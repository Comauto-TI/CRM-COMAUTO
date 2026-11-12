import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora, DIAS } from "@/lib/time";
import { Cabecalho, Status } from "../_components/ui";
import { tabelaUsuarios } from "@/lib/usuarios";
import { NovoMembro, RedefinirSenha } from "./Equipe";
import { PAPEIS, PAPEIS_LEGADO, SETORES, ROTULO_PAPEL, ROTULO_SETOR } from "@/lib/permissoes";
import { salvarEmpresa, salvarFinanceiro, salvarCustoFixo, salvarTemplate, salvarServico, adicionarBloqueio, removerBloqueio, salvarEquipe } from "./actions";

export default async function Configuracoes() {
  const u = await exigirAcesso("custos_config");
  const admin = u.papel === "admin";
  const cfg = await getConfig();
  const tabelaEquipe = await tabelaUsuarios();
  const unidadesLista = tabelaEquipe === "usuarios" ? (((await db().from("unidades").select("chave, nome").order("ativa", { ascending: false }).order("nome")).data ?? []) as { chave: string; nome: string }[]) : [];

  const [precos, fixos, templates, servicos, recursos, horarios, bloqueios, equipe] = await Promise.all([
    db().from("precos_meta").select("categoria, valor_brl, vigente_desde").order("vigente_desde", { ascending: false }),
    db().from("custos_fixos").select("*").order("nome"),
    db().from("templates").select("id, nome, categoria_meta, finalidade, uso, corpo_exemplo, status_aprovacao, ativo").order("nome"),
    db().from("servicos").select("*").order("nome"),
    db().from("recursos").select("id, nome, tipo").order("nome"),
    db().from("horarios_funcionamento").select("dia_semana, abre, fecha").order("dia_semana").order("abre"),
    db().from("bloqueios").select("id, inicio, fim, motivo, recursos!bloqueios_recurso_id_fkey(nome)").gte("fim", new Date().toISOString()).order("inicio"),
    db().from(tabelaEquipe).select("*").order("nome"),
  ]);
  const precoAtual = (cat: string) => (precos.data ?? []).find((p) => p.categoria === cat);

  return (
    <>
      <Cabecalho titulo="Configurações" sub="Tudo que o assistente usa vem daqui. A IA não inventa nada fora destes dados." />

      {admin && (
        <div className="card">
          <h2>Empresa e assistente</h2>
          <form action={salvarEmpresa} className="form">
            <div className="linha-form">
              <label>Nome<input name="nome" defaultValue={cfg.empresa.nome} required /></label>
              <label>Telefone da recepção<input name="telefone_humano" defaultValue={cfg.empresa.telefone_humano} /></label>
              <label>Site<input name="site" defaultValue={cfg.empresa.site} /></label>
              <label>Nº oficial do WhatsApp (links/QR)<input name="whatsapp_numero" defaultValue={cfg.empresa.whatsapp_numero ?? ""} placeholder="5551999998888" /></label>
            </div>
            <label>Endereço (usado nas mensagens)<input name="endereco" defaultValue={cfg.empresa.endereco} /></label>
            <label>Logo oficial (URL https de uma imagem SVG/PNG; vazio = monograma Comauto)<input name="logo_url" defaultValue={cfg.empresa.logo_url ?? ""} placeholder="https://…/logo.svg" /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="bot_ativo" defaultChecked={cfg.bot_ativo} style={{ width: "auto" }} /> Assistente virtual ligado (desligado = tudo vai para a recepção)
            </label>
            <div><button className="btn primario">Salvar</button></div>
          </form>
        </div>
      )}

      <div className="card secao" id="financeiro">
        <h2>Preços e câmbio</h2>
        <form action={salvarFinanceiro} className="form">
          <div className="linha-form">
            <label>Câmbio US$ → R$<input name="cambio" defaultValue={cfg.cambio_usd_brl} /></label>
            {["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"].map((c) => (
              <label key={c}>{c} (R$/msg)<input name={`preco_${c}`} defaultValue={precoAtual(c)?.valor_brl ?? ""} /></label>
            ))}
            <label>Vigente desde<input type="date" name="vigente" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          </div>
          <div className="mudo">Alterar um preço cria um novo registro com data de vigência: o histórico do financeiro continua correto. Confira na tabela oficial da Meta para o Brasil.</div>
          <div><button className="btn primario">Salvar preços</button></div>
        </form>

        <h3 className="secao">Custos fixos</h3>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Valor</th><th>Moeda</th><th>Recorrência</th><th>Ativo</th><th></th></tr></thead>
            <tbody>
              {[...(fixos.data ?? []), { id: "", nome: "", valor: "", moeda: "BRL", recorrencia: "mensal", ativo: true }].map((f) => (
                <tr key={f.id || "novo"}>
                  <td colSpan={6}>
                    <form action={salvarCustoFixo} className="linha-form">
                      <input type="hidden" name="id" value={f.id} />
                      <input name="nome" defaultValue={f.nome} placeholder="Novo custo fixo" required />
                      <input name="valor" defaultValue={String(f.valor)} placeholder="0,00" required />
                      <select name="moeda" defaultValue={f.moeda}><option>BRL</option><option>USD</option></select>
                      <select name="recorrencia" defaultValue={f.recorrencia}><option value="mensal">mensal</option><option value="anual">anual</option></select>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }}><input type="checkbox" name="ativo" defaultChecked={f.ativo} style={{ width: "auto" }} /> ativo</label>
                      <button className="btn pequeno" style={{ flex: "0 0 auto" }}>{f.id ? "Salvar" : "Adicionar"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {admin && (
        <>
          <div className="card secao">
            <h2>Templates da Meta</h2>
            <p className="mudo">Crie cada template no WhatsApp Manager com o MESMO nome e texto. Só marque &quot;aprovado&quot; depois que a Meta aprovar: o sistema não envia template que não esteja aprovado.</p>
            <div className="tabela-wrap">
              <table className="tabela">
                <thead><tr><th>Template</th><th>Categoria / consentimento</th><th>Texto</th><th>Status</th></tr></thead>
                <tbody>
                  {(templates.data ?? []).map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.nome}</strong><div className="mudo">{t.uso}</div></td>
                      <td><span className="tag">{t.categoria_meta}</span> <span className="tag info">{t.finalidade}</span></td>
                      <td className="mudo" style={{ maxWidth: 420 }}>{t.corpo_exemplo}</td>
                      <td>
                        <form action={salvarTemplate} className="acoes">
                          <input type="hidden" name="id" value={t.id} />
                          <select name="status_aprovacao" defaultValue={t.status_aprovacao}>
                            {["rascunho", "pendente", "aprovado", "reprovado"].map((s) => <option key={s}>{s}</option>)}
                          </select>
                          <label style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" name="ativo" defaultChecked={t.ativo} style={{ width: "auto" }} /> ativo</label>
                          <button className="btn pequeno">Salvar</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grade g2 secao">
            <div className="card">
              <h2>Serviços</h2>
              <p className="mudo">Preço de referência vazio = o assistente diz que o valor é passado pela equipe.</p>
              {[...(servicos.data ?? []), { id: "", nome: "", duracao_min: 60, preco_referencia: null, tipo_recurso: "box", ativo: true }].map((s) => (
                <form key={s.id || "novo"} action={salvarServico} className="linha-form" style={{ marginBottom: 8 }}>
                  <input type="hidden" name="id" value={s.id} />
                  <input name="nome" defaultValue={s.nome} placeholder="Novo serviço" required />
                  <input name="duracao" type="number" defaultValue={s.duracao_min} title="minutos" style={{ maxWidth: 90 }} />
                  <input name="preco" defaultValue={s.preco_referencia ?? ""} placeholder="R$ ref." style={{ maxWidth: 100 }} />
                  <select name="tipo_recurso" defaultValue={s.tipo_recurso} style={{ maxWidth: 120 }}><option value="box">box</option><option value="consultor">consultor</option><option value="sala">sala</option></select>
                  <label style={{ display: "flex", gap: 4, alignItems: "center", flex: "0 0 auto" }}><input type="checkbox" name="ativo" defaultChecked={s.ativo} style={{ width: "auto" }} /> ativo</label>
                  <button className="btn pequeno" style={{ flex: "0 0 auto" }}>{s.id ? "Salvar" : "Adicionar"}</button>
                </form>
              ))}
            </div>

            <div className="card">
              <h2>Agenda: horários e bloqueios</h2>
              <ul className="mudo" style={{ paddingLeft: 16 }}>
                {Object.entries((horarios.data ?? []).reduce<Record<number, string[]>>((a, h) => ((a[h.dia_semana] = [...(a[h.dia_semana] ?? []), `${h.abre.slice(0, 5)}–${h.fecha.slice(0, 5)}`]), a), {})).map(([d, f]) => (
                  <li key={d}>{DIAS[Number(d)]}: {f.join(" e ")}</li>
                ))}
              </ul>
              <p className="mudo">Recursos: {(recursos.data ?? []).map((r) => `${r.nome} (${r.tipo})`).join(", ")}</p>
              <h3>Bloqueios e feriados</h3>
              <form action={adicionarBloqueio} className="linha-form">
                <label>Início<input type="datetime-local" name="inicio" required /></label>
                <label>Fim<input type="datetime-local" name="fim" required /></label>
                <label>Recurso
                  <select name="recurso" defaultValue=""><option value="">Unidade toda</option>{(recursos.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select>
                </label>
                <label>Motivo<input name="motivo" placeholder="Feriado, manutenção…" /></label>
                <button className="btn pequeno" style={{ flex: "0 0 auto" }}>Bloquear</button>
              </form>
              <ul style={{ paddingLeft: 16 }}>
                {((bloqueios.data ?? []) as unknown as { id: string; inicio: string; fim: string; motivo: string | null; recursos: { nome: string } | null }[]).map((b) => (
                  <li key={b.id} className="acoes">
                    {formatarDataHora(b.inicio, cfg.fuso_offset)} → {formatarDataHora(b.fim, cfg.fuso_offset)} · {b.recursos?.nome ?? "unidade toda"} · {b.motivo ?? ""}
                    <form action={removerBloqueio}><input type="hidden" name="id" value={b.id} /><button className="btn pequeno perigo">remover</button></form>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card secao">
            <h2>Equipe</h2>
            <p className="mudo">A equipe, os alertas e os links de cadastro agora ficam em <a href="/painel/usuarios">Administração → Usuários</a>.</p>
          </div>
        </>
      )}
      {!admin && <p className="mudo secao">Outras configurações são visíveis apenas para administradores.</p>}
      <div className="secao mudo">Seu acesso: <Status valor={u.papel} /></div>
    </>
  );
}
