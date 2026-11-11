-- Banco descartável: módulos 0001/0002/0003/0005/0006, nessa ordem.
-- Nunca usa credenciais, usuários ou dados reais. Sem grants corretivos na fixture.
begin;

create function pg_temp.atm_uuid(n integer) returns uuid language sql immutable as $$
  select ('40000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.estado_atendimentos() returns jsonb language sql as $$
  select jsonb_build_object(
    'atendimentos',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimentos_modulares t),
    'canais',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.atendimento_canais t),
    'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.audit_log t),
    'conversas',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.conversas t),
    'oportunidades',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.vendas_oportunidades t),
    'cotacoes',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.pecas_cotacoes t)
  );
$$;
create function pg_temp.contexto_atm(p_setor text,p_registro uuid,p_ator uuid,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
  execute format('set local role %I',p_papel);
  if current_user<>p_papel then raise exception 'A fixture não mudou de papel.'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into r
    from public.contexto_atendimento_modular(p_setor,p_registro,p_ator) t;
  reset role;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.abrir_atm(p_setor text,p_registro uuid,p_ator uuid,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
  execute format('set local role %I',p_papel);
  if current_user<>p_papel then raise exception 'A fixture não mudou de papel.'; end if;
  r:=public.abrir_atendimento_modular(p_setor,p_registro,p_ator);
  reset role;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.assumir_atm(p_id uuid,p_ator uuid,p_versao integer,p_papel text default 'service_role')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_papel not in ('service_role','anon','authenticated') then raise exception 'Papel inválido na fixture.'; end if;
  execute format('set local role %I',p_papel);
  if current_user<>p_papel then raise exception 'A fixture não mudou de papel.'; end if;
  r:=public.assumir_atendimento_modular(p_id,p_ator,p_versao);
  reset role;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.recusar_abertura_atm(p_setor text,p_registro uuid,p_ator uuid,p_constraint text default null)
returns void language plpgsql as $$
declare antes jsonb; r jsonb; restricao text; lancou boolean:=false;
begin
  antes:=pg_temp.estado_atendimentos();
  begin
    r:=pg_temp.abrir_atm(p_setor,p_registro,p_ator);
  exception when check_violation then
    get stacked diagnostics restricao=constraint_name;
    if p_constraint is null or restricao is distinct from p_constraint then raise; end if;
    lancou:=true;
  end;
  if p_constraint is not null and not lancou then raise exception 'Falha induzida não foi atingida: %.',p_constraint; end if;
  if not lancou and (r->>'ok' is distinct from 'false' or (p_constraint is null and r is distinct from '{"ok":false,"codigo":"nao_encontrado"}'::jsonb)) then
    raise exception 'Abertura deveria recusar, obteve %.',r;
  end if;
  if pg_temp.estado_atendimentos() is distinct from antes then raise exception 'Abertura recusada deixou efeito parcial.'; end if;
end $$;
create function pg_temp.recusar_posse_atm(p_id uuid,p_ator uuid,p_versao integer,p_codigo text default 'nao_encontrado',p_constraint text default null)
returns void language plpgsql as $$
declare antes jsonb; r jsonb; restricao text; lancou boolean:=false;
begin
  antes:=pg_temp.estado_atendimentos();
  begin
    r:=pg_temp.assumir_atm(p_id,p_ator,p_versao);
  exception when check_violation then
    get stacked diagnostics restricao=constraint_name;
    if p_constraint is null or restricao is distinct from p_constraint then raise; end if;
    lancou:=true;
  end;
  if p_constraint is not null and not lancou then raise exception 'Falha induzida não foi atingida: %.',p_constraint; end if;
  if not lancou and (r->>'ok' is distinct from 'false' or (p_constraint is null and r is distinct from jsonb_build_object('ok',false,'codigo',p_codigo))) then
    raise exception 'Posse deveria recusar com %, obteve %.',p_codigo,r;
  end if;
  if pg_temp.estado_atendimentos() is distinct from antes then raise exception 'Posse recusada deixou efeito parcial.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values
  ('atm_principal','Atendimento principal fictício',true),('atm_fora','Outra unidade fictícia',true),
  ('atm_inativa','Unidade inativa fictícia',false),('atm_canal','Unidade física fictícia',true);
insert into auth.users(id) select pg_temp.atm_uuid(n) from generate_series(1,19)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.atm_uuid(1),'Vendedor A','vendedor','vendas','atm_principal',true),
  (pg_temp.atm_uuid(2),'Vendedor B','vendedor','vendas','atm_principal',true),
  (pg_temp.atm_uuid(3),'Peças A','pecas','pecas','atm_principal',true),
  (pg_temp.atm_uuid(4),'Peças B','pecas','pecas','atm_principal',true),
  (pg_temp.atm_uuid(5),'Gerente Vendas','gerente','vendas','atm_principal',true),
  (pg_temp.atm_uuid(6),'Gerente Peças','gerente','pecas','atm_principal',true),
  (pg_temp.atm_uuid(7),'Gerente extra','gerente','administracao','atm_fora',true),
  (pg_temp.atm_uuid(8),'Admin global','admin','administracao','atm_fora',true),
  (pg_temp.atm_uuid(9),'Gerente Oficina','gerente','oficina','atm_principal',true),
  (pg_temp.atm_uuid(10),'Vendedor inativo','vendedor','vendas','atm_principal',false),
  (pg_temp.atm_uuid(11),'Vendedor fora','vendedor','vendas','atm_fora',true),
  (pg_temp.atm_uuid(12),'Peças fora','pecas','pecas','atm_fora',true),
  (pg_temp.atm_uuid(13),'Vendedor extra','vendedor','vendas','atm_fora',true),
  (pg_temp.atm_uuid(14),'Peças extra','pecas','pecas','atm_fora',true),
  (pg_temp.atm_uuid(15),'Admin inativo','admin','administracao','atm_fora',false),
  (pg_temp.atm_uuid(16),'Peças inativo','pecas','pecas','atm_principal',false),
  (pg_temp.atm_uuid(17),'Recepção','recepcao','oficina','atm_principal',true),
  (pg_temp.atm_uuid(18),'Vendedor unidade inativa','vendedor','vendas','atm_inativa',true),
  (pg_temp.atm_uuid(19),'Peças unidade inativa','pecas','pecas','atm_inativa',true);
insert into public.usuario_unidades(user_id,unidade) values
  (pg_temp.atm_uuid(7),'atm_principal'),(pg_temp.atm_uuid(13),'atm_principal'),(pg_temp.atm_uuid(14),'atm_principal');
insert into public.clientes(id,telefone,nome,vendedor_id,unidade_origem,anonimizado)
select pg_temp.atm_uuid(n),'55119000'||lpad(n::text,5,'0'),'Cliente fictício '||n,
  pg_temp.atm_uuid(1),'atm_principal',n=108 from generate_series(101,125)n;
insert into public.conversas(id,cliente_id,unidade,status,assumida_por)
select pg_temp.atm_uuid(n+100),pg_temp.atm_uuid(n),'atm_canal',
  case n when 109 then 'bot' when 110 then 'encerrada' else 'humano' end,
  case n when 111 then 'legado@example.invalid' else null end
from generate_series(101,124)n where n<>112;
insert into public.vendas_funis(id,unidade,chave,nome,ativo) values
  (pg_temp.atm_uuid(501),'atm_principal','fixture','Funil principal',true),
  (pg_temp.atm_uuid(502),'atm_fora','fixture','Funil fora',true),
  (pg_temp.atm_uuid(503),'atm_inativa','fixture','Funil unidade inativa',true),
  (pg_temp.atm_uuid(504),'atm_principal','inativo','Funil inativo',false);
insert into public.vendas_etapas(id,funil_id,nome,ordem,tipo) values
  (pg_temp.atm_uuid(601),pg_temp.atm_uuid(501),'Aberta',1,'aberta'),
  (pg_temp.atm_uuid(602),pg_temp.atm_uuid(501),'Ganha',2,'ganho'),
  (pg_temp.atm_uuid(603),pg_temp.atm_uuid(502),'Aberta',1,'aberta'),
  (pg_temp.atm_uuid(604),pg_temp.atm_uuid(503),'Aberta',1,'aberta'),
  (pg_temp.atm_uuid(605),pg_temp.atm_uuid(504),'Aberta',1,'aberta');
insert into public.vendas_oportunidades(id,unidade,funil_id,etapa_id,cliente_id,vendedor_id,criado_por)
select pg_temp.atm_uuid(n),case n when 303 then 'atm_fora' when 313 then 'atm_inativa' else 'atm_principal' end,
  pg_temp.atm_uuid(case n when 303 then 502 when 313 then 503 when 321 then 504 else 501 end),
  pg_temp.atm_uuid(case n when 303 then 603 when 305 then 602 when 313 then 604 when 321 then 605 else 601 end),
  pg_temp.atm_uuid(case n when 302 then 101 else n-200 end),
  case n when 304 then null when 302 then pg_temp.atm_uuid(2) when 307 then pg_temp.atm_uuid(13)
    when 313 then pg_temp.atm_uuid(18) else pg_temp.atm_uuid(1) end,
  'fixture@example.invalid'
from generate_series(301,324)n;
insert into public.pecas_cotacoes(id,unidade,cliente_id,responsavel_id,descricao,status,venda_confirmada_em,venda_confirmada_por)
select pg_temp.atm_uuid(n),case n when 408 then 'atm_inativa' when 409 then 'atm_fora' else 'atm_principal' end,
  pg_temp.atm_uuid(case n when 407 then 108 when 408 then 113 when 409 then 107 else n-300 end),
  case n when 403 then null when 406 then pg_temp.atm_uuid(14) when 408 then pg_temp.atm_uuid(19)
    when 409 then pg_temp.atm_uuid(12) else pg_temp.atm_uuid(3) end,
  'Cotação fictícia '||n,case n when 404 then 'entregue' when 405 then 'aprovado' when 414 then 'em_separacao' else 'novo' end,
  case n when 405 then now() else null end,case n when 405 then pg_temp.atm_uuid(3) else null end
from generate_series(401,414)n;

-- Escopo vem do registro do setor, não da carteira única do cliente.
do $$
declare setor_atual text; registro uuid; ator integer; esperado jsonb;
begin
  esperado:=jsonb_build_array(jsonb_build_object('cliente_id',pg_temp.atm_uuid(101),'conversa_id',pg_temp.atm_uuid(201),
    'unidade','atm_principal','responsavel_id',pg_temp.atm_uuid(1)));
  if pg_temp.contexto_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(1)) is distinct from esperado then
    raise exception 'Contexto Vendas não derivou cliente/conversa/unidade/responsável corretos.'; end if;
  if pg_temp.contexto_atm('vendas',pg_temp.atm_uuid(302),pg_temp.atm_uuid(1))<>'[]'::jsonb then
    raise exception 'Carteira do cliente não pode liberar oportunidade de colega.'; end if;
  foreach ator in array array[2,3,4,6,9,10,11,15,16,17] loop
    if pg_temp.contexto_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(ator))<>'[]'::jsonb then raise exception 'Contexto Vendas indevido: %.',ator; end if;
    perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(ator));
  end loop;
  foreach ator in array array[1,2,4,5,9,10,11,12,15,16,17] loop
    if pg_temp.contexto_atm('pecas',pg_temp.atm_uuid(401),pg_temp.atm_uuid(ator))<>'[]'::jsonb then raise exception 'Contexto Peças indevido: %.',ator; end if;
    perform pg_temp.recusar_abertura_atm('pecas',pg_temp.atm_uuid(401),pg_temp.atm_uuid(ator));
  end loop;
  foreach ator in array array[5,7,8] loop
    if jsonb_array_length(pg_temp.contexto_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(ator)))<>1 then raise exception 'Supervisor Vendas autorizado recusado.'; end if;
  end loop;
  foreach ator in array array[3,6,7,8] loop
    if jsonb_array_length(pg_temp.contexto_atm('pecas',pg_temp.atm_uuid(401),pg_temp.atm_uuid(ator)))<>1 then raise exception 'Equipe/supervisor Peças autorizado recusado.'; end if;
  end loop;
  -- Fora da unidade, sem dono, fechado, anonimizado, sem conversa, unidade/funil inativo.
  foreach ator in array array[303,304,305,308,312,313,321] loop
    perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(ator),pg_temp.atm_uuid(1));
  end loop;
  foreach ator in array array[403,404,407,408] loop
    perform pg_temp.recusar_abertura_atm('pecas',pg_temp.atm_uuid(ator),pg_temp.atm_uuid(3));
  end loop;
  perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(304),pg_temp.atm_uuid(8));
  perform pg_temp.recusar_abertura_atm('pecas',pg_temp.atm_uuid(403),pg_temp.atm_uuid(8));
  perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(313),pg_temp.atm_uuid(8));
  perform pg_temp.recusar_abertura_atm('pecas',pg_temp.atm_uuid(408),pg_temp.atm_uuid(8));
  perform pg_temp.recusar_abertura_atm('oficina',pg_temp.atm_uuid(301),pg_temp.atm_uuid(8));
  perform pg_temp.recusar_abertura_atm(null,pg_temp.atm_uuid(301),pg_temp.atm_uuid(8));
  perform pg_temp.recusar_abertura_atm('vendas',null,pg_temp.atm_uuid(8));
  perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(301),null);
  perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(999),pg_temp.atm_uuid(8));
  if jsonb_array_length(pg_temp.contexto_atm('pecas',pg_temp.atm_uuid(405),pg_temp.atm_uuid(3)))<>1
    or jsonb_array_length(pg_temp.contexto_atm('pecas',pg_temp.atm_uuid(414),pg_temp.atm_uuid(3)))<>1 then
    raise exception 'Peças aprovada/venda confirmada ou em separação ainda permite atendimento.'; end if;
