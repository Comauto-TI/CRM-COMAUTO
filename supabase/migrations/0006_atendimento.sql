-- 0006: Atendimento entre setores. Conteúdo consolidado, sem mudança de contratos.

-- Depende de 0001, 0002, 0003 e 0005. Executar o arquivo inteiro em uma transação.

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
  if not public.rota_permite_atendimento(atendimento.id) or atendimento.versao <> p_versao or canal.status <> 'humano' or canal.assumida_por is not null then
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

-- A1.1b: somente a mensagem inicial comprovada do encaminhamento de Peças.
-- Depende de 0001/0002/0003/0005, encaminhamentos_bot e atendimentos_modulares.
-- Sem backfill, histórico por cliente, UI, envio ou associação automática de novas mensagens.

create unique index if not exists encaminhamentos_prova_atendimento_idx
  on public.encaminhamentos_bot(referencia, conversa_id, cliente_id, unidade, cotacao_id);
create unique index if not exists atendimentos_prova_mensagem_idx
  on public.atendimentos_modulares(id, conversa_id, cliente_id, unidade, cotacao_id);

create table if not exists public.atendimento_mensagens (
  mensagem_id uuid primary key,
  atendimento_id uuid not null,
  referencia text not null unique,
  cotacao_id uuid not null,
  conversa_id uuid not null,
  cliente_id uuid not null,
  unidade text not null,
  entrada_cliente_externa boolean not null default true check (entrada_cliente_externa),
  criado_por uuid not null,
  criado_em timestamptz not null default now(),
  constraint atendimento_mensagens_atendimento_fk
    foreign key(atendimento_id, conversa_id, cliente_id, unidade, cotacao_id)
    references public.atendimentos_modulares(id, conversa_id, cliente_id, unidade, cotacao_id) on delete restrict,
  constraint atendimento_mensagens_origem_fk
    foreign key(referencia, conversa_id, cliente_id, unidade, cotacao_id)
    references public.encaminhamentos_bot(referencia, conversa_id, cliente_id, unidade, cotacao_id) on delete restrict,
  constraint atendimento_mensagens_mensagem_fk
    foreign key(mensagem_id, conversa_id, cliente_id, referencia, entrada_cliente_externa)
    references public.mensagens(id, conversa_id, cliente_id, wamid, entrada_cliente_externa) on delete restrict
);
create index if not exists atendimento_mensagens_atendimento_idx
  on public.atendimento_mensagens(atendimento_id, criado_em, mensagem_id);
alter table public.atendimento_mensagens enable row level security;
revoke all on public.atendimento_mensagens from public, anon, authenticated, service_role;
grant select, insert on public.atendimento_mensagens to service_role;
grant select (id, conversa_id, cliente_id, wamid, entrada_cliente_externa) on public.mensagens to service_role;
grant update (status, metadata) on public.mensagens to service_role;
grant select (origem, origem_ref) on public.pecas_cotacoes to service_role;

create or replace function public.vincular_mensagem_encaminhada(
  p_atendimento_id uuid, p_referencia text, p_ator uuid
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  atendimento public.atendimentos_modulares%rowtype;
  ctx record;
  mensagem uuid;
  anterior public.atendimento_mensagens%rowtype;
begin
  if p_atendimento_id is null or p_ator is null or p_referencia is null
    or char_length(p_referencia) not between 1 and 512
    or p_referencia ~ '^[[:space:]]|[[:space:]]$' then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id and a.setor = 'pecas';
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select * into ctx from public.contexto_atendimento_modular('pecas', atendimento.cotacao_id, p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  -- Mesma ordem das RPCs de abertura/posse. O vínculo da mensagem não toma posse.
  perform 1 from public.conversas c where c.id = ctx.conversa_id and c.cliente_id = ctx.cliente_id for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select a.* into atendimento from public.atendimentos_modulares a where a.id = p_atendimento_id for update;
  if not found or atendimento.setor <> 'pecas' or atendimento.cliente_id <> ctx.cliente_id
    or atendimento.conversa_id <> ctx.conversa_id or atendimento.unidade <> ctx.unidade then
    return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  end if;
  -- O domínio já está protegido por FOR SHARE no resolvedor. A origem da cotação
  -- precisa corroborar a prova histórica do ledger no momento desta associação.
  perform 1 from public.pecas_cotacoes c where c.id = atendimento.cotacao_id
    and c.origem = 'whatsapp' and c.origem_ref = p_referencia;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  -- O ledger permanece sem UPDATE concedido ao serviço. A FK composta da inserção
  -- comprova e protege suas identidades; uma mudança concorrente invalida o insert.
  perform 1 from public.encaminhamentos_bot e where e.referencia = p_referencia and e.destino = 'pecas'
    and e.cotacao_id = atendimento.cotacao_id and e.conversa_id = ctx.conversa_id
    and e.cliente_id = ctx.cliente_id and e.unidade = ctx.unidade;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;
  select m.id into mensagem from public.mensagens m where m.wamid = p_referencia
    and m.conversa_id = ctx.conversa_id and m.cliente_id = ctx.cliente_id
    and m.entrada_cliente_externa for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'nao_encontrado'); end if;

  select a.* into anterior from public.atendimento_mensagens a where a.mensagem_id = mensagem;
  if found then
    if anterior.atendimento_id <> atendimento.id or anterior.referencia <> p_referencia then
      return pg_catalog.jsonb_build_object('ok', false, 'codigo', 'conflito');
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', atendimento.id,
      'mensagemId', mensagem, 'referencia', p_referencia, 'jaVinculado', true);
  end if;
  insert into public.atendimento_mensagens(mensagem_id, atendimento_id, referencia, cotacao_id,
    conversa_id, cliente_id, unidade, criado_por)
    values(mensagem, atendimento.id, p_referencia, atendimento.cotacao_id,
      ctx.conversa_id, ctx.cliente_id, ctx.unidade, p_ator);
  insert into public.audit_log(ator, acao, entidade, entidade_id, dados)
    values(p_ator::text, 'vincular_mensagem_encaminhada', 'atendimento', atendimento.id::text,
      pg_catalog.jsonb_build_object('mensagem_id', mensagem, 'referencia', p_referencia,
        'cotacao_id', atendimento.cotacao_id, 'unidade', ctx.unidade));
  return pg_catalog.jsonb_build_object('ok', true, 'atendimentoId', atendimento.id,
    'mensagemId', mensagem, 'referencia', p_referencia, 'jaVinculado', false);
end $$;
revoke all on function public.vincular_mensagem_encaminhada(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.vincular_mensagem_encaminhada(uuid, text, uuid) to service_role;

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

-- MVP Peças: vínculo do diálogo novo, sem importar histórico físico do cliente.
create unique index if not exists atendimentos_dialogo_identidade_idx
  on public.atendimentos_modulares(id, conversa_id, cliente_id);
alter table public.mensagens add column if not exists atendimento_id uuid;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid = 'public.mensagens'::regclass and conname = 'mensagens_atendimento_dialogo_fk') then
    alter table public.mensagens add constraint mensagens_atendimento_dialogo_fk
      foreign key(atendimento_id, conversa_id, cliente_id)
      references public.atendimentos_modulares(id, conversa_id, cliente_id) on delete restrict;
  end if;
end $$;
create index if not exists mensagens_atendimento_dialogo_idx on public.mensagens(atendimento_id, criado_em, id);
grant select(atendimento_id, erro, metadata) on public.mensagens to service_role;
grant insert(id, conversa_id, cliente_id, direcao, autor, tipo, conteudo, status, erro, metadata, atendimento_id, wamid) on public.mensagens to service_role;
grant update(erro, wamid) on public.mensagens to service_role;
grant select(ultimo_contato_em) on public.clientes to service_role;
grant delete on public.atendimento_canais to service_role;
grant insert(cliente_id) on public.conversas to service_role;
grant update(assumida_por, aguardando_desde, falhas_entendimento) on public.conversas to service_role;

create or replace function public.pecas_vincular_entrada_ativa()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare alvo public.atendimentos_modulares%rowtype; ctx record;
begin
  if new.direcao = 'entrada' and new.autor = 'cliente'
    and coalesce(new.metadata->'interno', 'false'::jsonb) = 'false'::jsonb then
    new.atendimento_id := null;
    select a.* into alvo from public.atendimento_canais s join public.atendimentos_modulares a on a.id = s.atendimento_id
      where s.conversa_id = new.conversa_id and a.cliente_id = new.cliente_id and a.setor = 'pecas';
    if not found or alvo.assumido_por is null then return new; end if;
    select * into ctx from public.contexto_atendimento_modular('pecas', alvo.cotacao_id, alvo.assumido_por);
    if not found or ctx.responsavel_id is distinct from alvo.dono_na_posse then return new; end if;
    perform 1 from public.conversas c where c.id = new.conversa_id and c.cliente_id = new.cliente_id
      and c.status = 'humano' and c.assumida_por is null for update;
    if not found then return new; end if;
    perform 1 from public.atendimentos_modulares a join public.atendimento_canais s on s.atendimento_id = a.id
      where a.id = alvo.id and s.conversa_id = new.conversa_id and a.assumido_por = alvo.assumido_por
        and a.dono_na_posse = ctx.responsavel_id and a.versao = alvo.versao;
    if found then new.atendimento_id := alvo.id; end if;
  end if;
  return new;
end $$;
drop trigger if exists pecas_entrada_ativa on public.mensagens;
create trigger pecas_entrada_ativa before insert on public.mensagens for each row execute function public.pecas_vincular_entrada_ativa();

create or replace function public.pecas_preservar_vinculo_dialogo()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.atendimento_id is distinct from old.atendimento_id then
    raise exception 'Vínculo de diálogo não pode ser reatribuído.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists pecas_dialogo_imutavel on public.mensagens;
create trigger pecas_dialogo_imutavel before update of atendimento_id on public.mensagens
  for each row execute function public.pecas_preservar_vinculo_dialogo();

create or replace function public.pecas_proteger_posse_aberta()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.responsavel_id is distinct from old.responsavel_id
    or (new.status is distinct from old.status and new.status in ('entregue','perdido','cancelado')))
    and exists(select 1 from public.atendimentos_modulares a join public.atendimento_canais s on s.atendimento_id = a.id where a.cotacao_id = old.id) then
    raise exception 'Devolva o atendimento antes de encerrar ou reatribuir.' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists pecas_posse_aberta on public.pecas_cotacoes;
create trigger pecas_posse_aberta before update of responsavel_id, status on public.pecas_cotacoes
  for each row execute function public.pecas_proteger_posse_aberta();

