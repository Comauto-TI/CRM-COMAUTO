-- Política de delegação de redefinição de senhas; apenas perfis fictícios locais.
begin;
create temp table permissoes_senhas_verificacoes(nome text primary key);
create function pg_temp.ps_conferir(p_nome text,p_ok boolean) returns void language plpgsql as $$
begin
 if p_ok is distinct from true then raise exception 'Permissão de senhas: %',p_nome; end if;
 insert into permissoes_senhas_verificacoes values(p_nome);
end $$;
insert into auth.users(id) select ('ab130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8)n;
insert into auth.users(id) values('ab130000-0000-4000-8000-000000000900');
insert into public.usuarios(user_id,nome,papel,setor,ativo) values
 ('ab130000-0000-4000-8000-000000000900','Principal fictício','admin','administracao',true),
 ('ab130000-0000-4000-8000-000000000001','Administrador fictício','admin','administracao',true),
 ('ab130000-0000-4000-8000-000000000002','Administrador delegado fictício','admin','administracao',true),
 ('ab130000-0000-4000-8000-000000000003','Financeiro fictício','financeiro','administracao',true),
 ('ab130000-0000-4000-8000-000000000004','Administrador inativo fictício','admin','administracao',false),
 ('ab130000-0000-4000-8000-000000000005','Gerente fictício','gerente','administracao',true),
 ('ab130000-0000-4000-8000-000000000006','Recepção fictícia','recepcao','oficina',true),
 ('ab130000-0000-4000-8000-000000000007','Alvo rollback fictício','admin','administracao',true),
 ('ab130000-0000-4000-8000-000000000008','Alvo demovido fictício','admin','administracao',true);

create function pg_temp.ps_definir(p_destino integer,p_permitir boolean,p_ator integer default 900,p_principal integer default 900,p_email text default 'principal@fixture.invalid')
returns jsonb language sql as $$
 select public.definir_permissao_senhas(
  ('ab130000-0000-4000-8000-'||lpad(p_ator::text,12,'0'))::uuid,
  ('ab130000-0000-4000-8000-'||lpad(p_principal::text,12,'0'))::uuid,
  ('ab130000-0000-4000-8000-'||lpad(p_destino::text,12,'0'))::uuid,p_permitir,p_email);
$$;

select pg_temp.ps_conferir('coluna boolean obrigatória e padrão falso',data_type='boolean' and is_nullable='NO' and column_default='false')
 from information_schema.columns where table_schema='public' and table_name='usuarios' and column_name='pode_redefinir_senhas';
select pg_temp.ps_conferir('nenhuma permissão delegada por padrão',not bool_or(pode_redefinir_senhas)) from public.usuarios;
select pg_temp.ps_conferir('CHECK de perfil existe',count(*)=1) from pg_constraint
 where conrelid='public.usuarios'::regclass and conname='usuarios_permissao_senhas_check';
select pg_temp.ps_conferir('usuários continuam com RLS',relrowsecurity) from pg_class where oid='public.usuarios'::regclass;
select pg_temp.ps_conferir('browser sem política nova',count(*)=0) from pg_policy where polrelid='public.usuarios'::regclass;
select pg_temp.ps_conferir('RPC é invoker',not prosecdef) from pg_proc
 where oid='public.definir_permissao_senhas(uuid,uuid,uuid,boolean,text)'::regprocedure;
select pg_temp.ps_conferir('RPC exclusiva do servidor',has_function_privilege('service_role','public.definir_permissao_senhas(uuid,uuid,uuid,boolean,text)','execute')
 and not has_function_privilege('anon','public.definir_permissao_senhas(uuid,uuid,uuid,boolean,text)','execute')
 and not has_function_privilege('authenticated','public.definir_permissao_senhas(uuid,uuid,uuid,boolean,text)','execute'));
select pg_temp.ps_conferir('coluna de permissão fechada ao navegador',not has_column_privilege('anon','public.usuarios','pode_redefinir_senhas','select,insert,update')
 and not has_column_privilege('authenticated','public.usuarios','pode_redefinir_senhas','select,insert,update'));
select pg_temp.ps_conferir('servidor lê e atualiza flag',has_column_privilege('service_role','public.usuarios','pode_redefinir_senhas','select')
 and has_column_privilege('service_role','public.usuarios','pode_redefinir_senhas','update'));
select pg_temp.ps_conferir('nenhuma liberação do Auth',not has_schema_privilege('service_role','auth','usage')
 and not has_table_privilege('service_role','auth.users','select,insert,update,delete'));

select pg_temp.ps_conferir('principal concede a admin ativo',pg_temp.ps_definir(1,true)='{"ok":true,"alterado":true}'::jsonb);
select pg_temp.ps_conferir('flag persistida',pode_redefinir_senhas) from public.usuarios where user_id='ab130000-0000-4000-8000-000000000001';
select pg_temp.ps_conferir('uma auditoria após concessão',count(*)=1) from public.audit_log where acao='definir_permissao_senhas';
select pg_temp.ps_conferir('auditoria identifica ator e alvo, sem credenciais',ator='principal@fixture.invalid' and entidade='usuarios'
 and entidade_id='ab130000-0000-4000-8000-000000000001'
 and dados='{"ator_id":"ab130000-0000-4000-8000-000000000900","destino_id":"ab130000-0000-4000-8000-000000000001","permitir":true}'::jsonb)
 from public.audit_log where acao='definir_permissao_senhas';
select pg_temp.ps_conferir('replay de concessão não altera',pg_temp.ps_definir(1,true)='{"ok":true,"alterado":false}'::jsonb);
select pg_temp.ps_conferir('replay não gera auditoria',count(*)=1) from public.audit_log where acao='definir_permissao_senhas';
select pg_temp.ps_conferir('principal revoga',pg_temp.ps_definir(1,false)='{"ok":true,"alterado":true}'::jsonb);
select pg_temp.ps_conferir('flag revogada',not pode_redefinir_senhas) from public.usuarios where user_id='ab130000-0000-4000-8000-000000000001';
select pg_temp.ps_conferir('revogação auditada uma vez',count(*)=2) from public.audit_log where acao='definir_permissao_senhas';
select pg_temp.ps_conferir('replay de revogação não altera',pg_temp.ps_definir(1,false)='{"ok":true,"alterado":false}'::jsonb);
select pg_temp.ps_conferir('replay revogação não gera auditoria',count(*)=2) from public.audit_log where acao='definir_permissao_senhas';

update public.usuarios set pode_redefinir_senhas=true where user_id='ab130000-0000-4000-8000-000000000002';
select pg_temp.ps_conferir('admin delegado não delega a terceiros',pg_temp.ps_definir(1,true,2)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('admin comum não delega',pg_temp.ps_definir(1,true,1)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('principal não altera própria flag',pg_temp.ps_definir(900,true)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('principal não revoga própria flag',pg_temp.ps_definir(900,false)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('alvo inexistente recusado',pg_temp.ps_definir(999,true)='{"ok":false,"motivo":"nao_encontrado"}'::jsonb);
select pg_temp.ps_conferir('conceder a financeiro recusado',pg_temp.ps_definir(3,true)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('conceder a admin inativo recusado',pg_temp.ps_definir(4,true)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('conceder a gerente recusado',pg_temp.ps_definir(5,true)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('conceder a recepção recusado',pg_temp.ps_definir(6,true)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
select pg_temp.ps_conferir('revogar financeiro sem flag é idempotente',pg_temp.ps_definir(3,false)='{"ok":true,"alterado":false}'::jsonb);
select pg_temp.ps_conferir('revogar admin inativo sem flag é idempotente',pg_temp.ps_definir(4,false)='{"ok":true,"alterado":false}'::jsonb);
select pg_temp.ps_conferir('recusas não produziram eventos',count(*)=2) from public.audit_log where acao='definir_permissao_senhas';

select pg_temp.ps_conferir('principal ausente na tabela recusado',pg_temp.ps_definir(1,true,999,999)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
update public.usuarios set ativo=false where user_id='ab130000-0000-4000-8000-000000000900';
select pg_temp.ps_conferir('principal inativo recusado',pg_temp.ps_definir(1,true)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
update public.usuarios set ativo=true,papel='gerente' where user_id='ab130000-0000-4000-8000-000000000900';
select pg_temp.ps_conferir('principal não admin recusado',pg_temp.ps_definir(1,true)='{"ok":false,"motivo":"sem_permissao"}'::jsonb);
update public.usuarios set papel='admin' where user_id='ab130000-0000-4000-8000-000000000900';

select pg_temp.ps_conferir('ator NULL recusado',public.definir_permissao_senhas(null,'ab130000-0000-4000-8000-000000000900','ab130000-0000-4000-8000-000000000001',true,'a@fixture.invalid')->>'motivo'='invalido');
select pg_temp.ps_conferir('principal NULL recusado',public.definir_permissao_senhas('ab130000-0000-4000-8000-000000000900',null,'ab130000-0000-4000-8000-000000000001',true,'a@fixture.invalid')->>'motivo'='invalido');
select pg_temp.ps_conferir('alvo NULL recusado',public.definir_permissao_senhas('ab130000-0000-4000-8000-000000000900','ab130000-0000-4000-8000-000000000900',null,true,'a@fixture.invalid')->>'motivo'='invalido');
select pg_temp.ps_conferir('permissão NULL recusada',pg_temp.ps_definir(1,null)->>'motivo'='invalido');
select pg_temp.ps_conferir('email NULL recusado',pg_temp.ps_definir(1,true,900,900,null)->>'motivo'='invalido');
select pg_temp.ps_conferir('email vazio recusado',pg_temp.ps_definir(1,true,900,900,'')->>'motivo'='invalido');
select pg_temp.ps_conferir('email com espaços recusado',pg_temp.ps_definir(1,true,900,900,' a@fixture.invalid ')->>'motivo'='invalido');
select pg_temp.ps_conferir('email com newline recusado',pg_temp.ps_definir(1,true,900,900,E'a@fixture.invalid\n')->>'motivo'='invalido');
select pg_temp.ps_conferir('email longo recusado',pg_temp.ps_definir(1,true,900,900,repeat('x',321))->>'motivo'='invalido');

do $$
begin
 begin update public.usuarios set pode_redefinir_senhas=true where user_id='ab130000-0000-4000-8000-000000000003';raise exception 'CHECK aceitou financeiro';
 exception when check_violation then perform pg_temp.ps_conferir('CHECK bloqueia flag em não admin',true);end;
 begin update public.usuarios set pode_redefinir_senhas=true where user_id='ab130000-0000-4000-8000-000000000004';raise exception 'CHECK aceitou inativo';
 exception when check_violation then perform pg_temp.ps_conferir('CHECK bloqueia flag em inativo',true);end;
 begin update public.usuarios set papel='gerente' where user_id='ab130000-0000-4000-8000-000000000002';raise exception 'CHECK aceitou demover com flag';
 exception when check_violation then perform pg_temp.ps_conferir('CHECK impede demover preservando flag',true);end;
 begin update public.usuarios set ativo=false where user_id='ab130000-0000-4000-8000-000000000002';raise exception 'CHECK aceitou inativar com flag';
 exception when check_violation then perform pg_temp.ps_conferir('CHECK impede inativar preservando flag',true);end;
end $$;
update public.usuarios set papel='gerente',pode_redefinir_senhas=false where user_id='ab130000-0000-4000-8000-000000000002';
select pg_temp.ps_conferir('demover e limpar flag juntos funciona',papel='gerente' and not pode_redefinir_senhas)
 from public.usuarios where user_id='ab130000-0000-4000-8000-000000000002';

create function pg_temp.ps_negar_audit() returns trigger language plpgsql as $$
begin if new.acao='definir_permissao_senhas' then raise exception 'Falha fictícia de auditoria';end if;return new;end $$;
create trigger ps_audit_falha before insert on public.audit_log for each row execute function pg_temp.ps_negar_audit();
select pg_temp.ps_conferir('falha de audit devolve recusa',pg_temp.ps_definir(7,true)='{"ok":false,"motivo":"indisponivel"}'::jsonb);
select pg_temp.ps_conferir('falha de audit desfaz a flag',not pode_redefinir_senhas) from public.usuarios where user_id='ab130000-0000-4000-8000-000000000007';
select pg_temp.ps_conferir('falha de audit não deixa evento parcial',count(*)=2) from public.audit_log where acao='definir_permissao_senhas';
drop trigger ps_audit_falha on public.audit_log;
rollback;
