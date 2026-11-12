import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { obterOpcoesTransferencia } from "@/modulos/atendimento/opcoes-transferencia";
import { prepararTransferenciaCartao, confirmarTransferenciaCartao } from "@/app/painel/transferencia-actions";
import type { DadosTransferencia } from "@/modulos/atendimento/dados-transferencia";

const f = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ from: f.from, rpc: f.rpc }) }));
vi.mock("@/lib/auth", () => ({ exigirAcesso: f.auth }));
vi.mock("next/cache", () => ({ revalidatePath: f.revalidate }));
vi.mock("@/lib/env", () => ({ valoresSecretos: () => ["segredo-ficticio-do-teste"] }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", registro = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pessoa = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", extra = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const outro = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", op = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const u: Usuario = { id, nome: "Operador fictício", email: "vendas@fixture.invalid", papel: "vendedor", setor: "vendas", unidade: "comauto", unidades: ["comauto"] };
type Resposta = { data: unknown; error: { code: string; message?: string } | null };
const respostas = new Map<string, Resposta>();
const filtros: { tabela: string; metodo: string; args: unknown[] }[] = [];
function resultado(tabela: string): Resposta { return respostas.get(tabela) ?? { data: null, error: null }; }
function consulta(tabela: string) {
  const q: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "is", "not", "in", "or", "order"]) q[metodo] = (...args: unknown[]) => { filtros.push({ tabela, metodo, args }); return q; };
  q.maybeSingle = () => Promise.resolve(resultado(tabela));
  q.then = (resolve: (r: Resposta) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(resultado(tabela)).then(resolve, reject);
  return q;
}
beforeEach(() => {
  vi.resetAllMocks(); respostas.clear(); filtros.length = 0;
  f.from.mockImplementation(consulta); f.auth.mockResolvedValue(u);
  respostas.set("vendas_oportunidades", { data: { id: registro, unidade: "comauto", atendimento: { versao: 7 } }, error: null });
  respostas.set("pecas_cotacoes", { data: { id: registro, unidade: "comauto", atendimento: null }, error: null });
  respostas.set("oficina_atendimentos", { data: { id: registro, unidade: "comauto" }, error: null });
  respostas.set("usuario_unidades", { data: [{ user_id: extra }], error: null });
  respostas.set("usuarios", { data: [
    { user_id: id, nome: "Vendas", papel: "vendedor", setor: "vendas", unidade: "comauto" },
    { user_id: pessoa, nome: "Peças", papel: "pecas", setor: "pecas", unidade: "comauto" },
    { user_id: extra, nome: "Consultor extra", papel: "consultor_tecnico", setor: "oficina", unidade: "motomecanica" },
    { user_id: outro, nome: "Outro setor", papel: "gerente", setor: "administracao", unidade: "comauto" },
    { user_id: op, nome: "Outra unidade", papel: "pecas", setor: "pecas", unidade: "santaluzia" },
  ], error: null });
  respostas.set("vendas_funis", { data: [{ chave: "novos" }, { chave: "seminovos" }], error: null });
  f.rpc.mockResolvedValue({ data: { ok: true, operacaoId: op, setorDestino: "pecas", idDestino: pessoa, reutilizado: false, avisoResponsavel: null }, error: null });
});
const temFiltro = (tabela: string, metodo: string, ...args: unknown[]) => filtros.some(filtro => filtro.tabela === tabela && filtro.metodo === metodo && JSON.stringify(filtro.args) === JSON.stringify(args));

describe("opções de transferência pelos cartões", () => {
  it("projeta só versão e opções elegíveis da unidade, sem dados do cliente ou da sessão", async () => {
    const r = await obterOpcoesTransferencia(u, "vendas", registro, "comauto");
    expect(r).toEqual({ ok: true, versao: 7, destinos: [
      { setor: "pecas", responsaveis: [{ id: pessoa, nome: "Peças" }] },
      { setor: "oficina", responsaveis: [{ id: extra, nome: "Consultor extra" }] },
    ] });
    expect(JSON.stringify(r)).not.toMatch(/email|fixture|cliente|telefone|unidade|historico|mensagens|Outro setor|Outra unidade/);
    expect(temFiltro("vendas_oportunidades", "eq", "vendedor_id", id)).toBe(true);
    for (const [coluna, valor] of [["unidade", "comauto"], ["cliente.anonimizado", false], ["loja.ativa", true], ["funil.ativo", true], ["etapa.ativo", true], ["etapa.tipo", "aberta"]]) expect(temFiltro("vendas_oportunidades", "eq", coluna, valor)).toBe(true);
    expect(temFiltro("vendas_oportunidades", "is", "fechado_em", null)).toBe(true);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(["central", "outro", null, {}, "__proto__"])("recusa origem inválida %s sem consultar", async origem => {
    expect(await obterOpcoesTransferencia(u, origem, registro, "comauto")).toMatchObject({ ok: false, status: 400 });
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each(["comauto,unidade.eq.outra", "comauto)or(true", "", null])("recusa unidade inválida sem interpolar filtros", async unidade => {
    expect(await obterOpcoesTransferencia(u, "vendas", registro, unidade)).toMatchObject({ ok: false, status: 400 });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("recusa unidade alheia e área indevida antes de ler equipe", async () => {
    expect(await obterOpcoesTransferencia(u, "vendas", registro, "santaluzia")).toMatchObject({ ok: false, status: 403 });
    expect(await obterOpcoesTransferencia(u, "pecas", registro, "comauto")).toMatchObject({ ok: false, status: 403 });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("não enumera pessoas se o cartão não existe ou está fora da carteira", async () => {
    respostas.set("vendas_oportunidades", { data: null, error: null });
    expect(await obterOpcoesTransferencia(u, "vendas", registro, "comauto")).toMatchObject({ ok: false, status: 404 });
    expect(f.from).toHaveBeenCalledTimes(1);
  });
  it("gerência autorizada não aplica filtro de dono; origem Peças exclui encerradas e mantém versão zero sem canal", async () => {
    const r = await obterOpcoesTransferencia({ ...u, papel: "gerente", setor: "pecas" }, "pecas", registro, "comauto");
    expect(r).toMatchObject({ ok: true, versao: 0, destinos: [{ setor: "vendas", funis: ["novos", "seminovos"] }, { setor: "oficina" }] });
    expect(temFiltro("pecas_cotacoes", "not", "status", "in", "(entregue,perdido,cancelado)")).toBe(true);
    expect(temFiltro("pecas_cotacoes", "eq", "responsavel_id", id)).toBe(false);
  });
  it("Oficina mantém domínio de duas etapas, só responsável ou supervisão e versão zero", async () => {
    expect(await obterOpcoesTransferencia({ ...u, papel: "recepcao", setor: "oficina" }, "oficina", registro, "comauto")).toMatchObject({ ok: true, versao: 0 });
    expect(temFiltro("oficina_atendimentos", "eq", "responsavel_id", id)).toBe(true);
    expect(temFiltro("oficina_atendimentos", "in", "status", ["novo", "em_triagem"])).toBe(true);
  });
  it("inclui unidade adicional e permite admin em unidade ativa diferente", async () => {
    expect(await obterOpcoesTransferencia({ ...u, unidade: "motomecanica", unidades: ["motomecanica", "comauto"] }, "vendas", registro, "comauto")).toMatchObject({ ok: true });
    expect(await obterOpcoesTransferencia({ ...u, papel: "admin", unidade: "motomecanica", unidades: ["motomecanica"] }, "vendas", registro, "comauto")).toMatchObject({ ok: true });
  });
  it.each([undefined, -1, 1.2, 2147483647, "7"])("não substitui versão inválida por zero: %s", async versao => {
    respostas.set("vendas_oportunidades", { data: { id: registro, unidade: "comauto", atendimento: { versao } }, error: null });
    expect(await obterOpcoesTransferencia(u, "vendas", registro, "comauto")).toMatchObject({ ok: false, status: 503 });
  });
  it("aceita relação um-para-um como array e recusa mais de um vínculo", async () => {
    for (const atendimento of [[], [{ versao: 9 }]]) {
      respostas.set("vendas_oportunidades", { data: { id: registro, unidade: "comauto", atendimento }, error: null });
      expect(await obterOpcoesTransferencia(u, "vendas", registro, "comauto")).toMatchObject({ ok: true, versao: atendimento.length ? 9 : 0 });
    }
    respostas.set("vendas_oportunidades", { data: { id: registro, unidade: "comauto", atendimento: [{ versao: 1 }, { versao: 2 }] }, error: null });
    expect(await obterOpcoesTransferencia(u, "vendas", registro, "comauto")).toMatchObject({ ok: false, status: 503 });
  });
  it.each(["vendas_oportunidades", "usuario_unidades", "usuarios", "vendas_funis"])("falha de consulta %s não vira opções vazias", async tabela => {
    respostas.set(tabela, { data: null, error: { code: "XX000", message: "segredo-ficticio-do-teste" } });
    const r = await obterOpcoesTransferencia(u, "vendas", registro, "comauto");
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(r)).not.toContain("segredo-ficticio");
  });
  it("omite Vendas sem funil ativo e não inventa catálogo", async () => {
    respostas.set("vendas_funis", { data: [], error: null });
    const r = await obterOpcoesTransferencia({ ...u, papel: "pecas", setor: "pecas" }, "pecas", registro, "comauto");
    expect(r).toMatchObject({ ok: true, destinos: [{ setor: "oficina" }] });
  });
  it("mascara CPF/cartão e segredos nos nomes da equipe", async () => {
    respostas.set("usuarios", { data: [
      { user_id: pessoa, nome: "Pessoa 123.456.789-00", papel: "pecas", setor: "pecas", unidade: "comauto" },
      { user_id: extra, nome: "segredo-ficticio-do-teste", papel: "recepcao", setor: "oficina", unidade: "comauto" },
    ], error: null });
    const r = await obterOpcoesTransferencia(u, "vendas", registro, "comauto");
    expect(r).toMatchObject({ ok: true, destinos: [{ responsaveis: [{ nome: "Pessoa [CPF removido]" }] }, { responsaveis: [{ nome: "Pessoa da equipe" }] }] });
  });
});

describe("actions reais ligam sessão → formulário → RPC existente", () => {
  const dados: DadosTransferencia = { operacaoId: op, origem: "vendas", registroId: registro, destino: "pecas", funil: null, responsavelId: null, nota: "Encaminhamento fictício", versao: 7 };
  it("preparo exige sessão e não escreve; confirmar faz uma RPC com identidade atual e versão do formulário", async () => {
    const preparo = await prepararTransferenciaCartao("vendas", registro, "comauto");
    expect(preparo).toMatchObject({ ok: true, versao: 7 });
    expect(f.rpc).not.toHaveBeenCalled();
    await confirmarTransferenciaCartao({ ...dados, ator: outro, unidade: "outra", email: "forjado@fixture.invalid" } as DadosTransferencia);
    expect(f.auth).toHaveBeenCalledTimes(2);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("transferir_atendimento_setor", {
      p_operacao: op, p_origem: "vendas", p_registro: registro, p_ator: id, p_destino: "pecas", p_funil: null,
      p_responsavel: null, p_nota: dados.nota, p_versao: 7, p_ator_email: u.email,
    });
    expect(f.revalidate.mock.calls).toEqual([["/painel/vendas"], ["/painel/pecas"], ["/painel/oficina"]]);
  });
  it("central forjada é recusada pela action sem chegar à RPC", async () => {
    expect(await confirmarTransferenciaCartao({ ...dados, origem: "central" })).toMatchObject({ ok: false, status: 403 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("reconsulta sessão ao confirmar e não herda autorização das opções", async () => {
    await prepararTransferenciaCartao("vendas", registro, "comauto");
    f.auth.mockResolvedValue({ ...u, papel: "financeiro" });
    expect(await confirmarTransferenciaCartao(dados)).toMatchObject({ ok: false, status: 403 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("falha ao invalidar cache preserva sucesso e não repete a RPC", async () => {
    f.revalidate.mockImplementation(() => { throw new Error("cache falhou"); });
    expect(await confirmarTransferenciaCartao(dados)).toMatchObject({ ok: true });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("aviso de reuso preserva sucesso sem expor segredo no nome armazenado", async () => {
    f.rpc.mockResolvedValue({ data: { ok: true, operacaoId: op, setorDestino: "pecas", idDestino: pessoa, reutilizado: true,
      avisoResponsavel: { nome: "segredo-ficticio-do-teste" } }, error: null });
    expect(await confirmarTransferenciaCartao(dados)).toMatchObject({ ok: true, reutilizado: true, avisoResponsavel: { nome: "Responsável atual" } });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["55P03", "40P01"])("conflito %s não vira sucesso ou retry", async code => {
    f.rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await confirmarTransferenciaCartao(dados)).toMatchObject({ ok: false, status: 409, codigo: "conflito" });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.revalidate).not.toHaveBeenCalled();
  });
  it("falha de transporte da RPC permanece incerta, sem repetir", async () => {
    f.rpc.mockRejectedValue(new Error("resposta perdida"));
    expect(await confirmarTransferenciaCartao(dados)).toMatchObject({ ok: false, status: 503 });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});
