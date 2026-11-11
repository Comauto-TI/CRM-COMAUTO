-- A1.2b: lista/prévias/totais com a mesma política de leitura do detalhe.
-- Sem UI, marca de leitura, inbox legado, envio ou importação de histórico.
grant select(nome) on public.clientes to service_role;

-- Fonte comum STABLE: a política é avaliada no snapshot da consulta que lê o corpo.
-- Não exige posse de envio, status humano ou responsável ativo: é leitura do negócio
-- aberto/atribuído, com responsável atual ou supervisão e snapshots exatos.
create or replace function public.atendimentos_legiveis(p_ator uuid, p_setor text)
returns table(id uuid, setor text, registro_id uuid, cliente_id uuid, conversa_id uuid,
  unidade text, criado_em timestamptz, cliente_nome text, oportunidade_id uuid, cotacao_id uuid)
language sql stable security invoker set search_path = ''
as $$
  with registros as (
    select 'vendas'::text as setor, o.id, o.cliente_id, o.unidade, o.vendedor_id as dono
    from public.vendas_oportunidades o join public.vendas_funis f on f.id = o.funil_id and f.ativo
    where p_setor = 'vendas' and o.fechado_em is null
    union all
    select 'pecas'::text, c.id, c.cliente_id, c.unidade, c.responsavel_id
    from public.pecas_cotacoes c
    where p_setor = 'pecas' and c.status not in ('entregue', 'perdido', 'cancelado')
  )
  select a.id, a.setor, r.id, a.cliente_id, a.conversa_id, a.unidade, a.criado_em,
    coalesce(c.nome, 'Cliente'), a.oportunidade_id, a.cotacao_id
  from public.atendimentos_modulares a
  join registros r on r.setor = a.setor and r.id = coalesce(a.oportunidade_id, a.cotacao_id)
    and r.cliente_id = a.cliente_id and r.unidade = a.unidade and r.dono is not null
  join public.usuarios u on u.user_id = p_ator and u.ativo
  join public.unidades loja on loja.chave = a.unidade and loja.ativa
  join public.clientes c on c.id = a.cliente_id and not c.anonimizado
  join public.conversas canal on canal.id = a.conversa_id and canal.cliente_id = a.cliente_id
  where a.setor = p_setor and (
    u.papel = 'admin'
    or (u.papel = 'gerente' and u.setor in (p_setor, 'administracao'))
    or (p_setor = 'vendas' and u.papel = 'vendedor')
    or (p_setor = 'pecas' and u.papel = 'pecas')
  ) and (u.papel in ('admin', 'gerente') or r.dono = p_ator)
    and (u.papel = 'admin' or u.unidade = a.unidade or exists (
      select 1 from public.usuario_unidades extra where extra.user_id = p_ator and extra.unidade = a.unidade
    ));
$$;

-- Prova comum da associação e origem, não autorização isolada de um ator.
-- O chamador usa primeiro atendimentos_legiveis no mesmo SELECT/snapshot.
create or replace function public.associacoes_mensagens_atendimento(p_atendimento_id uuid, p_setor text)
returns table(mensagem_id uuid, autorizada boolean)
language sql stable security invoker set search_path = ''
as $$
  select v.mensagem_id, (p.mensagem_id is not null and p.ambigua is false)
  from public.atendimentos_modulares a
  join public.atendimento_mensagens v on v.atendimento_id = a.id and v.setor = a.setor
    and v.cliente_id = a.cliente_id and v.conversa_id = a.conversa_id and v.unidade = a.unidade
    and v.oportunidade_id is not distinct from a.oportunidade_id
    and v.cotacao_id is not distinct from a.cotacao_id
  left join lateral public.prova_origem_mensagem_atendimento(a.id, v.referencia, a.setor) p
    on p.mensagem_id = v.mensagem_id
  where a.id = p_atendimento_id and a.setor = p_setor;
$$;

-- Preserva validações e locks do detalhe. O gate final, a origem, o corpo e o total
-- passam pelas mesmas fontes STABLE usadas na lista, sem permissão reutilizável.
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

  with escopo as materialized (
    select a.id from public.atendimentos_legiveis(p_ator, p_setor) a where a.id = p_atendimento_id
  ), candidatas as materialized (
    select v.* from escopo e
    cross join lateral public.associacoes_mensagens_atendimento(e.id, p_setor) v
  ), autorizadas as materialized (
    select m.id, m.conteudo, m.tipo, m.criado_em, m.status, m.direcao, m.autor
    from candidatas c join public.mensagens m on m.id = c.mensagem_id where c.autorizada
  ), seguintes as materialized (
    select a.* from autorizadas a
    where p_antes_id is null or (a.criado_em, a.id) < (p_antes_em, p_antes_id)
    order by a.criado_em desc, a.id desc limit (p_limite + 1)
  ), pagina as materialized (
    select s.* from seguintes s order by s.criado_em desc, s.id desc limit p_limite
  )
  select case when not exists(select 1 from escopo) then
    pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado')
  when p_antes_id is not null and not exists (
    select 1 from autorizadas a where a.id = p_antes_id and a.criado_em = p_antes_em
  ) then pg_catalog.jsonb_build_object('ok', false, 'codigo', 'cursor_invalido')
  else pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', p_atendimento_id, 'setor', p_setor,
    'total', (select count(*) from autorizadas),
    'revisaoPendente', exists(select 1 from candidatas c where not c.autorizada),
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

