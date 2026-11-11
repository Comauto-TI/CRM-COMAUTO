-- A1.1c: qualificação + proveniência Vendas numa transação, sem associação/inbox.
begin;
create function pg_temp.vb_uuid(n integer) returns uuid language sql immutable as $$
 select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.vb_estado() returns jsonb language sql as $$
 select jsonb_build_object(
  'ledger',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_encaminhamentos_bot t),
  'ops',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_oportunidades t),
  'historico',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_historico t),
  'atividades',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_atividades t),
  'clientes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.clientes t),
  'avisos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.notificacoes t),
  'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t),
  'mensagens',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mensagens t),
  'associacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_mensagens t)
 );
$$;
create function pg_temp.vb_rpc(p_conv uuid,p_cliente uuid,p_ref text,p_funil text,p_modelo text,p_pagamento text,
 p_prazo text,p_troca boolean,p_desc text,p_resumo text,p_conf boolean,p_papel text default 'service_role') returns jsonb language plpgsql as $$
declare r jsonb;
begin
 if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
 execute format('set local role %I',p_papel);
 if current_user<>p_papel then raise exception 'Fixture não mudou o papel.'; end if;
 r:=public.registrar_lead_vendas_bot(p_conv,p_cliente,p_ref,p_funil,p_modelo,p_pagamento,p_prazo,p_troca,p_desc,p_resumo,p_conf);
 reset role; return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.vb_chamar(n integer,p_ref text default null,p_modelo text default null,p_pagamento text default 'indefinido',
 p_prazo text default 'indefinido',p_troca boolean default null,p_desc text default null,p_resumo text default null,p_conf boolean default false,p_funil text default 'novos')
returns jsonb language sql as $$
 select pg_temp.vb_rpc(pg_temp.vb_uuid(200+n),pg_temp.vb_uuid(100+n),coalesce(p_ref,'wamid.vb.'||n),p_funil,p_modelo,p_pagamento,p_prazo,
  p_troca,p_desc,coalesce(p_resumo,'Resumo fictício '||n),p_conf);
$$;
create function pg_temp.vb_recusar(n integer,p_constraint text default null) returns void language plpgsql as $$
declare antes jsonb; r jsonb; restricao text; lancou boolean:=false;
begin
 antes:=pg_temp.vb_estado();
 begin
  r:=pg_temp.vb_chamar(n);
 exception when check_violation then
  get stacked diagnostics restricao=constraint_name;
  if p_constraint is null or restricao is distinct from p_constraint then raise; end if;
  lancou:=true;
 end;
 if p_constraint is not null and not lancou then raise exception 'Falha induzida não foi atingida: %.',p_constraint; end if;
 if not lancou and (r->>'ok' is distinct from 'false' or coalesce(r->>'motivo','')='') then raise exception 'Lead deveria recusar: %.',r; end if;
 if pg_temp.vb_estado() is distinct from antes then raise exception 'Recusa deixou efeito parcial.'; end if;
end $$;
create function pg_temp.vb_mutacao_recusada(p_sql text,p_codigo text) returns void language plpgsql as $$
declare antes jsonb; codigo text; lancou boolean:=false;
begin
 antes:=pg_temp.vb_estado();
 begin execute p_sql;
 exception when others then
  get stacked diagnostics codigo=returned_sqlstate;
  if codigo<>p_codigo then raise; end if;
  lancou:=true;
 end;
 if not lancou then raise exception 'Mutação deveria falhar com %: %.',p_codigo,p_sql; end if;
 if pg_temp.vb_estado() is distinct from antes then raise exception 'Mutação recusada deixou efeito parcial.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values
 ('vb_principal','Principal fictícia',true),('vb_extra','Extra fictícia',true),('vb_global','Admin fictícia',true),
 ('vb_supervisor','Supervisão fictícia',true),('vb_fallback','Fallback fictício',true),('vb_sem_equipe','Sem equipe fictícia',true),
 ('vb_rodizio','Rodízio fictício',true),('vb_zero','Rodízio vazio fictício',true),('vb_sem_funil','Sem funil fictícia',true),
 ('vb_sem_etapa','Sem etapa fictícia',true),('vb_inativa','Inativa fictícia',false);
