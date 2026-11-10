import "server-only";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora, horaLocal } from "@/lib/time";
import { notificar } from "@/lib/messaging/outbound";

/**
 * FOLLOW-UP e LEMBRETES.
 * Regra 7/12: nada de reenvio automático para quem não respondeu — máx. de tentativas configurável (padrão 1).
 * Cada follow-up só sai se houver consentimento do tipo do template (checado em notificar()).
 */

const DIA = 86400_000;

/** Cron diário: cria follow-ups a partir de agendamentos e veículos. Idempotente. */
export async function gerarFollowups() {
  const cfg = await getConfig();
  const desde = new Date(Date.now() - 30 * DIA).toISOString();
  let criados = 0;

  const { data: ags } = await db()
    .from("agendamentos")
    .select("id, cliente_id, status, fim")
    .in("status", ["compareceu", "nao_compareceu"])
    .gte("fim", desde);
  const ids = (ags ?? []).map((a) => a.id);
  const { data: existentes } = ids.length ? await db().from("followups").select("agendamento_id").in("agendamento_id", ids) : { data: [] };
  const ja = new Set((existentes ?? []).map((e) => e.agendamento_id));

  for (const a of ags ?? []) {
    if (ja.has(a.id)) continue;
    const posServico = a.status === "compareceu";
    const quando = posServico
      ? new Date(new Date(a.fim).getTime() + cfg.followup.pos_servico_dias * DIA)
      : new Date(new Date(a.fim).getTime() + cfg.followup.nao_compareceu_horas * 3600_000);
    await db().from("followups").insert({
      cliente_id: a.cliente_id,
      agendamento_id: a.id,
      tipo: posServico ? "pos_servico" : "nao_compareceu",
      agendar_para: quando.toISOString(),
    });
    criados++;
  }

  // Revisão periódica: veículo com próxima revisão dentro da janela de aviso
  const hoje = new Date().toISOString().slice(0, 10);
  const limite = new Date(Date.now() + cfg.followup.revisao_aviso_dias * DIA).toISOString().slice(0, 10);
  const { data: veics } = await db()
    .from("veiculos")
    .select("id, cliente_id, modelo, proxima_revisao_em")
    .gte("proxima_revisao_em", hoje)
    .lte("proxima_revisao_em", limite);
  for (const v of veics ?? []) {
    const { count } = await db()
      .from("followups")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", v.cliente_id)
      .eq("tipo", "revisao_periodica")
      .gte("criado_em", new Date(Date.now() - 60 * DIA).toISOString());
    if (count) continue;
    await db().from("followups").insert({
      cliente_id: v.cliente_id,
      tipo: "revisao_periodica",
      agendar_para: new Date().toISOString(),
      resultado: v.modelo ?? null,
    });
    criados++;
  }
  return { criados };
}

const USO_POR_TIPO: Record<string, string> = {
  pos_servico: "followup_pos_servico",
  nao_compareceu: "nao_compareceu",
  revisao_periodica: "revisao_periodica",
  lead_sem_agendamento: "followup_lead",
  pos_evento: "aviso_final_evento",
};

/** Cron: envia follow-ups vencidos. */
export async function enviarFollowupsPendentes() {
  const cfg = await getConfig();
  const { data: lista } = await db()
    .from("followups")
    .select("id, cliente_id, agendamento_id, evento_id, tipo, tentativas, resultado, clientes(nome), agendamentos(servicos(nome)), eventos(nome)")
    .eq("status", "pendente")
    .lte("agendar_para", new Date().toISOString())
    .limit(100);

  let enviados = 0;
  for (const f of (lista ?? []) as unknown as {
    id: string; cliente_id: string; agendamento_id: string | null; evento_id: string | null; tipo: string; tentativas: number; resultado: string | null;
    clientes: { nome: string | null } | null; agendamentos: { servicos: { nome: string } | null } | null; eventos: { nome: string } | null;
  }[]) {
    if (f.tentativas >= cfg.followup.max_tentativas) {
      await db().from("followups").update({ status: "cancelado", resultado: "limite_tentativas" }).eq("id", f.id);
      continue;
    }
    const nome = f.clientes?.nome?.split(" ")[0] ?? "cliente";
    const servico = f.agendamentos?.servicos?.nome ?? "serviço";
    const valores: Record<string, string[]> = {
      pos_servico: [nome, servico, cfg.empresa.nome],
      nao_compareceu: [nome, servico],
      revisao_periodica: [nome, f.resultado || "veículo", cfg.empresa.nome],
      lead_sem_agendamento: [nome, f.resultado || "nossos serviços", cfg.empresa.nome],
      pos_evento: [nome, f.eventos?.nome ?? "nosso evento", cfg.empresa.nome],
    };
    const payloads = f.tipo === "nao_compareceu" && f.agendamento_id ? [`AG_REM:${f.agendamento_id}`] : undefined;

    const r = await notificar({
      clienteId: f.cliente_id,
      uso: USO_POR_TIPO[f.tipo],
      valores: valores[f.tipo] ?? [nome],
      payloads,
      agendamentoId: f.agendamento_id,
    });
    // verificação de opt-out indisponível: continua pendente, sem gastar tentativa
    if (!r.ok && r.motivo === "verificacao_indisponivel") continue;
    const status = r.ok ? "enviado" : r.motivo.startsWith("sem_consentimento") || r.motivo === "optout" ? "sem_consentimento" : "falhou";
    await db()
      .from("followups")
      .update({ status, tentativas: f.tentativas + 1, enviado_em: r.ok ? new Date().toISOString() : null, resultado: r.ok ? f.resultado : r.motivo })
      .eq("id", f.id);
    if (r.ok) enviados++;
  }
  return { enviados };
}

