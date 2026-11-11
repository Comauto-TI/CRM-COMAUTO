import "server-only";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { buscarClientePorTelefone } from "@/lib/clientes-telefone";
import { normalizarTelefone, mascararTelefone } from "@/lib/phone";
import type { Usuario } from "@/lib/auth";
import { veTodasOportunidades, podeMexer, podeAssumir, podeTransferir, podeReceberLead, distribuirRodizio, MOTIVOS_TRANSFERENCIA, type EtapaResumo, type MotivoTransferencia } from "./regras";
import { notificar } from "@/lib/notificacoes";
import { lerVinculoProcessoVendas, lerVinculoAvaliex } from "./vinculos";

/** Acesso a dados do setor Vendas. SEMPRE chamado depois de exigirAcesso("vendas"). */

export type Funil = { id: string; chave: string; nome: string };
export type Etapa = { id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido"; sla_dias: number | null };
export type Cartao = {
  id: string;
  etapa_id: string;
  vendedor_id: string | null;
  veiculo_interesse: string | null;
  valor_estimado: number | null;
  temperatura: string;
  qualificacao: string;
  pagamento: string;
  tem_troca: boolean;
  origem: string;
  entrou_na_etapa_em: string;
  posicao: number;
  criado_em: string;
  atualizado_em: string;
  ultimo_contato_em: string | null; // última atividade registrada OU última mensagem do cliente no WhatsApp
  cliente: { id: string; nome: string | null; telefone: string };
};

/** Filtros da barra do quadro (todos opcionais; valores já saneados aqui). */
export type FiltrosQuadro = { vendedor?: string; nome?: string; telefone?: string; temperatura?: string; periodo?: string };

/** true se as tabelas de Vendas já existem (0003 aplicada). */
export async function vendasDisponivel(): Promise<boolean> {
  const { error } = await db().from("vendas_funis").select("id").limit(1);
  return !error;
}

export async function funisDaUnidade(unidade: string): Promise<Funil[]> {
  const { data } = await db().from("vendas_funis").select("id, chave, nome").eq("unidade", unidade).eq("ativo", true).order("ordem");
  return (data ?? []) as Funil[];
}

type Elegivel = { user_id: string; nome: string; papel: string };

/**
 * Quem pode receber leads na unidade (F1-V-T001): ativo, vendedor/gerente com acesso à área Vendas
 * e à unidade (principal OU adicional). Mesma regra para a lista da tela e para validar a gravação.
 */
async function elegiveisVendas(unidade: string, papeis: readonly string[] = ["vendedor", "gerente"]): Promise<Elegivel[]> {
  const { data: extras } = await db().from("usuario_unidades").select("user_id").eq("unidade", unidade);
  const idsExtras = new Set((extras ?? []).map((e) => e.user_id as string));
  let q = db().from("usuarios").select("user_id, nome, papel, setor, unidade, ativo").eq("ativo", true).in("papel", [...papeis]);
  q = idsExtras.size ? q.or(`unidade.eq.${unidade},user_id.in.(${[...idsExtras].join(",")})`) : q.eq("unidade", unidade);
  const { data } = await q.order("nome");
  return (data ?? [])
    .filter((p) => podeReceberLead({ papel: p.papel, setor: p.setor, ativo: p.ativo, unidade: p.unidade, extras: idsExtras.has(p.user_id) ? [unidade] : [] }, unidade))
    .map((p) => ({ user_id: p.user_id as string, nome: p.nome as string, papel: p.papel as string }));
}

export async function vendedoresDaUnidade(unidade: string): Promise<{ user_id: string; nome: string }[]> {
  return (await elegiveisVendas(unidade)).map(({ user_id, nome }) => ({ user_id, nome }));
}

export async function carregarQuadro(u: Usuario, funil: Funil, filtros: FiltrosQuadro = {}) {
  const filtroVendedor = filtros.vendedor;
  const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data: etapas }, resumo] = await Promise.all([
    db().from("vendas_etapas").select("id, nome, ordem, tipo, sla_dias").eq("funil_id", funil.id).eq("ativo", true).order("ordem"),
    db().rpc("vendas_funil_resumo", { p_funil: funil.id, p_desde: desde }),
  ]);

  // Quadro mostra abertas + fechadas nos últimos 30 dias (Ganho/Perdido não acumulam para sempre)
  const corteFechadas = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let q = db()
    .from("vendas_oportunidades")
    .select("id, etapa_id, vendedor_id, veiculo_interesse, valor_estimado, temperatura, qualificacao, pagamento, tem_troca, origem, entrou_na_etapa_em, posicao, criado_em, atualizado_em, cliente:clientes!inner(id, nome, telefone, ultimo_contato_em)")
    .eq("funil_id", funil.id)
    .order("posicao")
    .limit(500);
  // barra de filtros (nome/telefone filtram pelo cliente da ficha única)
  const nome = filtros.nome?.replace(/[%,()*\\:"']/g, " ").trim().slice(0, 60);
  if (nome && nome.length >= 2) q = q.ilike("cliente.nome", `%${nome}%`);
  const tel = filtros.telefone?.replace(/\D/g, "").slice(0, 13);
  if (tel && tel.length >= 4) q = q.like("cliente.telefone", `%${tel}%`);
  if (filtros.temperatura && ["frio", "morno", "quente"].includes(filtros.temperatura)) q = q.eq("temperatura", filtros.temperatura);
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  if (filtros.periodo === "criadas_mes") q = q.gte("criado_em", inicioMes);
  else if (filtros.periodo === "atualizadas_mes") q = q.gte("atualizado_em", inicioMes);
  if (!veTodasOportunidades(u)) {
    // carteira do vendedor (abertas + fechadas recentes) + leads abertos sem dono — numa expressão só
    q = q.or(`and(vendedor_id.eq.${u.id},fechado_em.is.null),and(vendedor_id.eq.${u.id},fechado_em.gte.${corteFechadas}),and(vendedor_id.is.null,fechado_em.is.null)`);
  } else {
    q = q.or(`fechado_em.is.null,fechado_em.gte.${corteFechadas}`);
    // filtro por vendedor: só para supervisor
    if (filtroVendedor === "sem") q = q.is("vendedor_id", null);
    else if (filtroVendedor && /^[0-9a-f-]{36}$/i.test(filtroVendedor)) q = q.eq("vendedor_id", filtroVendedor);
  }
  const { data: cartoes } = await q;
  const lista = (cartoes ?? []) as unknown as (Omit<Cartao, "ultimo_contato_em"> & { cliente: Cartao["cliente"] & { ultimo_contato_em: string | null } })[];

  // "Contato: há X" = o mais recente entre a última atividade registrada e a última mensagem do cliente
  const ultimaAtividade = new Map<string, string>();
  if (lista.length) {
    const { data: ativ } = await db()
      .from("vendas_atividades")
      .select("oportunidade_id, criado_em")
      .in("oportunidade_id", lista.map((c) => c.id))
      .order("criado_em", { ascending: false })
      .limit(2000);
    for (const a of ativ ?? []) if (!ultimaAtividade.has(a.oportunidade_id)) ultimaAtividade.set(a.oportunidade_id, a.criado_em);
  }

  return {
    etapas: (etapas ?? []) as Etapa[],
    cartoes: lista.map((c): Cartao => {
      const datas = [ultimaAtividade.get(c.id), c.cliente?.ultimo_contato_em].filter(Boolean) as string[];
      return {
        ...c,
        ultimo_contato_em: datas.sort().at(-1) ?? null,
        cliente: { id: c.cliente.id, nome: c.cliente.nome, telefone: mascararTelefone(c.cliente?.telefone ?? "") },
      };
    }),
    resumo: ((resumo.data ?? []) as EtapaResumo[]).map((r) => ({ ...r, abertas: Number(r.abertas), alcancaram: Number(r.alcancaram) })),
  };
}

export async function carregarOportunidade(u: Usuario, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: op } = await db()
    .from("vendas_oportunidades")
    .select("*, cliente:clientes(id, nome, telefone, cidade, email), etapa:vendas_etapas(nome, tipo)")
    .eq("id", id)
    .in("unidade", u.unidades)
    .maybeSingle();
  if (!op) return null;
  if (!veTodasOportunidades(u) && op.vendedor_id && op.vendedor_id !== u.id) return null;

  const [{ data: atividades }, { data: tarefas }, { data: historico }] = await Promise.all([
    db().from("vendas_atividades").select("id, tipo, descricao, ator, criado_em").eq("oportunidade_id", id).order("criado_em", { ascending: false }).limit(50),
    db().from("vendas_tarefas").select("id, titulo, prazo, concluida_em").eq("oportunidade_id", id).order("prazo"),
    db().from("vendas_historico").select("id, de_etapa_id, para_etapa_id, ator, dias_na_etapa, criado_em").eq("oportunidade_id", id).order("criado_em", { ascending: false }).limit(30),
  ]);
  return {
    op: { ...op, cliente: { ...op.cliente, telefone: mascararTelefone(op.cliente?.telefone ?? "") } },
    atividades: atividades ?? [],
    tarefas: tarefas ?? [],
    historico: historico ?? [],
    podeMexer: podeMexer(u, op),
    podeAssumir: podeAssumir(u, op),
  };
}

