-- Fila de cotações de Peças por unidade e histórico das etapas.
create table if not exists public.pecas_cotacoes (
  id uuid primary key default gen_random_uuid(),
  unidade text not null default 'comauto' references public.unidades (chave),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  veiculo_id uuid references public.veiculos (id) on delete set null,
  origem text not null default 'balcao',
  descricao text not null check (
    char_length(descricao) between 1 and 1000
    and descricao !~ '^[[:space:]]|[[:space:]]$'
  ),
  status text not null default 'novo' check (status in (
    'novo', 'em_cotacao', 'aguardando_cliente', 'aprovado',
    'em_separacao', 'entregue', 'perdido', 'cancelado'
  )),
  criado_por uuid references public.usuarios (user_id) on delete set null,
  criado_em timestamptz not null default now()
);

-- Mantém compatibilidade com as versões locais anteriores da migration.
alter table public.pecas_cotacoes
  add column if not exists origem_ref text,
  add column if not exists responsavel_id uuid references public.usuarios (user_id) on delete set null,
  add column if not exists venda_confirmada_em timestamptz,
  -- Autoria histórica preservada mesmo depois de remover o usuário.
  add column if not exists venda_confirmada_por uuid,
  add column if not exists tipo_preparo text check (tipo_preparo in ('separacao', 'encomenda')),
  add column if not exists proxima_acao text check (
    char_length(proxima_acao) between 1 and 500
    and proxima_acao !~ '^[[:space:]]|[[:space:]]$'
  ),
  add column if not exists prazo date,
  add column if not exists acompanhamento_versao integer not null default 0 check (acompanhamento_versao >= 0),
  -- Sem backfill com now(): registros antigos não ganham uma atualização fictícia.
  add column if not exists atualizado_em timestamptz,
  add column if not exists posicao numeric not null default 1000 check (posicao between -1000000000 and 1000000000),
  add column if not exists motivo_encerramento text check (
    char_length(motivo_encerramento) between 1 and 500
    and motivo_encerramento !~ '^[[:space:]]|[[:space:]]$'
  );

