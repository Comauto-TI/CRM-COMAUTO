import "server-only";
import crypto from "node:crypto";
import { env } from "@/lib/env";

/**
 * Cliente da WhatsApp Cloud API OFICIAL (Meta). Nada de ferramenta não oficial.
 * Este módulo só fala com a Graph API — as regras de negócio (consentimento,
 * janela 24h, template aprovado, opt-out) ficam em messaging/outbound.ts.
 */

export type BotaoResposta = { id: string; titulo: string };

export type ParametroTemplate = { texto: string };
export type BotaoTemplate = { indice: number; payload: string };

export type ResultadoEnvio = { ok: true; wamid: string } | { ok: false; erro: string; codigo?: number };

async function post(payload: Record<string, unknown>): Promise<ResultadoEnvio> {
  const e = env();
  const url = `https://graph.facebook.com/${e.META_GRAPH_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !json.messages?.[0]?.id) {
      return { ok: false, erro: json.error?.message ?? `HTTP ${res.status}`, codigo: json.error?.code };
    }
    return { ok: true, wamid: json.messages[0].id };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "falha de rede" };
  }
}

/** Texto livre — SÓ permitido com a janela de 24h aberta. */
export function enviarTexto(para: string, texto: string) {
  return post({ to: para, type: "text", text: { body: texto.slice(0, 4096), preview_url: false } });
}

/** Botões de resposta rápida (máx. 3, título até 20 caracteres) — também exige janela aberta. */
export function enviarBotoes(para: string, texto: string, botoes: BotaoResposta[]) {
  return post({
    to: para,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto.slice(0, 1024) },
      action: {
        buttons: botoes.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.titulo.slice(0, 20) } })),
      },
    },
  });
}

/** Template aprovado — único jeito de iniciar conversa ou falar fora da janela de 24h. */
export function enviarTemplate(
  para: string,
  nome: string,
  idioma: string,
  parametros: ParametroTemplate[],
  botoes: BotaoTemplate[] = [],
) {
  const components: Record<string, unknown>[] = [];
  if (parametros.length) {
    components.push({ type: "body", parameters: parametros.map((p) => ({ type: "text", text: p.texto.slice(0, 1024) })) });
  }
  for (const b of botoes) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(b.indice),
      parameters: [{ type: "payload", payload: b.payload }],
    });
  }
  return post({ to: para, type: "template", template: { name: nome, language: { code: idioma }, components } });
}

/** Marca como lida (os dois tiques azuis). */
export async function marcarComoLida(wamid: string) {
  await post({ status: "read", message_id: wamid }).catch(() => undefined);
}

/** Valida X-Hub-Signature-256 — rejeita qualquer chamada que não venha da Meta. */
export function assinaturaValida(corpoBruto: string, cabecalho: string | null): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const recebido = cabecalho.slice(7);
  // C7-001: só aceita exatamente 64 dígitos hexadecimais — senão Buffer.from(hex) gera tamanho
  // diferente e timingSafeEqual lança erro (500 em vez de 401).
  if (!/^[0-9a-f]{64}$/i.test(recebido)) return false;
  const esperado = crypto.createHmac("sha256", env().WHATSAPP_APP_SECRET).update(corpoBruto, "utf8").digest();
  return crypto.timingSafeEqual(Buffer.from(recebido, "hex"), esperado);
}
