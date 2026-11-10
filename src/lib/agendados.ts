import "server-only";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { auditar } from "@/lib/audit";
import { notificar as notificarUsuario } from "@/lib/notificacoes";
import { estaOptout, responderLivre, notificar as notificarCliente } from "@/lib/messaging/outbound";
import { janela24hAberta } from "@/lib/time";
import { nucleoAplicado } from "@/lib/usuarios";
import type { Usuario } from "@/lib/auth";
import { validarHorario, decidirEnvioAgendado, explicarBloqueio } from "@/lib/agendados-regras";

/**
 * F2-4 — lembretes para o próprio usuário e mensagens agendadas para o cliente.
 * Quem chama já passou por exigirAcesso e já conferiu que pode mexer no cliente/cartão.
 */

type Resultado = { ok: true } | { ok: false; motivo: string };

export async function agendarLembrete(
  u: Usuario,
  d: { clienteId: string; quando: Date; texto: string; oportunidadeId?: string | null; unidade?: string },
): Promise<Resultado> {
  if (!(await nucleoAplicado())) return { ok: false, motivo: "Recurso disponível após a atualização do banco" };
  const v = validarHorario(d.quando);
  if (!v.ok) return v;
  const { error } = await db().from("lembretes").insert({
    usuario_id: u.id,
    cliente_id: d.clienteId,
    oportunidade_id: d.oportunidadeId ?? null,
    unidade: d.unidade && u.unidades.includes(d.unidade) ? d.unidade : u.unidade,
    tipo: "retorno",
    data_alvo: d.quando.toISOString().slice(0, 10),
    quando: d.quando.toISOString(),
    observacao: d.texto.slice(0, 500),
  });
  if (error) return { ok: false, motivo: "Não foi possível agendar o lembrete" };
  await auditar(u.email, "agendar_lembrete", "lembretes", null, { cliente: d.clienteId });
  return { ok: true };
}

export async function agendarMensagem(
  u: Usuario,
  d: { clienteId: string; quando: Date; texto: string; oportunidadeId?: string | null; unidade?: string },
): Promise<Resultado> {
  if (!(await nucleoAplicado())) return { ok: false, motivo: "Recurso disponível após a atualização do banco" };
  const v = validarHorario(d.quando);
  if (!v.ok) return v;
  const texto = d.texto.trim().slice(0, 1000);
  if (!texto) return { ok: false, motivo: "Escreva a mensagem" };
  const { error } = await db().from("mensagens_agendadas").insert({
    unidade: d.unidade && u.unidades.includes(d.unidade) ? d.unidade : u.unidade,
    cliente_id: d.clienteId,
    oportunidade_id: d.oportunidadeId ?? null,
    criado_por: u.id,
    texto,
    enviar_em: d.quando.toISOString(),
  });
  if (error) return { ok: false, motivo: "Não foi possível agendar a mensagem" };
  await auditar(u.email, "agendar_mensagem", "mensagens_agendadas", null, { cliente: d.clienteId });
  return { ok: true };
}

/** "Meus agendados": lembretes e mensagens criados pelo usuário (próximos e recentes). */
export async function meusAgendados(u: Usuario) {
  if (!(await nucleoAplicado())) return { lembretes: [], mensagens: [] };
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: lembretes }, { data: mensagens }] = await Promise.all([
    db().from("lembretes").select("id, quando, observacao, notificado_em, concluido_em, oportunidade_id, cliente:clientes(id, nome)").eq("usuario_id", u.id).not("quando", "is", null).gte("quando", desde).order("quando").limit(200),
    db().from("mensagens_agendadas").select("id, enviar_em, texto, status, modo, motivo, enviada_em, oportunidade_id, cliente:clientes(id, nome)").eq("criado_por", u.id).gte("enviar_em", desde).order("enviar_em").limit(200),
  ]);
  return { lembretes: lembretes ?? [], mensagens: mensagens ?? [] };
}

export async function cancelarAgendado(u: Usuario, tipo: "lembrete" | "mensagem", id: string): Promise<Resultado> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, motivo: "Item inválido" };
  const r = tipo === "lembrete"
    ? await db().from("lembretes").update({ concluido_em: new Date().toISOString() }).eq("id", id).eq("usuario_id", u.id).is("concluido_em", null).select("id")
    : await db().from("mensagens_agendadas").update({ status: "cancelada" }).eq("id", id).eq("criado_por", u.id).eq("status", "pendente").select("id");
  return r.data?.length ? { ok: true } : { ok: false, motivo: "Já foi processado" };
}

function linkDoCliente(nome: string | null, oportunidadeId: string | null): string {
  return oportunidadeId ? `/painel/vendas?op=${oportunidadeId}` : `/painel/busca?q=${encodeURIComponent(nome ?? "")}`;
}

