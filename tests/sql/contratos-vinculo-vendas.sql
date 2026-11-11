-- Banco descartável: módulos 0001/0002/0003/0005/0006, nessa ordem.
-- A1.1d: setores explícitos, prova por mensagem e guarda de autorização sem conteúdo.
begin;
create function pg_temp.vv_uuid(n integer) returns uuid language sql immutable as $$
 select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.vv_estado() returns jsonb language sql as $$
 select jsonb_build_object(
  'vinculos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t),
  'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
  'pecas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.encaminhamentos_bot t),
  'vendas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_encaminhamentos_bot t),
  'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t),
  'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t)
 );
$$;
create function pg_temp.vv_chamar(p_operacao text,p_id uuid,p_ref text,p_ator uuid,p_setor text default null,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
 if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
 execute format('set local role %I',p_papel);
 if current_user<>p_papel then raise exception 'Fixture não mudou o papel.'; end if;
 if p_operacao='pecas' then r:=public.vincular_mensagem_encaminhada(p_id,p_ref,p_ator);
 elsif p_operacao='vendas' then r:=public.vincular_mensagem_vendas(p_id,p_ref,p_ator);
 elsif p_operacao='autorizar' then r:=public.autorizar_mensagem_atendimento(p_id,p_ref,p_ator,p_setor);
 else raise exception 'Operação inválida na fixture.';
 end if;
 reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.vv_recusar(p_op text,p_id uuid,p_ref text,p_ator uuid,p_setor text default null,p_codigo text default 'nao_encontrado',p_constraint text default null)
returns void language plpgsql as $$
declare antes jsonb; r jsonb; restricao text; lancou boolean:=false;
begin
 antes:=pg_temp.vv_estado();
 begin r:=pg_temp.vv_chamar(p_op,p_id,p_ref,p_ator,p_setor);
 exception when check_violation then
  get stacked diagnostics restricao=constraint_name;
  if p_constraint is null or restricao is distinct from p_constraint then raise; end if;
  lancou:=true;
 end;
 if p_constraint is not null and not lancou then raise exception 'Falha induzida não foi atingida: %.',p_constraint; end if;
 if not lancou and r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo) then raise exception 'Esperado % sem dados, obteve %.',p_codigo,r; end if;
 if pg_temp.vv_estado() is distinct from antes then raise exception 'Recusa alterou vínculos/fontes/auditoria.'; end if;
end $$;
create function pg_temp.vv_mutacao_recusada(p_sql text,p_codigo text) returns void language plpgsql as $$
declare antes jsonb; codigo text; lancou boolean:=false;
begin
 antes:=pg_temp.vv_estado();
 begin execute p_sql;
 exception when others then
  get stacked diagnostics codigo=returned_sqlstate;
  if codigo<>p_codigo then raise; end if;
  lancou:=true;
 end;
 if not lancou then raise exception 'Mutação deveria falhar com %: %.',p_codigo,p_sql; end if;
 if pg_temp.vv_estado() is distinct from antes then raise exception 'Mutação recusada alterou dados.'; end if;
