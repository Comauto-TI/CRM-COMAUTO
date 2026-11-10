-- =====================================================================
-- 0003_vendas — Setor Vendas (F1-V): funis, etapas, oportunidades, histórico,
-- atividades e tarefas. Dono: Claude. Depende da 0002_nucleo.
-- Regras:
--  * Toda mudança de etapa grava em vendas_historico (base da F8 — métricas/previsões).
--  * Etapa pertence ao funil e o funil à unidade da oportunidade (FKs compostas).
--  * "Perdido" exige motivo; ganho/perdido preenchem fechado_em.
-- Idempotente onde possível.
-- =====================================================================

create table if not exists vendas_funis (
  id        uuid primary key default gen_random_uuid(),
  unidade   text not null references unidades (chave),
  chave     text not null check (chave ~ '^[a-z0-9_]+$'), -- novos | seminovos
  nome      text not null,
  ordem     int not null default 0,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (unidade, chave),
  unique (id, unidade)
);

create table if not exists vendas_etapas (
  id        uuid primary key default gen_random_uuid(),
  funil_id  uuid not null references vendas_funis (id) on delete cascade,
  nome      text not null,
  ordem     int not null,
  tipo      text not null default 'aberta' check (tipo in ('aberta', 'ganho', 'perdido')),
  sla_dias  int check (sla_dias is null or sla_dias > 0), -- dias parado até ficar vermelho
  ativo     boolean not null default true,
  unique (funil_id, nome),
  unique (id, funil_id)
);

create table if not exists vendas_oportunidades (
  id                 uuid primary key default gen_random_uuid(),
  unidade            text not null default 'comauto' references unidades (chave),
  funil_id           uuid not null,
  etapa_id           uuid not null,
  cliente_id         uuid not null references clientes (id) on delete cascade,
  vendedor_id        uuid references usuarios (user_id) on delete set null,
  -- interesse (qualificação separada da etapa — decisão do consenso)
  veiculo_interesse  text,
  valor_estimado     numeric(12, 2) check (valor_estimado is null or valor_estimado >= 0),
  pagamento          text not null default 'indefinido'
                     check (pagamento in ('a_vista', 'financiamento', 'consorcio', 'indefinido')),
  canal_venda        text check (canal_venda in ('varejo', 'venda_direta')), -- Novos (Processo de Vendas)
  tem_troca          boolean not null default false,
  troca_descricao    text,                        -- usado oferecido na troca (separado do que quer comprar)
  prazo_compra       text not null default 'indefinido'
                     check (prazo_compra in ('imediato', 'ate_30_dias', 'ate_90_dias', 'sem_prazo', 'indefinido')),
  temperatura        text not null default 'morno' check (temperatura in ('frio', 'morno', 'quente')),
  qualificacao       text not null default 'a_verificar'
                     check (qualificacao in ('a_verificar', 'confirmado_cliente', 'qualificado', 'desqualificado')),
  origem             text not null default 'painel', -- painel | whatsapp | qr | campanha | evento | importacao
  origem_ref         text,                           -- código do link/QR, id da campanha...
  entrou_na_etapa_em timestamptz not null default now(),
  posicao            double precision not null default 0, -- ordem do cartão dentro da coluna
  motivo_perda       text,
  fechado_em         timestamptz,
  ids_externos       jsonb not null default '{}',     -- {processo_vendas, avaliex}
  observacoes        text,
  criado_por         text not null,
  atualizado_por     text,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint vendas_op_funil_mesma_unidade foreign key (funil_id, unidade) references vendas_funis (id, unidade),
  constraint vendas_op_etapa_do_funil      foreign key (etapa_id, funil_id) references vendas_etapas (id, funil_id)
);
create index if not exists vendas_op_etapa_idx    on vendas_oportunidades (etapa_id, posicao);
create index if not exists vendas_op_vendedor_idx on vendas_oportunidades (vendedor_id) where fechado_em is null;
create index if not exists vendas_op_cliente_idx  on vendas_oportunidades (cliente_id);
create index if not exists vendas_op_unidade_idx  on vendas_oportunidades (unidade, funil_id);

-- Histórico de etapas (F8). Uma linha na criação (de = null) e uma a cada mudança de etapa.
create table if not exists vendas_historico (
  id              bigint generated always as identity primary key,
  oportunidade_id uuid not null references vendas_oportunidades (id) on delete cascade,
  unidade         text not null references unidades (chave),
  funil_id        uuid not null,
  de_etapa_id     uuid references vendas_etapas (id) on delete set null,
  para_etapa_id   uuid references vendas_etapas (id) on delete set null,
  vendedor_id     uuid,
  ator            text not null,
  dias_na_etapa   numeric(10, 2),  -- quanto tempo ficou na etapa anterior
  criado_em       timestamptz not null default now()
);
alter table vendas_historico add column if not exists motivo_perda text; -- F1-V-005: motivo de cada perda, mesmo se reaberta depois
create index if not exists vendas_hist_op_idx   on vendas_historico (oportunidade_id, criado_em);
create index if not exists vendas_hist_funil_idx on vendas_historico (funil_id, criado_em);