/** Cron (a cada 10 min): dispara os lembretes vencidos (pop-up) e envia as mensagens agendadas. */
export async function processarAgendados(): Promise<{ lembretes: number; enviadas: number; bloqueadas: number }> {
  if (!(await nucleoAplicado())) return { lembretes: 0, enviadas: 0, bloqueadas: 0 };
  const agora = new Date().toISOString();
  let lembretes = 0, enviadas = 0, bloqueadas = 0;

  // ---- lembretes: marca como notificado ANTES de avisar (nunca duplica pop-up) ----
  const { data: vencidos } = await db()
    .from("lembretes")
    .update({ notificado_em: agora })
    .lte("quando", agora)
    .is("notificado_em", null)
    .is("concluido_em", null)
    .select("id, usuario_id, unidade, observacao, oportunidade_id, cliente:clientes(nome)");
  for (const l of vencidos ?? []) {
    const cliente = (Array.isArray(l.cliente) ? l.cliente[0] : l.cliente) as { nome: string | null } | null;
    await notificarUsuario(l.usuario_id as string, {
      tipo: "tarefa",
      titulo: `Lembrete: ${cliente?.nome ?? "cliente"}`,
      corpo: (l.observacao as string | null) ?? undefined,
      link: linkDoCliente(cliente?.nome ?? null, l.oportunidade_id as string | null),
      unidade: l.unidade as string,
    });
    lembretes++;
  }

  // F2-4-001: tudo que pode falhar ANTES de reservar vem primeiro (falha aqui não prende nenhuma mensagem)
  const cfg = await getConfig();

  // Reservas antigas (cron caiu no meio): resultado INCERTO — nunca reenvia sozinho (evita mensagem em dobro);
  // encerra como bloqueada e avisa quem agendou para conferir com o cliente.
  const limiteReserva = new Date(Date.now() - RESERVA_MAX_MIN * 60_000).toISOString();
  const { data: presas } = await db()
    .from("mensagens_agendadas")
    .update({ status: "bloqueada", motivo: "resultado_incerto" })
    .eq("status", "enviando")
    .lt("reservada_em", limiteReserva)
    .select("id, cliente_id, criado_por, unidade, oportunidade_id");
  for (const p of presas ?? []) {
    bloqueadas++;
    await avisarFalha(p, null, "resultado_incerto");
  }

  // ---- mensagens: "reserva" a linha (pendente → enviando) para dois crons não enviarem a mesma ----
  const { data: fila } = await db()
    .from("mensagens_agendadas")
    .update({ status: "enviando", reservada_em: new Date().toISOString() })
    .eq("status", "pendente")
    .lte("enviar_em", agora)
    .select("id, cliente_id, criado_por, unidade, texto, oportunidade_id")
    .limit(50);
  if (!fila?.length) return { lembretes, enviadas, bloqueadas };

  for (const m of fila) {
    // Fase 1 (antes do transporte): qualquer exceção devolve a mensagem para a fila.
    let cliente: { nome: string | null; telefone: string; ultimo_contato_em: string | null; anonimizado: boolean } | null;
    let decisao: ReturnType<typeof decidirEnvioAgendado> | "cliente_indisponivel";
    try {
      const { data, error } = await db().from("clientes").select("nome, telefone, ultimo_contato_em, anonimizado").eq("id", m.cliente_id).maybeSingle();
      if (error) throw error;
      cliente = data as typeof cliente;
      if (!cliente || cliente.anonimizado) decisao = "cliente_indisponivel";
      else {
        let optout = true; // falha na verificação = não envia (fail-closed, como no outbound)
        try { optout = await estaOptout(cliente.telefone); } catch { optout = true; }
        decisao = decidirEnvioAgendado({ optout, janelaAberta: janela24hAberta(cliente.ultimo_contato_em) });
      }
    } catch {
      await db().from("mensagens_agendadas").update({ status: "pendente", reservada_em: null }).eq("id", m.id).eq("status", "enviando");
      continue;
    }

    // Fase 2 (transporte): exceção aqui = resultado incerto (pode ter saído) → bloqueia, sem reenvio.
    let resultado: { ok: true; modo: "livre" | "template" } | { ok: false; motivo: string };
    try {
      if (decisao === "cliente_indisponivel") resultado = { ok: false, motivo: "cliente_indisponivel" };
      else if (decisao === "bloquear_optout") resultado = { ok: false, motivo: "optout" };
      else if (decisao === "livre") {
        const r = await responderLivre({ clienteId: m.cliente_id, texto: m.texto, autor: "atendente", metadata: { agendada: m.id } });
        resultado = r.ok ? { ok: true, modo: "livre" } : { ok: false, motivo: r.motivo };
      } else {
        const primeiroNome = (cliente?.nome ?? "cliente").split(" ")[0];
        const r = await notificarCliente({ clienteId: m.cliente_id, uso: "retomada_atendimento", valores: [primeiroNome, cfg.empresa.nome] });
        resultado = r.ok ? { ok: true, modo: "template" } : { ok: false, motivo: r.motivo };
      }
    } catch {
      resultado = { ok: false, motivo: "resultado_incerto" };
    }

    if (resultado.ok) {
      await db().from("mensagens_agendadas").update({ status: "enviada", modo: resultado.modo, enviada_em: new Date().toISOString() }).eq("id", m.id);
      enviadas++;
    } else {
      await db().from("mensagens_agendadas").update({ status: "bloqueada", motivo: resultado.motivo }).eq("id", m.id);
      bloqueadas++;
      await avisarFalha(m, cliente?.nome ?? null, resultado.motivo);
    }
  }
  return { lembretes, enviadas, bloqueadas };
}

/** Reserva com mais de 15 min sem desfecho = cron caiu no meio do envio. */
const RESERVA_MAX_MIN = 15;

async function avisarFalha(
  m: { cliente_id: string; criado_por: string | null; unidade: string; oportunidade_id: string | null },
  nomeConhecido: string | null,
  motivo: string,
) {
  if (!m.criado_por) return;
  let nome = nomeConhecido;
  if (!nome) {
    const { data } = await db().from("clientes").select("nome").eq("id", m.cliente_id).maybeSingle();
    nome = (data?.nome as string | null) ?? null;
  }
  await notificarUsuario(m.criado_por, {
    tipo: "alerta",
    titulo: `Mensagem para ${nome ?? "cliente"} não foi enviada`,
    corpo: motivo === "resultado_incerto"
      ? "O envio foi interrompido e não dá para saber se chegou. Confira com o cliente antes de mandar de novo."
      : `Motivo: ${explicarBloqueio(motivo)}. Entre em contato por telefone.`,
    link: linkDoCliente(nome, m.oportunidade_id),
    unidade: m.unidade,
  });
}
