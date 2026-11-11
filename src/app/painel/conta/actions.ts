"use server";

import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { trocarMinhaSenha } from "@/lib/conta";

const campo = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

export async function trocarSenhaAction(f: FormData) {
  const u = await exigirAcesso();
  const r = await trocarMinhaSenha(u, campo(f, "atual"), campo(f, "nova"), campo(f, "confirmar"));
  // a senha nunca vai para a URL; só o resultado
  redirect(r.ok ? "/painel/conta?ok=1" : `/painel/conta?erro=${encodeURIComponent(r.motivo)}`);
}
