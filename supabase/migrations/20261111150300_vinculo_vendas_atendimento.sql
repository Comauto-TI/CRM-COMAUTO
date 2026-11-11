-- A1.1d: Vendas usa sua proveniência e ambas as áreas recusam origem ambígua.
-- Preserva vínculos Peças, identidades, auditoria e a unicidade global da mensagem.
alter table public.atendimento_mensagens
  add column if not exists setor text not null default 'pecas',
  add column if not exists oportunidade_id uuid;
alter table public.atendimento_mensagens alter column cotacao_id drop not null;
create unique index if not exists atendimentos_prova_vendas_mensagem_idx
  on public.atendimentos_modulares(id, conversa_id, cliente_id, unidade, oportunidade_id);
create unique index if not exists vendas_encaminhamentos_prova_vinculo_idx
  on public.vendas_encaminhamentos_bot(referencia, oportunidade_id, conversa_id, cliente_id, unidade);
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.atendimento_mensagens'::regclass and conname = 'atendimento_mensagens_setor_check') then
    alter table public.atendimento_mensagens add constraint atendimento_mensagens_setor_check check (
      (setor = 'pecas' and cotacao_id is not null and oportunidade_id is null)
      or (setor = 'vendas' and oportunidade_id is not null and cotacao_id is null)
    );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.atendimento_mensagens'::regclass and conname = 'atendimento_mensagens_vendas_atendimento_fk') then
    alter table public.atendimento_mensagens add constraint atendimento_mensagens_vendas_atendimento_fk
      foreign key(atendimento_id, conversa_id, cliente_id, unidade, oportunidade_id)
      references public.atendimentos_modulares(id, conversa_id, cliente_id, unidade, oportunidade_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.atendimento_mensagens'::regclass and conname = 'atendimento_mensagens_vendas_origem_fk') then
    alter table public.atendimento_mensagens add constraint atendimento_mensagens_vendas_origem_fk
      foreign key(referencia, oportunidade_id, conversa_id, cliente_id, unidade)
      references public.vendas_encaminhamentos_bot(referencia, oportunidade_id, conversa_id, cliente_id, unidade) on delete restrict;
  end if;
end $$;
alter table public.atendimento_mensagens enable row level security;
revoke all on public.atendimento_mensagens from public, anon, authenticated, service_role;
grant select, insert on public.atendimento_mensagens to service_role;

-- Resolvedor interno. Prova primeiro o domínio e a fonte exata, antes de informar
-- conflito de origem; conhecer um wamid de outro atendimento não permite sondagem.
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
  comprovada uuid;
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
  if p_setor = 'pecas' then
    perform 1 from public.pecas_cotacoes c where c.id = registro and c.origem = 'whatsapp' and c.origem_ref = p_referencia;
    if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
    perform 1 from public.encaminhamentos_bot e where e.referencia = p_referencia and e.destino = 'pecas'
      and e.cotacao_id = registro and e.conversa_id = ctx.conversa_id and e.cliente_id = ctx.cliente_id and e.unidade = ctx.unidade;
    if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  else
    select e.mensagem_id into comprovada from public.vendas_encaminhamentos_bot e
      where e.referencia = p_referencia and e.oportunidade_id = registro
        and e.conversa_id = ctx.conversa_id and e.cliente_id = ctx.cliente_id and e.unidade = ctx.unidade;
    if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  end if;
  select m.id into mensagem from public.mensagens m where m.wamid = p_referencia
    and m.cliente_id = ctx.cliente_id and m.conversa_id = ctx.conversa_id and m.entrada_cliente_externa
    and (p_setor = 'pecas' or m.id = comprovada) for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  if exists(select 1 from public.encaminhamentos_bot e where e.referencia = p_referencia)
    and exists(select 1 from public.vendas_encaminhamentos_bot e where e.referencia = p_referencia) then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'origem_ambigua');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', atendimento.id, 'mensagemId', mensagem,
    'referencia', p_referencia, 'setor', p_setor, 'clienteId', ctx.cliente_id,
    'conversaId', ctx.conversa_id, 'unidade', ctx.unidade,
    'cotacaoId', atendimento.cotacao_id, 'oportunidadeId', atendimento.oportunidade_id);
end $$;

