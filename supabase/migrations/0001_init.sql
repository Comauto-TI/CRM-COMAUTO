-- =====================================================================
-- Agente WhatsApp Comauto — schema inicial
-- Regras de referência: "Regras a serem respeitadas.md" (Meta + LGPD)
-- Todo acesso do painel passa pelo servidor (service role) após checagem
-- de sessão + papel. RLS ligado em TODAS as tabelas, sem políticas para
-- anon/authenticated => o navegador nunca lê o banco diretamente.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Configuração e usuários do painel
-- ---------------------------------------------------------------------
create table config (
  chave        text primary key,
  valor        jsonb not null,
  atualizado_em timestamptz not null default now()
);

create table admin_usuarios (
  user_id   uuid primary key references auth.users on delete cascade,
  nome      text not null,
  papel     text not null default 'atendente'
            check (papel in ('admin','atendente','financeiro')),
  ativo     boolean not null default true,
  -- Alertas de atendimento humano no WhatsApp da recepcionista
  telefone_whatsapp        text,
  recebe_alertas           boolean not null default false,
  consentimento_alertas_em timestamptz,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clientes, veículos, consentimentos, opt-out
-- ---------------------------------------------------------------------
create table clientes (
  id                uuid primary key default gen_random_uuid(),
  telefone          text not null unique,            -- só dígitos, com DDI+DDD (ex: 5551999998888)
  nome              text,
  email             text,
  cidade            text,
  tags              text[] not null default '{}',
  origem            text not null default 'whatsapp', -- whatsapp | painel | importacao | evento
  ultimo_contato_em timestamptz,                      -- última msg RECEBIDA do cliente (janela 24h)
  anonimizado       boolean not null default false,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create table veiculos (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references clientes on delete cascade,
  placa              text,
  modelo             text,
  ano                int,
  km_atual           int,
  ultima_revisao_em  date,
  proxima_revisao_em date,
  criado_em          timestamptz not null default now()
);
create index on veiculos (cliente_id);
create index on veiculos (proxima_revisao_em);

create table consentimentos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references clientes on delete cascade,
  tipo            text not null check (tipo in ('servico','eventos','marketing')),
  status          text not null default 'ativo' check (status in ('ativo','revogado')),
  texto           text not null,     -- texto EXATO exibido no aceite
  origem          text not null,     -- whatsapp_conversa | formulario | painel | importacao
  concedido_em    timestamptz not null default now(),
  revogado_em     timestamptz,
  revogado_origem text
);
create unique index consentimento_ativo_unico on consentimentos (cliente_id, tipo) where status = 'ativo';

-- Lista de bloqueio permanente (opt-out). Mantém dado mínimo p/ comprovar.
create table optouts (
  id                uuid primary key default gen_random_uuid(),
  telefone          text not null,
  cliente_id        uuid references clientes on delete set null,
  palavra_detectada text,
  origem            text not null default 'whatsapp',
  criado_em         timestamptz not null default now()
);
create index on optouts (telefone);

-- ---------------------------------------------------------------------
-- Links e QR codes rastreados (o cliente chama primeiro = sem template, sem custo de disparo)
-- ---------------------------------------------------------------------
create table links_rastreados (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,     -- vai no fim da mensagem pronta: "(cód. ABC123)"
  nome             text not null,            -- ex.: "QR do balcão da oficina"
  canal            text not null default 'outro'
                   check (canal in ('balcao','oficina','instagram','facebook','site','anuncio','evento','panfleto','email','outro')),
  mensagem_inicial text not null,
  ativo            boolean not null default true,
  criado_por       text,
  criado_em        timestamptz not null default now()
);

-- Escaneou/clicou (via /r/<codigo>). Sem IP nem dado pessoal.
create table link_cliques (
  id        uuid primary key default gen_random_uuid(),
  link_id   uuid not null references links_rastreados on delete cascade,
  criado_em timestamptz not null default now()
);
create index on link_cliques (link_id, criado_em);

-- Conversas iniciadas por link (multi-toque: o mesmo cliente pode vir de vários links)
create table link_conversas (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid not null references links_rastreados on delete cascade,
  cliente_id uuid not null references clientes on delete cascade,
  criado_em  timestamptz not null default now(),
  unique (link_id, cliente_id)
);

-- primeiro toque: de onde o cliente veio na primeira vez
alter table clientes add column link_origem_id uuid references links_rastreados on delete set null;

-- ---------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------
create table servicos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  descricao        text,
  duracao_min      int not null check (duracao_min > 0),
  preco_referencia numeric(10,2),        -- só é informado se preenchido aqui (IA não inventa)
  tipo_recurso     text not null default 'box',
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

create table recursos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  tipo      text not null default 'box',   -- box | consultor | sala
  ativo     boolean not null default true
);

