-- A1.1c: qualificação e proveniência de Vendas na mesma transação.
-- Depende de 0001/0002/0003 e da coluna gerada de 20261111142602.
-- O código de marketing continua em origem_ref; a mensagem real fica neste ledger.
create unique index if not exists vendas_op_prova_bot_idx
  on public.vendas_oportunidades(id, cliente_id, unidade, funil_id);
create table if not exists public.vendas_encaminhamentos_bot (
  referencia text primary key check (char_length(referencia) between 1 and 512
    and referencia !~ '^[[:space:]]|[[:space:]]$'),
  mensagem_id uuid not null unique,
  conversa_id uuid not null,
  cliente_id uuid not null,
  unidade text not null,
  oportunidade_id uuid not null,
  funil_id uuid not null,
  novo boolean not null,
  entrada_cliente_externa boolean not null default true check (entrada_cliente_externa),
  criado_em timestamptz not null default now(),
  foreign key(mensagem_id, conversa_id, cliente_id, referencia, entrada_cliente_externa)
    references public.mensagens(id, conversa_id, cliente_id, wamid, entrada_cliente_externa) on delete restrict,
  foreign key(oportunidade_id, cliente_id, unidade, funil_id)
    references public.vendas_oportunidades(id, cliente_id, unidade, funil_id) on delete restrict
);
create index if not exists vendas_encaminhamentos_op_idx
  on public.vendas_encaminhamentos_bot(oportunidade_id, criado_em, referencia);
alter table public.vendas_encaminhamentos_bot enable row level security;
revoke all on public.vendas_encaminhamentos_bot from public, anon, authenticated, service_role;
grant select, insert on public.vendas_encaminhamentos_bot to service_role;
grant select (id, nome, vendedor_id, anonimizado, link_origem_id) on public.clientes to service_role;
grant update (vendedor_id) on public.clientes to service_role;
grant select (id, codigo, canal) on public.links_rastreados to service_role;
grant select (id, cliente_id, unidade) on public.conversas to service_role;
grant select (id, conversa_id, cliente_id, wamid, entrada_cliente_externa) on public.mensagens to service_role;
grant select (chave, ativa) on public.unidades to service_role;
grant select (user_id, papel, setor, unidade, ativo) on public.usuarios to service_role;
grant select (user_id, unidade) on public.usuario_unidades to service_role;
grant update (nome) on public.clientes, public.unidades, public.usuarios to service_role;
grant update (unidade) on public.usuario_unidades to service_role;
grant update (status) on public.conversas, public.mensagens to service_role;
grant insert (usuario_id, unidade, tipo, titulo, corpo, link) on public.notificacoes to service_role;
grant insert (ator, acao, entidade, entidade_id, dados) on public.audit_log to service_role;
-- 0003 concede as tabelas Vendas; seu trigger de criação também usa a identidade.
grant usage on sequence public.vendas_historico_id_seq to service_role;

