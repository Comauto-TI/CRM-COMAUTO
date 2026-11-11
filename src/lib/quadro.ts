/**
 * Quadro (Kanban) comum a todos os setores — regras puras, sem I/O.
 * Padrão visual do Simão: colunas por etapa com contagem e total, cartão com tempo de contato e semáforo.
 * Vendas, Peças e os próximos setores usam estas mesmas funções e o componente _components/quadro.
 */

/** Dias parado na etapa (inteiro, nunca negativo). */
export function diasNaEtapa(entrouEm: string | Date, agora: Date = new Date()): number {
  const t = new Date(entrouEm).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

/** "agora", "45 min atrás", "9 h atrás", "17 d atrás" (estilo do quadro de referência). */
export function tempoAtras(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const min = Math.max(0, Math.floor((agora.getTime() - t) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h atrás`;
  return `${Math.floor(h / 24)} d atrás`;
}

/** Semáforo do cartão: verde dentro do prazo, âmbar a partir de 70% do SLA, vermelho estourado. Sem SLA = neutro. */
export function semaforoEtapa(dias: number, slaDias: number | null): "ok" | "aviso" | "critico" | "neutro" {
  if (!slaDias) return "neutro";
  if (dias > slaDias) return "critico";
  if (dias >= Math.ceil(slaDias * 0.7)) return "aviso";
  return "ok";
}

/** Posição de um cartão solto entre dois vizinhos (ordem fracionária, sem renumerar a coluna). */
export function posicaoEntre(anterior: number | null, proximo: number | null): number {
  if (anterior === null && proximo === null) return 1000;
  if (anterior === null) return proximo! - 1000;
  if (proximo === null) return anterior + 1000;
  return (anterior + proximo) / 2;
}

export const ORDENACOES = { posicao: "Ordem do quadro", recentes: "Mais recentes", valor: "Maior valor", parado: "Parado há mais tempo", contato: "Sem contato há mais tempo" } as const;
export type Ordenacao = keyof typeof ORDENACOES;

/** Campos que todo cartão de qualquer setor precisa ter para ser ordenado. */
export type CamposOrdem = { posicao: number; criadoEm: string; valor: number | null; entrouEm: string; ultimoContatoEm: string | null };

/** Ordena os cartões de uma coluna conforme o filtro "Ordenar por". */
export function ordenarQuadro<T>(cartoes: T[], ordem: Ordenacao, campos: (c: T) => CamposOrdem): T[] {
  const t = (s: string | null) => (s ? new Date(s).getTime() : 0);
  const copia = [...cartoes];
  const k = (c: T) => campos(c);
  switch (ordem) {
    case "recentes": return copia.sort((a, b) => t(k(b).criadoEm) - t(k(a).criadoEm));
    case "valor": return copia.sort((a, b) => (k(b).valor ?? 0) - (k(a).valor ?? 0));
    case "parado": return copia.sort((a, b) => t(k(a).entrouEm) - t(k(b).entrouEm));
    case "contato": return copia.sort((a, b) => t(k(a).ultimoContatoEm) - t(k(b).ultimoContatoEm));
    default: return copia.sort((a, b) => k(a).posicao - k(b).posicao);
  }
}

/** Iniciais para o avatar do cartão ("Maria da Silva" → "MD"). */
export function iniciais(nome: string | null): string {
  return (nome ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}
