-- Executado em Postgres descartável após 0001_init.sql e seed.sql.
begin;

do $contratos$
declare
  v_cliente_a uuid;
  v_cliente_b uuid;
  v_servico uuid;
  v_recurso uuid;
  v_evento uuid;
  v_template uuid;
  v_campanha uuid;
  v_constraint text;
  v_inicio timestamptz := '2040-01-10 13:00:00+00';
begin
  insert into clientes (telefone, nome, origem)
    values ('5511900000091', 'Fixture SQL A', 'teste') returning id into v_cliente_a;
  insert into clientes (telefone, nome, origem)
    values ('5511900000092', 'Fixture SQL B', 'teste') returning id into v_cliente_b;

  select id into strict v_servico from servicos where nome = 'Revisão periódica';
  select id into strict v_recurso from recursos where nome = 'Box 1';
  insert into agendamentos (cliente_id, servico_id, recurso_id, inicio, fim, status)
    values (v_cliente_a, v_servico, v_recurso, v_inicio, v_inicio + interval '1 hour', 'confirmado');

  begin
    insert into agendamentos (cliente_id, servico_id, recurso_id, inicio, fim, status)
      values (v_cliente_b, v_servico, v_recurso, v_inicio + interval '30 minutes', v_inicio + interval '90 minutes', 'pendente');
    raise exception 'C3-a: sobreposição aceita';
  exception when sqlstate '23P01' then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'sem_conflito' then raise; end if;
  end;

  insert into agendamentos (cliente_id, servico_id, recurso_id, inicio, fim, status)
    values (v_cliente_b, v_servico, v_recurso, v_inicio + interval '1 hour', v_inicio + interval '2 hours', 'confirmado');
  raise notice 'C3-a OK: sobreposição retorna 23P01 e horários contíguos são aceitos';

  insert into eventos (nome, inicio, local, vagas, status)
    values ('Fixture SQL', v_inicio, 'Local fictício', 1, 'ativo') returning id into v_evento;
  if confirmar_inscricao(v_evento, v_cliente_a, 'teste') is distinct from 'confirmado' then
    raise exception 'C3-b: primeira inscrição deveria ser confirmada';
  end if;
  if confirmar_inscricao(v_evento, v_cliente_b, 'teste') is distinct from 'esgotado' then
    raise exception 'C3-b: segunda inscrição deveria retornar esgotado';
  end if;
  if (select count(*) from inscricoes_evento where evento_id = v_evento and status = 'confirmado') <> 1
    or (select status from inscricoes_evento where evento_id = v_evento and cliente_id = v_cliente_b) is distinct from 'lista_espera' then
    raise exception 'C3-b: inscrições persistidas em estados incorretos';
  end if;
  raise notice 'C3-b OK: última vaga ocupada e excedente em lista de espera';

  select id into strict v_template from templates where nome = 'convite_evento';
  insert into campanhas (nome, tipo, evento_id, template_id)
    values ('Campanha Fixture SQL', 'evento', v_evento, v_template) returning id into v_campanha;
  insert into campanha_envios (campanha_id, cliente_id, telefone)
    values (v_campanha, v_cliente_a, '5511900000091');

  begin
    insert into campanha_envios (campanha_id, cliente_id, telefone)
      values (v_campanha, v_cliente_a, '5511900000091');
    raise exception 'C3-c: envio repetido aceito';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'campanha_envios_campanha_id_cliente_id_key' then raise; end if;
  end;
  raise notice 'C3-c OK: destinatário não pode repetir dentro da campanha';

  insert into consentimentos (cliente_id, tipo, texto, origem)
    values (v_cliente_a, 'servico', 'Aceite sintético', 'teste'),
           (v_cliente_a, 'eventos', 'Aceite sintético', 'teste');
  insert into consentimentos (cliente_id, tipo, status, texto, origem, revogado_em)
    values (v_cliente_a, 'servico', 'revogado', 'Histórico sintético', 'teste', now());

  begin
    insert into consentimentos (cliente_id, tipo, texto, origem)
      values (v_cliente_a, 'servico', 'Aceite duplicado', 'teste');
    raise exception 'C3-d: consentimento ativo duplicado aceito';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'consentimento_ativo_unico' then raise; end if;
  end;
  raise notice 'C3-d OK: só um consentimento ativo por tipo, com histórico preservado';
end;
$contratos$;

rollback;

