import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { dataLocalISO, localParaUtc, horaLocal } from "@/lib/time";
import { mascararTelefone } from "@/lib/phone";
import { nucleoAplicado } from "@/lib/usuarios";
import { GRUPOS, dataValida, grupoDoAgendamento, minutosDeAtraso, resumoDoDia, textoAtraso, type GrupoAcompanhamento } from "@/lib/scheduling/acompanhamento";
import { Cabecalho } from "../../_components/ui";
import { marcarPresenca } from "./actions";
import AtualizarSozinho from "./AtualizarSozinho";

type Ag = {
  id: string; inicio: string; status: string; observacoes: string | null; cliente_id: string;
  clientes: { nome: string | null; telefone: string } | null; servicos: { nome: string } | null; recursos: { nome: string } | null;
  veiculos: { modelo: string | null; placa: string | null } | null;
  agendamento_historico: { criado_em: string; para_status: string | null }[];
};

const somarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export default async function Acompanhamento({ searchParams }: { searchParams: Promise<{ dia?: string; msg?: string }> }) {
  const u = await exigirAcesso("agenda");
  const multi = await nucleoAplicado();
  const off = (await getConfig()).fuso_offset;
  const sp = await searchParams;
  const agora = new Date();
  const hoje = dataLocalISO(agora, off);
  const dia = dataValida(sp.dia) ? sp.dia : hoje; // PR9-BAIXA-005
  const ehHoje = dia === hoje;
  const passado = dia < hoje;

  const inicioDia = localParaUtc(dia, "00:00", off);
  let q = db()
    .from("agendamentos")
    .select("id, inicio, status, observacoes, cliente_id, clientes(nome, telefone), servicos!agendamentos_servico_id_fkey(nome), recursos!agendamentos_recurso_id_fkey(nome), veiculos(modelo, placa), agendamento_historico(criado_em, para_status)")
    .gte("inicio", inicioDia.toISOString())
    .lt("inicio", new Date(inicioDia.getTime() + 86400_000).toISOString())
    .order("inicio")
    .limit(300);
  if (multi) q = q.in("unidade", u.unidades);
  const { data, error } = await q;
  const lista = (data ?? []) as unknown as Ag[];

  const porGrupo = new Map<GrupoAcompanhamento, Ag[]>(GRUPOS.map((g) => [g.chave, []]));
  for (const a of lista) porGrupo.get(grupoDoAgendamento(a, agora))!.push(a);
  const r = resumoDoDia(lista.map((a) => grupoDoAgendamento(a, agora)));
  const volta = `/painel/agendamentos/acompanhamento${dia !== hoje ? `?dia=${dia}` : ""}`;

  const chegada = (a: Ag) => {
    const h = a.agendamento_historico.filter((x) => x.para_status === "compareceu").sort((x, y) => y.criado_em.localeCompare(x.criado_em))[0];
    return h ? horaLocal(new Date(h.criado_em), off) : null;
  };

  const botao = (a: Ag, acao: string, rotulo: string, classe: string) => (
    <form action={marcarPresenca}>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="acao" value={acao} />
      <input type="hidden" name="volta" value={volta} />
      <button className={`btn pequeno ${classe}`}>{rotulo}</button>
    </form>
  );

  const linha = (a: Ag, g: GrupoAcompanhamento) => {
    const atraso = minutosDeAtraso(a.inicio, agora);
    const veiculo = [a.veiculos?.modelo, a.veiculos?.placa].filter(Boolean).join(" · ");
    const hc = g === "veio" ? chegada(a) : null;
    return (
      <li key={a.id} className={`acomp-item acomp-${g}`}>
        <div className="acomp-hora">{horaLocal(new Date(a.inicio), off)}</div>
        <div className="acomp-quem">
          <Link href={`/painel/clientes?c=${a.cliente_id}`} className="acomp-nome">{a.clientes?.nome || "Cliente sem nome"}</Link>
          <span className="mudo">{mascararTelefone(a.clientes?.telefone ?? "")}{veiculo ? ` · ${veiculo}` : ""}</span>
        </div>
        <div className="acomp-servico">
          <strong>{a.servicos?.nome ?? "Serviço"}</strong>
          {a.observacoes && <span className="mudo">{a.observacoes}</span>}
        </div>
        <div className="acomp-box mudo">{a.recursos?.nome ?? ""}</div>
        <div className="acomp-selo">
          {g === "atrasado" && <span className="tag erro">{ehHoje ? textoAtraso(atraso) : "sem marcação"}</span>}
          {g === "aguardando" && ehHoje && atraso > 0 && <span className="tag aviso">começou {textoAtraso(atraso)}</span>}
          {g === "aguardando" && ehHoje && atraso <= 0 && atraso > -60 && <span className="tag info">em {-atraso} min</span>}
          {g === "veio" && <span className="tag ok">{hc ? `chegou ${hc}` : "veio"}</span>}
          {g === "nao_veio" && <span className="tag erro">não veio</span>}
        </div>
        <div className="acomp-acoes">
          {(g === "atrasado" || g === "aguardando") && !(!ehHoje && !passado) && (
            <>
              {botao(a, "chegou", "Chegou", "primario")}
              {botao(a, "nao_veio", "Não veio", "perigo")}
            </>
          )}
          {(g === "veio" || g === "nao_veio") && botao(a, "desfazer", "Desfazer", "")}
        </div>
      </li>
    );
  };

  return (
    <>
      {ehHoje && <AtualizarSozinho />}
      <Cabecalho
        titulo="Acompanhamento do dia"
        sub={`${new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" })}${ehHoje ? " · atualiza sozinho a cada minuto" : ""}`}
      >
        <div className="acomp-dias">
          <Link className="btn pequeno" href={`/painel/agendamentos/acompanhamento?dia=${somarDias(dia, -1)}`} aria-label="Dia anterior">←</Link>
          <Link className={`btn pequeno${ehHoje ? " primario" : ""}`} href="/painel/agendamentos/acompanhamento">Hoje</Link>
          <Link className="btn pequeno" href={`/painel/agendamentos/acompanhamento?dia=${somarDias(dia, 1)}`} aria-label="Próximo dia">→</Link>
          <form className="linha-form"><input type="date" name="dia" defaultValue={dia} aria-label="Escolher dia" /><button className="btn pequeno">Ir</button></form>
          <Link className="btn pequeno" href="/painel/agendamentos">+ Novo agendamento</Link>
        </div>
      </Cabecalho>

      {error && <div className="alerta erro">Não foi possível carregar os agendamentos agora. <Link href={volta}>Tentar de novo</Link></div>}
      {sp.msg === "conflito" && <div className="alerta erro">Não deu para desfazer: outro agendamento já ocupa esse horário no mesmo box.</div>}

      {!error && (<>
      <div className="acomp-kpis">
        <div className="card acomp-kpi"><span>Agendados</span><strong>{r.total}</strong></div>
        <div className="card acomp-kpi"><span>Aguardando</span><strong>{r.aguardando}</strong></div>
        <div className={`card acomp-kpi${r.atrasado ? " alerta-kpi" : ""}`}><span>Atrasados</span><strong>{r.atrasado}</strong></div>
        <div className="card acomp-kpi"><span>Vieram</span><strong>{r.veio}</strong></div>
        <div className="card acomp-kpi"><span>Não vieram</span><strong>{r.nao_veio}</strong></div>
        <div className="card acomp-kpi"><span>Comparecimento</span><strong>{r.taxaComparecimento === null ? "—" : `${r.taxaComparecimento}%`}</strong></div>
      </div>

      {!lista.length && <div className="card mudo">Nenhum agendamento neste dia.</div>}
      </>)}

      {!error && GRUPOS.map(({ chave, rotulo }) => {
        const itens = porGrupo.get(chave)!;
        if (!itens.length) return null;
        const corpo = <ul className="acomp-lista">{itens.map((a) => linha(a, chave))}</ul>;
        return chave === "cancelado" ? (
          <details key={chave} className="acomp-grupo">
            <summary><h3>{rotulo} ({itens.length})</h3></summary>
            {corpo}
          </details>
        ) : (
          <section key={chave} className="acomp-grupo">
            <h3>{rotulo} ({itens.length})</h3>
            {corpo}
          </section>
        );
      })}
    </>
  );
}
