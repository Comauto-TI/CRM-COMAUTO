import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { lerMensagensAtendimento, type OpcoesLeituraAtendimento } from "@/modulos/atendimento/leitura";

const fixture = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn(), from: vi.fn(), autorizar: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));
vi.mock("@/modulos/atendimento/mensagens", () => ({ autorizarMensagemAtendimento: fixture.autorizar }));

const ator = "80000000-0000-4000-8000-000000000001";
const atendimentoId = "80000000-0000-4000-8000-000000000101";
const mensagemId = "80000000-0000-4000-8000-000000000201";
const outroId = "80000000-0000-4000-8000-000000000202";
const vendedor: Usuario = { id: ator, nome: "Vendedor fictício", email: "vendedor@example.test", papel: "vendedor", setor: "vendas", unidade: "comauto", unidades: ["comauto"] };
const pecas: Usuario = { ...vendedor, papel: "pecas", setor: "pecas" };
const criadoEm = "2026-11-11T12:00:00.000001Z";
const linha = { id: mensagemId, conteudo: "Mensagem fictícia", tipo: "text", criadoEm, status: "recebida", direcao: "entrada", autor: "cliente" };
const sucesso = { ok: true, atendimentoId, setor: "vendas", total: 1, revisaoPendente: false, mensagens: [linha], proximoCursor: null };
const argsBase = { p_atendimento_id: atendimentoId, p_ator: ator, p_setor: "vendas", p_limite: 50, p_antes_em: null, p_antes_id: null };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.db.mockReturnValue({ rpc: fixture.rpc, from: fixture.from });
  fixture.from.mockImplementation(() => { throw new Error("Leitura fora do RPC proibida"); });
  fixture.rpc.mockResolvedValue({ data: sucesso, error: null });
});

describe("A1.2a leitura e autorização em chamada única", () => {
  it.each([undefined, {}, { antes: null }, { limite: undefined, antes: undefined }])("defaults de opções %j geram os seis argumentos exatos", async opcoes => {
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", opcoes)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("ler_mensagens_atendimento", argsBase);
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.autorizar).not.toHaveBeenCalled();
  });
  it("não envia metadados de unidade, cliente, conversa ou dono", async () => {
    const u = { ...vendedor, unidade: "unidade-injetada", unidades: [], clienteId: outroId, conversaId: outroId, owner: outroId };
    const opcoes = { limite: 1, owner: outroId, unidade: "unidade-injetada", setor: "pecas" };
    expect(await lerMensagensAtendimento(u, atendimentoId, "vendas", opcoes)).toEqual(sucesso);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("ler_mensagens_atendimento", { ...argsBase, p_limite: 1 });
  });
  it("mascara CPF/cartão com helper real sem alterar o objeto retornado pelo DB", async () => {
    const conteudo = "CPF 111.444.777-35 cartão 4111 1111 1111 1111";
    const original = Object.freeze({ ...linha, conteudo, clienteId: outroId, telefone: "fixture_telefone" });
    const data = Object.freeze({ ...sucesso, mensagens: Object.freeze([original]), conversaId: outroId, textoInterno: "fixture_interno" });
    fixture.rpc.mockResolvedValue({ data, error: null });
    const r = await lerMensagensAtendimento(vendedor, atendimentoId, "vendas");
    expect(r).toEqual({ ...sucesso, mensagens: [{ ...linha, conteudo: "CPF [CPF removido] cartão [cartão removido]" }] });
    expect(original.conteudo).toBe(conteudo);
    expect(data.mensagens[0]).toBe(original);
    expect(JSON.stringify(r)).not.toMatch(/111\.444|4111|fixture_telefone|fixture_interno/);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("conteúdo null e indicação de revisão pendente são preservados", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, revisaoPendente: true, mensagens: [{ ...linha, conteudo: null }] }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toEqual({ ...sucesso, revisaoPendente: true, mensagens: [{ ...linha, conteudo: null }] });
  });
  it("lista vazia com total zero exige cursor null", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, total: 0, mensagens: [] }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toEqual({ ...sucesso, total: 0, mensagens: [] });
  });
  it("normaliza UUIDs e conserva micros do cursor/linhas", async () => {
    const id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const msg = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
    const userId = "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC";
    const antes = { criadoEm: "2026-11-11T12:00:00.000002+00:00", id: msg };
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, atendimentoId: id, mensagens: [{ ...linha, id: msg }] }, error: null });
    expect(await lerMensagensAtendimento({ ...vendedor, id: userId }, id, "vendas", { antes })).toEqual({ ...sucesso, atendimentoId: id.toLowerCase(), mensagens: [{ ...linha, id: msg.toLowerCase() }] });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("ler_mensagens_atendimento", {
      ...argsBase, p_atendimento_id: id.toLowerCase(), p_ator: userId.toLowerCase(), p_antes_em: antes.criadoEm, p_antes_id: msg.toLowerCase(),
    });
  });
});