create or replace function public.listar_atendimentos(
  p_ator uuid, p_setor text, p_limite integer default 50,
  p_antes_em timestamptz default null, p_antes_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare resultado jsonb;
begin
  if p_ator is null or p_setor is null or p_setor not in ('vendas', 'pecas')
    or p_limite is null or p_limite not between 1 and 100
    or ((p_antes_em is null) <> (p_antes_id is null))
    or (p_antes_em is not null and not pg_catalog.isfinite(p_antes_em)) then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  -- O escopo inteiro é autorizado antes de agregar ou paginar. Não chamar o
  -- contexto PL/pgSQL por linha: seus snapshots não definiriam uma lista única.
  with escopo as materialized (
    select a.* from public.atendimentos_legiveis(p_ator, p_setor) a
  ), candidatas as materialized (
    select e.id as atendimento_id, v.mensagem_id, v.autorizada from escopo e
    cross join lateral public.associacoes_mensagens_atendimento(e.id, p_setor) v
  ), autorizadas as materialized (
    -- Contagem e escolha da última mensagem não materializam corpos de todo o histórico.
    select c.atendimento_id, m.id, m.criado_em
    from candidatas c join public.mensagens m on m.id = c.mensagem_id where c.autorizada
  ), metricas as (
    select c.atendimento_id, count(*) filter(where c.autorizada) as total,
      bool_or(not c.autorizada) as revisao from candidatas c group by c.atendimento_id
  ), ultimas as (
    select distinct on (a.atendimento_id) a.* from autorizadas a
    order by a.atendimento_id, a.criado_em desc, a.id desc
  ), seguintes as materialized (
    select e.* from escopo e
    where p_antes_id is null or (e.criado_em, e.id) < (p_antes_em, p_antes_id)
    order by e.criado_em desc, e.id desc limit (p_limite + 1)
  ), pagina as materialized (
    select s.* from seguintes s order by s.criado_em desc, s.id desc limit p_limite
  )
  select case when p_antes_id is not null and not exists (
    select 1 from escopo e where e.id = p_antes_id and e.criado_em = p_antes_em
  ) then pg_catalog.jsonb_build_object('ok', false, 'codigo', 'cursor_invalido')
  else pg_catalog.jsonb_build_object('ok', true, 'setor', p_setor,
    'totalAtendimentos', (select count(*) from escopo), 'totalMensagens', (select count(*) from autorizadas),
    'atendimentos', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id, 'setor', p.setor, 'registroId', p.registro_id, 'unidade', p.unidade,
      'clienteNome', p.cliente_nome, 'criadoEm', p.criado_em,
      'totalMensagens', coalesce(m.total, 0), 'revisaoPendente', coalesce(m.revisao, false),
      'previa', case when u.id is null then null else pg_catalog.jsonb_build_object(
        'id', u.id, 'conteudo', corpo.conteudo, 'tipo', corpo.tipo, 'criadoEm', u.criado_em,
        'status', corpo.status, 'direcao', corpo.direcao, 'autor', corpo.autor
      ) end
    ) order by p.criado_em desc, p.id desc)
      from pagina p left join metricas m on m.atendimento_id = p.id
      left join ultimas u on u.atendimento_id = p.id
      left join public.mensagens corpo on corpo.id = u.id), '[]'::jsonb),
    'proximoCursor', case when (select count(*) from seguintes) > p_limite then (
      select pg_catalog.jsonb_build_object('criadoEm', p.criado_em, 'id', p.id)
      from pagina p order by p.criado_em, p.id limit 1
    ) else null end
  ) end into resultado;
  return resultado;
end $$;

revoke all on function public.atendimentos_legiveis(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.associacoes_mensagens_atendimento(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.ler_mensagens_atendimento(uuid, uuid, text, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.listar_atendimentos(uuid, text, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.atendimentos_legiveis(uuid, text) to service_role;
grant execute on function public.associacoes_mensagens_atendimento(uuid, text) to service_role;
grant execute on function public.ler_mensagens_atendimento(uuid, uuid, text, integer, timestamptz, uuid) to service_role;
grant execute on function public.listar_atendimentos(uuid, text, integer, timestamptz, uuid) to service_role;
