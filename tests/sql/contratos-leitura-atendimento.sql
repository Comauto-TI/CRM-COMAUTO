-- Banco descartável: módulos 0001/0002/0003/0005/0006, nessa ordem.
-- A1.2a: leitura somente das associações atuais autorizadas; cursor preserva microssegundos.
begin;
create function pg_temp.lr_uuid(n integer) returns uuid language sql immutable as $$
 select ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.lr_estado() returns jsonb language sql as $$
 select jsonb_build_object(
  'conversas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.conversas t),
  'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
  'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
  'canais',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_canais t),
  'vinculos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t),
  'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t)
 );
$$;
create function pg_temp.lr_rpc(p_id uuid,p_ator uuid,p_setor text,p_limite integer default 50,p_em timestamptz default null,p_cursor uuid default null,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
 if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
 execute format('set local role %I',p_papel);
 if current_user<>p_papel then raise exception 'Fixture não mudou o papel.'; end if;
 r:=public.ler_mensagens_atendimento(p_id,p_ator,p_setor,p_limite,p_em,p_cursor);
 reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.lr_recusar(p_id uuid,p_ator uuid,p_setor text,p_limite integer default 50,p_em timestamptz default null,p_cursor uuid default null,p_codigo text default 'nao_encontrado')
returns void language plpgsql as $$
declare antes jsonb; r jsonb;
begin
 antes:=pg_temp.lr_estado(); r:=pg_temp.lr_rpc(p_id,p_ator,p_setor,p_limite,p_em,p_cursor);
 if r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo) then raise exception 'Esperado % sem dados/total, obteve %.',p_codigo,r; end if;
 if pg_temp.lr_estado() is distinct from antes then raise exception 'Leitura recusada alterou estado.'; end if;
end $$;
create temporary table lr_contextos(chave text primary key,atendimento uuid,registro uuid,setor text,cliente uuid,conversa uuid,referencia text,mensagem uuid);
create function pg_temp.lr_preparar(p_chave text,p_cliente uuid,p_conversa uuid,p_ref text,p_msg uuid,p_setor text,p_dono uuid,p_funil text default 'novos',p_vincular boolean default true)
returns void language plpgsql as $$
declare r jsonb; registro uuid; atendimento uuid;
begin
 set local role service_role;
 if p_setor='pecas' then r:=public.encaminhar_lead_bot(p_conversa,p_cliente,p_ref,'pecas','Pedido fictício '||p_chave);
 else r:=public.registrar_lead_vendas_bot(p_conversa,p_cliente,p_ref,p_funil,null,'indefinido','indefinido',null,null,'Lead fictício '||p_chave,false); end if;
 reset role;
 if r->>'ok' is distinct from 'true' then raise exception 'Fonte real não criada para %: %.',p_chave,r; end if;
 registro:=coalesce(r->>'cotacao_id',r->>'oportunidade_id')::uuid;
 if p_setor='pecas' then update public.pecas_cotacoes set responsavel_id=p_dono where id=registro;
 else update public.vendas_oportunidades set vendedor_id=p_dono where id=registro; end if;
 set local role service_role;
 r:=public.abrir_atendimento_modular(p_setor,registro,p_dono); reset role;
 if r->>'ok' is distinct from 'true' then raise exception 'Atendimento não abriu para %: %.',p_chave,r; end if;
 atendimento:=(r->>'id')::uuid;
 insert into pg_temp.lr_contextos values(p_chave,atendimento,registro,p_setor,p_cliente,p_conversa,p_ref,p_msg);
 if p_vincular then
  set local role service_role;
  if p_setor='pecas' then r:=public.vincular_mensagem_encaminhada(atendimento,p_ref,p_dono);
  else r:=public.vincular_mensagem_vendas(atendimento,p_ref,p_dono); end if;
  reset role;
  if r->>'ok' is distinct from 'true' then raise exception 'Associação não criada para %: %.',p_chave,r; end if;
 end if;