end $$;
create temporary table vv_origens(n integer,setor text,registro uuid,atendimento uuid,cliente uuid,conversa uuid,referencia text,primary key(n,setor));
create function pg_temp.vv_preparar(n integer,p_setor text) returns void language plpgsql as $$
declare r jsonb; registro uuid; atendimento uuid; cliente uuid; conversa uuid; dono uuid; ref text:='wamid.vv.'||n;
begin
 cliente:=pg_temp.vv_uuid(case n when 20 then 102 else 100+n end);
 conversa:=pg_temp.vv_uuid(case n when 20 then 202 else 200+n end);
 set local role service_role;
 if p_setor='pecas' then r:=public.encaminhar_lead_bot(conversa,cliente,ref,'pecas','Origem Peças fictícia '||n);
 elsif p_setor='triagem' then r:=public.encaminhar_lead_bot(conversa,cliente,ref,'triagem','Origem Triagem fictícia '||n);
 else r:=public.registrar_lead_vendas_bot(conversa,cliente,ref,case n when 20 then 'seminovos' else 'novos' end,
  null,'indefinido','indefinido',null,null,'Origem Vendas fictícia '||n,false);
 end if;
 reset role;
 if r->>'ok' is distinct from 'true' then raise exception 'Fonte real %/% não foi criada: %.',p_setor,n,r; end if;
 if p_setor='triagem' then return; end if;
 if p_setor='pecas' then
  registro:=(r->>'cotacao_id')::uuid; dono:=pg_temp.vv_uuid(case n when 9 then 15 when 18 then 13 else 3 end);
  update public.pecas_cotacoes set responsavel_id=dono where id=registro;
 else
  registro:=(r->>'oportunidade_id')::uuid;
  if n=17 then update public.vendas_oportunidades set vendedor_id=pg_temp.vv_uuid(12) where id=registro; end if;
  select vendedor_id into dono from public.vendas_oportunidades where id=registro;
 end if;
 set local role service_role;
 r:=public.abrir_atendimento_modular(p_setor,registro,case when n in(17,18) then pg_temp.vv_uuid(8) else dono end);
 reset role;
 if r->>'ok' is distinct from 'true' then raise exception 'Atendimento real %/% não abriu: %.',p_setor,n,r; end if;
 atendimento:=(r->>'id')::uuid;
 insert into pg_temp.vv_origens values(n,p_setor,registro,atendimento,cliente,conversa,ref);
exception when others then reset role; raise;
end $$;
create function pg_temp.vv_vincular(n integer,p_setor text,p_ator uuid) returns void language plpgsql as $$
declare o record; r jsonb; antes jsonb; total integer;
begin
 select * into strict o from pg_temp.vv_origens where vv_origens.n=vv_vincular.n and setor=p_setor;
 select count(*) into total from public.audit_log;
 r:=pg_temp.vv_chamar(p_setor,o.atendimento,o.referencia,p_ator);
 if r is distinct from jsonb_build_object('ok',true,'atendimentoId',o.atendimento,'mensagemId',pg_temp.vv_uuid(300+n),'referencia',o.referencia,'jaVinculado',false) then raise exception 'Contrato de vínculo %/% incorreto: %.',p_setor,n,r; end if;
 if (select count(*) from public.audit_log)<>total+1 then raise exception 'Vínculo precisa de auditoria única.'; end if;
 antes:=pg_temp.vv_estado();
 r:=pg_temp.vv_chamar('autorizar',o.atendimento,o.referencia,p_ator,p_setor);
 if r is distinct from jsonb_build_object('ok',true,'atendimentoId',o.atendimento,'mensagemId',pg_temp.vv_uuid(300+n),'referencia',o.referencia,'setor',p_setor) then raise exception 'Guarda não autorizou associação exata sem conteúdo: %.',r; end if;
 r:=pg_temp.vv_chamar(p_setor,o.atendimento,o.referencia,p_ator);
 if r->>'ok' is distinct from 'true' or r->>'jaVinculado' is distinct from 'true' or pg_temp.vv_estado() is distinct from antes then raise exception 'Guarda/replay alterou vínculo ou auditoria.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values('vv_principal','Principal fictícia',true),('vv_fora','Outra fictícia',true),('vv_inativa','Inativa fictícia',false);
