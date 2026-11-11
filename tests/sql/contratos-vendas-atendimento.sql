-- Banco descartável 0001/0002/0003/0005/0006; serviço real, sem grants corretivos.
-- Não prova rede, Auth, janela Meta nem concorrência multissessão.
begin;
create function pg_temp.va_id(n integer) returns uuid language sql immutable as $$
  select ('d4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.va_estado() returns jsonb language sql as $$
  select jsonb_build_object(
    'ops',(select jsonb_agg(to_jsonb(t) order by t.id) from public.vendas_oportunidades t),
    'clientes',(select jsonb_agg(to_jsonb(t) order by t.id) from public.clientes t),
    'atividades',(select jsonb_agg(to_jsonb(t) order by t.id) from public.vendas_atividades t),
    'att',(select jsonb_agg(to_jsonb(t) order by t.id) from public.atendimentos_modulares t),
    'canais',(select jsonb_agg(to_jsonb(t) order by t.conversa_id) from public.atendimento_canais t),
    'vinculos',(select jsonb_agg(to_jsonb(t) order by t.mensagem_id) from public.atendimento_mensagens t),
    'msgs',(select jsonb_agg(to_jsonb(t) order by t.id) from public.mensagens t),
    'conversas',(select jsonb_agg(to_jsonb(t) order by t.id) from public.conversas t),
    'notificacoes',(select jsonb_agg(to_jsonb(t) order by t.id) from public.notificacoes t),
    'audit',(select jsonb_agg(to_jsonb(t) order by t.id) from public.audit_log t));
$$;
create function pg_temp.va_rpc(acao text,op integer,ator integer,versao integer default 0,msg integer default null,texto text default 'Resposta fictícia')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  if current_user<>'service_role' then raise exception 'Papel incorreto.'; end if;
  case acao
    when 'dialogo' then r:=public.vendas_dialogo(pg_temp.va_id(op),pg_temp.va_id(ator));
    when 'assumir' then r:=public.vendas_assumir_atendimento(pg_temp.va_id(op),pg_temp.va_id(ator),versao);
    when 'devolver' then r:=public.vendas_devolver_atendimento(pg_temp.va_id(op),pg_temp.va_id(ator),versao);
    when 'reservar' then r:=public.vendas_reservar_resposta(pg_temp.va_id(op),pg_temp.va_id(ator),versao,pg_temp.va_id(msg),texto);
    when 'autorizar' then r:=public.vendas_autorizar_resposta(pg_temp.va_id(op),pg_temp.va_id(ator),versao,pg_temp.va_id(msg));
    else raise exception 'Operação desconhecida.';
  end case;
  reset role;
  return r;
exception when others then reset role;raise;
end $$;
create function pg_temp.va_ok(acao text,op integer,ator integer,versao integer default 0,msg integer default null,texto text default 'Resposta fictícia')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r:=pg_temp.va_rpc(acao,op,ator,versao,msg,texto);
  if r->>'ok' is distinct from 'true' then raise exception '% positivo falhou: %.',acao,r; end if;
  return r;
end $$;
create function pg_temp.va_negar(acao text,op integer,ator integer,versao integer default 0,msg integer default null,codigo text default 'nao_encontrado',texto text default 'Resposta fictícia')
returns void language plpgsql as $$
declare antes jsonb:=pg_temp.va_estado();r jsonb;
begin
  r:=pg_temp.va_rpc(acao,op,ator,versao,msg,texto);
  if r is distinct from jsonb_build_object('ok',false,'codigo',codigo) then raise exception '% esperava %, recebeu %.',acao,codigo,r; end if;
  if antes is distinct from pg_temp.va_estado() then raise exception '% negou com efeito parcial.',acao; end if;
end $$;
create function pg_temp.va_erro(sql text,codigo text,restricao text default null,papel text default 'service_role') returns void language plpgsql as $$
declare antes jsonb:=pg_temp.va_estado();lancou boolean:=false;estado text;nome text;
begin
  begin
    execute format('set local role %I',papel);
    execute sql;
    reset role;
  exception when others then
    reset role;
    get stacked diagnostics estado=returned_sqlstate,nome=constraint_name;
    if estado is distinct from codigo or (restricao is not null and nome is distinct from restricao) then raise; end if;
    lancou:=true;
  end;
  if not lancou then raise exception 'Não atingiu erro real % / %.',codigo,restricao; end if;
  if antes is distinct from pg_temp.va_estado() then raise exception 'Erro deixou escrita parcial.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values('va_a','Vendas teste A',true),('va_b','Vendas teste B',true),('va_off','Vendas inativa',false);
insert into auth.users(id) select pg_temp.va_id(n) from generate_series(1,10)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.va_id(1),'Vendedor A','vendedor','vendas','va_a',true),
  (pg_temp.va_id(2),'Vendedor B','vendedor','vendas','va_a',true),
  (pg_temp.va_id(3),'Gerente Vendas','gerente','vendas','va_a',true),
  (pg_temp.va_id(4),'Admin global','admin','administracao','va_b',true),
  (pg_temp.va_id(5),'Vendedor extra','vendedor','vendas','va_b',true),
  (pg_temp.va_id(6),'Outra unidade','vendedor','vendas','va_b',true),
  (pg_temp.va_id(7),'Inativo','vendedor','vendas','va_a',false),
  (pg_temp.va_id(8),'Gerente Oficina','gerente','oficina','va_a',true),
  (pg_temp.va_id(9),'Peças','pecas','pecas','va_a',true),
  (pg_temp.va_id(10),'Gerente Administração','gerente','administracao','va_a',true);
