-- PostgreSQL descartável com 0001/0002/0003 e migration de aniversários.
-- Os grants necessários pertencem à migration; a fixture não os acrescenta.
begin;

create function pg_temp.estado_aniversarios() returns jsonb language sql as $$
  select jsonb_build_object(
    'contatos', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.aniversarios_contatos t),
    'lembretes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.lembretes t),
    'notas', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.notas_cliente t),
    'audit', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.audit_log t)
  );
$$;
create function pg_temp.chamar_aniversario(
  p_operacao text, p_cliente uuid, p_ator uuid, p_unidades text[], p_data date,
  p_autor text default 'fixture@example.invalid', p_papel text default 'service_role'
) returns jsonb language plpgsql as $$
declare resposta jsonb;
begin
  if p_papel not in ('service_role', 'anon', 'authenticated') then raise exception 'Papel inválido.'; end if;
  execute format('set local role %I', p_papel);
  if current_user <> p_papel then raise exception 'A fixture não mudou o papel.'; end if;
  if p_operacao = 'contato' then
    resposta := public.registrar_contato_aniversario(p_cliente, p_ator, p_unidades, p_data, p_autor);
  elsif p_operacao = 'lembrete' then
    resposta := public.ativar_lembrete_aniversario(p_cliente, p_ator, p_unidades, p_data);
  else raise exception 'Operação inválida.';
  end if;
  reset role;
  return resposta;
exception when others then reset role; raise;
end $$;
create function pg_temp.recusar_aniversario(
  p_operacao text, p_cliente uuid, p_ator uuid, p_unidades text[], p_data date,
  p_autor text default 'fixture@example.invalid', p_constraint text default null
) returns void language plpgsql as $$
declare antes jsonb; resposta jsonb; restricao text; lancou boolean := false;
begin
  antes := pg_temp.estado_aniversarios();
  begin
    resposta := pg_temp.chamar_aniversario(p_operacao, p_cliente, p_ator, p_unidades, p_data, p_autor);
  exception when check_violation then
    get stacked diagnostics restricao = constraint_name;
    if p_constraint is null or restricao is distinct from p_constraint then raise; end if;
    lancou := true;
  end;
  if p_constraint is not null and not lancou then raise exception 'A constraint % deveria recusar.', p_constraint; end if;
  if not lancou and resposta->>'ok' is distinct from 'false' then raise exception 'Operação deveria recusar, obteve %.', resposta; end if;
  if pg_temp.estado_aniversarios() is distinct from antes then raise exception 'Recusa deixou efeito parcial.'; end if;
end $$;

insert into public.unidades (chave, nome, ativa) values
  ('aniv_principal', 'Unidade principal fictícia', true),
  ('aniv_fora', 'Unidade extra fictícia', true),
  ('aniv_inativa', 'Unidade inativa fictícia', false);
-- Fixture isolada: o administrador global pode atuar em outra unidade ativa.
update public.unidades set ativa=true where chave='motomecanica';
insert into auth.users (id)
select ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 15) n;
insert into public.usuarios (user_id, nome, papel, setor, unidade, ativo) values
  ('30000000-0000-4000-8000-000000000001', 'Vendedor proprietário', 'vendedor', 'vendas', 'aniv_principal', true),
  ('30000000-0000-4000-8000-000000000002', 'Outro vendedor', 'vendedor', 'vendas', 'aniv_principal', true),
  ('30000000-0000-4000-8000-000000000003', 'Gerente Vendas', 'gerente', 'vendas', 'aniv_principal', true),
  ('30000000-0000-4000-8000-000000000004', 'Gerente Oficina', 'gerente', 'oficina', 'aniv_principal', true),
  ('30000000-0000-4000-8000-000000000005', 'Admin principal', 'admin', 'administracao', 'aniv_principal', true),
  ('30000000-0000-4000-8000-000000000006', 'Gerente extra', 'gerente', 'administracao', 'aniv_fora', true),
  ('30000000-0000-4000-8000-000000000007', 'Vendedor inativo', 'vendedor', 'vendas', 'aniv_principal', false),
  ('30000000-0000-4000-8000-000000000008', 'Peças', 'pecas', 'pecas', 'aniv_principal', true),
  ('30000000-0000-4000-8000-000000000009', 'Gerente de fora', 'gerente', 'vendas', 'aniv_fora', true),
  ('30000000-0000-4000-8000-000000000010', 'Gerente inativo', 'gerente', 'vendas', 'aniv_principal', false),
  ('30000000-0000-4000-8000-000000000011', 'Recepção', 'recepcao', 'oficina', 'aniv_principal', true),
  ('30000000-0000-4000-8000-000000000012', 'Admin extra', 'admin', 'administracao', 'aniv_fora', true),
  ('30000000-0000-4000-8000-000000000013', 'Dono unidade inativa', 'vendedor', 'vendas', 'aniv_inativa', true),
  ('30000000-0000-4000-8000-000000000014', 'Admin Comauto', 'admin', 'administracao', 'comauto', true),
  ('30000000-0000-4000-8000-000000000015', 'Dono Motomecânica', 'vendedor', 'vendas', 'motomecanica', true);
