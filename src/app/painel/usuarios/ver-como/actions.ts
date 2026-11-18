"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditar } from "@/lib/audit";
import { db } from "@/lib/supabase/admin";
import { tabelaUsuarios } from "@/lib/usuarios";
import { encerrarVisualizacao, iniciarVisualizacao, usuarioRealAtual } from "@/lib/auth";
import { papelValido, setorValido, type Papel, type Setor } from "@/lib/permissoes";

export type ResultadoVisualizacao = { ok: false; motivo: string } | null;

const campo = (f: FormData, nome: string) => typeof f.get(nome) === "string" ? String(f.get(nome)) : "";

export async function iniciarVerComoAction(_prev: ResultadoVisualizacao, formData: FormData): Promise<ResultadoVisualizacao> {
  const real = await usuarioRealAtual();
  if (!real || real.papel !== "admin") return { ok: false, motivo: "Só administradores podem visualizar outra função." };
  const papel = campo(formData, "papel");
  const setor = campo(formData, "setor");
  if (!papelValido(papel) || papel === "admin" || !setorValido(setor)) return { ok: false, motivo: "Função inválida." };
  const tabela = await tabelaUsuarios();
  if (tabela !== "usuarios") return { ok: false, motivo: "O núcleo de usuários ainda não está aplicado neste ambiente." };
  const { data: alvo } = await db().from(tabela).select("user_id, nome, papel, setor, ativo").eq("papel", papel).eq("setor", setor).eq("ativo", true).neq("user_id", real.id).order("nome").limit(1).maybeSingle();
  if (!alvo) return { ok: false, motivo: "Não existe usuário ativo dessa função e setor para abrir a tela." };
  await auditar(real.email, "ver_como_inicio", "usuarios", alvo.user_id, { papel: papel as Papel, setor: setor as Setor, somente_leitura: true });
  await iniciarVisualizacao(alvo.user_id as string);
  redirect("/painel");
}

export async function encerrarVerComoAction() {
  const real = await usuarioRealAtual();
  if (!real || real.papel !== "admin") redirect("/login");
  await auditar(real.email, "ver_como_fim", "usuarios", real.id, { somente_leitura: true });
  await encerrarVisualizacao();
  revalidatePath("/painel");
  redirect("/painel/usuarios/ver-como");
}
