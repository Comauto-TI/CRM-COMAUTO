import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { obterQuadroPecas, moverNoQuadroPecas } from "@/modulos/pecas/quadro";
import { moverCotacaoQuadro } from "@/app/painel/pecas/quadro-actions";

const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), acesso: vi.fn(), revalidar: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ rpc: f.rpc, from: f.from }) }));
vi.mock("@/lib/auth", () => ({ exigirAcesso: f.acesso }));
vi.mock("next/cache", () => ({ revalidatePath: f.revalidar }));
const ator = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const item = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const u: Usuario = { id: ator, papel: "pecas", setor: "pecas", nome: "Peças fictício", email: "pecas@fixture.invalid", unidade: "comauto", unidades: ["comauto"] };
const criadoEm = "2026-11-11T12:00:00.000001Z";
const cartao = { id, unidade: "comauto", origem: "whatsapp", descricao: "Pastilha dianteira", status: "em_cotacao", posicao: 1.5,
  criadoEm, atualizadoEm: criadoEm, entrouEm: criadoEm, ultimoContatoEm: null, clienteNome: "Cliente fictício", responsavelNome: "Peças fictício",
  responsavelId: ator, valorCentavos: 12500, podeMover: true, itensVersoes: { [item]: 1 } };
const sucesso = { ok: true, cotacoes: [cartao], total: 1, temMais: false };
const indisponivel = { ok: false, pendente: false };
const mover = (usuario = u) => moverNoQuadroPecas(usuario, id, "aguardando_cliente", 42.25, "em_cotacao", { [item]: 1 });

beforeEach(() => {
  vi.resetAllMocks();
  f.rpc.mockResolvedValue({ data: sucesso, error: null });
  f.from.mockImplementation(() => { throw new Error("Consulta ou escrita fora da RPC proibida"); });
  f.acesso.mockResolvedValue(u);
});

describe("Quadro Peças loader autorizado e DTO mínimo", () => {
  it("consulta somente ator na RPC, preservando centavos, ordem e micros", async () => {
    expect(await obterQuadroPecas(u)).toEqual(sucesso);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("pecas_quadro", { p_ator: ator });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("não passa unidade/carteira enviadas por fora como autoridade", async () => {
    await obterQuadroPecas({ ...u, unidade: "injetada", unidades: ["injetada"] });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("pecas_quadro", { p_ator: ator });
  });
  it("mascara descrição e nomes com helper real e descarta dados extras sem mutar DB", async () => {
    const original = Object.freeze({ ...cartao, descricao: "CPF 111.444.777-35", clienteNome: "Cartão 4111 1111 1111 1111", responsavelNome: "CPF 11144477735", telefone: "fixture_privado", metadata: { senha: "fixture_privado" } });
    f.rpc.mockResolvedValue({ data: Object.freeze({ ...sucesso, cotacoes: Object.freeze([original]), fonte: "fixture_privado" }), error: null });
    const r = await obterQuadroPecas(u); expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/111\.444|11144477735|4111|fixture_privado|metadata/);
    expect(original.descricao).toBe("CPF 111.444.777-35");
    if (r.ok) expect(r.cotacoes[0].descricao).toBe("CPF [CPF removido]");
  });
  it.each([0, 1, Number.MAX_SAFE_INTEGER, null])("preserva valorCentavos %j sem converter a reais", async valorCentavos => {
    f.rpc.mockResolvedValue({ data: { ...sucesso, cotacoes: [{ ...cartao, valorCentavos }] }, error: null });
    const r = await obterQuadroPecas(u); expect(r.ok).toBe(true); if (r.ok) expect(r.cotacoes[0].valorCentavos).toBe(valorCentavos);
  });
  it("aceita ficha nullable e quadro vazio completo", async () => {
    f.rpc.mockResolvedValue({ data: { ...sucesso, cotacoes: [{ ...cartao, clienteNome: null, responsavelNome: null, responsavelId: null, valorCentavos: null, itensVersoes: {} }] }, error: null });
    expect((await obterQuadroPecas(u)).ok).toBe(true);
    f.rpc.mockResolvedValue({ data: { ok: true, cotacoes: [], total: 0, temMais: false }, error: null });
    expect(await obterQuadroPecas(u)).toEqual({ ok: true, cotacoes: [], total: 0, temMais: false });
  });
  it("recusa ID duplicado inclusive com outra capitalização UUID", async () => {
    f.rpc.mockResolvedValue({ data: { ...sucesso, cotacoes: [cartao, { ...cartao, id: id.toUpperCase() }], total: 2 }, error: null });
    expect(await obterQuadroPecas(u)).toEqual(indisponivel);
  });
  it.each([
    { id: id + "\n" }, { unidade: null }, { origem: "interna" }, { descricao: null }, { status: "inventada" },
    { posicao: NaN }, { posicao: Infinity }, { posicao: 1e9 + 1 },
    { criadoEm: "2026-02-30T12:00:00Z" }, { atualizadoEm: "2026-11-11T24:00:00Z" },
    { entrouEm: "2026-11-11T12:00:00+16:00" }, { ultimoContatoEm: "2026-11-11T12:00:00.1234567Z" },
    { clienteNome: 1 }, { responsavelNome: {} }, { responsavelId: ator + "\n" },
    { valorCentavos: -1 }, { valorCentavos: 1.5 }, { valorCentavos: "12500" }, { valorCentavos: Number.MAX_SAFE_INTEGER + 1 },
    { podeMover: "true" }, { itensVersoes: null }, { itensVersoes: { "não_uuid": 1 } },
    { itensVersoes: { [item]: 0 } }, { itensVersoes: { [item]: 1.5 } }, { itensVersoes: { [item]: 2147483648 } },
  ])("recusa cartão inválido %j", async patch => {
    f.rpc.mockResolvedValue({ data: { ...sucesso, cotacoes: [{ ...cartao, ...patch }] }, error: null });
    expect(await obterQuadroPecas(u)).toEqual(indisponivel);
  });
  it.each([null, [], {}, { ...sucesso, ok: "true" }, { ...sucesso, total: "1" }, { ...sucesso, total: 2 }, { ...sucesso, temMais: true }])("envelope inconsistente %j não vira quadro vazio", async data => {
    f.rpc.mockResolvedValue({ data, error: null }); expect(await obterQuadroPecas(u)).toEqual(indisponivel);
  });
  it.each(["PGRST202", "PGRST205", "42P01", "42883"])("schema ausente %s fica pendente", async code => {
    f.rpc.mockResolvedValue({ data: null, error: { code, message: "fixture_privado" } });
    expect(await obterQuadroPecas(u)).toEqual({ ok: false, pendente: true });
  });
  it("erro operacional e throw não vazam diagnóstico nem fingem lista vazia", async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "fixture_privado" } }); expect(await obterQuadroPecas(u)).toEqual(indisponivel);
    f.rpc.mockRejectedValue(new Error("fixture_privado")); expect(await obterQuadroPecas(u)).toEqual(indisponivel);
  });
});

