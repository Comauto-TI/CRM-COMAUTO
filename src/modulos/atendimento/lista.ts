import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { mascararDadosSensiveis } from "@/lib/security/guard";
import { db } from "@/lib/supabase/admin";
import { objeto, uuid, setorValido, natural, instante, cursor, opcoesValidas, mensagem,
  type SetorLeitura, type CursorMensagens, type OpcoesLeituraAtendimento, type MensagemAtendimento } from "./contrato-leitura";

type Unidade = "comauto" | "motomecanica" | "santaluzia";
export type OpcoesListaAtendimentos = OpcoesLeituraAtendimento;
export type AtendimentoLista = {
  id: string; setor: SetorLeitura; registroId: string; unidade: Unidade; clienteNome: string; criadoEm: string;
  totalMensagens: number; revisaoPendente: boolean; previa: MensagemAtendimento | null;
};
export type ResultadoListaAtendimentos =
  | { ok: true; setor: SetorLeitura; totalAtendimentos: number; totalMensagens: number; atendimentos: AtendimentoLista[]; proximoCursor: CursorMensagens | null }
  | { ok: false; status: 400 | 403 | 503; motivo: string };

function atendimento(v: unknown, setor: SetorLeitura): AtendimentoLista | null {
  if (!objeto(v) || !uuid(v.id) || v.setor !== setor || !uuid(v.registroId) ||
    (v.unidade !== "comauto" && v.unidade !== "motomecanica" && v.unidade !== "santaluzia") ||
    typeof v.clienteNome !== "string" || !instante(v.criadoEm) || !natural(v.totalMensagens) || typeof v.revisaoPendente !== "boolean") return null;
  const previa = v.previa === null ? null : mensagem(v.previa);
  if ((v.totalMensagens === 0 && v.previa !== null) || (v.totalMensagens > 0 && !previa)) return null;
  return {
    id: v.id.toLowerCase(), setor, registroId: v.registroId.toLowerCase(), unidade: v.unidade,
    clienteNome: mascararDadosSensiveis(v.clienteNome).texto, criadoEm: v.criadoEm,
    totalMensagens: v.totalMensagens, revisaoPendente: v.revisaoPendente,
    // O parser compartilhado mascara antes deste corte para não partir CPF/cartão.
    previa: previa ? { ...previa, conteudo: previa.conteudo === null ? null : Array.from(previa.conteudo).slice(0, 160).join("") } : null,
  };
}

function falha(status: 400 | 403 | 503): ResultadoListaAtendimentos {
  const motivos = {
    400: "Dados de listagem de atendimentos inválidos.",
    403: "Seu perfil não tem acesso ao atendimento desse setor.",
    503: "Não foi possível carregar os atendimentos. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status] };
}

/** Lista somente o contexto revalidado pelo SQL; não reutiliza autorização anterior. */
export async function listarAtendimentos(u: Usuario, setor: SetorLeitura, opcoes?: OpcoesListaAtendimentos): Promise<ResultadoListaAtendimentos> {
  const opts = opcoesValidas(opcoes);
  if (!objeto(u) || !uuid(u.id) || !setorValido(setor) || !opts) return falha(400);
  if (!podeAcessar(u, setor)) return falha(403);
  try {
    const { data, error } = await db().rpc("listar_atendimentos", {
      p_ator: u.id.toLowerCase(), p_setor: setor, p_limite: opts.limite,
      p_antes_em: opts.antes?.criadoEm ?? null, p_antes_id: opts.antes?.id ?? null,
    });
    if (error || !objeto(data)) return falha(503);
    if (data.ok === false) return falha(data.codigo === "invalido" || data.codigo === "cursor_invalido" ? 400 : 503);
    if (data.ok !== true || data.setor !== setor || !natural(data.totalAtendimentos) || !natural(data.totalMensagens) ||
      !Array.isArray(data.atendimentos) || data.atendimentos.length > opts.limite || data.totalAtendimentos < data.atendimentos.length ||
      (data.totalAtendimentos === 0 && data.totalMensagens !== 0)) return falha(503);
    const atendimentos: AtendimentoLista[] = [];
    const ids = new Set<string>();
    const registros = new Set<string>();
    const previas = new Set<string>();
    let totalPagina = 0;
    for (const linha of data.atendimentos) {
      const a = atendimento(linha, setor);
      if (!a || ids.has(a.id) || registros.has(a.registroId) || (a.previa && previas.has(a.previa.id))) return falha(503);
      ids.add(a.id);
      registros.add(a.registroId);
      if (a.previa) previas.add(a.previa.id);
      totalPagina += a.totalMensagens;
      if (!natural(totalPagina) || data.totalMensagens < totalPagina) return falha(503);
      atendimentos.push(a);
    }
    const proximoCursor = data.proximoCursor === null ? null : cursor(data.proximoCursor);
    if (data.proximoCursor !== null) {
      const ultimo = atendimentos.at(-1);
      if (!proximoCursor || !ultimo || atendimentos.length !== opts.limite || data.totalAtendimentos <= atendimentos.length ||
        proximoCursor.id !== ultimo.id || proximoCursor.criadoEm !== ultimo.criadoEm) return falha(503);
    }
    if (opts.antes === null && proximoCursor === null &&
      (data.totalAtendimentos !== atendimentos.length || data.totalMensagens !== totalPagina)) return falha(503);
    return { ok: true, setor, totalAtendimentos: data.totalAtendimentos, totalMensagens: data.totalMensagens, atendimentos, proximoCursor };
  } catch {
    return falha(503);
  }
}
