import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { mascararTelefone } from "@/lib/phone";
import { dentroHorarioEnvio } from "@/lib/time";
import { enviarTemplate } from "@/lib/whatsapp/client";
import { responderLivre } from "@/lib/messaging/outbound";
import { auditar } from "@/lib/audit";
import { tabelaUsuarios } from "@/lib/usuarios";
import { papelValido, supervisiona } from "@/lib/permissoes";

/**
 * ATENDIMENTO HUMANO (regra 9) — fluxo da recepção estilo CRM:
 *  transferir → (cliente avisado) → alerta no WhatsApp das recepcionistas + popup no painel
 *  → alguém ASSUME (trava para as outras) → responde pela janela do painel
 *  → devolve ao bot ou encerra com resultado.
 * Enquanto status = 'humano', a IA NÃO responde aquela conversa.
 */

export type EstadoConversa = "bot" | "humano" | "encerrada";

/** Transições válidas (pura — testável). */
export function transicaoValida(de: EstadoConversa, acao: "transferir" | "assumir" | "devolver" | "encerrar", assumidaPor: string | null, quem?: string): boolean {
  switch (acao) {
    case "transferir":
      return de === "bot" || de === "encerrada";
    case "assumir":
      return de === "humano" && (!assumidaPor || assumidaPor === quem);
    case "devolver":
    case "encerrar":
      return de === "humano";
  }
}

export async function transferirParaHumano(clienteId: string, motivo: string, opts: { avisarCliente?: boolean } = {}) {
  const cfg = await getConfig();
  const { data: conv, error: erroConsulta } = await db()
    .from("conversas_legadas")
    .select("id, status, assumida_por")
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (erroConsulta) return { ok: false as const, motivo: "falha ao consultar a conversa" };
  if (!conv) return { ok: false as const, motivo: "conversa_inexistente" };
  if (conv.status === "humano") return { ok: true as const, jaEstava: true };

  const { data: alteradas, error } = await db()
    .from("conversas")
    .update({
      status: "humano",
      motivo_transferencia: motivo.slice(0, 300),
      aguardando_desde: new Date().toISOString(),
      assumida_por: null,
      assumida_em: null,
      alerta_reenviado_em: null,
      encerrada_em: null,
      resultado: null,
      falhas_entendimento: 0,
    })
    .eq("id", conv.id)
    .eq("status", conv.status)
    .select("id");
  if (error || !alteradas?.length) return { ok: false as const, motivo: "falha ao atualizar a conversa" };

  const noHorario = dentroHorarioEnvio(new Date(), cfg.horario_envio, cfg.fuso_offset);
  if (opts.avisarCliente !== false) {
    await responderLivre({
      clienteId,
      autor: "sistema",
      texto: noHorario ? cfg.atendimento.msg_transferencia : cfg.atendimento.msg_fora_horario,
    });
  }
  await alertarRecepcao(conv.id, clienteId, motivo);
  await auditar("sistema", "transferir_humano", "conversa", conv.id, { motivo });
  return { ok: true as const, jaEstava: false };
}

/** Template de alerta no WhatsApp de cada recepcionista ativa que aceitou receber. */
export async function alertarRecepcao(conversaId: string, clienteId: string, motivo: string) {
  const { data: conversa, error } = await db().from("conversas_legadas")
    .select("id, cliente_nome, cliente_telefone").eq("id", conversaId).eq("cliente_id", clienteId).maybeSingle();
  if (error || !conversa) return { enviados: 0, motivo: "conversa_indisponivel" };
  const { data: equipe } = await db()
    .from(await tabelaUsuarios())
    .select("nome, telefone_whatsapp")
    .eq("ativo", true)
    .eq("recebe_alertas", true)
    .not("telefone_whatsapp", "is", null)
    .not("consentimento_alertas_em", "is", null);
  const { data: tpl } = await db()
    .from("templates")
    .select("nome, idioma, status_aprovacao, ativo")
    .eq("uso", "alerta_recepcao")
    .maybeSingle();
  if (!tpl || tpl.status_aprovacao !== "aprovado" || !tpl.ativo) return { enviados: 0, motivo: "template_alerta_nao_aprovado" };

  const link = `${env().APP_URL}/painel/conversas?aba=espera&c=${conversaId}`;
  let enviados = 0;
  for (const pessoa of equipe ?? []) {
    const r = await enviarTemplate(pessoa.telefone_whatsapp!, tpl.nome, tpl.idioma, [
      { texto: conversa.cliente_nome || "Cliente" },
      { texto: mascararTelefone(conversa.cliente_telefone) },
      { texto: motivo.slice(0, 120) },
      { texto: link },
    ]);
    // registra como mensagem interna (sem cliente) para entrar no financeiro
    await db().from("mensagens").insert({
      conversa_id: conversaId,
      cliente_id: null,
      direcao: "saida",
      autor: "sistema",
      tipo: "template",
      conteudo: `Alerta para recepção (${pessoa.nome})`,
      wamid: r.ok ? r.wamid : null,
      template_nome: tpl.nome,
      categoria_cobranca: "UTILITY",
      status: r.ok ? "enviada" : "falhou",
      erro: r.ok ? null : r.erro,
      metadata: { interno: true, destinatario: pessoa.nome },
    });
    if (r.ok) enviados++;
  }
  return { enviados };
}

