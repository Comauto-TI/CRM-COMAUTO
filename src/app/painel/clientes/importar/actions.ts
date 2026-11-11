"use server";

import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { previaImportacao, importarClientes, type ResultadoPrevia, type ResultadoImportacao } from "@/modulos/importacao/dados";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prévia contra o banco: quantos são novos e quantos já têm ficha (não grava nada). */
export async function previa(clientes: unknown): Promise<({ ok: true } & ResultadoPrevia) | { ok: false; motivo: string }> {
  await exigirAcesso("importacao");
  try {
    return { ok: true, ...(await previaImportacao(clientes)) };
  } catch {
    return { ok: false, motivo: "Não foi possível conferir a base agora. Tente de novo." };
  }
}

export async function importar(clientes: unknown, vendedorId: unknown, completar: unknown): Promise<ResultadoImportacao> {
  const u = await exigirAcesso("importacao");
  try {
    const r = await importarClientes(u, clientes, {
      vendedorId: typeof vendedorId === "string" && UUID.test(vendedorId) ? vendedorId : null,
      completar: completar === true,
    });
    revalidatePath("/painel/clientes");
    return r;
  } catch {
    return { ok: false, motivo: "A importação foi interrompida. Rode de novo: quem já entrou não é duplicado." };
  }
}