type Resultado = { ok: true; id?: string } | { ok: false; motivo: string };

/** Lê só o necessário para decidir permissão — o filtro por unidade é a barreira entre lojas. */
async function opParaAlterar(u: Usuario, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from("vendas_oportunidades").select("id, funil_id, etapa_id, vendedor_id, unidade").eq("id", id).in("unidade", u.unidades).maybeSingle();
  return data as { id: string; funil_id: string; etapa_id: string; vendedor_id: string | null; unidade: string } | null;
}

/** F2-4: cliente e unidade do cartão, só para quem pode mexer nele (agendar lembrete/mensagem). */
export async function clienteDoCartao(u: Usuario, id: string): Promise<{ clienteId: string; unidade: string } | null> {
  const op = await opParaAlterar(u, id);
  if (!op || !podeMexer(u, op)) return null;
  const { data } = await db().from("vendas_oportunidades").select("cliente_id").eq("id", id).single();
  return data ? { clienteId: data.cliente_id as string, unidade: op.unidade } : null;
}

/**
 * F1-V-003: a permissão é conferida DE NOVO na própria gravação (unidade + posse vigente).
 * Se o gerente reatribuiu o cartão entre a leitura e a gravação, nada é alterado.
 */
const CONVERSA_ASSUMIDA = "Este cartão está com a conversa do WhatsApp assumida. Devolva a conversa ao assistente antes de fechar ou passar para outro vendedor.";

