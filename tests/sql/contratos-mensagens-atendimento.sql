-- Banco descartável: módulos 0001/0002/0003/0005/0006, nessa ordem.
-- A1.1b: só a mensagem inicial comprovada por encaminhamentos_bot em Peças.
-- Fixture local descartável: não concede grants para esconder dependências da migration.
begin;
create function pg_temp.msg_uuid(n integer) returns uuid language sql immutable as $$
  select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.msg_ref(n integer) returns text language sql immutable as $$ select 'wamid.atm.fixture.'||n; $$;
create function pg_temp.msg_estado() returns jsonb language sql as $$
  select jsonb_build_object(
    'vinculos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t),
    'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
    'ledger',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.encaminhamentos_bot t),
    'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
    'cotacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes t),
    'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t),
    'notas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.notas_cliente t),
    'avisos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.notificacoes t)
  );
$$;
create function pg_temp.msg_abrir(p_setor text,p_registro uuid,p_ator uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  if current_user<>'service_role' then raise exception 'Fixture não assumiu service_role.'; end if;
  r:=public.abrir_atendimento_modular(p_setor,p_registro,p_ator);
  reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.msg_bot(p_conversa uuid,p_cliente uuid,p_referencia text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  if current_user<>'service_role' then raise exception 'Fixture não assumiu service_role.'; end if;
  r:=public.encaminhar_lead_bot(p_conversa,p_cliente,p_referencia,'pecas','Pedido inicial fictício');
  reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.msg_vincular(p_id uuid,p_referencia text,p_ator uuid,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
  execute format('set local role %I',p_papel);
  if current_user<>p_papel then raise exception 'Fixture não mudou o papel.'; end if;
  r:=public.vincular_mensagem_encaminhada(p_id,p_referencia,p_ator);
  reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.msg_recusar(p_id uuid,p_ref text,p_ator uuid,p_constraint text default null)
returns void language plpgsql as $$
declare antes jsonb; r jsonb; restricao text; lancou boolean:=false;
begin
  antes:=pg_temp.msg_estado();
  begin
    r:=pg_temp.msg_vincular(p_id,p_ref,p_ator);
  exception when check_violation then
    get stacked diagnostics restricao=constraint_name;
    if p_constraint is null or restricao is distinct from p_constraint then raise; end if;
    lancou:=true;
  end;
  if p_constraint is not null and not lancou then raise exception 'Falha induzida não foi atingida: %.',p_constraint; end if;
  if not lancou and r is distinct from '{"ok":false,"codigo":"nao_encontrado"}'::jsonb then raise exception 'Vínculo deveria recusar sem expor contexto, obteve %.',r; end if;
  if pg_temp.msg_estado() is distinct from antes then raise exception 'Recusa deixou efeitos parciais.'; end if;
end $$;
create function pg_temp.msg_mutacao_recusada(p_sql text,p_sqlstate text,p_papel text default 'fixture_owner')
returns void language plpgsql as $$
declare antes jsonb; codigo text; lancou boolean:=false;
begin
  if p_papel not in ('fixture_owner','service_role') then raise exception 'Papel inválido na fixture.'; end if;
  antes:=pg_temp.msg_estado();
  begin
    if p_papel='service_role' then set local role service_role; end if;
    execute p_sql;
    reset role;
  exception when others then
    get stacked diagnostics codigo=returned_sqlstate;
    reset role;
    if codigo<>p_sqlstate then raise; end if;
    lancou:=true;
  end;
  if not lancou then raise exception 'Mutação deveria falhar com %: %.',p_sqlstate,p_sql; end if;
  if pg_temp.msg_estado() is distinct from antes then raise exception 'Mutação recusada deixou efeitos parciais.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values
 ('msg_principal','Mensagem principal fictícia',true),('msg_fora','Outra unidade fictícia',true),
 ('msg_canal','Unidade física fictícia',true),('msg_inativa','Unidade inativa fictícia',false);
insert into auth.users(id) select pg_temp.msg_uuid(n) from generate_series(1,13)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
 (pg_temp.msg_uuid(1),'Peças proprietário','pecas','pecas','msg_principal',true),
 (pg_temp.msg_uuid(2),'Outro Peças','pecas','pecas','msg_principal',true),
 (pg_temp.msg_uuid(3),'Gerente Peças','gerente','pecas','msg_principal',true),
 (pg_temp.msg_uuid(4),'Gerente Vendas','gerente','vendas','msg_principal',true),
 (pg_temp.msg_uuid(5),'Gerente administração extra','gerente','administracao','msg_fora',true),
 (pg_temp.msg_uuid(6),'Admin global','admin','administracao','msg_fora',true),
 (pg_temp.msg_uuid(7),'Peças inativo','pecas','pecas','msg_principal',false),
 (pg_temp.msg_uuid(8),'Peças extra','pecas','pecas','msg_fora',true),
 (pg_temp.msg_uuid(9),'Peças fora','pecas','pecas','msg_fora',true),
 (pg_temp.msg_uuid(10),'Recepção','recepcao','oficina','msg_principal',true),
 (pg_temp.msg_uuid(11),'Admin inativo','admin','administracao','msg_fora',false),
 (pg_temp.msg_uuid(12),'Vendedor','vendedor','vendas','msg_principal',true),
 (pg_temp.msg_uuid(13),'Gerente Oficina','gerente','oficina','msg_principal',true);
insert into public.usuario_unidades(user_id,unidade) values (pg_temp.msg_uuid(5),'msg_principal'),(pg_temp.msg_uuid(8),'msg_principal');
insert into public.clientes(id,telefone,nome,vendedor_id,unidade_origem)
select pg_temp.msg_uuid(n),'5511900'||lpad(n::text,6,'0'),'Cliente fictício '||n,pg_temp.msg_uuid(12),'msg_principal' from generate_series(101,133)n;
insert into public.conversas(id,cliente_id,unidade,status)
select pg_temp.msg_uuid(n+100),pg_temp.msg_uuid(n),'msg_principal','humano' from generate_series(101,133)n;

-- Caso positivo passa pela RPC real do bot, não por um ledger inventado na fixture.
insert into public.mensagens(id,conversa_id,cliente_id,wamid,direcao,autor,metadata)
values(pg_temp.msg_uuid(401),pg_temp.msg_uuid(201),pg_temp.msg_uuid(101),'wamid.atm.inicial','entrada','cliente','{}');
do $$
declare r jsonb; cotacao uuid;
begin
 r:=pg_temp.msg_bot(pg_temp.msg_uuid(201),pg_temp.msg_uuid(101),'wamid.atm.inicial');
 if r->>'ok' is distinct from 'true' or r->>'cotacao_id' is null then raise exception 'Encaminhamento real não criou origem confiável: %.',r; end if;
 cotacao:=(r->>'cotacao_id')::uuid;
 update public.pecas_cotacoes set responsavel_id=pg_temp.msg_uuid(1) where id=cotacao;
 -- A unidade física pode mudar sem reclassificar o negócio/ledger já comprovados.
 update public.conversas set unidade='msg_canal' where id=pg_temp.msg_uuid(201);
 r:=pg_temp.msg_abrir('pecas',cotacao,pg_temp.msg_uuid(1));
 if r->>'ok' is distinct from 'true' then raise exception 'Atendimento atribuído não abriu.'; end if;
end $$;

-- Cada origem abaixo varia apenas um requisito relevante da mensagem/ledger/cotação.
insert into public.mensagens(id,conversa_id,cliente_id,wamid,direcao,autor,metadata)
select pg_temp.msg_uuid(500+n),pg_temp.msg_uuid(case n when 10 then 212 else 201+n end),
 pg_temp.msg_uuid(case n when 9 then 111 else 101+n end),
 case n when 11 then 'wamid.atm.outro.11' else pg_temp.msg_ref(n) end,
 case n when 8 then 'saida' else 'entrada' end,case n when 7 then 'bot' else 'cliente' end,
 case n when 1 then '{"interno":false}'::jsonb when 2 then '{"interno":null}'::jsonb
  when 3 then '{"interno":true}'::jsonb when 4 then '{"interno":"true"}'::jsonb
  when 5 then '{"interno":"false"}'::jsonb when 6 then '{"interno":0}'::jsonb
  when 28 then '{"interno":[false]}'::jsonb when 29 then '{"interno":{}}'::jsonb else '{}'::jsonb end
from generate_series(1,32)n;
insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao,origem,origem_ref)
select pg_temp.msg_uuid(300+n),'msg_principal',pg_temp.msg_uuid(101+n),
 case n when 24 then pg_temp.msg_uuid(8) else pg_temp.msg_uuid(1) end,'Origem fictícia '||n,
 case n when 17 then 'balcao' else 'whatsapp' end,case n when 18 then 'wamid.atm.outro.18' else pg_temp.msg_ref(n) end
from generate_series(1,32)n;
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino,cotacao_id)
select pg_temp.msg_ref(n),pg_temp.msg_uuid(case n when 14 then 216 else 201+n end),
 pg_temp.msg_uuid(case n when 13 then 115 else 101+n end),case n when 15 then 'msg_fora' else 'msg_principal' end,
 case n when 16 then 'triagem' else 'pecas' end,case n when 16 then null when 12 then pg_temp.msg_uuid(313) else pg_temp.msg_uuid(300+n) end
from generate_series(1,32)n;
do $$
declare n integer; r jsonb;
begin
 for n in 1..32 loop
  r:=pg_temp.msg_abrir('pecas',pg_temp.msg_uuid(300+n),case n when 24 then pg_temp.msg_uuid(8) else pg_temp.msg_uuid(1) end);
  if r->>'ok' is distinct from 'true' then raise exception 'Fixture do caso % não abriu: %.',n,r; end if;
 end loop;
end $$;

-- Vínculo inicial atômico, identificadores exatos e replay com ator supervisor elegível.
do $$
declare atendimento uuid; r jsonb; antes jsonb; total integer; cotacao uuid;
begin
 select cotacao_id into cotacao from public.encaminhamentos_bot where referencia='wamid.atm.inicial';
 select id into atendimento from public.atendimentos_modulares where cotacao_id=cotacao;
 select count(*) into total from public.audit_log;
 r:=pg_temp.msg_vincular(atendimento,'wamid.atm.inicial',pg_temp.msg_uuid(1));
 if r is distinct from jsonb_build_object('ok',true,'atendimentoId',atendimento,'mensagemId',pg_temp.msg_uuid(401),'referencia','wamid.atm.inicial','jaVinculado',false) then raise exception 'Contrato de vínculo inicial incorreto: %.',r; end if;
 if not exists(select 1 from public.atendimento_mensagens where mensagem_id=pg_temp.msg_uuid(401) and atendimento_id=atendimento
  and referencia='wamid.atm.inicial' and cotacao_id=cotacao and conversa_id=pg_temp.msg_uuid(201) and cliente_id=pg_temp.msg_uuid(101)
  and unidade='msg_principal' and entrada_cliente_externa and criado_por=pg_temp.msg_uuid(1)) then raise exception 'Identidade comprovada não foi preservada.'; end if;
 if (select count(*) from public.audit_log)<>total+1 then raise exception 'Vínculo precisa auditar exatamente uma vez.'; end if;
 antes:=pg_temp.msg_estado();
 r:=pg_temp.msg_vincular(atendimento,'wamid.atm.inicial',pg_temp.msg_uuid(3));
 if r->>'ok' is distinct from 'true' or r->>'jaVinculado' is distinct from 'true' or pg_temp.msg_estado() is distinct from antes then raise exception 'Replay duplicou vínculo/auditoria.'; end if;
 -- Admin sem unidade extra também pode vincular uma origem elegível com interno=false.
 select id into atendimento from public.atendimentos_modulares where cotacao_id=pg_temp.msg_uuid(301);
 r:=pg_temp.msg_vincular(atendimento,pg_temp.msg_ref(1),pg_temp.msg_uuid(6));
 if r->>'ok' is distinct from 'true' or r->>'jaVinculado' is distinct from 'false' then raise exception 'Admin global ou interno=false recusado.'; end if;
end $$;

-- Nenhum acesso por conhecer IDs: outro responsável, setor, unidade ou usuário inativo.
do $$
declare atendimento uuid; n integer;
begin
 select id into atendimento from public.atendimentos_modulares where cotacao_id=(select cotacao_id from public.encaminhamentos_bot where referencia='wamid.atm.inicial');
 foreach n in array array[2,4,7,9,10,11,12,13] loop perform pg_temp.msg_recusar(atendimento,'wamid.atm.inicial',pg_temp.msg_uuid(n)); end loop;
 perform pg_temp.msg_recusar(null,'wamid.atm.inicial',pg_temp.msg_uuid(1));
 perform pg_temp.msg_recusar(atendimento,null,pg_temp.msg_uuid(1));
 perform pg_temp.msg_recusar(atendimento,'wamid.atm.inicial',null);
 perform pg_temp.msg_recusar(atendimento,'',pg_temp.msg_uuid(1));
 perform pg_temp.msg_recusar(atendimento,' wamid.atm.inicial',pg_temp.msg_uuid(1));
 perform pg_temp.msg_recusar(atendimento,'wamid.atm.inicial ',pg_temp.msg_uuid(1));
 perform pg_temp.msg_recusar(atendimento,repeat('x',513),pg_temp.msg_uuid(1));
 perform pg_temp.msg_recusar(pg_temp.msg_uuid(999),'wamid.atm.inicial',pg_temp.msg_uuid(1));
end $$;

-- Interno null/string/true/número/array/objeto; mensagem e ledger contraditórios; origem manual.
do $$
declare n integer; atendimento uuid;
begin
 foreach n in array array[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,28,29] loop
  select id into atendimento from public.atendimentos_modulares where cotacao_id=pg_temp.msg_uuid(300+n);
  perform pg_temp.msg_recusar(atendimento,pg_temp.msg_ref(n),pg_temp.msg_uuid(1));
 end loop;
end $$;

-- Revogação e snapshots são revalidados depois de abrir, sem religar atendimento antigo.
do $$
declare n integer; atendimento uuid; ator uuid; r jsonb;
begin
 foreach n in array array[19,20,21,23,24,25,26,27,30,31] loop
  select id into atendimento from public.atendimentos_modulares where cotacao_id=pg_temp.msg_uuid(300+n);
  ator:=case n when 20 then pg_temp.msg_uuid(6) when 24 then pg_temp.msg_uuid(8) when 25 then pg_temp.msg_uuid(6) else pg_temp.msg_uuid(1) end;
  if n=19 then update public.pecas_cotacoes set cliente_id=pg_temp.msg_uuid(133) where id=pg_temp.msg_uuid(319);
  elsif n=20 then update public.pecas_cotacoes set unidade='msg_fora' where id=pg_temp.msg_uuid(320);
  elsif n=21 then update public.atendimentos_modulares set conversa_id=pg_temp.msg_uuid(233) where id=atendimento;
  elsif n=23 then update public.usuarios set ativo=false where user_id=pg_temp.msg_uuid(1);
  elsif n=24 then delete from public.usuario_unidades where user_id=pg_temp.msg_uuid(8) and unidade='msg_principal';
  elsif n=25 then update public.unidades set ativa=false where chave='msg_principal';
  elsif n=26 then update public.clientes set anonimizado=true where id=pg_temp.msg_uuid(127);
  elsif n=27 then update public.pecas_cotacoes set status='entregue' where id=pg_temp.msg_uuid(327);
  elsif n=30 then update public.pecas_cotacoes set responsavel_id=null where id=pg_temp.msg_uuid(330);
  elsif n=31 then update public.pecas_cotacoes set responsavel_id=pg_temp.msg_uuid(2) where id=pg_temp.msg_uuid(331);
  end if;
  perform pg_temp.msg_recusar(atendimento,pg_temp.msg_ref(n),ator);
  if n=23 then update public.usuarios set ativo=true where user_id=pg_temp.msg_uuid(1); end if;
  if n=25 then update public.unidades set ativa=true where chave='msg_principal'; end if;
  if n=31 then
   r:=pg_temp.msg_vincular(atendimento,pg_temp.msg_ref(n),pg_temp.msg_uuid(2));
   if r->>'ok' is distinct from 'true' then raise exception 'Responsável novo não conseguiu vincular origem preservada.'; end if;
  end if;
 end loop;
end $$;

-- Vendas não tem origem confiável neste recorte, mesmo com cliente/conversa conhecidos.
insert into public.vendas_funis(id,unidade,chave,nome) values(pg_temp.msg_uuid(701),'msg_principal','fixture','Funil fictício');
insert into public.vendas_etapas(id,funil_id,nome,ordem) values(pg_temp.msg_uuid(702),pg_temp.msg_uuid(701),'Aberta',1);
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
 values(pg_temp.msg_uuid(703),'msg_principal',pg_temp.msg_uuid(701),pg_temp.msg_uuid(702),pg_temp.msg_uuid(101),pg_temp.msg_uuid(12),'fixture@example.invalid');
do $$
declare r jsonb;
begin
 r:=pg_temp.msg_abrir('vendas',pg_temp.msg_uuid(703),pg_temp.msg_uuid(12));
 if r->>'ok' is distinct from 'true' then raise exception 'Fixture Vendas não abriu.'; end if;
 perform pg_temp.msg_recusar((r->>'id')::uuid,'wamid.atm.inicial',pg_temp.msg_uuid(12));
end $$;

-- Auditoria realmente atingida e recusada: nenhuma associação parcial pode sobreviver.
alter table public.audit_log add constraint fixture_msg_rejeita_audit check(false) not valid;
select pg_temp.msg_recusar((select id from public.atendimentos_modulares where cotacao_id=pg_temp.msg_uuid(322)),
 pg_temp.msg_ref(22),pg_temp.msg_uuid(1),'fixture_msg_rejeita_audit');
alter table public.audit_log drop constraint fixture_msg_rejeita_audit;

-- Uma associação prova as identidades das três fontes: UPDATE/DELETE contraditórios falham por FK.
do $$
declare atendimento uuid; cotacao uuid; campo text; valor text;
begin
 select cotacao_id into cotacao from public.encaminhamentos_bot where referencia='wamid.atm.inicial';
 select id into atendimento from public.atendimentos_modulares where cotacao_id=cotacao;
 insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao)
  values(pg_temp.msg_uuid(900),'msg_principal',pg_temp.msg_uuid(101),pg_temp.msg_uuid(1),'Cotação alternativa fictícia');
 foreach campo in array array['cliente_id','conversa_id','unidade','cotacao_id'] loop
  valor:=case campo when 'cliente_id' then pg_temp.msg_uuid(133)::text when 'conversa_id' then pg_temp.msg_uuid(233)::text
   when 'unidade' then 'msg_fora' else pg_temp.msg_uuid(900)::text end;
  perform pg_temp.msg_mutacao_recusada(format('update public.atendimentos_modulares set %I=%L where id=%L',campo,valor,atendimento),'23503');
  perform pg_temp.msg_mutacao_recusada(format('update public.encaminhamentos_bot set %I=%L where referencia=%L',campo,valor,'wamid.atm.inicial'),'23503');
 end loop;
 perform pg_temp.msg_mutacao_recusada($q$update public.encaminhamentos_bot set referencia='wamid.atm.reescrito' where referencia='wamid.atm.inicial'$q$,'23503');
 foreach campo in array array['id','cliente_id','conversa_id','wamid','direcao','autor'] loop
  valor:=case campo when 'id' then pg_temp.msg_uuid(999)::text when 'cliente_id' then pg_temp.msg_uuid(133)::text
   when 'conversa_id' then pg_temp.msg_uuid(233)::text when 'wamid' then 'wamid.atm.reescrito' when 'direcao' then 'saida' else 'bot' end;
  perform pg_temp.msg_mutacao_recusada(format('update public.mensagens set %I=%L where id=%L',campo,valor,pg_temp.msg_uuid(401)),'23503');
 end loop;
 perform pg_temp.msg_mutacao_recusada(format('delete from public.mensagens where id=%L',pg_temp.msg_uuid(401)),'23001');
 perform pg_temp.msg_mutacao_recusada($q$delete from public.encaminhamentos_bot where referencia='wamid.atm.inicial'$q$,'23001');
 perform pg_temp.msg_mutacao_recusada(format('delete from public.atendimentos_modulares where id=%L',atendimento),'23001');
