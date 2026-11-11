import { beforeEach, describe, expect, it, vi } from "vitest";
import { encaminharLeadBot } from "@/modulos/atendimento/encaminhamentos";
import { rotearLead, type DadosLead } from "@/modulos/vendas/leads";

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), notificar: vi.fn(), auditar: vi.fn() }));
const clienteId = "00000000-0000-4000-8000-000000000101";
const conversaId = "00000000-0000-4000-8000-000000000102";
const cotacaoId = "00000000-0000-4000-8000-000000000103";

vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({
    rpc: fixture.rpc,
    from(tabela: string) {
      expect(tabela).toBe("clientes");
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { id: clienteId, nome: "Cliente fictício", anonimizado: false }, error: null }; },
      };
    },
  }),
}));
vi.mock("@/lib/usuarios", () => ({ nucleoAplicado: async () => true }));
vi.mock("@/lib/notificacoes", () => ({ notificar: fixture.notificar }));
vi.mock("@/lib/audit", () => ({ auditar: fixture.auditar }));

const pedido = { conversaId, clienteId, referencia: "wamid.fixture-encaminhamento", destino: "pecas" as const, resumo: "Pastilhas dianteiras" };
const lead: DadosLead = {
  ...pedido, interesse: "pecas", modelo: null, pagamento: "indefinido", prazo: "indefinido",
  temTroca: null, trocaDescricao: null, clienteConfirmou: false,
};

describe("encaminhamento persistido do bot", () => {
  beforeEach(() => {
    fixture.rpc.mockReset().mockResolvedValue({ data: { ok: true, cotacao_id: cotacaoId, ja_registrado: false }, error: null });
    fixture.notificar.mockReset(); fixture.auditar.mockReset();
  });

  it("recusa mensagem sem contexto real, em vez de inventar referência por horário", async () => {
    expect((await encaminharLeadBot({ ...pedido, conversaId: "" })).ok).toBe(false);
    expect((await encaminharLeadBot({ ...pedido, referencia: "" })).ok).toBe(false);
    expect((await rotearLead({ ...lead, conversaId: undefined })).ok).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("não confirma encaminhamento recusado ou com erro na transação", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: false }, error: null });
    expect((await rotearLead(lead)).ok).toBe(false);
    fixture.rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    expect((await rotearLead(lead)).ok).toBe(false);
    fixture.rpc.mockRejectedValue(new Error("Conexão indisponível"));
    expect((await rotearLead(lead)).ok).toBe(false);
    expect(fixture.notificar).not.toHaveBeenCalled();
  });

  it("Peças só confirma sucesso com o identificador de cotação persistida", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: true, cotacao_id: null }, error: null });
    expect((await rotearLead(lead)).ok).toBe(false);
    fixture.rpc.mockResolvedValue({ data: { ok: true, cotacao_id: cotacaoId, ja_registrado: true }, error: null });
    expect(await rotearLead(lead)).toEqual({ ok: true, destino: "pecas" });
    expect(fixture.notificar).not.toHaveBeenCalled();
  });

  it("transporta conversa, cliente e mensagem sem gerar nota ou aviso fora da transação", async () => {
    expect(await rotearLead(lead)).toEqual({ ok: true, destino: "pecas" });
    expect(fixture.rpc).toHaveBeenCalledWith("encaminhar_lead_bot", {
      p_conversa_id: conversaId, p_cliente_id: clienteId, p_referencia: pedido.referencia,
      p_destino: "pecas", p_resumo: pedido.resumo,
    });
    expect(fixture.notificar).not.toHaveBeenCalled();
    expect(fixture.auditar).not.toHaveBeenCalled();
  });

  it("triagem aceita um encaminhamento persistido sem criar cotação", async () => {
    fixture.rpc.mockResolvedValue({ data: { ok: true, cotacao_id: null, ja_registrado: false }, error: null });
    expect(await rotearLead({ ...lead, interesse: "indefinido" })).toEqual({ ok: true, destino: "triagem" });
  });
});
