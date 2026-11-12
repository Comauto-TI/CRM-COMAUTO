"use server";

import { redirect } from "next/navigation";
import { cadastrarPeloConvite } from "@/lib/convites";

const campo = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

export async function cadastrarAction(f: FormData) {
  const token = campo(f, "token");
  const r = await cadastrarPeloConvite(token, { nome: campo(f, "nome"), email: campo(f, "email"), senha: campo(f, "senha"), confirmar: campo(f, "confirmar") });
  const base = `/cadastro/${encodeURIComponent(token)}`;
  // senha nunca vai para a URL
  redirect(r.ok ? `${base}?ok=1` : `${base}?erro=${encodeURIComponent(r.motivo)}`);
}
