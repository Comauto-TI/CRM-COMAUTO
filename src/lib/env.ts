import "server-only";
import { z } from "zod";

/**
 * Variáveis de ambiente do SERVIDOR. Nunca importe este arquivo em
 * componentes "use client" — o pacote server-only quebra o build se isso ocorrer.
 */
const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default("claude-haiku-5-5"),
  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: z.string().default("v24.0"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  APP_URL: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Lista só os NOMES das variáveis com problema — nunca os valores.
    const faltando = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${faltando}`);
  }
  cached = parsed.data;
  return cached;
}

/** Valores secretos carregados — o filtro de saída garante que nunca apareçam numa resposta. */
export function valoresSecretos(): string[] {
  const e = env();
  return [
    e.ANTHROPIC_API_KEY,
    e.WHATSAPP_TOKEN,
    e.WHATSAPP_APP_SECRET,
    e.WHATSAPP_VERIFY_TOKEN,
    e.SUPABASE_SERVICE_ROLE_KEY,
    e.CRON_SECRET,
  ].filter((v) => v && v.length >= 8);
}
