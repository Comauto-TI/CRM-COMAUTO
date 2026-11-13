import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { notificar } from "@/lib/notificacoes";
import type { Usuario } from "@/lib/auth";
import { acharNoAuthPorEmail } from "@/lib/equipe";
import { SENHA_MINIMA } from "@/lib/conta";

/**
 * Links de cadastro da equipe. O admin gera; a pessoa se cadastra pelo link já com papel/setor/unidade.
 * Segurança: token aleatório de 32 bytes, só o SHA-256 vai para o banco, expira, limite de usos, revogável.
 * Login compartilhado no dev: e-mail que já existe no Auth é recusado (não mexemos em conta de outro sistema).
 */
const ORIGEM = "plataforma-comauto";
export const TIPOS_CONVITE = {
  vendas: { rotulo: "Vendedor (Vendas)", papel: "vendedor", setor: "vendas" },
  pecas: { rotulo: "Peças", papel: "pecas", setor: "pecas" },
  agendamento: { rotulo: "Agendamento / Recepção (Oficina)", papel: "recepcao", setor: "oficina" },
  administrador: { rotulo: "Administrador (acesso global)", papel: "admin", setor: "administracao" },
} as const;
export type TipoConvite = keyof typeof TIPOS_CONVITE;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ConviteResumo = {
  id: string; tipo: TipoConvite; unidade: string; expira_em: string; max_usos: number; usos: number; revogado_em: string | null; criado_em: string;
};

export async function criarConvite(admin: Usuario, tipo: string, unidade: string, dias: number, usos: number):
  Promise<{ ok: true; token: string } | { ok: false; motivo: string }> {
  if (admin?.papel !== "admin") return { ok: false, motivo: "Só um administrador pode gerar links de cadastro" };
  if (typeof tipo !== "string" || !Object.hasOwn(TIPOS_CONVITE, tipo)) return { ok: false, motivo: "Tipo de cadastro inválido" };
  const { data: un } = await db().from("unidades").select("chave").eq("chave", unidade).maybeSingle();
  if (!un) return { ok: false, motivo: "Unidade inválida" };
  // Convite administrativo é individual e curto, mesmo se o formulário for adulterado.
  const d = tipo === "administrador" ? 1 : Math.min(30, Math.max(1, Math.floor(dias) || 7));
  const n = tipo === "administrador" ? 1 : Math.min(50, Math.max(1, Math.floor(usos) || 1));
  const t = TIPOS_CONVITE[tipo as TipoConvite];
  const token = randomBytes(32).toString("base64url");
  const agora = Date.now();
  const { error } = await db().from("plataforma_convites").insert({
    token_hash: hash(token), tipo, papel: t.papel, setor: t.setor, unidade, criado_por: admin.id,
    ...(tipo === "administrador" ? { criado_em: new Date(agora).toISOString() } : {}),
    expira_em: new Date(agora + d * 86_400_000).toISOString(), max_usos: n,
  });
  if (error) return { ok: false, motivo: "Não foi possível criar o link" };
  await auditar(admin.email, "criar_convite", "plataforma_convites", null, { tipo, unidade, dias: d, usos: n });
  return { ok: true, token };
}

export async function listarConvites(): Promise<ConviteResumo[]> {
  const { data } = await db().from("plataforma_convites")
    .select("id, tipo, unidade, expira_em, max_usos, usos, revogado_em, criado_em").order("criado_em", { ascending: false }).limit(50);
  return (data ?? []) as ConviteResumo[];
}

export async function revogarConvite(admin: Usuario, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const { data } = await db().from("plataforma_convites").update({ revogado_em: new Date().toISOString() }).eq("id", id).is("revogado_em", null).select("id");
  if (data?.length) await auditar(admin.email, "revogar_convite", "plataforma_convites", id);
  return !!data?.length;
}

/** Para a página pública: o link ainda vale? (não reserva uso) */
export async function lerConvite(token: string): Promise<{ tipo: TipoConvite; unidade: string } | null> {
  if (!TOKEN.test(token)) return null;
  const { data } = await db().from("plataforma_convites").select("tipo, unidade, expira_em, max_usos, usos, revogado_em, papel, setor, criado_por, criado_em").eq("token_hash", hash(token)).maybeSingle();
  if (!data || data.revogado_em || new Date(data.expira_em as string) <= new Date() || (data.usos as number) >= (data.max_usos as number)) return null;
  if (data.tipo === "administrador") {
    const inicio = Date.parse(data.criado_em as string), fim = Date.parse(data.expira_em as string);
    if (data.papel !== "admin" || data.setor !== "administracao" || data.max_usos !== 1 || !data.criado_por
      || !Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio || fim - inicio > 86_400_000) return null;
    const { data: emissor, error } = await db().from("usuarios").select("user_id").eq("user_id", data.criado_por).eq("ativo", true).eq("papel", "admin").maybeSingle();
    if (error || !emissor) return null;
  }
  return { tipo: data.tipo as TipoConvite, unidade: data.unidade as string };
}

