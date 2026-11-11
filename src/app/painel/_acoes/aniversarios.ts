"use server";

import { revalidatePath } from "next/cache";
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
  await marcarContatoAniversario(u, String(f.get("cliente_id") ?? ""), await hoje());
  revalidatePath("/painel");
}

export async function lembrarAniversarioAction(f: FormData) {
  const u = await exigirAcesso("vendas");
  await ativarLembreteAniversario(u, String(f.get("cliente_id") ?? ""), await hoje());
  revalidatePath("/painel");
}
