-- A1.2b: lista/prévia/totais nascem do mesmo escopo atual, antes de paginação.
begin;
create function pg_temp.la_uuid(n integer) returns uuid language sql immutable as $$
 select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.la_estado() returns jsonb language sql as $$
 select jsonb_build_object(
  'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
  'conversas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.conversas t),
  'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
  'associacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t),
  'canais',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_canais t),
  'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t),
  'ops',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_oportunidades t),
  'cotacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes t)
 );
$$;
create function pg_temp.la_rpc(p_ator uuid,p_setor text,p_limite integer default 50,p_em timestamptz default null,p_id uuid default null,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
 if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
 execute format('set local role %I',p_papel);
 if current_user<>p_papel then raise exception 'Fixture não assumiu papel.'; end if;
 r:=public.listar_atendimentos(p_ator,p_setor,p_limite,p_em,p_id);
 reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.la_recusar(p_ator uuid,p_setor text,p_limite integer,p_em timestamptz,p_id uuid,p_codigo text)
returns void language plpgsql as $$
declare antes jsonb; r jsonb;
begin
 antes:=pg_temp.la_estado(); r:=pg_temp.la_rpc(p_ator,p_setor,p_limite,p_em,p_id);
 if r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo) then raise exception 'Esperado % sem dados/totais, obteve %.',p_codigo,r; end if;
 if pg_temp.la_estado() is distinct from antes then raise exception 'Lista recusada alterou dados.'; end if;
end $$;
create temporary table la_visiveis(ator integer,setor text,atendimento uuid,primary key(ator,setor,atendimento));
create temporary table la_previas(atendimento uuid primary key,total integer,revisao boolean,mensagem uuid);
create function pg_temp.la_conferir_dto(r jsonb,p_setor text,p_total integer,p_mensagens integer)
returns void language plpgsql as $$
declare campos text[]; item jsonb; base jsonb; previa jsonb; horario timestamptz; esperado record;
begin
 select array_agg(k order by k) into campos from jsonb_object_keys(r)k;
 if campos is distinct from array['atendimentos','ok','proximoCursor','setor','totalAtendimentos','totalMensagens']::text[]
  or r->>'ok' is distinct from 'true' or r->>'setor'<>p_setor or jsonb_typeof(r->'totalAtendimentos')<>'number'
  or jsonb_typeof(r->'totalMensagens')<>'number' or (r->>'totalAtendimentos')::integer<>p_total or (r->>'totalMensagens')::integer<>p_mensagens then raise exception 'DTO/totais globais incorretos: %.',r; end if;
 for item in select value from jsonb_array_elements(r->'atendimentos') loop
  select array_agg(k order by k) into campos from jsonb_object_keys(item)k;
  if campos is distinct from array['clienteNome','criadoEm','id','previa','registroId','revisaoPendente','setor','totalMensagens','unidade']::text[] then raise exception 'Item expôs dado indevido/omitiu campo: %.',campos; end if;
  select jsonb_build_object('id',a.id,'setor',a.setor,'registroId',coalesce(a.oportunidade_id,a.cotacao_id),'unidade',a.unidade,
   'clienteNome',coalesce(c.nome,'Cliente'),'totalMensagens',coalesce(p.total,0),'revisaoPendente',coalesce(p.revisao,false)) as corpo,a.criado_em as horario,
   p.mensagem into esperado
   from public.atendimentos_modulares a join public.clientes c on c.id=a.cliente_id
   left join pg_temp.la_previas p on p.atendimento=a.id where a.id=(item->>'id')::uuid;
  base:=esperado.corpo; horario:=esperado.horario;
  if item-array['criadoEm','previa']::text[] is distinct from base or (item->>'criadoEm')::timestamptz is distinct from horario then raise exception 'Snapshot/contagem por atendimento incorretos: %.',item; end if;
  if esperado.mensagem is null then
   if item->'previa'<>'null'::jsonb then raise exception 'Prévia vazou mensagem não autorizada/legada: %.',item; end if;
  else
   previa:=item->'previa'; select array_agg(k order by k) into campos from jsonb_object_keys(previa)k;
   if campos is distinct from array['autor','conteudo','criadoEm','direcao','id','status','tipo']::text[] then raise exception 'Prévia expôs campos indevidos: %.',campos; end if;
   select jsonb_build_object('id',m.id,'conteudo',m.conteudo,'tipo',m.tipo,'status',m.status,'direcao','entrada','autor','cliente'),m.criado_em into base,horario
    from public.mensagens m where m.id=esperado.mensagem;
   if previa-'criadoEm' is distinct from base or (previa->>'criadoEm')::timestamptz is distinct from horario then raise exception 'Prévia não é a última autorizada: %.',previa; end if;
  end if;
 end loop;