/** "conversa" = o banco recusou porque há atendimento de WhatsApp em posse neste cartão (trigger vendas_posse_aberta, 55000). */
async function gravarComPosse(u: Usuario, id: string, patch: Record<string, unknown>): Promise<"ok" | "conflito" | "erro" | "conversa"> {
  let q = db().from("vendas_oportunidades").update(patch).eq("id", id).in("unidade", u.unidades);
  if (!veTodasOportunidades(u)) q = q.eq("vendedor_id", u.id);
  const { data, error } = await q.select("id");
  if (error) return error.code === "55000" ? "conversa" : "erro";
  return data?.length ? "ok" : "conflito";
}

export async function criarOportunidade(
  u: Usuario,
  dados: {
    funilId: string; telefone: string; nome: string; veiculo: string | null; valor: number | null;
    pagamento: string; temperatura: string; prazo: string; temTroca: boolean; troca: string | null; observacoes: string | null;
  },
): Promise<Resultado> {
  const telefone = normalizarTelefone(dados.telefone);
  if (!telefone) return { ok: false, motivo: "Telefone inválido" };

  const { data: funil } = await db().from("vendas_funis").select("id, unidade").eq("id", dados.funilId).in("unidade", u.unidades).maybeSingle();
  if (!funil) return { ok: false, motivo: "Funil não encontrado" };
  const { data: primeira } = await db().from("vendas_etapas").select("id").eq("funil_id", funil.id).eq("tipo", "aberta").eq("ativo", true).order("ordem").limit(1).maybeSingle();
  if (!primeira) return { ok: false, motivo: "Funil sem etapas" };

  // Ficha única: reaproveita o cliente pelo telefone (cadastro manual NÃO gera consentimento de mensagem)
  let cliente: { id: string; nome: string | null; anonimizado: boolean } | null =
    await buscarClientePorTelefone<{ nome: string | null; anonimizado: boolean }>(telefone, "nome, anonimizado");
  if (cliente?.anonimizado) return { ok: false, motivo: "Cliente anonimizado (LGPD) — não pode ser reaberto" };
  if (!cliente) {
    const { data: novo, error } = await db()
      .from("clientes")
      .insert({ telefone, nome: dados.nome.slice(0, 120) || null, origem: "painel", unidade_origem: funil.unidade, vendedor_id: u.papel === "vendedor" ? u.id : null })
      .select("id, nome, anonimizado")
      .single();
    if (error || !novo) return { ok: false, motivo: "Não foi possível cadastrar o cliente" };
    cliente = novo;
  } else if (!cliente.nome && dados.nome) {
    await db().from("clientes").update({ nome: dados.nome.slice(0, 120) }).eq("id", cliente.id);
  }

  const { data: op, error } = await db()
    .from("vendas_oportunidades")
    .insert({
      unidade: funil.unidade,
      funil_id: funil.id,
      etapa_id: primeira.id,
      cliente_id: cliente.id,
      vendedor_id: u.papel === "vendedor" || u.papel === "gerente" ? u.id : null,
      veiculo_interesse: dados.veiculo?.slice(0, 120) || null,
      valor_estimado: dados.valor,
      pagamento: dados.pagamento,
      temperatura: dados.temperatura,
      prazo_compra: dados.prazo,
      tem_troca: dados.temTroca,
      troca_descricao: dados.temTroca ? dados.troca?.slice(0, 300) || null : null,
      observacoes: dados.observacoes?.slice(0, 1000) || null,
      origem: "painel",
      posicao: Date.now() / 1000,
      criado_por: u.email,
    })
    .select("id")
    .single();
  if (error || !op) return { ok: false, motivo: "Não foi possível criar a oportunidade" };
  await auditar(u.email, "criar_oportunidade", "vendas_oportunidades", op.id);
  return { ok: true, id: op.id };
}

