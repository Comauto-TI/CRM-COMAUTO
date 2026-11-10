import { exigirPapel } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora } from "@/lib/time";
import { mascararTelefone } from "@/lib/phone";
import { Cabecalho, Kpi } from "../_components/ui";

const ROTULO: Record<string, string> = {
  pedido_codigo: "Pedido de código/cupom",
  pedido_receita: "Pedido de receita",
  pedido_credencial: "Pedido de chave/senha",
  prompt_injection: "Tentativa de manipulação",
  saida_bloqueada: "Resposta da IA bloqueada",
  rate_limit: "Excesso de mensagens",
  assinatura_invalida: "Webhook com assinatura inválida",
  dados_sensiveis: "Dado sensível mascarado",
  fora_escopo: "Fora do escopo",
};

export default async function Seguranca() {
  await exigirPapel(["admin"]);
  const cfg = await getConfig();
  const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: eventos }, { data: auditoria }] = await Promise.all([
    db().from("eventos_seguranca").select("id, telefone, tipo, trecho, acao, criado_em").gte("criado_em", desde).order("criado_em", { ascending: false }).limit(300),
    db().from("audit_log").select("id, ator, acao, entidade, entidade_id, criado_em").order("criado_em", { ascending: false }).limit(150),
  ]);
  const porTipo = (eventos ?? []).reduce<Record<string, number>>((a, e) => ((a[e.tipo] = (a[e.tipo] ?? 0) + 1), a), {});

  return (
    <>
      <Cabecalho titulo="Segurança" sub="Tudo que foi bloqueado nos últimos 30 dias e quem fez o quê no painel" />
      <div className="grade g4">
        <Kpi rotulo="Pedidos de chave/senha" valor={porTipo.pedido_credencial ?? 0} />
        <Kpi rotulo="Tentativas de manipulação" valor={porTipo.prompt_injection ?? 0} />
        <Kpi rotulo="Pedidos de código/receita" valor={(porTipo.pedido_codigo ?? 0) + (porTipo.pedido_receita ?? 0)} />
        <Kpi rotulo="Respostas da IA barradas" valor={porTipo.saida_bloqueada ?? 0} sub="última barreira, antes de enviar" />
      </div>

      <div className="secao card">
        <h2>Eventos bloqueados</h2>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Tipo</th><th>Telefone</th><th>Trecho</th><th>Ação</th></tr></thead>
            <tbody>
              {(eventos ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="num">{formatarDataHora(e.criado_em, cfg.fuso_offset)}</td>
                  <td>{ROTULO[e.tipo] ?? e.tipo}</td>
                  <td className="mudo">{e.telefone ? mascararTelefone(e.telefone) : "—"}</td>
                  <td className="mudo" style={{ maxWidth: 420 }}>{e.trecho}</td>
                  <td className="mudo">{e.acao}</td>
                </tr>
              ))}
              {!eventos?.length && <tr><td colSpan={5} className="mudo">Nenhum evento nos últimos 30 dias.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="secao card">
        <h2>Auditoria do painel</h2>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th></tr></thead>
            <tbody>
              {(auditoria ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="num">{formatarDataHora(a.criado_em, cfg.fuso_offset)}</td>
                  <td>{a.ator}</td>
                  <td>{a.acao}</td>
                  <td className="mudo">{a.entidade}{a.entidade_id ? ` · ${String(a.entidade_id).slice(0, 8)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
