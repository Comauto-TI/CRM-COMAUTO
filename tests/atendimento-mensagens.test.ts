import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { vincularMensagemEncaminhada } from "@/modulos/atendimento/mensagens";

const fixture = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));

const ator = "50000000-0000-4000-8000-000000000001";
const atendimentoId = "50000000-0000-4000-8000-000000000101";
const mensagemId = "50000000-0000-4000-8000-000000000201";
const outroId = "50000000-0000-4000-8000-000000000999";
const referencia = "wamid.fixture-mensagem-inicial-pecas";
const pecas: Usuario = { id: ator, nome: "Peças fictício", email: "pecas@example.test", papel: "pecas", setor: "pecas", unidade: "comauto", unidades: ["comauto"] };
const sucesso = { ok: true as const, atendimentoId, mensagemId, referencia, jaVinculado: false };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.db.mockReturnValue({ rpc: fixture.rpc });
  fixture.rpc.mockResolvedValue({ data: sucesso, error: null });
});

describe("A1.1b vínculo comprovado de mensagem inicial de Peças", () => {
  it("transporta somente atendimento, referência exata e ator autenticado", async () => {
    const u = { ...pecas, unidade: "unidade-injetada", unidades: ["unidade-injetada"], clienteId: outroId, conversaId: outroId, cotacaoId: outroId, mensagemId: outroId, owner: outroId };
    expect(await vincularMensagemEncaminhada(u, atendimentoId, referencia)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("vincular_mensagem_encaminhada", {
      p_atendimento_id: atendimentoId, p_referencia: referencia, p_ator: ator,
    });
    expect(Object.keys(fixture.rpc.mock.calls[0][1]).sort()).toEqual(["p_atendimento_id", "p_ator", "p_referencia"]);
  });
  it.each([false, true])("transporta jaVinculado=%s estritamente como booleano", async jaVinculado => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, jaVinculado }, error: null });
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toEqual({ ...sucesso, jaVinculado });
  });
  it("descarta campos internos adicionais do RPC", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, clienteId: outroId, conversaId: outroId, cotacaoId: outroId, unidade: "comauto", owner: outroId, detalhe: "fixture_interno" }, error: null });
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toEqual(sucesso);
  });
  it("normaliza os UUIDs sem alterar a identidade da referência", async () => {
    const atorUpper = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const atendimentoUpper = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
    const mensagemUpper = "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC";
    const referenciaExata = "wamid.Maiuscula E espaço interno";
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, atendimentoId: atendimentoUpper, mensagemId: mensagemUpper, referencia: referenciaExata }, error: null });
    expect(await vincularMensagemEncaminhada({ ...pecas, id: atorUpper }, atendimentoUpper, referenciaExata)).toEqual({
      ok: true, atendimentoId: atendimentoUpper.toLowerCase(), mensagemId: mensagemUpper.toLowerCase(), referencia: referenciaExata, jaVinculado: false,
    });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("vincular_mensagem_encaminhada", {
      p_atendimento_id: atendimentoUpper.toLowerCase(), p_referencia: referenciaExata, p_ator: atorUpper.toLowerCase(),
    });
  });
  it.each(["x", "x".repeat(512)])("aceita referência no limite de comprimento (%s)", async ref => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, referencia: ref }, error: null });
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, ref)).toEqual({ ...sucesso, referencia: ref });
    expect(fixture.rpc.mock.calls[0][1].p_referencia).toBe(ref);
  });
  it("cadastro antigo em memória não substitui autorização final SQL", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "nao_encontrado" }, error: null });
    const adminAntigo: Usuario = { ...pecas, papel: "admin", setor: "administracao", unidades: ["comauto", "santaluzia"] };
    expect(await vincularMensagemEncaminhada(adminAntigo, atendimentoId, referencia)).toMatchObject({ ok: false, status: 404 });
    expect(fixture.rpc.mock.calls[0][1]).toEqual({ p_atendimento_id: atendimentoId, p_referencia: referencia, p_ator: ator });
  });
});

