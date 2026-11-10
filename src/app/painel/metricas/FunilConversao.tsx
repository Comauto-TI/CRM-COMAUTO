import type { CSSProperties } from "react";
import type { faixaFunil } from "@/modulos/vendas/regras";

/**
 * Funil da aba Métricas no estilo da referência do Simão: faixa larga em camadas translúcidas que afunila
 * (azul → roxo → rosa), % dentro de cada trecho com divisórias, e etapa + quantidade embaixo.
 * Partiu do desenho do Codex (codex/visual-funil). A espessura é ilustrativa (tem um mínimo para caber o
 * texto); o número que vale é o % escrito.
 */
type Etapa = ReturnType<typeof faixaFunil>[number];
type Ponto = { x: number; y: number };

const LARGURA_ETAPA = 100;
const ALTURA = 140;
const EIXO = ALTURA / 2;
const MEIA_MAX = 56; // meia-espessura da faixa principal em 100%
const MEIA_MIN = 12; // mínimo para o % caber dentro
const CAMADAS = [{ extra: 16, opacidade: 0.1 }, { extra: 8, opacidade: 0.2 }]; // halos atrás da faixa

function curva(pontos: Ponto[]): string {
  let anterior = pontos[0];
  let caminho = `${anterior.x} ${anterior.y}`;
  for (const ponto of pontos.slice(1)) {
    const meio = (anterior.x + ponto.x) / 2;
    caminho += ` C ${meio} ${anterior.y} ${meio} ${ponto.y} ${ponto.x} ${ponto.y}`;
    anterior = ponto;
  }
  return caminho;
}

/** Espessura de cada etapa proporcional ao % real (com mínimo só para o número caber dentro). */
function espessuras(etapas: Etapa[]): number[] {
  return etapas.map((e) => MEIA_MIN + (Math.max(0, Math.min(100, e.pct)) / 100) * (MEIA_MAX - MEIA_MIN));
}

/**
 * Faixa que estreita DE POUCO EM POUCO: a espessura de cada etapa fica no centro dela e a curva desce
 * suavemente até o centro da próxima (sem patamar reto nem "pescoço" perto da divisória).
 */
function faixa(etapas: Etapa[], extra = 0): string {
  const hs = espessuras(etapas).map((h) => h + extra);
  const centro = (i: number) => (i + 0.5) * LARGURA_ETAPA;
  const pontos = [{ x: 0, h: hs[0] }, ...hs.map((h, i) => ({ x: centro(i), h })), { x: etapas.length * LARGURA_ETAPA, h: hs[hs.length - 1] }];
  const topo = pontos.map(({ x, h }) => ({ x, y: EIXO - h }));
  const base = pontos.slice().reverse().map(({ x, h }) => ({ x, y: EIXO + h }));
  return `M ${curva(topo)} L ${curva(base)} Z`;
}

const formatar = (n: number) => n.toLocaleString("pt-BR");

export default function FunilConversao({
  id, etapas, ganhoId, titulo: tituloTexto = "Funil de conversão",
  subtitulo = "Até onde chegaram as oportunidades que entraram no período", periodo = "Últimos 90 dias", unidade = "oportunidade",
}: { id: string; etapas: Etapa[]; ganhoId?: string; titulo?: string; subtitulo?: string; periodo?: string; unidade?: string }) {
  const titulo = `fm-${id}-titulo`;
  const gradiente = `fm-${id}-cor`;
  const largura = etapas.length * LARGURA_ETAPA;
  const temBase = etapas.some((e) => e.quantidade > 0);

  return (
    <figure className="card fm-faixa" aria-labelledby={titulo}>
      <figcaption className="fm-cabecalho">
        <div>
          <h2 id={titulo}>{tituloTexto}</h2>
          <p>{subtitulo}</p>
        </div>
        <span className="fm-periodo">{periodo}</span>
      </figcaption>

      {!etapas.length ? (
        <p className="fm-vazio">Nenhuma etapa cadastrada.</p>
      ) : (
        <div className="fm-rolagem" role="region" aria-label="Etapas do funil" tabIndex={0}>
          <div className="fm-grade" style={{ "--funil-etapas": etapas.length } as CSSProperties}>
            <div className="fm-area">
              <svg className="fm-grafico" viewBox={`0 0 ${largura} ${ALTURA}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id={gradiente} gradientUnits="userSpaceOnUse" x1={0} x2={largura} y1={EIXO} y2={EIXO}>
                    <stop offset="0%" stopColor="#1f5bff" />
                    <stop offset="45%" stopColor="#5b5cf0" />
                    <stop offset="75%" stopColor="#9b4fe0" />
                    <stop offset="100%" stopColor="#e070d8" />
                  </linearGradient>
                  {/* fim que esmaece (como na referência) */}
                  <linearGradient id={`${gradiente}-fade`} gradientUnits="userSpaceOnUse" x1={0} x2={largura} y1={0} y2={0}>
                    <stop offset="0%" stopColor="#fff" />
                    <stop offset="88%" stopColor="#fff" />
                    <stop offset="100%" stopColor="#fff" stopOpacity="0.15" />
                  </linearGradient>
                  <mask id={`${gradiente}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={largura} height={ALTURA}>
                    <rect x={0} y={0} width={largura} height={ALTURA} fill={`url(#${gradiente}-fade)`} />
                  </mask>
                </defs>
                <g mask={`url(#${gradiente}-mask)`}>
                {temBase && CAMADAS.map((c) => (
                  <path key={c.extra} d={faixa(etapas, c.extra)} fill={`url(#${gradiente})`} opacity={c.opacidade} />
                ))}
                <path d={faixa(etapas)} fill={temBase ? `url(#${gradiente})` : "var(--superficie-3)"} />
                </g>
                {etapas.slice(1).map((e, i) => (
                  <line key={e.etapa_id} className="fm-divisoria" x1={(i + 1) * LARGURA_ETAPA} x2={(i + 1) * LARGURA_ETAPA} y1={EIXO - MEIA_MAX - 18} y2={EIXO + MEIA_MAX + 18} />
                ))}
              </svg>
              {/* % por cima do SVG em HTML (texto em SVG esticado com preserveAspectRatio="none" ficaria deformado) */}
              <div className="fm-pcts" aria-hidden="true">
                {etapas.map((e) => <span key={e.etapa_id} className={temBase ? "" : "fm-pct-vazio"}>{e.pct}%</span>)}
              </div>
            </div>
            <ol className="fm-etapas">
              {etapas.map((e) => (
                <li key={e.etapa_id} className={`fm-etapa${e.etapa_id === ganhoId ? " fm-etapa-ganha" : ""}`}>
                  <span className="fm-etapa-nome">{e.nome}</span>
                  <strong className="fm-etapa-qtd">{formatar(e.quantidade)}</strong>
                  <span className="sr-only">{e.pct}% — {e.quantidade} {e.quantidade === 1 ? unidade : `${unidade}s`}</span>
                </li>
              ))}
            </ol>
            {!temBase && <p className="fm-aviso">Nenhuma {unidade} entrou no período ainda.</p>}
          </div>
        </div>
      )}
    </figure>
  );
}
