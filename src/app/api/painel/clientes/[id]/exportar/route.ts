import { NextResponse, type NextRequest } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** LGPD — direito de acesso: exporta todos os dados do titular em JSON. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioApi("clientes");
  if (!u) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await ctx.params;

  const [cliente, veiculos, consentimentos, agendamentos, inscricoes, mensagens] = await Promise.all([
    db().from("clientes").select("nome, telefone, email, cidade, tags, origem, criado_em, ultimo_contato_em").eq("id", id).single(),
    db().from("veiculos").select("placa, modelo, ano, km_atual, ultima_revisao_em, proxima_revisao_em").eq("cliente_id", id),
    db().from("consentimentos").select("tipo, status, texto, origem, concedido_em, revogado_em").eq("cliente_id", id),
    db().from("agendamentos").select("inicio, status, confirmado_em, confirmado_canal, servicos(nome)").eq("cliente_id", id),
    db().from("inscricoes_evento").select("status, confirmado_em, eventos(nome, inicio)").eq("cliente_id", id),
    db().from("mensagens").select("direcao, autor, conteudo, criado_em").eq("cliente_id", id).order("criado_em").limit(5000),
  ]);
  if (!cliente.data) return new NextResponse("not found", { status: 404 });

  await db().from("audit_log").insert({ ator: u.email, acao: "exportar_dados_lgpd", entidade: "cliente", entidade_id: id, dados: {} });
  const corpo = {
    gerado_em: new Date().toISOString(),
    finalidade: "Atendimento ao direito de acesso do titular (LGPD, art. 18)",
    cliente: cliente.data,
    veiculos: veiculos.data,
    consentimentos: consentimentos.data,
    agendamentos: agendamentos.data,
    inscricoes_evento: inscricoes.data,
    mensagens: mensagens.data,
  };
  return new NextResponse(JSON.stringify(corpo, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dados-titular-${id.slice(0, 8)}.json"`, "Cache-Control": "no-store" },
  });
}
