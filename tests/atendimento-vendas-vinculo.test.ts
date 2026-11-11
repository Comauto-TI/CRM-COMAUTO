import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { autorizarMensagemAtendimento, vincularMensagemEncaminhada, vincularMensagemVendas } from "@/modulos/atendimento/mensagens";

const fixture = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));

const ator = "70000000-0000-4000-8000-000000000001";
const atendimentoId = "70000000-0000-4000-8000-000000000101";
const mensagemId = "70000000-0000-4000-8000-000000000201";
const outroId = "70000000-0000-4000-8000-000000000999";
const referencia = "wamid.fixture-vendas-origem";
const vendedor: Usuario = { id: ator, nome: "Vendedor fictício", email: "vendedor@example.test", papel: "vendedor", setor: "vendas", unidade: "comauto", unidades: ["comauto"] };
const pecas: Usuario = { ...vendedor, papel: "pecas", setor: "pecas" };
const vinculo = { ok: true as const, atendimentoId, mensagemId, referencia, jaVinculado: false };
const autorizado = { ok: true as const, atendimentoId, mensagemId, referencia, setor: "vendas" as const };
const ambiguidade = { ok: false, status: 409, motivo: "A origem desta mensagem precisa de revisão antes de continuar" };
const argsBase = { p_atendimento_id: atendimentoId, p_referencia: referencia, p_ator: ator };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.db.mockReturnValue({ rpc: fixture.rpc });
  fixture.rpc.mockResolvedValue({ data: { ...vinculo, setor: "vendas" }, error: null });
});

describe("A1.1d bind de Vendas e guarda de leitura", () => {
  it("Vendas vincula por seu RPC sem aceitar setor, unidade, cliente, conversa ou dono como autoridade", async () => {
    const u = { ...vendedor, unidades: ["unidade-injetada"], unidade: "unidade-injetada", clienteId: outroId, conversaId: outroId, owner: outroId, setorDoBind: "pecas" };
    expect(await vincularMensagemVendas(u, atendimentoId, referencia)).toEqual(vinculo);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("vincular_mensagem_vendas", argsBase);
  });
  it.each([false, true])("Vendas preserva jaVinculado=%s e descarta conteúdo/IDs adicionais", async jaVinculado => {
    fixture.rpc.mockResolvedValue({ data: { ...vinculo, jaVinculado, texto: "fixture_conteudo", conversaId: outroId }, error: null });
    expect(await vincularMensagemVendas(vendedor, atendimentoId, referencia)).toEqual({ ...vinculo, jaVinculado });
  });
  it("autorização retorna apenas referências/setor e transporta só o contexto mínimo", async () => {
    const u = { ...vendedor, clienteId: outroId, conversaId: outroId, owner: outroId, unidades: [] };
    fixture.rpc.mockResolvedValue({ data: { ...autorizado, texto: "fixture_conteudo", clienteId: outroId, unidade: "comauto", jaVinculado: true }, error: null });
    expect(await autorizarMensagemAtendimento(u, atendimentoId, referencia, "vendas")).toEqual(autorizado);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("autorizar_mensagem_atendimento", { ...argsBase, p_setor: "vendas" });
  });
  it("autorização Peças segue seu contexto, sem liberar Vendas", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...autorizado, setor: "pecas" }, error: null });
    expect(await autorizarMensagemAtendimento(pecas, atendimentoId, referencia, "pecas")).toEqual({ ...autorizado, setor: "pecas" });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("autorizar_mensagem_atendimento", { ...argsBase, p_setor: "pecas" });
  });
  it("ausência da associação no SQL não é tratada como autorização implícita", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "nao_encontrado" }, error: null });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 404 });
    expect(fixture.rpc.mock.calls[0][0]).toBe("autorizar_mensagem_atendimento");
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("normaliza apenas UUIDs e conserva referência opaca exata", async () => {
    const id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const msg = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
    const atorUpper = "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC";
    const ref = "wamid.Maiúscula Espaço interno";
    fixture.rpc.mockResolvedValue({ data: { ...vinculo, atendimentoId: id, mensagemId: msg, referencia: ref, setor: "vendas" }, error: null });
    const u = { ...vendedor, id: atorUpper };
    expect(await vincularMensagemVendas(u, id, ref)).toEqual({ ...vinculo, atendimentoId: id.toLowerCase(), mensagemId: msg.toLowerCase(), referencia: ref });
    expect(await autorizarMensagemAtendimento(u, id, ref, "vendas")).toEqual({ ...autorizado, atendimentoId: id.toLowerCase(), mensagemId: msg.toLowerCase(), referencia: ref });
    expect(fixture.rpc.mock.calls.map(c => c[1])).toEqual([
      { p_atendimento_id: id.toLowerCase(), p_referencia: ref, p_ator: atorUpper.toLowerCase() },
      { p_atendimento_id: id.toLowerCase(), p_referencia: ref, p_ator: atorUpper.toLowerCase(), p_setor: "vendas" },
    ]);
  });
});

