/**
 * Decisão PURA de envio (sem I/O) — aplica as regras da Meta/LGPD na ordem certa.
 * Testável isoladamente (tests/outbound-rules.test.ts).
 */

export type Finalidade = "servico" | "eventos" | "marketing";

export type EntradaDecisao = {
  clienteAnonimizado: boolean;
  optout: boolean;
  template: { aprovado: boolean; ativo: boolean; finalidade: Finalidade; categoria: string } | null;
  consentimentos: Finalidade[]; // tipos com consentimento ATIVO
  janelaAberta: boolean;
  dentroHorario: boolean;
  preferirLivre: boolean; // notificação operacional pode ir como texto livre se a janela estiver aberta
  ignorarHorario?: boolean; // ex.: alerta interno para a recepção
};

export type Decisao =
  | { acao: "livre" }
  | { acao: "template" }
  | { acao: "bloquear"; motivo: string };

export function decidirEnvio(e: EntradaDecisao): Decisao {
  if (e.clienteAnonimizado) return { acao: "bloquear", motivo: "cliente_anonimizado" };
  if (e.optout) return { acao: "bloquear", motivo: "optout" };

  const finalidade = e.template?.finalidade ?? "servico";
  if (!e.consentimentos.includes(finalidade)) return { acao: "bloquear", motivo: `sem_consentimento_${finalidade}` };

  // Marketing/eventos: só no horário comercial configurado (anti-spam)
  if (finalidade !== "servico" && !e.dentroHorario && !e.ignorarHorario) {
    return { acao: "bloquear", motivo: "fora_horario" };
  }

  // Operacional com janela aberta: texto livre (dentro da janela não precisa template)
  if (e.preferirLivre && e.janelaAberta && finalidade === "servico") return { acao: "livre" };

  if (!e.template) return { acao: "bloquear", motivo: "template_inexistente" };
  if (!e.template.ativo) return { acao: "bloquear", motivo: "template_inativo" };
  if (!e.template.aprovado) return { acao: "bloquear", motivo: "template_nao_aprovado" };
  return { acao: "template" };
}

/** Preenche {{1}}, {{2}}... do corpo de exemplo (para a versão em texto livre e para o histórico). */
export function preencherCorpo(corpo: string, valores: string[]): string {
  return corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? "");
}
