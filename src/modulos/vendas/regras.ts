/**
 * Setor Vendas — regras puras (sem I/O). Testadas em tests/vendas.test.ts.
 */
import type { Papel } from "@/lib/permissoes";

export const PAGAMENTOS = { a_vista: "À vista", financiamento: "Financiamento", consorcio: "Consórcio", indefinido: "A definir" } as const;
export const PRAZOS = { imediato: "Imediato", ate_30_dias: "Até 30 dias", ate_90_dias: "Até 90 dias", sem_prazo: "Sem prazo", indefinido: "A definir" } as const;
export const TEMPERATURAS = { frio: "Frio", morno: "Morno", quente: "Quente" } as const;
export const QUALIFICACOES = {
  a_verificar: "A verificar",
  confirmado_cliente: "Confirmado pelo cliente",
  qualificado: "Qualificado",
  desqualificado: "Desqualificado",
} as const;
export const TIPOS_ATIVIDADE = {
  ligacao: "Ligação", whatsapp: "WhatsApp", visita: "Visita", test_drive: "Test drive", proposta: "Proposta", nota: "Nota", email: "E-mail",
} as const;
export const MOTIVOS_PERDA = [
  "Preço / condição", "Comprou em outra loja", "Sem crédito aprovado", "Desistiu da compra",
  "Sem retorno do cliente", "Avaliação do usado", "Prazo de entrega", "Outro",
] as const;

export type Pagamento = keyof typeof PAGAMENTOS;
export type Prazo = keyof typeof PRAZOS;
export type Temperatura = keyof typeof TEMPERATURAS;
export type Qualificacao = keyof typeof QUALIFICACOES;
export type TipoAtividade = keyof typeof TIPOS_ATIVIDADE;

export const ehChave = <T extends object>(mapa: T, v: unknown): v is keyof T => typeof v === "string" && Object.hasOwn(mapa, v);

type QuemVende = { id: string; papel: Papel };

/** Gerente e admin veem o quadro inteiro da unidade; vendedor vê a carteira dele + leads sem dono. */
export function veTodasOportunidades(u: QuemVende): boolean {
  return u.papel === "admin" || u.papel === "gerente";
}

/** Mexer no cartão (mover, editar, registrar): dono, ou supervisor. Lead sem dono: qualquer vendedor pode assumir. */
export function podeMexer(u: QuemVende, op: { vendedor_id: string | null }): boolean {
  if (veTodasOportunidades(u)) return true;
  return op.vendedor_id === u.id;
}

export function podeAssumir(u: QuemVende, op: { vendedor_id: string | null }): boolean {
  return op.vendedor_id === null && (u.papel === "vendedor" || veTodasOportunidades(u));
}

/** Dias parado na etapa (inteiro, nunca negativo). */
export function diasNaEtapa(entrouEm: string | Date, agora: Date = new Date()): number {
  const t = new Date(entrouEm).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

/** Semáforo do cartão: verde dentro do prazo, âmbar a partir de 70% do SLA, vermelho estourado. Sem SLA = neutro. */
export function semaforoEtapa(dias: number, slaDias: number | null): "ok" | "aviso" | "critico" | "neutro" {
  if (!slaDias) return "neutro";
  if (dias > slaDias) return "critico";
  if (dias >= Math.ceil(slaDias * 0.7)) return "aviso";
  return "ok";
}

export type EtapaResumo = { etapa_id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido"; abertas: number; alcancaram: number };

/**
 * Faixa do funil (estilo do quadro de referência): % de quem ENTROU no funil e alcançou cada etapa.
 * A base é a 1ª etapa aberta. "Perdido" fica fora da faixa (vira indicador à parte).
 */
export function faixaFunil(etapas: EtapaResumo[]): { etapa_id: string; nome: string; quantidade: number; pct: number }[] {
  const ordenadas = etapas.filter((e) => e.tipo !== "perdido").sort((a, b) => a.ordem - b.ordem);
  const base = ordenadas[0]?.alcancaram ?? 0;
  return ordenadas.map((e) => ({
    etapa_id: e.etapa_id,
    nome: e.nome,
    quantidade: e.alcancaram,
    pct: base > 0 ? Math.round((Math.min(e.alcancaram, base) / base) * 100) : 0,
  }));
}

/** Taxa de conversão (ganhos / fechados). Sem fechados → null (não inventa número). */
export function taxaConversao(ganhos: number, perdidos: number): number | null {
  const total = ganhos + perdidos;
  return total > 0 ? Math.round((ganhos / total) * 100) : null;
}

/** Posição de um cartão solto entre dois vizinhos (ordem fracionária, sem renumerar a coluna). */
export function posicaoEntre(anterior: number | null, proximo: number | null): number {
  if (anterior === null && proximo === null) return 1000;
  if (anterior === null) return proximo! - 1000;
  if (proximo === null) return anterior + 1000;
  return (anterior + proximo) / 2;
}