insert into public.usuario_unidades(user_id,unidade) values(pg_temp.va_id(5),'va_a');
insert into public.clientes(id,telefone,nome,ultimo_contato_em,unidade_origem,anonimizado)
  select pg_temp.va_id(n),'55118000'||lpad(n::text,5,'0'),'Cliente fictício '||n,now(),'va_a',n=108 from generate_series(101,114)n;
insert into public.conversas(id,cliente_id,unidade,status,nao_lidas)
  select pg_temp.va_id(n+100),pg_temp.va_id(n),'va_a','bot',9 from generate_series(101,114)n where n<>112;
insert into public.vendas_funis(id,unidade,chave,nome) values
  (pg_temp.va_id(401),'va_a','novos','Novos'),(pg_temp.va_id(402),'va_a','seminovos','Seminovos'),
  (pg_temp.va_id(403),'va_b','novos','Novos B'),(pg_temp.va_id(404),'va_off','novos','Inativo');
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values
  (pg_temp.va_id(411),pg_temp.va_id(401),'Novo',1,'aberta'),(pg_temp.va_id(412),pg_temp.va_id(401),'Ganho',2,'ganho'),
  (pg_temp.va_id(413),pg_temp.va_id(402),'Novo',1,'aberta'),(pg_temp.va_id(414),pg_temp.va_id(403),'Novo',1,'aberta'),
  (pg_temp.va_id(415),pg_temp.va_id(404),'Novo',1,'aberta'),(pg_temp.va_id(416),pg_temp.va_id(401),'Proposta',3,'aberta');
insert into public.vendas_oportunidades(id,cliente_id,unidade,funil_id,etapa_id,vendedor_id,criado_por)
  select pg_temp.va_id(n),pg_temp.va_id(n-400),case when n=506 then 'va_b' else 'va_a' end,
    pg_temp.va_id(case when n=506 then 403 else 401 end),pg_temp.va_id(case when n=506 then 414 else 411 end),
    case when n=509 then null when n=504 then pg_temp.va_id(2) when n=505 then pg_temp.va_id(5) else pg_temp.va_id(1) end,'fixture'
  from generate_series(501,514)n where n<>503;
insert into public.vendas_oportunidades(id,cliente_id,unidade,funil_id,etapa_id,vendedor_id,criado_por)
  values(pg_temp.va_id(503),pg_temp.va_id(101),'va_a',pg_temp.va_id(402),pg_temp.va_id(413),pg_temp.va_id(2),'fixture');