describe("A1.2a calendário e precisão do timestamp", () => {
  it.each([
    "2026-11-11T12:00:00Z", "2026-11-11T12:00:00+00:00", "2026-11-11T09:00:00.1-03:00",
    "2026-11-11T12:00:00.000001Z", "2024-02-29T23:59:59.123456+05:30", "0001-01-01T00:00:00.1Z",
    "2026-11-11T12:00:00.000001+15:59", "2026-11-11T12:00:00.000001-15:59",
  ])("aceita e preserva timestamp válido %s", async valor => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, mensagens: [{ ...linha, criadoEm: valor }] }, error: null });
    const r = await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { antes: { criadoEm: valor, id: mensagemId } });
    expect(r).toMatchObject({ ok: true, mensagens: [{ criadoEm: valor }] });
    expect(fixture.rpc.mock.calls[0][1].p_antes_em).toBe(valor);
  });
  it.each([
    "Infinity", "2026-02-29T00:00:00Z", "2026-02-30T00:00:00Z", "2026-04-31T00:00:00Z",
    "0000-01-01T00:00:00Z", "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-00T00:00:00Z",
    "2026-11-11T24:00:00Z", "2026-11-11T12:60:00Z", "2026-11-11T12:00:60Z",
    "2026-11-11T12:00:00.Z", "2026-11-11T12:00:00.1234567Z", "2026-11-11T12:00:00.1+24:00",
    "2026-11-11T12:00:00+16:00", "2026-11-11T12:00:00-16:00", "2026-11-11T12:00:00+23:00",
    "2026-11-11T12:00:00.1+03:60", "2026-11-11T12:00:00", "2026-11-11 12:00:00Z", "2026-11-11T12:00:00Z ", "2026-11-11T12:00:00Z\n",
  ])("recusa data/horário/forma inválidos %s em entrada e retorno", async valor => {
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { antes: { criadoEm: valor, id: mensagemId } })).toMatchObject({ ok: false, status: 400 });
    expect(fixture.rpc).not.toHaveBeenCalled();
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, mensagens: [{ ...linha, criadoEm: valor }] }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
});

