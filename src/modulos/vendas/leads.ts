import "server-only";
import { db } from "@/lib/supabase/admin";
import { nucleoAplicado } from "@/lib/usuarios";
import { encaminharLeadBot } from "@/modulos/atendimento/encaminhamentos";
import { registrarLeadVendasBot } from "./qualificacao-bot";
import { destinoDoLead, type Interesse, type Pagamento, type Prazo } from "./regras";

/**
 * F2-1 — o assistente do WhatsApp qualifica o interesse e o lead entra no CRM.
 * Regras:
 *  - reprocessar a mesma mensagem preserva seus efeitos únicos; novas mensagens atualizam
 *    a oportunidade aberta mais recente do cliente no funil, quando houver;
 *  - "confirmado pelo cliente" só quando o próprio cliente confirmou os dados na conversa; senão "a verificar";
 *  - dono = vendedor da carteira do cliente; senão rodízio entre vendedores ativos da unidade;
 *  - devolve ao agente só o necessário para responder (nenhum nome de funcionário ou dado interno).
 */

export type DadosLead = {
  clienteId: string;
  interesse: Interesse;
  modelo: string | null;
  pagamento: Pagamento;
  prazo: Prazo;
  temTroca: boolean | null;
  trocaDescricao: string | null;
  resumo: string;
  clienteConfirmou: boolean;
  /** wamid da mensagem: referência estável para não duplicar os efeitos de uma qualificação. */
  referencia?: string | null;
  conversaId?: string | null;
};

export type ResultadoLead =
  | { ok: true; destino: "vendas"; novo: boolean }
  | { ok: true; destino: "agenda" | "pecas" | "triagem" }
  | { ok: false; motivo: string };

export async function rotearLead(d: DadosLead): Promise<ResultadoLead> {
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, motivo: "contexto_vendas_invalido" };
  const destino = destinoDoLead(d.interesse);
  if (destino.tipo === "agenda") return { ok: true, destino: "agenda" };
  if (!(await nucleoAplicado())) return { ok: false, motivo: "crm_indisponivel" };

  // Vendas comprova cliente, conversa e origem da mensagem na própria transação.
  if (destino.tipo === "funil") {
    const r = await registrarLeadVendasBot(d, destino.funil);
    return r.ok ? { ok: true, destino: "vendas", novo: r.novo } : r;
  }

  const { data: cliente } = await db()
    .from("clientes")
    .select("id, anonimizado")
    .eq("id", d.clienteId)
    .maybeSingle();
  if (!cliente || cliente.anonimizado) return { ok: false, motivo: "cliente_indisponivel" };
  const resumo = d.resumo.slice(0, 300);

  // Peças e triagem mantêm o encaminhamento interno já existente.
  const r = await encaminharLeadBot({
    conversaId: d.conversaId ?? "",
    clienteId: d.clienteId,
    referencia: d.referencia ?? "",
    destino: destino.tipo,
    resumo,
  });
  return r.ok ? { ok: true, destino: destino.tipo } : r;
}
