/**
 * Regressão dos bugs reais apontados pelo Codex na revisão C7 (docs/apontamentos-codex.txt).
 * C7-003/004/005/006 dependem de banco — cobertos por tests/sql e tests/e2e do Codex;
 * aqui ficam os cenários que dá para provar sem banco.
 */
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { parsearWebhook, timestampSeguro } from "@/lib/whatsapp/webhook";

describe("C7-001 — assinatura malformada não derruba a rota", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: "teste", WHATSAPP_TOKEN: "teste", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_APP_SECRET: "segredo-c7",
      WHATSAPP_VERIFY_TOKEN: "v", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
      SUPABASE_SERVICE_ROLE_KEY: "s", CRON_SECRET: "cron-secret-bem-longo",
    });
  });
  it.each([
    ["z".repeat(64), "64 caracteres não-hex (caso do Codex)"],
    ["a".repeat(63), "63 dígitos"],
    ["a".repeat(65), "65 dígitos"],
    ["", "vazio"],
    ["ÿ".repeat(64), "unicode"],
  ])("sha256=%s → false sem lançar (%s)", async (sig) => {
    const { assinaturaValida } = await import("@/lib/whatsapp/client");
    expect(() => assinaturaValida("{}", `sha256=${sig}`)).not.toThrow();
    expect(assinaturaValida("{}", `sha256=${sig}`)).toBe(false);
  });
  it("assinatura correta continua aceita (inclusive hex maiúsculo)", async () => {
    const { assinaturaValida } = await import("@/lib/whatsapp/client");
    const corpo = '{"entry":[]}';
    const hex = crypto.createHmac("sha256", "segredo-c7").update(corpo).digest("hex");
    expect(assinaturaValida(corpo, `sha256=${hex}`)).toBe(true);
    expect(assinaturaValida(corpo, `sha256=${hex.toUpperCase()}`)).toBe(true);
  });
});

describe("C7-002 — envelope malformado é descartado sem exceção", () => {
  it.each([
    [{ entry: {} }],
    [{ entry: "x" }],
    [{ entry: [{ changes: {} }] }],
    [{ entry: [{ changes: [{ value: { messages: {} , statuses: 5 } }] }] }],
    [{ entry: [null] }],
    [42],
    ["texto"],
  ])("%j → listas vazias", (corpo) => {
    expect(() => parsearWebhook(corpo)).not.toThrow();
    expect(parsearWebhook(corpo)).toEqual({ mensagens: [], status: [] });
  });

  it("descarta mensagem sem id ou sem remetente e mantém as válidas do mesmo lote", () => {
    const r = parsearWebhook({
      entry: [{ changes: [{ value: { messages: [
        { from: "5551999990000", type: "text", text: { body: "sem id" } },
        { id: "wamid.sem-from", type: "text", text: { body: "sem from" } },
        { id: "wamid.ok", from: "5551999990000", timestamp: "1762770000", type: "text", text: { body: "ok" } },
      ] } }] }],
    });
    expect(r.mensagens.map((m) => m.wamid)).toEqual(["wamid.ok"]);
  });

  it("timestamp ausente ou futuro não estende a janela de 24h", () => {
    const agora = Date.parse("2026-11-10T12:00:00Z");
    expect(timestampSeguro(undefined, agora).getTime()).toBe(agora);
    expect(timestampSeguro("abc", agora).getTime()).toBe(agora);
    expect(timestampSeguro(String((agora + 3600_000) / 1000), agora).getTime()).toBe(agora); // 1h no futuro → agora
    expect(timestampSeguro(String((agora - 60_000) / 1000), agora).getTime()).toBe(agora - 60_000);
  });
});
