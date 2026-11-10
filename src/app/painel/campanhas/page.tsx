import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarBRL, formatarDataHora, dataLocalISO } from "@/lib/time";
import { preChecagem } from "@/lib/campaigns";
import { Cabecalho, Status, Kpi } from "../_components/ui";
import { criarEvento, criarCampanha, rodarPreChecagem, iniciarTeste, iniciarEnvio, pausar, retomar } from "./actions";

const MSGS: Record<string, [string, string]> = {
  teste_ok: ["ok", "Grupo de teste enfileirado. Os envios saem em lotes no horário comercial. Confira os resultados antes de liberar o envio completo."],
  envio_ok: ["ok", "Envio completo liberado. O sistema respeita lote, limite diário, horário e pausa automática."],
  template_nao_aprovado: ["erro", "O template desta campanha ainda não está APROVADO na Meta. Atualize o status em Configurações depois da aprovação."],
  confirme: ["erro", "Marque a confirmação para liberar o envio."],
  erro: ["erro", "Não foi possível criar a campanha."],
};

export default async function Campanhas({ searchParams }: { searchParams: Promise<{ ver?: string; msg?: string }> }) {
  await exigirAcesso("campanhas");
  const cfg = await getConfig();
  const off = cfg.fuso_offset;
  const sp = await searchParams;

  const [{ data: eventos }, { data: campanhas }, { data: templates }] = await Promise.all([
    db().from("eventos").select("id, nome, inicio, local, vagas, status, inscricoes_evento(status)").order("inicio", { ascending: false }).limit(30),
    db().from("campanhas").select("id, nome, tipo, status, total_previsto, custo_estimado_brl, motivo_pausa, criado_em, templates(nome, status_aprovacao), eventos(nome)").order("criado_em", { ascending: false }).limit(50),
    db().from("templates").select("id, nome, categoria_meta, finalidade, status_aprovacao").in("finalidade", ["eventos", "marketing"]).eq("ativo", true).order("nome"),
  ]);

  type CampanhaDet = { id: string; nome: string; status: string; motivo_pausa: string | null; templates: { nome: string; status_aprovacao: string } | null };
  let detalhe: null | { c: CampanhaDet; pre: Awaited<ReturnType<typeof preChecagem>>; envios: Record<string, number>; gasto: number } = null;
  if (sp.ver) {
    const c = ((campanhas ?? []) as unknown as CampanhaDet[]).find((x) => x.id === sp.ver);
    if (c) {
      const [pre, { data: env }, { data: custo }] = await Promise.all([
        preChecagem(c.id),
        db().from("campanha_envios").select("status").eq("campanha_id", c.id),
        db().from("custos").select("valor_brl").eq("campanha_id", c.id),
      ]);
      const envios = (env ?? []).reduce<Record<string, number>>((a, e) => ((a[e.status] = (a[e.status] ?? 0) + 1), a), {});
      detalhe = { c, pre, envios, gasto: (custo ?? []).reduce((s, x) => s + Number(x.valor_brl), 0) };
    }
  }

  const msg = sp.msg ? MSGS[sp.msg] : null;

  return (
    <>
      <Cabecalho titulo="Eventos e campanhas" sub="Disparos só para quem autorizou eventos/marketing, com template aprovado, teste antes e pausa automática" />
      {msg && <div className={`alerta ${msg[0]}`}>{msg[1]}</div>}

      {detalhe && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="cabecalho" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{detalhe.c.nome} <Status valor={detalhe.c.status} /></h2>
              <div className="mudo">Template: {detalhe.c.templates?.nome} · <Status valor={detalhe.c.templates?.status_aprovacao ?? "rascunho"} /></div>
              {detalhe.c.motivo_pausa && <div className="alerta erro" style={{ marginTop: 8 }}>{detalhe.c.motivo_pausa}</div>}
            </div>
            <Link className="btn" href="/painel/campanhas">Fechar</Link>
          </div>
          {detalhe.pre && (
            <div className="grade g4">
              <Kpi rotulo="Aptos a receber" valor={detalhe.pre.aptos} sub={`de ${detalhe.pre.base} na base filtrada`} />
              <Kpi rotulo="Barrados" valor={detalhe.pre.semConsentimento + detalhe.pre.optout + detalhe.pre.invalidos + detalhe.pre.duplicados} sub={`${detalhe.pre.semConsentimento} sem consentimento · ${detalhe.pre.optout} opt-out · ${detalhe.pre.invalidos} inválidos · ${detalhe.pre.duplicados} duplicados`} />
              <Kpi rotulo="Custo estimado" valor={formatarBRL(detalhe.pre.custoEstimadoBRL)} sub="convite + avisos previstos" />
              <Kpi rotulo="Gasto real até agora" valor={formatarBRL(detalhe.gasto)} sub="mensagens entregues" />
            </div>
          )}
          <div className="grade g4 secao">
            {["fila", "enviado", "entregue", "lido", "respondido", "falhou", "ignorado"].map((s) => (
              <div key={s} className="card kpi"><div className="rotulo">{s}</div><div className="valor">{detalhe!.envios[s] ?? 0}</div></div>
            ))}
          </div>
          <div className="acoes secao">
            <form action={rodarPreChecagem}><input type="hidden" name="id" value={detalhe.c.id} /><button className="btn">Refazer pré-checagem</button></form>
            {["rascunho", "pronta"].includes(detalhe.c.status) && detalhe.c.status === "rascunho" && (
              <form action={iniciarTeste}><input type="hidden" name="id" value={detalhe.c.id} /><button className="btn">1. Enviar para grupo de teste ({cfg.campanhas.grupo_teste_tamanho})</button></form>
            )}
            {detalhe.c.status === "pronta" && (
              <form action={iniciarEnvio} className="acoes">
                <input type="hidden" name="id" value={detalhe.c.id} />
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="confirmo" style={{ width: "auto" }} /> Conferi o resultado do teste</label>
                <button className="btn primario">2. Liberar envio completo</button>
              </form>
            )}
            {["teste", "enviando"].includes(detalhe.c.status) && (
              <form action={pausar}><input type="hidden" name="id" value={detalhe.c.id} /><button className="btn perigo">Pausar</button></form>
            )}
            {detalhe.c.status === "pausada" && (
              <form action={retomar}><input type="hidden" name="id" value={detalhe.c.id} /><button className="btn">Retomar</button></form>
            )}
          </div>
        </div>
      )}

      <div className="grade g2">
        <div className="card">
          <h2>Novo evento</h2>
          <form action={criarEvento} className="form">
            <label>Nome<input name="nome" required placeholder="Feirão de Seminovos Comauto" /></label>
            <div className="linha-form">
              <label>Data<input type="date" name="data" required min={dataLocalISO(new Date(), off)} /></label>
              <label>Hora<input type="time" name="hora" required /></label>
              <label>Vagas<input type="number" name="vagas" min={1} placeholder="sem limite" /></label>
            </div>
            <label>Local<input name="local" required /></label>
            <label>Descrição (o assistente usa para responder dúvidas)<textarea name="descricao" rows={2} /></label>
            <div><button className="btn primario">Criar evento</button></div>
          </form>
        </div>

        <div className="card">
          <h2>Nova campanha</h2>
          <form action={criarCampanha} className="form">
            <label>Nome<input name="nome" required /></label>
            <div className="linha-form">
              <label>Evento (opcional)
                <select name="evento" defaultValue="">
                  <option value="">— campanha de marketing —</option>
                  {(eventos ?? []).filter((e) => e.status === "ativo").map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </label>
              <label>Template
                <select name="template" required>
                  {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome} ({t.categoria_meta}{t.status_aprovacao !== "aprovado" ? " · não aprovado" : ""})</option>)}
                </select>
              </label>
            </div>
            <div className="linha-form">
              <label>Tags (vírgula)<input name="tags" placeholder="suv, seminovos" /></label>
              <label>Cidade<input name="cidade" /></label>
              <label>Lote<input type="number" name="lote" defaultValue={50} min={1} max={500} /></label>
              <label>Limite/dia<input type="number" name="limite" defaultValue={250} min={1} /></label>
            </div>
            <div><button className="btn primario">Criar e calcular público</button> <span className="mudo">Nada é enviado nesta etapa.</span></div>
          </form>
        </div>
      </div>

      <div className="grade g2 secao">
        <div className="card">
          <h2>Eventos</h2>
          <table className="tabela">
            <thead><tr><th>Evento</th><th>Quando</th><th className="dir">Confirmados</th><th>Status</th></tr></thead>
            <tbody>
              {(eventos ?? []).map((e) => {
                const conf = (e.inscricoes_evento ?? []).filter((i: { status: string }) => i.status === "confirmado").length;
                const espera = (e.inscricoes_evento ?? []).filter((i: { status: string }) => i.status === "lista_espera").length;
                return (
                  <tr key={e.id}>
                    <td>{e.nome}<div className="mudo">{e.local}</div></td>
                    <td className="num">{formatarDataHora(e.inicio, off)}</td>
                    <td className="dir num">{conf}{e.vagas ? ` / ${e.vagas}` : ""}{espera ? <div className="mudo">{espera} em espera</div> : null}</td>
                    <td><Status valor={e.status} /></td>
                  </tr>
                );
              })}
              {!eventos?.length && <tr><td colSpan={4} className="mudo">Nenhum evento.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Campanhas</h2>
          <table className="tabela">
            <thead><tr><th>Campanha</th><th className="dir">Público</th><th className="dir">Estimado</th><th>Status</th></tr></thead>
            <tbody>
              {((campanhas ?? []) as unknown as { id: string; nome: string; status: string; total_previsto: number; custo_estimado_brl: number; eventos: { nome: string } | null }[]).map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/painel/campanhas?ver=${c.id}`}>{c.nome}</Link>{c.eventos && <div className="mudo">{c.eventos.nome}</div>}</td>
                  <td className="dir num">{c.total_previsto}</td>
                  <td className="dir num">{formatarBRL(Number(c.custo_estimado_brl))}</td>
                  <td><Status valor={c.status} /></td>
                </tr>
              ))}
              {!campanhas?.length && <tr><td colSpan={4} className="mudo">Nenhuma campanha.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
