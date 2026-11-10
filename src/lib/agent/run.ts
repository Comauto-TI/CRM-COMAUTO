import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { formatarDataHora } from "@/lib/time";
import { lancarCustoIA, type UsoClaude } from "@/lib/costs";
import { promptSistema } from "./prompt";
import { TOOLS, executarTool, type ContextoTool } from "./tools";

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 45_000 });
  return client;
}

const MAX_ITERACOES = 5;

export type ResultadoAgente =
  | { tipo: "resposta"; texto: string }
  | { tipo: "transferido" }
  | { tipo: "falha"; motivo: string };

export type MensagemHistorico = { papel: "cliente" | "assistente"; texto: string };

/**
 * Executa o agente para UMA mensagem do cliente.
 * - system prompt congelado + tools estáveis => prompt caching
 * - contexto variável numa mensagem role:"system" após a última mensagem do usuário
 * - loop manual de tools (máx. 5 voltas); blocos do assistente voltam intactos
 */
export async function rodarAgente(args: {
  ctx: ContextoTool;
  historico: MensagemHistorico[];
  mensagem: string;
  contexto: { consentimentos: string[]; agendamentos: string[] };
}): Promise<ResultadoAgente> {
  const cfg = await getConfig();
  const modelo = env().CLAUDE_MODEL;

  // Histórico só em texto, começando sempre por mensagem do cliente
  const messages: Anthropic.MessageParam[] = [];
  for (const h of args.historico) {
    const role = h.papel === "cliente" ? "user" : "assistant";
    if (!messages.length && role === "assistant") continue;
    messages.push({ role, content: h.texto });
  }
  messages.push({ role: "user", content: args.mensagem });
  messages.push({
    role: "system",
    content: [
      `Agora: ${formatarDataHora(new Date(), cfg.fuso_offset)} (fuso ${cfg.fuso_offset}). Data de hoje: ${new Date(Date.now() + 0).toISOString().slice(0, 10)}.`,
      `Cliente: ${args.ctx.nomeCliente ?? "nome ainda não informado"}.`,
      `Consentimentos ativos: ${args.contexto.consentimentos.join(", ") || "nenhum"}.`,
      `Agendamentos futuros: ${args.contexto.agendamentos.join("; ") || "nenhum"}.`,
    ].join("\n"),
  });

  const uso: UsoClaude = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let chamadas = 0;
  let transferiu = false;

  try {
    for (let i = 0; i < MAX_ITERACOES; i++) {
      const response = await anthropic().messages.create({
        model: modelo,
        max_tokens: 2048,
        output_config: { effort: "low" },
        system: [{ type: "text", text: promptSistema(cfg.empresa), cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });
      chamadas++;
      uso.input_tokens += response.usage.input_tokens;
      uso.output_tokens += response.usage.output_tokens;
      uso.cache_read_input_tokens! += response.usage.cache_read_input_tokens ?? 0;
      uso.cache_creation_input_tokens! += response.usage.cache_creation_input_tokens ?? 0;

      if (response.stop_reason === "refusal") return { tipo: "falha", motivo: "refusal" };

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason === "tool_use" && toolUses.length) {
        messages.push({ role: "assistant", content: response.content });
        const resultados: Anthropic.ToolResultBlockParam[] = [];
        for (const t of toolUses) {
          try {
            const r = await executarTool(t.name, (t.input ?? {}) as Record<string, unknown>, args.ctx);
            if (r.transferiu) transferiu = true;
            resultados.push({ type: "tool_result", tool_use_id: t.id, content: r.resultado });
          } catch (err) {
            console.error("[agente] erro na tool", t.name, err instanceof Error ? err.message : err);
            resultados.push({ type: "tool_result", tool_use_id: t.id, content: '{"ok":false,"motivo":"erro_interno"}', is_error: true });
          }
        }
        messages.push({ role: "user", content: resultados });
        if (transferiu) return { tipo: "transferido" };
        continue;
      }

      if (response.stop_reason === "max_tokens") return { tipo: "falha", motivo: "max_tokens" };

      const texto = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (transferiu) return { tipo: "transferido" };
      return texto ? { tipo: "resposta", texto } : { tipo: "falha", motivo: "resposta_vazia" };
    }
    return { tipo: "falha", motivo: "limite_iteracoes" };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { tipo: "falha", motivo: "rate_limit" };
    if (err instanceof Anthropic.AuthenticationError) return { tipo: "falha", motivo: "auth_anthropic" };
    if (err instanceof Anthropic.BadRequestError) {
      console.error("[agente] bad request", err.message);
      return { tipo: "falha", motivo: "bad_request" };
    }
    if (err instanceof Anthropic.APIError) return { tipo: "falha", motivo: `api_${err.status}` };
    console.error("[agente] erro", err instanceof Error ? err.message : err);
    return { tipo: "falha", motivo: "erro_desconhecido" };
  } finally {
    if (chamadas > 0) await lancarCustoIA({ uso, clienteId: args.ctx.clienteId, chamadas, modelo }).catch(() => undefined);
  }
}
