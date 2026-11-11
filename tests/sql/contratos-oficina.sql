-- Executar em banco descartável após 0001_init, 0002_nucleo e 0004_oficina.
begin;

-- Sem grants na fixture: as dependências pertencem à migration 0004.
insert into public.unidades (chave, nome, ativa) values
  ('oficina_fixture', 'Unidade fixture', true),('oficina_outra','Outra unidade ativa',true);
insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000103'),
  ('00000000-0000-4000-8000-000000000104');

insert into public.usuarios (user_id, nome, papel, setor, unidade, ativo) values
  ('00000000-0000-4000-8000-000000000101', 'Fixture ativa', 'consultor_tecnico', 'oficina', 'comauto', true),
  ('00000000-0000-4000-8000-000000000102', 'Fixture inativa', 'consultor_tecnico', 'oficina', 'comauto', false),
  ('00000000-0000-4000-8000-000000000103', 'Fixture de unidade inativa', 'consultor_tecnico', 'oficina', 'santaluzia', true),
  ('00000000-0000-4000-8000-000000000104', 'Fixture de segundo autor', 'consultor_tecnico', 'oficina', 'comauto', true);

insert into public.usuario_unidades (user_id, unidade)
values ('00000000-0000-4000-8000-000000000101', 'oficina_fixture');

insert into public.clientes (id, telefone, nome, anonimizado) values
  ('00000000-0000-4000-8000-000000000111', '5511900000111', 'Fixture de Oficina', false),
  ('00000000-0000-4000-8000-000000000112', '5511900000112', 'Outra ficha', false),
  ('00000000-0000-4000-8000-000000000113', '5511900000113', null, true);

insert into public.veiculos (id, cliente_id, placa) values
  ('00000000-0000-4000-8000-000000000114', '00000000-0000-4000-8000-000000000111', 'abc-1d23'),
  ('00000000-0000-4000-8000-000000000115', '00000000-0000-4000-8000-000000000112', 'ABC1D23'),
  ('00000000-0000-4000-8000-000000000116', '00000000-0000-4000-8000-000000000112', 'XYZ0001'),
  ('00000000-0000-4000-8000-000000000117', '00000000-0000-4000-8000-000000000111', 'DDD4E56'),
  ('00000000-0000-4000-8000-000000000118', '00000000-0000-4000-8000-000000000111', 'ddd-4e56');

-- Faz a inserção do histórico falhar depois de inserir o atendimento.
alter table public.oficina_atendimentos_historico add constraint fixture_rejeita_historico
  check (atendimento_id <> '00000000-0000-4000-8000-000000000123');

set local role service_role;

do $$
declare
  ator constant uuid := '00000000-0000-4000-8000-000000000101';
  ator_inativo constant uuid := '00000000-0000-4000-8000-000000000102';
  ator_unidade_inativa constant uuid := '00000000-0000-4000-8000-000000000103';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000104';
  atendimento constant uuid := '00000000-0000-4000-8000-000000000121';
  sem_placa constant uuid := '00000000-0000-4000-8000-000000000122';
  falha_historico constant uuid := '00000000-0000-4000-8000-000000000123';
  telefone constant text := '5511900000111';
  pedido constant text := 'Diagnosticar ruído';
  restricao text;