export function validarCadastro(nome: string, email: string, senha: string, confirmar: string): string | null {
  if (nome.trim().length < 2) return "Informe seu nome";
  if (!EMAIL.test(email.trim())) return "E-mail inválido";
  if (senha.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres`;
  if (senha.length > 72) return "A senha pode ter no máximo 72 caracteres";
  if (senha !== confirmar) return "A confirmação não é igual à senha";
  return null;
}

export async function cadastrarPeloConvite(token: string, d: { nome: string; email: string; senha: string; confirmar: string }):
  Promise<{ ok: true } | { ok: false; motivo: string }> {
  if (!TOKEN.test(token)) return { ok: false, motivo: "Link inválido" };
  const invalido = validarCadastro(d.nome, d.email, d.senha, d.confirmar);
  if (invalido) return { ok: false, motivo: invalido };
  const nome = d.nome.trim().replace(/\s+/g, " ").slice(0, 80);
  const email = d.email.trim().toLowerCase();
  // PR8-CONV-001: o link é validado ANTES de consultar o e-mail — sem link válido, ninguém descobre se um e-mail tem conta
  const convite = await lerConvite(token);
  if (!convite) return { ok: false, motivo: "Este link expirou, foi cancelado ou já foi usado." };
  if (await acharNoAuthPorEmail(email)) {
    return { ok: false, motivo: "Esse e-mail já tem login em um sistema do grupo. Peça ao administrador para incluir você pelo painel." };
  }

  const { data: r, error: errRes } = await db().rpc("reservar_convite", { p_hash: hash(token) });
  const conv = r as { ok: boolean; id?: string; papel?: string; setor?: string; unidade?: string; criado_por?: string | null; tipo?: string } | null;
  if (errRes || !conv?.ok || !conv.id) return { ok: false, motivo: "Este link expirou, foi cancelado ou já foi usado." };
  if ((convite.tipo === "administrador" || conv.tipo === "administrador" || conv.papel === "admin")
    && (convite.tipo !== "administrador" || conv.tipo !== "administrador" || conv.papel !== "admin"
      || conv.setor !== "administracao" || conv.unidade !== convite.unidade || !conv.criado_por)) {
    await db().rpc("devolver_convite", { p_id: conv.id });
    return { ok: false, motivo: "Este link expirou, foi cancelado ou já foi usado." };
  }

  const { data: criado, error: errAuth } = await db().auth.admin.createUser({
    email, password: d.senha, email_confirm: true, user_metadata: { nome }, app_metadata: { origem: ORIGEM },
  });
  if (errAuth || !criado.user) {
    await db().rpc("devolver_convite", { p_id: conv.id });
    return { ok: false, motivo: /weak|password/i.test(errAuth?.message ?? "") ? "Senha recusada pelo servidor (fraca ou muito comum). Tente outra." : "Não foi possível criar o login. Tente de novo." };
  }
  const { error: errUsu } = await db().from("usuarios").insert({ user_id: criado.user.id, nome, papel: conv.papel, setor: conv.setor, unidade: conv.unidade, ativo: true });
  if (errUsu) {
    // a conta acabou de ser criada por nós e não entrou na equipe: desfaz para não deixar login órfão
    await db().auth.admin.deleteUser(criado.user.id).catch(() => undefined);
    await db().rpc("devolver_convite", { p_id: conv.id });
    return { ok: false, motivo: "Não foi possível concluir o cadastro. Tente de novo." };
  }
  await auditar(email, "cadastro_por_convite", "usuarios", criado.user.id, { convite: conv.id, tipo: conv.tipo, unidade: conv.unidade });
  if (conv.criado_por) {
    await notificar(conv.criado_por, { tipo: "sistema", unidade: conv.unidade!, titulo: `${nome} se cadastrou pelo link`, corpo: `${TIPOS_CONVITE[conv.tipo as TipoConvite]?.rotulo ?? conv.tipo} · ${conv.unidade}`, link: "/painel/usuarios" });
  }
  return { ok: true };
}
