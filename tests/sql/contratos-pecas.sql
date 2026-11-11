-- Executar em banco descartável após 0001_init, 0002_nucleo e 0005_pecas.
begin;

insert into auth.users (id) values ('00000000-0000-4000-8000-000000000051');
insert into public.usuarios (user_id, nome, papel, setor)
values ('00000000-0000-4000-8000-000000000051', 'Fixture de Peças', 'pecas', 'pecas');
insert into public.clientes (id, telefone, nome)
values ('00000000-0000-4000-8000-000000000052', '5511900000052', 'Fixture cliente');
insert into public.veiculos (id, cliente_id)
values ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000052');

set local role service_role;

do $$
declare
  cotacao_id constant uuid := '00000000-0000-4000-8000-000000000054';
  cliente_id_fixture constant uuid := '00000000-0000-4000-8000-000000000052';
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
end $$;

reset role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.pecas_cotacoes'::regclass)
    or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pecas_cotacoes')
    or has_table_privilege('anon', 'public.pecas_cotacoes', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public.pecas_cotacoes', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('service_role', 'public.pecas_cotacoes', 'UPDATE, DELETE') then
    raise exception 'A cotação deve ter RLS fechada e permitir ao servidor apenas criação e leitura.';
  end if;

  delete from public.veiculos where id = '00000000-0000-4000-8000-000000000053';
  delete from auth.users where id = '00000000-0000-4000-8000-000000000051';
  if not exists (
    select 1 from public.pecas_cotacoes
    where id = '00000000-0000-4000-8000-000000000054' and veiculo_id is null and criado_por is null
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
