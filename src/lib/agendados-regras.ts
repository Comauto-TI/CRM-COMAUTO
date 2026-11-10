/**
 * F2-4 — lembretes e mensagens agendadas: regras puras (testadas em tests/agendados.test.ts).
 */

export const ANTECEDENCIA_MAX_DIAS = 180;

/** O horário escolhido precisa ser no futuro (com 1 min de folga) e no máximo em 180 dias. */
export function validarHorario(quando: Date, agora: Date = new Date()): { ok: true } | { ok: false; motivo: string } {
  if (Number.isNaN(quando.getTime())) return { ok: false, motivo: "Data/hora inválida" };
  if (quando.getTime() < agora.getTime() + 60_000) return { ok: false, motivo: "Escolha um horário no futuro" };
  if (quando.getTime() > agora.getTime() + ANTECEDENCIA_MAX_DIAS * 86_400_000) return { ok: false, motivo: `No máximo ${ANTECEDENCIA_MAX_DIAS} dias à frente` };
  return { ok: true };
}

/**
 * Como a mensagem agendada pode sair NO MOMENTO do envio (regras da Meta + LGPD):
 *  - opt-out → nunca envia;
 *  - janela de 24h aberta → texto escrito pelo usuário;
 *  - janela fechada → só o template aprovado (o texto livre do usuário não pode sair).
 */
export function decidirEnvioAgendado(s: { optout: boolean; janelaAberta: boolean }): "bloquear_optout" | "livre" | "template" {
  if (s.optout) return "bloquear_optout";
  return s.janelaAberta ? "livre" : "template";
}

/** Texto amigável do motivo de bloqueio para quem agendou. */
export function explicarBloqueio(motivo: string): string {
  if (motivo.startsWith("sem_consentimento")) return "a janela de 24h fechou e o cliente não autorizou mensagens deste tipo";
  const m: Record<string, string> = {
    optout: "o cliente pediu para não receber mensagens",
    template_nao_aprovado: "a janela de 24h fechou e o modelo de mensagem ainda não foi aprovado pela Meta",
    template_inexistente: "a janela de 24h fechou e não há modelo de mensagem cadastrado",
    template_inativo: "a janela de 24h fechou e o modelo de mensagem está desativado",
    fora_horario: "fora do horário permitido para envio",
    cliente_anonimizado: "o cadastro do cliente foi anonimizado (LGPD)",
    cliente_indisponivel: "o cadastro do cliente não está disponível (LGPD)",
    cliente_inexistente: "o cliente não foi encontrado",
    verificacao_indisponivel: "não foi possível conferir o consentimento agora",
    resultado_incerto: "o envio foi interrompido e não dá para saber se chegou (confira com o cliente antes de reenviar)",
  };
  if (m[motivo]) return m[motivo];
  // código interno desconhecido (snake_case) → legível; erro devolvido pela Meta → mensagem padrão + detalhe curto
  if (/^[a-z0-9_]+$/.test(motivo)) return motivo.replace(/_/g, " ");
  return `o WhatsApp não aceitou o envio (${motivo.slice(0, 120)})`;
}