exception when others then reset role; raise;
end $$;
create function pg_temp.lr_conferir_dto(r jsonb,p_id uuid,p_setor text,p_total integer,p_revisao boolean)
returns void language plpgsql as $$
declare item jsonb; campos text[]; esperado jsonb; horario timestamptz;
begin
 select array_agg(k order by k) into campos from jsonb_object_keys(r)k;
 if campos is distinct from array['atendimentoId','mensagens','ok','proximoCursor','revisaoPendente','setor','total']::text[]
  or r->>'ok' is distinct from 'true' or r->>'atendimentoId'<>p_id::text or r->>'setor'<>p_setor
  or (r->>'total')::integer<>p_total or (r->>'revisaoPendente')::boolean is distinct from p_revisao then raise exception 'Contrato da leitura incorreto: %.',r; end if;
 for item in select value from jsonb_array_elements(r->'mensagens') loop
  select array_agg(k order by k) into campos from jsonb_object_keys(item)k;
  if campos is distinct from array['autor','conteudo','criadoEm','direcao','id','status','tipo']::text[] then raise exception 'DTO expôs dado indevido ou omitiu campo: %.',campos; end if;
  select jsonb_build_object('id',m.id,'conteudo',m.conteudo,'tipo',m.tipo,'status',m.status,'direcao','entrada','autor','cliente'),m.criado_em
   into esperado,horario from public.mensagens m where m.id=(item->>'id')::uuid;
  if item-'criadoEm' is distinct from esperado or (item->>'criadoEm')!~'^\d{4}-\d{2}-\d{2}T'
   or (item->>'criadoEm')::timestamptz is distinct from horario then raise exception 'Conteúdo/timestamp do DTO incorreto: %.',item; end if;
 end loop;
