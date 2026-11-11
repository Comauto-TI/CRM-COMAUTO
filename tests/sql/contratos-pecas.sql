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
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_apresentacao
  check (cotacao_id <> '00000000-0000-4000-8000-000000000058' or para_status <> 'aguardando_cliente');
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_aprovacao
  check (cotacao_id <> '00000000-0000-4000-8000-000000000058' or para_status <> 'aprovado');

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

do $$
declare
  cotacao_fixture constant uuid := '00000000-0000-4000-8000-000000000054';
  cotacao_nova constant uuid := '00000000-0000-4000-8000-000000000056';
  outra_cotacao constant uuid := '00000000-0000-4000-8000-000000000058';
  ator_fixture constant uuid := '00000000-0000-4000-8000-000000000051';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000055';
  item_fixture constant uuid := '00000000-0000-4000-8000-000000000057';
  unidades_fixture constant text[] := array['comauto'];
  valores record;
  descricao_invalida text;
begin
  if public.pecas_adicionar_item(cotacao_nova, item_fixture, unidades_fixture, ator_fixture, 'Filtro', 1, 100, 0) is distinct from 'indisponivel'
    or public.pecas_adicionar_item(cotacao_fixture, item_fixture, array['santaluzia'], ator_fixture, 'Filtro', 1, 100, 0) is distinct from 'indisponivel'
    or public.pecas_adicionar_item(cotacao_fixture, item_fixture, unidades_fixture, outro_ator, 'Filtro', 1, 100, 0) is distinct from 'indisponivel' then
    raise exception 'Adicionar itens exige a etapa em cotação, a unidade e o responsável corretos.';
  end if;

  for valores in
    select * from (values
      (0, 100, 0),
      (10000, 100, 0),
      (1, -1, 0),
      (1, 100000000, 0),
      (1, 100, -1),
      (1, 100, 100000000)
    ) as casos (quantidade, preco, custo)
  loop
    if public.pecas_adicionar_item(
      cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 'Filtro',
      valores.quantidade, valores.preco, valores.custo
    ) is distinct from 'indisponivel' then
      raise exception 'Aceitou quantidade, preço ou custo inválido.';
    end if;
  end loop;

  foreach descricao_invalida in array array['', E'\tFiltro', 'Filtro ', repeat('x', 201)] loop
    if public.pecas_adicionar_item(
      cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, descricao_invalida, 1, 100, 0
    ) is distinct from 'indisponivel' then
      raise exception 'Aceitou descrição vazia, sem aparar ou longa demais.';
    end if;
  end loop;

  if public.pecas_adicionar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 'Filtro', 1, 100, 0) is distinct from 'adicionado'
    or public.pecas_adicionar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 'Filtro', 1, 100, 0) is distinct from 'adicionado'
    or public.pecas_adicionar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 'Filtro', 1, 100, null) is distinct from 'indisponivel'
    or public.pecas_adicionar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 'Outro filtro', 1, 100, 0) is distinct from 'indisponivel' then
    raise exception 'A repetição exige o mesmo item e deve distinguir custo zero de custo ausente.';
  end if;

  insert into public.pecas_cotacoes (id, cliente_id, descricao, status, responsavel_id)
  values (
    outra_cotacao, '00000000-0000-4000-8000-000000000052',
    'Fixture de outra cotação', 'em_cotacao', ator_fixture
  );
  if public.pecas_adicionar_item(outra_cotacao, item_fixture, unidades_fixture, ator_fixture, 'Filtro', 1, 100, 0) is distinct from 'indisponivel' then
    raise exception 'O mesmo ID não pode ser usado em outra cotação.';
  end if;

  for numero_item in 2..100 loop
    if public.pecas_adicionar_item(
      cotacao_fixture, gen_random_uuid(), unidades_fixture, ator_fixture,
      'Item ' || numero_item, 9999, 0, null
    ) is distinct from 'adicionado' then
      raise exception 'A cotação deve aceitar até 100 itens.';
    end if;
  end loop;

  if public.pecas_adicionar_item(
      cotacao_fixture, gen_random_uuid(), unidades_fixture, ator_fixture, 'Item 101', 1, 100, null
    ) is distinct from 'limite'
    or public.pecas_adicionar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 'Filtro', 1, 100, 0) is distinct from 'adicionado'
    or (select count(*) from public.pecas_cotacao_itens where cotacao_id = cotacao_fixture) <> 100
    or (select count(*) from public.pecas_cotacao_itens where cotacao_id = cotacao_fixture and custo_unitario_centavos is null) <> 99
    or not exists (select 1 from public.pecas_cotacao_itens where id = item_fixture and custo_unitario_centavos = 0) then
    raise exception 'O limite deve impedir apenas novos itens e preservar os valores persistidos.';
  end if;
