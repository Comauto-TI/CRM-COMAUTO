-- Banco descartável: 0001/0002/0003/0005/0006. RPCs executam como service_role.
-- Sem grants corretivos, credenciais ou dados reais. Não prova concorrência multissessão.
begin;

create function pg_temp.pm_uuid(n integer) returns uuid language sql immutable as $$
  select ('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.pm_estado() returns jsonb language sql as $$
  select jsonb_build_object(
    'cotacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes t),
    'historico',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes_historico t),
    'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
    'slots',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_canais t),
    'vinculos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t),
    'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
    'conversas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.conversas t),
    'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t));
$$;
create function pg_temp.pm_rpc(p_acao text,p_cotacao uuid,p_ator uuid,p_versao integer default 0,
  p_mensagem uuid default null,p_texto text default 'Resposta fictícia',p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
  execute format('set local role %I',p_papel);
  if current_user<>p_papel then raise exception 'Papel não mudou.'; end if;
  case p_acao
    when 'assumir' then r:=public.pecas_assumir_atendimento(p_cotacao,p_ator,p_versao);
    when 'devolver' then r:=public.pecas_devolver_atendimento(p_cotacao,p_ator,p_versao);
    when 'dialogo' then r:=public.pecas_dialogo(p_cotacao,p_ator);
    when 'reservar' then r:=public.pecas_reservar_resposta(p_cotacao,p_ator,p_versao,p_mensagem,p_texto);
    when 'autorizar' then r:=public.pecas_autorizar_resposta(p_cotacao,p_ator,p_versao,p_mensagem);
    else raise exception 'Operação inválida na fixture.';
  end case;
  reset role;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.pm_ok(p_acao text,p_cotacao uuid,p_ator uuid,p_versao integer default 0,
  p_mensagem uuid default null,p_texto text default 'Resposta fictícia')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r:=pg_temp.pm_rpc(p_acao,p_cotacao,p_ator,p_versao,p_mensagem,p_texto);
  if r->>'ok' is distinct from 'true' then raise exception '% recusou o caso positivo: %.',p_acao,r; end if;
  return r;
end $$;
create function pg_temp.pm_negar(p_acao text,p_cotacao uuid,p_ator uuid,p_versao integer default 0,
  p_mensagem uuid default null,p_texto text default 'Resposta fictícia',p_codigo text default 'nao_encontrado')
returns void language plpgsql as $$
declare antes jsonb; r jsonb;
begin
  antes:=pg_temp.pm_estado();
  r:=pg_temp.pm_rpc(p_acao,p_cotacao,p_ator,p_versao,p_mensagem,p_texto);
  if r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo) then
    raise exception '% deveria recusar com %, recebeu %.',p_acao,p_codigo,r;
  end if;
  if antes is distinct from pg_temp.pm_estado() then raise exception '% recusou com efeitos parciais.',p_acao; end if;
end $$;
create function pg_temp.pm_erro(p_sql text,p_codigo text,p_constraint text default null,p_papel text default 'service_role')
returns void language plpgsql as $$
declare antes jsonb; estado text; restricao text; lancou boolean:=false;
begin
  antes:=pg_temp.pm_estado();
  begin
    execute format('set local role %I',p_papel);
    execute p_sql;
    reset role;
  exception when others then
    reset role;
    get stacked diagnostics estado=returned_sqlstate,restricao=constraint_name;
    if estado is distinct from p_codigo or (p_constraint is not null and restricao is distinct from p_constraint) then raise; end if;
    lancou:=true;
  end;
  if not lancou then raise exception 'Erro SQL % / constraint % não foi atingido.',p_codigo,p_constraint; end if;
  if antes is distinct from pg_temp.pm_estado() then raise exception 'Erro SQL deixou efeitos parciais.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values
  ('pm_a','Piloto principal fictício',true),('pm_b','Piloto outra unidade',true),('pm_inativa','Piloto inativo',false);
insert into auth.users(id) select pg_temp.pm_uuid(n) from generate_series(1,10)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.pm_uuid(1),'Peças A','pecas','pecas','pm_a',true),
  (pg_temp.pm_uuid(2),'Peças B','pecas','pecas','pm_a',true),
  (pg_temp.pm_uuid(3),'Gerente Peças','gerente','pecas','pm_a',true),
  (pg_temp.pm_uuid(4),'Administrador global','admin','administracao','pm_b',true),
  (pg_temp.pm_uuid(5),'Peças extra','pecas','pecas','pm_b',true),
  (pg_temp.pm_uuid(6),'Peças outra unidade','pecas','pecas','pm_b',true),
  (pg_temp.pm_uuid(7),'Vendedor','vendedor','vendas','pm_a',true),
  (pg_temp.pm_uuid(8),'Peças inativo','pecas','pecas','pm_a',false),
  (pg_temp.pm_uuid(9),'Gerente Oficina','gerente','oficina','pm_a',true),
  (pg_temp.pm_uuid(10),'Gerente Administração','gerente','administracao','pm_b',true);