end $$;
create function pg_temp.lr_paginar(p_id uuid,p_ator uuid,p_setor text,p_esperados uuid[],p_revisao boolean default false)
returns void language plpgsql as $$
declare r jsonb; item jsonb; vistos uuid[]:=array[]::uuid[]; cursor_em timestamptz; cursor_id uuid; paginas integer:=0; antes jsonb; ultimo jsonb;
begin
 antes:=pg_temp.lr_estado();
 loop
  paginas:=paginas+1; if paginas>30 then raise exception 'Paginação não terminou.'; end if;
  r:=pg_temp.lr_rpc(p_id,p_ator,p_setor,100,cursor_em,cursor_id);
  perform pg_temp.lr_conferir_dto(r,p_id,p_setor,cardinality(p_esperados),p_revisao);
  if jsonb_array_length(r->'mensagens')>100 then raise exception 'Página excedeu limite.'; end if;
  for item in select value from jsonb_array_elements(r->'mensagens') loop vistos:=array_append(vistos,(item->>'id')::uuid); ultimo:=item; end loop;
  exit when r->'proximoCursor'='null'::jsonb;
  if jsonb_array_length(r->'mensagens')<>100 or r#>>'{proximoCursor,id}'<>ultimo->>'id'
   or (r#>>'{proximoCursor,criadoEm}')::timestamptz<>(ultimo->>'criadoEm')::timestamptz then raise exception 'Cursor não aponta o último item visível.'; end if;
  -- Mantém o texto ISO até o cast PostgreSQL: jamais passa por Date JS que perderia os microssegundos.
  cursor_em:=(r#>>'{proximoCursor,criadoEm}')::timestamptz; cursor_id:=(r#>>'{proximoCursor,id}')::uuid;
 end loop;
 if vistos is distinct from p_esperados then raise exception 'Paginação perdeu/duplicou/desordenou mensagens: viu %, esperava %.',cardinality(vistos),cardinality(p_esperados); end if;
 if pg_temp.lr_estado() is distinct from antes then raise exception 'Leitura paginada alterou nao_lidas/posse/mensagem/auditoria.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values('lr_principal','Leitura principal fictícia',true),('lr_fora','Leitura fora fictícia',true),('lr_inativa','Leitura inativa fictícia',false);
insert into auth.users(id) select pg_temp.lr_uuid(n) from generate_series(1,15)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
 (pg_temp.lr_uuid(1),'Vendedor A','vendedor','vendas','lr_principal',true),
 (pg_temp.lr_uuid(2),'Vendedor B','vendedor','vendas','lr_principal',true),
 (pg_temp.lr_uuid(3),'Peças','pecas','pecas','lr_principal',true),
 (pg_temp.lr_uuid(4),'Gerente Vendas','gerente','vendas','lr_principal',true),
 (pg_temp.lr_uuid(5),'Gerente Peças','gerente','pecas','lr_principal',true),
 (pg_temp.lr_uuid(6),'Gerente administração extra','gerente','administracao','lr_fora',true),
 (pg_temp.lr_uuid(7),'Admin global','admin','administracao','lr_fora',true),
 (pg_temp.lr_uuid(8),'Vendedor inativo','vendedor','vendas','lr_principal',false),
 (pg_temp.lr_uuid(9),'Vendedor fora','vendedor','vendas','lr_fora',true),
 (pg_temp.lr_uuid(10),'Gerente Oficina','gerente','oficina','lr_principal',true),
 (pg_temp.lr_uuid(11),'Admin inativo','admin','administracao','lr_fora',false),
 (pg_temp.lr_uuid(12),'Vendedor extra','vendedor','vendas','lr_fora',true),
 (pg_temp.lr_uuid(13),'Peças extra','pecas','pecas','lr_fora',true),
 (pg_temp.lr_uuid(14),'Outro Peças','pecas','pecas','lr_principal',true),
 (pg_temp.lr_uuid(15),'Recepção','recepcao','oficina','lr_principal',true);
insert into public.usuario_unidades values(pg_temp.lr_uuid(6),'lr_principal'),(pg_temp.lr_uuid(12),'lr_principal'),(pg_temp.lr_uuid(13),'lr_principal');
insert into public.clientes(id,telefone,nome,vendedor_id,unidade_origem)
select pg_temp.lr_uuid(n),'5511600'||lpad(n::text,6,'0'),'Cliente fictício '||n,pg_temp.lr_uuid(case n when 102 then 2 else 1 end),'lr_principal' from generate_series(101,104)n;
insert into public.conversas(id,cliente_id,unidade,status,nao_lidas)
select pg_temp.lr_uuid(n+100),pg_temp.lr_uuid(n),'lr_principal','humano',73 from generate_series(101,104)n;
insert into public.vendas_funis(id,unidade,chave,nome) values(pg_temp.lr_uuid(501),'lr_principal','novos','Novos fictício'),(pg_temp.lr_uuid(502),'lr_principal','seminovos','Seminovos fictício');
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values(pg_temp.lr_uuid(601),pg_temp.lr_uuid(501),'Aberta',1,'aberta'),(pg_temp.lr_uuid(602),pg_temp.lr_uuid(502),'Aberta',1,'aberta'),(pg_temp.lr_uuid(603),pg_temp.lr_uuid(501),'Ganha',2,'ganho');
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,tipo,status,metadata,criado_em)
select pg_temp.lr_uuid(10000+n),pg_temp.lr_uuid(101),pg_temp.lr_uuid(201),'wamid.lr.main.'||n,'entrada','cliente',
 case n when 500 then null else 'Mensagem fictícia '||n end,case n when 500 then 'image' else 'text' end,
 case n when 1005 then 'lida' else 'recebida' end,'{"privado":"NÃO EXPOR","telefone":"5511900000000"}'::jsonb,
 case n when 1002 then '2026-11-11T12:00:00.123457Z'::timestamptz when 1003 then '2026-11-11T12:00:00.123455Z'::timestamptz
  when 1004 then '2026-11-11T12:00:00.000001Z'::timestamptz when 1005 then '2026-11-11T12:00:00.999999Z'::timestamptz else '2026-11-11T12:00:00.123456Z'::timestamptz end
from generate_series(1,1005)n;
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,metadata)
values(pg_temp.lr_uuid(20001),pg_temp.lr_uuid(101),pg_temp.lr_uuid(201),'wamid.lr.outro_negocio','entrada','cliente','Outro negócio mesmo canal','{}'),
 (pg_temp.lr_uuid(20002),pg_temp.lr_uuid(101),pg_temp.lr_uuid(201),'wamid.lr.pecas','entrada','cliente','Peças mesmo cliente/canal','{}'),
 (pg_temp.lr_uuid(20003),pg_temp.lr_uuid(102),pg_temp.lr_uuid(202),'wamid.lr.outro_cliente','entrada','cliente','Outro cliente','{}'),
 (pg_temp.lr_uuid(20004),pg_temp.lr_uuid(103),pg_temp.lr_uuid(203),'wamid.lr.zero','entrada','cliente','Ainda não associado','{}'),
 (pg_temp.lr_uuid(20005),pg_temp.lr_uuid(103),pg_temp.lr_uuid(203),'wamid.lr.interna','entrada','cliente','INTERNO NÃO EXIBIR','{"interno":true}'),
 (pg_temp.lr_uuid(20006),pg_temp.lr_uuid(104),pg_temp.lr_uuid(204),'wamid.lr.ambigua_sem_vinculo','entrada','cliente','Sem associação','{}'),
 (pg_temp.lr_uuid(20007),pg_temp.lr_uuid(101),pg_temp.lr_uuid(201),'wamid.lr.sem_prova','entrada','cliente','HISTÓRICO SEM PROVA NÃO EXIBIR','{}');
