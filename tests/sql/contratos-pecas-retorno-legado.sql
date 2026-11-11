-- CR-PEC-001: negócios encerrados voltam à recepção sem expor mensagens do módulo.
-- Módulos 0001/0002/0003/0005/0006; dados fictícios e RPC como service_role.
begin;
create function pg_temp.rl_uuid(n integer) returns uuid language sql immutable as $$
  select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.rl_estado() returns jsonb language sql as $$
  select jsonb_build_object(
    'notificacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.notificacoes t),
    'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t),
    'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
    'slots',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_canais t),
    'conversas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.conversas t),
    'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
    'vinculos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t),
    'cotacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes t),
    'oportunidades',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_oportunidades t));
$$;
create function pg_temp.rl_pedido(p_cliente integer,p_motivo text default 'Quero falar com um atendente',p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
  execute format('set local role %I',p_papel);
  r:=public.registrar_pedido_humano_modular(pg_temp.rl_uuid(p_cliente),p_motivo);
  reset role;
  return r;
exception when others then reset role; raise;
end $$;

insert into public.unidades(chave,nome,ativa) values
  ('rl_a','Retorno principal fictício',true),('rl_b','Retorno outra unidade',true),('rl_sem','Sem destinatários',true);
insert into auth.users(id) select pg_temp.rl_uuid(n) from generate_series(1,10)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.rl_uuid(1),'Responsável Peças','pecas','pecas','rl_a',true),
  (pg_temp.rl_uuid(2),'Responsável Vendas','vendedor','vendas','rl_a',true),
  (pg_temp.rl_uuid(3),'Recepção principal','recepcao','oficina','rl_a',true),
  (pg_temp.rl_uuid(4),'Recepção extra','atendente','oficina','rl_b',true),
  (pg_temp.rl_uuid(5),'Recepção fora','recepcao','oficina','rl_b',true),
  (pg_temp.rl_uuid(6),'Responsável inativo','pecas','pecas','rl_a',false),
  (pg_temp.rl_uuid(7),'Vendas inativo','vendedor','vendas','rl_a',false),
  (pg_temp.rl_uuid(8),'Gerente outro setor','gerente','oficina','rl_a',true),
  (pg_temp.rl_uuid(9),'Peças fora da unidade','pecas','pecas','rl_b',true),
  (pg_temp.rl_uuid(10),'Gerente Peças','gerente','pecas','rl_a',true);
insert into public.usuario_unidades(user_id,unidade) values(pg_temp.rl_uuid(4),'rl_a');
insert into public.clientes(id,telefone,nome,unidade_origem)
select pg_temp.rl_uuid(n),'55117000'||lpad(n::text,5,'0'),'Cliente retorno fictício '||n,'rl_a' from generate_series(101,112)n;
insert into public.conversas(id,cliente_id,unidade,status,nao_lidas)
select pg_temp.rl_uuid(n+100),pg_temp.rl_uuid(n),case when n=108 then 'rl_sem' else 'rl_a' end,'bot',7 from generate_series(101,112)n;
insert into public.pecas_cotacoes(id,cliente_id,unidade,responsavel_id,descricao,status)
select pg_temp.rl_uuid(n),pg_temp.rl_uuid(n-200),case when n=308 then 'rl_sem' else 'rl_a' end,
  case when n in (305,306,308) then pg_temp.rl_uuid(6) when n=307 then null when n=310 then pg_temp.rl_uuid(9)
    when n=311 then pg_temp.rl_uuid(8) else pg_temp.rl_uuid(1) end,
  'Cotação retorno fictícia '||n,case when n in (301,304,305) then 'entregue' else 'em_cotacao' end
from generate_series(301,311)n where n<>302;
insert into public.vendas_funis(id,unidade,chave,nome,ativo)
  values(pg_temp.rl_uuid(901),'rl_a','retorno_fixture','Retorno Vendas',true);
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values
  (pg_temp.rl_uuid(902),pg_temp.rl_uuid(901),'Aberta',1,'aberta'),(pg_temp.rl_uuid(903),pg_temp.rl_uuid(901),'Ganha',2,'ganho');
