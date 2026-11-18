import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Funcao } from "@/db/schema";
import { inicioDaFuncao } from "@/lib/funcoes";
import { lerSessao } from "@/lib/session";

export type UsuarioVisivel = {
  id: number;
  nome: string;
  funcao: Funcao;
  loja: string;
};

export type Acesso = {
  // Quem fez login de verdade.
  usuario: UsuarioVisivel;
  // De quem são as telas exibidas (igual a `usuario`, exceto no "Ver como").
  visao: UsuarioVisivel;
  somenteLeitura: boolean;
};

async function buscarUsuario(id: number): Promise<UsuarioVisivel | null> {
  const db = await getDb();
  const [u] = await db
    .select({
      id: schema.usuarios.id,
      nome: schema.usuarios.nome,
      funcao: schema.usuarios.funcao,
      loja: schema.usuarios.loja,
      ativo: schema.usuarios.ativo,
    })
    .from(schema.usuarios)
    .where(eq(schema.usuarios.id, id));
  if (!u || !u.ativo) return null;
  return { id: u.id, nome: u.nome, funcao: u.funcao, loja: u.loja };
}

export const getAcesso = cache(async (): Promise<Acesso> => {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const usuario = await buscarUsuario(sessao.usuarioId);
  if (!usuario) redirect("/login");

  // "Ver como" só vale se quem está logado é admin e o alvo existe e está ativo.
  if (sessao.verComoUsuarioId && usuario.funcao === "admin") {
    const alvo = await buscarUsuario(sessao.verComoUsuarioId);
    if (alvo && alvo.funcao !== "admin") {
      return { usuario, visao: alvo, somenteLeitura: true };
    }
  }

  return { usuario, visao: usuario, somenteLeitura: false };
});

// Para páginas: manda para a tela inicial da função se a pessoa não tiver acesso.
export async function exigirFuncao(...funcoes: Funcao[]): Promise<Acesso> {
  const acesso = await getAcesso();
  if (!funcoes.includes(acesso.visao.funcao)) {
    redirect(inicioDaFuncao(acesso.visao.funcao));
  }
  return acesso;
}

export class SomenteLeituraError extends Error {
  constructor() {
    super("Modo \"Ver como\" é somente leitura.");
  }
}

// Para server actions que alteram dados: bloqueia e registra se estiver em "Ver como".
export async function exigirEscrita(descricao: string, ...funcoes: Funcao[]): Promise<Acesso> {
  const acesso = await getAcesso();
  if (acesso.somenteLeitura) {
    const db = await getDb();
    await db.insert(schema.auditoria).values({
      usuarioId: acesso.usuario.id,
      acao: "acao_bloqueada",
      alvoUsuarioId: acesso.visao.id,
      detalhe: descricao,
    });
    throw new SomenteLeituraError();
  }
  if (funcoes.length > 0 && !funcoes.includes(acesso.usuario.funcao)) {
    throw new Error("Sem permissão para esta ação.");
  }
  return acesso;
}
