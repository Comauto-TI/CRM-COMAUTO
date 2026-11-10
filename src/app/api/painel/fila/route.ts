import { NextResponse } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { mascararTelefone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Fila de atendimento humano — consultada pelo popup do painel a cada 5 s. */
export async function GET() {
  const u = await usuarioApi(["atendente"]);
  if (!u) return new NextResponse("unauthorized", { status: 401 });

  const { data } = await db()
    .from("conversas")
    .select("id, motivo_transferencia, aguardando_desde, assumida_por, nao_lidas, clientes(nome, telefone)")
    .eq("status", "humano")
    .order("aguardando_desde", { ascending: true })
    .limit(50);

  const itens = ((data ?? []) as unknown as {
    id: string; motivo_transferencia: string | null; aguardando_desde: string | null; assumida_por: string | null; nao_lidas: number;
    clientes: { nome: string | null; telefone: string } | null;
  }[]).map((c) => ({
    id: c.id,
    cliente: c.clientes?.nome ?? "Cliente",
    telefone: mascararTelefone(c.clientes?.telefone ?? ""),
    motivo: c.motivo_transferencia,
    aguardandoDesde: c.aguardando_desde,
    assumidaPor: c.assumida_por,
    naoLidas: c.nao_lidas,
    minha: c.assumida_por === u.email,
  }));

  return NextResponse.json(
    { aguardando: itens.filter((i) => !i.assumidaPor), emAtendimento: itens.filter((i) => i.assumidaPor), eu: u.email },
    { headers: { "Cache-Control": "no-store" } },
  );
}
