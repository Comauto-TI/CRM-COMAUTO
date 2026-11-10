-- Dados 100% fictícios. Execute apenas em uma instância local de demonstração.
-- Na mesma sessão, primeiro execute: SET comauto.ambiente = 'demo';
-- Requer 0001_init.sql + seed.sql. Nenhum consentimento de envio é criado.

do $demo$
declare
  v_cliente uuid;
  v_veiculo uuid;
  v_conversa uuid;
  v_agendamento uuid;
  v_servico uuid;
  v_recurso uuid;
  v_template uuid;
  v_evento uuid;
  v_campanha uuid;
  v_status text;
  v_estado_conversa text;
  v_inicio timestamptz;
  v_ultimo_contato timestamptz;
  v_telefone text;
  v_dia timestamptz;
  v_ref timestamptz := date_trunc('day', now(), 'America/Sao_Paulo') + interval '13 hours';
begin
  if current_setting('comauto.ambiente', true) is distinct from 'demo' then
    raise exception 'Seed demo requer banco de demonstração e SET comauto.ambiente = demo na sessão';
  end if;
  if exists (select from clientes where origem = 'demo' and tags @> array['comauto_demo']) then
    raise notice 'Dados de demonstração já carregados';
    return;
  end if;

  insert into servicos (nome, descricao, duracao_min, tipo_recurso)
    values ('Revisão de demonstração', 'Serviço fictício para o painel', 60, 'box') returning id into v_servico;
  insert into recursos (nome, tipo)
    values ('Box demonstração', 'box') returning id into v_recurso;

  insert into eventos (nome, descricao, inicio, fim, local, vagas, status)
    values ('Feirão Comauto · Demonstração', 'Evento fictício', v_ref - interval '7 days',
            v_ref - interval '7 days' + interval '4 hours', 'Loja de demonstração', 30, 'encerrado')
    returning id into v_evento;
  insert into templates (nome, categoria_meta, finalidade, uso, corpo_exemplo, status_aprovacao, ativo)
    values ('convite_demo_local', 'MARKETING', 'eventos', 'convite_evento', 'Convite fictício de demonstração.',
            'rascunho', false) returning id into v_template;
  insert into campanhas (nome, tipo, evento_id, template_id, status, total_previsto, iniciada_em, concluida_em, criado_por)
    values ('Convites · Feirão de demonstração', 'evento', v_evento, v_template, 'concluida', 30,
            v_ref - interval '14 days', v_ref - interval '12 days', 'demo@example.test')
    returning id into v_campanha;

  for i in 1..60 loop
    v_telefone := '55119000000' || lpad(i::text, 2, '0');
    v_ultimo_contato := now() - make_interval(mins => i * 6);
    v_status := (array['pendente','confirmado','compareceu','cancelado','nao_compareceu'])[(i - 1) % 5 + 1];
    v_estado_conversa := case when i % 5 = 0 then 'humano' when i % 5 = 1 then 'encerrada' else 'bot' end;

    insert into clientes (telefone, nome, email, cidade, tags, origem, ultimo_contato_em)
      values (v_telefone, 'Cliente Demo ' || lpad(i::text, 2, '0'), 'cliente' || i || '@example.test',
              (array['São Paulo','Guarulhos','Osasco'])[(i - 1) % 3 + 1], array['comauto_demo'], 'demo', v_ultimo_contato)
      returning id into v_cliente;
    insert into veiculos (cliente_id, modelo, ano, km_atual, ultima_revisao_em)
      values (v_cliente, (array['Hatch Demo','Sedã Demo','SUV Demo'])[(i - 1) % 3 + 1], 2019 + i % 6,
              12000 + 850 * i, current_date - 60 - i)
      returning id into v_veiculo;

    v_inicio := v_ref + make_interval(days => case when v_status in ('pendente','confirmado') then i else -i end);
    insert into agendamentos
      (cliente_id, veiculo_id, servico_id, recurso_id, inicio, fim, status, origem,
       confirmado_em, confirmado_por, confirmado_canal, motivo_cancelamento, lembrete_24h_em, lembrete_2h_em)
      values (v_cliente, v_veiculo, v_servico, v_recurso, v_inicio, v_inicio + interval '1 hour', v_status, 'demo',
              case when v_status <> 'pendente' then least(now(), v_inicio - interval '2 days') end,
              case when v_status <> 'pendente' then 'demo@example.test' end,
              case when v_status <> 'pendente' then 'painel' end,
              case when v_status = 'cancelado' then 'Cancelamento fictício' end, now(), now())
      returning id into v_agendamento;
    insert into agendamento_historico (agendamento_id, acao, para_status, ator)
      values (v_agendamento, 'criado', v_status, 'demo@example.test');

    insert into conversas (cliente_id, status, motivo_transferencia, aguardando_desde, alerta_reenviado_em,
                           ultima_msg_em, nao_lidas, encerrada_em)
      values (v_cliente, v_estado_conversa, case when v_estado_conversa = 'humano' then 'Pedido de atendente' end,
              case when v_estado_conversa = 'humano' then v_ultimo_contato end, now(), v_ultimo_contato,
              case when v_estado_conversa = 'humano' then 1 else 0 end,
              case when v_estado_conversa = 'encerrada' then now() end)
      returning id into v_conversa;
    insert into mensagens (cliente_id, conversa_id, direcao, autor, tipo, conteudo, status, criado_em)
      values (v_cliente, v_conversa, 'entrada', 'cliente', 'text',
              'Olá! Gostaria de saber o horário da minha revisão.', 'recebida', v_ultimo_contato);
    if v_estado_conversa <> 'humano' then
      insert into mensagens (cliente_id, conversa_id, direcao, autor, tipo, conteudo, status, criado_em)
        values (v_cliente, v_conversa, 'saida', 'bot', 'text',
                'Olá! Posso ajudar com o seu agendamento.', 'lida', v_ultimo_contato + interval '1 minute');
    end if;

    if i <= 30 then
      insert into campanha_envios (campanha_id, cliente_id, telefone, status, enviado_em, entregue_em)
        values (v_campanha, v_cliente, v_telefone, case when i % 8 = 0 then 'falhou' else 'entregue' end,
                v_ref - interval '14 days', case when i % 8 <> 0 then v_ref - interval '14 days' + interval '1 minute' end);
      insert into inscricoes_evento (evento_id, cliente_id, status, confirmado_em, confirmado_por)
        values (v_evento, v_cliente, case when i % 2 = 0 then 'compareceu' else 'convidado' end,
                case when i % 2 = 0 then v_ref - interval '8 days' end,
                case when i % 2 = 0 then 'demo@example.test' end);
    end if;
  end loop;

  for i in 1..30 loop
    v_dia := v_ref - make_interval(days => i);
    insert into custos (ocorrido_em, categoria, descricao, quantidade, valor_unitario_brl, valor_brl, metadata)
      values (v_dia, 'meta_utility', 'Lembretes fictícios', 10 + i, 0.035, (10 + i) * 0.035, '{"demo":true}'),
             (v_dia, 'ia_anthropic', 'Chamadas de IA fictícias', 20 + i, 0.0005, (20 + i) * 0.0005, '{"demo":true}');
  end loop;
  insert into custos (ocorrido_em, categoria, descricao, quantidade, valor_unitario_brl, valor_brl, campanha_id, metadata)
    values (v_ref - interval '14 days', 'meta_marketing', 'Convites fictícios do feirão',
            27, 0.3217, 27 * 0.3217, v_campanha, '{"demo":true}'),
           (v_ref - interval '14 days', 'infra', 'Hospedagem fictícia do mês',
            1, 120, 120, null, '{"demo":true}');
end;
$demo$;

