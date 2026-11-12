-- F1-O: fila inicial de Oficina. Depende de 0001/0002_nucleo.
-- Reaplicável; sem integração de WhatsApp, Agenda ou recuperação de triagem órfã.
create table if not exists public.oficina_atendimentos (
  id uuid primary key default gen_random_uuid(),
  unidade text not null references public.unidades (chave),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  veiculo_id uuid references public.veiculos (id) on delete set null,
  descricao text not null check (
    char_length(descricao) between 1 and 1000
    and descricao !~ '^[[:space:]]|[[:space:]]$'
  ),
  status text not null default 'novo' check (status in ('novo', 'em_triagem')),
  criado_por uuid references public.usuarios (user_id) on delete set null,
  responsavel_id uuid references public.usuarios (user_id) on delete set null,
  criado_em timestamptz not null default now()
);

create index if not exists oficina_atendimentos_unidade_criado_em_idx
  on public.oficina_atendimentos (unidade, criado_em desc);

alter table public.oficina_atendimentos enable row level security;
revoke all on table public.oficina_atendimentos from public, anon, authenticated, service_role;
grant select, insert on table public.oficina_atendimentos to service_role;
grant update (status, responsavel_id) on table public.oficina_atendimentos to service_role;

create table if not exists public.oficina_atendimentos_historico (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references public.oficina_atendimentos (id) on delete restrict,
  unidade text not null references public.unidades (chave),
  de_status text,
  para_status text not null,
  -- Mantém o autor do evento mesmo que seu usuário seja removido.
  ator_id uuid not null,
  ocorrido_em timestamptz not null default now()
);

create unique index if not exists oficina_atendimentos_historico_inicial_idx
  on public.oficina_atendimentos_historico (atendimento_id)
  where de_status is null;

alter table public.oficina_atendimentos_historico enable row level security;
revoke all on table public.oficina_atendimentos_historico from public, anon, authenticated, service_role;
grant insert on table public.oficina_atendimentos_historico to service_role;

-- Dependências explícitas do SECURITY INVOKER, sem depender de defaults legados.
grant select (chave, ativa) on public.unidades to service_role;
grant select (user_id, ativo, papel, setor, unidade) on public.usuarios to service_role;
grant select (user_id, unidade) on public.usuario_unidades to service_role;
grant select (id, telefone, anonimizado) on public.clientes to service_role;
grant select (id, cliente_id, placa) on public.veiculos to service_role;
-- SELECT FOR SHARE exige UPDATE em pelo menos uma coluna da relação.
grant update (nome) on public.unidades, public.usuarios, public.clientes to service_role;
grant update (unidade) on public.usuario_unidades to service_role;
grant update (modelo) on public.veiculos to service_role;

