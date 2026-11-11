import Link from "next/link";
import type { Usuario } from "@/lib/auth";
import { formatarDataHora } from "@/lib/time";
import { carregarMeuDia } from "@/modulos/vendas/meu-dia";
import { HORAS_LEAD_SEM_CONTATO } from "@/modulos/vendas/meu-dia-regras";

/** Bloco "Meu dia" da Visão geral (vendedor e gerente de Vendas): por onde começar hoje. */
export default async function MeuDia({ u, fimDoDia, fuso }: { u: Usuario; fimDoDia: Date; fuso: string }) {
  const r = await carregarMeuDia(u, new Date(), fimDoDia).catch(() => null);
  if (!r) return null;
  const link = (funil: string, op: string) => `/painel/vendas?funil=${funil}&op=${op}`;
  const MAX = 6;

  return (
    <section className="secao card meu-dia">
      <div className="aniv-cabecalho">
        <h2>Meu dia</h2>
        <span className="mudo">{r.total ? `${r.total} ${r.total === 1 ? "coisa pede" : "coisas pedem"} sua atenção` : "nada pendente"}</span>
      </div>
      {!r.total ? <p className="mudo">Tudo em dia: sem tarefa vencida, lead esperando ou cartão parado além do prazo. ✓</p> : (
        <div className="meu-dia-grade">
          {r.atrasadas.length > 0 && (
            <div>
              <h3 className="texto-erro">Tarefas atrasadas ({r.atrasadas.length})</h3>
              <ul>{r.atrasadas.slice(0, MAX).map((t) => <li key={t.id}><Link href={link(t.funil, t.oportunidadeId)}>{t.titulo}</Link><small className="mudo"> · {t.cliente} · venceu {formatarDataHora(t.prazo, fuso)}</small></li>)}</ul>
            </div>
          )}
          {r.semContato.length > 0 && (
            <div>
              <h3 className="texto-aviso">Leads esperando o primeiro contato ({r.semContato.length})</h3>
              <ul>{r.semContato.slice(0, MAX).map((c) => <li key={c.id}><Link href={link(c.funil, c.id)}>{c.cliente}</Link><small className="mudo"> · chegou {formatarDataHora(c.criadoEm, fuso)}</small></li>)}</ul>
              <small className="mudo">Lead novo há mais de {HORAS_LEAD_SEM_CONTATO} h sem ligação, WhatsApp ou visita registrada.</small>
            </div>
          )}
          {r.hoje.length > 0 && (
            <div>
              <h3>Tarefas de hoje ({r.hoje.length})</h3>
              <ul>{r.hoje.slice(0, MAX).map((t) => <li key={t.id}><Link href={link(t.funil, t.oportunidadeId)}>{t.titulo}</Link><small className="mudo"> · {t.cliente} · {formatarDataHora(t.prazo, fuso).split(" às ")[1] ?? ""}</small></li>)}</ul>
            </div>
          )}
          {r.parados.length > 0 && (
            <div>
              <h3 className="texto-aviso">Cartões parados além do prazo ({r.parados.length})</h3>
              <ul>{r.parados.slice(0, MAX).map((c) => <li key={c.id}><Link href={link(c.funil, c.id)}>{c.cliente}</Link><small className="mudo"> · {c.etapa} há {c.dias} dias (prazo {c.slaDias})</small></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
