import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";

export type SetorAtendimento = "vendas" | "pecas";
export type ResultadoAtendimento =
  | { ok: true; id: string; versao: number; setor: SetorAtendimento; registroId: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; motivo: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_VERSAO = 2_147_483_647;
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const setorValido = (v: unknown): v is SetorAtendimento => v === "vendas" || v === "pecas";
const versaoValida = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v < LIMITE_VERSAO;

function falha(status: 400 | 403 | 404 | 409 | 503): ResultadoAtendimento {
  const motivos = {
    400: "Dados de atendimento inválidos.",
    403: "Seu perfil não tem acesso a esse setor.",
    404: "Atendimento não encontrado ou fora do seu acesso.",
    409: "O atendimento foi alterado ou está em uso. Atualize e tente novamente.",
    503: "Não foi possível acessar o atendimento. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status] };
}

function resultado(data: unknown): ResultadoAtendimento {
  if (!objeto(data)) return falha(503);
  if (data.ok === false) {
    if (data.codigo === "nao_encontrado") return falha(404);
    if (data.codigo === "conflito") return falha(409);
    return falha(503);
  }
  if (data.ok !== true || !uuid(data.id) || !uuid(data.registroId) || !setorValido(data.setor) || !versaoValida(data.versao)) {
    return falha(503);
  }
  // Só o contrato público sai desta camada, mesmo se o RPC acrescentar outros campos.
  return { ok: true, id: data.id.toLowerCase(), versao: data.versao, setor: data.setor, registroId: data.registroId.toLowerCase() };
}

/** Recebe somente o usuário autenticado no servidor; o RPC revalida seu escopo atual. */
export async function abrirAtendimento(u: Usuario, setor: SetorAtendimento, registroId: string): Promise<ResultadoAtendimento> {
  if (!objeto(u) || !uuid(u.id) || !setorValido(setor) || !uuid(registroId)) return falha(400);
  if (!podeAcessar(u, setor)) return falha(403);
  const registro = registroId.toLowerCase();
  try {
    const { data, error } = await db().rpc("abrir_atendimento_modular", {
      p_setor: setor, p_registro: registro, p_ator: u.id.toLowerCase(),
    });
    if (error) return falha(503);
    const r = resultado(data);
    return r.ok && (r.setor !== setor || r.registroId !== registro) ? falha(503) : r;
  } catch {
    return falha(503);
  }
}

/** O setor e a posse são obtidos e validados na transação, nunca do navegador. */
export async function assumirAtendimento(u: Usuario, atendimentoId: string, versao: number): Promise<ResultadoAtendimento> {
  if (!objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !versaoValida(versao)) return falha(400);
  if (!podeAcessar(u, "vendas") && !podeAcessar(u, "pecas")) return falha(403);
  const id = atendimentoId.toLowerCase();
  try {
    const { data, error } = await db().rpc("assumir_atendimento_modular", {
      p_id: id, p_ator: u.id.toLowerCase(), p_versao: versao,
    });
    if (error) return falha(503);
    const r = resultado(data);
    return r.ok && r.id !== id ? falha(503) : r;
  } catch {
    return falha(503);
  }
}