insert into public.usuario_unidades (user_id, unidade) values
  ('30000000-0000-4000-8000-000000000006', 'aniv_principal'),
  ('30000000-0000-4000-8000-000000000012', 'aniv_principal');
insert into public.clientes (id, telefone, nome, data_nascimento, vendedor_id, unidade_origem, anonimizado)
select ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '551190000' || lpad(n::text, 4, '0'), 'Cliente fictício ' || n,
  case when n = 104 then null when n = 103 then '2000-02-29'::date else '2000-11-11'::date end,
  case when n in (108, 109) then null
    when n = 106 then '30000000-0000-4000-8000-000000000002'::uuid
    when n = 107 then '30000000-0000-4000-8000-000000000009'::uuid
    when n = 110 then '30000000-0000-4000-8000-000000000013'::uuid
    when n = 117 then '30000000-0000-4000-8000-000000000015'::uuid
    else '30000000-0000-4000-8000-000000000001'::uuid end,
  case when n = 109 then null else 'aniv_principal' end,
  n = 105
from generate_series(101, 117) n;

-- Consultas reais do carregador F5 precisam funcionar sem grants legados do Supabase.
set local role service_role;
select id,nome,telefone,data_nascimento,vendedor_id,unidade_origem,anonimizado
  from public.clientes where not anonimizado and data_nascimento is not null order by id limit 1;
select user_id,nome,unidade from public.usuarios order by user_id limit 1;
select id,cliente_id,data_alvo,concluido_em,insistente,usuario_id,unidade
  from public.lembretes where tipo='aniversario' order by id limit 1;
select id,cliente_id from public.vendas_oportunidades order by id limit 1;
select id,oportunidade_id,tipo,ator,criado_em from public.vendas_atividades
  where tipo in ('ligacao','whatsapp','visita','test_drive','email') order by id limit 1;
select id,cliente_id,criado_em,status from public.mensagens
  where direcao='saida' and autor='atendente' and status in ('enviada','entregue','lida') order by id limit 1;
select cliente_id,data_alvo from public.aniversarios_contatos order by cliente_id,data_alvo limit 1;
reset role;

-- Autorização atual no banco, não só os valores que chegaram do servidor.
do $$
declare
  operacao text; ator uuid;
  cliente constant uuid := '30000000-0000-4000-8000-000000000101';
  dono constant uuid := '30000000-0000-4000-8000-000000000001';