insert into auth.users(id) select pg_temp.vv_uuid(n) from generate_series(1,17)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
 (pg_temp.vv_uuid(1),'Vendedor A','vendedor','vendas','vv_principal',true),
 (pg_temp.vv_uuid(2),'Vendedor B','vendedor','vendas','vv_principal',true),
 (pg_temp.vv_uuid(3),'Peças A','pecas','pecas','vv_principal',true),
 (pg_temp.vv_uuid(4),'Peças B','pecas','pecas','vv_principal',true),
 (pg_temp.vv_uuid(5),'Gerente Vendas','gerente','vendas','vv_principal',true),
 (pg_temp.vv_uuid(6),'Gerente Peças','gerente','pecas','vv_principal',true),
 (pg_temp.vv_uuid(7),'Gerente administração extra','gerente','administracao','vv_fora',true),
 (pg_temp.vv_uuid(8),'Admin global','admin','administracao','vv_fora',true),
 (pg_temp.vv_uuid(9),'Gerente Oficina','gerente','oficina','vv_principal',true),
 (pg_temp.vv_uuid(10),'Vendedor inativo','vendedor','vendas','vv_principal',false),
 (pg_temp.vv_uuid(11),'Peças inativo','pecas','pecas','vv_principal',false),
 (pg_temp.vv_uuid(12),'Vendedor outra unidade','vendedor','vendas','vv_fora',true),
 (pg_temp.vv_uuid(13),'Peças outra unidade','pecas','pecas','vv_fora',true),
 (pg_temp.vv_uuid(14),'Vendedor extra','vendedor','vendas','vv_fora',true),
 (pg_temp.vv_uuid(15),'Peças extra','pecas','pecas','vv_fora',true),
 (pg_temp.vv_uuid(16),'Admin inativo','admin','administracao','vv_fora',false),
 (pg_temp.vv_uuid(17),'Recepção','recepcao','oficina','vv_principal',true);
insert into public.usuario_unidades values(pg_temp.vv_uuid(7),'vv_principal'),(pg_temp.vv_uuid(14),'vv_principal'),(pg_temp.vv_uuid(15),'vv_principal');
insert into public.clientes(id,telefone,nome,vendedor_id,unidade_origem)
select pg_temp.vv_uuid(100+n),'5511700'||lpad(n::text,6,'0'),'Cliente fictício '||n,pg_temp.vv_uuid(case n when 8 then 14 else 1 end),'vv_principal' from generate_series(1,25)n;
insert into public.conversas(id,cliente_id,unidade,status)
select pg_temp.vv_uuid(200+n),pg_temp.vv_uuid(100+n),'vv_principal','humano' from generate_series(1,25)n;
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor)
select pg_temp.vv_uuid(300+n),pg_temp.vv_uuid(case n when 20 then 102 else 100+n end),pg_temp.vv_uuid(case n when 20 then 202 else 200+n end),'wamid.vv.'||n,'entrada','cliente' from generate_series(1,25)n;
insert into public.vendas_funis(id,unidade,chave,nome) values(pg_temp.vv_uuid(701),'vv_principal','novos','Novos fictício'),(pg_temp.vv_uuid(702),'vv_principal','seminovos','Seminovos fictício');
insert into public.vendas_etapas(id,funil_id,nome,ordem) values(pg_temp.vv_uuid(801),pg_temp.vv_uuid(701),'Aberta',1),(pg_temp.vv_uuid(802),pg_temp.vv_uuid(702),'Aberta',1);
select pg_temp.vv_preparar(1,'pecas');
select pg_temp.vv_preparar(2,'vendas');
select pg_temp.vv_vincular(1,'pecas',pg_temp.vv_uuid(3));
select pg_temp.vv_vincular(2,'vendas',pg_temp.vv_uuid(1));

