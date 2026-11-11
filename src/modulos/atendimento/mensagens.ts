import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";

export type ResultadoVinculoMensagem =
  | { ok: true; atendimentoId: string; mensagemId: string; referencia: string; jaVinculado: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; motivo: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const referenciaValida = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 512 && v.trim() === v;

function falha(status: 400 | 403 | 404 | 409 | 503): ResultadoVinculoMensagem {
  const motivos = {
    400: "Dados de vínculo de mensagem inválidos.",
    403: "Seu perfil não tem acesso ao atendimento de Peças.",
    404: "Atendimento ou mensagem não encontrados no seu acesso.",
    409: "A mensagem ou o atendimento foi alterado. Atualize e tente novamente.",
    503: "Não foi possível vincular a mensagem. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status] };
}

/**
 * Vincula somente a mensagem inicial de Peças comprovada no encaminhamentos_bot.
 * Recebe o usuário autenticado no servidor. Origem, setor, unidade e responsável
 * atual do negócio são revalidados pelo RPC; cliente ou conversa não autorizam.
 */
export async function vincularMensagemEncaminhada(u: Usuario, atendimentoId: string, referencia: string): Promise<ResultadoVinculoMensagem> {
  if (!objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !referenciaValida(referencia)) return falha(400);
  if (!podeAcessar(u, "pecas")) return falha(403);
  const id = atendimentoId.toLowerCase();
  try {
    const { data, error } = await db().rpc("vincular_mensagem_encaminhada", {
      p_atendimento_id: id, p_referencia: referencia, p_ator: u.id.toLowerCase(),
    });
    if (error || !objeto(data)) return falha(503);
    if (data.ok === false) {
      if (data.codigo === "nao_encontrado") return falha(404);
      if (data.codigo === "conflito") return falha(409);
      return falha(503);
    }
    if (data.ok !== true || !uuid(data.atendimentoId) || !uuid(data.mensagemId) ||
      data.atendimentoId.toLowerCase() !== id || data.referencia !== referencia || typeof data.jaVinculado !== "boolean") {
      return falha(503);
    }
    return {
      ok: true, atendimentoId: data.atendimentoId.toLowerCase(), mensagemId: data.mensagemId.toLowerCase(),
      referencia, jaVinculado: data.jaVinculado,
    };
  } catch {
    return falha(503);
  }
}