/** valorGanho: valor fechado informado ao soltar em "Ganho" (já interpretado e validado); só vale para etapa ganho. */
export async function moverOportunidade(u: Usuario, id: string, etapaId: string, posicao: number | null, motivoPerda?: string, valorGanho?: number | null): Promise<Resultado> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeMexer(u, op)) return { ok: false, motivo: "Só o vendedor responsável ou o gerente pode mover este cartão" };
  const { data: etapa } = await db().from("vendas_etapas").select("id, tipo").eq("id", etapaId).eq("funil_id", op.funil_id).maybeSingle();
  if (!etapa) return { ok: false, motivo: "Etapa inválida para este funil" };
  if (etapa.tipo === "perdido" && !motivoPerda?.trim()) return { ok: false, motivo: "Informe o motivo da perda" };

  const patch: Record<string, unknown> = { etapa_id: etapaId, atualizado_por: u.email };
  if (posicao !== null && Number.isFinite(posicao)) patch.posicao = posicao;
  if (etapa.tipo === "perdido") patch.motivo_perda = motivoPerda!.trim().slice(0, 200);
  if (etapa.tipo === "ganho" && typeof valorGanho === "number" && Number.isFinite(valorGanho) && valorGanho > 0) patch.valor_estimado = valorGanho;
  const r = await gravarComPosse(u, id, patch);
  if (r === "conflito") return { ok: false, motivo: "O cartão mudou de responsável. Recarregue a tela." };
  if (r === "conversa") return { ok: false, motivo: CONVERSA_ASSUMIDA };
  if (r === "erro") return { ok: false, motivo: "Não foi possível mover" };
  if (etapaId !== op.etapa_id) await auditar(u.email, "mover_oportunidade", "vendas_oportunidades", id, { de: op.etapa_id, para: etapaId });
  return { ok: true };
}

