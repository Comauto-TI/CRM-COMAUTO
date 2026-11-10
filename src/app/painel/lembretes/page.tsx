import Link from "next/link";
import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { formatarDataHora } from "@/lib/time";
import { meusAgendados, cancelarAgendado } from "@/lib/agendados";
import { explicarBloqueio } from "@/lib/agendados-regras";
import { nucleoAplicado } from "@/lib/usuarios";
import { Cabecalho, Vazio } from "../_components/ui";

type Cli = { id: string; nome: string | null } | null;
const umCliente = (c: unknown): Cli => (Array.isArray(c) ? (c[0] as Cli) ?? null : (c as Cli));
const linkCliente = (c: Cli, op: string | null) => (op ? `/painel/vendas?op=${op}` : `/painel/busca?q=${encodeURIComponent(c?.nome ?? "")}`);

const STATUS_MSG: Record<string, [string, string]> = {
  pendente: ["info", "agendada"],
  enviando: ["info", "enviando"],
  enviada: ["ok", "enviada"],
  bloqueada: ["erro", "não enviada"],
  cancelada: ["", "cancelada"],
};

async function cancelar(f: FormData) {
  "use server";
  const u = await exigirAcesso("lembretes");
  const tipo = f.get("tipo") === "mensagem" ? "mensagem" : "lembrete";
  await cancelarAgendado(u, tipo, String(f.get("id") ?? ""));
  revalidatePath("/painel/lembretes");
}

export default async function Lembretes() {
  const u = await exigirAcesso("lembretes");
  const [{ lembretes, mensagens }, cfg, pronto] = await Promise.all([meusAgendados(u), getConfig(), nucleoAplicado()]);
  const off = cfg.fuso_offset;

  return (
    <>
      <Cabecalho titulo="Meus lembretes" sub="Lembretes para você e mensagens agendadas para clientes (próximos e últimos 30 dias)" />
      {!pronto && <div className="alerta aviso">Disponível após a atualização do banco (núcleo).</div>}
      <p className="mudo" style={{ marginTop: 0 }}>Para agendar, abra o cartão do cliente em <Link href="/painel/vendas">Vendas</Link> e use &quot;Agendar lembrete ou mensagem&quot;.</p>

      <div className="grade g2">
        <section className="card">
          <h2>Lembretes</h2>
          {!lembretes.length ? <Vazio>Nenhum lembrete.</Vazio> : (
            <ul className="lista-agendados">
              {lembretes.map((l) => {
                const c = umCliente(l.cliente);
                const feito = !!l.concluido_em;
                const disparado = !!l.notificado_em;
                return (
                  <li key={l.id} className={feito ? "feito" : ""}>
                    <div>
                      <strong><Link href={linkCliente(c, l.oportunidade_id)}>{c?.nome ?? "Cliente"}</Link></strong>
                      <div className="mudo">{l.observacao}</div>
                    </div>
                    <div className="lista-agendados-lado">
                      <span className="num">{formatarDataHora(l.quando, off)}</span>
                      <span className={`tag ${feito ? "" : disparado ? "ok" : "info"}`}>{feito ? "cancelado" : disparado ? "avisado" : "agendado"}</span>
                      {!feito && !disparado && (
                        <form action={cancelar}><input type="hidden" name="tipo" value="lembrete" /><input type="hidden" name="id" value={l.id} /><button className="btn pequeno">Cancelar</button></form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Mensagens agendadas</h2>
          {!mensagens.length ? <Vazio>Nenhuma mensagem agendada.</Vazio> : (
            <ul className="lista-agendados">
              {mensagens.map((m) => {
                const c = umCliente(m.cliente);
                const [cor, rotulo] = STATUS_MSG[m.status] ?? ["", m.status];
                return (
                  <li key={m.id}>
                    <div>
                      <strong><Link href={linkCliente(c, m.oportunidade_id)}>{c?.nome ?? "Cliente"}</Link></strong>
                      <div className="mudo">{m.texto}</div>
                      {m.status === "enviada" && m.modo === "template" && <small className="mudo">Saiu o modelo aprovado de retomada (janela de 24h fechada).</small>}
                      {m.status === "bloqueada" && m.motivo && <small className="texto-erro">Motivo: {explicarBloqueio(m.motivo)}</small>}
                    </div>
                    <div className="lista-agendados-lado">
                      <span className="num">{formatarDataHora(m.enviar_em, off)}</span>
                      <span className={`tag ${cor}`}>{rotulo}</span>
                      {m.status === "pendente" && (
                        <form action={cancelar}><input type="hidden" name="tipo" value="mensagem" /><input type="hidden" name="id" value={m.id} /><button className="btn pequeno">Cancelar</button></form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
