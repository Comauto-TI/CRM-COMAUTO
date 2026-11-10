-- =====================================================================
-- Seed inicial — TODOS os valores são editáveis no painel (Configurações).
-- Preços da Meta e infra conforme os PDFs do projeto (nov/2026).
-- CONFIRMAR na tabela oficial da Meta antes de fechar orçamento.
-- =====================================================================

insert into config (chave, valor) values
 ('empresa',            '{"nome":"Comauto","endereco":"(preencher endereço da unidade)","telefone_humano":"(preencher)","site":"","whatsapp_numero":""}'),
 ('fuso_offset',        '"-03:00"'),
 ('cambio_usd_brl',     '5.40'),
 -- US$ por milhão de tokens — Claude Haiku 5.5, prompts <= 100K tokens
 ('claude_preco',       '{"modelo":"claude-haiku-5-5","input":0.10,"output":0.50,"cache_read":0.01,"cache_write":0.125}'),
 ('agenda',             '{"antecedencia_min_horas":2,"janela_dias":30,"passo_min":30,"intervalo_min":0,"max_opcoes":6}'),
 -- Envios iniciados pela empresa só neste horário (anti-spam)
 ('horario_envio',      '{"inicio":"08:00","fim":"20:00","dias":[1,2,3,4,5,6]}'),
 ('followup',           '{"pos_servico_dias":2,"revisao_aviso_dias":15,"lead_horas":20,"nao_compareceu_horas":3,"max_tentativas":1}'),
 ('seguranca',          '{"max_msgs_por_minuto":8,"max_msgs_por_dia":150,"max_chars_entrada":1200,"historico_msgs":12}'),
 ('campanhas',          '{"pausa_taxa_falha":0.15,"amostra_minima":30,"grupo_teste_tamanho":20}'),
 ('atendimento',        '{"sla_min":5,"msg_transferencia":"Entendi! Já avisei nossa recepção e em instantes alguém da equipe continua o atendimento por aqui.","msg_fora_horario":"Nossa equipe está fora do horário agora. Sua mensagem ficou registrada e vamos responder assim que voltarmos.","msg_sla":"Ainda estamos chamando alguém da equipe, só mais um instante, por favor."}'),
 ('bot_ativo',          'true')
on conflict (chave) do nothing;

insert into precos_meta (categoria, valor_brl, vigente_desde, observacao) values
 ('MARKETING',      0.3217, '2026-01-01', 'Brasil — por mensagem entregue (PDF de custos)'),
 ('UTILITY',        0.0350, '2026-01-01', 'Brasil — por mensagem entregue; pode ter desconto por volume'),
 ('AUTHENTICATION', 0.0350, '2026-01-01', 'Brasil — por mensagem entregue'),
 ('SERVICE',        0.0350, '2026-10-01', 'Cobrado só quando a Meta marcar billable=true no webhook');

insert into custos_fixos (nome, valor, moeda, recorrencia) values
 ('Supabase Pro', 25.00, 'USD', 'mensal'),
 ('Vercel Pro',   20.00, 'USD', 'mensal'),
 ('Domínio',      60.00, 'BRL', 'anual');

insert into servicos (nome, descricao, duracao_min, tipo_recurso) values
 ('Revisão periódica',           'Revisão conforme plano do fabricante (10.000 km / 12 meses)', 120, 'box'),
 ('Troca de óleo e filtros',     'Troca de óleo do motor e filtros',                              60, 'box'),
 ('Alinhamento e balanceamento', 'Alinhamento de direção e balanceamento das rodas',              60, 'box'),
 ('Diagnóstico eletrônico',      'Leitura de falhas e avaliação técnica',                         90, 'box'),
 ('Test drive',                  'Test drive acompanhado de consultor',                           45, 'consultor');

insert into recursos (nome, tipo) values
 ('Box 1', 'box'), ('Box 2', 'box'), ('Box 3', 'box'), ('Consultor de vendas', 'consultor');

-- Seg a sex 08-12 / 13-18, sábado 08-12
insert into horarios_funcionamento (dia_semana, abre, fecha)
select d, t.abre::time, t.fecha::time
  from generate_series(1,5) d
 cross join (values ('08:00','12:00'), ('13:00','18:00')) t(abre, fecha);
insert into horarios_funcionamento (dia_semana, abre, fecha) values (6, '08:00', '12:00');

