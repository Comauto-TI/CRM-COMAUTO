import { NextResponse, type NextRequest } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { janela24hAberta } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Conversa + ficha do lead (CRM) para a janela de atendimento. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioApi("atendimento");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await ctx.params;

  const { data: conversa } = await db()
    .from("conversas")
    .select("id, status, motivo_transferencia, aguardando_desde, assumida_por, assumida_em, resultado, cliente_id")
    .eq("id", id)
    .maybeSingle();
  if (!conversa) return new NextResponse("not found", { status: 404 });

  const cid = conversa.cliente_id;
  const [cliente, mensagens, veiculos, agendamentos, consentimentos, notas, inscricoes, respostas, optout] = await Promise.all([
    db().from("clientes").select("id, nome, telefone, email, cidade, tags, origem, ultimo_contato_em, criado_em").eq("id", cid).single(),
    db()
      .from("mensagens")
      .select("id, direcao, autor, tipo, conteudo, status, erro, criado_em")
      .eq("conversa_id", id)
      .order("criado_em", { ascending: false })
      .limit(150),
    db().from("veiculos").select("placa, modelo, ano, km_atual, ultima_revisao_em, proxima_revisao_em").eq("cliente_id", cid),
    db()
      .from("agendamentos")
      .select("id, inicio, status, confirmado_por, confirmado_em, confirmado_canal, servicos!agendamentos_servico_id_fkey(nome)")
      .eq("cliente_id", cid)
      .order("inicio", { ascending: false })
      .limit(10),
    db().from("consentimentos").select("tipo, status, concedido_em, revogado_em").eq("cliente_id", cid).order("concedido_em", { ascending: false }),
    db().from("notas_cliente").select("id, autor, texto, criado_em").eq("cliente_id", cid).order("criado_em", { ascending: false }).limit(20),
    db().from("inscricoes_evento").select("status, eventos(nome, inicio)").eq("cliente_id", cid).limit(10),
    db().from("respostas_rapidas").select("id, titulo, texto").eq("ativo", true).order("titulo"),
    db().from("optouts").select("id", { count: "exact", head: true }).eq("cliente_id", cid),
  ]);

  // abriu a conversa => zera não lidas
  await db().from("conversas").update({ nao_lidas: 0 }).eq("id", id);

  return NextResponse.json(
    {
      eu: u.email,
      conversa,
      cliente: cliente.data,
      janelaAberta: janela24hAberta(cliente.data?.ultimo_contato_em),
      optout: (optout.count ?? 0) > 0,
      mensagens: (mensagens.data ?? []).reverse(),
      veiculos: veiculos.data ?? [],
      agendamentos: agendamentos.data ?? [],
      consentimentos: consentimentos.data ?? [],
      notas: notas.data ?? [],
      inscricoes: inscricoes.data ?? [],
      respostasRapidas: respostas.data ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
