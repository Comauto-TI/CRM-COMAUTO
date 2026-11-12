import { cursor, type CursorMensagens } from "@/modulos/atendimento/contrato-leitura";
import type { FiltrosFilaOficina } from "./atendimentos";

type ParametrosFila = { minhas?: unknown; antes?: unknown; antes_id?: unknown };

export function lerFiltrosFila(p: ParametrosFila): FiltrosFilaOficina | null {
  if (p.minhas !== undefined && p.minhas !== "0" && p.minhas !== "1") return null;
  const minhas = p.minhas === "1";
  if (p.antes === undefined && p.antes_id === undefined) return { minhas, limite: 50, antes: null };
  const antes = cursor({ criadoEm: p.antes, id: p.antes_id });
  return antes ? { minhas, limite: 50, antes } : null;
}

export function hrefFilaOficina(filtros: { minhas?: boolean; antes?: CursorMensagens | null }, msg?: string): string {
  const p = new URLSearchParams();
  if (filtros.minhas === true) p.set("minhas", "1");
  const antes = cursor(filtros.antes);
  if (antes) {
    p.set("antes", antes.criadoEm);
    p.set("antes_id", antes.id);
  }
  if (msg !== undefined) p.set("msg", msg);
  const query = p.toString();
  return `/painel/oficina${query ? `?${query}` : ""}`;
}
