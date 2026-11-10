"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { normalizarTelefone } from "@/lib/phone";
import { localParaUtc, formatarDataHora } from "@/lib/time";
import { criarAgendamento, confirmarAgendamento, cancelarAgendamento } from "@/lib/scheduling/booking";
import { notificar } from "@/lib/messaging/outbound";
import { auditar } from "@/lib/audit";

const STATUS_VALIDOS = ["pendente", "confirmado", "compareceu", "nao_compareceu", "cancelado"];

export async function mudarStatus(formData: FormData) {
  const u = await exigirAcesso("agenda");
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!STATUS_VALIDOS.includes(status)) return;
  const ator = `painel:${u.email}`;

  if (status === "confirmado") await confirmarAgendamento(id, u.email, "painel", ator);
  else if (status === "cancelado") await cancelarAgendamento(id, String(formData.get("motivo") || "cancelado pela recepção"), ator);
  else {
    const { data: ag } = await db().from("agendamentos").select("status, veiculo_id, servicos(nome)").eq("id", id).single();
    await db().from("agendamentos").update({ status }).eq("id", id);
    await db().from("agendamento_historico").insert({ agendamento_id: id, acao: "status_alterado", de_status: ag?.status, para_status: status, ator });
    // Compareceu em revisão => atualiza o veículo e alimenta o lembrete de revisão periódica
    const nomeServico = (ag as unknown as { servicos: { nome: string } | null })?.servicos?.nome ?? "";
    if (status === "compareceu" && ag?.veiculo_id && /revis/i.test(nomeServico)) {
      const hoje = new Date();
      const proxima = new Date(hoje.getTime() + 365 * 86400_000);
      await db().from("veiculos").update({ ultima_revisao_em: hoje.toISOString().slice(0, 10), proxima_revisao_em: proxima.toISOString().slice(0, 10) }).eq("id", ag.veiculo_id);
    }
  }
  await auditar(u.email, "agendamento_status", "agendamento", id, { status });
  revalidatePath("/painel/agendamentos");
}

export async function novoAgendamento(formData: FormData) {
  const u = await exigirAcesso("agenda");
  const cfg = await getConfig();
  const telefone = normalizarTelefone(String(formData.get("telefone") ?? ""));
  if (!telefone) redirect("/painel/agendamentos?msg=telefone_invalido");
  const nome = String(formData.get("nome") ?? "").trim().slice(0, 80) || null;
  const servicoId = String(formData.get("servico"));
  const data = String(formData.get("data"));
  const hora = String(formData.get("hora"));

  const { data: existente } = await db().from("clientes").select("id, nome").eq("telefone", telefone!).maybeSingle();
  const cliente = existente ?? (await db().from("clientes").insert({ telefone, origem: "painel", nome }).select("id, nome").single()).data;
  if (!cliente) redirect("/painel/agendamentos?msg=erro");
  if (nome && !cliente.nome) await db().from("clientes").update({ nome }).eq("id", cliente.id);

  const inicio = localParaUtc(data, hora, cfg.fuso_offset);
  const r = await criarAgendamento({
    clienteId: cliente.id,
    servicoId,
    inicioISO: inicio.toISOString(),
    ator: `painel:${u.email}`,
    origem: "painel",
    confirmadoPeloCliente: false,
    veiculo: { placa: String(formData.get("placa") || "") || null, modelo: String(formData.get("modelo") || "") || null },
    observacoes: String(formData.get("obs") || "") || null,
  });
  if (!r.ok) redirect(`/painel/agendamentos?msg=${r.motivo}`);

  // Pedido de confirmação ao cliente (só sai com consentimento de serviço + template aprovado ou janela aberta)
  const { data: srv } = await db().from("servicos").select("nome").eq("id", servicoId).single();
  const env = await notificar({
    clienteId: cliente.id,
    uso: "confirmacao_agendamento",
    valores: [(nome ?? cliente.nome ?? "cliente").split(" ")[0], srv?.nome ?? "serviço", cfg.empresa.nome, formatarDataHora(inicio, cfg.fuso_offset), cfg.empresa.endereco],
    payloads: [`AG_CONF:${r.agendamentoId}`, `AG_REM:${r.agendamentoId}`, `AG_CANC:${r.agendamentoId}`],
    agendamentoId: r.agendamentoId,
  });
  await auditar(u.email, "agendamento_criado", "agendamento", r.agendamentoId, { whatsapp: env.ok ? "enviado" : env.motivo });
  redirect(`/painel/agendamentos?msg=${env.ok ? "criado_enviado" : `criado_sem_whatsapp:${env.motivo}`}`);
}
