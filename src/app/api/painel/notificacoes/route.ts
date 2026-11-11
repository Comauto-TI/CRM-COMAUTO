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
  const [lista, total, resultadoInsistentes] = await Promise.all([
    listarNotificacoes(u.id, 20),
    contarNaoLidas(u.id),
    (async () => {
      if (!podeAcessar(u, "vendas")) return { insistentes: [], erroInsistentes: false };
      try {
        return { insistentes: await lembretesInsistentes(u, await hoje()), erroInsistentes: false };
      } catch {
        return { insistentes: [], erroInsistentes: true };
      }
    })(),
  ]);
  const naoLidas = lista
    .filter((n) => !n.lida_em)
    .slice(0, 10)
    .map((n) => ({ id: n.id, tipo: n.tipo, titulo: n.titulo, corpo: n.corpo, link: linkInternoSeguro(n.link), criado_em: n.criado_em }));
  return NextResponse.json({ naoLidas, total, ...resultadoInsistentes }, { headers: { "Cache-Control": "no-store" } });
}

/** Marca como lidas (só as do próprio usuário — o filtro por usuario_id está em marcarLidas). */
export async function POST(req: Request) {
  const u = await usuarioApi("notificacoes");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const entrada: unknown = await req.json().catch(() => null);
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const corpo = entrada as { ids?: unknown; contatoAniversario?: unknown; dataAniversario?: unknown };
  // pop-up insistente de aniversário: "Contato feito"
  if (typeof corpo.contatoAniversario === "string") {
    if (!podeAcessar(u, "vendas")) return NextResponse.json({ ok: false }, { status: 403 });
    if (corpo.dataAniversario !== undefined && (typeof corpo.dataAniversario !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(corpo.dataAniversario))) {
      return NextResponse.json({ ok: false, motivo: "Data de aniversário inválida." }, { status: 400 });
    }
    try {
      const r = await marcarContatoAniversario(u, corpo.contatoAniversario, await hoje(), corpo.dataAniversario);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    } catch {
      return NextResponse.json({ ok: false, motivo: "Não foi possível registrar o contato. Tente novamente." }, { status: 503 });
    }
  }
  const ids = Array.isArray(corpo.ids) ? corpo.ids.filter((i): i is string => typeof i === "string" && /^[0-9a-f-]{36}$/i.test(i)).slice(0, 50) : [];
  if (!ids.length) return NextResponse.json({ ok: false }, { status: 400 });
  await marcarLidas(u.id, ids);
  return NextResponse.json({ ok: true });
}
