-- A1.2a: corpo, contagem e cursor do mesmo conjunto autorizado por atendimento.
-- Não integra UI/legado, não marca leitura e não muda o contador físico do canal.
grant select(id, conteudo, tipo, criado_em, status, direcao, autor) on public.mensagens to service_role;

-- Prova de origem compartilhada entre vínculo/guarda e leitura. Não autoriza ator.
-- STABLE usa o snapshot do SELECT chamador, inclusive em cada linha da paginação.
create or replace function public.prova_origem_mensagem_atendimento(
  p_atendimento_id uuid, p_referencia text, p_setor text
)
returns table(mensagem_id uuid, ambigua boolean)
language sql stable security invoker set search_path = ''
as $$
  select m.id,
    exists(select 1 from public.encaminhamentos_bot e where e.referencia = p_referencia)
      and exists(select 1 from public.vendas_encaminhamentos_bot e where e.referencia = p_referencia)
  from public.atendimentos_modulares a
  join public.mensagens m on m.conversa_id = a.conversa_id and m.cliente_id = a.cliente_id
    and m.wamid = p_referencia and m.entrada_cliente_externa
  where a.id = p_atendimento_id and a.setor = p_setor and (
    (p_setor = 'pecas' and exists (
      select 1 from public.pecas_cotacoes c where c.id = a.cotacao_id
        and c.cliente_id = a.cliente_id and c.unidade = a.unidade
        and c.origem = 'whatsapp' and c.origem_ref = p_referencia
    ) and exists (
      select 1 from public.encaminhamentos_bot e where e.referencia = p_referencia and e.destino = 'pecas'
        and e.cotacao_id = a.cotacao_id and e.conversa_id = a.conversa_id
        and e.cliente_id = a.cliente_id and e.unidade = a.unidade
    )) or (p_setor = 'vendas' and exists (
      select 1 from public.vendas_encaminhamentos_bot e where e.referencia = p_referencia
        and e.oportunidade_id = a.oportunidade_id and e.mensagem_id = m.id
        and e.conversa_id = a.conversa_id and e.cliente_id = a.cliente_id and e.unidade = a.unidade
    ) and exists (
      select 1 from public.vendas_oportunidades o where o.id = a.oportunidade_id
        and o.cliente_id = a.cliente_id and o.unidade = a.unidade
    ))
  );
$$;

-- Mantém o contrato A1.1d, usando a mesma prova da futura leitura do corpo.
create or replace function public.resolver_mensagem_atendimento(
  p_atendimento_id uuid, p_referencia text, p_ator uuid, p_setor text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  atendimento public.atendimentos_modulares%rowtype;
  ctx record;
  registro uuid;
  mensagem uuid;
  prova record;
begin
  if p_atendimento_id is null or p_ator is null or p_referencia is null
    or char_length(p_referencia) not between 1 and 512 or p_referencia ~ '^[[:space:]]|[[:space:]]$'
    or p_setor is null or p_setor not in ('vendas', 'pecas') then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id and a.setor = p_setor;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  registro := coalesce(atendimento.oportunidade_id, atendimento.cotacao_id);
  select * into ctx from public.contexto_atendimento_modular(p_setor, registro, p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  perform 1 from public.conversas c where c.id = ctx.conversa_id and c.cliente_id = ctx.cliente_id for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id for update;
  if not found or atendimento.setor <> p_setor or atendimento.cliente_id <> ctx.cliente_id
    or atendimento.conversa_id <> ctx.conversa_id or atendimento.unidade <> ctx.unidade
    or coalesce(atendimento.oportunidade_id, atendimento.cotacao_id) <> registro then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;
  select m.id into mensagem from public.mensagens m where m.wamid = p_referencia
    and m.cliente_id = ctx.cliente_id and m.conversa_id = ctx.conversa_id and m.entrada_cliente_externa for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select p.* into prova from public.prova_origem_mensagem_atendimento(p_atendimento_id, p_referencia, p_setor) p
    where p.mensagem_id = mensagem;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  if prova.ambigua then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'origem_ambigua'); end if;
  return pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', atendimento.id, 'mensagemId', mensagem,
    'referencia', p_referencia, 'setor', p_setor, 'clienteId', ctx.cliente_id,
    'conversaId', ctx.conversa_id, 'unidade', ctx.unidade,
    'cotacaoId', atendimento.cotacao_id, 'oportunidadeId', atendimento.oportunidade_id);