insert into auth.users(id) select pg_temp.vb_uuid(n) from generate_series(1,21)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
 (pg_temp.vb_uuid(1),'Vendedor carteira','vendedor','vendas','vb_principal',true),
 (pg_temp.vb_uuid(2),'Vendedor colega','vendedor','vendas','vb_principal',true),
 (pg_temp.vb_uuid(3),'Vendedor extra','vendedor','vendas','vb_extra',true),
 (pg_temp.vb_uuid(4),'Vendedor fora','vendedor','vendas','vb_extra',true),
 (pg_temp.vb_uuid(5),'Vendedor inativo','vendedor','vendas','vb_principal',false),
 (pg_temp.vb_uuid(6),'Gerente Vendas','gerente','vendas','vb_principal',true),
 (pg_temp.vb_uuid(7),'Gerente administração extra','gerente','administracao','vb_extra',true),
 (pg_temp.vb_uuid(8),'Gerente Oficina','gerente','oficina','vb_principal',true),
 (pg_temp.vb_uuid(9),'Admin global','admin','administracao','vb_global',true),
 (pg_temp.vb_uuid(10),'Admin inativo','admin','administracao','vb_global',false),
 (pg_temp.vb_uuid(11),'Peças','pecas','pecas','vb_principal',true),
 (pg_temp.vb_uuid(12),'Recepção','recepcao','oficina','vb_principal',true),
 (pg_temp.vb_uuid(13),'Rodízio carga global','vendedor','vendas','vb_rodizio',true),
 (pg_temp.vb_uuid(14),'Rodízio mais antigo','vendedor','vendas','vb_rodizio',true),
 (pg_temp.vb_uuid(15),'Rodízio mais recente','vendedor','vendas','vb_rodizio',true),
 (pg_temp.vb_uuid(16),'Vazio primeiro id','vendedor','vendas','vb_zero',true),
 (pg_temp.vb_uuid(17),'Vazio segundo id','vendedor','vendas','vb_zero',true),
 (pg_temp.vb_uuid(18),'Supervisor Vendas','gerente','vendas','vb_supervisor',true),
 (pg_temp.vb_uuid(19),'Supervisor administração extra','gerente','administracao','vb_extra',true),
 (pg_temp.vb_uuid(20),'Supervisor Oficina','gerente','oficina','vb_supervisor',true),
 (pg_temp.vb_uuid(21),'Vendedor unidade inativa','vendedor','vendas','vb_inativa',true);
insert into public.usuario_unidades(user_id,unidade) values
 (pg_temp.vb_uuid(3),'vb_principal'),(pg_temp.vb_uuid(7),'vb_principal'),
 (pg_temp.vb_uuid(18),'vb_supervisor'),(pg_temp.vb_uuid(19),'vb_supervisor');
insert into public.links_rastreados(id,codigo,nome,canal,mensagem_inicial) values
 (pg_temp.vb_uuid(901),'EVT_FIX','Evento fictício','evento','Mensagem fictícia'),
 (pg_temp.vb_uuid(902),'QR_FIX','Link fictício','instagram','Mensagem fictícia');
insert into public.clientes(id,telefone,nome,vendedor_id,unidade_origem,anonimizado,link_origem_id)
select pg_temp.vb_uuid(100+n),'5511800'||lpad(n::text,6,'0'),'Cliente fictício '||n,
 case when n in(3,16,17,18,19,20,25,26,27,28,30) then null when n=2 then pg_temp.vb_uuid(3)
  when n=4 then pg_temp.vb_uuid(4) when n=5 then pg_temp.vb_uuid(5) when n=6 then pg_temp.vb_uuid(11) else pg_temp.vb_uuid(1) end,
 'vb_principal',n=7,case n when 1 then pg_temp.vb_uuid(901) when 2 then pg_temp.vb_uuid(902) else null end
from generate_series(1,40)n;
insert into public.conversas(id,cliente_id,unidade,status)
select pg_temp.vb_uuid(200+n),pg_temp.vb_uuid(100+n),case n when 8 then 'vb_inativa' when 9 then 'vb_sem_funil'
 when 16 then 'vb_supervisor' when 17 then 'vb_fallback' when 18 then 'vb_sem_equipe' when 19 then 'vb_rodizio'
 when 20 then 'vb_zero' when 30 then 'vb_sem_etapa' when 40 then 'vb_extra' else 'vb_principal' end,'bot'
