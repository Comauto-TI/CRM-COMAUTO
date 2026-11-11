-- Fila de cotações de Peças por unidade e histórico das etapas.
create table public.pecas_cotacoes (
  id uuid primary key default gen_random_uuid(),
  unidade text not null default 'comauto' references public.unidades (chave),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  veiculo_id uuid references public.veiculos (id) on delete set null,
  origem text not null default 'balcao' check (origem in ('balcao', 'oficina', 'whatsapp')),
  origem_ref text,
  descricao text not null check (
    char_length(descricao) between 1 and 1000
    and descricao !~ '^[[:space:]]|[[:space:]]$'
  ),
  status text not null default 'novo' check (status in (
    'novo', 'em_cotacao', 'aguardando_cliente', 'aprovado',
    'em_separacao', 'entregue', 'perdido', 'cancelado'
  )),
  responsavel_id uuid references public.usuarios (user_id) on delete set null,
  criado_por uuid references public.usuarios (user_id) on delete set null,
  criado_em timestamptz not null default now(),
  venda_confirmada_em timestamptz,
  -- Preserva o autor da confirmação mesmo depois de remover o usuário.
  venda_confirmada_por uuid,
  constraint pecas_cotacoes_confirmacao_venda_check check (
    (venda_confirmada_em is null) = (venda_confirmada_por is null)
  ),
  constraint pecas_cotacoes_referencia_whatsapp_check check (
    origem <> 'whatsapp' or (
      origem_ref is not null
      and char_length(origem_ref) between 1 and 512
      and origem_ref !~ '^[[:space:]]|[[:space:]]$'
    )
  )
);

create index pecas_cotacoes_unidade_criado_em_idx
  on public.pecas_cotacoes (unidade, criado_em desc);

create unique index pecas_cotacoes_referencia_whatsapp_idx
  on public.pecas_cotacoes (origem_ref)
  where origem = 'whatsapp';

alter table public.pecas_cotacoes enable row level security;
revoke all on table public.pecas_cotacoes from public, anon, authenticated, service_role;
grant select, insert on table public.pecas_cotacoes to service_role;
grant update (status, responsavel_id, venda_confirmada_em, venda_confirmada_por)
  on table public.pecas_cotacoes to service_role;

create table public.pecas_cotacoes_historico (
  id uuid primary key default gen_random_uuid(),
  cotacao_id uuid not null references public.pecas_cotacoes (id) on delete restrict,
  unidade text not null references public.unidades (chave),
  de_status text not null,
  para_status text not null,
  -- Preserva o identificador histórico mesmo se o usuário for removido.
  ator_id uuid not null,
  ocorrido_em timestamptz not null default now()
);

create index pecas_cotacoes_historico_cotacao_idx
  on public.pecas_cotacoes_historico (cotacao_id, ocorrido_em desc);

alter table public.pecas_cotacoes_historico enable row level security;
revoke all on table public.pecas_cotacoes_historico from public, anon, authenticated, service_role;
grant insert on table public.pecas_cotacoes_historico to service_role;

create function public.pecas_assumir_cotacao(p_id uuid, p_unidades text[], p_ator uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
begin
  update public.pecas_cotacoes
  set status = 'em_cotacao', responsavel_id = p_ator
  where id = p_id
    and unidade = any (p_unidades)
    and status = 'novo'
    and responsavel_id is null
    and p_ator is not null
  returning unidade into unidade_atual;

  if found then
    insert into public.pecas_cotacoes_historico (cotacao_id, unidade, de_status, para_status, ator_id)
    values (p_id, unidade_atual, 'novo', 'em_cotacao', p_ator);
    return true;
  end if;

  return exists (
    select 1 from public.pecas_cotacoes
    where id = p_id
      and unidade = any (p_unidades)
      and status = 'em_cotacao'
      and responsavel_id = p_ator
  );
end $$;

revoke all on function public.pecas_assumir_cotacao(uuid, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_assumir_cotacao(uuid, text[], uuid) to service_role;

create table public.pecas_cotacao_itens (
  id uuid primary key default gen_random_uuid(),
  cotacao_id uuid not null references public.pecas_cotacoes (id) on delete restrict,
  descricao text not null check (
    char_length(descricao) between 1 and 200
    and descricao !~ '^[[:space:]]|[[:space:]]$'
  ),
  quantidade integer not null check (quantidade between 1 and 9999),
  preco_unitario_centavos integer not null check (preco_unitario_centavos between 0 and 99999999),
  custo_unitario_centavos integer check (custo_unitario_centavos between 0 and 99999999),
  versao integer not null default 1 check (versao > 0),
  criado_em timestamptz not null default now()
);

create index pecas_cotacao_itens_cotacao_idx on public.pecas_cotacao_itens (cotacao_id);

alter table public.pecas_cotacao_itens enable row level security;
revoke all on table public.pecas_cotacao_itens from public, anon, authenticated, service_role;
grant select, insert on table public.pecas_cotacao_itens to service_role;
grant update (descricao, quantidade, preco_unitario_centavos, custo_unitario_centavos, versao)
  on table public.pecas_cotacao_itens to service_role;

create function public.pecas_adicionar_item(
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

create function public.pecas_atualizar_item(
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

create function public.pecas_registrar_apresentacao(p_id uuid, p_unidades text[], p_ator uuid, p_itens jsonb)
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

create function public.pecas_registrar_aprovacao(p_id uuid, p_unidades text[], p_ator uuid)
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

create function public.pecas_confirmar_venda(p_id uuid, p_unidades text[], p_ator uuid)
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

create function public.pecas_registrar_cotacao_bot(
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
