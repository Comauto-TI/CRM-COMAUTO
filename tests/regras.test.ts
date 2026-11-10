import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { decidirEnvio, preencherCorpo, type EntradaDecisao } from "@/lib/messaging/regras";
import { calcularCustoClaudeUSD } from "@/lib/costs";
import { parsearWebhook } from "@/lib/whatsapp/webhook";
import { janela24hAberta, dentroHorarioEnvio, formatarDataHora } from "@/lib/time";
import { normalizarTelefone, mascararTelefone } from "@/lib/phone";
import { transicaoValida } from "@/lib/handoff";

const base = (o: Partial<EntradaDecisao> = {}): EntradaDecisao => ({
  clienteAnonimizado: false,
  optout: false,
  template: { aprovado: true, ativo: true, finalidade: "servico", categoria: "UTILITY" },
  consentimentos: ["servico"],
  janelaAberta: false,
  dentroHorario: true,
  preferirLivre: true,
  ...o,
});

describe("decidirEnvio — regras Meta/LGPD", () => {
  it("opt-out bloqueia tudo, mesmo com consentimento", () => {
    expect(decidirEnvio(base({ optout: true }))).toEqual({ acao: "bloquear", motivo: "optout" });
  });
  it("sem consentimento do tipo certo bloqueia", () => {
    const r = decidirEnvio(base({ template: { aprovado: true, ativo: true, finalidade: "marketing", categoria: "MARKETING" }, consentimentos: ["servico"] }));
    expect(r).toEqual({ acao: "bloquear", motivo: "sem_consentimento_marketing" });
  });
  it("consentimento de serviço NÃO libera eventos", () => {
    const r = decidirEnvio(base({ template: { aprovado: true, ativo: true, finalidade: "eventos", categoria: "MARKETING" } }));
    expect(r.acao).toBe("bloquear");
  });
  it("marketing fora do horário bloqueia", () => {
    const r = decidirEnvio(base({ template: { aprovado: true, ativo: true, finalidade: "marketing", categoria: "MARKETING" }, consentimentos: ["marketing"], dentroHorario: false }));
    expect(r).toEqual({ acao: "bloquear", motivo: "fora_horario" });
  });
  it("janela aberta + operacional => texto livre (não gasta template)", () => {
    expect(decidirEnvio(base({ janelaAberta: true }))).toEqual({ acao: "livre" });
  });
  it("janela fechada => template aprovado", () => {
    expect(decidirEnvio(base())).toEqual({ acao: "template" });
  });
  it("template não aprovado nunca é enviado", () => {
    const r = decidirEnvio(base({ template: { aprovado: false, ativo: true, finalidade: "servico", categoria: "UTILITY" } }));
    expect(r).toEqual({ acao: "bloquear", motivo: "template_nao_aprovado" });
  });
  it("marketing com janela aberta continua exigindo template", () => {
    const r = decidirEnvio(base({ template: { aprovado: true, ativo: true, finalidade: "marketing", categoria: "MARKETING" }, consentimentos: ["marketing"], janelaAberta: true }));
    expect(r).toEqual({ acao: "template" });
  });
  it("cliente anonimizado (LGPD) bloqueia", () => {
    expect(decidirEnvio(base({ clienteAnonimizado: true })).acao).toBe("bloquear");
  });
  it("preenche variáveis do corpo", () => {
    expect(preencherCorpo("Olá, {{1}}! Seu {{2}}.", ["Ana", "horário"])).toBe("Olá, Ana! Seu horário.");
  });
});

describe("custo do Claude Haiku — bate com o PDF", () => {
  it("1.500 cache + 80 entrada + 120 saída ≈ US$ 0,000083", () => {
    const usd = calcularCustoClaudeUSD(
      { input_tokens: 80, output_tokens: 120, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 },
      { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
    );
    expect(usd).toBeCloseTo(0.000083, 6);
    // R$ 0,00045 por interação. O PDF diz R$ 0,0008, mas a conta do próprio PDF dá 0,000083 × 5,40 = 0,00045 (erro de arredondamento lá).
    expect(usd * 5.4).toBeCloseTo(0.000448, 5);
  });
});

describe("webhook da Meta", () => {
  it("parseia texto, botão e status com pricing", () => {
    const r = parsearWebhook({
      entry: [{
        changes: [{
          value: {
            contacts: [{ wa_id: "5551999998888", profile: { name: "Maria" } }],
            messages: [
              { from: "5551999998888", id: "wamid.1", timestamp: "1762770000", type: "text", text: { body: "quero agendar" } },
              { from: "5551999998888", id: "wamid.2", timestamp: "1762770001", type: "button", button: { text: "Confirmar", payload: "AG_CONF:abc" } },
              { from: "5551999998888", id: "wamid.3", timestamp: "1762770002", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "OPT_SAIR", title: "Parar mensagens" } } },
            ],
            statuses: [{ id: "wamid.9", status: "delivered", timestamp: "1762770003", recipient_id: "5551999998888", pricing: { billable: true, category: "utility", pricing_model: "PMP" } }],
          },
        }],
      }],
    });
    expect(r.mensagens).toHaveLength(3);
    expect(r.mensagens[0]).toMatchObject({ texto: "quero agendar", nomePerfil: "Maria" });
    expect(r.mensagens[1].payloadBotao).toBe("AG_CONF:abc");
    expect(r.mensagens[2].payloadBotao).toBe("OPT_SAIR");
    expect(r.status[0]).toMatchObject({ status: "delivered", cobravel: true, categoria: "utility" });
  });
  it("payload malformado não quebra", () => {
    expect(parsearWebhook({ lixo: true })).toEqual({ mensagens: [], status: [] });
    expect(parsearWebhook(null)).toEqual({ mensagens: [], status: [] });
  });
});

