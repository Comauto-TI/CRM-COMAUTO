-- Banco descartável: 0001/0002/0003/0005/0006. Sem grants corretivos na fixture.
begin;
create function pg_temp.pq_uuid(n integer) returns uuid language sql immutable as $$
  select ('d1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.pq_estado() returns jsonb language sql as $$
  select jsonb_build_object(
    'cotacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes t),
    'itens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacao_itens t),
    'historico',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes_historico t),
    'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
    'conversas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.conversas t),
    'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
    'canais',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_canais t),
    'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t));
$$;
create function pg_temp.pq_quadro(p_ator integer) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r:=public.pecas_quadro(pg_temp.pq_uuid(p_ator));
  reset role;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.pq_mover(p_id integer,p_ator integer,p_destino text,p_posicao numeric,p_status text,
  p_itens jsonb default '{}'::jsonb,p_motivo text default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r:=public.pecas_mover_quadro(pg_temp.pq_uuid(p_id),pg_temp.pq_uuid(p_ator),p_destino,p_posicao,p_status,p_itens,p_motivo);
  reset role;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.pq_negar(p_id integer,p_ator integer,p_destino text,p_posicao numeric,p_status text,p_codigo text,
  p_itens jsonb default '{}'::jsonb,p_motivo text default null) returns void language plpgsql as $$
declare antes jsonb; r jsonb;
begin
  antes:=pg_temp.pq_estado();
  r:=pg_temp.pq_mover(p_id,p_ator,p_destino,p_posicao,p_status,p_itens,p_motivo);
  if r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo) then raise exception 'Mover deveria recusar com %, recebeu %.',p_codigo,r; end if;
  if antes is distinct from pg_temp.pq_estado() then raise exception 'Mover recusou com efeitos parciais.'; end if;
end $$;
create function pg_temp.pq_ok(p_id integer,p_ator integer,p_destino text,p_posicao numeric,p_status text,
  p_itens jsonb default '{}'::jsonb,p_motivo text default null) returns void language plpgsql as $$
declare r jsonb;
begin
  r:=pg_temp.pq_mover(p_id,p_ator,p_destino,p_posicao,p_status,p_itens,p_motivo);
  if r is distinct from jsonb_build_object('ok',true) then raise exception 'Mover recusou positivo: %.',r; end if;
  if not exists(select 1 from public.pecas_cotacoes where id=pg_temp.pq_uuid(p_id) and status=p_destino and posicao=p_posicao) then
    raise exception 'Mover retornou sucesso sem persistir destino % / posição % na cotação %.',p_destino,p_posicao,p_id;
  end if;
end $$;

insert into public.unidades(chave,nome,ativa) values('pq_a','Quadro principal fictício',true),('pq_b','Quadro outra unidade',true),('pq_inativa','Quadro inativo',false);
insert into auth.users(id) select pg_temp.pq_uuid(n) from generate_series(1,10)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.pq_uuid(1),'Peças A','pecas','pecas','pq_a',true),(pg_temp.pq_uuid(2),'Peças B','pecas','pecas','pq_a',true),
  (pg_temp.pq_uuid(3),'Gerente Peças','gerente','pecas','pq_a',true),(pg_temp.pq_uuid(4),'Administrador','admin','administracao','pq_b',true),
  (pg_temp.pq_uuid(5),'Peças extra','pecas','pecas','pq_b',true),(pg_temp.pq_uuid(6),'Peças unidadeB','pecas','pecas','pq_b',true),
  (pg_temp.pq_uuid(7),'Vendedor','vendedor','vendas','pq_a',true),(pg_temp.pq_uuid(8),'Inativo','pecas','pecas','pq_a',false),
  (pg_temp.pq_uuid(9),'Gerente Oficina','gerente','oficina','pq_a',true),(pg_temp.pq_uuid(10),'Gerente Administração','gerente','administracao','pq_b',true);