export async function assumirOportunidade(u: Usuario, id: string): Promise<Resultado> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeAssumir(u, op)) return { ok: false, motivo: "Esta oportunidade já tem vendedor" };
  // condicional: só assume se continuar sem dono (dois vendedores clicando ao mesmo tempo)
  const { data } = await db().from("vendas_oportunidades").update({ vendedor_id: u.id, atualizado_por: u.email }).eq("id", id).in("unidade", u.unidades).is("vendedor_id", null).select("id");
  if (!data?.length) return { ok: false, motivo: "Outro vendedor assumiu antes" };
  await auditar(u.email, "assumir_oportunidade", "vendas_oportunidades", id);
  return { ok: true };
}

export async function atualizarQualificacao(
  u: Usuario, id: string,
  campos: { temperatura: string; qualificacao: string; pagamento: string; prazo: string; veiculo: string | null; valor: number | null; temTroca: boolean; troca: string | null; canal: string | null },
): Promise<Resultado> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeMexer(u, op)) return { ok: false, motivo: "Sem permissão para editar" };
  const patch: Record<string, unknown> = {
    temperatura: campos.temperatura, qualificacao: campos.qualificacao, pagamento: campos.pagamento, prazo_compra: campos.prazo,
    veiculo_interesse: campos.veiculo?.slice(0, 120) || null, valor_estimado: campos.valor,
    tem_troca: campos.temTroca, troca_descricao: campos.temTroca ? campos.troca?.slice(0, 300) || null : null,
    canal_venda: campos.canal, atualizado_por: u.email,
  };
  // F1-V-T005: responsável NÃO muda por aqui — só pela transferência (destino validado, motivo, nota e aviso)
  const r = await gravarComPosse(u, id, patch);
  if (r === "conflito") return { ok: false, motivo: "O cartão mudou de responsável. Recarregue a tela." };
  if (r !== "ok") return { ok: false, motivo: r === "conversa" ? CONVERSA_ASSUMIDA : "Não foi possível salvar" };
  await auditar(u.email, "editar_oportunidade", "vendas_oportunidades", id);
  return { ok: true };
}

export async function registrarAtividade(u: Usuario, id: string, tipo: string, descricao: string): Promise<Resultado> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeMexer(u, op)) return { ok: false, motivo: "Sem permissão" };
  const { error } = await db().from("vendas_atividades").insert({ oportunidade_id: id, tipo, descricao: descricao.slice(0, 2000), ator: u.email });
  return error ? { ok: false, motivo: "Não foi possível registrar" } : { ok: true };
}

export async function criarTarefa(u: Usuario, id: string, titulo: string, prazoISO: string): Promise<Resultado> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeMexer(u, op)) return { ok: false, motivo: "Sem permissão" };
  const prazo = new Date(prazoISO);
  if (Number.isNaN(prazo.getTime())) return { ok: false, motivo: "Prazo inválido" };
  const { error } = await db().from("vendas_tarefas").insert({
    oportunidade_id: id, titulo: titulo.slice(0, 200), prazo: prazo.toISOString(), responsavel_id: op.vendedor_id ?? u.id, criado_por: u.email,
  });
  return error ? { ok: false, motivo: "Não foi possível criar a tarefa" } : { ok: true };
}