end $$;
create function pg_temp.la_validar(p_ator integer,p_setor text,p_paginar boolean default false)
returns void language plpgsql as $$
declare ids uuid[]; vistos uuid[]:=array[]::uuid[]; total integer; mensagens integer; r jsonb; item jsonb; cursor_em timestamptz; cursor_id uuid;
 ultimo jsonb; paginas integer:=0; antes jsonb;
begin
 select coalesce(array_agg(a.id order by a.criado_em desc,a.id desc),array[]::uuid[]),count(*),coalesce(sum(p.total),0)
  into ids,total,mensagens from pg_temp.la_visiveis v join public.atendimentos_modulares a on a.id=v.atendimento
  left join pg_temp.la_previas p on p.atendimento=a.id where v.ator=p_ator and v.setor=p_setor;
 antes:=pg_temp.la_estado();
 loop
  paginas:=paginas+1; if paginas>30 then raise exception 'Paginação não terminou.'; end if;
  r:=pg_temp.la_rpc(pg_temp.la_uuid(p_ator),p_setor,100,cursor_em,cursor_id);
  perform pg_temp.la_conferir_dto(r,p_setor,total,mensagens);
  for item in select value from jsonb_array_elements(r->'atendimentos') loop vistos:=array_append(vistos,(item->>'id')::uuid); ultimo:=item; end loop;
  if r->'proximoCursor'<>'null'::jsonb then
   if jsonb_array_length(r->'atendimentos')<>100 or r#>>'{proximoCursor,id}'<>ultimo->>'id'
    or (r#>>'{proximoCursor,criadoEm}')::timestamptz<>(ultimo->>'criadoEm')::timestamptz then raise exception 'Cursor não aponta último atendimento visível.'; end if;
   cursor_em:=(r#>>'{proximoCursor,criadoEm}')::timestamptz; cursor_id:=(r#>>'{proximoCursor,id}')::uuid;
  elsif cardinality(vistos)<total then raise exception 'Lista parou antes do total autorizado.';
  end if;
  exit when not p_paginar or r->'proximoCursor'='null'::jsonb;
 end loop;
 if vistos is distinct from (case when p_paginar then ids else ids[1:100] end) then raise exception 'Lista perdeu/duplicou/desordenou autorização: ator %, setor %, viu %, esperado %.',p_ator,p_setor,cardinality(vistos),total; end if;
 if pg_temp.la_estado() is distinct from antes then raise exception 'Lista alterou dados/nao_lidas/posse/auditoria.'; end if;
end $$;
create function pg_temp.la_diferencial(p_ator integer,p_setor text) returns void language plpgsql as $$
declare antigo uuid[]; novo uuid[];
begin
 set local role service_role;
 select coalesce(array_agg(a.id order by a.id),array[]::uuid[]) into antigo
  from public.atendimentos_modulares a cross join lateral public.contexto_atendimento_modular(a.setor,coalesce(a.oportunidade_id,a.cotacao_id),pg_temp.la_uuid(p_ator))c
  where a.setor=p_setor and a.cliente_id=c.cliente_id and a.conversa_id=c.conversa_id and a.unidade=c.unidade;
 select coalesce(array_agg(a.id order by a.id),array[]::uuid[]) into novo from public.atendimentos_legiveis(pg_temp.la_uuid(p_ator),p_setor)a;
 reset role;
 if antigo is distinct from novo then raise exception 'Helper de lista diverge do contexto+snapshots: ator %, setor %.',p_ator,p_setor; end if;
exception when others then reset role; raise;
end $$;

insert into public.unidades(chave,nome,ativa) values('la_principal','Principal fictícia',true),('la_fora','Outra fictícia',true),('la_inativa','Inativa fictícia',false),('la_canal','Canal físico fictício',true);
insert into auth.users(id) select pg_temp.la_uuid(n) from generate_series(1,17)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
 (pg_temp.la_uuid(1),'Vendedor A','vendedor','vendas','la_principal',true),(pg_temp.la_uuid(2),'Vendedor B','vendedor','vendas','la_principal',true),
 (pg_temp.la_uuid(3),'Peças A','pecas','pecas','la_principal',true),(pg_temp.la_uuid(4),'Peças B','pecas','pecas','la_principal',true),
 (pg_temp.la_uuid(5),'Gerente Vendas','gerente','vendas','la_principal',true),(pg_temp.la_uuid(6),'Gerente Peças','gerente','pecas','la_principal',true),
 (pg_temp.la_uuid(7),'Gerente administração extra','gerente','administracao','la_fora',true),(pg_temp.la_uuid(8),'Admin global','admin','administracao','la_fora',true),
 (pg_temp.la_uuid(9),'Vendedor inativo','vendedor','vendas','la_principal',false),(pg_temp.la_uuid(10),'Peças inativo','pecas','pecas','la_principal',false),
 (pg_temp.la_uuid(11),'Gerente Oficina','gerente','oficina','la_principal',true),(pg_temp.la_uuid(12),'Vendedor outra unidade','vendedor','vendas','la_fora',true),
 (pg_temp.la_uuid(13),'Peças outra unidade','pecas','pecas','la_fora',true),(pg_temp.la_uuid(14),'Vendedor extra','vendedor','vendas','la_fora',true),
 (pg_temp.la_uuid(15),'Peças extra','pecas','pecas','la_fora',true),(pg_temp.la_uuid(16),'Admin inativo','admin','administracao','la_fora',false),
 (pg_temp.la_uuid(17),'Recepção','recepcao','oficina','la_principal',true);
insert into public.usuario_unidades values(pg_temp.la_uuid(7),'la_principal'),(pg_temp.la_uuid(14),'la_principal'),(pg_temp.la_uuid(15),'la_principal');
insert into public.clientes(id,telefone,nome,vendedor_id,unidade_origem,anonimizado) values
 (pg_temp.la_uuid(101),'5511500000101','Cliente comum fictício',pg_temp.la_uuid(1),'la_principal',false),
 (pg_temp.la_uuid(102),'5511500000102','Cliente anonimizado fictício',pg_temp.la_uuid(1),'la_principal',true),
 (pg_temp.la_uuid(103),'5511500000103',null,pg_temp.la_uuid(1),'la_principal',false),
 (pg_temp.la_uuid(104),'5511500000104','Somente legado fictício',pg_temp.la_uuid(1),'la_principal',false);
insert into public.conversas(id,cliente_id,unidade,status,assumida_por,nao_lidas)
select pg_temp.la_uuid(n+100),pg_temp.la_uuid(n),'la_canal','bot','legado@example.invalid',77 from generate_series(101,104)n;
insert into public.vendas_funis(id,unidade,chave,nome,ativo) values
 (pg_temp.la_uuid(501),'la_principal','novos','Principal',true),(pg_temp.la_uuid(502),'la_fora','novos','Outra',true),
 (pg_temp.la_uuid(503),'la_inativa','novos','Inativa',true),(pg_temp.la_uuid(504),'la_principal','inativo','Funil inativo',false);
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values
 (pg_temp.la_uuid(601),pg_temp.la_uuid(501),'Aberta',1,'aberta'),(pg_temp.la_uuid(602),pg_temp.la_uuid(502),'Aberta',1,'aberta'),
 (pg_temp.la_uuid(603),pg_temp.la_uuid(503),'Aberta',1,'aberta'),(pg_temp.la_uuid(604),pg_temp.la_uuid(504),'Aberta',1,'aberta'),
 (pg_temp.la_uuid(605),pg_temp.la_uuid(501),'Ganha',2,'ganho');
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
select pg_temp.la_uuid(10000+n),'la_principal',pg_temp.la_uuid(501),pg_temp.la_uuid(601),pg_temp.la_uuid(case n when 1004 then 103 else 101 end),pg_temp.la_uuid(1),'fixture@example.invalid' from generate_series(1,1005)n;
insert into public.atendimentos_modulares(id,setor,oportunidade_id,conversa_id,cliente_id,unidade,criado_por,criado_em)
select pg_temp.la_uuid(20000+n),'vendas',pg_temp.la_uuid(10000+n),pg_temp.la_uuid(case n when 1004 then 203 else 201 end),pg_temp.la_uuid(case n when 1004 then 103 else 101 end),'la_principal',pg_temp.la_uuid(1),
 case n when 1002 then '2026-11-11T12:00:00.123457Z'::timestamptz when 1003 then '2026-11-11T12:00:00.123455Z'::timestamptz
  when 1004 then '2026-11-11T12:00:00.000001Z'::timestamptz when 1005 then '2026-11-11T12:00:00.999999Z'::timestamptz else '2026-11-11T12:00:00.123456Z'::timestamptz end from generate_series(1,1005)n;
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
select pg_temp.la_uuid(12000+n),case when n in(2,3) then 'la_fora' when n=9 then 'la_inativa' else 'la_principal' end,
 pg_temp.la_uuid(case when n in(2,3) then 502 when n=9 then 503 when n=13 then 504 else 501 end),
 pg_temp.la_uuid(case when n in(2,3) then 602 when n=9 then 603 when n=13 then 604 when n=7 then 605 else 601 end),
 pg_temp.la_uuid(case n when 8 then 102 else 101 end),case n when 6 then null when 1 then pg_temp.la_uuid(2) when 2 then pg_temp.la_uuid(12)
  when 4 then pg_temp.la_uuid(14) when 5 then pg_temp.la_uuid(9) else pg_temp.la_uuid(1) end,'fixture@example.invalid' from generate_series(1,13)n;
insert into public.atendimentos_modulares(id,setor,oportunidade_id,conversa_id,cliente_id,unidade,criado_por,criado_em)
select pg_temp.la_uuid(22000+n),'vendas',pg_temp.la_uuid(12000+n),pg_temp.la_uuid(case n when 8 then 202 when 12 then 203 else 201 end),
 pg_temp.la_uuid(case n when 8 then 102 when 11 then 103 else 101 end),case when n in(2,3,10) then 'la_fora' when n=9 then 'la_inativa' else 'la_principal' end,
 pg_temp.la_uuid(8),'2026-11-12T12:00:00.000001Z'::timestamptz from generate_series(1,13)n;
insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao,status,origem,origem_ref)
select pg_temp.la_uuid(4000+n),case n when 3 then 'la_fora' when 8 then 'la_inativa' else 'la_principal' end,
 pg_temp.la_uuid(case n when 7 then 102 else 101 end),case n when 5 then null when 2 then pg_temp.la_uuid(4) when 4 then pg_temp.la_uuid(15) else pg_temp.la_uuid(3) end,
 'Cotação fictícia '||n,case n when 6 then 'entregue' else 'novo' end,case n when 11 then 'balcao' else 'whatsapp' end,'wamid.la.pecas.'||n from generate_series(1,11)n;
insert into public.atendimentos_modulares(id,setor,cotacao_id,conversa_id,cliente_id,unidade,criado_por,criado_em)
select pg_temp.la_uuid(24000+n),'pecas',pg_temp.la_uuid(4000+n),pg_temp.la_uuid(case n when 7 then 202 else 201 end),pg_temp.la_uuid(case n when 7 then 102 else 101 end),
 case n when 3 then 'la_fora' when 8 then 'la_inativa' when 9 then 'la_fora' else 'la_principal' end,pg_temp.la_uuid(8),'2026-11-13T12:00:00.123456Z'::timestamptz from generate_series(1,11)n;

-- Provas coerentes das prévias: outras mensagens do mesmo cliente/canal nunca suprem associação.
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,tipo,metadata,criado_em)
select pg_temp.la_uuid(n),pg_temp.la_uuid(101),pg_temp.la_uuid(201),'wamid.la.vendas.'||n,'entrada','cliente',
 case n when 30005 then null else 'Mensagem fictícia '||n end,case n when 30005 then 'image' else 'text' end,'{"privado":"NÃO EXPOR"}',
 case n when 30001 then '2026-11-14T12:00:00.123455Z'::timestamptz when 30002 then '2026-11-14T12:00:00.123456Z'::timestamptz
  when 30003 then '2026-11-14T12:00:00.123457Z'::timestamptz else '2026-11-15T12:00:00Z'::timestamptz end