insert into public.usuario_unidades(user_id,unidade) values(pg_temp.pq_uuid(5),'pq_a'),(pg_temp.pq_uuid(10),'pq_a');
insert into public.clientes(id,telefone,nome,anonimizado,unidade_origem)
select pg_temp.pq_uuid(n),'55118000'||lpad(n::text,5,'0'),'Cliente quadro fictício '||n,n=105,'pq_a' from generate_series(101,115)n;
insert into public.conversas(id,cliente_id,unidade,status)
select pg_temp.pq_uuid(n+100),pg_temp.pq_uuid(n),'pq_a','bot' from generate_series(101,115)n;
insert into public.pecas_cotacoes(id,cliente_id,unidade,responsavel_id,descricao,status,motivo_encerramento,posicao,criado_em)
select pg_temp.pq_uuid(n),pg_temp.pq_uuid(case when n=312 then 101 else n-200 end),
  case when n in (304,315) then 'pq_b' when n=306 then 'pq_inativa' else 'pq_a' end,
  case when n in (302,315) then null when n in (303,312) then pg_temp.pq_uuid(2) when n=307 then pg_temp.pq_uuid(5) else pg_temp.pq_uuid(1) end,
  'Cotação quadro fictícia '||n,
  case when n=308 then 'perdido' when n in (309,310,314) then 'em_cotacao' when n=311 then 'aguardando_cliente' else 'novo' end,
  case when n=308 then 'Cliente desistiu' else null end,
  case n when 302 then 10 when 309 then 20 when 301 then 30 else 1000 end,'2026-11-10T08:00:00Z'
from generate_series(301,315)n;
insert into public.pecas_cotacao_itens(id,cotacao_id,descricao,quantidade,preco_unitario_centavos,versao) values
  (pg_temp.pq_uuid(601),pg_temp.pq_uuid(309),'Item A',2,1000,1),(pg_temp.pq_uuid(602),pg_temp.pq_uuid(309),'Item B',3,250,2);

-- Execução real sem defaults: scope, DTO, valores e READONLY antes de ações.
do $$
declare r jsonb; card jsonb; antes jsonb; n integer; ids jsonb; helper_ids jsonb;
begin
  antes:=pg_temp.pq_estado(); r:=pg_temp.pq_quadro(1);
  if r->>'ok' is distinct from 'true' or (r->>'total')::integer<>8 or r->>'temMais'<>'false' then raise exception 'Quadro pessoal/fila incorreto: %.',r; end if;
  if exists(select 1 from jsonb_array_elements(r->'cotacoes')c where c->>'id' in (pg_temp.pq_uuid(303)::text,pg_temp.pq_uuid(304)::text,pg_temp.pq_uuid(305)::text,pg_temp.pq_uuid(306)::text,pg_temp.pq_uuid(312)::text)) then raise exception 'Quadro incluiu colega/unidade/anonimizado.'; end if;
  if r#>>'{cotacoes,0,id}'<>pg_temp.pq_uuid(302)::text or r#>>'{cotacoes,1,id}'<>pg_temp.pq_uuid(309)::text then raise exception 'Ordem inicial por posição incorreta.'; end if;
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(309)::text;
  if (card->>'valorCentavos')::bigint<>2750 or card->'itensVersoes'<>jsonb_build_object(pg_temp.pq_uuid(601)::text,1,pg_temp.pq_uuid(602)::text,2) then raise exception 'Valor/versões incorretos: %.',card; end if;
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(310)::text;
  if card->'valorCentavos'<>'null'::jsonb or card->'itensVersoes'<>'{}'::jsonb then raise exception 'Sem itens deveria ter valor nulo/versões vazias.'; end if;
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(308)::text;
  if card->>'podeMover'<>'false' then raise exception 'Terminal continua movível.'; end if;
  set local role service_role;
  select jsonb_agg(id::text order by id) into helper_ids from public.pecas_cotacoes_visiveis(pg_temp.pq_uuid(1));
  reset role;
  select jsonb_agg(c->>'id' order by c->>'id') into ids from jsonb_array_elements(r->'cotacoes')c;
  if ids is distinct from helper_ids then raise exception 'Helper de detalhe divergiu do quadro autorizado.'; end if;
  if (pg_temp.pq_quadro(3)->>'total')::integer<>11 or (pg_temp.pq_quadro(4)->>'total')::integer<>13
    or (pg_temp.pq_quadro(10)->>'total')::integer<>13 or (pg_temp.pq_quadro(5)->>'total')::integer<>3
    or (pg_temp.pq_quadro(6)->>'total')::integer<>1 then raise exception 'Escopo de gerência/admin/extra/unidadeB incorreto.'; end if;
  foreach n in array array[7,8,9] loop
    if pg_temp.pq_quadro(n)->'cotacoes'<>'[]'::jsonb then raise exception 'Perfil inelegível recebeu quadro: %.',n; end if;
  end loop;
  if antes is distinct from pg_temp.pq_estado() then raise exception 'Ler quadro alterou dados.'; end if;