end $$;

-- Abrir não toma o canal. Replay não muda identidade, versão, domínio nem auditoria.
do $$
declare r jsonb; replay jsonb; antes jsonb; total_audit integer; id1 uuid;
begin
  select count(*) into total_audit from public.audit_log;
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(1));
  if r->>'ok' is distinct from 'true' or (r->>'versao')::integer<>0 or r->>'setor'<>'vendas'
    or r->>'registroId'<>pg_temp.atm_uuid(301)::text or r->>'id' is null then raise exception 'Contrato da abertura inválido: %.',r; end if;
  id1:=(r->>'id')::uuid;
  if (select count(*) from public.audit_log)<>total_audit+1 then raise exception 'Abertura precisa auditar uma vez.'; end if;
  if exists(select 1 from public.atendimento_canais) then raise exception 'Abertura não deve reservar canal.'; end if;
  if not exists(select 1 from public.atendimentos_modulares where id=id1 and setor='vendas'
    and oportunidade_id=pg_temp.atm_uuid(301) and cotacao_id is null and conversa_id=pg_temp.atm_uuid(201)
    and cliente_id=pg_temp.atm_uuid(101) and unidade='atm_principal' and assumido_por is null
    and versao=0 and criado_por=pg_temp.atm_uuid(1)) then raise exception 'Snapshot da abertura incorreto.'; end if;
  antes:=pg_temp.estado_atendimentos();
  replay:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(5));
  if replay is distinct from r or pg_temp.estado_atendimentos() is distinct from antes then raise exception 'Replay da abertura duplicou ou alterou estado.'; end if;
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(302),pg_temp.atm_uuid(2));
  if r->>'ok' is distinct from 'true' or (r->>'id')::uuid=id1 then raise exception 'Oportunidades do mesmo cliente precisam de atendimentos distintos.'; end if;
  r:=pg_temp.abrir_atm('pecas',pg_temp.atm_uuid(401),pg_temp.atm_uuid(3));
  if r->>'ok' is distinct from 'true' or r->>'setor'<>'pecas' or r->>'registroId'<>pg_temp.atm_uuid(401)::text then raise exception 'Peças não abriu pelo contrato comum.'; end if;
  if not exists(select 1 from public.atendimentos_modulares where id=(r->>'id')::uuid and cotacao_id=pg_temp.atm_uuid(401)
    and oportunidade_id is null and conversa_id=pg_temp.atm_uuid(201) and unidade='atm_principal') then raise exception 'Vínculo Peças incorreto.'; end if;
  if exists(select 1 from public.atendimento_canais) then raise exception 'Aberturas concorrentes de contexto reservaram canal antes da posse.'; end if;