-- Exclusividade das RPCs e guarda: IDs/ref existentes não bastam sem associação exata.
do $$
declare p record; v record; n integer;
begin
 select * into p from pg_temp.vv_origens where vv_origens.n=1 and setor='pecas';
 select * into v from pg_temp.vv_origens where vv_origens.n=2 and setor='vendas';
 perform pg_temp.vv_recusar('pecas',v.atendimento,v.referencia,pg_temp.vv_uuid(1));
 perform pg_temp.vv_recusar('vendas',p.atendimento,p.referencia,pg_temp.vv_uuid(3));
 perform pg_temp.vv_recusar('autorizar',p.atendimento,p.referencia,pg_temp.vv_uuid(3),'vendas');
 perform pg_temp.vv_recusar('autorizar',v.atendimento,v.referencia,pg_temp.vv_uuid(1),'pecas');
 perform pg_temp.vv_recusar('autorizar',v.atendimento,p.referencia,pg_temp.vv_uuid(1),'vendas');
 foreach n in array array[2,3,4,6,9,10,11,12,13,16,17] loop
  perform pg_temp.vv_recusar('autorizar',v.atendimento,v.referencia,pg_temp.vv_uuid(n),'vendas');
  perform pg_temp.vv_recusar('vendas',v.atendimento,v.referencia,pg_temp.vv_uuid(n));
 end loop;
 foreach n in array array[1,2,4,5,9,10,11,12,13,16,17] loop
  perform pg_temp.vv_recusar('autorizar',p.atendimento,p.referencia,pg_temp.vv_uuid(n),'pecas');
 end loop;
 perform pg_temp.vv_recusar('vendas',v.atendimento,'inexistente',pg_temp.vv_uuid(1));
 perform pg_temp.vv_recusar('autorizar',v.atendimento,'',pg_temp.vv_uuid(1),'vendas');
 perform pg_temp.vv_recusar('autorizar',null,v.referencia,pg_temp.vv_uuid(1),'vendas');
 perform pg_temp.vv_recusar('autorizar',v.atendimento,null,pg_temp.vv_uuid(1),'vendas');
 perform pg_temp.vv_recusar('autorizar',v.atendimento,v.referencia,null,'vendas');
 perform pg_temp.vv_recusar('autorizar',v.atendimento,v.referencia,pg_temp.vv_uuid(1),'oficina');
end $$;
select pg_temp.vv_preparar(7,'vendas');
select pg_temp.vv_recusar('autorizar',atendimento,referencia,pg_temp.vv_uuid(1),'vendas') from pg_temp.vv_origens where n=7;
select pg_temp.vv_vincular(7,'vendas',pg_temp.vv_uuid(1));

-- Ambas ordens de origem dupla recusam; usuário sem escopo não aprende a ambiguidade.
select pg_temp.vv_preparar(3,'pecas'); select pg_temp.vv_preparar(3,'vendas');
select pg_temp.vv_preparar(4,'vendas'); select pg_temp.vv_preparar(4,'pecas');
do $$
declare o record; ator uuid;
begin
 for o in select * from pg_temp.vv_origens where n in(3,4) loop
  ator:=pg_temp.vv_uuid(case o.setor when 'pecas' then 3 else 1 end);
  perform pg_temp.vv_recusar(o.setor,o.atendimento,o.referencia,ator,null,'origem_ambigua');
  perform pg_temp.vv_recusar('autorizar',o.atendimento,o.referencia,ator,o.setor,'origem_ambigua');
  perform pg_temp.vv_recusar('autorizar',o.atendimento,o.referencia,pg_temp.vv_uuid(case o.setor when 'pecas' then 4 else 2 end),o.setor);
 end loop;
end $$;

-- Mesmo autorizado no próprio atendimento, não pode sondar wamid ambíguo alheio.
select pg_temp.vv_recusar('autorizar',atendimento,'wamid.vv.3',pg_temp.vv_uuid(1),'vendas') from pg_temp.vv_origens where n=2;
select pg_temp.vv_recusar('vendas',atendimento,'wamid.vv.3',pg_temp.vv_uuid(1)) from pg_temp.vv_origens where n=2;