/** Cron a cada 10 min: lembretes 24h e 2h de agendamentos + véspera de eventos. Idempotente pelas colunas *_em. */
export async function enviarLembretes() {
  const cfg = await getConfig();
  const off = cfg.fuso_offset;
  const agora = Date.now();
  let enviados = 0;

  const janelas = [
    { coluna: "lembrete_24h_em", uso: "lembrete_24h", de: 23 * 3600_000, ate: 25 * 3600_000 },
    { coluna: "lembrete_2h_em", uso: "lembrete_2h", de: 105 * 60_000, ate: 135 * 60_000 },
  ] as const;

  for (const j of janelas) {
    const { data } = await db()
      .from("agendamentos")
      .select("id, cliente_id, inicio, clientes(nome), servicos(nome)")
      .in("status", ["pendente", "confirmado"])
      .is(j.coluna, null)
      .gte("inicio", new Date(agora + j.de).toISOString())
      .lte("inicio", new Date(agora + j.ate).toISOString());

    for (const a of (data ?? []) as unknown as { id: string; cliente_id: string; inicio: string; clientes: { nome: string | null } | null; servicos: { nome: string } | null }[]) {
      // marca ANTES de enviar: em caso de erro não vira spam de repetição
      await db().from("agendamentos").update({ [j.coluna]: new Date().toISOString() }).eq("id", a.id);
      const nome = a.clientes?.nome?.split(" ")[0] ?? "cliente";
      const servico = a.servicos?.nome ?? "atendimento";
      const valores =
        j.uso === "lembrete_24h"
          ? [nome, servico, formatarDataHora(a.inicio, off), cfg.empresa.nome, cfg.empresa.endereco]
          : [nome, servico, horaLocal(new Date(a.inicio), off), cfg.empresa.nome];
      const r = await notificar({
        clienteId: a.cliente_id,
        uso: j.uso,
        valores,
        payloads: j.uso === "lembrete_24h" ? [`AG_CONF:${a.id}`, `AG_REM:${a.id}`, `AG_CANC:${a.id}`] : undefined,
        agendamentoId: a.id,
      });
      // verificação indisponível: libera de novo para o próximo ciclo (a janela de 2h cobre a nova tentativa)
      if (!r.ok && r.motivo === "verificacao_indisponivel") {
        await db().from("agendamentos").update({ [j.coluna]: null }).eq("id", a.id);
        continue;
      }
      await db().from("agendamento_historico").insert({
        agendamento_id: a.id,
        acao: "lembrete",
        ator: "sistema",
        detalhes: { tipo: j.uso, resultado: r.ok ? r.modo : r.motivo },
      });
      if (r.ok) enviados++;
    }
  }

  // Véspera de evento: só para quem CONFIRMOU presença
  const { data: eventos } = await db()
    .from("eventos")
    .select("id, nome, inicio, local")
    .eq("status", "ativo")
    .gte("inicio", new Date(agora + 23 * 3600_000).toISOString())
    .lte("inicio", new Date(agora + 25 * 3600_000).toISOString());
  for (const ev of eventos ?? []) {
    const { data: inscritos } = await db().from("inscricoes_evento").select("id, cliente_id, clientes(nome)").eq("evento_id", ev.id).eq("status", "confirmado").is("lembrete_em", null);
    for (const i of (inscritos ?? []) as unknown as { id: string; cliente_id: string; clientes: { nome: string | null } | null }[]) {
      await db().from("inscricoes_evento").update({ lembrete_em: new Date().toISOString() }).eq("id", i.id);
      const r = await notificar({
        clienteId: i.cliente_id,
        uso: "lembrete_evento",
        valores: [i.clientes?.nome?.split(" ")[0] ?? "cliente", ev.nome, formatarDataHora(ev.inicio, off), ev.local],
      });
      if (r.ok) enviados++;
    }
  }
  return { enviados };
}
