-- Contrato ATUAL: fila/pessoa e snapshot explícito autorizado; banco descartável 0001..0006.
-- Execução service_role, sem grants corretivos. Uma conexão: não prova disputa multissessão.
begin;

create function pg_temp.ts_id(n integer) returns uuid language sql immutable as $$
  select ('e6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create temp table ts_verificacoes (nome text primary key);
create function pg_temp.ts_assert(condicao boolean,nome text) returns void language plpgsql as $$
begin
  if condicao is distinct from true then raise exception 'Contrato transferência: %.',nome; end if;
  insert into ts_verificacoes values(nome) on conflict do nothing;
end $$;

-- Snapshot de todas as tabelas públicas: inclui ledger, rotas e notificações novas sem depender
-- de uma lista incompleta. Sequências não são dados de negócio nem prova de concorrência.
create function pg_temp.ts_estado() returns jsonb language plpgsql as $$
declare t record; linhas jsonb; resultado jsonb:='{}';
begin
  for t in select tablename from pg_catalog.pg_tables where schemaname='public' order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',t.tablename) into linhas;
    resultado:=resultado||jsonb_build_object(t.tablename,linhas);
  end loop;
  return resultado;
end $$;
create function pg_temp.ts_rpc(operacao integer,origem text,registro uuid,ator integer,destino text,
  funil text default null,responsavel integer default null,nota text default 'Nota explícita fictícia',versao integer default 0,
  papel text default 'service_role') returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if papel not in ('service_role','anon','authenticated') then raise exception 'Papel de fixture inválido.'; end if;
  execute format('set local role %I',papel);
  r:=public.transferir_atendimento_setor(pg_temp.ts_id(operacao),origem,registro,pg_temp.ts_id(ator),destino,funil,
    case when responsavel is null then null else pg_temp.ts_id(responsavel) end,nota,versao);
  reset role;
  return r;
exception when others then reset role;raise;
end $$;
create function pg_temp.ts_ok(operacao integer,origem text,registro uuid,ator integer,destino text,
  funil text default null,responsavel integer default null,nota text default 'Nota explícita fictícia',versao integer default 0)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r:=pg_temp.ts_rpc(operacao,origem,registro,ator,destino,funil,responsavel,nota,versao);
  if r->>'ok' is distinct from 'true' or r->>'operacaoId' is distinct from pg_temp.ts_id(operacao)::text
    or r->>'setorDestino' is distinct from destino or r->>'idDestino' is null
    or jsonb_typeof(r->'reutilizado') is distinct from 'boolean' or not (r ? 'avisoResponsavel') then
    raise exception 'Transferência positiva % → % falhou: %.',origem,destino,r;
  end if;
  return r;
end $$;
create function pg_temp.ts_negar(nome text,operacao integer,origem text,registro uuid,ator integer,destino text,
  funil text default null,responsavel integer default null,nota text default 'Nota explícita fictícia',versao integer default 0,
  codigo text default 'nao_encontrado') returns void language plpgsql as $$
declare antes jsonb:=pg_temp.ts_estado();r jsonb;
begin
  r:=pg_temp.ts_rpc(operacao,origem,registro,ator,destino,funil,responsavel,nota,versao);
  perform pg_temp.ts_assert(r=jsonb_build_object('ok',false,'codigo',codigo),nome||' retorno '||coalesce(r::text,'NULL'));
  perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),nome||' sem efeitos');
end $$;
create function pg_temp.ts_erro(nome text,sql text,codigo text) returns void language plpgsql as $$
declare antes jsonb:=pg_temp.ts_estado();lancou boolean:=false;estado text;
begin
  begin
    execute sql;
  exception when others then
    reset role;
    get stacked diagnostics estado=returned_sqlstate;
    if estado is distinct from codigo then raise; end if;
    lancou:=true;
  end;
  perform pg_temp.ts_assert(lancou,nome||' erro real atingido');
  perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),nome||' rollback integral');
end $$;

insert into public.unidades(chave,nome,ativa) values
  ('ts_a','Transferência fictícia A',true),('ts_b','Transferência fictícia B',true),('ts_off','Unidade inativa',false);
insert into auth.users(id,email) select pg_temp.ts_id(n),'qa-'||n||'@comauto.invalid' from generate_series(1,18)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.ts_id(1),'Admin fictício','admin','administracao','ts_b',true),
  (pg_temp.ts_id(2),'Recepção A','recepcao','oficina','ts_a',true),
  (pg_temp.ts_id(3),'Vendedor A','vendedor','vendas','ts_a',true),
  (pg_temp.ts_id(4),'Peças A','pecas','pecas','ts_a',true),
  (pg_temp.ts_id(5),'Consultor A','consultor_tecnico','oficina','ts_a',true),
  (pg_temp.ts_id(6),'Gerente Vendas','gerente','vendas','ts_a',true),
  (pg_temp.ts_id(7),'Gerente Peças','gerente','pecas','ts_a',true),
  (pg_temp.ts_id(8),'Gerente Oficina','gerente','oficina','ts_a',true),
  (pg_temp.ts_id(9),'Gerente Administração','gerente','administracao','ts_a',true),
  (pg_temp.ts_id(10),'Outro vendedor','vendedor','vendas','ts_a',true),
  (pg_temp.ts_id(11),'Outro Peças','pecas','pecas','ts_a',true),
  (pg_temp.ts_id(12),'Outro consultor','consultor_tecnico','oficina','ts_a',true),
  (pg_temp.ts_id(13),'Vendedor inativo','vendedor','vendas','ts_a',false),
  (pg_temp.ts_id(14),'Sem perfil elegível','financeiro','administracao','ts_a',true),
  (pg_temp.ts_id(15),'Vendedor outra unidade','vendedor','vendas','ts_b',true),
  (pg_temp.ts_id(16),'Recepção outra unidade','recepcao','oficina','ts_b',true),
  (pg_temp.ts_id(17),'Recepção legada','atendente','oficina','ts_a',true),
  (pg_temp.ts_id(18),'Gerente outra unidade','gerente','vendas','ts_b',true);
insert into public.vendas_funis(id,unidade,chave,nome) values
  (pg_temp.ts_id(901),'ts_a','novos','Novos'),(pg_temp.ts_id(902),'ts_a','seminovos','Seminovos'),
  (pg_temp.ts_id(903),'ts_b','novos','Novos B');
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values
  (pg_temp.ts_id(911),pg_temp.ts_id(901),'Novo',1,'aberta'),
  (pg_temp.ts_id(912),pg_temp.ts_id(901),'Ganho',2,'ganho'),
  (pg_temp.ts_id(913),pg_temp.ts_id(902),'Novo',1,'aberta'),
  (pg_temp.ts_id(914),pg_temp.ts_id(903),'Novo',1,'aberta');

