-- Banco descartável: 0001, 0002, 0003, 0005 e migration de encaminhamentos.
-- Não concede privilégios às tabelas reais: a migration precisa prover os grants do invoker.
begin;

create function pg_temp.estado_encaminhamentos() returns jsonb
language sql as $$
  select jsonb_build_object(
    'ledger', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.encaminhamentos_bot t),
    'cotacoes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pecas_cotacoes t),
    'historico', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pecas_cotacoes_historico t),
    'notas', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.notas_cliente t),
    'avisos', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.notificacoes t)
  );
$$;

-- A fixture é dona dos dados, mas a operação SEMPRE executa como o papel do servidor.
create function pg_temp.chamar_encaminhamento(
  p_conversa uuid, p_cliente uuid, p_referencia text, p_destino text, p_resumo text,
  p_papel text default 'service_role'
) returns jsonb language plpgsql as $$
declare resposta jsonb;
begin
  if p_papel not in ('service_role', 'anon', 'authenticated') then
    raise exception 'Papel inválido na fixture.';
  end if;
  execute format('set local role %I', p_papel);
  if current_user <> p_papel then raise exception 'A chamada não trocou o papel.'; end if;
  resposta := public.encaminhar_lead_bot(p_conversa, p_cliente, p_referencia, p_destino, p_resumo);
  reset role;
  return resposta;
exception when others then
  reset role;
  raise;
end $$;

create function pg_temp.recusar_encaminhamento(
  p_conversa uuid, p_cliente uuid, p_referencia text, p_destino text, p_resumo text,
  p_aceita_excecao boolean default false
) returns void language plpgsql as $$
declare antes jsonb; resposta jsonb; lancou boolean := false;
begin
  antes := pg_temp.estado_encaminhamentos();
  begin
    resposta := pg_temp.chamar_encaminhamento(p_conversa, p_cliente, p_referencia, p_destino, p_resumo);
  exception when others then
    if not p_aceita_excecao then raise; end if;
    lancou := true;
  end;
  if not lancou and resposta->>'ok' is distinct from 'false' then
    raise exception 'Deveria recusar referência %, obteve %.', p_referencia, resposta;
  end if;
  if pg_temp.estado_encaminhamentos() is distinct from antes then
    raise exception 'Recusa deixou efeitos parciais: %.', p_referencia;
  end if;
end $$;

insert into public.unidades (chave, nome, ativa) values
  ('enc_principal', 'Fixture encaminhamento principal', true),
  ('enc_fora', 'Fixture outra unidade', true),
  ('enc_triagem', 'Fixture triagem', true),
  ('enc_admin', 'Fixture fallback administrador', true),
  ('enc_admin_principal', 'Fixture administrador principal', true),
  ('enc_sem_equipe', 'Fixture sem destinatários', true),
  ('enc_inativa', 'Fixture unidade inativa', false);

insert into auth.users (id)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 17) n;
insert into public.usuarios (user_id, nome, papel, setor, unidade, ativo) values
  ('10000000-0000-4000-8000-000000000001', 'Peças principal', 'pecas', 'pecas', 'enc_principal', true),
  ('10000000-0000-4000-8000-000000000002', 'Peças unidade extra', 'pecas', 'pecas', 'enc_fora', true),
  ('10000000-0000-4000-8000-000000000003', 'Gerente Peças', 'gerente', 'pecas', 'enc_principal', true),
  ('10000000-0000-4000-8000-000000000004', 'Gerente administração extra', 'gerente', 'administracao', 'enc_fora', true),
  ('10000000-0000-4000-8000-000000000005', 'Gerente Oficina', 'gerente', 'oficina', 'enc_principal', true),
  ('10000000-0000-4000-8000-000000000006', 'Peças inativo', 'pecas', 'pecas', 'enc_principal', false),
  ('10000000-0000-4000-8000-000000000007', 'Peças fora da unidade', 'pecas', 'pecas', 'enc_fora', true),
  ('10000000-0000-4000-8000-000000000008', 'Admin principal', 'admin', 'administracao', 'enc_principal', true),
  ('10000000-0000-4000-8000-000000000009', 'Recepção principal', 'recepcao', 'oficina', 'enc_triagem', true),
  ('10000000-0000-4000-8000-000000000010', 'Atendente legado', 'atendente', 'administracao', 'enc_triagem', true),
  ('10000000-0000-4000-8000-000000000011', 'Recepção extra', 'recepcao', 'oficina', 'enc_fora', true),
  ('10000000-0000-4000-8000-000000000012', 'Recepção inativa', 'recepcao', 'oficina', 'enc_triagem', false),
  ('10000000-0000-4000-8000-000000000013', 'Peças fora da triagem', 'pecas', 'pecas', 'enc_triagem', true),
  ('10000000-0000-4000-8000-000000000014', 'Administrador extra', 'admin', 'administracao', 'enc_fora', true),
  ('10000000-0000-4000-8000-000000000015', 'Administrador inativo', 'admin', 'administracao', 'enc_admin', false),
  ('10000000-0000-4000-8000-000000000016', 'Peças unidade inativa', 'pecas', 'pecas', 'enc_inativa', true),
  ('10000000-0000-4000-8000-000000000017', 'Admin fallback principal', 'admin', 'administracao', 'enc_admin_principal', true);
