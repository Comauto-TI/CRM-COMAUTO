import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { formatarBRL, formatarDataHora } from "@/lib/time";
import { getConfig } from "@/lib/config";
import { nucleoAplicado } from "@/lib/usuarios";
import { vendasDisponivel } from "@/modulos/vendas/dados";
import { carregarMetricasVendas, listarEventos, carregarFunilEvento, PERIODOS, type Periodo } from "@/modulos/metricas/dados";
import {
  conversaoPorGrupo, motivosDePerda, tempoPorEtapa, chancePorEtapa, previsaoDoMes, funilEvento, confiancaPelaBase, type Confianca,
} from "@/modulos/metricas/calculos";
import { Cabecalho, Kpi, Vazio } from "../_components/ui";
import FunilConversao from "./FunilConversao";

type SP = { funil?: string; periodo?: string; evento?: string };

const ORIGEM: Record<string, string> = { whatsapp: "WhatsApp", qr: "QR Code", evento: "Evento", campanha: "Campanha", painel: "Cadastro manual", importacao: "Importação" };
const CONFIANCA: Record<Confianca, [string, string]> = {
  sem_dados: ["", "sem dados ainda"], baixa: ["aviso", "confiança baixa — poucos negócios fechados"],
  media: ["info", "confiança média"], boa: ["ok", "confiança boa"],
};

