"use server";

import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { registrarCotacao } from "@/modulos/pecas/cotacoes";
import { lerDadosCotacao } from "@/modulos/pecas/dados-cotacao";

export async function criarCotacao(form: FormData) {
  const u = await exigirAcesso("pecas");
  const dados = lerDadosCotacao(form);
  if (!dados) redirect("/painel/pecas?msg=invalida");
  const resultado = await registrarCotacao(u, dados);
  redirect(`/painel/pecas?msg=${resultado}`);
}