insert into public.usuario_unidades(user_id,unidade) values(pg_temp.pm_uuid(5),'pm_a'),(pg_temp.pm_uuid(10),'pm_a');
insert into public.clientes(id,telefone,nome,unidade_origem,ultimo_contato_em,anonimizado)
select pg_temp.pm_uuid(n),'55119000'||lpad(n::text,5,'0'),'Cliente piloto fictício '||n,'pm_a',now(),n=109
from generate_series(101,119)n;
insert into public.conversas(id,cliente_id,unidade,status,assumida_por,nao_lidas)
select pg_temp.pm_uuid(n+100),pg_temp.pm_uuid(n),'pm_a',case when n=103 then 'humano' else 'bot' end,
  case when n=103 then 'legado@example.invalid' else null end,7
from generate_series(101,119)n where n<>111;
insert into public.pecas_cotacoes(id,cliente_id,unidade,responsavel_id,descricao,status)
select pg_temp.pm_uuid(n),pg_temp.pm_uuid(n-200),case when n=317 then 'pm_inativa' else 'pm_a' end,
  case when n in (301,302,303,304,305,311,312,315,316,317) then null when n=308 then pg_temp.pm_uuid(5) else pg_temp.pm_uuid(1) end,
  'Cotação piloto fictícia '||n,'novo'
from generate_series(301,319)n;
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo,criado_em) values
  (pg_temp.pm_uuid(401),pg_temp.pm_uuid(201),pg_temp.pm_uuid(101),'entrada','cliente','wamid.pm.inicial','Pedido inicial comprovado','2026-11-11T10:00:00Z'),
  (pg_temp.pm_uuid(402),pg_temp.pm_uuid(201),pg_temp.pm_uuid(101),'entrada','cliente','wamid.pm.antes','Histórico anterior sem proveniência','2026-11-11T09:59:00Z');

-- Fonte inicial real: o encaminhamento transacional cria uma cotação sem responsável.
do $$ declare r jsonb;
begin
  set local role service_role;
  r:=public.encaminhar_lead_bot(pg_temp.pm_uuid(201),pg_temp.pm_uuid(101),'wamid.pm.inicial','pecas','Preciso de peças');
  reset role;
  if r->>'ok' is distinct from 'true' then raise exception 'Encaminhamento inicial real falhou: %.',r; end if;
end $$;
create function pg_temp.pm_principal() returns uuid language sql as $$
  select cotacao_id from public.encaminhamentos_bot where referencia='wamid.pm.inicial';
$$;

