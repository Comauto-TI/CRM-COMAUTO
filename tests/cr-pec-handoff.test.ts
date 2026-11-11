import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avisarFalhaTransferencia, transferirParaHumano } from "@/lib/handoff";

const f = vi.hoisted(() => ({ rpc: vi.fn(), responder: vi.fn(), auditar: vi.fn(), template: vi.fn(), horario: vi.fn(),
  views: [] as unknown[], chamadas: [] as { tabela: string; select?: string; update?: unknown }[] }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ rpc: f.rpc, from: (tabela: string) => {
  const chamada: { tabela: string; select?: string; update?: unknown } = { tabela }; f.chamadas.push(chamada);
  const resultado = () => tabela === "conversas_legadas" ? f.views.shift() : tabela === "conversas" ? { data: [{ id: conversa }], error: null } : { data: null, error: null };
  const q = { select: (s: string) => { chamada.select = s; return q; }, update: (p: unknown) => { chamada.update = p; return q; },
    eq: () => q, not: () => q, maybeSingle: async () => resultado(),
    then: (r: (v: unknown) => unknown, e?: (v: unknown) => unknown) => Promise.resolve(resultado()).then(r, e) };
  return q;
} }) }));
vi.mock("@/lib/config", () => ({ getConfig: async () => ({ atendimento: { msg_transferencia: "Aviso legado", msg_fora_horario: "Aviso fora do horário" }, horario_envio: {}, fuso_offset: "-03:00" }) }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://fixture.invalid" }) }));
vi.mock("@/lib/time", () => ({ dentroHorarioEnvio: f.horario }));
vi.mock("@/lib/whatsapp/client", () => ({ enviarTemplate: f.template }));
vi.mock("@/lib/messaging/outbound", () => ({ responderLivre: f.responder }));
vi.mock("@/lib/audit", () => ({ auditar: f.auditar }));
vi.mock("@/lib/usuarios", () => ({ tabelaUsuarios: async () => "usuarios" }));

const cliente = "81000000-0000-4000-8000-000000000001", conversa = "81000000-0000-4000-8000-000000000002";
const vazio = { data: null, error: null };
const legada = { data: { id: conversa, status: "bot", assumida_por: null }, error: null };
beforeEach(() => {
  vi.resetAllMocks(); f.views = [vazio]; f.chamadas = [];
  f.rpc.mockResolvedValue({ data: { ok: true, destinatarios: 1 }, error: null });
  f.responder.mockResolvedValue({ ok: true }); f.horario.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("CR-PEC-001 handoff modular", () => {
  it.each([1, 2])("confirma somente aviso persistido para responsável/fallback (%s destinatários)", async destinatarios => {
    f.rpc.mockResolvedValue({ data: { ok: true, destinatarios }, error: null });
    expect(await transferirParaHumano(cliente, "cliente pediu atendente")).toEqual({ ok: true, jaEstava: false, modular: true });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("registrar_pedido_humano_modular", { p_cliente: cliente, p_motivo: "cliente pediu atendente" });
    expect(f.responder).toHaveBeenCalledExactlyOnceWith({ clienteId: cliente, autor: "sistema", texto: "Avisei a equipe responsável pelo seu atendimento para continuar por aqui." });
    expect(f.chamadas.map(c => c.tabela)).toEqual(["conversas_legadas"]);
    expect(f.auditar).not.toHaveBeenCalled(); expect(f.template).not.toHaveBeenCalled();
  });
  it("preserva aviso opcional sem desativar a notificação persistida", async () => {
    expect(await transferirParaHumano(cliente, "pedido", { avisarCliente: false })).toMatchObject({ ok: true, modular: true });
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.responder).not.toHaveBeenCalled();
  });
  it.each([false, true])("falha no ACK opcional não desfaz pedido persistido nem repete notificações (throw=%s)", async lancar => {
    if (lancar) f.responder.mockRejectedValue(new Error("fixture_privado")); else f.responder.mockResolvedValue({ ok: false, motivo: "fixture_privado" });
    expect(await transferirParaHumano(cliente, "pedido")).toEqual({ ok: true, jaEstava: false, modular: true });
    expect(f.rpc).toHaveBeenCalledOnce(); expect(console.error).toHaveBeenCalledWith("[handoff] aviso_modular_ao_cliente_nao_confirmado");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fixture_privado");
  });
  it("não promete um horário ou troca de dono em aviso modular", async () => {
    f.horario.mockReturnValue(false);
    await transferirParaHumano(cliente, "pedido");
    expect(f.responder.mock.calls[0][0]).toMatchObject({ autor: "sistema", texto: "Avisei a equipe responsável pelo seu atendimento para continuar por aqui." });
    expect(f.chamadas.some(c => c.update)).toBe(false);
  });
  it.each([null, [], {}, { ok: true }, { ok: true, destinatarios: 0 }, { ok: true, destinatarios: -1 },
    { ok: true, destinatarios: 1.5 }, { ok: true, destinatarios: "1" }, { ok: true, destinatarios: Number.MAX_SAFE_INTEGER + 1 },
    { ok: false, codigo: "sem_destinatario" }, { ok: false, codigo: "nao_encontrado" }, { ok: false, codigo: "invalido" },
    { ok: false, codigo: "fixture_diagnostico_privado" }])("não confirma sem comprovação de persistência %j", async data => {
    f.rpc.mockResolvedValue({ data, error: null });
    expect(await transferirParaHumano(cliente, "CPF fixture_privado")).toMatchObject({ ok: false });
    expect(f.responder).not.toHaveBeenCalled(); expect(f.auditar).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/CPF|fixture_privado|fixture_diagnostico/);
  });
  it("erro da view não tenta assumir que é modular", async () => {
    f.views = [{ data: null, error: { message: "fixture_privado" } }];
    expect(await transferirParaHumano(cliente, "pedido")).toMatchObject({ ok: false });
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.responder).not.toHaveBeenCalled();
  });
  it("erro/throw da RPC ficam negativos e sem diagnóstico no log", async () => {
    for (const lancar of [false, true]) {
      f.views = [vazio];
      if (lancar) f.rpc.mockRejectedValue(new Error("fixture_privado"));
      else f.rpc.mockResolvedValue({ data: { ok: true, destinatarios: 1 }, error: { message: "fixture_privado" } });
      expect(await transferirParaHumano(cliente, "fixture_privado")).toMatchObject({ ok: false });
    }
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fixture_privado");
    expect(f.responder).not.toHaveBeenCalled();
  });
  it("negócio encerrado na consulta permite uma única reconsulta do legado", async () => {
    f.views = [vazio, legada, vazio]; f.rpc.mockResolvedValue({ data: { ok: false, codigo: "legado" }, error: null });
    expect(await transferirParaHumano(cliente, "pedido")).toEqual({ ok: true, jaEstava: false });
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.chamadas.filter(c => c.tabela === "conversas_legadas" && c.select === "id, status, assumida_por")).toHaveLength(2);
    expect(f.chamadas.filter(c => c.tabela === "conversas" && c.update)).toHaveLength(1);
    expect(f.auditar).toHaveBeenCalledOnce();
  });
  it("reconsulta ainda vazia não cria loop nem confirma transferência", async () => {
    f.views = [vazio, vazio]; f.rpc.mockResolvedValue({ data: { ok: false, codigo: "legado" }, error: null });
    expect(await transferirParaHumano(cliente, "pedido")).toMatchObject({ ok: false });
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.chamadas).toHaveLength(2); expect(f.responder).not.toHaveBeenCalled();
  });
  it("humano legado já existente mantém semântica sem RPC modular", async () => {
    f.views = [{ data: { ...legada.data, status: "humano" }, error: null }];
    expect(await transferirParaHumano(cliente, "pedido")).toEqual({ ok: true, jaEstava: true });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe("CR-PEC-001 aviso honesto de falha", () => {
  it("usa somente outbound sistema, sem afirmar que avisou a equipe", async () => {
    await avisarFalhaTransferencia(cliente);
    expect(f.responder).toHaveBeenCalledExactlyOnceWith({ clienteId: cliente, autor: "sistema", texto: expect.stringContaining("Não consegui confirmar") });
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.template).not.toHaveBeenCalled();
  });
  it.each([false, true])("falha no próprio aviso é registrada sem PII (throw=%s)", async lancar => {
    if (lancar) f.responder.mockRejectedValue(new Error("fixture_privado")); else f.responder.mockResolvedValue({ ok: false, motivo: "fixture_privado" });
    await expect(avisarFalhaTransferencia(cliente)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("[handoff] aviso_de_falha_nao_confirmado");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fixture_privado");
  });
});