create or replace function public.registrar_lead_vendas_bot(
  p_conversa_id uuid, p_cliente_id uuid, p_referencia text, p_funil text,
  p_modelo text, p_pagamento text, p_prazo text, p_tem_troca boolean,
  p_troca_descricao text, p_resumo text, p_cliente_confirmou boolean
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  loja text;
  funil uuid;
  primeira uuid;
  cliente record;
  pessoa record;
  op public.vendas_oportunidades%rowtype;
  anterior public.vendas_encaminhamentos_bot%rowtype;
  mensagem uuid;
  vendedores uuid[] := array[]::uuid[];
  supervisores uuid[] := array[]::uuid[];
  admins uuid[] := array[]::uuid[];
  destinatarios uuid[];
  dono uuid;
  nova boolean;
  origem text := 'whatsapp';
  codigo text;
  canal text;
  temperatura text;
begin
  if p_conversa_id is null or p_cliente_id is null or p_referencia is null
    or char_length(p_referencia) not between 1 and 512 or p_referencia ~ '^[[:space:]]|[[:space:]]$'
    or p_funil is null or p_funil not in ('novos', 'seminovos')
    or p_pagamento is null or p_pagamento not in ('a_vista', 'financiamento', 'consorcio', 'indefinido')
    or p_prazo is null or p_prazo not in ('imediato', 'ate_30_dias', 'ate_90_dias', 'sem_prazo', 'indefinido')
    or p_cliente_confirmou is null or p_resumo is null or char_length(p_resumo) not between 1 and 300
    or p_resumo ~ '^[[:space:]]|[[:space:]]$'
    or (p_modelo is not null and (char_length(p_modelo) not between 1 and 120 or p_modelo ~ '^[[:space:]]|[[:space:]]$'))
    or (p_troca_descricao is not null and (char_length(p_troca_descricao) not between 1 and 300 or p_troca_descricao ~ '^[[:space:]]|[[:space:]]$')) then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vendas_bot_ref:' || p_referencia, 0));
  -- Primeira leitura só resolve IDs. Travas definitivas seguem domínio -> cliente -> canal,
  -- compatíveis com abertura/claim A1; não adquirir SHARE no canal antes de FOR UPDATE.
  select c.unidade into loja from public.conversas c where c.id = p_conversa_id and c.cliente_id = p_cliente_id;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'contexto_indisponivel'); end if;
  select f.id into funil from public.vendas_funis f where f.unidade = loja and f.chave = p_funil and f.ativo;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'funil_indisponivel'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vendas_bot_cliente_funil:' || p_cliente_id::text || ':' || funil::text, 0));
  select o.* into op from public.vendas_oportunidades o where o.cliente_id = p_cliente_id
    and o.funil_id = funil and o.unidade = loja and o.fechado_em is null
    order by o.criado_em desc, o.id limit 1 for update;
  nova := not found;
  select c.id, c.nome, c.vendedor_id, c.link_origem_id into cliente from public.clientes c
    where c.id = p_cliente_id and not c.anonimizado for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'cliente_indisponivel'); end if;
  perform 1 from public.unidades u where u.chave = loja and u.ativa for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'unidade_indisponivel'); end if;
  perform 1 from public.vendas_funis f where f.id = funil and f.unidade = loja and f.chave = p_funil and f.ativo for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'funil_indisponivel'); end if;
  perform 1 from public.conversas c where c.id = p_conversa_id and c.cliente_id = p_cliente_id and c.unidade = loja for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'contexto_alterado'); end if;
  select m.id into mensagem from public.mensagens m where m.wamid = p_referencia
    and m.conversa_id = p_conversa_id and m.cliente_id = p_cliente_id and m.entrada_cliente_externa for share;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'mensagem_indisponivel'); end if;
  select e.* into anterior from public.vendas_encaminhamentos_bot e where e.referencia = p_referencia;
  if found then
    if anterior.conversa_id <> p_conversa_id or anterior.cliente_id <> p_cliente_id
      or anterior.unidade <> loja or anterior.funil_id <> funil or anterior.mensagem_id <> mensagem then
      return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'referencia_conflitante');
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'oportunidade_id', anterior.oportunidade_id,
      'novo', anterior.novo, 'ja_registrado', true);
  end if;

  -- A carga é global por vendedor: chamadas do bot em unidades diferentes também
  -- compartilham esta trava, pois a mesma pessoa pode atuar em unidades adicionais.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vendas_bot_rodizio', 0));
  for pessoa in select u.user_id, u.papel, u.setor, u.unidade from public.usuarios u
    where u.ativo and (u.papel in ('vendedor', 'admin')
      or (u.papel = 'gerente' and u.setor in ('vendas', 'administracao')))
      and (u.papel = 'admin' or u.unidade = loja or exists (
        select 1 from public.usuario_unidades uu where uu.user_id = u.user_id and uu.unidade = loja))
    order by u.user_id for share
  loop
    if pessoa.papel <> 'admin' and pessoa.unidade <> loja then
      perform 1 from public.usuario_unidades uu where uu.user_id = pessoa.user_id and uu.unidade = loja for share;
      if not found then continue; end if;
    end if;
    if pessoa.papel = 'vendedor' then vendedores := pg_catalog.array_append(vendedores, pessoa.user_id);
    elsif pessoa.papel = 'admin' then admins := pg_catalog.array_append(admins, pessoa.user_id);
    else supervisores := pg_catalog.array_append(supervisores, pessoa.user_id); end if;
  end loop;
  if nova then
    if cliente.vendedor_id = any(vendedores) then dono := cliente.vendedor_id;
    else
      select v.id into dono from pg_catalog.unnest(vendedores) v(id)
        left join public.vendas_oportunidades o on o.vendedor_id = v.id and o.fechado_em is null
        group by v.id order by count(o.id), max(o.criado_em) nulls first, v.id limit 1;
    end if;
  else dono := op.vendedor_id; end if;
  if dono = any(vendedores || supervisores || admins) then destinatarios := array[dono];
  elsif pg_catalog.cardinality(supervisores) > 0 then destinatarios := supervisores;
  else destinatarios := admins; end if;
  if pg_catalog.cardinality(destinatarios) = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'equipe_indisponivel');
  end if;

  if nova then
    select e.id into primeira from public.vendas_etapas e where e.funil_id = funil
      and e.tipo = 'aberta' and e.ativo order by e.ordem, e.id limit 1 for share;
    if not found then return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'funil_sem_etapas'); end if;
    if cliente.link_origem_id is not null then
      select l.codigo, l.canal into codigo, canal from public.links_rastreados l where l.id = cliente.link_origem_id;
      if found then origem := case when canal = 'evento' then 'evento' else 'qr' end; end if;
    end if;
    temperatura := case when p_prazo = 'imediato' or (p_prazo = 'ate_30_dias' and p_pagamento <> 'indefinido') then 'quente'
      when p_prazo = 'sem_prazo' then 'frio' else 'morno' end;
    insert into public.vendas_oportunidades(unidade, funil_id, etapa_id, cliente_id, vendedor_id,
      veiculo_interesse, pagamento, prazo_compra, tem_troca, troca_descricao, qualificacao,
      temperatura, origem, origem_ref, observacoes, posicao, criado_por)
      values(loja, funil, primeira, p_cliente_id, dono, p_modelo, p_pagamento, p_prazo,
        coalesce(p_tem_troca, false), case when p_tem_troca then p_troca_descricao end,
        case when p_cliente_confirmou then 'confirmado_cliente' else 'a_verificar' end,
        temperatura, origem, codigo, p_resumo, extract(epoch from now()), 'assistente') returning * into op;
    if dono is not null and cliente.vendedor_id is null then
      update public.clientes c set vendedor_id = dono where c.id = p_cliente_id and c.vendedor_id is null;
    end if;
  else
    -- Mesmo contrato de completarQualificacao: dados indefinidos não apagam o concreto;
    -- qualificado/desqualificado são decisões do vendedor e não são rebaixadas pelo bot.
    update public.vendas_oportunidades o set atualizado_por = 'assistente',
      veiculo_interesse = coalesce(p_modelo, o.veiculo_interesse),
      pagamento = case when p_pagamento <> 'indefinido' then p_pagamento else o.pagamento end,
      prazo_compra = case when p_prazo <> 'indefinido' then p_prazo else o.prazo_compra end,
      tem_troca = coalesce(p_tem_troca, o.tem_troca),
      troca_descricao = case when p_tem_troca is false then null
        when p_tem_troca is true then coalesce(p_troca_descricao, o.troca_descricao) else o.troca_descricao end,
      qualificacao = case when p_cliente_confirmou and o.qualificacao = 'a_verificar' then 'confirmado_cliente' else o.qualificacao end
      where o.id = op.id returning * into op;
  end if;
  insert into public.vendas_atividades(oportunidade_id, tipo, descricao, ator)
    values(op.id, 'whatsapp', case when nova then 'Lead qualificado pelo assistente: ' else 'Assistente atualizou o interesse: ' end || p_resumo, 'assistente');
  insert into public.notificacoes(usuario_id, unidade, tipo, titulo, corpo, link)
    select d, loja, 'lead', pg_catalog.left(case when nova
      then 'Novo lead (' || case when p_funil = 'novos' then 'Novos' else 'Seminovos' end || '): ' || coalesce(cliente.nome, 'Cliente')
      else coalesce(cliente.nome, 'Cliente') || ' voltou a falar no WhatsApp' end, 140),
      p_resumo, '/painel/vendas?funil=' || p_funil || '&op=' || op.id::text
      from pg_catalog.unnest(destinatarios) d;
  insert into public.audit_log(ator, acao, entidade, entidade_id, dados)
    values('assistente', case when nova then 'criar_lead' else 'atualizar_lead' end, 'vendas_oportunidades', op.id::text,
      pg_catalog.jsonb_build_object('funil', p_funil, 'origem', op.origem, 'com_dono', op.vendedor_id is not null, 'referencia', p_referencia));
  insert into public.vendas_encaminhamentos_bot(referencia, mensagem_id, conversa_id, cliente_id,
    unidade, oportunidade_id, funil_id, novo) values(p_referencia, mensagem, p_conversa_id,
      p_cliente_id, loja, op.id, funil, nova);
  return pg_catalog.jsonb_build_object('ok', true, 'oportunidade_id', op.id, 'novo', nova, 'ja_registrado', false);
end $$;
revoke all on function public.registrar_lead_vendas_bot(uuid, uuid, text, text, text, text, text, boolean, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.registrar_lead_vendas_bot(uuid, uuid, text, text, text, text, text, boolean, text, text, boolean) to service_role;