export async function concluirTarefa(u: Usuario, tarefaId: string): Promise<Resultado> {
  const { data: t } = await db().from("vendas_tarefas").select("id, oportunidade_id").eq("id", tarefaId).maybeSingle();
  if (!t) return { ok: false, motivo: "Tarefa não encontrada" };
  const op = await opParaAlterar(u, t.oportunidade_id);
  if (!op || !podeMexer(u, op)) return { ok: false, motivo: "Sem permissão" };
  await db().from("vendas_tarefas").update({ concluida_em: new Date().toISOString() }).eq("id", tarefaId).is("concluida_em", null);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// F2-2 — vínculo manual com Processo de Vendas e Avaliex (ids_externos)
// ---------------------------------------------------------------------------
export async function vincularExterno(
  u: Usuario, id: string, tipo: "processo_vendas" | "avaliex", entrada: string, placa?: string | null,
): Promise<{ ok: true; aviso?: string } | { ok: false; motivo: string }> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeMexer(u, op)) return { ok: false, motivo: "Sem permissão neste cartão" };
  const { data: atual } = await db().from("vendas_oportunidades").select("ids_externos").eq("id", id).single();
  const ids = { ...((atual?.ids_externos as Record<string, unknown> | null) ?? {}) };
  const carimbo = { vinculado_por: u.email, vinculado_em: new Date().toISOString() };
  let aviso: string | undefined;
  let descricao: string;

  if (tipo === "processo_vendas") {
    const r = lerVinculoProcessoVendas(entrada);
    if (!r.ok) return r;
    ids.processo_vendas = { id: r.id, empresa: r.empresa ?? op.unidade, situacao: null, ...carimbo };
    descricao = `Vinculou a proposta ${r.id} do Processo de Vendas`;
    const { data: outros } = await db().from("vendas_oportunidades").select("id").eq("ids_externos->processo_vendas->>id", r.id).neq("id", id).limit(1);
    if (outros?.length) aviso = "Atenção: essa proposta já está vinculada a outro cartão.";
  } else {
    const r = lerVinculoAvaliex(entrada, op.unidade, placa);
    if (!r.ok) return r;
    ids.avaliex = { id: r.id, unidade: r.unidade, placa: r.placa, ...carimbo };
    descricao = `Vinculou a avaliação ${r.id} do Avaliex${r.placa ? ` (placa ${r.placa})` : ""}`;
    if (r.unidade !== op.unidade) aviso = `Atenção: a avaliação é da unidade ${r.unidade}, o cartão é da ${op.unidade}.`;
  }

  const g = await gravarComPosse(u, id, { ids_externos: ids, atualizado_por: u.email });
  if (g !== "ok") return { ok: false, motivo: g === "conflito" ? "O cartão mudou de responsável. Recarregue a tela." : "Não foi possível salvar o vínculo" };
  await db().from("vendas_atividades").insert({ oportunidade_id: id, tipo: tipo === "processo_vendas" ? "proposta" : "nota", descricao, ator: u.email });
  await auditar(u.email, "vincular_externo", "vendas_oportunidades", id, { tipo });
  return aviso ? { ok: true, aviso } : { ok: true };
}

export async function desvincularExterno(u: Usuario, id: string, tipo: "processo_vendas" | "avaliex"): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeMexer(u, op)) return { ok: false, motivo: "Sem permissão neste cartão" };
  const { data: atual } = await db().from("vendas_oportunidades").select("ids_externos").eq("id", id).single();
  const ids = { ...((atual?.ids_externos as Record<string, unknown> | null) ?? {}) };
  if (!(tipo in ids)) return { ok: true };
  delete ids[tipo];
  const g = await gravarComPosse(u, id, { ids_externos: ids, atualizado_por: u.email });
  if (g !== "ok") return { ok: false, motivo: "Não foi possível remover o vínculo" };
  await db().from("vendas_atividades").insert({ oportunidade_id: id, tipo: "nota", descricao: `Removeu o vínculo com ${tipo === "processo_vendas" ? "o Processo de Vendas" : "o Avaliex"}`, ator: u.email });
  await auditar(u.email, "desvincular_externo", "vendas_oportunidades", id, { tipo });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transferência de leads: um cartão (caiu errado) ou a carteira aberta inteira (férias)
// ---------------------------------------------------------------------------
async function vendedorValido(unidade: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await elegiveisVendas(unidade)).find((p) => p.user_id === id) ?? null;
}

type RetornoTransferir = { ok: boolean; cliente_id?: string; carteira?: boolean };