from generate_series(1,40)n;
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor,metadata)
select pg_temp.vb_uuid(400+n),pg_temp.vb_uuid(case n when 13 then 114 else 100+n end),
 pg_temp.vb_uuid(case n when 14 then 215 else 200+n end),'wamid.vb.'||n,
 case n when 12 then 'saida' else 'entrada' end,case n when 11 then 'bot' else 'cliente' end,
 case n when 10 then '{"interno":true}'::jsonb else '{}'::jsonb end
from generate_series(1,40)n where n<>15;
insert into public.mensagens(id,cliente_id,conversa_id,wamid,direcao,autor)
select pg_temp.vb_uuid(9100+n),pg_temp.vb_uuid(121),pg_temp.vb_uuid(221),'wamid.vb.21.'||n,'entrada','cliente' from generate_series(1,3)n;

insert into public.vendas_funis(id,unidade,chave,nome,ativo)
select pg_temp.vb_uuid(500+n),unidade,case n when 10 then 'fixture' else 'novos' end,'Novos fictício',true
from (values(1,'vb_principal'),(2,'vb_extra'),(3,'vb_supervisor'),(4,'vb_fallback'),(5,'vb_sem_equipe'),
 (6,'vb_rodizio'),(7,'vb_zero'),(8,'vb_inativa'),(9,'vb_sem_etapa'),(10,'comauto'))f(n,unidade);
insert into public.vendas_funis(id,unidade,chave,nome) values(pg_temp.vb_uuid(511),'vb_principal','seminovos','Seminovos fictício');
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo,ativo)
select pg_temp.vb_uuid(600+n),pg_temp.vb_uuid(500+n),'Aberta',1,'aberta',n<>9 from generate_series(1,11)n;
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values(pg_temp.vb_uuid(650),pg_temp.vb_uuid(501),'Ganha',2,'ganho');

-- Carga global fora da unidade do rodízio; empate compara a última criação aberta.
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por,criado_em)
select pg_temp.vb_uuid(800+n),'vb_principal',pg_temp.vb_uuid(501),pg_temp.vb_uuid(601),pg_temp.vb_uuid(140),
 pg_temp.vb_uuid(case n when 1 then 13 when 2 then 13 when 3 then 14 else 15 end),'fixture@example.invalid',
 case n when 1 then '2022-01-01'::timestamptz when 2 then '2023-01-01'::timestamptz when 3 then '2020-01-01'::timestamptz else '2024-01-01'::timestamptz end
from generate_series(1,4)n;
-- Duas oportunidades abertas do mesmo cliente: só a mais recente recebe atualização.
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por,criado_em,veiculo_interesse,pagamento,prazo_compra,tem_troca,troca_descricao,qualificacao,temperatura)
values
 (pg_temp.vb_uuid(805),'vb_principal',pg_temp.vb_uuid(501),pg_temp.vb_uuid(601),pg_temp.vb_uuid(121),pg_temp.vb_uuid(1),'fixture@example.invalid','2020-01-01','Antigo','a_vista','sem_prazo',false,null,'a_verificar','frio'),
 (pg_temp.vb_uuid(806),'vb_principal',pg_temp.vb_uuid(501),pg_temp.vb_uuid(601),pg_temp.vb_uuid(121),pg_temp.vb_uuid(2),'fixture@example.invalid','2025-01-01','Modelo atual','financiamento','ate_30_dias',true,'Troca original','qualificado','frio');
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por,qualificacao)
select pg_temp.vb_uuid(800+n),'vb_principal',pg_temp.vb_uuid(501),pg_temp.vb_uuid(601),pg_temp.vb_uuid(100+n),
 pg_temp.vb_uuid(case n when 35 then 5 when 36 then 6 when 37 then 9 when 38 then 8 else 2 end),'fixture@example.invalid',
 case n when 22 then 'desqualificado' when 24 then 'confirmado_cliente' else 'a_verificar' end