describe("A1.1d perfil local é pré-filtro, SQL revalida domínio atual", () => {
  it.each([
    ["pecas", "pecas"], ["gerente", "pecas"], ["gerente", "oficina"], ["recepcao", "oficina"],
    ["consultor_tecnico", "oficina"], ["financeiro", "administracao"],
  ])("%s de %s não vincula nem autoriza Vendas", async (papel, setor) => {
    const u = { ...vendedor, papel, setor } as Usuario;
    expect(await vincularMensagemVendas(u, atendimentoId, referencia)).toMatchObject({ ok: false, status: 403 });
    expect(await autorizarMensagemAtendimento(u, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 403 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([["vendedor", "vendas"], ["gerente", "vendas"], ["gerente", "administracao"], ["admin", "administracao"]])("%s de %s chega à autorização SQL de Vendas", async (papel, setor) => {
    const u = { ...vendedor, papel, setor } as Usuario;
    expect(await vincularMensagemVendas(u, atendimentoId, referencia)).toEqual(vinculo);
    expect(await autorizarMensagemAtendimento(u, atendimentoId, referencia, "vendas")).toEqual(autorizado);
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
  });
  it("vendedor não usa o bind/guarda de Peças", async () => {
    expect(await vincularMensagemEncaminhada(vendedor, atendimentoId, referencia)).toMatchObject({ ok: false, status: 403 });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "pecas")).toMatchObject({ ok: false, status: 403 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("perfil admin antigo na memória não sobrepõe recusa SQL", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "nao_encontrado" }, error: null });
    const u: Usuario = { ...vendedor, papel: "admin", setor: "administracao", unidades: ["comauto", "santaluzia"] };
    expect(await vincularMensagemVendas(u, atendimentoId, referencia)).toMatchObject({ ok: false, status: 404 });
    expect(await autorizarMensagemAtendimento(u, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 404 });
    expect(fixture.rpc.mock.calls.map(c => c[1])).toEqual([argsBase, { ...argsBase, p_setor: "vendas" }]);
  });
});

describe("A1.1d entradas e correlação estritas", () => {
  it.each([
    [null, referencia], [undefined, referencia], [1, referencia], [atendimentoId.replaceAll("-", ""), referencia],
    [atendimentoId, null], [atendimentoId, undefined], [atendimentoId, {}], [atendimentoId, ""],
    [atendimentoId, "x".repeat(513)], [atendimentoId, " " + referencia], [atendimentoId, referencia + "\n"],
  ])("recusa ID/ref inválidos %j/%j", async (id, ref) => {
    expect(await vincularMensagemVendas(vendedor, id as string, ref as string)).toMatchObject({ ok: false, status: 400 });
    expect(await autorizarMensagemAtendimento(vendedor, id as string, ref as string, "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { ...vendedor, id: 2 }, { ...vendedor, id: "" }])("recusa ator runtime inválido %j", async u => {
    expect(await vincularMensagemVendas(u as Usuario, atendimentoId, referencia)).toMatchObject({ ok: false, status: 400 });
    expect(await autorizarMensagemAtendimento(u as Usuario, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "oficina", "administracao", "VENDAS", {}, 2])("guarda recusa setor inválido %j", async setor => {
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, setor as "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it.each(["x", "x".repeat(512)])("preserva referências nos limites1..512 (%s)", async ref => {
    fixture.rpc.mockResolvedValue({ data: { ...vinculo, referencia: ref, setor: "vendas" }, error: null });
    expect(await vincularMensagemVendas(vendedor, atendimentoId, ref)).toEqual({ ...vinculo, referencia: ref });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, ref, "vendas")).toEqual({ ...autorizado, referencia: ref });
  });
  it.each([
    null, [], {}, { ...vinculo, ok: "true", setor: "vendas" }, { ...vinculo, atendimentoId: null, setor: "vendas" },
    { ...vinculo, mensagemId: null, setor: "vendas" }, { ...vinculo, mensagemId: mensagemId.replaceAll("-", ""), setor: "vendas" },
    { ...vinculo, atendimentoId: outroId, setor: "vendas" }, { ...vinculo, referencia: referencia.toUpperCase(), setor: "vendas" },
  ])("ambos recusam sucesso malformado/descorrelacionado %j", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await vincularMensagemVendas(vendedor, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it.each([undefined, null, "false", 0])("bind exige jaVinculado booleano, recebido %s", async jaVinculado => {
    fixture.rpc.mockResolvedValue({ data: { ...vinculo, jaVinculado }, error: null });
    expect(await vincularMensagemVendas(vendedor, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
  });
  it.each([undefined, null, "pecas", "oficina", 2])("guarda exige setor retornado igual ao pedido, recebido %s", async setor => {
    fixture.rpc.mockResolvedValue({ data: { ...autorizado, setor }, error: null });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
});

describe("A1.1d ambiguidade e erros não revelam contexto de outros setores", () => {
  it("binds Peças/Vendas e guarda retornam origem_ambigua sem IDs, setores ou diagnóstico", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "origem_ambigua", setores: ["pecas", "vendas"], ids: [outroId], motivo: "fixture_interno" }, error: null });
    expect(await vincularMensagemEncaminhada(pecas, atendimentoId, referencia)).toEqual(ambiguidade);
    expect(await vincularMensagemVendas(vendedor, atendimentoId, referencia)).toEqual(ambiguidade);
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toEqual(ambiguidade);
  });
  it("guarda rejeita ambiguidade surgida após um bind antes confirmado", async () => {
    expect(await vincularMensagemVendas(vendedor, atendimentoId, referencia)).toEqual(vinculo);
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "origem_ambigua" }, error: null });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toEqual(ambiguidade);
    expect(fixture.rpc.mock.calls.map(c => c[0])).toEqual(["vincular_mensagem_vendas", "autorizar_mensagem_atendimento"]);
  });
  it.each([["nao_encontrado", 404], ["conflito", 409], ["desconhecido", 503]])("mapeia %s para%s sem propagar erro cru", async (codigo, status) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo, motivo: "fixture_interno", mensagemId: outroId }, error: null });
    for (const r of [await vincularMensagemVendas(vendedor, atendimentoId, referencia), await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")]) {
      expect(r).toMatchObject({ ok: false, status });
      expect(Object.keys(r).sort()).toEqual(["motivo", "ok", "status"]);
      expect(JSON.stringify(r)).not.toMatch(/fixture_interno|70000000-0000-4000-8000-000000000999/);
    }
  });
  it("erro, throw e envelope inválido são503 e não retornam texto", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...vinculo, setor: "vendas" }, error: { code: "42501", message: "fixture_interno" } });
    expect(await vincularMensagemVendas(vendedor, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockRejectedValue(new Error("fixture_interno"));
    expect(await vincularMensagemVendas(vendedor, atendimentoId, referencia)).toMatchObject({ ok: false, status: 503 });
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue(null);
    expect(await autorizarMensagemAtendimento(vendedor, atendimentoId, referencia, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
});