describe("assinatura HMAC do webhook", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: "teste", WHATSAPP_TOKEN: "teste", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_APP_SECRET: "segredo-de-teste-123",
      WHATSAPP_VERIFY_TOKEN: "v", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
      SUPABASE_SERVICE_ROLE_KEY: "s", CRON_SECRET: "cron-secret-bem-longo",
    });
  });
  it("aceita assinatura correta e rejeita adulterada", async () => {
    const { assinaturaValida } = await import("@/lib/whatsapp/client");
    const corpo = '{"entry":[]}';
    const sig = "sha256=" + crypto.createHmac("sha256", "segredo-de-teste-123").update(corpo).digest("hex");
    expect(assinaturaValida(corpo, sig)).toBe(true);
    expect(assinaturaValida(corpo + " ", sig)).toBe(false);
    expect(assinaturaValida(corpo, null)).toBe(false);
    expect(assinaturaValida(corpo, "sha256=abc")).toBe(false);
  });
});

describe("tempo e telefone", () => {
  it("janela de 24h", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    expect(janela24hAberta(new Date("2026-11-10T00:00:00Z"), agora)).toBe(true);
    expect(janela24hAberta(new Date("2026-11-09T11:55:00Z"), agora)).toBe(false);
    expect(janela24hAberta(null, agora)).toBe(false);
  });
  it("horário comercial de envio (local -03:00)", () => {
    const cfg = { inicio: "08:00", fim: "20:00", dias: [1, 2, 3, 4, 5, 6] };
    expect(dentroHorarioEnvio(new Date("2026-11-10T12:00:00-03:00"), cfg, "-03:00")).toBe(true);
    expect(dentroHorarioEnvio(new Date("2026-11-10T21:00:00-03:00"), cfg, "-03:00")).toBe(false);
    expect(dentroHorarioEnvio(new Date("2026-11-15T12:00:00-03:00"), cfg, "-03:00")).toBe(false); // domingo
  });
  it("formata data local", () => {
    expect(formatarDataHora("2026-11-10T17:30:00Z", "-03:00")).toBe("terça, 10/11 às 14:30");
  });
  it("normaliza e mascara telefone", () => {
    expect(normalizarTelefone("(51) 99999-8888")).toBe("5551999998888");
    expect(normalizarTelefone("+55 51 99999-8888")).toBe("5551999998888");
    expect(normalizarTelefone("123")).toBeNull();
    expect(mascararTelefone("5551999998888")).toBe("5551*****8888");
  });
});

describe("handoff — transições", () => {
  it("só assume quem está na fila e ninguém pegou", () => {
    expect(transicaoValida("humano", "assumir", null, "ana@x")).toBe(true);
    expect(transicaoValida("humano", "assumir", "bia@x", "ana@x")).toBe(false);
    expect(transicaoValida("bot", "assumir", null, "ana@x")).toBe(false);
    expect(transicaoValida("bot", "transferir", null)).toBe(true);
    expect(transicaoValida("humano", "transferir", null)).toBe(false);
    expect(transicaoValida("humano", "devolver", "ana@x")).toBe(true);
  });
});

import { variantesTelefone } from "@/lib/phone";
describe("telefone — mesmo celular com e sem o 9º dígito", () => {
  it("com 9 gera a forma sem 9 e vice-versa", () => {
    expect(variantesTelefone("5551999998888")).toEqual(["5551999998888", "555199998888"]);
    expect(variantesTelefone("555199998888")).toEqual(["555199998888", "5551999998888"]);
  });
  it("fixo e números fora do padrão não ganham variante", () => {
    expect(variantesTelefone("555133334444")).toEqual(["555133334444"]);
    expect(variantesTelefone("14155550100")).toEqual(["14155550100"]);
    expect(variantesTelefone("")).toEqual([]);
  });
});