create table if not exists vendas_atividades (
  id              uuid primary key default gen_random_uuid(),
  oportunidade_id uuid not null references vendas_oportunidades (id) on delete cascade,
  tipo            text not null check (tipo in ('ligacao', 'whatsapp', 'visita', 'test_drive', 'proposta', 'nota', 'email')),
  descricao       text not null check (length(descricao) between 1 and 2000),
  ator            text not null,
  criado_em       timestamptz not null default now()
);
create index if not exists vendas_ativ_op_idx on vendas_atividades (oportunidade_id, criado_em desc);

create table if not exists vendas_tarefas (
  id              uuid primary key default gen_random_uuid(),
  oportunidade_id uuid not null references vendas_oportunidades (id) on delete cascade,
  responsavel_id  uuid references usuarios (user_id) on delete set null,
  titulo          text not null check (length(titulo) between 1 and 200),
  prazo           timestamptz not null,
  concluida_em    timestamptz,
  criado_por      text not null,
  criado_em       timestamptz not null default now()
);
create index if not exists vendas_tarefas_resp_idx on vendas_tarefas (responsavel_id, concluida_em, prazo);

-- ---------------------------------------------------------------------
-- Regras de etapa no banco (valem para o painel, para o chatbot e para qualquer integração)
-- ---------------------------------------------------------------------
create or replace function vendas_regras_etapa() returns trigger
language plpgsql set search_path = public as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo from vendas_etapas where id = new.etapa_id;

  if v_tipo = 'perdido' and coalesce(btrim(new.motivo_perda), '') = '' then
    raise exception 'Informe o motivo da perda' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    new.entrou_na_etapa_em := now();
    -- F1-V-005: o desfecho vigente é o da transição atual (Perdido → Ganho fecha de novo, hoje).
    -- O motivo da perda anterior fica guardado em vendas_historico.
    if v_tipo = 'ganho' then
      new.fechado_em := now();
      new.motivo_perda := null;
    elsif v_tipo = 'perdido' then
      new.fechado_em := now();
    else
      new.fechado_em := null;     -- reaberta
      new.motivo_perda := null;
    end if;
  end if;

  new.atualizado_em := now();
  return new;
end $$;

create or replace function vendas_registrar_historico() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into vendas_historico (oportunidade_id, unidade, funil_id, de_etapa_id, para_etapa_id, vendedor_id, ator, motivo_perda)
    values (new.id, new.unidade, new.funil_id, null, new.etapa_id, new.vendedor_id, new.criado_por, new.motivo_perda); -- F1-V-005-R1
  elsif new.etapa_id is distinct from old.etapa_id then
    insert into vendas_historico (oportunidade_id, unidade, funil_id, de_etapa_id, para_etapa_id, vendedor_id, ator, dias_na_etapa, motivo_perda)
    values (new.id, new.unidade, new.funil_id, old.etapa_id, new.etapa_id, new.vendedor_id,
            coalesce(new.atualizado_por, 'sistema'),
            round((extract(epoch from (now() - old.entrou_na_etapa_em)) / 86400)::numeric, 2),
            new.motivo_perda);  -- só preenchido quando a transição é para Perdido
  end if;
  return null;
end $$;

drop trigger if exists vendas_op_regras on vendas_oportunidades;
create trigger vendas_op_regras before insert or update on vendas_oportunidades
  for each row execute function vendas_regras_etapa();

drop trigger if exists vendas_op_historico on vendas_oportunidades;
create trigger vendas_op_historico after insert or update of etapa_id on vendas_oportunidades
  for each row execute function vendas_registrar_historico();

-- ---------------------------------------------------------------------
-- F1-V-005-R1: ajuste ÚNICO dos registros gravados antes da correção (idempotente: só toca o que está incoerente)
-- ---------------------------------------------------------------------
-- (a) perda vigente sem motivo no evento de entrada em Perdido → copia o motivo vigente para o histórico
update vendas_historico h set motivo_perda = o.motivo_perda
from vendas_oportunidades o
join vendas_etapas e on e.id = o.etapa_id and e.tipo = 'perdido'
where h.oportunidade_id = o.id and h.motivo_perda is null and o.motivo_perda is not null
  and h.id = (select max(h2.id) from vendas_historico h2 where h2.oportunidade_id = o.id and h2.para_etapa_id = o.etapa_id);

-- (b) ganha depois de perdida (antes da correção ficava com o motivo vigente): leva o motivo para o último evento de perda
update vendas_historico h set motivo_perda = o.motivo_perda
from vendas_oportunidades o
join vendas_etapas e on e.id = o.etapa_id and e.tipo = 'ganho'
where h.oportunidade_id = o.id and h.motivo_perda is null and o.motivo_perda is not null
  and h.id = (select max(h2.id) from vendas_historico h2 join vendas_etapas e2 on e2.id = h2.para_etapa_id
              where h2.oportunidade_id = o.id and e2.tipo = 'perdido');
