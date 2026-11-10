"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { localParaUtc } from "@/lib/time";
import { auditar } from "@/lib/audit";
import { preChecagem, enfileirar } from "@/lib/campaigns";

export async function criarEvento(formData: FormData) {
  const u = await exigirAcesso("campanhas");
  const cfg = await getConfig();
  const inicio = localParaUtc(String(formData.get("data")), String(formData.get("hora")), cfg.fuso_offset);
  const vagas = Number(formData.get("vagas")) || null;
  const { data } = await db()
    .from("eventos")
    .insert({
      nome: String(formData.get("nome")).slice(0, 120),
      descricao: String(formData.get("descricao") || "") || null,
      local: String(formData.get("local")).slice(0, 200),
      inicio: inicio.toISOString(),
      vagas,
      status: "ativo",
    })
    .select("id")
    .single();
  await auditar(u.email, "criar_evento", "evento", data?.id ?? null);
  revalidatePath("/painel/campanhas");
}

export async function criarCampanha(formData: FormData) {
  const u = await exigirAcesso("campanhas");
  const tags = String(formData.get("tags") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const cidade = String(formData.get("cidade") || "").trim();
  const eventoId = String(formData.get("evento") || "") || null;
  const { data, error } = await db()
    .from("campanhas")
    .insert({
      nome: String(formData.get("nome")).slice(0, 120),
      tipo: eventoId ? "evento" : "marketing",
      evento_id: eventoId,
      template_id: String(formData.get("template")),
      filtros: { ...(tags.length ? { tags } : {}), ...(cidade ? { cidade } : {}) },
      lote_tamanho: Math.min(500, Math.max(1, Number(formData.get("lote")) || 50)),
      limite_diario: Math.max(1, Number(formData.get("limite")) || 250),
      criado_por: u.email,
    })
    .select("id")
    .single();
  if (error || !data) redirect("/painel/campanhas?msg=erro");
  await preChecagem(data.id);
  await auditar(u.email, "criar_campanha", "campanha", data.id);
  redirect(`/painel/campanhas?ver=${data.id}`);
}

export async function rodarPreChecagem(formData: FormData) {
  await exigirAcesso("campanhas");
  const id = String(formData.get("id"));
  await preChecagem(id);
  redirect(`/painel/campanhas?ver=${id}`);
}

export async function iniciarTeste(formData: FormData) {
  const u = await exigirAcesso("campanhas");
  const id = String(formData.get("id"));
  const r = await enfileirar(id, true, u.email);
  redirect(`/painel/campanhas?ver=${id}&msg=${r.ok ? "teste_ok" : r.motivo}`);
}

export async function iniciarEnvio(formData: FormData) {
  const u = await exigirAcesso("campanhas");
  const id = String(formData.get("id"));
  if (formData.get("confirmo") !== "on") redirect(`/painel/campanhas?ver=${id}&msg=confirme`);
  const r = await enfileirar(id, false, u.email);
  redirect(`/painel/campanhas?ver=${id}&msg=${r.ok ? "envio_ok" : r.motivo}`);
}

export async function pausar(formData: FormData) {
  const u = await exigirAcesso("campanhas");
  const id = String(formData.get("id"));
  await db().from("campanhas").update({ status: "pausada", motivo_pausa: `Pausada manualmente por ${u.email}` }).eq("id", id);
  await auditar(u.email, "pausar_campanha", "campanha", id);
  revalidatePath("/painel/campanhas");
}

export async function retomar(formData: FormData) {
  const u = await exigirAcesso("campanhas");
  const id = String(formData.get("id"));
  await db().from("campanhas").update({ status: "enviando", motivo_pausa: null }).eq("id", id).eq("status", "pausada");
  await auditar(u.email, "retomar_campanha", "campanha", id);
  revalidatePath("/painel/campanhas");
}
