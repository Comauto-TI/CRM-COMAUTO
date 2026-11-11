import { NextResponse } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { mascararTelefone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Fila de atendimento humano — consultada pelo popup do painel a cada 5 s. */
export async function GET() {
  const u = await usuarioApi("atendimento");
  if (!u) return new NextResponse("unauthorized", { status: 401 });

  const { data } = await db()
    .from("conversas_legadas")
    .select("id, motivo_transferencia, aguardando_desde, assumida_por, nao_lidas, cliente_nome, cliente_telefone")
    .eq("status", "humano")
    .order("aguardando_desde", { ascending: true })
    .limit(50);

  const itens = ((data ?? []) as unknown as {
    id: string; motivo_transferencia: string | null; aguardando_desde: string | null; assumida_por: string | null; nao_lidas: number;
    cliente_nome: string | null; cliente_telefone: string;
  }[]).map((c) => ({
    id: c.id,
    cliente: c.cliente_nome ?? "Cliente",
    telefone: mascararTelefone(c.cliente_telefone),
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