describe("Quadro Peças mover somente por RPC transacional", () => {
  it("envia snapshot de status/itens e motivo aparado, sem mutações soltas", async () => {
    f.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await moverNoQuadroPecas(u, id, "perdido", 3.5, "em_cotacao", { [item]: 2 }, "  Não aprovado  ")).toEqual({ ok: true });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("pecas_mover_quadro", { p_id: id, p_ator: ator, p_destino: "perdido", p_posicao: 3.5, p_status_esperado: "em_cotacao", p_itens: { [item]: 2 }, p_motivo: "Não aprovado" });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("erro de rollback/constraint da RPC não confirma movimento ou tenta corrigir em JS", async () => {
    f.rpc.mockResolvedValue({ data: { ok: true }, error: { code: "23514", message: "fixture_privado" } });
    const r = await mover(); expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain("fixture_privado");
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.from).not.toHaveBeenCalled();
  });
  it.each(["desatualizada", "sem_itens", "devolva_conversa", "transicao", "invalido", "__proto__", "fixture_privado"])("falha SQL %s não vira sucesso", async codigo => {
    f.rpc.mockResolvedValue({ data: { ok: false, codigo }, error: null });
    const r = await mover(); expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain("fixture_privado");
  });
  it("nenhum envelope/throw confirma a operação", async () => {
    for (const data of [null, [], {}, { ok: "true" }]) { f.rpc.mockResolvedValue({ data, error: null }); expect((await mover()).ok).toBe(false); }
    f.rpc.mockRejectedValue(new Error("fixture_privado")); expect((await mover()).ok).toBe(false);
  });
  it.each([
    { id: id + "\n" }, { destino: "qualquer" }, { posicao: Infinity }, { posicao: 1e9 + 1 },
    { status: "qualquer" }, { itens: { [item]: -1 } }, { itens: { [item]: 1.5 } }, { motivo: "x".repeat(501) },
  ])("input inválido %j não chama RPC", async patch => {
    const p = { id, destino: "aguardando_cliente", posicao: 1, status: "em_cotacao", itens: { [item]: 1 }, motivo: undefined as string | undefined, ...patch };
    expect((await moverNoQuadroPecas(u, p.id, p.destino, p.posicao, p.status, p.itens, p.motivo)).ok).toBe(false);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("mais de100 itens é recusado antes da RPC", async () => {
    const itens = Object.fromEntries(Array.from({ length: 101 }, (_, n) => [`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, 1]));
    expect((await moverNoQuadroPecas(u, id, "aguardando_cliente", 1, "em_cotacao", itens)).ok).toBe(false); expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe("Quadro Peças identidade/perfis e action", () => {
  it.each([null, undefined, {}, { ...u, id: ator + "\n" }, { ...u, papel: "vendedor" }, { ...u, papel: "gerente", setor: "oficina" }])("identidade/perfil inválido %j falha fechado", async usuario => {
    expect(await obterQuadroPecas(usuario as Usuario)).toEqual(indisponivel);
    expect((await moverNoQuadroPecas(usuario as Usuario, id, "aguardando_cliente", 42.25, "em_cotacao", { [item]: 1 })).ok).toBe(false);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([["pecas", "pecas"], ["gerente", "pecas"], ["gerente", "administracao"], ["admin", "administracao"]] as const)("perfil%s/%s ainda pode ser negado pelo SQL", async (papel, setor) => {
    const usuario = { ...u, papel, setor }; f.rpc.mockResolvedValue({ data: { ok: false, codigo: "indisponivel" }, error: null });
    expect((await mover(usuario)).ok).toBe(false); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("action usa usuário autenticado e só revalida após sucesso SQL", async () => {
    f.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await moverCotacaoQuadro(id, "aguardando_cliente", 4, "em_cotacao", { [item]: 1 })).toEqual({ ok: true });
    expect(f.acesso).toHaveBeenCalledExactlyOnceWith("pecas"); expect(f.revalidar).toHaveBeenCalledExactlyOnceWith("/painel/pecas");
    f.revalidar.mockClear(); f.rpc.mockResolvedValue({ data: { ok: false, codigo: "desatualizada" }, error: null });
    expect((await moverCotacaoQuadro(id, "aguardando_cliente", 4, "em_cotacao", { [item]: 1 })).ok).toBe(false); expect(f.revalidar).not.toHaveBeenCalled();
  });
});