insert into public.vendas_oportunidades(id,unidade,cliente_id,funil_id,etapa_id,vendedor_id,fechado_em,criado_por) values
  (pg_temp.rl_uuid(702),'rl_a',pg_temp.rl_uuid(102),pg_temp.rl_uuid(901),pg_temp.rl_uuid(903),pg_temp.rl_uuid(2),'2026-11-10T10:00:00Z','fixture@example.invalid'),
  (pg_temp.rl_uuid(705),'rl_a',pg_temp.rl_uuid(105),pg_temp.rl_uuid(901),pg_temp.rl_uuid(902),pg_temp.rl_uuid(2),null,'fixture@example.invalid'),
  (pg_temp.rl_uuid(709),'rl_a',pg_temp.rl_uuid(109),pg_temp.rl_uuid(901),pg_temp.rl_uuid(902),pg_temp.rl_uuid(2),null,'fixture@example.invalid');
insert into public.atendimentos_modulares(id,setor,cotacao_id,conversa_id,cliente_id,unidade,criado_por,assumido_por,dono_na_posse,versao)
select pg_temp.rl_uuid(n+100),'pecas',pg_temp.rl_uuid(n),pg_temp.rl_uuid(n-100),pg_temp.rl_uuid(n-200),
  case when n=308 then 'rl_sem' else 'rl_a' end,pg_temp.rl_uuid(1),
  case when n=304 then pg_temp.rl_uuid(1) else null end,case when n=304 then pg_temp.rl_uuid(1) else null end,
  case when n=304 then 1 else 0 end
from generate_series(301,311)n where n<>302;
insert into public.atendimentos_modulares(id,setor,oportunidade_id,conversa_id,cliente_id,unidade,criado_por) values
  (pg_temp.rl_uuid(412),'vendas',pg_temp.rl_uuid(702),pg_temp.rl_uuid(202),pg_temp.rl_uuid(102),'rl_a',pg_temp.rl_uuid(2)),
  (pg_temp.rl_uuid(415),'vendas',pg_temp.rl_uuid(705),pg_temp.rl_uuid(205),pg_temp.rl_uuid(105),'rl_a',pg_temp.rl_uuid(2)),
  (pg_temp.rl_uuid(419),'vendas',pg_temp.rl_uuid(709),pg_temp.rl_uuid(209),pg_temp.rl_uuid(109),'rl_a',pg_temp.rl_uuid(2));
-- A fixture representa reserva que sobreviveu a um fechamento externo anterior.
-- As FKs ficam ligadas; não chama uma transição que o piloto corretamente proíbe.
insert into public.atendimento_canais(conversa_id,atendimento_id) values(pg_temp.rl_uuid(204),pg_temp.rl_uuid(404));

-- Histórico de Peças associado das duas formas permanece armazenado e nunca vai ao legado.
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo,atendimento_id) values
  (pg_temp.rl_uuid(501),pg_temp.rl_uuid(201),pg_temp.rl_uuid(101),'entrada','cliente','wamid.rl.inicial','Histórico inicial Peças',null),
  (pg_temp.rl_uuid(502),pg_temp.rl_uuid(201),pg_temp.rl_uuid(101),'saida','atendente','wamid.rl.saida','Histórico explícito Peças',pg_temp.rl_uuid(401)),
  (pg_temp.rl_uuid(511),pg_temp.rl_uuid(202),pg_temp.rl_uuid(102),'entrada','cliente','wamid.rl.inicial-vendas','Histórico inicial Vendas',null),
  (pg_temp.rl_uuid(512),pg_temp.rl_uuid(202),pg_temp.rl_uuid(102),'saida','atendente','wamid.rl.vendas','Histórico explícito Vendas',pg_temp.rl_uuid(412));
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino,cotacao_id)
  values('wamid.rl.inicial',pg_temp.rl_uuid(201),pg_temp.rl_uuid(101),'rl_a','pecas',pg_temp.rl_uuid(301));
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,cotacao_id,conversa_id,cliente_id,unidade,criado_por)
  values(pg_temp.rl_uuid(501),pg_temp.rl_uuid(401),'wamid.rl.inicial',pg_temp.rl_uuid(301),pg_temp.rl_uuid(201),pg_temp.rl_uuid(101),'rl_a',pg_temp.rl_uuid(1));
insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
  values('wamid.rl.inicial-vendas',pg_temp.rl_uuid(511),pg_temp.rl_uuid(202),pg_temp.rl_uuid(102),'rl_a',pg_temp.rl_uuid(702),pg_temp.rl_uuid(901),true);
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,setor,oportunidade_id,conversa_id,cliente_id,unidade,criado_por)
  values(pg_temp.rl_uuid(511),pg_temp.rl_uuid(412),'wamid.rl.inicial-vendas','vendas',pg_temp.rl_uuid(702),pg_temp.rl_uuid(202),pg_temp.rl_uuid(102),'rl_a',pg_temp.rl_uuid(2));

do $$ declare ids uuid[]; antes jsonb;
begin
  antes:=pg_temp.rl_estado();
  set local role service_role;
  select array_agg(id order by id) into ids from public.atendimentos_modulares_ativos;
  if pg_temp.rl_uuid(401)=any(ids) or pg_temp.rl_uuid(412)=any(ids) then raise exception 'Negócio encerrado sem reserva continua ativo.'; end if;
  if not(pg_temp.rl_uuid(403)=any(ids)) or not(pg_temp.rl_uuid(404)=any(ids))
    or not(pg_temp.rl_uuid(415)=any(ids)) or not(pg_temp.rl_uuid(419)=any(ids)) then raise exception 'Ativo sem reserva/fechado reservado/misto/Vendas sumiu.'; end if;
  if not exists(select 1 from public.conversas_legadas where id=pg_temp.rl_uuid(201))
    or not exists(select 1 from public.conversas_legadas where id=pg_temp.rl_uuid(202)) then raise exception 'Encerrados Peças/Vendas não voltaram à recepção.'; end if;
  if exists(select 1 from public.conversas_legadas where id in (pg_temp.rl_uuid(203),pg_temp.rl_uuid(204),pg_temp.rl_uuid(205),pg_temp.rl_uuid(209))) then raise exception 'Canal ativo/reservado/misto vazou ao legado.'; end if;
  if exists(select 1 from public.mensagens_legadas where id in (pg_temp.rl_uuid(501),pg_temp.rl_uuid(502),pg_temp.rl_uuid(511),pg_temp.rl_uuid(512))) then raise exception 'Histórico associado de outro setor vazou após encerramento.'; end if;
  reset role;
  if antes is distinct from pg_temp.rl_estado() then raise exception 'Views de retorno alteraram dados.'; end if;
end $$;

do $$ declare etapa text; bloqueou boolean:=false;
begin
  foreach etapa in array array['novo','em_cotacao','aguardando_cliente','aprovado','em_separacao'] loop
    update public.pecas_cotacoes set status=etapa where id=pg_temp.rl_uuid(303);
    if not exists(select 1 from public.atendimentos_modulares_ativos where id=pg_temp.rl_uuid(403)) then raise exception 'Etapa aberta % deixou de bloquear o legado.',etapa; end if;
  end loop;
  update public.pecas_cotacoes set status='em_cotacao' where id=pg_temp.rl_uuid(303);
  foreach etapa in array array['entregue','perdido','cancelado'] loop
    update public.pecas_cotacoes set status=etapa,motivo_encerramento=case when etapa='entregue' then null else 'Fixture encerrada' end where id=pg_temp.rl_uuid(301);
    if exists(select 1 from public.atendimentos_modulares_ativos where id=pg_temp.rl_uuid(401)) then raise exception 'Etapa terminal % reteve o legado sem reserva.',etapa; end if;
  end loop;
  update public.pecas_cotacoes set status='entregue',motivo_encerramento=null where id=pg_temp.rl_uuid(301);
  update public.vendas_funis set ativo=false where id=pg_temp.rl_uuid(901);
  if not exists(select 1 from public.atendimentos_modulares_ativos where id=pg_temp.rl_uuid(419)) then raise exception 'Funil inativo apagou oportunidade ainda aberta.'; end if;
  update public.vendas_funis set ativo=true where id=pg_temp.rl_uuid(901);
  begin
    set local role service_role;
    update public.conversas set status='humano',assumida_por='recepcao@example.invalid' where id=pg_temp.rl_uuid(204);
    reset role;
  exception when sqlstate '55000' then reset role; bloqueou:=true;
  end;
  if not bloqueou then raise exception 'Domínio fechado com reserva permitiu roubo de posse legada.'; end if;
