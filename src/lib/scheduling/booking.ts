import "server-only";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { calcularSlots, type Slot } from "./availability";
import { dataLocalISO, formatarDataHora } from "@/lib/time";

/**
 * Operações de agenda. O banco é a última palavra sobre conflito
 * (exclusion constraint `sem_conflito`, erro 23P01).
 */

export type Servico = { id: string; nome: string; duracao_min: number; tipo_recurso: string; preco_referencia: number | null; descricao: string | null };

export async function listarServicos(): Promise<Servico[]> {
  const { data } = await db()
    .from("servicos")
    .select("id, nome, duracao_min, tipo_recurso, preco_referencia, descricao")
    .eq("ativo", true)
    .order("nome");
  return (data ?? []) as Servico[];
}

export async function buscarServico(idOuNome: string): Promise<Servico | null> {
  const lista = await listarServicos();
  const alvo = idOuNome.toLowerCase().trim();
  return lista.find((s) => s.id === idOuNome) ?? lista.find((s) => s.nome.toLowerCase() === alvo) ?? lista.find((s) => s.nome.toLowerCase().includes(alvo)) ?? null;
}

export async function horariosDisponiveis(args: {
  servicoId: string;
  dataPreferida?: string | null;
  periodo?: "manha" | "tarde" | null;
  limite?: number;
  ignorarAgendamentoId?: string;
}): Promise<{ servico: Servico; slots: Slot[] } | null> {
  const cfg = await getConfig();
  const servico = await buscarServico(args.servicoId);
  if (!servico) return null;

  const agora = new Date();
  const ate = new Date(agora.getTime() + (cfg.agenda.janela_dias + 1) * 86400_000).toISOString();

  const [{ data: horarios }, { data: recursos }, { data: ocupados }, { data: bloqueios }] = await Promise.all([
    db().from("horarios_funcionamento").select("dia_semana, abre, fecha"),
    db().from("recursos").select("id, nome").eq("ativo", true).eq("tipo", servico.tipo_recurso).order("nome"),
    db()
      .from("agendamentos")
      .select("id, recurso_id, inicio, fim")
      .in("status", ["pendente", "confirmado"])
      .gte("fim", agora.toISOString())
      .lte("inicio", ate),
    db().from("bloqueios").select("recurso_id, inicio, fim").gte("fim", agora.toISOString()),
  ]);

  const slots = calcularSlots({
    agora,
    offset: cfg.fuso_offset,
    agenda: cfg.agenda,
    horarios: horarios ?? [],
    recursos: recursos ?? [],
    ocupados: (ocupados ?? []).filter((o) => o.id !== args.ignorarAgendamentoId),
    bloqueios: bloqueios ?? [],
    duracaoMin: servico.duracao_min,
    dataPreferida: args.dataPreferida ?? null,
    periodo: args.periodo ?? null,
    limite: args.limite ?? cfg.agenda.max_opcoes,
  });
  return { servico, slots };
}

async function historico(agendamentoId: string, acao: string, ator: string, de: string | null, para: string | null, detalhes: Record<string, unknown> = {}) {
  await db().from("agendamento_historico").insert({ agendamento_id: agendamentoId, acao, de_status: de, para_status: para, ator, detalhes });
}

/** Acha o slot exato pedido (o horário precisa estar REALMENTE livre agora). */
async function slotExato(servicoId: string, inicioISO: string, ignorarAgendamentoId?: string): Promise<{ servico: Servico; slot: Slot } | null> {
  const cfg = await getConfig();
  const inicio = new Date(inicioISO);
  if (Number.isNaN(inicio.getTime())) return null;
  const r = await horariosDisponiveis({
    servicoId,
    dataPreferida: dataLocalISO(inicio, cfg.fuso_offset),
    limite: 500,
    ignorarAgendamentoId,
  });
  if (!r) return null;
  const slot = r.slots.find((s) => s.inicio.getTime() === inicio.getTime());
  return slot ? { servico: r.servico, slot } : null;
}

