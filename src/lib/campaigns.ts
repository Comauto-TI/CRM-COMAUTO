import "server-only";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { normalizarTelefone, variantesTelefone } from "@/lib/phone";
import { dentroHorarioEnvio, formatarDataHora } from "@/lib/time";
import { notificar } from "@/lib/messaging/outbound";
import { precoMeta } from "@/lib/costs";

/**
 * CAMPANHAS / EVENTOS EM MASSA (regras 7 e 8):
 * só base consentida, sem duplicidade, sem opt-out, telefone válido,
 * grupo de teste antes, lotes controlados, limite diário, horário comercial,
 * pausa automática se a taxa de falha subir, nunca reenviar para quem já recebeu.
 */

type Campanha = {
  id: string;
  nome: string;
  tipo: string;
  status: string;
  evento_id: string | null;
  filtros: { tags?: string[]; cidade?: string } | null;
  lote_tamanho: number;
  limite_diario: number;
  templates: { uso: string; finalidade: string; categoria_meta: string; variaveis: string[]; botoes: { payload_prefixo: string }[]; status_aprovacao: string } | null;
  eventos: { nome: string; inicio: string; local: string } | null;
};

async function carregar(campanhaId: string): Promise<Campanha | null> {
  const { data } = await db()
    .from("campanhas")
    .select("id, nome, tipo, status, evento_id, filtros, lote_tamanho, limite_diario, templates(uso, finalidade, categoria_meta, variaveis, botoes, status_aprovacao), eventos(nome, inicio, local)")
    .eq("id", campanhaId)
    .maybeSingle();
  return data as unknown as Campanha | null;
}

export type PreChecagem = {
  base: number;
  semConsentimento: number;
  optout: number;
  invalidos: number;
  duplicados: number;
  aptos: number;
  custoEstimadoBRL: number;
  templateAprovado: boolean;
};

async function publico(c: Campanha) {
  const finalidade = c.templates?.finalidade ?? "marketing";
  let q = db().from("clientes").select("id, telefone, nome, tags, cidade").eq("anonimizado", false);
  if (c.filtros?.cidade) q = q.ilike("cidade", c.filtros.cidade);
  if (c.filtros?.tags?.length) q = q.overlaps("tags", c.filtros.tags);
  const { data: clientes } = await q.limit(20000);

  const ids = (clientes ?? []).map((x) => x.id);
  const consentidos = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db().from("consentimentos").select("cliente_id").eq("status", "ativo").eq("tipo", finalidade).in("cliente_id", ids.slice(i, i + 500));
    (data ?? []).forEach((r) => consentidos.add(r.cliente_id));
  }
  // C7-004: sem a lista de bloqueio não existe público seguro — aborta em vez de considerar todos liberados
  const { data: opts, error: errOpt } = await db().from("optouts").select("telefone");
  if (errOpt) throw new Error(`lista de bloqueio indisponível: ${errOpt.message}`);
  const bloqueados = new Set((opts ?? []).flatMap((o) => variantesTelefone(o.telefone))); // com e sem o 9º dígito

  const vistos = new Set<string>();
  const aptos: { id: string; telefone: string; nome: string | null }[] = [];
  const cont = { semConsentimento: 0, optout: 0, invalidos: 0, duplicados: 0 };
  for (const cl of clientes ?? []) {
    const tel = normalizarTelefone(cl.telefone);
    if (!tel) { cont.invalidos++; continue; }
    if (bloqueados.has(tel)) { cont.optout++; continue; }
    if (!consentidos.has(cl.id)) { cont.semConsentimento++; continue; }
    if (vistos.has(tel) || variantesTelefone(tel).some((v) => vistos.has(v))) { cont.duplicados++; continue; }
    vistos.add(tel);
    aptos.push({ id: cl.id, telefone: tel, nome: cl.nome });
  }
  return { base: clientes?.length ?? 0, aptos, ...cont };
}

/**
 * Pré-checagem do público e do custo. Por padrão SÓ CALCULA (abrir a tela não grava nada — QA-TELAS-CAMPANHAS-GET-003).
 * persistir=true apenas em ação explícita (enfileirar), que registra total previsto e custo estimado.
 */
export async function preChecagem(campanhaId: string, opcoes: { persistir?: boolean } = {}): Promise<PreChecagem | null> {
  const c = await carregar(campanhaId);
  if (!c) return null;
  const p = await publico(c);
  const precoConvite = await precoMeta(c.templates?.categoria_meta ?? "MARKETING");
  const precoUtility = await precoMeta("UTILITY");
  // evento: convite + (confirmação, lembrete, agradecimento) estimados para todos, como no PDF
  const custo = p.aptos.length * precoConvite + (c.tipo === "evento" ? p.aptos.length * 3 * precoUtility : 0);
  if (opcoes.persistir) {
    await db().from("campanhas").update({ total_previsto: p.aptos.length, custo_estimado_brl: Number(custo.toFixed(2)) }).eq("id", campanhaId);
  }
  return {
    base: p.base,
    semConsentimento: p.semConsentimento,
    optout: p.optout,
    invalidos: p.invalidos,
    duplicados: p.duplicados,
    aptos: p.aptos.length,
    custoEstimadoBRL: custo,
    templateAprovado: c.templates?.status_aprovacao === "aprovado",
  };
}