end $$;

-- Posse exata, replay com versão atual e disputa sequencial pelo mesmo canal físico.
do $$
declare id1 uuid; id2 uuid; id3 uuid; r jsonb; antes jsonb; total_audit integer; conv_antes jsonb;
begin
  select id into id1 from public.atendimentos_modulares where oportunidade_id=pg_temp.atm_uuid(301);
  select id into id2 from public.atendimentos_modulares where oportunidade_id=pg_temp.atm_uuid(302);
  select id into id3 from public.atendimentos_modulares where cotacao_id=pg_temp.atm_uuid(401);
  select to_jsonb(c) into conv_antes from public.conversas c where id=pg_temp.atm_uuid(201);
  select count(*) into total_audit from public.audit_log;
  r:=pg_temp.assumir_atm(id1,pg_temp.atm_uuid(1),0);
  if r->>'ok' is distinct from 'true' or r->>'id'<>id1::text or (r->>'versao')::integer<>1
    or r->>'setor'<>'vendas' or r->>'registroId'<>pg_temp.atm_uuid(301)::text then raise exception 'Contrato da primeira posse inválido: %.',r; end if;
  if not exists(select 1 from public.atendimentos_modulares where id=id1 and assumido_por=pg_temp.atm_uuid(1)
      and dono_na_posse=pg_temp.atm_uuid(1) and versao=1)
    or not exists(select 1 from public.atendimento_canais where conversa_id=pg_temp.atm_uuid(201) and atendimento_id=id1) then raise exception 'Posse não gravou dono/versão/canal corretos.'; end if;
  if (select count(*) from public.audit_log)<>total_audit+1 then raise exception 'Posse precisa auditar uma vez.'; end if;
  if (select to_jsonb(c) from public.conversas c where id=pg_temp.atm_uuid(201)) is distinct from conv_antes then raise exception 'A1 modular alterou posse física legada.'; end if;
  antes:=pg_temp.estado_atendimentos();
  if pg_temp.assumir_atm(id1,pg_temp.atm_uuid(1),1) is distinct from r or pg_temp.estado_atendimentos() is distinct from antes then raise exception 'Replay de posse mudou versão/auditoria.'; end if;
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(1),0,'conflito');
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(2),1);
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(5),1,'conflito');
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(8),1,'conflito');
  perform pg_temp.recusar_posse_atm(id2,pg_temp.atm_uuid(2),0,'conflito');
  perform pg_temp.recusar_posse_atm(id3,pg_temp.atm_uuid(3),0,'conflito');
  perform pg_temp.recusar_posse_atm(null,pg_temp.atm_uuid(1),0);
  perform pg_temp.recusar_posse_atm(id1,null,1);
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(1),null);
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(1),-1);
  perform pg_temp.recusar_posse_atm(pg_temp.atm_uuid(999),pg_temp.atm_uuid(1),0);
