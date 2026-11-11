import "server-only";
import { mascararDadosSensiveis } from "@/lib/security/guard";

export type SetorLeitura = "pecas" | "vendas";
type StatusMensagem = "recebida" | "enviada" | "entregue" | "lida" | "falhou" | "bloqueada";
export type CursorMensagens = { criadoEm: string; id: string };
export type OpcoesLeituraAtendimento = { limite?: number; antes?: CursorMensagens | null };
export type MensagemAtendimento = {
  id: string; conteudo: string | null; tipo: string; criadoEm: string; status: StatusMensagem;
  direcao: "entrada"; autor: "cliente";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const ESTADOS: readonly unknown[] = ["recebida", "enviada", "entregue", "lida", "falhou", "bloqueada"];
export const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID.test(v);
export const setorValido = (v: unknown): v is SetorLeitura => v === "pecas" || v === "vendas";
export const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Valida calendário e fuso sem reescrever nem reduzir a precisão da string. */
export function instante(v: unknown): v is string {
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

export function cursor(v: unknown): CursorMensagens | null {
  return objeto(v) && instante(v.criadoEm) && uuid(v.id) ? { criadoEm: v.criadoEm, id: v.id.toLowerCase() } : null;
}

export function opcoesValidas(v: unknown): { limite: number; antes: CursorMensagens | null } | null {
  if (v === undefined) return { limite: 50, antes: null };
  if (!objeto(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) return null;
  const limite = v.limite === undefined ? 50 : v.limite;
  if (!natural(limite) || limite < 1 || limite > 100) return null;
  const antes = v.antes === undefined || v.antes === null ? null : cursor(v.antes);
  if (v.antes !== undefined && v.antes !== null && !antes) return null;
  return { limite, antes };
}

export function mensagem(v: unknown): MensagemAtendimento | null {
  if (!objeto(v) || !uuid(v.id) || (v.conteudo !== null && typeof v.conteudo !== "string") ||
    typeof v.tipo !== "string" || !instante(v.criadoEm) || !ESTADOS.includes(v.status) || v.direcao !== "entrada" || v.autor !== "cliente") return null;
  return {
    id: v.id.toLowerCase(), conteudo: v.conteudo === null ? null : mascararDadosSensiveis(v.conteudo).texto,
    tipo: v.tipo, criadoEm: v.criadoEm, status: v.status as StatusMensagem, direcao: "entrada", autor: "cliente",
  };
}
