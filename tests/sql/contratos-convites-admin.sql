-- Convite administrativo no banco descartável; não cria contas em Auth real.
begin;
create temp table convites_admin_verificacoes(nome text primary key);
create function pg_temp.ca_conferir(p_nome text,p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'Convite admin: %',p_nome; end if;
  insert into convites_admin_verificacoes values(p_nome);
end $$;
insert into auth.users(id) select ('ca130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into public.usuarios(user_id,nome,papel,setor,ativo) values
 ('ca130000-0000-4000-8000-000000000001','Admin fictício','admin','administracao',true),
 ('ca130000-0000-4000-8000-000000000002','Gerente fictício','gerente','administracao',true),
 ('ca130000-0000-4000-8000-000000000003','Admin inativo fictício','admin','administracao',false),
 ('ca130000-0000-4000-8000-000000000004','Admin removido fictício','admin','administracao',true),
 ('ca130000-0000-4000-8000-000000000005','Admin rebaixado fictício','admin','administracao',true);

create function pg_temp.ca_criar(p_num integer,p_extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare d jsonb; resultado uuid;
begin
 d:=jsonb_build_object('tipo','administrador','papel','admin','setor','administracao','unidade','comauto',
  'criado_por','ca130000-0000-4000-8000-000000000001','criado_em',now(),'expira_em',now()+interval '24 hours',
  'max_usos',1,'usos',0)||p_extra;
 insert into public.plataforma_convites(token_hash,tipo,papel,setor,unidade,criado_por,criado_em,expira_em,max_usos,usos,revogado_em)
 values(lpad(to_hex(p_num),64,'0'),d->>'tipo',d->>'papel',d->>'setor',d->>'unidade',(d->>'criado_por')::uuid,
 (d->>'criado_em')::timestamptz,(d->>'expira_em')::timestamptz,(d->>'max_usos')::integer,(d->>'usos')::integer,
 (d->>'revogado_em')::timestamptz) returning id into resultado;
 return resultado;
end $$;
create function pg_temp.ca_recusar(p_num integer,p_nome text,p_extra jsonb) returns void language plpgsql as $$
begin
 begin perform pg_temp.ca_criar(p_num,p_extra); raise exception 'CHECK aceitou %',p_nome;
 exception when check_violation or not_null_violation then perform pg_temp.ca_conferir(p_nome,true); end;
end $$;

select pg_temp.ca_conferir('tipo inclui administrador',pg_get_constraintdef(oid) like '%administrador%')
 from pg_constraint where conrelid='public.plataforma_convites'::regclass and conname='plataforma_convites_tipo_check';
select pg_temp.ca_conferir('CHECK administrativo existe',count(*)=1) from pg_constraint
 where conrelid='public.plataforma_convites'::regclass and conname='plataforma_convites_admin_check';
select pg_temp.ca_conferir('RLS continua ligado',relrowsecurity) from pg_class where oid='public.plataforma_convites'::regclass;
select pg_temp.ca_conferir('não há política de navegador',count(*)=0) from pg_policy where polrelid='public.plataforma_convites'::regclass;
select pg_temp.ca_conferir('RPC invoker',not prosecdef) from pg_proc where oid='public.reservar_convite(text)'::regprocedure;
select pg_temp.ca_conferir('Auth não foi liberado',not has_schema_privilege('service_role','auth','usage') and not has_table_privilege('service_role','auth.users','select,insert,update,delete'));
select pg_temp.ca_conferir('servidor executa reserva e devolução',has_function_privilege('service_role','public.reservar_convite(text)','execute') and has_function_privilege('service_role','public.devolver_convite(uuid)','execute'));
select pg_temp.ca_conferir('anon não executa RPCs',not has_function_privilege('anon','public.reservar_convite(text)','execute') and not has_function_privilege('anon','public.devolver_convite(uuid)','execute'));
select pg_temp.ca_conferir('authenticated não executa RPCs',not has_function_privilege('authenticated','public.reservar_convite(text)','execute') and not has_function_privilege('authenticated','public.devolver_convite(uuid)','execute'));

select pg_temp.ca_criar(10);
select pg_temp.ca_conferir('admin válido reserva uma vez',public.reservar_convite(lpad(to_hex(10),64,'0'))->>'ok'='true');
select pg_temp.ca_conferir('hash desconhecido não reserva',public.reservar_convite(lpad(to_hex(999),64,'0'))='{"ok":false}'::jsonb);
do $$
declare r jsonb;
begin
 perform pg_temp.ca_criar(11);
 r:=public.reservar_convite(lpad(to_hex(11),64,'0'));
 perform pg_temp.ca_conferir('retorno fixa claims administrativos',r @> '{"ok":true,"tipo":"administrador","papel":"admin","setor":"administracao","unidade":"comauto","criado_por":"ca130000-0000-4000-8000-000000000001"}'::jsonb);
 perform pg_temp.ca_conferir('retorno não expõe token ou hash',not(r ? 'token_hash') and not(r ? 'token'));
end $$;
select pg_temp.ca_conferir('replay esgotado não reserva',public.reservar_convite(lpad(to_hex(10),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('uso fica exatamente um',usos=1 and papel='admin' and setor='administracao') from public.plataforma_convites where token_hash=lpad(to_hex(10),64,'0');
select public.devolver_convite(id) from public.plataforma_convites where token_hash=lpad(to_hex(10),64,'0');
select pg_temp.ca_conferir('compensação devolve uma reserva',usos=0) from public.plataforma_convites where token_hash=lpad(to_hex(10),64,'0');
select public.devolver_convite(id) from public.plataforma_convites where token_hash=lpad(to_hex(10),64,'0');
select pg_temp.ca_conferir('devolução repetida não fica negativa',usos=0) from public.plataforma_convites where token_hash=lpad(to_hex(10),64,'0');
select pg_temp.ca_conferir('reserva após compensação funciona',public.reservar_convite(lpad(to_hex(10),64,'0'))->>'ok'='true');

select pg_temp.ca_recusar(20,'admin com outro papel recusado','{"papel":"vendedor"}');
select pg_temp.ca_recusar(21,'admin com outro setor recusado','{"setor":"vendas"}');
select pg_temp.ca_recusar(22,'admin com vários usos recusado','{"max_usos":2}');
select pg_temp.ca_recusar(23,'admin com zero usos máximos recusado','{"max_usos":0}');
select pg_temp.ca_recusar(24,'validade acima de 24h recusada',jsonb_build_object('expira_em',now()+interval '24 hours 1 second'));
select pg_temp.ca_recusar(25,'tipo desconhecido recusado','{"tipo":"super_admin"}');
select pg_temp.ca_recusar(26,'papel NULL recusado','{"papel":null}');
select pg_temp.ca_recusar(27,'setor NULL recusado','{"setor":null}');
select pg_temp.ca_recusar(28,'usos acima do máximo recusado','{"usos":2}');
select pg_temp.ca_recusar(29,'fim igual ao início recusado',jsonb_build_object('criado_em',now()+interval '1 hour','expira_em',now()+interval '1 hour'));
select pg_temp.ca_recusar(129,'fim antes do início recusado',jsonb_build_object('criado_em',now()+interval '2 hours','expira_em',now()+interval '1 hour'));

select pg_temp.ca_criar(30,'{"criado_por":"ca130000-0000-4000-8000-000000000002"}');
select pg_temp.ca_criar(31,'{"criado_por":"ca130000-0000-4000-8000-000000000003"}');
select pg_temp.ca_criar(32,'{"criado_por":"ca130000-0000-4000-8000-000000000004"}');
select pg_temp.ca_criar(33,'{"criado_por":"ca130000-0000-4000-8000-000000000005"}');
select pg_temp.ca_criar(34,'{"criado_por":null}');
delete from public.usuarios where user_id='ca130000-0000-4000-8000-000000000004';
update public.usuarios set papel='gerente' where user_id='ca130000-0000-4000-8000-000000000005';
select pg_temp.ca_conferir('emissor gerente não reserva',public.reservar_convite(lpad(to_hex(30),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('emissor inativo não reserva',public.reservar_convite(lpad(to_hex(31),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('emissor removido não reserva',public.reservar_convite(lpad(to_hex(32),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('emissor rebaixado não reserva',public.reservar_convite(lpad(to_hex(33),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('emissor nulo não reserva',public.reservar_convite(lpad(to_hex(34),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('recusas de emissor não gastam uso',bool_and(usos=0)) from public.plataforma_convites where token_hash in(select lpad(to_hex(n),64,'0') from generate_series(30,34)n);

select pg_temp.ca_criar(40,jsonb_build_object('criado_em',now()-interval '25 hours','expira_em',now()-interval '1 hour'));
select pg_temp.ca_criar(41,jsonb_build_object('revogado_em',now()));
select pg_temp.ca_criar(42,'{"usos":1}');
select pg_temp.ca_conferir('expirado não reserva',public.reservar_convite(lpad(to_hex(40),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('revogado não reserva',public.reservar_convite(lpad(to_hex(41),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('esgotado não reserva',public.reservar_convite(lpad(to_hex(42),64,'0'))='{"ok":false}'::jsonb);
select pg_temp.ca_conferir('hash ausente não reserva',public.reservar_convite(null)='{"ok":false}'::jsonb);

select pg_temp.ca_criar(50,'{"tipo":"vendas","papel":"vendedor","setor":"vendas","max_usos":5,"criado_por":"ca130000-0000-4000-8000-000000000002"}');
select pg_temp.ca_criar(51,'{"tipo":"pecas","papel":"pecas","setor":"pecas","max_usos":5,"criado_por":null}');
select pg_temp.ca_criar(52,'{"tipo":"agendamento","papel":"recepcao","setor":"oficina","max_usos":5,"criado_por":"ca130000-0000-4000-8000-000000000003"}');
select pg_temp.ca_conferir('legado vendas preservado',public.reservar_convite(lpad(to_hex(50),64,'0'))->>'papel'='vendedor');
select pg_temp.ca_conferir('legado peças preservado',public.reservar_convite(lpad(to_hex(51),64,'0'))->>'papel'='pecas');
select pg_temp.ca_conferir('legado agendamento preservado',public.reservar_convite(lpad(to_hex(52),64,'0'))->>'papel'='recepcao');
rollback;
