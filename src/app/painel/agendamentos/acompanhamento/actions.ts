"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { nucleoAplicado } from "@/lib/usuarios";
import { statusAoDesfazer } from "@/lib/scheduling/acompanhamento";

/**
 * Atalhos da tela de acompanhamento: "Chegou", "Não veio" e "Desfazer".
 * Grava só se o agendamento ainda estiver no status esperado (evita sobrescrever quem marcou antes)
 * e só nas unidades do operador. Histórico + auditoria só depois de gravar de verdade.
 */
const DE_PARA: Record<string, { de: string[]; para?: string }> = {
  chegou: { de: ["pendente", "confirmado"], para: "compareceu" },
  nao_veio: { de: ["pendente", "confirmado"], para: "nao_compareceu" },
  // PR9-ACOMP-003: desfazer volta ao de_status gravado na marcação (não infere pelo confirmado_em)
  desfazer: { de: ["compareceu", "nao_compareceu"] },
};

export async function marcarPresenca(form: FormData) {
  const u = await exigirAcesso("agenda");
  const id = String(form.get("id") ?? "");
  const acao = String(form.get("acao") ?? "");
  const volta = String(form.get("volta") ?? "/painel/agendamentos/acompanhamento");
  const destino = volta.startsWith("/painel/agendamentos/acompanhamento") ? volta : "/painel/agendamentos/acompanhamento";
  const regra = DE_PARA[acao];
  if (!id || !regra) return;

  const multi = await nucleoAplicado();
  let leitura = db().from("agendamentos").select("status, veiculo_id, confirmado_em, servicos!agendamentos_servico_id_fkey(nome)").eq("id", id);
  if (multi) leitura = leitura.in("unidade", u.unidades);
  const { data: ag } = await leitura.maybeSingle();
  if (!ag || !regra.de.includes(ag.status)) { revalidatePath("/painel/agendamentos/acompanhamento"); return; }

  let para = regra.para;
  if (!para) {
    const { data: marca } = await db().from("agendamento_historico").select("de_status")
      // ACOMP003-R1: só a marcação EFETIVA (veio de pendente/confirmado); ignora eventos sem mudança (ex.: Salvar mantendo o status)
      .eq("agendamento_id", id).eq("para_status", ag.status).in("de_status", ["pendente", "confirmado"])
      .order("criado_em", { ascending: false }).limit(1).maybeSingle();
    para = statusAoDesfazer(marca?.de_status as string | null | undefined, ag.confirmado_em);
  }
  let gravacao = db().from("agendamentos").update({ status: para }).eq("id", id).eq("status", ag.status);
  if (multi) gravacao = gravacao.in("unidade", u.unidades);
  const { data: gravou, error } = await gravacao.select("id");
  // desfazer pode bater no bloqueio de conflito (outro agendamento ocupou o box nesse horário)
  if (error?.code === "23P01") redirect(`${destino}${destino.includes("?") ? "&" : "?"}msg=conflito`);
  if (error || !gravou?.length) { revalidatePath("/painel/agendamentos/acompanhamento"); return; }

  await db().from("agendamento_historico").insert({ agendamento_id: id, acao: acao === "desfazer" ? "presenca_desfeita" : "status_alterado", de_status: ag.status, para_status: para, ator: `painel:${u.email}` });
  // mesma regra da tela de agendamentos: compareceu em revisão alimenta a próxima revisão do veículo
  const nomeServico = (ag as unknown as { servicos: { nome: string } | null }).servicos?.nome ?? "";
  if (para === "compareceu" && ag.veiculo_id && /revis/i.test(nomeServico)) {
    const hoje = new Date();
    const proxima = new Date(hoje.getTime() + 365 * 86400_000);
    await db().from("veiculos").update({ ultima_revisao_em: hoje.toISOString().slice(0, 10), proxima_revisao_em: proxima.toISOString().slice(0, 10) }).eq("id", ag.veiculo_id);
  }
  await auditar(u.email, "agendamento_status", "agendamento", id, { status: para, via: "acompanhamento" });
  revalidatePath("/painel/agendamentos/acompanhamento");
  revalidatePath("/painel/agendamentos");
}
