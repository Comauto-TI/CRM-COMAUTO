import "server-only";
import { db } from "@/lib/supabase/admin";
import { nucleoAplicado } from "@/lib/usuarios";

/** Central de notificações (F0-4). Usada por todos os setores: lead novo, atendimento, aniversário, tarefa. */
export type TipoNotificacao = "atendimento" | "lead" | "pecas" | "aniversario" | "tarefa" | "alerta" | "sistema";
export type Notificacao = {
  id: string;
  tipo: TipoNotificacao;
  titulo: string;
  corpo: string | null;
  link: string | null;
  lida_em: string | null;
  criado_em: string;
};

/** Link só pode apontar para dentro do painel (evita redirecionamento para fora). */
export function linkInternoSeguro(link: string | null | undefined): string | null {
  if (!link) return null;
  return /^\/painel(\/|\?|$)/.test(link) && !link.startsWith("//") ? link : null;
}

export async function notificar(
  usuarioId: string,
  n: { tipo: TipoNotificacao; titulo: string; corpo?: string; link?: string; unidade?: string },
): Promise<boolean> {
  if (!(await nucleoAplicado())) return false;
  const { error } = await db().from("notificacoes").insert({
    usuario_id: usuarioId,
    unidade: n.unidade ?? "comauto",
    tipo: n.tipo,
    titulo: n.titulo.slice(0, 140),
    corpo: n.corpo?.slice(0, 500) ?? null,
    link: linkInternoSeguro(n.link),
  });
  return !error;
}

export async function contarNaoLidas(usuarioId: string): Promise<number> {
  if (!(await nucleoAplicado())) return 0;
  const { count } = await db()
    .from("notificacoes")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", usuarioId)
    .is("lida_em", null);
  return count ?? 0;
}

export async function listarNotificacoes(usuarioId: string, limite = 50): Promise<Notificacao[]> {
  if (!(await nucleoAplicado())) return [];
  const { data } = await db()
    .from("notificacoes")
    .select("id, tipo, titulo, corpo, link, lida_em, criado_em")
    .eq("usuario_id", usuarioId)
    .order("criado_em", { ascending: false })
    .limit(limite);
  return (data ?? []) as Notificacao[];
}

/** Marca como lida SÓ se for do próprio usuário (id sozinho não basta). */
export async function marcarLidas(usuarioId: string, ids?: string[]) {
  if (!(await nucleoAplicado())) return;
  let q = db().from("notificacoes").update({ lida_em: new Date().toISOString() }).eq("usuario_id", usuarioId).is("lida_em", null);
  if (ids?.length) q = q.in("id", ids);
  await q;
}
