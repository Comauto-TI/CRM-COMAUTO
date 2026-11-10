import "server-only";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { normalizarTelefone, mascararTelefone } from "@/lib/phone";
import type { Usuario } from "@/lib/auth";
import { veTodasOportunidades, podeMexer, podeAssumir, type EtapaResumo } from "./regras";

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
  cliente: { id: string; nome: string | null; telefone: string };
};

/** true se as tabelas de Vendas já existem (0003 aplicada). */
export async function vendasDisponivel(): Promise<boolean> {
  const { error } = await db().from("vendas_funis").select("id").limit(1);
  return !error;
}

export async function funisDaUnidade(unidade: string): Promise<Funil[]> {
  const { data } = await db().from("vendas_funis").select("id, chave, nome").eq("unidade", unidade).eq("ativo", true).order("ordem");
  return (data ?? []) as Funil[];
}

export async function vendedoresDaUnidade(unidade: string): Promise<{ user_id: string; nome: string }[]> {
  const { data } = await db()
    .from("usuarios")
    .select("user_id, nome")
    .eq("ativo", true)
    .eq("unidade", unidade)
    .in("papel", ["vendedor", "gerente"])
    .order("nome");
  return (data ?? []) as { user_id: string; nome: string }[];
}

export async function carregarQuadro(u: Usuario, funil: Funil, filtroVendedor?: string) {
  const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data: etapas }, resumo] = await Promise.all([
    db().from("vendas_etapas").select("id, nome, ordem, tipo, sla_dias").eq("funil_id", funil.id).eq("ativo", true).order("ordem"),
    db().rpc("vendas_funil_resumo", { p_funil: funil.id, p_desde: desde }),
  ]);

  // Quadro mostra abertas + fechadas nos últimos 30 dias (Ganho/Perdido não acumulam para sempre)
  const corteFechadas = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let q = db()
    .from("vendas_oportunidades")
    .select("id, etapa_id, vendedor_id, veiculo_interesse, valor_estimado, temperatura, qualificacao, pagamento, tem_troca, origem, entrou_na_etapa_em, posicao, cliente:clientes(id, nome, telefone)")
    .eq("funil_id", funil.id)
    .order("posicao")
    .limit(500);
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

  return {
    etapas: (etapas ?? []) as Etapa[],
    cartoes: ((cartoes ?? []) as unknown as Cartao[]).map((c) => ({ ...c, cliente: { ...c.cliente, telefone: mascararTelefone(c.cliente?.telefone ?? "") } })),
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

/**
 * F1-V-003: a permissão é conferida DE NOVO na própria gravação (unidade + posse vigente).
 * Se o gerente reatribuiu o cartão entre a leitura e a gravação, nada é alterado.
 */
async function gravarComPosse(u: Usuario, id: string, patch: Record<string, unknown>): Promise<"ok" | "conflito" | "erro"> {
  let q = db().from("vendas_oportunidades").update(patch).eq("id", id).in("unidade", u.unidades);
  if (!veTodasOportunidades(u)) q = q.eq("vendedor_id", u.id);
  const { data, error } = await q.select("id");
  if (error) return "erro";
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
  let { data: cliente } = await db().from("clientes").select("id, nome, anonimizado").eq("telefone", telefone).maybeSingle();
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

export async function moverOportunidade(u: Usuario, id: string, etapaId: string, posicao: number | null, motivoPerda?: string): Promise<Resultado> {
  const op = await opParaAlterar(u, id);
  if (!op) return { ok: false, motivo: "Oportunidade não encontrada" };
  if (!podeMexer(u, op)) return { ok: false, motivo: "Só o vendedor responsável ou o gerente pode mover este cartão" };
  const { data: etapa } = await db().from("vendas_etapas").select("id, tipo").eq("id", etapaId).eq("funil_id", op.funil_id).maybeSingle();
  if (!etapa) return { ok: false, motivo: "Etapa inválida para este funil" };
  if (etapa.tipo === "perdido" && !motivoPerda?.trim()) return { ok: false, motivo: "Informe o motivo da perda" };

  const patch: Record<string, unknown> = { etapa_id: etapaId, atualizado_por: u.email };
  if (posicao !== null && Number.isFinite(posicao)) patch.posicao = posicao;
  if (etapa.tipo === "perdido") patch.motivo_perda = motivoPerda!.trim().slice(0, 200);
  const r = await gravarComPosse(u, id, patch);
  if (r === "conflito") return { ok: false, motivo: "O cartão mudou de responsável. Recarregue a tela." };
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
  campos: { temperatura: string; qualificacao: string; pagamento: string; prazo: string; veiculo: string | null; valor: number | null; temTroca: boolean; troca: string | null; canal: string | null; vendedorId?: string | null },
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
  // só supervisor redistribui carteira
  if (veTodasOportunidades(u) && campos.vendedorId !== undefined) patch.vendedor_id = campos.vendedorId;
  const r = await gravarComPosse(u, id, patch);
  if (r === "conflito") return { ok: false, motivo: "O cartão mudou de responsável. Recarregue a tela." };
  if (r === "erro") return { ok: false, motivo: "Não foi possível salvar" };
  await auditar(u.email, "editar_oportunidade", "vendas_oportunidades", id, { vendedor: patch.vendedor_id });
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