begin
  if public.oficina_registrar_atendimento(atendimento, 'oficina_outra', ator, telefone, null, pedido) is distinct from 'unidade'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator_inativo, telefone, null, pedido) is distinct from 'unidade'
    or public.oficina_registrar_atendimento(atendimento, 'santaluzia', ator_unidade_inativa, telefone, null, pedido) is distinct from 'unidade' then
    raise exception 'A criação exige usuário ativo e unidade ativa autorizada.';
  end if;

  if public.oficina_registrar_atendimento(atendimento, 'comauto', ator, '5511900000199', null, pedido) is distinct from 'cliente'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, '5511900000113', null, pedido) is distinct from 'cliente' then
    raise exception 'A criação exige cliente existente e não anonimizado.';
  end if;

  if public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, 'XYZ0001', pedido) is distinct from 'veiculo'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, 'ZZZ9Z99', pedido) is distinct from 'veiculo'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, 'DDD4E56', pedido) is distinct from 'veiculo'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, '---', pedido) is distinct from 'veiculo' then
    raise exception 'A placa informada exige um único veículo correspondente vinculado ao cliente.';
  end if;

  if public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, null, '') is distinct from 'conflito'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, null, E'\tPedido') is distinct from 'conflito'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, null, repeat('x', 1001)) is distinct from 'conflito' then
    raise exception 'A descrição exige 1 a 1000 caracteres e deve estar aparada.';
  end if;

  if public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, 'ABC1D23', pedido) is distinct from 'criado' then
    raise exception 'Não criou atendimento para o veículo já vinculado.';
  end if;
  if public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, 'abc-1d23', pedido) is distinct from 'criado' then
    raise exception 'A repetição com os mesmos dados deveria retornar sucesso.';
  end if;
  if public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, 'ABC1D23', 'Outro pedido') is distinct from 'conflito'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, telefone, null, pedido) is distinct from 'conflito'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', ator, '5511900000112', 'ABC1D23', pedido) is distinct from 'conflito'
    or public.oficina_registrar_atendimento(atendimento, 'comauto', outro_ator, telefone, 'ABC1D23', pedido) is distinct from 'conflito' then
    raise exception 'O mesmo ID com dados diferentes deveria retornar conflito.';
  end if;

  if public.oficina_registrar_atendimento(sem_placa, 'comauto', ator, telefone, null, 'Solicitar revisão') is distinct from 'criado'
    or public.oficina_registrar_atendimento(sem_placa, 'comauto', ator, telefone, null, 'Solicitar revisão') is distinct from 'criado' then
    raise exception 'O veículo é opcional e a repetição também funciona sem placa.';
  end if;

  begin
    perform public.oficina_registrar_atendimento(falha_historico, 'comauto', ator, telefone, null, pedido);
    raise exception 'A inserção do histórico deveria ter falhado.';
  exception when check_violation then
    get stacked diagnostics restricao=constraint_name;
    if restricao is distinct from 'fixture_rejeita_historico' then raise; end if;
  end;

  if exists (select 1 from public.oficina_atendimentos where id = falha_historico) then
    raise exception 'Falha no histórico deve reverter a criação do atendimento.';
  end if;