end $$;

-- Entradas novas da recepção não são vinculadas retroativamente ao módulo encerrado.
do $$
begin
  set local role service_role;
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo) values
    (pg_temp.rl_uuid(503),pg_temp.rl_uuid(201),pg_temp.rl_uuid(101),'entrada','cliente','wamid.rl.nova-recepcao','Novo assunto da recepção'),
    (pg_temp.rl_uuid(513),pg_temp.rl_uuid(202),pg_temp.rl_uuid(102),'entrada','cliente','wamid.rl.nova-vendas-fechada','Novo assunto depois de Vendas');
  if not exists(select 1 from public.mensagens_legadas where id=pg_temp.rl_uuid(503))
    or not exists(select 1 from public.mensagens_legadas where id=pg_temp.rl_uuid(513)) then raise exception 'Novo atendimento da recepção ficou invisível.'; end if;
  update public.conversas set status='humano',assumida_por='recepcao@example.invalid' where id in (pg_temp.rl_uuid(201),pg_temp.rl_uuid(202));
  reset role;
  if exists(select 1 from public.mensagens where id in (pg_temp.rl_uuid(503),pg_temp.rl_uuid(513)) and atendimento_id is not null)
    or (select count(*) from public.mensagens where id in (pg_temp.rl_uuid(501),pg_temp.rl_uuid(502),pg_temp.rl_uuid(511),pg_temp.rl_uuid(512)))<>4 then
    raise exception 'Novo handoff reclassificou/apagou histórico do módulo.';
  end if;
end $$;

create function pg_temp.rl_avisar(p_cliente integer,p_esperados uuid[])
returns void language plpgsql as $$
declare antes jsonb; ids uuid[]; recebidos uuid[]; r jsonb; auditorias integer; marca text:='MOTIVO_BRUTO_FIXTURE_NAO_COPIAR';
begin
  antes:=pg_temp.rl_estado();
  select coalesce(array_agg(id),array[]::uuid[]) into ids from public.notificacoes;
  select count(*) into auditorias from public.audit_log;
  r:=pg_temp.rl_pedido(p_cliente,marca);
  if r is distinct from jsonb_build_object('ok',true,'destinatarios',cardinality(p_esperados)) then raise exception 'Aviso deveria alcançar %, recebeu %.',p_esperados,r; end if;
  select array_agg(usuario_id order by usuario_id) into recebidos from public.notificacoes where not(id=any(ids));
  if recebidos is distinct from p_esperados then raise exception 'Destinatários indevidos: esperado%, recebeu%.',p_esperados,recebidos; end if;
  if (select count(*) from public.audit_log)<>auditorias+1 then raise exception 'Aviso não auditou exatamente uma operação.'; end if;
  if (antes-array['notificacoes','audit']) is distinct from (pg_temp.rl_estado()-array['notificacoes','audit']) then raise exception 'Aviso alterou canal, posse, mensagens ou domínio.'; end if;
  if exists(select 1 from public.notificacoes where not(id=any(ids)) and
    (titulo like '%'||marca||'%' or corpo like '%'||marca||'%' or titulo like '%Cliente retorno fictício%' or corpo like '%Cliente retorno fictício%'))
    or (select jsonb_agg(to_jsonb(t))::text from public.audit_log t) like '%'||marca||'%' then raise exception 'Aviso/auditoria copiou motivo ou cliente bruto.'; end if;
