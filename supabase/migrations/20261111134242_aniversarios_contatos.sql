-- F5: conclusão explícita e idempotente do contato de aniversário.
-- Não depende de mensagens, notas administrativas ou do fuso do servidor.
create table if not exists public.aniversarios_contatos (
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  data_alvo date not null check (pg_catalog.isfinite(data_alvo)),
  ator_id uuid not null, -- autoria preservada após remoção do usuário
  unidade text not null references public.unidades (chave),
  criado_em timestamptz not null default now(),
  primary key (cliente_id, data_alvo)
);
create index if not exists aniversarios_contatos_unidade_data_idx
  on public.aniversarios_contatos (unidade, data_alvo);

alter table public.aniversarios_contatos enable row level security;
revoke all on table public.aniversarios_contatos from public, anon, authenticated, service_role;
grant select on table public.aniversarios_contatos to service_role;
grant insert (cliente_id, data_alvo, ator_id, unidade)
  on public.aniversarios_contatos to service_role;

-- SECURITY INVOKER: as operações funcionam sem os defaults antigos do Supabase.
grant select (id, nome, telefone, data_nascimento, vendedor_id, unidade_origem, anonimizado)
  on public.clientes to service_role;
grant select (user_id, nome, papel, setor, unidade, ativo) on public.usuarios to service_role;
grant select (user_id, unidade) on public.usuario_unidades to service_role;
grant select (chave, ativa) on public.unidades to service_role;
grant select (id, usuario_id, cliente_id, tipo, data_alvo, concluido_em, insistente, unidade)
  on public.lembretes to service_role;
grant insert (usuario_id, cliente_id, tipo, data_alvo, insistente, unidade, observacao)
  on public.lembretes to service_role;
grant update (insistente, concluido_em, unidade) on public.lembretes to service_role;
grant insert (cliente_id, autor, texto) on public.notas_cliente to service_role;
grant insert (ator, acao, entidade, entidade_id, dados) on public.audit_log to service_role;
-- Leitura F5: só metadados que comprovam contato, sem conteúdo das mensagens.
grant select (id, cliente_id) on public.vendas_oportunidades to service_role;
grant select (id, oportunidade_id, tipo, ator, criado_em) on public.vendas_atividades to service_role;
grant select (id, cliente_id, criado_em, status, direcao, autor) on public.mensagens to service_role;

create or replace function public.registrar_contato_aniversario(
  p_cliente_id uuid, p_ator uuid, p_unidades text[], p_data date, p_autor text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
  inserido uuid;
  agora timestamptz := now();
begin
  if p_cliente_id is null or p_ator is null or p_data is null or not pg_catalog.isfinite(p_data)
    or p_autor is null or char_length(p_autor) not between 1 and 320
    or p_autor ~ '^[[:space:]]|[[:space:]]$' then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aniversario:' || p_cliente_id::text || ':' || p_data::text, 0));

  select un.chave into unidade_atual
  from public.clientes c
  left join public.usuarios dono on dono.user_id = c.vendedor_id
  join public.unidades un on un.chave = coalesce(dono.unidade, c.unidade_origem) and un.ativa
  join public.usuarios ator on ator.user_id = p_ator and ator.ativo
  where c.id = p_cliente_id and not c.anonimizado
    and c.data_nascimento is not null and pg_catalog.isfinite(c.data_nascimento)
    and p_data >= c.data_nascimento
    and extract(month from p_data) = extract(month from c.data_nascimento)
    and extract(day from p_data) = case
      when extract(month from c.data_nascimento) = 2 and extract(day from c.data_nascimento) = 29
        and not ((extract(year from p_data)::integer % 4 = 0 and extract(year from p_data)::integer % 100 <> 0)
          or extract(year from p_data)::integer % 400 = 0) then 28
      else extract(day from c.data_nascimento) end
    -- Administrador atravessa as unidades ativas; os demais precisam dos dois vínculos.
    and (ator.papel = 'admin'
      or (un.chave = any (p_unidades)
        and (ator.unidade = un.chave or exists (
          select 1 from public.usuario_unidades uu where uu.user_id = ator.user_id and uu.unidade = un.chave
        ))
        and ((ator.papel = 'gerente' and ator.setor in ('vendas', 'administracao'))
          or (ator.papel = 'vendedor' and c.vendedor_id = ator.user_id))));
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'fora_da_carteira_ou_unidade');
  end if;

  insert into public.aniversarios_contatos (cliente_id, data_alvo, ator_id, unidade)
  values (p_cliente_id, p_data, p_ator, unidade_atual)
  on conflict (cliente_id, data_alvo) do nothing
  returning cliente_id into inserido;
  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'ja_registrado', true);
  end if;

  update public.lembretes set concluido_em = agora
  where cliente_id = p_cliente_id and tipo = 'aniversario' and data_alvo = p_data
    and concluido_em is null;

  insert into public.notas_cliente (cliente_id, autor, texto)
  values (p_cliente_id, p_autor, 'Contato de aniversário feito (' || pg_catalog.to_char(p_data, 'DD/MM/YYYY') || ').');
  insert into public.audit_log (ator, acao, entidade, entidade_id, dados)
  values (p_autor, 'aniversario_contato', 'cliente', p_cliente_id::text,
    pg_catalog.jsonb_build_object('data_alvo', p_data::text, 'ator_id', p_ator, 'unidade', unidade_atual));

  return pg_catalog.jsonb_build_object('ok', true, 'ja_registrado', false);
