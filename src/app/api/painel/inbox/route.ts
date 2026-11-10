import { NextResponse, type NextRequest } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { mascararTelefone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Caixa de entrada estilo WhatsApp: abas Em espera / Em atendimento / Finalizados / Assistente. */
export async function GET(req: NextRequest) {
  const u = await usuarioApi("atendimento");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const aba = req.nextUrl.searchParams.get("aba") ?? "espera";
  const q = (req.nextUrl.searchParams.get("q") ?? "").replace(/[%,()]/g, "").slice(0, 40);

  const contar = (f: (x: ReturnType<typeof base>) => ReturnType<typeof base>) => f(base()).then((r) => r.count ?? 0);
  function base() {
    return db().from("conversas").select("id", { count: "exact", head: true });
  }
  const desdeFinalizados = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [espera, atendimento, minhas, finalizados, bot] = await Promise.all([
    contar((x) => x.eq("status", "humano").is("assumida_por", null)),
    contar((x) => x.eq("status", "humano").not("assumida_por", "is", null)),
    contar((x) => x.eq("status", "humano").eq("assumida_por", u.email)),
    contar((x) => x.eq("status", "encerrada").gte("encerrada_em", desdeFinalizados)),
    contar((x) => x.eq("status", "bot")),
  ]);

  let lista = db()
    .from("conversas")
    .select("id, status, motivo_transferencia, aguardando_desde, assumida_por, ultima_msg_em, nao_lidas, resultado, encerrada_em, clientes!inner(nome, telefone)")
    .limit(80);
  if (aba === "espera") lista = lista.eq("status", "humano").is("assumida_por", null).order("aguardando_desde", { ascending: true });
  else if (aba === "atendimento") lista = lista.eq("status", "humano").not("assumida_por", "is", null).order("ultima_msg_em", { ascending: false });
  else if (aba === "finalizados") lista = lista.eq("status", "encerrada").order("encerrada_em", { ascending: false, nullsFirst: false });
  else lista = lista.eq("status", "bot").order("ultima_msg_em", { ascending: false, nullsFirst: false });
  if (q) lista = lista.or(`nome.ilike.%${q}%,telefone.ilike.%${q.replace(/\D/g, "") || q}%`, { referencedTable: "clientes" });

  const { data } = await lista;
  const convs = (data ?? []) as unknown as {
    id: string; status: string; motivo_transferencia: string | null; aguardando_desde: string | null; assumida_por: string | null;
    ultima_msg_em: string | null; nao_lidas: number; resultado: string | null; encerrada_em: string | null; clientes: { nome: string | null; telefone: string } | null;
  }[];

  // última mensagem de cada conversa (prévia da lista)
  const ids = convs.map((c) => c.id);
  const ultimas = new Map<string, { conteudo: string | null; direcao: string; autor: string; status: string; criado_em: string }>();
  if (ids.length) {
    const { data: msgs } = await db()
      .from("mensagens")
      .select("conversa_id, conteudo, direcao, autor, status, criado_em")
      .in("conversa_id", ids)
      .order("criado_em", { ascending: false })
      .limit(Math.min(ids.length * 6, 600));
    for (const m of msgs ?? []) if (!ultimas.has(m.conversa_id)) ultimas.set(m.conversa_id, m);
  }

  const itens = convs.map((c) => {
    const ult = ultimas.get(c.id);
    return {
      id: c.id,
      cliente: c.clientes?.nome ?? "Cliente",
      telefone: mascararTelefone(c.clientes?.telefone ?? ""),
      status: c.status,
      motivo: c.motivo_transferencia,
      aguardandoDesde: c.aguardando_desde,
      assumidaPor: c.assumida_por,
      naoLidas: c.nao_lidas,
      resultado: c.resultado,
      ultimaMsg: ult?.conteudo ?? null,
      ultimaDirecao: ult?.direcao ?? null,
      ultimoAutor: ult?.autor ?? null,
      ultimoStatus: ult?.status ?? null,
      ultimaEm: ult?.criado_em ?? c.ultima_msg_em,
    };
  });

  return NextResponse.json({ eu: u.email, contagem: { espera, atendimento, minhas, finalizados, bot }, itens }, { headers: { "Cache-Control": "no-store" } });
}
