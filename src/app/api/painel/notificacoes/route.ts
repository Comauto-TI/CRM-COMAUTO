import { NextResponse } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { listarNotificacoes, marcarLidas, contarNaoLidas, linkInternoSeguro } from "@/lib/notificacoes";

export const dynamic = "force-dynamic";

/** Notificações NÃO lidas do próprio usuário — consultadas pelo pop-up do painel. */
export async function GET() {
  const u = await usuarioApi("notificacoes");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const [lista, total] = await Promise.all([listarNotificacoes(u.id, 20), contarNaoLidas(u.id)]);
  const naoLidas = lista
    .filter((n) => !n.lida_em)
    .slice(0, 10)
    .map((n) => ({ id: n.id, tipo: n.tipo, titulo: n.titulo, corpo: n.corpo, link: linkInternoSeguro(n.link), criado_em: n.criado_em }));
  return NextResponse.json({ naoLidas, total }, { headers: { "Cache-Control": "no-store" } });
}

/** Marca como lidas (só as do próprio usuário — o filtro por usuario_id está em marcarLidas). */
export async function POST(req: Request) {
  const u = await usuarioApi("notificacoes");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const corpo = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(corpo.ids) ? corpo.ids.filter((i): i is string => typeof i === "string" && /^[0-9a-f-]{36}$/i.test(i)).slice(0, 50) : [];
  if (!ids.length) return NextResponse.json({ ok: false }, { status: 400 });
  await marcarLidas(u.id, ids);
  return NextResponse.json({ ok: true });
}