from unnest(array[30001,30002,30003,30004,30005,31001,31002,31003])n;
insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
select m.wamid,m.id,m.conversa_id,m.cliente_id,case when m.id in(pg_temp.la_uuid(31002),pg_temp.la_uuid(31003)) then 'la_fora' else 'la_principal' end,
 pg_temp.la_uuid(case when m.id=pg_temp.la_uuid(30004) then 10002 when m.id=pg_temp.la_uuid(30005) then 10003
  when m.id=pg_temp.la_uuid(31001) then 12001 when m.id=pg_temp.la_uuid(31002) then 12002 when m.id=pg_temp.la_uuid(31003) then 12003 else 10001 end),
 pg_temp.la_uuid(case when m.id in(pg_temp.la_uuid(31002),pg_temp.la_uuid(31003)) then 502 else 501 end),false from public.mensagens m;
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,oportunidade_id,setor,conversa_id,cliente_id,unidade,criado_por)
select e.mensagem_id,a.id,e.referencia,e.oportunidade_id,'vendas',e.conversa_id,e.cliente_id,e.unidade,pg_temp.la_uuid(8)
from public.vendas_encaminhamentos_bot e join public.atendimentos_modulares a on a.oportunidade_id=e.oportunidade_id;
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino) values
 ('wamid.la.vendas.30003',pg_temp.la_uuid(201),pg_temp.la_uuid(101),'la_principal','triagem');
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,criado_em)
select pg_temp.la_uuid(32000+n),pg_temp.la_uuid(101),pg_temp.la_uuid(201),'wamid.la.pecas.'||n,'entrada','cliente','Prévia Peças fictícia '||n,'2026-11-14T13:00:00Z' from unnest(array[1,2,3,10])n;
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino,cotacao_id)
select 'wamid.la.pecas.'||n,pg_temp.la_uuid(201),pg_temp.la_uuid(101),case n when 3 then 'la_fora' else 'la_principal' end,'pecas',pg_temp.la_uuid(4000+n) from unnest(array[1,2,3,10])n;
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,cotacao_id,setor,conversa_id,cliente_id,unidade,criado_por)
select pg_temp.la_uuid(32000+n),pg_temp.la_uuid(24000+n),'wamid.la.pecas.'||n,pg_temp.la_uuid(4000+n),'pecas',pg_temp.la_uuid(201),pg_temp.la_uuid(101),
 case n when 3 then 'la_fora' else 'la_principal' end,pg_temp.la_uuid(8) from unnest(array[1,2,3,10])n;