-- Origem dupla que chega depois preserva a linha; bloqueia guarda e replay sem eleger setor.
select pg_temp.vv_preparar(5,'vendas'); select pg_temp.vv_vincular(5,'vendas',pg_temp.vv_uuid(1));
select pg_temp.vv_preparar(5,'triagem');
select pg_temp.vv_preparar(6,'pecas'); select pg_temp.vv_vincular(6,'pecas',pg_temp.vv_uuid(3));
select pg_temp.vv_preparar(6,'vendas');
do $$
declare o record; ator uuid; linha jsonb;
begin
 for o in select * from pg_temp.vv_origens where (n=5 and setor='vendas') or(n=6 and setor='pecas') loop
  ator:=pg_temp.vv_uuid(case o.setor when 'pecas' then 3 else 1 end);
  select to_jsonb(t) into linha from public.atendimento_mensagens t where referencia=o.referencia;
  perform pg_temp.vv_recusar(o.setor,o.atendimento,o.referencia,ator,null,'origem_ambigua');
  perform pg_temp.vv_recusar('autorizar',o.atendimento,o.referencia,ator,o.setor,'origem_ambigua');
  perform pg_temp.vv_recusar('autorizar',o.atendimento,o.referencia,pg_temp.vv_uuid(case o.setor when 'pecas' then 4 else 2 end),o.setor);
  if (select to_jsonb(t) from public.atendimento_mensagens t where referencia=o.referencia) is distinct from linha then raise exception 'Origem dupla moveu/apagou vínculo existente.'; end if;
 end loop;
end $$;

-- Transferências não alteram associação; carteira anterior não concede acesso ao antigo dono.
update public.vendas_oportunidades set vendedor_id=pg_temp.vv_uuid(2) where id=(select registro from pg_temp.vv_origens where n=2 and setor='vendas');
update public.pecas_cotacoes set responsavel_id=pg_temp.vv_uuid(4) where id=(select registro from pg_temp.vv_origens where n=1 and setor='pecas');
do $$
declare o record; r jsonb; antes jsonb; antigo uuid; novo uuid;
begin
 for o in select * from pg_temp.vv_origens where n in(1,2) loop
  antigo:=pg_temp.vv_uuid(case o.setor when 'pecas' then 3 else 1 end); novo:=pg_temp.vv_uuid(case o.setor when 'pecas' then 4 else 2 end);
  perform pg_temp.vv_recusar('autorizar',o.atendimento,o.referencia,antigo,o.setor);
  perform pg_temp.vv_recusar(o.setor,o.atendimento,o.referencia,antigo);
  antes:=pg_temp.vv_estado(); r:=pg_temp.vv_chamar('autorizar',o.atendimento,o.referencia,novo,o.setor);
  if r->>'ok' is distinct from 'true' then raise exception 'Novo dono não acessou associação preservada.'; end if;
  r:=pg_temp.vv_chamar(o.setor,o.atendimento,o.referencia,novo);
  if r->>'jaVinculado' is distinct from 'true' or pg_temp.vv_estado() is distinct from antes then raise exception 'Transferência duplicou associação/audit.'; end if;
 end loop;
 if (select vendedor_id from public.clientes where id=pg_temp.vv_uuid(102))<>pg_temp.vv_uuid(1) then raise exception 'Fixture deveria manter carteira antiga.'; end if;
end $$;

-- Acesso atual, extras revogadas e unidades/inativos são rechecados na guarda/replay.
select pg_temp.vv_preparar(8,'vendas'); select pg_temp.vv_vincular(8,'vendas',pg_temp.vv_uuid(14));
select pg_temp.vv_preparar(9,'pecas'); select pg_temp.vv_vincular(9,'pecas',pg_temp.vv_uuid(15));
delete from public.usuario_unidades where user_id in(pg_temp.vv_uuid(14),pg_temp.vv_uuid(15)) and unidade='vv_principal';
do $$
declare o record; ator uuid;
begin
 for o in select * from pg_temp.vv_origens where n in(8,9) loop
  ator:=pg_temp.vv_uuid(case o.setor when 'pecas' then 15 else 14 end);
  perform pg_temp.vv_recusar('autorizar',o.atendimento,o.referencia,ator,o.setor);
  perform pg_temp.vv_recusar(o.setor,o.atendimento,o.referencia,ator);
 end loop;