update public.vendas_oportunidades set etapa_id=pg_temp.va_id(412) where id=pg_temp.va_id(507);
insert into public.pecas_cotacoes(id,cliente_id,unidade,responsavel_id,descricao,status)
  values(pg_temp.va_id(701),pg_temp.va_id(101),'va_a',pg_temp.va_id(9),'Peça do mesmo cliente','em_cotacao');
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo,criado_em) values
  (pg_temp.va_id(301),pg_temp.va_id(201),pg_temp.va_id(101),'entrada','cliente','wamid.va.antiga','Origem anterior','2026-11-11 10:00Z'),
  (pg_temp.va_id(302),pg_temp.va_id(201),pg_temp.va_id(101),'entrada','cliente','wamid.va.recente','Origem escolhida','2026-11-11 11:00Z'),
  (pg_temp.va_id(303),pg_temp.va_id(201),pg_temp.va_id(101),'entrada','cliente','wamid.va.legada','Histórico físico sem vínculo','2026-11-11 09:00Z'),
  (pg_temp.va_id(304),pg_temp.va_id(202),pg_temp.va_id(102),'entrada','cliente','wamid.va.manual.antes','Anterior da manual','2026-11-11 08:00Z');
-- Proveniência real pelo bot; empate de criado_em desempata pela referencia PK.
do $$ declare r jsonb;
begin
  set local role service_role;
  r:=public.registrar_lead_vendas_bot(pg_temp.va_id(201),pg_temp.va_id(101),'wamid.va.antiga','novos',null,'indefinido','indefinido',null,null,'Interesse inicial',false);
  if r->>'ok'<>'true' or (r->>'oportunidade_id')::uuid<>pg_temp.va_id(501) then raise exception 'Ledger real antigo: %.',r; end if;
  r:=public.registrar_lead_vendas_bot(pg_temp.va_id(201),pg_temp.va_id(101),'wamid.va.recente','novos',null,'indefinido','indefinido',null,null,'Interesse recente',false);
  if r->>'ok'<>'true' then raise exception 'Ledger real recente: %.',r; end if;
  r:=public.abrir_atendimento_modular('vendas',pg_temp.va_id(501),pg_temp.va_id(1));
  r:=public.vincular_mensagem_vendas((r->>'id')::uuid,'wamid.va.antiga',pg_temp.va_id(1));
  if r->>'ok'<>'true' then raise exception 'Vínculo anterior A1 não preparado.'; end if;
  reset role;
end $$;

-- Escopo e GET sem canal não escrevem nem importam história por cliente.
do $$ declare r jsonb;antes jsonb:=pg_temp.va_estado();
begin
  r:=pg_temp.va_ok('dialogo',512,1);
  if r->'id'<>'null'::jsonb or r->>'versao'<>'0' or r->'mensagens'<>'[]'::jsonb or r->>'podeAssumir'<>'true' then raise exception 'GET sem canal: %.',r; end if;
  if antes is distinct from pg_temp.va_estado() then raise exception 'GET criou canal/att.'; end if;
  perform pg_temp.va_negar('dialogo',501,2);perform pg_temp.va_negar('assumir',501,2);
  perform pg_temp.va_negar('dialogo',501,6);perform pg_temp.va_negar('assumir',501,8);perform pg_temp.va_negar('assumir',501,9);
  perform pg_temp.va_negar('assumir',501,7);perform pg_temp.va_negar('assumir',506,1);perform pg_temp.va_negar('assumir',506,3);
  perform pg_temp.va_negar('assumir',506,6); -- mesmo setor/unidade não concede carteira alheia
  perform pg_temp.va_negar('assumir',507,1);perform pg_temp.va_negar('assumir',506,1);
  perform pg_temp.va_negar('dialogo',509,1,0,null,'sem_responsavel');perform pg_temp.va_negar('assumir',509,3);
  perform pg_temp.va_negar('assumir',508,1);
end $$;