export async function assumirConversa(conversaId: string, email: string) {
  const { data: legada, error: erroConsulta } = await db().from("conversas_legadas").select("id").eq("id", conversaId).maybeSingle();
  if (erroConsulta || !legada) return { ok: false as const, motivo: "conversa indisponível no atendimento geral" };
  // Atualização condicional: só assume se ninguém assumiu ainda (evita duas pessoas respondendo)
  const { data, error } = await db()
    .from("conversas")
    .update({ assumida_por: email, assumida_em: new Date().toISOString(), nao_lidas: 0 })
    .eq("id", conversaId)
    .eq("status", "humano")
    .is("assumida_por", null)
    .select("id");
  if (error) return { ok: false as const, motivo: "falha ao atualizar a conversa" };
  if (data?.length) {
    await auditar(email, "assumir", "conversa", conversaId);
    return { ok: true as const };
  }
  const { data: atual, error: erroAtual } = await db().from("conversas_legadas").select("assumida_por, status").eq("id", conversaId).maybeSingle();
  if (erroAtual || !atual) return { ok: false as const, motivo: "conversa indisponível no atendimento geral" };
  if (atual?.assumida_por === email) return { ok: true as const };
  return { ok: false as const, motivo: atual?.assumida_por ? `em atendimento com ${atual.assumida_por}` : `status ${atual?.status}` };
}

/**
 * C7-006: a trava de posse é conferida NA PRÓPRIA atualização (não só na interface).
 * Atendente: só mexe na conversa livre ou assumida por ele. Admin e gerente: podem intervir (supervisores).
 * Zero linhas afetadas = conflito de posse; auditoria só registra o que de fato mudou.
 */
type Quem = { email: string; papel: string };
export type ResultadoPosse = { ok: true } | { ok: false; motivo: string };

async function mudarComPosse(conversaId: string, quem: Quem, patch: Record<string, unknown>, acao: string, dados: Record<string, unknown> = {}): Promise<ResultadoPosse> {
  const { data: legada, error: erroConsulta } = await db().from("conversas_legadas").select("id").eq("id", conversaId).maybeSingle();
  if (erroConsulta || !legada) return { ok: false, motivo: "conversa indisponível no atendimento geral" };
  let q = db().from("conversas").update(patch).eq("id", conversaId).eq("status", "humano");
  if (!(papelValido(quem.papel) && supervisiona({ papel: quem.papel }))) q = q.or(`assumida_por.is.null,assumida_por.eq."${quem.email.replace(/"/g, "")}"`);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, motivo: "falha ao atualizar a conversa" };
  if (!data?.length) {
    const { data: atual, error: erroAtual } = await db().from("conversas_legadas").select("status, assumida_por").eq("id", conversaId).maybeSingle();
    if (erroAtual) return { ok: false, motivo: "falha ao consultar a conversa" };
    if (!atual) return { ok: false, motivo: "conversa não encontrada" };
    if (atual.status !== "humano") return { ok: false, motivo: "a conversa não está mais em atendimento humano" };
    return { ok: false, motivo: `em atendimento com ${atual.assumida_por}` };
  }
  await auditar(quem.email, acao, "conversa", conversaId, { ...dados, papel: quem.papel });
  return { ok: true };
}

export function devolverAoBot(conversaId: string, quem: Quem) {
  return mudarComPosse(conversaId, quem, { status: "bot", assumida_por: null, aguardando_desde: null, falhas_entendimento: 0 }, "devolver_bot");
}

export function encerrarConversa(conversaId: string, quem: Quem, resultado: string) {
  return mudarComPosse(
    conversaId,
    quem,
    { status: "encerrada", encerrada_em: new Date().toISOString(), resultado, aguardando_desde: null },
    "encerrar",
    { resultado },
  );
}

/** Cron: conversas na fila sem ninguém assumir além do SLA → reenvio ÚNICO do alerta + aviso ao cliente. */
export async function verificarSLA() {
  const cfg = await getConfig();
  const limite = new Date(Date.now() - cfg.atendimento.sla_min * 60_000).toISOString();
  const { data } = await db()
    .from("conversas_legadas")
    .select("id, cliente_id, motivo_transferencia")
    .eq("status", "humano")
    .is("assumida_por", null)
    .is("alerta_reenviado_em", null)
    .lte("aguardando_desde", limite);
  let reenviados = 0;
  for (const c of data ?? []) {
    const { data: legada, error: erroConsulta } = await db().from("conversas_legadas").select("id").eq("id", c.id).maybeSingle();
    if (erroConsulta || !legada) continue;
    const { data: atualizadas, error } = await db().from("conversas").update({ alerta_reenviado_em: new Date().toISOString() })
      .eq("id", c.id).eq("status", "humano").is("assumida_por", null).is("alerta_reenviado_em", null).select("id");
    if (error || !atualizadas?.length) continue;
    const { data: aindaLegada, error: erroEscopo } = await db().from("conversas_legadas").select("id").eq("id", c.id).maybeSingle();
    if (erroEscopo || !aindaLegada) continue;
    if (dentroHorarioEnvio(new Date(), cfg.horario_envio, cfg.fuso_offset)) {
      await responderLivre({ clienteId: c.cliente_id, autor: "sistema", texto: cfg.atendimento.msg_sla });
    }
    await alertarRecepcao(c.id, c.cliente_id, `(SLA estourado) ${c.motivo_transferencia ?? ""}`);
    reenviados++;
  }
  return { reenviados };
}