end $$;

-- Transferir oportunidade sem mover carteira remove acesso antigo e permite substituir posse obsoleta.
update public.vendas_oportunidades set vendedor_id=pg_temp.atm_uuid(2) where id=pg_temp.atm_uuid(301);
do $$
declare id1 uuid; r jsonb; antes jsonb;
begin
  select id into id1 from public.atendimentos_modulares where oportunidade_id=pg_temp.atm_uuid(301);
  if (select vendedor_id from public.clientes where id=pg_temp.atm_uuid(101))<>pg_temp.atm_uuid(1) then raise exception 'Fixture deveria manter carteira antiga.'; end if;
  if pg_temp.contexto_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(1))<>'[]'::jsonb then raise exception 'Carteira antiga manteve acesso ao registro transferido.'; end if;
  perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(1));
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(1),1);
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(2));
  if r->>'ok' is distinct from 'true' or r->>'id'<>id1::text or (r->>'versao')::integer<>1 then raise exception 'Transferência reabriu atendimento com outra identidade.'; end if;
  r:=pg_temp.assumir_atm(id1,pg_temp.atm_uuid(2),1);
  if r->>'ok' is distinct from 'true' or (r->>'versao')::integer<>2 or not exists(
    select 1 from public.atendimentos_modulares where id=id1 and assumido_por=pg_temp.atm_uuid(2) and dono_na_posse=pg_temp.atm_uuid(2)) then
    raise exception 'Dono novo não substituiu posse obsoleta.'; end if;
  antes:=pg_temp.estado_atendimentos();
  perform pg_temp.assumir_atm(id1,pg_temp.atm_uuid(2),2);
  if pg_temp.estado_atendimentos() is distinct from antes then raise exception 'Replay após transferência alterou estado.'; end if;
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(5),2,'conflito');
end $$;