-- Posse única, origem mais recente apenas, replay sem notas/avisos duplicados.
do $$ declare r jsonb;antes jsonb;ticket uuid;
begin
  r:=pg_temp.va_ok('assumir',501,1);ticket:=(r->>'id')::uuid;
  if r is distinct from jsonb_build_object('ok',true,'id',ticket,'oportunidadeId',pg_temp.va_id(501),'versao',1,'estado','minha') then raise exception 'DTO claim: %.',r; end if;
  if not exists(select 1 from public.atendimentos_modulares where id=ticket and origem_inicial_fixada and referencia_inicial='wamid.va.recente') then raise exception 'Origem inicial errada.'; end if;
  r:=pg_temp.va_ok('dialogo',501,1);
  if jsonb_array_length(r->'mensagens')<>1 or r->'mensagens'->0->>'id'<>pg_temp.va_id(302)::text then raise exception 'Importou história anterior/A1: %.',r; end if;
  antes:=pg_temp.va_estado();perform pg_temp.va_ok('assumir',501,1,1);
  if antes is distinct from pg_temp.va_estado() then raise exception 'Replay duplicou efeitos.'; end if;
  perform pg_temp.va_negar('assumir',501,1,0,null,'conflito');
  perform pg_temp.va_negar('assumir',501,3,1,null,'conflito');
  perform pg_temp.va_negar('assumir',503,2,0,null,'conflito');
  r:=pg_temp.va_ok('dialogo',503,2);
  if r->'mensagens'<>'[]'::jsonb or r->>'estado'<>'outra' then raise exception 'Outra oportunidade herdou histórico/posse.'; end if;
  set local role service_role;
  r:=public.pecas_assumir_atendimento(pg_temp.va_id(701),pg_temp.va_id(9),0);
  reset role;
  if r is distinct from jsonb_build_object('ok',false,'codigo','conflito') then raise exception 'Peças roubou canal: %.',r; end if;
end $$;

-- Guardas de ciclo: exige devolver antes de mudar identidade/dono/encerramento.
select pg_temp.va_erro(format('update public.vendas_oportunidades set vendedor_id=%L where id=%L',pg_temp.va_id(2),pg_temp.va_id(501)),'55000');
select pg_temp.va_erro(format('update public.vendas_oportunidades set cliente_id=%L where id=%L',pg_temp.va_id(102),pg_temp.va_id(501)),'55000');
select pg_temp.va_erro(format('update public.vendas_oportunidades set unidade=%L,funil_id=%L,etapa_id=%L where id=%L','va_b',pg_temp.va_id(403),pg_temp.va_id(414),pg_temp.va_id(501)),'55000');
select pg_temp.va_erro(format('update public.vendas_oportunidades set funil_id=%L,etapa_id=%L where id=%L',pg_temp.va_id(402),pg_temp.va_id(413),pg_temp.va_id(501)),'55000');
select pg_temp.va_erro(format('update public.vendas_oportunidades set etapa_id=%L where id=%L',pg_temp.va_id(412),pg_temp.va_id(501)),'55000');
select pg_temp.va_erro(format('update public.vendas_oportunidades set fechado_em=now() where id=%L',pg_temp.va_id(501)),'55000');
select pg_temp.va_erro(format('update public.vendas_funis set ativo=false where id=%L',pg_temp.va_id(401)),'55000');
select pg_temp.va_erro(format('update public.vendas_etapas set ativo=false where id=%L',pg_temp.va_id(411)),'55000');
select pg_temp.va_erro(format('update public.vendas_etapas set tipo=%L where id=%L','ganho',pg_temp.va_id(411)),'55000');
update public.vendas_oportunidades set etapa_id=pg_temp.va_id(416) where id=pg_temp.va_id(501);

-- Supervisão assume temporariamente, avisa o vendedor e conserva a carteira.
do $$ declare r jsonb;antes jsonb;n integer;a integer;
begin
  perform pg_temp.va_ok('devolver',501,3,1);
  n:=(select count(*) from public.notificacoes);a:=(select count(*) from public.vendas_atividades);
  r:=pg_temp.va_ok('assumir',501,3,2);
  if r->>'versao'<>'3' or not exists(select 1 from public.vendas_oportunidades where id=pg_temp.va_id(501) and vendedor_id=pg_temp.va_id(1)) then raise exception 'Supervisor transferiu oportunidade.'; end if;
  if (select count(*) from public.notificacoes)<>n+1 or (select count(*) from public.vendas_atividades)<>a+1
    or not exists(select 1 from public.vendas_atividades where oportunidade_id=pg_temp.va_id(501) and tipo='nota' and descricao='Conversa assumida por Gerente Vendas.')
    or not exists(select 1 from public.notificacoes where usuario_id=pg_temp.va_id(1) and tipo='atendimento' and unidade='va_a') then raise exception 'Nota/aviso da supervisão ausente.'; end if;
  antes:=pg_temp.va_estado();perform pg_temp.va_ok('assumir',501,3,3);
  if antes is distinct from pg_temp.va_estado() then raise exception 'Replay supervisão duplicou.'; end if;
  perform pg_temp.va_negar('assumir',501,4,3,null,'conflito');
  perform pg_temp.va_negar('devolver',501,1,3,null,'conflito');
  perform pg_temp.va_negar('reservar',501,1,3,801,'conflito');
  perform pg_temp.va_ok('devolver',501,4,3);
  perform pg_temp.va_negar('assumir',501,1,3,null,'conflito');
  perform pg_temp.va_ok('assumir',501,1,4);
