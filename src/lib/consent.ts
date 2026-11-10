import "server-only";
import { db } from "@/lib/supabase/admin";

/** Textos EXATOS exibidos no aceite (ficam gravados junto do consentimento). */
export const TEXTO_CONSENTIMENTO = {
  servico: (empresa: string) =>
    `Autorizo a ${empresa} a me contatar pelo WhatsApp para confirmações, lembretes e avisos sobre meus agendamentos. Posso cancelar a qualquer momento enviando SAIR.`,
  ofertas: (empresa: string) =>
    `Autorizo a ${empresa} a me enviar convites de eventos e ofertas pelo WhatsApp. Posso cancelar a qualquer momento enviando SAIR.`,
};

export async function registrarConsentimento(clienteId: string, tipo: "servico" | "eventos" | "marketing", texto: string, origem: string) {
  const { data: ativo } = await db()
    .from("consentimentos")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("tipo", tipo)
    .eq("status", "ativo")
    .maybeSingle();
  if (ativo) return { ok: true, jaExistia: true };
  const { error } = await db().from("consentimentos").insert({ cliente_id: clienteId, tipo, texto, origem });
  return { ok: !error, jaExistia: false };
}

/** Opt-out: revoga TODOS os consentimentos e grava na lista de bloqueio permanente. */
export async function aplicarOptout(clienteId: string, telefone: string, palavra: string, origem = "whatsapp") {
  const agora = new Date().toISOString();
  await db()
    .from("consentimentos")
    .update({ status: "revogado", revogado_em: agora, revogado_origem: origem })
    .eq("cliente_id", clienteId)
    .eq("status", "ativo");
  await db().from("optouts").insert({ telefone, cliente_id: clienteId, palavra_detectada: palavra.slice(0, 60), origem });
  await db().from("campanha_envios").update({ status: "ignorado", erro: "optout" }).eq("cliente_id", clienteId).eq("status", "fila");
  await db().from("followups").update({ status: "cancelado", resultado: "optout" }).eq("cliente_id", clienteId).eq("status", "pendente");
}