-- Peças segue o mesmo ciclo de posse e transferência do responsável.
do $$
declare r jsonb; id1 uuid;
begin
  r:=pg_temp.abrir_atm('pecas',pg_temp.atm_uuid(402),pg_temp.atm_uuid(3)); id1:=(r->>'id')::uuid;
  r:=pg_temp.assumir_atm(id1,pg_temp.atm_uuid(3),0);
  if r->>'ok' is distinct from 'true' or (r->>'versao')::integer<>1 then raise exception 'Peças não tomou posse.'; end if;
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(6),1,'conflito');
  update public.pecas_cotacoes set responsavel_id=pg_temp.atm_uuid(4) where id=pg_temp.atm_uuid(402);
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(3),1);
  r:=pg_temp.assumir_atm(id1,pg_temp.atm_uuid(4),1);
  if r->>'ok' is distinct from 'true' or (r->>'versao')::integer<>2 or not exists(
    select 1 from public.atendimentos_modulares where id=id1 and assumido_por=pg_temp.atm_uuid(4) and dono_na_posse=pg_temp.atm_uuid(4)) then raise exception 'Peças não substituiu responsável antigo.'; end if;
end $$;

-- Unidade extra atual permite; sua revogação entre abrir e assumir bloqueia sem efeitos.
do $$
declare r jsonb; id1 uuid;
begin
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(307),pg_temp.atm_uuid(13));
  if r->>'ok' is distinct from 'true' then raise exception 'Vendedor com unidade extra recusado.'; end if;
  id1:=(r->>'id')::uuid;
  delete from public.usuario_unidades where user_id=pg_temp.atm_uuid(13) and unidade='atm_principal';
  perform pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(307),pg_temp.atm_uuid(13));
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(13),0);
  r:=pg_temp.abrir_atm('pecas',pg_temp.atm_uuid(406),pg_temp.atm_uuid(14));
  if r->>'ok' is distinct from 'true' then raise exception 'Peças com unidade extra recusado.'; end if;
  id1:=(r->>'id')::uuid;
  delete from public.usuario_unidades where user_id=pg_temp.atm_uuid(14) and unidade='atm_principal';
  perform pg_temp.recusar_abertura_atm('pecas',pg_temp.atm_uuid(406),pg_temp.atm_uuid(14));
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(14),0);
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(303),pg_temp.atm_uuid(8));
  if r->>'ok' is distinct from 'true' then raise exception 'Admin global não abriu unidade ativa fora da principal.'; end if;