end $$;
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo,criado_em)
  values(pg_temp.va_id(305),pg_temp.va_id(201),pg_temp.va_id(101),'entrada','cliente','wamid.va.depois','Entrada na posse atual',now());
do $$ declare r jsonb;antes jsonb;
begin
  if not exists(select 1 from public.mensagens m join public.atendimentos_modulares a on a.id=m.atendimento_id where m.id=pg_temp.va_id(305) and a.oportunidade_id=pg_temp.va_id(501)) then raise exception 'Trigger não vinculou entrada Vendas.'; end if;
  r:=pg_temp.va_ok('dialogo',501,1);
  if jsonb_array_length(r->'mensagens')<>2 then raise exception 'Diálogo novo incorreto: %.',r; end if;
  antes:=pg_temp.va_estado();perform pg_temp.va_ok('dialogo',501,1);
  if antes is distinct from pg_temp.va_estado() then raise exception 'GET alterou canal/não lidas.'; end if;
  r:=pg_temp.va_ok('reservar',501,1,5,801);
  if r->>'despachar'<>'true' then raise exception 'Reserva sem despacho.'; end if;
  perform pg_temp.va_ok('reservar',501,1,5,801);
  perform pg_temp.va_negar('reservar',501,1,5,801,'conflito','Outro conteúdo');
  perform pg_temp.va_negar('autorizar',501,2,5,801);
  perform pg_temp.va_ok('autorizar',501,1,5,801);
  perform pg_temp.va_negar('autorizar',501,1,5,801,'conflito');
  perform pg_temp.va_negar('reservar',501,1,5,801,'envio_incerto');
end $$;
update public.mensagens set status='enviada',erro=null where id=pg_temp.va_id(801);
do $$ declare r jsonb;
begin
  r:=pg_temp.va_ok('reservar',501,1,5,801);
  if r->>'despachar'<>'false' then raise exception 'Reenviou saída já enviada.'; end if;
end $$;

-- Origem manual congelada sem histórico; origem futura não importa as mensagens antigas.
do $$ declare r jsonb;
begin
  perform pg_temp.va_ok('assumir',502,1);
  r:=pg_temp.va_ok('dialogo',502,1);
  if r->'mensagens'<>'[]'::jsonb then raise exception 'Manual importou história.'; end if;
  perform pg_temp.va_ok('devolver',502,1,1);
  if not exists(select 1 from public.atendimentos_modulares where oportunidade_id=pg_temp.va_id(502) and origem_inicial_fixada and referencia_inicial is null) then raise exception 'Manual não congelada.'; end if;
  set local role service_role;
  r:=public.registrar_lead_vendas_bot(pg_temp.va_id(202),pg_temp.va_id(102),'wamid.va.manual.antes','novos',null,'indefinido','indefinido',null,null,'Interesse posterior',false);
  reset role;
  if r->>'ok'<>'true' then raise exception 'Prova posterior da manual falhou: %.',r; end if;
  perform pg_temp.va_ok('assumir',502,1,2);
  r:=pg_temp.va_ok('dialogo',502,1);
  if r->'mensagens'<>'[]'::jsonb then raise exception 'Replay escolheu origem posterior.'; end if;
  perform pg_temp.va_ok('devolver',502,1,3);
end $$;