end $$;

do $$
declare
  cotacao_fixture constant uuid := '00000000-0000-4000-8000-000000000054';
  outra_cotacao constant uuid := '00000000-0000-4000-8000-000000000058';
  ator_fixture constant uuid := '00000000-0000-4000-8000-000000000051';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000055';
  item_fixture constant uuid := '00000000-0000-4000-8000-000000000057';
  unidades_fixture constant text[] := array['comauto'];
begin
  if (select versao from public.pecas_cotacao_itens where id = item_fixture) is distinct from 1 then
    raise exception 'O item deve começar na versão 1.';
  end if;

  if public.pecas_atualizar_item(cotacao_fixture, item_fixture, array['santaluzia'], ator_fixture, 1, 'Filtro novo', 2, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, outro_ator, 1, 'Filtro novo', 2, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(outra_cotacao, item_fixture, unidades_fixture, ator_fixture, 1, 'Filtro novo', 2, 120, null) is distinct from 'indisponivel' then
    raise exception 'Editar exige a cotação do item, a unidade e o responsável corretos.';
  end if;

  if public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 1, 'Filtro novo', 2, 120, null) is distinct from 'atualizado'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 1, 'Filtro novo', 2, 120, null) is distinct from 'atualizado'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, 'Filtro novo', 2, 120, null) is distinct from 'atualizado'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 1, 'Alteração concorrente', 2, 120, null) is distinct from 'desatualizado'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 1, 'Filtro novo', 2, 120, 0) is distinct from 'desatualizado' then
    raise exception 'Uma edição idêntica pode ser repetida; conteúdo novo exige a versão atual.';
  end if;

  if public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 0, 'Filtro novo', 2, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, null, 'Filtro novo', 2, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, ' Filtro', 2, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, repeat('x', 201), 2, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, null, 2, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, 'Filtro', 0, 120, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, 'Filtro', 2, 100000000, null) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, 'Filtro', 2, 120, -1) is distinct from 'indisponivel' then
    raise exception 'A edição deve rejeitar versões e valores inválidos.';
  end if;

  if not exists (
    select 1 from public.pecas_cotacao_itens
    where id = item_fixture and versao = 2 and descricao = 'Filtro novo' and quantidade = 2
      and preco_unitario_centavos = 120 and custo_unitario_centavos is null
  ) then
    raise exception 'Só a primeira edição válida deve alterar o item e avançar a versão.';
  end if;

  if public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, 'Filtro novo', 2, 120, 0) is distinct from 'atualizado'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 2, 'Filtro novo', 2, 120, 0) is distinct from 'atualizado' then
    raise exception 'A edição deve aceitar custo zero e permitir repetição.';
  end if;
  if not exists (
    select 1 from public.pecas_cotacao_itens
    where id = item_fixture and versao = 3 and custo_unitario_centavos = 0
  ) then
    raise exception 'Trocar custo ausente por zero deve incrementar a versão uma única vez.';
  end if;

end $$;

do $$
declare
  cotacao_fixture constant uuid := '00000000-0000-4000-8000-000000000054';
  cotacao_nova constant uuid := '00000000-0000-4000-8000-000000000056';
  cotacao_vazia constant uuid := '00000000-0000-4000-8000-000000000058';
  ator_fixture constant uuid := '00000000-0000-4000-8000-000000000051';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000055';
  item_fixture constant uuid := '00000000-0000-4000-8000-000000000057';
  unidades_fixture constant text[] := array['comauto'];
  itens_apresentados jsonb;
  itens_antes_edicao jsonb;
  itens_antes_inclusao jsonb;
  itens_antes_aprovacao jsonb;
  restricao text;