-- Uma origem/client/canal por cenário; nenhum cliente real nem reuso acidental entre casos.
create function pg_temp.ts_preparar(caso integer,origem text,dono integer default null) returns uuid language plpgsql as $$
declare cliente uuid:=pg_temp.ts_id(1000+caso);canal uuid:=pg_temp.ts_id(2000+caso);registro uuid:=pg_temp.ts_id(3000+caso);r jsonb;atendimento uuid;
begin
  insert into public.clientes(id,telefone,nome,anonimizado,unidade_origem)
    values(cliente,'5511900'||lpad(caso::text,6,'0'),'Cliente fictício '||caso,false,'ts_a');
  insert into public.conversas(id,cliente_id,unidade,status,nao_lidas)
    values(canal,cliente,'ts_a','humano',7);
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.ts_id(4000+caso),canal,cliente,'entrada','cliente','wamid.ts.legada.'||caso,'Texto legado não compartilhável');
  if origem='central' then
    insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,tipo,status,conteudo)
      values(pg_temp.ts_id(13000+caso),canal,cliente,'saida','bot','text','enviada','Resposta fictícia do bot visível ao cliente'),
        (pg_temp.ts_id(14000+caso),canal,cliente,'saida','sistema','text','enviada','Aviso fictício do sistema visível ao cliente');
    return canal;
  elsif origem='vendas' then
    insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por,observacoes)
      values(registro,'ts_a',pg_temp.ts_id(901),pg_temp.ts_id(911),cliente,pg_temp.ts_id(coalesce(dono,3)),'fixture','Observação original');
    set local role service_role;
    r:=public.vendas_assumir_atendimento(registro,pg_temp.ts_id(coalesce(dono,3)),0);
    reset role;
  elsif origem='pecas' then
    insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao,status)
      values(registro,'ts_a',cliente,pg_temp.ts_id(coalesce(dono,4)),'Pedido original','em_cotacao');
    set local role service_role;
    r:=public.pecas_assumir_atendimento(registro,pg_temp.ts_id(coalesce(dono,4)),0);
    reset role;
  elsif origem='oficina' then
    insert into public.oficina_atendimentos(id,unidade,cliente_id,descricao,status,responsavel_id,criado_por)
      values(registro,'ts_a',cliente,'Triagem original','em_triagem',pg_temp.ts_id(coalesce(dono,5)),pg_temp.ts_id(coalesce(dono,5)));
    return registro;
  else raise exception 'Origem inválida da fixture.';
  end if;
  if r->>'ok' is distinct from 'true' then raise exception 'Fixture claim %: %.',origem,r; end if;
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
    values(pg_temp.ts_id(5000+caso),canal,cliente,'entrada','cliente','wamid.ts.origem.'||caso,'Histórico do setor de origem');
  if origem='vendas' and caso=4 then
    select id into atendimento from public.atendimentos_modulares where oportunidade_id=registro;
    insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
      values('wamid.ts.origem.4',pg_temp.ts_id(5004),canal,cliente,'ts_a',registro,pg_temp.ts_id(901),false);
    set local role service_role;
    r:=public.vincular_mensagem_vendas(atendimento,'wamid.ts.origem.4',pg_temp.ts_id(3));
    if r->>'ok' is distinct from 'true' then raise exception 'Fixture não vinculou mensagem para leitura: %.',r;end if;
    r:=public.marcar_mensagens_lidas_atendimento(atendimento,pg_temp.ts_id(3),'vendas',array[pg_temp.ts_id(5004)]);
    reset role;
    if r->>'ok' is distinct from 'true' then raise exception 'Fixture não marcou leitura anterior: %.',r;end if;
  end if;
  return registro;
exception when others then reset role;raise;
end $$;
create function pg_temp.ts_versao(origem text,registro uuid) returns integer language sql as $$
  select coalesce((select a.versao from public.atendimentos_modulares a
    where (origem='vendas' and a.oportunidade_id=registro) or (origem='pecas' and a.cotacao_id=registro)),0);
$$;
create function pg_temp.ts_negocio(origem text,registro uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if origem='vendas' then select to_jsonb(t) into r from public.vendas_oportunidades t where id=registro;
  elsif origem='pecas' then select to_jsonb(t) into r from public.pecas_cotacoes t where id=registro;
  elsif origem='oficina' then select to_jsonb(t) into r from public.oficina_atendimentos t where id=registro;
  end if;
  return r;
end $$;

-- Mensagens de outro negócio do MESMO cliente/canal e alerta interno não pertencem ao snapshot.
create function pg_temp.ts_ruido(caso integer) returns void language plpgsql as $$
declare outra_op uuid:=pg_temp.ts_id(11000+caso);outro_at uuid:=pg_temp.ts_id(12000+caso);
begin
  insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,fechado_em,criado_por)
    values(outra_op,'ts_a',pg_temp.ts_id(901),pg_temp.ts_id(912),pg_temp.ts_id(1000+caso),pg_temp.ts_id(10),now(),'fixture');
  insert into public.atendimentos_modulares(id,setor,oportunidade_id,conversa_id,cliente_id,unidade,criado_por)
    values(outro_at,'vendas',outra_op,pg_temp.ts_id(2000+caso),pg_temp.ts_id(1000+caso),'ts_a',pg_temp.ts_id(10));
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,tipo,status,conteudo,atendimento_id)
    values(pg_temp.ts_id(9000+caso),pg_temp.ts_id(2000+caso),pg_temp.ts_id(1000+caso),'saida','atendente','text','enviada',
      'Texto privado de outro negócio fictício',outro_at);
  insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,tipo,status,conteudo,metadata)
    values(pg_temp.ts_id(10000+caso),pg_temp.ts_id(2000+caso),null,'saida','sistema','text','enviada',
      'Alerta interno fictício não compartilhável','{"interno":true}'::jsonb);
end $$;

create function pg_temp.ts_ler(operacao integer,ator integer) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r:=public.ler_snapshot_transferencia(pg_temp.ts_id(operacao),pg_temp.ts_id(ator));
  reset role;return r;
exception when others then reset role;raise;
end $$;
create function pg_temp.ts_ler_negado(operacao integer,ator integer,nome text) returns void language plpgsql as $$
declare antes jsonb:=pg_temp.ts_estado();r jsonb;
begin
  r:=pg_temp.ts_ler(operacao,ator);
  perform pg_temp.ts_assert(r=jsonb_build_object('ok',false,'codigo','nao_encontrado'),nome||' sem corpo ou metadados');
  perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),nome||' leitura sem efeitos');
end $$;