end $$;

-- Timestamp nullable sem default: nenhuma atividade é inventada para cartão intocado.
-- Item INSERT/UPDATE/DELETE e próxima ação atualizam; UPDATE sem mudança é idempotente.
do $$ declare inicio timestamptz; marcada timestamptz; r text; card jsonb;
begin
  if exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.pecas_cotacoes'::regclass and a.attname='atualizado_em')
    or exists(select 1 from pg_attribute where attrelid='public.pecas_cotacoes'::regclass and attname='atualizado_em' and attnotnull)
    or (select atualizado_em from public.pecas_cotacoes where id=pg_temp.pq_uuid(311)) is not null then raise exception 'Timestamp foi preenchido sem atividade real.'; end if;
  inicio:=clock_timestamp();
  set local role service_role;
  r:=public.pecas_adicionar_item(pg_temp.pq_uuid(310),pg_temp.pq_uuid(603),array['pq_a'],pg_temp.pq_uuid(1),'Item temporal',1,100,null);
  reset role;
  select atualizado_em into marcada from public.pecas_cotacoes where id=pg_temp.pq_uuid(310);
  if r<>'adicionado' or marcada is null or marcada<inicio then raise exception 'INSERT item não atualizou timestamp.'; end if;
  set local role service_role;
  update public.pecas_cotacao_itens set quantidade=quantidade where id=pg_temp.pq_uuid(603);
  reset role;
  if (select atualizado_em from public.pecas_cotacoes where id=pg_temp.pq_uuid(310)) is distinct from marcada then raise exception 'Item sem mudança inventou timestamp.'; end if;
  inicio:=clock_timestamp();
  set local role service_role;
  update public.pecas_cotacao_itens set quantidade=2,versao=versao+1 where id=pg_temp.pq_uuid(603);
  reset role;
  if not exists(select 1 from public.pecas_cotacoes where id=pg_temp.pq_uuid(310) and atualizado_em>=inicio) then raise exception 'UPDATE item não atualizou timestamp.'; end if;
  inicio:=clock_timestamp();
  -- Exclusão administrativa da fixture: o serviço não recebe novo CRUD para apagar itens.
  delete from public.pecas_cotacao_itens where id=pg_temp.pq_uuid(603);
  if not exists(select 1 from public.pecas_cotacoes where id=pg_temp.pq_uuid(310) and atualizado_em>=inicio) then raise exception 'DELETE item não atualizou timestamp.'; end if;
  inicio:=clock_timestamp();
  set local role service_role;
  update public.pecas_cotacoes set proxima_acao='Retornar ligação' where id=pg_temp.pq_uuid(310);
  reset role;
  select atualizado_em into marcada from public.pecas_cotacoes where id=pg_temp.pq_uuid(310);
  if marcada is null or marcada<inicio then raise exception 'Próxima ação não atualizou timestamp.'; end if;
  set local role service_role;
  update public.pecas_cotacoes set proxima_acao=proxima_acao where id=pg_temp.pq_uuid(310);
  reset role;
  if (select atualizado_em from public.pecas_cotacoes where id=pg_temp.pq_uuid(310)) is distinct from marcada then raise exception 'Próxima ação sem mudança inventou atualização.'; end if;
  select c into card from jsonb_array_elements(pg_temp.pq_quadro(1)->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(310)::text;
  if (card->>'atualizadoEm')::timestamptz is distinct from marcada or card->'ultimoContatoEm'<>'null'::jsonb then raise exception 'Quadro não refletiu atividade própria ou confundiu com contato.'; end if;
end $$;

-- Fila sem dono e cotação própria já atribuída devem realmente avançar de etapa.
select pg_temp.pq_ok(302,1,'em_cotacao',12.5,'novo');
select pg_temp.pq_ok(301,1,'em_cotacao',31,'novo');

-- Contato é do negócio explícito, não da ficha/canal físico compartilhado.
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo,criado_em) values
  (pg_temp.pq_uuid(401),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'entrada','cliente','wamid.pq.inicial','Pedido inicial','2026-11-10T10:00:00Z'),
  (pg_temp.pq_uuid(402),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'entrada','cliente','wamid.pq.historico','Histórico global mais recente','2026-11-10T12:00:00Z'),
  (pg_temp.pq_uuid(407),pg_temp.pq_uuid(201),pg_temp.pq_uuid(101),'entrada','cliente','wamid.pq.outro-negocio','Outro negócio do mesmo cliente','2026-11-10T15:00:00Z');
