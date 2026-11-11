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
-- F1-V-T003: transferência atômica — troca de responsável, carteira e nota na MESMA transação.
-- Posse conferida na gravação (p_de = responsável que a tela viu) e escopo de unidade repetido.
-- A nota diz a verdade sobre a carteira: movida, mantida (cliente de outro vendedor) ou não pedida.
-- ---------------------------------------------------------------------
create or replace function vendas_transferir(
  p_id uuid, p_de uuid, p_para uuid, p_unidades text[], p_so_abertas boolean,
  p_mover_carteira boolean, p_ator text, p_descricao text
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_cliente uuid;
  v_carteira boolean := false;
begin
  update vendas_oportunidades
     set vendedor_id = p_para, atualizado_por = p_ator
   where id = p_id
     and unidade = any (p_unidades)
     and vendedor_id is not distinct from p_de
     and (not p_so_abertas or fechado_em is null)
  returning cliente_id into v_cliente;
  if v_cliente is null then
    return jsonb_build_object('ok', false);
  end if;

  if p_mover_carteira then
    -- só move se a carteira estava com o responsável anterior (ou vazia): nunca tira cliente de terceiro
    update clientes set vendedor_id = p_para
     where id = v_cliente and (vendedor_id is null or vendedor_id is not distinct from p_de);
    v_carteira := found;
  end if;

  insert into vendas_atividades (oportunidade_id, tipo, descricao, ator)
  values (p_id, 'nota', left(p_descricao || case
            when v_carteira then ' · carteira do cliente também'
            when p_mover_carteira then ' · carteira mantida (cliente é de outro vendedor)'
            else '' end, 2000), p_ator);

  return jsonb_build_object('ok', true, 'cliente_id', v_cliente, 'carteira', v_carteira);
end;
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
revoke all on function vendas_transferir(uuid, uuid, uuid, text[], boolean, boolean, text, text) from public, anon, authenticated;

-- F1-V-004: grants explícitos para o servidor (service_role), sem depender dos grants implícitos
-- antigos do Supabase. O navegador (anon/authenticated) continua sem acesso nenhum.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on vendas_funis, vendas_etapas, vendas_oportunidades,
      vendas_historico, vendas_atividades, vendas_tarefas to service_role;
    grant execute on function vendas_funil_resumo(uuid, timestamptz) to service_role;
    grant execute on function vendas_transferir(uuid, uuid, uuid, text[], boolean, boolean, text, text) to service_role;
  end if;
end $$;

-- APÊNDICE CONSOLIDADO: F5 e proveniência do bot
-- Reaplicar o módulo completo em uma transação; não renumera histórico do banco.

-- F5: conclusão explícita e idempotente do contato de aniversário.
-- Não depende de mensagens, notas administrativas ou do fuso do servidor.
create table if not exists public.aniversarios_contatos (
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  data_alvo date not null check (pg_catalog.isfinite(data_alvo)),
  ator_id uuid not null, -- autoria preservada após remoção do usuário
  unidade text not null references public.unidades (chave),
  criado_em timestamptz not null default now(),
  primary key (cliente_id, data_alvo)
);
create index if not exists aniversarios_contatos_unidade_data_idx
  on public.aniversarios_contatos (unidade, data_alvo);

alter table public.aniversarios_contatos enable row level security;
revoke all on table public.aniversarios_contatos from public, anon, authenticated, service_role;
grant select on table public.aniversarios_contatos to service_role;
grant insert (cliente_id, data_alvo, ator_id, unidade)
  on public.aniversarios_contatos to service_role;

-- SECURITY INVOKER: as operações funcionam sem os defaults antigos do Supabase.
grant select (id, nome, telefone, data_nascimento, vendedor_id, unidade_origem, anonimizado)
  on public.clientes to service_role;
grant select (user_id, nome, papel, setor, unidade, ativo) on public.usuarios to service_role;
grant select (user_id, unidade) on public.usuario_unidades to service_role;
grant select (chave, ativa) on public.unidades to service_role;
grant select (id, usuario_id, cliente_id, tipo, data_alvo, concluido_em, insistente, unidade)
  on public.lembretes to service_role;
grant insert (usuario_id, cliente_id, tipo, data_alvo, insistente, unidade, observacao)
  on public.lembretes to service_role;
grant update (insistente, concluido_em, unidade) on public.lembretes to service_role;
grant insert (cliente_id, autor, texto) on public.notas_cliente to service_role;
grant insert (ator, acao, entidade, entidade_id, dados) on public.audit_log to service_role;
-- Leitura F5: só metadados que comprovam contato, sem conteúdo das mensagens.
grant select (id, cliente_id) on public.vendas_oportunidades to service_role;
grant select (id, oportunidade_id, tipo, ator, criado_em) on public.vendas_atividades to service_role;
grant select (id, cliente_id, criado_em, status, direcao, autor) on public.mensagens to service_role;

create or replace function public.registrar_contato_aniversario(
  p_cliente_id uuid, p_ator uuid, p_unidades text[], p_data date, p_autor text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  inserido uuid;
  agora timestamptz := now();
begin
  if p_cliente_id is null or p_ator is null or p_data is null or not pg_catalog.isfinite(p_data)
    or p_autor is null or char_length(p_autor) not between 1 and 320
    or p_autor ~ '^[[:space:]]|[[:space:]]$' then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aniversario:' || p_cliente_id::text || ':' || p_data::text, 0));

  select un.chave into unidade_atual
  from public.clientes c
  left join public.usuarios dono on dono.user_id = c.vendedor_id
  join public.unidades un on un.chave = coalesce(dono.unidade, c.unidade_origem) and un.ativa
  join public.usuarios ator on ator.user_id = p_ator and ator.ativo
  where c.id = p_cliente_id and not c.anonimizado
    and c.data_nascimento is not null and pg_catalog.isfinite(c.data_nascimento)
    and p_data >= c.data_nascimento
    and extract(month from p_data) = extract(month from c.data_nascimento)
    and extract(day from p_data) = case
      when extract(month from c.data_nascimento) = 2 and extract(day from c.data_nascimento) = 29
        and not ((extract(year from p_data)::integer % 4 = 0 and extract(year from p_data)::integer % 100 <> 0)
          or extract(year from p_data)::integer % 400 = 0) then 28
      else extract(day from c.data_nascimento) end
    -- Administrador atravessa as unidades ativas; os demais precisam dos dois vínculos.
    and (ator.papel = 'admin'
      or (un.chave = any (p_unidades)
        and (ator.unidade = un.chave or exists (
          select 1 from public.usuario_unidades uu where uu.user_id = ator.user_id and uu.unidade = un.chave
        ))
        and ((ator.papel = 'gerente' and ator.setor in ('vendas', 'administracao'))
          or (ator.papel = 'vendedor' and c.vendedor_id = ator.user_id))));
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'fora_da_carteira_ou_unidade');
  end if;

  insert into public.aniversarios_contatos (cliente_id, data_alvo, ator_id, unidade)
  values (p_cliente_id, p_data, p_ator, unidade_atual)
  on conflict (cliente_id, data_alvo) do nothing
  returning cliente_id into inserido;
  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'ja_registrado', true);
  end if;

  update public.lembretes set concluido_em = agora
  where cliente_id = p_cliente_id and tipo = 'aniversario' and data_alvo = p_data
    and concluido_em is null;

  insert into public.notas_cliente (cliente_id, autor, texto)
  values (p_cliente_id, p_autor, 'Contato de aniversário feito (' || pg_catalog.to_char(p_data, 'DD/MM/YYYY') || ').');
  insert into public.audit_log (ator, acao, entidade, entidade_id, dados)
  values (p_autor, 'aniversario_contato', 'cliente', p_cliente_id::text,
    pg_catalog.jsonb_build_object('data_alvo', p_data::text, 'ator_id', p_ator, 'unidade', unidade_atual));

  return pg_catalog.jsonb_build_object('ok', true, 'ja_registrado', false);