create or replace function public.oficina_registrar_atendimento(
  p_id uuid,
  p_unidade text,
  p_ator uuid,
  p_telefone text,
  p_placa text,
  p_descricao text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cliente_resolvido uuid;
  veiculo_resolvido uuid;
  placa_normalizada text;
  ator record;
begin
  -- Ordem de locks: ator, unidade, vínculo extra, cliente e veículo.
  select u.user_id,u.papel,u.setor,u.unidade into ator
    from public.usuarios u where u.user_id=p_ator and u.ativo for share;
  if not found or not (ator.papel in ('admin','consultor_tecnico','recepcao','atendente')
    or (ator.papel='gerente' and ator.setor in ('oficina','administracao'))) then
    return 'unidade';
  end if;
  perform 1 from public.unidades un where un.chave=p_unidade and un.ativa for share;
  if not found then return 'unidade'; end if;
  if ator.papel<>'admin' and ator.unidade<>p_unidade then
    perform 1 from public.usuario_unidades uu where uu.user_id=p_ator and uu.unidade=p_unidade for share;
    if not found then return 'unidade'; end if;
  end if;

  select c.id into cliente_resolvido
  from public.clientes c
  where c.telefone = p_telefone and not c.anonimizado for share;

  if not found then
    return 'cliente';
  end if;

  if p_placa is not null and p_placa !~ '^[[:space:]]*$' then
    placa_normalizada := regexp_replace(upper(p_placa), '[[:space:]-]', '', 'g');
    if placa_normalizada !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
      return 'veiculo';
    end if;

    begin
      select v.id into strict veiculo_resolvido
      from public.veiculos v
      where v.cliente_id = cliente_resolvido
        and regexp_replace(upper(v.placa), '[[:space:]-]', '', 'g') = placa_normalizada for share;
    exception when no_data_found or too_many_rows then
      return 'veiculo';
    end;
  end if;

  if p_id is null or p_descricao is null or char_length(p_descricao) not between 1 and 1000
    or p_descricao ~ '^[[:space:]]|[[:space:]]$' then
    return 'conflito';
  end if;

  insert into public.oficina_atendimentos (id, unidade, cliente_id, veiculo_id, descricao, criado_por)
  values (p_id, p_unidade, cliente_resolvido, veiculo_resolvido, p_descricao, p_ator)
  on conflict (id) do nothing;

  if found then
    insert into public.oficina_atendimentos_historico (atendimento_id, unidade, para_status, ator_id)
    values (p_id, p_unidade, 'novo', p_ator);
    return 'criado';
  end if;

  return case when exists (
    select 1
    from public.oficina_atendimentos a
    where a.id = p_id and a.unidade = p_unidade and a.cliente_id = cliente_resolvido
      and a.veiculo_id is not distinct from veiculo_resolvido
      and a.descricao = p_descricao and a.criado_por = p_ator
  ) then 'criado' else 'conflito' end;
end $$;

revoke all on function public.oficina_registrar_atendimento(uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.oficina_registrar_atendimento(uuid, text, uuid, text, text, text)
  to service_role;

create or replace function public.oficina_assumir_atendimento(p_id uuid, p_ator uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  status_atual text;
  responsavel_atual uuid;
  cliente_atual uuid;
  veiculo_atual uuid;
  ator record;
begin
  select u.user_id,u.papel,u.setor,u.unidade into ator
    from public.usuarios u where u.user_id=p_ator and u.ativo for share;
  if not found or not (ator.papel in ('admin','consultor_tecnico','recepcao','atendente')
    or (ator.papel='gerente' and ator.setor in ('oficina','administracao'))) then
    return false;
  end if;
  -- Serializa a transição antes de consultar os mesmos vínculos da criação.
  select a.unidade,a.status,a.responsavel_id,a.cliente_id,a.veiculo_id
    into unidade_atual,status_atual,responsavel_atual,cliente_atual,veiculo_atual
    from public.oficina_atendimentos a where a.id=p_id for update;
  if not found then return false; end if;
  perform 1 from public.unidades un where un.chave=unidade_atual and un.ativa for share;
  if not found then return false; end if;
  if ator.papel<>'admin' and ator.unidade<>unidade_atual then
    perform 1 from public.usuario_unidades uu where uu.user_id=p_ator and uu.unidade=unidade_atual for share;
    if not found then return false; end if;
  end if;
  perform 1 from public.clientes c where c.id=cliente_atual and not c.anonimizado for share;
  if not found then return false; end if;
  if veiculo_atual is not null then
    perform 1 from public.veiculos v where v.id=veiculo_atual and v.cliente_id=cliente_atual for share;
    if not found then return false; end if;
  end if;
  if status_atual = 'em_triagem' then
    return responsavel_atual is not distinct from p_ator;
  end if;
  if status_atual <> 'novo' or responsavel_atual is not null then
    return false;
  end if;

  update public.oficina_atendimentos
  set status = 'em_triagem', responsavel_id = p_ator
  where id = p_id;

  insert into public.oficina_atendimentos_historico (atendimento_id, unidade, de_status, para_status, ator_id)
  values (p_id, unidade_atual, 'novo', 'em_triagem', p_ator);
  return true;
end $$;

revoke all on function public.oficina_assumir_atendimento(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.oficina_assumir_atendimento(uuid, uuid) to service_role;

-- Fila autorizada antes de contar/paginar. Não altera atribuição nem leituras.
grant select (nome) on public.clientes, public.usuarios to service_role;
grant select (modelo) on public.veiculos to service_role;
create or replace function public.oficina_fila(
  p_ator uuid,p_limite integer default 50,p_antes timestamptz default null,
  p_antes_id uuid default null,p_minhas boolean default false
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare resultado jsonb;
begin
  if p_ator is null or p_limite is null or p_limite not between 1 and 100 or p_minhas is null
    or ((p_antes is null)<>(p_antes_id is null))
    or (p_antes is not null and not pg_catalog.isfinite(p_antes)) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  with ator as materialized (
    select u.user_id,u.papel,u.unidade from public.usuarios u where u.user_id=p_ator and u.ativo
      and (u.papel in ('admin','consultor_tecnico','recepcao','atendente')
        or (u.papel='gerente' and u.setor in ('oficina','administracao')))
  ), escopo as materialized (
    select a.id,a.unidade,a.status,a.criado_em,a.responsavel_id,a.veiculo_id,a.cliente_id
    from ator u join public.oficina_atendimentos a on true
    join public.unidades un on un.chave=a.unidade and un.ativa
    join public.clientes c on c.id=a.cliente_id and not c.anonimizado
    left join public.veiculos v on v.id=a.veiculo_id and v.cliente_id=a.cliente_id
    where (u.papel='admin' or u.unidade=a.unidade or exists(
      select 1 from public.usuario_unidades uu where uu.user_id=u.user_id and uu.unidade=a.unidade))
      and (u.papel<>'consultor_tecnico' or a.responsavel_id is null or a.responsavel_id=u.user_id)
      and (not p_minhas or a.responsavel_id=u.user_id)
      and (a.veiculo_id is null or v.id is not null)
  ), pagina as materialized (
    select * from escopo e where p_antes is null or (e.criado_em,e.id)<(p_antes,p_antes_id)
    order by e.criado_em desc,e.id desc limit p_limite+1
  ), exibidas as materialized (
    select * from pagina order by criado_em desc,id desc limit p_limite
  ), corpos as (
    select e.*,a.descricao,c.nome as cliente_nome,v.placa,v.modelo,r.nome as responsavel_nome
    from exibidas e join public.oficina_atendimentos a on a.id=e.id
    join public.clientes c on c.id=e.cliente_id
    left join public.veiculos v on v.id=e.veiculo_id and v.cliente_id=e.cliente_id
    left join public.usuarios r on r.user_id=e.responsavel_id
  )
  select case
    when not exists(select 1 from ator) then pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado')
    when p_antes is not null and not exists(select 1 from escopo e where e.id=p_antes_id and e.criado_em=p_antes)
      then pg_catalog.jsonb_build_object('ok',false,'codigo','cursor_invalido')
    else pg_catalog.jsonb_build_object('ok',true,'total',(select count(*) from escopo),
      'atendimentos',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',e.id,'unidade',e.unidade,'descricao',e.descricao,'status',e.status,'criadoEm',e.criado_em,
        'clienteNome',coalesce(e.cliente_nome,'Cliente cadastrado'),
        'veiculo',case when e.veiculo_id is not null then pg_catalog.jsonb_build_object('placa',e.placa,'modelo',e.modelo) else null end,
        'responsavel',case when e.responsavel_id is not null then pg_catalog.jsonb_build_object('id',e.responsavel_id,'nome',coalesce(e.responsavel_nome,'Usuário')) else null end,
        'podeAssumir',e.status='novo' and e.responsavel_id is null) order by e.criado_em desc,e.id desc) from corpos e),'[]'::jsonb),
      'proximo',case when (select count(*) from pagina)>p_limite then (
        select pg_catalog.jsonb_build_object('criadoEm',e.criado_em,'id',e.id)
        from exibidas e order by e.criado_em,e.id limit 1) else null end)
    end into resultado;
  return resultado;
end $$;
revoke all on function public.oficina_fila(uuid,integer,timestamptz,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.oficina_fila(uuid,integer,timestamptz,uuid,boolean) to service_role;
