-- Executar em banco descartável após 0001_init, 0002_nucleo e 0005_pecas.
begin;

-- A RPC do bot só lê estas colunas da ficha e da unidade.
grant select (id, anonimizado) on public.clientes to service_role;
grant select (chave, ativa) on public.unidades to service_role;

insert into public.unidades (chave, nome, ativa) values ('pecas_fixture', 'Unidade fixture de Peças', true);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000051'),
  ('00000000-0000-4000-8000-000000000055');
insert into public.usuarios (user_id, nome, papel, setor)
values
  ('00000000-0000-4000-8000-000000000051', 'Fixture de Peças', 'pecas', 'pecas'),
  ('00000000-0000-4000-8000-000000000055', 'Fixture segundo responsável', 'pecas', 'pecas');
insert into public.clientes (id, telefone, nome)
values ('00000000-0000-4000-8000-000000000052', '5511900000052', 'Fixture cliente');
insert into public.clientes (id, telefone, nome, anonimizado) values
  ('00000000-0000-4000-8000-000000000071', '5511900000071', 'Outra ficha', false),
  ('00000000-0000-4000-8000-000000000072', '5511900000072', null, true);
insert into public.veiculos (id, cliente_id)
values ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000052');

-- Induz falha no histórico para verificar o rollback da mudança de etapa.
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_historico
  check (cotacao_id <> '00000000-0000-4000-8000-000000000056');
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_apresentacao
  check (cotacao_id <> '00000000-0000-4000-8000-000000000058' or para_status <> 'aguardando_cliente');
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_aprovacao
  check (cotacao_id <> '00000000-0000-4000-8000-000000000058' or para_status <> 'aprovado');
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_entrega
  check (cotacao_id <> '00000000-0000-4000-8000-000000000063' or para_status <> 'entregue');
alter table public.pecas_cotacoes_historico add constraint fixture_rejeita_encerramento
  check (cotacao_id <> '00000000-0000-4000-8000-000000000065' or para_status <> 'cancelado');

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
  if public.pecas_confirmar_venda(cotacao_fixture, unidades_fixture, ator_fixture) is distinct from false then
    raise exception 'A confirmação de venda exige aprovação prévia.';
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
  if not exists (
    select 1 from public.pecas_cotacoes
    where id = cotacao_fixture and venda_confirmada_em is null and venda_confirmada_por is null
  ) then
    raise exception 'A aprovação comercial deve deixar a confirmação de venda pendente.';
  end if;
  if public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'separacao') is distinct from false
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'encomenda') is distinct from false then
    raise exception 'A confirmação de venda deve preceder o preparo.';
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

do $$
declare
  cliente_fixture constant uuid := '00000000-0000-4000-8000-000000000052';
  outro_cliente constant uuid := '00000000-0000-4000-8000-000000000071';
  cliente_anonimo constant uuid := '00000000-0000-4000-8000-000000000072';
  referencia constant text := 'wamid.fixture-pecas';
  descricao_inicial constant text := 'Consultar disponibilidade de filtro';
  cotacao_bot uuid;
  referencia_invalida text;
