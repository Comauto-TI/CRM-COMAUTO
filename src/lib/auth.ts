import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { authClient } from "@/lib/supabase/server";
import { db } from "@/lib/supabase/admin";
import { tabelaUsuarios } from "@/lib/usuarios";
import { podeAcessar, papelValido, setorValido, type Area, type Papel, type Setor } from "@/lib/permissoes";

export type { Papel, Setor, Area } from "@/lib/permissoes";
export type Usuario = {
  id: string;
  email: string;
  nome: string;
  papel: Papel;
  setor: Setor;
  unidade: string; // unidade principal
  unidades: string[]; // todas as unidades que pode ver (principal + extras)
};

/**
 * Autorização REAL do painel: sessão válida (verificada no Supabase) + usuário ativo na tabela de usuários.
 * cache(): layout e página da MESMA requisição compartilham uma só verificação (antes eram duas idas ao Supabase).
 */
export const usuarioAtual = cache(async function usuarioAtual(): Promise<Usuario | null> {
  const supa = await authClient();
  const { data } = await supa.auth.getUser();
  if (!data.user) return null;
  const tabela = await tabelaUsuarios();
  const { data: row } = await db().from(tabela).select("*").eq("user_id", data.user.id).maybeSingle();
  if (!row || !row.ativo || !papelValido(row.papel)) return null;

  const unidade: string = typeof row.unidade === "string" ? row.unidade : "comauto";
  let unidades = [unidade];
  if (tabela === "usuarios") {
    const { data: extras } = await db().from("usuario_unidades").select("unidade").eq("user_id", data.user.id);
    unidades = [...new Set([unidade, ...(extras ?? []).map((e) => e.unidade as string)])];
  }
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    nome: row.nome,
    papel: row.papel,
    setor: setorValido(row.setor) ? row.setor : "administracao",
    unidade,
    unidades,
  };
});

/** Use no topo de TODA página e server action do painel. Sem área = só exige login. */
export async function exigirAcesso(area?: Area): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (area && !podeAcessar(u, area)) redirect("/painel?erro=sem_permissao");
  return u;
}

/** Versão para rotas de API: devolve null em vez de redirecionar. */
export async function usuarioApi(area?: Area): Promise<Usuario | null> {
  const u = await usuarioAtual();
  if (!u) return null;
  if (area && !podeAcessar(u, area)) return null;
  return u;
}