-- Nota raw só pode ser criada nas tabelas cobertas pela redação LGPD. Preserva-se qualquer
-- conteúdo idêntico que já existisse antes no negócio de origem/destino ou em atividades.
create function pg_temp.ts_sem_duplicar_nota(antes jsonb,nota text,nome text) returns void language plpgsql as $$
declare tabela record;linha jsonb;agulha text:=to_jsonb(nota)::text;
begin
  agulha:=substring(agulha from 2 for char_length(agulha)-2);
  for tabela in select * from jsonb_each(pg_temp.ts_estado()) loop
    if tabela.key in ('transferencias_setores','transferencias_mensagens') then continue;end if;
    for linha in select value from jsonb_array_elements(tabela.value) loop
      if position(agulha in linha::text)>0 and not exists(
        select 1 from jsonb_array_elements(coalesce(antes->tabela.key,'[]'::jsonb)) velha where velha=linha
      ) then raise exception 'Nota raw duplicada fora da cobertura LGPD: % / %.',nome,tabela.key;end if;
    end loop;
  end loop;
  perform pg_temp.ts_assert(true,nome||' sem novas cópias raw da nota');
end $$;

-- Nove caminhos: fila; snapshot apenas do contexto autorizado; novas entradas seguem autoridade nova.
do $$ declare caso integer:=0;origem text;destino text;registro uuid;ator integer;v integer;r jsonb;antes jsonb;negocio jsonb;
  msg uuid;canal uuid;alvo uuid;esperada uuid;snap jsonb;gestor integer;originais jsonb;estado_previo jsonb;leituras_antes jsonb;
begin
  for origem,destino in values ('central','vendas'),('central','pecas'),('central','oficina'),
    ('vendas','pecas'),('vendas','oficina'),('pecas','vendas'),('pecas','oficina'),('oficina','vendas'),('oficina','pecas') loop
    caso:=caso+1;registro:=pg_temp.ts_preparar(caso,origem);perform pg_temp.ts_ruido(caso);
    if origem='vendas' then update public.vendas_oportunidades set observacoes='Nota explícita caso '||caso where id=registro;
    elsif origem='pecas' then update public.pecas_cotacoes set descricao='Nota explícita caso '||caso where id=registro;
    elsif origem='oficina' then update public.oficina_atendimentos set descricao='Nota explícita caso '||caso where id=registro;end if;
    ator:=case origem when 'central' then 2 when 'vendas' then 3 when 'pecas' then 4 else 5 end;
    gestor:=case destino when 'vendas' then 6 when 'pecas' then 7 else 8 end;
    v:=pg_temp.ts_versao(origem,registro);negocio:=pg_temp.ts_negocio(origem,registro);
    select jsonb_agg(to_jsonb(m) order by m.id) into originais from public.mensagens m where m.conversa_id=pg_temp.ts_id(2000+caso);
    select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]'::jsonb) into leituras_antes from public.atendimento_leituras l;
    estado_previo:=pg_temp.ts_estado();
    r:=pg_temp.ts_ok(6000+caso,origem,registro,ator,destino,case when destino='vendas' then 'novos' end,null,'Nota explícita caso '||caso,v);
    perform pg_temp.ts_sem_duplicar_nota(estado_previo,'Nota explícita caso '||caso,'caminho '||caso);
    alvo:=(r->>'idDestino')::uuid;canal:=pg_temp.ts_id(2000+caso);
    perform pg_temp.ts_assert(r->>'reutilizado'='false','caminho '||caso||' cria destino');
    perform pg_temp.ts_assert(r->'avisoResponsavel'='null'::jsonb,'caminho '||caso||' sem aviso dono inexistente');
    perform pg_temp.ts_assert((select count(*) from public.clientes where id=pg_temp.ts_id(1000+caso))=1,'caminho '||caso||' cliente único');
    perform pg_temp.ts_assert(negocio is not distinct from pg_temp.ts_negocio(origem,registro),'caminho '||caso||' negócio origem intacto');
    perform pg_temp.ts_assert(originais=(select jsonb_agg(to_jsonb(m) order by m.id) from public.mensagens m where m.conversa_id=canal),'caminho '||caso||' mensagens originais intactas');
    perform pg_temp.ts_assert(leituras_antes=(select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]'::jsonb) from public.atendimento_leituras l),'caminho '||caso||' leituras anteriores intactas');
    perform pg_temp.ts_assert(exists(select 1 from public.transferencias_setores where operacao_id=pg_temp.ts_id(6000+caso)
      and registro_origem=registro and registro_destino=alvo and ator_id=pg_temp.ts_id(ator) and nota='Nota explícita caso '||caso),'caminho '||caso||' ledger exato');
    perform pg_temp.ts_assert((select count(*) from public.atendimento_canais s join public.atendimentos_modulares a on a.id=s.atendimento_id
      where s.conversa_id=canal and ((origem='vendas' and a.oportunidade_id=registro) or (origem='pecas' and a.cotacao_id=registro)))=0,'caminho '||caso||' posse origem liberada');
    perform pg_temp.ts_assert(exists(select 1 from public.notificacoes where unidade='ts_a' and
      (link like '%'||alvo::text||'%' or (destino='oficina' and link like '/painel/oficina%'))),'caminho '||caso||' aviso destino');
    antes:=pg_temp.ts_estado();snap:=pg_temp.ts_ler(6000+caso,gestor);
    perform pg_temp.ts_assert(snap->>'ok'='true' and jsonb_typeof(snap->'mensagens')='array','caminho '||caso||' gestão lê snapshot');
    perform pg_temp.ts_assert(snap->>'nota'='Nota explícita caso '||caso and snap->>'origem'=origem
      and snap->>'atorId'=pg_temp.ts_id(ator)::text,'caminho '||caso||' nota e autoria explícitas no leitor autorizado');
    perform pg_temp.ts_assert((snap->>'ocorridoEm')::timestamptz=(select criado_em from public.transferencias_setores where operacao_id=pg_temp.ts_id(6000+caso)),
      'caminho '||caso||' horário do encaminhamento preservado');
    perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),'caminho '||caso||' snapshot readonly');
    esperada:=case when origem='central' then pg_temp.ts_id(4000+caso) when origem in ('vendas','pecas') then pg_temp.ts_id(5000+caso) end;
    perform pg_temp.ts_assert(jsonb_array_length(snap->'mensagens')=case when esperada is null then 0 when origem='central' then 3 else 1 end,'caminho '||caso||' quantidade autorizada do snapshot');
    if esperada is not null then
      perform pg_temp.ts_assert(exists(select 1 from jsonb_array_elements(snap->'mensagens') m where m->>'id'=esperada::text),'caminho '||caso||' mensagem exata compartilhada');
      perform pg_temp.ts_assert(exists(select 1 from public.audit_log where
        (entidade_id=pg_temp.ts_id(6000+caso)::text or dados::text like '%'||pg_temp.ts_id(6000+caso)::text||'%')
        and dados::text like '%'||esperada::text||'%'),'caminho '||caso||' IDs compartilhados auditados');
    end if;
    if origem='central' then
      perform pg_temp.ts_assert(exists(select 1 from jsonb_array_elements(snap->'mensagens') m where m->>'id'=pg_temp.ts_id(13000+caso)::text and m->>'autor'='bot'),
        'caminho '||caso||' bot externo preserva autoria');
      perform pg_temp.ts_assert(exists(select 1 from jsonb_array_elements(snap->'mensagens') m where m->>'id'=pg_temp.ts_id(14000+caso)::text and m->>'autor'='sistema'),
        'caminho '||caso||' sistema externo preserva autoria');
    end if;
    perform pg_temp.ts_assert(not exists(select 1 from jsonb_array_elements(snap->'mensagens') m
      where m->>'id' in(pg_temp.ts_id(9000+caso)::text,pg_temp.ts_id(10000+caso)::text)),'caminho '||caso||' outro negócio e interno excluídos');
    perform pg_temp.ts_ok(6000+caso,origem,registro,ator,destino,case when destino='vendas' then 'novos' end,null,'Nota explícita caso '||caso,v);
    perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),'caminho '||caso||' replay sem efeitos');
    perform pg_temp.ts_negar('caminho '||caso||' UUID divergente',6000+caso,origem,registro,ator,destino,
      case when destino='vendas' then 'novos' end,null,'Outra nota',v,'conflito');
    msg:=pg_temp.ts_id(7000+caso);
    insert into public.mensagens(id,conversa_id,cliente_id,direcao,autor,wamid,conteudo)
      values(msg,canal,pg_temp.ts_id(1000+caso),'entrada','cliente','wamid.ts.destino.'||caso,'Nova mensagem após encaminhamento');
    if destino='oficina' then
      perform pg_temp.ts_assert(exists(select 1 from public.oficina_atendimentos where id=alvo and cliente_id=pg_temp.ts_id(1000+caso)
        and unidade='ts_a' and status='novo' and responsavel_id is null),'caminho '||caso||' triagem fila');
      perform pg_temp.ts_assert(exists(select 1 from public.mensagens where id=msg and atendimento_id is null
        and transferencia_central_id=pg_temp.ts_id(6000+caso)),'caminho '||caso||' entrada central explícita');
      perform pg_temp.ts_assert(exists(select 1 from public.conversas_legadas where id=canal),'caminho '||caso||' central disponível');
      perform pg_temp.ts_assert(exists(select 1 from public.mensagens_legadas where id=msg)
        and not exists(select 1 from public.mensagens_legadas where id in(pg_temp.ts_id(9000+caso),pg_temp.ts_id(10000+caso))),'caminho '||caso||' central não abre outros contextos');
    else
      perform pg_temp.ts_assert(exists(select 1 from public.atendimentos_modulares a join public.mensagens m on m.atendimento_id=a.id
        where m.id=msg and a.cliente_id=pg_temp.ts_id(1000+caso) and a.setor=destino
        and coalesce(a.oportunidade_id,a.cotacao_id)=alvo and a.assumido_por is null),'caminho '||caso||' entrada destino antes de claim');
      perform pg_temp.ts_assert(not exists(select 1 from public.mensagens_legadas where id=msg),'caminho '||caso||' entrada fora da central');
    end if;
  end loop;