begin
  begin
    insert into public.pecas_cotacoes (cliente_id, origem, descricao)
    values (cliente_fixture, 'whatsapp', descricao_inicial);
    raise exception 'Uma cotação de WhatsApp exige referência.';
  exception when check_violation then null;
  end;

  foreach referencia_invalida in array array[null, '', ' wamid.fixture', E'wamid.fixture\t', repeat('x', 513)] loop
    if public.pecas_registrar_cotacao_bot(cliente_fixture, 'comauto', referencia_invalida, descricao_inicial) is not null then
      raise exception 'A referência exige de 1 a 512 caracteres aparados.';
    end if;
  end loop;
  if public.pecas_registrar_cotacao_bot(cliente_fixture, 'comauto', referencia, '') is not null
    or public.pecas_registrar_cotacao_bot(cliente_fixture, 'comauto', referencia, ' Descrição') is not null
    or public.pecas_registrar_cotacao_bot(cliente_fixture, 'comauto', referencia, repeat('x', 1001)) is not null then
    raise exception 'A cotação pelo bot exige descrição válida.';
  end if;

  if public.pecas_registrar_cotacao_bot(cliente_fixture, 'santaluzia', referencia, descricao_inicial) is not null
    or public.pecas_registrar_cotacao_bot(cliente_fixture, 'inexistente', referencia, descricao_inicial) is not null
    or public.pecas_registrar_cotacao_bot(cliente_anonimo, 'comauto', referencia, descricao_inicial) is not null
    or public.pecas_registrar_cotacao_bot('00000000-0000-4000-8000-000000000079', 'comauto', referencia, descricao_inicial) is not null then
    raise exception 'A cotação pelo bot exige unidade ativa e ficha disponível.';
  end if;

  cotacao_bot := public.pecas_registrar_cotacao_bot(cliente_fixture, 'comauto', referencia, descricao_inicial);
  if cotacao_bot is null
    or public.pecas_registrar_cotacao_bot(cliente_fixture, 'comauto', referencia, 'Descrição do reenvio') is distinct from cotacao_bot
    or public.pecas_registrar_cotacao_bot(outro_cliente, 'comauto', referencia, descricao_inicial) is not null
    or public.pecas_registrar_cotacao_bot(cliente_fixture, 'pecas_fixture', referencia, descricao_inicial) is not null then
    raise exception 'O reenvio exige a mesma ficha e unidade e deve retornar o ID original.';
  end if;
  if (select count(*) from public.pecas_cotacoes where origem = 'whatsapp' and origem_ref = referencia) <> 1
    or not exists (
      select 1 from public.pecas_cotacoes
      where id = cotacao_bot and cliente_id = cliente_fixture and unidade = 'comauto' and origem = 'whatsapp'
        and origem_ref = referencia and descricao = descricao_inicial and status = 'novo'
        and criado_por is null and responsavel_id is null and veiculo_id is null
        and criado_em between transaction_timestamp() and clock_timestamp()
    ) then
    raise exception 'O bot deve abrir uma única cotação nova e preservar a descrição original.';
  end if;
  if public.pecas_registrar_cotacao_bot(
    cliente_fixture, 'pecas_fixture', 'wamid.' || repeat('x', 506), descricao_inicial
  ) is null then
    raise exception 'Uma referência distinta de 512 caracteres deve ser aceita na outra unidade ativa.';
  end if;
end $$;

do $$
declare
  cotacao_fixture constant uuid := '00000000-0000-4000-8000-000000000054';
  cotacao_sem_itens constant uuid := '00000000-0000-4000-8000-000000000059';
  ator_fixture constant uuid := '00000000-0000-4000-8000-000000000051';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000055';
  unidades_fixture constant text[] := array['comauto'];
  instante_venda timestamptz;
  tupla_venda tid;
begin
  insert into public.pecas_cotacoes (id, cliente_id, descricao, status, responsavel_id)
  values (cotacao_sem_itens, '00000000-0000-4000-8000-000000000052', 'Fixture sem itens', 'aprovado', ator_fixture);

  if public.pecas_confirmar_venda(cotacao_sem_itens, unidades_fixture, ator_fixture) is distinct from false
    or public.pecas_confirmar_venda(cotacao_fixture, array['santaluzia'], ator_fixture) is distinct from false
    or public.pecas_confirmar_venda(cotacao_fixture, unidades_fixture, outro_ator) is distinct from false then
    raise exception 'Confirmar venda exige cotação com itens, unidade e responsável corretos.';
  end if;

  begin
    update public.pecas_cotacoes set venda_confirmada_em = now() where id = cotacao_fixture;
    raise exception 'A confirmação exige data e autor juntos.';
  exception when check_violation then null;
  end;

  if public.pecas_confirmar_venda(cotacao_fixture, unidades_fixture, ator_fixture) is distinct from true then
    raise exception 'O responsável deve conseguir confirmar a venda aprovada.';
  end if;

  -- O ctid detecta uma nova gravação mesmo com now() fixo dentro da fixture.
  select venda_confirmada_em, ctid into instante_venda, tupla_venda
  from public.pecas_cotacoes where id = cotacao_fixture;

  if public.pecas_confirmar_venda(cotacao_fixture, unidades_fixture, ator_fixture) is distinct from true
    or public.pecas_confirmar_venda(cotacao_fixture, array['santaluzia'], ator_fixture) is distinct from false
    or public.pecas_confirmar_venda(cotacao_fixture, unidades_fixture, outro_ator) is distinct from false then
    raise exception 'O reenvio da confirmação deve validar o acesso.';
  end if;
  if not exists (
    select 1 from public.pecas_cotacoes
    where id = cotacao_fixture and status = 'aprovado' and venda_confirmada_por = ator_fixture
      and venda_confirmada_em = instante_venda and ctid = tupla_venda
      and venda_confirmada_em between transaction_timestamp() and clock_timestamp()
  ) then
    raise exception 'A confirmação deve preservar a etapa, a data e o autor em reenvios.';
  end if;