insert into public.notas_cliente(cliente_id,autor,texto) values(pg_temp.lr_uuid(101),'fixture','NOTA INTERNA NÃO EXIBIR');
select pg_temp.lr_preparar('principal',pg_temp.lr_uuid(101),pg_temp.lr_uuid(201),'wamid.lr.main.1',pg_temp.lr_uuid(10001),'vendas',pg_temp.lr_uuid(1));
-- Bulk fixture coerente usa as FKs reais: cada mensagem tem seu ledger e associação próprios.
insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
select 'wamid.lr.main.'||n,pg_temp.lr_uuid(10000+n),pg_temp.lr_uuid(201),pg_temp.lr_uuid(101),'lr_principal',c.registro,pg_temp.lr_uuid(501),false
from generate_series(2,1005)n cross join pg_temp.lr_contextos c where c.chave='principal';
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,cotacao_id,oportunidade_id,setor,conversa_id,cliente_id,unidade,criado_por)
select pg_temp.lr_uuid(10000+n),c.atendimento,'wamid.lr.main.'||n,null,c.registro,'vendas',pg_temp.lr_uuid(201),pg_temp.lr_uuid(101),'lr_principal',pg_temp.lr_uuid(1)
from generate_series(2,1005)n cross join pg_temp.lr_contextos c where c.chave='principal';
select pg_temp.lr_preparar('outro_negocio',pg_temp.lr_uuid(101),pg_temp.lr_uuid(201),'wamid.lr.outro_negocio',pg_temp.lr_uuid(20001),'vendas',pg_temp.lr_uuid(2),'seminovos');
select pg_temp.lr_preparar('pecas',pg_temp.lr_uuid(101),pg_temp.lr_uuid(201),'wamid.lr.pecas',pg_temp.lr_uuid(20002),'pecas',pg_temp.lr_uuid(3));
select pg_temp.lr_preparar('outro_cliente',pg_temp.lr_uuid(102),pg_temp.lr_uuid(202),'wamid.lr.outro_cliente',pg_temp.lr_uuid(20003),'vendas',pg_temp.lr_uuid(2));
select pg_temp.lr_preparar('zero',pg_temp.lr_uuid(103),pg_temp.lr_uuid(203),'wamid.lr.zero',pg_temp.lr_uuid(20004),'vendas',pg_temp.lr_uuid(1),'novos',false);
select pg_temp.lr_preparar('ambigua_sem_vinculo',pg_temp.lr_uuid(104),pg_temp.lr_uuid(204),'wamid.lr.ambigua_sem_vinculo',pg_temp.lr_uuid(20006),'vendas',pg_temp.lr_uuid(1),'novos',false);
set local role service_role;
select public.encaminhar_lead_bot('80000000-0000-4000-8000-000000000204','80000000-0000-4000-8000-000000000104','wamid.lr.ambigua_sem_vinculo','triagem','Triagem fictícia sem associação');
reset role;