end $$;

-- Pessoa escolhida: titular legítimo nos três destinos; fila sem dono não libera corpo a outro operador.
do $$ declare destino text;caso integer:=30;registro uuid;r jsonb;dono integer;outra integer;alvo uuid;snap jsonb;
begin
  foreach destino in array array['vendas','pecas','oficina'] loop
    caso:=caso+1;registro:=pg_temp.ts_preparar(caso,'central');
    dono:=case destino when 'vendas' then 3 when 'pecas' then 4 else 5 end;
    outra:=case destino when 'vendas' then 10 when 'pecas' then 11 else 12 end;
    r:=pg_temp.ts_ok(6300+caso,'central',registro,2,destino,case when destino='vendas' then 'novos' end,dono);
    alvo:=(r->>'idDestino')::uuid;
    if destino='vendas' then perform pg_temp.ts_assert((select vendedor_id from public.vendas_oportunidades where id=alvo)=pg_temp.ts_id(dono),'pessoa Vendas atribuída');
    elsif destino='pecas' then perform pg_temp.ts_assert((select responsavel_id from public.pecas_cotacoes where id=alvo)=pg_temp.ts_id(dono),'pessoa Peças atribuída');
    else perform pg_temp.ts_assert((select responsavel_id from public.oficina_atendimentos where id=alvo)=pg_temp.ts_id(dono),'pessoa Oficina atribuída');end if;
    snap:=pg_temp.ts_ler(6300+caso,dono);
    perform pg_temp.ts_assert(snap->>'ok'='true' and jsonb_array_length(snap->'mensagens')=3,'pessoa '||destino||' lê snapshot');
    perform pg_temp.ts_ler_negado(6300+caso,outra,'outro operador '||destino);
    perform pg_temp.ts_assert(exists(select 1 from public.notificacoes where usuario_id=pg_temp.ts_id(dono)
      and (link like '%'||alvo::text||'%' or (destino='oficina' and link like '/painel/oficina%'))),'pessoa '||destino||' aviso direto');
  end loop;
  perform pg_temp.ts_ler_negado(6001,3,'fila Vendas não é corpo aberto');
  perform pg_temp.ts_ler_negado(6002,4,'fila Peças não é corpo aberto');
  perform pg_temp.ts_ler_negado(6003,5,'fila Oficina não é corpo aberto');
end $$;

