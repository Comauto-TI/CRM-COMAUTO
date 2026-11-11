import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { abrirAtendimento, assumirAtendimento } from "@/modulos/atendimento/acesso";

const fixture = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));

const ator = "40000000-0000-4000-8000-000000000001";
const registroId = "40000000-0000-4000-8000-000000000101";
const atendimentoId = "40000000-0000-4000-8000-000000000201";
const outroId = "40000000-0000-4000-8000-000000000999";
const pecas: Usuario = { id: ator, nome: "Peças fictício", email: "pecas@example.test", papel: "pecas", setor: "pecas", unidade: "comauto", unidades: ["comauto"] };
const vendedor: Usuario = { ...pecas, papel: "vendedor", setor: "vendas" };
const sucesso = { ok: true as const, id: atendimentoId, versao: 4, setor: "pecas" as const, registroId };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.db.mockReturnValue({ rpc: fixture.rpc });
  fixture.rpc.mockResolvedValue({ data: sucesso, error: null });
});

describe("A1.1a RPC autenticado no servidor", () => {
  it("Peças abre pelo registro setorial e transporta somente referências e ator", async () => {
    const u = { ...pecas, clienteId: outroId, conversaId: outroId, owner: outroId, unidade: "unidade-injetada", unidades: ["unidade-injetada"] };
    expect(await abrirAtendimento(u, "pecas", registroId)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("abrir_atendimento_modular", { p_setor: "pecas", p_registro: registroId, p_ator: ator });
    expect(Object.keys(fixture.rpc.mock.calls[0][1]).sort()).toEqual(["p_ator", "p_registro", "p_setor"]);
  });
  it("assumir transporta ID, ator e versão, sem identidade ou posse fornecida pelo browser", async () => {
    const u = { ...pecas, clienteId: outroId, conversaId: outroId, owner: outroId, unidades: [] };
    expect(await assumirAtendimento(u, atendimentoId, 3)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("assumir_atendimento_modular", { p_id: atendimentoId, p_ator: ator, p_versao: 3 });
    expect(Object.keys(fixture.rpc.mock.calls[0][1]).sort()).toEqual(["p_ator", "p_id", "p_versao"]);
  });
  it("Vendas usa seu próprio setor e registro", async () => {
    const data = { ...sucesso, setor: "vendas" };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await abrirAtendimento(vendedor, "vendas", registroId)).toEqual(data);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("abrir_atendimento_modular", { p_setor: "vendas", p_registro: registroId, p_ator: ator });
  });
  it("o pré-filtro não substitui a recusa SQL com cadastro/permissões atualizados", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "nao_encontrado" }, error: null });
    const adminAntigo: Usuario = { ...pecas, papel: "admin", setor: "administracao", unidades: ["comauto", "santaluzia", "motomecanica"] };
    expect(await abrirAtendimento(adminAntigo, "pecas", registroId)).toMatchObject({ ok: false, status: 404 });
    expect(fixture.rpc.mock.calls[0][1]).toEqual({ p_setor: "pecas", p_registro: registroId, p_ator: ator });
  });
  it("não retorna campos de dados que o RPC acrescente ao sucesso", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, clienteId: outroId, conversaId: outroId, unidade: "comauto", owner: outroId, detalhe: "fixture_interno" }, error: null });
    expect(await abrirAtendimento(pecas, "pecas", registroId)).toEqual(sucesso);
  });
  it("aceita UUID hifenizado em maiúsculas e normaliza antes de comparar", async () => {
    const upperAtor = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const upperRegistro = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, id: atendimentoId.toUpperCase(), registroId: upperRegistro }, error: null });
    expect(await abrirAtendimento({ ...pecas, id: upperAtor }, "pecas", upperRegistro)).toEqual({ ...sucesso, registroId: upperRegistro.toLowerCase() });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("abrir_atendimento_modular", { p_setor: "pecas", p_registro: upperRegistro.toLowerCase(), p_ator: upperAtor.toLowerCase() });
  });
});

