"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { iniciarTriagem, registrarAtendimento } from "@/modulos/oficina/atendimentos";
import { lerDadosAtendimento, lerIdAtendimento } from "@/modulos/oficina/dados-atendimento";
import { hrefFilaOficina } from "@/modulos/oficina/filtros-fila";

export async function criarAtendimento(form: FormData) {
  const u = await exigirAcesso("oficina");
  const dados = lerDadosAtendimento(form);
  if (!dados) redirect(hrefFilaOficina({ minhas: form.get("minhas") === "1" }, "invalido"));
  const resultado = await registrarAtendimento(u, dados);
  if (resultado === "criado") revalidatePath("/painel/oficina");
  redirect(hrefFilaOficina({ minhas: form.get("minhas") === "1" }, resultado));
}

export async function assumirAtendimento(form: FormData) {
  const u = await exigirAcesso("oficina");
  const id = lerIdAtendimento(form);
  if (!id) redirect(hrefFilaOficina({ minhas: form.get("minhas") === "1" }, "indisponivel"));
  const resultado = await iniciarTriagem(u, id);
  if (resultado === "triagem") revalidatePath("/painel/oficina");
  redirect(hrefFilaOficina({ minhas: form.get("minhas") === "1" }, resultado));
}