-- Reuso com dono preservado: aviso estruturado e nenhum direito novo à pessoa alternativa.
do $$ declare registro uuid;r jsonb;alvo uuid;antes jsonb;caso integer:=40;destino text;dono integer;escolhido integer;snap jsonb;estado_previo jsonb;
begin
  foreach destino in array array['vendas','pecas','oficina'] loop
    caso:=caso+1;registro:=pg_temp.ts_preparar(caso,'central');alvo:=pg_temp.ts_id(8000+caso);
    dono:=case destino when 'vendas' then 10 when 'pecas' then 11 else 12 end;
    escolhido:=case destino when 'vendas' then 3 when 'pecas' then 4 else 5 end;
    if destino='vendas' then
      insert into public.vendas_oportunidades(id,unidade,cliente_id,funil_id,etapa_id,vendedor_id,veiculo_interesse,valor_estimado,criado_por)
        values(alvo,'ts_a',pg_temp.ts_id(1000+caso),pg_temp.ts_id(901),pg_temp.ts_id(911),pg_temp.ts_id(dono),'Modelo preservado',12345,'fixture');
    elsif destino='pecas' then
      insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao,status)
        values(alvo,'ts_a',pg_temp.ts_id(1000+caso),pg_temp.ts_id(dono),'Nota privada ao destino titular','aprovado');
    else
      insert into public.oficina_atendimentos(id,unidade,cliente_id,responsavel_id,descricao,status)
        values(alvo,'ts_a',pg_temp.ts_id(1000+caso),pg_temp.ts_id(dono),'Triagem preservada','em_triagem');
    end if;
    antes:=pg_temp.ts_negocio(destino,alvo);estado_previo:=pg_temp.ts_estado();
    r:=pg_temp.ts_ok(6400+caso,'central',registro,2,destino,case when destino='vendas' then 'novos' end,escolhido,'Nota privada ao destino titular');
    perform pg_temp.ts_sem_duplicar_nota(estado_previo,'Nota privada ao destino titular','reuso '||destino);
    perform pg_temp.ts_assert(r->>'reutilizado'='true' and (r->>'idDestino')::uuid=alvo,'reuso '||destino||' destino exato');
    perform pg_temp.ts_assert(antes=pg_temp.ts_negocio(destino,alvo),'reuso '||destino||' preserva negócio e dono');
    perform pg_temp.ts_assert(r->'avisoResponsavel'=jsonb_build_object('nome',(select nome from public.usuarios where user_id=pg_temp.ts_id(dono))),'reuso '||destino||' aviso dono preservado');
    snap:=pg_temp.ts_ler(6400+caso,dono);
    perform pg_temp.ts_assert(snap->>'ok'='true' and jsonb_array_length(snap->'mensagens')=3,'reuso '||destino||' titular lê snapshot');
    perform pg_temp.ts_ler_negado(6400+caso,escolhido,'reuso '||destino||' alternativa não ganha leitura');
    perform pg_temp.ts_assert(exists(select 1 from public.notificacoes where usuario_id=pg_temp.ts_id(escolhido)),'reuso '||destino||' alternativa é avisada');
    perform pg_temp.ts_assert(not exists(select 1 from public.notificacoes where usuario_id=pg_temp.ts_id(escolhido)
      and (link like '%'||alvo::text||'%' or corpo like '%Nota privada ao destino titular%')),'reuso '||destino||' aviso alternativo mínimo');
  end loop;
end $$;

-- Reuso sem dono aceita a pessoa escolhida, sem criar outro negócio.
do $$ declare destino text;caso integer:=50;registro uuid;alvo uuid;r jsonb;dono integer;
begin
  foreach destino in array array['vendas','pecas','oficina'] loop
    caso:=caso+1;registro:=pg_temp.ts_preparar(caso,'central');alvo:=pg_temp.ts_id(8000+caso);
    dono:=case destino when 'vendas' then 3 when 'pecas' then 4 else 5 end;
    if destino='vendas' then insert into public.vendas_oportunidades(id,unidade,cliente_id,funil_id,etapa_id,criado_por)
      values(alvo,'ts_a',pg_temp.ts_id(1000+caso),pg_temp.ts_id(901),pg_temp.ts_id(911),'fixture');
    elsif destino='pecas' then insert into public.pecas_cotacoes(id,unidade,cliente_id,descricao) values(alvo,'ts_a',pg_temp.ts_id(1000+caso),'Fila existente');
    else insert into public.oficina_atendimentos(id,unidade,cliente_id,descricao) values(alvo,'ts_a',pg_temp.ts_id(1000+caso),'Fila existente');end if;
    r:=pg_temp.ts_ok(6500+caso,'central',registro,2,destino,case when destino='vendas' then 'novos' end,dono);
    perform pg_temp.ts_assert(r->>'reutilizado'='true' and r->>'idDestino'=alvo::text and r->'avisoResponsavel'='null'::jsonb,'reuso sem dono '||destino);
    perform pg_temp.ts_assert((pg_temp.ts_negocio(destino,alvo)->>case when destino='vendas' then 'vendedor_id' else 'responsavel_id' end)=pg_temp.ts_id(dono)::text,'reuso sem dono atribui '||destino);
  end loop;
end $$;

-- Guardas: IDs conhecidos não dão acesso, unidade, elegibilidade ou versão.
do $$ declare registro uuid:=pg_temp.ts_preparar(60,'vendas');v integer;
begin
  v:=pg_temp.ts_versao('vendas',registro);
  perform pg_temp.ts_negar('outro vendedor',6601,'vendas',registro,10,'pecas',null,null,'Nota',v);
  perform pg_temp.ts_negar('gerente outro setor',6602,'vendas',registro,7,'pecas',null,null,'Nota',v);
  perform pg_temp.ts_negar('operador outro setor',6603,'vendas',registro,4,'pecas',null,null,'Nota',v);
  perform pg_temp.ts_negar('gerente outra unidade',6604,'vendas',registro,18,'pecas',null,null,'Nota',v);
  perform pg_temp.ts_negar('ator inativo',6605,'vendas',registro,13,'pecas',null,null,'Nota',v);
  perform pg_temp.ts_negar('ator inexistente',6606,'vendas',registro,99,'pecas',null,null,'Nota',v);
  perform pg_temp.ts_negar('origem forjada',6607,'pecas',registro,3,'vendas','novos',null,'Nota',v);
  perform pg_temp.ts_negar('versão antiga',6608,'vendas',registro,3,'pecas',null,null,'Nota',v-1,'conflito');
  perform pg_temp.ts_negar('mesmo setor',6609,'vendas',registro,3,'vendas','novos',null,'Nota',v,'invalido');
  perform pg_temp.ts_negar('nota vazia',6610,'vendas',registro,3,'pecas',null,null,'',v,'invalido');
  perform pg_temp.ts_negar('nota excessiva',6611,'vendas',registro,3,'pecas',null,null,repeat('x',1001),v,'invalido');
  perform pg_temp.ts_negar('funil indevido',6612,'vendas',registro,3,'pecas','novos',null,'Nota',v,'invalido');
  perform pg_temp.ts_negar('destinatário outro setor',6613,'vendas',registro,3,'pecas',null,3,'Nota',v);
  perform pg_temp.ts_erro('anon SQL',format('select pg_temp.ts_rpc(6615,''vendas'',%L,3,''pecas'',null,null,''Nota'',%s,''anon'')',registro,v),'42501');
  perform pg_temp.ts_erro('authenticated SQL',format('select pg_temp.ts_rpc(6616,''vendas'',%L,3,''pecas'',null,null,''Nota'',%s,''authenticated'')',registro,v),'42501');
  update public.unidades set ativa=false where chave='ts_a';
  perform pg_temp.ts_negar('unidade inativa',6617,'vendas',registro,3,'pecas',null,null,'Nota',v);
  update public.unidades set ativa=true where chave='ts_a';
  update public.clientes set anonimizado=true where id=pg_temp.ts_id(1060);
  perform pg_temp.ts_negar('cliente anonimizado',6618,'vendas',registro,3,'pecas',null,null,'Nota',v);
  update public.clientes set anonimizado=false where id=pg_temp.ts_id(1060);
