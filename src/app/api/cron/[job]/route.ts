import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { enviarLembretes, gerarFollowups, enviarFollowupsPendentes } from "@/lib/followups";
import { processarFilaCampanhas } from "@/lib/campaigns";
import { verificarSLA } from "@/lib/handoff";
import { lancarCustosFixosDoMes } from "@/lib/costs";
import { retomarMensagensPendentes } from "@/lib/conversation/handler";
import { processarAgendados } from "@/lib/agendados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const recebido = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${env().CRON_SECRET}`;
  return recebido.length === esperado.length && crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

const JOBS: Record<string, () => Promise<unknown>> = {
  lembretes: async () => ({
    lembretes: await enviarLembretes(),
    sla: await verificarSLA(),
    retomada: await retomarMensagensPendentes(),
    agendados: await processarAgendados(), // F2-4: lembretes dos usuários + mensagens agendadas
  }),
  campanhas: processarFilaCampanhas,
  followups: async () => ({ gerados: await gerarFollowups(), enviados: await enviarFollowupsPendentes() }),
  "custos-fixos": () => lancarCustosFixosDoMes(),
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ job: string }> }) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const { job } = await ctx.params;
  const fn = JOBS[job];
  if (!fn) return new NextResponse("not found", { status: 404 });
  try {
    return NextResponse.json({ ok: true, job, resultado: await fn() });
  } catch (e) {
    console.error(`[cron:${job}]`, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, job }, { status: 500 });
  }
}
