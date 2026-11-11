import { beforeEach, describe, expect, it, vi } from "vitest";
import { executarTool } from "@/lib/agent/tools";

const f = vi.hoisted(() => ({ transferir: vi.fn(), aviso: vi.fn() }));
vi.mock("@/lib/handoff", () => ({ transferirParaHumano: f.transferir, avisarFalhaTransferencia: f.aviso }));
vi.mock("@/lib/config", () => ({ getConfig: async () => ({ fuso_offset: "-03:00" }) }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => { throw new Error("Consulta inesperada"); } }));
vi.mock("@/lib/scheduling/booking", () => ({}));
vi.mock("@/lib/consent", () => ({}));
vi.mock("@/modulos/vendas/leads", () => ({}));
const ctx = { clienteId: "82000000-0000-4000-8000-000000000001", telefone: "550000000001", nomeCliente: null };
beforeEach(() => { vi.resetAllMocks(); f.aviso.mockResolvedValue(undefined); });

describe("CR-PEC-001 ferramenta transferir_humano", () => {
  it.each([{ ok: true, jaEstava: false, modular: true }, { ok: true, jaEstava: false }, { ok: true, jaEstava: true }])("marca transferiu somente com confirmação %j", async sucesso => {
    f.transferir.mockResolvedValue(sucesso);
    const r = await executarTool("transferir_humano", { motivo: "pedido" }, ctx);
    expect(r.transferiu).toBe(true); expect(JSON.parse(r.resultado)).toMatchObject({ ok: true, transferido: true });
    expect(f.aviso).not.toHaveBeenCalled();
  });
  it.each([false, true])("erro não vira transferido nem manda o handler ficar calado (throw=%s)", async lancar => {
    if (lancar) f.transferir.mockRejectedValue(new Error("fixture_privado")); else f.transferir.mockResolvedValue({ ok: false, motivo: "sem_destinatario" });
    const r = await executarTool("transferir_humano", { motivo: "pedido" }, ctx);
    expect(r.transferiu).toBeUndefined();
    expect(JSON.parse(r.resultado)).toMatchObject({ ok: false, motivo: "transferencia_nao_confirmada" });
    expect(r.resultado).not.toContain("fixture_privado"); expect(f.aviso).toHaveBeenCalledExactlyOnceWith(ctx.clienteId);
  });
});
