"use server";

import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { iniciarCotacao, registrarCotacao, registrarItem } from "@/modulos/pecas/cotacoes";
import { lerDadosCotacao, lerDadosItem, lerIdCotacao, uuidV4Valido } from "@/modulos/pecas/dados-cotacao";

export async function criarCotacao(form: FormData) {
  const u = await exigirAcesso("pecas");
  const dados = lerDadosCotacao(form);
  if (!dados) redirect("/painel/pecas?msg=invalida");
  const resultado = await registrarCotacao(u, dados);
  redirect(`/painel/pecas?msg=${resultado}`);
}

export async function assumirCotacao(form: FormData) {
  const u = await exigirAcesso("pecas");
  const id = lerIdCotacao(form);
  if (!id) redirect("/painel/pecas?msg=indisponivel");
  const resultado = await iniciarCotacao(u, id);
  redirect(`/painel/pecas?msg=${resultado}`);
}

export async function adicionarItemCotacao(id: string, form: FormData) {
  const u = await exigirAcesso("pecas");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  const dados = lerDadosItem(form);
  const resultado = dados ? await registrarItem(u, id, dados) : "invalido";
  redirect(`/painel/pecas/${id}?msg=${resultado}`);
}