end $$;

create or replace function public.ler_mensagens_atendimento(
  p_atendimento_id uuid, p_ator uuid, p_setor text, p_limite integer default 50,
  p_antes_em timestamptz default null, p_antes_id uuid default null
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
    or p_limite is null or p_limite not between 1 and 100
    or ((p_antes_em is null) <> (p_antes_id is null))
    or (p_antes_em is not null and not pg_catalog.isfinite(p_antes_em)) then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id and a.setor = p_setor;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  registro := coalesce(atendimento.oportunidade_id, atendimento.cotacao_id);
  select * into ctx from public.contexto_atendimento_modular(p_setor, registro, p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  perform 1 from public.conversas c where c.id = ctx.conversa_id and c.cliente_id = ctx.cliente_id for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id for share;
  if not found or atendimento.setor <> p_setor or atendimento.cliente_id <> ctx.cliente_id
    or atendimento.conversa_id <> ctx.conversa_id or atendimento.unidade <> ctx.unidade
    or coalesce(atendimento.oportunidade_id, atendimento.cotacao_id) <> registro then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;

  -- Este SELECT é o ponto único de política + corpo + total + cursor. Não separar
  -- autorização e SELECT do conteúdo em chamadas diferentes, nem contar antes do filtro.
  with candidatas as materialized (
    select a.mensagem_id, p.mensagem_id as comprovada, p.ambigua
    from public.atendimento_mensagens a
    left join lateral public.prova_origem_mensagem_atendimento(p_atendimento_id, a.referencia, p_setor) p
      on p.mensagem_id = a.mensagem_id
    where a.atendimento_id = p_atendimento_id and a.setor = p_setor
      and a.cliente_id = ctx.cliente_id and a.conversa_id = ctx.conversa_id and a.unidade = ctx.unidade
      and (a.oportunidade_id is not distinct from atendimento.oportunidade_id)
      and (a.cotacao_id is not distinct from atendimento.cotacao_id)
  ), autorizadas as materialized (
    select m.id, m.conteudo, m.tipo, m.criado_em, m.status, m.direcao, m.autor
    from candidatas c join public.mensagens m on m.id = c.mensagem_id
    where c.comprovada is not null and c.ambigua is false
  ), seguintes as materialized (
    select a.* from autorizadas a
    where p_antes_id is null or (a.criado_em, a.id) < (p_antes_em, p_antes_id)
    order by a.criado_em desc, a.id desc limit (p_limite + 1)
  ), pagina as materialized (
    select s.* from seguintes s order by s.criado_em desc, s.id desc limit p_limite
  )
  select case when p_antes_id is not null and not exists (
    select 1 from autorizadas a where a.id = p_antes_id and a.criado_em = p_antes_em
  ) then pg_catalog.jsonb_build_object('ok', false, 'codigo', 'cursor_invalido')
  else pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', p_atendimento_id, 'setor', p_setor,
    'total', (select count(*) from autorizadas),
    'revisaoPendente', exists(select 1 from candidatas c where c.comprovada is null or c.ambigua is distinct from false),
    'mensagens', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id, 'conteudo', p.conteudo, 'tipo', p.tipo, 'criadoEm', p.criado_em,
      'status', p.status, 'direcao', p.direcao, 'autor', p.autor
    ) order by p.criado_em desc, p.id desc) from pagina p), '[]'::jsonb),
    'proximoCursor', case when (select count(*) from seguintes) > p_limite then (
      select pg_catalog.jsonb_build_object('criadoEm', p.criado_em, 'id', p.id)
      from pagina p order by p.criado_em, p.id limit 1
    ) else null end
  ) end into resultado;
  return resultado;
end $$;

revoke all on function public.prova_origem_mensagem_atendimento(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.resolver_mensagem_atendimento(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.ler_mensagens_atendimento(uuid, uuid, text, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.prova_origem_mensagem_atendimento(uuid, text, text) to service_role;
grant execute on function public.resolver_mensagem_atendimento(uuid, text, uuid, text) to service_role;
grant execute on function public.ler_mensagens_atendimento(uuid, uuid, text, integer, timestamptz, uuid) to service_role;
