import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { formatarBRL, formatarDataHora } from "@/lib/time";
import { nucleoAplicado } from "@/lib/usuarios";
import {
  vendasDisponivel, funisDaUnidade, vendedoresDaUnidade, carregarQuadro, carregarOportunidade,
} from "@/modulos/vendas/dados";
import {
  faixaFunil, taxaConversao, veTodasOportunidades, podeMexer, podeTransferir, valorParaCampo, MOTIVOS_TRANSFERENCIA,
  PAGAMENTOS, PRAZOS, TEMPERATURAS, QUALIFICACOES, TIPOS_ATIVIDADE, MOTIVOS_PERDA, ORDENACOES, ehChave, type Ordenacao,
} from "@/modulos/vendas/regras";
import { Cabecalho, Vazio } from "../_components/ui";
import Quadro from "./Quadro";
import ConversaVendas from "./ConversaVendas";
import { novaOportunidade, assumir, salvarQualificacao, novaAtividade, novaTarefa, concluir, moverPeloFormulario, agendarNoCartao, vincular, desvincular, transferir, transferirCarteiraAction } from "./actions";
import Icone from "../_components/Icone";
import { lerVinculos, linkProcessoVendas, linkAvaliex } from "@/modulos/vendas/vinculos";

type SP = {
  funil?: string; vendedor?: string; op?: string; nova?: string; erro?: string; ok?: string;
  nome?: string; telefone?: string; temperatura?: string; periodo?: string; ordem?: string; aviso?: string; transferir?: string; qtd?: string; pulados?: string; parcial?: string;
};

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
    carregarQuadro(u, funil, { vendedor: supervisor ? sp.vendedor : undefined, nome: sp.nome, telefone: sp.telefone, temperatura: sp.temperatura, periodo: sp.periodo }),
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

  // filtros ativos viajam nos links (abrir cartão, fechar painel) para o quadro não "resetar"
  const ordem: Ordenacao = ehChave(ORDENACOES, sp.ordem) ? sp.ordem : "posicao";
  const filtrosAtivos: Record<string, string> = Object.fromEntries(
    Object.entries({
      vendedor: supervisor ? sp.vendedor : undefined, nome: sp.nome, telefone: sp.telefone,
      temperatura: sp.temperatura, periodo: sp.periodo, ordem: ordem === "posicao" ? undefined : ordem,
    }).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  );
  const qs = new URLSearchParams({ funil: funil.chave, ...filtrosAtivos });
  const linkBase = `/painel/vendas?${qs}`;
  const comPeriodo = (p?: string) => {
    const n = new URLSearchParams(qs);
    if (p) n.set("periodo", p); else n.delete("periodo");
    return `/painel/vendas?${n}`;
  };
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
            <details className="transferir-carteira">
              <summary className="botao-transferir" title="Transferir carteira (férias)" aria-label="Transferir carteira de um vendedor"><Icone nome="transferir" tamanho={16} /></summary>
              <form action={transferirCarteiraAction} className="form card transferir-carteira-form">
                <input type="hidden" name="funil" value={funil.chave} />
                <strong>Transferir carteira (férias, saída)</strong>
                <label>De<select name="de" required defaultValue="">
                  <option value="" disabled>Vendedor que vai sair</option>
                  {vendedores.map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}</option>)}
                </select></label>
                <label>Para<select name="para" required defaultValue="rodizio">
                  <option value="rodizio">Dividir entre os outros vendedores (rodízio)</option>
                  {vendedores.map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}</option>)}
                </select></label>
                <label>Motivo<select name="motivo" defaultValue="ferias">
                  {Object.entries(MOTIVOS_TRANSFERENCIA).filter(([k]) => k !== "errado").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
                <label className="check"><input type="checkbox" name="mover_carteira" /> Mover também os clientes da carteira (saída definitiva)</label>
                <small className="mudo">Passa só os cartões ABERTOS. Cada vendedor que recebe é avisado; tudo fica registrado.</small>
                <button className="btn primario">Transferir carteira</button>
              </form>
            </details>
          )}
          <Link href={`${linkBase}&nova=1`} className="btn primario" scroll={false}>+ Nova oportunidade</Link>
        </Cabecalho>

        <form className="card filtros-quadro" role="search" aria-label="Filtrar oportunidades">
          <input type="hidden" name="funil" value={funil.chave} />
          <label>Nome do cliente<input name="nome" defaultValue={sp.nome ?? ""} maxLength={60} /></label>
          <label>Telefone<input name="telefone" defaultValue={sp.telefone ?? ""} inputMode="tel" maxLength={20} /></label>
          {supervisor && (
            <label>Vendedor<select name="vendedor" defaultValue={sp.vendedor ?? ""}>
              <option value="">Todos os vendedores</option>
              <option value="sem">Sem vendedor</option>
              {vendedores.map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}</option>)}
            </select></label>
          )}
          <label>Temperatura<select name="temperatura" defaultValue={sp.temperatura ?? ""}>
            <option value="">Todas</option>
            {Object.entries(TEMPERATURAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          <label>Ordenar por<select name="ordem" defaultValue={ordem}>
            {Object.entries(ORDENACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          {sp.periodo && <input type="hidden" name="periodo" value={sp.periodo} />}
          <div className="filtros-botoes">
            <button className="btn primario">Filtrar</button>
            <Link href={`/painel/vendas?funil=${funil.chave}`} className="btn">Limpar</Link>
          </div>
          <div className="filtros-atalhos">
            <Link href={comPeriodo("criadas_mes")} className={`chip${sp.periodo === "criadas_mes" ? " ativo" : ""}`}>Criadas no mês</Link>
            <Link href={comPeriodo("atualizadas_mes")} className={`chip${sp.periodo === "atualizadas_mes" ? " ativo" : ""}`}>Atualizadas no mês</Link>
            <Link href={comPeriodo()} className={`chip${!sp.periodo ? " ativo" : ""}`}>Exibir todas</Link>
          </div>
        </form>

        {sp.erro && !sp.op && <div className="alerta erro">{sp.erro}</div>}
        {sp.ok === "carteira" && <div className="alerta ok">Carteira transferida: {sp.qtd} {sp.qtd === "1" ? "cartão" : "cartões"}. Os vendedores que receberam foram avisados.</div>}
        {sp.ok === "carteira" && (sp.pulados || sp.parcial) && <div className="alerta aviso">{sp.pulados ? `${sp.pulados} ${sp.pulados === "1" ? "cartão ficou" : "cartões ficaram"} com o vendedor de origem (mudou no meio do caminho ou não havia destino com acesso àquela unidade). ` : ""}{sp.parcial ? "Lote muito grande: rode a transferência de novo para os cartões restantes." : ""}</div>}

        <div className="vendas-topo">
          <div className="card funil-faixa" aria-label="Funil de conversão dos últimos 90 dias">
            <div className="funil-topo-vendas">
              <strong>Funil de conversão</strong>
              <span className="funil-periodo-vendas">últimos 90 dias</span>
            </div>
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
            <div className="mudo funil-legenda">Quem entrou no funil no período e até onde chegou</div>
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
          podeTransferir={quadro.cartoes.filter((c) => podeTransferir(u, c)).map((c) => c.id)}
          vendedores={nomes}
          linkBase={linkBase}
          selecionado={detalhe?.op.id}
          ordem={ordem}
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
            <div className="painel-titulo">
              <h2>{op.cliente?.nome ?? "Cliente"}</h2>
              {podeTransferir(u, op) && (
                <a href="#transferir" className="botao-transferir" title="Transferir" aria-label="Transferir para outro vendedor"><Icone nome="transferir" tamanho={15} /></a>
              )}
            </div>
            <div className="mudo">{op.cliente?.telefone}{op.cliente?.cidade ? ` · ${op.cliente.cidade}` : ""}</div>
            {op.fechado_em ? <p className="mudo">Oportunidade encerrada. O atendimento está indisponível.</p> : (
              <section className="vendas-conversa" aria-label="Atendimento da oportunidade">
                <h3>Atendimento WhatsApp</h3>
                <ConversaVendas oportunidadeId={op.id} />
              </section>
            )}
            {sp.erro && <div className="alerta erro">{sp.erro}</div>}
            {sp.ok === "salvo" && <div className="alerta ok">Salvo.</div>}
            {sp.ok === "agendado" && <div className="alerta ok">Agendado. Acompanhe em <Link href="/painel/lembretes">Meus lembretes</Link>.</div>}
            {sp.ok === "vinculado" && <div className="alerta ok">Vínculo salvo.</div>}
            {sp.ok === "vinculado_aviso" && <div className="alerta aviso">Vínculo salvo. {sp.aviso?.slice(0, 160)}</div>}
            {sp.ok === "transferido" && <div className="alerta ok">Lead transferido. O novo vendedor foi avisado.</div>}
            {sp.ok === "transferido_aviso" && <div className="alerta aviso">{sp.aviso?.slice(0, 160)} O novo vendedor foi avisado.</div>}
            {podeTransferir(u, op) && (
              <details id="transferir" className="transferir-bloco" open={sp.transferir === "1"}>
                <summary><Icone nome="transferir" tamanho={14} /> Transferir para outro vendedor</summary>
                <form action={transferir} className="form">
                  <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} />
                  <label>Para<select name="para" required defaultValue="">
                    <option value="" disabled>Escolha o vendedor</option>
                    {vendedores.filter((v) => v.user_id !== op.vendedor_id).map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}{v.user_id === u.id ? " (você)" : ""}</option>)}
                  </select></label>
                  <label>Motivo<select name="motivo" defaultValue="errado">
                    {Object.entries(MOTIVOS_TRANSFERENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></label>
                  <label className="check"><input type="checkbox" name="mover_carteira" defaultChecked /> Mover também a carteira do cliente</label>
                  <small className="mudo">Desmarque se for só temporário (férias, folga): o cliente continua na carteira atual.</small>
                  <button className="btn primario">Transferir</button>
                </form>
              </details>
            )}

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
                  <label>Valor estimado (R$)<input name="valor" defaultValue={valorParaCampo(op.valor_estimado)} inputMode="decimal" /></label>
                  <label>Temperatura<select name="temperatura" defaultValue={op.temperatura}>{Object.entries(TEMPERATURAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Qualificação<select name="qualificacao" defaultValue={op.qualificacao}>{Object.entries(QUALIFICACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Pagamento<select name="pagamento" defaultValue={op.pagamento}>{Object.entries(PAGAMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Prazo<select name="prazo" defaultValue={op.prazo_compra}>{Object.entries(PRAZOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  {funil.chave === "novos" && (
                    <label>Canal<select name="canal" defaultValue={op.canal_venda ?? ""}><option value="">A definir</option><option value="varejo">Varejo</option><option value="venda_direta">Venda direta</option></select></label>
                  )}
                  <label className="check"><input type="checkbox" name="tem_troca" defaultChecked={op.tem_troca} /> Tem usado na troca</label>
                  <label>Usado na troca<input name="troca" defaultValue={op.troca_descricao ?? ""} maxLength={300} /></label>
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

            {(() => {
              const v = lerVinculos(op.ids_externos);
              const linkPV = v.processo_vendas ? linkProcessoVendas(v.processo_vendas.id, v.processo_vendas.empresa) : null;
              const linkAV = v.avaliex ? linkAvaliex(v.avaliex.unidade) : null;
              return (
                <section className="secao vinculos">
                  <h3>Proposta e avaliação</h3>
                  <div className="vinculo">
                    <div>
                      <strong>Processo de Vendas</strong>
                      {v.processo_vendas
                        ? <small className="mudo">Proposta {v.processo_vendas.id.slice(0, 13)}{v.processo_vendas.id.length > 13 ? "…" : ""} · situação: consulta automática na próxima etapa</small>
                        : <small className="mudo">Nenhuma proposta vinculada</small>}
                    </div>
                    {linkPV && <a className="btn pequeno" href={linkPV} target="_blank" rel="noopener noreferrer">Abrir proposta</a>}
                    {v.processo_vendas && editar && (
                      <form action={desvincular}><input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} /><input type="hidden" name="tipo" value="processo_vendas" /><button className="btn pequeno">Remover</button></form>
                    )}
                  </div>
                  {editar && (
                    <form action={vincular} className="linha-form">
                      <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} /><input type="hidden" name="tipo" value="processo_vendas" />
                      <input name="entrada" required maxLength={400} placeholder="Cole o link da proposta ou o ID" aria-label="Link ou ID da proposta" />
                      <button className="btn">{v.processo_vendas ? "Trocar" : "Vincular"}</button>
                    </form>
                  )}
                  <div className="vinculo">
                    <div>
                      <strong>Avaliex (usado na troca)</strong>
                      {v.avaliex
                        ? <small className="mudo">Avaliação {v.avaliex.id.slice(0, 13)}{v.avaliex.id.length > 13 ? "…" : ""} · {v.avaliex.unidade}{v.avaliex.placa ? ` · placa ${v.avaliex.placa}` : ""}</small>
                        : <small className="mudo">{op.tem_troca ? "Tem troca: vincule a avaliação" : "Nenhuma avaliação vinculada"}</small>}
                    </div>
                    {linkAV && <a className="btn pequeno" href={linkAV} target="_blank" rel="noopener noreferrer">Abrir Avaliex</a>}
                    {v.avaliex && editar && (
                      <form action={desvincular}><input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} /><input type="hidden" name="tipo" value="avaliex" /><button className="btn pequeno">Remover</button></form>
                    )}
                  </div>
                  {editar && (
                    <form action={vincular} className="linha-form">
                      <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} /><input type="hidden" name="tipo" value="avaliex" />
                      <input name="entrada" required maxLength={400} placeholder="Link ou ID da avaliação" aria-label="Link ou ID da avaliação" />
                      <input name="placa" maxLength={8} placeholder="Placa" aria-label="Placa do usado" style={{ maxWidth: 100 }} />
                      <button className="btn">{v.avaliex ? "Trocar" : "Vincular"}</button>
                    </form>
                  )}
                </section>
              );
            })()}

            {editar && (
              <section className="secao">
                <h3>Agendar lembrete ou mensagem</h3>
                <form action={agendarNoCartao} className="form">
                  <input type="hidden" name="id" value={op.id} /><input type="hidden" name="funil" value={funil.chave} />
                  <div className="linha-form">
                    <select name="tipo" defaultValue="lembrete" aria-label="Tipo">
                      <option value="lembrete">Lembrete para mim</option>
                      <option value="mensagem">Mensagem para o cliente</option>
                    </select>
                    <input name="quando" type="datetime-local" required aria-label="Quando" />
                  </div>
                  <textarea name="texto" rows={2} maxLength={1000} required placeholder="Lembrete: o que fazer · Mensagem: o texto que o cliente vai receber" />
                  <button className="btn">Agendar</button>
                  <small className="mudo">Mensagem: sai no horário marcado se o cliente tiver falado com a loja nas últimas 24h. Fora disso, só vai o modelo aprovado de &quot;retomada de atendimento&quot; (com autorização do cliente); se não puder sair, você recebe um aviso para ligar.</small>
                </form>
              </section>
            )}

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
