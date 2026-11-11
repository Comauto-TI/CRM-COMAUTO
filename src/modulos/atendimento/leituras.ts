import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { objeto, uuid, setorValido, natural, type SetorLeitura } from "./contrato-leitura";

type FalhaLeitura = { ok: false; status: 400 | 403 | 404 | 503; motivo: string };
export type ResultadoLeitura =
  | { ok: true; atendimentoId: string; setor: SetorLeitura; total: number; lidas: number; naoLidas: number; revisaoPendente: boolean }
  | FalhaLeitura;
export type ResultadoMarcarLidas = { ok: true; atendimentoId: string; setor: SetorLeitura; marcadas: number } | FalhaLeitura;
export type ResultadoResumoLeituras =
  | { ok: true; setor: SetorLeitura; totalAtendimentos: number; totalMensagens: number; lidas: number; naoLidas: number; atendimentosComNaoLidas: number; revisaoPendente: boolean }
  | FalhaLeitura;

function falha(status: FalhaLeitura["status"]): FalhaLeitura {
  const motivos = {
    400: "Dados de leitura inválidos.",
    403: "Seu perfil não tem acesso ao atendimento desse setor.",
    404: "Atendimento não encontrado ou fora do seu acesso.",
    503: "Não foi possível processar as leituras. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status] };
}

type Operacao = "obter_leitura_atendimento" | "marcar_mensagens_lidas_atendimento" | "resumir_leituras_atendimentos";
async function consultar(operacao: Operacao, argumentos: Record<string, string | string[]>): Promise<{ ok: true; dados: Record<string, unknown> } | FalhaLeitura> {
  try {
    const { data, error } = await db().rpc(operacao, argumentos);
    if (error || !objeto(data)) return falha(503);
    if (data.ok === false) return falha(data.codigo === "invalido" ? 400 : data.codigo === "nao_encontrado" ? 404 : 503);
    return data.ok === true ? { ok: true, dados: data } : falha(503);
  } catch {
    return falha(503);
  }
}

function contagens(total: unknown, lidas: unknown, naoLidas: unknown) {
  return natural(total) && natural(lidas) && natural(naoLidas) && natural(lidas + naoLidas) && total === lidas + naoLidas
    ? { total, lidas, naoLidas } : null;
}

/** Contagem pontual: não marca mensagens nem reutiliza autorização anterior. */
export async function obterLeituraAtendimento(u: Usuario, atendimentoId: string, setor: SetorLeitura): Promise<ResultadoLeitura> {
  if (!objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !setorValido(setor)) return falha(400);
  if (!podeAcessar(u, setor)) return falha(403);
  const id = atendimentoId.toLowerCase();
  const r = await consultar("obter_leitura_atendimento", { p_atendimento_id: id, p_ator: u.id.toLowerCase(), p_setor: setor });
  if (!r.ok) return r;
  const d = r.dados;
  const c = contagens(d.total, d.lidas, d.naoLidas);
  if (!uuid(d.atendimentoId) || d.atendimentoId.toLowerCase() !== id || d.setor !== setor || !c || typeof d.revisaoPendente !== "boolean") return falha(503);
  return { ok: true, atendimentoId: id, setor, ...c, revisaoPendente: d.revisaoPendente };
}

/** Marca somente o lote explícito; escopo e associação são revalidados na transação. */
export async function marcarMensagensLidas(u: Usuario, atendimentoId: string, setor: SetorLeitura, mensagens: readonly string[]): Promise<ResultadoMarcarLidas> {
  if (!objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !setorValido(setor) ||
    !Array.isArray(mensagens) || mensagens.length < 1 || mensagens.length > 100) return falha(400);
  const ids: string[] = [];
  for (const m of mensagens) {
    if (!uuid(m)) return falha(400);
    ids.push(m.toLowerCase());
  }
  if (new Set(ids).size !== ids.length) return falha(400);
  if (!podeAcessar(u, setor)) return falha(403);
  const id = atendimentoId.toLowerCase();
  const r = await consultar("marcar_mensagens_lidas_atendimento", {
    p_atendimento_id: id, p_ator: u.id.toLowerCase(), p_setor: setor, p_mensagens: ids,
  });
  if (!r.ok) return r;
  const d = r.dados;
  if (!uuid(d.atendimentoId) || d.atendimentoId.toLowerCase() !== id || d.setor !== setor || !natural(d.marcadas) || d.marcadas > ids.length) return falha(503);
  return { ok: true, atendimentoId: id, setor, marcadas: d.marcadas };
}

/** Resumo do escopo atual; nenhum conteúdo ou identificador de mensagem é retornado. */
export async function resumirLeiturasAtendimentos(u: Usuario, setor: SetorLeitura): Promise<ResultadoResumoLeituras> {
  if (!objeto(u) || !uuid(u.id) || !setorValido(setor)) return falha(400);
  if (!podeAcessar(u, setor)) return falha(403);
  const r = await consultar("resumir_leituras_atendimentos", { p_ator: u.id.toLowerCase(), p_setor: setor });
  if (!r.ok) return r;
  const d = r.dados;
  const c = contagens(d.totalMensagens, d.lidas, d.naoLidas);
  if (d.setor !== setor || !c || !natural(d.totalAtendimentos) || !natural(d.atendimentosComNaoLidas) ||
    typeof d.revisaoPendente !== "boolean" || d.atendimentosComNaoLidas > Math.min(d.totalAtendimentos, c.naoLidas) ||
    (c.naoLidas === 0) !== (d.atendimentosComNaoLidas === 0) ||
    (d.totalAtendimentos === 0 && (c.total !== 0 || d.revisaoPendente))) return falha(503);
  return { ok: true, setor, totalAtendimentos: d.totalAtendimentos, totalMensagens: c.total, lidas: c.lidas,
    naoLidas: c.naoLidas, atendimentosComNaoLidas: d.atendimentosComNaoLidas, revisaoPendente: d.revisaoPendente };
}
