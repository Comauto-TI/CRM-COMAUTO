-- A1.2c: marcas por mensagem/usuário, escopo atual e lotes explícitos atômicos.
begin;
create function pg_temp.lu_uuid(n integer) returns uuid language sql immutable as $$
 select ('a0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.lu_estado() returns jsonb language sql as $$
 select jsonb_build_object(
  'leituras',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_leituras t),
  'conversas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.conversas t),
  'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
  'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
  'canais',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_canais t),
  'vinculos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t),
  'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t)
 );
$$;
create function pg_temp.lu_rpc(p_op text,p_id uuid,p_ator uuid,p_setor text,p_ids uuid[] default null,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
 if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
 execute format('set local role %I',p_papel);
 if current_user<>p_papel then raise exception 'Fixture não mudou papel.'; end if;
 if p_op='obter' then r:=public.obter_leitura_atendimento(p_id,p_ator,p_setor);
 elsif p_op='marcar' then r:=public.marcar_mensagens_lidas_atendimento(p_id,p_ator,p_setor,p_ids);
 elsif p_op='resumo' then r:=public.resumir_leituras_atendimentos(p_ator,p_setor);
 else raise exception 'Operação inválida na fixture.'; end if;
 reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.lu_obter(p_id uuid,p_ator integer,p_setor text,p_total integer,p_lidas integer,p_revisao boolean default false)
returns void language plpgsql as $$
declare antes jsonb; r jsonb;
begin
 antes:=pg_temp.lu_estado(); r:=pg_temp.lu_rpc('obter',p_id,pg_temp.lu_uuid(p_ator),p_setor);
 if r is distinct from jsonb_build_object('ok',true,'atendimentoId',p_id,'setor',p_setor,'total',p_total,'lidas',p_lidas,'naoLidas',p_total-p_lidas,'revisaoPendente',p_revisao) then
  raise exception 'Estatística pessoal incorreta/exposição de dados: %.',r; end if;
 if pg_temp.lu_estado() is distinct from antes then raise exception 'Estatística GET gravou estado.'; end if;
end $$;
create function pg_temp.lu_resumir(p_ator integer,p_setor text,p_atendimentos integer,p_total integer,p_lidas integer,p_com_nao_lidas integer,p_revisao boolean default false)
returns void language plpgsql as $$
declare antes jsonb; r jsonb;
begin
 antes:=pg_temp.lu_estado(); r:=pg_temp.lu_rpc('resumo',null,pg_temp.lu_uuid(p_ator),p_setor);
 if r is distinct from jsonb_build_object('ok',true,'setor',p_setor,'totalAtendimentos',p_atendimentos,'totalMensagens',p_total,
  'lidas',p_lidas,'naoLidas',p_total-p_lidas,'atendimentosComNaoLidas',p_com_nao_lidas,'revisaoPendente',p_revisao) then raise exception 'Resumo pessoal/escopo incorreto: %.',r; end if;
 if pg_temp.lu_estado() is distinct from antes then raise exception 'Resumo GET gravou estado.'; end if;
end $$;
create function pg_temp.lu_marcar(p_id uuid,p_ator integer,p_setor text,p_ids uuid[],p_marcadas integer)
returns void language plpgsql as $$
declare antes jsonb; depois jsonb; r jsonb;
begin
 antes:=pg_temp.lu_estado(); r:=pg_temp.lu_rpc('marcar',p_id,pg_temp.lu_uuid(p_ator),p_setor,p_ids); depois:=pg_temp.lu_estado();
 if r is distinct from jsonb_build_object('ok',true,'atendimentoId',p_id,'setor',p_setor,'marcadas',p_marcadas) then raise exception 'Contrato de marcação incorreto: %.',r; end if;
 if jsonb_array_length(depois->'leituras')-jsonb_array_length(antes->'leituras')<>p_marcadas then raise exception 'Contagem de inserts da marcação incorreta.'; end if;
 if antes-'leituras' is distinct from depois-'leituras' then raise exception 'Marca alterou canal/status/posse/auditoria global.'; end if;
 if p_marcadas=0 and antes is distinct from depois then raise exception 'Replay alterou primeira leitura.'; end if;
end $$;
create function pg_temp.lu_recusar(p_op text,p_id uuid,p_ator uuid,p_setor text,p_ids uuid[] default null,p_codigo text default 'nao_encontrado',p_constraint text default null)
returns void language plpgsql as $$
declare antes jsonb; r jsonb; restricao text; lancou boolean:=false;
begin
 antes:=pg_temp.lu_estado();
 begin r:=pg_temp.lu_rpc(p_op,p_id,p_ator,p_setor,p_ids);
 exception when check_violation then
  get stacked diagnostics restricao=constraint_name;
  if p_constraint is null or restricao is distinct from p_constraint then raise; end if;
  lancou:=true;
 end;
 if p_constraint is not null and not lancou then raise exception 'Falha induzida não foi atingida: %.',p_constraint; end if;
 if not lancou and r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo) then raise exception 'Esperado % genérico, obteve %.',p_codigo,r; end if;
 if pg_temp.lu_estado() is distinct from antes then raise exception 'Lote recusado deixou marca parcial/efeito global.'; end if;
