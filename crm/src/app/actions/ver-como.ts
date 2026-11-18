"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { getAcesso } from "@/lib/acesso";
import { inicioDaFuncao } from "@/lib/funcoes";
import { gravarSessao } from "@/lib/session";

export async function iniciarVerComo(formData: FormData) {
  const { usuario } = await getAcesso();
  if (usuario.funcao !== "admin") throw new Error("Apenas administradores.");

  const alvoId = Number(formData.get("usuarioId"));
  const db = await getDb();
  const [alvo] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, alvoId));
  if (!alvo || !alvo.ativo || alvo.funcao === "admin") {
    throw new Error("Usuário inválido para \"Ver como\".");
  }

  await db.insert(schema.auditoria).values({
    usuarioId: usuario.id,
    acao: "ver_como_inicio",
    alvoUsuarioId: alvo.id,
  });
  await gravarSessao({ usuarioId: usuario.id, verComoUsuarioId: alvo.id });
  redirect(inicioDaFuncao(alvo.funcao));
}

export async function encerrarVerComo() {
  // Usa o usuário real (não a visão), então funciona mesmo dentro do "Ver como".
  const { usuario, visao, somenteLeitura } = await getAcesso();
  if (usuario.funcao !== "admin") redirect("/");

  if (somenteLeitura) {
    const db = await getDb();
    await db.insert(schema.auditoria).values({
      usuarioId: usuario.id,
      acao: "ver_como_fim",
      alvoUsuarioId: visao.id,
    });
  }
  await gravarSessao({ usuarioId: usuario.id });
  redirect("/admin/ver-como");
}
