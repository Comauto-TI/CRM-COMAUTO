import "server-only";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import type { Usuario } from "@/lib/auth";
import { obterPermissoesSenhas } from "@/lib/permissoes-senhas";

/**
 * "Minha conta" — a própria pessoa troca a senha.
 * Regra leve (pedido do Simão): mínimo de 6 caracteres, sem exigir maiúscula/símbolo.
 * Login COMPARTILHADO: o banco de dev usa o mesmo Auth do processo-vendas-teste. Trocar aqui mudaria a senha
 * lá também, então contas vinculadas de outro sistema são preservadas. A exceção explícita é o próprio
 * administrador principal configurado por UUID, com perfil atual validado e prova da senha atual do mesmo
 * login. No banco oficial da plataforma (projeto próprio) os logins já são independentes.
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

export async function verificarTrocaMinhaSenha(u: Usuario): Promise<{ ok: true; compartilhada: boolean } | { ok: false; motivo: string }> {
  try {
    const { data, error } = await db().auth.admin.getUserById(u.id);
    if (error || !data.user || data.user.id.toLowerCase() !== u.id.toLowerCase()) {
      return { ok: false, motivo: "Não foi possível verificar seu login agora. Tente novamente." };
    }
    if (data.user.app_metadata?.origem === ORIGEM) return { ok: true, compartilhada: false };
    const permissoes = await obterPermissoesSenhas(u);
    if (permissoes.principal && permissoes.principalId === u.id.toLowerCase()) return { ok: true, compartilhada: true };
    return { ok: false, motivo: "Seu login é o mesmo de outro sistema do grupo. Para não mudar a senha de lá, troque a senha no sistema de origem." };
  } catch { return { ok: false, motivo: "Não foi possível verificar seu login agora. Tente novamente." }; }
}

export async function trocarMinhaSenha(u: Usuario, atual: string, nova: string, confirmar: string): Promise<ResultadoConta> {
  const invalida = validarNovaSenha(atual, nova, confirmar);
  if (invalida) return { ok: false, motivo: invalida };
  const verificacao = await verificarTrocaMinhaSenha(u);
  if (!verificacao.ok) return verificacao;
  // confirma a senha atual sem criar sessão no navegador
  const verificador = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let autenticado = false;
  try {
    const { data, error: errAtual } = await verificador.auth.signInWithPassword({ email: u.email, password: atual });
    if (errAtual) return { ok: false, motivo: errAtual.code === "invalid_credentials" ? "Senha atual incorreta"
      : "Não foi possível confirmar a senha atual agora. Tente novamente." };
    autenticado = true;
    if (!data.user || data.user.id.toLowerCase() !== u.id.toLowerCase()) {
      return { ok: false, motivo: "A confirmação não corresponde ao seu login atual. Entre novamente." };
    }
  } catch { return { ok: false, motivo: "Não foi possível confirmar a senha atual agora. Tente novamente." }; }
  finally {
    // O cliente temporário não pode encerrar as sessões do painel ou de outros dispositivos.
    if (autenticado) await verificador.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  const atualizada = await verificarTrocaMinhaSenha(u);
  if (!atualizada.ok) return atualizada;

  const { error } = await db().auth.admin.updateUserById(u.id, { password: nova });
  if (error) {
    const fraca = /weak|password/i.test(error.message);
    return { ok: false, motivo: fraca ? "Essa senha foi recusada pelo servidor (fraca demais ou muito comum). Tente outra." : "Não foi possível trocar a senha agora" };
  }
  await auditar(u.email, "trocar_propria_senha", "auth", u.id);
  return { ok: true, mensagem: "Senha trocada. Use a nova no próximo login." };
}