from unnest(array[22,23,24,29,35,36,37,38,39])n;
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
 values(pg_temp.vb_uuid(831),'vb_principal',pg_temp.vb_uuid(501),pg_temp.vb_uuid(650),pg_temp.vb_uuid(131),pg_temp.vb_uuid(1),'fixture@example.invalid');

-- Nova proveniência conserva marketing separado da identidade de entrada; replay é imutável.
do $$
declare r jsonb; antes jsonb; op uuid;
begin
 if exists(select 1 from public.vendas_encaminhamentos_bot) then raise exception 'Migration não deve fazer backfill.'; end if;
 r:=pg_temp.vb_chamar(1,null,'Modelo inicial','financiamento','ate_30_dias',true,'Usado fictício','Lead principal fictício',true);
 if r->>'ok' is distinct from 'true' or r->>'novo' is distinct from 'true' or r->>'ja_registrado' is distinct from 'false' then raise exception 'Contrato de novo lead inválido: %.',r; end if;
 op:=(r->>'oportunidade_id')::uuid;
 if not exists(select 1 from public.vendas_oportunidades where id=op and cliente_id=pg_temp.vb_uuid(101)
  and unidade='vb_principal' and funil_id=pg_temp.vb_uuid(501) and vendedor_id=pg_temp.vb_uuid(1)
  and origem='evento' and origem_ref='EVT_FIX' and temperatura='quente' and qualificacao='confirmado_cliente') then raise exception 'Novo lead perdeu carteira/marketing/temperatura/qualificação.'; end if;
 if not exists(select 1 from public.vendas_encaminhamentos_bot where referencia='wamid.vb.1' and mensagem_id=pg_temp.vb_uuid(401)
  and conversa_id=pg_temp.vb_uuid(201) and cliente_id=pg_temp.vb_uuid(101) and unidade='vb_principal' and oportunidade_id=op and funil_id=pg_temp.vb_uuid(501) and novo and entrada_cliente_externa) then raise exception 'Ledger não provou a origem exata.'; end if;
 if (select count(*) from public.vendas_atividades where oportunidade_id=op and tipo='whatsapp' and ator='assistente')<>1
  or (select count(*) from public.notificacoes where usuario_id=pg_temp.vb_uuid(1) and corpo='Lead principal fictício')<>1 then raise exception 'Faltou atividade ou aviso ao dono.'; end if;
 update public.vendas_oportunidades set vendedor_id=pg_temp.vb_uuid(2) where id=op;
 antes:=pg_temp.vb_estado();
 r:=pg_temp.vb_chamar(1,null,'Payload diferente','a_vista','sem_prazo',false,null,'Replay diferente',false);
 if r is distinct from jsonb_build_object('ok',true,'oportunidade_id',op,'novo',true,'ja_registrado',true)
  or pg_temp.vb_estado() is distinct from antes then raise exception 'Replay alterou lead transferido/qualificação/efeitos.'; end if;
 r:=pg_temp.vb_chamar(1,null,null,'indefinido','indefinido',null,null,null,false,'seminovos');
 if r->>'ok' is distinct from 'false' or pg_temp.vb_estado() is distinct from antes then raise exception 'Mesmo wamid mudou de funil.'; end if;
 r:=pg_temp.vb_rpc(pg_temp.vb_uuid(202),pg_temp.vb_uuid(102),'wamid.vb.1','novos',null,'indefinido','indefinido',null,null,'Conflito fictício',false);
 if r->>'ok' is distinct from 'false' or pg_temp.vb_estado() is distinct from antes then raise exception 'Mesmo wamid mudou cliente/conversa.'; end if;
 r:=pg_temp.vb_chamar(2);
 if r->>'ok' is distinct from 'true' or not exists(select 1 from public.vendas_oportunidades where id=(r->>'oportunidade_id')::uuid and vendedor_id=pg_temp.vb_uuid(3) and origem='qr' and origem_ref='QR_FIX') then raise exception 'Carteira extra ou QR perdido.'; end if;
end $$;