-- Falhas REAIS das dependências desfazem abertura, posse, nota e notificação.
alter table public.vendas_atividades add constraint va_falha_nota check(descricao not like 'Conversa assumida por %') not valid;
select pg_temp.va_erro(format('select public.vendas_assumir_atendimento(%L,%L,0)',pg_temp.va_id(510),pg_temp.va_id(3)),'23514','va_falha_nota');
alter table public.vendas_atividades drop constraint va_falha_nota;
alter table public.notificacoes add constraint va_falha_notif check(tipo<>'atendimento') not valid;
select pg_temp.va_erro(format('select public.vendas_assumir_atendimento(%L,%L,0)',pg_temp.va_id(510),pg_temp.va_id(3)),'23514','va_falha_notif');
alter table public.notificacoes drop constraint va_falha_notif;
alter table public.audit_log add constraint va_falha_audit check(acao<>'assumir_atendimento_modular') not valid;
select pg_temp.va_erro(format('select public.vendas_assumir_atendimento(%L,%L,0)',pg_temp.va_id(510),pg_temp.va_id(3)),'23514','va_falha_audit');
alter table public.audit_log drop constraint va_falha_audit;
-- Administração global e gerente de Administração seguem a supervisão aprovada.
select pg_temp.va_ok('assumir',510,4);
select pg_temp.va_ok('devolver',510,4,1);
select pg_temp.va_ok('assumir',512,10);
select pg_temp.va_ok('devolver',512,10,1);

-- Canal legado ocupado recusa sem criar atendimento/alterar a fila legada.
update public.conversas set status='humano',assumida_por='legado@example.invalid' where id=pg_temp.va_id(214);
select pg_temp.va_negar('assumir',514,1,0,null,'conflito');
update public.conversas set status='bot',assumida_por=null where id=pg_temp.va_id(214);
-- Duas provas de setor antes da primeira abertura não elegem um destino automaticamente.
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
  values(pg_temp.va_id(314),pg_temp.va_id(214),pg_temp.va_id(114),'entrada','cliente','wamid.va.dupla','Duas origens antes de abrir');
do $$ declare r jsonb;
begin
  set local role service_role;
  r:=public.registrar_lead_vendas_bot(pg_temp.va_id(214),pg_temp.va_id(114),'wamid.va.dupla','novos',null,'indefinido','indefinido',null,null,'Resumo fictício',false);
  if r->>'ok'<>'true' then raise exception 'Ledger Vendas inicial: %.',r; end if;
  r:=public.encaminhar_lead_bot(pg_temp.va_id(214),pg_temp.va_id(114),'wamid.va.dupla','pecas','Origem Peças');
  reset role;
  if r->>'ok'<>'true' then raise exception 'Ledger Peças inicial: %.',r; end if;
  perform pg_temp.va_negar('assumir',514,1,0,null,'origem_ambigua');
end $$;

-- Revogações são revalidadas no preflight, não só na reserva inicial.
select pg_temp.va_ok('assumir',505,5);
select pg_temp.va_ok('reservar',505,5,1,805);
delete from public.usuario_unidades where user_id=pg_temp.va_id(5) and unidade='va_a';
select pg_temp.va_negar('autorizar',505,5,1,805);
select pg_temp.va_negar('dialogo',505,5);
select pg_temp.va_ok('devolver',505,3,1);
select pg_temp.va_ok('assumir',511,1);
select pg_temp.va_ok('reservar',511,1,1,811);
update public.usuarios set ativo=false where user_id=pg_temp.va_id(1);
select pg_temp.va_negar('autorizar',511,1,1,811);
update public.usuarios set ativo=true where user_id=pg_temp.va_id(1);
select pg_temp.va_ok('devolver',511,3,1);