end $$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.oficina_atendimentos
    where id = '00000000-0000-4000-8000-000000000121' and unidade = 'comauto'
      and cliente_id = '00000000-0000-4000-8000-000000000111' and veiculo_id = '00000000-0000-4000-8000-000000000114'
      and status = 'novo' and criado_por = '00000000-0000-4000-8000-000000000101'
  ) or not exists (
    select 1 from public.oficina_atendimentos
    where id = '00000000-0000-4000-8000-000000000122' and veiculo_id is null and status = 'novo'
  ) then
    raise exception 'O vínculo persistido deve usar a ficha e o veículo corretos.';
  end if;

  if (select count(*) from public.oficina_atendimentos_historico) <> 2
    or (select count(*) from public.oficina_atendimentos_historico h join public.oficina_atendimentos a on a.id = h.atendimento_id
      where h.unidade = a.unidade and h.de_status is null and h.para_status = 'novo'
        and h.ator_id = a.criado_por and h.ocorrido_em = a.criado_em) <> 2 then
    raise exception 'Cada criação deve produzir um único evento inicial com unidade, ator e data.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.oficina_atendimentos'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.oficina_atendimentos_historico'::regclass)
    or exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('oficina_atendimentos', 'oficina_atendimentos_historico'))
    or has_table_privilege('anon', 'public.oficina_atendimentos', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public.oficina_atendimentos', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('anon', 'public.oficina_atendimentos_historico', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public.oficina_atendimentos_historico', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('service_role', 'public.oficina_atendimentos', 'UPDATE, DELETE')
    or has_table_privilege('service_role', 'public.oficina_atendimentos_historico', 'SELECT, UPDATE, DELETE')
    or has_function_privilege('anon', 'public.oficina_registrar_atendimento(uuid,text,uuid,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.oficina_registrar_atendimento(uuid,text,uuid,text,text,text)', 'EXECUTE') then
    raise exception 'A fila e o histórico exigem RLS fechado e grants mínimos para o servidor.';
  end if;
end $$;

insert into auth.users (id) values ('00000000-0000-4000-8000-000000000105');
insert into public.usuarios (user_id, nome, papel, setor, unidade)
values ('00000000-0000-4000-8000-000000000105', 'Fixture de outra unidade', 'consultor_tecnico', 'oficina', 'oficina_fixture');

-- Representam um atendimento de unidade desativada e uma triagem cujo responsável foi removido.
insert into public.oficina_atendimentos (id, unidade, cliente_id, descricao, status) values
  ('00000000-0000-4000-8000-000000000125', 'santaluzia', '00000000-0000-4000-8000-000000000111', 'Unidade desativada', 'novo'),
  ('00000000-0000-4000-8000-000000000126', 'comauto', '00000000-0000-4000-8000-000000000111', 'Triagem sem responsável', 'em_triagem');

-- Permite a criação, mas força a transição e a atribuição a reverterem.
alter table public.oficina_atendimentos_historico add constraint fixture_rejeita_triagem
  check (atendimento_id <> '00000000-0000-4000-8000-000000000122' or de_status is null);

set local role service_role;

do $$
declare
  ator constant uuid := '00000000-0000-4000-8000-000000000101';
  ator_inativo constant uuid := '00000000-0000-4000-8000-000000000102';
  ator_unidade_inativa constant uuid := '00000000-0000-4000-8000-000000000103';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000104';
  ator_outra_unidade constant uuid := '00000000-0000-4000-8000-000000000105';
  atendimento constant uuid := '00000000-0000-4000-8000-000000000121';
  falha_historico constant uuid := '00000000-0000-4000-8000-000000000122';
  atendimento_unidade_extra constant uuid := '00000000-0000-4000-8000-000000000124';
  atendimento_unidade_inativa constant uuid := '00000000-0000-4000-8000-000000000125';
  triagem_sem_responsavel constant uuid := '00000000-0000-4000-8000-000000000126';
  restricao text;
begin
  if public.oficina_registrar_atendimento(
    atendimento_unidade_extra, 'oficina_fixture', ator_outra_unidade, '5511900000111', null, 'Atendimento em outra unidade'
  ) is distinct from 'criado' then
    raise exception 'Não criou o atendimento da unidade extra para o teste.';
  end if;

  if public.oficina_assumir_atendimento(atendimento_unidade_extra, outro_ator) is distinct from false
    or public.oficina_assumir_atendimento(atendimento, ator_inativo) is distinct from false
    or public.oficina_assumir_atendimento(atendimento_unidade_inativa, ator_unidade_inativa) is distinct from false
    or public.oficina_assumir_atendimento(triagem_sem_responsavel, ator) is distinct from false then
    raise exception 'Assumir exige usuário ativo, unidade ativa no escopo e etapa inicial.';
  end if;

  if public.oficina_assumir_atendimento(atendimento, ator) is distinct from true
    or public.oficina_assumir_atendimento(atendimento, ator) is distinct from true
    or public.oficina_assumir_atendimento(atendimento_unidade_extra, ator) is distinct from true
    or public.oficina_assumir_atendimento(atendimento_unidade_extra, ator) is distinct from true then
    raise exception 'O mesmo responsável pode assumir e repetir na unidade principal ou adicional.';
  end if;
  if public.oficina_assumir_atendimento(atendimento, outro_ator) is distinct from false
    or public.oficina_assumir_atendimento(atendimento_unidade_extra, ator_outra_unidade) is distinct from false then
    raise exception 'Outro usuário não pode assumir a triagem já atribuída.';
  end if;

  begin
    perform public.oficina_assumir_atendimento(falha_historico, ator);
    raise exception 'O histórico da triagem deveria ter falhado.';
  exception when check_violation then
    get stacked diagnostics restricao = constraint_name;
    if restricao is distinct from 'fixture_rejeita_triagem' then raise; end if;
  end;
  if not exists (
    select 1 from public.oficina_atendimentos
    where id = falha_historico and status = 'novo' and responsavel_id is null
  ) then
    raise exception 'A falha no histórico deve reverter a atribuição e a etapa.';
  end if;
end $$;

reset role;

do $$
begin
  if (select count(*) from public.oficina_atendimentos_historico where de_status is not null) <> 2
    or (select count(*) from public.oficina_atendimentos_historico h join public.oficina_atendimentos a on a.id = h.atendimento_id
      where a.id in ('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000124')
        and a.status = 'em_triagem' and a.responsavel_id = '00000000-0000-4000-8000-000000000101'
        and h.unidade = a.unidade and h.de_status = 'novo' and h.para_status = 'em_triagem'
        and h.ator_id = a.responsavel_id) <> 2 then
    raise exception 'Cada triagem deve persistir o responsável e exatamente um evento correto.';
  end if;

  if not has_column_privilege('service_role', 'public.oficina_atendimentos', 'status', 'UPDATE')
    or not has_column_privilege('service_role', 'public.oficina_atendimentos', 'responsavel_id', 'UPDATE')
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'oficina_atendimentos'
        and column_name not in ('status', 'responsavel_id')
        and has_column_privilege('service_role', 'public.oficina_atendimentos', column_name, 'UPDATE')
    )
    or has_function_privilege('anon', 'public.oficina_assumir_atendimento(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.oficina_assumir_atendimento(uuid,uuid)', 'EXECUTE') then
    raise exception 'A triagem exige execução exclusiva do servidor e UPDATE só de etapa e responsável.';
  end if;