/** Enfileira o público. `teste` = só o grupo de teste (regra: testar com grupo pequeno antes). */
export async function enfileirar(campanhaId: string, teste: boolean, ator: string) {
  const cfg = await getConfig();
  const c = await carregar(campanhaId);
  if (!c) return { ok: false, motivo: "campanha_inexistente" };
  if (c.templates?.status_aprovacao !== "aprovado") return { ok: false, motivo: "template_nao_aprovado" };
  const p = await publico(c);
  const lista = teste ? p.aptos.slice(0, cfg.campanhas.grupo_teste_tamanho) : p.aptos;
  for (let i = 0; i < lista.length; i += 500) {
    await db()
      .from("campanha_envios")
      .upsert(
        lista.slice(i, i + 500).map((x) => ({ campanha_id: campanhaId, cliente_id: x.id, telefone: x.telefone, grupo_teste: teste })),
        { onConflict: "campanha_id,cliente_id", ignoreDuplicates: true },
      );
  }
  await db()
    .from("campanhas")
    .update({ status: teste ? "teste" : "enviando", iniciada_em: new Date().toISOString(), motivo_pausa: null })
    .eq("id", campanhaId);
  await db().from("audit_log").insert({ ator, acao: teste ? "campanha_teste" : "campanha_iniciar", entidade: "campanha", entidade_id: campanhaId, dados: { qtd: lista.length } });
  return { ok: true, enfileirados: lista.length };
}

function valoresTemplate(variaveis: string[], dados: Record<string, string>): string[] {
  return variaveis.map((v) => dados[v] ?? "");
}

/** Cron: envia lotes respeitando horário, limite diário e pausa. */
export async function processarFilaCampanhas() {
  const cfg = await getConfig();
  if (!dentroHorarioEnvio(new Date(), cfg.horario_envio, cfg.fuso_offset)) return { enviados: 0, motivo: "fora_horario" };

  const { data: ativas } = await db().from("campanhas").select("id").in("status", ["teste", "enviando"]);
  let enviados = 0;
  const inicioDia = new Date(Date.now() - 24 * 3600_000).toISOString();

  for (const { id } of ativas ?? []) {
    const c = await carregar(id);
    if (!c?.templates) continue;
    const { count: hoje } = await db().from("campanha_envios").select("id", { count: "exact", head: true }).eq("campanha_id", id).gte("enviado_em", inicioDia);
    const restanteDia = c.limite_diario - (hoje ?? 0);
    if (restanteDia <= 0) continue;

    let q = db().from("campanha_envios").select("id, cliente_id, telefone").eq("campanha_id", id).eq("status", "fila");
    if (c.status === "teste") q = q.eq("grupo_teste", true);
    const { data: lote } = await q.limit(Math.min(c.lote_tamanho, restanteDia));

    if (!lote?.length) {
      // teste terminou => aguarda liberação manual; produção terminou => concluída
      await db().from("campanhas").update(c.status === "teste" ? { status: "pronta" } : { status: "concluida", concluida_em: new Date().toISOString() }).eq("id", id);
      continue;
    }

    const { data: nomes } = await db().from("clientes").select("id, nome").in("id", lote.map((l) => l.cliente_id));
    const nomePor = new Map((nomes ?? []).map((n) => [n.id, n.nome as string | null]));

    for (const envio of lote) {
      const dados: Record<string, string> = {
        nome: nomePor.get(envio.cliente_id)?.split(" ")[0] ?? "cliente",
        empresa: cfg.empresa.nome,
        evento: c.eventos?.nome ?? c.nome,
        data_hora: c.eventos ? formatarDataHora(c.eventos.inicio, cfg.fuso_offset) : "",
        local: c.eventos?.local ?? cfg.empresa.endereco,
        assunto: c.nome,
        veiculo: "veículo",
      };
      const r = await notificar({
        clienteId: envio.cliente_id,
        uso: c.templates.uso,
        valores: valoresTemplate(c.templates.variaveis, dados),
        payloads: (c.templates.botoes ?? []).map((b) => (c.evento_id ? `${b.payload_prefixo}:${c.evento_id}` : b.payload_prefixo)),
        preferirLivre: false,
        campanhaId: id,
      });
      // verificação de opt-out/consentimento indisponível: fica na fila e tenta no próximo ciclo
      if (!r.ok && r.motivo === "verificacao_indisponivel") continue;
      await db()
        .from("campanha_envios")
        .update(
          r.ok
            ? { status: "enviado", wamid: r.wamid, enviado_em: new Date().toISOString() }
            : { status: r.motivo.startsWith("sem_consentimento") || r.motivo === "optout" ? "ignorado" : "falhou", erro: r.motivo, enviado_em: new Date().toISOString() },
        )
        .eq("id", envio.id);
      if (r.ok && c.evento_id) {
        await db()
          .from("inscricoes_evento")
          .upsert({ evento_id: c.evento_id, cliente_id: envio.cliente_id, status: "convidado", origem: "campanha" }, { onConflict: "evento_id,cliente_id", ignoreDuplicates: true });
      }
      if (r.ok) enviados++;
    }
    await verificarPausaCampanha(id);
  }
  return { enviados };
}

/** Pausa automática se a taxa de falha passar do limite (regra 7: "pausar se aumentar falhas/bloqueios"). */
export async function verificarPausaCampanha(campanhaId: string) {
  const cfg = await getConfig();
  const { data } = await db().from("campanha_envios").select("status").eq("campanha_id", campanhaId).neq("status", "fila").neq("status", "ignorado");
  const total = data?.length ?? 0;
  if (total < cfg.campanhas.amostra_minima) return;
  const falhas = (data ?? []).filter((e) => e.status === "falhou").length;
  if (falhas / total > cfg.campanhas.pausa_taxa_falha) {
    await db()
      .from("campanhas")
      .update({ status: "pausada", motivo_pausa: `Pausa automática: ${falhas}/${total} falhas (${Math.round((falhas / total) * 100)}%)` })
      .eq("id", campanhaId)
      .in("status", ["teste", "enviando"]);
  }
}