end $$;
create function pg_temp.lu_mutacao_recusada(p_sql text,p_codigo text,p_papel text default 'fixture_owner')
returns void language plpgsql as $$
declare antes jsonb; codigo text; lancou boolean:=false;
begin
 if p_papel not in ('fixture_owner','service_role') then raise exception 'Papel inválido.'; end if;
 antes:=pg_temp.lu_estado();
 begin
  if p_papel='service_role' then set local role service_role; end if;
  execute p_sql; reset role;
 exception when others then
  get stacked diagnostics codigo=returned_sqlstate; reset role;
  if codigo<>p_codigo then raise; end if;
  lancou:=true;
 end;
 if not lancou then raise exception 'Mutação deveria falhar com %: %.',p_codigo,p_sql; end if;
 if pg_temp.lu_estado() is distinct from antes then raise exception 'Mutação recusada deixou efeito.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values('lu_principal','Principal fictícia',true),('lu_fora','Outra fictícia',true),('lu_canal','Canal fictício',true);
insert into auth.users(id) select pg_temp.lu_uuid(n) from generate_series(1,15)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
 (pg_temp.lu_uuid(1),'Vendedor A','vendedor','vendas','lu_principal',true),(pg_temp.lu_uuid(2),'Vendedor B','vendedor','vendas','lu_principal',true),
 (pg_temp.lu_uuid(3),'Gerente Vendas','gerente','vendas','lu_principal',true),(pg_temp.lu_uuid(4),'Peças','pecas','pecas','lu_principal',true),
 (pg_temp.lu_uuid(5),'Gerente Peças','gerente','pecas','lu_principal',true),(pg_temp.lu_uuid(6),'Admin global','admin','administracao','lu_fora',true),
 (pg_temp.lu_uuid(7),'Gerente administração extra','gerente','administracao','lu_fora',true),(pg_temp.lu_uuid(8),'Inativo','vendedor','vendas','lu_principal',false),
 (pg_temp.lu_uuid(9),'Vendedor extra','vendedor','vendas','lu_fora',true),(pg_temp.lu_uuid(10),'Peças extra','pecas','pecas','lu_fora',true),
 (pg_temp.lu_uuid(11),'Gerente Oficina','gerente','oficina','lu_principal',true),(pg_temp.lu_uuid(12),'Outro Peças','pecas','pecas','lu_principal',true),
 (pg_temp.lu_uuid(13),'Recepção','recepcao','oficina','lu_principal',true),(pg_temp.lu_uuid(14),'Vendedor fora','vendedor','vendas','lu_fora',true),
 (pg_temp.lu_uuid(15),'Admin inativo','admin','administracao','lu_fora',false);
