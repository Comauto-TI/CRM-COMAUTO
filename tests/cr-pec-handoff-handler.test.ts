import { beforeEach, describe, expect, it, vi } from "vitest";
import { processarMensagem } from "@/lib/conversation/handler";

const f = vi.hoisted(() => ({ transferir: vi.fn(), aviso: vi.fn(), responder: vi.fn(), agente: vi.fn(), aplicarOptout: vi.fn(),
  status: "bot", botAtivo: true, optout: "nenhum", writes: [] as { tabela: string; patch: Record<string, unknown> }[] }));
const cliente = { id: "83000000-0000-4000-8000-000000000001", telefone: "550000000001", nome: "Cliente fictício" };
const conversa = "83000000-0000-4000-8000-000000000002", mensagem = "83000000-0000-4000-8000-000000000003";
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ from: (tabela: string) => {
  let operacao = "select", campos = "", contagem = false;
  const resolver = () => {
    if (tabela === "clientes" && operacao === "upsert") return { data: cliente, error: null };
    if (tabela === "conversas" && operacao === "select") return { data: { id: conversa, status: f.status, falhas_entendimento: 0, nao_lidas: 0 }, error: null };
    if (tabela === "mensagens" && operacao === "insert") return { data: { id: mensagem }, error: null };
    if (contagem) return { count: 0, error: null };
    if (tabela === "mensagens" && campos === "metadata") return { data: { metadata: {} }, error: null };
    if (campos.startsWith("id, metadata")) return { data: null, error: null };
    return { data: [], error: null };
  };
  const q = { select: (s: string, opts?: { head?: boolean }) => { campos = s; contagem = opts?.head === true; return q; },
    upsert: () => { operacao = "upsert"; return q; }, insert: () => { operacao = "insert"; return q; },
    update: (patch: Record<string, unknown>) => { operacao = "update"; f.writes.push({ tabela, patch }); return q; },
    eq: () => q, gte: () => q, in: () => q, order: () => q, limit: () => q,
    single: async () => resolver(), maybeSingle: async () => resolver(),
    then: (r: (v: unknown) => unknown, e?: (v: unknown) => unknown) => Promise.resolve(resolver()).then(r, e) };
  return q;
} }) }));
vi.mock("@/lib/config", () => ({ getConfig: async () => ({ bot_ativo: f.botAtivo, empresa: { nome: "Comauto" }, fuso_offset: "-03:00",
  seguranca: { max_chars_entrada: 4000, max_msgs_por_minuto: 10, max_msgs_por_dia: 100, historico_msgs: 10 } }) }));
vi.mock("@/lib/env", () => ({ valoresSecretos: () => [] }));
vi.mock("@/lib/phone", () => ({ normalizarTelefone: (t: string) => t }));
vi.mock("@/lib/clientes-telefone", () => ({ buscarClientePorTelefone: async () => null }));
vi.mock("@/lib/whatsapp/client", () => ({ marcarComoLida: async () => undefined }));
vi.mock("@/lib/security/guard", () => ({ mascararDadosSensiveis: (t: string) => ({ texto: t, mascarou: false }), verificarEntrada: () => ({ bloqueado: false }), filtrarSaida: () => ({ ok: true }), mensagemRecusa: () => "Recusa segura" }));
vi.mock("@/lib/security/optout", () => ({ detectarOptout: () => f.optout, pediuAtendente: (t: string) => t.includes("ATENDENTE"), pedidoLGPD: (t: string) => t.includes("LGPD") }));
vi.mock("@/lib/messaging/outbound", () => ({ responderLivre: f.responder, consentimentosAtivos: async () => [] }));
vi.mock("@/lib/consent", () => ({ aplicarOptout: f.aplicarOptout }));
vi.mock("@/lib/handoff", () => ({ transferirParaHumano: f.transferir, avisarFalhaTransferencia: f.aviso }));
vi.mock("@/lib/scheduling/booking", () => ({ agendamentosDoCliente: async () => [] }));
vi.mock("@/lib/audit", () => ({ registrarEventoSeguranca: async () => undefined }));
vi.mock("@/lib/costs", () => ({ lancarCustoMeta: async () => undefined }));
vi.mock("@/lib/campaigns", () => ({ verificarPausaCampanha: async () => undefined }));
vi.mock("@/lib/agent/run", () => ({ rodarAgente: f.agente }));
vi.mock("@/lib/links", () => ({ extrairCodigo: () => null, removerCodigo: (t: string) => t }));
vi.mock("@/lib/links-db", () => ({ vincularLink: async () => false }));

const entrada = (texto: string) => ({ wamid: "wamid.fixture.handoff", de: cliente.telefone, nomePerfil: null, timestamp: new Date("2026-11-11T12:00:00Z"), tipo: "text", texto, payloadBotao: null, contexto: null });
beforeEach(() => {
  vi.resetAllMocks(); f.status = "bot"; f.botAtivo = true; f.optout = "nenhum"; f.writes = [];
  f.transferir.mockResolvedValue({ ok: true, modular: true, jaEstava: false });
  f.aviso.mockResolvedValue(undefined); f.responder.mockResolvedValue({ ok: true });
  f.agente.mockResolvedValue({ tipo: "resposta", texto: "Resposta fictícia" });
});

