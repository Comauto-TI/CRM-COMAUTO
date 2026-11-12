import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { setorDoMarketing } from "@/lib/escopo-setor";
import { SETORES, ROTULO_SETOR, type Setor } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { formatarBRL, formatarDataHora } from "@/lib/time";
import { CANAIS, MENSAGENS_SUGERIDAS, montarLinkWhatsApp, mensagemComCodigo } from "@/lib/links";
import { Cabecalho, Kpi, Vazio } from "../_components/ui";
import Copiar from "../_components/Copiar";
import { criarLink, alternarLink } from "./actions";

const MSGS: Record<string, [string, string]> = {
  fora_do_setor: ["erro", "Esse link é de outro setor."],
  incompleto: ["erro", "Preencha nome, canal e mensagem."],
  mensagem_bloqueada: ["erro", "Essa mensagem seria barrada pela segurança do próprio assistente. Use uma mensagem de agendamento ou dúvida."],
  erro: ["erro", "Não foi possível criar o link."],
};

type LinkRow = { id: string; codigo: string; nome: string; canal: string; mensagem_inicial: string; ativo: boolean; criado_por: string | null; criado_em: string };

export default async function Links({ searchParams }: { searchParams: Promise<{ novo?: string; msg?: string; setor?: string }> }) {
  const u = await exigirAcesso("links");
  // marketing por setor: cada setor vê só os próprios links/QR e as estatísticas deles; admin vê todos
  const fixo = setorDoMarketing(u);
  const cfg = await getConfig();
  const sp = await searchParams;
  const filtroSetor: Setor | null = fixo ?? ((SETORES as readonly string[]).includes(sp.setor ?? "") ? (sp.setor as Setor) : null);
  const numero = cfg.empresa.whatsapp_numero?.replace(/\D/g, "") ?? "";
  const base = env().APP_URL.replace(/\/$/, "");

  let q = db().from("links_rastreados").select("*");
  if (filtroSetor) q = q.eq("setor", filtroSetor);
  const { data } = await q.order("criado_em", { ascending: false }).limit(100);
  const links = (data ?? []) as LinkRow[];
  const ids = links.map((l) => l.id);

  // Funil por link: cliques → conversas → agendamentos → custo
  const [cliques, conversas] = ids.length
    ? await Promise.all([
        db().from("link_cliques").select("link_id").in("link_id", ids).limit(100000),
        db().from("link_conversas").select("link_id, cliente_id, criado_em").in("link_id", ids).limit(100000),
      ])
    : [{ data: [] }, { data: [] }];
  const clientesPorLink = new Map<string, { cliente: string; desde: string }[]>();
  for (const c of conversas.data ?? []) clientesPorLink.set(c.link_id, [...(clientesPorLink.get(c.link_id) ?? []), { cliente: c.cliente_id, desde: c.criado_em }]);
  const todosClientes = [...new Set((conversas.data ?? []).map((c) => c.cliente_id))];

  const [ags, custos] = todosClientes.length
    ? await Promise.all([
        db().from("agendamentos").select("cliente_id, criado_em, status").in("cliente_id", todosClientes).neq("status", "cancelado").limit(100000),
        db().from("custos").select("cliente_id, valor_brl").in("cliente_id", todosClientes).limit(200000),
      ])
    : [{ data: [] }, { data: [] }];

  const funil = new Map<string, { cliques: number; conversas: number; agendamentos: number; custo: number }>();
  for (const l of links) {
    const lista = clientesPorLink.get(l.id) ?? [];
    const setCli = new Set(lista.map((x) => x.cliente));
    const agend = (ags.data ?? []).filter((a) => setCli.has(a.cliente_id) && lista.some((x) => x.cliente === a.cliente_id && a.criado_em >= x.desde)).length;
    const custo = (custos.data ?? []).filter((c) => c.cliente_id && setCli.has(c.cliente_id)).reduce((s, c) => s + Number(c.valor_brl), 0);
    funil.set(l.id, { cliques: (cliques.data ?? []).filter((c) => c.link_id === l.id).length, conversas: setCli.size, agendamentos: agend, custo });
  }
  const tot = [...funil.values()].reduce((a, f) => ({ cliques: a.cliques + f.cliques, conversas: a.conversas + f.conversas, agendamentos: a.agendamentos + f.agendamentos, custo: a.custo + f.custo }), { cliques: 0, conversas: 0, agendamentos: 0, custo: 0 });
  const novo = links.find((l) => l.id === sp.novo);
  const msg = sp.msg ? MSGS[sp.msg] : null;
  const rotuloCanal = (v: string) => CANAIS.find((c) => c.valor === v)?.rotulo ?? v;

  return (
    <>
      <Cabecalho titulo="Links e QR Code" sub={`${fixo ? "Setor " + ROTULO_SETOR[fixo] : filtroSetor ? "Setor " + ROTULO_SETOR[filtroSetor] : "Todos os setores"} · o cliente chama primeiro: abre a janela de 24h, sem template nem custo de disparo`}>
        {!fixo && (
          <form className="linha-form">
            <select name="setor" defaultValue={filtroSetor ?? ""} aria-label="Setor">
              <option value="">Todos os setores</option>
              {SETORES.map((x) => <option key={x} value={x}>{ROTULO_SETOR[x]}</option>)}
            </select>
            <button className="btn">Filtrar</button>
          </form>
        )}
      </Cabecalho>
      {msg && <div className={`alerta ${msg[0]}`}>{msg[1]}</div>}
      {!numero && (
        <div className="alerta aviso">
          Cadastre o número oficial do WhatsApp em <Link href="/painel/configuracoes">Configurações → Empresa</Link> para os links funcionarem.
        </div>
      )}

      <div className="grade g4">
        <Kpi rotulo="Escaneamentos / cliques" valor={tot.cliques} />
        <Kpi rotulo="Conversas iniciadas" valor={tot.conversas} sub={tot.cliques ? `${Math.round((tot.conversas / tot.cliques) * 100)}% de quem clicou` : undefined} />
        <Kpi rotulo="Agendamentos gerados" valor={tot.agendamentos} sub={tot.conversas ? `${Math.round((tot.agendamentos / tot.conversas) * 100)}% das conversas` : undefined} />
        <Kpi rotulo="Custo por agendamento" valor={tot.agendamentos ? formatarBRL(tot.custo / tot.agendamentos) : "—"} sub={`custo total desses clientes: ${formatarBRL(tot.custo)}`} />
      </div>

      {novo && numero && (
        <div className="card secao" style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/painel/links/${novo.id}/qr?formato=svg`} alt={`QR code de ${novo.nome}`} width={220} height={220} style={{ background: "#fff", borderRadius: 8 }} />
          <div>
            <div className="alerta ok">Link criado! Imprima o QR ou use o link onde quiser.</div>
            <h2>{novo.nome}</h2>
            <p className="mudo">O cliente vai enviar: “{mensagemComCodigo(novo.mensagem_inicial, novo.codigo)}”</p>
            <div className="acoes">
              <a className="btn primario" href={`/api/painel/links/${novo.id}/qr?formato=png&baixar=1`}>Baixar QR (PNG para impressão)</a>
              <a className="btn" href={`/api/painel/links/${novo.id}/qr?formato=svg&baixar=1`}>Baixar QR (SVG vetorial)</a>
              <Copiar texto={`${base}/r/${novo.codigo}`} />
            </div>
          </div>
        </div>
      )}

      <div className="card secao">
        <h2>Novo link / QR code</h2>
        <form action={criarLink} className="form">
          <div className="linha-form">
            <label>Nome (onde vai ser usado)<input name="nome" required placeholder="QR do balcão da recepção" /></label>
            <label>Canal
              <select name="canal" defaultValue="balcao">{CANAIS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}</select>
            </label>
            {!fixo && <label>Setor<select name="setor" defaultValue={filtroSetor ?? "vendas"}>{SETORES.map((x) => <option key={x} value={x}>{ROTULO_SETOR[x]}</option>)}</select></label>}
          </div>
          <label>Mensagem que já vem escrita para o cliente
            <input name="mensagem" required defaultValue={MENSAGENS_SUGERIDAS[0]} list="sugestoes" maxLength={300} />
            <datalist id="sugestoes">{MENSAGENS_SUGERIDAS.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <div className="mudo">Um código curto, como “(cód. K7M2QX)”, é colocado no fim da mensagem para identificar a origem. O assistente ignora o código e responde normalmente.</div>
          <div><button className="btn primario">Gerar link e QR code</button></div>
        </form>
      </div>

      <div className="secao">
        {links.length === 0 ? (
          <Vazio>Nenhum link criado ainda. Comece pelo QR do balcão e pelo link da bio do Instagram.</Vazio>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr><th>QR</th><th>Link</th><th className="dir">Cliques</th><th className="dir">Conversas</th><th className="dir">Agendamentos</th><th className="dir">Custo/agend.</th><th></th></tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const f = funil.get(l.id)!;
                  return (
                    <tr key={l.id} style={{ opacity: l.ativo ? 1 : 0.55 }}>
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/painel/links/${l.id}/qr?formato=svg`} alt="" width={64} height={64} style={{ background: "#fff", borderRadius: 4 }} />
                      </td>
                      <td>
                        <strong>{l.nome}</strong> <span className="tag">{rotuloCanal(l.canal)}</span> {!l.ativo && <span className="tag erro">desativado</span>}
                        <div className="mudo">“{l.mensagem_inicial}” · cód. {l.codigo}</div>
                        <div className="mudo">{base}/r/{l.codigo} · criado {formatarDataHora(l.criado_em, cfg.fuso_offset)}{l.criado_por ? ` por ${l.criado_por}` : ""}</div>
                        <div className="acoes" style={{ marginTop: 6 }}>
                          <Copiar texto={`${base}/r/${l.codigo}`} />
                          {numero && <Copiar texto={montarLinkWhatsApp(numero, l.mensagem_inicial, l.codigo)} rotulo="Copiar wa.me direto" />}
                          <a className="btn pequeno" href={`/api/painel/links/${l.id}/qr?formato=png&baixar=1`}>PNG</a>
                          <a className="btn pequeno" href={`/api/painel/links/${l.id}/qr?formato=svg&baixar=1`}>SVG</a>
                        </div>
                      </td>
                      <td className="dir num">{f.cliques}</td>
                      <td className="dir num">{f.conversas}</td>
                      <td className="dir num">{f.agendamentos}</td>
                      <td className="dir num">{f.agendamentos ? formatarBRL(f.custo / f.agendamentos) : "—"}</td>
                      <td className="dir">
                        <form action={alternarLink}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="ativo" value={l.ativo ? "0" : "1"} />
                          <button className={`btn pequeno ${l.ativo ? "perigo" : ""}`}>{l.ativo ? "Desativar" : "Reativar"}</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mudo secao">
        Dica: o QR aponta para o link curto (conta os escaneamentos). Se preferir que funcione mesmo com o painel fora do ar, use o “wa.me direto”: funciona igual, só não conta o clique.
      </p>
    </>
  );
}