insert into public.usuario_unidades values(pg_temp.lu_uuid(7),'lu_principal'),(pg_temp.lu_uuid(9),'lu_principal'),(pg_temp.lu_uuid(10),'lu_principal');
insert into public.clientes(id,telefone,nome,vendedor_id,unidade_origem)
select pg_temp.lu_uuid(n),'5511400'||lpad(n::text,6,'0'),'Cliente fictício '||n,pg_temp.lu_uuid(case n when 102 then 2 when 105 then 14 else 1 end),'lu_principal' from generate_series(101,105)n;
insert into public.conversas(id,cliente_id,unidade,status,assumida_por,nao_lidas)
select pg_temp.lu_uuid(n+100),pg_temp.lu_uuid(n),'lu_canal','bot','legado@example.invalid',51 from generate_series(101,105)n;
insert into public.vendas_funis(id,unidade,chave,nome) values(pg_temp.lu_uuid(501),'lu_principal','novos','Novos'),(pg_temp.lu_uuid(502),'lu_principal','seminovos','Seminovos'),(pg_temp.lu_uuid(503),'lu_fora','novos','Fora');
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values(pg_temp.lu_uuid(601),pg_temp.lu_uuid(501),'Aberta',1,'aberta'),(pg_temp.lu_uuid(602),pg_temp.lu_uuid(502),'Aberta',1,'aberta'),(pg_temp.lu_uuid(603),pg_temp.lu_uuid(503),'Aberta',1,'aberta'),(pg_temp.lu_uuid(604),pg_temp.lu_uuid(501),'Ganha',2,'ganho');
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
select pg_temp.lu_uuid(1000+n),case n when 5 then 'lu_fora' else 'lu_principal' end,pg_temp.lu_uuid(case n when 2 then 502 when 5 then 503 else 501 end),
 pg_temp.lu_uuid(case n when 2 then 602 when 5 then 603 else 601 end),pg_temp.lu_uuid(case n when 2 then 101 when 3 then 102 when 4 then 103 when 5 then 105 else 101 end),
 pg_temp.lu_uuid(case n when 2 then 2 when 3 then 2 when 5 then 14 else 1 end),'fixture@example.invalid' from generate_series(1,5)n;
insert into public.atendimentos_modulares(id,setor,oportunidade_id,conversa_id,cliente_id,unidade,criado_por)
select pg_temp.lu_uuid(2000+n),'vendas',o.id,pg_temp.lu_uuid(case n when 2 then 201 when 3 then 202 when 4 then 203 when 5 then 205 else 201 end),o.cliente_id,o.unidade,pg_temp.lu_uuid(1)
from generate_series(1,5)n join public.vendas_oportunidades o on o.id=pg_temp.lu_uuid(1000+n);
insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao,origem,origem_ref)
values(pg_temp.lu_uuid(5001),'lu_principal',pg_temp.lu_uuid(104),pg_temp.lu_uuid(4),'Pedido fictício','whatsapp','wamid.lu.pecas');
insert into public.atendimentos_modulares(id,setor,cotacao_id,conversa_id,cliente_id,unidade,criado_por)
values(pg_temp.lu_uuid(2006),'pecas',pg_temp.lu_uuid(5001),pg_temp.lu_uuid(204),pg_temp.lu_uuid(104),'lu_principal',pg_temp.lu_uuid(4));
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,criado_em)
select pg_temp.lu_uuid(10000+n),pg_temp.lu_uuid(101),pg_temp.lu_uuid(201),'wamid.lu.main.'||n,'entrada','cliente','Mensagem fictícia '||n,'2026-11-11T12:00:00.123456Z' from generate_series(1,1005)n;
insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
select 'wamid.lu.main.'||n,pg_temp.lu_uuid(10000+n),pg_temp.lu_uuid(201),pg_temp.lu_uuid(101),'lu_principal',pg_temp.lu_uuid(1001),pg_temp.lu_uuid(501),false from generate_series(1,1005)n;
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,oportunidade_id,setor,conversa_id,cliente_id,unidade,criado_por)
select pg_temp.lu_uuid(10000+n),pg_temp.lu_uuid(2001),'wamid.lu.main.'||n,pg_temp.lu_uuid(1001),'vendas',pg_temp.lu_uuid(201),pg_temp.lu_uuid(101),'lu_principal',pg_temp.lu_uuid(1) from generate_series(1,1005)n;
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,metadata) values
 (pg_temp.lu_uuid(60001),pg_temp.lu_uuid(101),pg_temp.lu_uuid(201),'wamid.lu.outro_att','entrada','cliente','Outro negócio mesmo cliente','{}'),
 (pg_temp.lu_uuid(60002),pg_temp.lu_uuid(102),pg_temp.lu_uuid(202),'wamid.lu.outro_cliente','entrada','cliente','Outro cliente','{}'),
 (pg_temp.lu_uuid(60003),pg_temp.lu_uuid(104),pg_temp.lu_uuid(204),'wamid.lu.pecas','entrada','cliente','Peças','{}'),
 (pg_temp.lu_uuid(60004),pg_temp.lu_uuid(105),pg_temp.lu_uuid(205),'wamid.lu.fora','entrada','cliente','Outra unidade','{}'),
 (pg_temp.lu_uuid(60005),pg_temp.lu_uuid(101),pg_temp.lu_uuid(201),'wamid.lu.legada','entrada','cliente','Sem vínculo','{}'),
 (pg_temp.lu_uuid(60006),pg_temp.lu_uuid(101),pg_temp.lu_uuid(201),'wamid.lu.interna','entrada','cliente','Interna','{"interno":true}');
insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
select m.wamid,m.id,m.conversa_id,m.cliente_id,o.unidade,o.id,o.funil_id,false
from (values(60001,1002),(60002,1003),(60004,1005))x(m,o) join public.mensagens m on m.id=pg_temp.lu_uuid(x.m) join public.vendas_oportunidades o on o.id=pg_temp.lu_uuid(x.o);
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,oportunidade_id,setor,conversa_id,cliente_id,unidade,criado_por)
select e.mensagem_id,a.id,e.referencia,e.oportunidade_id,'vendas',e.conversa_id,e.cliente_id,e.unidade,pg_temp.lu_uuid(1)
from public.vendas_encaminhamentos_bot e join public.atendimentos_modulares a on a.oportunidade_id=e.oportunidade_id where e.mensagem_id in(pg_temp.lu_uuid(60001),pg_temp.lu_uuid(60002),pg_temp.lu_uuid(60004));
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino,cotacao_id)
values('wamid.lu.pecas',pg_temp.lu_uuid(204),pg_temp.lu_uuid(104),'lu_principal','pecas',pg_temp.lu_uuid(5001));
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,cotacao_id,setor,conversa_id,cliente_id,unidade,criado_por)
values(pg_temp.lu_uuid(60003),pg_temp.lu_uuid(2006),'wamid.lu.pecas',pg_temp.lu_uuid(5001),'pecas',pg_temp.lu_uuid(204),pg_temp.lu_uuid(104),'lu_principal',pg_temp.lu_uuid(4));

-- Leitura pessoal não se confunde com dono/supervisor nem usa limite da Data API.
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),1,'vendas',1005,0);
select pg_temp.lu_obter(pg_temp.lu_uuid(2004),1,'vendas',0,0);
select pg_temp.lu_obter(pg_temp.lu_uuid(2006),4,'pecas',1,0);
select pg_temp.lu_resumir(1,'vendas',2,1005,0,1);
select pg_temp.lu_resumir(2,'vendas',2,2,0,2);
select pg_temp.lu_resumir(3,'vendas',4,1007,0,3);
select pg_temp.lu_resumir(6,'vendas',5,1008,0,4);
select pg_temp.lu_resumir(4,'pecas',1,1,0,1);
select pg_temp.lu_resumir(11,'vendas',0,0,0,0);
do $$ declare ator integer; begin
 foreach ator in array array[2,4,5,8,11,12,13,14,15] loop
  perform pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(ator),'vendas');
  perform pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(ator),'vendas',array[pg_temp.lu_uuid(10076)]);
 end loop;
 perform pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2006),pg_temp.lu_uuid(12),'pecas');
 perform pg_temp.lu_recusar('obter',pg_temp.lu_uuid(99999),pg_temp.lu_uuid(1),'vendas');
 perform pg_temp.lu_recusar('obter',null,pg_temp.lu_uuid(1),'vendas',null,'invalido');
 perform pg_temp.lu_recusar('resumo',null,null,'vendas',null,'invalido');
 perform pg_temp.lu_recusar('resumo',null,pg_temp.lu_uuid(1),'oficina',null,'invalido');
end $$;
select pg_temp.lu_marcar(pg_temp.lu_uuid(2001),1,'vendas',array(select pg_temp.lu_uuid(10000+n) from generate_series(1,75)n),75);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),1,'vendas',1005,75);
select pg_temp.lu_resumir(1,'vendas',2,1005,75,1);
select pg_temp.lu_marcar(pg_temp.lu_uuid(2001),1,'vendas',array(select pg_temp.lu_uuid(10000+n) from generate_series(1,75)n),0);
-- now() é constante na transação: envelhece só a fixture para provar preservação de firsttimestamp.
update public.atendimento_leituras set lido_em='2001-01-01T00:00:00Z' where atendimento_id=pg_temp.lu_uuid(2001) and usuario_id=pg_temp.lu_uuid(1) and mensagem_id=pg_temp.lu_uuid(10001);
select pg_temp.lu_marcar(pg_temp.lu_uuid(2001),1,'vendas',array[pg_temp.lu_uuid(10001)],0);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),3,'vendas',1005,0);
select pg_temp.lu_marcar(pg_temp.lu_uuid(2001),3,'vendas',array(select pg_temp.lu_uuid(10000+n) from generate_series(1,10)n),10);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),1,'vendas',1005,75);
select pg_temp.lu_resumir(3,'vendas',4,1007,10,3);

