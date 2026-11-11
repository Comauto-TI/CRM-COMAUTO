"use server";

import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import {
  assumirAtendimentoPecas as assumir,
  devolverAtendimentoPecas as devolver,
  responderAtendimentoPecas as responder,
} from "@/modulos/pecas/atendimento";

export async function assumirAtendimentoPecas(cotacaoId: string, versao: number) {
  const usuario = await exigirAcesso("pecas");
  const resultado = await assumir(usuario, cotacaoId, versao);
  if (resultado.ok) revalidatePath("/painel/pecas");
  return resultado;
}

export async function devolverAtendimentoPecas(cotacaoId: string, versao: number) {
  const usuario = await exigirAcesso("pecas");
  const resultado = await devolver(usuario, cotacaoId, versao);
  if (resultado.ok) revalidatePath("/painel/pecas");
  return resultado;
}

export async function responderAtendimentoPecas(cotacaoId: string, versao: number, mensagemId: string, texto: string) {
  const usuario = await exigirAcesso("pecas");
  return responder(usuario, cotacaoId, versao, mensagemId, texto);
}
