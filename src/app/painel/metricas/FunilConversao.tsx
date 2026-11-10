import type { CSSProperties } from "react";
/** Funil contínuo da aba Métricas — desenho do Codex (codex/visual-funil), reaproveitado com classes fm-*. */
import type { faixaFunil } from "@/modulos/vendas/regras";

type Etapa = ReturnType<typeof faixaFunil>[number];
type Ponto = { x: number; y: number };

const LARGURA_ETAPA = 100;
const ALTURA_GRAFICO = 112;
const EIXO = ALTURA_GRAFICO / 2;
const ESPESSURA_MAXIMA = 90;

function centro(index: number): number {
  return (index + 0.5) * LARGURA_ETAPA;
}

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

function faixaContinua(etapas: Etapa[], largura: number): string {
  const alturas = etapas.map((etapa) => (etapa.pct / 100) * ESPESSURA_MAXIMA / 2);
  const centros = alturas.map((altura, index) => ({ x: centro(index), altura }));
  const pontos = [{ x: 0, altura: alturas[0] }, ...centros, { x: largura, altura: alturas[alturas.length - 1] }];
  const topo = pontos.map(({ x, altura }) => ({ x, y: EIXO - altura }));
  const base = pontos.slice().reverse().map(({ x, altura }) => ({ x, y: EIXO + altura }));
  return `M ${curva(topo)} L ${curva(base)} Z`;
}

export default function FunilConversao({
  id, etapas, ganhoId, titulo: tituloTexto = "Funil de conversão",
  subtitulo = "Até onde chegaram as oportunidades que entraram no período", periodo = "Últimos 90 dias", unidade = "oportunidade",
}: { id: string; etapas: Etapa[]; ganhoId?: string; titulo?: string; subtitulo?: string; periodo?: string; unidade?: string }) {
  const titulo = `fm-${id}-titulo`;
  const gradiente = `fm-${id}-cor`;
  const largura = etapas.length * LARGURA_ETAPA;
  const ultimaEtapaPreenchida = etapas.findLastIndex((etapa) => etapa.pct > 0);
  const temPercentuais = ultimaEtapaPreenchida >= 0;
  // A cor percorre a faixa preenchida, mesmo quando as últimas etapas estão zeradas.
  const fimDoGradiente = Math.min(largura, centro(ultimaEtapaPreenchida + 1));
  const temOportunidades = etapas.some((etapa) => etapa.quantidade > 0);

  return (
    <figure className="card fm-faixa" aria-labelledby={titulo}>
      <figcaption className="fm-cabecalho">
        <div>
          <h2 id={titulo}>{tituloTexto}</h2>
          <p>{subtitulo}</p>
        </div>
        <span className="fm-periodo">{periodo}</span>
      </figcaption>

      {etapas.length ? (
        <div className="fm-rolagem" role="region" aria-label="Etapas do funil" tabIndex={0}>
          <div className="fm-grade" style={{ "--funil-etapas": etapas.length } as CSSProperties}>
            {temPercentuais ? (
              <svg className="fm-grafico" viewBox={`0 0 ${largura} ${ALTURA_GRAFICO}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id={gradiente} gradientUnits="userSpaceOnUse" x1={0} x2={fimDoGradiente} y1={EIXO} y2={EIXO}>
                    <stop offset="0%" stopColor="var(--vw-azul)" />
                    <stop offset="47%" stopColor="#5053d7" />
                    <stop offset="77%" stopColor="#7b47c5" />
                    <stop offset="100%" stopColor="#a63baf" />
                  </linearGradient>
                </defs>
                {etapas.map((etapa, index) => (
                  <line key={etapa.etapa_id} className="fm-guia" x1={centro(index)} x2={centro(index)} y1={7} y2={ALTURA_GRAFICO - 7} />
                ))}
                <line className="fm-eixo" x1={0} x2={largura} y1={EIXO} y2={EIXO} />
                <path d={faixaContinua(etapas, largura)} fill={`url(#${gradiente})`} />
                {etapas.map((etapa, index) => (
                  <circle key={etapa.etapa_id} className={etapa.pct > 0 ? "fm-marca" : "fm-marca-zero"} cx={centro(index)} cy={EIXO} r={2.6} />
                ))}
              </svg>
            ) : (
              <p className="fm-vazio">{temOportunidades ? "Sem base para calcular os percentuais." : "Nenhuma oportunidade entrou no período."}</p>
            )}
            <ol className="fm-etapas">
              {etapas.map((etapa) => (
                <li key={etapa.etapa_id} className={`fm-etapa${etapa.pct === 0 ? " fm-etapa-zero" : etapa.etapa_id === ganhoId ? " fm-etapa-ganha" : ""}`}>
                  <strong className="fm-etapa-pct">{etapa.pct}%</strong>
                  <span className="fm-etapa-nome">{etapa.nome}</span>
                  <span className="fm-etapa-total">{etapa.quantidade} {etapa.quantidade === 1 ? unidade : `${unidade}s`}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="fm-vazio">Nenhuma etapa cadastrada.</p>
      )}
    </figure>
  );
}
