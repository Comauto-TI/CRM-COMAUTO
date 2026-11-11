-- A1.1a: contexto e posse modular, ainda sem UI, envio ou adaptadores legados.
-- Depende de 0001, 0002, 0003 e 0005. Oficina entra após a integração de seu schema.
-- Não classifica mensagens legadas nem modifica posse/carteira dos sistemas existentes.
create table if not exists public.atendimentos_modulares (
  id uuid primary key default gen_random_uuid(),
  setor text not null check (setor in ('vendas', 'pecas')),
  oportunidade_id uuid unique references public.vendas_oportunidades(id) on delete restrict,
  cotacao_id uuid unique references public.pecas_cotacoes(id) on delete restrict,
  conversa_id uuid not null references public.conversas(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  unidade text not null references public.unidades(chave),
  assumido_por uuid,
  dono_na_posse uuid,
  versao integer not null default 0 check (versao between 0 and 2147483646),
  criado_por uuid not null,
  criado_em timestamptz not null default now(),
  unique (id, conversa_id),
  check ((setor = 'vendas' and oportunidade_id is not null and cotacao_id is null)
    or (setor = 'pecas' and cotacao_id is not null and oportunidade_id is null)),
  check ((assumido_por is null) = (dono_na_posse is null))
);
create index if not exists atendimentos_modulares_setor_unidade_idx
  on public.atendimentos_modulares(setor, unidade, criado_em, id);
create table if not exists public.atendimento_canais (
  conversa_id uuid primary key references public.conversas(id) on delete restrict,
  atendimento_id uuid not null unique,
  foreign key (atendimento_id, conversa_id)
    references public.atendimentos_modulares(id, conversa_id) on delete restrict
);
alter table public.atendimentos_modulares enable row level security;
alter table public.atendimento_canais enable row level security;
revoke all on public.atendimentos_modulares, public.atendimento_canais from public, anon, authenticated, service_role;
grant select, insert on public.atendimentos_modulares to service_role;
grant update (assumido_por, dono_na_posse, versao) on public.atendimentos_modulares to service_role;
grant select, insert on public.atendimento_canais to service_role;

-- SELECT FOR SHARE/UPDATE exige UPDATE em pelo menos uma coluna da relação.
-- Defaults de tabelas antigas não são pressupostos pelas RPCs invoker.
grant select (user_id, papel, setor, unidade, ativo) on public.usuarios to service_role;
grant select (user_id, unidade) on public.usuario_unidades to service_role;
grant select (chave, ativa) on public.unidades to service_role;
grant select (id, anonimizado) on public.clientes to service_role;
grant select (id, cliente_id, status, assumida_por) on public.conversas to service_role;
grant select (id, unidade, cliente_id, vendedor_id, fechado_em, funil_id) on public.vendas_oportunidades to service_role;
grant select (id, ativo) on public.vendas_funis to service_role;
grant select (id, unidade, cliente_id, responsavel_id, status) on public.pecas_cotacoes to service_role;
grant update (nome) on public.usuarios, public.clientes, public.unidades to service_role;
grant update (unidade) on public.usuario_unidades to service_role;
grant update (atualizado_em) on public.vendas_oportunidades to service_role;
grant update (proxima_acao) on public.pecas_cotacoes to service_role;
grant update (status) on public.conversas to service_role;
grant update (ativo) on public.vendas_funis to service_role;
grant insert (ator, acao, entidade, entidade_id, dados) on public.audit_log to service_role;

/** Resolve somente o vínculo atual; carteira de cliente não substitui dono do negócio. */
create or replace function public.contexto_atendimento_modular(p_setor text, p_registro uuid, p_ator uuid)
returns table (cliente_id uuid, conversa_id uuid, unidade text, responsavel_id uuid)
language plpgsql security invoker set search_path = ''
as $$
declare
  ator record;
  cliente uuid;
  loja text;
  dono uuid;
  funil uuid;
  canal uuid;
begin
  if p_setor is null or p_setor not in ('vendas', 'pecas') or p_registro is null or p_ator is null then return; end if;
  select u.user_id, u.papel, u.setor, u.unidade into ator from public.usuarios u where u.user_id = p_ator and u.ativo for share;
  if not found then return; end if;
  if not (ator.papel = 'admin'
    or (ator.papel = 'gerente' and ator.setor in (p_setor, 'administracao'))
    or (p_setor = 'vendas' and ator.papel = 'vendedor')
    or (p_setor = 'pecas' and ator.papel = 'pecas')) then return; end if;

  if p_setor = 'vendas' then
    select o.cliente_id, o.unidade, o.vendedor_id, o.funil_id into cliente, loja, dono, funil
      from public.vendas_oportunidades o where o.id = p_registro and o.fechado_em is null for share;
    if not found then return; end if;
    perform 1 from public.vendas_funis f where f.id = funil and f.ativo for share;
    if not found then return; end if;
  else
    select c.cliente_id, c.unidade, c.responsavel_id into cliente, loja, dono
      from public.pecas_cotacoes c where c.id = p_registro
        and c.status not in ('entregue', 'perdido', 'cancelado') for share;
    if not found then return; end if;
  end if;
  -- Resolver fila sem dono exige uma atribuição explícita pelo domínio; sem atalho por cliente.
  if dono is null then return; end if;
  if ator.papel not in ('admin', 'gerente') and dono <> p_ator then return; end if;
  perform 1 from public.unidades u where u.chave = loja and u.ativa for share;
  if not found then return; end if;
  if ator.papel <> 'admin' and ator.unidade <> loja then
    perform 1 from public.usuario_unidades uu where uu.user_id = p_ator and uu.unidade = loja for share;
    if not found then return; end if;
  end if;
  perform 1 from public.clientes c where c.id = cliente and not c.anonimizado for share;
  if not found then return; end if;
  select c.id into canal from public.conversas c where c.cliente_id = cliente;
  if not found then return; end if;
  return query select cliente, canal, loja, dono;
end $$;

create or replace function public.abrir_atendimento_modular(p_setor text, p_registro uuid, p_ator uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  ctx record;
  atendimento public.atendimentos_modulares%rowtype;
begin
  select * into ctx from public.contexto_atendimento_modular(p_setor, p_registro, p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  -- Toda operação modular bloqueia primeiro o canal, depois o atendimento: sem upgrade de SHARE.
  perform 1 from public.conversas c where c.id = ctx.conversa_id and c.cliente_id = ctx.cliente_id for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select a.* into atendimento from public.atendimentos_modulares a
    where (p_setor = 'vendas' and a.oportunidade_id = p_registro)
      or (p_setor = 'pecas' and a.cotacao_id = p_registro) for update;
  if found then
    if atendimento.setor <> p_setor or atendimento.cliente_id <> ctx.cliente_id
      or atendimento.conversa_id <> ctx.conversa_id or atendimento.unidade <> ctx.unidade then
      return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
    end if;
  else
    insert into public.atendimentos_modulares(setor, oportunidade_id, cotacao_id, conversa_id, cliente_id, unidade, criado_por)
      values(p_setor, case when p_setor = 'vendas' then p_registro end,
        case when p_setor = 'pecas' then p_registro end, ctx.conversa_id, ctx.cliente_id, ctx.unidade, p_ator)
      returning * into atendimento;
    insert into public.audit_log(ator, acao, entidade, entidade_id, dados)
      values(p_ator::text, 'abrir_atendimento_modular', 'atendimento', atendimento.id::text,
        pg_catalog.jsonb_build_object('setor', p_setor, 'registro_id', p_registro, 'unidade', ctx.unidade));
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'id', atendimento.id, 'versao', atendimento.versao,
    'setor', atendimento.setor, 'registroId', p_registro);
end $$;

create or replace function public.assumir_atendimento_modular(p_id uuid, p_ator uuid, p_versao integer)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  atendimento public.atendimentos_modulares%rowtype;
  ctx record;
  registro uuid;
  canal record;
  reservado uuid;
begin
  if p_id is null or p_ator is null or p_versao is null or p_versao < 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_id;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  registro := coalesce(atendimento.oportunidade_id, atendimento.cotacao_id);
  select * into ctx from public.contexto_atendimento_modular(atendimento.setor, registro, p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select c.status, c.assumida_por into canal from public.conversas c where c.id = ctx.conversa_id and c.cliente_id = ctx.cliente_id for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_id for update;
  if not found or atendimento.cliente_id <> ctx.cliente_id or atendimento.conversa_id <> ctx.conversa_id
    or atendimento.unidade <> ctx.unidade then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;
  if atendimento.versao <> p_versao or canal.status <> 'humano' or canal.assumida_por is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'conflito');
  end if;
  select c.atendimento_id into reservado from public.atendimento_canais c where c.conversa_id = ctx.conversa_id;
  if reservado is not null and reservado <> atendimento.id then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'conflito');
  end if;
  if atendimento.assumido_por is not null and atendimento.assumido_por <> p_ator
    and atendimento.dono_na_posse = ctx.responsavel_id then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'conflito');
  end if;
  if atendimento.assumido_por is distinct from p_ator or atendimento.dono_na_posse is distinct from ctx.responsavel_id or reservado is null then
    if atendimento.versao >= 2147483646 then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'conflito'); end if;
    insert into public.atendimento_canais(conversa_id, atendimento_id) values(ctx.conversa_id, atendimento.id)
      on conflict (conversa_id) do nothing;
    update public.atendimentos_modulares a set assumido_por = p_ator, dono_na_posse = ctx.responsavel_id, versao = a.versao + 1
      where a.id = atendimento.id returning a.* into atendimento;
    insert into public.audit_log(ator, acao, entidade, entidade_id, dados)
      values(p_ator::text, 'assumir_atendimento_modular', 'atendimento', atendimento.id::text,
        pg_catalog.jsonb_build_object('versao', atendimento.versao, 'dono_no_registro', ctx.responsavel_id, 'unidade', ctx.unidade));
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'id', atendimento.id, 'versao', atendimento.versao,
    'setor', atendimento.setor, 'registroId', registro);
end $$;

revoke all on function public.contexto_atendimento_modular(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.abrir_atendimento_modular(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.assumir_atendimento_modular(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.contexto_atendimento_modular(text, uuid, uuid) to service_role;
grant execute on function public.abrir_atendimento_modular(text, uuid, uuid) to service_role;
grant execute on function public.assumir_atendimento_modular(uuid, uuid, integer) to service_role;