end $$;

do $$
declare
  cotacao_fixture constant uuid := '00000000-0000-4000-8000-000000000054';
  cotacao_encomenda constant uuid := '00000000-0000-4000-8000-000000000060';
  cotacao_sem_tipo constant uuid := '00000000-0000-4000-8000-000000000061';
  cotacao_sem_venda constant uuid := '00000000-0000-4000-8000-000000000062';
  cotacao_falha constant uuid := '00000000-0000-4000-8000-000000000063';
  cliente_fixture constant uuid := '00000000-0000-4000-8000-000000000052';
  ator_fixture constant uuid := '00000000-0000-4000-8000-000000000051';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000055';
  unidades_fixture constant text[] := array['comauto'];
  restricao text;
begin
  insert into public.pecas_cotacoes (
    id, cliente_id, descricao, status, responsavel_id, venda_confirmada_em, venda_confirmada_por, tipo_preparo
  ) values
    (cotacao_encomenda, cliente_fixture, 'Peça sob encomenda', 'aprovado', ator_fixture, now(), ator_fixture, null),
    (cotacao_sem_tipo, cliente_fixture, 'Fixture de preparo incompleto', 'em_separacao', ator_fixture, now(), ator_fixture, null),
    (cotacao_sem_venda, cliente_fixture, 'Fixture sem confirmação', 'em_separacao', ator_fixture, null, null, 'separacao'),
    (cotacao_falha, cliente_fixture, 'Fixture de falha no histórico', 'em_separacao', ator_fixture, now(), ator_fixture, 'encomenda');

  if public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'entrega') is distinct from false
    or public.pecas_avancar_atendimento(cotacao_sem_tipo, unidades_fixture, ator_fixture, 'entrega') is distinct from false
    or public.pecas_avancar_atendimento(cotacao_sem_venda, unidades_fixture, ator_fixture, 'entrega') is distinct from false then
    raise exception 'A entrega exige preparo com tipo registrado e venda confirmada.';
  end if;
  if public.pecas_avancar_atendimento(cotacao_fixture, array['santaluzia'], ator_fixture, 'separacao') is distinct from false
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, outro_ator, 'encomenda') is distinct from false
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'invalida') is distinct from false then
    raise exception 'O preparo exige ação válida, unidade e responsável corretos.';
  end if;

  begin
    update public.pecas_cotacoes set tipo_preparo = 'invalido' where id = cotacao_fixture;
    raise exception 'O tipo de preparo exige separação ou encomenda.';
  exception when check_violation then null;
  end;

  if public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'separacao') is distinct from true
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'separacao') is distinct from true
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'encomenda') is distinct from false then
    raise exception 'A separação deve aceitar reenvio e preservar o tipo escolhido.';
  end if;
  if public.pecas_avancar_atendimento(cotacao_encomenda, unidades_fixture, ator_fixture, 'encomenda') is distinct from true
    or public.pecas_avancar_atendimento(cotacao_encomenda, unidades_fixture, ator_fixture, 'encomenda') is distinct from true
    or public.pecas_avancar_atendimento(cotacao_encomenda, unidades_fixture, ator_fixture, 'separacao') is distinct from false then
    raise exception 'A encomenda deve aceitar reenvio e preservar o tipo escolhido.';
  end if;
  if not exists (select 1 from public.pecas_cotacoes where id = cotacao_fixture and status = 'em_separacao' and tipo_preparo = 'separacao')
    or not exists (select 1 from public.pecas_cotacoes where id = cotacao_encomenda and status = 'em_separacao' and tipo_preparo = 'encomenda') then
    raise exception 'Separação e encomenda devem usar a mesma etapa com tipos distintos.';
  end if;

  if public.pecas_avancar_atendimento(cotacao_fixture, array['santaluzia'], ator_fixture, 'entrega') is distinct from false
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, outro_ator, 'entrega') is distinct from false
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'entrega') is distinct from true
    or public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'entrega') is distinct from true
    or public.pecas_avancar_atendimento(cotacao_encomenda, unidades_fixture, ator_fixture, 'entrega') is distinct from true then
    raise exception 'A entrega deve respeitar unidade e responsável e aceitar reenvio.';
  end if;
  if public.pecas_avancar_atendimento(cotacao_fixture, unidades_fixture, ator_fixture, 'separacao') is distinct from false
    or not exists (select 1 from public.pecas_cotacoes where id = cotacao_fixture and status = 'entregue' and tipo_preparo = 'separacao')
    or not exists (select 1 from public.pecas_cotacoes where id = cotacao_encomenda and status = 'entregue' and tipo_preparo = 'encomenda') then
    raise exception 'A entrega deve preservar o tipo e encerrar o preparo.';
  end if;

  begin
    perform public.pecas_avancar_atendimento(cotacao_falha, unidades_fixture, ator_fixture, 'entrega');
    raise exception 'O evento de entrega deveria ter falhado.';
  exception when check_violation then
    get stacked diagnostics restricao = constraint_name;
    if restricao is distinct from 'fixture_rejeita_entrega' then raise; end if;
  end;
  if not exists (
    select 1 from public.pecas_cotacoes
    where id = cotacao_falha and status = 'em_separacao' and tipo_preparo = 'encomenda'
  ) then
    raise exception 'Falha no histórico deve reverter a entrega.';
  end if;