end $$;
create function pg_temp.rl_negar(p_cliente integer,p_codigo text,p_motivo text default 'Quero falar com um atendente',p_auditar boolean default false)
returns void language plpgsql as $$
declare antes jsonb; r jsonb; quantidade integer;
begin
  antes:=pg_temp.rl_estado(); select count(*) into quantidade from public.audit_log;
  r:=pg_temp.rl_pedido(p_cliente,p_motivo);
  if r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo) then raise exception 'Pedido deveria recusar com %, recebeu%.',p_codigo,r; end if;
  if p_auditar then
    if (select count(*) from public.audit_log)<>quantidade+1 or (antes-'audit') is distinct from (pg_temp.rl_estado()-'audit')
      or not exists(select 1 from public.audit_log where acao='pedido_humano_modular_sem_destinatario' and entidade_id=pg_temp.rl_uuid(p_cliente+100)::text) then raise exception 'Sem destinatário deixou efeitos além da auditoria esperada.'; end if;
  elsif antes is distinct from pg_temp.rl_estado() then raise exception 'Pedido recusado escreveu dados.';
  end if;
end $$;
create function pg_temp.rl_falha_real(p_cliente integer,p_constraint text)
returns void language plpgsql as $$
declare antes jsonb; lancou boolean:=false; restricao text;
begin
  antes:=pg_temp.rl_estado();
  begin
    perform pg_temp.rl_pedido(p_cliente);
  exception when check_violation then
    get stacked diagnostics restricao=constraint_name;
    if restricao is distinct from p_constraint then raise; end if;
    lancou:=true;
  end;
  if not lancou then raise exception 'Constraint real % não foi atingida.',p_constraint; end if;
  if antes is distinct from pg_temp.rl_estado() then raise exception 'Falha deixou avisos/auditoria parciais ou alterou a posse.'; end if;
end $$;

-- Sem atividade modular, o chamador segue o handoff legado de Peças/Vendas encerrados.
select pg_temp.rl_negar(101,'legado');
select pg_temp.rl_negar(102,'legado');
select pg_temp.rl_negar(112,'legado');
select pg_temp.rl_negar(999,'nao_encontrado');
select pg_temp.rl_negar(null,'invalido');
select pg_temp.rl_negar(103,'invalido','   ');
select pg_temp.rl_negar(103,'invalido',repeat('a',301));

-- Dono atual ativo, sem slot, recebe o pedido; nenhum canal é assumido/pausado pelo RPC.
select pg_temp.rl_avisar(103,array[pg_temp.rl_uuid(1)]);
select pg_temp.rl_avisar(105,array[pg_temp.rl_uuid(2)]); -- Peças fechada não recebe o pedido da Vendas aberta.
select pg_temp.rl_avisar(109,array[pg_temp.rl_uuid(1),pg_temp.rl_uuid(2)]); -- ambos setores abertos sem reserva

-- Com reserva, somente seu atendimento recebe; claimant elegível precede dono.
update public.atendimentos_modulares set assumido_por=pg_temp.rl_uuid(10) where id=pg_temp.rl_uuid(404);
select pg_temp.rl_avisar(104,array[pg_temp.rl_uuid(10)]);
update public.usuarios set ativo=false where user_id=pg_temp.rl_uuid(10);
select pg_temp.rl_avisar(104,array[pg_temp.rl_uuid(1)]);
update public.usuarios set ativo=true where user_id=pg_temp.rl_uuid(10);
update public.atendimentos_modulares set assumido_por=pg_temp.rl_uuid(2),dono_na_posse=pg_temp.rl_uuid(2),versao=1 where id=pg_temp.rl_uuid(419);
insert into public.atendimento_canais(conversa_id,atendimento_id) values(pg_temp.rl_uuid(209),pg_temp.rl_uuid(419));
select pg_temp.rl_avisar(109,array[pg_temp.rl_uuid(2)]);
delete from public.atendimento_canais where conversa_id=pg_temp.rl_uuid(209);

-- Fallback restrito à unidade atual e a recepção/gestão elegível do setor.
select pg_temp.rl_avisar(106,array[pg_temp.rl_uuid(3),pg_temp.rl_uuid(4),pg_temp.rl_uuid(10)]);
select pg_temp.rl_avisar(107,array[pg_temp.rl_uuid(3),pg_temp.rl_uuid(4),pg_temp.rl_uuid(10)]);
select pg_temp.rl_avisar(110,array[pg_temp.rl_uuid(3),pg_temp.rl_uuid(4),pg_temp.rl_uuid(10)]);
select pg_temp.rl_avisar(111,array[pg_temp.rl_uuid(3),pg_temp.rl_uuid(4),pg_temp.rl_uuid(10)]);
delete from public.usuario_unidades where user_id=pg_temp.rl_uuid(4) and unidade='rl_a';
select pg_temp.rl_avisar(107,array[pg_temp.rl_uuid(3),pg_temp.rl_uuid(10)]);
insert into public.usuario_unidades(user_id,unidade) values(pg_temp.rl_uuid(4),'rl_a');
select pg_temp.rl_negar(108,'sem_destinatario','Solicitação sem equipe',true);