end $$;

create or replace function public.ativar_lembrete_aniversario(
  p_cliente_id uuid, p_ator uuid, p_unidades text[], p_data date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
begin
  if p_cliente_id is null or p_ator is null or p_data is null or not pg_catalog.isfinite(p_data) then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aniversario:' || p_cliente_id::text || ':' || p_data::text, 0));

  select un.chave into unidade_atual
  from public.clientes c
  left join public.usuarios dono on dono.user_id = c.vendedor_id
  join public.unidades un on un.chave = coalesce(dono.unidade, c.unidade_origem) and un.ativa
  join public.usuarios ator on ator.user_id = p_ator and ator.ativo
  where c.id = p_cliente_id and not c.anonimizado
    and c.data_nascimento is not null and pg_catalog.isfinite(c.data_nascimento)
    and p_data >= c.data_nascimento
    and extract(month from p_data) = extract(month from c.data_nascimento)
    and extract(day from p_data) = case
      when extract(month from c.data_nascimento) = 2 and extract(day from c.data_nascimento) = 29
        and not ((extract(year from p_data)::integer % 4 = 0 and extract(year from p_data)::integer % 100 <> 0)
          or extract(year from p_data)::integer % 400 = 0) then 28
      else extract(day from c.data_nascimento) end
    and (ator.papel = 'admin'
      or (un.chave = any (p_unidades)
        and (ator.unidade = un.chave or exists (
          select 1 from public.usuario_unidades uu where uu.user_id = ator.user_id and uu.unidade = un.chave
        ))
        and ((ator.papel = 'gerente' and ator.setor in ('vendas', 'administracao'))
          or (ator.papel = 'vendedor' and c.vendedor_id = ator.user_id))));
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'motivo', 'fora_da_carteira_ou_unidade');
  end if;

  if exists (select 1 from public.aniversarios_contatos where cliente_id = p_cliente_id and data_alvo = p_data) then
    return pg_catalog.jsonb_build_object('ok', true);
  end if;

  update public.lembretes set insistente = true, unidade = unidade_atual
  where cliente_id = p_cliente_id and usuario_id = p_ator and tipo = 'aniversario'
    and data_alvo = p_data and concluido_em is null;
  if not found then
    insert into public.lembretes (usuario_id, cliente_id, tipo, data_alvo, insistente, unidade, observacao)
    values (p_ator, p_cliente_id, 'aniversario', p_data, true, unidade_atual, 'Lembrete de aniversário');
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end $$;

revoke all on function public.registrar_contato_aniversario(uuid, uuid, text[], date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ativar_lembrete_aniversario(uuid, uuid, text[], date)
  from public, anon, authenticated, service_role;
grant execute on function public.registrar_contato_aniversario(uuid, uuid, text[], date, text) to service_role;
grant execute on function public.ativar_lembrete_aniversario(uuid, uuid, text[], date) to service_role;
