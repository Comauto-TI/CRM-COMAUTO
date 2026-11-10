import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora } from "@/lib/time";
import { mascararTelefone } from "@/lib/phone";
import { Cabecalho, Status } from "../_components/ui";
import { podeAcessar } from "@/lib/permissoes";
import { anonimizar, optoutManual, importarCSV } from "./actions";

type Cli = {
  id: string; nome: string | null; telefone: string; cidade: string | null; tags: string[]; origem: string; ultimo_contato_em: string | null; anonimizado: boolean;
  consentimentos: { tipo: string; status: string }[];
};

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string; ok?: string; inv?: string; opt?: string }> }) {
  const u = await exigirAcesso("clientes");
  const cfg = await getConfig();
  const sp = await searchParams;

  let q = db()
    .from("clientes")
    .select("id, nome, telefone, cidade, tags, origem, ultimo_contato_em, anonimizado, consentimentos(tipo, status)")
    .order("ultimo_contato_em", { ascending: false, nullsFirst: false })
    .limit(200);
  if (sp.q) {
    const t = sp.q.replace(/[%,()]/g, "").slice(0, 40);
    q = q.or(`nome.ilike.%${t}%,telefone.ilike.%${t.replace(/\D/g, "") || t}%,cidade.ilike.%${t}%`);
  }
  const [{ data }, { data: opts }] = await Promise.all([q, db().from("optouts").select("telefone")]);
  const bloqueados = new Set((opts ?? []).map((o) => o.telefone));
  const lista = (data ?? []) as unknown as Cli[];
  const admin = u.papel === "admin";
  const podeLgpd = podeAcessar(u, "lgpd"); // F0-3-001: exportação integral só com permissão LGPD

  return (
    <>
      <Cabecalho titulo="Clientes" sub="Consentimentos por tipo, opt-outs e direitos LGPD">
        <form className="linha-form">
          <input name="q" defaultValue={sp.q} placeholder="Nome, telefone ou cidade" />
          <button className="btn">Buscar</button>
        </form>
      </Cabecalho>

      {sp.msg === "import_ok" && <div className="alerta ok">Importação concluída: {sp.ok} contatos com consentimento registrado · {sp.inv} telefones inválidos · {sp.opt} ignorados por opt-out.</div>}
      {sp.msg === "import_incompleto" && <div className="alerta erro">Importação recusada: informe a origem, o texto exato do consentimento, os tipos e marque a declaração.</div>}

      {admin && (
        <details className="card" style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Importar base com consentimento</summary>
          <form action={importarCSV} className="form" style={{ marginTop: 12 }}>
            <div className="alerta aviso">Somente contatos que deram consentimento comprovado (formulário, ficha de atendimento, inscrição em evento). Nunca listas compradas.</div>
            <label>Origem do consentimento<input name="origem" required placeholder="ex.: ficha de inscrição do evento Feirão 2026" /></label>
            <label>Texto exato que a pessoa aceitou<textarea name="texto" required rows={2} placeholder={`Autorizo a ${cfg.empresa.nome} a me contatar pelo WhatsApp para...`} /></label>
            <div className="acoes">
              <label style={{ display: "flex", gap: 6 }}><input type="checkbox" name="tipos" value="servico" style={{ width: "auto" }} /> Serviço</label>
              <label style={{ display: "flex", gap: 6 }}><input type="checkbox" name="tipos" value="eventos" style={{ width: "auto" }} /> Eventos</label>
              <label style={{ display: "flex", gap: 6 }}><input type="checkbox" name="tipos" value="marketing" style={{ width: "auto" }} /> Marketing</label>
            </div>
            <label>CSV (telefone;nome;cidade;tags separadas por |)<textarea name="csv" rows={6} required placeholder={"51999998888;Maria Souza;Porto Alegre;suv|evento2026"} /></label>
            <label style={{ display: "flex", gap: 6 }}><input type="checkbox" name="declaro" style={{ width: "auto" }} /> Declaro que todos os contatos autorizaram o recebimento conforme o texto acima.</label>
            <div><button className="btn primario">Importar</button></div>
          </form>
        </details>
      )}

      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Cliente</th><th>Origem</th><th>Consentimentos</th><th>Último contato</th><th>LGPD</th></tr></thead>
          <tbody>
            {lista.map((c) => {
              const opt = bloqueados.has(c.telefone);
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.anonimizado ? "[anonimizado]" : c.nome ?? "—"}</strong>
                    <div className="mudo">{mascararTelefone(c.telefone)}{c.cidade ? ` · ${c.cidade}` : ""}</div>
                    <div className="acoes">{c.tags.map((t) => <span key={t} className="tag info">{t}</span>)}</div>
                  </td>
                  <td className="mudo">{c.origem}</td>
                  <td>
                    <div className="acoes">
                      {opt && <span className="tag erro">opt-out</span>}
                      {c.consentimentos.filter((k) => k.status === "ativo").map((k) => <Status key={k.tipo} valor={k.tipo} />)}
                      {!opt && !c.consentimentos.some((k) => k.status === "ativo") && <span className="mudo">nenhum</span>}
                    </div>
                  </td>
                  <td className="num mudo">{c.ultimo_contato_em ? formatarDataHora(c.ultimo_contato_em, cfg.fuso_offset) : "—"}</td>
                  <td>
                    {!c.anonimizado && (
                      <div className="acoes">
                        {podeLgpd && <a className="btn pequeno" href={`/api/painel/clientes/${c.id}/exportar`}>Exportar dados</a>}
                        {!opt && (
                          <form action={optoutManual}><input type="hidden" name="id" value={c.id} /><button className="btn pequeno">Opt-out</button></form>
                        )}
                        {admin && (
                          <form action={anonimizar}><input type="hidden" name="id" value={c.id} /><button className="btn pequeno perigo">Anonimizar</button></form>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!lista.length && <tr><td colSpan={5} className="mudo">Nenhum cliente encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
