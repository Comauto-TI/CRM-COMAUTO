import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { responderLivre, notificar, type ContextoAtendimento } from "@/lib/messaging/outbound";

const f = vi.hoisted(() => ({ enviar: vi.fn(), botoes: vi.fn(), template: vi.fn(), autorizar: vi.fn(), open: true, optout: 0 as number | null, optoutError: null as unknown, modular: 0 as number | null, modularError: null as unknown, status: "bot", statusError: null as unknown, persistError: null as unknown, persisted: true, ops: [] as Array<{ tabela: string; acao: string; dados: unknown; filtros: Array<[string, unknown]> }>, calls: [] as string[] }));
const clienteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", conv = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", att = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", msg = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
vi.mock("@/lib/whatsapp/client", () => ({ enviarTexto: f.enviar, enviarBotoes: f.botoes, enviarTemplate: f.template }));
vi.mock("@/lib/time", () => ({ janela24hAberta: () => f.open, dentroHorarioEnvio: () => true }));
vi.mock("@/lib/config", () => ({ getConfig: async () => ({ horario_envio: {}, fuso_offset: "-03:00" }) }));
vi.mock("@/lib/messaging/regras", () => ({ decidirEnvio: () => ({ acao: "livre" }), preencherCorpo: () => "Notificação fictícia" }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ from(tabela: string) {
  let acao = "select"; let dados: unknown; const filtros: Array<[string, unknown]> = [];
  const resolver = () => {
    f.calls.push(tabela + ":" + acao);
    if (acao !== "select") { f.ops.push({ tabela, acao, dados, filtros }); return { data: tabela === "mensagens" && acao === "update" && f.persisted ? { id: msg } : null, error: tabela === "mensagens" ? f.persistError : null }; }
    if (tabela === "clientes") return { data: { id: clienteId, telefone: "5511999991234", nome: "Cliente", ultimo_contato_em: "2026-11-11T12:00:00Z", anonimizado: false }, error: null };
    if (tabela === "optouts") return { count: f.optout, error: f.optoutError };
    if (tabela === "atendimentos_modulares") return { count: f.modular, error: f.modularError };
    if (tabela === "conversas") return { data: { id: conv, status: f.status }, error: f.statusError };
    if (tabela === "templates") return { data: { nome: "fixture", idioma: "pt_BR", categoria_meta: "UTILITY", finalidade: "servico", corpo_exemplo: "Olá", botoes: [], status_aprovacao: "aprovado", ativo: true }, error: null };
    if (tabela === "consentimentos") return { data: [{ tipo: "servico" }], error: null };
    throw new Error("Tabela inesperada " + tabela);
  };
  const q = { select() { return q; }, eq(k: string, v: unknown) { filtros.push([k, v]); return q; }, in(k: string, v: unknown) { filtros.push([k, v]); return q; }, order() { return q; }, limit() { return q; },
    update(v: unknown) { acao = "update"; dados = v; return q; }, insert(v: unknown) { acao = "insert"; dados = v; return q; },
    maybeSingle: async () => resolver(), single: async () => resolver(), then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve(resolver()).then(resolve, reject); } };
  return q;
} }) }));
const contexto = (): ContextoAtendimento => ({ id: att, mensagemId: msg, conversaId: conv, autorizar: f.autorizar });
const pedido = () => ({ clienteId, texto: "Resposta fictícia", autor: "atendente" as const, contextoAtendimento: contexto() });