export type ResultadoAgenda =
  | { ok: true; agendamentoId: string; resumo: string }
  | { ok: false; motivo: string; alternativas?: string[] };

async function alternativas(servicoId: string): Promise<string[]> {
  const cfg = await getConfig();
  const r = await horariosDisponiveis({ servicoId, limite: 4 });
  return (r?.slots ?? []).map((s) => `${formatarDataHora(s.inicio, cfg.fuso_offset)} (${s.inicio.toISOString()})`);
}

export async function criarAgendamento(args: {
  clienteId: string;
  servicoId: string;
  inicioISO: string;
  ator: string; // cliente:<tel> | painel:<email>
  origem: "whatsapp" | "painel";
  confirmadoPeloCliente: boolean; // cliente confirmou explicitamente na conversa
  confirmadoPor?: string | null;
  veiculo?: { placa?: string | null; modelo?: string | null; km?: number | null } | null;
  observacoes?: string | null;
}): Promise<ResultadoAgenda> {
  const cfg = await getConfig();
  const alvo = await slotExato(args.servicoId, args.inicioISO);
  if (!alvo) return { ok: false, motivo: "horario_indisponivel", alternativas: await alternativas(args.servicoId) };

  let veiculoId: string | null = null;
  if (args.veiculo && (args.veiculo.placa || args.veiculo.modelo)) {
    const placa = args.veiculo.placa?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
    const { data: existente } = placa
      ? await db().from("veiculos").select("id").eq("cliente_id", args.clienteId).eq("placa", placa).maybeSingle()
      : { data: null };
    if (existente) {
      veiculoId = existente.id;
      if (args.veiculo.km) await db().from("veiculos").update({ km_atual: args.veiculo.km }).eq("id", existente.id);
    } else {
      const { data: novo } = await db()
        .from("veiculos")
        .insert({ cliente_id: args.clienteId, placa, modelo: args.veiculo.modelo ?? null, km_atual: args.veiculo.km ?? null })
        .select("id")
        .single();
      veiculoId = novo?.id ?? null;
    }
  }

  const confirmado = args.confirmadoPeloCliente;
  const { data, error } = await db()
    .from("agendamentos")
    .insert({
      cliente_id: args.clienteId,
      veiculo_id: veiculoId,
      servico_id: alvo.servico.id,
      recurso_id: alvo.slot.recursoId,
      inicio: alvo.slot.inicio.toISOString(),
      fim: alvo.slot.fim.toISOString(),
      status: confirmado ? "confirmado" : "pendente",
      origem: args.origem,
      observacoes: args.observacoes ?? null,
      confirmado_em: confirmado ? new Date().toISOString() : null,
      confirmado_por: confirmado ? args.confirmadoPor ?? null : null,
      confirmado_canal: confirmado ? "whatsapp_conversa" : null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23P01") return { ok: false, motivo: "horario_acabou_de_ser_ocupado", alternativas: await alternativas(args.servicoId) };
    throw error;
  }

  await historico(data.id, "criado", args.ator, null, confirmado ? "confirmado" : "pendente", {
    servico: alvo.servico.nome,
    inicio: alvo.slot.inicio.toISOString(),
    recurso: alvo.slot.recursoNome,
  });
  if (confirmado) await historico(data.id, "confirmado", args.ator, "pendente", "confirmado", { canal: "whatsapp_conversa" });

  return {
    ok: true,
    agendamentoId: data.id,
    resumo: `${alvo.servico.nome} em ${formatarDataHora(alvo.slot.inicio, cfg.fuso_offset)} (${alvo.slot.recursoNome})`,
  };
}

/** "Quem confirmou": grava quem, quando e por qual canal. */
export async function confirmarAgendamento(agendamentoId: string, por: string, canal: "whatsapp_botao" | "whatsapp_conversa" | "painel", ator: string) {
  const { data: ag } = await db().from("agendamentos").select("id, status, confirmado_em").eq("id", agendamentoId).maybeSingle();
  if (!ag) return { ok: false as const, motivo: "agendamento_inexistente" };
  if (!["pendente", "confirmado"].includes(ag.status)) return { ok: false as const, motivo: `status_${ag.status}` };

  if (ag.status === "pendente") {
    await db()
      .from("agendamentos")
      .update({ status: "confirmado", confirmado_em: new Date().toISOString(), confirmado_por: por, confirmado_canal: canal })
      .eq("id", agendamentoId);
    await historico(agendamentoId, "confirmado", ator, "pendente", "confirmado", { canal, por });
  } else {
    // já confirmado: registra a reconfirmação de presença (ex.: botão do lembrete)
    await historico(agendamentoId, "presenca_reconfirmada", ator, "confirmado", "confirmado", { canal, por });
  }
  return { ok: true as const };
}

export async function cancelarAgendamento(agendamentoId: string, motivo: string | null, ator: string) {
  const { data: ag } = await db().from("agendamentos").select("status").eq("id", agendamentoId).maybeSingle();
  if (!ag) return { ok: false as const, motivo: "agendamento_inexistente" };
  if (!["pendente", "confirmado"].includes(ag.status)) return { ok: false as const, motivo: `status_${ag.status}` };
  await db().from("agendamentos").update({ status: "cancelado", motivo_cancelamento: motivo }).eq("id", agendamentoId);
  await historico(agendamentoId, "cancelado", ator, ag.status, "cancelado", { motivo });
  await db().from("followups").update({ status: "cancelado" }).eq("agendamento_id", agendamentoId).eq("status", "pendente");
  return { ok: true as const };
}

export async function reagendar(agendamentoId: string, novoInicioISO: string, ator: string): Promise<ResultadoAgenda> {
  const cfg = await getConfig();
  const { data: ag } = await db().from("agendamentos").select("id, servico_id, status, inicio").eq("id", agendamentoId).maybeSingle();
  if (!ag) return { ok: false, motivo: "agendamento_inexistente" };
  if (!["pendente", "confirmado"].includes(ag.status)) return { ok: false, motivo: `status_${ag.status}` };

  const alvo = await slotExato(ag.servico_id, novoInicioISO, agendamentoId);
  if (!alvo) return { ok: false, motivo: "horario_indisponivel", alternativas: await alternativas(ag.servico_id) };

  const { error } = await db()
    .from("agendamentos")
    .update({
      inicio: alvo.slot.inicio.toISOString(),
      fim: alvo.slot.fim.toISOString(),
      recurso_id: alvo.slot.recursoId,
      lembrete_24h_em: null,
      lembrete_2h_em: null,
    })
    .eq("id", agendamentoId);
  if (error) {
    if (error.code === "23P01") return { ok: false, motivo: "horario_acabou_de_ser_ocupado", alternativas: await alternativas(ag.servico_id) };
    throw error;
  }
  await historico(agendamentoId, "reagendado", ator, ag.status, ag.status, { de: ag.inicio, para: alvo.slot.inicio.toISOString() });
  return { ok: true, agendamentoId, resumo: `${alvo.servico.nome} em ${formatarDataHora(alvo.slot.inicio, cfg.fuso_offset)}` };
}

/** Agendamentos futuros ativos do cliente (para o agente e para a ficha do lead). */
export async function agendamentosDoCliente(clienteId: string) {
  const { data } = await db()
    .from("agendamentos")
    .select("id, inicio, status, servicos(nome), recursos(nome)")
    .eq("cliente_id", clienteId)
    .in("status", ["pendente", "confirmado"])
    .gte("inicio", new Date().toISOString())
    .order("inicio");
  return (data ?? []) as unknown as { id: string; inicio: string; status: string; servicos: { nome: string } | null; recursos: { nome: string } | null }[];
}