end $$;

create or replace function public.ativar_lembrete_aniversario(
  p_cliente_id uuid, p_ator uuid, p_unidades text[], p_data date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
begin
  if p_cliente_id is null or p_ator is null or p_data is null or not pg_catalog.isfinite(p_data) then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aniversario:' || p_cliente_id::text || ':' || p_data::text, 0));

  select un.chave into unidade_atual
  from public.clientes c
  left join public.usuarios dono on dono.user_id = c.vendedor_id
  join public.unidades un on un.chave = coalesce(dono.unidade, c.unidade_origem) and un.ativa
  join public.usuarios ator on ator.user_id = p_ator and ator.ativo
  where c.id = p_cliente_id and not c.anonimizado
    and c.data_nascimento is not null and pg_catalog.isfinite(c.data_nascimento)
    and p_data >= c.data_nascimento
    and extract(month from p_data) = extract(month from c.data_nascimento)
    and extract(day from p_data) = case
      when extract(month from c.data_nascimento) = 2 and extract(day from c.data_nascimento) = 29
        and not ((extract(year from p_data)::integer % 4 = 0 and extract(year from p_data)::integer % 100 <> 0)
          or extract(year from p_data)::integer % 400 = 0) then 28
      else extract(day from c.data_nascimento) end
    and (ator.papel = 'admin'
      or (un.chave = any (p_unidades)
        and (ator.unidade = un.chave or exists (
          select 1 from public.usuario_unidades uu where uu.user_id = ator.user_id and uu.unidade = un.chave
        ))
        and ((ator.papel = 'gerente' and ator.setor in ('vendas', 'administracao'))
          or (ator.papel = 'vendedor' and c.vendedor_id = ator.user_id))));
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'fora_da_carteira_ou_unidade');
  end if;

  if exists (select 1 from public.aniversarios_contatos where cliente_id = p_cliente_id and data_alvo = p_data) then
    return pg_catalog.jsonb_build_object('ok', true);
  end if;

  update public.lembretes set insistente = true, unidade = unidade_atual
  where cliente_id = p_cliente_id and usuario_id = p_ator and tipo = 'aniversario'
    and data_alvo = p_data and concluido_em is null;
  if not found then
    insert into public.lembretes (usuario_id, cliente_id, tipo, data_alvo, insistente, unidade, observacao)
    values (p_ator, p_cliente_id, 'aniversario', p_data, true, unidade_atual, 'Lembrete de aniversário');
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end $$;