-- Qualificação atualiza a oportunidade mais recente, sem reatribuir ou rebaixar decisões humanas.
do $$
declare r jsonb; antes jsonb; n integer;
begin
 select to_jsonb(o) into antes from public.vendas_oportunidades o where id=pg_temp.vb_uuid(805);
 r:=pg_temp.vb_chamar(21,null,null,'indefinido','indefinido',null,null,null,true);
 if r->>'ok' is distinct from 'true' or r->>'novo' is distinct from 'false' or r->>'oportunidade_id'<>pg_temp.vb_uuid(806)::text then raise exception 'Não reutilizou a oportunidade aberta mais recente.'; end if;
 if (select to_jsonb(o) from public.vendas_oportunidades o where id=pg_temp.vb_uuid(805)) is distinct from antes then raise exception 'Atualizou oportunidade mais antiga.'; end if;
 if not exists(select 1 from public.vendas_oportunidades where id=pg_temp.vb_uuid(806) and vendedor_id=pg_temp.vb_uuid(2)
  and veiculo_interesse='Modelo atual' and pagamento='financiamento' and prazo_compra='ate_30_dias' and tem_troca and troca_descricao='Troca original'
  and qualificacao='qualificado' and temperatura='frio') then raise exception 'Dados indefinidos apagaram decisões concretas.'; end if;
 if (select vendedor_id from public.clientes where id=pg_temp.vb_uuid(121))<>pg_temp.vb_uuid(1) then raise exception 'Lead existente trocou carteira alheia.'; end if;
 perform pg_temp.vb_chamar(21,'wamid.vb.21.1',null,'indefinido','indefinido',true,null);
 if (select troca_descricao from public.vendas_oportunidades where id=pg_temp.vb_uuid(806))<>'Troca original' then raise exception 'Troca=true sem descrição apagou a anterior.'; end if;
 perform pg_temp.vb_chamar(21,'wamid.vb.21.2',null,'indefinido','indefinido',false,null);
 if not exists(select 1 from public.vendas_oportunidades where id=pg_temp.vb_uuid(806) and not tem_troca and troca_descricao is null) then raise exception 'Troca=false não limpou descrição.'; end if;
 perform pg_temp.vb_chamar(21,'wamid.vb.21.3','Modelo novo','a_vista','imediato',true,'Descrição nova',null,true);
 if not exists(select 1 from public.vendas_oportunidades where id=pg_temp.vb_uuid(806) and veiculo_interesse='Modelo novo' and pagamento='a_vista' and prazo_compra='imediato'
  and tem_troca and troca_descricao='Descrição nova' and qualificacao='qualificado' and temperatura='frio') then raise exception 'Dados concretos não atualizaram respeitando qualificação/temperatura atuais.'; end if;
 foreach n in array array[22,23,24] loop
  r:=pg_temp.vb_chamar(n,null,null,'indefinido','indefinido',null,null,null,n<>24);
  if r->>'ok' is distinct from 'true' or (select qualificacao from public.vendas_oportunidades where id=pg_temp.vb_uuid(800+n))<>
   (case n when 22 then 'desqualificado' else 'confirmado_cliente' end) then raise exception 'Transição de qualificação incorreta: %.',n; end if;
 end loop;
 antes:=pg_temp.vb_estado();
 r:=pg_temp.vb_chamar(21,null,'Replay não altera','consorcio','sem_prazo',false,null,null,false);
 if r is distinct from jsonb_build_object('ok',true,'oportunidade_id',pg_temp.vb_uuid(806),'novo',false,'ja_registrado',true)
  or pg_temp.vb_estado() is distinct from antes then raise exception 'Replay de atualização não preservou novo=false/identidade/efeitos.'; end if;
end $$;

