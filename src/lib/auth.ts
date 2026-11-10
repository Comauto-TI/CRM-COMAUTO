import "server-only";
import { redirect } from "next/navigation";
import { authClient } from "@/lib/supabase/server";
import { db } from "@/lib/supabase/admin";

export type Papel = "admin" | "atendente" | "financeiro";
export type Usuario = { id: string; email: string; nome: string; papel: Papel };

/** Autorização REAL do painel: sessão válida (verificada no Supabase) + usuário ativo em admin_usuarios. */
export async function usuarioAtual(): Promise<Usuario | null> {
  const supa = await authClient();
  const { data } = await supa.auth.getUser();
  if (!data.user) return null;
  const { data: adm } = await db()
    .from("admin_usuarios")
    .select("nome, papel, ativo")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!adm || !adm.ativo) return null;
  return { id: data.user.id, email: data.user.email ?? "", nome: adm.nome, papel: adm.papel as Papel };
}

/** Use no topo de TODA página e server action do painel. Admin passa em tudo. */
export async function exigirPapel(papeis?: Papel[]): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (papeis && u.papel !== "admin" && !papeis.includes(u.papel)) redirect("/painel?erro=sem_permissao");
  return u;
}

/** Versão para rotas de API: devolve null em vez de redirecionar. */
export async function usuarioApi(papeis?: Papel[]): Promise<Usuario | null> {
  const u = await usuarioAtual();
  if (!u) return null;
  if (papeis && u.papel !== "admin" && !papeis.includes(u.papel)) return null;
  return u;
}
