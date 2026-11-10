import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { formatarBRL, formatarDataHora } from "@/lib/time";
import { nucleoAplicado } from "@/lib/usuarios";
import {
  vendasDisponivel, funisDaUnidade, vendedoresDaUnidade, carregarQuadro, carregarOportunidade,
} from "@/modulos/vendas/dados";
import {
  faixaFunil, taxaConversao, veTodasOportunidades, podeMexer,
  PAGAMENTOS, PRAZOS, TEMPERATURAS, QUALIFICACOES, TIPOS_ATIVIDADE, MOTIVOS_PERDA,
} from "@/modulos/vendas/regras";
import { Cabecalho, Vazio } from "../_components/ui";
import Quadro from "./Quadro";
import { novaOportunidade, assumir, salvarQualificacao, novaAtividade, novaTarefa, concluir, moverPeloFormulario } from "./actions";

type SP = { funil?: string; vendedor?: string; op?: string; nova?: string; erro?: string; ok?: string };

export default async function Vendas({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await exigirAcesso("vendas");
  const sp = await searchParams;
  const cfg = await getConfig();

  if (!(await nucleoAplicado()) || !(await vendasDisponivel())) {
    return (
      <>
        <Cabecalho titulo="Vendas" sub="Funis de Novos e Seminovos" />
        <Vazio>O setor de Vendas será ativado quando as atualizações do banco (núcleo e vendas) forem aplicadas.</Vazio>
      </>
    );
  }

  const funis = await funisDaUnidade(u.unidade);
  const funil = funis.find((f) => f.chave === sp.funil) ?? funis[0];
  if (!funil) return <Vazio>Nenhum funil de vendas configurado para esta unidade.</Vazio>;

  const supervisor = veTodasOportunidades(u);
  const [quadro, vendedores, detalhe] = await Promise.all([
    carregarQuadro(u, funil, supervisor ? sp.vendedor : undefined),
    vendedoresDaUnidade(u.unidade),
    sp.op ? carregarOportunidade(u, sp.op) : Promise.resolve(null),
  ]);
  const nomes = Object.fromEntries(vendedores.map((v) => [v.user_id, v.nome]));
  const faixa = faixaFunil(quadro.resumo);
  const ganhos = quadro.resumo.find((r) => r.tipo === "ganho")?.alcancaram ?? 0;
  const perdidos = quadro.resumo.find((r) => r.tipo === "perdido")?.alcancaram ?? 0;
  const conversao = taxaConversao(ganhos, perdidos);
  const abertas = quadro.cartoes.filter((c) => quadro.etapas.find((e) => e.id === c.etapa_id)?.tipo === "aberta");
  const emNegociacao = abertas.reduce((s, c) => s + (c.valor_estimado ?? 0), 0);
  const semDono = abertas.filter((c) => !c.vendedor_id).length;

  const qs = new URLSearchParams({ funil: funil.chave, ...(supervisor && sp.vendedor ? { vendedor: sp.vendedor } : {}) });
  const linkBase = `/painel/vendas?${qs}`;
  const etapaNome = Object.fromEntries(quadro.etapas.map((e) => [e.id, e.nome]));

  return (
    <div className={detalhe ? "vendas com-painel" : "vendas"}>
      <div className="vendas-principal">
        <Cabecalho titulo="Vendas" sub={supervisor ? "Quadro da unidade" : "Sua carteira e leads sem vendedor"}>
          <nav className="abas-funil" aria-label="Funis">
            {funis.map((f) => (
              <Link key={f.id} href={`/painel/vendas?funil=${f.chave}`} className={f.id === funil.id ? "ativo" : ""}>{f.nome}</Link>
            ))}
          </nav>
          {supervisor && (
            <form className="linha-form">
              <input type="hidden" name="funil" value={funil.chave} />
              <select name="vendedor" defaultValue={sp.vendedor ?? ""} aria-label="Filtrar por vendedor">
                <option value="">Todos os vendedores</option>
                <option value="sem">Sem vendedor</option>
                {vendedores.map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}</option>)}
              </select>
              <button className="btn">Filtrar</button>
            </form>
          )}
          <Link href={`${linkBase}&nova=1`} className="btn primario" scroll={false}>+ Nova oportunidade</Link>
        </Cabecalho>

        {sp.erro && !sp.op && <div className="alerta erro">{sp.erro}</div>}

        <div className="vendas-topo">
          <div className="card funil-faixa" aria-label="Funil de conversão dos últimos 90 dias">
            <div className="funil-barras">
              {faixa.map((e) => (
                <div key={e.etapa_id} className="funil-segmento" style={{ ["--h" as string]: `${Math.max(e.pct, 8)}%` }}>
                  <span className="funil-pct">{e.pct}%</span>
                </div>
              ))}
            </div>
            <div className="funil-rotulos">
              {faixa.map((e) => (
                <div key={e.etapa_id}><span>{e.nome}</span><strong>{e.quantidade}</strong></div>
              ))}
            </div>
            <div className="mudo funil-legenda">Quem entrou no funil nos últimos 90 dias e até onde chegou</div>
          </div>
          <div className="card vendas-kpis">
            <div><span className="mudo">Em aberto</span><strong>{abertas.length}</strong><small className="mudo">{formatarBRL(emNegociacao)} em negociação</small></div>
            <div><span className="mudo">Conversão (90 dias)</span><strong>{conversao === null ? "—" : `${conversao}%`}</strong><small className="mudo">{ganhos} ganhas · {perdidos} perdidas</small></div>
            <div><span className="mudo">Sem vendedor</span><strong className={semDono ? "texto-aviso" : ""}>{semDono}</strong><small className="mudo">leads aguardando dono</small></div>
          </div>
        </div>

        {sp.nova && (
          <div className="card secao">
            <h2>Nova oportunidade — {funil.nome}</h2>
            {sp.erro && <div className="alerta erro">{sp.erro}</div>}
            <form action={novaOportunidade} className="form grade-form">
              <input type="hidden" name="funil" value={funil.chave} />
              <input type="hidden" name="funil_id" value={funil.id} />
              <label>Telefone (WhatsApp)<input name="telefone" required inputMode="tel" placeholder="(51) 99999-8888" /></label>
              <label>Nome do cliente<input name="nome" required maxLength={120} /></label>
              <label>Veículo de interesse<input name="veiculo" maxLength={120} placeholder="ex.: T-Cross Highline 2026" /></label>
              <label>Valor estimado (R$)<input name="valor" inputMode="decimal" placeholder="150.000" /></label>
              <label>Pagamento<select name="pagamento" defaultValue="indefinido">{Object.entries(PAGAMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Prazo de compra<select name="prazo" defaultValue="indefinido">{Object.entries(PRAZOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Temperatura<select name="temperatura" defaultValue="morno">{Object.entries(TEMPERATURAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="check"><input type="checkbox" name="tem_troca" /> Tem usado na troca</label>
              <label className="largo">Usado oferecido na troca<input name="troca" maxLength={300} placeholder="modelo, ano, km" /></label>
              <label className="largo">Observações<textarea name="observacoes" rows={2} maxLength={1000} /></label>
              <div className="acoes largo">
                <Link href={linkBase} className="btn">Cancelar</Link>
                <button className="btn primario">Criar oportunidade</button>
              </div>
            </form>
            <p className="mudo">Cadastro feito pelo vendedor não autoriza mensagens automáticas: o envio pelo WhatsApp continua exigindo o consentimento do cliente.</p>
          </div>
        )}

        <Quadro
          etapas={quadro.etapas}
          cartoes={quadro.cartoes}
          podeMover={quadro.cartoes.filter((c) => podeMexer(u, c)).map((c) => c.id)}
          vendedores={nomes}
          linkBase={linkBase}
          selecionado={detalhe?.op.id}
        />
      </div>

      {sp.op && !detalhe && (
        <aside className="painel-lateral card"><Link href={linkBase} className="fechar" aria-label="Fechar">×</Link><Vazio>Oportunidade não encontrada ou fora da sua carteira.</Vazio></aside>
      )}

      {detalhe && (() => {
        const { op } = detalhe;
        const editar = detalhe.podeMexer;
        return (
          <aside className="painel-lateral card" aria-label="Detalhe da oportunidade">
            <Link href={linkBase} className="fechar" aria-label="Fechar" scroll={false}>×</Link>
            <div className="mudo">{op.etapa?.nome} · desde {formatarDataHora(op.entrou_na_etapa_em, cfg.fuso_offset)}</div>
            <h2>{op.cliente?.nome ?? "Cliente"}</h2>
            <div className="mudo">{op.cliente?.telefone}{op.cliente?.cidade ? ` · ${op.cliente.cidade}` : ""}</div>
            {sp.erro && <div className="alerta erro">{sp.erro}</div>}
            {sp.ok === "salvo" && <div className="alerta ok">Salvo.</div>}

            <dl className="ficha">
              <dt>Vendedor</dt><dd>{op.vendedor_id ? nomes[op.vendedor_id] ?? "—" : "Sem vendedor"}</dd>
              <dt>Origem</dt><dd>{op.origem}{op.origem_ref ? ` (${op.origem_ref})` : ""}</dd>
              <dt>Qualificação</dt><dd>{QUALIFICACOES[op.qualificacao as keyof typeof QUALIFICACOES] ?? op.qualificacao}</dd>
              {op.motivo_perda && (<><dt>Motivo da perda</dt><dd>{op.motivo_perda}</dd></>)}
            </dl>

            {detalhe.podeAssumir && (
              <form action={assumir}><input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} />
                <button className="btn primario largo-total">Assumir este lead</button></form>
            )}

            {editar && (
              <form action={moverPeloFormulario} className="linha-form secao">
                <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} />
                <select name="etapa_id" defaultValue={op.etapa_id} aria-label="Mover para a etapa">
                  {quadro.etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
                <select name="motivo_perda" defaultValue="" aria-label="Motivo (se perdida)">
                  <option value="">Motivo (se perdida)</option>
                  {MOTIVOS_PERDA.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <button className="btn">Mover</button>
              </form>
            )}

            <details className="secao" open={editar}>
              <summary>Qualificação e interesse</summary>
              <form action={salvarQualificacao} className="form">
                <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} />
                <fieldset disabled={!editar}>
                  <label>Veículo de interesse<input name="veiculo" defaultValue={op.veiculo_interesse ?? ""} maxLength={120} /></label>
                  <label>Valor estimado (R$)<input name="valor" defaultValue={op.valor_estimado ?? ""} inputMode="decimal" /></label>
                  <label>Temperatura<select name="temperatura" defaultValue={op.temperatura}>{Object.entries(TEMPERATURAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Qualificação<select name="qualificacao" defaultValue={op.qualificacao}>{Object.entries(QUALIFICACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Pagamento<select name="pagamento" defaultValue={op.pagamento}>{Object.entries(PAGAMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Prazo<select name="prazo" defaultValue={op.prazo_compra}>{Object.entries(PRAZOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  {funil.chave === "novos" && (
                    <label>Canal<select name="canal" defaultValue={op.canal_venda ?? ""}><option value="">A definir</option><option value="varejo">Varejo</option><option value="venda_direta">Venda direta</option></select></label>
                  )}
                  <label className="check"><input type="checkbox" name="tem_troca" defaultChecked={op.tem_troca} /> Tem usado na troca</label>
                  <label>Usado na troca<input name="troca" defaultValue={op.troca_descricao ?? ""} maxLength={300} /></label>
                  {supervisor && (
                    <label>Vendedor responsável<select name="vendedor_id" defaultValue={op.vendedor_id ?? ""}>
                      <option value="">Sem vendedor</option>{vendedores.map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}</option>)}
                    </select></label>
                  )}
                  <button className="btn primario">Salvar</button>
                </fieldset>
              </form>
            </details>

            <section className="secao">
              <h3>Tarefas</h3>
              <ul className="lista-simples">
                {detalhe.tarefas.map((t) => (
                  <li key={t.id} className={t.concluida_em ? "feito" : new Date(t.prazo) < new Date() ? "atrasada" : ""}>
                    <span>{t.titulo}<small className="mudo"> · {formatarDataHora(t.prazo, cfg.fuso_offset)}</small></span>
                    {!t.concluida_em && editar && (
                      <form action={concluir}><input type="hidden" name="tarefa_id" value={t.id} /><input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} /><button className="btn pequeno">Concluir</button></form>
                    )}
                  </li>
                ))}
                {!detalhe.tarefas.length && <li className="mudo">Nenhuma tarefa.</li>}
              </ul>
              {editar && (
                <form action={novaTarefa} className="linha-form">
                  <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} />
                  <input name="titulo" placeholder="ex.: ligar com a proposta" maxLength={200} required />
                  <input name="prazo" type="datetime-local" required aria-label="Prazo" />
                  <button className="btn">Agendar</button>
                </form>
              )}
            </section>

            <section className="secao">
              <h3>Contatos e anotações</h3>
              {editar && (
                <form action={novaAtividade} className="form">
                  <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} />
                  <div className="linha-form">
                    <select name="tipo" defaultValue="ligacao" aria-label="Tipo de contato">{Object.entries(TIPOS_ATIVIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <button className="btn">Registrar</button>
                  </div>
                  <textarea name="descricao" rows={2} maxLength={2000} placeholder="O que foi conversado" required />
                </form>
              )}
              <ul className="linha-tempo">
                {detalhe.atividades.map((a) => (
                  <li key={a.id}><strong>{TIPOS_ATIVIDADE[a.tipo as keyof typeof TIPOS_ATIVIDADE] ?? a.tipo}</strong> <span className="mudo">· {a.ator} · {formatarDataHora(a.criado_em, cfg.fuso_offset)}</span><div>{a.descricao}</div></li>
                ))}
                {detalhe.historico.map((h) => (
                  <li key={`h${h.id}`} className="historico"><span className="mudo">{h.de_etapa_id ? `${etapaNome[h.de_etapa_id] ?? "?"} → ` : "Criada em "}{h.para_etapa_id ? etapaNome[h.para_etapa_id] ?? "?" : "—"} · {h.ator} · {formatarDataHora(h.criado_em, cfg.fuso_offset)}{h.dias_na_etapa != null ? ` · ${h.dias_na_etapa} dias na etapa anterior` : ""}</span></li>
                ))}
              </ul>
            </section>
          </aside>
        );
      })()}
    </div>
  );
}
