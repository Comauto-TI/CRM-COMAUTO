import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";

type SetorMensagem = "pecas" | "vendas";
type FalhaMensagem = { ok: false; status: 400 | 403 | 404 | 409 | 503; motivo: string };
type ReferenciasMensagem = { atendimentoId: string; mensagemId: string; referencia: string };
export type ResultadoVinculoMensagem = ({ ok: true; jaVinculado: boolean } & ReferenciasMensagem) | FalhaMensagem;
export type ResultadoAutorizacaoMensagem = ({ ok: true; setor: SetorMensagem } & ReferenciasMensagem) | FalhaMensagem;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID.test(v);
const referenciaValida = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 512 && v.trim() === v;

const setorValido = (v: unknown): v is SetorMensagem => v === "pecas" || v === "vendas";

function falha(status: FalhaMensagem["status"], setor: SetorMensagem = "pecas", acao: "vincular" | "autorizar" = "vincular"): FalhaMensagem {
  const motivos = {
    400: acao === "vincular" ? "Dados de vínculo de mensagem inválidos." : "Dados de autorização de mensagem inválidos.",
    403: `Seu perfil não tem acesso ao atendimento de ${setor === "pecas" ? "Peças" : "Vendas"}.`,
    404: "Atendimento ou mensagem não encontrados no seu acesso.",
    409: "A mensagem ou o atendimento foi alterado. Atualize e tente novamente.",
    503: acao === "vincular" ? "Não foi possível vincular a mensagem. Tente novamente." : "Não foi possível acessar a mensagem. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status] };
}

function erroRpc(data: Record<string, unknown>, setor: SetorMensagem, acao: "vincular" | "autorizar"): FalhaMensagem {
  if (data.codigo === "nao_encontrado") return falha(404, setor, acao);
  if (data.codigo === "conflito") return falha(409, setor, acao);
  if (data.codigo === "origem_ambigua") return { ok: false, status: 409, motivo: "A origem desta mensagem precisa de revisão antes de continuar" };
  return falha(503, setor, acao);
}

function corresponde(data: Record<string, unknown>, id: string, referencia: string): data is Record<string, unknown> & ReferenciasMensagem & { ok: true } {
  return data.ok === true && uuid(data.atendimentoId) && uuid(data.mensagemId) &&
    data.atendimentoId.toLowerCase() === id && data.referencia === referencia;
}

async function vincular(u: Usuario, atendimentoId: string, referencia: string, setor: SetorMensagem,
  rpc: "vincular_mensagem_encaminhada" | "vincular_mensagem_vendas"): Promise<ResultadoVinculoMensagem> {
  if (!objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !referenciaValida(referencia)) return falha(400, setor);
  if (!podeAcessar(u, setor)) return falha(403, setor);
  const id = atendimentoId.toLowerCase();
  try {
    const { data, error } = await db().rpc(rpc, {
      p_atendimento_id: id, p_referencia: referencia, p_ator: u.id.toLowerCase(),
    });
    if (error || !objeto(data)) return falha(503, setor);
    if (data.ok === false) return erroRpc(data, setor, "vincular");
    if (!corresponde(data, id, referencia) || typeof data.jaVinculado !== "boolean") {
      return falha(503, setor);
    }
    return {
      ok: true, atendimentoId: data.atendimentoId.toLowerCase(), mensagemId: data.mensagemId.toLowerCase(),
      referencia, jaVinculado: data.jaVinculado,
    };
  } catch {
    return falha(503, setor);
  }
}

/** Peças: vincula somente a origem comprovada no ledger de encaminhamentos. */
export async function vincularMensagemEncaminhada(u: Usuario, atendimentoId: string, referencia: string): Promise<ResultadoVinculoMensagem> {
  return vincular(u, atendimentoId, referencia, "pecas", "vincular_mensagem_encaminhada");
}

/** Vendas: o RPC deriva o domínio e comprova a origem, sem inferência pelo cliente. */
export async function vincularMensagemVendas(u: Usuario, atendimentoId: string, referencia: string): Promise<ResultadoVinculoMensagem> {
  return vincular(u, atendimentoId, referencia, "vendas", "vincular_mensagem_vendas");
}

/**
 * Guarda para leitura futura: exige associação existente e revalida origem,
 * domínio e escopo atuais no SQL. Não retorna conteúdo de mensagem.
 * É uma verificação pontual: os IDs retornados não são permissão reutilizável.
 * A futura leitura de conteúdo deve revalidar e buscar na mesma transação.
 */
export async function autorizarMensagemAtendimento(u: Usuario, atendimentoId: string, referencia: string, setor: SetorMensagem): Promise<ResultadoAutorizacaoMensagem> {
  if (!setorValido(setor) || !objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !referenciaValida(referencia)) return falha(400, "pecas", "autorizar");
  if (!podeAcessar(u, setor)) return falha(403, setor, "autorizar");
  const id = atendimentoId.toLowerCase();
  try {
    const { data, error } = await db().rpc("autorizar_mensagem_atendimento", {
      p_atendimento_id: id, p_referencia: referencia, p_ator: u.id.toLowerCase(), p_setor: setor,
    });
    if (error || !objeto(data)) return falha(503, setor, "autorizar");
    if (data.ok === false) return erroRpc(data, setor, "autorizar");
    if (!corresponde(data, id, referencia) || data.setor !== setor) return falha(503, setor, "autorizar");
    return { ok: true, atendimentoId: data.atendimentoId.toLowerCase(), mensagemId: data.mensagemId.toLowerCase(), referencia, setor };
  } catch {
    return falha(503, setor, "autorizar");
  }
}
