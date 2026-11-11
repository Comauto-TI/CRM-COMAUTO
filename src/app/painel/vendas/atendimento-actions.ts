"use server";

import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import {
  assumirAtendimentoVendas as assumir,
  devolverAtendimentoVendas as devolver,
  responderAtendimentoVendas as responder,
} from "@/modulos/vendas/atendimento";

export async function assumirAtendimentoVendas(oportunidadeId: string, versao: number) {
  const usuario = await exigirAcesso("vendas");
  const resultado = await assumir(usuario, oportunidadeId, versao);
  if (resultado.ok) revalidatePath("/painel/vendas");
  return resultado;
}

export async function devolverAtendimentoVendas(oportunidadeId: string, versao: number) {
  const usuario = await exigirAcesso("vendas");
  const resultado = await devolver(usuario, oportunidadeId, versao);
  if (resultado.ok) revalidatePath("/painel/vendas");
  return resultado;
}

export async function responderAtendimentoVendas(oportunidadeId: string, versao: number, mensagemId: string, texto: string) {
  const usuario = await exigirAcesso("vendas");
  return responder(usuario, oportunidadeId, versao, mensagemId, texto);
}