revoke all on function public.registrar_contato_aniversario(uuid, uuid, text[], date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ativar_lembrete_aniversario(uuid, uuid, text[], date)
  from public, anon, authenticated, service_role;
grant execute on function public.registrar_contato_aniversario(uuid, uuid, text[], date, text) to service_role;
grant execute on function public.ativar_lembrete_aniversario(uuid, uuid, text[], date) to service_role;

-- Primitivos compartilhados necessários à FK do ledger de Vendas, antes de 0006.
-- A FK também protege contra mudanças posteriores de autor, direção ou classificação
-- interna. Metadata de processamento, status e redação de conteúdo continuam editáveis.
alter table public.mensagens add column if not exists entrada_cliente_externa boolean
  generated always as (
    direcao = 'entrada' and autor = 'cliente'
    and coalesce(metadata -> 'interno', 'false'::jsonb) = 'false'::jsonb
  ) stored;
create unique index if not exists mensagens_prova_atendimento_idx
  on public.mensagens(id, conversa_id, cliente_id, wamid, entrada_cliente_externa);

-- A1.1c: qualificação e proveniência de Vendas na mesma transação.
-- Depende de 0001/0002/0003 e da coluna gerada de 20261111142602.
-- O código de marketing continua em origem_ref; a mensagem real fica neste ledger.
create unique index if not exists vendas_op_prova_bot_idx
  on public.vendas_oportunidades(id, cliente_id, unidade, funil_id);
create table if not exists public.vendas_encaminhamentos_bot (
  referencia text primary key check (char_length(referencia) between 1 and 512
    and referencia !~ '^[[:space:]]|[[:space:]]$'),
  mensagem_id uuid not null unique,
  conversa_id uuid not null,
  cliente_id uuid not null,
  unidade text not null,
  oportunidade_id uuid not null,
  funil_id uuid not null,
  novo boolean not null,
  entrada_cliente_externa boolean not null default true check (entrada_cliente_externa),
  criado_em timestamptz not null default now(),
  foreign key(mensagem_id, conversa_id, cliente_id, referencia, entrada_cliente_externa)
    references public.mensagens(id, conversa_id, cliente_id, wamid, entrada_cliente_externa) on delete restrict,
  foreign key(oportunidade_id, cliente_id, unidade, funil_id)
    references public.vendas_oportunidades(id, cliente_id, unidade, funil_id) on delete restrict
);
create index if not exists vendas_encaminhamentos_op_idx
  on public.vendas_encaminhamentos_bot(oportunidade_id, criado_em, referencia);
alter table public.vendas_encaminhamentos_bot enable row level security;
revoke all on public.vendas_encaminhamentos_bot from public, anon, authenticated, service_role;
grant select, insert on public.vendas_encaminhamentos_bot to service_role;
grant select (id, nome, vendedor_id, anonimizado, link_origem_id) on public.clientes to service_role;
grant update (vendedor_id) on public.clientes to service_role;
grant select (id, codigo, canal) on public.links_rastreados to service_role;
grant select (id, cliente_id, unidade) on public.conversas to service_role;
grant select (id, conversa_id, cliente_id, wamid, entrada_cliente_externa) on public.mensagens to service_role;
grant select (chave, ativa) on public.unidades to service_role;
grant select (user_id, papel, setor, unidade, ativo) on public.usuarios to service_role;
grant select (user_id, unidade) on public.usuario_unidades to service_role;
grant update (nome) on public.clientes, public.unidades, public.usuarios to service_role;
grant update (unidade) on public.usuario_unidades to service_role;
grant update (status) on public.conversas, public.mensagens to service_role;
grant insert (usuario_id, unidade, tipo, titulo, corpo, link) on public.notificacoes to service_role;
grant insert (ator, acao, entidade, entidade_id, dados) on public.audit_log to service_role;
-- 0003 concede as tabelas Vendas; seu trigger de criação também usa a identidade.
grant usage on sequence public.vendas_historico_id_seq to service_role;

create or replace function public.registrar_lead_vendas_bot(
  p_conversa_id uuid, p_cliente_id uuid, p_referencia text, p_funil text,
  p_modelo text, p_pagamento text, p_prazo text, p_tem_troca boolean,
  p_troca_descricao text, p_resumo text, p_cliente_confirmou boolean
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  loja text;
  funil uuid;
  primeira uuid;
  cliente record;
  pessoa record;
  op public.vendas_oportunidades%rowtype;
  anterior public.vendas_encaminhamentos_bot%rowtype;
  mensagem uuid;
  vendedores uuid[] := array[]::uuid[];
  supervisores uuid[] := array[]::uuid[];
  admins uuid[] := array[]::uuid[];
  destinatarios uuid[];
  dono uuid;
  nova boolean;
  origem text := 'whatsapp';
  codigo text;
  canal text;
  temperatura text;
begin
  if p_conversa_id is null or p_cliente_id is null or p_referencia is null
    or char_length(p_referencia) not between 1 and 512 or p_referencia ~ '^[[:space:]]|[[:space:]]$'
    or p_funil is null or p_funil not in ('novos', 'seminovos')
    or p_pagamento is null or p_pagamento not in ('a_vista', 'financiamento', 'consorcio', 'indefinido')
    or p_prazo is null or p_prazo not in ('imediato', 'ate_30_dias', 'ate_90_dias', 'sem_prazo', 'indefinido')
    or p_cliente_confirmou is null or p_resumo is null or char_length(p_resumo) not between 1 and 300
    or p_resumo ~ '^[[:space:]]|[[:space:]]$'
    or (p_modelo is not null and (char_length(p_modelo) not between 1 and 120 or p_modelo ~ '^[[:space:]]|[[:space:]]$'))
    or (p_troca_descricao is not null and (char_length(p_troca_descricao) not between 1 and 300 or p_troca_descricao ~ '^[[:space:]]|[[:space:]]$')) then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vendas_bot_ref:' || p_referencia, 0));
  -- Primeira leitura só resolve IDs. Travas definitivas seguem domínio -> cliente -> canal,
  -- compatíveis com abertura/claim A1; não adquirir SHARE no canal antes de FOR UPDATE.
  select c.unidade into loja from public.conversas c where c.id = p_conversa_id and c.cliente_id = p_cliente_id;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'contexto_indisponivel'); end if;
  select f.id into funil from public.vendas_funis f where f.unidade = loja and f.chave = p_funil and f.ativo;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'funil_indisponivel'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vendas_bot_cliente_funil:' || p_cliente_id::text || ':' || funil::text, 0));
  select o.* into op from public.vendas_oportunidades o where o.cliente_id = p_cliente_id
    and o.funil_id = funil and o.unidade = loja and o.fechado_em is null
    order by o.criado_em desc, o.id limit 1 for update;
  nova := not found;
  select c.id, c.nome, c.vendedor_id, c.link_origem_id into cliente from public.clientes c
    where c.id = p_cliente_id and not c.anonimizado for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'cliente_indisponivel'); end if;
  perform 1 from public.unidades u where u.chave = loja and u.ativa for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'unidade_indisponivel'); end if;
  perform 1 from public.vendas_funis f where f.id = funil and f.unidade = loja and f.chave = p_funil and f.ativo for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'funil_indisponivel'); end if;
  perform 1 from public.conversas c where c.id = p_conversa_id and c.cliente_id = p_cliente_id and c.unidade = loja for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'contexto_alterado'); end if;
  select m.id into mensagem from public.mensagens m where m.wamid = p_referencia
    and m.conversa_id = p_conversa_id and m.cliente_id = p_cliente_id and m.entrada_cliente_externa for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'mensagem_indisponivel'); end if;
  select e.* into anterior from public.vendas_encaminhamentos_bot e where e.referencia = p_referencia;
  if found then
    if anterior.conversa_id <> p_conversa_id or anterior.cliente_id <> p_cliente_id
      or anterior.unidade <> loja or anterior.funil_id <> funil or anterior.mensagem_id <> mensagem then
      return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'referencia_conflitante');
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'oportunidade_id', anterior.oportunidade_id,
      'novo', anterior.novo, 'ja_registrado', true);
  end if;

  -- A carga é global por vendedor: chamadas do bot em unidades diferentes também
  -- compartilham esta trava, pois a mesma pessoa pode atuar em unidades adicionais.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vendas_bot_rodizio', 0));
  for pessoa in select u.user_id, u.papel, u.setor, u.unidade from public.usuarios u
    where u.ativo and (u.papel in ('vendedor', 'admin')
      or (u.papel = 'gerente' and u.setor in ('vendas', 'administracao')))
      and (u.papel = 'admin' or u.unidade = loja or exists (
        select 1 from public.usuario_unidades uu where uu.user_id = u.user_id and uu.unidade = loja))
    order by u.user_id for share
  loop
    if pessoa.papel <> 'admin' and pessoa.unidade <> loja then
      perform 1 from public.usuario_unidades uu where uu.user_id = pessoa.user_id and uu.unidade = loja for share;
      if not found then continue; end if;
    end if;
    if pessoa.papel = 'vendedor' then vendedores := pg_catalog.array_append(vendedores, pessoa.user_id);
    elsif pessoa.papel = 'admin' then admins := pg_catalog.array_append(admins, pessoa.user_id);
    else supervisores := pg_catalog.array_append(supervisores, pessoa.user_id); end if;
  end loop;
  if nova then
    if cliente.vendedor_id = any(vendedores) then dono := cliente.vendedor_id;
    else
      select v.id into dono from pg_catalog.unnest(vendedores) v(id)
        left join public.vendas_oportunidades o on o.vendedor_id = v.id and o.fechado_em is null
        group by v.id order by count(o.id), max(o.criado_em) nulls first, v.id limit 1;
    end if;
  else dono := op.vendedor_id; end if;
  if dono = any(vendedores || supervisores || admins) then destinatarios := array[dono];
  elsif pg_catalog.cardinality(supervisores) > 0 then destinatarios := supervisores;
  else destinatarios := admins; end if;
  if pg_catalog.cardinality(destinatarios) = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'equipe_indisponivel');
  end if;

  if nova then
    select e.id into primeira from public.vendas_etapas e where e.funil_id = funil
      and e.tipo = 'aberta' and e.ativo order by e.ordem, e.id limit 1 for share;
    if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'funil_sem_etapas'); end if;
    if cliente.link_origem_id is not null then
      select l.codigo, l.canal into codigo, canal from public.links_rastreados l where l.id = cliente.link_origem_id;
      if found then origem := case when canal = 'evento' then 'evento' else 'qr' end; end if;
    end if;
    temperatura := case when p_prazo = 'imediato' or (p_prazo = 'ate_30_dias' and p_pagamento <> 'indefinido') then 'quente'
      when p_prazo = 'sem_prazo' then 'frio' else 'morno' end;
    insert into public.vendas_oportunidades(unidade, funil_id, etapa_id, cliente_id, vendedor_id,
      veiculo_interesse, pagamento, prazo_compra, tem_troca, troca_descricao, qualificacao,
      temperatura, origem, origem_ref, observacoes, posicao, criado_por)
      values(loja, funil, primeira, p_cliente_id, dono, p_modelo, p_pagamento, p_prazo,
        coalesce(p_tem_troca, false), case when p_tem_troca then p_troca_descricao end,
        case when p_cliente_confirmou then 'confirmado_cliente' else 'a_verificar' end,
        temperatura, origem, codigo, p_resumo, extract(epoch from now()), 'assistente') returning * into op;
    if dono is not null and cliente.vendedor_id is null then
      update public.clientes c set vendedor_id = dono where c.id = p_cliente_id and c.vendedor_id is null;
    end if;
  else
    -- Mesmo contrato de completarQualificacao: dados indefinidos não apagam o concreto;
    -- qualificado/desqualificado são decisões do vendedor e não são rebaixadas pelo bot.
    update public.vendas_oportunidades o set atualizado_por = 'assistente',
      veiculo_interesse = coalesce(p_modelo, o.veiculo_interesse),
      pagamento = case when p_pagamento <> 'indefinido' then p_pagamento else o.pagamento end,
      prazo_compra = case when p_prazo <> 'indefinido' then p_prazo else o.prazo_compra end,
      tem_troca = coalesce(p_tem_troca, o.tem_troca),
      troca_descricao = case when p_tem_troca is false then null
        when p_tem_troca is true then coalesce(p_troca_descricao, o.troca_descricao) else o.troca_descricao end,
      qualificacao = case when p_cliente_confirmou and o.qualificacao = 'a_verificar' then 'confirmado_cliente' else o.qualificacao end
      where o.id = op.id returning * into op;
  end if;
  insert into public.vendas_atividades(oportunidade_id, tipo, descricao, ator)
    values(op.id, 'whatsapp', case when nova then 'Lead qualificado pelo assistente: ' else 'Assistente atualizou o interesse: ' end || p_resumo, 'assistente');
  insert into public.notificacoes(usuario_id, unidade, tipo, titulo, corpo, link)
    select d, loja, 'lead', pg_catalog.left(case when nova
      then 'Novo lead (' || case when p_funil = 'novos' then 'Novos' else 'Seminovos' end || '): ' || coalesce(cliente.nome, 'Cliente')
      else coalesce(cliente.nome, 'Cliente') || ' voltou a falar no WhatsApp' end, 140),
      p_resumo, '/painel/vendas?funil=' || p_funil || '&op=' || op.id::text
      from pg_catalog.unnest(destinatarios) d;
  insert into public.audit_log(ator, acao, entidade, entidade_id, dados)
    values('assistente', case when nova then 'criar_lead' else 'atualizar_lead' end, 'vendas_oportunidades', op.id::text,
      pg_catalog.jsonb_build_object('funil', p_funil, 'origem', op.origem, 'com_dono', op.vendedor_id is not null, 'referencia', p_referencia));
  insert into public.vendas_encaminhamentos_bot(referencia, mensagem_id, conversa_id, cliente_id,
    unidade, oportunidade_id, funil_id, novo) values(p_referencia, mensagem, p_conversa_id,
      p_cliente_id, loja, op.id, funil, nova);
  return pg_catalog.jsonb_build_object('ok', true, 'oportunidade_id', op.id, 'novo', nova, 'ja_registrado', false);
end $$;
revoke all on function public.registrar_lead_vendas_bot(uuid, uuid, text, text, text, text, text, boolean, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.registrar_lead_vendas_bot(uuid, uuid, text, text, text, text, text, boolean, text, text, boolean) to service_role;