end $$;

-- A fonte central revalida posse atual; supervisão elegível pode intervir.
-- Uma origem de negócio SEM atendimento modular não pode tomar a rota ativa de outro setor.
do $$ declare registro uuid:=pg_temp.ts_id(31071);r jsonb;
begin
  insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao,status)
    values(registro,'ts_a',pg_temp.ts_id(1001),pg_temp.ts_id(4),'Cotação manual sem atendimento modular','em_cotacao');
  perform pg_temp.ts_assert(not exists(select 1 from public.atendimentos_modulares where cotacao_id=registro),'NULLrota pré-condição Peças sem modular');
  perform pg_temp.ts_assert(exists(select 1 from public.atendimento_rotas_setores where conversa_id=pg_temp.ts_id(2001) and setor='vendas'),'NULLrota pré-condição rota Vendas');
  delete from public.atendimento_canais where conversa_id=pg_temp.ts_id(2001);
  perform pg_temp.ts_negar('NULLrota Peças não rouba rota Vendas',6711,'pecas',registro,4,'oficina',null,null,'Tentativa de trocar canal de outro negócio',0,'conflito');
  registro:=pg_temp.ts_id(31072);
  insert into public.vendas_oportunidades(id,unidade,cliente_id,funil_id,etapa_id,vendedor_id,criado_por)
    values(registro,'ts_a',pg_temp.ts_id(1002),pg_temp.ts_id(901),pg_temp.ts_id(911),pg_temp.ts_id(3),'fixture');
  perform pg_temp.ts_assert(not exists(select 1 from public.atendimentos_modulares where oportunidade_id=registro),'NULLrota pré-condição Vendas sem modular');
  perform pg_temp.ts_assert(exists(select 1 from public.atendimento_rotas_setores where conversa_id=pg_temp.ts_id(2002) and setor='pecas'),'NULLrota pré-condição rota Peças');
  delete from public.atendimento_canais where conversa_id=pg_temp.ts_id(2002);
  perform pg_temp.ts_negar('NULLrota Vendas não rouba rota Peças',6712,'vendas',registro,3,'oficina',null,null,'Tentativa de trocar canal de outro negócio',0,'conflito');
end $$;

do $$ declare registro uuid:=pg_temp.ts_preparar(66,'central');
begin
  perform pg_temp.ts_negar('destinatário unidade estrangeira',6661,'central',registro,2,'vendas','novos',15);
  perform pg_temp.ts_negar('destinatário inativo',6662,'central',registro,2,'vendas','novos',13);
  perform pg_temp.ts_negar('destinatário papel incompatível',6663,'central',registro,2,'oficina',null,14);
  perform pg_temp.ts_negar('destinatário vendedor em Peças',6664,'central',registro,2,'pecas',null,3);
end $$;

-- Normalização do aviso respeita Unicode e o contrato de nome não vazio/até200 caracteres.
do $$ declare registro uuid;alvo uuid;r jsonb;anterior text;
begin
  select nome into anterior from public.usuarios where user_id=pg_temp.ts_id(11);
  update public.usuarios set nome=repeat(chr(160),3) where user_id=pg_temp.ts_id(11);
  registro:=pg_temp.ts_preparar(72,'central');alvo:=pg_temp.ts_id(8072);
  insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao)
    values(alvo,'ts_a',pg_temp.ts_id(1072),pg_temp.ts_id(11),'Pedido Unicode fictício');
  r:=pg_temp.ts_ok(6721,'central',registro,2,'pecas',null,4);
  perform pg_temp.ts_assert(r->'avisoResponsavel'->>'nome' is not null
    and char_length(replace(r->'avisoResponsavel'->>'nome',chr(160),''))>0,'aviso somente NBSP tem fallback não vazio');
  update public.usuarios set nome=repeat('🚗',200) where user_id=pg_temp.ts_id(11);
  registro:=pg_temp.ts_preparar(73,'central');alvo:=pg_temp.ts_id(8073);
  insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao)
    values(alvo,'ts_a',pg_temp.ts_id(1073),pg_temp.ts_id(11),'Pedido Unicode com nome longo');
  r:=pg_temp.ts_ok(6731,'central',registro,2,'pecas',null,4);
  perform pg_temp.ts_assert(r->'avisoResponsavel'->>'nome'=repeat('🚗',200),'aviso preserva200 caracteres Unicode');
  update public.usuarios set nome=anterior where user_id=pg_temp.ts_id(11);
end $$;

do $$ declare registro uuid:=pg_temp.ts_preparar(70,'central');r jsonb;
begin
  r:=pg_temp.ts_ok(6701,'central',registro,2,'pecas',null,4,repeat('🚗',1000));
  perform pg_temp.ts_assert(r->>'ok'='true','nota1000 Unicode sem corte UTF16');
  perform pg_temp.ts_negar('replay muda destino',6001,'central',pg_temp.ts_id(2001),2,'pecas',null,null,'Nota explícita caso 1',0,'conflito');
  perform pg_temp.ts_ler_negado(6001,7,'gerente de outro setor não lê snapshot');
  perform pg_temp.ts_ler_negado(6001,14,'financeiro não lê snapshot');
  perform pg_temp.ts_ler_negado(6001,99,'ator inexistente não lê snapshot');
end $$;

do $$ declare registro uuid;r jsonb;
begin
  registro:=pg_temp.ts_preparar(67,'central');
  r:=pg_temp.ts_ok(6671,'central',registro,1,'oficina',null,5);
  perform pg_temp.ts_assert(r->>'ok'='true','admin em unidade ativa global');
  registro:=pg_temp.ts_preparar(68,'vendas');
  r:=pg_temp.ts_ok(6681,'vendas',registro,6,'pecas',null,4,'Gestão de origem elegível',pg_temp.ts_versao('vendas',registro));
  perform pg_temp.ts_assert(r->>'ok'='true','gerente do setor de origem intervém');
end $$;

do $$ declare registro uuid:=pg_temp.ts_preparar(61,'central');r jsonb;
begin
  update public.conversas set assumida_por='qa-2@comauto.invalid' where id=registro;
  perform pg_temp.ts_negar('recepção não rouba posse',6621,'central',registro,17,'pecas',null,null,'Nota',0,'conflito');
  perform pg_temp.ts_negar('gerente Vendas não opera central',6622,'central',registro,6,'pecas');
  perform pg_temp.ts_negar('central outra unidade',6623,'central',registro,16,'pecas');
  r:=pg_temp.ts_ok(6624,'central',registro,8,'pecas');
  perform pg_temp.ts_assert(r->>'ok'='true','gerente Oficina intervém na central');