update public.pecas_cotacoes set origem='balcao' where id=pg_temp.la_uuid(4010);
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,metadata,criado_em) values
 (pg_temp.la_uuid(39997),pg_temp.la_uuid(104),pg_temp.la_uuid(204),'wamid.la.canal_sem_atendimento','entrada','cliente','CANAL LEGADO SEM ATENDIMENTO NÃO LISTAR','{}','2026-11-30'),
 (pg_temp.la_uuid(39998),pg_temp.la_uuid(101),pg_temp.la_uuid(201),'wamid.la.legada','entrada','cliente','LEGADO MAIS RECENTE NÃO EXIBIR','{}','2026-11-30'),
 (pg_temp.la_uuid(39999),pg_temp.la_uuid(101),pg_temp.la_uuid(201),'wamid.la.interna','entrada','cliente','NOTA INTERNA NÃO EXIBIR','{"interno":true}','2026-11-30');
insert into public.notas_cliente(cliente_id,autor,texto) values(pg_temp.la_uuid(101),'fixture','NOTA NÃO VIRA PRÉVIA');

-- Expectativas explícitas da fixture; não reutiliza o algoritmo do SQL implementado.
insert into pg_temp.la_visiveis select ator,'vendas',pg_temp.la_uuid(20000+n) from generate_series(1,1005)n cross join unnest(array[1,5,7,8])ator;
insert into pg_temp.la_visiveis(ator,setor,atendimento) select ator,'vendas',pg_temp.la_uuid(22000+n)
from (values(1,array[2,5,7,8]),(2,array[12,7,8]),(3,array[7,8]),(4,array[14,5,7,8]),(5,array[5,7,8]))x(n,atores) cross join lateral unnest(atores)ator;
insert into pg_temp.la_visiveis(ator,setor,atendimento) select ator,'pecas',pg_temp.la_uuid(24000+n)
from (values(1,array[3,6,7,8]),(2,array[4,6,7,8]),(3,array[7,8]),(4,array[15,6,7,8]),(10,array[3,6,7,8]),(11,array[3,6,7,8]))x(n,atores) cross join lateral unnest(atores)ator;
insert into pg_temp.la_previas values
 (pg_temp.la_uuid(20001),2,true,pg_temp.la_uuid(30002)),(pg_temp.la_uuid(20002),1,false,pg_temp.la_uuid(30004)),(pg_temp.la_uuid(20003),1,false,pg_temp.la_uuid(30005)),
 (pg_temp.la_uuid(22001),1,false,pg_temp.la_uuid(31001)),(pg_temp.la_uuid(22002),1,false,pg_temp.la_uuid(31002)),(pg_temp.la_uuid(22003),1,false,pg_temp.la_uuid(31003)),
 (pg_temp.la_uuid(24001),1,false,pg_temp.la_uuid(32001)),(pg_temp.la_uuid(24002),1,false,pg_temp.la_uuid(32002)),(pg_temp.la_uuid(24003),1,false,pg_temp.la_uuid(32003)),(pg_temp.la_uuid(24010),0,true,null);

