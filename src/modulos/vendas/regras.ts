/**
 * Setor Vendas — regras puras (sem I/O). Testadas em tests/vendas.test.ts.
 */
import { podeAcessar, type Papel, type Setor } from "@/lib/permissoes";
import { ordenarQuadro, type Ordenacao } from "@/lib/quadro";

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

// Quadro comum a todos os setores (src/lib/quadro.ts): reexportado para quem já importa daqui.
export { diasNaEtapa, tempoAtras, semaforoEtapa, posicaoEntre, ORDENACOES, type Ordenacao } from "@/lib/quadro";

/** Ordena os cartões de Vendas conforme o filtro "Ordenar por" (mesma regra do quadro comum). */
export function ordenarCartoes<T extends { posicao: number; criado_em: string; valor_estimado: number | null; entrou_na_etapa_em: string; ultimo_contato_em: string | null }>(
  cartoes: T[], ordem: Ordenacao,
): T[] {
  return ordenarQuadro(cartoes, ordem, (c) => ({
    posicao: c.posicao, criadoEm: c.criado_em, valor: c.valor_estimado, entrouEm: c.entrou_na_etapa_em, ultimoContatoEm: c.ultimo_contato_em,
  }));
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

/**
 * Valor em reais digitado no formulário (F1-V-001). Aceita "150.000", "150.000,50", "12500,5", "12500.5", "R$ 1.234,56".
 * Ponto só é separador de milhar quando vem em grupos de 3 dígitos; senão é decimal.
 */
export function lerValorBRL(entrada: string): number | null {
  const s = (entrada ?? "").replace(/[R$\s]/g, "");
  if (!s) return null;
  let normal: string;
  if (s.includes(",")) normal = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, "");
  else normal = s;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Valor do banco no formato do campo (ida e volta sem perder centavos): 12500.5 → "12.500,50". */
export function valorParaCampo(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}


// ---------------------------------------------------------------------------
// F2-1 — Chatbot → CRM: roteamento do lead qualificado pelo assistente
// ---------------------------------------------------------------------------
export const INTERESSES = ["novo", "seminovo", "oficina", "pecas", "indefinido"] as const;
export type Interesse = (typeof INTERESSES)[number];

/** Para onde vai o lead. Vendas vira cartão; oficina segue o agendamento; peças e incerto vão para pessoas. */
export function destinoDoLead(interesse: Interesse): { tipo: "funil"; funil: "novos" | "seminovos" } | { tipo: "agenda" } | { tipo: "pecas" } | { tipo: "triagem" } {
  if (interesse === "novo") return { tipo: "funil", funil: "novos" };
  if (interesse === "seminovo") return { tipo: "funil", funil: "seminovos" };
  if (interesse === "oficina") return { tipo: "agenda" };
  if (interesse === "pecas") return { tipo: "pecas" };
  return { tipo: "triagem" };
}

/**
 * Quem recebe o lead: o vendedor da carteira do cliente (se ainda ativo); senão rodízio —
 * o vendedor ativo com MENOS oportunidades abertas (empate: o que recebeu lead há mais tempo, depois o id).
 */
export function escolherVendedor(
  carteira: string | null,
  vendedores: { id: string; abertas: number; ultimoLeadEm: string | null }[],
): string | null {
  if (carteira && vendedores.some((v) => v.id === carteira)) return carteira;
  if (!vendedores.length) return null;
  const t = (s: string | null) => (s ? new Date(s).getTime() : 0);
  return [...vendedores].sort((a, b) => a.abertas - b.abertas || t(a.ultimoLeadEm) - t(b.ultimoLeadEm) || a.id.localeCompare(b.id))[0].id;
}

/**
 * Cliente voltou a falar com o assistente e já tem oportunidade aberta: o que pode ser atualizado.
 * Só entra dado CONCRETO da conversa ("a definir"/vazio não apaga o que existe) e a qualificação
 * nunca é rebaixada; a decisão do vendedor (qualificado/desqualificado) é soberana.
 */
export function completarQualificacao(
  atual: string,
  campos: { veiculo_interesse: string | null; pagamento: string; prazo_compra: string; tem_troca: boolean; troca_descricao: string | null },
  conversa: { temTroca: boolean | null; clienteConfirmou: boolean },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (campos.veiculo_interesse) patch.veiculo_interesse = campos.veiculo_interesse;
  if (campos.pagamento !== "indefinido") patch.pagamento = campos.pagamento;
  if (campos.prazo_compra !== "indefinido") patch.prazo_compra = campos.prazo_compra;
  if (conversa.temTroca !== null) {
    patch.tem_troca = conversa.temTroca;
    if (conversa.temTroca && campos.troca_descricao) patch.troca_descricao = campos.troca_descricao;
    if (!conversa.temTroca) patch.troca_descricao = null;
  }
  if (conversa.clienteConfirmou && atual === "a_verificar") patch.qualificacao = "confirmado_cliente";
  return patch;
}

/** Temperatura inicial pelo que o cliente disse (o vendedor ajusta depois). */
export function temperaturaInicial(prazo: Prazo, pagamentoDefinido: boolean): Temperatura {
  if (prazo === "imediato" || (prazo === "ate_30_dias" && pagamentoDefinido)) return "quente";
  if (prazo === "sem_prazo") return "frio";
  return "morno";
}

// ---------------------------------------------------------------------------
// Transferência de leads (caiu errado / férias)
// ---------------------------------------------------------------------------
export const MOTIVOS_TRANSFERENCIA = { errado: "Caiu no vendedor errado", ferias: "Férias", folga: "Folga / ausência", saiu: "Saiu da empresa", outro: "Outro" } as const;
export type MotivoTransferencia = keyof typeof MOTIVOS_TRANSFERENCIA;

/** Quem pode transferir um cartão: o dono dele ou um supervisor (gerente/admin). Lead sem dono: só supervisor. */
export function podeTransferir(u: { id: string; papel: Papel }, op: { vendedor_id: string | null }): boolean {
  if (veTodasOportunidades(u)) return true;
  return op.vendedor_id !== null && op.vendedor_id === u.id;
}

/**
 * F1-V-T001: quem pode RECEBER um lead transferido — ativo, vendedor ou gerente, com acesso atual à área Vendas
 * (gerente de outro setor não abre Vendas) e à unidade do cartão (principal ou adicional).
 */
export function podeReceberLead(
  p: { papel: string; setor: string; ativo: boolean; unidade: string; extras: readonly string[] },
  unidade: string,
): boolean {
  if (!p.ativo || (p.papel !== "vendedor" && p.papel !== "gerente")) return false;
  if (!podeAcessar({ papel: p.papel as Papel, setor: p.setor as Setor }, "vendas")) return false;
  return p.unidade === unidade || p.extras.includes(unidade);
}

/**
 * Férias: divide N cartões entre os vendedores que ficam, um por vez para quem está com MENOS abertas no momento
 * (empate: quem recebeu lead há mais tempo, depois o id). Devolve o id escolhido para cada cartão, na ordem.
 */
export function distribuirRodizio(quantidade: number, vendedores: { id: string; abertas: number; ultimoLeadEm: string | null }[]): string[] {
  if (!vendedores.length || quantidade <= 0) return [];
  const carga = vendedores.map((v) => ({ ...v }));
  const destino: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    const escolhido = escolherVendedor(null, carga)!;
    destino.push(escolhido);
    const v = carga.find((x) => x.id === escolhido)!;
    v.abertas++;
    v.ultimoLeadEm = new Date(Date.UTC(2100, 0, 1, 0, 0, i)).toISOString(); // recebeu agora → vai para o fim do empate
  }
  return destino;
}