-- Nova seleção preserva carteiras inelegíveis e preenche só NULL; carga é global por pessoa.
do $$
declare r jsonb; n integer; dono uuid; anterior uuid;
begin
 foreach n in array array[3,4,5,6,19,20,31,32,33,34,40] loop
  select vendedor_id into anterior from public.clientes where id=pg_temp.vb_uuid(100+n);
  r:=pg_temp.vb_chamar(n,null,null,'indefinido',case n when 32 then 'imediato' when 33 then 'sem_prazo' else 'indefinido' end);
  if r->>'ok' is distinct from 'true' or r->>'novo' is distinct from 'true' then raise exception 'Novo lead válido recusado: % %.',n,r; end if;
  select vendedor_id into dono from public.vendas_oportunidades where id=(r->>'oportunidade_id')::uuid;
  if dono is null then raise exception 'Equipe elegível disponível ficou sem atribuição: %.',n; end if;
  if anterior is null and (select vendedor_id from public.clientes where id=pg_temp.vb_uuid(100+n)) is distinct from dono then raise exception 'Carteira NULL não foi preenchida pelo dono selecionado.'; end if;
  if anterior is not null and (select vendedor_id from public.clientes where id=pg_temp.vb_uuid(100+n)) is distinct from anterior then raise exception 'Carteira alheia foi sobrescrita.'; end if;
  if n in(4,5,6,40) and dono=anterior then raise exception 'Carteira inelegível foi selecionada.'; end if;
  if n=19 and dono<>pg_temp.vb_uuid(14) then raise exception 'Rodízio ignorou carga global/última criação: %.',dono; end if;
  if n=20 and dono<>pg_temp.vb_uuid(16) then raise exception 'Rodízio vazio ignorou desempate por ID.'; end if;
  if n in(32,33,34) and (select temperatura from public.vendas_oportunidades where id=(r->>'oportunidade_id')::uuid)<>
   (case n when 32 then 'quente' when 33 then 'frio' else 'morno' end) then raise exception 'Temperatura inicial incorreta.'; end if;
  if n=40 and not exists(select 1 from public.vendas_oportunidades where id=(r->>'oportunidade_id')::uuid and unidade='vb_extra' and funil_id=pg_temp.vb_uuid(502)) then raise exception 'Fonte da unidade não foi a conversa atual.'; end if;
 end loop;
end $$;

-- Aviso ao dono elegível; senão supervisão setorial/unidade e fallback admin global.
do $$
declare r jsonb; n integer; esperados uuid[]; recebidos uuid[];
begin
 foreach n in array array[16,17,35,36,37,38,39] loop
  r:=pg_temp.vb_chamar(n);
  if r->>'ok' is distinct from 'true' then raise exception 'Lead sem vendedor ou com dono existente recusado: % %.',n,r; end if;
  esperados:=case n when 16 then array[pg_temp.vb_uuid(18),pg_temp.vb_uuid(19)] when 17 then array[pg_temp.vb_uuid(9)]
   when 35 then array[pg_temp.vb_uuid(6),pg_temp.vb_uuid(7)] when 36 then array[pg_temp.vb_uuid(6)]
   when 37 then array[pg_temp.vb_uuid(9)] when 38 then array[pg_temp.vb_uuid(6),pg_temp.vb_uuid(7)] else array[pg_temp.vb_uuid(2)] end;
  select array_agg(usuario_id order by usuario_id) into recebidos from public.notificacoes where corpo='Resumo fictício '||n;
  if recebidos is distinct from esperados then raise exception 'Destinatários incorretos para %: % esperado %.',n,recebidos,esperados; end if;
  if n in(16,17) and (select vendedor_id from public.vendas_oportunidades where id=(r->>'oportunidade_id')::uuid) is not null then raise exception 'Sem vendedores não deve atribuir gerente/admin automaticamente.'; end if;
  if n=39 and (select vendedor_id from public.vendas_oportunidades where id=(r->>'oportunidade_id')::uuid)<>pg_temp.vb_uuid(2) then raise exception 'Oportunidade existente foi reatribuída pela carteira.'; end if;
 end loop;
end $$;
update public.usuarios set ativo=false where user_id=pg_temp.vb_uuid(9);
select pg_temp.vb_recusar(18);
update public.usuarios set ativo=true where user_id=pg_temp.vb_uuid(9);