/** Barras horizontais simples (uma cor, rótulo direto): magnitude relativa ao maior valor da lista. */
function Barras({ linhas, formato = (n: number) => String(n) }: { linhas: { rotulo: string; valor: number; extra?: string }[]; formato?: (n: number) => string }) {
  const max = Math.max(1, ...linhas.map((l) => l.valor));
  return (
    <ul className="mt-barras">
      {linhas.map((l) => (
        <li key={l.rotulo}>
          <span className="mt-barras-rotulo" title={l.rotulo}>{l.rotulo}</span>
          <span className="mt-barras-trilho"><span className="mt-barras-valor" style={{ width: `${Math.max(2, (l.valor / max) * 100)}%` }} /></span>
          <span className="mt-barras-num">{formato(l.valor)}{l.extra ? <small> {l.extra}</small> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function Metricas({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await exigirAcesso("metricas");
  const sp = await searchParams;
  const cfg = await getConfig();
  if (!(await nucleoAplicado()) || !(await vendasDisponivel())) {
    return (<><Cabecalho titulo="Métricas" /><Vazio>As métricas ficam disponíveis depois da atualização do banco (núcleo e vendas).</Vazio></>);
  }

  const periodo: Periodo = sp.periodo && sp.periodo in PERIODOS ? (sp.periodo as Periodo) : "90";
  const [m, eventos] = await Promise.all([carregarMetricasVendas(u, sp.funil, periodo), listarEventos(u)]);
  if (!m) return (<><Cabecalho titulo="Métricas" /><Vazio>Nenhum funil de vendas configurado para a unidade.</Vazio></>);
  const eventoId = sp.evento ?? eventos[0]?.id;
  const ev = eventoId ? await carregarFunilEvento(u, eventoId) : null;

  const ganhos = m.coorte.filter((o) => o.desfecho === "ganho");
  const perdidos = m.coorte.filter((o) => o.desfecho === "perdido");
  const fechados = ganhos.length + perdidos.length;
  const conversao = fechados ? Math.round((ganhos.length / fechados) * 100) : null;
  const valorGanho = ganhos.reduce((s, o) => s + (o.valor ?? 0), 0);
  const diasAteFechar = m.coorte.filter((o) => o.fechado_em).map((o) => (new Date(o.fechado_em!).getTime() - new Date(o.criado_em).getTime()) / 86_400_000);
  const cicloMedio = diasAteFechar.length ? Math.round(diasAteFechar.reduce((a, b) => a + b, 0) / diasAteFechar.length) : null;

  const porVendedor = conversaoPorGrupo(m.coorte, (o) => (o.vendedor_id ? m.nomesVendedores[o.vendedor_id] ?? "Vendedor" : "Sem vendedor"));
  const porOrigem = conversaoPorGrupo(m.coorte, (o) => ORIGEM[o.origem] ?? o.origem);
  const motivos = motivosDePerda(m.coorte);
  const tempos = tempoPorEtapa(m.saidas, m.etapas.filter((e) => e.tipo === "aberta"));

  const agora = new Date();
  const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const chances = chancePorEtapa(m.fechadasAno, m.etapas.filter((e) => e.tipo === "aberta").map((e) => e.ordem));
  const prev = previsaoDoMes({ ganhosNoMes: m.ganhosNoMes.length, diaDoMes: agora.getDate(), diasNoMes, abertas: m.abertasAgora, chances, baseFechadas: m.fechadasAno.length });
  const [corConf, textoConf] = CONFIANCA[prev.confianca];

  const qs = (extra: Record<string, string | undefined>) => {
    const n = new URLSearchParams({ funil: m.funil.chave, periodo, ...(eventoId ? { evento: eventoId } : {}) });
    for (const [k, v] of Object.entries(extra)) { if (v) n.set(k, v); else n.delete(k); }
    return `/painel/metricas?${n}`;
  };
  const rotuloPeriodo = PERIODOS[periodo];

  return (
    <>
      <Cabecalho titulo="Métricas" sub={`Vendas e eventos · ${u.unidades.length > 1 ? "suas unidades" : "unidade " + u.unidade} · dados do sistema, sem estimativa onde não há base`}>
        <nav className="abas-funil" aria-label="Funis">
          {m.funis.map((f) => <Link key={f.id} href={qs({ funil: f.chave })} className={f.id === m.funil.id ? "ativo" : ""}>{f.nome}</Link>)}
        </nav>
        <form className="linha-form">
          <input type="hidden" name="funil" value={m.funil.chave} />
          {eventoId && <input type="hidden" name="evento" value={eventoId} />}
          <select name="periodo" defaultValue={periodo} aria-label="Período">
            {Object.entries(PERIODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn">Aplicar</button>
        </form>
      </Cabecalho>

      {m.parcial && <div className="alerta aviso">Volume muito grande: estes números usam as primeiras 50.000 oportunidades do recorte e estão PARCIAIS. Reduza o período.</div>}
      <div className="grade g4">
        <Kpi rotulo={`Oportunidades (${m.funil.nome})`} valor={m.coorte.length} sub={`entraram nos ${rotuloPeriodo.toLowerCase()}`} />
        <Kpi rotulo="Conversão" valor={conversao === null ? "—" : `${conversao}%`} sub={`${ganhos.length} ganhas de ${fechados} fechadas`} />
        <Kpi rotulo="Valor ganho" valor={formatarBRL(valorGanho)} sub={ganhos.length ? `${ganhos.filter((o) => o.valor == null).length} sem valor informado` : "nenhuma venda no período"} />
        <Kpi rotulo="Ciclo médio" valor={cicloMedio === null ? "—" : `${cicloMedio} dias`} sub="da entrada até fechar (ganha ou perdida)" />
      </div>

      <div className="mt-topo secao">
        <FunilConversao id={`vendas-${m.funil.id}`} etapas={m.faixa} ganhoId={m.ganhoId} periodo={rotuloPeriodo}
          subtitulo={`${m.funil.nome}: até onde chegaram as oportunidades que entraram no período`} />
        <section className="card mt-previsao">
          <h2>Previsão do mês</h2>
          <p className="mudo">Vendas {m.funil.nome.toLowerCase()} em {agora.toLocaleString("pt-BR", { month: "long" })}</p>
          <div className="mt-previsao-numeros">
            <div><span className="mudo">Fechadas até hoje</span><strong>{m.ganhosNoMes.length}</strong></div>
            <div><span className="mudo">No ritmo atual</span><strong>{prev.ritmo}</strong><small className="mudo">projeção para {diasNoMes} dias</small></div>
            <div><span className="mudo">Pelo funil</span><strong>{prev.funil}</strong><small className="mudo">+{String(prev.esperadoAbertas).replace(".", ",")} esperadas das {m.abertasAgora.length} abertas</small></div>
          </div>
          <span className={`tag ${corConf}`}>{textoConf}</span>
          <p className="mudo mt-nota">&quot;Pelo funil&quot; usa a chance histórica de fechar a partir de cada etapa, calculada com {m.fechadasAno.length} negócios fechados nos últimos 12 meses. Melhora conforme o sistema junta dados.</p>
        </section>
      </div>

      <div className="grade g2 secao">
        <section className="card">
          <h2>Conversão por vendedor</h2>
          {!porVendedor.length ? <Vazio>Sem oportunidades no período.</Vazio> : (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead><tr><th>Vendedor</th><th className="num">Oport.</th><th className="num">Ganhas</th><th className="num">Perdidas</th><th className="num">Abertas</th><th className="num">Conversão</th></tr></thead>
                <tbody>{porVendedor.map((l) => (
                  <tr key={l.grupo}><td>{l.grupo}</td><td className="num">{l.total}</td><td className="num">{l.ganhos}</td><td className="num">{l.perdidos}</td><td className="num">{l.abertas}</td>
                    <td className="num">{l.taxa === null ? <span className="mudo">—</span> : `${l.taxa}%`}{l.taxa !== null && confiancaPelaBase(l.ganhos + l.perdidos) === "baixa" && <small className="mudo"> (poucos)</small>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <h2>Conversão por origem</h2>
          {!porOrigem.length ? <Vazio>Sem oportunidades no período.</Vazio> : (
            <Barras linhas={porOrigem.map((l) => ({ rotulo: l.grupo, valor: l.total, extra: l.taxa === null ? "· sem fechadas" : `· ${l.taxa}% convertem` }))} />
          )}
          <p className="mudo mt-nota">Barra = oportunidades que entraram por cada origem no período. Conversão = ganhas ÷ fechadas.</p>
        </section>
      </div>

      <div className="grade g2 secao">
        <section className="card">
          <h2>Tempo médio por etapa</h2>
          {!tempos.some((t) => t.media !== null) ? <Vazio>Ainda não há cartões que saíram de uma etapa no período.</Vazio> : (
            <Barras linhas={tempos.map((t) => ({ rotulo: t.etapa, valor: t.media ?? 0, extra: t.base ? `· ${t.base} saídas` : "· sem dados" }))} formato={(n) => `${String(n).replace(".", ",")} d`} />
          )}
        </section>
        <section className="card">
          <h2>Por que perdemos</h2>
          {!motivos.length ? <Vazio>Nenhuma perda registrada no período.</Vazio> : (
            <Barras linhas={motivos.map((x) => ({ rotulo: x.motivo, valor: x.quantidade, extra: `· ${x.pct}%` }))} />
          )}
        </section>
      </div>

      <section className="secao">
        <div className="mt-evento-cabecalho">
          <h2>Funil de eventos</h2>
          {eventos.length > 0 && (
            <form className="linha-form">
              <input type="hidden" name="funil" value={m.funil.chave} /><input type="hidden" name="periodo" value={periodo} />
              <select name="evento" defaultValue={eventoId} aria-label="Evento">
                {eventos.map((e) => <option key={e.id} value={e.id}>{e.nome} · {formatarDataHora(e.inicio, cfg.fuso_offset).split(" às")[0]}</option>)}
              </select>
              <button className="btn">Ver</button>
            </form>
          )}
        </div>
        {!ev ? <Vazio>Nenhum evento ativo ou encerrado ainda.</Vazio> : (
          <div className="mt-topo">
            <FunilConversao id={`evento-${ev.evento.id}`} etapas={funilEvento(ev.conjuntos)} ganhoId="vendidos" unidade="pessoa"
              titulo={ev.evento.nome} periodo={formatarDataHora(ev.evento.inicio, cfg.fuso_offset).split(" às")[0]}
              subtitulo="Pessoas únicas: chamadas → confirmaram → compareceram → compraram" />
            <section className="card mt-previsao">
              <h2>Detalhamento</h2>
              <ul className="lista-simples">
                <li><span>Leram o convite</span><strong>{ev.detalhe.lidos}</strong></li>
                <li><span>Responderam</span><strong>{ev.detalhe.responderam}</strong></li>
                <li><span>Recusaram</span><strong>{ev.detalhe.recusaram}</strong></li>
                <li><span>Lista de espera</span><strong>{ev.detalhe.listaEspera}</strong></li>
                <li><span>Inscrições espontâneas (fora dos chamados)</span><strong>{ev.detalhe.espontaneas}</strong></li>
                <li><span>Presentes que compraram em até {ev.janelaDias} dias (aproximação)</span><strong>{ev.detalhe.compraramJanela}</strong></li>
              </ul>
              <p className="mudo mt-nota">Chamados = convite entregue pela campanha do evento. Vendidos = venda ganha atribuída a este evento. A compra em até {ev.janelaDias} dias é só indicador, sem atribuição.</p>
            </section>
          </div>
        )}
      </section>
    </>
  );
}
