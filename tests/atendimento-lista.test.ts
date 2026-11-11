import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { listarAtendimentos, type OpcoesListaAtendimentos } from "@/modulos/atendimento/lista";

const fixture = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));

const ator = "90000000-0000-4000-8000-000000000001";
const atendimentoId = "90000000-0000-4000-8000-000000000101";
const registroId = "90000000-0000-4000-8000-000000000201";
const mensagemId = "90000000-0000-4000-8000-000000000301";
const outroId = "90000000-0000-4000-8000-000000000999";
const criadoEm = "2026-11-11T12:00:00.000001Z";
const vendedor: Usuario = { id: ator, nome: "Vendedor fictício", email: "vendedor@example.test", papel: "vendedor", setor: "vendas", unidade: "comauto", unidades: ["comauto"] };
const previa = { id: mensagemId, conteudo: "Mensagem fictícia", tipo: "text", criadoEm, status: "recebida", direcao: "entrada", autor: "cliente" };
const atendimento = { id: atendimentoId, setor: "vendas", registroId, unidade: "comauto", clienteNome: "Cliente fictício", criadoEm, totalMensagens: 1, revisaoPendente: false, previa };
const sucesso = { ok: true, setor: "vendas", totalAtendimentos: 1, totalMensagens: 1, atendimentos: [atendimento], proximoCursor: null };
const argsBase = { p_ator: ator, p_setor: "vendas", p_limite: 50, p_antes_em: null, p_antes_id: null };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.db.mockReturnValue({ rpc: fixture.rpc, from: fixture.from });
  fixture.from.mockImplementation(() => { throw new Error("Consulta fora da transação proibida"); });
  fixture.rpc.mockResolvedValue({ data: sucesso, error: null });
});

describe("A1.2b lista mínima por uma chamada autorizada", () => {
  it.each([undefined, {}, { antes: null }, { limite: undefined, antes: undefined }])("opções%j usam os defaults e cinco argumentos exatos", async opcoes => {
    expect(await listarAtendimentos(vendedor, "vendas", opcoes)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("listar_atendimentos", argsBase);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("unidade/dono/cliente/operação de origem não são aceitos como autoridade de escopo", async () => {
    const u = { ...vendedor, unidades: ["unidade-injetada"], unidade: "unidade-injetada", clienteId: outroId, owner: outroId, registroId: outroId };
    const opcoes = { limite: 1, unidade: "unidade-injetada", clienteId: outroId, owner: outroId, setor: "pecas" };
    expect(await listarAtendimentos(u, "vendas", opcoes)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("listar_atendimentos", { ...argsBase, p_limite: 1 });
  });
  it("mascara nome e prévia antes de truncar, sem partir CPF nem alterar dados do DB", async () => {
    const prefixo = "x".repeat(153) + " ";
    const conteudo = prefixo + "111.444.777-35 depois";
    const nome = "Cliente 111.444.777-35 cartão 4111 1111 1111 1111";
    const original = Object.freeze({ ...atendimento, clienteNome: nome, telefone: "fixture_telefone", owner: outroId,
      previa: Object.freeze({ ...previa, conteudo, conversaId: outroId, wamid: "fixture_referencia" }) });
    const data = Object.freeze({ ...sucesso, atendimentos: Object.freeze([original]), metadados: "fixture_interno" });
    fixture.rpc.mockResolvedValue({ data, error: null });
    const r = await listarAtendimentos(vendedor, "vendas");
    expect(r).toEqual({ ...sucesso, atendimentos: [{ ...atendimento,
      clienteNome: "Cliente [CPF removido] cartão [cartão removido]",
      previa: { ...previa, conteudo: (prefixo + "[CPF removido] depois").slice(0, 160) },
    }] });
    expect(original.clienteNome).toBe(nome);
    expect(original.previa.conteudo).toBe(conteudo);
    expect(JSON.stringify(r)).not.toMatch(/111\.44|4111|fixture_telefone|fixture_interno|fixture_referencia/);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it.each([null, "  texto com whitespace  "])("preserva conteúdo%j sem trim adicional", async conteudo => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, atendimentos: [{ ...atendimento, previa: { ...previa, conteudo } }] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: true, atendimentos: [{ previa: { conteudo } }] });
  });
  it("corta em160 pontos Unicode sem partir o par surrogate do emoji no limite", async () => {
    const prefixo = "x".repeat(159);
    const conteudo = prefixo + "🚗fim";
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, atendimentos: [{ ...atendimento, previa: { ...previa, conteudo } }] }, error: null });
    const r = await listarAtendimentos(vendedor, "vendas");
    expect(r).toMatchObject({ ok: true, atendimentos: [{ previa: { conteudo: prefixo + "🚗" } }] });
    if (r.ok) expect(Array.from(r.atendimentos[0].previa!.conteudo!)).toHaveLength(160);
  });
  it("atendimento sem mensagem autorizada preserva revisão pendente e prévia null", async () => {
    const data = { ...sucesso, totalMensagens: 0, atendimentos: [{ ...atendimento, totalMensagens: 0, revisaoPendente: true, previa: null }] };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toEqual(data);
  });
  it("lista vazia mantém os totais globais antes do cursor", async () => {
    const data = { ...sucesso, totalAtendimentos: 7, totalMensagens: 11, atendimentos: [] };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await listarAtendimentos(vendedor, "vendas", { antes: { criadoEm, id: atendimentoId } })).toEqual(data);
  });
});