update public.pecas_cotacoes set origem='whatsapp',origem_ref='wamid.pq.inicial' where id=pg_temp.pq_uuid(309);
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino,cotacao_id) values
  ('wamid.pq.inicial',pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'pq_a','pecas',pg_temp.pq_uuid(309)),
  ('wamid.pq.outro-negocio',pg_temp.pq_uuid(201),pg_temp.pq_uuid(101),'pq_a','pecas',pg_temp.pq_uuid(312));
do $$ declare r jsonb; card jsonb;
begin
  r:=pg_temp.pq_quadro(1);
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(309)::text;
  if (card->>'ultimoContatoEm')::timestamptz is distinct from '2026-11-10T10:00:00Z'::timestamptz then raise exception 'Contato inicial não usou proveniência ou importou global: %.',card; end if;
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(301)::text;
  if card->'ultimoContatoEm'<>'null'::jsonb then raise exception 'Outro negócio do mesmo cliente influenciou último contato.'; end if;
  set local role service_role;
  r:=public.pecas_assumir_atendimento(pg_temp.pq_uuid(309),pg_temp.pq_uuid(1),0);
  if r->>'ok' is distinct from 'true' then raise exception 'Não assumiu para contato vinculado: %.',r; end if;
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.pq_uuid(403),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'entrada','cliente','wamid.pq.ativa','Entrada vinculada');
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo,metadata)
    values(pg_temp.pq_uuid(404),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'saida','sistema','wamid.pq.interna','Alerta interno','{"interno":true}');
  r:=public.pecas_reservar_resposta(pg_temp.pq_uuid(309),pg_temp.pq_uuid(1),1,pg_temp.pq_uuid(451),'Resposta própria');
  if r->>'ok' is distinct from 'true' then raise exception 'Não reservou saída própria: %.',r; end if;
  r:=public.pecas_autorizar_resposta(pg_temp.pq_uuid(309),pg_temp.pq_uuid(1),1,pg_temp.pq_uuid(451));
  if r->>'ok' is distinct from 'true' then raise exception 'Não autorizou saída própria: %.',r; end if;
  update public.mensagens set status='enviada',wamid='wamid.pq.saida',erro=null where id=pg_temp.pq_uuid(451);
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.pq_uuid(405),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'entrada','cliente','wamid.pq.ambigua','Entrada que ficará ambígua'),
      (pg_temp.pq_uuid(406),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'entrada','cliente','wamid.pq.contraditoria','Entrada com origem em outra cotação');
  reset role;