update vendas_oportunidades o set motivo_perda = null
from vendas_etapas e
where e.id = o.etapa_id and e.tipo = 'ganho' and o.motivo_perda is not null;

-- (c) fechamento = último evento de entrada na etapa final atual (ganho/perdido)
update vendas_oportunidades o
set fechado_em = (select max(h.criado_em) from vendas_historico h where h.oportunidade_id = o.id and h.para_etapa_id = o.etapa_id)
where exists (select 1 from vendas_etapas e where e.id = o.etapa_id and e.tipo in ('ganho', 'perdido'))
  and exists (select 1 from vendas_historico h where h.oportunidade_id = o.id and h.para_etapa_id = o.etapa_id)
  and o.fechado_em is distinct from (select max(h.criado_em) from vendas_historico h where h.oportunidade_id = o.id and h.para_etapa_id = o.etapa_id);

-- ---------------------------------------------------------------------
-- Funis e etapas padrão da Comauto (configuráveis depois pelo painel)
-- ---------------------------------------------------------------------
insert into vendas_funis (unidade, chave, nome, ordem) values
  ('comauto', 'novos', 'Novos', 1),
  ('comauto', 'seminovos', 'Seminovos', 2)
on conflict (unidade, chave) do nothing;

insert into vendas_etapas (funil_id, nome, ordem, tipo, sla_dias)
select f.id, e.nome, e.ordem, e.tipo, e.sla
from vendas_funis f
cross join (values
  ('Novo', 1, 'aberta', 1),
  ('Em atendimento', 2, 'aberta', 3),
  ('Qualificado', 3, 'aberta', 5),
  ('Negociação', 4, 'aberta', 7),
  ('Proposta', 5, 'aberta', 7),
  ('Ganho', 6, 'ganho', null),
  ('Perdido', 7, 'perdido', null)
) as e (nome, ordem, tipo, sla)
-- F1-V-007: semeia só os funis padrão que ainda não têm etapa nenhuma (não recria etapa renomeada
-- nem invade funil personalizado quando a migration é reaplicada)
where f.unidade = 'comauto' and f.chave in ('novos', 'seminovos')
  and not exists (select 1 from vendas_etapas x where x.funil_id = f.id)
on conflict (funil_id, nome) do nothing;

-- ---------------------------------------------------------------------
-- Métricas (F8, base): conversão por etapa e tempo médio — lidas só pelo servidor
-- ---------------------------------------------------------------------
create or replace function vendas_funil_resumo(p_funil uuid, p_desde timestamptz)
returns table (etapa_id uuid, nome text, ordem int, tipo text, abertas bigint, alcancaram bigint, valor_aberto numeric, dias_medios numeric)
language sql stable set search_path = public as $$
  -- F1-V-006: coorte = quem ENTROU no funil desde p_desde (oportunidade antiga movida hoje não entra).
  -- Etapas abertas: quantos da coorte chegaram até ali (maior etapa não-perdida alcançada).
  -- Ganho/Perdido: desfecho ATUAL de cada oportunidade da coorte (reaberta e ganha conta só como ganha).
  with coorte as (
    select id, etapa_id from vendas_oportunidades where funil_id = p_funil and criado_em >= p_desde
  ),
  alcance as (
    select h.oportunidade_id, max(e2.ordem) filter (where e2.tipo <> 'perdido') as max_ordem
    from vendas_historico h
    join vendas_etapas e2 on e2.id = h.para_etapa_id
    where h.oportunidade_id in (select id from coorte)
    group by h.oportunidade_id
  )
  select e.id, e.nome, e.ordem, e.tipo,
         (select count(*) from vendas_oportunidades o where o.etapa_id = e.id and o.fechado_em is null),
         case when e.tipo = 'aberta'
              then (select count(*) from alcance a where a.max_ordem >= e.ordem)
              else (select count(*) from coorte c where c.etapa_id = e.id)
         end,
         (select coalesce(sum(o.valor_estimado), 0) from vendas_oportunidades o where o.etapa_id = e.id and o.fechado_em is null),
         (select round(avg(h.dias_na_etapa), 1) from vendas_historico h where h.de_etapa_id = e.id and h.criado_em >= p_desde)
  from vendas_etapas e
  where e.funil_id = p_funil and e.ativo
  order by e.ordem;
$$;

-- ---------------------------------------------------------------------
-- RLS: fechado, acesso só pelo servidor (igual ao núcleo)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vendas_funis','vendas_etapas','vendas_oportunidades','vendas_historico','vendas_atividades','vendas_tarefas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;
revoke all on function vendas_funil_resumo(uuid, timestamptz) from public, anon, authenticated;

-- F1-V-004: grants explícitos para o servidor (service_role), sem depender dos grants implícitos
-- antigos do Supabase. O navegador (anon/authenticated) continua sem acesso nenhum.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on vendas_funis, vendas_etapas, vendas_oportunidades,
      vendas_historico, vendas_atividades, vendas_tarefas to service_role;
    grant execute on function vendas_funil_resumo(uuid, timestamptz) to service_role;
  end if;
end $$;
