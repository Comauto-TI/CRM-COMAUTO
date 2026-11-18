"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb, schema } from "@/db";
import { inicioDaFuncao } from "@/lib/funcoes";
import { apagarSessao, gravarSessao } from "@/lib/session";

const LoginSchema = z.object({
  email: z.email({ error: "Informe um e-mail válido." }).trim().toLowerCase(),
  senha: z.string().min(1, { error: "Informe a senha." }),
});

export type EstadoLogin = { erro?: string } | undefined;

export async function entrar(_: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const dados = LoginSchema.safeParse({
    email: formData.get("email"),
    senha: formData.get("senha"),
  });
  if (!dados.success) return { erro: dados.error.issues[0].message };

  const db = await getDb();
  const [usuario] = await db
    .select()
    .from(schema.usuarios)
    .where(eq(schema.usuarios.email, dados.data.email));

  const senhaOk = usuario?.ativo && (await bcrypt.compare(dados.data.senha, usuario.senhaHash));
  if (!usuario || !senhaOk) return { erro: "E-mail ou senha incorretos." };

  await gravarSessao({ usuarioId: usuario.id });
  redirect(inicioDaFuncao(usuario.funcao));
}

export async function sair() {
  await apagarSessao();
  redirect("/login");
}
