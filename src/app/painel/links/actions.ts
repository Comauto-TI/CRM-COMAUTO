"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { gerarCodigo, CANAIS } from "@/lib/links";
import { verificarEntrada } from "@/lib/security/guard";
import { noEscopo, setorParaGravar } from "@/lib/escopo-setor";

export async function criarLink(formData: FormData) {
  const u = await exigirAcesso("links");
  const nome = String(formData.get("nome") ?? "").trim().slice(0, 80);
  const canal = String(formData.get("canal") ?? "outro");
  const mensagem = String(formData.get("mensagem") ?? "").trim().slice(0, 300);
  if (!nome || !mensagem) redirect("/painel/links?msg=incompleto");
  if (!CANAIS.some((c) => c.valor === canal)) redirect("/painel/links?msg=incompleto");
  // A mensagem pronta vai chegar ao próprio bot: não pode ser algo que a barreira de segurança recusaria
  if (verificarEntrada(mensagem).bloqueado) redirect("/painel/links?msg=mensagem_bloqueada");

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigo();
    const { data, error } = await db()
      .from("links_rastreados")
      .insert({ codigo, nome, canal, mensagem_inicial: mensagem, criado_por: u.email, setor: setorParaGravar(u, formData.get("setor")) })
      .select("id")
      .single();
    if (!error && data) {
      await auditar(u.email, "criar_link", "links_rastreados", data.id, { codigo, canal });
      redirect(`/painel/links?novo=${data.id}`);
    }
    if (error && error.code !== "23505") break; // 23505 = código repetido, tenta outro
  }
  redirect("/painel/links?msg=erro");
}

export async function alternarLink(formData: FormData) {
  const u = await exigirAcesso("links");
  const id = String(formData.get("id"));
  const ativo = formData.get("ativo") === "1";
  // marketing por setor: só mexe em link do próprio setor (admin em todos)
  const { data: link } = await db().from("links_rastreados").select("setor").eq("id", id).maybeSingle();
  if (!link || !noEscopo(u, link.setor as string)) redirect("/painel/links?msg=fora_do_setor");
  await db().from("links_rastreados").update({ ativo }).eq("id", id);
  await auditar(u.email, ativo ? "ativar_link" : "desativar_link", "links_rastreados", id);
  revalidatePath("/painel/links");
}