-- Identidade divergente nunca é reatada a outro cliente/unidade/canal.
do $$ declare r jsonb;ticket uuid;
begin
  set local role service_role;
  r:=public.abrir_atendimento_modular('vendas',pg_temp.va_id(513),pg_temp.va_id(1));
  reset role;ticket:=(r->>'id')::uuid;
  update public.atendimentos_modulares set unidade='va_b' where id=ticket;
  perform pg_temp.va_negar('dialogo',513,4);perform pg_temp.va_negar('assumir',513,4);
  update public.atendimentos_modulares set unidade='va_a',cliente_id=pg_temp.va_id(102) where id=ticket;
  perform pg_temp.va_negar('dialogo',513,1);perform pg_temp.va_negar('assumir',513,1);
  update public.atendimentos_modulares set cliente_id=pg_temp.va_id(113),conversa_id=pg_temp.va_id(202) where id=ticket;
  perform pg_temp.va_negar('dialogo',513,1);perform pg_temp.va_negar('assumir',513,1);
  update public.atendimentos_modulares set conversa_id=pg_temp.va_id(213) where id=ticket;
  update public.unidades set ativa=false where chave='va_a';
  perform pg_temp.va_negar('dialogo',513,4);perform pg_temp.va_negar('assumir',513,4);
  update public.unidades set ativa=true where chave='va_a';
  update public.vendas_oportunidades set origem='qr',origem_ref='codigo-marketing-sem-wamid' where id=pg_temp.va_id(513);
  perform pg_temp.va_ok('assumir',513,10);
  r:=pg_temp.va_ok('dialogo',513,10);
  if r->'mensagens'<>'[]'::jsonb then raise exception 'Marketing sem ledger inventou história.'; end if;
  perform pg_temp.va_ok('devolver',513,10,1);
end $$;

-- Ambiguidade tardia oculta a origem e bloqueia reserva/despacho, mas deixa devolver.
select pg_temp.va_ok('reservar',501,1,5,802);
do $$ declare r jsonb;
begin
  set local role service_role;
  r:=public.encaminhar_lead_bot(pg_temp.va_id(201),pg_temp.va_id(101),'wamid.va.recente','pecas','Pedido em outro setor');
  reset role;
  if r->>'ok'<>'true' then raise exception 'Segunda origem real não criada: %.',r; end if;
  perform pg_temp.va_negar('assumir',501,1,5,null,'origem_ambigua');
  perform pg_temp.va_negar('reservar',501,1,5,803,'origem_ambigua');
  perform pg_temp.va_negar('autorizar',501,1,5,802,'origem_ambigua');
  r:=pg_temp.va_ok('dialogo',501,1);
  if r->>'revisaoPendente'<>'true' or exists(select 1 from jsonb_array_elements(r->'mensagens')m where m->>'id'=pg_temp.va_id(302)::text) then raise exception 'Ambígua exposta sem revisão.'; end if;
  perform pg_temp.va_ok('devolver',501,1,5);
  perform pg_temp.va_negar('assumir',501,1,6,null,'origem_ambigua');
end $$;
update public.vendas_oportunidades set vendedor_id=pg_temp.va_id(2) where id=pg_temp.va_id(501);
select pg_temp.va_negar('dialogo',501,1);
-- Novo dono tem acesso ao negócio, mas a origem ambígua continua recusada.
select pg_temp.va_negar('assumir',501,2,6,null,'origem_ambigua');

-- Peças continua usando o MESMO trigger, sem ser apagada pela integração Vendas.
select public.pecas_assumir_atendimento(pg_temp.va_id(701),pg_temp.va_id(9),0);
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
  values(pg_temp.va_id(306),pg_temp.va_id(201),pg_temp.va_id(101),'entrada','cliente','wamid.va.pecas.depois','Nova mensagem para Peças');
do $$ begin
  if not exists(select 1 from public.mensagens m join public.atendimentos_modulares a on a.id=m.atendimento_id
    where m.id=pg_temp.va_id(306) and a.cotacao_id=pg_temp.va_id(701)) then raise exception 'Trigger compartilhado quebrou Peças.'; end if;
end $$;
-- A entrada já pertence ao diálogo Peças; um ledger posterior de Vendas não a transfere.
do $$ declare r jsonb;
begin
  set local role service_role;
  r:=public.registrar_lead_vendas_bot(pg_temp.va_id(201),pg_temp.va_id(101),'wamid.va.pecas.depois','seminovos',null,'indefinido','indefinido',null,null,'Interesse novo',false);
  reset role;
  if r->>'ok'<>'true' or (r->>'oportunidade_id')::uuid<>pg_temp.va_id(503) then raise exception 'Ledger posterior real falhou: %.',r; end if;
end $$;
select public.pecas_devolver_atendimento(pg_temp.va_id(701),pg_temp.va_id(9),1);
select pg_temp.va_negar('assumir',503,2,0,null,'origem_ambigua');