-- A RPC é estrita; normalização/truncamento pertence ao wrapper anterior à chamada.
do $$
declare caso jsonb; campo text; valor text; r jsonb; antes jsonb;
begin
 antes:=pg_temp.vb_estado();
 for caso in select value from jsonb_array_elements('[
  {"campo":"ref","valor":null},{"campo":"ref","valor":""},{"campo":"ref","valor":" wamid.vb.1"},
  {"campo":"funil","valor":null},{"campo":"funil","valor":"pecas"},
  {"campo":"modelo","valor":""},{"campo":"modelo","valor":" Modelo"},
  {"campo":"pagamento","valor":null},{"campo":"pagamento","valor":"pix_invalido"},
  {"campo":"prazo","valor":null},{"campo":"prazo","valor":"hoje_invalido"},
  {"campo":"resumo","valor":null},{"campo":"resumo","valor":""},{"campo":"resumo","valor":"Resumo "},
  {"campo":"desc","valor":""},{"campo":"desc","valor":" Troca"},{"campo":"confirmou","valor":null}
 ]'::jsonb) loop
  campo:=caso->>'campo'; valor:=caso->>'valor';
  r:=pg_temp.vb_rpc(pg_temp.vb_uuid(201),pg_temp.vb_uuid(101),case when campo='ref' then valor else 'wamid.vb.1' end,
   case when campo='funil' then valor else 'novos' end,case when campo='modelo' then valor else null end,
   case when campo='pagamento' then valor else 'indefinido' end,case when campo='prazo' then valor else 'indefinido' end,
   null,case when campo='desc' then valor else null end,case when campo='resumo' then valor else 'Entrada inválida fictícia' end,
   case when campo='confirmou' then null else false end);
  if r->>'ok' is distinct from 'false' or pg_temp.vb_estado() is distinct from antes then raise exception 'Entrada inválida aceita: %.',caso; end if;
 end loop;
 r:=pg_temp.vb_chamar(1,repeat('x',513));
 if r->>'ok' is distinct from 'false' then raise exception 'Referência excessiva aceita.'; end if;
 r:=pg_temp.vb_chamar(1,null,repeat('x',121));
 if r->>'ok' is distinct from 'false' then raise exception 'Modelo excessivo aceito.'; end if;
 r:=pg_temp.vb_chamar(1,null,null,'indefinido','indefinido',true,repeat('x',301));
 if r->>'ok' is distinct from 'false' then raise exception 'Descrição excessiva aceita.'; end if;
 r:=pg_temp.vb_chamar(1,null,null,'indefinido','indefinido',null,null,repeat('x',301));
 if r->>'ok' is distinct from 'false' or pg_temp.vb_estado() is distinct from antes then raise exception 'Resumo excessivo aceito ou efeito parcial.'; end if;
end $$;

-- Replay também comprova cliente e unidade atuais; não fura anonimização/desativação.
update public.clientes set anonimizado=true where id=pg_temp.vb_uuid(101);
select pg_temp.vb_recusar(1);
update public.clientes set anonimizado=false where id=pg_temp.vb_uuid(101);
update public.unidades set ativa=false where chave='vb_principal';
select pg_temp.vb_recusar(1);
update public.unidades set ativa=true where chave='vb_principal';
update public.conversas set unidade='vb_extra' where id=pg_temp.vb_uuid(201);
select pg_temp.vb_recusar(1);
update public.conversas set unidade='vb_principal' where id=pg_temp.vb_uuid(201);

-- Fonte inválida, anonimizada, unidade/funil/etapa indisponível não vira lead.
do $$
declare n integer;
begin foreach n in array array[7,8,9,10,11,12,13,14,15,30] loop perform pg_temp.vb_recusar(n); end loop; end $$;
update public.vendas_funis set ativo=false where id=pg_temp.vb_uuid(501);
select pg_temp.vb_recusar(29);
update public.vendas_funis set ativo=true where id=pg_temp.vb_uuid(501);

-- Falhas reais de cada gravação obrigatória desfazem inclusive carteira e trigger histórico.
alter table public.audit_log add constraint fixture_vb_rejeita_audit check(false) not valid;
select pg_temp.vb_recusar(25,'fixture_vb_rejeita_audit');
select pg_temp.vb_recusar(29,'fixture_vb_rejeita_audit');
alter table public.audit_log drop constraint fixture_vb_rejeita_audit;
alter table public.vendas_atividades add constraint fixture_vb_rejeita_atividade check(false) not valid;
select pg_temp.vb_recusar(26,'fixture_vb_rejeita_atividade');
alter table public.vendas_atividades drop constraint fixture_vb_rejeita_atividade;
alter table public.notificacoes add constraint fixture_vb_rejeita_aviso check(false) not valid;
select pg_temp.vb_recusar(27,'fixture_vb_rejeita_aviso');
alter table public.notificacoes drop constraint fixture_vb_rejeita_aviso;
alter table public.vendas_historico add constraint fixture_vb_rejeita_historico check(false) not valid;
select pg_temp.vb_recusar(28,'fixture_vb_rejeita_historico');
alter table public.vendas_historico drop constraint fixture_vb_rejeita_historico;

