-- Executar em banco descartável após 0001_init, 0002_nucleo e 0005_pecas.
begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000051'),
  ('00000000-0000-4000-8000-000000000055');
insert into public.usuarios (user_id, nome, papel, setor)
values
  ('00000000-0000-4000-8000-000000000051', 'Fixture de Peças', 'pecas', 'pecas'),
  ('00000000-0000-4000-8000-000000000055', 'Fixture segundo responsável', 'pecas', 'pecas');
insert into public.clientes (id, telefone, nome)
values ('00000000-0000-4000-8000-000000000052', '5511900000052', 'Fixture cliente');
insert into public.veiculos (id, cliente_id)
values ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000052');

-- Induz falha no histórico para verificar o rollback da mudança de etapa.
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_historico
  check (cotacao_id <> '00000000-0000-4000-8000-000000000056');

set local role service_role;

do $$
declare
  cotacao_id constant uuid := '00000000-0000-4000-8000-000000000054';
  cliente_id_fixture constant uuid := '00000000-0000-4000-8000-000000000052';
  ator_id_fixture constant uuid := '00000000-0000-4000-8000-000000000051';
  cotacao_falha constant uuid := '00000000-0000-4000-8000-000000000056';
  criada public.pecas_cotacoes%rowtype;
begin
  insert into public.pecas_cotacoes (id, cliente_id, veiculo_id, descricao, criado_por)
  values (cotacao_id, cliente_id_fixture, '00000000-0000-4000-8000-000000000053',
    'Filtro de óleo', '00000000-0000-4000-8000-000000000051')
  returning * into criada;

  if criada.unidade <> 'comauto' or criada.origem <> 'balcao' or criada.status <> 'novo' then
    raise exception 'A cotação deve começar como balcão e nova na unidade Comauto.';
  end if;

  insert into public.pecas_cotacoes (id, cliente_id, descricao)
  values (cotacao_id, cliente_id_fixture, 'Repetição do envio')
  on conflict (id) do nothing;
  if (select descricao from public.pecas_cotacoes where id = cotacao_id) is distinct from 'Filtro de óleo' then
    raise exception 'Repetir o ID não deve sobrescrever a cotação criada.';
  end if;

  begin
    insert into public.pecas_cotacoes (cliente_id, descricao) values (cliente_id_fixture, E'\tFiltro');
    raise exception 'Aceitou descrição com espaço inicial.';
  exception when check_violation then null;
  end;

  begin
    insert into public.pecas_cotacoes (cliente_id, descricao) values (cliente_id_fixture, repeat('x', 1001));
    raise exception 'Aceitou descrição acima de 1000 caracteres.';
  exception when check_violation then null;
  end;

  begin
    insert into public.pecas_cotacoes (cliente_id, descricao, status) values (cliente_id_fixture, 'Filtro', 'desconhecido');
    raise exception 'Aceitou status fora do fluxo.';
  exception when check_violation then null;
  end;

  if public.pecas_assumir_cotacao(cotacao_id, array['santaluzia'], ator_id_fixture) is distinct from false then
    raise exception 'Uma unidade fora do escopo conseguiu assumir a cotação.';
  end if;
  if public.pecas_assumir_cotacao(cotacao_id, array['comauto'], ator_id_fixture) is distinct from true then
    raise exception 'O responsável não conseguiu assumir a cotação da sua unidade.';
  end if;
  if public.pecas_assumir_cotacao(cotacao_id, array['comauto'], ator_id_fixture) is distinct from true then
    raise exception 'Repetir a operação pelo mesmo responsável deve retornar sucesso.';
  end if;
  if public.pecas_assumir_cotacao(cotacao_id, array['santaluzia'], ator_id_fixture) is distinct from false then
    raise exception 'A repetição também deve respeitar o escopo de unidades.';
  end if;
  if public.pecas_assumir_cotacao(cotacao_id, array['comauto'], '00000000-0000-4000-8000-000000000055') is distinct from false then
    raise exception 'Outro responsável conseguiu assumir a cotação já atribuída.';
  end if;
  if not exists (select 1 from public.pecas_cotacoes where id = cotacao_id and status = 'em_cotacao' and responsavel_id = ator_id_fixture) then
    raise exception 'A cotação deve permanecer em cotação com o primeiro responsável.';
  end if;

  insert into public.pecas_cotacoes (id, cliente_id, descricao)
  values (cotacao_falha, cliente_id_fixture, 'Fixture de rollback');
  begin
    perform public.pecas_assumir_cotacao(cotacao_falha, array['comauto'], ator_id_fixture);
    raise exception 'O histórico deveria ter falhado.';
  exception when check_violation then null;
  end;
  if not exists (select 1 from public.pecas_cotacoes where id = cotacao_falha and status = 'novo' and responsavel_id is null) then
    raise exception 'A falha no histórico deve reverter a atribuição da cotação.';
  end if;
end $$;

reset role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.pecas_cotacoes'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.pecas_cotacoes_historico'::regclass)
    or exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('pecas_cotacoes', 'pecas_cotacoes_historico'))
    or has_table_privilege('anon', 'public.pecas_cotacoes', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public.pecas_cotacoes', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('anon', 'public.pecas_cotacoes_historico', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public.pecas_cotacoes_historico', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('service_role', 'public.pecas_cotacoes', 'UPDATE, DELETE')
    or not has_column_privilege('service_role', 'public.pecas_cotacoes', 'status', 'UPDATE')
    or not has_column_privilege('service_role', 'public.pecas_cotacoes', 'responsavel_id', 'UPDATE')
    or has_column_privilege('service_role', 'public.pecas_cotacoes', 'descricao', 'UPDATE')
    or has_table_privilege('service_role', 'public.pecas_cotacoes_historico', 'SELECT, UPDATE, DELETE')
    or has_function_privilege('anon', 'public.pecas_assumir_cotacao(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_assumir_cotacao(uuid,text[],uuid)', 'EXECUTE') then
    raise exception 'A cotação e seu histórico devem manter RLS fechada e os grants mínimos do servidor.';
  end if;

  if (select count(*) from public.pecas_cotacoes_historico) <> 1 or not exists (
    select 1 from public.pecas_cotacoes_historico
    where cotacao_id = '00000000-0000-4000-8000-000000000054'
      and unidade = 'comauto' and de_status = 'novo' and para_status = 'em_cotacao'
      and ator_id = '00000000-0000-4000-8000-000000000051'
  ) then
    raise exception 'Assumir e repetir deve produzir um único evento com unidade, etapa e autor corretos.';
  end if;

  delete from public.veiculos where id = '00000000-0000-4000-8000-000000000053';
  delete from auth.users where id = '00000000-0000-4000-8000-000000000051';
  if not exists (
    select 1 from public.pecas_cotacoes
    where id = '00000000-0000-4000-8000-000000000054'
      and veiculo_id is null and criado_por is null and responsavel_id is null
  ) then
    raise exception 'Remover veículo ou autor deve preservar a cotação.';
  end if;

  begin
    delete from public.clientes where id = '00000000-0000-4000-8000-000000000052';
    raise exception 'Removeu cliente com cotação vinculada.';
  exception when foreign_key_violation or sqlstate '23001' then null;
  end;
end $$;

rollback;
