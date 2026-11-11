"use server";

import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { auditar } from "@/lib/audit";
import { assumirConversa, devolverAoBot, encerrarConversa } from "@/lib/handoff";
import { responderLivre, notificar } from "@/lib/messaging/outbound";
import { filtrarSaida } from "@/lib/security/guard";
import { valoresSecretos } from "@/lib/env";

type R = { ok: boolean; erro?: string };

export async function assumir(conversaId: string): Promise<R> {
  const u = await exigirAcesso("atendimento");
  const r = await assumirConversa(conversaId, u.email);
  revalidatePath("/painel/conversas");
  return r.ok ? { ok: true } : { ok: false, erro: r.motivo };
}

/** Puxa uma conversa que está com o bot direto para o atendimento humano. */
export async function puxarParaHumano(conversaId: string): Promise<R> {
  const u = await exigirAcesso("atendimento");
  const { data: legada, error: erroConsulta } = await db().from("conversas_legadas")
    .select("id").eq("id", conversaId).maybeSingle();
  if (erroConsulta || !legada) return { ok: false, erro: "Conversa indisponível no atendimento geral." };
  const { data, error } = await db()
    .from("conversas")
    .update({ status: "humano", aguardando_desde: new Date().toISOString(), assumida_por: u.email, assumida_em: new Date().toISOString(), motivo_transferencia: "assumida manualmente pela recepção" })
    .eq("id", conversaId)
    .neq("status", "humano")
    .select("id");
  if (error || !data?.length) return { ok: false, erro: "Não foi possível assumir a conversa." };
  await auditar(u.email, "puxar_humano", "conversa", conversaId);
  revalidatePath("/painel/conversas");
  return { ok: true };
}

export async function responder(conversaId: string, texto: string): Promise<R> {
  const u = await exigirAcesso("atendimento");
  const limpo = texto.trim().slice(0, 4000);
  if (!limpo) return { ok: false, erro: "Mensagem vazia." };

  const { data: conv, error } = await db().from("conversas_legadas").select("cliente_id, status, assumida_por").eq("id", conversaId).maybeSingle();
  if (error || !conv) return { ok: false, erro: "Conversa indisponível no atendimento geral." };
  if (conv.status !== "humano") return { ok: false, erro: "Assuma a conversa antes de responder." };
  if (conv.assumida_por && conv.assumida_por !== u.email) return { ok: false, erro: "Em atendimento com outra pessoa." };
  if (!conv.assumida_por) {
    const a = await assumirConversa(conversaId, u.email);
    if (!a.ok) return { ok: false, erro: a.motivo };
  }
  // A recepção também não pode colar chave/token por engano
  const f = filtrarSaida(limpo, valoresSecretos());
  if (!f.ok && ["segredo_literal", "chave_anthropic", "token_meta", "jwt", "chave_privada", "nome_variavel"].includes(f.motivo)) {
    return { ok: false, erro: "A mensagem parece conter uma chave ou token. Envio bloqueado." };
  }
  const r = await responderLivre({ clienteId: conv.cliente_id, texto: limpo, autor: "atendente", metadata: { atendente: u.email } });
  if (!r.ok) {
    return {
      ok: false,
      erro: r.motivo === "janela_24h_fechada" ? "Janela de 24h fechada: use 'Enviar template de retomada'." : `Falha no envio: ${r.motivo}`,
    };
  }
  return { ok: true };
}

export async function enviarRetomada(conversaId: string): Promise<R> {
  const u = await exigirAcesso("atendimento");
  const cfg = await getConfig();
  const { data: conv, error } = await db().from("conversas_legadas").select("cliente_id, cliente_nome").eq("id", conversaId).maybeSingle();
  if (error || !conv) return { ok: false, erro: "Conversa indisponível no atendimento geral." };
  const nome = (conv.cliente_nome ?? "cliente").split(" ")[0];
  const r = await notificar({ clienteId: conv.cliente_id, uso: "retomada_atendimento", valores: [nome, cfg.empresa.nome], preferirLivre: false });
  await auditar(u.email, "enviar_retomada", "conversa", conversaId, { resultado: r.ok ? "ok" : r.motivo });
  return r.ok ? { ok: true } : { ok: false, erro: `Não enviado: ${r.motivo}` };
}

const RESULTADOS = ["agendou", "resolvido", "sem_retorno", "reclamacao", "outro"];

export async function devolver(conversaId: string): Promise<R> {
  const u = await exigirAcesso("atendimento");
  const r = await devolverAoBot(conversaId, { email: u.email, papel: u.papel });
  revalidatePath("/painel/conversas");
  return r.ok ? { ok: true } : { ok: false, erro: r.motivo };
}

export async function encerrar(conversaId: string, resultado: string): Promise<R> {
  const u = await exigirAcesso("atendimento");
  const r = await encerrarConversa(conversaId, { email: u.email, papel: u.papel }, RESULTADOS.includes(resultado) ? resultado : "resolvido");
  revalidatePath("/painel/conversas");
  return r.ok ? { ok: true } : { ok: false, erro: r.motivo };
}

export async function adicionarNota(clienteId: string, texto: string): Promise<R> {
  const u = await exigirAcesso("atendimento");
  const t = texto.trim().slice(0, 2000);
  if (!t) return { ok: false, erro: "Nota vazia." };
  await db().from("notas_cliente").insert({ cliente_id: clienteId, autor: u.nome || u.email, texto: t });
  return { ok: true };
}

export async function adicionarTag(clienteId: string, tag: string): Promise<R> {
  await exigirAcesso("atendimento");
  const t = tag.trim().toLowerCase().slice(0, 30);
  if (!t) return { ok: false };
  const { data } = await db().from("clientes").select("tags").eq("id", clienteId).single();
  const tags = Array.from(new Set([...(data?.tags ?? []), t]));
  await db().from("clientes").update({ tags }).eq("id", clienteId);
  return { ok: true };
}
