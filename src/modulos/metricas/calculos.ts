/**
 * F8 — Métricas e previsões: cálculos puros (testados em tests/metricas.test.ts).
 * Princípio: todo número mostra a base (denominador). Com pouca base, dizemos isso em vez de inventar precisão.
 */

export type Desfecho = "aberta" | "ganho" | "perdido";
export type OpMetrica = {
  id: string;
  vendedor_id: string | null;
  origem: string;
  desfecho: Desfecho;
  valor: number | null;
  criado_em: string;
  fechado_em: string | null;
  motivo_perda: string | null;
  maior_ordem: number; // maior etapa NÃO-perdida que a oportunidade alcançou
};

export type LinhaConversao = { grupo: string; total: number; ganhos: number; perdidos: number; abertas: number; taxa: number | null };

/** Conversão por grupo (vendedor, origem...). Taxa = ganhos / (ganhos + perdidos); sem fechadas → null. */
export function conversaoPorGrupo(ops: OpMetrica[], chave: (o: OpMetrica) => string): LinhaConversao[] {
  const mapa = new Map<string, LinhaConversao>();
  for (const o of ops) {
    const g = chave(o);
    const l = mapa.get(g) ?? { grupo: g, total: 0, ganhos: 0, perdidos: 0, abertas: 0, taxa: null };
    l.total++;
    if (o.desfecho === "ganho") l.ganhos++;
    else if (o.desfecho === "perdido") l.perdidos++;
    else l.abertas++;
    mapa.set(g, l);
  }
  return [...mapa.values()]
    .map((l) => ({ ...l, taxa: l.ganhos + l.perdidos > 0 ? Math.round((l.ganhos / (l.ganhos + l.perdidos)) * 100) : null }))
    .sort((a, b) => b.total - a.total || a.grupo.localeCompare(b.grupo));
}

export function motivosDePerda(ops: OpMetrica[]): { motivo: string; quantidade: number; pct: number }[] {
  const perdidas = ops.filter((o) => o.desfecho === "perdido");
  const mapa = new Map<string, number>();
  for (const o of perdidas) mapa.set(o.motivo_perda?.trim() || "Sem motivo", (mapa.get(o.motivo_perda?.trim() || "Sem motivo") ?? 0) + 1);
  return [...mapa.entries()]
    .map(([motivo, quantidade]) => ({ motivo, quantidade, pct: Math.round((quantidade / perdidas.length) * 100) }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Tempo médio (dias) por etapa a partir das saídas registradas no histórico. */
export function tempoPorEtapa(saidas: { etapa_id: string; dias: number }[], etapas: { id: string; nome: string; ordem: number }[]) {
  return etapas
    .map((e) => {
      const d = saidas.filter((s) => s.etapa_id === e.id).map((s) => s.dias);
      return { etapa: e.nome, ordem: e.ordem, media: d.length ? Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10 : null, base: d.length };
    })
    .sort((a, b) => a.ordem - b.ordem);
}

/**
 * Chance de ganhar a partir de cada etapa (com base nas oportunidades JÁ FECHADAS):
 * das que chegaram até a etapa N, quantas % terminaram ganhas.
 */
export function chancePorEtapa(ops: OpMetrica[], ordens: number[]): Map<number, { chance: number | null; base: number }> {
  const fechadas = ops.filter((o) => o.desfecho !== "aberta");
  const r = new Map<number, { chance: number | null; base: number }>();
  for (const ordem of ordens) {
    const chegaram = fechadas.filter((o) => o.maior_ordem >= ordem);
    const ganhas = chegaram.filter((o) => o.desfecho === "ganho").length;
    r.set(ordem, { chance: chegaram.length ? ganhas / chegaram.length : null, base: chegaram.length });
  }
  return r;
}

export type Confianca = "sem_dados" | "baixa" | "media" | "boa";
export function confiancaPelaBase(base: number): Confianca {
  if (base === 0) return "sem_dados";
  if (base < 10) return "baixa";
  if (base < 40) return "media";
  return "boa";
}

/**
 * Previsão de vendas do mês, duas leituras lado a lado:
 *  - ritmo: ganhos até hoje projetados para o mês inteiro;
 *  - funil: ganhos até hoje + soma das chances das oportunidades abertas (pela etapa em que estão).
 * A confiança vem da quantidade de oportunidades fechadas usadas para calcular as chances.
 */
export function previsaoDoMes(args: {
  ganhosNoMes: number;
  diaDoMes: number;
  diasNoMes: number;
  abertas: { ordem: number }[];
  chances: Map<number, { chance: number | null; base: number }>;
  baseFechadas: number;
}) {
  const ritmo = args.diaDoMes > 0 ? Math.round((args.ganhosNoMes / args.diaDoMes) * args.diasNoMes) : args.ganhosNoMes;
  const esperadoAbertas = args.abertas.reduce((s, a) => s + (args.chances.get(a.ordem)?.chance ?? 0), 0);
  return {
    ritmo,
    funil: Math.round(args.ganhosNoMes + esperadoAbertas),
    esperadoAbertas: Math.round(esperadoAbertas * 10) / 10,
    confianca: confiancaPelaBase(args.baseFechadas),
  };
}

/** Funil de eventos: Chamados → Confirmados → Presentes → Vendidos (pessoas únicas, mesmo grupo). */
export function funilEvento(c: { chamados: Set<string>; confirmados: Set<string>; presentes: Set<string>; vendidos: Set<string> }) {
  // cada etapa só conta quem está no grupo da etapa anterior (passagem no mesmo grupo)
  const confirmados = new Set([...c.confirmados].filter((x) => c.chamados.has(x)));
  const presentes = new Set([...c.presentes].filter((x) => confirmados.has(x) || c.chamados.has(x)));
  const vendidos = new Set([...c.vendidos].filter((x) => presentes.has(x)));
  const base = c.chamados.size;
  const pct = (n: number) => (base > 0 ? Math.round((n / base) * 100) : 0);
  return [
    { etapa_id: "chamados", nome: "Chamados", quantidade: base, pct: base > 0 ? 100 : 0 },
    { etapa_id: "confirmados", nome: "Confirmados", quantidade: confirmados.size, pct: pct(confirmados.size) },
    { etapa_id: "presentes", nome: "Presentes", quantidade: presentes.size, pct: pct(presentes.size) },
    { etapa_id: "vendidos", nome: "Vendidos", quantidade: vendidos.size, pct: pct(vendidos.size) },
  ];
}

/**
 * Métricas por pessoa: monta o resumo do funil a partir das oportunidades de UM recorte (ex.: a carteira do vendedor),
 * com a mesma regra do vendas_funil_resumo — etapa aberta = quantos alcançaram até ali; ganho/perdido = desfecho atual.
 */
export function resumoDaCoorte(
  coorte: OpMetrica[],
  etapas: { id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido" }[],
): { etapa_id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido"; abertas: number; alcancaram: number }[] {
  return etapas.map((e) => ({
    etapa_id: e.id, nome: e.nome, ordem: e.ordem, tipo: e.tipo, abertas: 0,
    alcancaram: e.tipo === "aberta" ? coorte.filter((o) => o.maior_ordem >= e.ordem).length : coorte.filter((o) => o.desfecho === e.tipo).length,
  }));
}