-- Mensagem associada depois com data antiga continua não lida: não existe watermark.
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,conteudo,criado_em)
values(pg_temp.lu_uuid(11006),pg_temp.lu_uuid(101),pg_temp.lu_uuid(201),'wamid.lu.main.1006','entrada','cliente','Chegou depois com data antiga','1990-01-01');
insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
values('wamid.lu.main.1006',pg_temp.lu_uuid(11006),pg_temp.lu_uuid(201),pg_temp.lu_uuid(101),'lu_principal',pg_temp.lu_uuid(1001),pg_temp.lu_uuid(501),false);
insert into public.atendimento_mensagens(mensagem_id,atendimento_id,referencia,oportunidade_id,setor,conversa_id,cliente_id,unidade,criado_por)
values(pg_temp.lu_uuid(11006),pg_temp.lu_uuid(2001),'wamid.lu.main.1006',pg_temp.lu_uuid(1001),'vendas',pg_temp.lu_uuid(201),pg_temp.lu_uuid(101),'lu_principal',pg_temp.lu_uuid(1));
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),1,'vendas',1006,75);
select pg_temp.lu_marcar(pg_temp.lu_uuid(2001),1,'vendas',array[pg_temp.lu_uuid(11006)],1);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),1,'vendas',1006,76);

-- Lotes inválidos/forjados são todos recusados, nunca quota/truncamento ou subset parcial.
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',null,'invalido');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[]::uuid[],'invalido');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array(select pg_temp.lu_uuid(10000+n) from generate_series(1,101)n),'invalido');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10076),null],'invalido');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10076),pg_temp.lu_uuid(10076)],'invalido');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[[pg_temp.lu_uuid(10076),pg_temp.lu_uuid(10077)]],'invalido');
do $$ declare id integer; begin
 foreach id in array array[60001,60002,60003,60004,60005,60006,99999] loop
  perform pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10076),pg_temp.lu_uuid(id)]);
 end loop;
end $$;
alter table public.atendimento_leituras add constraint fixture_lu_rejeita_marca check(mensagem_id<>pg_temp.lu_uuid(10077)) not valid;
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10076),pg_temp.lu_uuid(10077)],'nao_encontrado','fixture_lu_rejeita_marca');
alter table public.atendimento_leituras drop constraint fixture_lu_rejeita_marca;

-- Nova ambiguidade omite das estatísticas e bloqueia mark mesmo para ID já marcado.
insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino)
values('wamid.lu.main.1',pg_temp.lu_uuid(201),pg_temp.lu_uuid(101),'lu_principal','triagem');
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),1,'vendas',1005,75,true);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),3,'vendas',1005,9,true);
select pg_temp.lu_resumir(1,'vendas',2,1005,75,1,true);
select pg_temp.lu_resumir(3,'vendas',4,1007,9,3,true);
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10001)]);
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10076),pg_temp.lu_uuid(10001)]);
do $$ begin
 if not exists(select 1 from public.atendimento_leituras where usuario_id=pg_temp.lu_uuid(1) and mensagem_id=pg_temp.lu_uuid(10001) and lido_em='2001-01-01') then raise exception 'Ambiguidade apagou ou sobrescreveu marca antiga.'; end if;
end $$;

-- Os antigos GETs não criam leituras, não zeram o canal e não mudam status/posse.
do $$ declare antes jsonb; r jsonb; begin
 antes:=pg_temp.lu_estado(); set local role service_role;
 r:=public.ler_mensagens_atendimento('a0000000-0000-4000-8000-000000002001','a0000000-0000-4000-8000-000000000001','vendas');
 if r->>'ok' is distinct from 'true' then raise exception 'GET detalhe falhou na fixture.'; end if;
 r:=public.listar_atendimentos('a0000000-0000-4000-8000-000000000001','vendas'); reset role;
 if r->>'ok' is distinct from 'true' or pg_temp.lu_estado() is distinct from antes then raise exception 'GET antigo alterou marcas/estado global.'; end if;
exception when others then reset role; raise; end $$;