-- Completa 1005 itens, inclusive microssegundos e NULL, sem perder empates ou trazer outro negócio.
do $$
declare c record; esperados uuid[]; r jsonb; antes jsonb; papel integer;
begin
 select * into c from pg_temp.lr_contextos where chave='principal';
 select array_agg(m.id order by m.criado_em desc,m.id desc) into esperados from public.mensagens m where m.wamid like 'wamid.lr.main.%';
 perform pg_temp.lr_paginar(c.atendimento,pg_temp.lr_uuid(1),'vendas',esperados);
 foreach papel in array array[4,6,7] loop
  antes:=pg_temp.lr_estado(); r:=pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(papel),'vendas',1);
  perform pg_temp.lr_conferir_dto(r,c.atendimento,'vendas',1005,false);
  if jsonb_array_length(r->'mensagens')<>1 or pg_temp.lr_estado() is distinct from antes then raise exception 'Supervisor/admin teve leitura incorreta ou mutação.'; end if;
 end loop;
 if (select count(*) from public.mensagens where wamid like 'wamid.lr.main.%' and criado_em='2026-11-11T12:00:00.123456Z')<>1001 then raise exception 'Fixture de empates precisa de 1001 registros.'; end if;
 if exists(select 1 from public.atendimentos_modulares where id=c.atendimento and assumido_por is not null)
  or exists(select 1 from public.atendimento_canais where atendimento_id=c.atendimento) then raise exception 'Leitura não exige nem adquire claim de envio.'; end if;
end $$;
do $$
declare c record; r jsonb; antes jsonb;
begin
 for c in select * from pg_temp.lr_contextos where chave in('zero','ambigua_sem_vinculo') loop
  if c.chave='ambigua_sem_vinculo' and (not exists(select 1 from public.encaminhamentos_bot where referencia=c.referencia)
   or not exists(select 1 from public.vendas_encaminhamentos_bot where referencia=c.referencia)) then raise exception 'Fixture ambígua exige os dois ledgers.'; end if;
  antes:=pg_temp.lr_estado(); r:=pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(1),'vendas');
  perform pg_temp.lr_conferir_dto(r,c.atendimento,'vendas',0,false);
  if r->'mensagens'<>'[]'::jsonb or r->'proximoCursor'<>'null'::jsonb or pg_temp.lr_estado() is distinct from antes then raise exception 'Sem associação deve ser vazio, sem revisão ou mutação.'; end if;
 end loop;
 select * into c from pg_temp.lr_contextos where chave='pecas';
 antes:=pg_temp.lr_estado(); r:=pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(3),'pecas');
 perform pg_temp.lr_conferir_dto(r,c.atendimento,'pecas',1,false);
 if jsonb_array_length(r->'mensagens')<>1 or r#>>'{mensagens,0,id}'<>c.mensagem::text or pg_temp.lr_estado() is distinct from antes then raise exception 'Leitura Peças trouxe conteúdo de outro negócio.'; end if;
end $$;

-- Entradas e cursores inválidos nunca retornam total/dados de mensagens.
do $$
declare c record; outro record; limite integer;
begin
 select * into c from pg_temp.lr_contextos where chave='principal'; select * into outro from pg_temp.lr_contextos where chave='outro_negocio';
 foreach limite in array array[null,0,-1,101] loop perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',limite,null,null,'invalido'); end loop;
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',50,now(),null,'invalido');
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',50,null,pg_temp.lr_uuid(10001),'invalido');
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',50,'infinity',pg_temp.lr_uuid(10001),'invalido');
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',50,'-infinity',pg_temp.lr_uuid(10001),'invalido');
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',50,(select criado_em from public.mensagens where id=outro.mensagem),outro.mensagem,'cursor_invalido');
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',50,'2026-11-11T12:00:00.123455Z',pg_temp.lr_uuid(10001),'cursor_invalido');
end $$;

