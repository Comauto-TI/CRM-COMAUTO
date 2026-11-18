import type { Funcao } from "@/db/schema";

export const NOME_FUNCAO: Record<Funcao, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
  posvenda: "Pós-venda",
};

export type ItemMenu = { href: string; rotulo: string };

export const MENU: Record<Funcao, ItemMenu[]> = {
  admin: [
    { href: "/admin/ver-como", rotulo: "Ver como" },
    { href: "/admin/usuarios", rotulo: "Usuários" },
    { href: "/admin/auditoria", rotulo: "Auditoria" },
  ],
  gerente: [
    { href: "/painel", rotulo: "Painel" },
    { href: "/leads", rotulo: "Todos os leads" },
  ],
  vendedor: [
    { href: "/fila", rotulo: "Minha fila" },
    { href: "/meus-leads", rotulo: "Meus leads" },
  ],
  posvenda: [{ href: "/revisoes", rotulo: "Revisões" }],
};

export function inicioDaFuncao(funcao: Funcao): string {
  return MENU[funcao][0].href;
}
