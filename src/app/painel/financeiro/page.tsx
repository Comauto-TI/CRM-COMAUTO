import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarBRL, localParaUtc, dataLocalISO } from "@/lib/time";
import { precoMeta } from "@/lib/costs";
import { Cabecalho, Kpi } from "../_components/ui";

const ROTULO: Record<string, string> = {
  meta_marketing: "WhatsApp · Marketing",
  meta_utility: "WhatsApp · Utility",
  meta_service: "WhatsApp · Serviço",
  meta_authentication: "WhatsApp · Autenticação",
  ia_anthropic: "IA · Claude Haiku",
  infra: "Infraestrutura (fixos)",
  outro: "Outros",
};

// Séries do gráfico diário (infra é mensal e fica fora do gráfico)
const SERIES = [
  { chave: "meta_marketing", rotulo: "Marketing", cor: "var(--serie-1)" },
  { chave: "meta_utility", rotulo: "Utility", cor: "var(--serie-2)" },
  { chave: "meta_service+meta_authentication", rotulo: "Serviço/Autenticação", cor: "var(--serie-3)" },
  { chave: "ia_anthropic", rotulo: "IA", cor: "var(--serie-4)" },
];

type Sp = { mes?: string; convidados?: string; utilities?: string; resposta?: string; interacoes?: string };