beforeEach(() => {
  vi.clearAllMocks(); f.open = true; f.optout = 0; f.optoutError = null; f.modular = 0; f.modularError = null; f.status = "bot"; f.statusError = null; f.persistError = null; f.persisted = true; f.ops = []; f.calls = [];
  f.enviar.mockResolvedValue({ ok: true, wamid: "wamid.envio.fixture" }); f.botoes.mockResolvedValue({ ok: true, wamid: "wamid.botoes.fixture" }); f.template.mockResolvedValue({ ok: true, wamid: "wamid.template.fixture" });
  f.autorizar.mockImplementation(async () => { f.calls.push("autorizar"); return true; });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("HTTP real proibido"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("outbound Peças despacho autorizado", () => {
  it("autoriza imediatamente antes de transportar e atualiza só a reserva exata", async () => {
    f.enviar.mockImplementation(async () => { expect(f.calls.at(-1)).toBe("autorizar"); return { ok: true, wamid: "wamid.envio.fixture" }; });
    expect(await responderLivre(pedido())).toEqual({ ok: true, wamid: "wamid.envio.fixture", modo: "livre" });
    expect(f.autorizar).toHaveBeenCalledTimes(1); expect(f.enviar).toHaveBeenCalledExactlyOnceWith("5511999991234", "Resposta fictícia");
    expect(f.ops).toHaveLength(1); expect(f.ops[0]).toMatchObject({ tabela: "mensagens", acao: "update", dados: { wamid: "wamid.envio.fixture", status: "enviada", erro: null } });
    expect(f.ops[0].filtros).toEqual(expect.arrayContaining([["id", msg], ["atendimento_id", att], ["cliente_id", clienteId], ["conversa_id", conv], ["direcao", "saida"], ["autor", "atendente"]]));
    expect(Object.keys(f.ops[0].dados as object).sort()).toEqual(["erro", "status", "wamid"]);
  });
  it.each([false, "throw"])("autorização final%s impede transporte", async valor => {
    if (valor === "throw") f.autorizar.mockRejectedValue(new Error("fixture_interno")); else f.autorizar.mockResolvedValue(false);
    expect((await responderLivre(pedido())).ok).toBe(false); expect(f.enviar).not.toHaveBeenCalled(); expect(f.ops).toHaveLength(0);
  });
  it("24h fechada recusa antes da autorização e do transporte", async () => { f.open = false; expect(await responderLivre(pedido())).toEqual({ ok: false, motivo: "janela_24h_fechada" }); expect(f.autorizar).not.toHaveBeenCalled(); expect(f.enviar).not.toHaveBeenCalled(); });
  it.each([1, null, "erro"] as const)("optout%s bloqueia humano com falha fechada", async valor => {
    if (valor === "erro") f.optoutError = { message: "fixture_interno" }; else f.optout = valor;
    expect((await responderLivre(pedido())).ok).toBe(false); expect(f.autorizar).not.toHaveBeenCalled(); expect(f.enviar).not.toHaveBeenCalled();
  });
  it.each(["bot", "sistema"] as const)("autor%s não pode usar contexto humano", async autor => { expect((await responderLivre({ ...pedido(), autor })).ok).toBe(false); expect(f.enviar).not.toHaveBeenCalled(); });
  it("contexto UUID inválido não faz consulta nem transporte", async () => { expect((await responderLivre({ ...pedido(), contextoAtendimento: { ...contexto(), id: att + "\n" } })).ok).toBe(false); expect(f.calls).toHaveLength(0); });
});

describe("outbound Peças resultado de persistência/HTTP", () => {
  it.each(["erro", "zero"])("Meta aceitou e persistência%s retorna incerto sem reenviar", async valor => {
    if (valor === "erro") f.persistError = { message: "fixture_interno" }; else f.persisted = false;
    expect(await responderLivre(pedido())).toEqual({ ok: false, motivo: "envio_incerto" }); expect(f.enviar).toHaveBeenCalledTimes(1); expect(f.ops).toHaveLength(1);
  });
  it("timeout mantém reserva pendente sem gravar falhou nem sugerir reenvio seguro", async () => {
    f.enviar.mockResolvedValue({ ok: false, erro: "timeout" });
    expect(await responderLivre(pedido())).toEqual({ ok: false, motivo: "envio_incerto" });
    expect(f.enviar).toHaveBeenCalledTimes(1); expect(f.autorizar).toHaveBeenCalledTimes(1);
    expect(f.ops).toHaveLength(0); expect(f.calls).not.toContain("mensagens:update");
  });
  it("throw do transporte também fica incerto e não reenvia", async () => { f.enviar.mockRejectedValue(new Error("fixture_interno")); expect(await responderLivre(pedido())).toEqual({ ok: false, motivo: "envio_incerto" }); expect(f.enviar).toHaveBeenCalledTimes(1); });
  it("recusa explícita Meta é registrada sem criar outra mensagem", async () => { f.enviar.mockResolvedValue({ ok: false, erro: "Recusado", codigo: 131047 }); expect(await responderLivre(pedido())).toEqual({ ok: false, motivo: "Recusado" }); expect(f.ops[0]).toMatchObject({ acao: "update", dados: { wamid: null, status: "falhou", erro: "Recusado" } }); });
});

describe("outbound cerca do legado e compatibilidade", () => {
  it.each([1, null, "erro"] as const)("atendente sem contexto e cadastro modular%s não envia", async valor => { if (valor === "erro") f.modularError = { message: "fixture_interno" }; else f.modular = valor; expect((await responderLivre({ clienteId, texto: "Legado", autor: "atendente" })).ok).toBe(false); expect(f.enviar).not.toHaveBeenCalled(); });
  it("atendente legado sem ticket mantém INSERT e atualização da conversa", async () => { expect((await responderLivre({ clienteId, texto: "Legado", autor: "atendente" })).ok).toBe(true); expect(f.ops.map(o => [o.tabela, o.acao])).toEqual([["mensagens", "insert"], ["conversas", "update"]]); });
  it("bot em voo vê estado humano fresco e fica calado", async () => { f.status = "humano"; expect(await responderLivre({ clienteId, texto: "Bot", autor: "bot" })).toEqual({ ok: false, motivo: "atendimento_humano" }); expect(f.enviar).not.toHaveBeenCalled(); });
  it("erro ao revalidar status do bot falha fechado", async () => { f.statusError = { message: "fixture_interno" }; expect((await responderLivre({ clienteId, texto: "Bot", autor: "bot" })).ok).toBe(false); expect(f.enviar).not.toHaveBeenCalled(); });
  it("confirmação fixa de optout do sistema continua permitida", async () => { f.optout = 1; expect((await responderLivre({ clienteId, texto: "Descadastro confirmado", autor: "sistema" })).ok).toBe(true); expect(f.calls).not.toContain("optouts:select"); });
  it.each([1, null, "erro"] as const)("retomada legada modular%s não manda texto nem template", async valor => { if (valor === "erro") f.modularError = { message: "fixture_interno" }; else f.modular = valor; expect((await notificar({ clienteId, uso: "retomada_atendimento", valores: ["Cliente"] })).ok).toBe(false); expect(f.enviar).not.toHaveBeenCalled(); expect(f.template).not.toHaveBeenCalled(); });
  it("notificação fora do piloto conserva o fluxo existente", async () => { f.modular = 1; expect((await notificar({ clienteId, uso: "confirmacao_agendamento", valores: ["Cliente"] })).ok).toBe(true); expect(f.calls).not.toContain("atendimentos_modulares:select"); expect(f.ops[0].acao).toBe("insert"); });
});