-- Ledger existente que aponta para um canal antigo não vira abertura manual.
-- Fixture evolui a identidade física sem desativar FK/trigger algum.
insert into public.clientes(id,telefone,nome,unidade_origem) values
  (pg_temp.va_id(115),'5511800000115','Cliente ledger divergente','va_a'),
  (pg_temp.va_id(116),'5511800000116','Cliente da outra conversa','va_a');
insert into public.conversas(id,cliente_id,unidade) values(pg_temp.va_id(215),pg_temp.va_id(115),'va_a');
insert into public.vendas_oportunidades(id,cliente_id,unidade,funil_id,etapa_id,vendedor_id,criado_por)
  values(pg_temp.va_id(515),pg_temp.va_id(115),'va_a',pg_temp.va_id(401),pg_temp.va_id(411),pg_temp.va_id(1),'fixture');
insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
  values(pg_temp.va_id(315),pg_temp.va_id(215),pg_temp.va_id(115),'entrada','cliente','wamid.va.divergente','Prova do canal anterior');
do $$ declare r jsonb;
begin
  set local role service_role;
  r:=public.registrar_lead_vendas_bot(pg_temp.va_id(215),pg_temp.va_id(115),'wamid.va.divergente','novos',null,'indefinido','indefinido',null,null,'Resumo fictício',false);
  reset role;
  if r->>'ok'<>'true' then raise exception 'Ledger divergente não preparado: %.',r; end if;
end $$;
update public.conversas set cliente_id=pg_temp.va_id(116) where id=pg_temp.va_id(215);
insert into public.conversas(id,cliente_id,unidade) values(pg_temp.va_id(216),pg_temp.va_id(115),'va_a');
select pg_temp.va_negar('assumir',515,1);

-- Canal sem vínculo antigo não pode aparecer na API legada enquanto negócio está ativo.
do $$ declare assinatura text;papel text;
begin
  if exists(select 1 from public.conversas_legadas where id=pg_temp.va_id(201))
    or exists(select 1 from public.mensagens_legadas where id in (pg_temp.va_id(301),pg_temp.va_id(302),pg_temp.va_id(305),pg_temp.va_id(801))) then raise exception 'Histórico modular vazou ao legado.'; end if;
  foreach assinatura in array array['vendas_dialogo(uuid,uuid)','vendas_assumir_atendimento(uuid,uuid,integer)',
    'vendas_devolver_atendimento(uuid,uuid,integer)','vendas_contexto_posse(uuid,uuid,integer)',
    'vendas_contexto_posse(uuid,uuid,integer,boolean)','vendas_reservar_resposta(uuid,uuid,integer,uuid,text)',
    'vendas_autorizar_resposta(uuid,uuid,integer,uuid)'] loop
    foreach papel in array array['anon','authenticated'] loop
      if has_function_privilege(papel,'public.'||assinatura,'execute') then raise exception 'RPC exposta: % para %.',assinatura,papel; end if;
    end loop;
    if not has_function_privilege('service_role','public.'||assinatura,'execute') then raise exception 'RPC sem grant de serviço.'; end if;
    if exists(select 1 from pg_proc where oid=('public.'||assinatura)::regprocedure and (prosecdef or not proconfig @> array['search_path=""'])) then raise exception 'Função privilegiada/search_path aberto.'; end if;
  end loop;
  if exists(select 1 from pg_class where oid in ('public.mensagens'::regclass,'public.atendimentos_modulares'::regclass,'public.atendimento_canais'::regclass) and not relrowsecurity) then raise exception 'RLS desativado.'; end if;
end $$;
select pg_temp.va_erro(format('select public.vendas_dialogo(%L,%L)',pg_temp.va_id(501),pg_temp.va_id(3)),'42501',null,'anon');
create function pg_temp.va_reaplicacao() returns void language plpgsql as $$
declare antes jsonb:=pg_temp.va_estado();r jsonb;
begin
  r:=pg_temp.va_ok('dialogo',502,1);
  if r->'mensagens'<>'[]'::jsonb then raise exception 'Reaplicação reimportou história.'; end if;
  if antes is distinct from pg_temp.va_estado() then raise exception 'GET após reaplicação escreveu.'; end if;
end $$;
rollback;