export async function transferirOportunidade(
  u: Usuario, id: string, novoId: string, motivo: MotivoTransferencia, moverCarteira: boolean,
): Promise<{ ok: true; aviso?: string } | { ok: false; motivo: string }> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeTransferir(u, op)) return { ok: false, motivo: "Só o vendedor responsável ou o gerente transfere este cartão" };
  if (novoId === op.vendedor_id) return { ok: false, motivo: "O cartão já está com esse vendedor" };
  const novo = await vendedorValido(op.unidade, novoId);
  if (!novo) return { ok: false, motivo: "Escolha um vendedor com acesso a Vendas nesta unidade" };

  const { data: antigo } = op.vendedor_id ? await db().from("usuarios").select("nome").eq("user_id", op.vendedor_id).maybeSingle() : { data: null };
  const deNome = (antigo?.nome as string | undefined) ?? "sem vendedor";
  // F1-V-T003: responsável + carteira + nota numa transação só; posse e unidade conferidas na gravação
  const { data, error } = await db().rpc("vendas_transferir", {
    p_id: id, p_de: op.vendedor_id, p_para: novo.user_id, p_unidades: [op.unidade], p_so_abertas: false,
    p_mover_carteira: moverCarteira, p_ator: u.email,
    p_descricao: `Transferido de ${deNome} para ${novo.nome} (${MOTIVOS_TRANSFERENCIA[motivo]})`,
  });
  if (error) return { ok: false, motivo: error.code === "55000" ? CONVERSA_ASSUMIDA : "Não foi possível transferir — nada foi alterado" };
  const r = data as RetornoTransferir | null;
  if (!r?.ok || !r.cliente_id) return { ok: false, motivo: "O cartão mudou de responsável. Recarregue a tela." };
  const clienteId = r.cliente_id;

  const { data: cli } = await db().from("clientes").select("nome").eq("id", clienteId).maybeSingle();
  const { data: funil } = await db().from("vendas_funis").select("chave").eq("id", op.funil_id).maybeSingle();
  if (novo.user_id !== u.id) {
    await notificar(novo.user_id, {
      tipo: "lead", unidade: op.unidade,
      titulo: `Lead transferido para você: ${(cli?.nome as string | undefined) ?? "cliente"}`,
      corpo: `De ${deNome} · ${MOTIVOS_TRANSFERENCIA[motivo]}`,
      link: `/painel/vendas?funil=${(funil?.chave as string | undefined) ?? "novos"}&op=${id}`,
    });
  }
  await auditar(u.email, "transferir_oportunidade", "vendas_oportunidades", id, { de: op.vendedor_id, para: novo.user_id, motivo, moverCarteira, carteiraMovida: !!r.carteira });
  return moverCarteira && !r.carteira
    ? { ok: true, aviso: "Cartão transferido. A carteira do cliente continuou com o vendedor dela (é de outra pessoa)." }
    : { ok: true };
}

/** Teto de um lote de férias (F1-V-T004): acima disso a operação avisa que foi parcial. */
const LOTE_MAXIMO = 10_000;
const PAGINA = 1000;

/**
 * Férias/saída: passa os cartões ABERTOS de um vendedor para outro, ou divide entre os demais (rodízio). Só supervisor.
 * F1-V-T002: cada unidade valida os próprios destinos e a gravação repete a unidade do cartão.
 * F1-V-T004: o lote é lido inteiro (em páginas estáveis) ANTES de gravar; acima do teto avisa que foi parcial.
 */
