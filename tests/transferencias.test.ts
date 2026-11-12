import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { transferirAtendimento } from "@/modulos/atendimento/transferencias";
import type { DadosTransferencia } from "@/modulos/atendimento/dados-transferencia";

const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ rpc: f.rpc, from: f.from }) }));
const ator = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const operacao = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const registro = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const destino = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const outro = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const u: Usuario = { id: ator, nome: "Pessoa fictícia", email: "teste@fixture.invalid", papel: "recepcao", setor: "oficina", unidade: "comauto", unidades: ["comauto"] };
const dados: DadosTransferencia = { operacaoId: operacao, origem: "central", registroId: registro,
  destino: "pecas", funil: null, responsavelId: null, nota: "Solicitação fictícia", versao: 0 };
const sucesso = { ok: true, operacaoId: operacao, setorDestino: "pecas", idDestino: destino, reutilizado: false };

beforeEach(() => {
  vi.resetAllMocks();
  f.from.mockImplementation(() => { throw new Error("Consulta solta proibida"); });
  f.rpc.mockResolvedValue({ data: sucesso, error: null });
});

describe("transferência pelo adaptador transacional", () => {
  it("faz uma RPC com ator autenticado e nenhum SELECT separado", async () => {
    expect(await transferirAtendimento(u, dados)).toEqual(sucesso);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("transferir_atendimento_setor", {
      p_operacao: operacao, p_origem: "central", p_registro: registro, p_ator: ator,
      p_destino: "pecas", p_funil: null, p_responsavel: null, p_nota: dados.nota, p_versao: 0,
    });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("normaliza IDs e nota, ignorando ator/cliente/unidade do objeto", async () => {
    const entrada = { ...dados, operacaoId: operacao.toUpperCase(), registroId: registro.toUpperCase(), nota: `  ${dados.nota}  `,
      ator: outro, p_ator: outro, cliente: outro, unidade: "outra", mensagemIds: [outro], historico: [outro] };
    expect(await transferirAtendimento({ ...u, id: ator.toUpperCase() }, entrada)).toEqual(sucesso);
    expect(f.rpc.mock.calls[0][1]).toEqual({ p_operacao: operacao, p_origem: "central", p_registro: registro, p_ator: ator,
      p_destino: "pecas", p_funil: null, p_responsavel: null, p_nota: dados.nota, p_versao: 0 });
  });

  it("retorna somente DTO mínimo e aceita reuso explícito", async () => {
    f.rpc.mockResolvedValue({ data: { ...sucesso, operacaoId: operacao.toUpperCase(), idDestino: destino.toUpperCase(), reutilizado: true,
      clienteId: outro, telefone: "privado", mensagens: [{ conteudo: "não exportar" }], metadata: { interno: true } }, error: null });
    expect(await transferirAtendimento(u, dados)).toEqual({ ...sucesso, reutilizado: true });
  });

  it("não transforma a passagem de área em autorização persistente de replay", async () => {
    expect(await transferirAtendimento(u, dados)).toEqual(sucesso);
    expect(await transferirAtendimento(u, dados)).toEqual(sucesso);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.rpc.mock.calls[0]).toEqual(f.rpc.mock.calls[1]);
  });

  it.each([
    ["central", "recepcao", "oficina"], ["vendas", "vendedor", "vendas"], ["pecas", "pecas", "pecas"],
    ["oficina", "consultor_tecnico", "oficina"], ["central", "gerente", "oficina"], ["pecas", "admin", "administracao"],
  ] as const)("mapeia origem %s à área correspondente", async (origem, papel, setor) => {
    const d: DadosTransferencia = { ...dados, origem, destino: origem === "pecas" ? "oficina" : "pecas" };
    f.rpc.mockResolvedValue({ data: { ...sucesso, setorDestino: d.destino }, error: null });
    expect(await transferirAtendimento({ ...u, papel, setor }, d)).toMatchObject({ ok: true });
    expect(f.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["central", "vendedor", "vendas"], ["central", "gerente", "pecas"], ["pecas", "recepcao", "oficina"],
    ["vendas", "gerente", "pecas"], ["oficina", "pecas", "pecas"],
  ] as const)("barra área local %s ao perfil %s/%s", async (origem, papel, setor) => {
    expect(await transferirAtendimento({ ...u, papel, setor }, { ...dados, origem, destino: origem === "pecas" ? "oficina" : "pecas" })).toMatchObject({ ok: false, status: 403 });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { ...dados, operacaoId: "inválido" }, { ...dados, registroId: registro + "\n" }, { ...dados, versao: -1 },
    { ...dados, nota: "" }, { ...dados, destino: "pecas", origem: "pecas" },
    { ...dados, responsavelId: "nome livre" }, { ...dados, destino: "oficina", responsavelId: outro + "\n" },
  ])("recusa dados inválidos antes de consultar o banco: %j", async entrada => {
    expect(await transferirAtendimento(u, entrada as DadosTransferencia)).toMatchObject({ ok: false, status: 400 });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("recusa ator inválido antes de consultar o banco", async () => {
    expect(await transferirAtendimento({ ...u, id: "sem-sessao" }, dados)).toMatchObject({ ok: false, status: 400 });
    expect(await transferirAtendimento(null as unknown as Usuario, dados)).toMatchObject({ ok: false, status: 400 });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it.each(["vendas", "pecas", "oficina"] as const)("transporta pessoa ou fila para %s, com funil apenas em Vendas", async destino => {
    const funil = destino === "vendas" ? "novos" : null;
    const d: DadosTransferencia = { ...dados, destino, funil, responsavelId: outro.toUpperCase() };
    f.rpc.mockResolvedValue({ data: { ...sucesso, setorDestino: destino }, error: null });
    expect(await transferirAtendimento(u, d)).toMatchObject({ ok: true, setorDestino: destino });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("transferir_atendimento_setor", {
      p_operacao: operacao, p_origem: "central", p_registro: registro, p_ator: ator,
      p_destino: destino, p_funil: funil, p_responsavel: outro, p_nota: dados.nota, p_versao: 0,
    });
    f.rpc.mockClear();
    expect(await transferirAtendimento(u, { ...d, responsavelId: null })).toMatchObject({ ok: true, setorDestino: destino });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("transferir_atendimento_setor", {
      p_operacao: operacao, p_origem: "central", p_registro: registro, p_ator: ator,
      p_destino: destino, p_funil: funil, p_responsavel: null, p_nota: dados.nota, p_versao: 0,
    });
  });

  it.each([["invalido", 400], ["nao_encontrado", 404], ["conflito", 409], ["origem_ambigua", 409], ["envio_incerto", 409]] as const)("mapeia recusa SQL %s sem repetir chamada", async (codigo, status) => {
    f.rpc.mockResolvedValue({ data: { ok: false, codigo, mensagens: "não exportar", clienteId: outro }, error: null });
    const r = await transferirAtendimento(u, dados);
    expect(r).toMatchObject({ ok: false, status, codigo });
    expect(r).not.toHaveProperty("mensagens");
    expect(r).not.toHaveProperty("clienteId");
    expect(JSON.stringify(r)).not.toContain("não exportar");
    expect(f.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    null, [], "texto", {}, { ok: "true" }, { ...sucesso, operacaoId: outro }, { ...sucesso, operacaoId: operacao + "\n" },
    { ...sucesso, setorDestino: "oficina" }, { ...sucesso, idDestino: "não-uuid" }, { ...sucesso, reutilizado: "false" },
    { ...sucesso, reutilizado: undefined }, { ok: false, codigo: "codigo_interno" },
  ])("retorno desconhecido/inconsistente não é sucesso: %j", async data => {
    f.rpc.mockResolvedValue({ data, error: null });
    expect(await transferirAtendimento(u, dados)).toMatchObject({ ok: false, status: 503 });
    expect(f.rpc).toHaveBeenCalledOnce();
  });

  it.each(["PGRST202", "42501", "23505", "08006"])("não repete erro de banco %s e não exporta detalhes", async code => {
    f.rpc.mockResolvedValue({ data: sucesso, error: { code, message: "detalhe privado" } });
    const r = await transferirAtendimento(u, dados);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(r)).not.toContain("detalhe privado");
    expect(f.rpc).toHaveBeenCalledOnce();
  });

  it("rejeição da chamada não gera repetição automática", async () => {
    f.rpc.mockRejectedValue(new Error("transporte indisponível"));
    expect(await transferirAtendimento(u, dados)).toMatchObject({ ok: false, status: 503 });
    expect(f.rpc).toHaveBeenCalledOnce();
  });
});