end $$;
-- Datas de evidência controladas somente pela fixture dona do banco.
update public.mensagens set criado_em=case
  when id=pg_temp.pq_uuid(403) then '2026-11-10T10:15:00Z'::timestamptz
  when id=pg_temp.pq_uuid(404) then '2026-11-10T13:00:00Z'::timestamptz
  when id=pg_temp.pq_uuid(405) then '2026-11-10T10:30:00Z'::timestamptz
  when id=pg_temp.pq_uuid(406) then '2026-11-10T14:00:00Z'::timestamptz
  else '2026-11-10T10:20:00Z'::timestamptz end
where id in (pg_temp.pq_uuid(403),pg_temp.pq_uuid(404),pg_temp.pq_uuid(405),pg_temp.pq_uuid(406),pg_temp.pq_uuid(451));
insert into public.vendas_funis(id,unidade,chave,nome,ativo) values(pg_temp.pq_uuid(801),'pq_a','pq_fixture','Quadro fixture',true);
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values(pg_temp.pq_uuid(802),pg_temp.pq_uuid(801),'Aberta',1,'aberta');
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
  values(pg_temp.pq_uuid(803),'pq_a',pg_temp.pq_uuid(801),pg_temp.pq_uuid(802),pg_temp.pq_uuid(109),pg_temp.pq_uuid(7),'fixture@example.invalid');
insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
  values('wamid.pq.ambigua',pg_temp.pq_uuid(405),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'pq_a',pg_temp.pq_uuid(803),pg_temp.pq_uuid(801),true);
insert into public.pecas_cotacoes(id,cliente_id,unidade,responsavel_id,descricao)
  values(pg_temp.pq_uuid(319),pg_temp.pq_uuid(109),'pq_a',pg_temp.pq_uuid(2),'Outra origem explícita');
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino,cotacao_id)
  values('wamid.pq.contraditoria',pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),'pq_a','pecas',pg_temp.pq_uuid(319));
insert into public.pecas_cotacoes_historico(cotacao_id,unidade,de_status,para_status,ator_id,ocorrido_em) values
  (pg_temp.pq_uuid(309),'pq_a','novo','em_cotacao',pg_temp.pq_uuid(1),'2026-11-10T08:30:00Z'),
  (pg_temp.pq_uuid(309),'pq_a','em_cotacao','em_cotacao',pg_temp.pq_uuid(1),'2026-11-10T10:45:00Z');
do $$ declare r jsonb; card jsonb; antes jsonb; atualizada timestamptz;
begin
  select atualizado_em into atualizada from public.pecas_cotacoes where id=pg_temp.pq_uuid(309);
  antes:=pg_temp.pq_estado(); r:=pg_temp.pq_quadro(1);
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(309)::text;
  if (card->>'ultimoContatoEm')::timestamptz is distinct from '2026-11-10T10:20:00Z'::timestamptz
    or (card->>'atualizadoEm')::timestamptz is distinct from atualizada
    or (card->>'entrouEm')::timestamptz is distinct from '2026-11-10T08:30:00Z'::timestamptz then raise exception 'Contato/etapa/atualização divergiram: %.',card; end if;
  if antes is distinct from pg_temp.pq_estado() then raise exception 'Métrica de contato alterou dados.'; end if;
end $$;