-- Notificação e auditoria falham de verdade e desfazem inclusive destinatários anteriores.
alter table public.notificacoes add constraint rl_falhar_aviso check(usuario_id<>'e1000000-0000-4000-8000-000000000004'::uuid) not valid;
select pg_temp.rl_falha_real(107,'rl_falhar_aviso');
alter table public.notificacoes drop constraint rl_falhar_aviso;
alter table public.audit_log add constraint rl_falhar_audit check(acao<>'pedido_humano_modular') not valid;
select pg_temp.rl_falha_real(103,'rl_falhar_audit');
alter table public.audit_log drop constraint rl_falhar_audit;

-- Link da recepção fallback não abre uma conversa de outro setor por ID conhecido.
do $$ declare nome text; papel text; lancou boolean:=false;
begin
  if exists(select 1 from public.notificacoes where usuario_id in (pg_temp.rl_uuid(3),pg_temp.rl_uuid(4)) and link is not null)
    or not exists(select 1 from public.notificacoes where usuario_id=pg_temp.rl_uuid(2) and link='/painel/vendas?op='||pg_temp.rl_uuid(705)::text) then raise exception 'Links de fallback/setor não respeitaram o contexto.'; end if;
  foreach nome in array array['atendimentos_modulares_ativos','conversas_legadas','mensagens_legadas'] loop
    foreach papel in array array['anon','authenticated'] loop
      if has_table_privilege(papel,'public.'||nome,'select') then raise exception 'View exposta ao navegador: %.',nome; end if;
    end loop;
    if not has_table_privilege('service_role','public.'||nome,'select') then raise exception 'Servidor sem SELECT na view %.',nome; end if;
    if not exists(select 1 from pg_class where oid=('public.'||nome)::regclass and reloptions @> array['security_invoker=true','security_barrier=true']) then raise exception 'View privilegiada: %.',nome; end if;
  end loop;
  foreach papel in array array['anon','authenticated'] loop
    if has_function_privilege(papel,'public.registrar_pedido_humano_modular(uuid,text)','execute') then raise exception 'RPC exposto a %.',papel; end if;
  end loop;
  if exists(select 1 from pg_proc where oid='public.registrar_pedido_humano_modular(uuid,text)'::regprocedure
    and (prosecdef or proconfig is null or not proconfig @> array['search_path=""'])) then raise exception 'RPC privilegiado ou search_path aberto.'; end if;
  if exists(select 1 from pg_class where oid in ('public.atendimentos_modulares'::regclass,'public.atendimento_canais'::regclass,'public.mensagens'::regclass) and not relrowsecurity) then raise exception 'RLS foi desligado.'; end if;
  begin
    perform pg_temp.rl_pedido(103,'Motivo','anon');
  exception when insufficient_privilege then lancou:=true;
  end;
  if not lancou then raise exception 'Navegador chamou RPC interno.'; end if;
end $$;

create function pg_temp.rl_verificar_reaplicacao() returns void language plpgsql as $$
declare antes jsonb;
begin
  antes:=pg_temp.rl_estado();
  set local role service_role;
  if exists(select 1 from public.mensagens_legadas where id in (pg_temp.rl_uuid(501),pg_temp.rl_uuid(502),pg_temp.rl_uuid(511),pg_temp.rl_uuid(512)))
    or not exists(select 1 from public.mensagens_legadas where id=pg_temp.rl_uuid(503)) then raise exception 'Reaplicação reabriu histórico setorial.'; end if;
  reset role;
  if antes is distinct from pg_temp.rl_estado() then raise exception 'Leitura depois da reaplicação escreveu.'; end if;
end $$;
rollback;
