"use server";

import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { moverNoQuadroPecas } from "@/modulos/pecas/quadro";

export async function moverCotacaoQuadro(id: string, destino: string, posicao: number,
  statusEsperado: string, itensVersoes: Record<string, number>, motivo?: string,
) {
  const u = await exigirAcesso("pecas");
  const r = await moverNoQuadroPecas(u, id, destino, posicao, statusEsperado, itensVersoes, motivo);
  if (r.ok) revalidatePath("/painel/pecas");
  return r;
}
