-- Encaminhamento interno do bot: pedido, nota e avisos na mesma transação.
-- A mensagem de entrada é a identidade; nunca usar hora do relógio como chave.
create table if not exists public.encaminhamentos_bot (
  referencia text primary key check (
    char_length(referencia) between 1 and 512
    and referencia !~ '^[[:space:]]|[[:space:]]$'
  ),
  conversa_id uuid not null references public.conversas (id) on delete restrict,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  unidade text not null references public.unidades (chave),
  destino text not null check (destino in ('pecas', 'triagem')),
  cotacao_id uuid references public.pecas_cotacoes (id) on delete restrict,
  criado_em timestamptz not null default now(),
  constraint encaminhamentos_bot_cotacao_check check ((destino = 'pecas') = (cotacao_id is not null))
);
create index if not exists encaminhamentos_bot_conversa_idx
  on public.encaminhamentos_bot (conversa_id, criado_em desc);
create index if not exists encaminhamentos_bot_cliente_idx
  on public.encaminhamentos_bot (cliente_id, criado_em desc);

alter table public.encaminhamentos_bot enable row level security;
revoke all on table public.encaminhamentos_bot from public, anon, authenticated, service_role;
grant select, insert on table public.encaminhamentos_bot to service_role;

-- Dependências explícitas para SECURITY INVOKER, inclusive sem grants implícitos legados.
grant select (id, cliente_id, unidade) on public.conversas to service_role;
grant select (conversa_id, cliente_id, wamid, direcao) on public.mensagens to service_role;
grant select (id, nome, anonimizado) on public.clientes to service_role;
grant select (chave, ativa) on public.unidades to service_role;
grant select (user_id, papel, setor, unidade, ativo) on public.usuarios to service_role;
grant select (user_id, unidade) on public.usuario_unidades to service_role;
grant insert (cliente_id, autor, texto) on public.notas_cliente to service_role;
grant insert (usuario_id, unidade, tipo, titulo, corpo, link) on public.notificacoes to service_role;

create or replace function public.encaminhar_lead_bot(
  p_conversa_id uuid, p_cliente_id uuid, p_referencia text, p_destino text, p_resumo text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  nome_cliente text;
  cotacao uuid;
  anterior public.encaminhamentos_bot%rowtype;
  destinatarios uuid[];
begin
  if p_conversa_id is null or p_cliente_id is null or p_referencia is null
    or char_length(p_referencia) not between 1 and 512
    or p_referencia ~ '^[[:space:]]|[[:space:]]$'
    or p_destino is null or p_destino not in ('pecas', 'triagem')
    or p_resumo is null or char_length(p_resumo) not between 1 and 300
    or p_resumo ~ '^[[:space:]]|[[:space:]]$' then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  -- Serializa reprocessamentos da mesma mensagem, mesmo antes de existir o ledger.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('encaminhamento_bot:' || p_referencia, 0));

  select cv.unidade, c.nome into unidade_atual, nome_cliente
  from public.conversas cv
  join public.clientes c on c.id = cv.cliente_id and not c.anonimizado
  join public.unidades u on u.chave = cv.unidade and u.ativa
  where cv.id = p_conversa_id and cv.cliente_id = p_cliente_id
    and exists (
      select 1 from public.mensagens m
      where m.wamid = p_referencia and m.conversa_id = cv.id
        and m.cliente_id = p_cliente_id and m.direcao = 'entrada'
    );
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'contexto_indisponivel');
  end if;

  select * into anterior from public.encaminhamentos_bot where referencia = p_referencia;
  if found then
    if anterior.conversa_id <> p_conversa_id or anterior.cliente_id <> p_cliente_id
      or anterior.unidade <> unidade_atual or anterior.destino <> p_destino then
      return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'referencia_conflitante');
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'cotacao_id', anterior.cotacao_id, 'ja_registrado', true);
  end if;

  select pg_catalog.array_agg(u.user_id order by u.user_id) into destinatarios
  from public.usuarios u
  where u.ativo
    and (u.unidade = unidade_atual or exists (
      select 1 from public.usuario_unidades uu where uu.user_id = u.user_id and uu.unidade = unidade_atual
    ))
    and (
      (p_destino = 'pecas' and (u.papel = 'pecas' or (u.papel = 'gerente' and u.setor in ('pecas', 'administracao'))))
      or (p_destino = 'triagem' and u.papel in ('recepcao', 'atendente'))
    );
  if destinatarios is null then
    select pg_catalog.array_agg(u.user_id order by u.user_id) into destinatarios
    from public.usuarios u
    where u.ativo and u.papel = 'admin'
      and (u.unidade = unidade_atual or exists (
        select 1 from public.usuario_unidades uu where uu.user_id = u.user_id and uu.unidade = unidade_atual
      ));
  end if;
  if destinatarios is null then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'equipe_indisponivel');
  end if;

  if p_destino = 'pecas' then
    cotacao := public.pecas_registrar_cotacao_bot(p_cliente_id, unidade_atual, p_referencia, p_resumo);
    if cotacao is null then
      return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'cotacao_indisponivel');
    end if;
  end if;

  insert into public.notas_cliente (cliente_id, autor, texto)
  values (p_cliente_id, 'assistente', '[' || case when p_destino = 'pecas' then 'Peças' else 'Triagem' end || '] ' || p_resumo);

  insert into public.notificacoes (usuario_id, unidade, tipo, titulo, corpo, link)
  select destinatario, unidade_atual, case when p_destino = 'pecas' then 'pecas' else 'lead' end,
    pg_catalog.left(case when p_destino = 'pecas' then 'Pedido de peças pelo WhatsApp: ' else 'Lead para triagem: ' end || coalesce(nome_cliente, 'Cliente'), 140),
    p_resumo,
    case when cotacao is not null then '/painel/pecas/' || cotacao::text else '/painel/clientes?c=' || p_cliente_id::text end
  from pg_catalog.unnest(destinatarios) destinatario;

  insert into public.encaminhamentos_bot (referencia, conversa_id, cliente_id, unidade, destino, cotacao_id)
  values (p_referencia, p_conversa_id, p_cliente_id, unidade_atual, p_destino, cotacao);
  return pg_catalog.jsonb_build_object('ok', true, 'cotacao_id', cotacao, 'ja_registrado', false);
end $$;

revoke all on function public.encaminhar_lead_bot(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.encaminhar_lead_bot(uuid, uuid, text, text, text) to service_role;