describe("A1.2a entradas e perfis", () => {
  it.each([null, [], 2, "50", new Date(), { limite: null }, { limite: 0 }, { limite: 101 }, { limite: 1.5 }, { limite: Infinity }, { limite: "50" }, { antes: {} }, { antes: { criadoEm } }, { antes: { id: mensagemId } }, { antes: { criadoEm, id: "invalido" } }, { antes: { criadoEm: null, id: mensagemId } }])("recusa opções inválidas %j", async valor => {
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", valor as OpcoesLeituraAtendimento)).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([1, 100])("limite válido%s é enviado sem coerção", async limite => {
    await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { limite });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("ler_mensagens_atendimento", { ...argsBase, p_limite: limite });
  });
  it.each([null, undefined, {}, { ...vendedor, id: "" }, { ...vendedor, id: 3 }, { ...vendedor, id: ator + "\n" }])("ator inválido %j não chega ao banco", async u => {
    expect(await lerMensagensAtendimento(u as Usuario, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, 1, atendimentoId.replaceAll("-", ""), atendimentoId + " ", atendimentoId + "\n"])("recusa ID de atendimento inválido %j", async id => {
    expect(await lerMensagensAtendimento(vendedor, id as string, "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([null, "oficina", "administracao", "VENDAS", {}, 2])("recusa setor inválido %j", async setor => {
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, setor as "vendas")).toMatchObject({ ok: false, status: 400 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([["financeiro", "administracao"], ["recepcao", "oficina"], ["consultor_tecnico", "oficina"], ["gerente", "oficina"]])("perfil%s/%s não lê Peças nem Vendas", async (papel, setor) => {
    const u = { ...vendedor, papel, setor } as Usuario;
    expect(await lerMensagensAtendimento(u, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 403 });
    expect(await lerMensagensAtendimento(u, atendimentoId, "pecas")).toMatchObject({ ok: false, status: 403 });
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it("vendedor e Peças não cruzam de setor pelo ID conhecido", async () => {
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "pecas")).toMatchObject({ ok: false, status: 403 });
    expect(await lerMensagensAtendimento(pecas, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 403 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it.each([["vendedor", "vendas", "vendas"], ["pecas", "pecas", "pecas"], ["gerente", "vendas", "vendas"], ["gerente", "pecas", "pecas"], ["gerente", "administracao", "pecas"], ["admin", "administracao", "vendas"]])("perfil%s/%s usa pré-filtro%s e SQL ainda pode negar", async (papel, setor, contexto) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo: "nao_encontrado", unidade: "fixture_interno" }, error: null });
    expect(await lerMensagensAtendimento({ ...vendedor, papel, setor } as Usuario, atendimentoId, contexto as "vendas")).toMatchObject({ ok: false, status: 404 });
    expect(fixture.rpc.mock.calls[0][1]).toEqual({ ...argsBase, p_setor: contexto });
  });
});

describe("A1.2a paginação e DTO de retorno", () => {
  it("mantém micros e a ordem dada pelo SQL, sem ordenar por milissegundos JS", async () => {
    const primeira = { ...linha, criadoEm: "2026-11-11T12:00:00.000002Z" };
    const ultima = { ...linha, id: outroId, criadoEm: "2026-11-11T12:00:00.000001Z" };
    const proximoCursor = { criadoEm: ultima.criadoEm, id: outroId };
    const data = { ...sucesso, total: 3, mensagens: [primeira, ultima], proximoCursor };
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { limite: 2 })).toEqual(data);
  });
  it.each(["recebida", "enviada", "entregue", "lida", "falhou", "bloqueada"])("aceita status previsto%s sem mudar direção/autor", async status => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, mensagens: [{ ...linha, status }] }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: true, mensagens: [{ status, direcao: "entrada", autor: "cliente" }] });
  });
  it.each([
    { atendimentoId: outroId }, { setor: "pecas" }, { total: -1 }, { total: 0 }, { total: 1.5 }, { total: Infinity },
    { total: "1" }, { total: Number.MAX_SAFE_INTEGER + 1 }, { revisaoPendente: "false" }, { mensagens: null },
    { mensagens: [linha, { ...linha, id: outroId }] }, { mensagens: [linha, linha], total: 2 },
    { proximoCursor: undefined }, { proximoCursor: { criadoEm, id: mensagemId }, total: 1 },
  ])("recusa envelope/paginação inválidos %j", async patch => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, ...patch }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { limite: 1 })).toMatchObject({ ok: false, status: 503 });
  });
  it("IDs duplicados após normalizar maiúsculas invalidam página de tamanho permitido", async () => {
    const id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, total: 2, mensagens: [{ ...linha, id }, { ...linha, id: id.toLowerCase() }] }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { limite: 2 })).toMatchObject({ ok: false, status: 503 });
  });
  it("cursor seguinte exige página cheia, mesmo se coincidir com a última linha", async () => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, total: 3, proximoCursor: { criadoEm, id: mensagemId } }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { limite: 2 })).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    { id: null }, { conteudo: 1 }, { conteudo: undefined }, { tipo: null }, { criadoEm: null },
    { status: "desconhecido" }, { direcao: "saida" }, { autor: "atendente" },
  ])("recusa linha inválida%s em vez de devolver resultado parcial", async patch => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, mensagens: [{ ...linha, ...patch }] }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    { criadoEm, id: outroId }, { criadoEm: "2026-11-11T12:00:00.000001+00:00", id: mensagemId },
    { criadoEm: "2026-11-11T12:00:00.000002Z", id: mensagemId },
  ])("cursor seguinte deve coincidir com última linha exatamente %j", async proximoCursor => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, total: 2, proximoCursor }, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas", { limite: 1 })).toMatchObject({ ok: false, status: 503 });
  });
});

describe("A1.2a falhas do backend não expõem dados", () => {
  it.each([["invalido", 400], ["cursor_invalido", 400], ["nao_encontrado", 404], ["desconhecido", 503]])("mapeia%s para%s sem detalhes", async (codigo, status) => {
    fixture.rpc.mockResolvedValue({ data: { ok: false, codigo, conteudo: "fixture_interno", clienteId: outroId }, error: null });
    const r = await lerMensagensAtendimento(vendedor, atendimentoId, "vendas");
    expect(r).toMatchObject({ ok: false, status });
    expect(Object.keys(r).sort()).toEqual(["motivo", "ok", "status"]);
    expect(JSON.stringify(r)).not.toMatch(/fixture_interno|80000000-0000-4000-8000-000000000202/);
  });
  it.each([null, [], {}, { ...sucesso, ok: "true" }])("resposta malformada%j vira503", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
  it("erro, throw e envelope inválido nunca devolvem corpo cru", async () => {
    fixture.rpc.mockResolvedValue({ data: sucesso, error: { code: "42501", message: "fixture_interno" } });
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockRejectedValue(new Error("fixture_interno"));
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 503 });
    fixture.rpc.mockResolvedValue(null);
    expect(await lerMensagensAtendimento(vendedor, atendimentoId, "vendas")).toMatchObject({ ok: false, status: 503 });
  });
});
