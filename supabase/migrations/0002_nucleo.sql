-- =====================================================================
-- 0002_nucleo — Plataforma Comauto: unidades, setores, papéis, ficha única
-- Dono: Claude (F0-2 em docs/ETAPAS.md). Banco de dev compartilhado com o
-- processo-vendas-teste: NÃO usar os nomes empresas/profiles/propostas/convites.
-- Idempotente onde possível (pode ser reaplicada sem erro).
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- Unidades (concessionárias do grupo). Chaves iguais às dos sistemas
-- existentes (processo-vendas, revisao, acessorios). Piloto: só Comauto ativa.
-- ---------------------------------------------------------------------
create table if not exists unidades (
  chave     text primary key check (chave ~ '^[a-z0-9_]+$'),
  nome      text not null,
  grupo     text not null default 'grupo-comauto',
  ativa     boolean not null default true,
  criado_em timestamptz not null default now()
);
insert into unidades (chave, nome, ativa) values
  ('comauto', 'Comauto', true),
  ('motomecanica', 'Motomecânica', false),
  ('santaluzia', 'Santa Luzia', false)
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Usuários: admin_usuarios vira usuarios (mantém os dados), com setor e unidade
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.admin_usuarios') is not null and to_regclass('public.usuarios') is not null then
    raise exception 'Já existe public.usuarios (de outro sistema?) além de admin_usuarios. Pare e confira antes de seguir.';
  end if;
  if to_regclass('public.admin_usuarios') is not null then
    alter table admin_usuarios rename to usuarios;
  end if;
  -- garante que "usuarios" é a NOSSA tabela (tem as colunas do 0001) antes de alterar
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'usuarios' and column_name = 'recebe_alertas') then
    raise exception 'public.usuarios não é a tabela da plataforma (falta recebe_alertas). Abortado.';
  end if;
end $$;

alter table usuarios add column if not exists setor text not null default 'administracao';
alter table usuarios add column if not exists unidade text not null default 'comauto';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'usuarios_setor_check') then
    alter table usuarios add constraint usuarios_setor_check check (setor in ('vendas','oficina','pecas','administracao'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'usuarios_unidade_fkey') then
    alter table usuarios add constraint usuarios_unidade_fkey foreign key (unidade) references unidades (chave);
  end if;
  -- papéis da plataforma ('atendente' mantido por compatibilidade = recepção)
  alter table usuarios drop constraint if exists admin_usuarios_papel_check;
  alter table usuarios drop constraint if exists usuarios_papel_check;
  alter table usuarios add constraint usuarios_papel_check
    check (papel in ('admin','gerente','vendedor','consultor_tecnico','recepcao','pecas','financeiro','atendente'));
end $$;

-- Acesso a mais de uma unidade (ex.: gerente do grupo)
create table if not exists usuario_unidades (
  user_id uuid not null references usuarios (user_id) on delete cascade,
  unidade text not null references unidades (chave),
  primary key (user_id, unidade)
);

-- ---------------------------------------------------------------------
-- Ficha única do cliente (válida para o grupo inteiro)
-- ---------------------------------------------------------------------
alter table clientes add column if not exists cpf_cnpj text;            -- só dígitos
alter table clientes add column if not exists data_nascimento date;
alter table clientes add column if not exists vendedor_id uuid references usuarios (user_id) on delete set null; -- carteira
alter table clientes add column if not exists unidade_origem text references unidades (chave);
alter table clientes add column if not exists ids_externos jsonb not null default '{}'; -- {bravus, processo_vendas, revisao, avaliex}
create index if not exists clientes_cpf_cnpj_idx on clientes (cpf_cnpj);
create index if not exists clientes_vendedor_idx on clientes (vendedor_id);
create index if not exists clientes_nome_trgm_idx on clientes using gin (nome gin_trgm_ops);
create index if not exists clientes_telefone_trgm_idx on clientes using gin (telefone gin_trgm_ops);
create index if not exists clientes_nascimento_idx on clientes (extract(month from data_nascimento), extract(day from data_nascimento));

alter table veiculos add column if not exists chassi text;
alter table veiculos add column if not exists renavam text;
alter table veiculos add column if not exists ids_externos jsonb not null default '{}';
create index if not exists veiculos_placa_idx on veiculos (placa);
create index if not exists veiculos_chassi_idx on veiculos (chassi);

-- ---------------------------------------------------------------------
-- Unidade nas tabelas operacionais (default Comauto para os dados atuais)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'recursos','servicos','horarios_funcionamento','bloqueios','agendamentos',
    'eventos','campanhas','links_rastreados','conversas','custos','followups'
  ] loop
    execute format('alter table %I add column if not exists unidade text not null default %L', t, 'comauto');
    if not exists (select 1 from pg_constraint where conname = t || '_unidade_fkey') then
      execute format('alter table %I add constraint %I foreign key (unidade) references unidades (chave)', t, t || '_unidade_fkey');
    end if;
    execute format('create index if not exists %I on %I (unidade)', t || '_unidade_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Central de notificações e lembretes (usados por todos os setores)
-- ---------------------------------------------------------------------
create table if not exists notificacoes (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios (user_id) on delete cascade,
  unidade    text not null default 'comauto' references unidades (chave),
  tipo       text not null,             -- atendimento | lead | aniversario | tarefa | sistema
  titulo     text not null,
  corpo      text,
  link       text,                      -- caminho interno do painel (ex.: /painel/conversas?c=...)
  lida_em    timestamptz,
  criado_em  timestamptz not null default now()
);
create index if not exists notificacoes_usuario_idx on notificacoes (usuario_id, lida_em, criado_em desc);

create table if not exists lembretes (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references usuarios (user_id) on delete cascade,
  cliente_id   uuid references clientes (id) on delete cascade,
  tipo         text not null check (tipo in ('aniversario','retorno','tarefa')),
  data_alvo    date not null,
  insistente   boolean not null default false, -- avisa a cada abertura até concluir
  concluido_em timestamptz,
  observacao   text,
  criado_em    timestamptz not null default now()
);
create index if not exists lembretes_usuario_idx on lembretes (usuario_id, concluido_em, data_alvo);

-- ---------------------------------------------------------------------
-- RLS: mesma política do 0001 — tudo fechado, acesso só pelo servidor
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['unidades','usuarios','usuario_unidades','notificacoes','lembretes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;