-- Transferência sem mover carteira não herda marcas de outro vendedor/supervisor.
update public.vendas_oportunidades set vendedor_id=pg_temp.lu_uuid(2) where id=pg_temp.lu_uuid(1001);
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10076)]);
select pg_temp.lu_resumir(1,'vendas',1,0,0,0);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),2,'vendas',1005,0,true);
select pg_temp.lu_marcar(pg_temp.lu_uuid(2001),2,'vendas',array(select pg_temp.lu_uuid(10000+n) from generate_series(76,100)n),25);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),2,'vendas',1005,25,true);
select pg_temp.lu_resumir(2,'vendas',3,1007,25,3,true);

-- Revogação de extra, atividade, papel, cliente e unidade volta a negar no momento da chamada.
update public.vendas_oportunidades set vendedor_id=pg_temp.lu_uuid(9) where id=pg_temp.lu_uuid(1001);
select pg_temp.lu_obter(pg_temp.lu_uuid(2001),9,'vendas',1005,0,true);
select pg_temp.lu_marcar(pg_temp.lu_uuid(2001),9,'vendas',array[pg_temp.lu_uuid(10076)],1);
delete from public.usuario_unidades where user_id=pg_temp.lu_uuid(9) and unidade='lu_principal';
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(9),'vendas');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(9),'vendas',array[pg_temp.lu_uuid(10077)]);
select pg_temp.lu_resumir(9,'vendas',0,0,0,0);
insert into public.usuario_unidades values(pg_temp.lu_uuid(9),'lu_principal');
update public.usuarios set ativo=false where user_id=pg_temp.lu_uuid(9);
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(9),'vendas');
update public.usuarios set ativo=true,papel='pecas',setor='pecas' where user_id=pg_temp.lu_uuid(9);
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(9),'vendas');
select pg_temp.lu_resumir(9,'vendas',0,0,0,0);
update public.usuarios set papel='vendedor',setor='vendas' where user_id=pg_temp.lu_uuid(9);
delete from public.usuario_unidades where user_id=pg_temp.lu_uuid(7) and unidade='lu_principal';
select pg_temp.lu_resumir(7,'vendas',1,1,0,1);
update public.pecas_cotacoes set responsavel_id=pg_temp.lu_uuid(10) where id=pg_temp.lu_uuid(5001);
select pg_temp.lu_obter(pg_temp.lu_uuid(2006),10,'pecas',1,0);
select pg_temp.lu_marcar(pg_temp.lu_uuid(2006),10,'pecas',array[pg_temp.lu_uuid(60003)],1);
delete from public.usuario_unidades where user_id=pg_temp.lu_uuid(10) and unidade='lu_principal';
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2006),pg_temp.lu_uuid(10),'pecas');
select pg_temp.lu_resumir(10,'pecas',0,0,0,0);
update public.clientes set anonimizado=true where id=pg_temp.lu_uuid(101);
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(6),'vendas');
select pg_temp.lu_resumir(6,'vendas',3,2,0,2);
update public.clientes set anonimizado=false where id=pg_temp.lu_uuid(101);
update public.unidades set ativa=false where chave='lu_principal';
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(6),'vendas');
select pg_temp.lu_resumir(6,'vendas',1,1,0,1);
update public.unidades set ativa=true where chave='lu_principal';
update public.vendas_oportunidades set etapa_id=pg_temp.lu_uuid(604) where id=pg_temp.lu_uuid(1001);
select pg_temp.lu_recusar('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(9),'vendas');
select pg_temp.lu_recusar('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(9),'vendas',array[pg_temp.lu_uuid(10076)]);
select pg_temp.lu_resumir(6,'vendas',4,3,0,3);
update public.pecas_cotacoes set status='entregue' where id=pg_temp.lu_uuid(5001);
select pg_temp.lu_resumir(6,'pecas',0,0,0,0);

-- Integridade da associação/usuário e primeira data somente default do servidor.
select pg_temp.lu_mutacao_recusada(format('insert into public.atendimento_leituras(atendimento_id,mensagem_id,usuario_id,lido_em) values(%L,%L,%L,now())',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(10076),pg_temp.lu_uuid(1)),'42501','service_role');
select pg_temp.lu_mutacao_recusada(format('insert into public.atendimento_leituras(atendimento_id,mensagem_id,usuario_id) values(%L,%L,%L)',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(60001),pg_temp.lu_uuid(1)),'23503');
select pg_temp.lu_mutacao_recusada(format('insert into public.atendimento_leituras(atendimento_id,mensagem_id,usuario_id) values(%L,%L,%L)',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(10076),pg_temp.lu_uuid(999)),'23503');
select pg_temp.lu_mutacao_recusada(format('insert into public.atendimento_leituras(atendimento_id,mensagem_id,usuario_id) values(%L,%L,%L)',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(10001),pg_temp.lu_uuid(1)),'23505');
select pg_temp.lu_mutacao_recusada(format('delete from public.atendimento_mensagens where atendimento_id=%L and mensagem_id=%L',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(10001)),'23001');
-- Exclusão administrativa acompanha somente o usuário fictício local; nenhum Auth remoto.
delete from auth.users where id=pg_temp.lu_uuid(10);
do $$ begin if exists(select 1 from public.atendimento_leituras where usuario_id=pg_temp.lu_uuid(10)) then raise exception 'Exclusão do usuário não removeu suas marcas.'; end if; end $$;

do $$
declare assinatura text; papel text; privilegio text; campo text; f record;
begin
 if not exists(select 1 from pg_class where oid='public.atendimento_leituras'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.atendimento_leituras'::regclass) then raise exception 'Leituras precisam de RLS fechado.'; end if;
 foreach papel in array array['anon','authenticated'] loop
  foreach privilegio in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if has_table_privilege(papel,'public.atendimento_leituras',privilegio) then raise exception 'Marcas expostas ao browser.'; end if;
  end loop;
  if has_any_column_privilege(papel,'public.atendimento_leituras','SELECT,INSERT,UPDATE') then raise exception 'Colunas expostas ao browser.'; end if;
 end loop;
 if not has_table_privilege('service_role','public.atendimento_leituras','SELECT') then raise exception 'Servidor sem SELECT de marcas.'; end if;
 foreach campo in array array['atendimento_id','mensagem_id','usuario_id'] loop
  if not has_column_privilege('service_role','public.atendimento_leituras',campo,'INSERT') then raise exception 'Servidor sem INSERT necessário.'; end if;
 end loop;
 if has_column_privilege('service_role','public.atendimento_leituras','lido_em','INSERT') or has_any_column_privilege('service_role','public.atendimento_leituras','UPDATE') then raise exception 'Servidor pode sobrescrever primeira leitura.'; end if;
 foreach privilegio in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
  if has_table_privilege('service_role','public.atendimento_leituras',privilegio) then raise exception 'Marcas receberam grant excessivo.'; end if;
 end loop;
 foreach assinatura in array array['public.obter_leitura_atendimento(uuid,uuid,text)','public.marcar_mensagens_lidas_atendimento(uuid,uuid,text,uuid[])','public.resumir_leituras_atendimentos(uuid,text)'] loop
  select prosecdef,proconfig,proacl,proowner into f from pg_proc where oid=assinatura::regprocedure;
  if f.prosecdef or not coalesce(f.proconfig&&array['search_path=""','search_path='],false)
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Invoker/search_path/ACL incorreto.'; end if;
  if not has_function_privilege('service_role',assinatura,'EXECUTE') then raise exception 'Servidor sem RPC.'; end if;
  foreach papel in array array['anon','authenticated'] loop if has_function_privilege(papel,assinatura,'EXECUTE') then raise exception 'RPC exposta ao browser.'; end if; end loop;
 end loop;
 foreach papel in array array['anon','authenticated'] loop
  begin perform pg_temp.lu_rpc('obter',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',null,papel); raise exception 'Browser obteve stats.';
  exception when insufficient_privilege then null; end;
  begin perform pg_temp.lu_rpc('marcar',pg_temp.lu_uuid(2001),pg_temp.lu_uuid(1),'vendas',array[pg_temp.lu_uuid(10001)],papel); raise exception 'Browser marcou.';
  exception when insufficient_privilege then null; end;
  begin perform pg_temp.lu_rpc('resumo',null,pg_temp.lu_uuid(1),'vendas',null,papel); raise exception 'Browser obteve resumo.';
  exception when insufficient_privilege then null; end;
 end loop;
 if (select vendedor_id from public.clientes where id=pg_temp.lu_uuid(101))<>pg_temp.lu_uuid(1) then raise exception 'Fixture deveria conservar carteira antiga.'; end if;
 if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Sem necessidade de grants Auth.'; end if;
end $$;
rollback;