end $$;

-- A PK/UNIQUE e as FKs impedem fabricar outra associação íntegra do mesmo wamid.
do $$
declare comando text;
begin
 comando:=$q$insert into public.atendimento_mensagens select * from public.atendimento_mensagens where referencia='wamid.atm.inicial'$q$;
 perform pg_temp.msg_mutacao_recusada(comando,'23505');
 comando:=format($q$insert into public.atendimento_mensagens(mensagem_id,referencia,atendimento_id,cotacao_id,conversa_id,cliente_id,unidade,entrada_cliente_externa,criado_por)
  select %L,referencia||'.outro',atendimento_id,cotacao_id,conversa_id,cliente_id,unidade,entrada_cliente_externa,criado_por
  from public.atendimento_mensagens where referencia='wamid.atm.inicial'$q$,pg_temp.msg_uuid(532));
 perform pg_temp.msg_mutacao_recusada(comando,'23503');
end $$;

-- Metadata de processamento e status continuam alteráveis; transformar em interna não.
set local role service_role;
update public.mensagens set metadata='{"processamento":{"etapa":"feito"},"interno":false}'::jsonb,status='lida'
 where wamid='wamid.atm.inicial';
reset role;
do $$
declare interno jsonb;
begin
 if not exists(select 1 from public.mensagens where wamid='wamid.atm.inicial' and status='lida' and metadata#>>'{processamento,etapa}'='feito') then raise exception 'Update legítimo de processamento/status falhou.'; end if;
 foreach interno in array array['true'::jsonb,'null'::jsonb,'"true"'::jsonb,'"false"'::jsonb,'0'::jsonb,'[]'::jsonb,'{}'::jsonb] loop
  perform pg_temp.msg_mutacao_recusada(format('update public.mensagens set metadata=jsonb_build_object(''interno'',%L::jsonb) where wamid=%L',interno::text,'wamid.atm.inicial'),'23503','service_role');
 end loop;
end $$;
set local role service_role;
update public.mensagens set metadata='{"processamento":{"etapa":"feito"}}'::jsonb where wamid='wamid.atm.inicial';
reset role;
update public.mensagens set conteudo='Conteúdo anonimizado em fixture',metadata='{}'::jsonb where wamid='wamid.atm.inicial';

-- Só servidor: tabela SELECT/INSERT, sem UPDATE/DELETE, RLS fechado, RPC invoker e PUBLIC fechado.
do $$
declare papel text; privilegio text; funcao record;
 assinatura constant text:='public.vincular_mensagem_encaminhada(uuid,text,uuid)';
begin
 if not exists(select 1 from pg_attribute where attrelid='public.mensagens'::regclass and attname='entrada_cliente_externa'
  and attgenerated='s' and atttypid='boolean'::regtype) then raise exception 'Classificação externa precisa ser generated stored boolean.'; end if;
 if not exists(select 1 from pg_class where oid='public.atendimento_mensagens'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.atendimento_mensagens'::regclass) then raise exception 'Vínculos precisam de RLS fechado.'; end if;
 foreach papel in array array['anon','authenticated'] loop
  foreach privilegio in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if has_table_privilege(papel,'public.atendimento_mensagens',privilegio) then raise exception 'Vínculo exposto ao navegador.'; end if;
  end loop;
  if has_any_column_privilege(papel,'public.atendimento_mensagens','SELECT,INSERT,UPDATE') or has_function_privilege(papel,assinatura,'EXECUTE') then raise exception 'Vínculo/RPC exposto ao navegador.'; end if;
  begin
   perform pg_temp.msg_vincular((select atendimento_id from public.atendimento_mensagens where referencia='wamid.atm.inicial'),'wamid.atm.inicial',pg_temp.msg_uuid(1),papel);
   raise exception 'Browser executou RPC.';
  exception when insufficient_privilege then null;
  end;
 end loop;
 if not has_table_privilege('service_role','public.atendimento_mensagens','SELECT')
  or not has_table_privilege('service_role','public.atendimento_mensagens','INSERT')
  or not has_function_privilege('service_role',assinatura,'EXECUTE') then raise exception 'Faltam grants explícitos do servidor.'; end if;
 foreach privilegio in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
  if has_table_privilege('service_role','public.atendimento_mensagens',privilegio) then raise exception 'Grant excessivo de % no vínculo.',privilegio; end if;
 end loop;
 if has_any_column_privilege('service_role','public.atendimento_mensagens','UPDATE') then raise exception 'Associações não podem ser atualizadas por coluna.'; end if;
 select prosecdef,proconfig,proacl,proowner into funcao from pg_proc where oid=assinatura::regprocedure;
 if funcao.prosecdef or not coalesce(funcao.proconfig&&array['search_path=""','search_path='],false)
  or exists(select 1 from aclexplode(coalesce(funcao.proacl,acldefault('f',funcao.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'RPC precisa de invoker/search_path vazio/PUBLIC fechado.'; end if;
 if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,INSERT,UPDATE,DELETE') then raise exception 'A1.1b não precisa de grants Auth.'; end if;
end $$;
rollback;
