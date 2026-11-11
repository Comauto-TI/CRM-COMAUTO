import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { papelValido, setorValido } from "@/lib/permissoes";
import type { Usuario } from "@/lib/auth";

/**
 * Equipe da plataforma (cadastro pelo admin, sem mexer no Supabase na mão).
 * CUIDADO: o Auth do banco de dev é COMPARTILHADO com o processo-vendas-teste.
 *  - e-mail que já tem login em outro sistema → só vincula ao painel (não troca a senha dele);
 *  - redefinir senha → só de quem foi criado pela plataforma (user_metadata.origem);
 *  - desativar → tira o acesso ao PAINEL (usuarios.ativo = false); nunca apaga usuário do Auth.
 */

const ORIGEM = "plataforma-comauto";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Senha provisória legível (sem 0/O/1/l/I) com letras e números. */
export function gerarSenhaProvisoria(tamanho = 12): string {
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const numeros = "23456789";
  const todos = letras + numeros;
  const s = [letras[randomInt(letras.length)], numeros[randomInt(numeros.length)]];
  while (s.length < tamanho) s.push(todos[randomInt(todos.length)]);
  for (let i = s.length - 1; i > 0; i--) { const j = randomInt(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
  return s.join("");
}

async function acharNoAuthPorEmail(email: string): Promise<{ id: string; origem: string | null } | null> {
  // o Auth não tem busca por e-mail na API admin: percorre as páginas (poucos usuários no projeto)
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const achou = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
    if (achou) return { id: achou.id, origem: (achou.user_metadata?.origem as string | undefined) ?? null };
    if (data.users.length < 200) return null;
  }
  return null;
}

export type ResultadoEquipe =
  | { ok: true; mensagem: string; senhaProvisoria?: string }
  | { ok: false; motivo: string };

export async function criarMembro(
  admin: Usuario,
  d: { nome: string; email: string; papel: string; setor: string; unidade: string },
): Promise<ResultadoEquipe> {
  const nome = d.nome.trim().slice(0, 80);
  const email = d.email.trim().toLowerCase();
  if (nome.length < 2) return { ok: false, motivo: "Informe o nome" };
  if (!EMAIL.test(email)) return { ok: false, motivo: "E-mail inválido" };
  if (!papelValido(d.papel) || d.papel === "atendente") return { ok: false, motivo: "Papel inválido" };
  if (!setorValido(d.setor)) return { ok: false, motivo: "Setor inválido" };
  const { data: un } = await db().from("unidades").select("chave").eq("chave", d.unidade).maybeSingle();
  if (!un) return { ok: false, motivo: "Unidade inválida" };

  let userId: string;
  let senhaProvisoria: string | undefined;
  let vinculado = false;
  const existente = await acharNoAuthPorEmail(email);
  if (existente) {
    const { data: ja } = await db().from("usuarios").select("user_id").eq("user_id", existente.id).maybeSingle();
    if (ja) return { ok: false, motivo: "Essa pessoa já está na equipe" };
    userId = existente.id;
    vinculado = true;
  } else {
    senhaProvisoria = gerarSenhaProvisoria();
    const { data, error } = await db().auth.admin.createUser({
      email, password: senhaProvisoria, email_confirm: true, user_metadata: { nome, origem: ORIGEM },
    });
    if (error || !data.user) return { ok: false, motivo: "Não foi possível criar o login" };
    userId = data.user.id;
  }

  const { error } = await db().from("usuarios").insert({ user_id: userId, nome, papel: d.papel, setor: d.setor, unidade: d.unidade, ativo: true });
  if (error) return { ok: false, motivo: "Login criado, mas não foi possível incluir na equipe — tente de novo" };
  await auditar(admin.email, "equipe_criar", "usuarios", userId, { papel: d.papel, setor: d.setor, unidade: d.unidade, vinculado });
  return vinculado
    ? { ok: true, mensagem: `${nome} já tinha login em outro sistema do grupo: foi vinculado ao painel e entra com a mesma senha de lá.` }
    : { ok: true, mensagem: `${nome} foi cadastrado. Passe a senha provisória pessoalmente — ela aparece só agora.`, senhaProvisoria };
}

export async function definirAtivo(admin: Usuario, userId: string, ativo: boolean): Promise<ResultadoEquipe> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, motivo: "Usuário inválido" };
  if (userId === admin.id && !ativo) return { ok: false, motivo: "Você não pode desativar o próprio acesso" };
  const { data } = await db().from("usuarios").update({ ativo }).eq("user_id", userId).select("user_id");
  if (!data?.length) return { ok: false, motivo: "Usuário não encontrado" };
  await auditar(admin.email, ativo ? "equipe_reativar" : "equipe_desativar", "usuarios", userId);
  return { ok: true, mensagem: ativo ? "Acesso reativado." : "Acesso ao painel desativado (o login nos outros sistemas não muda)." };
}

export async function redefinirSenha(admin: Usuario, userId: string): Promise<ResultadoEquipe> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, motivo: "Usuário inválido" };
  const { data: membro } = await db().from("usuarios").select("nome").eq("user_id", userId).maybeSingle();
  if (!membro) return { ok: false, motivo: "Usuário não encontrado" };
  const { data: au, error } = await db().auth.admin.getUserById(userId);
  if (error || !au.user) return { ok: false, motivo: "Login não encontrado" };
  if (au.user.user_metadata?.origem !== ORIGEM) {
    return { ok: false, motivo: "Esse login veio de outro sistema do grupo — a senha é trocada por lá (para não derrubar o acesso dele no outro sistema)." };
  }
  const senhaProvisoria = gerarSenhaProvisoria();
  const { error: e2 } = await db().auth.admin.updateUserById(userId, { password: senhaProvisoria });
  if (e2) return { ok: false, motivo: "Não foi possível redefinir" };
  await auditar(admin.email, "equipe_redefinir_senha", "usuarios", userId);
  return { ok: true, mensagem: `Nova senha provisória de ${membro.nome as string} — aparece só agora.`, senhaProvisoria };
}
