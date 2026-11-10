import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { formatarDataHora } from "@/lib/time";
import { podeAcessar } from "@/lib/permissoes";
import { nucleoAplicado } from "@/lib/usuarios";
import { listarClientes, fichaCliente, ORIGENS_CLIENTE, FILTRO_AUTORIZACAO } from "@/lib/clientes-dados";
import { tempoAtras } from "@/modulos/vendas/regras";
import { db } from "@/lib/supabase/admin";
import { Cabecalho, Status, Vazio } from "../_components/ui";
import { anonimizar, optoutManual, importarCSV, agendarNaFicha } from "./actions";

type SP = {
  q?: string; nome?: string; telefone?: string; cidade?: string; origem?: string; autorizacao?: string; atalho?: string; vendedor?: string;
  c?: string; msg?: string; ok?: string; inv?: string; opt?: string; erro?: string;
};

const ROTULO_AUT: Record<string, string> = { servico: "serviço", eventos: "eventos", marketing: "ofertas" };
/** "link:balcao" (cliente que chegou por QR/link rastreado) → "QR/Link · balcão". */
const rotuloOrigem = (o: string) => {
  if (o.startsWith("link:")) return `QR/Link · ${o.slice(5).replace(/_/g, " ").replace("balcao", "balcão")}`;
  return ORIGENS_CLIENTE[o as keyof typeof ORIGENS_CLIENTE] ?? o;
};
const iniciais = (nome: string | null) => (nome ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export default async function Clientes({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await exigirAcesso("clientes");
  const cfg = await getConfig();
  const sp = await searchParams;
  const nucleo = await nucleoAplicado();
  const supervisor = u.papel === "admin" || u.papel === "gerente";
  const podeLgpd = podeAcessar(u, "lgpd");

  // compatibilidade: a busca antiga usava ?q= (nome, telefone ou cidade)
  const filtros = { nome: sp.nome ?? (sp.q && /\D/.test(sp.q) ? sp.q : undefined), telefone: sp.telefone ?? (sp.q && !/\D/.test(sp.q) ? sp.q : undefined), cidade: sp.cidade, origem: sp.origem, autorizacao: sp.autorizacao, atalho: sp.atalho, vendedor: supervisor ? sp.vendedor : undefined };
  const [lista, ficha, vendedores] = await Promise.all([
    listarClientes(u, filtros),
    sp.c ? fichaCliente(u, sp.c) : Promise.resolve(null),
    nucleo
      ? db().from("usuarios").select("user_id, nome").eq("ativo", true).in("papel", ["vendedor", "gerente"]).order("nome").then((r) => (r.data ?? []) as { user_id: string; nome: string }[])
      : Promise.resolve([] as { user_id: string; nome: string }[]),
  ]);
  const nomeVendedor = Object.fromEntries(vendedores.map((v) => [v.user_id, v.nome]));

  const ativos = Object.fromEntries(Object.entries(filtros).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  const qs = new URLSearchParams(ativos);
  const linkFiltro = (extra: Record<string, string | undefined>) => {
    const n = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(extra)) { if (v) n.set(k, v); else n.delete(k); }
    return `/painel/clientes?${n}`;
  };
  const linkFicha = (id: string) => linkFiltro({ c: id });
  const fechar = linkFiltro({ c: undefined });
  const agora = new Date();

  return (
    <div className={ficha ? "vendas com-painel" : "vendas"}>
      <div className="vendas-principal">
        <Cabecalho titulo="Clientes" sub={`${lista.length === 300 ? "300+ clientes" : `${lista.length} cliente(s)`} · ficha única do grupo, autorizações e LGPD`} />

        {sp.msg === "import_ok" && <div className="alerta ok">Importação concluída: {sp.ok} contatos com consentimento registrado · {sp.inv} telefones inválidos · {sp.opt} ignorados por opt-out.</div>}
        {sp.msg === "import_incompleto" && <div className="alerta erro">Importação recusada: informe a origem, o texto exato do consentimento, os tipos e marque a declaração.</div>}

        <form className="card filtros-quadro" role="search" aria-label="Filtrar clientes">
          <label>Nome<input name="nome" defaultValue={filtros.nome ?? ""} maxLength={60} /></label>
          <label>Telefone<input name="telefone" defaultValue={filtros.telefone ?? ""} inputMode="tel" maxLength={20} /></label>
          <label>Cidade<input name="cidade" defaultValue={sp.cidade ?? ""} maxLength={40} /></label>
          <label>Origem<select name="origem" defaultValue={sp.origem ?? ""}>
            <option value="">Todas</option>
            {Object.entries(ORIGENS_CLIENTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          <label>Autorização<select name="autorizacao" defaultValue={sp.autorizacao ?? ""}>
            <option value="">Todas</option>
            {Object.entries(FILTRO_AUTORIZACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          {supervisor && nucleo && (
            <label>Vendedor<select name="vendedor" defaultValue={sp.vendedor ?? ""}>
              <option value="">Todos</option>
              <option value="sem">Sem vendedor</option>
              {vendedores.map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}</option>)}
            </select></label>
          )}
          {sp.atalho && <input type="hidden" name="atalho" value={sp.atalho} />}
          <div className="filtros-botoes">
            <button className="btn primario">Filtrar</button>
            <Link href="/painel/clientes" className="btn">Limpar</Link>
          </div>
          <div className="filtros-atalhos">
            {nucleo && <Link href={linkFiltro({ atalho: "carteira", c: undefined })} className={`chip${sp.atalho === "carteira" ? " ativo" : ""}`}>Minha carteira</Link>}
            <Link href={linkFiltro({ atalho: "novos_mes", c: undefined })} className={`chip${sp.atalho === "novos_mes" ? " ativo" : ""}`}>Novos no mês</Link>
            <Link href={linkFiltro({ atalho: "falaram_7d", c: undefined })} className={`chip${sp.atalho === "falaram_7d" ? " ativo" : ""}`}>Falaram nos últimos 7 dias</Link>
            <Link href={linkFiltro({ atalho: undefined, c: undefined })} className={`chip${!sp.atalho ? " ativo" : ""}`}>Exibir todos</Link>
          </div>
        </form>

        {podeLgpd && (
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

        {!lista.length ? <Vazio>Nenhum cliente encontrado com esses filtros.</Vazio> : (
          <div className="tabela-wrap">
            <table className="tabela tabela-clientes">
              <thead><tr><th>Cliente</th><th>Cidade</th><th>Origem</th>{nucleo && <th>Vendedor</th>}<th>Autorizações</th><th>Último contato</th></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} className={sp.c === c.id ? "selecionada" : ""}>
                    <td>
                      <Link href={linkFicha(c.id)} scroll={false} className="cliente-celula">
                        <span className="cartao-avatar">{c.anonimizado ? "—" : iniciais(c.nome)}</span>
                        <span>
                          <strong>{c.anonimizado ? "[anonimizado]" : c.nome ?? "Sem nome"}</strong>
                          <small className="mudo">{c.telefone}</small>
                        </span>
                      </Link>
                    </td>
                    <td className="mudo">{c.cidade ?? "—"}</td>
                    <td className="mudo">{rotuloOrigem(c.origem)}</td>
                    {nucleo && <td>{c.vendedor_id ? (c.vendedor_id === u.id ? <span className="tag ok">você</span> : nomeVendedor[c.vendedor_id] ?? "—") : <span className="mudo">—</span>}</td>}
                    <td>
                      <div className="acoes">
                        {c.optout && <span className="tag erro">pediu para sair</span>}
                        {!c.optout && c.autorizacoes.map((a) => <span key={a} className="tag ok">{ROTULO_AUT[a] ?? a}</span>)}
                        {!c.optout && !c.autorizacoes.length && <span className="mudo">nenhuma</span>}
                      </div>
                    </td>
                    <td className="mudo" title={c.ultimo_contato_em ? formatarDataHora(c.ultimo_contato_em, cfg.fuso_offset) : ""}>{tempoAtras(c.ultimo_contato_em, agora)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sp.c && !ficha && (
        <aside className="painel-lateral card"><Link href={fechar} className="fechar" aria-label="Fechar">×</Link><Vazio>Cliente não encontrado.</Vazio></aside>
      )}

      {ficha && (() => {
        const { cliente: c } = ficha;
        return (
          <aside className="painel-lateral card" aria-label="Ficha do cliente">
            <Link href={fechar} className="fechar" aria-label="Fechar" scroll={false}>×</Link>
            <div className="mudo">Cliente desde {formatarDataHora(c.criado_em, cfg.fuso_offset).split(" às")[0]}</div>
            <h2>{c.anonimizado ? "[anonimizado]" : c.nome ?? "Sem nome"}</h2>
            <div className="mudo">{c.telefone}{c.cidade ? ` · ${c.cidade}` : ""}</div>
            {sp.erro && <div className="alerta erro">{sp.erro}</div>}
            {sp.ok === "agendado" && <div className="alerta ok">Agendado. Acompanhe em <Link href="/painel/lembretes">Meus lembretes</Link>.</div>}

            <dl className="ficha">
              <dt>Origem</dt><dd>{rotuloOrigem(c.origem)}</dd>
              {nucleo && (<><dt>Vendedor</dt><dd>{ficha.vendedorNome ?? "Sem vendedor"}</dd></>)}
              {c.cpf_cnpj && (<><dt>CPF/CNPJ</dt><dd>{c.cpf_cnpj}</dd></>)}
              {c.email && (<><dt>E-mail</dt><dd>{c.email}</dd></>)}
              <dt>Último contato</dt><dd>{c.ultimo_contato_em ? formatarDataHora(c.ultimo_contato_em, cfg.fuso_offset) : "—"}</dd>
            </dl>

            <section className="secao">
              <h3>Autorizações (LGPD)</h3>
              {ficha.optout && <div className="alerta erro">Pediu para não receber mensagens em {formatarDataHora(ficha.optout.criado_em, cfg.fuso_offset)}.</div>}
              <ul className="lista-simples">
                {ficha.consentimentos.map((k, i) => (
                  <li key={i}><span><Status valor={k.status} /> {ROTULO_AUT[k.tipo] ?? k.tipo}<small className="mudo"> · {k.origem} · {formatarDataHora(k.concedido_em, cfg.fuso_offset)}</small></span></li>
                ))}
                {!ficha.consentimentos.length && <li className="mudo">Nenhuma autorização registrada.</li>}
              </ul>
            </section>

            <section className="secao">
              <h3>Veículos</h3>
              <ul className="lista-simples">
                {ficha.veiculos.map((v, i) => (
                  <li key={i}><span>{[v.modelo, v.ano, v.placa].filter(Boolean).join(" · ") || "Veículo"}{v.proxima_revisao_em ? <small className="mudo"> · próxima revisão {v.proxima_revisao_em.split("-").reverse().join("/")}</small> : null}</span></li>
                ))}
                {!ficha.veiculos.length && <li className="mudo">Nenhum veículo.</li>}
              </ul>
            </section>

            {nucleo && podeAcessar(u, "vendas") && (
              <section className="secao">
                <h3>Oportunidades</h3>
                <ul className="lista-simples">
                  {ficha.oportunidades.map((o) => (
                    <li key={o.id}>
                      <span><Link href={`/painel/vendas?funil=${o.funil?.chave ?? "novos"}&op=${o.id}`}>{o.funil?.nome ?? "Vendas"}: {o.veiculo_interesse ?? "interesse a definir"}</Link></span>
                      <span className={`tag ${o.etapa?.tipo === "ganho" ? "ok" : o.etapa?.tipo === "perdido" ? "erro" : "info"}`}>{o.etapa?.nome ?? "—"}</span>
                    </li>
                  ))}
                  {!ficha.oportunidades.length && <li className="mudo">Nenhuma oportunidade.</li>}
                </ul>
              </section>
            )}

            <section className="secao">
              <h3>Agendamentos</h3>
              <ul className="lista-simples">
                {ficha.agendamentos.map((a) => (
                  <li key={a.id}><span>{a.servicos?.nome ?? "Serviço"}<small className="mudo"> · {formatarDataHora(a.inicio, cfg.fuso_offset)}</small></span><Status valor={a.status} /></li>
                ))}
                {!ficha.agendamentos.length && <li className="mudo">Nenhum agendamento.</li>}
              </ul>
            </section>

            {!c.anonimizado && (
              <section className="secao">
                <h3>Agendar lembrete ou mensagem</h3>
                <form action={agendarNaFicha} className="form">
                  <input type="hidden" name="id" value={c.id} />
                  <div className="linha-form">
                    <select name="tipo" defaultValue="lembrete" aria-label="Tipo">
                      <option value="lembrete">Lembrete para mim</option>
                      <option value="mensagem">Mensagem para o cliente</option>
                    </select>
                    <input name="quando" type="datetime-local" required aria-label="Quando" />
                  </div>
                  <textarea name="texto" rows={2} maxLength={1000} required placeholder="Lembrete: o que fazer · Mensagem: o texto que o cliente vai receber" />
                  <button className="btn">Agendar</button>
                  <small className="mudo">A mensagem só sai se o cliente tiver falado com a loja nas últimas 24h; fora disso vai o modelo aprovado de retomada (com autorização). Se não puder sair, você recebe um aviso.</small>
                </form>
              </section>
            )}

            {!c.anonimizado && (
              <section className="secao">
                <h3>Direitos LGPD</h3>
                <div className="acoes">
                  {podeLgpd && <a className="btn pequeno" href={`/api/painel/clientes/${c.id}/exportar`}>Exportar dados</a>}
                  {!ficha.optout && (
                    <form action={optoutManual}><input type="hidden" name="id" value={c.id} /><button className="btn pequeno">Registrar opt-out</button></form>
                  )}
                  {podeLgpd && (
                    <form action={anonimizar}><input type="hidden" name="id" value={c.id} /><button className="btn pequeno perigo">Anonimizar</button></form>
                  )}
                </div>
              </section>
            )}
          </aside>
        );
      })()}
    </div>
  );
}
