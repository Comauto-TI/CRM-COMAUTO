import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarBRL, formatarDataHora, localParaUtc, dataLocalISO } from "@/lib/time";
import { Cabecalho, Kpi, Status } from "./_components/ui";
import { podeAcessar } from "@/lib/permissoes";
import { nucleoAplicado } from "@/lib/usuarios";

export default async function VisaoGeral({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const u = await exigirAcesso();
  const { erro } = await searchParams;
  const cfg = await getConfig();
  const off = cfg.fuso_offset;
  const hoje = dataLocalISO(new Date(), off);
  const iniHoje = localParaUtc(hoje, "00:00", off).toISOString();
  const fimHoje = new Date(new Date(iniHoje).getTime() + 86400_000).toISOString();
  const iniMes = localParaUtc(`${hoje.slice(0, 7)}-01`, "00:00", off).toISOString();

  // F0-3-002: cada bloco só é consultado se o perfil tiver acesso à área (e só nas unidades dele)
  const verAgenda = podeAcessar(u, "agenda");
  const verAtendimento = podeAcessar(u, "atendimento");
  const verCusto = podeAcessar(u, "financeiro");
  const multi = await nucleoAplicado();
  const doUsuario = <Q,>(q: Q): Q => (multi ? (q as unknown as { in: (c: string, v: string[]) => Q }).in("unidade", u.unidades) : q);
  const vazio = Promise.resolve({ data: null, count: null });

  const [agHoje, fila, conversasHoje, custosMes, bloqueios, proximos] = await Promise.all([
    verAgenda ? doUsuario(db().from("agendamentos").select("status").gte("inicio", iniHoje).lt("inicio", fimHoje)) : vazio,
    verAtendimento ? doUsuario(db().from("conversas").select("id", { count: "exact", head: true }).eq("status", "humano").is("assumida_por", null)) : vazio,
    verAtendimento ? db().from("mensagens").select("cliente_id").eq("direcao", "entrada").gte("criado_em", iniHoje) : vazio,
    verCusto ? db().rpc("resumo_custos", { p_inicio: iniMes, p_fim: new Date().toISOString() }) : vazio,
    verAtendimento ? db().from("eventos_seguranca").select("id", { count: "exact", head: true }).gte("criado_em", iniHoje) : vazio,
    verAgenda
      ? doUsuario(
          db()
            .from("agendamentos")
            .select("id, inicio, status, confirmado_por, clientes(nome), servicos(nome), recursos(nome)")
            .in("status", ["pendente", "confirmado"])
            .gte("inicio", new Date().toISOString())
            .order("inicio")
            .limit(8),
        )
      : vazio,
  ]);

  const ags = (agHoje.data ?? []) as { status: string }[];
  const confirmados = ags.filter((a) => a.status === "confirmado").length;
  const totalMes = ((custosMes.data ?? []) as { total_brl: number }[]).reduce((s: number, r: { total_brl: number }) => s + Number(r.total_brl), 0);
  const contatosHoje = new Set(((conversasHoje.data ?? []) as { cliente_id: string }[]).map((m) => m.cliente_id)).size;

  return (
    <>
      <Cabecalho titulo={`Olá, ${u.nome.split(" ")[0]}`} sub={`Resumo de hoje, ${formatarDataHora(new Date(), off).split(" às")[0]}`} />
      {erro === "sem_permissao" && <div className="alerta aviso">Seu perfil não tem acesso a essa área.</div>}
      {!cfg.bot_ativo && <div className="alerta erro">O assistente virtual está DESLIGADO. Todas as conversas estão indo para a recepção.</div>}

      <div className="grade g4">
        {verAgenda && <Kpi rotulo="Agendamentos hoje" valor={ags.length} sub={`${confirmados} confirmados · ${ags.length - confirmados} pendentes`} />}
        {verAtendimento && <Kpi rotulo="Aguardando atendimento" valor={<span style={{ color: (fila.count ?? 0) ? "var(--erro)" : undefined }}>{fila.count ?? 0}</span>} sub={<Link href="/painel/conversas?aba=espera">abrir fila</Link>} />}
        {verAtendimento && <Kpi rotulo="Clientes que falaram hoje" valor={contatosHoje} />}
        {verCusto ? (
          <Kpi rotulo="Custo do mês" valor={formatarBRL(totalMes)} sub={<Link href="/painel/financeiro">ver detalhes</Link>} />
        ) : verAtendimento ? (
          <Kpi rotulo="Bloqueios de segurança hoje" valor={bloqueios.count ?? 0} />
        ) : null}
      </div>

      {!verAgenda && !verAtendimento && !verCusto && (
        <div className="card secao">
          <h2>Bem-vindo à Plataforma Comauto</h2>
          <p className="mudo">Use o menu ao lado para abrir o seu setor. A busca de clientes procura em todo o grupo.</p>
        </div>
      )}

      {verAgenda && <div className="secao card">
        <h2>Próximos agendamentos</h2>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr><th>Quando</th><th>Cliente</th><th>Serviço</th><th>Box</th><th>Status</th><th>Quem confirmou</th></tr>
            </thead>
            <tbody>
              {((proximos.data ?? []) as unknown as { id: string; inicio: string; status: string; confirmado_por: string | null; clientes: { nome: string | null } | null; servicos: { nome: string } | null; recursos: { nome: string } | null }[]).map((a) => (
                <tr key={a.id}>
                  <td className="num">{formatarDataHora(a.inicio, off)}</td>
                  <td>{a.clientes?.nome ?? "—"}</td>
                  <td>{a.servicos?.nome}</td>
                  <td>{a.recursos?.nome}</td>
                  <td><Status valor={a.status} /></td>
                  <td className="mudo">{a.confirmado_por ?? "—"}</td>
                </tr>
              ))}
              {!proximos.data?.length && <tr><td colSpan={6} className="mudo">Nenhum agendamento futuro.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>}
    </>
  );
}
