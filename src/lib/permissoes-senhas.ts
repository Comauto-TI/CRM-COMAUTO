import "server-only";
import type { Usuario } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PermissoesSenhas = { principalId: string | null; principal: boolean; podeRedefinir: boolean; administradorAtivo: boolean; alvoAtivo: boolean };

/** Identidade de servidor: nunca inferir proprietário por nome, e-mail ou dados editáveis do usuário. */
export function administradorPrincipalId(): string | null {
  const valor = process.env.ADMIN_PRINCIPAL_ID;
  return typeof valor === "string" && valor.length === 36 && UUID.test(valor) ? valor.toLowerCase() : null;
}

export async function obterPermissoesSenhas(u: Usuario, alvoId?: string): Promise<PermissoesSenhas> {
  const principalId = administradorPrincipalId();
  const negado: PermissoesSenhas = { principalId, principal: false, podeRedefinir: false, administradorAtivo: false, alvoAtivo: false };
  if (!principalId || !u || typeof u.id !== "string" || u.id.length !== 36 || !UUID.test(u.id) || u.papel !== "admin") return negado;
  if (alvoId !== undefined && (typeof alvoId !== "string" || alvoId.length !== 36 || !UUID.test(alvoId))) return negado;
  try {
    const id = u.id.toLowerCase();
    const alvo = alvoId?.toLowerCase();
    // A autorização final de reset lê ator, principal e alvo no mesmo snapshot da consulta.
    const { data, error } = await db().from("usuarios").select("user_id,papel,ativo,pode_redefinir_senhas").in("user_id", [...new Set([id, principalId, ...(alvo ? [alvo] : [])])]);
    if (error || !Array.isArray(data)) return negado;
    const ator = data.find(linha => linha.user_id === id);
    const principal = data.find(linha => linha.user_id === principalId);
    if (!ator || !principal || ator.ativo !== true || principal.ativo !== true || ator.papel !== "admin" || principal.papel !== "admin") return negado;
    return { principalId, principal: id === principalId, podeRedefinir: id === principalId || ator.pode_redefinir_senhas === true, administradorAtivo: true, alvoAtivo: !!alvo && data.some(linha => linha.user_id === alvo && linha.ativo === true) };
  } catch { return negado; }
}

/** Todos os caminhos de edição de equipe preservam a identidade e o acesso da conta principal. */
export async function podeAlterarPerfilUsuario(u: Usuario, alvo: string, ativo: boolean, papel: unknown): Promise<boolean> {
  if (typeof alvo !== "string" || alvo.length !== 36 || !UUID.test(alvo)) return false;
  const permissoes = await obterPermissoesSenhas(u);
  if (!permissoes.administradorAtivo) return false;
  if (alvo.toLowerCase() !== permissoes.principalId) return true;
  return permissoes.principal && ativo && papel === "admin";
}