export default async function Financeiro({ searchParams }: { searchParams: Promise<Sp> }) {
  await exigirAcesso("financeiro");
  const cfg = await getConfig();
  const off = cfg.fuso_offset;
  const sp = await searchParams;
  const mesAtual = dataLocalISO(new Date(), off).slice(0, 7);
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : mesAtual;
  const [ano, m] = mes.split("-").map(Number);
  const ini = localParaUtc(`${mes}-01`, "00:00", off);
  const proxMes = m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;
  const fim = localParaUtc(`${proxMes}-01`, "00:00", off);
  const p = { p_inicio: ini.toISOString(), p_fim: fim.toISOString() };

  const [resumo, diarios, campanhas, ia, metaMsgs, agConf, conversas, fixos, inscr, origens] = await Promise.all([
    db().rpc("resumo_custos", p),
    db().rpc("custos_diarios", p),
    db().rpc("custos_por_campanha", p),
    db().from("custos").select("valor_brl, valor_usd, quantidade, metadata").eq("categoria", "ia_anthropic").gte("ocorrido_em", p.p_inicio).lt("ocorrido_em", p.p_fim).limit(50000),
    db().from("custos").select("descricao, valor_brl").like("categoria", "meta_%").gte("ocorrido_em", p.p_inicio).lt("ocorrido_em", p.p_fim).limit(100000),
    db().from("agendamentos").select("id", { count: "exact", head: true }).in("status", ["confirmado", "compareceu"]).gte("criado_em", p.p_inicio).lt("criado_em", p.p_fim),
    db().from("mensagens").select("cliente_id").eq("direcao", "entrada").gte("criado_em", p.p_inicio).lt("criado_em", p.p_fim).limit(100000),
    db().from("custos_fixos").select("nome, valor, moeda, recorrencia, ativo").order("nome"),
    db().from("inscricoes_evento").select("id", { count: "exact", head: true }).eq("status", "confirmado").gte("confirmado_em", p.p_inicio).lt("confirmado_em", p.p_fim),
    db().from("agendamentos").select("clientes(origem)").in("status", ["confirmado", "compareceu"]).gte("criado_em", p.p_inicio).lt("criado_em", p.p_fim).limit(50000),
  ]);
  const porOrigem = new Map<string, number>();
  for (const a of (origens.data ?? []) as unknown as { clientes: { origem: string } | null }[]) {
    const o = a.clientes?.origem ?? "whatsapp";
    porOrigem.set(o, (porOrigem.get(o) ?? 0) + 1);
  }

  const cats = (resumo.data ?? []) as { categoria: string; quantidade: number; total_brl: number; total_usd: number }[];
  const total = cats.reduce((s, c) => s + Number(c.total_brl), 0);
  const soma = (pref: string) => cats.filter((c) => c.categoria.startsWith(pref)).reduce((s, c) => s + Number(c.total_brl), 0);
  const totalMeta = soma("meta_");
  const totalIA = soma("ia_");
  const totalInfra = soma("infra");
  const clientesUnicos = new Set((conversas.data ?? []).map((x) => x.cliente_id)).size;
  const agendamentos = agConf.count ?? 0;

  // projeção do mês corrente
  const diasMes = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const diaHoje = mes === mesAtual ? Number(dataLocalISO(new Date(), off).slice(8, 10)) : diasMes;
  const variavel = total - totalInfra;
  const projecao = mes === mesAtual ? (variavel / Math.max(diaHoje, 1)) * diasMes + totalInfra : total;

  // IA detalhada
  const tok = { in: 0, out: 0, cr: 0, cw: 0, chamadas: 0, usd: 0 };
  for (const r of (ia.data ?? []) as { valor_usd: number | null; quantidade: number; metadata: Record<string, number> }[]) {
    tok.in += r.metadata.input_tokens ?? 0;
    tok.out += r.metadata.output_tokens ?? 0;
    tok.cr += r.metadata.cache_read_input_tokens ?? 0;
    tok.cw += r.metadata.cache_creation_input_tokens ?? 0;
    tok.chamadas += Number(r.quantidade);
    tok.usd += Number(r.valor_usd ?? 0);
  }
  const totalEntrada = tok.in + tok.cr + tok.cw;
  const cacheHit = totalEntrada ? (tok.cr / totalEntrada) * 100 : 0;

  // mensagens Meta por template
  const porTemplate = new Map<string, { qtd: number; total: number }>();
  for (const r of metaMsgs.data ?? []) {
    const k = r.descricao as string;
    const v = porTemplate.get(k) ?? { qtd: 0, total: 0 };
    v.qtd++;
    v.total += Number(r.valor_brl);
    porTemplate.set(k, v);
  }

  // série diária
  const dias = new Map<string, Record<string, number>>();
  for (let d = 1; d <= diasMes; d++) dias.set(`${mes}-${String(d).padStart(2, "0")}`, {});
  for (const r of (diarios.data ?? []) as { dia: string; categoria: string; total_brl: number }[]) {
    const reg = dias.get(String(r.dia).slice(0, 10));
    if (reg) reg[r.categoria] = (reg[r.categoria] ?? 0) + Number(r.total_brl);
  }
  const valorSerie = (reg: Record<string, number>, chave: string) => chave.split("+").reduce((s, k) => s + (reg[k] ?? 0), 0);
  const maxDia = Math.max(0.01, ...[...dias.values()].map((reg) => SERIES.reduce((s, x) => s + valorSerie(reg, x.chave), 0)));

  // simulador de evento (mesma conta do PDF)
  const sim = {
    convidados: Math.max(0, Number(sp.convidados ?? 2000)),
    utilities: Math.max(0, Number(sp.utilities ?? 3)),
    resposta: Math.min(100, Math.max(0, Number(sp.resposta ?? 30))),
    interacoes: Math.max(0, Number(sp.interacoes ?? 2)),
  };
  const [pMkt, pUtil] = await Promise.all([precoMeta("MARKETING"), precoMeta("UTILITY")]);
  const custoInteracaoUSD = (1500 * cfg.claude_preco.cache_read + 80 * cfg.claude_preco.input + 120 * cfg.claude_preco.output) / 1_000_000;
  const simMkt = sim.convidados * pMkt;
  const simUtil = sim.convidados * sim.utilities * pUtil;
  const simIA = sim.convidados * (sim.resposta / 100) * sim.interacoes * custoInteracaoUSD * cfg.cambio_usd_brl;

  const fixosMes = (fixos.data ?? []).filter((f) => f.ativo).map((f) => {
    const v = f.recorrencia === "anual" ? Number(f.valor) / 12 : Number(f.valor);
    return { ...f, brl: f.moeda === "USD" ? v * cfg.cambio_usd_brl : v };
  });

  const meses = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(mesAtual.slice(0, 4)), Number(mesAtual.slice(5, 7)) - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });

  return (
    <>
      <Cabecalho titulo="Financeiro" sub={`Custos reais lançados: WhatsApp por mensagem entregue (categoria informada pela Meta), IA pelo uso de tokens e fixos no dia 1. Câmbio: R$ ${cfg.cambio_usd_brl.toFixed(2)}`}>
        <form className="linha-form">
          <select name="mes" defaultValue={mes} aria-label="Mês">
            {meses.map((x) => <option key={x} value={x}>{x.slice(5)}/{x.slice(0, 4)}</option>)}
          </select>
          <button className="btn">Ver</button>
        </form>
        <a className="btn" href={`/api/painel/financeiro/csv?mes=${mes}`}>Exportar CSV</a>
        <Link className="btn" href="/painel/configuracoes#financeiro">Preços e câmbio</Link>
      </Cabecalho>

      <div className="grade g4">
        <Kpi rotulo="Total do mês" valor={formatarBRL(total)} sub={mes === mesAtual ? `Projeção até o fim do mês: ${formatarBRL(projecao)}` : "mês fechado"} />
        <Kpi rotulo="WhatsApp (Meta)" valor={formatarBRL(totalMeta)} sub={`${(metaMsgs.data ?? []).length.toLocaleString("pt-BR")} mensagens cobradas`} />
        <Kpi rotulo="IA (Claude Haiku)" valor={formatarBRL(totalIA)} sub={`${tok.chamadas.toLocaleString("pt-BR")} chamadas · US$ ${tok.usd.toFixed(4)}`} />
        <Kpi rotulo="Infraestrutura" valor={formatarBRL(totalInfra)} sub="Supabase, Vercel, domínio" />
      </div>
      <div className="grade g4 secao">
        <Kpi rotulo="Custo por agendamento confirmado" valor={agendamentos ? formatarBRL(total / agendamentos) : "—"} sub={`${agendamentos} agendamentos confirmados no mês`} />
        <Kpi rotulo="Custo por cliente atendido" valor={clientesUnicos ? formatarBRL(total / clientesUnicos) : "—"} sub={`${clientesUnicos} clientes conversaram`} />
        <Kpi rotulo="Custo por presença em evento" valor={inscr.count ? formatarBRL(soma("meta_") / inscr.count) : "—"} sub={`${inscr.count ?? 0} confirmações (só custo WhatsApp)`} />
        <Kpi rotulo="Aproveitamento do cache da IA" valor={`${cacheHit.toFixed(0)}%`} sub="tokens de entrada lidos do cache (mais = mais barato)" />
      </div>

      <div className="secao card">
        <h2>Custo diário (sem fixos)</h2>
        <div className="grafico" role="img" aria-label="Gráfico de custo diário empilhado por categoria">
          {[...dias.entries()].map(([dia, reg]) => {
            const totalDia = SERIES.reduce((s, x) => s + valorSerie(reg, x.chave), 0);
            return (
              <div
                key={dia}
                className="col"
                style={{ height: `${(totalDia / maxDia) * 100}%` }}
                title={`${dia.slice(8)}/${dia.slice(5, 7)}: ${formatarBRL(totalDia)}\n${SERIES.map((x) => `${x.rotulo}: ${formatarBRL(valorSerie(reg, x.chave))}`).join("\n")}`}
              >
                {SERIES.map((x) => {
                  const v = valorSerie(reg, x.chave);
                  return v > 0 ? <span key={x.chave} style={{ height: `${(v / totalDia) * 100}%`, background: x.cor }} /> : null;
                })}
              </div>
            );
          })}
        </div>
        <div className="legenda">
          {SERIES.map((x) => <span key={x.chave}><i style={{ background: x.cor }} />{x.rotulo}</span>)}
          <span className="mudo">Passe o mouse sobre um dia para ver os valores.</span>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="mudo" style={{ cursor: "pointer" }}>Ver tabela diária</summary>
          <div className="tabela-wrap" style={{ marginTop: 8 }}>
            <table className="tabela">
              <thead><tr><th>Dia</th>{SERIES.map((x) => <th key={x.chave} className="dir">{x.rotulo}</th>)}<th className="dir">Total</th></tr></thead>
              <tbody>
                {[...dias.entries()].filter(([, reg]) => Object.keys(reg).length).map(([dia, reg]) => (
                  <tr key={dia}>
                    <td>{dia.slice(8)}/{dia.slice(5, 7)}</td>
                    {SERIES.map((x) => <td key={x.chave} className="dir num">{formatarBRL(valorSerie(reg, x.chave))}</td>)}
                    <td className="dir num">{formatarBRL(SERIES.reduce((s, x) => s + valorSerie(reg, x.chave), 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <div className="grade g2 secao">
        <div className="card">
          <h2>Por categoria</h2>
          <table className="tabela">
            <thead><tr><th>Categoria</th><th className="dir">Qtd</th><th className="dir">Total</th><th style={{ width: "30%" }}>%</th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.categoria}>
                  <td>{ROTULO[c.categoria] ?? c.categoria}</td>
                  <td className="dir num">{Number(c.quantidade).toLocaleString("pt-BR")}</td>
                  <td className="dir num">{formatarBRL(Number(c.total_brl))}</td>
                  <td><div className="barra" title={`${((Number(c.total_brl) / (total || 1)) * 100).toFixed(1)}%`}><span style={{ width: `${(Number(c.total_brl) / (total || 1)) * 100}%` }} /></div></td>
                </tr>
              ))}
              {!cats.length && <tr><td colSpan={4} className="mudo">Sem custos lançados neste mês.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>IA — uso detalhado</h2>
          <table className="tabela">
            <tbody>
              <tr><td>Chamadas ao Claude</td><td className="dir num">{tok.chamadas.toLocaleString("pt-BR")}</td></tr>
              <tr><td>Tokens de entrada (sem cache)</td><td className="dir num">{tok.in.toLocaleString("pt-BR")}</td></tr>
              <tr><td>Tokens lidos do cache</td><td className="dir num">{tok.cr.toLocaleString("pt-BR")}</td></tr>
              <tr><td>Tokens gravados no cache</td><td className="dir num">{tok.cw.toLocaleString("pt-BR")}</td></tr>
              <tr><td>Tokens de saída</td><td className="dir num">{tok.out.toLocaleString("pt-BR")}</td></tr>
              <tr><td>Custo médio por chamada</td><td className="dir num">{tok.chamadas ? formatarBRL(totalIA / tok.chamadas, 4) : "—"}</td></tr>
              <tr><td>Preço (US$/milhão): entrada · cache · saída</td><td className="dir num">{cfg.claude_preco.input} · {cfg.claude_preco.cache_read} · {cfg.claude_preco.output}</td></tr>
            </tbody>
          </table>
          <p className="mudo">Recusas de segurança (código, receitas, chaves) não chamam a IA, então custam zero.</p>
        </div>
      </div>

      <div className="grade g2 secao">
        <div className="card">
          <h2>Por campanha / evento</h2>
          <table className="tabela">
            <thead><tr><th>Campanha</th><th className="dir">Mensagens</th><th className="dir">Total</th></tr></thead>
            <tbody>
              {((campanhas.data ?? []) as { campanha_id: string; nome: string; mensagens: number; total_brl: number }[]).map((c) => (
                <tr key={c.campanha_id}><td>{c.nome}</td><td className="dir num">{c.mensagens}</td><td className="dir num">{formatarBRL(Number(c.total_brl))}</td></tr>
              ))}
              {!campanhas.data?.length && <tr><td colSpan={3} className="mudo">Nenhuma campanha com custo neste mês.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>WhatsApp por tipo de mensagem</h2>
          <table className="tabela">
            <thead><tr><th>Mensagem</th><th className="dir">Qtd</th><th className="dir">Total</th></tr></thead>
            <tbody>
              {[...porTemplate.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="dir num">{v.qtd}</td><td className="dir num">{formatarBRL(v.total)}</td></tr>
              ))}
              {!porTemplate.size && <tr><td colSpan={3} className="mudo">Sem mensagens cobradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card secao">
        <h2>Agendamentos confirmados por origem do cliente</h2>
        <table className="tabela">
          <thead><tr><th>Origem</th><th className="dir">Agendamentos</th><th style={{ width: "40%" }}>%</th></tr></thead>
          <tbody>
            {[...porOrigem.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => (
              <tr key={o}>
                <td>{o.startsWith("link:") ? `Link/QR · ${o.slice(5)}` : o}</td>
                <td className="dir num">{n}</td>
                <td><div className="barra"><span style={{ width: `${(n / Math.max(agendamentos, 1)) * 100}%` }} /></div></td>
              </tr>
            ))}
            {!porOrigem.size && <tr><td colSpan={3} className="mudo">Sem agendamentos confirmados no mês.</td></tr>}
          </tbody>
        </table>
        <p className="mudo">Funil completo por link (cliques → conversas → agendamentos → custo) em <Link href="/painel/links">Links e QR Code</Link>.</p>
      </div>

      <div className="grade g2 secao">
        <div className="card">
          <h2>Custos fixos (valor mensal)</h2>
          <table className="tabela">
            <tbody>
              {fixosMes.map((f) => (
                <tr key={f.nome}><td>{f.nome}<div className="mudo">{f.moeda} {Number(f.valor).toFixed(2)} / {f.recorrencia}</div></td><td className="dir num">{formatarBRL(f.brl)}</td></tr>
              ))}
              <tr><td><strong>Total fixo/mês</strong></td><td className="dir num"><strong>{formatarBRL(fixosMes.reduce((s, f) => s + f.brl, 0))}</strong></td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Simulador de evento</h2>
          <form className="linha-form">
            <input type="hidden" name="mes" value={mes} />
            <label>Convidados<input type="number" name="convidados" defaultValue={sim.convidados} min={0} /></label>
            <label>Avisos utility/pessoa<input type="number" name="utilities" defaultValue={sim.utilities} min={0} /></label>
            <label>% que responde<input type="number" name="resposta" defaultValue={sim.resposta} min={0} max={100} /></label>
            <label>Conversas IA/pessoa<input type="number" name="interacoes" defaultValue={sim.interacoes} min={0} /></label>
            <button className="btn">Calcular</button>
          </form>
          <table className="tabela" style={{ marginTop: 10 }}>
            <tbody>
              <tr><td>Convites marketing ({sim.convidados} × {formatarBRL(pMkt, 4)})</td><td className="dir num">{formatarBRL(simMkt)}</td></tr>
              <tr><td>Avisos utility ({sim.convidados * sim.utilities} × {formatarBRL(pUtil, 4)})</td><td className="dir num">{formatarBRL(simUtil)}</td></tr>
              <tr><td>IA (Claude Haiku com cache)</td><td className="dir num">{formatarBRL(simIA)}</td></tr>
              <tr><td><strong>Total do evento (sem fixos)</strong></td><td className="dir num"><strong>{formatarBRL(simMkt + simUtil + simIA)}</strong></td></tr>
              <tr><td className="mudo">Por convidado</td><td className="dir num mudo">{formatarBRL(sim.convidados ? (simMkt + simUtil + simIA) / sim.convidados : 0, 4)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