end $$;

do $$
declare
  cotacao_entregue constant uuid := '00000000-0000-4000-8000-000000000054';
  cotacao_aguardando constant uuid := '00000000-0000-4000-8000-000000000058';
  cotacao_sem_venda constant uuid := '00000000-0000-4000-8000-000000000059';
  cotacao_em_preparo constant uuid := '00000000-0000-4000-8000-000000000063';
  cotacao_em_cotacao constant uuid := '00000000-0000-4000-8000-000000000064';
  cotacao_vendida constant uuid := '00000000-0000-4000-8000-000000000065';
  cliente_fixture constant uuid := '00000000-0000-4000-8000-000000000052';
  ator_fixture constant uuid := '00000000-0000-4000-8000-000000000051';
  outro_ator constant uuid := '00000000-0000-4000-8000-000000000055';
  unidades_fixture constant text[] := array['comauto'];
  motivo_perda constant text := repeat('m', 500);
  motivo_cancelamento constant text := 'Cliente solicitou cancelamento';
  motivo_invalido text;
  instante_venda timestamptz;
  restricao text;
begin
  insert into public.pecas_cotacoes (id, cliente_id, descricao, status, responsavel_id, venda_confirmada_em, venda_confirmada_por)
  values
    (cotacao_em_cotacao, cliente_fixture, 'Fixture de perda', 'em_cotacao', ator_fixture, null, null),
    (cotacao_vendida, cliente_fixture, 'Fixture de venda aprovada', 'aprovado', ator_fixture, now(), ator_fixture);

  foreach motivo_invalido in array array[null, '', ' ', E'\tMotivo', 'Motivo ', repeat('x', 501)] loop
    if public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, ator_fixture, 'perdido', motivo_invalido) is distinct from false then
      raise exception 'O motivo exige de 1 a 500 caracteres aparados.';
    end if;
  end loop;
  if public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, ator_fixture, 'entregue', motivo_perda) is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_em_cotacao, array['santaluzia'], ator_fixture, 'perdido', motivo_perda) is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, outro_ator, 'perdido', motivo_perda) is distinct from false then
    raise exception 'O encerramento exige destino válido, unidade e responsável corretos.';
  end if;
  if public.pecas_encerrar_cotacao(cotacao_entregue, unidades_fixture, ator_fixture, 'perdido', motivo_perda) is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_entregue, unidades_fixture, ator_fixture, 'cancelado', motivo_cancelamento) is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_vendida, unidades_fixture, ator_fixture, 'perdido', motivo_perda) is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_em_preparo, unidades_fixture, ator_fixture, 'perdido', motivo_perda) is distinct from false then
    raise exception 'A perda exige venda pendente e a entrega encerra o fluxo.';
  end if;

  begin
    update public.pecas_cotacoes set status = 'perdido' where id = cotacao_em_cotacao;
    raise exception 'Uma cotação perdida exige motivo persistido.';
  exception when check_violation then null;
  end;
  begin
    update public.pecas_cotacoes set motivo_encerramento = motivo_perda where id = cotacao_em_cotacao;
    raise exception 'O motivo persistido exige uma etapa de encerramento.';
  exception when check_violation then null;
  end;

  if public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, ator_fixture, 'perdido', motivo_perda) is distinct from true
    or public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, ator_fixture, 'perdido', motivo_perda) is distinct from true
    or public.pecas_encerrar_cotacao(cotacao_sem_venda, unidades_fixture, ator_fixture, 'perdido', motivo_perda) is distinct from true
    or public.pecas_encerrar_cotacao(cotacao_aguardando, unidades_fixture, ator_fixture, 'cancelado', motivo_cancelamento) is distinct from true then
    raise exception 'O responsável deve conseguir encerrar as cotações elegíveis.';
  end if;
  if public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, ator_fixture, 'perdido', 'Outro motivo') is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, ator_fixture, 'cancelado', motivo_cancelamento) is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_em_cotacao, unidades_fixture, outro_ator, 'perdido', motivo_perda) is distinct from false
    or public.pecas_encerrar_cotacao(cotacao_em_cotacao, array['santaluzia'], ator_fixture, 'perdido', motivo_perda) is distinct from false then
    raise exception 'O reenvio exige o destino, o motivo e o escopo originais.';
  end if;
  if not exists (select 1 from public.pecas_cotacoes where id = cotacao_em_cotacao and status = 'perdido' and motivo_encerramento = motivo_perda)
    or not exists (select 1 from public.pecas_cotacoes where id = cotacao_aguardando and status = 'cancelado' and motivo_encerramento = motivo_cancelamento) then
    raise exception 'A etapa e o motivo precisam permanecer no cartão.';
  end if;

  select venda_confirmada_em into instante_venda from public.pecas_cotacoes where id = cotacao_em_preparo;
  if public.pecas_encerrar_cotacao(cotacao_em_preparo, unidades_fixture, ator_fixture, 'cancelado', motivo_cancelamento) is distinct from true
    or public.pecas_encerrar_cotacao(cotacao_em_preparo, unidades_fixture, ator_fixture, 'cancelado', motivo_cancelamento) is distinct from true
    or public.pecas_avancar_atendimento(cotacao_em_preparo, unidades_fixture, ator_fixture, 'entrega') is distinct from false then
    raise exception 'O cancelamento encerra o preparo e aceita reenvio idêntico.';
  end if;
  if not exists (
    select 1 from public.pecas_cotacoes
    where id = cotacao_em_preparo and status = 'cancelado' and motivo_encerramento = motivo_cancelamento
      and venda_confirmada_em = instante_venda and venda_confirmada_por = ator_fixture and tipo_preparo = 'encomenda'
  ) then
    raise exception 'O cancelamento deve preservar data e autor da venda e o tipo de preparo.';
  end if;

  begin
    perform public.pecas_encerrar_cotacao(cotacao_vendida, unidades_fixture, ator_fixture, 'cancelado', motivo_cancelamento);
    raise exception 'O evento de cancelamento deveria ter falhado.';
  exception when check_violation then
    get stacked diagnostics restricao = constraint_name;
    if restricao is distinct from 'fixture_rejeita_encerramento' then raise; end if;
  end;
  if not exists (
    select 1 from public.pecas_cotacoes
    where id = cotacao_vendida and status = 'aprovado' and motivo_encerramento is null
      and venda_confirmada_em is not null and venda_confirmada_por = ator_fixture
  ) then
    raise exception 'Falha no histórico deve reverter a etapa e o motivo.';
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
    or not has_column_privilege('service_role', 'public.pecas_cotacoes', 'venda_confirmada_em', 'UPDATE')
    or not has_column_privilege('service_role', 'public.pecas_cotacoes', 'venda_confirmada_por', 'UPDATE')
    or not has_column_privilege('service_role', 'public.pecas_cotacoes', 'tipo_preparo', 'UPDATE')
    or not has_column_privilege('service_role', 'public.pecas_cotacoes', 'motivo_encerramento', 'UPDATE')
    or has_column_privilege('service_role', 'public.pecas_cotacoes', 'descricao', 'UPDATE')
    or has_table_privilege('service_role', 'public.pecas_cotacoes_historico', 'SELECT, UPDATE, DELETE')
    or has_function_privilege('anon', 'public.pecas_assumir_cotacao(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_assumir_cotacao(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_registrar_apresentacao(uuid,text[],uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_registrar_apresentacao(uuid,text[],uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_registrar_aprovacao(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_registrar_aprovacao(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_confirmar_venda(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_confirmar_venda(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_avancar_atendimento(uuid,text[],uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_avancar_atendimento(uuid,text[],uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_encerrar_cotacao(uuid,text[],uuid,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_encerrar_cotacao(uuid,text[],uuid,text,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.pecas_registrar_cotacao_bot(uuid,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pecas_registrar_cotacao_bot(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'A cotação e seu histórico devem manter RLS fechada e os grants mínimos do servidor.';
  end if;

  if (select count(*) from public.pecas_cotacoes_historico) <> 11 or not exists (
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
  if (
    select count(*) from (
      select cotacao_id from public.pecas_cotacoes_historico
      where cotacao_id in ('00000000-0000-4000-8000-000000000054', '00000000-0000-4000-8000-000000000060')
        and unidade = 'comauto' and ator_id = '00000000-0000-4000-8000-000000000051'
        and ocorrido_em between transaction_timestamp() and clock_timestamp()
      group by cotacao_id
      having count(*) filter (where de_status = 'aprovado' and para_status = 'em_separacao') = 1
        and count(*) filter (where de_status = 'em_separacao' and para_status = 'entregue') = 1
    ) cotacoes_com_historico
  ) <> 2 then
    raise exception 'Cada cotação deve guardar um evento de preparo e um de entrega.';
  end if;
  if (
    select count(distinct h.cotacao_id) from public.pecas_cotacoes_historico h
    join (values
      ('00000000-0000-4000-8000-000000000058'::uuid, 'aguardando_cliente', 'cancelado'),
      ('00000000-0000-4000-8000-000000000059'::uuid, 'aprovado', 'perdido'),
      ('00000000-0000-4000-8000-000000000063'::uuid, 'em_separacao', 'cancelado'),
      ('00000000-0000-4000-8000-000000000064'::uuid, 'em_cotacao', 'perdido')
    ) esperado (cotacao_id, de_status, para_status)
      on esperado.cotacao_id = h.cotacao_id and esperado.de_status = h.de_status and esperado.para_status = h.para_status
    where h.unidade = 'comauto' and h.ator_id = '00000000-0000-4000-8000-000000000051'
      and h.ocorrido_em between transaction_timestamp() and clock_timestamp()
  ) <> 4 then
    raise exception 'Cada encerramento deve guardar a transição, unidade, autor e horário corretos.';
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
      and venda_confirmada_por = '00000000-0000-4000-8000-000000000051' and venda_confirmada_em is not null
  ) then
    raise exception 'Remover veículo ou usuário deve preservar a cotação e a autoria da venda.';
  end if;

  begin
    delete from public.clientes where id = '00000000-0000-4000-8000-000000000052';
    raise exception 'Removeu cliente com cotação vinculada.';
  exception when foreign_key_violation or sqlstate '23001' then null;
  end;
end $$;

rollback;
