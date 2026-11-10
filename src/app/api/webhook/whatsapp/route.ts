import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { assinaturaValida } from "@/lib/whatsapp/client";
import { parsearWebhook } from "@/lib/whatsapp/webhook";
import { processarMensagem, processarStatus } from "@/lib/conversation/handler";
import { registrarEventoSeguranca } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verificação do webhook pela Meta (configuração no painel de desenvolvedores). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env().WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Eventos da Meta: responde 200 na hora e processa depois (after) — a Meta reenvia se demorar. */
export async function POST(req: NextRequest) {
  const bruto = await req.text();
  if (!assinaturaValida(bruto, req.headers.get("x-hub-signature-256"))) {
    after(() =>
      registrarEventoSeguranca({ telefone: null, clienteId: null, tipo: "assinatura_invalida", trecho: req.headers.get("x-forwarded-for"), acao: "bloqueado" }).catch(() => undefined),
    );
    return new NextResponse("invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(bruto);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  const { mensagens, status } = parsearWebhook(body);
  after(async () => {
    for (const s of status) {
      await processarStatus(s).catch((e) => console.error("[webhook] status", e instanceof Error ? e.message : e));
    }
    for (const m of mensagens) {
      await processarMensagem(m).catch((e) => console.error("[webhook] mensagem", e instanceof Error ? e.message : e));
    }
  });
  return NextResponse.json({ ok: true });
}
