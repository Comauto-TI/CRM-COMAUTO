"use server";

import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { atualizarAcompanhamento, atualizarItem, encerrarCotacao, iniciarCotacao, marcarApresentada, marcarAprovada, marcarVendaConfirmada, reatribuirCotacao, registrarCotacao, registrarItem } from "@/modulos/pecas/cotacoes";
import { lerDadosAcompanhamento, lerDadosCotacao, lerDadosEdicaoItem, lerDadosEncerramento, lerDadosItem, lerIdCotacao, uuidV4Valido } from "@/modulos/pecas/dados-cotacao";

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

export async function editarItemCotacao(id: string, form: FormData) {
  const u = await exigirAcesso("pecas");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  const dados = lerDadosEdicaoItem(form);
  if (!dados) redirect(`/painel/pecas/${id}?msg=invalido`);

  const resultado = await atualizarItem(u, id, dados);
  if (resultado === "desatualizado" || resultado === "erro_edicao") {
    redirect(`/painel/pecas/${id}?msg=${resultado}&item=${dados.id}#item-cotacao`);
  }
  redirect(`/painel/pecas/${id}?msg=${resultado}`);
}

export async function registrarApresentacao(id: string, itens: Record<string, number>) {
  const u = await exigirAcesso("pecas");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  const resultado = await marcarApresentada(u, id, itens);
  redirect(`/painel/pecas/${id}?msg=${resultado}`);
}

export async function registrarAprovacao(id: string) {
  const u = await exigirAcesso("pecas");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  const resultado = await marcarAprovada(u, id);
  redirect(`/painel/pecas/${id}?msg=${resultado}`);
}

export async function confirmarVenda(id: string) {
  const u = await exigirAcesso("pecas");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  const resultado = await marcarVendaConfirmada(u, id);
  redirect(`/painel/pecas/${id}?msg=${resultado}`);
}

export async function registrarEncerramento(id: string, form: FormData) {
  const u = await exigirAcesso("pecas");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  const dados = lerDadosEncerramento(form);
  const resultado = dados ? await encerrarCotacao(u, id, dados) : "motivo_invalido";
  redirect(`/painel/pecas/${id}?msg=${resultado}`);
}

export async function salvarAcompanhamento(id: string, form: FormData) {
  const u = await exigirAcesso("pecas");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  const dados = lerDadosAcompanhamento(form);
  const resultado = dados ? await atualizarAcompanhamento(u, id, dados) : "acompanhamento_invalido";
  redirect(`/painel/pecas/${id}?msg=${resultado}#acompanhamento`);
}

export async function mudarResponsavel(id: string, form: FormData) {
  const u = await exigirAcesso("pecas");
  const responsavelId = form.get("responsavel");
  if (!uuidV4Valido(id)) redirect("/painel/pecas?msg=indisponivel");
  if (typeof responsavelId !== "string" || !uuidV4Valido(responsavelId)) {
    redirect(`/painel/pecas/${id}?msg=indisponivel`);
  }
  const resultado = await reatribuirCotacao(u, id, responsavelId);
  redirect(`/painel/pecas/${id}?msg=${resultado}`);
}