do $$
declare r jsonb; repetida jsonb; antes jsonb; ticket uuid; principal uuid:=pg_temp.pm_principal();
begin
  perform pg_temp.pm_negar('dialogo',principal,pg_temp.pm_uuid(1),0,null,'Resposta fictícia','sem_responsavel');
  r:=pg_temp.pm_ok('assumir',principal,pg_temp.pm_uuid(1)); ticket:=(r->>'id')::uuid;
  if r is distinct from jsonb_build_object('ok',true,'id',ticket,'cotacaoId',principal,'versao',1,'estado','minha') then raise exception 'DTO assumir incorreto: %.',r; end if;
  if not exists(select 1 from public.pecas_cotacoes where id=principal and responsavel_id=pg_temp.pm_uuid(1) and status='em_cotacao')
    or not exists(select 1 from public.atendimento_canais where conversa_id=pg_temp.pm_uuid(201) and atendimento_id=ticket)
    or not exists(select 1 from public.conversas where id=pg_temp.pm_uuid(201) and status='humano' and assumida_por is null)
    or not exists(select 1 from public.atendimento_mensagens where atendimento_id=ticket and mensagem_id=pg_temp.pm_uuid(401)) then
    raise exception 'Assumir não atomizou atribuição/abertura/pausa/vínculo/claim.';
  end if;
  antes:=pg_temp.pm_estado(); repetida:=pg_temp.pm_ok('assumir',principal,pg_temp.pm_uuid(1),1);
  if r is distinct from repetida or antes is distinct from pg_temp.pm_estado() then raise exception 'Replay assumir gerou efeitos.'; end if;
  r:=pg_temp.pm_ok('dialogo',principal,pg_temp.pm_uuid(1));
  if jsonb_array_length(r->'mensagens')<>1 or r#>>'{mensagens,0,id}'<>pg_temp.pm_uuid(401)::text then raise exception 'Histórico anterior foi importado: %.',r; end if;
  -- Inserção de webhook como servidor: somente depois da posse ganha vínculo.
  set local role service_role;
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,tipo,wamid,conteudo)
    values(pg_temp.pm_uuid(403),pg_temp.pm_uuid(201),pg_temp.pm_uuid(101),'entrada','cliente','text','wamid.pm.ativa','Mensagem após assumir');
  reset role;
  if (select atendimento_id from public.mensagens where id=pg_temp.pm_uuid(403)) is distinct from ticket then raise exception 'Entrada ativa não foi vinculada.'; end if;
  r:=pg_temp.pm_ok('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(451),'Olá, temos essa peça');
  if r->>'despachar' is distinct from 'true' then raise exception 'Reserva inicial não permite despacho: %.',r; end if;
  if not exists(select 1 from public.mensagens where id=pg_temp.pm_uuid(451) and atendimento_id=ticket and status='bloqueada'
    and erro='envio_em_processamento' and metadata->>'estagio'='reservado') then raise exception 'Reserva não foi persistida corretamente.'; end if;
end $$;

-- Recusas são comparadas contra todas as tabelas de efeitos do piloto.
do $$
declare r jsonb; antes jsonb; ator integer; principal uuid:=pg_temp.pm_principal();
begin
  perform pg_temp.pm_negar('assumir',pg_temp.pm_uuid(301),pg_temp.pm_uuid(1),0,null,'Resposta fictícia','conflito'); -- outro negócio no mesmo canal
  perform pg_temp.pm_negar('assumir',pg_temp.pm_uuid(303),pg_temp.pm_uuid(1),0,null,'Resposta fictícia','conflito'); -- posse legada
  perform pg_temp.pm_negar('assumir',pg_temp.pm_uuid(302),pg_temp.pm_uuid(1),1,null,'Resposta fictícia','conflito'); -- versão sem ticket
  perform pg_temp.pm_negar('assumir',principal,pg_temp.pm_uuid(1),0,null,'Resposta fictícia','conflito');
  perform pg_temp.pm_negar('devolver',principal,pg_temp.pm_uuid(1),0,null,'Resposta fictícia','conflito');
  foreach ator in array array[3,4,10] loop
    perform pg_temp.pm_negar('assumir',principal,pg_temp.pm_uuid(ator),1);
  end loop;
  foreach ator in array array[2,6,7,8,9] loop
    perform pg_temp.pm_negar('dialogo',principal,pg_temp.pm_uuid(ator));
  end loop;
  foreach ator in array array[6,7,8,9] loop
    perform pg_temp.pm_negar('assumir',pg_temp.pm_uuid(312),pg_temp.pm_uuid(ator));
  end loop;
  perform pg_temp.pm_negar('assumir',pg_temp.pm_uuid(309),pg_temp.pm_uuid(1)); -- anonimizado
  perform pg_temp.pm_negar('assumir',pg_temp.pm_uuid(317),pg_temp.pm_uuid(4)); -- admin não abre unidade inativa
  perform pg_temp.pm_negar('assumir',null,pg_temp.pm_uuid(1),0,null,'Resposta fictícia','invalido');
  perform pg_temp.pm_negar('assumir',pg_temp.pm_uuid(302),pg_temp.pm_uuid(1),-1,null,'Resposta fictícia','invalido');
  antes:=pg_temp.pm_estado();
  r:=pg_temp.pm_ok('dialogo',pg_temp.pm_uuid(313),pg_temp.pm_uuid(1));
  if r->'id'<>'null'::jsonb or r->>'versao'<>'0' or r->'mensagens'<>'[]'::jsonb or r->>'estado'<>'livre' or r->>'podeAssumir'<>'true' then raise exception 'Diálogo sem ticket incorreto: %.',r; end if;
  r:=pg_temp.pm_ok('dialogo',pg_temp.pm_uuid(313),pg_temp.pm_uuid(3));
  if r->>'podeAssumir'<>'false' then raise exception 'Gestor recebeu podeAssumir sobre carteira de outro.'; end if;
  if antes is distinct from pg_temp.pm_estado() then raise exception 'Diálogo sem ticket criou dados.'; end if;
  perform pg_temp.pm_ok('dialogo',principal,pg_temp.pm_uuid(3));
  perform pg_temp.pm_ok('dialogo',principal,pg_temp.pm_uuid(4));
  perform pg_temp.pm_ok('dialogo',principal,pg_temp.pm_uuid(10));
end $$;

-- Replay da reserva, CAS do despacho e confirmação persistida.
do $$
declare r jsonb; antes jsonb; principal uuid:=pg_temp.pm_principal();
begin
  antes:=pg_temp.pm_estado();
  r:=pg_temp.pm_ok('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(451),'Olá, temos essa peça');
  if r->>'despachar'<>'true' or antes is distinct from pg_temp.pm_estado() then raise exception 'Replay da reserva duplicou mensagem.'; end if;
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(451),'Outro conteúdo','conflito');
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(3),1,pg_temp.pm_uuid(451),'Olá, temos essa peça','conflito');
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(2),1,pg_temp.pm_uuid(451),'Olá, temos essa peça');
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(401),'Pedido inicial comprovado','conflito');
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(1),1,null,'Texto','invalido');
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(453),' ','invalido');
  perform pg_temp.pm_ok('autorizar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(451));
  if (select metadata->>'estagio' from public.mensagens where id=pg_temp.pm_uuid(451))<>'despachando' then raise exception 'Preflight não avançou CAS.'; end if;
  perform pg_temp.pm_negar('autorizar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(451),'Resposta fictícia','conflito');
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(451),'Olá, temos essa peça','envio_incerto');
  set local role service_role;
  update public.mensagens set status='enviada',wamid='wamid.pm.saida.confirmada',erro=null
    where id=pg_temp.pm_uuid(451) and atendimento_id=(select id from public.atendimentos_modulares where cotacao_id=principal)
      and cliente_id=pg_temp.pm_uuid(101) and conversa_id=pg_temp.pm_uuid(201)
      and direcao='saida' and autor='atendente' and status='bloqueada' and erro='envio_em_processamento';
  reset role;
  if not exists(select 1 from public.mensagens where id=pg_temp.pm_uuid(451) and status='enviada' and wamid='wamid.pm.saida.confirmada') then raise exception 'Servidor não persistiu confirmação do transporte.'; end if;
  antes:=pg_temp.pm_estado();
  r:=pg_temp.pm_ok('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(451),'Olá, temos essa peça');
  if r->>'despachar'<>'false' or antes is distinct from pg_temp.pm_estado() then raise exception 'Replay de mensagem enviada despacharia novamente: %.',r; end if;
  perform pg_temp.pm_ok('reservar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(452),'Resposta aguardando nova verificação');
  update public.usuarios set ativo=false where user_id=pg_temp.pm_uuid(1);
  perform pg_temp.pm_negar('autorizar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(452));
  update public.usuarios set ativo=true,papel='consultor_tecnico',setor='oficina' where user_id=pg_temp.pm_uuid(1);
  perform pg_temp.pm_negar('autorizar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(452));
  update public.usuarios set papel='pecas',setor='pecas' where user_id=pg_temp.pm_uuid(1);
  update public.clientes set anonimizado=true where id=pg_temp.pm_uuid(101);
  perform pg_temp.pm_negar('autorizar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(452));
  update public.clientes set anonimizado=false where id=pg_temp.pm_uuid(101);
  update public.unidades set ativa=false where chave='pm_a';
  perform pg_temp.pm_negar('autorizar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(452));
  update public.unidades set ativa=true where chave='pm_a';
  if (select metadata->>'estagio' from public.mensagens where id=pg_temp.pm_uuid(452))<>'reservado' then raise exception 'Recusa de preflight consumiu reserva.'; end if;
end $$;

-- Novo diálogo é bidirecional, limitado aos100 recentes e devolvido em ordem crescente.
do $$
declare r jsonb; antes jsonb; principal uuid:=pg_temp.pm_principal(); ticket uuid;
begin
  select id into ticket from public.atendimentos_modulares where cotacao_id=principal;
  -- Datas artificiais são da fixture dona dos dados; a entrada403 já provou INSERT service.
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,tipo,wamid,conteudo,criado_em)
    select pg_temp.pm_uuid(n),pg_temp.pm_uuid(201),pg_temp.pm_uuid(101),'entrada','cliente','text','wamid.pm.volume.'||n,
      case when n=599 then null else 'Mensagem fictícia '||n end,now()-interval '1 minute'+n*interval '1 microsecond'
    from generate_series(500,604)n;
  antes:=pg_temp.pm_estado(); r:=pg_temp.pm_ok('dialogo',principal,pg_temp.pm_uuid(1));
  -- A saída452 pendente também está mais recente: exclui inicial+8 primeiras entradas.
  if jsonb_array_length(r->'mensagens')<>100 or r#>>'{mensagens,0,id}'<>pg_temp.pm_uuid(508)::text then
    raise exception 'Recorte dos100 recentes incorreto: %.',r->'mensagens';
  end if;
  if not exists(select 1 from jsonb_array_elements(r->'mensagens') m where m->>'id'=pg_temp.pm_uuid(451)::text and m->>'direcao'='saida' and m->>'conteudo'='Olá, temos essa peça')
    or not exists(select 1 from jsonb_array_elements(r->'mensagens') m where m->>'id'=pg_temp.pm_uuid(452)::text and m->>'pendente'='true')
    or not exists(select 1 from jsonb_array_elements(r->'mensagens') m where m->>'id'=pg_temp.pm_uuid(599)::text and m->'conteudo'='null'::jsonb) then
    raise exception 'Diálogo perdeu saída própria, pendência ou conteúdo NULL.';
  end if;
  if exists(select 1 from (
    select m,lag(m) over(order by ord) anterior from jsonb_array_elements(r->'mensagens') with ordinality a(m,ord)
  ) t where ((t.m->>'criadoEm')::timestamptz,(t.m->>'id')::uuid)<((t.anterior->>'criadoEm')::timestamptz,(t.anterior->>'id')::uuid)) then raise exception 'Diálogo não está cronológico.'; end if;
  if exists(select 1 from jsonb_array_elements(r->'mensagens') m,jsonb_object_keys(m) k
    where k not in ('id','conteudo','direcao','autor','tipo','status','criadoEm','pendente')) then raise exception 'Diálogo expôs campo fora do DTO mínimo.'; end if;
  if antes is distinct from pg_temp.pm_estado() then raise exception 'Diálogo alterou dados, posse ou contador.'; end if;
  if (select nao_lidas from public.conversas where id=pg_temp.pm_uuid(201))<>7 then raise exception 'Módulo zerou contador físico.'; end if;
end $$;

-- Travas reais com slotativo: não encerram/reatribuem nem deixam claim legado entrar.
select pg_temp.pm_erro(format('update public.pecas_cotacoes set status=''entregue'' where id=%L',pg_temp.pm_principal()),'55000');
select pg_temp.pm_erro(format('update public.pecas_cotacoes set responsavel_id=%L where id=%L',pg_temp.pm_uuid(2),pg_temp.pm_principal()),'55000');
select pg_temp.pm_erro(format('update public.conversas set status=''bot'' where id=%L',pg_temp.pm_uuid(201)),'55000');
select pg_temp.pm_erro(format('update public.conversas set assumida_por=''legado@example.invalid'' where id=%L',pg_temp.pm_uuid(201)),'55000');
update public.pecas_cotacoes set status='aguardando_cliente' where id=pg_temp.pm_principal();
select pg_temp.pm_erro(format('update public.mensagens set atendimento_id=null where id=%L',pg_temp.pm_uuid(403)),'23514',null,'postgres');

-- Unidade extra é revalidada no preflight; administrador global não depende da própria unidade.
do $$ declare r jsonb; ticket uuid;
begin
  r:=pg_temp.pm_ok('assumir',pg_temp.pm_uuid(308),pg_temp.pm_uuid(5)); ticket:=(r->>'id')::uuid;
  perform pg_temp.pm_ok('reservar',pg_temp.pm_uuid(308),pg_temp.pm_uuid(5),1,pg_temp.pm_uuid(458),'Resposta unidade extra');
  delete from public.usuario_unidades where user_id=pg_temp.pm_uuid(5) and unidade='pm_a';
  perform pg_temp.pm_negar('autorizar',pg_temp.pm_uuid(308),pg_temp.pm_uuid(5),1,pg_temp.pm_uuid(458));
  perform pg_temp.pm_negar('dialogo',pg_temp.pm_uuid(308),pg_temp.pm_uuid(5));
  insert into public.usuario_unidades(user_id,unidade) values(pg_temp.pm_uuid(5),'pm_a');
  perform pg_temp.pm_ok('devolver',pg_temp.pm_uuid(308),pg_temp.pm_uuid(5),1);
  r:=pg_temp.pm_ok('assumir',pg_temp.pm_uuid(316),pg_temp.pm_uuid(4));
  if not exists(select 1 from public.pecas_cotacoes where id=pg_temp.pm_uuid(316) and responsavel_id=pg_temp.pm_uuid(4)) then raise exception 'Admin global não assumiu unidade alheia.'; end if;
  perform pg_temp.pm_ok('devolver',pg_temp.pm_uuid(316),pg_temp.pm_uuid(4),1);
  perform pg_temp.pm_ok('assumir',pg_temp.pm_uuid(311),pg_temp.pm_uuid(1));
  if not exists(select 1 from public.conversas where cliente_id=pg_temp.pm_uuid(111) and status='humano') then raise exception 'Canal inexistente não foi criado.'; end if;
end $$;

-- Falhas induzidas precisam atingir a constraint real; provam rollback de toda a transação.
alter table public.audit_log add constraint pm_falhar_claim check(not(acao='assumir_atendimento_modular' and ator='c1000000-0000-4000-8000-000000000003'));
select pg_temp.pm_erro(format('select public.pecas_assumir_atendimento(%L,%L,0)',pg_temp.pm_uuid(315),pg_temp.pm_uuid(3)),'23514','pm_falhar_claim');
alter table public.audit_log drop constraint pm_falhar_claim;
alter table public.audit_log add constraint pm_falhar_devolver check(acao<>'pecas_devolver') not valid;
select pg_temp.pm_erro(format('select public.pecas_devolver_atendimento(%L,%L,1)',pg_temp.pm_principal(),pg_temp.pm_uuid(1)),'23514','pm_falhar_devolver');
alter table public.audit_log drop constraint pm_falhar_devolver;

do $$ declare r jsonb; ticket uuid; principal uuid:=pg_temp.pm_principal();
begin
  select id into ticket from public.atendimentos_modulares where cotacao_id=principal;
  r:=pg_temp.pm_ok('devolver',principal,pg_temp.pm_uuid(1),1);
  if r is distinct from jsonb_build_object('ok',true,'id',ticket,'cotacaoId',principal,'versao',2,'estado','livre') then raise exception 'DTO devolver incorreto: %.',r; end if;
  if exists(select 1 from public.atendimento_canais where conversa_id=pg_temp.pm_uuid(201))
    or not exists(select 1 from public.atendimentos_modulares where id=ticket and assumido_por is null and dono_na_posse is null and versao=2)
    or not exists(select 1 from public.conversas where id=pg_temp.pm_uuid(201) and status='bot' and assumida_por is null)
    or not exists(select 1 from public.pecas_cotacoes where id=principal and responsavel_id=pg_temp.pm_uuid(1) and status='aguardando_cliente') then raise exception 'Devolver alterou negócio ou deixou posse parcial.'; end if;
  if not exists(select 1 from public.atendimento_canais s join public.atendimentos_modulares a on a.id=s.atendimento_id where a.cotacao_id=pg_temp.pm_uuid(311)) then raise exception 'Devolver apagou slot de outro canal.'; end if;
  perform pg_temp.pm_negar('devolver',principal,pg_temp.pm_uuid(1),1,null,'Resposta fictícia','conflito');
  perform pg_temp.pm_negar('autorizar',principal,pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(452),'Resposta fictícia','conflito');
  set local role service_role;
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.pm_uuid(470),pg_temp.pm_uuid(201),pg_temp.pm_uuid(101),'entrada','cliente','wamid.pm.devolvida','Mensagem fora da posse');
  reset role;
  perform pg_temp.pm_ok('assumir',principal,pg_temp.pm_uuid(1),2);
  if (select atendimento_id from public.mensagens where id=pg_temp.pm_uuid(470)) is not null then raise exception 'Reassumir fez backfill de entrada anterior.'; end if;
  r:=pg_temp.pm_ok('dialogo',principal,pg_temp.pm_uuid(1));
  if exists(select 1 from jsonb_array_elements(r->'mensagens')m where m->>'id'=pg_temp.pm_uuid(470)::text) then raise exception 'Histórico fora de posse entrou no diálogo.'; end if;
  if (select count(*) from public.mensagens where id=pg_temp.pm_uuid(451))<>1 then raise exception 'Saída foi removida ou duplicada pela devolução.'; end if;
end $$;

-- Supervisão libera o atendimento autorizado, sem ganhar envio na posse de outro.
do $$ declare r jsonb; ticket uuid;
begin
  r:=pg_temp.pm_ok('assumir',pg_temp.pm_uuid(313),pg_temp.pm_uuid(1)); ticket:=(r->>'id')::uuid;
  perform pg_temp.pm_negar('reservar',pg_temp.pm_uuid(313),pg_temp.pm_uuid(3),1,pg_temp.pm_uuid(459),'Supervisor não envia','conflito');
  perform pg_temp.pm_negar('devolver',pg_temp.pm_uuid(313),pg_temp.pm_uuid(9),1);
  perform pg_temp.pm_negar('devolver',pg_temp.pm_uuid(313),pg_temp.pm_uuid(2),1);
  r:=pg_temp.pm_ok('devolver',pg_temp.pm_uuid(313),pg_temp.pm_uuid(3),1);
  if r->>'id'<>ticket::text or r->>'versao'<>'2' or r->>'estado'<>'livre'
    or exists(select 1 from public.atendimento_canais where atendimento_id=ticket)
    or not exists(select 1 from public.audit_log where ator=pg_temp.pm_uuid(3)::text and acao='pecas_devolver' and entidade_id=ticket::text) then raise exception 'Gerente não liberou/auditou só o próprio atendimento.'; end if;
  perform pg_temp.pm_ok('assumir',pg_temp.pm_uuid(314),pg_temp.pm_uuid(1));
  perform pg_temp.pm_ok('devolver',pg_temp.pm_uuid(314),pg_temp.pm_uuid(4),1);
  if not exists(select 1 from public.atendimento_canais s join public.atendimentos_modulares a on a.id=s.atendimento_id where a.cotacao_id=pg_temp.pm_principal()) then raise exception 'Supervisão apagou slot de outro atendimento.'; end if;
end $$;

-- Ledgers contraditórios íntegros: ambas as provas referenciam a mesma entrada real.
-- A fixture registra a segunda origem como dona dos dados, sem desligar FKs.
insert into public.vendas_funis(id,unidade,chave,nome,ativo)
  values(pg_temp.pm_uuid(801),'pm_a','piloto_fixture','Piloto Vendas fictício',true);
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo)
  values(pg_temp.pm_uuid(802),pg_temp.pm_uuid(801),'Aberta',1,'aberta');
create function pg_temp.pm_ledger_vendas(p_mensagem uuid,p_referencia text,p_conversa uuid,p_cliente uuid)
returns void language plpgsql as $$
declare oportunidade uuid:=gen_random_uuid();
begin
  insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
    values(oportunidade,'pm_a',pg_temp.pm_uuid(801),pg_temp.pm_uuid(802),p_cliente,pg_temp.pm_uuid(7),'fixture@example.invalid');
  insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
    values(p_referencia,p_mensagem,p_conversa,p_cliente,'pm_a',oportunidade,pg_temp.pm_uuid(801),true);
end $$;
do $$
declare r jsonb; cotacao uuid; antes jsonb; ticket uuid;
begin
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.pm_uuid(404),pg_temp.pm_uuid(204),pg_temp.pm_uuid(104),'entrada','cliente','wamid.pm.ambigua','Origem em dois setores');
  set local role service_role;
  r:=public.encaminhar_lead_bot(pg_temp.pm_uuid(204),pg_temp.pm_uuid(104),'wamid.pm.ambigua','pecas','Pedido ambíguo fictício');
  reset role;
  if r->>'ok' is distinct from 'true' then raise exception 'F2 ambíguo não criou a fonte: %.',r; end if;
  cotacao:=(r->>'cotacao_id')::uuid;
  perform pg_temp.pm_ledger_vendas(pg_temp.pm_uuid(404),'wamid.pm.ambigua',pg_temp.pm_uuid(204),pg_temp.pm_uuid(104));
  perform pg_temp.pm_negar('assumir',cotacao,pg_temp.pm_uuid(1),0,null,'Resposta fictícia','conflito');
  if exists(select 1 from public.atendimentos_modulares where cotacao_id=cotacao)
    or exists(select 1 from public.pecas_cotacoes c where c.id=cotacao and c.responsavel_id is not null)
    or not exists(select 1 from public.conversas where id=pg_temp.pm_uuid(204) and status='bot') then raise exception 'Origem ambígua deixou atribuição/abertura/pausa parcial.'; end if;

  -- Sem ledger, não importa sequer uma mensagem física com a origem_ref correta.
  update public.pecas_cotacoes set origem='whatsapp',origem_ref='wamid.pm.sem-prova' where id=pg_temp.pm_uuid(318);
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.pm_uuid(418),pg_temp.pm_uuid(218),pg_temp.pm_uuid(118),'entrada','cliente','wamid.pm.sem-prova','Histórico sem ledger');
  perform pg_temp.pm_ok('assumir',pg_temp.pm_uuid(318),pg_temp.pm_uuid(1));
  r:=pg_temp.pm_ok('dialogo',pg_temp.pm_uuid(318),pg_temp.pm_uuid(1));
  if r->'mensagens'<>'[]'::jsonb then raise exception 'Origem_ref sem ledger bastou para importar histórico.'; end if;

  r:=pg_temp.pm_ok('assumir',pg_temp.pm_uuid(307),pg_temp.pm_uuid(1)); ticket:=(r->>'id')::uuid;
  set local role service_role;
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.pm_uuid(447),pg_temp.pm_uuid(207),pg_temp.pm_uuid(107),'entrada','cliente','wamid.pm.ambigua-depois','Entrada vinculada antes da ambiguidade');
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo,metadata)
    values(pg_temp.pm_uuid(448),pg_temp.pm_uuid(207),pg_temp.pm_uuid(107),'entrada','cliente','wamid.pm.interna','Mensagem interna não visível','{"interno":true}');
  reset role;
  if (select atendimento_id from public.mensagens where id=pg_temp.pm_uuid(447)) is distinct from ticket
    or (select atendimento_id from public.mensagens where id=pg_temp.pm_uuid(448)) is not null then raise exception 'Trigger não distinguiu entrada externa/interna.'; end if;
  r:=pg_temp.pm_ok('dialogo',pg_temp.pm_uuid(307),pg_temp.pm_uuid(1));
  if jsonb_array_length(r->'mensagens')<>1 or r#>>'{mensagens,0,id}'<>pg_temp.pm_uuid(447)::text then raise exception 'Diálogo inicial após slot não isolou mensagens: %.',r; end if;
  perform pg_temp.pm_ok('reservar',pg_temp.pm_uuid(307),pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(449),'Reserva anterior à ambiguidade direta');
  perform pg_temp.pm_ledger_vendas(pg_temp.pm_uuid(447),'wamid.pm.ambigua-depois',pg_temp.pm_uuid(207),pg_temp.pm_uuid(107));
  antes:=pg_temp.pm_estado(); r:=pg_temp.pm_ok('dialogo',pg_temp.pm_uuid(307),pg_temp.pm_uuid(1));
  if exists(select 1 from jsonb_array_elements(r->'mensagens')m where m->>'id'=pg_temp.pm_uuid(447)::text) or r->>'revisaoPendente'<>'true' then raise exception 'Nova ambiguidade não omitiu corpo/sinalizou revisão: %.',r; end if;
  if antes is distinct from pg_temp.pm_estado() or (select atendimento_id from public.mensagens where id=pg_temp.pm_uuid(447)) is distinct from ticket then raise exception 'Leitura apagou vínculo ambíguo.'; end if;
  perform pg_temp.pm_negar('reservar',pg_temp.pm_uuid(307),pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(450),'Reserva após ambiguidade direta','origem_ambigua');
  perform pg_temp.pm_negar('autorizar',pg_temp.pm_uuid(307),pg_temp.pm_uuid(1),1,pg_temp.pm_uuid(449),'Resposta fictícia','origem_ambigua');
  perform pg_temp.pm_ok('devolver',pg_temp.pm_uuid(307),pg_temp.pm_uuid(1),1);