end $$;
update public.usuarios set ativo=false where user_id=pg_temp.vv_uuid(2);
select pg_temp.vv_recusar('autorizar',atendimento,referencia,pg_temp.vv_uuid(2),'vendas') from pg_temp.vv_origens where n=2;
update public.usuarios set ativo=true where user_id=pg_temp.vv_uuid(2);
update public.unidades set ativa=false where chave='vv_principal';
select pg_temp.vv_recusar('autorizar',atendimento,referencia,pg_temp.vv_uuid(8),setor) from pg_temp.vv_origens where n in(1,2);
update public.unidades set ativa=true where chave='vv_principal';
update public.clientes set anonimizado=true where id=pg_temp.vv_uuid(102);
select pg_temp.vv_recusar('autorizar',atendimento,referencia,pg_temp.vv_uuid(2),'vendas') from pg_temp.vv_origens where n=2;
update public.clientes set anonimizado=false where id=pg_temp.vv_uuid(102);

select pg_temp.vv_preparar(12,'vendas');
update public.atendimentos_modulares set conversa_id=pg_temp.vv_uuid(225) where id=(select atendimento from pg_temp.vv_origens where n=12);
select pg_temp.vv_recusar('vendas',atendimento,referencia,pg_temp.vv_uuid(1)) from pg_temp.vv_origens where n=12;
select pg_temp.vv_preparar(13,'pecas');
update public.pecas_cotacoes set origem='balcao' where id=(select registro from pg_temp.vv_origens where n=13);
select pg_temp.vv_recusar('pecas',atendimento,referencia,pg_temp.vv_uuid(3)) from pg_temp.vv_origens where n=13;
select pg_temp.vv_preparar(17,'vendas'); select pg_temp.vv_vincular(17,'vendas',pg_temp.vv_uuid(8));
select pg_temp.vv_preparar(18,'pecas'); select pg_temp.vv_vincular(18,'pecas',pg_temp.vv_uuid(8));
select pg_temp.vv_recusar('autorizar',atendimento,referencia,pg_temp.vv_uuid(case setor when 'pecas' then 13 else 12 end),setor) from pg_temp.vv_origens where n in(17,18);
select pg_temp.vv_preparar(20,'vendas');
select pg_temp.vv_recusar('vendas',atendimento,'wamid.vv.2',pg_temp.vv_uuid(1)) from pg_temp.vv_origens where n=20;

-- Rollback exige atingir a constraint audit real nos dois caminhos refatorados.
select pg_temp.vv_preparar(14,'vendas'); select pg_temp.vv_preparar(15,'pecas');
alter table public.audit_log add constraint fixture_vv_rejeita_audit check(false) not valid;
select pg_temp.vv_recusar(setor,atendimento,referencia,pg_temp.vv_uuid(case setor when 'pecas' then 3 else 1 end),null,'nao_encontrado','fixture_vv_rejeita_audit') from pg_temp.vv_origens where n in(14,15);
alter table public.audit_log drop constraint fixture_vv_rejeita_audit;

-- CHECK setorial, unicidade global e identidades compostas impedem cross-binding bruto.
do $$
declare p record; v record;
begin
 select * into p from pg_temp.vv_origens where n=1; select * into v from pg_temp.vv_origens where n=2;
 perform pg_temp.vv_mutacao_recusada($q$insert into public.atendimento_mensagens select * from public.atendimento_mensagens where referencia='wamid.vv.1'$q$,'23505');
 perform pg_temp.vv_mutacao_recusada($q$update public.atendimento_mensagens set setor='oficina' where referencia='wamid.vv.1'$q$,'23514');
 perform pg_temp.vv_mutacao_recusada(format('update public.atendimento_mensagens set oportunidade_id=%L where referencia=%L',v.registro,p.referencia),'23514');
 perform pg_temp.vv_mutacao_recusada(format('update public.atendimento_mensagens set setor=%L,oportunidade_id=%L,cotacao_id=null where referencia=%L','vendas',v.registro,p.referencia),'23503');
 perform pg_temp.vv_mutacao_recusada(format('update public.atendimento_mensagens set setor=%L,cotacao_id=%L,oportunidade_id=null where referencia=%L','pecas',p.registro,v.referencia),'23503');
