import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
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
  visualizacao?: { administradorId: string; administradorNome: string; alvoId: string; alvoNome: string };
};

const COOKIE_VISUALIZACAO = "comauto_ver_como";
const DURACAO_VISUALIZACAO = 30 * 60;

function segredoVisualizacao() {
  return process.env.VER_COMO_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function assinaturaVisualizacao(alvoId: string, expira: number) {
  return createHmac("sha256", segredoVisualizacao()).update(`${alvoId}.${expira}`).digest("hex");
}

function tokenVisualizacaoValido(token: string | undefined): string | null {
  if (!token || !segredoVisualizacao()) return null;
  const [alvoId, expiraTexto, assinatura] = token.split(".");
  const expira = Number(expiraTexto);
  if (!alvoId || !/^\d+$/.test(expiraTexto ?? "") || !assinatura || expira < Date.now()) return null;
  const esperado = assinaturaVisualizacao(alvoId, expira);
  const a = Buffer.from(assinatura, "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b) ? alvoId : null;
}

export async function iniciarVisualizacao(alvoId: string) {
  const expira = Date.now() + DURACAO_VISUALIZACAO * 1000;
  (await cookies()).set(COOKIE_VISUALIZACAO, `${alvoId}.${expira}.${assinaturaVisualizacao(alvoId, expira)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DURACAO_VISUALIZACAO,
  });
}

export async function encerrarVisualizacao() {
  (await cookies()).delete(COOKIE_VISUALIZACAO);
}

async function buscarUsuarioPorId(userId: string, tabela: "usuarios" | "admin_usuarios"): Promise<Usuario | null> {
  const { data: row } = await db().from(tabela).select("*").eq("user_id", userId).maybeSingle();
  if (!row || !row.ativo || !papelValido(row.papel)) return null;
  const unidade: string = typeof row.unidade === "string" ? row.unidade : "comauto";
  let unidades = [unidade];
  if (tabela === "usuarios") {
    const { data: extras } = await db().from("usuario_unidades").select("unidade").eq("user_id", userId);
    unidades = [...new Set([unidade, ...(extras ?? []).map((e) => e.unidade as string)])];
  }
  return { id: userId, email: typeof row.email === "string" ? row.email : "", nome: typeof row.nome === "string" ? row.nome : "Usuário", papel: row.papel, setor: setorValido(row.setor) ? row.setor : "administracao", unidade, unidades };
}

/**
 * Autorização REAL do painel: sessão válida (verificada no Supabase) + usuário ativo na tabela de usuários.
 * cache(): layout e página da MESMA requisição compartilham uma só verificação (antes eram duas idas ao Supabase).
 */
export const usuarioRealAtual = cache(async function usuarioRealAtual(): Promise<Usuario | null> {
  const supa = await authClient();
  const { data } = await supa.auth.getUser();
  if (!data.user) return null;
  const tabela = await tabelaUsuarios();
  const usuario = await buscarUsuarioPorId(data.user.id, tabela);
  return usuario ? { ...usuario, email: data.user.email ?? usuario.email } : null;
});

export const usuarioAtual = cache(async function usuarioAtual(): Promise<Usuario | null> {
  const real = await usuarioRealAtual();
  if (!real || real.papel !== "admin") return real;
  const alvoId = tokenVisualizacaoValido((await cookies()).get(COOKIE_VISUALIZACAO)?.value);
  if (!alvoId || alvoId === real.id) return real;
  const alvo = await buscarUsuarioPorId(alvoId, await tabelaUsuarios());
  if (!alvo || alvo.papel === "admin") return real;
  return { ...alvo, visualizacao: { administradorId: real.id, administradorNome: real.nome, alvoId: alvo.id, alvoNome: alvo.nome } };
});

export class SomenteLeituraError extends Error {
  constructor() { super("Esta tela está em modo somente leitura."); }
}

async function estaEmAcaoDoServidor() {
  const h = await headers();
  return Boolean(h.get("next-action") || h.get("x-action-id"));
}

/** Use no topo de TODA página e server action do painel. Sem área = só exige login. */
export async function exigirAcesso(area?: Area): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (u.visualizacao && await estaEmAcaoDoServidor()) throw new SomenteLeituraError();
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