end $$;

-- F2 inicial real seguida do bot real de Vendas com o mesmo wamid fecha o envio.
insert into public.vendas_funis(id,unidade,chave,nome,ativo)
  values(pg_temp.pm_uuid(811),'pm_a','novos','Novos para segunda origem',true);
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo)
  values(pg_temp.pm_uuid(812),pg_temp.pm_uuid(811),'Aberta',1,'aberta');
do $$ declare r jsonb; principal uuid:=pg_temp.pm_principal();
begin
  perform pg_temp.pm_ok('reservar',principal,pg_temp.pm_uuid(1),3,pg_temp.pm_uuid(455),'Reserva antes da segunda origem inicial');
  set local role service_role;
  r:=public.registrar_lead_vendas_bot(pg_temp.pm_uuid(201),pg_temp.pm_uuid(101),'wamid.pm.inicial','novos',
    'Modelo fictício','indefinido','indefinido',null,null,'Segunda origem fictícia',false);
  reset role;
  if r->>'ok' is distinct from 'true' then raise exception 'Bot Vendas real não confirmou a segunda origem: %.',r; end if;
  perform pg_temp.pm_negar('reservar',principal,pg_temp.pm_uuid(1),3,pg_temp.pm_uuid(456),'Reserva após segunda origem inicial','origem_ambigua');
  perform pg_temp.pm_negar('autorizar',principal,pg_temp.pm_uuid(1),3,pg_temp.pm_uuid(455),'Resposta fictícia','origem_ambigua');
  perform pg_temp.pm_ok('devolver',principal,pg_temp.pm_uuid(3),3);