insert into public.usuario_unidades (user_id, unidade) values
  ('10000000-0000-4000-8000-000000000001', 'enc_principal'), -- não pode duplicar destinatário
  ('10000000-0000-4000-8000-000000000002', 'enc_principal'),
  ('10000000-0000-4000-8000-000000000004', 'enc_principal'),
  ('10000000-0000-4000-8000-000000000011', 'enc_triagem'),
  ('10000000-0000-4000-8000-000000000014', 'enc_admin');

insert into public.clientes (id, telefone, nome, anonimizado)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '55119000' || lpad(n::text, 5, '0'), 'Cliente fictício ' || n, n = 107
from generate_series(101, 108) n;
insert into public.conversas (id, cliente_id, unidade)
select ('10000000-0000-4000-8000-' || lpad((n + 100)::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case n when 101 then 'enc_principal' when 102 then 'enc_triagem' when 103 then 'enc_admin'
    when 104 then 'enc_sem_equipe' when 105 then 'enc_inativa' when 106 then 'enc_fora'
    when 108 then 'enc_admin_principal'
    else 'enc_principal' end
from generate_series(101, 108) n;

-- Cada chamada positiva tem uma mensagem de entrada pertencente à mesma ficha e conversa.
insert into public.mensagens (conversa_id, cliente_id, direcao, autor, wamid, conteudo)
select ('10000000-0000-4000-8000-' || lpad(f.conversa::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(f.cliente::text, 12, '0'))::uuid,
  f.direcao, case when f.direcao = 'entrada' then 'cliente' else 'bot' end,
  f.referencia, 'Mensagem fictícia do contrato'
from (values
  (201, 101, 'entrada', 'wamid.enc.normal'),
  (201, 101, 'entrada', 'wamid.enc.outra'),
  (201, 101, 'saida', 'wamid.enc.saida'),
  (206, 106, 'entrada', 'wamid.enc.outra-conversa'),
  (201, 106, 'entrada', 'wamid.enc.ficha-divergente'),
  (202, 102, 'entrada', 'wamid.enc.triagem'),
  (203, 103, 'entrada', 'wamid.enc.admin-pecas'),
  (203, 103, 'entrada', 'wamid.enc.admin-triagem'),
  (208, 108, 'entrada', 'wamid.enc.admin-principal'),
  (204, 104, 'entrada', 'wamid.enc.sem-equipe'),
  (205, 105, 'entrada', 'wamid.enc.inativa'),
  (207, 107, 'entrada', 'wamid.enc.anonimizado'),
  (201, 101, 'entrada', 'wamid.enc.falha-nota'),
  (201, 101, 'entrada', 'wamid.enc.falha-aviso')
) f (conversa, cliente, direcao, referencia);

do $$
declare
  conversa constant uuid := '10000000-0000-4000-8000-000000000201';
  cliente constant uuid := '10000000-0000-4000-8000-000000000101';
  resposta jsonb; repetida jsonb; antes jsonb; cotacao uuid; destinatarios uuid[];
begin
  resposta := pg_temp.chamar_encaminhamento(conversa, cliente, 'wamid.enc.normal', 'pecas', 'Pedido original de pastilhas');
  if resposta->>'ok' is distinct from 'true' or resposta->>'ja_registrado' is distinct from 'false'
    or resposta->>'cotacao_id' is null then
    raise exception 'Primeiro pedido de Peças não foi registrado: %.', resposta;
  end if;
  cotacao := (resposta->>'cotacao_id')::uuid;
  if not exists (select 1 from public.encaminhamentos_bot e
    where e.referencia = 'wamid.enc.normal' and e.conversa_id = conversa and e.cliente_id = cliente
      and e.unidade = 'enc_principal' and e.destino = 'pecas' and e.cotacao_id = cotacao and e.criado_em is not null) then
    raise exception 'Ledger não preservou ficha, conversa, unidade, destino e cotação.';
  end if;
  if not exists (select 1 from public.pecas_cotacoes c where c.id = cotacao and c.cliente_id = cliente
    and c.unidade = 'enc_principal' and c.origem = 'whatsapp' and c.origem_ref = 'wamid.enc.normal'
    and c.status = 'novo' and c.responsavel_id is null and c.descricao = 'Pedido original de pastilhas') then
    raise exception 'A cotação de Peças deve iniciar nova, vinculada à mensagem e sem responsável.';
  end if;
  if (select count(*) from public.notas_cliente where cliente_id = cliente and texto like '%Pedido original de pastilhas%') <> 1 then
    raise exception 'O pedido deve criar uma nota interna.';
  end if;
  select array_agg(usuario_id order by usuario_id) into destinatarios
    from public.notificacoes where unidade = 'enc_principal' and corpo = 'Pedido original de pastilhas';
  if destinatarios is distinct from array[
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'
  ]::uuid[] then
    raise exception 'Destinatários Peças incorretos (principal/extra/gerência/inativo/outro setor): %.', destinatarios;
  end if;
  if exists (select 1 from public.notificacoes where corpo = 'Pedido original de pastilhas'
    and (tipo <> 'pecas' or unidade <> 'enc_principal' or link is distinct from '/painel/pecas/' || cotacao::text)) then
    raise exception 'Avisos devem apontar para a cotação da mesma unidade.';
  end if;

  antes := pg_temp.estado_encaminhamentos();
  repetida := pg_temp.chamar_encaminhamento(conversa, cliente, 'wamid.enc.normal', 'pecas', 'Resumo diferente no reenvio');
  if repetida->>'ok' is distinct from 'true' or repetida->>'ja_registrado' is distinct from 'true'
    or repetida->>'cotacao_id' is distinct from cotacao::text then
    raise exception 'Reenvio deve informar já registrado e devolver a mesma cotação: %.', repetida;
  end if;
  if pg_temp.estado_encaminhamentos() is distinct from antes then
    raise exception 'Reenvio alterou conteúdo, datas, nota, avisos ou ledger.';
  end if;
  resposta := pg_temp.chamar_encaminhamento(conversa, cliente, 'wamid.enc.outra', 'pecas', 'Segundo pedido distinto');
  if resposta->>'ok' is distinct from 'true' or resposta->>'ja_registrado' is distinct from 'false'
    or resposta->>'cotacao_id' is null or resposta->>'cotacao_id' = cotacao::text then
    raise exception 'Outra mensagem deve gerar outra cotação: %.', resposta;
  end if;
end $$;

do $$
declare
  conversa constant uuid := '10000000-0000-4000-8000-000000000201';
  cliente constant uuid := '10000000-0000-4000-8000-000000000101';
begin
  perform pg_temp.recusar_encaminhamento(conversa, cliente, 'wamid.enc.normal', 'triagem', 'Destino conflitante');
  perform pg_temp.recusar_encaminhamento('10000000-0000-4000-8000-000000000206',
    '10000000-0000-4000-8000-000000000106', 'wamid.enc.normal', 'pecas', 'Referência de outra ficha');
  perform pg_temp.recusar_encaminhamento(conversa, '10000000-0000-4000-8000-000000000106',
    'wamid.enc.normal', 'pecas', 'Conversa não pertence à ficha');
  perform pg_temp.recusar_encaminhamento('10000000-0000-4000-8000-000000000999', cliente,
    'wamid.enc.normal', 'pecas', 'Conversa inexistente');
  perform pg_temp.recusar_encaminhamento(conversa, cliente, 'wamid.enc.inexistente', 'pecas', 'Sem mensagem real');
  perform pg_temp.recusar_encaminhamento(conversa, cliente, 'wamid.enc.saida', 'pecas', 'Mensagem de saída');
  perform pg_temp.recusar_encaminhamento(conversa, cliente, 'wamid.enc.outra-conversa', 'pecas', 'Mensagem de outra conversa');
  perform pg_temp.recusar_encaminhamento(conversa, cliente, 'wamid.enc.ficha-divergente', 'pecas', 'Mensagem com ficha divergente');
  perform pg_temp.recusar_encaminhamento(conversa, cliente, '', 'pecas', 'Referência vazia');
  perform pg_temp.recusar_encaminhamento(conversa, cliente, null, 'pecas', 'Referência nula');
  perform pg_temp.recusar_encaminhamento(null, cliente, 'wamid.enc.normal', 'pecas', 'Sem conversa');
  perform pg_temp.recusar_encaminhamento(conversa, null, 'wamid.enc.normal', 'pecas', 'Sem ficha');
  perform pg_temp.recusar_encaminhamento(conversa, cliente, 'wamid.enc.outra', 'desconhecido', 'Destino inválido');
  perform pg_temp.recusar_encaminhamento('10000000-0000-4000-8000-000000000205',
    '10000000-0000-4000-8000-000000000105', 'wamid.enc.inativa', 'pecas', 'Unidade inativa');
  perform pg_temp.recusar_encaminhamento('10000000-0000-4000-8000-000000000207',
    '10000000-0000-4000-8000-000000000107', 'wamid.enc.anonimizado', 'pecas', 'Ficha anonimizada');
  perform pg_temp.recusar_encaminhamento('10000000-0000-4000-8000-000000000204',
    '10000000-0000-4000-8000-000000000104', 'wamid.enc.sem-equipe', 'pecas', 'Não há equipe nem administrador', true);
end $$;

do $$
declare resposta jsonb; antes jsonb; destinatarios uuid[];
begin
  resposta := pg_temp.chamar_encaminhamento('10000000-0000-4000-8000-000000000202',
    '10000000-0000-4000-8000-000000000102', 'wamid.enc.triagem', 'triagem', 'Pedido de triagem');
  if resposta->>'ok' is distinct from 'true' or resposta->>'ja_registrado' is distinct from 'false'
    or resposta->'cotacao_id' is distinct from 'null'::jsonb then
    raise exception 'Triagem deve registrar nota/avisos sem cotação: %.', resposta;
  end if;
  if not exists (select 1 from public.encaminhamentos_bot where referencia = 'wamid.enc.triagem'
    and destino = 'triagem' and unidade = 'enc_triagem' and cotacao_id is null) then
    raise exception 'Triagem não foi registrada no ledger.';
  end if;
  if (select count(*) from public.notas_cliente where cliente_id = '10000000-0000-4000-8000-000000000102'
    and texto like '%Pedido de triagem%') <> 1 then raise exception 'Triagem não criou a nota.'; end if;
  select array_agg(usuario_id order by usuario_id) into destinatarios
    from public.notificacoes where corpo = 'Pedido de triagem';
  if destinatarios is distinct from array[
    '10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000011'
  ]::uuid[] then raise exception 'Destinatários da triagem incorretos: %.', destinatarios; end if;
  if exists (select 1 from public.notificacoes where corpo = 'Pedido de triagem'
    and (tipo <> 'lead' or unidade <> 'enc_triagem'
      or link is distinct from '/painel/clientes?c=10000000-0000-4000-8000-000000000102')) then
    raise exception 'Triagem deve apontar para a ficha exata do cliente.';
  end if;
  antes := pg_temp.estado_encaminhamentos();
  resposta := pg_temp.chamar_encaminhamento('10000000-0000-4000-8000-000000000202',
    '10000000-0000-4000-8000-000000000102', 'wamid.enc.triagem', 'triagem', 'Reenvio da triagem');
  if resposta->>'ok' is distinct from 'true' or resposta->>'ja_registrado' is distinct from 'true'
    or pg_temp.estado_encaminhamentos() is distinct from antes then
    raise exception 'Reenvio da triagem duplicou ou alterou efeitos.';
  end if;
end $$;

do $$
declare destino text; resposta jsonb;
begin
  foreach destino in array array['pecas', 'triagem'] loop
    resposta := pg_temp.chamar_encaminhamento('10000000-0000-4000-8000-000000000203',
      '10000000-0000-4000-8000-000000000103', 'wamid.enc.admin-' || destino, destino, 'Fallback admin ' || destino);
    if resposta->>'ok' is distinct from 'true' then raise exception 'Falhou fallback admin: %.', resposta; end if;
    if (select count(*) from public.notificacoes where corpo = 'Fallback admin ' || destino) <> 1
      or not exists (select 1 from public.notificacoes where corpo = 'Fallback admin ' || destino
        and usuario_id = '10000000-0000-4000-8000-000000000014' and unidade = 'enc_admin') then
      raise exception 'Fallback não alcançou exatamente o administrador ativo por unidade extra.';
    end if;
  end loop;
  resposta := pg_temp.chamar_encaminhamento('10000000-0000-4000-8000-000000000208',
    '10000000-0000-4000-8000-000000000108', 'wamid.enc.admin-principal', 'pecas', 'Fallback admin principal');
  if resposta->>'ok' is distinct from 'true'
    or (select count(*) from public.notificacoes where corpo = 'Fallback admin principal') <> 1
    or not exists (select 1 from public.notificacoes where corpo = 'Fallback admin principal'
      and usuario_id = '10000000-0000-4000-8000-000000000017' and unidade = 'enc_admin_principal') then
    raise exception 'Fallback não alcançou o administrador da unidade principal: %.', resposta;
  end if;
end $$;

-- Falhas reais de constraints depois da resolução da mensagem: nenhuma operação pode sobrar pela metade.
alter table public.notas_cliente add constraint fixture_enc_rejeita_nota
  check (texto not like '%FALHA-NOTA%');
alter table public.notificacoes add constraint fixture_enc_rejeita_aviso
  check (corpo not like '%FALHA-AVISO%');
do $$
begin
  perform pg_temp.recusar_encaminhamento('10000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000101', 'wamid.enc.falha-nota', 'pecas', 'FALHA-NOTA proposital', true);
  perform pg_temp.recusar_encaminhamento('10000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000101', 'wamid.enc.falha-aviso', 'pecas', 'FALHA-AVISO proposital', true);
end $$;
alter table public.notas_cliente drop constraint fixture_enc_rejeita_nota;
alter table public.notificacoes drop constraint fixture_enc_rejeita_aviso;

do $$
declare
  assinatura constant text := 'public.encaminhar_lead_bot(uuid,uuid,text,text,text)';
  papel text; privilegio text; funcao record;
begin
  if not exists (select 1 from pg_class where oid = 'public.encaminhamentos_bot'::regclass and relrowsecurity) then
    raise exception 'O ledger deve ter RLS ligado.';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.encaminhamentos_bot'::regclass) then
    raise exception 'O ledger deve permanecer sem políticas de browser.';
  end if;
  foreach papel in array array['anon', 'authenticated'] loop
    if has_function_privilege(papel, assinatura, 'EXECUTE') then
      raise exception 'RPC exposta ao papel %.', papel;
    end if;
    foreach privilegio in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(papel, 'public.encaminhamentos_bot', privilegio) then
        raise exception 'Ledger expôs % ao papel %.', privilegio, papel;
      end if;
    end loop;
    if has_any_column_privilege(papel, 'public.encaminhamentos_bot', 'SELECT, INSERT, UPDATE') then
      raise exception 'Ledger expôs privilégios por coluna ao papel %.', papel;
    end if;
    begin
      perform pg_temp.chamar_encaminhamento('10000000-0000-4000-8000-000000000201',
        '10000000-0000-4000-8000-000000000101', 'wamid.enc.normal', 'pecas', 'Não deve executar', papel);
      raise exception 'O browser conseguiu executar a RPC como %.', papel;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if not has_function_privilege('service_role', assinatura, 'EXECUTE')
    or not has_table_privilege('service_role', 'public.encaminhamentos_bot', 'SELECT')
    or not has_table_privilege('service_role', 'public.encaminhamentos_bot', 'INSERT') then
    raise exception 'Faltam grants explícitos do servidor.';
  end if;
  foreach privilegio in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('service_role', 'public.encaminhamentos_bot', privilegio) then
      raise exception 'Ledger recebeu grant desnecessário de % ao servidor.', privilegio;
    end if;
  end loop;
  if has_any_column_privilege('service_role', 'public.encaminhamentos_bot', 'UPDATE') then
    raise exception 'Ledger recebeu grant desnecessário de UPDATE por coluna.';
  end if;
  select prosecdef, proconfig, proacl, proowner into funcao from pg_proc where oid = assinatura::regprocedure;
  if funcao.prosecdef or not coalesce(funcao.proconfig && array['search_path=""', 'search_path='], false) then
    raise exception 'RPC deve ser invoker com search_path vazio explícito.';
  end if;
  if exists (select 1 from aclexplode(coalesce(funcao.proacl, acldefault('f', funcao.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'PUBLIC ainda pode executar a RPC.';
  end if;
end $$;

rollback;
