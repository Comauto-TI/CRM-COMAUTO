CREATE TYPE "public"."etapa" AS ENUM('novo', 'em_atendimento', 'proposta', 'ganho', 'perdido');--> statement-breakpoint
CREATE TYPE "public"."funcao" AS ENUM('admin', 'gerente', 'vendedor', 'posvenda');--> statement-breakpoint
CREATE TYPE "public"."status_revisao" AS ENUM('pendente', 'contatado', 'agendado');--> statement-breakpoint
CREATE TABLE "acoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"vendedor_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"descricao" text NOT NULL,
	"vence_em" timestamp with time zone NOT NULL,
	"concluida_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"acao" text NOT NULL,
	"alvo_usuario_id" integer,
	"detalhe" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"telefone" text NOT NULL,
	"origem" text NOT NULL,
	"loja" text NOT NULL,
	"interesse" text NOT NULL,
	"etapa" "etapa" DEFAULT 'novo' NOT NULL,
	"test_drive" boolean DEFAULT false NOT NULL,
	"tem_troca" boolean DEFAULT false NOT NULL,
	"quer_financiar" boolean DEFAULT false NOT NULL,
	"cliente_da_casa" boolean DEFAULT false NOT NULL,
	"pontuacao" integer DEFAULT 0 NOT NULL,
	"vendedor_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"cliente_nome" text NOT NULL,
	"telefone" text NOT NULL,
	"veiculo" text NOT NULL,
	"placa" text NOT NULL,
	"ultima_revisao" date NOT NULL,
	"proxima_revisao" date NOT NULL,
	"garantia_ate" date,
	"status" "status_revisao" DEFAULT 'pendente' NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"funcao" "funcao" NOT NULL,
	"loja" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "acoes" ADD CONSTRAINT "acoes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acoes" ADD CONSTRAINT "acoes_vendedor_id_usuarios_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_alvo_usuario_id_usuarios_id_fk" FOREIGN KEY ("alvo_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_vendedor_id_usuarios_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;