-- Contexto de escrita específico do piloto; válido somente dentro da mesma transação.
create or replace function public.pecas_contexto_posse(p_cotacao uuid, p_ator uuid, p_versao integer, p_supervisao boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx record; a public.atendimentos_modulares%rowtype; c record;
begin
  select * into ctx from public.contexto_atendimento_modular('pecas', p_cotacao, p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  select status, assumida_por into c from public.conversas where id = ctx.conversa_id for update;
  select * into a from public.atendimentos_modulares where cotacao_id = p_cotacao for update;
  if not found or a.cliente_id <> ctx.cliente_id or a.conversa_id <> ctx.conversa_id or a.unidade <> ctx.unidade then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  if p_versao is null or a.versao <> p_versao or a.assumido_por is null
    or (a.assumido_por is distinct from p_ator and not (p_supervisao is true and exists(
      select 1 from public.usuarios u where u.user_id = p_ator and u.ativo and u.papel in ('admin','gerente'))))
    or a.dono_na_posse is distinct from ctx.responsavel_id or c.status <> 'humano' or c.assumida_por is not null
    or not exists(select 1 from public.atendimento_canais s where s.conversa_id = a.conversa_id and s.atendimento_id = a.id) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
  end if;
  return pg_catalog.jsonb_build_object('ok',true,'id',a.id,'cotacaoId',p_cotacao,'versao',a.versao,
    'clienteId',a.cliente_id,'conversaId',a.conversa_id);
end $$;

create or replace function public.pecas_contexto_posse(p_cotacao uuid, p_ator uuid, p_versao integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb; origem record; prova jsonb;
begin
  ctx:=public.pecas_contexto_posse(p_cotacao,p_ator,p_versao,false);
  if ctx->>'ok'<>'true' then return ctx; end if;
  select c.origem,c.origem_ref into origem from public.pecas_cotacoes c where c.id=p_cotacao;
  if origem.origem='whatsapp' then
    prova:=public.autorizar_mensagem_atendimento((ctx->>'id')::uuid,origem.origem_ref,p_ator,'pecas');
    if prova->>'ok'<>'true' then return prova; end if;
  end if;
  -- Uma segunda origem também pode surgir para entradas vinculadas após o claim.
  if exists(select 1 from public.mensagens m where m.atendimento_id=(ctx->>'id')::uuid
    and m.entrada_cliente_externa and (
      exists(select 1 from public.vendas_encaminhamentos_bot v where v.referencia=m.wamid)
      or exists(select 1 from public.encaminhamentos_bot e where e.referencia=m.wamid and
        (e.destino<>'pecas' or e.cotacao_id is distinct from p_cotacao or e.cliente_id<>m.cliente_id
          or e.conversa_id<>m.conversa_id or e.unidade<>(select c.unidade from public.pecas_cotacoes c where c.id=p_cotacao))))) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','origem_ambigua');
  end if;
  return ctx;
end;
$$;

create or replace function public.pecas_assumir_atendimento(p_cotacao uuid, p_ator uuid, p_versao integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare pessoa record; cotacao public.pecas_cotacoes%rowtype; canal record; a public.atendimentos_modulares%rowtype; r jsonb;
begin
  if p_cotacao is null or p_ator is null or p_versao is null or p_versao not between 0 and 2147483646 then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  begin
    select user_id,papel,setor,unidade into pessoa from public.usuarios where user_id = p_ator and ativo for share;
    if not found or not (pessoa.papel in ('admin','pecas') or (pessoa.papel = 'gerente' and pessoa.setor in ('pecas','administracao'))) then
      raise sqlstate 'P1004';
    end if;
    select c.* into cotacao from public.pecas_cotacoes c join public.unidades u on u.chave = c.unidade and u.ativa
      join public.clientes cl on cl.id = c.cliente_id and not cl.anonimizado
      where c.id = p_cotacao and c.status not in ('entregue','perdido','cancelado') for update of c;
    if not found or (pessoa.papel <> 'admin' and pessoa.unidade <> cotacao.unidade and not exists(
      select 1 from public.usuario_unidades x where x.user_id = p_ator and x.unidade = cotacao.unidade))
      or (cotacao.responsavel_id is not null and cotacao.responsavel_id <> p_ator) then
      raise sqlstate 'P1004';
    end if;
    -- Ordem compatível com o bot de Vendas: cliente antes de canal.
    perform 1 from public.clientes cl where cl.id=cotacao.cliente_id and not cl.anonimizado for share;
    if not found then raise sqlstate 'P1004'; end if;
    insert into public.conversas(cliente_id) values(cotacao.cliente_id) on conflict(cliente_id) do nothing;
    select id,status,assumida_por into canal from public.conversas where cliente_id = cotacao.cliente_id for update;
    select * into a from public.atendimentos_modulares where cotacao_id = p_cotacao for update;
    if (found and a.versao <> p_versao) or (not found and p_versao <> 0) then raise sqlstate 'P1009'; end if;
    if canal.assumida_por is not null or exists(select 1 from public.atendimento_canais s
      where s.conversa_id = canal.id and (a.id is null or s.atendimento_id <> a.id))
      or (a.assumido_por is not null and a.assumido_por <> p_ator) then raise sqlstate 'P1009'; end if;
    if cotacao.responsavel_id is null or cotacao.status = 'novo' then
      if not public.pecas_assumir_cotacao(p_cotacao,array[cotacao.unidade],p_ator) then raise sqlstate 'P1004'; end if;
    end if;
    r := public.abrir_atendimento_modular('pecas',p_cotacao,p_ator);
    if r->>'ok' <> 'true' then raise sqlstate 'P1009'; end if;
    if cotacao.origem = 'whatsapp' and exists(select 1 from public.encaminhamentos_bot e where e.referencia = cotacao.origem_ref) then
      r := public.vincular_mensagem_encaminhada((r->>'id')::uuid,cotacao.origem_ref,p_ator);
      if r->>'ok' <> 'true' then raise sqlstate 'P1009'; end if;
    end if;
    update public.conversas set status = 'humano' where id = canal.id and status <> 'humano';
    r := public.assumir_atendimento_modular((select id from public.atendimentos_modulares where cotacao_id = p_cotacao),p_ator,p_versao);
    if r->>'ok' <> 'true' then raise sqlstate 'P1009'; end if;
    return pg_catalog.jsonb_build_object('ok',true,'id',r->>'id','cotacaoId',p_cotacao,'versao',(r->>'versao')::integer,'estado','minha');
  exception when sqlstate 'P1004' then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
    when sqlstate 'P1009' then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
  end;
end $$;

create or replace function public.pecas_devolver_atendimento(p_cotacao uuid, p_ator uuid, p_versao integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb; removido uuid; nova integer;
begin
  ctx := public.pecas_contexto_posse(p_cotacao,p_ator,p_versao,true);
  if ctx->>'ok' <> 'true' then return ctx; end if;
  if p_versao >= 2147483646 then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito'); end if;
  delete from public.atendimento_canais where conversa_id = (ctx->>'conversaId')::uuid and atendimento_id = (ctx->>'id')::uuid returning atendimento_id into removido;
  if not found then raise exception 'Reserva mudou.' using errcode = '40001'; end if;
  update public.atendimentos_modulares set assumido_por = null,dono_na_posse = null,versao = versao + 1
    where id = removido returning versao into nova;
  update public.conversas set status = 'bot',assumida_por = null,aguardando_desde = null,falhas_entendimento = 0 where id = (ctx->>'conversaId')::uuid;
  insert into public.audit_log(ator,acao,entidade,entidade_id,dados) values(p_ator::text,'pecas_devolver','atendimento',removido::text,pg_catalog.jsonb_build_object('versao',nova));
  return pg_catalog.jsonb_build_object('ok',true,'id',removido,'cotacaoId',p_cotacao,'versao',nova,'estado','livre');
end $$;

create or replace function public.pecas_dialogo(p_cotacao uuid, p_ator uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx record; a public.atendimentos_modulares%rowtype; pessoa record; cotacao record; cliente record;
  estado text := 'livre'; resultado jsonb; reservado uuid; canal record;
begin
  select user_id,papel,setor,unidade into pessoa from public.usuarios where user_id = p_ator and ativo for share;
  if not found or not (pessoa.papel in ('admin','pecas') or (pessoa.papel = 'gerente' and pessoa.setor in ('pecas','administracao'))) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  select c.responsavel_id,c.unidade,c.cliente_id into cotacao from public.pecas_cotacoes c join public.unidades u on u.chave = c.unidade and u.ativa
    where c.id = p_cotacao and c.status not in ('entregue','perdido','cancelado') for share of c;
  if not found or (pessoa.papel <> 'admin' and pessoa.unidade <> cotacao.unidade and not exists(
    select 1 from public.usuario_unidades x where x.user_id = p_ator and x.unidade = cotacao.unidade)) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  if cotacao.responsavel_id is null then
    select m.* into a from public.atendimentos_modulares m join public.atendimento_rotas_setores r
      on r.atendimento_id=m.id and r.conversa_id=m.conversa_id and r.cliente_id=m.cliente_id and r.unidade=m.unidade
      where m.cotacao_id=p_cotacao and m.cliente_id=cotacao.cliente_id and m.unidade=cotacao.unidade
        and r.setor='pecas' and m.assumido_por is null;
    if found then
      select c.nome,c.ultimo_contato_em into cliente from public.clientes c where c.id=cotacao.cliente_id and not c.anonimizado for share;
      if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
      return pg_catalog.jsonb_build_object('ok',true,'id',a.id,'cotacaoId',p_cotacao,'versao',a.versao,
        'clienteNome',coalesce(cliente.nome,'Cliente'),'estado','livre','podeAssumir',true,'podeDevolver',false,
        'janelaAberta',coalesce(cliente.ultimo_contato_em>now()-interval '24 hours',false),
        'mensagens','[]'::jsonb,'revisaoPendente',false);
    end if;
    return pg_catalog.jsonb_build_object('ok',false,'codigo','sem_responsavel');
  end if;
  if cotacao.responsavel_id <> p_ator and pessoa.papel not in ('admin','gerente') then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  select nome,ultimo_contato_em into cliente from public.clientes where id=cotacao.cliente_id and not anonimizado for share;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  if not exists(select 1 from public.conversas c where c.cliente_id=cotacao.cliente_id) then
    -- Cotação pode ter sido atribuída antes do primeiro contato. GET não cria canal;
    -- a ação de assumir fará isso atomicamente e revalidará a versão/posse atuais.
    return pg_catalog.jsonb_build_object('ok',true,'id',null,'cotacaoId',p_cotacao,'versao',0,
      'clienteNome',coalesce(cliente.nome,'Cliente'),'estado','livre',
      'podeAssumir',cotacao.responsavel_id=p_ator,'podeDevolver',false,
      'janelaAberta',coalesce(cliente.ultimo_contato_em>now()-interval '24 hours',false),
      'mensagens','[]'::jsonb,'revisaoPendente',false);
  end if;
  select * into ctx from public.contexto_atendimento_modular('pecas',p_cotacao,p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  select nome,ultimo_contato_em into cliente from public.clientes where id = ctx.cliente_id;
  select * into a from public.atendimentos_modulares where cotacao_id = p_cotacao;
  if found and (a.cliente_id <> ctx.cliente_id or a.conversa_id <> ctx.conversa_id or a.unidade <> ctx.unidade) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  select status,assumida_por into canal from public.conversas where id = ctx.conversa_id;
  select atendimento_id into reservado from public.atendimento_canais where conversa_id = ctx.conversa_id;
  if canal.assumida_por is not null or (reservado is not null and reservado is distinct from a.id) or a.assumido_por is not null then estado := 'outra'; end if;
  if a.assumido_por = p_ator and a.dono_na_posse = ctx.responsavel_id and reservado = a.id and canal.status = 'humano' and canal.assumida_por is null then estado := 'minha'; end if;
  with escopo as materialized (
    select s.id from public.atendimentos_legiveis(p_ator,'pecas') s where s.id = a.id
  ), candidatas as materialized (
    select m.id,m.conteudo,m.direcao,m.autor,m.tipo,m.status,m.criado_em,m.erro,
      case when m.atendimento_id = e.id then
        ((m.direcao = 'saida' and m.autor = 'atendente' and coalesce(m.metadata->'interno','false'::jsonb) = 'false'::jsonb) or
          (m.entrada_cliente_externa and not exists(select 1 from public.vendas_encaminhamentos_bot v where v.referencia = m.wamid)
            and not exists(select 1 from public.encaminhamentos_bot v where v.referencia = m.wamid and
              (v.destino <> 'pecas' or v.cotacao_id is distinct from p_cotacao or v.cliente_id <> ctx.cliente_id
               or v.conversa_id <> ctx.conversa_id or v.unidade <> ctx.unidade))))
      else exists(select 1 from public.associacoes_mensagens_atendimento(e.id,'pecas') v where v.mensagem_id = m.id and v.autorizada) end as permitida
    from escopo e join public.mensagens m on m.conversa_id = ctx.conversa_id and m.cliente_id = ctx.cliente_id
    where m.atendimento_id = e.id or exists(select 1 from public.atendimento_mensagens v where v.atendimento_id = e.id and v.mensagem_id = m.id)
  ), todas as (
    select * from candidatas where permitida
    union all select s.id,s.conteudo,s.direcao,s.autor,s.tipo,s.status,s.criado_em,null::text,true
      from public.mensagens_snapshot_destino('pecas',p_cotacao,p_ator) s
  ), recentes as (
    select * from (select distinct on(id) * from todas order by id,criado_em desc) unicas
      order by criado_em desc,id desc limit 100
  )
  select pg_catalog.jsonb_build_object('ok',true,'id',a.id,'cotacaoId',p_cotacao,'versao',coalesce(a.versao,0),
    'clienteNome',coalesce(cliente.nome,'Cliente'),'estado',estado,
    'podeAssumir',estado='livre' and ctx.responsavel_id=p_ator and (not exists(select 1 from public.atendimento_rotas_setores r where r.conversa_id=ctx.conversa_id) or public.rota_permite_atendimento(a.id)),
    'podeDevolver',coalesce(estado = 'minha' or (pessoa.papel in ('admin','gerente') and a.assumido_por is not null
      and a.dono_na_posse = ctx.responsavel_id and reservado = a.id and canal.status = 'humano' and canal.assumida_por is null),false),
    'janelaAberta',coalesce(cliente.ultimo_contato_em > now() - interval '24 hours',false),
    'mensagens',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id,'conteudo',m.conteudo,
      'direcao',m.direcao,'autor',m.autor,'tipo',m.tipo,'status',m.status,'criadoEm',m.criado_em,
      'pendente',coalesce(m.erro = 'envio_em_processamento',false)) order by m.criado_em,m.id) from recentes m),'[]'::jsonb),
    'revisaoPendente',exists(select 1 from candidatas where not permitida)
  ) into resultado;
  return resultado;
end $$;

create or replace function public.pecas_reservar_resposta(p_cotacao uuid,p_ator uuid,p_versao integer,p_mensagem uuid,p_texto text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb; m record;
begin
  if p_mensagem is null or p_texto is null or char_length(p_texto) not between 1 and 4000 or btrim(p_texto) = '' then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  ctx := public.pecas_contexto_posse(p_cotacao,p_ator,p_versao);
  if ctx->>'ok' <> 'true' then return ctx; end if;
  select id,atendimento_id,cliente_id,conversa_id,autor,direcao,conteudo,metadata,status into m
    from public.mensagens where id = p_mensagem for update;
  if found then
    if m.atendimento_id is distinct from (ctx->>'id')::uuid or m.cliente_id is distinct from (ctx->>'clienteId')::uuid
      or m.conversa_id is distinct from (ctx->>'conversaId')::uuid or m.autor <> 'atendente' or m.direcao <> 'saida'
      or m.conteudo is distinct from p_texto or m.metadata->>'ator_id' is distinct from p_ator::text
      or coalesce(m.metadata->'interno','false'::jsonb) <> 'false'::jsonb then
      return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
    end if;
    if m.status in ('enviada','entregue','lida') then return ctx || pg_catalog.jsonb_build_object('mensagemId',p_mensagem,'despachar',false); end if;
    if m.metadata->>'estagio' is distinct from 'reservado' then
      return pg_catalog.jsonb_build_object('ok',false,'codigo','envio_incerto');
    end if;
  else
    insert into public.mensagens(id,conversa_id,cliente_id,atendimento_id,direcao,autor,tipo,conteudo,status,erro,metadata)
      values(p_mensagem,(ctx->>'conversaId')::uuid,(ctx->>'clienteId')::uuid,(ctx->>'id')::uuid,'saida','atendente','text',p_texto,
        'bloqueada','envio_em_processamento',pg_catalog.jsonb_build_object('ator_id',p_ator,'estagio','reservado'));
  end if;
  return ctx || pg_catalog.jsonb_build_object('mensagemId',p_mensagem,'despachar',true);
end $$;

create or replace function public.pecas_autorizar_resposta(p_cotacao uuid,p_ator uuid,p_versao integer,p_mensagem uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb;
begin
  ctx := public.pecas_contexto_posse(p_cotacao,p_ator,p_versao);
  if ctx->>'ok' <> 'true' then return ctx; end if;
  update public.mensagens set metadata = metadata || pg_catalog.jsonb_build_object('estagio','despachando')
    where id = p_mensagem and atendimento_id = (ctx->>'id')::uuid and cliente_id = (ctx->>'clienteId')::uuid
      and conversa_id = (ctx->>'conversaId')::uuid and autor = 'atendente' and direcao = 'saida'
      and status = 'bloqueada' and metadata->>'ator_id' = p_ator::text and metadata->>'estagio' = 'reservado'
      and coalesce(metadata->'interno','false'::jsonb) = 'false'::jsonb;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito'); end if;
  return ctx || pg_catalog.jsonb_build_object('mensagemId',p_mensagem);
end $$;

revoke all on function public.pecas_vincular_entrada_ativa() from public,anon,authenticated,service_role;
revoke all on function public.pecas_preservar_vinculo_dialogo() from public,anon,authenticated,service_role;
revoke all on function public.pecas_proteger_posse_aberta() from public,anon,authenticated,service_role;
revoke all on function public.pecas_contexto_posse(uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.pecas_contexto_posse(uuid,uuid,integer,boolean) from public,anon,authenticated,service_role;
revoke all on function public.pecas_assumir_atendimento(uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.pecas_devolver_atendimento(uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.pecas_dialogo(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.pecas_reservar_resposta(uuid,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.pecas_autorizar_resposta(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pecas_vincular_entrada_ativa(),public.pecas_preservar_vinculo_dialogo(),public.pecas_proteger_posse_aberta() to service_role;
grant execute on function public.pecas_contexto_posse(uuid,uuid,integer),public.pecas_contexto_posse(uuid,uuid,integer,boolean),public.pecas_assumir_atendimento(uuid,uuid,integer),
  public.pecas_devolver_atendimento(uuid,uuid,integer),public.pecas_dialogo(uuid,uuid),
  public.pecas_reservar_resposta(uuid,uuid,integer,uuid,text),public.pecas_autorizar_resposta(uuid,uuid,integer,uuid) to service_role;


-- Apêndice proposto para 0006_atendimento.sql; aplicar depois das tabelas modulares.
-- CR-PEC-001: histórico modular não exclui o cliente para sempre da recepção.
-- Negócio ainda aberto OU reserva vigente bloqueia o canal, mesmo sem claimant ativo.
create index if not exists atendimentos_modulares_conversa_idx
  on public.atendimentos_modulares(conversa_id);

create or replace view public.atendimentos_modulares_ativos
with (security_invoker = true, security_barrier = true) as
select a.id,a.cliente_id,a.conversa_id,a.setor,a.unidade,
  coalesce(p.responsavel_id,v.vendedor_id) as responsavel_id
from public.atendimentos_modulares a
left join public.pecas_cotacoes p on p.id=a.cotacao_id
left join public.vendas_oportunidades v on v.id=a.oportunidade_id
where exists(select 1 from public.atendimento_canais s where s.atendimento_id=a.id)
  or (a.setor='pecas' and p.status in ('novo','em_cotacao','aguardando_cliente','aprovado','em_separacao'))
  or (a.setor='vendas' and v.id is not null and v.fechado_em is null);

-- Campos planos da ficha evitam inferência de relacionamentos sobre views no PostgREST.
create or replace view public.conversas_legadas
with (security_invoker = true, security_barrier = true) as
select c.id, c.cliente_id, c.status, c.motivo_transferencia, c.aguardando_desde,
  c.assumida_por, c.assumida_em, c.alerta_reenviado_em, c.encerrada_em,
  c.resultado, c.falhas_entendimento, c.ultima_msg_em, c.nao_lidas, c.criado_em,
  c.unidade, cl.nome as cliente_nome, cl.telefone as cliente_telefone
from public.conversas c
join public.clientes cl on cl.id = c.cliente_id
where not exists (
  select 1 from public.atendimentos_modulares_ativos a where a.conversa_id = c.id
);

create or replace view public.mensagens_legadas
with (security_invoker = true, security_barrier = true) as
select m.id, m.conversa_id, m.cliente_id, m.direcao, m.autor, m.tipo,
  m.conteudo, m.status, m.erro, m.criado_em
from public.mensagens m
where m.atendimento_id is null
  and not exists(select 1 from public.atendimento_mensagens v where v.mensagem_id=m.id)
  and not exists (
    select 1 from public.atendimentos_modulares_ativos a where a.conversa_id = m.conversa_id
  );

revoke all on public.atendimentos_modulares_ativos, public.conversas_legadas, public.mensagens_legadas
  from public, anon, authenticated, service_role;
grant select on public.atendimentos_modulares_ativos, public.conversas_legadas, public.mensagens_legadas to service_role;
-- Dependências invoker explícitas, sem permissões de escrita adicionais nas bases.
grant select (id, cliente_id, status, motivo_transferencia, aguardando_desde,
  assumida_por, assumida_em, alerta_reenviado_em, encerrada_em, resultado,
  falhas_entendimento, ultima_msg_em, nao_lidas, criado_em, unidade)
  on public.conversas to service_role;
grant select (id, nome, telefone) on public.clientes to service_role;
grant select (id, conversa_id, cliente_id, direcao, autor, tipo, conteudo, status, erro, criado_em)
  on public.mensagens to service_role;
grant select (conversa_id) on public.atendimentos_modulares, public.atendimento_canais to service_role;

-- O UPDATE da conversa já bloqueia sua linha. O claim modular bloqueia a mesma
-- conversa antes de reservar o canal: a exclusão não depende de flag do cliente.
-- A devolução modular apaga seu próprio slot antes de mudar o status físico.
create or replace function public.impedir_posse_legada_em_canal_modular()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.atendimento_canais c where c.conversa_id = old.id) then
    raise exception using errcode = '55000', message = 'Canal reservado para atendimento modular.';
  end if;
  return new;
end $$;
revoke all on function public.impedir_posse_legada_em_canal_modular()
  from public, anon, authenticated, service_role;
grant execute on function public.impedir_posse_legada_em_canal_modular() to service_role;
drop trigger if exists impedir_posse_legada_em_canal_modular on public.conversas;
create trigger impedir_posse_legada_em_canal_modular
before update of status, assumida_por on public.conversas
for each row when (old.status is distinct from new.status or old.assumida_por is distinct from new.assumida_por)
execute function public.impedir_posse_legada_em_canal_modular();

-- O pedido humano continua visível enquanto um setor detém o canal. Usa a central
-- já existente; não transfere posse, não expõe histórico e não envia WhatsApp direto.
create or replace function public.registrar_pedido_humano_modular(p_cliente uuid,p_motivo text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare canal uuid; atendimento record; destinos uuid[]; total integer:=0; inseridas integer;
begin
  if p_cliente is null or p_motivo is null or char_length(btrim(p_motivo)) not between 1 and 300 then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  perform 1 from public.clientes c where c.id=p_cliente and not c.anonimizado for share;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  select c.id into canal from public.conversas c where c.cliente_id=p_cliente for update;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  if not exists(select 1 from public.atendimentos_modulares_ativos a where a.conversa_id=canal) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','legado');
  end if;
  for atendimento in
    select v.*,a.assumido_por,a.cotacao_id,a.oportunidade_id
    from public.atendimentos_modulares_ativos v join public.atendimentos_modulares a on a.id=v.id
    where v.conversa_id=canal and (not exists(select 1 from public.atendimento_canais s where s.conversa_id=canal)
      or exists(select 1 from public.atendimento_canais s where s.conversa_id=canal and s.atendimento_id=v.id))
  loop
    destinos:=null;
    -- Claimant elegível primeiro; responsável do negócio é a segunda opção.
    select array[u.user_id] into destinos from public.usuarios u
    join public.unidades loja on loja.chave=atendimento.unidade and loja.ativa
    where u.user_id=any(array[atendimento.assumido_por,atendimento.responsavel_id]) and u.ativo
      and (u.papel='admin' or (u.papel='gerente' and u.setor in (atendimento.setor,'administracao'))
        or (atendimento.setor='pecas' and u.papel='pecas') or (atendimento.setor='vendas' and u.papel='vendedor'))
      and (u.papel='admin' or u.unidade=atendimento.unidade or exists(
        select 1 from public.usuario_unidades x where x.user_id=u.user_id and x.unidade=atendimento.unidade))
    order by (u.user_id=atendimento.assumido_por) desc nulls last,u.user_id limit 1;
    if destinos is null then
      select array_agg(u.user_id) into destinos from public.usuarios u
      join public.unidades loja on loja.chave=atendimento.unidade and loja.ativa
      where u.ativo and (u.papel in ('admin','recepcao','atendente')
        or (u.papel='gerente' and u.setor in (atendimento.setor,'administracao')))
        and (u.papel='admin' or u.unidade=atendimento.unidade or exists(
          select 1 from public.usuario_unidades x where x.user_id=u.user_id and x.unidade=atendimento.unidade));
    end if;
    insert into public.notificacoes(usuario_id,unidade,tipo,titulo,corpo,link)
      select u.user_id,atendimento.unidade,'atendimento','Pedido de atendimento humano',
        'Há um pedido de atendimento no setor '||atendimento.setor||'. Confira o atendimento com a equipe responsável.',
        case when u.papel in ('recepcao','atendente') then null
          when atendimento.setor='pecas' then '/painel/pecas?cotacao='||atendimento.cotacao_id::text
          else '/painel/vendas?op='||atendimento.oportunidade_id::text end
      from public.usuarios u where u.user_id=any(destinos) and u.ativo
        and (u.papel in ('admin','recepcao','atendente')
          or (u.papel='gerente' and u.setor in (atendimento.setor,'administracao'))
          or (atendimento.setor='pecas' and u.papel='pecas') or (atendimento.setor='vendas' and u.papel='vendedor'))
        and exists(select 1 from public.unidades loja where loja.chave=atendimento.unidade and loja.ativa)
        and (u.papel='admin' or u.unidade=atendimento.unidade or exists(
          select 1 from public.usuario_unidades x where x.user_id=u.user_id and x.unidade=atendimento.unidade));
    get diagnostics inseridas=row_count;
    total:=total+inseridas;
  end loop;
  -- Não copiar motivo bruto/trechos do cliente para avisos ou auditoria.
  insert into public.audit_log(ator,acao,entidade,entidade_id,dados)
    values('sistema',case when total>0 then 'pedido_humano_modular' else 'pedido_humano_modular_sem_destinatario' end,
      'conversa',canal::text,pg_catalog.jsonb_build_object('destinatarios',total));
  if total=0 then return pg_catalog.jsonb_build_object('ok',false,'codigo','sem_destinatario'); end if;
  return pg_catalog.jsonb_build_object('ok',true,'destinatarios',total);
end $$;
revoke all on function public.registrar_pedido_humano_modular(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.registrar_pedido_humano_modular(uuid,text) to service_role;
grant insert(usuario_id,unidade,tipo,titulo,corpo,link) on public.notificacoes to service_role;

-- Quadro do piloto: carteira/fila autorizada no mesmo statement que lê os dados.
-- Também é a origem da leitura direta do detalhe, sem autorização só pela unidade da sessão.
create or replace function public.pecas_cotacoes_visiveis(p_ator uuid)
returns setof public.pecas_cotacoes language sql stable security invoker set search_path = '' as $$
  select c.* from public.pecas_cotacoes c
  join public.unidades loja on loja.chave=c.unidade and loja.ativa
  join public.clientes cl on cl.id=c.cliente_id and not cl.anonimizado
  join public.usuarios u on u.user_id=p_ator and u.ativo
  where (u.papel in ('admin','pecas') or (u.papel='gerente' and u.setor in ('pecas','administracao')))
    and (u.papel='admin' or u.unidade=c.unidade or exists(
      select 1 from public.usuario_unidades x where x.user_id=u.user_id and x.unidade=c.unidade))
    and (u.papel in ('admin','gerente') or c.responsavel_id=p_ator or c.responsavel_id is null);
$$;

create or replace function public.pecas_quadro(p_ator uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with cartoes as (
    select c.id,c.posicao,c.criado_em,
      pg_catalog.jsonb_build_object('id',c.id,'unidade',c.unidade,'origem',c.origem,'descricao',c.descricao,
        'status',c.status,'posicao',c.posicao,'criadoEm',c.criado_em,
        'entrouEm',coalesce(h.etapa_em,c.criado_em),
        'atualizadoEm',greatest(c.criado_em,c.atualizado_em,h.atualizado_em,m.contato_em),
        'ultimoContatoEm',m.contato_em,'clienteNome',cl.nome,'responsavelNome',u.nome,
        'responsavelId',c.responsavel_id,'valorCentavos',i.total,'itensVersoes',coalesce(i.versoes,'{}'::jsonb),
        'podeMover',c.status not in ('entregue','perdido','cancelado') and
          (c.responsavel_id=p_ator or c.responsavel_id is null)) as cartao
    from public.pecas_cotacoes_visiveis(p_ator) c
    join public.clientes cl on cl.id=c.cliente_id
    left join public.usuarios u on u.user_id=c.responsavel_id
    left join lateral (
      select sum(it.quantidade::bigint * it.preco_unitario_centavos)::bigint as total,
        pg_catalog.jsonb_object_agg(it.id::text,it.versao) as versoes
      from public.pecas_cotacao_itens it where it.cotacao_id=c.id
    ) i on true
    left join lateral (
      select max(h.ocorrido_em) as atualizado_em,
        max(h.ocorrido_em) filter(where h.para_status=c.status and h.de_status<>h.para_status) as etapa_em
      from public.pecas_cotacoes_historico h where h.cotacao_id=c.id
    ) h on true
    left join lateral (
      select max(msg.criado_em) as contato_em from public.mensagens msg
      join public.conversas cv on cv.id=msg.conversa_id and cv.cliente_id=c.cliente_id
      left join public.atendimentos_modulares a on a.cotacao_id=c.id and a.cliente_id=c.cliente_id
        and a.conversa_id=cv.id and a.unidade=c.unidade and a.setor='pecas'
      where msg.cliente_id=c.cliente_id and coalesce(msg.metadata->'interno','false'::jsonb)='false'::jsonb
        and ((msg.atendimento_id=a.id and msg.direcao='saida' and msg.autor='atendente' and msg.status in ('enviada','entregue','lida')) or
          (msg.entrada_cliente_externa
            and not exists(select 1 from public.vendas_encaminhamentos_bot v where v.referencia=msg.wamid)
            and not exists(select 1 from public.encaminhamentos_bot e where e.referencia=msg.wamid and
              (e.destino<>'pecas' or e.cotacao_id is distinct from c.id or e.cliente_id<>c.cliente_id
                or e.conversa_id<>cv.id or e.unidade<>c.unidade))
            and (msg.atendimento_id=a.id or exists(select 1 from public.encaminhamentos_bot e
              where e.referencia=msg.wamid and e.destino='pecas' and e.cotacao_id=c.id
                and e.cliente_id=c.cliente_id and e.conversa_id=cv.id and e.unidade=c.unidade))))
    ) m on true
  ) select pg_catalog.jsonb_build_object('ok',true,
    'cotacoes',coalesce(pg_catalog.jsonb_agg(cartao order by posicao,criado_em,id),'[]'::jsonb),
    'total',count(*),'temMais',false) from cartoes;
$$;

-- Adapta o drag às transições de domínio já existentes, sem pulos arbitrários de etapa.
create or replace function public.pecas_mover_quadro(p_id uuid,p_ator uuid,p_destino text,p_posicao numeric,
  p_status_esperado text,p_itens jsonb,p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.pecas_cotacoes%rowtype; resultado text; mudou boolean := false;
begin
  if p_id is null or p_ator is null or p_destino is null or p_status_esperado is null
    or p_destino not in ('novo','em_cotacao','aguardando_cliente','aprovado','perdido','cancelado')
    or p_posicao is null or not (p_posicao between -1000000000 and 1000000000) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  perform 1 from public.usuarios where user_id=p_ator and ativo for share;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','indisponivel'); end if;
  select q.* into c from public.pecas_cotacoes q where q.id=p_id for update;
  if not found or not exists(select 1 from public.pecas_cotacoes_visiveis(p_ator) v where v.id=p_id)
    or (c.responsavel_id is not null and c.responsavel_id<>p_ator)
    or c.status in ('entregue','perdido','cancelado') then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','indisponivel');
  end if;
  if c.status<>p_status_esperado then return pg_catalog.jsonb_build_object('ok',false,'codigo','desatualizada'); end if;
  if p_destino in ('perdido','cancelado') and exists(select 1 from public.atendimentos_modulares a
    join public.atendimento_canais s on s.atendimento_id=a.id where a.cotacao_id=p_id) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','devolva_conversa');
  end if;
  if c.status=p_destino then mudou:=true;
  elsif p_destino='em_cotacao' and c.status='novo' then
    mudou:=public.pecas_assumir_cotacao(p_id,array[c.unidade],p_ator);
  elsif p_destino='aguardando_cliente' and c.status='em_cotacao' then
    resultado:=public.pecas_registrar_apresentacao(p_id,array[c.unidade],p_ator,p_itens);
    if resultado<>'apresentada' then return pg_catalog.jsonb_build_object('ok',false,'codigo',resultado); end if;
    mudou:=true;
  elsif p_destino='aprovado' and c.status='aguardando_cliente' then
    mudou:=public.pecas_registrar_aprovacao(p_id,array[c.unidade],p_ator);
  elsif p_destino in ('perdido','cancelado') then
    mudou:=public.pecas_encerrar_cotacao(p_id,array[c.unidade],p_ator,p_destino,p_motivo);
  end if;
  if not mudou then return pg_catalog.jsonb_build_object('ok',false,'codigo','transicao'); end if;
  update public.pecas_cotacoes set posicao=p_posicao where id=p_id;
  return pg_catalog.jsonb_build_object('ok',true);
end $$;

grant select on public.pecas_cotacoes_historico to service_role;
grant select (nome) on public.usuarios to service_role;
revoke all on function public.pecas_cotacoes_visiveis(uuid),public.pecas_quadro(uuid),
  public.pecas_mover_quadro(uuid,uuid,text,numeric,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.pecas_cotacoes_visiveis(uuid),public.pecas_quadro(uuid),
  public.pecas_mover_quadro(uuid,uuid,text,numeric,text,jsonb,text) to service_role;


-- MVP Vendas: conversa da oportunidade, sem transferir sua carteira ao supervisor.
-- A escolha inicial fica congelada inclusive quando não havia ledger na abertura.
alter table public.atendimentos_modulares add column if not exists referencia_inicial text;
alter table public.atendimentos_modulares add column if not exists origem_inicial_fixada boolean not null default false;
grant select(referencia_inicial,origem_inicial_fixada) on public.atendimentos_modulares to service_role;
grant update(referencia_inicial,origem_inicial_fixada) on public.atendimentos_modulares to service_role;

create or replace function public.vendas_proteger_posse_aberta()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.vendedor_id is distinct from old.vendedor_id or new.unidade is distinct from old.unidade
    or new.cliente_id is distinct from old.cliente_id or new.funil_id is distinct from old.funil_id
    or new.fechado_em is distinct from old.fechado_em
    or (new.etapa_id is distinct from old.etapa_id and exists(
      select 1 from public.vendas_etapas e where e.id=new.etapa_id and (e.tipo<>'aberta' or not e.ativo))))
    and exists(select 1 from public.atendimentos_modulares a join public.atendimento_canais s on s.atendimento_id=a.id
      where a.oportunidade_id=old.id) then
    raise exception 'Devolva o atendimento antes de encerrar ou reatribuir.' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists vendas_posse_aberta on public.vendas_oportunidades;
create trigger vendas_posse_aberta before update of vendedor_id,unidade,cliente_id,funil_id,fechado_em,etapa_id
  on public.vendas_oportunidades for each row execute function public.vendas_proteger_posse_aberta();

create or replace function public.vendas_proteger_etapa_funil_em_posse()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name='vendas_funis' then
    if old.ativo and not new.ativo and exists(select 1 from public.vendas_oportunidades o
      join public.atendimentos_modulares a on a.oportunidade_id=o.id
      join public.atendimento_canais s on s.atendimento_id=a.id where o.funil_id=old.id) then
      raise exception 'Devolva os atendimentos antes de desativar o funil.' using errcode='55000';
    end if;
  else
    if (new.tipo is distinct from old.tipo and new.tipo<>'aberta' or old.ativo and not new.ativo
      or new.funil_id is distinct from old.funil_id) and exists(select 1 from public.vendas_oportunidades o
        join public.atendimentos_modulares a on a.oportunidade_id=o.id
        join public.atendimento_canais s on s.atendimento_id=a.id where o.etapa_id=old.id) then
      raise exception 'Devolva os atendimentos antes de encerrar a etapa.' using errcode='55000';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists vendas_funil_em_posse on public.vendas_funis;
create trigger vendas_funil_em_posse before update of ativo on public.vendas_funis
  for each row execute function public.vendas_proteger_etapa_funil_em_posse();
drop trigger if exists vendas_etapa_em_posse on public.vendas_etapas;
create trigger vendas_etapa_em_posse before update of tipo,ativo,funil_id on public.vendas_etapas
  for each row execute function public.vendas_proteger_etapa_funil_em_posse();

-- Sobrecarga de supervisão só serve à devolução; responder continua exigindo posse pessoal.
create or replace function public.vendas_contexto_posse(p_oportunidade uuid,p_ator uuid,p_versao integer,p_supervisao boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx record; a public.atendimentos_modulares%rowtype; c record;
begin
  select * into ctx from public.contexto_atendimento_modular('vendas',p_oportunidade,p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  perform 1 from public.vendas_oportunidades o join public.vendas_etapas e on e.id=o.etapa_id and e.funil_id=o.funil_id
    where o.id=p_oportunidade and e.ativo and e.tipo='aberta' for share of e;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  select status,assumida_por into c from public.conversas where id=ctx.conversa_id for update;
  select * into a from public.atendimentos_modulares where oportunidade_id=p_oportunidade for update;
  if not found or a.setor<>'vendas' or a.cliente_id<>ctx.cliente_id or a.conversa_id<>ctx.conversa_id or a.unidade<>ctx.unidade then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  if p_versao is null or a.versao<>p_versao or a.assumido_por is null
    or (a.assumido_por is distinct from p_ator and not (p_supervisao is true and exists(
      select 1 from public.usuarios u where u.user_id=p_ator and u.ativo and u.papel in ('admin','gerente'))))
    or a.dono_na_posse is distinct from ctx.responsavel_id or c.status<>'humano' or c.assumida_por is not null
    or not exists(select 1 from public.atendimento_canais s where s.conversa_id=a.conversa_id and s.atendimento_id=a.id) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
  end if;
  return pg_catalog.jsonb_build_object('ok',true,'id',a.id,'oportunidadeId',p_oportunidade,'versao',a.versao,
    'clienteId',a.cliente_id,'conversaId',a.conversa_id);
end $$;

create or replace function public.vendas_contexto_posse(p_oportunidade uuid,p_ator uuid,p_versao integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb; a record; prova jsonb;
begin
  ctx:=public.vendas_contexto_posse(p_oportunidade,p_ator,p_versao,false);
  if ctx->>'ok'<>'true' then return ctx; end if;
  select referencia_inicial,origem_inicial_fixada,unidade into a from public.atendimentos_modulares where id=(ctx->>'id')::uuid;
  if not a.origem_inicial_fixada then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito'); end if;
  if a.referencia_inicial is not null then
    if exists(select 1 from public.mensagens m where m.wamid=a.referencia_inicial
      and m.atendimento_id is not null and m.atendimento_id<>(ctx->>'id')::uuid) then
      return pg_catalog.jsonb_build_object('ok',false,'codigo','origem_ambigua');
    end if;
    prova:=public.autorizar_mensagem_atendimento((ctx->>'id')::uuid,a.referencia_inicial,p_ator,'vendas');
    if prova->>'ok'<>'true' then return prova; end if;
  end if;
  if exists(select 1 from public.mensagens m where m.atendimento_id=(ctx->>'id')::uuid and m.entrada_cliente_externa and (
    exists(select 1 from public.encaminhamentos_bot e where e.referencia=m.wamid)
    or exists(select 1 from public.vendas_encaminhamentos_bot e where e.referencia=m.wamid and
      (e.oportunidade_id is distinct from p_oportunidade or e.cliente_id<>m.cliente_id
        or e.conversa_id<>m.conversa_id or e.unidade<>a.unidade)))) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','origem_ambigua');
  end if;
  return ctx;
end $$;

create or replace function public.vendas_assumir_atendimento(p_oportunidade uuid,p_ator uuid,p_versao integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare pessoa record; op public.vendas_oportunidades%rowtype; canal record; a public.atendimentos_modulares%rowtype;
  r jsonb; referencia text; primeira boolean; mudou boolean; anterior integer;
begin
  if p_oportunidade is null or p_ator is null or p_versao is null or p_versao not between 0 and 2147483646 then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  begin
    select user_id,nome,papel,setor,unidade into pessoa from public.usuarios where user_id=p_ator and ativo for share;
    if not found or not (pessoa.papel in ('admin','vendedor') or (pessoa.papel='gerente' and pessoa.setor in ('vendas','administracao'))) then raise sqlstate 'P1004'; end if;
    select o.* into op from public.vendas_oportunidades o join public.unidades u on u.chave=o.unidade and u.ativa
      where o.id=p_oportunidade and o.fechado_em is null for update of o;
    if not found or op.vendedor_id is null or (pessoa.papel not in ('admin','gerente') and op.vendedor_id<>p_ator)
      or (pessoa.papel<>'admin' and pessoa.unidade<>op.unidade and not exists(
        select 1 from public.usuario_unidades x where x.user_id=p_ator and x.unidade=op.unidade)) then raise sqlstate 'P1004'; end if;
    perform 1 from public.vendas_funis f where f.id=op.funil_id and f.ativo for share;
    if not found then raise sqlstate 'P1004'; end if;
    perform 1 from public.vendas_etapas e where e.id=op.etapa_id and e.funil_id=op.funil_id and e.ativo and e.tipo='aberta' for share;
    if not found then raise sqlstate 'P1004'; end if;
    perform 1 from public.clientes cl where cl.id=op.cliente_id and not cl.anonimizado for share;
    if not found then raise sqlstate 'P1004'; end if;
    insert into public.conversas(cliente_id) values(op.cliente_id) on conflict(cliente_id) do nothing;
    select id,status,assumida_por into canal from public.conversas where cliente_id=op.cliente_id for update;
    select * into a from public.atendimentos_modulares where oportunidade_id=p_oportunidade for update;
    primeira:=not found;
    if not primeira and (a.setor<>'vendas' or a.cliente_id<>op.cliente_id or a.conversa_id<>canal.id or a.unidade<>op.unidade) then raise sqlstate 'P1004'; end if;
    if (not primeira and a.versao<>p_versao) or (primeira and p_versao<>0) then raise sqlstate 'P1009'; end if;
    if canal.assumida_por is not null or exists(select 1 from public.atendimento_canais s
      where s.conversa_id=canal.id and (a.id is null or s.atendimento_id<>a.id))
      or (a.assumido_por is not null and a.assumido_por<>p_ator) then raise sqlstate 'P1009'; end if;
    r:=public.abrir_atendimento_modular('vendas',p_oportunidade,p_ator);
    if r->>'ok'<>'true' then raise sqlstate 'P1009'; end if;
    select * into a from public.atendimentos_modulares where id=(r->>'id')::uuid;
    anterior:=a.versao;
    if not a.origem_inicial_fixada then
      -- Ledger não tem id: referencia é a PK estável usada para desempatar criado_em.
      select e.referencia into referencia from public.vendas_encaminhamentos_bot e
        join public.mensagens m on m.id=e.mensagem_id and m.conversa_id=e.conversa_id and m.cliente_id=e.cliente_id
          and m.wamid=e.referencia and m.entrada_cliente_externa
        where e.oportunidade_id=op.id and e.cliente_id=op.cliente_id and e.conversa_id=canal.id
          and e.unidade=op.unidade and e.funil_id=op.funil_id
        order by e.criado_em desc,e.referencia desc limit 1;
      -- Origem de marketing não é prova de mensagem. Sem ledger, abre vazio;
      -- ledger contraditório nunca é tratado como cadastro manual.
      if referencia is null and exists(select 1 from public.vendas_encaminhamentos_bot e where e.oportunidade_id=op.id) then raise sqlstate 'P1004'; end if;
      if referencia is not null then
        if exists(select 1 from public.mensagens m where m.wamid=referencia
          and m.atendimento_id is not null and m.atendimento_id<>a.id) then raise sqlstate 'P1010'; end if;
        r:=public.vincular_mensagem_vendas(a.id,referencia,p_ator);
        if r->>'codigo'='origem_ambigua' then raise sqlstate 'P1010'; end if;
        if r->>'ok'<>'true' then raise sqlstate 'P1009'; end if;
      end if;
      update public.atendimentos_modulares set referencia_inicial=referencia,origem_inicial_fixada=true where id=a.id;
    elsif a.referencia_inicial is not null then
      r:=public.autorizar_mensagem_atendimento(a.id,a.referencia_inicial,p_ator,'vendas');
      if r->>'codigo'='origem_ambigua' then raise sqlstate 'P1010'; end if;
      if r->>'ok'<>'true' then raise sqlstate 'P1009'; end if;
    end if;
    update public.conversas set status='humano' where id=canal.id and status<>'humano';
    r:=public.assumir_atendimento_modular(a.id,p_ator,p_versao);
    if r->>'ok'<>'true' then raise sqlstate 'P1009'; end if;
    r:=public.vendas_contexto_posse(op.id,p_ator,(r->>'versao')::integer);
    if r->>'codigo'='origem_ambigua' then raise sqlstate 'P1010'; end if;
    if r->>'ok'<>'true' then raise sqlstate 'P1009'; end if;
    mudou:=(r->>'versao')::integer<>anterior;
    if mudou then
      insert into public.vendas_atividades(oportunidade_id,tipo,descricao,ator)
        values(op.id,'nota',left('Conversa assumida por '||pessoa.nome||'.',2000),p_ator::text);
      if op.vendedor_id<>p_ator then
        insert into public.notificacoes(usuario_id,unidade,tipo,titulo,corpo,link)
          values(op.vendedor_id,op.unidade,'atendimento','Conversa assumida pela gestão',
            left('Conversa assumida por '||pessoa.nome||'. O responsável da oportunidade foi preservado.',500),'/painel/vendas?op='||op.id::text);
      end if;
    end if;
    return pg_catalog.jsonb_build_object('ok',true,'id',a.id,'oportunidadeId',p_oportunidade,'versao',(r->>'versao')::integer,'estado','minha');
  exception when sqlstate 'P1004' then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
    when sqlstate 'P1009' then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
    when sqlstate 'P1010' then return pg_catalog.jsonb_build_object('ok',false,'codigo','origem_ambigua');
  end;
end $$;

create or replace function public.vendas_devolver_atendimento(p_oportunidade uuid,p_ator uuid,p_versao integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb; removido uuid; nova integer;
begin
  ctx:=public.vendas_contexto_posse(p_oportunidade,p_ator,p_versao,true);
  if ctx->>'ok'<>'true' then return ctx; end if;
  if p_versao>=2147483646 then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito'); end if;
  delete from public.atendimento_canais where conversa_id=(ctx->>'conversaId')::uuid and atendimento_id=(ctx->>'id')::uuid returning atendimento_id into removido;
  if not found then raise exception 'Reserva mudou.' using errcode='40001'; end if;
  update public.atendimentos_modulares set assumido_por=null,dono_na_posse=null,versao=versao+1 where id=removido returning versao into nova;
  update public.conversas set status='bot',assumida_por=null,aguardando_desde=null,falhas_entendimento=0 where id=(ctx->>'conversaId')::uuid;
  insert into public.audit_log(ator,acao,entidade,entidade_id,dados)
    values(p_ator::text,'vendas_devolver','atendimento',removido::text,pg_catalog.jsonb_build_object('versao',nova));
  return pg_catalog.jsonb_build_object('ok',true,'id',removido,'oportunidadeId',p_oportunidade,'versao',nova,'estado','livre');
end $$;


create or replace function public.vendas_dialogo(p_oportunidade uuid, p_ator uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx record; a public.atendimentos_modulares%rowtype; pessoa record; op record; cliente record;
  estado text := 'livre'; resultado jsonb; reservado uuid; canal record;
begin
  select user_id,papel,setor,unidade into pessoa from public.usuarios where user_id = p_ator and ativo for share;
  if not found or not (pessoa.papel in ('admin','vendedor') or (pessoa.papel = 'gerente' and pessoa.setor in ('vendas','administracao'))) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  select c.vendedor_id,c.unidade,c.cliente_id into op from public.vendas_oportunidades c join public.unidades u on u.chave = c.unidade and u.ativa
    where c.id = p_oportunidade and c.fechado_em is null and exists(select 1 from public.vendas_funis f where f.id=c.funil_id and f.ativo) and exists(select 1 from public.vendas_etapas e where e.id=c.etapa_id and e.funil_id=c.funil_id and e.ativo and e.tipo='aberta') for share of c;
  if not found or (pessoa.papel <> 'admin' and pessoa.unidade <> op.unidade and not exists(
    select 1 from public.usuario_unidades x where x.user_id = p_ator and x.unidade = op.unidade)) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  if op.vendedor_id is null then return pg_catalog.jsonb_build_object('ok',false,'codigo','sem_responsavel'); end if;
  if op.vendedor_id <> p_ator and pessoa.papel not in ('admin','gerente') then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  select nome,ultimo_contato_em into cliente from public.clientes where id=op.cliente_id and not anonimizado for share;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  if not exists(select 1 from public.conversas c where c.cliente_id=op.cliente_id) then
    -- Oportunidade pode ter sido atribuída antes do primeiro contato. GET não cria canal;
    -- a ação de assumir fará isso atomicamente e revalidará a versão/posse atuais.
    return pg_catalog.jsonb_build_object('ok',true,'id',null,'oportunidadeId',p_oportunidade,'versao',0,
      'clienteNome',coalesce(cliente.nome,'Cliente'),'estado','livre',
      'podeAssumir',true,'podeDevolver',false,
      'janelaAberta',coalesce(cliente.ultimo_contato_em>now()-interval '24 hours',false),
      'mensagens','[]'::jsonb,'revisaoPendente',false);
  end if;
  select * into ctx from public.contexto_atendimento_modular('vendas',p_oportunidade,p_ator);
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'); end if;
  select nome,ultimo_contato_em into cliente from public.clientes where id = ctx.cliente_id;
  select * into a from public.atendimentos_modulares where oportunidade_id = p_oportunidade;
  if found and (a.cliente_id <> ctx.cliente_id or a.conversa_id <> ctx.conversa_id or a.unidade <> ctx.unidade) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
  end if;
  select status,assumida_por into canal from public.conversas where id = ctx.conversa_id;
  select atendimento_id into reservado from public.atendimento_canais where conversa_id = ctx.conversa_id;
  if canal.assumida_por is not null or (reservado is not null and reservado is distinct from a.id) or a.assumido_por is not null then estado := 'outra'; end if;
  if a.assumido_por = p_ator and a.dono_na_posse = ctx.responsavel_id and reservado = a.id and canal.status = 'humano' and canal.assumida_por is null then estado := 'minha'; end if;
  with escopo as materialized (
    select s.id from public.atendimentos_legiveis(p_ator,'vendas') s where s.id = a.id
  ), candidatas as materialized (
    select m.id,m.conteudo,m.direcao,m.autor,m.tipo,m.status,m.criado_em,m.erro,
      case when m.atendimento_id = e.id then
        ((m.direcao = 'saida' and m.autor = 'atendente' and coalesce(m.metadata->'interno','false'::jsonb) = 'false'::jsonb) or
          (m.entrada_cliente_externa and not exists(select 1 from public.encaminhamentos_bot v where v.referencia=m.wamid)
            and not exists(select 1 from public.vendas_encaminhamentos_bot v where v.referencia=m.wamid and
              (v.oportunidade_id is distinct from p_oportunidade or v.cliente_id<>ctx.cliente_id
               or v.conversa_id<>ctx.conversa_id or v.unidade<>ctx.unidade))))
      else m.atendimento_id is null and exists(select 1 from public.associacoes_mensagens_atendimento(e.id,'vendas') v where v.mensagem_id = m.id and v.autorizada) end as permitida
    from escopo e join public.mensagens m on m.conversa_id = ctx.conversa_id and m.cliente_id = ctx.cliente_id
    where m.atendimento_id = e.id or exists(select 1 from public.atendimento_mensagens v where v.atendimento_id = e.id and v.mensagem_id = m.id and v.setor='vendas' and v.referencia=a.referencia_inicial and a.origem_inicial_fixada)
  ), todas as (
    select * from candidatas where permitida
    union all select s.id,s.conteudo,s.direcao,s.autor,s.tipo,s.status,s.criado_em,null::text,true
      from public.mensagens_snapshot_destino('vendas',p_oportunidade,p_ator) s
  ), recentes as (
    select * from (select distinct on(id) * from todas order by id,criado_em desc) unicas
      order by criado_em desc,id desc limit 100
  )
  select pg_catalog.jsonb_build_object('ok',true,'id',a.id,'oportunidadeId',p_oportunidade,'versao',coalesce(a.versao,0),
    'clienteNome',coalesce(cliente.nome,'Cliente'),'estado',estado,
    'podeAssumir',estado='livre' and (not exists(select 1 from public.atendimento_rotas_setores r where r.conversa_id=ctx.conversa_id) or public.rota_permite_atendimento(a.id)),
    'podeDevolver',coalesce(estado = 'minha' or (pessoa.papel in ('admin','gerente') and a.assumido_por is not null
      and a.dono_na_posse = ctx.responsavel_id and reservado = a.id and canal.status = 'humano' and canal.assumida_por is null),false),
    'janelaAberta',coalesce(cliente.ultimo_contato_em > now() - interval '24 hours',false),
    'mensagens',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id,'conteudo',m.conteudo,
      'direcao',m.direcao,'autor',m.autor,'tipo',m.tipo,'status',m.status,'criadoEm',m.criado_em,
      'pendente',coalesce(m.erro = 'envio_em_processamento',false)) order by m.criado_em,m.id) from recentes m),'[]'::jsonb),
    'revisaoPendente',exists(select 1 from candidatas where not permitida)
  ) into resultado;
  return resultado;
end $$;

create or replace function public.vendas_reservar_resposta(p_oportunidade uuid,p_ator uuid,p_versao integer,p_mensagem uuid,p_texto text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb; m record;
begin
  if p_mensagem is null or p_texto is null or char_length(p_texto) not between 1 and 4000 or btrim(p_texto) = '' then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  ctx := public.vendas_contexto_posse(p_oportunidade,p_ator,p_versao);
  if ctx->>'ok' <> 'true' then return ctx; end if;
  select id,atendimento_id,cliente_id,conversa_id,autor,direcao,conteudo,metadata,status into m
    from public.mensagens where id = p_mensagem for update;
  if found then
    if m.atendimento_id is distinct from (ctx->>'id')::uuid or m.cliente_id is distinct from (ctx->>'clienteId')::uuid
      or m.conversa_id is distinct from (ctx->>'conversaId')::uuid or m.autor <> 'atendente' or m.direcao <> 'saida'
      or m.conteudo is distinct from p_texto or m.metadata->>'ator_id' is distinct from p_ator::text
      or coalesce(m.metadata->'interno','false'::jsonb) <> 'false'::jsonb then
      return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
    end if;
    if m.status in ('enviada','entregue','lida') then return ctx || pg_catalog.jsonb_build_object('mensagemId',p_mensagem,'despachar',false); end if;
    if m.metadata->>'estagio' is distinct from 'reservado' then
      return pg_catalog.jsonb_build_object('ok',false,'codigo','envio_incerto');
    end if;
  else
    insert into public.mensagens(id,conversa_id,cliente_id,atendimento_id,direcao,autor,tipo,conteudo,status,erro,metadata)
      values(p_mensagem,(ctx->>'conversaId')::uuid,(ctx->>'clienteId')::uuid,(ctx->>'id')::uuid,'saida','atendente','text',p_texto,
        'bloqueada','envio_em_processamento',pg_catalog.jsonb_build_object('ator_id',p_ator,'estagio','reservado'));
  end if;
  return ctx || pg_catalog.jsonb_build_object('mensagemId',p_mensagem,'despachar',true);
end $$;

create or replace function public.vendas_autorizar_resposta(p_oportunidade uuid,p_ator uuid,p_versao integer,p_mensagem uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ctx jsonb;
begin
  ctx := public.vendas_contexto_posse(p_oportunidade,p_ator,p_versao);
  if ctx->>'ok' <> 'true' then return ctx; end if;
  update public.mensagens set metadata = metadata || pg_catalog.jsonb_build_object('estagio','despachando')
    where id = p_mensagem and atendimento_id = (ctx->>'id')::uuid and cliente_id = (ctx->>'clienteId')::uuid
      and conversa_id = (ctx->>'conversaId')::uuid and autor = 'atendente' and direcao = 'saida'
      and status = 'bloqueada' and metadata->>'ator_id' = p_ator::text and metadata->>'estagio' = 'reservado'
      and coalesce(metadata->'interno','false'::jsonb) = 'false'::jsonb;
  if not found then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito'); end if;
  return ctx || pg_catalog.jsonb_build_object('mensagemId',p_mensagem);
end $$;

-- Mantém o trigger único de Peças; amplia apenas o contexto validado da entrada.
create or replace function public.pecas_vincular_entrada_ativa()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare alvo public.atendimentos_modulares%rowtype; ctx record;
begin
  if new.direcao = 'entrada' and new.autor = 'cliente'
    and coalesce(new.metadata->'interno', 'false'::jsonb) = 'false'::jsonb then
    new.atendimento_id := null;
    select a.* into alvo from public.atendimento_canais s join public.atendimentos_modulares a on a.id = s.atendimento_id
      where s.conversa_id = new.conversa_id and a.cliente_id = new.cliente_id and a.setor in ('pecas','vendas');
    if not found or alvo.assumido_por is null then return new; end if;
    select * into ctx from public.contexto_atendimento_modular(alvo.setor,coalesce(alvo.oportunidade_id,alvo.cotacao_id),alvo.assumido_por);
    if not found or ctx.responsavel_id is distinct from alvo.dono_na_posse then return new; end if;
    perform 1 from public.conversas c where c.id = new.conversa_id and c.cliente_id = new.cliente_id
      and c.status = 'humano' and c.assumida_por is null for update;
    if not found then return new; end if;
    perform 1 from public.atendimentos_modulares a join public.atendimento_canais s on s.atendimento_id = a.id
      where a.id = alvo.id and s.conversa_id = new.conversa_id and a.assumido_por = alvo.assumido_por
        and a.dono_na_posse = ctx.responsavel_id and a.versao = alvo.versao;
    if found then new.atendimento_id := alvo.id; end if;
  end if;
  return new;
end $$;
revoke all on function public.vendas_proteger_posse_aberta() from public,anon,authenticated,service_role;
grant execute on function public.vendas_proteger_posse_aberta() to service_role;
revoke all on function public.vendas_proteger_etapa_funil_em_posse() from public,anon,authenticated,service_role;
grant execute on function public.vendas_proteger_etapa_funil_em_posse() to service_role;
revoke all on function public.vendas_contexto_posse(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.vendas_contexto_posse(uuid,uuid,integer) to service_role;
revoke all on function public.vendas_contexto_posse(uuid,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.vendas_contexto_posse(uuid,uuid,integer,boolean) to service_role;
revoke all on function public.vendas_assumir_atendimento(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.vendas_assumir_atendimento(uuid,uuid,integer) to service_role;
revoke all on function public.vendas_devolver_atendimento(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.vendas_devolver_atendimento(uuid,uuid,integer) to service_role;
revoke all on function public.vendas_dialogo(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.vendas_dialogo(uuid,uuid) to service_role;
revoke all on function public.vendas_reservar_resposta(uuid,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.vendas_reservar_resposta(uuid,uuid,integer,uuid,text) to service_role;
revoke all on function public.vendas_autorizar_resposta(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.vendas_autorizar_resposta(uuid,uuid,integer,uuid) to service_role;

-- Transferência entre setores (contrato de 12/11): negócio intacto, rota explícita
-- e compartilhamento somente do snapshot autorizado. Depende também de 0004.
create table if not exists public.transferencias_setores (
  operacao_id uuid primary key,
  origem text not null check (origem in ('central','vendas','pecas','oficina')),
  registro_origem uuid not null,
  ator_id uuid not null,
  destino text not null check (destino in ('vendas','pecas','oficina') and destino<>origem),
  funil text,
  responsavel_solicitado uuid,
  nota text not null check (char_length(nota) between 1 and 1000 and nota !~ '^[[:space:]]|[[:space:]]$'),
  versao_origem integer not null check (versao_origem between 0 and 2147483646),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  conversa_id uuid not null references public.conversas(id) on delete restrict,
  unidade text not null references public.unidades(chave),
  registro_destino uuid not null,
  reutilizado boolean not null,
  aviso_responsavel_nome text,
  criado_em timestamptz not null default now(),
  unique(operacao_id,conversa_id,cliente_id,unidade),
  check ((destino='vendas' and funil is not null and funil in ('novos','seminovos')) or (destino<>'vendas' and funil is null)),
  check (aviso_responsavel_nome is null or (reutilizado and char_length(aviso_responsavel_nome) between 1 and 200))
);
create index if not exists transferencias_setores_origem_idx
  on public.transferencias_setores(origem,registro_origem,criado_em,operacao_id);
create index if not exists transferencias_setores_destino_idx
  on public.transferencias_setores(destino,registro_destino,criado_em,operacao_id);

create table if not exists public.atendimento_rotas_setores (
  conversa_id uuid primary key,
  operacao_id uuid not null,
  cliente_id uuid not null,
  unidade text not null,
  setor text not null check (setor in ('central','vendas','pecas')),
  atendimento_id uuid references public.atendimentos_modulares(id) on delete restrict,
  nao_lidas integer not null default 0 check (nao_lidas between 0 and 2147483646),
  foreign key(operacao_id,conversa_id,cliente_id,unidade)
    references public.transferencias_setores(operacao_id,conversa_id,cliente_id,unidade) on delete restrict,
  foreign key(atendimento_id,conversa_id,cliente_id)
    references public.atendimentos_modulares(id,conversa_id,cliente_id) on delete restrict,
  check ((setor='central')=(atendimento_id is null))
);

create table if not exists public.transferencias_mensagens (
  operacao_id uuid not null,
  mensagem_id uuid not null references public.mensagens(id) on delete restrict,
  conversa_id uuid not null,
  cliente_id uuid not null,
  unidade text not null,
  destino text not null check (destino in ('vendas','pecas','oficina')),
  registro_destino uuid not null,
  direcao text not null check (direcao in ('entrada','saida')),
  autor text not null check (autor in ('cliente','atendente','bot','sistema')),
  tipo text not null,
  conteudo text,
  status text not null check (status in ('recebida','enviada','entregue','lida','falhou','bloqueada')),
  criado_em timestamptz not null,
  primary key(operacao_id,mensagem_id),
  foreign key(operacao_id,conversa_id,cliente_id,unidade)
    references public.transferencias_setores(operacao_id,conversa_id,cliente_id,unidade) on delete restrict,
  check ((direcao='entrada' and autor='cliente') or (direcao='saida' and autor in ('atendente','bot','sistema')))
);
create index if not exists transferencias_mensagens_destino_idx
  on public.transferencias_mensagens(destino,registro_destino,criado_em,mensagem_id);

alter table public.transferencias_setores enable row level security;
alter table public.atendimento_rotas_setores enable row level security;
alter table public.transferencias_mensagens enable row level security;
revoke all on public.transferencias_setores,public.atendimento_rotas_setores,public.transferencias_mensagens
  from public,anon,authenticated,service_role;
grant select,insert on public.transferencias_setores,public.transferencias_mensagens to service_role;
grant select,insert,update on public.atendimento_rotas_setores to service_role;

alter table public.mensagens add column if not exists transferencia_central_id uuid
  references public.transferencias_setores(operacao_id) on delete restrict;
create index if not exists mensagens_transferencia_central_idx
  on public.mensagens(transferencia_central_id,criado_em,id) where transferencia_central_id is not null;
grant select(transferencia_central_id),insert(transferencia_central_id) on public.mensagens to service_role;
grant select(nome) on public.usuarios to service_role;
grant select,insert on public.vendas_atividades,public.oficina_atendimentos to service_role;
grant update(responsavel_id) on public.oficina_atendimentos to service_role;
grant select on public.vendas_etapas to service_role;
grant insert on public.vendas_oportunidades to service_role;
grant update(unidade,assumida_em,alerta_reenviado_em) on public.conversas to service_role;

create or replace function public.rota_permite_atendimento(p_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.atendimentos_modulares a where a.id=p_id and not exists(
    select 1 from public.atendimento_rotas_setores r where r.conversa_id=a.conversa_id
      and r.atendimento_id is distinct from a.id));
$$;

create or replace function public.rota_destino_aberto(p_setor text,p_id uuid,p_cliente uuid,p_unidade text)
returns boolean language sql stable security invoker set search_path='' as $$
  select case p_setor
    when 'vendas' then exists(select 1 from public.vendas_oportunidades o join public.vendas_funis f on f.id=o.funil_id and f.ativo
      join public.vendas_etapas e on e.id=o.etapa_id and e.funil_id=o.funil_id and e.ativo and e.tipo='aberta'
      where o.id=p_id and o.cliente_id=p_cliente and o.unidade=p_unidade and o.fechado_em is null)
    when 'pecas' then exists(select 1 from public.pecas_cotacoes c where c.id=p_id and c.cliente_id=p_cliente
      and c.unidade=p_unidade and c.status not in ('entregue','perdido','cancelado'))
    else false end;
$$;

/** Política atual de leitura do item, nunca a pessoa meramente notificada. */
create or replace function public.destino_transferencia_legivel(
  p_setor text,p_registro uuid,p_ator uuid,p_cliente uuid,p_conversa uuid,p_unidade text
) returns boolean language sql stable security invoker set search_path='' as $$
  with dominio as (
    select o.cliente_id,o.unidade,o.vendedor_id as dono from public.vendas_oportunidades o
      join public.vendas_funis f on f.id=o.funil_id and f.ativo
      join public.vendas_etapas e on e.id=o.etapa_id and e.funil_id=o.funil_id and e.ativo and e.tipo='aberta'
      where p_setor='vendas' and o.id=p_registro and o.fechado_em is null
    union all select c.cliente_id,c.unidade,c.responsavel_id from public.pecas_cotacoes c
      where p_setor='pecas' and c.id=p_registro and c.status not in ('entregue','perdido','cancelado')
    union all select o.cliente_id,o.unidade,o.responsavel_id from public.oficina_atendimentos o
      where p_setor='oficina' and o.id=p_registro and o.status in ('novo','em_triagem')
  )
  select exists(select 1 from dominio d
    join public.usuarios u on u.user_id=p_ator and u.ativo
    join public.unidades un on un.chave=d.unidade and un.ativa
    join public.clientes c on c.id=d.cliente_id and not c.anonimizado
    join public.conversas canal on canal.id=p_conversa and canal.cliente_id=c.id
    where d.cliente_id=p_cliente and d.unidade=p_unidade
      and (u.papel='admin' or u.unidade=d.unidade or exists(select 1 from public.usuario_unidades x where x.user_id=p_ator and x.unidade=d.unidade))
      and (u.papel='admin' or (u.papel='gerente' and u.setor in (p_setor,'administracao'))
        or (d.dono=p_ator and ((p_setor='vendas' and u.papel='vendedor') or (p_setor='pecas' and u.papel='pecas')
          or (p_setor='oficina' and u.papel in ('consultor_tecnico','recepcao','atendente'))))
        or (p_setor='oficina' and u.papel in ('recepcao','atendente'))));
$$;

/** Filtro conservador de formatos de segredo; o adaptador também filtra a saída. */
create or replace function public.texto_compartilhavel_transferencia(p_texto text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select p_texto is null or p_texto !~* '(sk-ant-|sk-proj-|sb_secret_|sbp_|ghp_|github_pat_|-----BEGIN[[:space:]]+.*PRIVATE KEY|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(ql)?://|\m(senha|password|secret|token|chave)\M[[:space:]]*[:=][[:space:]]*[^[:space:]])';
$$;

/** Snapshot já compartilhado, reautorizado pelo destino no mesmo SELECT do corpo. */
create or replace function public.mensagens_snapshot_destino(p_setor text,p_registro uuid,p_ator uuid)
returns table(id uuid,conteudo text,direcao text,autor text,tipo text,status text,criado_em timestamptz)
language sql stable security invoker set search_path='' as $$
  select distinct on(s.mensagem_id) s.mensagem_id,s.conteudo,s.direcao,s.autor,s.tipo,s.status,s.criado_em
  from public.transferencias_mensagens s join public.transferencias_setores t on t.operacao_id=s.operacao_id
    and t.destino=s.destino and t.registro_destino=s.registro_destino
    and t.cliente_id=s.cliente_id and t.conversa_id=s.conversa_id and t.unidade=s.unidade
  where s.destino=p_setor and s.registro_destino=p_registro
    and public.destino_transferencia_legivel(s.destino,s.registro_destino,p_ator,s.cliente_id,s.conversa_id,s.unidade)
  order by s.mensagem_id,t.criado_em desc,t.operacao_id desc;
$$;

create or replace function public.ler_snapshot_transferencia(p_operacao uuid,p_ator uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce((select pg_catalog.jsonb_build_object('ok',true,
    'nota',t.nota,'origem',t.origem,'atorId',t.ator_id,'ocorridoEm',t.criado_em,'mensagens',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.mensagem_id,'conteudo',s.conteudo,'direcao',s.direcao,
      'autor',s.autor,'tipo',s.tipo,'status',s.status,'criadoEm',s.criado_em) order by s.criado_em,s.mensagem_id)
    from public.transferencias_mensagens s where s.operacao_id=t.operacao_id
      and s.cliente_id=t.cliente_id and s.conversa_id=t.conversa_id and s.unidade=t.unidade
      and s.destino=t.destino and s.registro_destino=t.registro_destino),'[]'::jsonb))
    from public.transferencias_setores t where t.operacao_id=p_operacao
      and public.destino_transferencia_legivel(t.destino,t.registro_destino,p_ator,t.cliente_id,t.conversa_id,t.unidade)),
    pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado'));
$$;

-- Fecha as aridades antigas sem ler/revogar privilégios do Auth compartilhado.
-- São somente funções desta entrega; nenhum dado ou vínculo é removido.
drop function if exists public.transferir_atendimento_setor(uuid,text,uuid,uuid,text,text,uuid,text,integer);
drop function if exists public.mensagens_origem_transferencia(text,uuid,uuid,uuid,uuid,text);
drop function if exists public.central_transferencia_legivel(uuid,uuid,text);

create or replace function public.central_transferencia_legivel(p_conversa uuid,p_ator uuid,p_unidade text,p_ator_email text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare u record; c record;
begin
  -- Somente o servidor chama a RPC e fornece o e-mail da sessão, nunca o formulário.
  if p_ator_email is null or p_ator_email='' or char_length(p_ator_email)>320 or p_ator_email<>btrim(p_ator_email)
    or position(chr(10) in p_ator_email)>0 or position(chr(13) in p_ator_email)>0 then return false; end if;
  select user_id,papel,setor,unidade into u from public.usuarios where user_id=p_ator and ativo;
  if not found or not (u.papel in ('admin','recepcao','atendente') or (u.papel='gerente' and u.setor in ('oficina','administracao'))) then return false; end if;
  perform 1 from public.unidades un where un.chave=p_unidade and un.ativa;
  if not found or (u.papel<>'admin' and u.unidade<>p_unidade and not exists(
    select 1 from public.usuario_unidades x where x.user_id=p_ator and x.unidade=p_unidade)) then return false; end if;
  select status,assumida_por,unidade,cliente_id into c from public.conversas_legadas where id=p_conversa;
  if not found or c.status<>'humano' or c.unidade<>p_unidade then return false; end if;
  if not exists(select 1 from public.clientes cl where cl.id=c.cliente_id and not cl.anonimizado) then return false; end if;
  if u.papel in ('admin','gerente') or c.assumida_por is null then return true; end if;
  return c.assumida_por=p_ator_email;
end $$;

/** Corpo e política são selecionados juntos; IDs desta função não são permissões futuras. */
create or replace function public.mensagens_origem_transferencia(
  p_origem text,p_registro uuid,p_ator uuid,p_cliente uuid,p_conversa uuid,p_unidade text,p_ator_email text
) returns table(id uuid,conteudo text,direcao text,autor text,tipo text,status text,criado_em timestamptz)
language sql stable security invoker set search_path='' as $$
  with origem as materialized (
    select a.* from public.atendimentos_legiveis(p_ator,p_origem) a
      where p_origem in ('vendas','pecas') and a.registro_id=p_registro and a.cliente_id=p_cliente
        and a.conversa_id=p_conversa and a.unidade=p_unidade
  ), proprias as (
    select m.id,m.conteudo,m.direcao,m.autor,m.tipo,m.status,m.criado_em
    from origem a join public.mensagens m on m.cliente_id=a.cliente_id and m.conversa_id=a.conversa_id
    where ((m.atendimento_id=a.id and (not m.entrada_cliente_externa or (
        not exists(select 1 from public.encaminhamentos_bot e where e.referencia=m.wamid and
          (p_origem<>'pecas' or e.destino<>'pecas' or e.cotacao_id is distinct from a.cotacao_id or e.cliente_id<>a.cliente_id or e.conversa_id<>a.conversa_id or e.unidade<>a.unidade))
        and not exists(select 1 from public.vendas_encaminhamentos_bot v where v.referencia=m.wamid and
          (p_origem<>'vendas' or v.oportunidade_id is distinct from a.oportunidade_id or v.cliente_id<>a.cliente_id or v.conversa_id<>a.conversa_id or v.unidade<>a.unidade)))))
      or (m.atendimento_id is null and exists(select 1 from public.associacoes_mensagens_atendimento(a.id,p_origem) v where v.mensagem_id=m.id and v.autorizada)))
      and coalesce(m.metadata->'interno','false'::jsonb)='false'::jsonb
      and ((m.direcao='entrada' and m.autor='cliente') or (m.direcao='saida' and m.autor='atendente'))
      and m.status in ('recebida','enviada','entregue','lida','falhou','bloqueada')
      and public.texto_compartilhavel_transferencia(m.conteudo)
  ), centro as (
    select m.id,m.conteudo,m.direcao,m.autor,m.tipo,m.status,m.criado_em
    from public.mensagens_legadas m join public.mensagens bruto on bruto.id=m.id
    where p_origem='central' and p_registro=p_conversa
      and public.central_transferencia_legivel(p_conversa,p_ator,p_unidade,p_ator_email)
      and m.conversa_id=p_conversa and m.cliente_id=p_cliente
      and coalesce(bruto.metadata->'interno','false'::jsonb)='false'::jsonb
      and ((m.direcao='entrada' and m.autor='cliente') or (m.direcao='saida' and m.autor in ('atendente','bot','sistema')))
      and public.texto_compartilhavel_transferencia(m.conteudo)
  ), compartilhadas as (
    select s.* from public.mensagens_snapshot_destino(p_origem,p_registro,p_ator) s
    where p_origem in ('vendas','pecas','oficina')
      and public.destino_transferencia_legivel(p_origem,p_registro,p_ator,p_cliente,p_conversa,p_unidade)
  )
  select distinct on(x.id) x.* from (
    select * from proprias union all select * from centro union all select * from compartilhadas
  ) x order by x.id;
$$;

create or replace function public.proteger_rota_do_canal()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if not public.rota_permite_atendimento(new.atendimento_id) then
    raise exception 'Canal encaminhado para outro contexto.' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists atendimento_canal_rota on public.atendimento_canais;
create trigger atendimento_canal_rota before insert or update on public.atendimento_canais
  for each row execute function public.proteger_rota_do_canal();

create or replace view public.atendimentos_modulares_ativos
with (security_invoker=true,security_barrier=true) as
select a.id,a.cliente_id,a.conversa_id,a.setor,a.unidade,coalesce(p.responsavel_id,v.vendedor_id) as responsavel_id
from public.atendimentos_modulares a
left join public.pecas_cotacoes p on p.id=a.cotacao_id
left join public.vendas_oportunidades v on v.id=a.oportunidade_id
where public.rota_permite_atendimento(a.id) and (
  exists(select 1 from public.atendimento_canais s where s.atendimento_id=a.id)
  or (a.setor='pecas' and p.status in ('novo','em_cotacao','aguardando_cliente','aprovado','em_separacao'))
  or (a.setor='vendas' and v.id is not null and v.fechado_em is null));

create or replace view public.conversas_legadas
with (security_invoker=true,security_barrier=true) as
select c.id,c.cliente_id,c.status,c.motivo_transferencia,c.aguardando_desde,
  c.assumida_por,c.assumida_em,c.alerta_reenviado_em,c.encerrada_em,c.resultado,c.falhas_entendimento,c.ultima_msg_em,
  case when r.conversa_id is null then c.nao_lidas else r.nao_lidas end as nao_lidas,
  c.criado_em,c.unidade,cl.nome as cliente_nome,cl.telefone as cliente_telefone
from public.conversas c join public.clientes cl on cl.id=c.cliente_id
left join public.atendimento_rotas_setores r on r.conversa_id=c.id
where not exists(select 1 from public.atendimentos_modulares_ativos a where a.conversa_id=c.id);

create or replace view public.mensagens_legadas
with (security_invoker=true,security_barrier=true) as
select m.id,m.conversa_id,m.cliente_id,m.direcao,m.autor,m.tipo,m.conteudo,m.status,m.erro,m.criado_em
from public.mensagens m left join public.atendimento_rotas_setores r on r.conversa_id=m.conversa_id
where m.atendimento_id is null and (r.conversa_id is null or m.transferencia_central_id=r.operacao_id)
  and not exists(select 1 from public.atendimento_mensagens v where v.mensagem_id=m.id)
  and not exists(select 1 from public.atendimentos_modulares_ativos a where a.conversa_id=m.conversa_id)
union all
select s.mensagem_id,s.conversa_id,s.cliente_id,s.direcao,s.autor,s.tipo,s.conteudo,s.status,null::text,s.criado_em
from public.transferencias_mensagens s join public.atendimento_rotas_setores r on r.operacao_id=s.operacao_id
  and r.conversa_id=s.conversa_id and r.cliente_id=s.cliente_id and r.unidade=s.unidade and r.setor='central'
join public.transferencias_setores t on t.operacao_id=r.operacao_id and t.destino='oficina' and t.registro_destino=s.registro_destino
join public.clientes c on c.id=s.cliente_id and not c.anonimizado
join public.unidades u on u.chave=s.unidade and u.ativa
where s.destino='oficina' and not exists(select 1 from public.atendimentos_modulares_ativos a where a.conversa_id=s.conversa_id);

-- O contador central representa somente entradas da fase nova, não os não lidos do setor anterior.
create or replace function public.transferencia_central_leitura()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.nao_lidas=0 and old.nao_lidas<>0 then
    update public.atendimento_rotas_setores set nao_lidas=0 where conversa_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists transferencia_central_leitura on public.conversas;
create trigger transferencia_central_leitura after update of nao_lidas on public.conversas
  for each row execute function public.transferencia_central_leitura();

create or replace function public.preservar_transferencia_central()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.transferencia_central_id is distinct from old.transferencia_central_id then
    raise exception 'O contexto da mensagem não pode ser alterado.' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists mensagem_transferencia_central_imutavel on public.mensagens;
create trigger mensagem_transferencia_central_imutavel before update of transferencia_central_id on public.mensagens
  for each row execute function public.preservar_transferencia_central();

create or replace function public.transferir_atendimento_setor(
  p_operacao uuid,p_origem text,p_registro uuid,p_ator uuid,p_destino text,p_funil text,
  p_responsavel uuid,p_nota text,p_versao integer,p_ator_email text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare pessoa record; anterior public.transferencias_setores%rowtype; rota public.atendimento_rotas_setores%rowtype;
  cliente uuid; loja text; dono uuid; veiculo uuid; canal public.conversas%rowtype;
  origem_mod public.atendimentos_modulares%rowtype; destino_mod public.atendimentos_modulares%rowtype;
  reservado uuid; alvo_id uuid; alvo_dono uuid; funil_destino uuid; etapa_destino uuid; reutilizado boolean;
  supervisor boolean; destinatario record; destinatarios uuid[]; escolha record;
  aviso_nome text; link_destino text; origem_nome text; snapshot_ids jsonb; snapshot_inicio timestamptz; snapshot_fim timestamptz;
begin
  if p_operacao is null or p_ator is null or p_registro is null or p_origem is null
    or p_ator_email is null or p_ator_email='' or char_length(p_ator_email)>320 or p_ator_email<>btrim(p_ator_email)
    or position(chr(10) in p_ator_email)>0 or position(chr(13) in p_ator_email)>0
    or p_origem not in ('central','vendas','pecas','oficina') or p_destino is null
    or p_destino not in ('vendas','pecas','oficina') or p_destino=p_origem
    or p_versao is null or p_versao not between 0 and 2147483646
    or p_nota is null or char_length(p_nota) not between 1 and 1000 or p_nota~'^[[:space:]]|[[:space:]]$'
    or not public.texto_compartilhavel_transferencia(p_nota)
    or (p_destino='vendas' and (p_funil is null or p_funil not in ('novos','seminovos')))
    or (p_destino<>'vendas' and p_funil is not null) then
    return pg_catalog.jsonb_build_object('ok',false,'codigo','invalido');
  end if;
  begin
    select user_id,nome,papel,setor,unidade into pessoa from public.usuarios where user_id=p_ator and ativo for share nowait;
    if not found then raise sqlstate 'P1004'; end if;
    supervisor:=pessoa.papel='admin' or (pessoa.papel='gerente' and pessoa.setor in (
      case when p_origem='central' then 'oficina' else p_origem end,'administracao'));
    origem_nome:=case p_origem when 'central' then 'Recepção' when 'vendas' then 'Vendas' when 'pecas' then 'Peças' else 'Oficina' end;
    if p_origem='central' then
      if not supervisor and pessoa.papel not in ('recepcao','atendente') then raise sqlstate 'P1004'; end if;
      select c.cliente_id,c.unidade into cliente,loja from public.conversas c where c.id=p_registro;
      if not found then raise sqlstate 'P1004'; end if;
    elsif p_origem='vendas' then
      if not supervisor and pessoa.papel<>'vendedor' then raise sqlstate 'P1004'; end if;
      select o.cliente_id,o.unidade,o.vendedor_id into cliente,loja,dono from public.vendas_oportunidades o
        join public.vendas_funis f on f.id=o.funil_id and f.ativo
        join public.vendas_etapas e on e.id=o.etapa_id and e.funil_id=o.funil_id and e.ativo and e.tipo='aberta'
        where o.id=p_registro and o.fechado_em is null for update of o nowait;
      if not found then raise sqlstate 'P1004'; end if;
    elsif p_origem='pecas' then
      if not supervisor and pessoa.papel<>'pecas' then raise sqlstate 'P1004'; end if;
      select c.cliente_id,c.unidade,c.responsavel_id,c.veiculo_id into cliente,loja,dono,veiculo from public.pecas_cotacoes c
        where c.id=p_registro and c.status not in ('entregue','perdido','cancelado') for update nowait;
      if not found then raise sqlstate 'P1004'; end if;
    else
      if not supervisor and pessoa.papel not in ('consultor_tecnico','recepcao','atendente') then raise sqlstate 'P1004'; end if;
      select o.cliente_id,o.unidade,o.responsavel_id,o.veiculo_id into cliente,loja,dono,veiculo from public.oficina_atendimentos o
        where o.id=p_registro and o.status in ('novo','em_triagem') for update nowait;
      if not found then raise sqlstate 'P1004'; end if;
    end if;
    if p_origem<>'central' and not supervisor and dono is distinct from p_ator then raise sqlstate 'P1004'; end if;
    perform 1 from public.unidades u where u.chave=loja and u.ativa for share nowait;
    if not found then raise sqlstate 'P1004'; end if;
    if pessoa.papel<>'admin' and pessoa.unidade<>loja then
      perform 1 from public.usuario_unidades u where u.user_id=p_ator and u.unidade=loja for share nowait;
      if not found then raise sqlstate 'P1004'; end if;
    end if;
    -- Compatível com produtores do bot: cliente antes do canal. Revalidar sob lock.
    perform 1 from public.clientes c where c.id=cliente and not c.anonimizado for update nowait;
    if not found then raise sqlstate 'P1004'; end if;
    if veiculo is not null then
      perform 1 from public.veiculos v where v.id=veiculo and v.cliente_id=cliente for share nowait;
      if not found then raise sqlstate 'P1004'; end if;
    end if;
    insert into public.conversas(cliente_id) values(cliente) on conflict(cliente_id) do nothing;
    select * into canal from public.conversas where cliente_id=cliente for update nowait;
    select * into rota from public.atendimento_rotas_setores where conversa_id=canal.id for update nowait;
    if p_origem='central' and canal.id<>p_registro then raise sqlstate 'P1004'; end if;

    -- Replays não concedem acesso: o ator e o domínio de origem acabaram de ser revalidados.
    select * into anterior from public.transferencias_setores where operacao_id=p_operacao;
    if found then
      if anterior.origem<>p_origem or anterior.registro_origem<>p_registro or anterior.ator_id<>p_ator
        or anterior.destino<>p_destino or anterior.funil is distinct from p_funil
        or anterior.responsavel_solicitado is distinct from p_responsavel or anterior.nota<>p_nota
        or anterior.versao_origem<>p_versao or anterior.cliente_id<>cliente or anterior.unidade<>loja then raise sqlstate 'P1009'; end if;
      return pg_catalog.jsonb_build_object('ok',true,'operacaoId',p_operacao,'setorDestino',anterior.destino,
        'idDestino',anterior.registro_destino,'reutilizado',anterior.reutilizado,
        'avisoResponsavel',case when anterior.aviso_responsavel_nome is null then null
          else pg_catalog.jsonb_build_object('nome',anterior.aviso_responsavel_nome) end);
    end if;
    if p_origem='central' then
      if not public.central_transferencia_legivel(canal.id,p_ator,loja,p_ator_email) then raise sqlstate 'P1009'; end if;
    else
      select * into origem_mod from public.atendimentos_modulares a
        where (p_origem='vendas' and a.oportunidade_id=p_registro) or (p_origem='pecas' and a.cotacao_id=p_registro) for update nowait;
      if p_origem in ('vendas','pecas') and ((origem_mod.id is null and p_versao<>0)
        or (origem_mod.id is not null and (origem_mod.versao<>p_versao or origem_mod.versao>=2147483646))) then raise sqlstate 'P1009'; end if;
      if origem_mod.id is not null and (origem_mod.cliente_id<>cliente or origem_mod.unidade<>loja or origem_mod.conversa_id<>canal.id) then raise sqlstate 'P1004'; end if;
      if origem_mod.assumido_por is not null and origem_mod.assumido_por<>p_ator and not supervisor then raise sqlstate 'P1009'; end if;
      if canal.assumida_por is not null then raise sqlstate 'P1009'; end if;
      if rota.conversa_id is not null and not coalesce((p_origem in ('vendas','pecas') and origem_mod.id is not null and rota.atendimento_id=origem_mod.id)
        or (p_origem='oficina' and rota.setor='central' and exists(select 1 from public.transferencias_setores t
          where t.operacao_id=rota.operacao_id and t.destino='oficina' and t.registro_destino=p_registro)),false) then raise sqlstate 'P1009'; end if;
    end if;
    select atendimento_id into reservado from public.atendimento_canais where conversa_id=canal.id;
    if reservado is not null and reservado is distinct from origem_mod.id then raise sqlstate 'P1009'; end if;
    if p_origem='oficina' and rota.conversa_id is null and exists(
      select 1 from public.atendimentos_modulares_ativos a where a.conversa_id=canal.id) then raise sqlstate 'P1009'; end if;
    if exists(select 1 from public.mensagens m where m.conversa_id=canal.id and m.direcao='saida'
      and m.autor='atendente' and (m.metadata->>'estagio' in ('reservado','despachando') or m.erro='envio_em_processamento')
      and m.status not in ('enviada','entregue','lida','falhou')) then raise sqlstate 'P1011'; end if;
    -- T-003: a mesma mensagem com ledgers de Peças/triagem E Vendas é origem ambígua por contrato.
    if exists(select 1 from public.mensagens m join public.encaminhamentos_bot p on p.referencia=m.wamid
      join public.vendas_encaminhamentos_bot v on v.referencia=m.wamid
      where m.conversa_id=canal.id and m.entrada_cliente_externa and (
        m.atendimento_id=origem_mod.id
        or (origem_mod.origem_inicial_fixada and m.wamid=origem_mod.referencia_inicial)
        or exists(select 1 from public.atendimento_mensagens a where a.atendimento_id=origem_mod.id
          and a.mensagem_id=m.id and a.conversa_id=canal.id and a.cliente_id=cliente and a.unidade=loja)
        or (p_origem='central' and exists(select 1 from public.mensagens_legadas leg where leg.id=m.id
          and leg.conversa_id=canal.id and leg.cliente_id=cliente)))) then raise sqlstate 'P1010'; end if;

    if p_responsavel is not null then
      select u.user_id,u.nome,u.unidade into escolha from public.usuarios u where u.user_id=p_responsavel and u.ativo
        and ((p_destino='vendas' and (u.papel='vendedor' or (u.papel='gerente' and u.setor='vendas')))
          or (p_destino='pecas' and (u.papel='pecas' or (u.papel='gerente' and u.setor='pecas')))
          or (p_destino='oficina' and (u.papel in ('recepcao','atendente','consultor_tecnico') or (u.papel='gerente' and u.setor='oficina'))))
        and (u.unidade=loja or exists(select 1 from public.usuario_unidades x where x.user_id=u.user_id and x.unidade=loja)) for share nowait;
      if not found then raise sqlstate 'P1004'; end if;
      if escolha.unidade<>loja then
        perform 1 from public.usuario_unidades x where x.user_id=p_responsavel and x.unidade=loja for share nowait;
        if not found then raise sqlstate 'P1004'; end if;
      end if;
    end if;
    if p_destino='vendas' then
      select f.id into funil_destino from public.vendas_funis f where f.unidade=loja and f.chave=p_funil and f.ativo for share nowait;
      if not found then raise sqlstate 'P1004'; end if;
      select o.id,o.vendedor_id into alvo_id,alvo_dono from public.vendas_oportunidades o
        join public.vendas_etapas e on e.id=o.etapa_id and e.funil_id=o.funil_id and e.ativo and e.tipo='aberta'
        where o.cliente_id=cliente and o.unidade=loja and o.funil_id=funil_destino and o.fechado_em is null
        order by o.criado_em,o.id limit 1 for update of o nowait;
      reutilizado:=found;
      if not reutilizado then
        select e.id into etapa_destino from public.vendas_etapas e where e.funil_id=funil_destino and e.ativo and e.tipo='aberta'
          order by e.ordem,e.id limit 1 for share nowait;
        if not found then raise sqlstate 'P1004'; end if;
        insert into public.vendas_oportunidades(unidade,funil_id,etapa_id,cliente_id,vendedor_id,origem,criado_por)
          values(loja,funil_destino,etapa_destino,cliente,p_responsavel,'painel',p_ator::text) returning id,vendedor_id into alvo_id,alvo_dono;
      end if;
    elsif p_destino='pecas' then
      select c.id,c.responsavel_id into alvo_id,alvo_dono from public.pecas_cotacoes c
        where c.cliente_id=cliente and c.unidade=loja and c.status not in ('entregue','perdido','cancelado')
        order by c.criado_em,c.id limit 1 for update nowait;
      reutilizado:=found;
      if not reutilizado then
        insert into public.pecas_cotacoes(unidade,cliente_id,veiculo_id,origem,descricao,criado_por)
          values(loja,cliente,veiculo,case when p_origem='oficina' then 'oficina' else 'balcao' end,
            'Pedido encaminhado de '||origem_nome||'. Consulte a nota da transferência.',p_ator)
          returning id,responsavel_id into alvo_id,alvo_dono;
      end if;
    else
      select o.id,o.responsavel_id into alvo_id,alvo_dono from public.oficina_atendimentos o
        where o.cliente_id=cliente and o.unidade=loja and o.status in ('novo','em_triagem')
        order by o.criado_em,o.id limit 1 for update nowait;
      reutilizado:=found;
      if not reutilizado then
        insert into public.oficina_atendimentos(unidade,cliente_id,veiculo_id,descricao,criado_por)
          values(loja,cliente,veiculo,'Pedido encaminhado de '||origem_nome||'. Consulte a nota da transferência.',p_ator)
          returning id,responsavel_id into alvo_id,alvo_dono;
        insert into public.oficina_atendimentos_historico(atendimento_id,unidade,de_status,para_status,ator_id)
          values(alvo_id,loja,null,'novo',p_ator);
      end if;
    end if;
    -- Reuso nunca toma o dono existente. A escolha divergente é somente um aviso genérico.
    if reutilizado and alvo_dono is not null and alvo_dono is distinct from p_responsavel then
      select left(coalesce(nullif(btrim(regexp_replace(translate(u.nome,
        U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',
        repeat(' ',19)),'[[:space:]]+',' ','g')),''),'Responsável atual'),200)
        into aviso_nome from public.usuarios u where u.user_id=alvo_dono for share nowait;
      aviso_nome:=coalesce(aviso_nome,'Responsável atual');
    end if;
    if alvo_dono is null and p_responsavel is not null then
      if p_destino='vendas' then update public.vendas_oportunidades set vendedor_id=p_responsavel where id=alvo_id;
      elsif p_destino='pecas' then update public.pecas_cotacoes set responsavel_id=p_responsavel where id=alvo_id;
      else update public.oficina_atendimentos set responsavel_id=p_responsavel where id=alvo_id; end if;
      alvo_dono:=p_responsavel;
    end if;
    insert into public.transferencias_setores(operacao_id,origem,registro_origem,ator_id,destino,funil,responsavel_solicitado,
      nota,versao_origem,cliente_id,conversa_id,unidade,registro_destino,reutilizado,aviso_responsavel_nome)
      values(p_operacao,p_origem,p_registro,p_ator,p_destino,p_funil,p_responsavel,p_nota,p_versao,cliente,canal.id,loja,alvo_id,reutilizado,aviso_nome);
    -- Captura corpo+política no mesmo statement, ANTES de mudar a rota. Sem IDs como ACL reutilizável.
    insert into public.transferencias_mensagens(operacao_id,mensagem_id,conversa_id,cliente_id,unidade,destino,registro_destino,
      direcao,autor,tipo,conteudo,status,criado_em)
      select p_operacao,m.id,canal.id,cliente,loja,p_destino,alvo_id,m.direcao,m.autor,m.tipo,m.conteudo,m.status,m.criado_em
      from public.mensagens_origem_transferencia(p_origem,p_registro,p_ator,cliente,canal.id,loja,p_ator_email) m;

    if p_destino in ('vendas','pecas') then
      select * into destino_mod from public.atendimentos_modulares a where
        (p_destino='vendas' and a.oportunidade_id=alvo_id) or (p_destino='pecas' and a.cotacao_id=alvo_id) for update nowait;
      if found then
        if destino_mod.cliente_id<>cliente or destino_mod.unidade<>loja or destino_mod.conversa_id<>canal.id then raise sqlstate 'P1004'; end if;
        if destino_mod.assumido_por is not null or destino_mod.versao>=2147483646 then raise sqlstate 'P1009'; end if;
        update public.atendimentos_modulares set versao=versao+1 where id=destino_mod.id returning * into destino_mod;
      else
        insert into public.atendimentos_modulares(setor,oportunidade_id,cotacao_id,conversa_id,cliente_id,unidade,criado_por,origem_inicial_fixada)
          values(p_destino,case when p_destino='vendas' then alvo_id end,case when p_destino='pecas' then alvo_id end,
            canal.id,cliente,loja,p_ator,true) returning * into destino_mod;
      end if;
    end if;
    delete from public.atendimento_canais where conversa_id=canal.id and atendimento_id=origem_mod.id;
    if origem_mod.id is not null then
      update public.atendimentos_modulares set assumido_por=null,dono_na_posse=null,versao=versao+1 where id=origem_mod.id;
    end if;
    insert into public.atendimento_rotas_setores(conversa_id,operacao_id,cliente_id,unidade,setor,atendimento_id,nao_lidas)
      values(canal.id,p_operacao,cliente,loja,case when p_destino='oficina' then 'central' else p_destino end,destino_mod.id,0)
      on conflict(conversa_id) do update set operacao_id=excluded.operacao_id,cliente_id=excluded.cliente_id,
        unidade=excluded.unidade,setor=excluded.setor,atendimento_id=excluded.atendimento_id,nao_lidas=0;
    update public.conversas set status='humano',unidade=loja,assumida_por=null,assumida_em=null,
      aguardando_desde=now(),alerta_reenviado_em=null where id=canal.id;
    if p_destino='vendas' then
      insert into public.vendas_atividades(oportunidade_id,tipo,descricao,ator)
        values(alvo_id,'nota','Pedido encaminhado de '||origem_nome||'. Consulte a nota da transferência.',p_ator::text);
      link_destino:='/painel/vendas?op='||alvo_id::text;
    elsif p_destino='pecas' then link_destino:='/painel/pecas?cotacao='||alvo_id::text;
    else link_destino:='/painel/oficina'; end if;
    destinatarios:=array[]::uuid[];
    for destinatario in select u.user_id,u.papel,u.unidade from public.usuarios u where u.ativo
      and (p_responsavel is null or alvo_dono is not distinct from p_responsavel or u.user_id<>p_responsavel)
      and (u.papel='admin' or u.unidade=loja or exists(select 1 from public.usuario_unidades x where x.user_id=u.user_id and x.unidade=loja))
      and (u.papel='admin' or (u.papel='gerente' and u.setor in (p_destino,'administracao'))
        or (u.user_id=alvo_dono and ((p_destino='vendas' and u.papel='vendedor') or (p_destino='pecas' and u.papel='pecas')
          or (p_destino='oficina' and u.papel in ('consultor_tecnico','recepcao','atendente'))))
        or (alvo_dono is null and ((p_destino='vendas' and u.papel='vendedor') or (p_destino='pecas' and u.papel='pecas')
          or (p_destino='oficina' and u.papel in ('consultor_tecnico','recepcao','atendente')))))
      order by u.user_id for share nowait loop
      if destinatario.papel<>'admin' and destinatario.unidade<>loja then
        perform 1 from public.usuario_unidades x where x.user_id=destinatario.user_id and x.unidade=loja for share nowait;
        if not found then continue; end if;
      end if;
      insert into public.notificacoes(usuario_id,unidade,tipo,titulo,corpo,link)
        values(destinatario.user_id,loja,'atendimento','Pedido encaminhado de '||origem_nome,
          'Consulte a nota do encaminhamento no pedido do seu setor.',link_destino);
      destinatarios:=array_append(destinatarios,destinatario.user_id);
    end loop;
    if cardinality(destinatarios)=0 then raise sqlstate 'P1009'; end if;
    if p_responsavel is not null and alvo_dono is distinct from p_responsavel and not (p_responsavel=any(destinatarios)) then
      insert into public.notificacoes(usuario_id,unidade,tipo,titulo,corpo,link)
        values(p_responsavel,loja,'atendimento','Encaminhamento registrado no setor',
          'O pedido foi mantido com seu responsável atual. A gestão do setor pode orientar uma reatribuição.',null);
    end if;
    select coalesce(pg_catalog.jsonb_agg(s.mensagem_id order by s.criado_em,s.mensagem_id),'[]'::jsonb),min(s.criado_em),max(s.criado_em)
      into snapshot_ids,snapshot_inicio,snapshot_fim from public.transferencias_mensagens s where s.operacao_id=p_operacao;
    insert into public.audit_log(ator,acao,entidade,entidade_id,dados)
      values(p_ator::text,'transferir_setor','transferencia',p_operacao::text,
        pg_catalog.jsonb_build_object('origem',p_origem,'registro_origem',p_registro,'destino',p_destino,
          'registro_destino',alvo_id,'unidade',loja,'reutilizado',reutilizado,'snapshot_ids',snapshot_ids,
          'snapshot_inicio',snapshot_inicio,'snapshot_fim',snapshot_fim));
    return pg_catalog.jsonb_build_object('ok',true,'operacaoId',p_operacao,'setorDestino',p_destino,'idDestino',alvo_id,
      'reutilizado',reutilizado,'avisoResponsavel',case when aviso_nome is null then null else pg_catalog.jsonb_build_object('nome',aviso_nome) end);
  exception when sqlstate 'P1004' then return pg_catalog.jsonb_build_object('ok',false,'codigo','nao_encontrado');
    when sqlstate 'P1009' then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
    when sqlstate 'P1010' then return pg_catalog.jsonb_build_object('ok',false,'codigo','origem_ambigua');
    when sqlstate 'P1011' then return pg_catalog.jsonb_build_object('ok',false,'codigo','envio_incerto');
    when sqlstate '55P03' or sqlstate '40P01' then return pg_catalog.jsonb_build_object('ok',false,'codigo','conflito');
  end;
end $$;

-- O recebimento serializa com a transferência no canal antes de ler a rota.
-- Rota explícita permite entradas no destino ainda na fila, sem conceder posse/envio.
create or replace function public.pecas_vincular_entrada_ativa()
returns trigger language plpgsql security invoker set search_path='' as $$
declare alvo public.atendimentos_modulares%rowtype; ctx record; rota public.atendimento_rotas_setores%rowtype;
begin
  new.transferencia_central_id:=null;
  if coalesce(new.metadata->'interno','false'::jsonb)<>'false'::jsonb then return new; end if;
  perform 1 from public.conversas c where c.id=new.conversa_id and c.cliente_id=new.cliente_id for update;
  if not found then return new; end if;
  select * into rota from public.atendimento_rotas_setores where conversa_id=new.conversa_id;
  if found then
    if new.direcao='entrada' and new.autor='cliente' then new.atendimento_id:=null; end if;
    if rota.cliente_id<>new.cliente_id or not exists(select 1 from public.unidades u where u.chave=rota.unidade and u.ativa)
      or not exists(select 1 from public.clientes c where c.id=new.cliente_id and not c.anonimizado) then return new; end if;
    select * into alvo from public.atendimentos_modulares where id=rota.atendimento_id
      and conversa_id=new.conversa_id and cliente_id=new.cliente_id and unidade=rota.unidade and setor=rota.setor;
    if found and public.rota_destino_aberto(alvo.setor,coalesce(alvo.oportunidade_id,alvo.cotacao_id),new.cliente_id,rota.unidade) then
      if new.direcao='entrada' and new.autor='cliente' then new.atendimento_id:=alvo.id; end if;
    elsif not exists(select 1 from public.atendimento_canais s where s.conversa_id=new.conversa_id) then
      if new.atendimento_id is not null then raise exception 'O roteamento da conversa mudou.' using errcode='55000'; end if;
      new.transferencia_central_id:=rota.operacao_id;
      if new.direcao='entrada' and new.autor='cliente' then
        update public.atendimento_rotas_setores set nao_lidas=least(2147483646,nao_lidas+1) where conversa_id=new.conversa_id;
      end if;
    end if;
    return new;
  end if;
  if new.direcao='entrada' and new.autor='cliente' then
    new.atendimento_id:=null;
    select a.* into alvo from public.atendimento_canais s join public.atendimentos_modulares a on a.id=s.atendimento_id
      where s.conversa_id=new.conversa_id and a.cliente_id=new.cliente_id and a.setor in ('pecas','vendas');
    if not found or alvo.assumido_por is null then return new; end if;
    select * into ctx from public.contexto_atendimento_modular(alvo.setor,coalesce(alvo.oportunidade_id,alvo.cotacao_id),alvo.assumido_por);
    if not found or ctx.responsavel_id is distinct from alvo.dono_na_posse then return new; end if;
    perform 1 from public.conversas c where c.id=new.conversa_id and c.cliente_id=new.cliente_id
      and c.status='humano' and c.assumida_por is null;
    if not found then return new; end if;
    perform 1 from public.atendimentos_modulares a join public.atendimento_canais s on s.atendimento_id=a.id
      where a.id=alvo.id and s.conversa_id=new.conversa_id and a.assumido_por=alvo.assumido_por
        and a.dono_na_posse=ctx.responsavel_id and a.versao=alvo.versao;
    if found then new.atendimento_id:=alvo.id; end if;
  end if;
  return new;
end $$;

revoke all on function public.rota_permite_atendimento(uuid),public.rota_destino_aberto(text,uuid,uuid,text),
  public.destino_transferencia_legivel(text,uuid,uuid,uuid,uuid,text),public.texto_compartilhavel_transferencia(text),
  public.mensagens_snapshot_destino(text,uuid,uuid),public.ler_snapshot_transferencia(uuid,uuid),
  public.central_transferencia_legivel(uuid,uuid,text,text),public.mensagens_origem_transferencia(text,uuid,uuid,uuid,uuid,text,text),
  public.proteger_rota_do_canal(),public.transferencia_central_leitura(),public.preservar_transferencia_central(),
  public.transferir_atendimento_setor(uuid,text,uuid,uuid,text,text,uuid,text,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.rota_permite_atendimento(uuid),public.rota_destino_aberto(text,uuid,uuid,text),
  public.destino_transferencia_legivel(text,uuid,uuid,uuid,uuid,text),public.texto_compartilhavel_transferencia(text),
  public.mensagens_snapshot_destino(text,uuid,uuid),public.ler_snapshot_transferencia(uuid,uuid),
  public.central_transferencia_legivel(uuid,uuid,text,text),public.mensagens_origem_transferencia(text,uuid,uuid,uuid,uuid,text,text),
  public.proteger_rota_do_canal(),public.transferencia_central_leitura(),public.preservar_transferencia_central(),
  public.transferir_atendimento_setor(uuid,text,uuid,uuid,text,text,uuid,text,integer,text) to service_role;

-- A anonimização existente marca clientes.anonimizado; as cópias não podem escapar
-- dessa operação. Não há backfill nem anonimização executada pela migration.
grant update(conteudo) on public.transferencias_mensagens to service_role;
grant update(nota) on public.transferencias_setores to service_role;

create or replace function public.proteger_redacao_snapshot_transferencia()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new is not distinct from old then return new; end if;
  if (pg_catalog.to_jsonb(new)-'conteudo') is distinct from (pg_catalog.to_jsonb(old)-'conteudo')
    or new.conteudo is distinct from '[removido — LGPD]'
    or not exists(select 1 from public.clientes c where c.id=old.cliente_id and c.anonimizado) then
    raise exception 'Snapshot imutável; somente a redação LGPD é permitida.' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists snapshot_transferencia_redacao on public.transferencias_mensagens;
create trigger snapshot_transferencia_redacao before update on public.transferencias_mensagens
  for each row execute function public.proteger_redacao_snapshot_transferencia();

create or replace function public.proteger_redacao_nota_transferencia()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new is not distinct from old then return new; end if;
  if (pg_catalog.to_jsonb(new)-'nota') is distinct from (pg_catalog.to_jsonb(old)-'nota')
    or new.nota is distinct from '[removido — LGPD]'
    or not exists(select 1 from public.clientes c where c.id=old.cliente_id and c.anonimizado) then
    raise exception 'Evento imutável; somente a redação LGPD é permitida.' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists nota_transferencia_redacao on public.transferencias_setores;
create trigger nota_transferencia_redacao before update on public.transferencias_setores
  for each row execute function public.proteger_redacao_nota_transferencia();

create or replace function public.redigir_transferencias_cliente_anonimizado()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.anonimizado and not old.anonimizado then
    update public.transferencias_mensagens set conteudo='[removido — LGPD]'
      where cliente_id=new.id and conteudo is distinct from '[removido — LGPD]';
    update public.transferencias_setores set nota='[removido — LGPD]'
      where cliente_id=new.id and nota is distinct from '[removido — LGPD]';
  end if;
  return new;
end $$;
drop trigger if exists cliente_anonimizar_transferencias on public.clientes;
create trigger cliente_anonimizar_transferencias after update of anonimizado on public.clientes
  for each row when (new.anonimizado and not old.anonimizado)
  execute function public.redigir_transferencias_cliente_anonimizado();

revoke all on function public.proteger_redacao_snapshot_transferencia(),public.proteger_redacao_nota_transferencia(),
  public.redigir_transferencias_cliente_anonimizado() from public,anon,authenticated,service_role;
grant execute on function public.proteger_redacao_snapshot_transferencia(),public.proteger_redacao_nota_transferencia(),
  public.redigir_transferencias_cliente_anonimizado() to service_role;
