import "server-only";
import { db } from "@/lib/supabase/admin";
import type { DadosLead } from "./leads";
import { ehChave, PAGAMENTOS, PRAZOS } from "./regras";

type Resultado = { ok: true; novo: boolean } | { ok: false; motivo: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID.test(v);
const textoOuNulo = (v: unknown): v is string | null => v === null || typeof v === "string";
const referenciaValida = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 512 && v.trim() === v;

/**
 * Persiste a qualificação e seus efeitos internos na mesma transação.
 * O RPC comprova a mensagem recebida, deriva a unidade e decide carteira/rodízio;
 * o agente recebe apenas sucesso e a indicação de novo cartão.
 */
export async function registrarLeadVendasBot(d: DadosLead, funil: "novos" | "seminovos"): Promise<Resultado> {
  if (!objeto(d) || !uuid(d.conversaId) || !uuid(d.clienteId) || !referenciaValida(d.referencia) ||
    (funil !== "novos" && funil !== "seminovos") || !ehChave(PAGAMENTOS, d.pagamento) || !ehChave(PRAZOS, d.prazo) ||
    !textoOuNulo(d.modelo) || !textoOuNulo(d.trocaDescricao) || typeof d.resumo !== "string" ||
    (d.temTroca !== null && typeof d.temTroca !== "boolean") || typeof d.clienteConfirmou !== "boolean") {
    return { ok: false, motivo: "contexto_vendas_invalido" };
  }
  const resumo = d.resumo.trim().slice(0, 300).trim();
  if (!resumo) return { ok: false, motivo: "contexto_vendas_invalido" };
  try {
    const { data, error } = await db().rpc("registrar_lead_vendas_bot", {
      p_conversa_id: d.conversaId.toLowerCase(),
      p_cliente_id: d.clienteId.toLowerCase(),
      p_referencia: d.referencia,
      p_funil: funil,
      p_modelo: d.modelo?.trim().slice(0, 120).trim() || null,
      p_pagamento: d.pagamento,
      p_prazo: d.prazo,
      p_tem_troca: d.temTroca,
      p_troca_descricao: d.temTroca === true ? d.trocaDescricao?.trim().slice(0, 300).trim() || null : null,
      p_resumo: resumo,
      p_cliente_confirmou: d.clienteConfirmou,
    });
    if (error || !objeto(data) || data.ok !== true || !uuid(data.oportunidade_id) ||
      typeof data.novo !== "boolean" || typeof data.ja_registrado !== "boolean") {
      return { ok: false, motivo: "vendas_indisponivel" };
    }
    return { ok: true, novo: data.novo };
  } catch {
    return { ok: false, motivo: "vendas_indisponivel" };
  }
}