-- Templates — status 'rascunho' até serem APROVADOS na Meta (sistema não envia sem aprovação).
insert into templates (nome, categoria_meta, finalidade, uso, corpo_exemplo, variaveis, botoes) values
 ('confirmacao_agendamento', 'UTILITY', 'servico', 'confirmacao_agendamento',
  'Olá, {{1}}! Seu agendamento de {{2}} na {{3}} está marcado para {{4}}. Local: {{5}}. Toque em Confirmar para garantir o horário. Se precisar alterar ou cancelar, responda aqui.',
  '{nome,servico,empresa,data_hora,local}',
  '[{"tipo":"quick_reply","texto":"Confirmar","payload_prefixo":"AG_CONF"},{"tipo":"quick_reply","texto":"Remarcar","payload_prefixo":"AG_REM"},{"tipo":"quick_reply","texto":"Cancelar","payload_prefixo":"AG_CANC"}]'),
 ('lembrete_agendamento_24h', 'UTILITY', 'servico', 'lembrete_24h',
  'Olá, {{1}}! Este é um lembrete do seu {{2}} agendado para amanhã, {{3}}, na {{4}}. Endereço: {{5}}. Se precisar alterar ou cancelar, responda aqui.',
  '{nome,servico,data_hora,empresa,local}',
  '[{"tipo":"quick_reply","texto":"Confirmar presença","payload_prefixo":"AG_CONF"},{"tipo":"quick_reply","texto":"Remarcar","payload_prefixo":"AG_REM"},{"tipo":"quick_reply","texto":"Cancelar","payload_prefixo":"AG_CANC"}]'),
 ('lembrete_agendamento_2h', 'UTILITY', 'servico', 'lembrete_2h',
  'Olá, {{1}}! Seu {{2}} é hoje às {{3}}. Estamos esperando você na {{4}}.',
  '{nome,servico,hora,empresa}', '[]'),
 ('alteracao_agendamento', 'UTILITY', 'servico', 'alteracao_agendamento',
  'Olá, {{1}}! Seu agendamento de {{2}} foi alterado para {{3}}. Se você não reconhece esta alteração, responda aqui.',
  '{nome,servico,data_hora}', '[]'),
 ('cancelamento_agendamento', 'UTILITY', 'servico', 'cancelamento_agendamento',
  'Olá, {{1}}. Seu agendamento de {{2}} em {{3}} foi cancelado. Quando quiser remarcar, é só responder aqui.',
  '{nome,servico,data_hora}', '[]'),
 ('nao_compareceu', 'UTILITY', 'servico', 'nao_compareceu',
  'Olá, {{1}}. Sentimos sua falta no {{2}} de hoje. Quer escolher um novo horário? Responda aqui.',
  '{nome,servico}', '[{"tipo":"quick_reply","texto":"Remarcar","payload_prefixo":"AG_REM"}]'),
 ('pesquisa_pos_servico', 'UTILITY', 'servico', 'followup_pos_servico',
  'Olá, {{1}}! Como foi o seu {{2}} na {{3}}? Sua opinião nos ajuda a melhorar. Responda com uma nota de 1 a 5.',
  '{nome,servico,empresa}', '[]'),
 ('convite_evento', 'MARKETING', 'eventos', 'convite_evento',
  'Olá, {{1}}! Você está convidado para {{2}} da {{3}}. Data: {{4}}. Local: {{5}}. Toque abaixo para confirmar presença. Para não receber mais convites, responda SAIR.',
  '{nome,evento,empresa,data_hora,local}',
  '[{"tipo":"quick_reply","texto":"Confirmar presença","payload_prefixo":"EV_CONF"},{"tipo":"quick_reply","texto":"Não poderei ir","payload_prefixo":"EV_REC"}]'),
 ('confirmacao_presenca_evento', 'UTILITY', 'eventos', 'confirmacao_presenca',
  'Olá, {{1}}! Sua presença em {{2}} está confirmada para {{3}}, no {{4}}. Até lá!',
  '{nome,evento,data_hora,local}', '[]'),
 ('lembrete_evento', 'UTILITY', 'eventos', 'lembrete_evento',
  'Olá, {{1}}! Lembrete: {{2}} acontece amanhã, {{3}}, no {{4}}. Esperamos você!',
  '{nome,evento,data_hora,local}', '[]'),
 ('alteracao_evento', 'UTILITY', 'eventos', 'alteracao_evento',
  'Olá, {{1}}. Houve uma alteração em {{2}}: {{3}}. Qualquer dúvida, responda aqui.',
  '{nome,evento,alteracao}', '[]'),
 ('agradecimento_evento', 'UTILITY', 'eventos', 'aviso_final_evento',
  'Olá, {{1}}! Obrigado por participar de {{2}} da {{3}}. Se tiver interesse em algum veículo ou quiser falar com um consultor, responda aqui.',
  '{nome,evento,empresa}', '[]'),
 ('lembrete_revisao_periodica', 'MARKETING', 'marketing', 'revisao_periodica',
  'Olá, {{1}}! Pelo nosso registro, o seu {{2}} está próximo da revisão. Quer agendar um horário na {{3}}? Responda aqui. Para não receber mais, responda SAIR.',
  '{nome,veiculo,empresa}', '[{"tipo":"quick_reply","texto":"Quero agendar","payload_prefixo":"LEAD_AGENDAR"}]'),
 ('alerta_atendimento_humano', 'UTILITY', 'servico', 'alerta_recepcao',
  'Novo atendimento aguardando: {{1}} ({{2}}). Motivo: {{3}}. Responder: {{4}}',
  '{cliente,telefone_mascarado,motivo,link}', '[]'),
 ('retomada_conversa', 'UTILITY', 'servico', 'retomada_atendimento',
  'Olá, {{1}}! Aqui é da {{2}}, dando continuidade ao seu atendimento. Pode responder esta mensagem para continuarmos.',
  '{nome,empresa}', '[]'),
 ('retorno_lead', 'MARKETING', 'marketing', 'followup_lead',
  'Olá, {{1}}! Ficou alguma dúvida sobre {{2}}? Posso ajudar a escolher um horário na {{3}}. Para não receber mais, responda SAIR.',
  '{nome,assunto,empresa}', '[{"tipo":"quick_reply","texto":"Quero agendar","payload_prefixo":"LEAD_AGENDAR"}]');

insert into respostas_rapidas (titulo, texto) values
 ('Saudação',        'Olá! Aqui é da recepção da Comauto, vou te ajudar. Um instante, por favor.'),
 ('Endereço',        'Nosso endereço é (preencher). Funcionamos de segunda a sexta das 8h às 18h e sábado das 8h às 12h.'),
 ('Orçamento',       'Vou verificar com a oficina e te retorno com o orçamento por aqui ainda hoje.'),
 ('Encerramento',    'Obrigado pelo contato! Qualquer coisa, é só chamar por aqui.');
