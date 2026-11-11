import "server-only";
import { db } from "@/lib/supabase/admin";
import type { Usuario } from "@/lib/auth";
import { faixaFunil, type EtapaResumo } from "@/modulos/vendas/regras";
import { funisDaUnidade } from "@/modulos/vendas/dados";
import type { OpMetrica } from "./calculos";

/** F8 — leitura para a aba Métricas. Sempre depois de exigirAcesso("metricas"); tudo filtrado pelas unidades do usuário. */

export const PERIODOS = { "30": "Últimos 30 dias", "90": "Últimos 90 dias", "180": "Últimos 180 dias", "365": "Últimos 12 meses" } as const;
export type Periodo = keyof typeof PERIODOS;
const JANELA_VENDA_EVENTO_DIAS = 60;

export async function carregarMetricasVendas(u: Usuario, funilChave: string | undefined, periodo: Periodo) {
  const funis = await funisDaUnidade(u.unidade);
  const funil = funis.find((f) => f.chave === funilChave) ?? funis[0];
  if (!funil) return null;
  const dias = Number(periodo);
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const umAno = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const agora = new Date();
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();

  const [{ data: etapas }, resumo, ops, { data: vendedores }] = await Promise.all([
    db().from("vendas_etapas").select("id, nome, ordem, tipo").eq("funil_id", funil.id).eq("ativo", true).order("ordem"),
    db().rpc("vendas_funil_resumo", { p_funil: funil.id, p_desde: desde }),
    // coorte do período + fechadas no último ano (base das chances por etapa) — F8-002: paginado
    lerTodas(funil.id, u.unidades, desde, umAno),
    db().from("usuarios").select("user_id, nome").in("unidade", u.unidades),
  ]);
  const listaEtapas = (etapas ?? []) as { id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido" }[];
  const etapaPorId = new Map(listaEtapas.map((e) => [e.id, e]));
  const listaOps = ops.linhas as { id: string; vendedor_id: string | null; origem: string; valor_estimado: number | null; criado_em: string; fechado_em: string | null; motivo_perda: string | null; etapa_id: string }[];

  // maior etapa não-perdida alcançada por oportunidade (pelo histórico) + tempos de saída por etapa
  const maiorOrdem = new Map<string, number>();
  const saidas: { etapa_id: string; dias: number }[] = [];
  for (let i = 0; i < listaOps.length; i += 300) {
    const ids = listaOps.slice(i, i + 300).map((o) => o.id);
    const { data: hist } = await db().from("vendas_historico").select("oportunidade_id, de_etapa_id, para_etapa_id, dias_na_etapa, criado_em").in("oportunidade_id", ids);
    for (const h of hist ?? []) {
      const e = h.para_etapa_id ? etapaPorId.get(h.para_etapa_id as string) : undefined;
      if (e && e.tipo !== "perdido") maiorOrdem.set(h.oportunidade_id as string, Math.max(maiorOrdem.get(h.oportunidade_id as string) ?? 0, e.ordem));
      if (h.de_etapa_id && h.dias_na_etapa != null && (h.criado_em as string) >= desde) saidas.push({ etapa_id: h.de_etapa_id as string, dias: Number(h.dias_na_etapa) });
    }
  }

  const paraMetrica = (o: (typeof listaOps)[number]): OpMetrica => {
    const tipo = etapaPorId.get(o.etapa_id)?.tipo ?? "aberta";
    return {
      id: o.id, vendedor_id: o.vendedor_id, origem: o.origem, valor: o.valor_estimado == null ? null : Number(o.valor_estimado),
      criado_em: o.criado_em, fechado_em: o.fechado_em, motivo_perda: o.motivo_perda,
      desfecho: tipo === "ganho" ? "ganho" : tipo === "perdido" ? "perdido" : "aberta",
      maior_ordem: maiorOrdem.get(o.id) ?? etapaPorId.get(o.etapa_id)?.ordem ?? 1,
    };
  };
  const todas = listaOps.map(paraMetrica);
  const coorte = todas.filter((o) => o.criado_em >= desde);
  const fechadasAno = todas.filter((o) => o.desfecho !== "aberta" && (o.fechado_em ?? "") >= umAno);
  const abertasAgora = todas.filter((o) => o.desfecho === "aberta").map((o) => ({ ordem: etapaPorId.get(listaOps.find((x) => x.id === o.id)!.etapa_id)?.ordem ?? 1 }));
  const ganhosNoMes = todas.filter((o) => o.desfecho === "ganho" && (o.fechado_em ?? "") >= inicioMes);

  return {
    funil, funis,
    etapas: listaEtapas,
    faixa: faixaFunil(((resumo.data ?? []) as EtapaResumo[]).map((r) => ({ ...r, abertas: Number(r.abertas), alcancaram: Number(r.alcancaram) }))),
    ganhoId: listaEtapas.find((e) => e.tipo === "ganho")?.id,
    coorte, fechadasAno, abertasAgora, ganhosNoMes, saidas,
    nomesVendedores: Object.fromEntries((vendedores ?? []).map((v) => [v.user_id as string, v.nome as string])),
    desde,
    parcial: ops.parcial, // F8-002: true = passou do teto de leitura; a tela avisa que os números são parciais
  };
}

const PAGINA = 1000;
const TETO_LEITURA = 50_000;
/** F8-002: lê TODAS as oportunidades do recorte em páginas ordenadas; acima do teto devolve parcial = true. */
async function lerTodas(funilId: string, unidades: string[], desde: string, umAno: string) {
  const linhas: Record<string, unknown>[] = [];
  for (let de = 0; de < TETO_LEITURA; de += PAGINA) {
    const { data, error } = await db().from("vendas_oportunidades")
      .select("id, vendedor_id, origem, valor_estimado, criado_em, fechado_em, motivo_perda, etapa_id")
      .eq("funil_id", funilId).in("unidade", unidades)
      .or(`criado_em.gte.${desde},fechado_em.gte.${umAno},fechado_em.is.null`)
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return { linhas, parcial: false };
  }
  return { linhas, parcial: true };
}

export async function listarEventos(u: Usuario) {
  const { data } = await db().from("eventos").select("id, nome, inicio, status").in("unidade", u.unidades).neq("status", "rascunho").order("inicio", { ascending: false }).limit(20);
  return (data ?? []) as { id: string; nome: string; inicio: string; status: string }[];
}

/** Pessoas únicas por etapa do evento. Vendidos = presentes com venda GANHA até 60 dias após o evento. */
export async function carregarFunilEvento(u: Usuario, eventoId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(eventoId)) return null;
  const { data: ev } = await db().from("eventos").select("id, nome, inicio, unidade").eq("id", eventoId).in("unidade", u.unidades).maybeSingle();
  if (!ev) return null;
  const [{ data: insc }, { data: camps }] = await Promise.all([
    db().from("inscricoes_evento").select("cliente_id, status").eq("evento_id", ev.id),
    db().from("campanhas").select("id").eq("evento_id", ev.id),
  ]);
  const idsCamp = (camps ?? []).map((c) => c.id as string);
  const { data: envios } = idsCamp.length
    ? await db().from("campanha_envios").select("cliente_id, status").in("campanha_id", idsCamp).eq("grupo_teste", false)
    : { data: [] as { cliente_id: string; status: string }[] };

  const chamados = new Set<string>();
  for (const e of envios ?? []) if (!["fila", "falhou", "ignorado"].includes(e.status as string)) chamados.add(e.cliente_id as string);
  // F8-001: Chamados = só convite registrado (envio da campanha do evento). Inscrição espontânea vai ao detalhamento.
  const confirmados = new Set((insc ?? []).filter((i) => ["confirmado", "compareceu"].includes(i.status as string)).map((i) => i.cliente_id as string));
  const presentes = new Set((insc ?? []).filter((i) => i.status === "compareceu").map((i) => i.cliente_id as string));

  // F8-001: Vendidos = venda GANHA atribuída a ESTE evento (origem "evento" + origem_ref = id do evento), na unidade do evento.
  // Indicador separado (aproximação, sem atribuição): presentes que compraram até 60 dias depois.
  const vendidos = new Set<string>();
  let compraramJanela = 0;
  if (presentes.size) {
    const ate = new Date(new Date(ev.inicio as string).getTime() + JANELA_VENDA_EVENTO_DIAS * 86_400_000).toISOString();
    const { data: ganhas } = await db()
      .from("vendas_oportunidades")
      .select("cliente_id, origem, origem_ref, fechado_em, etapa:vendas_etapas(tipo)")
      .in("cliente_id", [...presentes])
      .eq("unidade", ev.unidade as string)
      .gte("fechado_em", ev.inicio as string);
    const lista = ((ganhas ?? []) as unknown as { cliente_id: string; origem: string; origem_ref: string | null; fechado_em: string; etapa: { tipo: string } | null }[]).filter((g) => g.etapa?.tipo === "ganho");
    for (const g of lista) if (g.origem === "evento" && g.origem_ref === ev.id) vendidos.add(g.cliente_id);
    compraramJanela = new Set(lista.filter((g) => g.fechado_em <= ate).map((g) => g.cliente_id)).size;
  }
  return {
    evento: ev as { id: string; nome: string; inicio: string },
    conjuntos: { chamados, confirmados, presentes, vendidos },
    detalhe: {
      recusaram: (insc ?? []).filter((i) => i.status === "recusado").length,
      listaEspera: (insc ?? []).filter((i) => i.status === "lista_espera").length,
      espontaneas: (insc ?? []).filter((i) => !chamados.has(i.cliente_id as string)).length,
      compraramJanela,
      lidos: (envios ?? []).filter((e) => ["lido", "respondido"].includes(e.status as string)).length,
      responderam: (envios ?? []).filter((e) => e.status === "respondido").length,
    },
    janelaDias: JANELA_VENDA_EVENTO_DIAS,
  };
}