describe("A1.1b perfis permitidos apenas como pré-filtro", () => {
  it.each([
    ["vendedor", "vendas"], ["financeiro", "administracao"], ["recepcao", "oficina"],
    ["atendente", "oficina"], ["consultor_tecnico", "oficina"], ["gerente", "oficina"], ["gerente", "vendas"],
  ])("%s de %s não acessa vínculo de Peças", async (papel, setor) => {
    const u = { ...pecas, papel, setor } as Usuario;
    expect(await vincularMensagemEncaminhada(u, atendimentoId, referencia)).toMatchObject({ ok: false, status: 403 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([["gerente", "pecas"], ["gerente", "administracao"], ["admin", "administracao"]])("%s de %s chega à revalidação SQL", async (papel, setor) => {
    expect(await vincularMensagemEncaminhada({ ...pecas, papel, setor } as Usuario, atendimentoId, referencia)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("A1.1b validação de entradas em runtime", () => {
  it.each([null, undefined, 1, {}, [], "", " " + atendimentoId, atendimentoId + " ", atendimentoId + "\n", atendimentoId.replaceAll("-", ""), "50000000-0000-4000-8000-00000000010z"])("recusa atendimento UUID inválido %j", async valor => {
    expect(await vincularMensagemEncaminhada(pecas, valor as string, referencia)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { ...pecas, id: "" }, { ...pecas, id: 1 }, { ...pecas, id: ator.replaceAll("-", "") }, { ...pecas, id: ator + "\n" }])("recusa ator inválido %j", async valor => {
    expect(await vincularMensagemEncaminhada(valor as Usuario, atendimentoId, referencia)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, 1, {}, [], "", " ", "x".repeat(513), " " + referencia, referencia + " ", "\t" + referencia, referencia + "\n", "\u00a0" + referencia, referencia + "\u00a0"])("recusa referência inválida sem normalizá-la %j", async valor => {
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, valor as string)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it("objeto do navegador com mensagem/cliente/conversa não é referência suficiente", async () => {
    const origemSemLedger = { referencia, mensagemId, clienteId: outroId, conversaId: outroId, cotacaoId: outroId };
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, origemSemLedger as unknown as string)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});

describe("A1.1b erros e correlação da resposta", () => {
  it.each([["nao_encontrado", 404], ["conflito", 409], ["desconhecido", 503]])("mapeia %s para%s sem detalhes internos", async (codigo, status) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo, motivo: "fixture_interno", clienteId: outroId }, error: null });
    const r = await vincularMensagemEncaminhada(pecas, atendimentoId, referencia);
    expect(r).toMatchObject({ ok: false, status });
    expect(Object.keys(r).sort()).toEqual(["motivo", "ok", "status"]);
    expect(JSON.stringify(r)).not.toMatch(/fixture_interno|50000000-0000-4000-8000-000000000999/);
  });
  it("erro SQL prevalece sobre sucesso e não vaza código nem diagnóstico", async () => {
    fixture.rpc.mockResolvedValue({ data: sucesso, error: { code: "42501", message: "fixture_interno", details: "fixture_detalhe" } });
    const r = await vincularMensagemEncaminhada(pecas, atendimentoId, referencia);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(r)).not.toMatch(/42501|fixture_/);
  });
  it("exceção ou envelope inválido não confirma vínculo", async () => {
    fixture.rpc.mockRejectedValue(new Error("fixture_interno"));
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue(null);
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
    fixture.db.mockImplementation(() => { throw new Error("fixture_configuração"); });
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    null, [], "fixture_interno", {}, { ...sucesso, ok: "true" }, { ...sucesso, atendimentoId: null },
    { ...sucesso, atendimentoId: atendimentoId.replaceAll("-", "") }, { ...sucesso, mensagemId: null },
    { ...sucesso, mensagemId: mensagemId.replaceAll("-", "") }, { ...sucesso, referencia: null },
    { ...sucesso, atendimentoId: atendimentoId + "\n" }, { ...sucesso, mensagemId: mensagemId + "\n" },
    { ...sucesso, jaVinculado: "false" }, { ...sucesso, jaVinculado: 0 }, { ...sucesso, jaVinculado: null },
  ])("recusa sucesso malformado %j", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    { ...sucesso, atendimentoId: outroId }, { ...sucesso, referencia: referencia.toUpperCase() },
    { ...sucesso, referencia: referencia + " " }, { ...sucesso, referencia: "wamid.outro" },
  ])("recusa resposta de outro atendimento ou referência %j", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
  });
});
