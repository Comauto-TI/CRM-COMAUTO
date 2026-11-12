"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { criarConvite, revogarConvite } from "@/lib/convites";

export type ResultadoConvite = { ok: true; link: string } | { ok: false; motivo: string } | null;

const campo = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

export async function criarConviteAction(_prev: ResultadoConvite, f: FormData): Promise<ResultadoConvite> {
  const u = await exigirAcesso("configuracoes");
  const r = await criarConvite(u, campo(f, "tipo"), campo(f, "unidade"), Number(campo(f, "dias")), Number(campo(f, "usos")));
  if (!r.ok) return r;
  // link montado pelo endereço oficial (APP_URL) ou pelo endereço que o admin está usando
  const h = await headers();
  const base = process.env.APP_URL?.replace(/\/+$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  revalidatePath("/painel/usuarios");
  return { ok: true, link: `${base}/cadastro/${r.token}` };
}

export async function revogarConviteAction(f: FormData) {
  const u = await exigirAcesso("configuracoes");
  await revogarConvite(u, campo(f, "id"));
  revalidatePath("/painel/usuarios");
}