-- Mensagens históricas explícitas, produzidas antes da ambiguidade: reservas/falhas
-- mais recentes continuam sem representar um contato realizado.
do $$ declare r jsonb; card jsonb; ticket uuid; atualizada timestamptz;
begin
  select id into ticket from public.atendimentos_modulares where cotacao_id=pg_temp.pq_uuid(309);
  select atualizado_em into atualizada from public.pecas_cotacoes where id=pg_temp.pq_uuid(309);
  insert into public.mensagens(id,conversa_id,cliente_id,atendimento_id,direcao,autor,conteudo,status,erro,criado_em) values
    (pg_temp.pq_uuid(452),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),ticket,'saida','atendente','Reserva ainda não enviada','bloqueada','envio_em_processamento','2026-11-10T15:00:00Z'),
    (pg_temp.pq_uuid(453),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),ticket,'saida','atendente','Envio que falhou','falhou','falha_ficticia','2026-11-10T16:00:00Z');
  r:=pg_temp.pq_quadro(1);
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(309)::text;
  if (card->>'ultimoContatoEm')::timestamptz is distinct from '2026-11-10T10:20:00Z'::timestamptz
    or (card->>'atualizadoEm')::timestamptz is distinct from atualizada then
    raise exception 'Reserva/falha adiantou contato ou atualização: %.',card;
  end if;
  insert into public.mensagens(id,conversa_id,cliente_id,atendimento_id,direcao,autor,conteudo,status,criado_em)
    values(pg_temp.pq_uuid(454),pg_temp.pq_uuid(209),pg_temp.pq_uuid(109),ticket,'saida','atendente','Envio confirmado','enviada','2026-11-10T11:45:00Z');
  r:=pg_temp.pq_quadro(1);
  select c into card from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(309)::text;
  if (card->>'ultimoContatoEm')::timestamptz is distinct from '2026-11-10T11:45:00Z'::timestamptz then raise exception 'Envio confirmado não avançou último contato: %.',card; end if;
end $$;

-- Status e versões de itens antigas nunca causam deslocamento parcial.
select pg_temp.pq_negar(309,1,'aguardando_cliente',40,'novo','desatualizada');
select pg_temp.pq_negar(309,1,'aguardando_cliente',40,'em_cotacao','desatualizada','{}');
select pg_temp.pq_negar(310,1,'aguardando_cliente',40,'em_cotacao','sem_itens');
select pg_temp.pq_ok(309,1,'aguardando_cliente',40,'em_cotacao',jsonb_build_object(pg_temp.pq_uuid(601)::text,1,pg_temp.pq_uuid(602)::text,2));
select pg_temp.pq_ok(309,1,'aprovado',50,'aguardando_cliente');
select pg_temp.pq_negar(309,1,'em_cotacao',60,'aprovado','transicao');
select pg_temp.pq_negar(313,1,'aprovado',60,'novo','transicao');
select pg_temp.pq_negar(313,1,'entregue',60,'novo','invalido');
select pg_temp.pq_negar(313,1,'em_separacao',60,'novo','invalido');
select pg_temp.pq_negar(303,1,'em_cotacao',60,'novo','indisponivel');
select pg_temp.pq_negar(303,3,'em_cotacao',60,'novo','indisponivel'); -- supervisor lê, mas não arrasta carteira de outro
select pg_temp.pq_negar(304,1,'em_cotacao',60,'novo','indisponivel');
select pg_temp.pq_negar(305,1,'em_cotacao',60,'novo','indisponivel');
select pg_temp.pq_negar(306,4,'em_cotacao',60,'novo','indisponivel');
select pg_temp.pq_negar(313,8,'em_cotacao',60,'novo','indisponivel');
select pg_temp.pq_negar(313,1,'em_cotacao',1000000001,'novo','invalido');
select pg_temp.pq_negar(313,1,'em_cotacao','NaN'::numeric,'novo','invalido');

-- Revogações e transferência se refletem imediatamente também no helper de detalhe.
do $$ declare r jsonb;
begin
  delete from public.usuario_unidades where user_id=pg_temp.pq_uuid(5) and unidade='pq_a';
  if (pg_temp.pq_quadro(5)->>'total')::integer<>1 then raise exception 'Extra revogada permaneceu no quadro.'; end if;
  perform pg_temp.pq_negar(307,5,'em_cotacao',60,'novo','indisponivel');
  insert into public.usuario_unidades(user_id,unidade) values(pg_temp.pq_uuid(5),'pq_a');
  update public.pecas_cotacoes set responsavel_id=pg_temp.pq_uuid(2) where id=pg_temp.pq_uuid(301);
  r:=pg_temp.pq_quadro(1);
  if exists(select 1 from jsonb_array_elements(r->'cotacoes')c where c->>'id'=pg_temp.pq_uuid(301)::text) then raise exception 'Antigo dono manteve cartão após transferência.'; end if;
  perform pg_temp.pq_negar(301,1,'aguardando_cliente',60,'em_cotacao','indisponivel');
  set local role service_role;
  if exists(select 1 from public.pecas_cotacoes_visiveis(pg_temp.pq_uuid(1)) where id=pg_temp.pq_uuid(301)) then raise exception 'Detalhe permite carteira antiga.'; end if;
  reset role;
