import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { obterDialogoPecas, assumirAtendimentoPecas, devolverAtendimentoPecas, responderAtendimentoPecas } from "@/modulos/pecas/atendimento";

const f = vi.hoisted(() => ({ rpc: vi.fn(), responder: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ rpc: f.rpc, from: f.from }) }));
vi.mock("@/lib/messaging/outbound", () => ({ responderLivre: f.responder }));
vi.mock("@/lib/env", () => ({ valoresSecretos: () => ["segredo-fixture-123456789"] }));
const ator = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cotacao = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const atendimento = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", msg = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const cliente = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", conversa = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const outro = "00000000-0000-4000-8000-000000000001";
const u: Usuario = { id: ator, nome: "Peças", email: "pecas@fixture.invalid", papel: "pecas", setor: "pecas", unidade: "comauto", unidades: ["comauto"] };
const linha = { id: msg, direcao: "entrada", autor: "cliente", tipo: "text", conteudo: "Pedido fictício", status: "recebida", criadoEm: "2026-11-11T12:00:00.000001Z", pendente: false };
const dialogo = { ok: true, id: atendimento, cotacaoId: cotacao, versao: 1, clienteNome: "Cliente", estado: "minha", janelaAberta: true, podeAssumir: false, podeDevolver: true, mensagens: [linha], revisaoPendente: false };
const reserva = { ok: true, id: atendimento, cotacaoId: cotacao, versao: 1, clienteId: cliente, conversaId: conversa, mensagemId: msg, despachar: true };
const autorizacao = { ok: true, id: atendimento, clienteId: cliente, conversaId: conversa, mensagemId: msg };
const args = { p_cotacao: cotacao, p_ator: ator, p_versao: 1, p_mensagem: msg };

beforeEach(() => {
  vi.resetAllMocks();
  f.from.mockImplementation(() => { throw new Error("Consulta solta proibida"); });
  f.rpc.mockImplementation(async (nome: string) => ({ error: null, data: nome === "pecas_dialogo" ? dialogo : nome === "pecas_reservar_resposta" ? reserva : nome === "pecas_autorizar_resposta" ? autorizacao : { ok: true, id: atendimento, cotacaoId: cotacao, versao: 2, estado: nome === "pecas_assumir_atendimento" ? "minha" : "livre" } }));
  f.responder.mockImplementation(async (a: { contextoAtendimento: { autorizar: () => Promise<boolean> } }) => await a.contextoAtendimento.autorizar() ? { ok: true, wamid: "wamid.fixture", modo: "livre" } : { ok: false, motivo: "atendimento_indisponivel" });
});

