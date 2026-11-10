import { NextResponse, type NextRequest } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { localParaUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // evita injeção de fórmula ao abrir no Excel
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
};

export async function GET(req: NextRequest) {
  const u = await usuarioApi("financeiro");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const cfg = await getConfig();
  const mes = req.nextUrl.searchParams.get("mes") ?? "";
  if (!/^\d{4}-\d{2}$/.test(mes)) return new NextResponse("mes inválido", { status: 400 });
  const [ano, m] = mes.split("-").map(Number);
  const prox = m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;

  const { data } = await db()
    .from("custos")
    .select("ocorrido_em, categoria, descricao, quantidade, valor_unitario_brl, valor_brl, valor_usd, cambio, campanha_id, agendamento_id")
    .gte("ocorrido_em", localParaUtc(`${mes}-01`, "00:00", cfg.fuso_offset).toISOString())
    .lt("ocorrido_em", localParaUtc(`${prox}-01`, "00:00", cfg.fuso_offset).toISOString())
    .order("ocorrido_em")
    .limit(200000);

  const cab = ["data", "categoria", "descricao", "quantidade", "valor_unitario_brl", "valor_brl", "valor_usd", "cambio", "campanha_id", "agendamento_id"];
  const linhas = (data ?? []).map((r) => cab.map((k) => esc((r as Record<string, unknown>)[k === "data" ? "ocorrido_em" : k])).join(";"));
  const csv = "﻿" + [cab.join(";"), ...linhas].join("\n");
  await db().from("audit_log").insert({ ator: u.email, acao: "exportar_csv_financeiro", entidade: "custos", entidade_id: mes, dados: {} });
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="custos-${mes}.csv"`, "Cache-Control": "no-store" },
  });
}
