/**
 * Acompanhamento do dia na Oficina (regra pura, testável).
 * "Atrasado" é DERIVADO: pendente/confirmado cujo início já passou além da tolerância e ninguém marcou a chegada.
 * "Não veio" é sempre marcado por uma pessoa (sem automático).
 */
export type GrupoAcompanhamento = "atrasado" | "aguardando" | "veio" | "nao_veio" | "cancelado";

export const TOLERANCIA_PADRAO_MIN = 15;

export const GRUPOS: { chave: GrupoAcompanhamento; rotulo: string }[] = [
  { chave: "atrasado", rotulo: "Atrasados" },
  { chave: "aguardando", rotulo: "Aguardando" },
  { chave: "veio", rotulo: "Vieram" },
  { chave: "nao_veio", rotulo: "Não vieram" },
  { chave: "cancelado", rotulo: "Cancelados" },
];

export function minutosDeAtraso(inicioISO: string, agora: Date): number {
  return Math.floor((agora.getTime() - new Date(inicioISO).getTime()) / 60_000);
}

export function grupoDoAgendamento(a: { status: string; inicio: string }, agora: Date, toleranciaMin = TOLERANCIA_PADRAO_MIN): GrupoAcompanhamento {
  if (a.status === "compareceu") return "veio";
  if (a.status === "nao_compareceu") return "nao_veio";
  if (a.status === "cancelado") return "cancelado";
  return minutosDeAtraso(a.inicio, agora) > toleranciaMin ? "atrasado" : "aguardando";
}

/** "há 5 min", "há 1h20" — curto, para o selo do atraso. */
export function textoAtraso(min: number): string {
  if (min < 60) return `há ${Math.max(min, 0)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `há ${h}h${m ? String(m).padStart(2, "0") : ""}`;
}

export function resumoDoDia(grupos: GrupoAcompanhamento[]) {
  const c: Record<GrupoAcompanhamento, number> = { atrasado: 0, aguardando: 0, veio: 0, nao_veio: 0, cancelado: 0 };
  for (const g of grupos) c[g]++;
  const decididos = c.veio + c.nao_veio;
  return {
    ...c,
    total: grupos.length - c.cancelado,
    /** comparecimento entre os que já tiveram desfecho (veio ou não veio); null se nenhum ainda */
    taxaComparecimento: decididos ? Math.round((c.veio / decididos) * 100) : null,
  };
}
