import "server-only";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";

/**
 * FINANCEIRO — todo centavo vira uma linha em `custos`:
 *  - Meta: lançado quando o webhook de status diz "delivered" e billable=true
 *    (a Meta cobra por mensagem ENTREGUE; categoria vem do próprio webhook).
 *  - Anthropic: lançado a cada chamada, a partir do `usage` real da resposta
 *    (input, cache read, cache write, output), convertido pelo câmbio configurado.
 *  - Infra: custos fixos mensais lançados pelo cron no dia 1.
 */

const MAPA_CATEGORIA: Record<string, { tabela: string; custo: string }> = {
  marketing: { tabela: "MARKETING", custo: "meta_marketing" },
  marketing_lite: { tabela: "MARKETING", custo: "meta_marketing" },
  utility: { tabela: "UTILITY", custo: "meta_utility" },
  authentication: { tabela: "AUTHENTICATION", custo: "meta_authentication" },
  authentication_international: { tabela: "AUTHENTICATION", custo: "meta_authentication" },
  service: { tabela: "SERVICE", custo: "meta_service" },
};

let precosCache: { em: number; lista: { categoria: string; valor_brl: number; vigente_desde: string }[] } | null = null;

export async function precoMeta(categoriaTabela: string, quando = new Date()): Promise<number> {
  if (!precosCache || Date.now() - precosCache.em > 300_000) {
    const { data } = await db().from("precos_meta").select("categoria, valor_brl, vigente_desde").order("vigente_desde", { ascending: false });
    precosCache = { em: Date.now(), lista: (data ?? []).map((p) => ({ ...p, valor_brl: Number(p.valor_brl) })) };
  }
  const dia = quando.toISOString().slice(0, 10);
  const p = precosCache.lista.find((x) => x.categoria === categoriaTabela && x.vigente_desde <= dia);
  return p?.valor_brl ?? 0;
}

/** Chamado pelo webhook de status. Idempotente (índice único em custos.mensagem_id). */
export async function lancarCustoMeta(args: {
  wamid: string;
  categoria: string | null;
  cobravel: boolean | null;
  modeloPreco: string | null;
  quando: Date;
}) {
  if (args.cobravel !== true || !args.categoria) return;
  const mapa = MAPA_CATEGORIA[args.categoria.toLowerCase()];
  if (!mapa) return;

  const { data: msg } = await db()
    .from("mensagens")
    .select("id, cliente_id, campanha_id, agendamento_id, template_nome")
    .eq("wamid", args.wamid)
    .maybeSingle();
  if (!msg) return;

  const valor = await precoMeta(mapa.tabela, args.quando);
  const { error } = await db().from("custos").insert({
    ocorrido_em: args.quando.toISOString(),
    categoria: mapa.custo,
    descricao: `WhatsApp ${mapa.tabela}${msg.template_nome ? ` — ${msg.template_nome}` : ""}`,
    quantidade: 1,
    valor_unitario_brl: valor,
    valor_brl: valor,
    mensagem_id: msg.id,
    campanha_id: msg.campanha_id,
    agendamento_id: msg.agendamento_id,
    cliente_id: msg.cliente_id,
    metadata: { wamid: args.wamid, categoria_meta: args.categoria, modelo_preco: args.modeloPreco },
  });
  if (!error) {
    await db().from("mensagens").update({ custo_brl: valor, categoria_cobranca: mapa.tabela }).eq("id", msg.id);
  }
}

export type UsoClaude = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function calcularCustoClaudeUSD(
  uso: UsoClaude,
  preco: { input: number; output: number; cache_read: number; cache_write: number },
): number {
  return (
    (uso.input_tokens * preco.input +
      (uso.cache_read_input_tokens ?? 0) * preco.cache_read +
      (uso.cache_creation_input_tokens ?? 0) * preco.cache_write +
      uso.output_tokens * preco.output) /
    1_000_000
  );
}

export async function lancarCustoIA(args: { uso: UsoClaude; clienteId: string | null; chamadas: number; modelo: string }) {
  const cfg = await getConfig();
  const usd = calcularCustoClaudeUSD(args.uso, cfg.claude_preco);
  const brl = usd * cfg.cambio_usd_brl;
  await db().from("custos").insert({
    categoria: "ia_anthropic",
    descricao: `Claude (${args.modelo}) — ${args.chamadas} chamada(s)`,
    quantidade: args.chamadas,
    valor_unitario_brl: args.chamadas ? brl / args.chamadas : brl,
    valor_brl: brl,
    valor_usd: usd,
    cambio: cfg.cambio_usd_brl,
    cliente_id: args.clienteId,
    metadata: {
      modelo: args.modelo,
      input_tokens: args.uso.input_tokens,
      output_tokens: args.uso.output_tokens,
      cache_read_input_tokens: args.uso.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: args.uso.cache_creation_input_tokens ?? 0,
    },
  });
}

/** Cron do dia 1: lança os custos fixos do mês (anuais entram como 1/12). */
export async function lancarCustosFixosDoMes(agora = new Date()) {
  const cfg = await getConfig();
  const mes = agora.toISOString().slice(0, 7);
  const { data: jaLancado } = await db()
    .from("custos")
    .select("id")
    .eq("categoria", "infra")
    .contains("metadata", { mes_referencia: mes })
    .limit(1);
  if (jaLancado?.length) return { lancados: 0, motivo: "já lançado" };

  const { data: fixos } = await db().from("custos_fixos").select("*").eq("ativo", true);
  const linhas = (fixos ?? []).map((f) => {
    const valorMes = f.recorrencia === "anual" ? Number(f.valor) / 12 : Number(f.valor);
    const brl = f.moeda === "USD" ? valorMes * cfg.cambio_usd_brl : valorMes;
    return {
      ocorrido_em: agora.toISOString(),
      categoria: "infra",
      descricao: `${f.nome} (${mes})`,
      quantidade: 1,
      valor_unitario_brl: brl,
      valor_brl: brl,
      valor_usd: f.moeda === "USD" ? valorMes : null,
      cambio: f.moeda === "USD" ? cfg.cambio_usd_brl : null,
      metadata: { mes_referencia: mes, custo_fixo_id: f.id },
    };
  });
  if (linhas.length) await db().from("custos").insert(linhas);
  return { lancados: linhas.length };
}
