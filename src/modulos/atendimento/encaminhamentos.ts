import "server-only";
import { db } from "@/lib/supabase/admin";

type PedidoEncaminhamento = {
  conversaId: string;
  clienteId: string;
  referencia: string;
  destino: "pecas" | "triagem";
  resumo: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID.test(v);
type Resultado = { ok: true } | { ok: false; motivo: string };

/** A RPC grava pedido, nota, avisos e identidade da mensagem juntos, ou desfaz tudo. */
export async function encaminharLeadBot(pedido: PedidoEncaminhamento): Promise<Resultado> {
  const referencia = pedido.referencia.trim();
  const resumo = pedido.resumo.trim().slice(0, 300);
  if (!uuid(pedido.conversaId) || !uuid(pedido.clienteId) || !referencia || referencia.length > 512 || !resumo) {
    return { ok: false, motivo: "contexto_encaminhamento_invalido" };
  }
  try {
    const { data, error } = await db().rpc("encaminhar_lead_bot", {
      p_conversa_id: pedido.conversaId,
      p_cliente_id: pedido.clienteId,
      p_referencia: referencia,
      p_destino: pedido.destino,
      p_resumo: resumo,
    });
    if (error || !data || typeof data !== "object" || data.ok !== true ||
      (pedido.destino === "pecas" && !uuid(data.cotacao_id))) {
      return { ok: false, motivo: "encaminhamento_indisponivel" };
    }
    return { ok: true };
  } catch {
    return { ok: false, motivo: "encaminhamento_indisponivel" };
  }
}
