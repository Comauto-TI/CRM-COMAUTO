import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { usuarioApi } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { montarLinkWhatsApp } from "@/lib/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QR code do link. Padrão: aponta para /r/<codigo> (conta escaneamentos).
 * ?direto=1 aponta direto para o wa.me (funciona mesmo se o painel estiver fora, mas não conta o clique).
 * ?formato=png|svg  ?baixar=1 para download.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioApi("links");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;

  const { data: link } = await db().from("links_rastreados").select("codigo, nome, mensagem_inicial").eq("id", id).maybeSingle();
  if (!link) return new NextResponse("not found", { status: 404 });

  const cfg = await getConfig();
  const numero = cfg.empresa.whatsapp_numero ?? "";
  const destino = sp.get("direto") === "1" && numero
    ? montarLinkWhatsApp(numero, link.mensagem_inicial, link.codigo)
    : `${env().APP_URL.replace(/\/$/, "")}/r/${link.codigo}`;

  const nomeArquivo = `qr-${link.nome.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}-${link.codigo}`;
  const disp = sp.get("baixar") === "1" ? "attachment" : "inline";
  const opcoes = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#111111", light: "#ffffff" } };

  if (sp.get("formato") === "png") {
    const png = await QRCode.toBuffer(destino, { ...opcoes, type: "png", width: 1024 });
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `${disp}; filename="${nomeArquivo}.png"`, "Cache-Control": "private, max-age=300" },
    });
  }
  const svg = await QRCode.toString(destino, { ...opcoes, type: "svg" });
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Content-Disposition": `${disp}; filename="${nomeArquivo}.svg"`, "Cache-Control": "private, max-age=300" },
  });
}
