import "server-only";
import { db } from "@/lib/supabase/admin";

export type ConfigMap = {
  empresa: { nome: string; endereco: string; telefone_humano: string; site: string; whatsapp_numero?: string; logo_url?: string };
  fuso_offset: string;
  cambio_usd_brl: number;
  claude_preco: { modelo: string; input: number; output: number; cache_read: number; cache_write: number };
  agenda: { antecedencia_min_horas: number; janela_dias: number; passo_min: number; intervalo_min: number; max_opcoes: number };
  horario_envio: { inicio: string; fim: string; dias: number[] };
  followup: { pos_servico_dias: number; revisao_aviso_dias: number; lead_horas: number; nao_compareceu_horas: number; max_tentativas: number };
  seguranca: { max_msgs_por_minuto: number; max_msgs_por_dia: number; max_chars_entrada: number; historico_msgs: number };
  campanhas: { pausa_taxa_falha: number; amostra_minima: number; grupo_teste_tamanho: number };
  atendimento: { sla_min: number; msg_transferencia: string; msg_fora_horario: string; msg_sla: string };
  bot_ativo: boolean;
};

export const CONFIG_PADRAO: ConfigMap = {
  empresa: { nome: "Comauto", endereco: "", telefone_humano: "", site: "" },
  fuso_offset: "-03:00",
  cambio_usd_brl: 5.4,
  claude_preco: { modelo: "claude-haiku-5-5", input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
  agenda: { antecedencia_min_horas: 2, janela_dias: 30, passo_min: 30, intervalo_min: 0, max_opcoes: 6 },
  horario_envio: { inicio: "08:00", fim: "20:00", dias: [1, 2, 3, 4, 5, 6] },
  followup: { pos_servico_dias: 2, revisao_aviso_dias: 15, lead_horas: 20, nao_compareceu_horas: 3, max_tentativas: 1 },
  seguranca: { max_msgs_por_minuto: 8, max_msgs_por_dia: 150, max_chars_entrada: 1200, historico_msgs: 12 },
  campanhas: { pausa_taxa_falha: 0.15, amostra_minima: 30, grupo_teste_tamanho: 20 },
  atendimento: {
    sla_min: 5,
    msg_transferencia: "Entendi! Já avisei nossa recepção e em instantes alguém da equipe continua o atendimento por aqui.",
    msg_fora_horario: "Nossa equipe está fora do horário agora. Sua mensagem ficou registrada e vamos responder assim que voltarmos.",
    msg_sla: "Ainda estamos chamando alguém da equipe, só mais um instante, por favor.",
  },
  bot_ativo: true,
};

let cache: { valor: ConfigMap; em: number } | null = null;
const TTL_MS = 60_000;

export async function getConfig(): Promise<ConfigMap> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.valor;
  const { data, error } = await db().from("config").select("chave, valor");
  if (error) throw error;
  const valor: Record<string, unknown> = { ...CONFIG_PADRAO };
  for (const row of data ?? []) valor[row.chave as string] = row.valor;
  cache = { valor: valor as ConfigMap, em: Date.now() };
  return cache.valor;
}

export function invalidarConfig() {
  cache = null;
}
