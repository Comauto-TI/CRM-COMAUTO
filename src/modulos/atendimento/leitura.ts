import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { mascararDadosSensiveis } from "@/lib/security/guard";
import { db } from "@/lib/supabase/admin";

type SetorLeitura = "pecas" | "vendas";
type StatusMensagem = "recebida" | "enviada" | "entregue" | "lida" | "falhou" | "bloqueada";
export type CursorMensagens = { criadoEm: string; id: string };
export type OpcoesLeituraAtendimento = { limite?: number; antes?: CursorMensagens | null };
export type MensagemAtendimento = {
  id: string; conteudo: string | null; tipo: string; criadoEm: string; status: StatusMensagem;
  direcao: "entrada"; autor: "cliente";
};
export type ResultadoLeituraAtendimento =
  | { ok: true; atendimentoId: string; setor: SetorLeitura; total: number; revisaoPendente: boolean; mensagens: MensagemAtendimento[]; proximoCursor: CursorMensagens | null }
  | { ok: false; status: 400 | 403 | 404 | 503; motivo: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const ESTADOS: readonly unknown[] = ["recebida", "enviada", "entregue", "lida", "falhou", "bloqueada"];
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID.test(v);
const setorValido = (v: unknown): v is SetorLeitura => v === "pecas" || v === "vendas";
const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Valida calendário e fuso sem reescrever nem reduzir a precisão da string. */
function instante(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO.exec(v);
  if (!m || m[0] !== v) return false;
  const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const dias = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1 || dia > dias[mes - 1] ||
    Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59 ||
    (m[8] !== "Z" && (Number(m[10]) > 15 || Number(m[11]) > 59))) return false;
  // Date só verifica finitude; não participa de comparação, ordenação ou serialização.
  return Number.isFinite(Date.parse(v));
}

function cursor(v: unknown): CursorMensagens | null {
  return objeto(v) && instante(v.criadoEm) && uuid(v.id) ? { criadoEm: v.criadoEm, id: v.id.toLowerCase() } : null;
}

function opcoesValidas(v: unknown): { limite: number; antes: CursorMensagens | null } | null {
  if (v === undefined) return { limite: 50, antes: null };
  if (!objeto(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) return null;
  const limite = v.limite === undefined ? 50 : v.limite;
  if (!natural(limite) || limite < 1 || limite > 100) return null;
  const antes = v.antes === undefined || v.antes === null ? null : cursor(v.antes);
  if (v.antes !== undefined && v.antes !== null && !antes) return null;
  return { limite, antes };
}

function mensagem(v: unknown): MensagemAtendimento | null {
  if (!objeto(v) || !uuid(v.id) || (v.conteudo !== null && typeof v.conteudo !== "string") ||
    typeof v.tipo !== "string" || !instante(v.criadoEm) || !ESTADOS.includes(v.status) || v.direcao !== "entrada" || v.autor !== "cliente") return null;
  return {
    id: v.id.toLowerCase(), conteudo: v.conteudo === null ? null : mascararDadosSensiveis(v.conteudo).texto,
    tipo: v.tipo, criadoEm: v.criadoEm, status: v.status as StatusMensagem, direcao: "entrada", autor: "cliente",
  };
}

function falha(status: 400 | 403 | 404 | 503): ResultadoLeituraAtendimento {
  const motivos = {
    400: "Dados de leitura de mensagens inválidos.",
    403: "Seu perfil não tem acesso ao atendimento desse setor.",
    404: "Atendimento não encontrado ou fora do seu acesso.",
    503: "Não foi possível carregar as mensagens. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status] };
}

/** Autoriza e lê na mesma transação; uma autorização anterior não é reutilizada. */
export async function lerMensagensAtendimento(u: Usuario, atendimentoId: string, setor: SetorLeitura, opcoes?: OpcoesLeituraAtendimento): Promise<ResultadoLeituraAtendimento> {
  const opts = opcoesValidas(opcoes);
  if (!objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !setorValido(setor) || !opts) return falha(400);
  if (!podeAcessar(u, setor)) return falha(403);
  const id = atendimentoId.toLowerCase();
  try {
    const { data, error } = await db().rpc("ler_mensagens_atendimento", {
      p_atendimento_id: id, p_ator: u.id.toLowerCase(), p_setor: setor, p_limite: opts.limite,
      p_antes_em: opts.antes?.criadoEm ?? null, p_antes_id: opts.antes?.id ?? null,
    });
    if (error || !objeto(data)) return falha(503);
    if (data.ok === false) {
      if (data.codigo === "invalido" || data.codigo === "cursor_invalido") return falha(400);
      if (data.codigo === "nao_encontrado") return falha(404);
      return falha(503);
    }
    if (data.ok !== true || !uuid(data.atendimentoId) || data.atendimentoId.toLowerCase() !== id || data.setor !== setor ||
      !natural(data.total) || typeof data.revisaoPendente !== "boolean" || !Array.isArray(data.mensagens) ||
      data.mensagens.length > opts.limite || data.total < data.mensagens.length) return falha(503);
    const mensagens: MensagemAtendimento[] = [];
    const ids = new Set<string>();
    for (const linha of data.mensagens) {
      const m = mensagem(linha);
      if (!m || ids.has(m.id)) return falha(503);
      ids.add(m.id);
      mensagens.push(m);
    }
    const proximoCursor = data.proximoCursor === null ? null : cursor(data.proximoCursor);
    if (data.proximoCursor !== null) {
      const ultima = mensagens.at(-1);
      if (!proximoCursor || !ultima || mensagens.length !== opts.limite || data.total <= mensagens.length ||
        proximoCursor.id !== ultima.id || proximoCursor.criadoEm !== ultima.criadoEm) return falha(503);
    }
    return { ok: true, atendimentoId: id, setor, total: data.total, revisaoPendente: data.revisaoPendente, mensagens, proximoCursor };
  } catch {
    return falha(503);
  }
}
