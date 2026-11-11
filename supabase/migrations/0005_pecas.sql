-- Fila de cotações de Peças por unidade e histórico das etapas.
create table public.pecas_cotacoes (
  id uuid primary key default gen_random_uuid(),
  unidade text not null default 'comauto' references public.unidades (chave),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  veiculo_id uuid references public.veiculos (id) on delete set null,
  origem text not null default 'balcao' check (origem in ('balcao', 'oficina')),
  descricao text not null check (
    char_length(descricao) between 1 and 1000
    and descricao !~ '^[[:space:]]|[[:space:]]$'
  ),
  status text not null default 'novo' check (status in (
    'novo', 'em_cotacao', 'aguardando_cliente', 'aprovado',
    'em_separacao', 'entregue', 'perdido', 'cancelado'
  )),
  responsavel_id uuid references public.usuarios (user_id) on delete set null,
  criado_por uuid references public.usuarios (user_id) on delete set null,
  criado_em timestamptz not null default now()
);

create index pecas_cotacoes_unidade_criado_em_idx
  on public.pecas_cotacoes (unidade, criado_em desc);

alter table public.pecas_cotacoes enable row level security;
revoke all on table public.pecas_cotacoes from public, anon, authenticated, service_role;
grant select, insert on table public.pecas_cotacoes to service_role;
grant update (status, responsavel_id) on table public.pecas_cotacoes to service_role;

create table public.pecas_cotacoes_historico (
  id uuid primary key default gen_random_uuid(),
  cotacao_id uuid not null references public.pecas_cotacoes (id) on delete restrict,
  unidade text not null references public.unidades (chave),
  de_status text not null,
  para_status text not null,
  -- Preserva o identificador histórico mesmo se o usuário for removido.
  ator_id uuid not null,
  ocorrido_em timestamptz not null default now()
);

create index pecas_cotacoes_historico_cotacao_idx
  on public.pecas_cotacoes_historico (cotacao_id, ocorrido_em desc);

alter table public.pecas_cotacoes_historico enable row level security;
revoke all on table public.pecas_cotacoes_historico from public, anon, authenticated, service_role;
grant insert on table public.pecas_cotacoes_historico to service_role;

create function public.pecas_assumir_cotacao(p_id uuid, p_unidades text[], p_ator uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unidade_atual text;
begin
  update public.pecas_cotacoes
  set status = 'em_cotacao', responsavel_id = p_ator
  where id = p_id
    and unidade = any (p_unidades)
    and status = 'novo'
    and responsavel_id is null
    and p_ator is not null
  returning unidade into unidade_atual;

  if found then
    insert into public.pecas_cotacoes_historico (cotacao_id, unidade, de_status, para_status, ator_id)
    values (p_id, unidade_atual, 'novo', 'em_cotacao', p_ator);
    return true;
  end if;

  return exists (
    select 1 from public.pecas_cotacoes
    where id = p_id
      and unidade = any (p_unidades)
      and status = 'em_cotacao'
      and responsavel_id = p_ator
  );
end $$;

revoke all on function public.pecas_assumir_cotacao(uuid, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pecas_assumir_cotacao(uuid, text[], uuid) to service_role;