end $$;

-- Canal bot/encerrado/ocupado pelo legado não pode ser tomado pelo módulo.
do $$
declare n integer; r jsonb;
begin
  foreach n in array array[309,310,311] loop
    r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(n),pg_temp.atm_uuid(1));
    if r->>'ok' is distinct from 'true' then raise exception 'Domínio válido deve abrir antes de verificar disponibilidade do canal.'; end if;
    perform pg_temp.recusar_posse_atm((r->>'id')::uuid,pg_temp.atm_uuid(1),0,'conflito');
  end loop;
end $$;

-- Snapshot persistido não é religado silenciosamente depois de trocar cliente/unidade/conversa.
do $$
declare r jsonb; id1 uuid;
begin
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(316),pg_temp.atm_uuid(1)); id1:=(r->>'id')::uuid;
  update public.vendas_oportunidades set cliente_id=pg_temp.atm_uuid(124) where id=pg_temp.atm_uuid(316);
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(1),0);
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(317),pg_temp.atm_uuid(8)); id1:=(r->>'id')::uuid;
  update public.vendas_oportunidades set unidade='atm_fora',funil_id=pg_temp.atm_uuid(502),etapa_id=pg_temp.atm_uuid(603) where id=pg_temp.atm_uuid(317);
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(8),0);
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(318),pg_temp.atm_uuid(1)); id1:=(r->>'id')::uuid;
  update public.atendimentos_modulares set conversa_id=pg_temp.atm_uuid(224) where id=id1;
  perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(1),0);
end $$;

-- Fechamento, anonimização, desatribuição e revogação após abrir voltam a ser checados na posse.
do $$
declare n integer; r jsonb; id1 uuid;
begin
  foreach n in array array[319,320,322,323,324] loop
    r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(n),pg_temp.atm_uuid(1)); id1:=(r->>'id')::uuid;
    if r->>'ok' is distinct from 'true' then raise exception 'Abertura de fixture válida falhou: %.',n; end if;
    if n=319 then update public.vendas_oportunidades set etapa_id=pg_temp.atm_uuid(602) where id=pg_temp.atm_uuid(n);
    elsif n=320 then update public.vendas_oportunidades set vendedor_id=null where id=pg_temp.atm_uuid(n);
    elsif n=322 then update public.clientes set anonimizado=true where id=pg_temp.atm_uuid(122);
    elsif n=323 then update public.unidades set ativa=false where chave='atm_principal';
    elsif n=324 then update public.usuarios set ativo=false where user_id=pg_temp.atm_uuid(1);
    end if;
    perform pg_temp.recusar_posse_atm(id1,pg_temp.atm_uuid(1),0);
    if n=323 then update public.unidades set ativa=true where chave='atm_principal'; end if;
    if n=324 then update public.usuarios set ativo=true where user_id=pg_temp.atm_uuid(1); end if;
  end loop;
