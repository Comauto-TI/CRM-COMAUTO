"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { dataLocalISO } from "@/lib/time";
import { marcarContatoAniversario, ativarLembreteAniversario } from "@/modulos/vendas/aniversarios-dados";

async function hoje() {
  const cfg = await getConfig();
  return dataLocalISO(new Date(), cfg.fuso_offset);
}

export async function contatoAniversarioAction(f: FormData) {
  const u = await exigirAcesso("vendas");
  const entradaData = f.get("data_aniversario");
  if (entradaData !== null && typeof entradaData !== "string") {
    redirect(`/painel?erro_aniversario=${encodeURIComponent("Data de aniversário inválida.")}`);
  }
  let r;
  try {
    r = await marcarContatoAniversario(u, String(f.get("cliente_id") ?? ""), await hoje(), entradaData?.trim() || undefined);
  } catch {
    redirect(`/painel?erro_aniversario=${encodeURIComponent("Não foi possível registrar o contato. Tente novamente.")}`);
  }
  if (!r.ok) redirect(`/painel?erro_aniversario=${encodeURIComponent(r.motivo || "Não foi possível registrar o contato. Tente novamente.")}`);
  revalidatePath("/painel");
}

export async function lembrarAniversarioAction(f: FormData) {
  const u = await exigirAcesso("vendas");
  let r;
  try {
    r = await ativarLembreteAniversario(u, String(f.get("cliente_id") ?? ""), await hoje());
  } catch {
    redirect(`/painel?erro_aniversario=${encodeURIComponent("Não foi possível ativar o lembrete. Tente novamente.")}`);
  }
  if (!r.ok) redirect(`/painel?erro_aniversario=${encodeURIComponent(r.motivo || "Não foi possível ativar o lembrete. Tente novamente.")}`);
  revalidatePath("/painel");
}
