import "server-only";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import type { Usuario } from "@/lib/auth";

/**
 * "Minha conta" — a própria pessoa troca a senha.
 * Regra leve (pedido do Simão): mínimo de 6 caracteres, sem exigir maiúscula/símbolo.
 * Login COMPARTILHADO: o banco de dev usa o mesmo Auth do processo-vendas-teste. Trocar aqui mudaria a senha
 * lá também, então só troca quem foi CRIADO pela plataforma; conta vinculada de outro sistema é recusada com
 * explicação. No banco oficial da plataforma (projeto próprio) os logins já são independentes.
 */
const ORIGEM = "plataforma-comauto";
export const SENHA_MINIMA = 6;

export type ResultadoConta = { ok: true; mensagem: string } | { ok: false; motivo: string };

export function validarNovaSenha(atual: string, nova: string, confirmar: string): string | null {
  if (!atual) return "Informe a senha atual";
  if (nova.length < SENHA_MINIMA) return `A nova senha precisa ter pelo menos ${SENHA_MINIMA} caracteres`;
  if (nova.length > 72) return "A nova senha pode ter no máximo 72 caracteres";
  if (nova !== confirmar) return "A confirmação não é igual à nova senha";
  if (nova === atual) return "A nova senha precisa ser diferente da atual";
  return null;
}

export async function contaDaPlataforma(userId: string): Promise<boolean> {
  const { data, error } = await db().auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  // PR8-CONTA-002: só a marca controlada pelo servidor (app_metadata); user_metadata a própria pessoa pode editar
  return data.user.app_metadata?.origem === ORIGEM;
}

export async function trocarMinhaSenha(u: Usuario, atual: string, nova: string, confirmar: string): Promise<ResultadoConta> {
  const invalida = validarNovaSenha(atual, nova, confirmar);
  if (invalida) return { ok: false, motivo: invalida };
  if (!(await contaDaPlataforma(u.id))) {
    return { ok: false, motivo: "Seu login é o mesmo de outro sistema do grupo. Para não mudar a senha de lá, troque a senha no sistema de origem." };
  }
  // confirma a senha atual sem criar sessão no navegador
  const verificador = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: errAtual } = await verificador.auth.signInWithPassword({ email: u.email, password: atual });
  if (errAtual) return { ok: false, motivo: "Senha atual incorreta" };
  await verificador.auth.signOut().catch(() => undefined);

  const { error } = await db().auth.admin.updateUserById(u.id, { password: nova });
  if (error) {
    const fraca = /weak|password/i.test(error.message);
    return { ok: false, motivo: fraca ? "Essa senha foi recusada pelo servidor (fraca demais ou muito comum). Tente outra." : "Não foi possível trocar a senha agora" };
  }
  await auditar(u.email, "trocar_propria_senha", "auth", u.id);
  return { ok: true, mensagem: "Senha trocada. Use a nova no próximo login." };
}
