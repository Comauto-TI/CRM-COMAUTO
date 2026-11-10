import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { montarLinkWhatsApp } from "@/lib/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Link curto PÚBLICO dos QR codes: conta o clique (sem IP/dado pessoal) e redireciona ao WhatsApp
 * com a mensagem pronta. Só aceita código no formato exato — nada de entrada livre no banco.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  const cod = codigo.toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(cod)) return new NextResponse("Link inválido", { status: 404 });

  let destino: string;
  try {
    const [{ data: link }, cfg] = await Promise.all([
      db().from("links_rastreados").select("id, codigo, mensagem_inicial, ativo").eq("codigo", cod).maybeSingle(),
      getConfig(),
    ]);
    const numero = cfg.empresa.whatsapp_numero?.replace(/\D/g, "");
    if (!link || !link.ativo || !numero) return new NextResponse("Este link não está mais ativo.", { status: 404 });
    await db().from("link_cliques").insert({ link_id: link.id });
    destino = montarLinkWhatsApp(numero, link.mensagem_inicial, link.codigo);
  } catch {
    return new NextResponse("Não foi possível abrir o WhatsApp agora. Tente novamente em instantes.", { status: 503 });
  }
  return NextResponse.redirect(destino, {
    status: 302,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