-- Várias linhas por dia permitem intervalo de almoço (08-12 e 13-18).
create table horarios_funcionamento (
  id         uuid primary key default gen_random_uuid(),
  dia_semana int  not null check (dia_semana between 0 and 6), -- 0 = domingo
  abre       time not null,
  fecha      time not null check (fecha > abre)
);

create table bloqueios (
  id         uuid primary key default gen_random_uuid(),
  recurso_id uuid references recursos on delete cascade,  -- null = bloqueia a unidade toda (feriado)
  inicio     timestamptz not null,
  fim        timestamptz not null check (fim > inicio),
  motivo     text
);

create table agendamentos (
  id                     uuid primary key default gen_random_uuid(),
  cliente_id             uuid not null references clientes on delete cascade,
  veiculo_id             uuid references veiculos on delete set null,
  servico_id             uuid not null references servicos,
  recurso_id             uuid not null references recursos,
  inicio                 timestamptz not null,
  fim                    timestamptz not null check (fim > inicio),
  status                 text not null default 'pendente'
                         check (status in ('pendente','confirmado','compareceu','cancelado','nao_compareceu')),
  origem                 text not null default 'whatsapp',
  observacoes            text,
  motivo_cancelamento    text,
  confirmado_em          timestamptz,
  confirmado_por         text,   -- telefone do cliente ou e-mail do atendente
  confirmado_canal       text,   -- whatsapp_botao | whatsapp_conversa | painel
  lembrete_24h_em        timestamptz,
  lembrete_2h_em         timestamptz,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  -- REGRA: nunca dois agendamentos ativos no mesmo horário para o mesmo recurso.
  constraint sem_conflito exclude using gist (
    recurso_id with =,
    tstzrange(inicio, fim, '[)') with &&
  ) where (status in ('pendente','confirmado'))
);
create index on agendamentos (inicio);
create index on agendamentos (cliente_id);
create index on agendamentos (status);

create table agendamento_historico (
  id             uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references agendamentos on delete cascade,
  acao           text not null,   -- criado | confirmado | reagendado | cancelado | status_alterado | lembrete
  de_status      text,
  para_status    text,
  detalhes       jsonb not null default '{}',
  ator           text not null,   -- cliente:<tel> | bot | painel:<email> | sistema
  criado_em      timestamptz not null default now()
);
create index on agendamento_historico (agendamento_id);

-- ---------------------------------------------------------------------
-- Eventos / marketing
-- ---------------------------------------------------------------------
create table eventos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  descricao text,
  inicio    timestamptz not null,
  fim       timestamptz,
  local     text not null,
  vagas     int check (vagas is null or vagas > 0),
  status    text not null default 'rascunho' check (status in ('rascunho','ativo','encerrado','cancelado')),
  criado_em timestamptz not null default now()
);

create table inscricoes_evento (
  id             uuid primary key default gen_random_uuid(),
  evento_id      uuid not null references eventos on delete cascade,
  cliente_id     uuid not null references clientes on delete cascade,
  status         text not null default 'convidado'
                 check (status in ('convidado','confirmado','recusado','lista_espera','compareceu','cancelado')),
  confirmado_em  timestamptz,
  confirmado_por text,
  origem         text not null default 'campanha',
  lembrete_em    timestamptz,
  criado_em      timestamptz not null default now(),
  unique (evento_id, cliente_id)
);

