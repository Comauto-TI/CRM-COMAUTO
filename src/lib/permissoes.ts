/**
 * Mapa de permissões da Plataforma Comauto (puro, sem I/O — testável e usável no cliente).
 * Regra: admin passa em tudo. Demais papéis só nas áreas listadas.
 * Áreas de setor (vendas/oficina/pecas): o gerente só entra no próprio setor (ou se for da administração).
 */

export const PAPEIS = [
  "admin",
  "gerente",
  "vendedor",
  "consultor_tecnico",
  "recepcao",
  "pecas",
  "financeiro",
  "atendente", // legado = recepção
] as const;
export type Papel = (typeof PAPEIS)[number];

/** Papéis aceitos pela tabela antiga (admin_usuarios) antes da 0002 — F0-3-003. */
export const PAPEIS_LEGADO = ["admin", "atendente", "financeiro"] as const satisfies readonly Papel[];

export const SETORES = ["vendas", "oficina", "pecas", "administracao"] as const;
export type Setor = (typeof SETORES)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
  consultor_tecnico: "Consultor técnico",
  recepcao: "Recepção",
  pecas: "Peças",
  financeiro: "Financeiro",
  atendente: "Recepção",
};

export const ROTULO_SETOR: Record<Setor, string> = {
  vendas: "Vendas",
  oficina: "Oficina",
  pecas: "Peças",
  administracao: "Administração",
};

const RECEPCAO: Papel[] = ["recepcao", "atendente"];
const TODOS: Papel[] = [...PAPEIS];

export const AREAS = {
  inicio: TODOS,
  notificacoes: TODOS,
  lembretes: TODOS, // "Meus lembretes": cada um vê só os próprios (filtro por usuário no servidor)
  metricas: ["gerente", "financeiro"], // F8 — aba Métricas (página a cargo do Codex)
  busca: ["gerente", "vendedor", "consultor_tecnico", "pecas", ...RECEPCAO],
  clientes: ["gerente", "vendedor", "consultor_tecnico", "pecas", ...RECEPCAO],
  atendimento: ["gerente", "vendedor", "consultor_tecnico", ...RECEPCAO],
  agenda: ["gerente", "consultor_tecnico", ...RECEPCAO],
  links: ["gerente", "vendedor", ...RECEPCAO],
  followups: ["gerente", ...RECEPCAO],
  campanhas: ["gerente"],
  financeiro: ["financeiro"],
  custos_config: ["financeiro"], // preços/custos fixos dentro de Configurações
  configuracoes: [], // só admin
  seguranca: [],
  lgpd: [], // exportar/anonimizar cliente
  vendas: ["gerente", "vendedor"],
  oficina: ["gerente", "consultor_tecnico", ...RECEPCAO],
  pecas: ["gerente", "pecas"],
} satisfies Record<string, Papel[]>;
export type Area = keyof typeof AREAS;

const SETOR_DA_AREA: Partial<Record<Area, Setor>> = { vendas: "vendas", oficina: "oficina", pecas: "pecas" };

export type QuemAcessa = { papel: Papel; setor: Setor };

export function podeAcessar(u: QuemAcessa, area: Area): boolean {
  if (u.papel === "admin") return true;
  if (!(AREAS[area] as readonly Papel[]).includes(u.papel)) return false;
  const setor = SETOR_DA_AREA[area];
  if (setor && u.papel === "gerente" && u.setor !== setor && u.setor !== "administracao") return false;
  return true;
}

/** Quem vê a fila de atendimento humano no topo (popup/badge). */
export function atendeFila(u: QuemAcessa): boolean {
  return u.papel === "admin" || RECEPCAO.includes(u.papel);
}

/** Supervisor pode intervir em conversa assumida por outra pessoa. */
export function supervisiona(u: { papel: Papel }): boolean {
  return u.papel === "admin" || u.papel === "gerente";
}

export function papelValido(p: unknown): p is Papel {
  return typeof p === "string" && (PAPEIS as readonly string[]).includes(p);
}
export function setorValido(s: unknown): s is Setor {
  return typeof s === "string" && (SETORES as readonly string[]).includes(s);
}