describe("CR-PEC-001 handler não confirma transferência falsa", () => {
  it.each(["ATENDENTE trecho privado", "LGPD trecho privado"])("pedido %s usa somente motivo controlado", async texto => {
    await processarMensagem(entrada(texto));
    expect(f.transferir).toHaveBeenCalledExactlyOnceWith(cliente.id, texto.startsWith("LGPD") ? "pedido LGPD (dados pessoais)" : "cliente pediu atendente");
    expect(JSON.stringify(f.transferir.mock.calls)).not.toContain("trecho privado");
    expect(f.agente).not.toHaveBeenCalled(); expect(f.aviso).not.toHaveBeenCalled();
  });
  it.each([false, true])("handoff explícito com falha não fica silencioso (throw=%s)", async lancar => {
    if (lancar) f.transferir.mockRejectedValue(new Error("fixture_privado")); else f.transferir.mockResolvedValue({ ok: false });
    await processarMensagem(entrada("ATENDENTE"));
    expect(f.aviso).toHaveBeenCalledExactlyOnceWith(cliente.id); expect(f.agente).not.toHaveBeenCalled();
  });
  it("bot desligado tenta handoff e trata falha", async () => {
    f.botAtivo = false; f.transferir.mockResolvedValue({ ok: false });
    await processarMensagem(entrada("Quero informações"));
    expect(f.transferir).toHaveBeenCalledWith(cliente.id, "assistente desligado no painel"); expect(f.aviso).toHaveBeenCalledOnce();
  });
  it.each(["ATENDENTE", "LGPD"])("canal humano ainda encaminha pedido explícito %s sem IA", async texto => {
    f.status = "humano"; f.transferir.mockResolvedValue({ ok: false });
    await processarMensagem(entrada(texto));
    expect(f.transferir).toHaveBeenCalledOnce(); expect(f.aviso).toHaveBeenCalledOnce(); expect(f.agente).not.toHaveBeenCalled();
  });
  it("canal humano com texto comum permanece silencioso mesmo com bot desligado", async () => {
    f.status = "humano"; f.botAtivo = false;
    await processarMensagem(entrada("Informação ao meu atendente"));
    expect(f.transferir).not.toHaveBeenCalled(); expect(f.agente).not.toHaveBeenCalled(); expect(f.responder).not.toHaveBeenCalled();
  });
  it("opt-out conserva prioridade sobre pedido humano/modular", async () => {
    f.status = "humano"; f.optout = "optout";
    await processarMensagem(entrada("ATENDENTE SAIR"));
    expect(f.aplicarOptout).toHaveBeenCalledOnce(); expect(f.transferir).not.toHaveBeenCalled();
    expect(f.responder).toHaveBeenCalledWith(expect.objectContaining({ autor: "sistema", texto: expect.stringContaining("não receber mais mensagens") }));
  });
  it.each([false, true])("falha técnica só afirma equipe avisada quando handoff confirmou (sucesso=%s)", async sucesso => {
    f.agente.mockResolvedValue({ tipo: "falha", motivo: "fixture_privado" }); f.transferir.mockResolvedValue({ ok: sucesso });
    await processarMensagem(entrada("Quero informações"));
    expect(f.transferir).toHaveBeenCalledExactlyOnceWith(cliente.id, "falha técnica do assistente", { avisarCliente: false });
    expect(JSON.stringify(f.transferir.mock.calls)).not.toContain("fixture_privado");
    if (sucesso) { expect(f.aviso).not.toHaveBeenCalled(); expect(f.responder).toHaveBeenCalledWith(expect.objectContaining({ autor: "sistema", texto: expect.stringContaining("Já chamei alguém") })); }
    else { expect(f.aviso).toHaveBeenCalledExactlyOnceWith(cliente.id); expect(f.responder).not.toHaveBeenCalled(); }
  });
  it("refusal não entra em handoff técnico", async () => {
    f.agente.mockResolvedValue({ tipo: "falha", motivo: "refusal" }); await processarMensagem(entrada("Quero informações"));
    expect(f.transferir).not.toHaveBeenCalled(); expect(f.responder).toHaveBeenCalledWith(expect.objectContaining({ autor: "sistema", texto: "Recusa segura" }));
  });
  it("resposta normal do bot e transferência já confirmada conservam caminhos existentes", async () => {
    await processarMensagem(entrada("Quero informações"));
    expect(f.responder).toHaveBeenCalledExactlyOnceWith({ clienteId: cliente.id, autor: "bot", texto: "Resposta fictícia" });
    f.responder.mockClear(); f.agente.mockResolvedValue({ tipo: "transferido" });
    await processarMensagem(entrada("Quero informações"));
    expect(f.responder).not.toHaveBeenCalled(); expect(f.transferir).not.toHaveBeenCalled();
  });
});
