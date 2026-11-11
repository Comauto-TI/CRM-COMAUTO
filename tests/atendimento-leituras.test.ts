import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { obterLeituraAtendimento, marcarMensagensLidas, resumirLeiturasAtendimentos } from "@/modulos/atendimento/leituras";

const fixture = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));

const ator = "a0000000-0000-4000-8000-000000000001";
const atendimentoId = "a0000000-0000-4000-8000-000000000101";
const mensagemId = "a0000000-0000-4000-8000-000000000201";
const outraMensagem = "a0000000-0000-4000-8000-000000000202";
const vendedor: Usuario = { id: ator, nome: "Vendedor fictício", email: "vendedor@example.test", papel: "vendedor", setor: "vendas", unidade: "comauto", unidades: ["comauto"] };
const leitura = { ok: true, atendimentoId, setor: "vendas", total: 3, lidas: 1, naoLidas: 2, revisaoPendente: false };
const marcacao = { ok: true, atendimentoId, setor: "vendas", marcadas: 1 };
const resumo = { ok: true, setor: "vendas", totalAtendimentos: 2, totalMensagens: 3, lidas: 1, naoLidas: 2, atendimentosComNaoLidas: 1, revisaoPendente: false };
const args = { p_atendimento_id: atendimentoId, p_ator: ator, p_setor: "vendas" };
const todas = (u = vendedor, id = atendimentoId, setor: "vendas" | "pecas" = "vendas") => Promise.all([
  obterLeituraAtendimento(u, id, setor), marcarMensagensLidas(u, id, setor, [mensagemId]), resumirLeiturasAtendimentos(u, setor),
]);

beforeEach(() => {
  vi.resetAllMocks();
  fixture.db.mockReturnValue({ rpc: fixture.rpc, from: fixture.from });
  fixture.from.mockImplementation(() => { throw new Error("Acesso fora do RPC proibido"); });
  fixture.rpc.mockImplementation(async (nome: string) => ({ data: nome === "obter_leitura_atendimento" ? leitura : nome === "marcar_mensagens_lidas_atendimento" ? marcacao : resumo, error: null }));
});

