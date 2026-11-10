import { describe, expect, it, vi } from "vitest";
import { assinaturaValida } from "@/lib/whatsapp/client";
import { parsearWebhook } from "@/lib/whatsapp/webhook";
import { transicaoValida } from "@/lib/handoff";
import { janela24hAberta } from "@/lib/time";
import { assinarPayload, montarPayload } from "../scripts/simular-webhook";

vi.mock("@/lib/env", () => ({ env: () => ({ WHATSAPP_APP_SECRET: "fixture-unitaria-sem-credencial-real" }) }));

const telefone = "5551999990000";
const dados = { wabaId: "0", phoneNumberId: "0", wamid: "wamid.fixture", timestamp: 1_794_312_000 };

describe("contrato do simulador e webhook", () => {
  it("preserva texto Unicode e a assinatura do corpo serializado", () => {
    const payload = montarPayload({ tipo: "texto", telefone, texto: "Quero uma revisão 🔧" }, dados);
    const corpo = JSON.stringify(payload);
    const assinatura = assinarPayload(corpo, "fixture-unitaria-sem-credencial-real");
    expect(assinaturaValida(corpo, assinatura)).toBe(true);
    expect(assinaturaValida(corpo.replace("revisão", "troca"), assinatura)).toBe(false);
    expect(parsearWebhook(payload).mensagens).toMatchObject([{
      wamid: dados.wamid,
      de: telefone,
      texto: "Quero uma revisão 🔧",
      timestamp: new Date(dados.timestamp * 1000),
    }]);
  });

  it.each(["botao-template", "botao-interativo"] as const)("preserva identificador de %s", (tipo) => {
    const payload = montarPayload({ tipo, telefone, payload: "AG_CONF:fixture", titulo: "Confirmar" }, dados);
    expect(parsearWebhook(payload).mensagens).toMatchObject([{ texto: "Confirmar", payloadBotao: "AG_CONF:fixture" }]);
  });

  it.each(["delivered", "read", "failed"] as const)("distingue status %s e cobrança", (status) => {
    const payload = montarPayload({ tipo: "status", telefone, wamid: dados.wamid, status, categoria: "utility" }, dados);
    expect(parsearWebhook(payload).status).toMatchObject([{
      wamid: dados.wamid,
      para: telefone,
      status,
      cobravel: status === "delivered",
      categoria: "utility",
      modeloPreco: "PMP",
      erro: status === "failed" ? "131026 Message undeliverable" : null,
    }]);
  });
});

describe("limites da janela de atendimento", () => {
  const agora = new Date("2026-11-10T12:00:00Z");

  it("fecha quando começa a margem de dez minutos", () => {
    expect(janela24hAberta("2026-11-09T12:10:00.001Z", agora)).toBe(true);
    expect(janela24hAberta("2026-11-09T12:10:00.000Z", agora)).toBe(false);
    expect(janela24hAberta("inválido", agora)).toBe(false);
  });
});

describe("transições adicionais da fila", () => {
  it("permite reabrir conversa encerrada para atendimento humano", () => {
    expect(transicaoValida("encerrada", "transferir", null)).toBe(true);
  });

  it("permite a mesma pessoa assumir novamente a própria conversa", () => {
    expect(transicaoValida("humano", "assumir", "recepcao@example.test", "recepcao@example.test")).toBe(true);
  });

  it("só permite encerrar a partir de atendimento humano", () => {
    expect(transicaoValida("humano", "encerrar", null)).toBe(true);
    expect(transicaoValida("bot", "encerrar", null)).toBe(false);
    expect(transicaoValida("encerrada", "encerrar", null)).toBe(false);
  });
});