create or replace function public.vincular_mensagem_do_setor(
  p_atendimento_id uuid, p_referencia text, p_ator uuid, p_setor text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  ctx jsonb;
  mensagem uuid;
  anterior public.atendimento_mensagens%rowtype;
begin
  ctx := public.resolver_mensagem_atendimento(p_atendimento_id, p_referencia, p_ator, p_setor);
  if ctx -> 'ok' is distinct from 'true'::jsonb then return ctx; end if;
  mensagem := (ctx ->> 'mensagemId')::uuid;
  select a.* into anterior from public.atendimento_mensagens a where a.mensagem_id = mensagem;
  if found then
    if anterior.atendimento_id <> p_atendimento_id or anterior.referencia <> p_referencia or anterior.setor <> p_setor then
      return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'conflito');
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', p_atendimento_id,
      'mensagemId', mensagem, 'referencia', p_referencia, 'jaVinculado', true);
  end if;
  insert into public.atendimento_mensagens(mensagem_id, atendimento_id, referencia, cotacao_id,
    oportunidade_id, setor, conversa_id, cliente_id, unidade, criado_por)
    values(mensagem, p_atendimento_id, p_referencia, (ctx ->> 'cotacaoId')::uuid,
      (ctx ->> 'oportunidadeId')::uuid, p_setor, (ctx ->> 'conversaId')::uuid,
      (ctx ->> 'clienteId')::uuid, ctx ->> 'unidade', p_ator);
  insert into public.audit_log(ator, acao, entidade, entidade_id, dados)
    values(p_ator::text, case when p_setor = 'pecas' then 'vincular_mensagem_encaminhada' else 'vincular_mensagem_vendas' end,
      'atendimento', p_atendimento_id::text, pg_catalog.jsonb_build_object('mensagem_id', mensagem,
        'referencia', p_referencia, 'setor', p_setor, 'cotacao_id', ctx -> 'cotacaoId',
        'oportunidade_id', ctx -> 'oportunidadeId', 'unidade', ctx ->> 'unidade'));
  return pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', p_atendimento_id,
    'mensagemId', mensagem, 'referencia', p_referencia, 'jaVinculado', false);
end $$;

create or replace function public.vincular_mensagem_encaminhada(p_atendimento_id uuid, p_referencia text, p_ator uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return public.vincular_mensagem_do_setor(p_atendimento_id, p_referencia, p_ator, 'pecas');
end $$;
create or replace function public.vincular_mensagem_vendas(p_atendimento_id uuid, p_referencia text, p_ator uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return public.vincular_mensagem_do_setor(p_atendimento_id, p_referencia, p_ator, 'vendas');
end $$;

-- Guarda para leituras futuras: não retorna texto e não transforma uma simples
-- linha de associação em autorização permanente. Revalida também ambiguidades novas.
create or replace function public.autorizar_mensagem_atendimento(
  p_atendimento_id uuid, p_referencia text, p_ator uuid, p_setor text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare ctx jsonb;
begin
  ctx := public.resolver_mensagem_atendimento(p_atendimento_id, p_referencia, p_ator, p_setor);
  if ctx -> 'ok' is distinct from 'true'::jsonb then return ctx; end if;
  perform 1 from public.atendimento_mensagens a where a.atendimento_id = p_atendimento_id
    and a.mensagem_id = (ctx ->> 'mensagemId')::uuid and a.referencia = p_referencia and a.setor = p_setor;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  return pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', p_atendimento_id,
    'mensagemId', ctx -> 'mensagemId', 'referencia', p_referencia, 'setor', p_setor);
end $$;

revoke all on function public.resolver_mensagem_atendimento(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.vincular_mensagem_do_setor(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.vincular_mensagem_encaminhada(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.vincular_mensagem_vendas(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.autorizar_mensagem_atendimento(uuid, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.resolver_mensagem_atendimento(uuid, text, uuid, text) to service_role;
grant execute on function public.vincular_mensagem_do_setor(uuid, text, uuid, text) to service_role;
grant execute on function public.vincular_mensagem_encaminhada(uuid, text, uuid) to service_role;
grant execute on function public.vincular_mensagem_vendas(uuid, text, uuid) to service_role;
grant execute on function public.autorizar_mensagem_atendimento(uuid, text, uuid, text) to service_role;