end $$;

-- Recusa do audit_log precisa desfazer inserção, slot e versão, sem sucesso aparente.
do $$
declare r jsonb;
begin
  r:=pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(315),pg_temp.atm_uuid(1));
  if r->>'ok' is distinct from 'true' then raise exception 'Fixture do rollback da posse não abriu.'; end if;
end $$;
alter table public.audit_log add constraint fixture_atm_rejeita_audit check(false) not valid;
select pg_temp.recusar_abertura_atm('vendas',pg_temp.atm_uuid(314),pg_temp.atm_uuid(1),'fixture_atm_rejeita_audit');
select pg_temp.recusar_posse_atm((select id from public.atendimentos_modulares where oportunidade_id=pg_temp.atm_uuid(315)),
  pg_temp.atm_uuid(1),0,'nao_encontrado','fixture_atm_rejeita_audit');
alter table public.audit_log drop constraint fixture_atm_rejeita_audit;

-- RLS fechado e sem execute/browser; funções invoker com search_path vazio.
do $$
declare tabela text; papel text; privilegio text; assinatura text; funcao record;
begin
  foreach tabela in array array['atendimentos_modulares','atendimento_canais'] loop
    if not exists(select 1 from pg_class where oid=('public.'||tabela)::regclass and relrowsecurity)
      or exists(select 1 from pg_policy where polrelid=('public.'||tabela)::regclass) then raise exception 'RLS precisa estar fechado em %.',tabela; end if;
    foreach papel in array array['anon','authenticated'] loop
      foreach privilegio in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(papel,'public.'||tabela,privilegio) then raise exception 'Tabela % exposta a %.',tabela,papel; end if;
      end loop;
      if has_any_column_privilege(papel,'public.'||tabela,'SELECT,INSERT,UPDATE') then raise exception 'Grants de coluna expostos ao navegador.'; end if;
    end loop;
    if not has_table_privilege('service_role','public.'||tabela,'SELECT') then raise exception 'Servidor sem leitura de %.',tabela; end if;
  end loop;
  foreach assinatura in array array[
    'public.contexto_atendimento_modular(text,uuid,uuid)',
    'public.abrir_atendimento_modular(text,uuid,uuid)',
    'public.assumir_atendimento_modular(uuid,uuid,integer)'
  ] loop
    select prosecdef,proconfig,proacl,proowner into funcao from pg_proc where oid=assinatura::regprocedure;
    if funcao.prosecdef or not coalesce(funcao.proconfig && array['search_path=""','search_path='],false)
      or exists(select 1 from aclexplode(coalesce(funcao.proacl,acldefault('f',funcao.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Invoker/search_path/ACL incorreto em %.',assinatura; end if;
    if not has_function_privilege('service_role',assinatura,'EXECUTE') then raise exception 'Servidor sem RPC.'; end if;
    foreach papel in array array['anon','authenticated'] loop
      if has_function_privilege(papel,assinatura,'EXECUTE') then raise exception 'RPC exposta a navegador.'; end if;
      begin
        if assinatura like '%contexto_%' then perform pg_temp.contexto_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(2),papel);
        elsif assinatura like '%abrir_%' then perform pg_temp.abrir_atm('vendas',pg_temp.atm_uuid(301),pg_temp.atm_uuid(2),papel);
        else perform pg_temp.assumir_atm((select id from public.atendimentos_modulares where oportunidade_id=pg_temp.atm_uuid(301)),pg_temp.atm_uuid(2),2,papel);
        end if;
        raise exception 'Browser executou RPC.';
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;
  if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,INSERT,UPDATE,DELETE') then raise exception 'A1 não precisa de grants ao Auth.'; end if;
end $$;

rollback;