alter table public.pecas_cotacoes drop constraint if exists pecas_cotacoes_origem_check;
alter table public.pecas_cotacoes add constraint pecas_cotacoes_origem_check
  check (origem in ('balcao', 'oficina', 'whatsapp'));

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pecas_cotacoes'::regclass and conname = 'pecas_cotacoes_prazo_acao_check') then
    alter table public.pecas_cotacoes add constraint pecas_cotacoes_prazo_acao_check
      check (prazo is null or proxima_acao is not null);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pecas_cotacoes'::regclass and conname = 'pecas_cotacoes_encerramento_status_check') then
    alter table public.pecas_cotacoes add constraint pecas_cotacoes_encerramento_status_check
      check ((status in ('perdido', 'cancelado')) = (motivo_encerramento is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pecas_cotacoes'::regclass and conname = 'pecas_cotacoes_confirmacao_venda_check') then
    alter table public.pecas_cotacoes add constraint pecas_cotacoes_confirmacao_venda_check
      check ((venda_confirmada_em is null) = (venda_confirmada_por is null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pecas_cotacoes'::regclass and conname = 'pecas_cotacoes_referencia_whatsapp_check') then
    alter table public.pecas_cotacoes add constraint pecas_cotacoes_referencia_whatsapp_check
      check (origem <> 'whatsapp' or (origem_ref is not null and char_length(origem_ref) between 1 and 512
        and origem_ref !~ '^[[:space:]]|[[:space:]]$'));
  end if;
end $$;

create index if not exists pecas_cotacoes_unidade_criado_em_idx
  on public.pecas_cotacoes (unidade, criado_em desc);

create unique index if not exists pecas_cotacoes_referencia_whatsapp_idx
  on public.pecas_cotacoes (origem_ref)
  where origem = 'whatsapp';

alter table public.pecas_cotacoes enable row level security;
revoke all on table public.pecas_cotacoes from public, anon, authenticated, service_role;
grant select, insert on table public.pecas_cotacoes to service_role;
grant update (
  status, responsavel_id, venda_confirmada_em, venda_confirmada_por, tipo_preparo, motivo_encerramento,
  proxima_acao, prazo, acompanhamento_versao, posicao, atualizado_em
)
  on table public.pecas_cotacoes to service_role;

create table if not exists public.pecas_cotacoes_historico (
  id uuid primary key default gen_random_uuid(),
  cotacao_id uuid not null references public.pecas_cotacoes (id) on delete restrict,
  unidade text not null references public.unidades (chave),
  de_status text not null,
  para_status text not null,
  -- Preserva o identificador histórico mesmo se o usuário for removido.
  ator_id uuid not null,
  ocorrido_em timestamptz not null default now()
);

alter table public.pecas_cotacoes_historico
  add column if not exists responsavel_anterior_id uuid,
  add column if not exists responsavel_novo_id uuid;

create index if not exists pecas_cotacoes_historico_cotacao_idx
  on public.pecas_cotacoes_historico (cotacao_id, ocorrido_em desc);

alter table public.pecas_cotacoes_historico enable row level security;
revoke all on table public.pecas_cotacoes_historico from public, anon, authenticated, service_role;
grant insert on table public.pecas_cotacoes_historico to service_role;

create or replace function public.pecas_assumir_cotacao(p_id uuid, p_unidades text[], p_ator uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  status_atual text;
  status_destino text;
  responsavel_atual uuid;
begin
  select c.unidade, c.status, c.responsavel_id
  into unidade_atual, status_atual, responsavel_atual
  from public.pecas_cotacoes c
  where c.id = p_id and c.unidade = any (p_unidades)
    and c.status in ('novo', 'em_cotacao', 'aguardando_cliente', 'aprovado', 'em_separacao')
  for update;

  if not found then
    return false;
  end if;
  if not exists (
    select 1 from public.usuarios u
    join public.unidades un on un.chave = unidade_atual and un.ativa
    where u.user_id = p_ator and u.ativo
      and (u.papel in ('admin', 'pecas') or (u.papel = 'gerente' and u.setor in ('pecas', 'administracao')))
      and (u.papel = 'admin' or u.unidade = unidade_atual or exists (
        select 1 from public.usuario_unidades uu where uu.user_id = u.user_id and uu.unidade = unidade_atual
      ))
  ) then
    return false;
  end if;
  if responsavel_atual is not null and (responsavel_atual <> p_ator or status_atual <> 'novo') then
    return responsavel_atual = p_ator;
  end if;

  status_destino := case when status_atual = 'novo' then 'em_cotacao' else status_atual end;
  update public.pecas_cotacoes
  set status = status_destino, responsavel_id = p_ator
  where id = p_id;

  insert into public.pecas_cotacoes_historico (
    cotacao_id, unidade, de_status, para_status, ator_id, responsavel_anterior_id, responsavel_novo_id
  )
  values (p_id, unidade_atual, status_atual, status_destino, p_ator, responsavel_atual, p_ator);
  return true;
end $$;

revoke all on function public.pecas_assumir_cotacao(uuid, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_assumir_cotacao(uuid, text[], uuid) to service_role;

create or replace function public.pecas_reatribuir_cotacao(
  p_id uuid, p_unidades text[], p_ator uuid, p_responsavel uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  status_atual text;
  status_destino text;
  responsavel_atual uuid;
begin
  select c.unidade, c.status, c.responsavel_id
  into unidade_atual, status_atual, responsavel_atual
  from public.pecas_cotacoes c
  where c.id = p_id and c.unidade = any (p_unidades)
    and c.status in ('novo', 'em_cotacao', 'aguardando_cliente', 'aprovado', 'em_separacao')
  for update;

  if not found then
    return false;
  end if;
  if not exists (
    select 1 from public.usuarios u
    join public.unidades un on un.chave = unidade_atual and un.ativa
    where u.user_id = p_ator and u.ativo
      and (u.papel = 'admin' or (u.papel = 'gerente' and u.setor in ('pecas', 'administracao')))
      and (u.unidade = unidade_atual or exists (
        select 1 from public.usuario_unidades uu where uu.user_id = u.user_id and uu.unidade = unidade_atual
      ))
  ) or not exists (
    select 1 from public.usuarios u
    where u.user_id = p_responsavel and u.ativo
      and (u.papel in ('admin', 'pecas') or (u.papel = 'gerente' and u.setor in ('pecas', 'administracao')))
      and (u.unidade = unidade_atual or exists (
        select 1 from public.usuario_unidades uu where uu.user_id = u.user_id and uu.unidade = unidade_atual
      ))
  ) then
    return false;
  end if;
  if responsavel_atual = p_responsavel then
    return true;
  end if;

  status_destino := case when status_atual = 'novo' then 'em_cotacao' else status_atual end;
  update public.pecas_cotacoes
  set status = status_destino, responsavel_id = p_responsavel
  where id = p_id;

  insert into public.pecas_cotacoes_historico (
    cotacao_id, unidade, de_status, para_status, ator_id, responsavel_anterior_id, responsavel_novo_id
  )
  values (p_id, unidade_atual, status_atual, status_destino, p_ator, responsavel_atual, p_responsavel);
  return true;
end $$;

revoke all on function public.pecas_reatribuir_cotacao(uuid, text[], uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_reatribuir_cotacao(uuid, text[], uuid, uuid) to service_role;

create table if not exists public.pecas_cotacao_itens (
  id uuid primary key default gen_random_uuid(),
  cotacao_id uuid not null references public.pecas_cotacoes (id) on delete restrict,
  descricao text not null check (
    char_length(descricao) between 1 and 200
    and descricao !~ '^[[:space:]]|[[:space:]]$'
  ),
  quantidade integer not null check (quantidade between 1 and 9999),
  preco_unitario_centavos integer not null check (preco_unitario_centavos between 0 and 99999999),
  custo_unitario_centavos integer check (custo_unitario_centavos between 0 and 99999999),
  criado_em timestamptz not null default now()
);

alter table public.pecas_cotacao_itens
  add column if not exists versao integer not null default 1 check (versao > 0);

create index if not exists pecas_cotacao_itens_cotacao_idx on public.pecas_cotacao_itens (cotacao_id);

alter table public.pecas_cotacao_itens enable row level security;
revoke all on table public.pecas_cotacao_itens from public, anon, authenticated, service_role;
grant select, insert on table public.pecas_cotacao_itens to service_role;
grant update (descricao, quantidade, preco_unitario_centavos, custo_unitario_centavos, versao)
  on table public.pecas_cotacao_itens to service_role;

create or replace function public.pecas_adicionar_item(
  p_cotacao_id uuid,
  p_item_id uuid,
  p_unidades text[],
  p_ator uuid,
  p_descricao text,
  p_quantidade integer,
  p_preco_unitario_centavos integer,
  p_custo_unitario_centavos integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item_existente public.pecas_cotacao_itens%rowtype;
begin
  -- Serializa a inclusão de itens e a mudança de etapa da mesma cotação.
  perform 1
  from public.pecas_cotacoes
  where id = p_cotacao_id
    and unidade = any (p_unidades)
    and status = 'em_cotacao'
    and responsavel_id = p_ator
  for update;

  if not found then
    return 'indisponivel';
  end if;

  select * into item_existente
  from public.pecas_cotacao_itens
  where id = p_item_id;

  if found then
    if item_existente.cotacao_id = p_cotacao_id
      and item_existente.descricao = p_descricao
      and item_existente.quantidade = p_quantidade
      and item_existente.preco_unitario_centavos = p_preco_unitario_centavos
      and item_existente.custo_unitario_centavos is not distinct from p_custo_unitario_centavos then
      return 'adicionado';
    end if;
    return 'indisponivel';
  end if;

  if (select count(*) from public.pecas_cotacao_itens where cotacao_id = p_cotacao_id) >= 100 then
    return 'limite';
  end if;

  begin
    insert into public.pecas_cotacao_itens (
      id, cotacao_id, descricao, quantidade, preco_unitario_centavos, custo_unitario_centavos
    )
    values (
      p_item_id, p_cotacao_id, p_descricao, p_quantidade, p_preco_unitario_centavos, p_custo_unitario_centavos
    )
    on conflict (id) do nothing;
  exception when check_violation or not_null_violation then
    return 'indisponivel';
  end;

  return case when found then 'adicionado' else 'indisponivel' end;
end $$;

revoke all on function public.pecas_adicionar_item(uuid, uuid, text[], uuid, text, integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_adicionar_item(uuid, uuid, text[], uuid, text, integer, integer, integer)
  to service_role;

create or replace function public.pecas_atualizar_item(
  p_cotacao_id uuid,
  p_item_id uuid,
  p_unidades text[],
  p_ator uuid,
  p_versao integer,
  p_descricao text,
  p_quantidade integer,
  p_preco_unitario_centavos integer,
  p_custo_unitario_centavos integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item_atual public.pecas_cotacao_itens%rowtype;
begin
  perform 1
  from public.pecas_cotacoes
  where id = p_cotacao_id
    and unidade = any (p_unidades)
    and status = 'em_cotacao'
    and responsavel_id = p_ator
  for update;

  if not found or p_versao is null or p_versao < 1 then
    return 'indisponivel';
  end if;

  select * into item_atual
  from public.pecas_cotacao_itens
  where id = p_item_id and cotacao_id = p_cotacao_id
  for update;

  if not found then
    return 'indisponivel';
  end if;

  if item_atual.descricao = p_descricao
    and item_atual.quantidade = p_quantidade
    and item_atual.preco_unitario_centavos = p_preco_unitario_centavos
    and item_atual.custo_unitario_centavos is not distinct from p_custo_unitario_centavos then
    return 'atualizado';
  end if;

  if item_atual.versao <> p_versao then
    return 'desatualizado';
  end if;

  begin
    update public.pecas_cotacao_itens
    set descricao = p_descricao,
        quantidade = p_quantidade,
        preco_unitario_centavos = p_preco_unitario_centavos,
        custo_unitario_centavos = p_custo_unitario_centavos,
        versao = versao + 1
    where id = p_item_id and cotacao_id = p_cotacao_id;
  exception when check_violation or not_null_violation or numeric_value_out_of_range then
    return 'indisponivel';
  end;
  return 'atualizado';
end $$;

revoke all on function public.pecas_atualizar_item(uuid, uuid, text[], uuid, integer, text, integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_atualizar_item(uuid, uuid, text[], uuid, integer, text, integer, integer, integer)
  to service_role;

create or replace function public.pecas_registrar_apresentacao(p_id uuid, p_unidades text[], p_ator uuid, p_itens jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  status_atual text;
  itens_atuais jsonb;
begin
  select unidade, status into unidade_atual, status_atual
  from public.pecas_cotacoes
  where id = p_id
    and unidade = any (p_unidades)
    and responsavel_id = p_ator
    and status in ('em_cotacao', 'aguardando_cliente')
  for update;

  if not found then
    return 'indisponivel';
  end if;
  select jsonb_object_agg(id::text, versao) into itens_atuais
  from public.pecas_cotacao_itens
  where cotacao_id = p_id;

  if itens_atuais is null then
    return 'sem_itens';
  end if;
  if itens_atuais is distinct from p_itens then
    return 'desatualizada';
  end if;
  if status_atual = 'aguardando_cliente' then
    return 'apresentada';
  end if;

  update public.pecas_cotacoes
  set status = 'aguardando_cliente'
  where id = p_id;

  insert into public.pecas_cotacoes_historico (cotacao_id, unidade, de_status, para_status, ator_id)
  values (p_id, unidade_atual, status_atual, 'aguardando_cliente', p_ator);
  return 'apresentada';
end $$;

revoke all on function public.pecas_registrar_apresentacao(uuid, text[], uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_registrar_apresentacao(uuid, text[], uuid, jsonb) to service_role;

create or replace function public.pecas_registrar_aprovacao(p_id uuid, p_unidades text[], p_ator uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  status_atual text;
begin
  select unidade, status into unidade_atual, status_atual
  from public.pecas_cotacoes
  where id = p_id
    and unidade = any (p_unidades)
    and responsavel_id = p_ator
    and status in ('aguardando_cliente', 'aprovado')
  for update;

  if not found then
    return false;
  end if;
  if status_atual = 'aprovado' then
    return true;
  end if;

  update public.pecas_cotacoes
  set status = 'aprovado'
  where id = p_id;

  insert into public.pecas_cotacoes_historico (cotacao_id, unidade, de_status, para_status, ator_id)
  values (p_id, unidade_atual, status_atual, 'aprovado', p_ator);
  return true;
end $$;

revoke all on function public.pecas_registrar_aprovacao(uuid, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_registrar_aprovacao(uuid, text[], uuid) to service_role;

create or replace function public.pecas_confirmar_venda(p_id uuid, p_unidades text[], p_ator uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.pecas_cotacoes c
  set venda_confirmada_em = now(), venda_confirmada_por = p_ator
  where c.id = p_id
    and c.unidade = any (p_unidades)
    and c.responsavel_id = p_ator
    and c.status = 'aprovado'
    and c.venda_confirmada_em is null
    and exists (select 1 from public.pecas_cotacao_itens i where i.cotacao_id = c.id);

  if found then
    return true;
  end if;

  return exists (
    select 1 from public.pecas_cotacoes c
    where c.id = p_id
      and c.unidade = any (p_unidades)
      and c.responsavel_id = p_ator
      and c.status = 'aprovado'
      and c.venda_confirmada_em is not null
      and c.venda_confirmada_por = p_ator
      and exists (select 1 from public.pecas_cotacao_itens i where i.cotacao_id = c.id)
  );
end $$;

revoke all on function public.pecas_confirmar_venda(uuid, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_confirmar_venda(uuid, text[], uuid) to service_role;

create or replace function public.pecas_avancar_atendimento(p_id uuid, p_unidades text[], p_ator uuid, p_acao text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  etapa_origem text;
  etapa_destino text;
  tipo_desejado text;
  unidade_atual text;
begin
  if p_acao in ('separacao', 'encomenda') then
    etapa_origem := 'aprovado';
    etapa_destino := 'em_separacao';
    tipo_desejado := p_acao;
  elsif p_acao = 'entrega' then
    etapa_origem := 'em_separacao';
    etapa_destino := 'entregue';
  else
    return false;
  end if;

  update public.pecas_cotacoes c
  set status = etapa_destino, tipo_preparo = coalesce(tipo_desejado, c.tipo_preparo)
  where c.id = p_id
    and c.unidade = any (p_unidades)
    and c.responsavel_id = p_ator
    and c.venda_confirmada_em is not null
    and c.status = etapa_origem
    and (tipo_desejado is not null or c.tipo_preparo is not null)
  returning c.unidade into unidade_atual;

  if found then
    insert into public.pecas_cotacoes_historico (cotacao_id, unidade, de_status, para_status, ator_id)
    values (p_id, unidade_atual, etapa_origem, etapa_destino, p_ator);
    return true;
  end if;

  return exists (
    select 1 from public.pecas_cotacoes c
    where c.id = p_id
      and c.unidade = any (p_unidades)
      and c.responsavel_id = p_ator
      and c.venda_confirmada_em is not null
      and c.status = etapa_destino
      and c.tipo_preparo is not null
      and (tipo_desejado is null or c.tipo_preparo = tipo_desejado)
  );
end $$;

revoke all on function public.pecas_avancar_atendimento(uuid, text[], uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_avancar_atendimento(uuid, text[], uuid, text) to service_role;

create or replace function public.pecas_encerrar_cotacao(
  p_id uuid, p_unidades text[], p_ator uuid, p_destino text, p_motivo text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  status_atual text;
  motivo_atual text;
begin
  if p_destino is null or p_destino not in ('perdido', 'cancelado')
    or p_motivo is null or char_length(p_motivo) not between 1 and 500
    or p_motivo ~ '^[[:space:]]|[[:space:]]$' then
    return false;
  end if;

  select c.unidade, c.status, c.motivo_encerramento into unidade_atual, status_atual, motivo_atual
  from public.pecas_cotacoes c
  where c.id = p_id
    and c.unidade = any (p_unidades)
    and c.responsavel_id = p_ator
    and (
      c.status = p_destino
      or (c.status in ('em_cotacao', 'aguardando_cliente', 'aprovado')
        and (p_destino = 'cancelado' or c.venda_confirmada_em is null))
      or (c.status = 'em_separacao' and p_destino = 'cancelado')
    )
  for update;

  if not found then
    return false;
  end if;
  if status_atual = p_destino then
    return motivo_atual = p_motivo;
  end if;

  update public.pecas_cotacoes
  set status = p_destino, motivo_encerramento = p_motivo
  where id = p_id;

  insert into public.pecas_cotacoes_historico (cotacao_id, unidade, de_status, para_status, ator_id)
  values (p_id, unidade_atual, status_atual, p_destino, p_ator);
  return true;
end $$;

revoke all on function public.pecas_encerrar_cotacao(uuid, text[], uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_encerrar_cotacao(uuid, text[], uuid, text, text) to service_role;

create or replace function public.pecas_registrar_cotacao_bot(
  p_cliente_id uuid, p_unidade text, p_referencia text, p_descricao text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cotacao_criada uuid;
begin
  begin
    insert into public.pecas_cotacoes (unidade, cliente_id, origem, origem_ref, descricao)
    select u.chave, c.id, 'whatsapp', p_referencia, p_descricao
    from public.unidades u
    cross join public.clientes c
    where u.chave = p_unidade and u.ativa
      and c.id = p_cliente_id and not c.anonimizado
    on conflict (origem_ref) where origem = 'whatsapp' do nothing
    returning id into cotacao_criada;
  exception when check_violation or not_null_violation or foreign_key_violation then
    return null;
  end;

  if found then
    return cotacao_criada;
  end if;

  return (
    select q.id
    from public.pecas_cotacoes q
    join public.unidades u on u.chave = q.unidade and u.ativa
    join public.clientes c on c.id = q.cliente_id and not c.anonimizado
    where q.origem = 'whatsapp' and q.origem_ref = p_referencia
      and q.cliente_id = p_cliente_id and q.unidade = p_unidade
  );
end $$;

revoke all on function public.pecas_registrar_cotacao_bot(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_registrar_cotacao_bot(uuid, text, text, text) to service_role;

create or replace function public.pecas_atualizar_acompanhamento(
  p_id uuid, p_unidades text[], p_ator uuid, p_versao integer, p_proxima_acao text, p_prazo date
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  acao_atual text;
  prazo_atual date;
  versao_atual integer;
begin
  select c.proxima_acao, c.prazo, c.acompanhamento_versao
  into acao_atual, prazo_atual, versao_atual
  from public.pecas_cotacoes c
  where c.id = p_id
    and c.unidade = any (p_unidades)
    and c.responsavel_id = p_ator
    and c.status not in ('entregue', 'perdido', 'cancelado')
  for update;

  if not found or p_versao is null or p_versao < 0 then
    return 'indisponivel';
  end if;
  if acao_atual is not distinct from p_proxima_acao
    and prazo_atual is not distinct from p_prazo then
    return 'atualizado';
  end if;
  if versao_atual <> p_versao then
    return 'desatualizado';
  end if;

  begin
    update public.pecas_cotacoes
    set proxima_acao = p_proxima_acao,
        prazo = p_prazo,
        acompanhamento_versao = acompanhamento_versao + 1
    where id = p_id;
  exception when check_violation or not_null_violation or numeric_value_out_of_range then
    return 'indisponivel';
  end;
  return 'atualizado';
end $$;

revoke all on function public.pecas_atualizar_acompanhamento(uuid, text[], uuid, integer, text, date)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_atualizar_acompanhamento(uuid, text[], uuid, integer, text, date)
  to service_role;

-- O quadro mostra alterações reais, inclusive itens e próxima ação, sem backfill fictício.
create or replace function public.pecas_marcar_atualizacao()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new is distinct from old then new.atualizado_em := pg_catalog.clock_timestamp(); end if;
  return new;
end $$;
create or replace function public.pecas_item_atualiza_cotacao()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new is not distinct from old then return new; end if;
  update public.pecas_cotacoes set atualizado_em=pg_catalog.clock_timestamp()
    where id=case when tg_op='DELETE' then old.cotacao_id else new.cotacao_id end;
  return null;
end $$;
revoke all on function public.pecas_marcar_atualizacao(),public.pecas_item_atualiza_cotacao()
  from public,anon,authenticated,service_role;
grant execute on function public.pecas_marcar_atualizacao(),public.pecas_item_atualiza_cotacao() to service_role;
drop trigger if exists pecas_marcar_atualizacao on public.pecas_cotacoes;
create trigger pecas_marcar_atualizacao before update on public.pecas_cotacoes
  for each row execute function public.pecas_marcar_atualizacao();
drop trigger if exists pecas_item_atualiza_cotacao on public.pecas_cotacao_itens;
create trigger pecas_item_atualiza_cotacao after insert or update or delete on public.pecas_cotacao_itens
  for each row execute function public.pecas_item_atualiza_cotacao();