-- Proveniência impede retarget posterior da mensagem ou da oportunidade.
do $$
declare op uuid;
begin
 select oportunidade_id into op from public.vendas_encaminhamentos_bot where referencia='wamid.vb.1';
 perform pg_temp.vb_mutacao_recusada(format('update public.vendas_oportunidades set cliente_id=%L where id=%L',pg_temp.vb_uuid(140),op),'23503');
 perform pg_temp.vb_mutacao_recusada(format('update public.vendas_oportunidades set unidade=%L,funil_id=%L,etapa_id=%L where id=%L','vb_extra',pg_temp.vb_uuid(502),pg_temp.vb_uuid(602),op),'23503');
 perform pg_temp.vb_mutacao_recusada(format('update public.vendas_oportunidades set funil_id=%L,etapa_id=%L where id=%L',pg_temp.vb_uuid(511),pg_temp.vb_uuid(611),op),'23503');
 perform pg_temp.vb_mutacao_recusada($q$update public.mensagens set wamid='wamid.vb.reescrito' where wamid='wamid.vb.1'$q$,'23503');
 perform pg_temp.vb_mutacao_recusada($q$update public.mensagens set metadata='{"interno":true}'::jsonb where wamid='wamid.vb.1'$q$,'23503');
 if exists(select 1 from public.atendimento_mensagens) then raise exception 'A1.1c não associa mensagens à interface modular.'; end if;
end $$;

do $$
declare papel text; privilegio text; funcao record; r jsonb;
 assinatura constant text:='public.registrar_lead_vendas_bot(uuid,uuid,text,text,text,text,text,boolean,text,text,boolean)';
begin
 if not exists(select 1 from pg_class where oid='public.vendas_encaminhamentos_bot'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.vendas_encaminhamentos_bot'::regclass) then raise exception 'Ledger deve ter RLS fechado.'; end if;
 foreach papel in array array['anon','authenticated'] loop
  foreach privilegio in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if has_table_privilege(papel,'public.vendas_encaminhamentos_bot',privilegio) then raise exception 'Ledger exposto ao navegador.'; end if;
  end loop;
  if has_any_column_privilege(papel,'public.vendas_encaminhamentos_bot','SELECT,INSERT,UPDATE') or has_function_privilege(papel,assinatura,'EXECUTE') then raise exception 'Ledger/RPC exposto ao navegador.'; end if;
  begin
   r:=pg_temp.vb_rpc(pg_temp.vb_uuid(201),pg_temp.vb_uuid(101),'wamid.vb.1','novos',null,'indefinido','indefinido',null,null,'Não executar',false,papel);
   raise exception 'Browser executou RPC.';
  exception when insufficient_privilege then null;
  end;
 end loop;
 if not has_table_privilege('service_role','public.vendas_encaminhamentos_bot','SELECT') or not has_table_privilege('service_role','public.vendas_encaminhamentos_bot','INSERT')
  or not has_function_privilege('service_role',assinatura,'EXECUTE') then raise exception 'Grants explícitos do servidor ausentes.'; end if;
 foreach privilegio in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
  if has_table_privilege('service_role','public.vendas_encaminhamentos_bot',privilegio) then raise exception 'Ledger recebeu grant excessivo: %.',privilegio; end if;
 end loop;
 if has_any_column_privilege('service_role','public.vendas_encaminhamentos_bot','UPDATE') then raise exception 'Ledger recebeu UPDATE por coluna.'; end if;
 select prosecdef,proconfig,proacl,proowner into funcao from pg_proc where oid=assinatura::regprocedure;
 if funcao.prosecdef or not coalesce(funcao.proconfig&&array['search_path=""','search_path='],false)
  or exists(select 1 from aclexplode(coalesce(funcao.proacl,acldefault('f',funcao.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'RPC precisa de invoker/search_path vazio/PUBLIC fechado.'; end if;
 if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,INSERT,UPDATE,DELETE') then raise exception 'RPC bot não precisa de grants Auth.'; end if;
end $$;
rollback;