begin
  select jsonb_object_agg(id::text, versao) into itens_apresentados
  from public.pecas_cotacao_itens where cotacao_id = cotacao_fixture;
  itens_antes_edicao := jsonb_set(itens_apresentados, array[item_fixture::text], '2'::jsonb);

  if public.pecas_registrar_apresentacao(cotacao_vazia, unidades_fixture, ator_fixture, '{}'::jsonb) is distinct from 'sem_itens'
    or (select status from public.pecas_cotacoes where id = cotacao_vazia) is distinct from 'em_cotacao' then
    raise exception 'Uma cotação sem itens deve permanecer em cotação.';
  end if;
  if public.pecas_registrar_apresentacao(cotacao_nova, unidades_fixture, ator_fixture, null) is distinct from 'indisponivel'
    or public.pecas_registrar_apresentacao(cotacao_fixture, array['santaluzia'], ator_fixture, itens_antes_edicao) is distinct from 'indisponivel'
    or public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, outro_ator, itens_antes_edicao) is distinct from 'indisponivel' then
    raise exception 'Apresentar exige etapa, unidade e responsável corretos.';
  end if;

  if public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, ator_fixture, itens_antes_edicao) is distinct from 'desatualizada'
    or public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, ator_fixture, null) is distinct from 'desatualizada' then
    raise exception 'A apresentação exige as versões atuais de todos os itens.';
  end if;
  if (select status from public.pecas_cotacoes where id = cotacao_fixture) is distinct from 'em_cotacao' then
    raise exception 'Um mapa desatualizado deve preservar a etapa.';
  end if;
  if public.pecas_registrar_aprovacao(cotacao_fixture, unidades_fixture, ator_fixture) is distinct from false then
    raise exception 'A aprovação exige apresentação prévia.';
  end if;

  if public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, ator_fixture, itens_apresentados) is distinct from 'apresentada'
    or public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, ator_fixture, itens_apresentados) is distinct from 'apresentada' then
    raise exception 'O responsável deve conseguir registrar e repetir a apresentação.';
  end if;
  if (select status from public.pecas_cotacoes where id = cotacao_fixture) is distinct from 'aguardando_cliente'
    or public.pecas_registrar_apresentacao(cotacao_fixture, array['santaluzia'], ator_fixture, itens_apresentados) is distinct from 'indisponivel'
    or public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, outro_ator, itens_apresentados) is distinct from 'indisponivel'
    or public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, ator_fixture, itens_antes_edicao) is distinct from 'desatualizada' then
    raise exception 'A apresentação move para aguardando cliente e o reenvio revalida acesso e versões.';
  end if;

  if public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 3, 'Filtro novo', 2, 120, 0) is distinct from 'indisponivel'
    or public.pecas_atualizar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 3, 'Mudança após envio', 2, 120, 0) is distinct from 'indisponivel'
    or public.pecas_adicionar_item(cotacao_fixture, gen_random_uuid(), unidades_fixture, ator_fixture, 'Novo item', 1, 100, null) is distinct from 'indisponivel'
    or public.pecas_adicionar_item(cotacao_fixture, item_fixture, unidades_fixture, ator_fixture, 'Filtro novo', 2, 120, 0) is distinct from 'indisponivel' then
    raise exception 'Após apresentar a cotação, os itens devem permanecer bloqueados.';
  end if;

  select jsonb_agg(to_jsonb(i) order by i.id) into itens_antes_aprovacao
  from public.pecas_cotacao_itens i where i.cotacao_id = cotacao_fixture;

  if public.pecas_registrar_aprovacao(cotacao_fixture, array['santaluzia'], ator_fixture) is distinct from false
    or public.pecas_registrar_aprovacao(cotacao_fixture, unidades_fixture, outro_ator) is distinct from false then
    raise exception 'A aprovação exige a unidade e o responsável corretos.';
  end if;
  if public.pecas_registrar_aprovacao(cotacao_fixture, unidades_fixture, ator_fixture) is distinct from true
    or public.pecas_registrar_aprovacao(cotacao_fixture, unidades_fixture, ator_fixture) is distinct from true then
    raise exception 'O responsável deve conseguir aprovar e repetir a aprovação.';
  end if;
  if (select status from public.pecas_cotacoes where id = cotacao_fixture) is distinct from 'aprovado'
    or public.pecas_registrar_aprovacao(cotacao_fixture, array['santaluzia'], ator_fixture) is distinct from false
    or public.pecas_registrar_aprovacao(cotacao_fixture, unidades_fixture, outro_ator) is distinct from false then
    raise exception 'O reenvio deve preservar a aprovação e revalidar o acesso.';
  end if;
  if public.pecas_registrar_apresentacao(cotacao_fixture, unidades_fixture, ator_fixture, itens_apresentados) is distinct from 'indisponivel' then
    raise exception 'Uma cotação aprovada não deve voltar para aguardando cliente.';
  end if;
  if (select jsonb_agg(to_jsonb(i) order by i.id)
      from public.pecas_cotacao_itens i where i.cotacao_id = cotacao_fixture) is distinct from itens_antes_aprovacao then
    raise exception 'A aprovação comercial deve preservar os itens.';
  end if;

  if public.pecas_adicionar_item(cotacao_vazia, gen_random_uuid(), unidades_fixture, ator_fixture, 'Peça única', 1, 100, null) is distinct from 'adicionado' then
    raise exception 'Não criou o item para testar a falha no histórico da apresentação.';
  end if;
  select jsonb_object_agg(id::text, versao) into itens_antes_inclusao
  from public.pecas_cotacao_itens where cotacao_id = cotacao_vazia;
  begin
    perform public.pecas_registrar_apresentacao(cotacao_vazia, unidades_fixture, ator_fixture, itens_antes_inclusao);
    raise exception 'A apresentação com um item deveria alcançar o histórico e falhar.';
  exception when check_violation then
    get stacked diagnostics restricao = constraint_name;
    if restricao is distinct from 'fixture_rejeita_apresentacao' then raise; end if;
  end;
  if (select status from public.pecas_cotacoes where id = cotacao_vazia) is distinct from 'em_cotacao' then
    raise exception 'A falha no histórico deve reverter a apresentação.';
  end if;

  if public.pecas_adicionar_item(cotacao_vazia, gen_random_uuid(), unidades_fixture, ator_fixture, 'Segunda peça', 1, 100, null) is distinct from 'adicionado'
    or public.pecas_registrar_apresentacao(cotacao_vazia, unidades_fixture, ator_fixture, itens_antes_inclusao) is distinct from 'desatualizada' then
    raise exception 'Incluir um item deve invalidar o mapa anterior de apresentação.';
  end if;

  update public.pecas_cotacoes set status = 'aguardando_cliente' where id = cotacao_vazia;
  begin
    perform public.pecas_registrar_aprovacao(cotacao_vazia, unidades_fixture, ator_fixture);
    raise exception 'O evento de aprovação deveria ter falhado.';
  exception when check_violation then
    get stacked diagnostics restricao = constraint_name;
    if restricao is distinct from 'fixture_rejeita_aprovacao' then raise; end if;
  end;
  if (select status from public.pecas_cotacoes where id = cotacao_vazia) is distinct from 'aguardando_cliente' then
    raise exception 'A falha no histórico deve reverter a aprovação.';
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
    or has_function_privilege('authenticated', 'public.pecas_assumir_cotacao(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_registrar_apresentacao(uuid,text[],uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_registrar_apresentacao(uuid,text[],uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_registrar_aprovacao(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_registrar_aprovacao(uuid,text[],uuid)', 'EXECUTE') then
    raise exception 'A cotação e seu histórico devem manter RLS fechada e os grants mínimos do servidor.';
  end if;

  if (select count(*) from public.pecas_cotacoes_historico) <> 3 or not exists (
    select 1 from public.pecas_cotacoes_historico
    where cotacao_id = '00000000-0000-4000-8000-000000000054'
      and unidade = 'comauto' and de_status = 'novo' and para_status = 'em_cotacao'
      and ator_id = '00000000-0000-4000-8000-000000000051'
  ) then
    raise exception 'Assumir e repetir deve produzir um único evento com unidade, etapa e autor corretos.';
  end if;
  if not exists (
    select 1 from public.pecas_cotacoes_historico
    where cotacao_id = '00000000-0000-4000-8000-000000000054'
      and unidade = 'comauto' and de_status = 'em_cotacao' and para_status = 'aguardando_cliente'
      and ator_id = '00000000-0000-4000-8000-000000000051'
      and ocorrido_em between transaction_timestamp() and clock_timestamp()
  ) then
    raise exception 'Apresentar e repetir deve produzir um único evento com unidade, etapa, autor e horário corretos.';
  end if;
  if not exists (
    select 1 from public.pecas_cotacoes_historico
    where cotacao_id = '00000000-0000-4000-8000-000000000054'
      and unidade = 'comauto' and de_status = 'aguardando_cliente' and para_status = 'aprovado'
      and ator_id = '00000000-0000-4000-8000-000000000051'
      and ocorrido_em between transaction_timestamp() and clock_timestamp()
  ) then
    raise exception 'Aprovar e repetir deve produzir um único evento com unidade, etapa, autor e horário corretos.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.pecas_cotacao_itens'::regclass)
    or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pecas_cotacao_itens')
    or has_table_privilege('anon', 'public.pecas_cotacao_itens', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_table_privilege('authenticated', 'public.pecas_cotacao_itens', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_table_privilege('service_role', 'public.pecas_cotacao_itens', 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'pecas_cotacao_itens'
        and column_name not in ('descricao', 'quantidade', 'preco_unitario_centavos', 'custo_unitario_centavos', 'versao')
        and has_column_privilege('service_role', 'public.pecas_cotacao_itens', column_name, 'UPDATE')
    )
    or has_function_privilege('anon', 'public.pecas_adicionar_item(uuid,uuid,text[],uuid,text,integer,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_adicionar_item(uuid,uuid,text[],uuid,text,integer,integer,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_atualizar_item(uuid,uuid,text[],uuid,integer,text,integer,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_atualizar_item(uuid,uuid,text[],uuid,integer,text,integer,integer,integer)', 'EXECUTE') then
    raise exception 'Os itens e a RPC devem manter RLS fechada e os grants mínimos do servidor.';
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
