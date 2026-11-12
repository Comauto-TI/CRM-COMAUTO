import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora } from "@/lib/time";
import { tabelaUsuarios } from "@/lib/usuarios";
import { listarConvites, TIPOS_CONVITE } from "@/lib/convites";
import { PAPEIS, PAPEIS_LEGADO, SETORES, ROTULO_PAPEL, ROTULO_SETOR } from "@/lib/permissoes";
import { Cabecalho } from "../_components/ui";
import { NovoMembro, RedefinirSenha } from "../configuracoes/Equipe";
import { salvarEquipe } from "../configuracoes/actions";
import NovoLink from "./NovoLink";
import { revogarConviteAction } from "./actions";

/** Aba Usuários (só admin): links de cadastro por setor + equipe (papel, setor, alertas, ativo, nova senha). */
export default async function Usuarios() {
  const u = await exigirAcesso("configuracoes");
  const cfg = await getConfig();
  const tabela = await tabelaUsuarios();
  const [{ data: unidades }, { data: equipe }, convites] = await Promise.all([
    db().from("unidades").select("chave, nome").order("ativa", { ascending: false }).order("nome"),
    db().from(tabela).select("*").order("nome"),
    tabela === "usuarios" ? listarConvites().catch(() => []) : Promise.resolve([]),
  ]);
  const listaUnidades = (unidades ?? []) as { chave: string; nome: string }[];
  const agora = new Date();
  const ativo = (c: (typeof convites)[number]) => !c.revogado_em && new Date(c.expira_em) > agora && c.usos < c.max_usos;

  return (
    <>
      <Cabecalho titulo="Usuários" sub="Links de cadastro por setor e a equipe da plataforma" />

      {tabela === "usuarios" && (
        <section className="card">
          <h2>Link de cadastro</h2>
          <p className="mudo">Gere um link e mande no WhatsApp da pessoa: ela cria o próprio acesso já como vendedor, peças ou agendamento, na unidade escolhida. O link expira e tem limite de pessoas.</p>
          <NovoLink unidades={listaUnidades} />
          {convites.length > 0 && (
            <div className="tabela-wrap secao">
              <table className="tabela">
                <thead><tr><th>Tipo</th><th>Unidade</th><th>Usados</th><th>Validade</th><th>Situação</th><th /></tr></thead>
                <tbody>
                  {convites.map((c) => (
                    <tr key={c.id}>
                      <td>{TIPOS_CONVITE[c.tipo]?.rotulo ?? c.tipo}</td>
                      <td>{c.unidade}</td>
                      <td className="num">{c.usos}/{c.max_usos}</td>
                      <td>{formatarDataHora(c.expira_em, cfg.fuso_offset)}</td>
                      <td>{c.revogado_em ? <span className="tag">cancelado</span> : ativo(c) ? <span className="tag ok">valendo</span> : <span className="tag">encerrado</span>}</td>
                      <td>{ativo(c) && <form action={revogarConviteAction}><input type="hidden" name="id" value={c.id} /><button className="btn pequeno">Cancelar</button></form>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card secao">
        <h2>Equipe</h2>
        {tabela === "usuarios" && (
          <details className="secao">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Cadastrar pessoa direto (sem link)</summary>
            <p className="mudo">Cria o login com senha provisória. Se o e-mail já tiver login em outro sistema do grupo, a pessoa só é vinculada (a senha dela não muda).</p>
            <NovoMembro unidades={listaUnidades} />
          </details>
        )}
        <p className="mudo">Quem marcar &quot;recebe alertas&quot; recebe no próprio WhatsApp o aviso de cliente aguardando, com link direto para responder pelo painel.</p>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Pessoa</th><th colSpan={2}>Configuração</th></tr></thead>
            <tbody>
              {(equipe ?? []).map((p) => (
                <tr key={p.user_id}>
                  <td>{p.nome}{p.consentimento_alertas_em && <div className="mudo">alertas autorizados em {formatarDataHora(p.consentimento_alertas_em, cfg.fuso_offset)}</div>}</td>
                  <td colSpan={2}>
                    <form action={salvarEquipe} className="linha-form">
                      <input type="hidden" name="user_id" value={p.user_id} />
                      <select name="papel" defaultValue={p.papel} aria-label="Papel">{(tabela === "usuarios" ? PAPEIS : PAPEIS_LEGADO).map((x) => <option key={x} value={x}>{ROTULO_PAPEL[x]}{x === "atendente" ? " (legado)" : ""}</option>)}</select>
                      {tabela === "usuarios" && <select name="setor" defaultValue={p.setor} aria-label="Setor">{SETORES.map((x) => <option key={x} value={x}>{ROTULO_SETOR[x]}</option>)}</select>}
                      <input name="telefone" defaultValue={p.telefone_whatsapp ?? ""} placeholder="WhatsApp p/ alertas" />
                      <label style={{ display: "flex", gap: 4, alignItems: "center", flex: "0 0 auto" }}><input type="checkbox" name="recebe_alertas" defaultChecked={p.recebe_alertas} style={{ width: "auto" }} /> recebe alertas</label>
                      {p.user_id === u.id && <input type="hidden" name="ativo" value="on" />}
                      <label style={{ display: "flex", gap: 4, alignItems: "center", flex: "0 0 auto" }}><input type="checkbox" name="ativo" defaultChecked={p.ativo} disabled={p.user_id === u.id} style={{ width: "auto" }} /> {p.user_id === u.id ? "seu acesso ativo" : "ativo"}</label>
                      <button className="btn pequeno" style={{ flex: "0 0 auto" }}>Salvar</button>
                    </form>
                    {tabela === "usuarios" && p.user_id !== u.id && <RedefinirSenha userId={p.user_id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