end $$;

-- Revogação também se aplica ao replay e à leitura de snapshot já existente.
do $$ declare registro uuid;v integer;r jsonb;
begin
  insert into public.usuario_unidades(user_id,unidade) values(pg_temp.ts_id(15),'ts_a');
  registro:=pg_temp.ts_preparar(62,'vendas',15);v:=pg_temp.ts_versao('vendas',registro);
  r:=pg_temp.ts_ok(6630,'vendas',registro,15,'pecas',null,4,'Unidade adicional autorizada',v);
  delete from public.usuario_unidades where user_id=pg_temp.ts_id(15) and unidade='ts_a';
  perform pg_temp.ts_negar('replay unidade extra revogada',6630,'vendas',registro,15,'pecas',null,4,'Unidade adicional autorizada',v);
  update public.usuarios set ativo=false where user_id=pg_temp.ts_id(2);
  perform pg_temp.ts_negar('replay ator revogado',6001,'central',pg_temp.ts_id(2001),2,'vendas','novos',null,'Nota explícita caso 1',0);
  update public.usuarios set ativo=true where user_id=pg_temp.ts_id(2);
  update public.usuarios set ativo=false where user_id=pg_temp.ts_id(4);
  perform pg_temp.ts_ler_negado(6332,4,'snapshot destinatário desativado');
  update public.usuarios set ativo=true where user_id=pg_temp.ts_id(4);
end $$;

do $$ declare registro uuid;r jsonb;
begin
  insert into public.usuario_unidades(user_id,unidade) values(pg_temp.ts_id(15),'ts_a');
  registro:=pg_temp.ts_preparar(69,'central');
  r:=pg_temp.ts_ok(6691,'central',registro,2,'vendas','novos',15);
  perform pg_temp.ts_assert(pg_temp.ts_ler(6691,15)->>'ok'='true','snapshot destino em unidade adicional');
  delete from public.usuario_unidades where user_id=pg_temp.ts_id(15) and unidade='ts_a';
  perform pg_temp.ts_ler_negado(6691,15,'snapshot unidade extra revogada');
end $$;

-- Reserva/HTTP incerto não pode ser apresentado como transferência limpa.
do $$ declare registro uuid:=pg_temp.ts_preparar(63,'vendas');v integer;r jsonb;
begin
  v:=pg_temp.ts_versao('vendas',registro);
  set local role service_role;r:=public.vendas_reservar_resposta(registro,pg_temp.ts_id(3),v,pg_temp.ts_id(9663),'Resposta reservada fictícia');reset role;
  perform pg_temp.ts_assert(r->>'ok'='true','pré-condição reserva real');
  perform pg_temp.ts_negar('reserva pendente bloqueia',6640,'vendas',registro,3,'pecas',null,null,'Nota',v,'envio_incerto');
  update public.mensagens set metadata=metadata||'{"estagio":"despachando"}'::jsonb where id=pg_temp.ts_id(9663);
  perform pg_temp.ts_negar('despacho incerto bloqueia',6641,'vendas',registro,3,'pecas',null,null,'Nota',v,'envio_incerto');
end $$;

-- Origem que ganha prova contraditória permanece ambígua.
do $$ declare registro uuid:=pg_temp.ts_preparar(64,'vendas');a uuid;r jsonb;v integer;
begin
  select id,versao into a,v from public.atendimentos_modulares where oportunidade_id=registro;
  insert into public.vendas_encaminhamentos_bot(referencia,mensagem_id,conversa_id,cliente_id,unidade,oportunidade_id,funil_id,novo)
    values('wamid.ts.origem.64',pg_temp.ts_id(5064),pg_temp.ts_id(2064),pg_temp.ts_id(1064),'ts_a',registro,pg_temp.ts_id(901),false);
  set local role service_role;r:=public.vincular_mensagem_vendas(a,'wamid.ts.origem.64',pg_temp.ts_id(3));reset role;
  perform pg_temp.ts_assert(r->>'ok'='true','pré-condição origem Vendas comprovada');
  update public.atendimentos_modulares set referencia_inicial='wamid.ts.origem.64',origem_inicial_fixada=true where id=a;
  insert into public.encaminhamentos_bot(referencia,conversa_id,cliente_id,unidade,destino)
    values('wamid.ts.origem.64',pg_temp.ts_id(2064),pg_temp.ts_id(1064),'ts_a','triagem');
  perform pg_temp.ts_negar('origem ambígua tardia',6650,'vendas',registro,3,'pecas',null,null,'Nota',v,'origem_ambigua');
end $$;

-- Claim/envio da origem antiga perdem autorização mesmo usando sua versão atualizada.
do $$ declare antes jsonb;v integer;r jsonb;
begin
  antes:=pg_temp.ts_estado();v:=pg_temp.ts_versao('vendas',pg_temp.ts_id(3004));
  set local role service_role;r:=public.vendas_assumir_atendimento(pg_temp.ts_id(3004),pg_temp.ts_id(3),v);reset role;
  perform pg_temp.ts_assert(r->>'ok'='false','origem antiga não retoma canal');
  perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),'claim antigo sem efeitos');
  set local role service_role;r:=public.vendas_reservar_resposta(pg_temp.ts_id(3004),pg_temp.ts_id(3),v,pg_temp.ts_id(9670),'Resposta da origem antiga');reset role;
  perform pg_temp.ts_assert(r->>'ok'='false','origem antiga não reserva saída');
  perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),'reserva antiga sem efeitos');
end $$;

-- Falhas REAIS depois da escrita iniciada: snapshot integral de todas as tabelas públicas.
create function pg_temp.ts_falha_forcada() returns trigger language plpgsql as $$
begin
  if current_setting('comauto.teste_falhar',true)=tg_table_name then
    if tg_table_name='transferencias_mensagens' then
      if not exists(select 1 from public.transferencias_mensagens where operacao_id=new.operacao_id)
        then return new;end if; -- falha no SEGUNDO snapshot após o primeiro já ter sido inserido
    end if;
    case tg_table_name
      when 'notificacoes' then raise exception 'Falha de aviso fictício' using errcode='P9001';
      when 'audit_log' then raise exception 'Falha de audit fictício' using errcode='P9002';
      when 'transferencias_mensagens' then raise exception 'Falha de snapshot fictício' using errcode='P9003';
      else raise exception 'Falha de destino fictício' using errcode='P9004';
    end case;
  end if;return new;
