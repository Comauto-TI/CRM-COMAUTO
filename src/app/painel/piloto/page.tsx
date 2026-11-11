import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { nucleoAplicado, tabelaUsuarios } from "@/lib/usuarios";
import { vendasDisponivel } from "@/modulos/vendas/dados";
import { avaliarProntidao, resumoProntidao, configurado, type Fatos } from "@/lib/prontidao";
import { Cabecalho } from "../_components/ui";

/** Prontidão do piloto (admin): o que falta para colocar o WhatsApp e o painel em uso. Mostra só se cada chave EXISTE. */
export default async function Prontidao() {
  await exigirAcesso("configuracoes");
  const cfg = await getConfig();
  const [nucleo, vendas] = await Promise.all([nucleoAplicado(), vendasDisponivel()]);
  const tabela = await tabelaUsuarios();
  const [tpl, equipe, servicos, recursos, horarios, qr] = await Promise.all([
    db().from("templates").select("uso").eq("status_aprovacao", "aprovado").eq("ativo", true),
    db().from(tabela).select("papel, ativo, recebe_alertas, telefone_whatsapp, consentimento_alertas_em").eq("ativo", true),
    db().from("servicos").select("id", { count: "exact", head: true }).eq("ativo", true),
    db().from("recursos").select("id", { count: "exact", head: true }).eq("ativo", true),
    db().from("horarios_funcionamento").select("dia_semana", { count: "exact", head: true }),
    db().from("links_rastreados").select("id", { count: "exact", head: true }).eq("ativo", true),
  ]);
  const pessoas = (equipe.data ?? []) as { papel: string; recebe_alertas: boolean; telefone_whatsapp: string | null; consentimento_alertas_em: string | null }[];
  const e = process.env;
  const fatos: Fatos = {
    chaves: {
      anthropic: configurado(e.ANTHROPIC_API_KEY, 20),
      whatsappToken: configurado(e.WHATSAPP_TOKEN, 20),
      whatsappNumero: configurado(e.WHATSAPP_PHONE_NUMBER_ID, 5),
      whatsappSegredo: configurado(e.WHATSAPP_APP_SECRET, 10),
      whatsappVerify: configurado(e.WHATSAPP_VERIFY_TOKEN, 8),
      cron: configurado(e.CRON_SECRET, 16),
    },
    appUrl: e.APP_URL ?? "",
    templatesAprovados: (tpl.data ?? []).map((t) => t.uso as string),
    equipe: {
      admin: pessoas.filter((p) => p.papel === "admin").length,
      recepcao: pessoas.filter((p) => p.papel === "recepcao" || p.papel === "atendente").length,
      vendedor: pessoas.filter((p) => p.papel === "vendedor").length,
      recepcaoComAlerta: pessoas.filter((p) => p.recebe_alertas && p.telefone_whatsapp && p.consentimento_alertas_em).length,
    },
    agenda: { servicos: servicos.count ?? 0, recursos: recursos.count ?? 0, horarios: horarios.count ?? 0 },
    qrAtivos: qr.count ?? 0,
    botAtivo: !!cfg.bot_ativo,
    nucleo, vendas,
  };
  const itens = avaliarProntidao(fatos);
  const r = resumoProntidao(itens);
  const grupos = [...new Set(itens.map((i) => i.grupo))];

  return (
    <>
      <Cabecalho titulo="Prontidão do piloto" sub="O que já está pronto e o que falta para colocar o WhatsApp e o painel em uso na Comauto" />
      <div className={`alerta ${r.pronto ? "ok" : "aviso"}`}>
        {r.pronto
          ? `Pronto para o piloto: ${r.ok} de ${r.total} itens ok${r.pendente ? ` · ${r.pendente} recomendações pendentes` : ""}.`
          : `${r.bloqueia} ${r.bloqueia === 1 ? "item bloqueia" : "itens bloqueiam"} o piloto · ${r.ok} de ${r.total} prontos${r.pendente ? ` · ${r.pendente} recomendações` : ""}.`}
      </div>
      <div className="grade g2">
        {grupos.map((g) => (
          <section key={g} className="card">
            <h2>{g}</h2>
            <ul className="lista-prontidao">
              {itens.filter((i) => i.grupo === g).map((i) => (
                <li key={i.titulo} className={`pr-${i.estado}`}>
                  <span className="pr-marca" aria-hidden="true">{i.estado === "ok" ? "✓" : i.estado === "bloqueia" ? "!" : "•"}</span>
                  <div>
                    <strong>{i.titulo}</strong>
                    <span className="sr-only">{i.estado === "ok" ? "pronto" : i.estado === "bloqueia" ? "bloqueia o piloto" : "recomendado"}</span>
                    {i.acao && <small className="mudo">{i.acao}</small>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mudo secao">Esta tela só verifica se as chaves existem — nenhum valor é exibido. Equipe: <Link href="/painel/configuracoes">Configurações → Cadastrar pessoa</Link>.</p>
    </>
  );
}