export async function transferirCarteira(
  u: Usuario, deId: string, para: string, motivo: MotivoTransferencia, moverCarteira: boolean,
): Promise<{ ok: true; total: number; pulados: number; parcial: boolean } | { ok: false; motivo: string }> {
  if (!veTodasOportunidades(u)) return { ok: false, motivo: "Só gerente ou administrador transfere a carteira inteira" };
  if (!/^[0-9a-f-]{36}$/i.test(deId)) return { ok: false, motivo: "Escolha o vendedor de origem" };

  type Op = { id: string; unidade: string };
  const lista: Op[] = [];
  let parcial = false;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db().from("vendas_oportunidades")
      .select("id, unidade").eq("vendedor_id", deId).is("fechado_em", null).in("unidade", u.unidades)
      .order("id").range(de, de + PAGINA - 1);
    if (error) return { ok: false, motivo: "Não foi possível ler a carteira desse vendedor" };
    lista.push(...((data ?? []) as Op[]));
    if (!data || data.length < PAGINA) break;
    if (lista.length >= LOTE_MAXIMO) { parcial = true; break; }
  }
  if (!lista.length) return { ok: false, motivo: "Esse vendedor não tem cartões abertos" };

  const porUnidade = new Map<string, Op[]>();
  for (const op of lista) porUnidade.set(op.unidade, [...(porUnidade.get(op.unidade) ?? []), op]);
  const plano: { op: Op; novo: string }[] = [];
  const semDestino: string[] = [];
  for (const [unidade, ops] of porUnidade) {
    if (para === "rodizio") {
      const ids = (await elegiveisVendas(unidade, ["vendedor"])).map((p) => p.user_id).filter((id) => id !== deId);
      if (!ids.length) { semDestino.push(unidade); continue; }
      const { data: abertas } = await db().from("vendas_oportunidades").select("vendedor_id, criado_em").in("vendedor_id", ids).is("fechado_em", null);
      const carga = ids.map((id) => {
        const minhas = (abertas ?? []).filter((o) => o.vendedor_id === id);
        return { id, abertas: minhas.length, ultimoLeadEm: minhas.map((o) => o.criado_em as string).sort().at(-1) ?? null };
      });
      const destinos = distribuirRodizio(ops.length, carga);
      ops.forEach((op, i) => plano.push({ op, novo: destinos[i] }));
    } else {
      const alvo = await vendedorValido(unidade, para);
      if (!alvo || alvo.user_id === deId) { semDestino.push(unidade); continue; }
      ops.forEach((op) => plano.push({ op, novo: alvo.user_id }));
    }
  }
  if (!plano.length) {
    return { ok: false, motivo: para === "rodizio" ? "Não há outros vendedores com acesso a Vendas nessa unidade" : "Esse vendedor não tem acesso a Vendas na unidade dos cartões" };
  }

  const { data: nomes } = await db().from("usuarios").select("user_id, nome").in("user_id", [deId, ...new Set(plano.map((x) => x.novo))]);
  const nome = (id: string) => ((nomes ?? []).find((n) => n.user_id === id)?.nome as string | undefined) ?? "vendedor";
  let total = 0, erros = 0;
  const porDestino = new Map<string, { vendedor: string; unidade: string; qtd: number }>();
  for (const { op, novo } of plano) {
    // unidade do cartão repetida na gravação: se ele mudou de unidade no meio do caminho, não é tocado
    const { data, error } = await db().rpc("vendas_transferir", {
      p_id: op.id, p_de: deId, p_para: novo, p_unidades: [op.unidade], p_so_abertas: true,
      p_mover_carteira: moverCarteira, p_ator: u.email,
      p_descricao: `Transferido de ${nome(deId)} para ${nome(novo)} (${MOTIVOS_TRANSFERENCIA[motivo]}, em lote)`,
    });
    if (error) { erros++; continue; }
    if (!(data as RetornoTransferir | null)?.ok) continue; // mudou no meio do caminho: não força
    total++;
    const k = `${novo}|${op.unidade}`;
    const atual = porDestino.get(k) ?? { vendedor: novo, unidade: op.unidade, qtd: 0 };
    atual.qtd++;
    porDestino.set(k, atual);
  }
  if (!total && erros) return { ok: false, motivo: "Não foi possível transferir — nada foi alterado" };
  for (const { vendedor, unidade, qtd } of porDestino.values()) {
    await notificar(vendedor, { tipo: "lead", unidade, titulo: `${qtd} ${qtd === 1 ? "lead transferido" : "leads transferidos"} para você`, corpo: `Carteira de ${nome(deId)} · ${MOTIVOS_TRANSFERENCIA[motivo]}`, link: "/painel/vendas" });
  }
  const pulados = lista.length - total;
  await auditar(u.email, "transferir_carteira", "vendas_oportunidades", null, { de: deId, para, total, pulados, erros, semDestino, parcial, motivo, moverCarteira });
  return { ok: true, total, pulados, parcial };
}
