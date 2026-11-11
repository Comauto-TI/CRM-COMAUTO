import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { mascararDadosSensiveis } from "@/lib/security/guard";
import { objeto, uuid, instante } from "@/modulos/atendimento/contrato-leitura";
import { ETAPAS_ABERTAS, ETAPAS_ENCERRADAS } from "./dados-cotacao";

export type CotacaoQuadroPecas = {
  id: string; unidade: string; origem: "balcao" | "oficina" | "whatsapp"; descricao: string;
  status: string; posicao: number; criadoEm: string; atualizadoEm: string; entrouEm: string;
  ultimoContatoEm: string | null; clienteNome: string | null; responsavelNome: string | null;
  responsavelId: string | null; valorCentavos: number | null; podeMover: boolean;
  itensVersoes: Record<string, number>;
};
const etapas = [...ETAPAS_ABERTAS, ...ETAPAS_ENCERRADAS];
const texto = (v: string) => mascararDadosSensiveis(v).texto;
const textoOpcional = (v: unknown): v is string | null => v === null || typeof v === "string";
function versoes(v: unknown): v is Record<string, number> {
  return objeto(v) && Object.keys(v).length <= 100 && Object.entries(v).every(([id, n]) =>
    uuid(id) && typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 2147483647);
}
function cartao(v: unknown): CotacaoQuadroPecas | null {
  if (!objeto(v) || !uuid(v.id) || typeof v.unidade !== "string" || typeof v.descricao !== "string" ||
    !["balcao", "oficina", "whatsapp"].includes(v.origem as string) || !etapas.includes(v.status as string) ||
    typeof v.posicao !== "number" || !Number.isFinite(v.posicao) || Math.abs(v.posicao) > 1e9 ||
    !instante(v.criadoEm) || !instante(v.atualizadoEm) || !instante(v.entrouEm) ||
    !(v.ultimoContatoEm === null || instante(v.ultimoContatoEm)) ||
    !textoOpcional(v.clienteNome) || !textoOpcional(v.responsavelNome) ||
    !(v.responsavelId === null || uuid(v.responsavelId)) ||
    !(v.valorCentavos === null || (typeof v.valorCentavos === "number" && Number.isSafeInteger(v.valorCentavos) && v.valorCentavos >= 0)) ||
    typeof v.podeMover !== "boolean" || !versoes(v.itensVersoes)) return null;
  return {
    id: v.id.toLowerCase(), unidade: v.unidade, origem: v.origem as CotacaoQuadroPecas["origem"], descricao: texto(v.descricao),
    status: v.status as string, posicao: v.posicao, criadoEm: v.criadoEm, atualizadoEm: v.atualizadoEm,
    entrouEm: v.entrouEm, ultimoContatoEm: v.ultimoContatoEm as string | null,
    clienteNome: v.clienteNome === null ? null : texto(v.clienteNome),
    responsavelNome: v.responsavelNome === null ? null : texto(v.responsavelNome),
    responsavelId: v.responsavelId === null ? null : (v.responsavelId as string).toLowerCase(), valorCentavos: v.valorCentavos as number | null,
    podeMover: v.podeMover, itensVersoes: v.itensVersoes,
  };
}

export async function obterQuadroPecas(u: Usuario): Promise<
  { ok: true; cotacoes: CotacaoQuadroPecas[]; total: number; temMais: boolean } | { ok: false; pendente: boolean }
> {
  if (!objeto(u) || !uuid(u.id) || !podeAcessar(u, "pecas")) return { ok: false, pendente: false };
  try {
    const { data, error } = await db().rpc("pecas_quadro", { p_ator: u.id });
    if (error) return { ok: false, pendente: ["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code) };
    if (!objeto(data) || data.ok !== true || !Array.isArray(data.cotacoes) ||
      data.total !== data.cotacoes.length || data.temMais !== false) return { ok: false, pendente: false };
    const cotacoes: CotacaoQuadroPecas[] = []; const ids = new Set<string>();
    for (const linha of data.cotacoes) {
      const c = cartao(linha);
      if (!c || ids.has(c.id)) return { ok: false, pendente: false };
      ids.add(c.id); cotacoes.push(c);
    }
    return { ok: true, cotacoes, total: cotacoes.length, temMais: false };
  } catch { return { ok: false, pendente: false }; }
}

const motivos: Record<string, string> = {
  desatualizada: "Esta cotação mudou. Atualize o quadro antes de mover novamente.",
  sem_itens: "Inclua os itens na cotação antes de registrar a apresentação.",
  devolva_conversa: "Devolva a conversa ao bot antes de encerrar a cotação.",
  transicao: "Esta mudança de etapa exige uma ação no detalhe da cotação.",
  invalido: "Confira os dados da movimentação.",
};
export async function moverNoQuadroPecas(u: Usuario, id: string, destino: string, posicao: number,
  statusEsperado: string, itensVersoes: Record<string, number>, motivo?: string,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const indisponivel = { ok: false as const, motivo: "Não foi possível mover esta cotação. Atualize o quadro e confira sua permissão." };
  if (!objeto(u) || !uuid(u.id) || !podeAcessar(u, "pecas") || !uuid(id) || !etapas.includes(destino) || !etapas.includes(statusEsperado) ||
    !Number.isFinite(posicao) || Math.abs(posicao) > 1e9 || !versoes(itensVersoes) ||
    (motivo !== undefined && (typeof motivo !== "string" || motivo.trim().length > 500))) return indisponivel;
  try {
    const { data, error } = await db().rpc("pecas_mover_quadro", {
      p_id: id, p_ator: u.id, p_destino: destino, p_posicao: posicao,
      p_status_esperado: statusEsperado, p_itens: itensVersoes, p_motivo: motivo?.trim() ?? null,
    });
    if (error || !objeto(data)) return indisponivel;
    if (data.ok === true) return { ok: true };
    return { ok: false, motivo: typeof data.codigo === "string" && Object.hasOwn(motivos, data.codigo) ? motivos[data.codigo] : indisponivel.motivo };
  } catch { return indisponivel; }
}