-- Interna depois do vínculo não é estado íntegro: a FK bloqueia sem desativar constraints.
do $$
declare antes jsonb; lancou boolean:=false;
begin
 antes:=pg_temp.lr_estado();
 begin update public.mensagens set metadata='{"interno":true}'::jsonb where id=pg_temp.lr_uuid(10001);
 exception when foreign_key_violation then lancou:=true; end;
 if not lancou or pg_temp.lr_estado() is distinct from antes then raise exception 'FK não preservou mensagem externa vinculada.'; end if;
end $$;

-- Segunda origem chega depois: omite ANTES da paginação, flag sem IDs/contagens omitidas.
set local role service_role;
select public.encaminhar_lead_bot('80000000-0000-4000-8000-000000000201','80000000-0000-4000-8000-000000000101','wamid.lr.main.1002','triagem','Origem ambígua fictícia');
reset role;
do $$
declare c record; esperados uuid[];
begin
 select * into c from pg_temp.lr_contextos where chave='principal';
 select array_agg(m.id order by m.criado_em desc,m.id desc) into esperados from public.mensagens m where m.wamid like 'wamid.lr.main.%' and id<>pg_temp.lr_uuid(11002);
 perform pg_temp.lr_paginar(c.atendimento,pg_temp.lr_uuid(1),'vendas',esperados,true);
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'vendas',50,'2026-11-11T12:00:00.123457Z',pg_temp.lr_uuid(11002),'cursor_invalido');
end $$;
-- Peças: origem alterada e depois ambiguidade preservam a associação, omitindo-a da leitura.
update public.pecas_cotacoes set origem='balcao' where id=(select registro from pg_temp.lr_contextos where chave='pecas');
do $$
declare c record; r jsonb; antes jsonb;
begin
 select * into c from pg_temp.lr_contextos where chave='pecas'; antes:=pg_temp.lr_estado();
 r:=pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(3),'pecas'); perform pg_temp.lr_conferir_dto(r,c.atendimento,'pecas',0,true);
 if r->'mensagens'<>'[]'::jsonb or r->'proximoCursor'<>'null'::jsonb or pg_temp.lr_estado() is distinct from antes then raise exception 'Origem alterada não foi omitida sem mutação.'; end if;
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(3),'pecas',50,(select criado_em from public.mensagens where id=c.mensagem),c.mensagem,'cursor_invalido');
end $$;
update public.pecas_cotacoes set origem='whatsapp' where id=(select registro from pg_temp.lr_contextos where chave='pecas');
set local role service_role;
select public.registrar_lead_vendas_bot('80000000-0000-4000-8000-000000000201','80000000-0000-4000-8000-000000000101','wamid.lr.pecas','novos',null,'indefinido','indefinido',null,null,'Segunda origem fictícia Peças',false);
reset role;
do $$
declare c record; r jsonb;
begin select * into c from pg_temp.lr_contextos where chave='pecas';
 r:=pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(3),'pecas'); perform pg_temp.lr_conferir_dto(r,c.atendimento,'pecas',0,true);
end $$;

-- Permissões atuais; transferência sem carteira não mantém leitura do antigo vendedor.
do $$
declare c record; ator integer;
begin
 select * into c from pg_temp.lr_contextos where chave='principal';
 foreach ator in array array[2,3,5,8,9,10,11,14,15] loop perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(ator),'vendas'); end loop;
 perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(1),'pecas');
 select * into c from pg_temp.lr_contextos where chave='pecas';
 foreach ator in array array[1,2,4,8,9,10,11,14,15] loop perform pg_temp.lr_recusar(c.atendimento,pg_temp.lr_uuid(ator),'pecas'); end loop;
end $$;
delete from public.usuario_unidades where user_id=pg_temp.lr_uuid(6) and unidade='lr_principal';
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(6),setor) from pg_temp.lr_contextos where chave='principal';
update public.vendas_oportunidades set vendedor_id=pg_temp.lr_uuid(2) where id=(select registro from pg_temp.lr_contextos where chave='principal');
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(1),'vendas') from pg_temp.lr_contextos where chave='principal';
do $$
declare c record; r jsonb;
begin select * into c from pg_temp.lr_contextos where chave='principal';
 r:=pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(2),'vendas'); perform pg_temp.lr_conferir_dto(r,c.atendimento,'vendas',1004,true);
 if (select vendedor_id from public.clientes where id=c.cliente)<>pg_temp.lr_uuid(1) then raise exception 'Fixture deve manter carteira antiga.'; end if;
