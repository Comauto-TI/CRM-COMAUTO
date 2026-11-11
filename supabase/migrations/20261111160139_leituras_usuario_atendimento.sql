-- A1.2c: leitura explícita por mensagem/atendimento/usuário, sem alterar o canal
-- físico, status da mensagem no WhatsApp, posse, histórico legado ou envio.
-- Sem backfill: uma associação autorizada sem marca pessoal é não lida.
create unique index if not exists atendimento_mensagens_leitura_idx
  on public.atendimento_mensagens(atendimento_id, mensagem_id);
create table if not exists public.atendimento_leituras (
  atendimento_id uuid not null,
  mensagem_id uuid not null,
  usuario_id uuid not null references public.usuarios(user_id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key(atendimento_id, usuario_id, mensagem_id),
  foreign key(atendimento_id, mensagem_id)
    references public.atendimento_mensagens(atendimento_id, mensagem_id) on delete restrict
);
create index if not exists atendimento_leituras_usuario_idx
  on public.atendimento_leituras(usuario_id, atendimento_id, mensagem_id);
alter table public.atendimento_leituras enable row level security;
revoke all on public.atendimento_leituras from public, anon, authenticated, service_role;
grant select on public.atendimento_leituras to service_role;
grant insert(atendimento_id, mensagem_id, usuario_id) on public.atendimento_leituras to service_role;

create or replace function public.obter_leitura_atendimento(p_atendimento_id uuid, p_ator uuid, p_setor text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare resultado jsonb;
begin
  if p_atendimento_id is null or p_ator is null or p_setor is null or p_setor not in ('vendas', 'pecas') then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  with escopo as materialized (
    select a.id from public.atendimentos_legiveis(p_ator, p_setor) a where a.id = p_atendimento_id
  ), candidatas as materialized (
    select v.mensagem_id, v.autorizada, (l.mensagem_id is not null) as lida
    from escopo e cross join lateral public.associacoes_mensagens_atendimento(e.id, p_setor) v
    left join public.atendimento_leituras l on l.atendimento_id = e.id
      and l.mensagem_id = v.mensagem_id and l.usuario_id = p_ator
  )
  select case when not exists(select 1 from escopo) then
    pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado')
  else pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', p_atendimento_id, 'setor', p_setor,
    'total', (select count(*) from candidatas c where c.autorizada),
    'lidas', (select count(*) from candidatas c where c.autorizada and c.lida),
    'naoLidas', (select count(*) from candidatas c where c.autorizada and not c.lida),
    'revisaoPendente', exists(select 1 from candidatas c where not c.autorizada)
  ) end into resultado;
  return resultado;
end $$;

create or replace function public.resumir_leituras_atendimentos(p_ator uuid, p_setor text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare resultado jsonb;
begin
  if p_ator is null or p_setor is null or p_setor not in ('vendas', 'pecas') then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  with escopo as materialized (
    select a.id from public.atendimentos_legiveis(p_ator, p_setor) a
  ), candidatas as materialized (
    select e.id as atendimento_id, v.autorizada, (l.mensagem_id is not null) as lida
    from escopo e cross join lateral public.associacoes_mensagens_atendimento(e.id, p_setor) v
    left join public.atendimento_leituras l on l.atendimento_id = e.id
      and l.mensagem_id = v.mensagem_id and l.usuario_id = p_ator
  )
  select pg_catalog.jsonb_build_object('ok', true, 'setor', p_setor,
    'totalAtendimentos', (select count(*) from escopo),
    'totalMensagens', (select count(*) from candidatas c where c.autorizada),
    'lidas', (select count(*) from candidatas c where c.autorizada and c.lida),
    'naoLidas', (select count(*) from candidatas c where c.autorizada and not c.lida),
    'atendimentosComNaoLidas', (select count(distinct c.atendimento_id) from candidatas c where c.autorizada and not c.lida),
    'revisaoPendente', exists(select 1 from candidatas c where not c.autorizada)
  ) into resultado;
  return resultado;
end $$;

create or replace function public.marcar_mensagens_lidas_atendimento(
  p_atendimento_id uuid, p_ator uuid, p_setor text, p_mensagens uuid[]
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  atendimento public.atendimentos_modulares%rowtype;
  ctx record;
  registro uuid;
  resultado jsonb;
begin
  if p_atendimento_id is null or p_ator is null or p_setor is null or p_setor not in ('vendas', 'pecas')
    or p_mensagens is null or coalesce(pg_catalog.array_ndims(p_mensagens), 0) <> 1
    or pg_catalog.cardinality(p_mensagens) not between 1 and 100 then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  -- Separado da checagem de dimensões: array_position não aceita array 2D.
  if pg_catalog.array_position(p_mensagens, null::uuid) is not null
    or (select count(distinct x.id) from pg_catalog.unnest(p_mensagens) as x(id)) <> pg_catalog.cardinality(p_mensagens) then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id and a.setor = p_setor;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  registro := coalesce(atendimento.oportunidade_id, atendimento.cotacao_id);
  select * into ctx from public.contexto_atendimento_modular(p_setor, registro, p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  -- Mesma ordem de locks do detalhe/abertura/claim, protegendo o contexto durante a escrita.
  perform 1 from public.conversas c where c.id = ctx.conversa_id and c.cliente_id = ctx.cliente_id for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id for share;
  if not found or atendimento.setor <> p_setor or atendimento.cliente_id <> ctx.cliente_id
    or atendimento.conversa_id <> ctx.conversa_id or atendimento.unidade <> ctx.unidade
    or coalesce(atendimento.oportunidade_id, atendimento.cotacao_id) <> registro then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;

  -- Autorização e gravação pertencem ao mesmo statement/snapshot. A validade do
  -- lote é predicado do INSERT: o CASE do resultado sozinho não desfaria escrita.
  with escopo as materialized (
    select a.id from public.atendimentos_legiveis(p_ator, p_setor) a where a.id = p_atendimento_id
  ), autorizadas as materialized (
    select v.mensagem_id from escopo e
    cross join lateral public.associacoes_mensagens_atendimento(e.id, p_setor) v
    where v.autorizada and v.mensagem_id = any(p_mensagens)
  ), validacao as materialized (
    select exists(select 1 from escopo)
      and (select count(*) from autorizadas) = pg_catalog.cardinality(p_mensagens) as valida
  ), inseridas as (
    insert into public.atendimento_leituras(atendimento_id, mensagem_id, usuario_id)
    select p_atendimento_id, a.mensagem_id, p_ator from autorizadas a
    where (select v.valida from validacao v) order by a.mensagem_id
    on conflict(atendimento_id, usuario_id, mensagem_id) do nothing
    returning mensagem_id
  )
  select case when not (select v.valida from validacao v) then
    pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado')
  else pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', p_atendimento_id, 'setor', p_setor,
    'marcadas', (select count(*) from inseridas)) end into resultado;
  return resultado;
end $$;

revoke all on function public.obter_leitura_atendimento(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resumir_leituras_atendimentos(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.marcar_mensagens_lidas_atendimento(uuid, uuid, text, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.obter_leitura_atendimento(uuid, uuid, text) to service_role;
grant execute on function public.resumir_leituras_atendimentos(uuid, text) to service_role;
grant execute on function public.marcar_mensagens_lidas_atendimento(uuid, uuid, text, uuid[]) to service_role;