end $$;

-- A associação própria também preserva as identidades e nunca permite backfill por UPDATE.
select pg_temp.pm_erro(format('update public.mensagens set atendimento_id=(select id from public.atendimentos_modulares where cotacao_id=%L) where id=%L',pg_temp.pm_principal(),pg_temp.pm_uuid(402)),'23514',null,'postgres');
select pg_temp.pm_erro(format('insert into public.mensagens(id,conversa_id,cliente_id,atendimento_id,direcao,autor,conteudo) values(%L,%L,%L,(select id from public.atendimentos_modulares where cotacao_id=%L),''saida'',''atendente'',''Identidade forjada'')',pg_temp.pm_uuid(499),pg_temp.pm_uuid(204),pg_temp.pm_uuid(104),pg_temp.pm_principal()),'23503','mensagens_atendimento_dialogo_fk','postgres');

-- APIs SQL fechadas e canais aderentes removidos definitivamente das views gerais.
do $$ declare assinatura text; papel text; tabela text; r jsonb; nome text;
begin
  foreach assinatura in array array[
    'public.pecas_assumir_atendimento(uuid,uuid,integer)',
    'public.pecas_devolver_atendimento(uuid,uuid,integer)',
    'public.pecas_dialogo(uuid,uuid)',
    'public.pecas_reservar_resposta(uuid,uuid,integer,uuid,text)',
    'public.pecas_autorizar_resposta(uuid,uuid,integer,uuid)',
    'public.pecas_contexto_posse(uuid,uuid,integer)',
    'public.pecas_contexto_posse(uuid,uuid,integer,boolean)'
  ] loop
    foreach papel in array array['anon','authenticated'] loop
      if has_function_privilege(papel,assinatura,'execute') then raise exception '% executa %.',papel,assinatura; end if;
    end loop;
    if not has_function_privilege('service_role',assinatura,'execute') then raise exception 'Servidor sem EXECUTE: %.',assinatura; end if;
    if exists(select 1 from pg_proc p where p.oid=assinatura::regprocedure and (p.prosecdef or p.proconfig is null or not p.proconfig @> array['search_path=""'])) then raise exception 'Função privilegiada ou search_path aberto: %.',assinatura; end if;
  end loop;
  foreach tabela in array array['atendimentos_modulares','atendimento_canais','atendimento_mensagens','mensagens','pecas_cotacoes'] loop
    if not exists(select 1 from pg_class where oid=('public.'||tabela)::regclass and relrowsecurity) then raise exception 'RLS desligado: %.',tabela; end if;
  end loop;
  if has_schema_privilege('service_role','auth','usage') then raise exception 'MVP concedeu acesso ao schema Auth.'; end if;
  foreach nome in array array['conversas_legadas','mensagens_legadas'] loop
    foreach papel in array array['anon','authenticated'] loop
      if has_table_privilege(papel,'public.'||nome,'select') then raise exception 'View legada exposta ao navegador: %.',nome; end if;
    end loop;
  end loop;
  set local role service_role;
  if exists(select 1 from public.conversas_legadas where id in (pg_temp.pm_uuid(201),pg_temp.pm_uuid(208),pg_temp.pm_uuid(216)))
    or exists(select 1 from public.mensagens_legadas where conversa_id=pg_temp.pm_uuid(201)) then raise exception 'Piloto devolvido ou ativo voltou ao legado.'; end if;
  if not exists(select 1 from public.conversas_legadas where id=pg_temp.pm_uuid(203)) then raise exception 'Canal legado sem adesão desapareceu.'; end if;
  reset role;
end $$;
select pg_temp.pm_erro(format('select public.pecas_dialogo(%L,%L)',pg_temp.pm_principal(),pg_temp.pm_uuid(1)),'42501',null,'anon');
select pg_temp.pm_erro('select * from public.conversas_legadas','42501',null,'authenticated');

-- O runner mantém esta transação aberta para reaplicar os módulos com dados reais.
create function pg_temp.pm_verificar_reaplicacao() returns void language plpgsql as $$
declare r jsonb; antes jsonb;
begin
  antes:=pg_temp.pm_estado(); r:=pg_temp.pm_ok('dialogo',pg_temp.pm_principal(),pg_temp.pm_uuid(1));
  if r->>'clienteNome' is distinct from 'Cliente piloto fictício 101' then raise exception 'Leitura depois de reaplicar falhou: %.',r; end if;
  if antes is distinct from pg_temp.pm_estado() then raise exception 'Diálogo fez escrita.'; end if;
end $$;
rollback;