select pg_temp.la_validar(1,'vendas',true);
do $$ declare ator integer; setor_atual text; begin
 foreach ator in array array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,999] loop
  foreach setor_atual in array array['vendas','pecas'] loop perform pg_temp.la_validar(ator,setor_atual); end loop;
 end loop;
 foreach ator in array array[1,3,5,6,7,8,9,14,15] loop
  foreach setor_atual in array array['vendas','pecas'] loop perform pg_temp.la_diferencial(ator,setor_atual); end loop;
 end loop;
end $$;

-- A origem mais recente torna-se ambígua: prévia recua, totais mudam antes da página.
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino) values('wamid.la.vendas.30002',pg_temp.la_uuid(201),pg_temp.la_uuid(101),'la_principal','triagem');
update pg_temp.la_previas set total=1,mensagem=pg_temp.la_uuid(30001) where atendimento=pg_temp.la_uuid(20001);
select pg_temp.la_validar(1,'vendas',true);

-- Limites e cursores exigem par exato de atendimento atualmente visível.
do $$ declare limite integer; begin
 foreach limite in array array[null,-1,0,101] loop perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',limite,null,null,'invalido'); end loop;
 perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,now(),null,'invalido');
 perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,null,pg_temp.la_uuid(20001),'invalido');
 perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,'infinity',pg_temp.la_uuid(20001),'invalido');
 perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,'-infinity',pg_temp.la_uuid(20001),'invalido');
 perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,(select criado_em from public.atendimentos_modulares where id=pg_temp.la_uuid(22001)),pg_temp.la_uuid(22001),'cursor_invalido');
 perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,'2026-11-11T12:00:00.123455Z',pg_temp.la_uuid(20001),'cursor_invalido');
 perform pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,'2026-11-11T12:00:00.123456Z',pg_temp.la_uuid(99999),'cursor_invalido');