end $$;

delete from public.usuario_unidades
where user_id = '00000000-0000-4000-8000-000000000101' and unidade = 'oficina_fixture';

set local role service_role;

do $$
begin
  if public.oficina_assumir_atendimento(
    '00000000-0000-4000-8000-000000000124', '00000000-0000-4000-8000-000000000101'
  ) is distinct from false then
    raise exception 'A repetição também exige vínculo ativo com a unidade.';
  end if;
end $$;

reset role;

-- Helpers executam como service_role sem corrigir permissões da migration.
create function pg_temp.of_id(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.of_estado() returns jsonb language sql as $$
  select jsonb_build_object(
    'fila',(select jsonb_agg(to_jsonb(a) order by a.id) from public.oficina_atendimentos a),
    'historico',(select jsonb_agg(to_jsonb(h) order by h.id) from public.oficina_atendimentos_historico h),
    'clientes',(select jsonb_agg(to_jsonb(c) order by c.id) from public.clientes c),
    'veiculos',(select jsonb_agg(to_jsonb(v) order by v.id) from public.veiculos v));
$$;
create function pg_temp.of_criar(id integer,ator integer,unidade text default 'comauto',placa text default null)
returns text language plpgsql as $$
declare r text;
begin
  set local role service_role;
  r:=public.oficina_registrar_atendimento(pg_temp.of_id(id),unidade,pg_temp.of_id(ator),'5511900000111',placa,'Solicitação adicional');
  reset role;return r;
exception when others then reset role;raise;
end $$;
create function pg_temp.of_assumir(id integer,ator integer) returns boolean language plpgsql as $$
declare r boolean;
begin
  set local role service_role;
  r:=public.oficina_assumir_atendimento(pg_temp.of_id(id),pg_temp.of_id(ator));
  reset role;return r;
exception when others then reset role;raise;
end $$;
create function pg_temp.of_fila(ator integer,limite integer default 50,antes timestamptz default null,antes_id uuid default null,minhas boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r:=public.oficina_fila(pg_temp.of_id(ator),limite,antes,antes_id,minhas);
  reset role;return r;
exception when others then reset role;raise;
end $$;
create function pg_temp.of_sem_efeito(sql text,esperado jsonb) returns void language plpgsql as $$
declare antes jsonb:=pg_temp.of_estado();r jsonb;
begin
  execute sql into r;
  if r is distinct from esperado then raise exception 'Esperado %, recebido % em %.',esperado,r,sql; end if;
  if antes is distinct from pg_temp.of_estado() then raise exception 'Recusa/replay/leitura escreveu.'; end if;
end $$;

insert into auth.users(id) select pg_temp.of_id(n) from generate_series(106,116)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.of_id(106),'Vendedor proibido','vendedor','vendas','comauto',true),
  (pg_temp.of_id(107),'Gerente Vendas proibido','gerente','vendas','comauto',true),
  (pg_temp.of_id(108),'Gerente Oficina','gerente','oficina','comauto',true),
  (pg_temp.of_id(109),'Gerente Administração','gerente','administracao','comauto',true),
  (pg_temp.of_id(110),'Administrador global','admin','administracao','oficina_outra',true),
  (pg_temp.of_id(111),'Recepção','recepcao','administracao','comauto',true),
  (pg_temp.of_id(112),'Atendente legado','atendente','administracao','comauto',true),
  (pg_temp.of_id(113),'Financeiro proibido','financeiro','administracao','comauto',true),
  (pg_temp.of_id(114),'Peças proibido','pecas','pecas','comauto',true),
  (pg_temp.of_id(115),'Consultor de outra lotação','consultor_tecnico','vendas','comauto',true),
  (pg_temp.of_id(116),'Gerente Peças proibido','gerente','pecas','comauto',true);
-- O mapa podeAcessar restringe setor para gerente; consultor/recepção seguem seu papel.
do $$ declare ator integer;r text;antes jsonb;
begin
  foreach ator in array array[106,107,113,114,116] loop
    antes:=pg_temp.of_estado();r:=pg_temp.of_criar(1000+ator,ator);
    if r<>'unidade' or pg_temp.of_assumir(122,ator) then raise exception 'Perfil fora de Oficina operou: %.',ator; end if;
    if antes is distinct from pg_temp.of_estado() then raise exception 'Perfil negado deixou escrita.'; end if;
    if pg_temp.of_fila(ator) is distinct from jsonb_build_object('ok',false,'codigo','nao_encontrado') then raise exception 'Fila liberada ao perfil %.',ator; end if;
  end loop;
  foreach ator in array array[108,109,110,111,112,115] loop
    if pg_temp.of_criar(1000+ator,ator)<>'criado' or not pg_temp.of_assumir(1000+ator,ator) then raise exception 'Perfil autorizado negado: %.',ator; end if;
    perform pg_temp.of_sem_efeito(format('select to_jsonb(pg_temp.of_assumir(%s,%s))',1000+ator,ator),'true'::jsonb);
  end loop;
  if pg_temp.of_criar(140,110,'oficina_outra')<>'criado' or not pg_temp.of_assumir(140,110) then raise exception 'Admin global falhou.'; end if;
  if pg_temp.of_criar(141,110,'motomecanica')<>'unidade' or pg_temp.of_assumir(125,110) then raise exception 'Admin entrou em unidade inativa.'; end if;
  if pg_temp.of_assumir(121,110) or pg_temp.of_assumir(126,110) then raise exception 'Admin roubou triagem/recuperou órfão sem contrato.'; end if;
end $$;

insert into public.usuario_unidades(user_id,unidade) values(pg_temp.of_id(101),'oficina_fixture');
do $$ begin
  if pg_temp.of_criar(142,101,'oficina_fixture')<>'criado' or not pg_temp.of_assumir(142,101) then raise exception 'Unidade extra recusada na criação/triagem.'; end if;
end $$;
-- Revalidação vale também para replays após mudança de vínculo/anonimização.
update public.veiculos set cliente_id=pg_temp.of_id(112) where id=pg_temp.of_id(114);
select pg_temp.of_sem_efeito('select to_jsonb(pg_temp.of_assumir(121,101))','false'::jsonb);
select pg_temp.of_sem_efeito('select to_jsonb(pg_temp.of_criar(121,101,''comauto'',''ABC1D23''))','"veiculo"'::jsonb);
update public.veiculos set cliente_id=pg_temp.of_id(111) where id=pg_temp.of_id(114);
update public.clientes set anonimizado=true where id=pg_temp.of_id(111);
select pg_temp.of_sem_efeito('select to_jsonb(pg_temp.of_assumir(121,101))','false'::jsonb);
select pg_temp.of_sem_efeito('select to_jsonb(pg_temp.of_criar(143,101))','"cliente"'::jsonb);
update public.clientes set anonimizado=false where id=pg_temp.of_id(111);
update public.usuarios set papel='financeiro' where user_id=pg_temp.of_id(101);
select pg_temp.of_sem_efeito('select to_jsonb(pg_temp.of_assumir(121,101))','false'::jsonb);
update public.usuarios set papel='consultor_tecnico' where user_id=pg_temp.of_id(101);

-- Mais de 100 registros, 130 empates exatos e microssegundos fora do empate.
insert into public.oficina_atendimentos(id,unidade,cliente_id,descricao,status,responsavel_id,criado_em)
select pg_temp.of_id(2000+n),'comauto',pg_temp.of_id(111),'Pedido paginado '||n,
  case when n%3=0 then 'em_triagem' else 'novo' end,
  case when n%3=0 then pg_temp.of_id(104) when n%3=1 then pg_temp.of_id(101) else null end,
  case when n<=130 then '2026-11-11 10:00:00.123456Z'::timestamptz
    else '2026-11-11 10:00:00Z'::timestamptz+n*interval '1 microsecond' end
from generate_series(1,205)n;

do $$ declare r jsonb;linha jsonb;visto uuid[]:='{}'::uuid[];esperado uuid[];anterior timestamptz;anterior_id uuid;
  total integer;paginas integer:=0;antes jsonb:=pg_temp.of_estado();
begin
  select array_agg(a.id order by a.criado_em desc,a.id desc) into esperado
    from public.oficina_atendimentos a join public.clientes c on c.id=a.cliente_id and not c.anonimizado
    where a.unidade in ('comauto','oficina_fixture') and (a.responsavel_id=pg_temp.of_id(101) or a.responsavel_id is null)
      and (a.veiculo_id is null or exists(select 1 from public.veiculos v where v.id=a.veiculo_id and v.cliente_id=a.cliente_id));
  loop
    r:=pg_temp.of_fila(101,17,anterior,anterior_id);
    if r->>'ok'<>'true' or (r->>'total')::integer<>cardinality(esperado) then raise exception 'Total/escopo paginado: %.',r; end if;
    for linha in select * from jsonb_array_elements(r->'atendimentos') loop
      visto:=array_append(visto,(linha->>'id')::uuid);
      if (select count(*) from jsonb_object_keys(linha))<>9 or linha?'telefone' or linha?'clienteId' then raise exception 'DTO expôs dados extras.'; end if;
      if (linha->>'podeAssumir')::boolean is distinct from (linha->>'status'='novo' and linha->'responsavel'='null'::jsonb) then raise exception 'Capacidade incorreta.'; end if;
    end loop;
    paginas:=paginas+1;
    if r->'proximo'='null'::jsonb then exit; end if;
    if jsonb_array_length(r->'atendimentos')<>17 or r->'proximo'->>'id'<>r->'atendimentos'->-1->>'id'
      or r->'proximo'->>'criadoEm'<>r->'atendimentos'->-1->>'criadoEm' then raise exception 'Cursor não corresponde à última linha.'; end if;
    anterior:=(r->'proximo'->>'criadoEm')::timestamptz;anterior_id:=(r->'proximo'->>'id')::uuid;
    if paginas>30 then raise exception 'Paginação não termina.'; end if;
  end loop;
  if paginas<7 or visto is distinct from esperado then raise exception 'Perdeu/duplicou/reordenou registros: % vs %.',cardinality(visto),cardinality(esperado); end if;
  if antes is distinct from pg_temp.of_estado() then raise exception 'Listar alterou dados.'; end if;
end $$;

do $$ declare r jsonb;ator integer;antes jsonb:=pg_temp.of_estado();t integer;
begin
  -- Consultor não vê colega; recepção/atendente/gerência veem unidade inteira.
  r:=pg_temp.of_fila(101,100);
  if exists(select 1 from jsonb_array_elements(r->'atendimentos') x where x->'responsavel'->>'id'=pg_temp.of_id(104)::text) then raise exception 'Consultor viu carteira de colega.'; end if;
  foreach ator in array array[108,109,111,112] loop
    r:=pg_temp.of_fila(ator,100);
    select count(*) into t from public.oficina_atendimentos where unidade='comauto';
    if r->>'ok'<>'true' or (r->>'total')::integer<>t then raise exception 'Recepção/gestão perdeu fila da unidade %: %.',ator,r; end if;
  end loop;
  r:=pg_temp.of_fila(110,100);
  if not exists(select 1 from jsonb_array_elements(r->'atendimentos') x where x->>'unidade'='oficina_outra') then raise exception 'Admin perdeu outra unidade ativa.'; end if;
  r:=pg_temp.of_fila(111,100,null,null,true);
  if (r->>'total')::integer<>1 or r->'atendimentos'->0->'responsavel'->>'id'<>pg_temp.of_id(111)::text then raise exception 'Minhas da recepção incorreto.'; end if;
  r:=pg_temp.of_fila(101,100,null,null,true);
  if exists(select 1 from jsonb_array_elements(r->'atendimentos') x where x->'responsavel'->>'id' is distinct from pg_temp.of_id(101)::text) then raise exception 'Minhas incluiu fila/colega.'; end if;
  r:=pg_temp.of_fila(101,100);
  if not exists(select 1 from jsonb_array_elements(r->'atendimentos') x where x->>'id'=pg_temp.of_id(126)::text and x->>'podeAssumir'='false') then raise exception 'Órfã oculta/assumível sem contrato.'; end if;
  if antes is distinct from pg_temp.of_estado() then raise exception 'Leituras por perfil escreveram.'; end if;
end $$;

-- Cursor falso, oculto, data inexata, inválidos e revogações não devolvem corpo/total.
do $$ declare r jsonb;quando timestamptz;codigo text;
begin
  foreach codigo in array array['0','101'] loop
    if pg_temp.of_fila(101,codigo::integer) is distinct from jsonb_build_object('ok',false,'codigo','invalido') then raise exception 'Limite inválido aceito.'; end if;
  end loop;
  if pg_temp.of_fila(101,10,now(),null) is distinct from jsonb_build_object('ok',false,'codigo','invalido')
    or pg_temp.of_fila(101,10,null,pg_temp.of_id(121)) is distinct from jsonb_build_object('ok',false,'codigo','invalido')
    or pg_temp.of_fila(101,10,'infinity',pg_temp.of_id(121)) is distinct from jsonb_build_object('ok',false,'codigo','invalido')
    or pg_temp.of_fila(101,10,null,null,null) is distinct from jsonb_build_object('ok',false,'codigo','invalido') then raise exception 'Cursor/flag inválidos aceitos.'; end if;
  select criado_em into quando from public.oficina_atendimentos where id=pg_temp.of_id(2003);
  if pg_temp.of_fila(101,10,quando,pg_temp.of_id(2003)) is distinct from jsonb_build_object('ok',false,'codigo','cursor_invalido') then raise exception 'Cursor de colega aceito.'; end if;
  select criado_em into quando from public.oficina_atendimentos where id=pg_temp.of_id(2001);
  if pg_temp.of_fila(101,10,quando+interval '1 microsecond',pg_temp.of_id(2001)) is distinct from jsonb_build_object('ok',false,'codigo','cursor_invalido') then raise exception 'Cursor de data errada aceito.'; end if;
  update public.clientes set anonimizado=true where id=pg_temp.of_id(111);
  if pg_temp.of_fila(101,10,quando,pg_temp.of_id(2001)) is distinct from jsonb_build_object('ok',false,'codigo','cursor_invalido') then raise exception 'Cursor anonimizado aceito.'; end if;
  update public.clientes set anonimizado=false where id=pg_temp.of_id(111);
  select criado_em into quando from public.oficina_atendimentos where id=pg_temp.of_id(142);
  delete from public.usuario_unidades where user_id=pg_temp.of_id(101) and unidade='oficina_fixture';
  if pg_temp.of_fila(101,10,quando,pg_temp.of_id(142)) is distinct from jsonb_build_object('ok',false,'codigo','cursor_invalido') then raise exception 'Cursor unidade revogada aceito.'; end if;
  if pg_temp.of_assumir(142,101) then raise exception 'Replay unidade revogada aceito.'; end if;
  update public.usuarios set ativo=false where user_id=pg_temp.of_id(101);
  if pg_temp.of_fila(101) is distinct from jsonb_build_object('ok',false,'codigo','nao_encontrado') then raise exception 'Ator inativo leu fila.'; end if;
  update public.usuarios set ativo=true where user_id=pg_temp.of_id(101);
end $$;

do $$ declare papel text;assinatura text;lancou boolean:=false;
begin
  foreach assinatura in array array['oficina_registrar_atendimento(uuid,text,uuid,text,text,text)','oficina_assumir_atendimento(uuid,uuid)','oficina_fila(uuid,integer,timestamptz,uuid,boolean)'] loop
    foreach papel in array array['anon','authenticated'] loop
      if has_function_privilege(papel,'public.'||assinatura,'execute') then raise exception 'RPC exposta ao navegador.'; end if;
    end loop;
    if exists(select 1 from pg_proc where oid=('public.'||assinatura)::regprocedure and (prosecdef or not proconfig @> array['search_path=""'])) then raise exception 'RPC privilegiada/search_path aberto.'; end if;
  end loop;
  begin
    set local role anon;
    perform public.oficina_fila(pg_temp.of_id(101));
    reset role;
  exception when insufficient_privilege then reset role;lancou:=true;
  end;
  if not lancou then raise exception 'Anon chamou RPC de fila.'; end if;
end $$;
create function pg_temp.of_reaplicacao() returns void language plpgsql as $$
declare antes jsonb:=pg_temp.of_estado();r jsonb;
begin
  r:=pg_temp.of_fila(111,100);
  if r->>'ok'<>'true' or (r->>'total')::integer<=100 then raise exception 'Fila populada não sobreviveu.'; end if;
  if not pg_temp.of_assumir(121,101) then raise exception 'Replay perdeu responsável.'; end if;
  if antes is distinct from pg_temp.of_estado() then raise exception 'Reaplicação duplicou histórico ou leitura escreveu.'; end if;
end $$;
rollback;
