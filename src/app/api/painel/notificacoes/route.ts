import { NextResponse } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { listarNotificacoes, marcarLidas, contarNaoLidas, linkInternoSeguro } from "@/lib/notificacoes";
import { getConfig } from "@/lib/config";
import { dataLocalISO } from "@/lib/time";
import { podeAcessar } from "@/lib/permissoes";
import { lembretesInsistentes, marcarContatoAniversario } from "@/modulos/vendas/aniversarios-dados";

async function hoje() {
  const cfg = await getConfig();
  return dataLocalISO(new Date(), cfg.fuso_offset);
}

export const dynamic = "force-dynamic";

/** Notificações NÃO lidas do próprio usuário — consultadas pelo pop-up do painel. */
export async function GET() {
  const u = await usuarioApi("notificacoes");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const [lista, total, insistentes] = await Promise.all([
    listarNotificacoes(u.id, 20),
    contarNaoLidas(u.id),
    podeAcessar(u, "vendas") ? lembretesInsistentes(u, await hoje()) : Promise.resolve([]),
  ]);
  const naoLidas = lista
    .filter((n) => !n.lida_em)
    .slice(0, 10)
    .map((n) => ({ id: n.id, tipo: n.tipo, titulo: n.titulo, corpo: n.corpo, link: linkInternoSeguro(n.link), criado_em: n.criado_em }));
  return NextResponse.json({ naoLidas, total, insistentes }, { headers: { "Cache-Control": "no-store" } });
}

/** Marca como lidas (só as do próprio usuário — o filtro por usuario_id está em marcarLidas). */
export async function POST(req: Request) {
  const u = await usuarioApi("notificacoes");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const corpo = (await req.json().catch(() => ({}))) as { ids?: unknown; contatoAniversario?: unknown };
  // pop-up insistente de aniversário: "Contato feito"
  if (typeof corpo.contatoAniversario === "string") {
    if (!podeAcessar(u, "vendas")) return NextResponse.json({ ok: false }, { status: 403 });
    const r = await marcarContatoAniversario(u, corpo.contatoAniversario, await hoje());
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  const ids = Array.isArray(corpo.ids) ? corpo.ids.filter((i): i is string => typeof i === "string" && /^[0-9a-f-]{36}$/i.test(i)).slice(0, 50) : [];
  if (!ids.length) return NextResponse.json({ ok: false }, { status: 400 });
  await marcarLidas(u.id, ids);
  return NextResponse.json({ ok: true });
}