end $$;
-- A FK do ledger deve conferir a unidade mesmo com snapshot de atendimento forjado.
select pg_temp.vv_preparar(16,'vendas');
update public.atendimentos_modulares set unidade='vv_fora' where id=(select atendimento from pg_temp.vv_origens where n=16);
do $$
declare o record; comando text;
begin
 select * into o from pg_temp.vv_origens where n=16;
 comando:=format($q$insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,oportunidade_id,cotacao_id,conversa_id,cliente_id,unidade,setor,criado_por)
 values(%L,%L,%L,%L,null,%L,%L,'vv_fora','vendas',%L)$q$,pg_temp.vv_uuid(316),o.atendimento,o.referencia,o.registro,o.conversa,o.cliente,pg_temp.vv_uuid(1));
 perform pg_temp.vv_mutacao_recusada(comando,'23503');
end $$;

-- RLS/ACL continuam fechados, associações sem UPDATE/DELETE do serviço e funções invoker.
do $$
declare assinatura text; papel text; privilegio text; f record; o record;
begin
 if not exists(select 1 from pg_class where oid='public.atendimento_mensagens'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.atendimento_mensagens'::regclass) then raise exception 'RLS de associações precisa permanecer fechado.'; end if;
 foreach papel in array array['anon','authenticated'] loop
  foreach privilegio in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if has_table_privilege(papel,'public.atendimento_mensagens',privilegio) then raise exception 'Associação exposta ao browser.'; end if;
  end loop;
  if has_any_column_privilege(papel,'public.atendimento_mensagens','SELECT,INSERT,UPDATE') then raise exception 'Colunas expostas ao browser.'; end if;
 end loop;
 foreach privilegio in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
  if has_table_privilege('service_role','public.atendimento_mensagens',privilegio) then raise exception 'Serviço recebeu mutação excessiva.'; end if;
 end loop;
 if has_any_column_privilege('service_role','public.atendimento_mensagens','UPDATE') then raise exception 'Associação recebeu UPDATE por coluna.'; end if;
 foreach assinatura in array array['public.vincular_mensagem_encaminhada(uuid,text,uuid)','public.vincular_mensagem_vendas(uuid,text,uuid)',
  'public.autorizar_mensagem_atendimento(uuid,text,uuid,text)','public.resolver_mensagem_atendimento(uuid,text,uuid,text)',
  'public.vincular_mensagem_do_setor(uuid,text,uuid,text)'] loop
  select prosecdef,proconfig,proacl,proowner into f from pg_proc where oid=assinatura::regprocedure;
  if f.prosecdef or not coalesce(f.proconfig&&array['search_path=""','search_path='],false)
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Invoker/search_path/ACL incorreto: %.',assinatura; end if;
  if not has_function_privilege('service_role',assinatura,'EXECUTE') then raise exception 'Serviço sem função necessária.'; end if;
  foreach papel in array array['anon','authenticated'] loop if has_function_privilege(papel,assinatura,'EXECUTE') then raise exception 'RPC exposta ao browser.'; end if; end loop;
 end loop;
 select * into o from pg_temp.vv_origens where n=2;
 foreach papel in array array['anon','authenticated'] loop
  begin perform pg_temp.vv_chamar('vendas',o.atendimento,o.referencia,pg_temp.vv_uuid(2),null,papel); raise exception 'Browser vinculou mensagem.';
  exception when insufficient_privilege then null; end;
  begin perform pg_temp.vv_chamar('autorizar',o.atendimento,o.referencia,pg_temp.vv_uuid(2),'vendas',papel); raise exception 'Browser autorizou mensagem.';
  exception when insufficient_privilege then null; end;
 end loop;
 if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Sem necessidade de grants Auth.'; end if;
end $$;
rollback;