describe("A1.2b precisão, paginação e correlação", () => {
  it("preserva micros/ordem do SQL e normaliza apenas UUIDs de ator, linhas e cursor", async () => {
    const id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const segundo = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
    const userId = "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC";
    const antes = { criadoEm: "2026-11-11T12:00:00.000003+00:00", id };
    const primeira = { ...atendimento, id, criadoEm: "2026-11-11T12:00:00.000002Z" };
    const ultima = { ...atendimento, id: segundo, registroId: outroId, criadoEm, previa: { ...previa, id: outroId } };
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 3, totalMensagens: 4, atendimentos: [primeira, ultima], proximoCursor: { criadoEm, id: segundo } }, error: null });
    expect(await listarAtendimentos({ ...vendedor, id: userId }, "vendas", { limite: 2, antes })).toEqual({
      ...sucesso, totalAtendimentos: 3, totalMensagens: 4,
      atendimentos: [{ ...primeira, id: id.toLowerCase() }, { ...ultima, id: segundo.toLowerCase() }],
      proximoCursor: { criadoEm, id: segundo.toLowerCase() },
    });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("listar_atendimentos", {
      ...argsBase, p_ator: userId.toLowerCase(), p_limite: 2, p_antes_em: antes.criadoEm, p_antes_id: id.toLowerCase(),
    });
  });
  it.each(["2026-11-11T12:00:00Z", "2026-11-11T12:00:00+00:00", "2024-02-29T12:00:00.000001-03:00"])("reutiliza o contrato ISO válido%s sem normalizar data", async data => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, atendimentos: [{ ...atendimento, criadoEm: data }] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas", { antes: { criadoEm: data, id: atendimentoId } })).toMatchObject({ ok: true, atendimentos: [{ criadoEm: data }] });
    expect(fixture.rpc.mock.calls[0][1].p_antes_em).toBe(data);
  });
  it.each([
    { criadoEm, id: outroId }, { criadoEm: "2026-11-11T12:00:00.000001+00:00", id: atendimentoId },
    { criadoEm: "2026-11-11T12:00:00.000002Z", id: atendimentoId },
  ])("cursor seguinte deve coincidir exatamente com a última linha%j", async proximoCursor => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 2, proximoCursor }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas", { limite: 1 })).toMatchObject({ ok: false, status: 503 });
  });
  it("cursor exige página cheia e mais atendimentos, mesmo com ID/data corretos", async () => {
    const proximoCursor = { criadoEm, id: atendimentoId };
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 3, proximoCursor }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas", { limite: 2 })).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, proximoCursor }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas", { limite: 1 })).toMatchObject({ ok: false, status: 503 });
  });
  it("IDs duplicados após normalização não são listados duas vezes", async () => {
    const id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 2, totalMensagens: 2, atendimentos: [{ ...atendimento, id }, { ...atendimento, id: id.toLowerCase() }] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it("total global de mensagens cobre a soma da página, sem overflow safeint", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 2, totalMensagens: 4, atendimentos: [{ ...atendimento, totalMensagens: 2 }, { ...atendimento, id: outroId, registroId: outroId, previa: { ...previa, id: outroId }, totalMensagens: 3 }] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 2, totalMensagens: Number.MAX_SAFE_INTEGER, atendimentos: [{ ...atendimento, totalMensagens: Number.MAX_SAFE_INTEGER }, { ...atendimento, id: outroId, registroId: outroId, previa: { ...previa, id: outroId } }] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it("nenhum atendimento global exige nenhuma mensagem global mesmo após cursor", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 0, totalMensagens: 1, atendimentos: [] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas", { antes: { criadoEm, id: atendimentoId } })).toMatchObject({ ok: false, status: 503 });
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it.each(["registro", "previa"])("ID de%s não pode repetir entre atendimentos após normalização", async campo => {
    const id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const primeira = { ...atendimento, registroId: campo === "registro" ? id : registroId, previa: { ...previa, id: campo === "previa" ? id : mensagemId } };
    const segunda = { ...atendimento, id: outroId, registroId: campo === "registro" ? id.toLowerCase() : outroId,
      previa: { ...previa, id: campo === "previa" ? id.toLowerCase() : outroId } };
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, totalAtendimentos: 2, totalMensagens: 2, atendimentos: [primeira, segunda] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it.each([{ totalAtendimentos: 2 }, { totalMensagens: 2 }])("primeira página completa sem cursor deve conferir totais globais%j", async patch => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, ...patch }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(fixture.from).not.toHaveBeenCalled();
  });
});

describe("A1.2b entrada/perfil inválidos não consultam o banco", () => {
  it.each([null, [], 2, new Date(), { limite: null }, { limite: 0 }, { limite: 101 }, { limite: 1.5 }, { limite: Infinity }, { limite: "50" }, { antes: {} }, { antes: { criadoEm, id: atendimentoId + "\n" } }, { antes: { criadoEm: "2026-02-30T12:00:00Z", id: atendimentoId } }, { antes: { criadoEm: "2026-11-11T12:00:00+16:00", id: atendimentoId } }])("recusa opções/cursor%j", async valor => {
    expect(await listarAtendimentos(vendedor, "vendas", valor as OpcoesListaAtendimentos)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { ...vendedor, id: 1 }, { ...vendedor, id: ator + "\n" }])("recusa ator%j", async u => {
    expect(await listarAtendimentos(u as Usuario, "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, "oficina", "administracao", "VENDAS", {}, 2])("recusa setor%j", async setor => {
    expect(await listarAtendimentos(vendedor, setor as "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([["vendedor", "vendas", "pecas"], ["pecas", "pecas", "vendas"], ["gerente", "pecas", "vendas"], ["gerente", "oficina", "pecas"], ["recepcao", "oficina", "pecas"], ["financeiro", "administracao", "vendas"]])("perfil%s/%s não lista%s", async (papel, setor, alvo) => {
    expect(await listarAtendimentos({ ...vendedor, papel, setor } as Usuario, alvo as "vendas")).toMatchObject({ ok: false, status: 403 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([["pecas", "pecas", "pecas"], ["gerente", "pecas", "pecas"], ["gerente", "administracao", "vendas"], ["admin", "administracao", "vendas"]])("perfil%s/%s chega ao SQL de%s", async (papel, setor, alvo) => {
    const data = { ...sucesso, setor: alvo, atendimentos: [{ ...atendimento, setor: alvo }] };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await listarAtendimentos({ ...vendedor, papel, setor } as Usuario, alvo as "vendas")).toEqual(data);
    expect(fixture.rpc.mock.calls[0][1]).toEqual({ ...argsBase, p_setor: alvo });
  });
});

describe("A1.2b DTO inválido ou erro retorna falha sem dados crus", () => {
  it.each([
    null, [], {}, { ...sucesso, ok: "true" }, { ...sucesso, setor: "pecas" },
    { ...sucesso, totalAtendimentos: 0 }, { ...sucesso, totalMensagens: 0 },
    { ...sucesso, totalAtendimentos: Infinity }, { ...sucesso, totalMensagens: Number.MAX_SAFE_INTEGER + 1 },
    { ...sucesso, atendimentos: null }, { ...sucesso, proximoCursor: undefined },
    { ...sucesso, atendimentos: [atendimento, { ...atendimento, id: outroId }], totalAtendimentos: 2, totalMensagens: 2 },
  ])("recusa envelope%j", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await listarAtendimentos(vendedor, "vendas", { limite: 1 })).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    { id: atendimentoId + "\n" }, { registroId: null }, { setor: "pecas" }, { unidade: "desconhecida" },
    { clienteNome: null }, { criadoEm: "2026-11-11T24:00:00Z" }, { totalMensagens: -1 }, { revisaoPendente: "false" },
    { previa: null }, { totalMensagens: 0 }, { previa: { ...previa, direcao: "saida" } },
    { previa: { ...previa, autor: "atendente" } }, { previa: { ...previa, conteudo: 3 } },
  ])("recusa atendimento/prévia%j sem retornar página parcial", async patch => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, atendimentos: [{ ...atendimento, ...patch }] }, error: null });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it.each([["invalido", 400], ["cursor_invalido", 400], ["desconhecido", 503]])("mapeia%s para%s sem detalhar diagnósticos", async (codigo, status) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo, unidade: "fixture_interno", owner: outroId }, error: null });
    const r = await listarAtendimentos(vendedor, "vendas");
    expect(r).toMatchObject({ ok: false, status });
    expect(Object.keys(r).sort()).toEqual(["motivo", "ok", "status"]);
    expect(JSON.stringify(r)).not.toMatch(/fixture_interno|90000000-0000-4000-8000-000000000999/);
  });
  it("erro PostgREST, exceção e envelope inválido retornam503", async () => {
    fixture.rpc.mockResolvedValue({ data: sucesso, error: { code: "42501", message: "fixture_interno" } });
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockRejectedValue(new Error("fixture_interno"));
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue(null);
    expect(await listarAtendimentos(vendedor, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
});