describe("Peças diálogo autorizado", () => {
  it("usa uma RPC e não marca leitura nem consulta cliente por fora", async () => {
    expect(await obterDialogoPecas(u, cotacao)).toEqual(dialogo);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("pecas_dialogo", { p_cotacao: cotacao, p_ator: ator });
    expect(f.from).not.toHaveBeenCalled(); expect(f.responder).not.toHaveBeenCalled();
  });
  it("filtra DTO, mascara nome/texto, preserva null e microssegundos", async () => {
    f.rpc.mockResolvedValue({ data: { ...dialogo, clienteNome: "CPF 111.444.777-35", telefone: "fixture_privado", mensagens: [{ ...linha, conteudo: "CPF 111.444.777-35 cartão 4111 1111 1111 1111", metadata: { segredo: true } }, { ...linha, id: outro, direcao: "saida", autor: "atendente", status: "bloqueada", conteudo: null, pendente: true }] }, error: null });
    const r = await obterDialogoPecas(u, cotacao); expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/111\.444|4111|metadata|fixture_privado/);
    if (r.ok) { expect(r.mensagens[0].criadoEm).toBe(linha.criadoEm); expect(r.mensagens[1].conteudo).toBeNull(); }
  });
  it("preserva sem responsável para oferecer assumir0", async () => {
    f.rpc.mockResolvedValue({ data: { ok: false, codigo: "sem_responsavel" }, error: null });
    expect(await obterDialogoPecas(u, cotacao)).toMatchObject({ ok: false, codigo: "sem_responsavel" });
  });
  it("aceita atendimento ainda não criado sem inventar mensagens", async () => {
    const d = { ...dialogo, id: null, versao: 0, estado: "livre", podeAssumir: true, podeDevolver: false, mensagens: [] }; f.rpc.mockResolvedValue({ data: d, error: null });
    expect(await obterDialogoPecas(u, cotacao)).toEqual(d);
  });
  it("cotação sem ticket preserva canal ocupado por outro atendimento/legado", async () => {
    const d = { ...dialogo, id: null, versao: 0, estado: "outra", podeDevolver: false, mensagens: [] };
    f.rpc.mockResolvedValue({ data: d, error: null });
    expect(await obterDialogoPecas(u, cotacao)).toEqual(d);
    expect(f.responder).not.toHaveBeenCalled();
    f.rpc.mockResolvedValue({ data: { ...d, estado: "minha" }, error: null });
    expect(await obterDialogoPecas(u, cotacao)).toMatchObject({ ok: false, status: 503 });
  });
  it("preserva autorização explícita de supervisor para devolver outra posse sem permitir responder", async () => {
    const d = { ...dialogo, estado: "outra", podeDevolver: true };
    f.rpc.mockResolvedValue({ data: d, error: null });
    expect(await obterDialogoPecas({ ...u, papel: "gerente", setor: "pecas" }, cotacao)).toEqual(d);
    expect(f.responder).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("pecas_dialogo", { p_cotacao: cotacao, p_ator: ator });
  });
  it("não infere podeDevolver pelo estado ou papel do usuário", async () => {
    const d = { ...dialogo, podeDevolver: false };
    f.rpc.mockResolvedValue({ data: d, error: null });
    expect(await obterDialogoPecas({ ...u, papel: "admin", setor: "administracao" }, cotacao)).toEqual(d);
  });
  it("canal livre não concede assumir ao supervisor sem autorização explícita", async () => {
    const d = { ...dialogo, estado: "livre", podeAssumir: false, podeDevolver: false };
    f.rpc.mockResolvedValue({ data: d, error: null });
    expect(await obterDialogoPecas({ ...u, papel: "admin", setor: "administracao" }, cotacao)).toEqual(d);
  });
  it.each([{ cotacaoId: outro }, { id: atendimento + "\n" }, { versao: -1 }, { estado: "bot" }, { janelaAberta: "true" }, { podeAssumir: undefined }, { podeAssumir: null }, { podeAssumir: "true" }, { podeAssumir: 0 }, { podeAssumir: true }, { podeDevolver: undefined }, { podeDevolver: null }, { podeDevolver: "true" }, { podeDevolver: 0 }, { id: null, versao: 0, estado: "outra", mensagens: [] }, { estado: "livre" }, { revisaoPendente: null }, { mensagens: [linha, linha] }, { mensagens: [{ ...linha, direcao: "saida" }] }, { mensagens: [{ ...linha, autor: "sistema" }] }, { mensagens: [{ ...linha, criadoEm: "2026-02-30T00:00:00Z" }] }, { mensagens: [{ ...linha, pendente: true }] }])("recusa retorno inválido %j", async patch => {
    f.rpc.mockResolvedValue({ data: { ...dialogo, ...patch }, error: null }); expect(await obterDialogoPecas(u, cotacao)).toMatchObject({ ok: false, status: 503 });
  });
});

describe("Peças assumir/devolver", () => {
  it.each([[assumirAtendimentoPecas, "pecas_assumir_atendimento", "minha"], [devolverAtendimentoPecas, "pecas_devolver_atendimento", "livre"]] as const)("chama somente a operação transacional %s", async (fn, nome, estado) => {
    expect(await fn(u, cotacao.toUpperCase(), 1)).toEqual({ ok: true, id: atendimento, cotacaoId: cotacao, versao: 2, estado });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(nome, { p_cotacao: cotacao, p_ator: ator, p_versao: 1 });
  });
  it("aceita replay da versão corrente e rejeita salto de versão", async () => {
    f.rpc.mockResolvedValue({ data: { ok: true, id: atendimento, cotacaoId: cotacao, versao: 1, estado: "minha" }, error: null });
    expect(await assumirAtendimentoPecas(u, cotacao, 1)).toMatchObject({ ok: true, versao: 1 });
    f.rpc.mockResolvedValue({ data: { ok: true, id: atendimento, cotacaoId: cotacao, versao: 3, estado: "livre" }, error: null });
    expect(await devolverAtendimentoPecas(u, cotacao, 1)).toMatchObject({ ok: false, status: 503 });
  });
});

