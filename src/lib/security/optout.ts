import { normalizar } from "./guard";

/**
 * Detecção de descadastro (regra 3). Determinística — não depende da IA.
 *
 * "CANCELAR" sozinho é ambíguo numa oficina: pode ser "cancelar meu agendamento".
 * Se o cliente tem agendamento ativo, perguntamos com botões; senão vale como opt-out.
 * "quero cancelar meu agendamento" (frase completa) NÃO é opt-out — vai pro fluxo de agenda.
 */
export type ResultadoOptout = "optout" | "ambiguo_cancelar" | null;

const PALAVRAS_EXATAS = new Set(["sair", "parar", "pare", "stop", "descadastrar", "remover", "unsubscribe"]);

const FRASES = [
  /\bnao quero (mais )?receber\b/,
  /\bnao (me )?(mande|mandem|envie|enviem) mais\b/,
  /\bpar(ar|e|em) de (me )?(mandar|enviar|receber)\b/,
  /\b(remov\w*|retir\w*|tir\w*|exclu\w*|apag\w*)\b.{0,12}\b(meu numero|meu telefone|meu contato|da lista|das mensagens)\b/,
  /\bdescadastr\w*\b/,
  /\bcancel\w* (o |a |as |os )?(recebimento|mensagens|inscricao na lista|notificacoes|promocoes|propagandas)\b/,
  /\bsair da lista\b/,
];

export function detectarOptout(texto: string): ResultadoOptout {
  const n = normalizar(texto).replace(/[.!,;:?]+/g, "").trim();
  if (!n) return null;
  if (PALAVRAS_EXATAS.has(n)) return "optout";
  if (n === "cancelar" || n === "cancela") return "ambiguo_cancelar";
  if (FRASES.some((re) => re.test(n))) return "optout";
  return null;
}

/** Pedido explícito de atendente humano. */
export function pediuAtendente(texto: string): boolean {
  const n = normalizar(texto);
  return /\b(atendente|humano|pessoa de verdade|falar com (alguem|uma pessoa|o gerente|um consultor|o vendedor|a equipe)|quero falar com)\b/.test(n);
}

/** Pedido LGPD (acesso, correção, exclusão de dados) — sempre vai para humano. */
export function pedidoLGPD(texto: string): boolean {
  const n = normalizar(texto);
  return /\b(lgpd|meus dados|apag\w* (os )?meus dados|exclu\w* (os )?meus dados|delet\w* (os )?meus dados|quais dados voces (tem|possuem)|direito (ao esquecimento|de acesso))\b/.test(n);
}