end $$;

-- Transferir sem mover carteira revoga item/preview/denominador/cursor do antigo dono.
update public.vendas_oportunidades set vendedor_id=pg_temp.la_uuid(2) where id=pg_temp.la_uuid(10001);
delete from pg_temp.la_visiveis where ator=1 and atendimento=pg_temp.la_uuid(20001);
insert into pg_temp.la_visiveis values(2,'vendas',pg_temp.la_uuid(20001));
select pg_temp.la_validar(1,'vendas',true); select pg_temp.la_validar(2,'vendas');
select pg_temp.la_diferencial(1,'vendas'); select pg_temp.la_diferencial(2,'vendas');
select pg_temp.la_recusar(pg_temp.la_uuid(1),'vendas',50,'2026-11-11T12:00:00.123456Z',pg_temp.la_uuid(20001),'cursor_invalido');
delete from public.usuario_unidades where user_id in(pg_temp.la_uuid(14),pg_temp.la_uuid(15)) and unidade='la_principal';
delete from pg_temp.la_visiveis where ator in(14,15);
select pg_temp.la_validar(14,'vendas'); select pg_temp.la_validar(15,'pecas');
select pg_temp.la_diferencial(14,'vendas'); select pg_temp.la_diferencial(15,'pecas');

do $$
declare assinatura text; papel text; f record;
begin
 if (select vendedor_id from public.clientes where id=pg_temp.la_uuid(101))<>pg_temp.la_uuid(1) then raise exception 'Fixture precisa conservar carteira antiga.'; end if;
 if (select count(*) from public.atendimentos_modulares where setor='vendas' and criado_em='2026-11-11T12:00:00.123456Z')<>1001 then raise exception 'Fixture precisa de 1001 empates.'; end if;
 foreach assinatura in array array['public.listar_atendimentos(uuid,text,integer,timestamp with time zone,uuid)',
  'public.atendimentos_legiveis(uuid,text)','public.associacoes_mensagens_atendimento(uuid,text)'] loop
  select prosecdef,proconfig,proacl,proowner,provolatile into f from pg_proc where oid=assinatura::regprocedure;
  if f.prosecdef or not coalesce(f.proconfig&&array['search_path=""','search_path='],false)
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Invoker/search_path/ACL incorreto: %.',assinatura; end if;
  if assinatura not like '%listar_%' and f.provolatile<>'s' then raise exception 'Helper de lista deve ser STABLE.'; end if;
  if not has_function_privilege('service_role',assinatura,'EXECUTE') then raise exception 'Servidor sem função necessária.'; end if;
  foreach papel in array array['anon','authenticated'] loop if has_function_privilege(papel,assinatura,'EXECUTE') then raise exception 'Função exposta ao browser.'; end if; end loop;
 end loop;
 foreach papel in array array['anon','authenticated'] loop
  begin perform pg_temp.la_rpc(pg_temp.la_uuid(1),'vendas',50,null,null,papel); raise exception 'Browser listou atendimentos.';
  exception when insufficient_privilege then null; end;
 end loop;
 if not exists(select 1 from pg_class where oid='public.atendimento_mensagens'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.atendimento_mensagens'::regclass) then raise exception 'Associações precisam manter RLS fechado.'; end if;
 if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Sem necessidade de grants Auth.'; end if;
end $$;
rollback;