describe("Peças resposta com reserva e autorização final", () => {
  it("reserva corpo mascarado e envia o MESMO texto com IDs derivados do SQL", async () => {
    expect(await responderAtendimentoPecas(u, cotacao, 1, msg, "  CPF 111.444.777-35  ")).toEqual({ ok: true, versao: 1 });
    expect(f.rpc).toHaveBeenNthCalledWith(1, "pecas_reservar_resposta", { ...args, p_texto: "CPF [CPF removido]" });
    expect(f.rpc).toHaveBeenNthCalledWith(2, "pecas_autorizar_resposta", args);
    expect(f.responder).toHaveBeenCalledExactlyOnceWith({ clienteId: cliente, texto: "CPF [CPF removido]", autor: "atendente", contextoAtendimento: { id: atendimento, conversaId: conversa, mensagemId: msg, autorizar: expect.any(Function) } });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("limita a4000 sem cortar emoji e sem divergir reserva/transporte", async () => {
    await responderAtendimentoPecas(u, cotacao, 1, msg, "a".repeat(3999) + "🚗 final");
    expect(f.rpc.mock.calls[0][1].p_texto).toBe("a".repeat(3999)); expect(f.responder.mock.calls[0][0].texto).toBe("a".repeat(3999));
  });
  it("sucesso de replay enviado nunca chama transporte", async () => {
    f.rpc.mockResolvedValue({ data: { ...reserva, despachar: false }, error: null });
    expect(await responderAtendimentoPecas(u, cotacao, 1, msg, "Pedido")).toEqual({ ok: true, versao: 1 }); expect(f.responder).not.toHaveBeenCalled();
  });
  it.each(["pecas_reservar_resposta", "pecas_autorizar_resposta"])("origem ambígua em %s exige revisão sem sugerir falha transitória", async bloqueada => {
    f.rpc.mockImplementation(async (nome: string) => ({ data: nome === bloqueada ? { ok: false, codigo: "origem_ambigua", referencia: "fixture_privada" } : reserva, error: null }));
    expect(await responderAtendimentoPecas(u, cotacao, 1, msg, "Pedido")).toEqual({ ok: false, status: 409, erro: "A origem das mensagens precisa de revisão antes de responder." });
    if (bloqueada === "pecas_reservar_resposta") expect(f.responder).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each(["segredo-fixture-123456789", "sk-ant-fixture123456789", "-----BEGIN PRIVATE KEY-----"])("segredo é bloqueado ANTES de reservar %s", async texto => {
    expect(await responderAtendimentoPecas(u, cotacao, 1, msg, texto)).toMatchObject({ ok: false, status: 400 }); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([{ id: outro }, { clienteId: outro }, { conversaId: outro }, { mensagemId: outro }, { ok: false }])("autorização final inválida nunca confirma envio %j", async patch => {
    f.rpc.mockImplementation(async (nome: string) => ({ data: nome === "pecas_reservar_resposta" ? reserva : { ...autorizacao, ...patch }, error: null }));
    expect(await responderAtendimentoPecas(u, cotacao, 1, msg, "Pedido")).toMatchObject({ ok: false });
  });
  it.each([{ cotacaoId: outro }, { mensagemId: outro }, { versao: 2 }, { clienteId: "invalido" }, { conversaId: null }, { despachar: "true" }])("reserva malformada não chega ao outbound %j", async patch => {
    f.rpc.mockResolvedValue({ data: { ...reserva, ...patch }, error: null }); expect(await responderAtendimentoPecas(u, cotacao, 1, msg, "Pedido")).toMatchObject({ ok: false, status: 503 }); expect(f.responder).not.toHaveBeenCalled();
  });
  it.each([["envio_incerto", true], ["optout", false], ["janela_24h_fechada", false]] as const)("falha %s não vira sucesso", async (motivo, incerto) => {
    f.responder.mockResolvedValue({ ok: false, motivo }); const r = await responderAtendimentoPecas(u, cotacao, 1, msg, "Pedido"); expect(r.ok).toBe(false); expect("incerto" in r && r.incerto === true).toBe(incerto);
  });
});

describe("Peças barreiras e erros", () => {
  it.each([null, {}, { ...u, id: ator + "\n" }, { ...u, papel: "vendedor" }, { ...u, papel: "gerente", setor: "oficina" }])("perfil/identidade inválida %j não consulta", async usuario => {
    const user = usuario as Usuario; expect((await obterDialogoPecas(user, cotacao)).ok).toBe(false); expect((await assumirAtendimentoPecas(user, cotacao, 1)).ok).toBe(false); expect((await devolverAtendimentoPecas(user, cotacao, 1)).ok).toBe(false); expect((await responderAtendimentoPecas(user, cotacao, 1, msg, "Pedido")).ok).toBe(false); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, Infinity, 2_147_483_647])("versão inválida%s não reserva", async versao => { expect((await responderAtendimentoPecas(u, cotacao, versao, msg, "Pedido")).ok).toBe(false); expect(f.rpc).not.toHaveBeenCalled(); });
  it("erro de banco/throw/código desconhecido não vazam diagnóstico", async () => {
    for (const resultado of [{ data: null, error: { message: "fixture_interno" } }, { data: { ok: false, codigo: "fixture_interno" }, error: null }]) { f.rpc.mockResolvedValue(resultado); const r = await obterDialogoPecas(u, cotacao); expect(r).toMatchObject({ ok: false, status: 503 }); expect(JSON.stringify(r)).not.toContain("fixture_interno"); }
    f.rpc.mockRejectedValue(new Error("fixture_interno")); expect(await assumirAtendimentoPecas(u, cotacao, 1)).toMatchObject({ ok: false, status: 503 });
  });
});
