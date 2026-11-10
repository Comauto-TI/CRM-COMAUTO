/**
 * F2-2 — vínculo manual do cartão com a proposta do Processo de Vendas e a avaliação do Avaliex.
 * Regras puras (testadas em tests/vinculos.test.ts).
 * Segurança: o link exibido no painel é SEMPRE montado aqui a partir do endereço oficial + ID codificado;
 * o texto colado pelo vendedor nunca vira href (evita link falso / javascript: no cartão).
 */

export const PROCESSO_VENDAS_BASE = "https://grupocomauto.com.br/processo-de-vendas/";
const HOSTS_PROCESSO_VENDAS = ["grupocomauto.com.br", "www.grupocomauto.com.br", "processo-vendas-phi.vercel.app"];
export const AVALIEX_BASE = "https://avaliex.onrender.com/";
const HOSTS_AVALIEX = ["avaliex.onrender.com"];

/** Estados oficiais da proposta no Processo de Vendas (mapa do Codex). */
export const SITUACOES_PROPOSTA = {
  rascunho: "Rascunho", com_operador: "Com operador", em_analise: "Em análise", devolvida: "Devolvida",
  aprovada: "Aprovada", faturado: "Faturado", entregue: "Entregue",
} as const;

const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const UNIDADE_VALIDA = /^[a-z0-9_]{2,30}$/;

type Erro = { ok: false; motivo: string };

function lerUrl(entrada: string): URL | null {
  try {
    const u = new URL(entrada);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Aceita o link da proposta (proposta.html?p=...) ou só o ID/número. */
export function lerVinculoProcessoVendas(entrada: string): { ok: true; id: string; empresa: string | null } | Erro {
  const t = (entrada ?? "").trim();
  if (!t) return { ok: false, motivo: "Cole o link ou o ID da proposta" };
  const url = lerUrl(t);
  if (url) {
    if (!HOSTS_PROCESSO_VENDAS.includes(url.hostname)) return { ok: false, motivo: "O link não é do Processo de Vendas" };
    const id = url.searchParams.get("p") ?? url.searchParams.get("proposta") ?? url.searchParams.get("proposta_id") ?? "";
    if (!ID_VALIDO.test(id)) return { ok: false, motivo: "Não encontrei o ID da proposta nesse link (abra a proposta e copie o endereço)" };
    const empresa = url.searchParams.get("empresa");
    return { ok: true, id, empresa: empresa && ID_VALIDO.test(empresa) ? empresa : null };
  }
  if (!ID_VALIDO.test(t)) return { ok: false, motivo: "ID da proposta inválido" };
  return { ok: true, id: t, empresa: null };
}

export function linkProcessoVendas(id: string, empresa?: string | null): string | null {
  if (!ID_VALIDO.test(id)) return null;
  const q = new URLSearchParams({ p: id });
  if (empresa && ID_VALIDO.test(empresa)) q.set("empresa", empresa);
  return `${PROCESSO_VENDAS_BASE}proposta.html?${q}`;
}

/** Aceita link do Avaliex (a unidade vem do caminho) ou só o ID da avaliação; placa opcional para conferência. */
export function lerVinculoAvaliex(
  entrada: string, unidadePadrao: string, placa?: string | null,
): { ok: true; id: string; unidade: string; placa: string | null } | Erro {
  const t = (entrada ?? "").trim();
  if (!t) return { ok: false, motivo: "Cole o link ou o ID da avaliação" };
  const placaNorm = placa ? placa.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const placaOk = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaNorm) ? placaNorm : null;
  if (placa && placa.trim() && !placaOk) return { ok: false, motivo: "Placa inválida" };

  const url = lerUrl(t);
  if (url) {
    if (!HOSTS_AVALIEX.includes(url.hostname)) return { ok: false, motivo: "O link não é do Avaliex" };
    const partes = url.pathname.split("/").filter(Boolean);
    const unidade = UNIDADE_VALIDA.test(partes[0] ?? "") ? partes[0] : unidadePadrao;
    const daQuery = url.searchParams.get("id") ?? url.searchParams.get("avaliacao") ?? url.searchParams.get("avaliacao_id");
    const doCaminho = [...partes].reverse().find((p) => ID_VALIDO.test(p) && /\d/.test(p) && p !== unidade);
    const id = daQuery ?? doCaminho ?? "";
    if (!ID_VALIDO.test(id)) return { ok: false, motivo: "Não encontrei o ID da avaliação nesse link — cole só o ID" };
    return { ok: true, id, unidade, placa: placaOk };
  }
  if (!ID_VALIDO.test(t)) return { ok: false, motivo: "ID da avaliação inválido" };
  return { ok: true, id: t, unidade: unidadePadrao, placa: placaOk };
}

/** Avaliex não tem endereço direto por avaliação: abre a unidade (o vendedor procura pelo ID/placa). */
export function linkAvaliex(unidade: string): string | null {
  return UNIDADE_VALIDA.test(unidade) ? `${AVALIEX_BASE}${unidade}/` : null;
}

export type VinculosExternos = {
  processo_vendas?: { id: string; empresa: string | null; vinculado_por: string; vinculado_em: string; situacao?: string | null };
  avaliex?: { id: string; unidade: string; placa: string | null; vinculado_por: string; vinculado_em: string };
};

/** Lê ids_externos do banco de forma tolerante (jsonb pode ter outras chaves, ex.: bravus). */
export function lerVinculos(ids: unknown): VinculosExternos {
  const o = (ids && typeof ids === "object" ? ids : {}) as Record<string, unknown>;
  const pv = o.processo_vendas as VinculosExternos["processo_vendas"] | undefined;
  const av = o.avaliex as VinculosExternos["avaliex"] | undefined;
  return {
    ...(pv && typeof pv.id === "string" && ID_VALIDO.test(pv.id) ? { processo_vendas: pv } : {}),
    ...(av && typeof av.id === "string" && ID_VALIDO.test(av.id) && UNIDADE_VALIDA.test(av.unidade ?? "") ? { avaliex: av } : {}),
  };
}
