import "server-only";
import { db } from "@/lib/supabase/admin";
import type { Usuario } from "@/lib/auth";
import { classificarMeuDia, type CartaoDia, type TarefaDia } from "./meu-dia-regras";

/** "Meu dia": só o que é DA PESSOA (tarefas dela e cartões em que ela é a vendedora), nas unidades dela. */
export async function carregarMeuDia(u: Usuario, agora: Date, fimDoDia: Date) {
  const [{ data: tarefasBrutas, error: e1 }, { data: opsBrutas, error: e2 }] = await Promise.all([
    db().from("vendas_tarefas").select("id, titulo, prazo, oportunidade_id")
      .eq("responsavel_id", u.id).is("concluida_em", null).lt("prazo", fimDoDia.toISOString()).order("prazo").limit(100),
    db().from("vendas_oportunidades").select("id, etapa_id, funil_id, cliente_id, entrou_na_etapa_em, criado_em")
      .eq("vendedor_id", u.id).is("fechado_em", null).in("unidade", u.unidades).limit(500),
  ]);
  if (e1 || e2) return null; // Vendas ainda não instalado
  const ops = opsBrutas ?? [];
  const tarefasRaw = tarefasBrutas ?? [];

  // oportunidades das tarefas que não estão na lista de abertas (ex.: tarefa num cartão já fechado continua valendo)
  const idsExtras = [...new Set(tarefasRaw.map((t) => t.oportunidade_id as string))].filter((id) => !ops.some((o) => o.id === id));
  const { data: opsExtras } = idsExtras.length
    ? await db().from("vendas_oportunidades").select("id, funil_id, cliente_id").in("id", idsExtras).in("unidade", u.unidades)
    : { data: [] };
  const todasOps = [...ops, ...(opsExtras ?? [])] as { id: string; funil_id: string; cliente_id: string; etapa_id?: string; entrou_na_etapa_em?: string; criado_em?: string }[];

  const idsClientes = [...new Set(todasOps.map((o) => o.cliente_id))];
  const idsFunis = [...new Set(todasOps.map((o) => o.funil_id))];
  const [{ data: clientes }, { data: funis }, { data: etapas }] = await Promise.all([
    idsClientes.length ? db().from("clientes").select("id, nome").in("id", idsClientes) : Promise.resolve({ data: [] }),
    idsFunis.length ? db().from("vendas_funis").select("id, chave").in("id", idsFunis) : Promise.resolve({ data: [] }),
    idsFunis.length ? db().from("vendas_etapas").select("id, nome, ordem, tipo, sla_dias, funil_id, ativo").in("funil_id", idsFunis) : Promise.resolve({ data: [] }),
  ]);
  const nomeCliente = new Map((clientes ?? []).map((c) => [c.id as string, (c.nome as string | null) ?? "Cliente sem nome"]));
  const chaveFunil = new Map((funis ?? []).map((f) => [f.id as string, f.chave as string]));
  const etapaPorId = new Map((etapas ?? []).map((e) => [e.id as string, e]));
  const primeiraOrdem = new Map<string, number>();
  for (const e of etapas ?? []) {
    if (e.tipo !== "aberta" || !e.ativo) continue;
    const f = e.funil_id as string;
    primeiraOrdem.set(f, Math.min(primeiraOrdem.get(f) ?? Infinity, e.ordem as number));
  }

  // contato humano = qualquer atividade registrada por alguém que não seja o assistente
  const comContato = new Set<string>();
  for (let i = 0; i < ops.length; i += 300) {
    const { data } = await db().from("vendas_atividades").select("oportunidade_id").in("oportunidade_id", ops.slice(i, i + 300).map((o) => o.id as string)).neq("ator", "assistente");
    for (const a of data ?? []) comContato.add(a.oportunidade_id as string);
  }

  const opPorId = new Map(todasOps.map((o) => [o.id, o]));
  const tarefas: TarefaDia[] = tarefasRaw
    .filter((t) => opPorId.has(t.oportunidade_id as string)) // só unidades da pessoa
    .map((t) => {
      const o = opPorId.get(t.oportunidade_id as string)!;
      return { id: t.id as string, titulo: t.titulo as string, prazo: t.prazo as string, oportunidadeId: o.id, cliente: nomeCliente.get(o.cliente_id) ?? "Cliente", funil: chaveFunil.get(o.funil_id) ?? "novos" };
    });
  const cartoes: CartaoDia[] = ops.map((o) => {
    const e = etapaPorId.get(o.etapa_id as string);
    return {
      id: o.id as string, cliente: nomeCliente.get(o.cliente_id as string) ?? "Cliente", funil: chaveFunil.get(o.funil_id as string) ?? "novos",
      etapa: (e?.nome as string | undefined) ?? "", ordemEtapa: (e?.ordem as number | undefined) ?? 0, primeiraOrdem: primeiraOrdem.get(o.funil_id as string) ?? 1,
      slaDias: (e?.sla_dias as number | null | undefined) ?? null, entrouEm: o.entrou_na_etapa_em as string, criadoEm: o.criado_em as string,
      teveContatoHumano: comContato.has(o.id as string),
    };
  });
  return classificarMeuDia(tarefas, cartoes, agora, fimDoDia);
}
