import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const funcaoEnum = pgEnum("funcao", [
  "admin",
  "gerente",
  "vendedor",
  "posvenda",
]);

export const etapaEnum = pgEnum("etapa", [
  "novo",
  "em_atendimento",
  "proposta",
  "ganho",
  "perdido",
]);

export const statusRevisaoEnum = pgEnum("status_revisao", [
  "pendente",
  "contatado",
  "agendado",
]);

export const usuarios = pgTable("usuarios", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  funcao: funcaoEnum("funcao").notNull(),
  loja: text("loja").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  telefone: text("telefone").notNull(),
  origem: text("origem").notNull(),
  loja: text("loja").notNull(),
  interesse: text("interesse").notNull(),
  etapa: etapaEnum("etapa").notNull().default("novo"),
  testDrive: boolean("test_drive").notNull().default(false),
  temTroca: boolean("tem_troca").notNull().default(false),
  querFinanciar: boolean("quer_financiar").notNull().default(false),
  clienteDaCasa: boolean("cliente_da_casa").notNull().default(false),
  pontuacao: integer("pontuacao").notNull().default(0),
  vendedorId: integer("vendedor_id").references(() => usuarios.id),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const acoes = pgTable("acoes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id),
  vendedorId: integer("vendedor_id")
    .notNull()
    .references(() => usuarios.id),
  tipo: text("tipo").notNull(),
  descricao: text("descricao").notNull(),
  venceEm: timestamp("vence_em", { withTimezone: true }).notNull(),
  concluidaEm: timestamp("concluida_em", { withTimezone: true }),
});

export const revisoes = pgTable("revisoes", {
  id: serial("id").primaryKey(),
  clienteNome: text("cliente_nome").notNull(),
  telefone: text("telefone").notNull(),
  veiculo: text("veiculo").notNull(),
  placa: text("placa").notNull(),
  ultimaRevisao: date("ultima_revisao").notNull(),
  proximaRevisao: date("proxima_revisao").notNull(),
  garantiaAte: date("garantia_ate"),
  status: statusRevisaoEnum("status").notNull().default("pendente"),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

// Registro de uso do "Ver como" e de tentativas bloqueadas (auditoria/LGPD).
export const auditoria = pgTable("auditoria", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  acao: text("acao").notNull(),
  alvoUsuarioId: integer("alvo_usuario_id").references(() => usuarios.id),
  detalhe: text("detalhe"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export type Funcao = (typeof funcaoEnum.enumValues)[number];
export type Etapa = (typeof etapaEnum.enumValues)[number];