end $$;
update public.vendas_oportunidades set vendedor_id=pg_temp.lr_uuid(12) where id=(select registro from pg_temp.lr_contextos where chave='principal');
delete from public.usuario_unidades where user_id=pg_temp.lr_uuid(12) and unidade='lr_principal';
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(12),'vendas') from pg_temp.lr_contextos where chave='principal';
update public.vendas_oportunidades set vendedor_id=pg_temp.lr_uuid(2) where id=(select registro from pg_temp.lr_contextos where chave='principal');
update public.pecas_cotacoes set responsavel_id=pg_temp.lr_uuid(13) where id=(select registro from pg_temp.lr_contextos where chave='pecas');
do $$
declare c record; r jsonb;
begin select * into c from pg_temp.lr_contextos where chave='pecas';
 r:=pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(13),'pecas'); perform pg_temp.lr_conferir_dto(r,c.atendimento,'pecas',0,true);
end $$;
delete from public.usuario_unidades where user_id=pg_temp.lr_uuid(13) and unidade='lr_principal';
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(13),'pecas') from pg_temp.lr_contextos where chave='pecas';
update public.usuarios set ativo=false where user_id=pg_temp.lr_uuid(2);
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(2),'vendas') from pg_temp.lr_contextos where chave='principal';
update public.usuarios set ativo=true where user_id=pg_temp.lr_uuid(2);
update public.clientes set anonimizado=true where id=pg_temp.lr_uuid(101);
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(7),setor) from pg_temp.lr_contextos where chave in('principal','pecas');
update public.clientes set anonimizado=false where id=pg_temp.lr_uuid(101);
update public.unidades set ativa=false where chave='lr_principal';
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(7),setor) from pg_temp.lr_contextos where chave in('principal','pecas');
update public.unidades set ativa=true where chave='lr_principal';
update public.atendimentos_modulares set unidade='lr_fora' where id=(select atendimento from pg_temp.lr_contextos where chave='zero');
select pg_temp.lr_recusar(atendimento,pg_temp.lr_uuid(1),'vendas') from pg_temp.lr_contextos where chave='zero';

do $$
declare assinatura text; papel text; f record; c record;
begin
 foreach assinatura in array array['public.ler_mensagens_atendimento(uuid,uuid,text,integer,timestamp with time zone,uuid)',
  'public.prova_origem_mensagem_atendimento(uuid,text,text)'] loop
  select prosecdef,proconfig,proacl,proowner,provolatile into f from pg_proc where oid=assinatura::regprocedure;
  if f.prosecdef or not coalesce(f.proconfig&&array['search_path=""','search_path='],false)
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Invoker/search_path/ACL incorreto: %.',assinatura; end if;
  if assinatura like '%prova_%' and f.provolatile<>'s' then raise exception 'Prova de origem deve ser STABLE.'; end if;
  if not has_function_privilege('service_role',assinatura,'EXECUTE') then raise exception 'Servidor sem função necessária.'; end if;
  foreach papel in array array['anon','authenticated'] loop if has_function_privilege(papel,assinatura,'EXECUTE') then raise exception 'Função exposta ao browser.'; end if; end loop;
 end loop;
 select * into c from pg_temp.lr_contextos where chave='principal';
 foreach papel in array array['anon','authenticated'] loop
  begin perform pg_temp.lr_rpc(c.atendimento,pg_temp.lr_uuid(2),'vendas',50,null,null,papel); raise exception 'Browser leu mensagens.';
  exception when insufficient_privilege then null; end;
 end loop;
 if not exists(select 1 from pg_class where oid='public.atendimento_mensagens'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.atendimento_mensagens'::regclass) then raise exception 'Associação perdeu RLS fechado.'; end if;
 if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Sem necessidade de grants Auth.'; end if;
end $$;
rollback;