end $$;

-- Terminal respeita a devolução de posse e exige motivo pelo domínio.
do $$ declare r jsonb;
begin
  set local role service_role;
  r:=public.pecas_assumir_atendimento(pg_temp.pq_uuid(314),pg_temp.pq_uuid(1),0);
  reset role;
  if r->>'ok' is distinct from 'true' then raise exception 'Fixture de slot ativo não assumiu: %.',r; end if;
  perform pg_temp.pq_negar(314,1,'perdido',60,'em_cotacao','devolva_conversa','{}','Cliente desistiu');
  set local role service_role;
  r:=public.pecas_devolver_atendimento(pg_temp.pq_uuid(314),pg_temp.pq_uuid(1),1);
  reset role;
  if r->>'ok' is distinct from 'true' then raise exception 'Não devolveu antes de encerrar: %.',r; end if;
  perform pg_temp.pq_negar(314,1,'perdido',60,'em_cotacao','transicao','{}',null);
  perform pg_temp.pq_ok(314,1,'perdido',60,'em_cotacao','{}','Cliente desistiu');
  perform pg_temp.pq_negar(314,1,'em_cotacao',70,'perdido','indisponivel');
end $$;

-- A auditoria de domínio é o histórico; sua falha real desfaz etapa, atribuição e posição.
alter table public.pecas_cotacoes_historico add constraint pq_falhar_historico
  check(cotacao_id<>'d1000000-0000-4000-8000-000000000313'::uuid) not valid;
do $$ declare antes jsonb; lancou boolean:=false; restricao text;
begin
  antes:=pg_temp.pq_estado();
  begin
    perform pg_temp.pq_mover(313,1,'em_cotacao',75,'novo');
  exception when check_violation then
    get stacked diagnostics restricao=constraint_name;
    if restricao<>'pq_falhar_historico' then raise; end if;
    lancou:=true;
  end;
  if not lancou then raise exception 'Constraint real de histórico não foi atingida.'; end if;
  if antes is distinct from pg_temp.pq_estado() then raise exception 'Falha do histórico deixou efeitos parciais.'; end if;
end $$;
alter table public.pecas_cotacoes_historico drop constraint pq_falhar_historico;

do $$ declare assinatura text; papel text;
begin
  foreach assinatura in array array['public.pecas_cotacoes_visiveis(uuid)','public.pecas_quadro(uuid)','public.pecas_mover_quadro(uuid,uuid,text,numeric,text,jsonb,text)'] loop
    foreach papel in array array['anon','authenticated'] loop
      if has_function_privilege(papel,assinatura,'execute') then raise exception 'Quadro/mover exposto a %: %.',papel,assinatura; end if;
    end loop;
    if not has_function_privilege('service_role',assinatura,'execute') then raise exception 'Servidor sem EXECUTE no quadro.'; end if;
    if exists(select 1 from pg_proc where oid=assinatura::regprocedure and (prosecdef or proconfig is null or not proconfig @> array['search_path=""'])) then raise exception 'Função quadro/mover privilegiada ou path aberto.'; end if;
  end loop;
end $$;

create function pg_temp.pq_verificar_reaplicacao() returns void language plpgsql as $$
declare r jsonb; antes jsonb;
begin
  antes:=pg_temp.pq_estado(); r:=pg_temp.pq_quadro(1);
  if r->>'ok' is distinct from 'true' then raise exception 'Quadro falhou após reaplicação.'; end if;
  if (select atualizado_em from public.pecas_cotacoes where id=pg_temp.pq_uuid(311)) is not null then raise exception 'Reaplicação fez backfill do cartão intocado.'; end if;
  if antes is distinct from pg_temp.pq_estado() then raise exception 'Quadro fez escrita após reaplicação.'; end if;
end $$;
rollback;
