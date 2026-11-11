-- Primeira fatia de Peças: criação e fila de cotações por unidade.
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
  criado_por uuid references public.usuarios (user_id) on delete set null,
  criado_em timestamptz not null default now()
);

create index pecas_cotacoes_unidade_criado_em_idx
  on public.pecas_cotacoes (unidade, criado_em desc);

alter table public.pecas_cotacoes enable row level security;
revoke all on table public.pecas_cotacoes from public, anon, authenticated, service_role;
grant select, insert on table public.pecas_cotacoes to service_role;