end $$;
create trigger ts_falha_aviso before insert on public.notificacoes for each row execute function pg_temp.ts_falha_forcada();
create trigger ts_falha_audit before insert on public.audit_log for each row execute function pg_temp.ts_falha_forcada();
create trigger ts_falha_snapshot before insert on public.transferencias_mensagens for each row execute function pg_temp.ts_falha_forcada();
create trigger ts_falha_destino before insert on public.pecas_cotacoes for each row execute function pg_temp.ts_falha_forcada();
do $$ declare registro uuid:=pg_temp.ts_preparar(65,'central');
begin
  perform set_config('comauto.teste_falhar','notificacoes',true);
  perform pg_temp.ts_erro('falha aviso',format('select pg_temp.ts_rpc(6651,''central'',%L,2,''pecas'')',registro),'P9001');
  perform set_config('comauto.teste_falhar','audit_log',true);
  perform pg_temp.ts_erro('falha audit',format('select pg_temp.ts_rpc(6652,''central'',%L,2,''oficina'')',registro),'P9002');
  perform set_config('comauto.teste_falhar','transferencias_mensagens',true);
  perform pg_temp.ts_erro('falha snapshot',format('select pg_temp.ts_rpc(6653,''central'',%L,2,''vendas'',''novos'')',registro),'P9003');
  perform set_config('comauto.teste_falhar','pecas_cotacoes',true);
  perform pg_temp.ts_erro('falha destino',format('select pg_temp.ts_rpc(6654,''central'',%L,2,''pecas'')',registro),'P9004');
  perform set_config('comauto.teste_falhar','',true);
end $$;

-- ACL explícita, ausência de security definer e replay estável após reaplicação populada.
do $$ declare vizinho_snapshot jsonb;vizinho_nota text;ids_antes uuid[];ids_depois uuid[];r jsonb;
begin
  select jsonb_agg(to_jsonb(t) order by mensagem_id) into vizinho_snapshot
    from public.transferencias_mensagens t where operacao_id=pg_temp.ts_id(6331);
  select nota into vizinho_nota from public.transferencias_setores where operacao_id=pg_temp.ts_id(6331);
  select array_agg(mensagem_id order by mensagem_id) into ids_antes from public.transferencias_mensagens where operacao_id=pg_temp.ts_id(6332);
  perform pg_temp.ts_assert(array_length(ids_antes,1)=3,'LGPD pré-condição três cópias do cliente');
  perform pg_temp.ts_erro('snapshot não aceita edição comum',format('set local role service_role;update public.transferencias_mensagens set conteudo=''Texto indevido'' where operacao_id=%L',pg_temp.ts_id(6332)),'55000');
  perform pg_temp.ts_erro('nota não aceita edição comum',format('set local role service_role;update public.transferencias_setores set nota=''Nota indevida'' where operacao_id=%L',pg_temp.ts_id(6332)),'55000');
  update public.clientes set anonimizado=true where id=pg_temp.ts_id(1032);
  perform pg_temp.ts_assert((select bool_and(conteudo='[removido — LGPD]') from public.transferencias_mensagens where cliente_id=pg_temp.ts_id(1032)),'LGPD redige todos os corpos copiados');
  perform pg_temp.ts_assert((select bool_and(nota='[removido — LGPD]') from public.transferencias_setores where cliente_id=pg_temp.ts_id(1032)),'LGPD redige notas dos encaminhamentos');
  select array_agg(mensagem_id order by mensagem_id) into ids_depois from public.transferencias_mensagens where operacao_id=pg_temp.ts_id(6332);
  perform pg_temp.ts_assert(ids_antes=ids_depois,'LGPD preserva identidades das cópias');
  perform pg_temp.ts_assert(vizinho_snapshot=(select jsonb_agg(to_jsonb(t) order by mensagem_id) from public.transferencias_mensagens t where operacao_id=pg_temp.ts_id(6331))
    and vizinho_nota=(select nota from public.transferencias_setores where operacao_id=pg_temp.ts_id(6331)),'LGPD preserva outro cliente');
  perform pg_temp.ts_ler_negado(6332,4,'LGPD revoga leitura do titular do destino');
  perform pg_temp.ts_ler_negado(6332,1,'LGPD revoga também leitura administrativa');
  perform pg_temp.ts_erro('LGPD não permite reescrita arbitrária',format('set local role service_role;update public.transferencias_mensagens set conteudo=''Restauração indevida'' where operacao_id=%L',pg_temp.ts_id(6332)),'55000');
  update public.clientes set anonimizado=false where id=pg_temp.ts_id(1032);
  perform pg_temp.ts_assert((select bool_and(conteudo='[removido — LGPD]') from public.transferencias_mensagens where cliente_id=pg_temp.ts_id(1032))
    and (select bool_and(nota='[removido — LGPD]') from public.transferencias_setores where cliente_id=pg_temp.ts_id(1032)),'LGPD flag reversa não restaura dados');
  r:=pg_temp.ts_ler(6332,4);
  perform pg_temp.ts_assert(r->>'ok'='true' and r->>'nota'='[removido — LGPD]'
    and not exists(select 1 from jsonb_array_elements(r->'mensagens') m where m->>'conteudo' is distinct from '[removido — LGPD]'),
    'LGPD reativação só permite nota e corpos redigidos');
end $$;

do $$ declare nome text;papel text;p record;
begin
  foreach nome in array array['transferencias_setores','transferencias_mensagens','atendimento_rotas_setores'] loop
    perform pg_temp.ts_assert((select relrowsecurity from pg_class where oid=('public.'||nome)::regclass),'RLS '||nome);
    foreach papel in array array['anon','authenticated'] loop
      perform pg_temp.ts_assert(not has_table_privilege(papel,'public.'||nome,'select,insert,update,delete'),'ACL '||papel||' '||nome);
    end loop;
  end loop;
  for p in select oid,proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace
    and proname in ('transferir_atendimento_setor','ler_snapshot_transferencia') loop
    perform pg_temp.ts_assert(not p.prosecdef,'invoker '||p.proname);
    perform pg_temp.ts_assert(array_to_string(p.proconfig,',') like '%search_path=""%','search_path '||p.proname);
    perform pg_temp.ts_assert(not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute'),'execute fechado '||p.proname);
  end loop;
end $$;
create function pg_temp.ts_reaplicacao() returns void language plpgsql as $$
declare antes jsonb:=pg_temp.ts_estado();r jsonb;
begin
  r:=pg_temp.ts_ok(6001,'central',pg_temp.ts_id(2001),2,'vendas','novos',null,'Nota explícita caso 1',0);
  perform pg_temp.ts_assert(antes=pg_temp.ts_estado(),'reapply replay sem escrita');
  perform pg_temp.ts_assert((select count(*) from public.transferencias_setores where operacao_id=pg_temp.ts_id(6001))=1,'reapply ledger preservado');
end $$;

rollback;