begin
  foreach operacao in array array['contato', 'lembrete'] loop
    foreach ator in array array[
      '30000000-0000-4000-8000-000000000002'::uuid,
      '30000000-0000-4000-8000-000000000004'::uuid,
      '30000000-0000-4000-8000-000000000007'::uuid,
      '30000000-0000-4000-8000-000000000008'::uuid,
      '30000000-0000-4000-8000-000000000009'::uuid,
      '30000000-0000-4000-8000-000000000010'::uuid,
      '30000000-0000-4000-8000-000000000011'::uuid
    ] loop
      perform pg_temp.recusar_aniversario(operacao, cliente, ator, array['aniv_principal'], '2026-11-11');
    end loop;
    perform pg_temp.recusar_aniversario(operacao, cliente, dono, array['aniv_fora'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, cliente, dono, null, '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, cliente, dono, array[]::text[], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, null, dono, array['aniv_principal'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, cliente, null, array['aniv_principal'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, cliente, dono, array['aniv_principal'], null);
    perform pg_temp.recusar_aniversario(operacao, cliente, dono, array['aniv_principal'], 'infinity'::date);
    perform pg_temp.recusar_aniversario(operacao, cliente, dono, array['aniv_principal'], '2026-11-10');
    perform pg_temp.recusar_aniversario(operacao, cliente, dono, array['aniv_principal'], '1999-11-11');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000104', dono, array['aniv_principal'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000105', dono, array['aniv_principal'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000106', dono, array['aniv_principal'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000107', dono, array['aniv_principal', 'aniv_fora'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000109', '30000000-0000-4000-8000-000000000005', array['aniv_principal'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000110', '30000000-0000-4000-8000-000000000005', array['aniv_principal', 'aniv_inativa'], '2026-11-11');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000110', '30000000-0000-4000-8000-000000000014', array['comauto'], '2026-11-11');
  end loop;
  perform pg_temp.recusar_aniversario('contato', cliente, dono, array['aniv_principal'], '2026-11-11', '');
  perform pg_temp.recusar_aniversario('contato', cliente, dono, array['aniv_principal'], '2026-11-11', ' ');
end $$;

-- Admin Comauto sem unidade extra opera Motomecânica ativa com escopo da sessão só Comauto.
do $$
declare resposta jsonb;
begin
  resposta := pg_temp.chamar_aniversario('lembrete','30000000-0000-4000-8000-000000000117',
    '30000000-0000-4000-8000-000000000014',array['comauto'],'2026-11-11');
  if resposta->>'ok' is distinct from 'true' or not exists (
    select 1 from public.lembretes where cliente_id='30000000-0000-4000-8000-000000000117'
      and usuario_id='30000000-0000-4000-8000-000000000014' and unidade='motomecanica'
      and insistente and concluido_em is null) then raise exception 'Admin global não ativou na unidade correta.'; end if;
  resposta := pg_temp.chamar_aniversario('contato','30000000-0000-4000-8000-000000000117',
    '30000000-0000-4000-8000-000000000014',array['comauto'],'2026-11-11');
  if resposta is distinct from '{"ok":true,"ja_registrado":false}'::jsonb or not exists (
    select 1 from public.aniversarios_contatos where cliente_id='30000000-0000-4000-8000-000000000117'
      and unidade='motomecanica' and ator_id='30000000-0000-4000-8000-000000000014') then
    raise exception 'Admin global não registrou na unidade correta.'; end if;
end $$;

-- Promove o lembrete aberto já existente e usa a unidade atual, não o default legado.
insert into public.lembretes (usuario_id, cliente_id, tipo, data_alvo, insistente, unidade)
values ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 'aniversario', '2026-11-11', false, 'comauto');
do $$
declare resposta jsonb; antes jsonb;
begin
  resposta := pg_temp.chamar_aniversario('lembrete', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11');
  if resposta->>'ok' is distinct from 'true' then raise exception 'Não ativou lembrete.'; end if;
  if (select count(*) from public.lembretes where cliente_id='30000000-0000-4000-8000-000000000101') <> 1
    or not exists (select 1 from public.lembretes where cliente_id='30000000-0000-4000-8000-000000000101'
      and insistente and unidade='aniv_principal' and concluido_em is null) then
    raise exception 'Promover lembrete não deve duplicar e precisa da unidade correta.';
  end if;
  antes := pg_temp.estado_aniversarios();
  perform pg_temp.chamar_aniversario('lembrete', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11');
  if pg_temp.estado_aniversarios() is distinct from antes then raise exception 'Replay do lembrete alterou dados.'; end if;
end $$;

-- O contato conclui todas as pendências daquele aniversário, inclusive da supervisão.
insert into public.lembretes (usuario_id, cliente_id, tipo, data_alvo, insistente, unidade) values
  ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000101', 'aniversario', '2026-11-11', true, 'aniv_principal'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000101', 'retorno', '2026-11-11', true, 'aniv_principal');
do $$
declare resposta jsonb; antes jsonb;
begin
  resposta := pg_temp.chamar_aniversario('contato', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11', 'vendedor@example.invalid');
  if resposta is distinct from '{"ok":true,"ja_registrado":false}'::jsonb then raise exception 'Primeiro contato inválido: %.', resposta; end if;
  if not exists (select 1 from public.aniversarios_contatos where cliente_id='30000000-0000-4000-8000-000000000101'
    and data_alvo='2026-11-11' and ator_id='30000000-0000-4000-8000-000000000001' and unidade='aniv_principal') then
    raise exception 'Contato precisa preservar cliente, data, autor e unidade.';
  end if;
  if exists (select 1 from public.lembretes where cliente_id='30000000-0000-4000-8000-000000000101'
    and tipo='aniversario' and data_alvo='2026-11-11' and concluido_em is null)
    or not exists (select 1 from public.lembretes where cliente_id='30000000-0000-4000-8000-000000000101'
      and tipo='retorno' and concluido_em is null) then raise exception 'Conclusão tem de atingir apenas os aniversários.'; end if;
  if not exists (select 1 from public.notas_cliente where cliente_id='30000000-0000-4000-8000-000000000101'
      and autor='vendedor@example.invalid' and texto='Contato de aniversário feito (11/11/2026).')
    or not exists (select 1 from public.audit_log where entidade_id='30000000-0000-4000-8000-000000000101'
      and acao='aniversario_contato' and entidade='cliente' and ator='vendedor@example.invalid'
      and dados->>'unidade'='aniv_principal' and dados->>'data_alvo'='2026-11-11') then raise exception 'Faltou nota/auditoria da conclusão.'; end if;
  antes := pg_temp.estado_aniversarios();
  resposta := pg_temp.chamar_aniversario('contato', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000003', array['aniv_principal'], '2026-11-11', 'gerente@example.invalid');
  if resposta is distinct from '{"ok":true,"ja_registrado":true}'::jsonb then raise exception 'Contato repetido deve informar replay.'; end if;
  perform pg_temp.chamar_aniversario('lembrete', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11');
  if pg_temp.estado_aniversarios() is distinct from antes then raise exception 'Replay ou reativação depois do contato duplicou dados.'; end if;
end $$;

-- Escopos de supervisão e nascimento real (incluindo ano secular não bissexto).
do $$
declare resposta jsonb; operacao text; data_fixture date;
begin
  resposta := pg_temp.chamar_aniversario('lembrete', '30000000-0000-4000-8000-000000000102',
    '30000000-0000-4000-8000-000000000006', array['aniv_principal'], '2026-11-11');
  if resposta->>'ok' is distinct from 'true' then raise exception 'Gerente com unidade adicional deve operar.'; end if;
  resposta := pg_temp.chamar_aniversario('contato', '30000000-0000-4000-8000-000000000102',
    '30000000-0000-4000-8000-000000000012', array['aniv_principal'], '2026-11-11');
  if resposta->>'ok' is distinct from 'true' then raise exception 'Admin com unidade adicional deve operar.'; end if;
  resposta := pg_temp.chamar_aniversario('contato', '30000000-0000-4000-8000-000000000108',
    '30000000-0000-4000-8000-000000000005', array['aniv_principal'], '2026-11-11');
  if resposta->>'ok' is distinct from 'true' then raise exception 'Sem dono, deve usar a unidade de origem.'; end if;
  foreach operacao in array array['contato', 'lembrete'] loop
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000103',
      '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2027-03-01');
    perform pg_temp.recusar_aniversario(operacao, '30000000-0000-4000-8000-000000000103',
      '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2028-02-28');
    foreach data_fixture in array array['2027-02-28'::date, '2028-02-29'::date, '2100-02-28'::date] loop
      resposta := pg_temp.chamar_aniversario(operacao, '30000000-0000-4000-8000-000000000103',
        '30000000-0000-4000-8000-000000000001', array['aniv_principal'], data_fixture);
      if resposta->>'ok' is distinct from 'true' then raise exception 'Aniversário bissexto válido recusado: %.', data_fixture; end if;
    end loop;
  end loop;
end $$;

-- Falhas de nota, auditoria, conclusão e ativação desfazem todos os efeitos obrigatórios.
insert into public.lembretes (usuario_id, cliente_id, tipo, data_alvo, insistente, unidade) values
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000113', 'aniversario', '2026-11-11', true, 'aniv_principal'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000114', 'aniversario', '2026-11-11', false, 'aniv_principal');
alter table public.notas_cliente add constraint fixture_aniv_rejeita_nota check (cliente_id <> '30000000-0000-4000-8000-000000000111');
alter table public.audit_log add constraint fixture_aniv_rejeita_audit check (entidade_id <> '30000000-0000-4000-8000-000000000112');
alter table public.lembretes add constraint fixture_aniv_rejeita_conclusao check (cliente_id <> '30000000-0000-4000-8000-000000000113' or concluido_em is null);
alter table public.lembretes add constraint fixture_aniv_rejeita_promocao check (cliente_id <> '30000000-0000-4000-8000-000000000114' or not insistente);
alter table public.lembretes add constraint fixture_aniv_rejeita_insert check (cliente_id <> '30000000-0000-4000-8000-000000000115');
do $$
begin
  perform pg_temp.recusar_aniversario('contato', '30000000-0000-4000-8000-000000000111', '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11', 'fixture@example.invalid', 'fixture_aniv_rejeita_nota');
  perform pg_temp.recusar_aniversario('contato', '30000000-0000-4000-8000-000000000112', '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11', 'fixture@example.invalid', 'fixture_aniv_rejeita_audit');
  perform pg_temp.recusar_aniversario('contato', '30000000-0000-4000-8000-000000000113', '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11', 'fixture@example.invalid', 'fixture_aniv_rejeita_conclusao');
  perform pg_temp.recusar_aniversario('lembrete', '30000000-0000-4000-8000-000000000114', '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11', 'fixture@example.invalid', 'fixture_aniv_rejeita_promocao');
  perform pg_temp.recusar_aniversario('lembrete', '30000000-0000-4000-8000-000000000115', '30000000-0000-4000-8000-000000000001', array['aniv_principal'], '2026-11-11', 'fixture@example.invalid', 'fixture_aniv_rejeita_insert');
end $$;
alter table public.notas_cliente drop constraint fixture_aniv_rejeita_nota;
alter table public.audit_log drop constraint fixture_aniv_rejeita_audit;
alter table public.lembretes drop constraint fixture_aniv_rejeita_conclusao;
alter table public.lembretes drop constraint fixture_aniv_rejeita_promocao;
alter table public.lembretes drop constraint fixture_aniv_rejeita_insert;

-- A autoria do contato não some quando o usuário é removido do Auth/usuarios.
delete from auth.users where id='30000000-0000-4000-8000-000000000001';
do $$
begin
  if not exists (select 1 from public.aniversarios_contatos where cliente_id='30000000-0000-4000-8000-000000000101'
    and ator_id='30000000-0000-4000-8000-000000000001') then raise exception 'Remoção do usuário perdeu autoria do contato.'; end if;
end $$;

do $$
declare papel text; privilegio text; assinatura text; funcao record; campo text;
begin
  if not exists (select 1 from pg_class where oid='public.aniversarios_contatos'::regclass and relrowsecurity)
    or exists (select 1 from pg_policy where polrelid='public.aniversarios_contatos'::regclass) then raise exception 'Contatos precisam de RLS fechado.'; end if;
  foreach assinatura in array array[
    'public.registrar_contato_aniversario(uuid,uuid,text[],date,text)',
    'public.ativar_lembrete_aniversario(uuid,uuid,text[],date)'
  ] loop
    foreach papel in array array['anon','authenticated'] loop
      if has_function_privilege(papel, assinatura, 'EXECUTE') then raise exception 'RPC exposta a %.', papel; end if;
      begin
        perform pg_temp.chamar_aniversario(case when assinatura like '%registrar_%' then 'contato' else 'lembrete' end,
          '30000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000005',
          array['aniv_principal'], '2026-11-11', 'fixture@example.invalid', papel);
        raise exception 'Browser executou RPC.';
      exception when insufficient_privilege then null;
      end;
    end loop;
    if not has_function_privilege('service_role', assinatura, 'EXECUTE') then raise exception 'Falta EXECUTE do servidor.'; end if;
    select prosecdef,proconfig,proacl,proowner into funcao from pg_proc where oid=assinatura::regprocedure;
    if funcao.prosecdef or not coalesce(funcao.proconfig && array['search_path=""','search_path='],false)
      or exists (select 1 from aclexplode(coalesce(funcao.proacl,acldefault('f',funcao.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'RPC precisa de invoker/search_path vazio e PUBLIC fechado.';
    end if;
  end loop;
  foreach papel in array array['anon','authenticated'] loop
    foreach privilegio in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(papel,'public.aniversarios_contatos',privilegio) then raise exception 'Contatos expostos ao browser.'; end if;
    end loop;
    if has_any_column_privilege(papel,'public.aniversarios_contatos','SELECT,INSERT,UPDATE') then raise exception 'Contatos têm grants por coluna ao browser.'; end if;
  end loop;
  if not has_table_privilege('service_role','public.aniversarios_contatos','SELECT') then raise exception 'Falta SELECT do servidor.'; end if;
  foreach campo in array array['cliente_id','data_alvo','ator_id','unidade'] loop
    if not has_column_privilege('service_role','public.aniversarios_contatos',campo,'INSERT') then raise exception 'Falta INSERT de %.', campo; end if;
  end loop;
  if has_column_privilege('service_role','public.aniversarios_contatos','criado_em','INSERT')
    or has_any_column_privilege('service_role','public.aniversarios_contatos','UPDATE') then raise exception 'Contato recebeu mutação desnecessária.'; end if;
  foreach privilegio in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role','public.aniversarios_contatos',privilegio) then raise exception 'Contato recebeu grant excessivo.'; end if;
  end loop;
  if has_schema_privilege('service_role','auth','USAGE') or has_table_privilege('service_role','auth.users','SELECT,UPDATE,INSERT,DELETE') then
    raise exception 'RPC não precisa de acesso ao schema Auth.';
  end if;
end $$;

rollback;
