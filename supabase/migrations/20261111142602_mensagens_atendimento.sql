-- A1.1b: somente a mensagem inicial comprovada do encaminhamento de Peças.
-- Depende de 0001/0002/0003/0005, encaminhamentos_bot e atendimentos_modulares.
-- Sem backfill, histórico por cliente, UI, envio ou associação automática de novas mensagens.

-- A FK também protege contra mudanças posteriores de autor, direção ou classificação
-- interna. Metadata de processamento, status e redação de conteúdo continuam editáveis.
alter table public.mensagens add column if not exists entrada_cliente_externa boolean
  generated always as (
    direcao = 'entrada' and autor = 'cliente'
    and coalesce(metadata -> 'interno', 'false'::jsonb) = 'false'::jsonb
  ) stored;
create unique index if not exists mensagens_prova_atendimento_idx
  on public.mensagens(id, conversa_id, cliente_id, wamid, entrada_cliente_externa);
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
