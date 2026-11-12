import type { Usuario } from "@/lib/auth";
import { SETORES, type Setor } from "@/lib/permissoes";

/**
 * Marketing por setor: de qual setor a pessoa enxerga/cria campanhas, eventos e links.
 * null = enxerga TODOS (admin e gerente da administração). Os demais ficam presos ao próprio setor.
 */
export function setorDoMarketing(u: Pick<Usuario, "papel" | "setor">): Setor | null {
  if (u.papel === "admin" || (u.papel === "gerente" && u.setor === "administracao")) return null;
  return u.setor;
}

/** Setor a gravar num registro novo: quem tem escopo fixo grava o próprio; quem vê tudo escolhe (padrão vendas). */
export function setorParaGravar(u: Pick<Usuario, "papel" | "setor">, escolhido: unknown): Setor {
  const fixo = setorDoMarketing(u);
  if (fixo) return fixo;
  return typeof escolhido === "string" && (SETORES as readonly string[]).includes(escolhido) ? (escolhido as Setor) : "vendas";
}

/** O registro (do setor informado) está no escopo da pessoa? */
export function noEscopo(u: Pick<Usuario, "papel" | "setor">, setorDoRegistro: string | null | undefined): boolean {
  const fixo = setorDoMarketing(u);
  return fixo === null || setorDoRegistro === fixo;
}