describe("A1.1a pré-filtro por setor", () => {
  it.each([
    ["financeiro", "administracao"], ["recepcao", "oficina"], ["atendente", "oficina"],
    ["consultor_tecnico", "oficina"], ["gerente", "oficina"],
  ])("%s de %s não abre nem assume no fluxo Vendas/Peças", async (papel, setor) => {
    const u = { ...pecas, papel, setor } as Usuario;
    expect(await abrirAtendimento(u, "pecas", registroId)).toMatchObject({ ok: false, status: 403 });
    expect(await abrirAtendimento(u, "vendas", registroId)).toMatchObject({ ok: false, status: 403 });
    expect(await assumirAtendimento(u, atendimentoId, 3)).toMatchObject({ ok: false, status: 403 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it("Peças não abre Vendas e vendedor não abre Peças", async () => {
    expect(await abrirAtendimento(pecas, "vendas", registroId)).toMatchObject({ ok: false, status: 403 });
    expect(await abrirAtendimento(vendedor, "pecas", registroId)).toMatchObject({ ok: false, status: 403 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("gerente só abre seu setor; administração pode entrar nos dois", async () => {
    const gerente: Usuario = { ...pecas, papel: "gerente" };
    expect((await abrirAtendimento(gerente, "pecas", registroId)).ok).toBe(true);
    expect(await abrirAtendimento(gerente, "vendas", registroId)).toMatchObject({ ok: false, status: 403 });
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, setor: "vendas" }, error: null });
    expect((await abrirAtendimento({ ...gerente, setor: "administracao" }, "vendas", registroId)).ok).toBe(true);
  });
  it("assumir aceita vendedor, deixando o setor final para a validação SQL", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, setor: "vendas" }, error: null });
    expect(await assumirAtendimento(vendedor, atendimentoId, 3)).toEqual({ ...sucesso, setor: "vendas" });
  });
});

describe("A1.1a validação em runtime antes do RPC", () => {
  it.each([null, undefined, 7, {}, [], { id: ator }, "", " " + registroId, registroId + " ", registroId.replaceAll("-", ""), "40000000-0000-4000-8000-00000000010z"])("recusa referência UUID não canônica %j", async valor => {
    expect(await abrirAtendimento(pecas, "pecas", valor as string)).toMatchObject({ ok: false, status: 400 });
    expect(await assumirAtendimento(pecas, valor as string, 3)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { ...pecas, id: "" }, { ...pecas, id: 2 }])("recusa ator inválido %j", async valor => {
    expect(await abrirAtendimento(valor as Usuario, "pecas", registroId)).toMatchObject({ ok: false, status: 400 });
    expect(await assumirAtendimento(valor as Usuario, atendimentoId, 3)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "oficina", "administracao", "PECAS", {}, 2])("recusa setor de runtime %j", async valor => {
    expect(await abrirAtendimento(pecas, valor as "pecas", registroId)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "3", -1, 0.5, NaN, Infinity, -Infinity, 2_147_483_647, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1])("recusa versão de runtime %s", async versao => {
    expect(await assumirAtendimento(pecas, atendimentoId, versao as number)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([0, 2_147_483_646])("aceita versão limite %s e deixa conflito de incremento para SQL", async versao => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "conflito" }, error: null });
    expect(await assumirAtendimento(pecas, atendimentoId, versao)).toMatchObject({ ok: false, status: 409 });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("assumir_atendimento_modular", { p_id: atendimentoId, p_ator: ator, p_versao: versao });
  });
});

describe("A1.1a falhas de RPC não vazam dados", () => {
  it.each([["nao_encontrado", 404], ["conflito", 409], ["desconhecido", 503]])("mapeia código %s para%s sem propagar detalhes", async (codigo, status) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo, motivo: "fixture_interno", clienteId: outroId }, error: null });
    for (const r of [await abrirAtendimento(pecas, "pecas", registroId), await assumirAtendimento(pecas, atendimentoId, 3)]) {
      expect(r).toMatchObject({ ok: false, status });
      expect(Object.keys(r).sort()).toEqual(["motivo", "ok", "status"]);
      expect(JSON.stringify(r)).not.toContain("fixture_interno");
      expect(JSON.stringify(r)).not.toContain(outroId);
    }
  });
  it("erro PostgREST prevalece mesmo com um corpo de sucesso", async () => {
    fixture.rpc.mockResolvedValue({ data: sucesso, error: { message: "fixture_interno", details: "fixture_detalhe", code: "42501" } });
    const r = await abrirAtendimento(pecas, "pecas", registroId);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(r)).not.toMatch(/fixture_|42501/);
  });
  it("exceção e envelope inválido viram503", async () => {
    fixture.rpc.mockRejectedValue(new Error("fixture_interno"));
    expect(await abrirAtendimento(pecas, "pecas", registroId)).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue(null);
    expect(await assumirAtendimento(pecas, atendimentoId, 3)).toMatchObject({ ok: false, status: 503 });
    fixture.db.mockImplementation(() => { throw new Error("fixture_configuração"); });
    expect(await abrirAtendimento(pecas, "pecas", registroId)).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    null, [], "fixture_interno", {}, { ...sucesso, ok: "true" }, { ...sucesso, id: null },
    { ...sucesso, id: atendimentoId.replaceAll("-", "") }, { ...sucesso, registroId: 1 },
    { ...sucesso, setor: "oficina" }, { ...sucesso, versao: "4" }, { ...sucesso, versao: -1 },
    { ...sucesso, versao: 0.5 }, { ...sucesso, versao: 2_147_483_647 }, { ...sucesso, versao: Infinity },
  ])("não aceita sucesso malformado %j", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await abrirAtendimento(pecas, "pecas", registroId)).toMatchObject({ ok: false, status: 503 });
    expect(await assumirAtendimento(pecas, atendimentoId, 3)).toMatchObject({ ok: false, status: 503 });
  });
  it("abrir exige retorno do setor e registro consultados", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, setor: "vendas" }, error: null });
    expect(await abrirAtendimento(pecas, "pecas", registroId)).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, registroId: outroId }, error: null });
    expect(await abrirAtendimento(pecas, "pecas", registroId)).toMatchObject({ ok: false, status: 503 });
  });
  it("assumir exige retorno do atendimento solicitado", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, id: outroId }, error: null });
    expect(await assumirAtendimento(pecas, atendimentoId, 3)).toMatchObject({ ok: false, status: 503 });
  });
});