describe("A1.2c uma RPC por operação, sem marcação automática", () => {
  it("obter contagem não faz marcação ou consulta separada", async () => {
    expect(await obterLeituraAtendimento(vendedor, atendimentoId, "vendas")).toEqual(leitura);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("obter_leitura_atendimento", args);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("marcação usa somente ator, setor, atendimento e mensagens explícitas", async () => {
    expect(await marcarMensagensLidas(vendedor, atendimentoId, "vendas", [mensagemId])).toEqual(marcacao);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("marcar_mensagens_lidas_atendimento", { ...args, p_mensagens: [mensagemId] });
  });
  it("resumo consulta só ator e setor", async () => {
    expect(await resumirLeiturasAtendimentos(vendedor, "vendas")).toEqual(resumo);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("resumir_leituras_atendimentos", { p_ator: ator, p_setor: "vendas" });
  });
  it("ignora metadados de cliente/conversa/unidade/dono e descarta extras do DTO", async () => {
    const u = { ...vendedor, unidade: "unidade-injetada", unidades: [], clienteId: outraMensagem, conversaId: outraMensagem, owner: outraMensagem };
    fixture.rpc.mockImplementation(async (nome: string) => ({ data: { ...(nome === "obter_leitura_atendimento" ? leitura : nome === "marcar_mensagens_lidas_atendimento" ? marcacao : resumo), conteudo: "fixture_interno", owner: outraMensagem }, error: null }));
    expect(await todas(u)).toEqual([leitura, marcacao, resumo]);
    expect(fixture.rpc.mock.calls.map(c => c[1])).toEqual([args, { ...args, p_mensagens: [mensagemId] }, { p_ator: ator, p_setor: "vendas" }]);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("Peças usa seu setor e UUIDs em maiúsculas são normalizados em entrada e retorno", async () => {
    const u: Usuario = { ...vendedor, id: ator.toUpperCase(), papel: "pecas", setor: "pecas" };
    fixture.rpc.mockImplementation(async (nome: string) => ({ data: {
      ...(nome === "obter_leitura_atendimento" ? leitura : nome === "marcar_mensagens_lidas_atendimento" ? marcacao : resumo),
      atendimentoId: atendimentoId.toUpperCase(), setor: "pecas",
    }, error: null }));
    expect(await todas(u, atendimentoId.toUpperCase(), "pecas")).toEqual([
      { ...leitura, setor: "pecas" }, { ...marcacao, setor: "pecas" }, { ...resumo, setor: "pecas" },
    ]);
    expect(fixture.rpc.mock.calls.map(c => c[1].p_ator)).toEqual([ator, ator, ator]);
  });
});

describe("A1.2c lote explícito e imutável", () => {
  it("faz lowercase em cópia sem mudar o input congelado", async () => {
    const ids = Object.freeze([mensagemId.toUpperCase(), outraMensagem]);
    expect(await marcarMensagensLidas(vendedor, atendimentoId.toUpperCase(), "vendas", ids)).toEqual(marcacao);
    expect(ids).toEqual([mensagemId.toUpperCase(), outraMensagem]);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("marcar_mensagens_lidas_atendimento", { ...args, p_mensagens: [mensagemId, outraMensagem] });
  });
  it.each([[], Array(101).fill(mensagemId), [mensagemId, mensagemId], [mensagemId.toUpperCase(), mensagemId], [mensagemId, null], [mensagemId, " " + outraMensagem], [mensagemId, outraMensagem + "\n"], [mensagemId, 2], Array(1)].map(ids => ({ ids })))("lote inválido%j não chama RPC nem produz sucesso parcial", async ({ ids }) => {
    const copia = ids.slice();
    expect(await marcarMensagensLidas(vendedor, atendimentoId, "vendas", ids as string[])).toMatchObject({ ok: false, status: 400 });
    expect(ids).toEqual(copia);
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, mensagemId])("lote deve ser array, recebido%j", async ids => {
    expect(await marcarMensagensLidas(vendedor, atendimentoId, "vendas", ids as string[])).toMatchObject({ ok: false, status: 400 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("aceita100 UUIDs únicos e apenas o número confirmado de marcações", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `a0000000-0000-4000-8000-${String(i + 1000).padStart(12, "0")}`);
    fixture.rpc.mockResolvedValue({ data: { ...marcacao, marcadas: 100 }, error: null });
    expect(await marcarMensagensLidas(vendedor, atendimentoId, "vendas", ids)).toEqual({ ...marcacao, marcadas: 100 });
    expect(fixture.rpc.mock.calls[0][1].p_mensagens).toEqual(ids);
  });
  it.each([0, 1])("marcações%s preservam resultado idempotente", async marcadas => {
    fixture.rpc.mockResolvedValue({ data: { ...marcacao, marcadas }, error: null });
    expect(await marcarMensagensLidas(vendedor, atendimentoId, "vendas", [mensagemId])).toEqual({ ...marcacao, marcadas });
  });
});

describe("A1.2c contexto e pré-filtro de perfis", () => {
  it.each([null, undefined, {}, { ...vendedor, id: 1 }, { ...vendedor, id: ator + "\n" }])("ator inválido%j bloqueia todas as operações", async u => {
    for (const r of await Promise.all([
      obterLeituraAtendimento(u as Usuario, atendimentoId, "vendas"),
      marcarMensagensLidas(u as Usuario, atendimentoId, "vendas", [mensagemId]),
      resumirLeiturasAtendimentos(u as Usuario, "vendas"),
    ])) expect(r).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, "oficina", "administracao", "VENDAS", {}, 2])("setor inválido%j é400 sem RPC", async setor => {
    for (const r of await todas(vendedor, atendimentoId, setor as "vendas")) expect(r).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, atendimentoId + "\n", atendimentoId.replaceAll("-", "")])("ID inválido%j bloqueia operações por atendimento", async id => {
    expect(await obterLeituraAtendimento(vendedor, id as string, "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(await marcarMensagensLidas(vendedor, id as string, "vendas", [mensagemId])).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([["vendedor", "vendas", "pecas"], ["pecas", "pecas", "vendas"], ["gerente", "oficina", "vendas"], ["gerente", "pecas", "vendas"], ["financeiro", "administracao", "vendas"], ["recepcao", "oficina", "pecas"]])("perfil%s/%s não atravessa%s", async (papel, setor, alvo) => {
    for (const r of await todas({ ...vendedor, papel, setor } as Usuario, atendimentoId, alvo as "vendas")) expect(r).toMatchObject({ ok: false, status: 403 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it.each([["pecas", "pecas", "pecas"], ["gerente", "vendas", "vendas"], ["gerente", "pecas", "pecas"], ["gerente", "administracao", "vendas"], ["admin", "administracao", "pecas"]])("perfil%s/%s chega ao SQL de%s e ainda pode ser negado", async (papel, setor, alvo) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "nao_encontrado" }, error: null });
    for (const r of await todas({ ...vendedor, papel, setor } as Usuario, atendimentoId, alvo as "vendas")) expect(r).toMatchObject({ ok: false, status: 404 });
    expect(fixture.rpc.mock.calls.map(c => c[1].p_ator)).toEqual([ator, ator, ator]);
  });
});

describe("A1.2c integridade e correlação de contagens", () => {
  it.each([{ total: 4 }, { lidas: -1 }, { naoLidas: 1.5 }, { total: Infinity }, { total: Number.MAX_SAFE_INTEGER + 1 }, { lidas: "1" }, { revisaoPendente: "false" }, { atendimentoId: outraMensagem }, { atendimentoId: atendimentoId + "\n" }, { setor: "pecas" }])("contagem incoerente%j é503", async patch => {
    fixture.rpc.mockResolvedValue({ data: { ...leitura, ...patch }, error: null });
    expect(await obterLeituraAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it("aceita leitura zero com revisão pendente sem transformá-la em mensagem lida", async () => {
    const data = { ...leitura, total: 0, lidas: 0, naoLidas: 0, revisaoPendente: true };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await obterLeituraAtendimento(vendedor, atendimentoId, "vendas")).toEqual(data);
  });
  it.each([{ marcadas: 2 }, { marcadas: -1 }, { marcadas: 0.5 }, { marcadas: "1" }, { marcadas: Infinity }, { atendimentoId: outraMensagem }, { setor: "pecas" }])("confirmação de marcação inválida%j não vira sucesso", async patch => {
    fixture.rpc.mockResolvedValue({ data: { ...marcacao, ...patch }, error: null });
    expect(await marcarMensagensLidas(vendedor, atendimentoId, "vendas", [mensagemId])).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    { totalMensagens: 4 }, { totalAtendimentos: -1 }, { totalAtendimentos: Number.MAX_SAFE_INTEGER + 1 },
    { atendimentosComNaoLidas: 3 }, { atendimentosComNaoLidas: 0 }, { atendimentosComNaoLidas: 1.5 },
    { naoLidas: 0, lidas: 3 }, { totalAtendimentos: 0 }, { revisaoPendente: "false" }, { setor: "pecas" },
    { totalMensagens: Number.MAX_SAFE_INTEGER, lidas: Number.MAX_SAFE_INTEGER, naoLidas: 1 },
  ])("resumo contraditório%j é503", async patch => {
    fixture.rpc.mockResolvedValue({ data: { ...resumo, ...patch }, error: null });
    expect(await resumirLeiturasAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it("escopo vazio exige todas as contagens zero e revisão false", async () => {
    const data = { ...resumo, totalAtendimentos: 0, totalMensagens: 0, lidas: 0, naoLidas: 0, atendimentosComNaoLidas: 0 };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await resumirLeiturasAtendimentos(vendedor, "vendas")).toEqual(data);
    fixture.rpc.mockResolvedValue({ data: { ...data, revisaoPendente: true }, error: null });
    expect(await resumirLeiturasAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it("sem não lidas exige nenhum atendimento com não lidas", async () => {
    const data = { ...resumo, lidas: 3, naoLidas: 0, atendimentosComNaoLidas: 0 };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await resumirLeiturasAtendimentos(vendedor, "vendas")).toEqual(data);
  });
});

describe("A1.2c falhas normalizadas sem dados internos", () => {
  it.each([["invalido", 400], ["nao_encontrado", 404], ["desconhecido", 503]])("código%s retorna%s nas três operações", async (codigo, status) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo, conteudo: "fixture_interno", actor: outraMensagem }, error: null });
    for (const r of await todas()) {
      expect(r).toMatchObject({ ok: false, status });
      expect(Object.keys(r).sort()).toEqual(["motivo", "ok", "status"]);
      expect(JSON.stringify(r)).not.toMatch(/fixture_interno|a0000000-0000-4000-8000-000000000202/);
    }
  });
  it.each([null, [], {}, { ok: "true" }])("envelope malformado%j é503 nas três operações", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    for (const r of await todas()) expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it("erro de banco, throw e envelope ausente não vazam diagnóstico", async () => {
    fixture.rpc.mockResolvedValue({ data: leitura, error: { code: "42501", message: "fixture_interno" } });
    for (const r of await todas()) expect(r).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockRejectedValue(new Error("fixture_interno"));
    for (const r of await todas()) expect(r).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue(null);
    for (const r of await todas()) expect(r).toMatchObject({ ok: false, status: 503 });
  });
});
