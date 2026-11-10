import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora, dataLocalISO, localParaUtc } from "@/lib/time";
import { mascararTelefone } from "@/lib/phone";
import { Cabecalho, Status } from "../_components/ui";
import { mudarStatus, novoAgendamento } from "./actions";

const MSGS: Record<string, [string, string]> = {
  criado_enviado: ["ok", "Agendamento criado e pedido de confirmação enviado no WhatsApp."],
  telefone_invalido: ["erro", "Telefone inválido. Use DDD + número."],
  horario_indisponivel: ["erro", "Esse horário não está livre (fora do expediente, bloqueado ou ocupado)."],
  horario_acabou_de_ser_ocupado: ["erro", "Alguém acabou de ocupar esse horário. Escolha outro."],
  erro: ["erro", "Não foi possível criar o agendamento."],
};

type Ag = {
  id: string; inicio: string; status: string; origem: string; observacoes: string | null; motivo_cancelamento: string | null;
  confirmado_por: string | null; confirmado_em: string | null; confirmado_canal: string | null;
  clientes: { nome: string | null; telefone: string } | null; servicos: { nome: string } | null; recursos: { nome: string } | null;
  veiculos: { modelo: string | null; placa: string | null } | null;
  agendamento_historico: { acao: string; ator: string; criado_em: string; para_status: string | null }[];
};

export default async function Agendamentos({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; status?: string; msg?: string }> }) {
  await exigirAcesso("agenda");
  const cfg = await getConfig();
  const off = cfg.fuso_offset;
  const sp = await searchParams;
  const hoje = dataLocalISO(new Date(), off);
  const de = sp.de ?? hoje;
  const ate = sp.ate ?? dataLocalISO(new Date(Date.now() + 7 * 86400_000), off);

  let q = db()
    .from("agendamentos")
    .select("id, inicio, status, origem, observacoes, motivo_cancelamento, confirmado_por, confirmado_em, confirmado_canal, clientes(nome, telefone), servicos(nome), recursos(nome), veiculos(modelo, placa), agendamento_historico(acao, ator, criado_em, para_status)")
    .gte("inicio", localParaUtc(de, "00:00", off).toISOString())
    .lt("inicio", new Date(localParaUtc(ate, "00:00", off).getTime() + 86400_000).toISOString())
    .order("inicio")
    .limit(500);
  if (sp.status) q = q.eq("status", sp.status);
  const [{ data }, { data: servicos }] = await Promise.all([q, db().from("servicos").select("id, nome").eq("ativo", true).order("nome")]);
  const lista = (data ?? []) as unknown as Ag[];

  const msg = sp.msg ? MSGS[sp.msg] ?? (sp.msg.startsWith("criado_sem_whatsapp") ? ["aviso", `Agendamento criado, mas o WhatsApp não foi enviado (${sp.msg.split(":")[1]}). Confirme com o cliente por outro meio ou registre o consentimento.`] : null) : null;
  const contagem = lista.reduce<Record<string, number>>((acc, a) => ((acc[a.status] = (acc[a.status] ?? 0) + 1), acc), {});

  return (
    <>
      <Cabecalho titulo="Agendamentos" sub={`${lista.length} no período · ${contagem.confirmado ?? 0} confirmados · ${contagem.pendente ?? 0} pendentes · ${contagem.cancelado ?? 0} cancelados`}>
        <form className="linha-form">
          <label>De<input type="date" name="de" defaultValue={de} /></label>
          <label>Até<input type="date" name="ate" defaultValue={ate} /></label>
          <label>Status
            <select name="status" defaultValue={sp.status ?? ""}>
              <option value="">Todos</option>
              {["pendente", "confirmado", "compareceu", "nao_compareceu", "cancelado"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button className="btn">Filtrar</button>
        </form>
      </Cabecalho>

      {msg && <div className={`alerta ${msg[0]}`}>{msg[1]}</div>}

      <details className="card" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Novo agendamento (recepção)</summary>
        <form action={novoAgendamento} className="form" style={{ marginTop: 12 }}>
          <div className="linha-form">
            <label>Telefone (WhatsApp)<input name="telefone" required placeholder="(51) 99999-8888" /></label>
            <label>Nome<input name="nome" /></label>
            <label>Serviço
              <select name="servico" required>{(servicos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
            </label>
          </div>
          <div className="linha-form">
            <label>Data<input type="date" name="data" required min={hoje} /></label>
            <label>Hora<input type="time" name="hora" required step={1800} /></label>
            <label>Modelo<input name="modelo" /></label>
            <label>Placa<input name="placa" /></label>
          </div>
          <label>Observações<input name="obs" /></label>
          <div><button className="btn primario">Criar e pedir confirmação</button> <span className="mudo">O sistema verifica a agenda e impede conflito de horário.</span></div>
        </form>
      </details>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr><th>Quando</th><th>Cliente</th><th>Serviço / veículo</th><th>Box</th><th>Status</th><th>Quem confirmou</th><th>Ação</th></tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id}>
                <td className="num">{formatarDataHora(a.inicio, off)}<div className="mudo">{a.origem}</div></td>
                <td>{a.clientes?.nome ?? "—"}<div className="mudo">{mascararTelefone(a.clientes?.telefone ?? "")}</div></td>
                <td>
                  {a.servicos?.nome}
                  <div className="mudo">{[a.veiculos?.modelo, a.veiculos?.placa].filter(Boolean).join(" · ")}</div>
                  {a.observacoes && <div className="mudo">“{a.observacoes}”</div>}
                </td>
                <td>{a.recursos?.nome}</td>
                <td>
                  <Status valor={a.status} />
                  {a.motivo_cancelamento && <div className="mudo">{a.motivo_cancelamento}</div>}
                </td>
                <td>
                  {a.confirmado_por ? (
                    <>
                      <div>{a.confirmado_por}</div>
                      <div className="mudo">{a.confirmado_canal?.replace(/_/g, " ")} · {a.confirmado_em ? formatarDataHora(a.confirmado_em, off) : ""}</div>
                    </>
                  ) : <span className="mudo">—</span>}
                  <details>
                    <summary className="mudo" style={{ cursor: "pointer" }}>histórico ({a.agendamento_historico.length})</summary>
                    <ul className="mudo" style={{ paddingLeft: 16, margin: "4px 0" }}>
                      {[...a.agendamento_historico].sort((x, y) => x.criado_em.localeCompare(y.criado_em)).map((h, i) => (
                        <li key={i}>{formatarDataHora(h.criado_em, off)} · {h.acao}{h.para_status ? ` → ${h.para_status}` : ""} · {h.ator}</li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td>
                  <form action={mudarStatus} className="acoes">
                    <input type="hidden" name="id" value={a.id} />
                    <select name="status" defaultValue={a.status} aria-label="Novo status">
                      {["pendente", "confirmado", "compareceu", "nao_compareceu", "cancelado"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                    <button className="btn pequeno">Salvar</button>
                  </form>
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={7} className="mudo">Nenhum agendamento no período. <Link href="/painel/agendamentos">Limpar filtros</Link></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