create table templates (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null unique,        -- nome EXATO aprovado na Meta
  idioma           text not null default 'pt_BR',
  categoria_meta   text not null check (categoria_meta in ('MARKETING','UTILITY','AUTHENTICATION')),
  finalidade       text not null check (finalidade in ('servico','eventos','marketing')), -- consentimento exigido
  uso              text not null,               -- confirmacao_agendamento | lembrete_24h | ...
  corpo_exemplo    text not null,
  variaveis        text[] not null default '{}',
  botoes           jsonb not null default '[]', -- [{"tipo":"quick_reply","texto":"Confirmar","payload_prefixo":"AG_CONF"}]
  status_aprovacao text not null default 'rascunho' check (status_aprovacao in ('rascunho','pendente','aprovado','reprovado')),
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

create table campanhas (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null,
  tipo               text not null check (tipo in ('evento','marketing')),
  evento_id          uuid references eventos on delete set null,
  template_id        uuid not null references templates,
  filtros            jsonb not null default '{}',   -- {"tags":["suv"],"cidade":"Porto Alegre"}
  status             text not null default 'rascunho'
                     check (status in ('rascunho','teste','pronta','enviando','pausada','concluida','cancelada')),
  lote_tamanho       int not null default 50 check (lote_tamanho between 1 and 500),
  limite_diario      int not null default 250 check (limite_diario > 0),
  total_previsto     int not null default 0,
  custo_estimado_brl numeric(12,2) not null default 0,
  motivo_pausa       text,
  iniciada_em        timestamptz,
  concluida_em       timestamptz,
  criado_por         text,
  criado_em          timestamptz not null default now()
);

create table campanha_envios (
  id            uuid primary key default gen_random_uuid(),
  campanha_id   uuid not null references campanhas on delete cascade,
  cliente_id    uuid not null references clientes on delete cascade,
  telefone      text not null,
  grupo_teste   boolean not null default false,
  status        text not null default 'fila'
                check (status in ('fila','enviado','entregue','lido','respondido','falhou','ignorado')),
  wamid         text,
  erro          text,
  enviado_em    timestamptz,
  entregue_em   timestamptz,
  lido_em       timestamptz,
  respondido_em timestamptz,
  unique (campanha_id, cliente_id)       -- REGRA: não repetir envio p/ quem já recebeu
);
create index on campanha_envios (campanha_id, status);
create index on campanha_envios (wamid);

-- ---------------------------------------------------------------------
-- Conversas e mensagens
-- ---------------------------------------------------------------------
create table conversas (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null unique references clientes on delete cascade,
  -- bot: IA responde | humano: fila/atendimento da recepção (IA calada) | encerrada
  status                text not null default 'bot' check (status in ('bot','humano','encerrada')),
  motivo_transferencia  text,
  aguardando_desde      timestamptz,          -- entrou na fila humana
  assumida_por          text,                 -- e-mail da recepcionista que assumiu
  assumida_em           timestamptz,
  alerta_reenviado_em   timestamptz,          -- SLA estourado: reenvio único
  encerrada_em          timestamptz,
  resultado             text,                 -- agendou | resolvido | sem_retorno | reclamacao | outro
  falhas_entendimento   int not null default 0,
  ultima_msg_em         timestamptz,
  nao_lidas             int not null default 0,
  criado_em             timestamptz not null default now()
);
create index on conversas (status, aguardando_desde);

create table notas_cliente (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes on delete cascade,
  autor      text not null,
  texto      text not null,
  criado_em  timestamptz not null default now()
);
create index on notas_cliente (cliente_id);

create table respostas_rapidas (
  id        uuid primary key default gen_random_uuid(),
  titulo    text not null,
  texto     text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table mensagens (
  id                 uuid primary key default gen_random_uuid(),
  conversa_id        uuid references conversas on delete cascade,
  cliente_id         uuid references clientes on delete cascade,
  direcao            text not null check (direcao in ('entrada','saida')),
  autor              text not null check (autor in ('cliente','bot','atendente','sistema')),
  tipo               text not null default 'text',  -- text | template | interactive | button | outro
  conteudo           text,
  wamid              text unique,                   -- id da Meta (deduplica reentregas do webhook)
  template_nome      text,
  categoria_cobranca text,                          -- MARKETING | UTILITY | AUTHENTICATION | SERVICE
  status             text not null default 'recebida'
                     check (status in ('recebida','enviada','entregue','lida','falhou','bloqueada')),
  erro               text,
  custo_brl          numeric(12,4) not null default 0,
  campanha_id        uuid references campanhas on delete set null,
  agendamento_id     uuid references agendamentos on delete set null,
  metadata           jsonb not null default '{}',
  criado_em          timestamptz not null default now()
);
create index on mensagens (conversa_id, criado_em);
create index on mensagens (criado_em);

-- ---------------------------------------------------------------------
-- Follow-up
-- ---------------------------------------------------------------------
create table followups (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references clientes on delete cascade,
  agendamento_id uuid references agendamentos on delete cascade,
  evento_id      uuid references eventos on delete cascade,
  tipo           text not null check (tipo in ('pos_servico','revisao_periodica','lead_sem_agendamento','pos_evento','nao_compareceu')),
  agendar_para   timestamptz not null,
  status         text not null default 'pendente'
                 check (status in ('pendente','enviado','cancelado','falhou','sem_consentimento','respondido')),
  tentativas     int not null default 0,
  enviado_em     timestamptz,
  resultado      text,
  criado_em      timestamptz not null default now()
);
create index on followups (status, agendar_para);

-- ---------------------------------------------------------------------
-- Financeiro
-- ---------------------------------------------------------------------
create table precos_meta (
  id            uuid primary key default gen_random_uuid(),
  categoria     text not null check (categoria in ('MARKETING','UTILITY','AUTHENTICATION','SERVICE')),
  valor_brl     numeric(10,4) not null,
  vigente_desde date not null,
  observacao    text
);

create table custos (
  id                 uuid primary key default gen_random_uuid(),
  ocorrido_em        timestamptz not null default now(),
  categoria          text not null check (categoria in
                     ('meta_marketing','meta_utility','meta_authentication','meta_service','ia_anthropic','infra','outro')),
  descricao          text not null,
  quantidade         numeric(14,4) not null default 1,
  valor_unitario_brl numeric(14,6) not null default 0,
  valor_brl          numeric(14,4) not null,
  valor_usd          numeric(14,6),
  cambio             numeric(10,4),
  mensagem_id        uuid references mensagens on delete set null,
  campanha_id        uuid references campanhas on delete set null,
  agendamento_id     uuid references agendamentos on delete set null,
  cliente_id         uuid references clientes on delete set null,
  metadata           jsonb not null default '{}'   -- tokens, wamid, pricing_model...
);
create index on custos (ocorrido_em);
create index on custos (categoria, ocorrido_em);
create index on custos (campanha_id);
create unique index custo_mensagem_unico on custos (mensagem_id) where mensagem_id is not null;

create table custos_fixos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  valor       numeric(12,2) not null,
  moeda       text not null default 'BRL' check (moeda in ('BRL','USD')),
  recorrencia text not null default 'mensal' check (recorrencia in ('mensal','anual')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Segurança e auditoria
-- ---------------------------------------------------------------------
create table eventos_seguranca (
  id         uuid primary key default gen_random_uuid(),
  telefone   text,
  cliente_id uuid references clientes on delete set null,
  tipo       text not null check (tipo in
             ('pedido_codigo','pedido_receita','pedido_credencial','prompt_injection',
              'fora_escopo','rate_limit','saida_bloqueada','assinatura_invalida','dados_sensiveis')),
  trecho     text,          -- até 300 caracteres da mensagem original
  acao       text not null, -- recusado | bloqueado | ignorado
  criado_em  timestamptz not null default now()
);
create index on eventos_seguranca (criado_em);
create index on eventos_seguranca (telefone, criado_em);

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  ator        text not null,
  acao        text not null,
  entidade    text not null,
  entidade_id text,
  dados       jsonb not null default '{}',
  criado_em   timestamptz not null default now()
);
create index on audit_log (criado_em);

-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------

-- Confirma presença respeitando o limite de vagas (atômico).
create or replace function confirmar_inscricao(p_evento uuid, p_cliente uuid, p_por text)
returns text language plpgsql as $$
declare
  v_vagas int;
  v_confirmados int;
begin
  select vagas into v_vagas from eventos where id = p_evento and status = 'ativo' for update;
  if not found then return 'evento_indisponivel'; end if;

  select count(*) into v_confirmados from inscricoes_evento
   where evento_id = p_evento and status = 'confirmado' and cliente_id <> p_cliente;

  if v_vagas is not null and v_confirmados >= v_vagas then
    insert into inscricoes_evento (evento_id, cliente_id, status, origem)
    values (p_evento, p_cliente, 'lista_espera', 'whatsapp')
    on conflict (evento_id, cliente_id) do update set status = 'lista_espera'
      where inscricoes_evento.status <> 'confirmado';
    return 'esgotado';
  end if;

  insert into inscricoes_evento (evento_id, cliente_id, status, confirmado_em, confirmado_por, origem)
  values (p_evento, p_cliente, 'confirmado', now(), p_por, 'whatsapp')
  on conflict (evento_id, cliente_id) do update
    set status = 'confirmado', confirmado_em = now(), confirmado_por = p_por;
  return 'confirmado';
end $$;

-- Resumo financeiro por categoria no período.
create or replace function resumo_custos(p_inicio timestamptz, p_fim timestamptz)
returns table (categoria text, quantidade numeric, total_brl numeric, total_usd numeric)
language sql stable as $$
  select categoria, sum(quantidade), sum(valor_brl), sum(coalesce(valor_usd,0))
    from custos
   where ocorrido_em >= p_inicio and ocorrido_em < p_fim
   group by categoria
   order by sum(valor_brl) desc;
$$;

-- Série diária para gráfico.
create or replace function custos_diarios(p_inicio timestamptz, p_fim timestamptz)
returns table (dia date, categoria text, total_brl numeric)
language sql stable as $$
  select (ocorrido_em at time zone 'America/Sao_Paulo')::date, categoria, sum(valor_brl)
    from custos
   where ocorrido_em >= p_inicio and ocorrido_em < p_fim
   group by 1, 2
   order by 1;
$$;

-- Custo por campanha.
create or replace function custos_por_campanha(p_inicio timestamptz, p_fim timestamptz)
returns table (campanha_id uuid, nome text, mensagens bigint, total_brl numeric)
language sql stable as $$
  select c.campanha_id, cp.nome, count(*), sum(c.valor_brl)
    from custos c join campanhas cp on cp.id = c.campanha_id
   where c.ocorrido_em >= p_inicio and c.ocorrido_em < p_fim
   group by c.campanha_id, cp.nome
   order by 4 desc;
$$;

-- atualizado_em automático
create or replace function tocar_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;
create trigger t_clientes_upd before update on clientes for each row execute function tocar_atualizado_em();
create trigger t_agend_upd    before update on agendamentos for each row execute function tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- RLS: liga em tudo, sem políticas => só o service role (servidor) acessa.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'config','admin_usuarios','clientes','veiculos','consentimentos','optouts','servicos','recursos',
    'horarios_funcionamento','bloqueios','agendamentos','agendamento_historico','eventos',
    'inscricoes_evento','templates','campanhas','campanha_envios','conversas','mensagens',
    'notas_cliente','respostas_rapidas','links_rastreados','link_cliques','link_conversas',
    'followups','precos_meta','custos','custos_fixos','eventos_seguranca','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

revoke execute on function confirmar_inscricao(uuid, uuid, text) from anon, authenticated, public;
revoke execute on function resumo_custos(timestamptz, timestamptz) from anon, authenticated, public;
revoke execute on function custos_diarios(timestamptz, timestamptz) from anon, authenticated, public;
revoke execute on function custos_por_campanha(timestamptz, timestamptz) from anon, authenticated, public;
