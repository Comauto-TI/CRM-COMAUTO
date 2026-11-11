# Atendimento e relacionamento por setor

Direção confirmada pelo Simão em 11/11/2026, registrada também pelo Claude no chat de desenvolvimento.

O sistema se organiza por setores. Atendimento, relacionamento, carteira e métricas são funções disponíveis dentro de cada setor. A ficha do cliente permanece compartilhada no grupo.

## Visibilidade

| Perfil | Visão |
|---|---|
| Vendedor | Seus leads, carteira, conversas vinculadas e métricas pessoais em Vendas. |
| Equipe de Peças | Leads, conversas, relacionamento, cotações e resultados comerciais de Peças, conforme atribuição e unidades autorizadas. |
| Equipe de Oficina | Atendimento, clientes e agenda de Oficina, conforme atribuição e unidades autorizadas. |
| Gerente | Carteiras, atendimento e métricas do setor e das unidades que gerencia. |
| Administrador | Visão de todos os setores, equipes e unidades. |

As verificações são do servidor. Esconder menus ou filtrar apenas no navegador não constitui controle de acesso. Métricas pessoais devem nascer da mesma carteira autorizada usada pela fila, com os mesmos filtros e denominadores.

## Experiência compartilhada

- **Vendas:** atendimento no estilo WhatsApp dentro de Vendas; carteira e funis de Novos/Seminovos; relacionamento, próximas ações e métricas pessoais ou da gestão.
- **Peças:** atendimento no estilo WhatsApp dentro de Peças; relacionamento com leads, promoções autorizadas, cotação e acompanhamento da venda; métricas comerciais do setor e dos responsáveis.
- **Oficina/Agenda:** mesma base de conversa, ligada ao atendimento e aos agendamentos. Reutilizar a agenda existente e suas travas de horário.
- **Gestão:** visão consolidada por setor, unidade e responsável; administrador atravessa os setores autorizados pela sua função.

Reutilizar a interface de conversa, o envio oficial, os controles da janela de atendimento, as notificações e o histórico. Os módulos fornecem seu vínculo e escopo. Peças continua como CRM comercial: sem estoque, reserva física ou faturamento.

## Contrato antes de integrar a interface

1. Transportar a identidade da conversa e sua unidade desde a mensagem recebida. Preservar `wamid` como referência da mensagem.
2. Persistir o vínculo entre setor, lead/atendimento/cotação, cliente e conversa. O cliente sozinho não determina o setor nem a autorização para operar.
3. Leitura, assumir, responder, retomada, devolução, encerramento, notas e tags comprovam no servidor o vínculo, a unidade atual e a permissão do usuário. Vendas respeita a carteira; Peças e Oficina respeitam seus responsáveis e filas liberadas. Supervisão usa o setor e as unidades permitidos.
4. Uma conversa com o mesmo cliente pode passar entre setores mantendo o histórico. A posse da conversa evita respostas simultâneas conflitantes pelo mesmo número oficial. Mudanças de setor e responsável têm autor, horário e resultado persistidos.
5. O componente de conversa recebe o contexto do módulo e chama ações autorizadas para esse contexto. A rota geral atual não deve ser liberada para Peças apenas ampliando o mapa de papéis.
6. Todo envio continua no serviço compartilhado de mensagens, com consentimento, opt-out, janela, templates e registro de falhas. Notas internas não viram mensagens ao cliente.
7. Promoções e eventos ficam acessíveis no contexto do setor e usam as mesmas regras de envio já existentes. Métricas distinguem carteira pessoal, setor e visão administrativa.

## Sequência de implementação

| Etapa | Entrega | Responsável atual |
|---|---|---|
| A1 | Contrato e controles de acesso por conversa, vínculo, setor, unidade e posse; testes de acesso direto e concorrência | Codex |
| A2 | Atendimento integrado em Peças e Vendas reutilizando a interface existente; adaptar Oficina com o mesmo contrato | Codex |
| A3 | Relacionamento, próximas ações e carteira contextualizados em cada setor | Codex, com revisão do Claude quando retomar |
| A4 | Métricas pessoais, do setor e consolidadas, usando as mesmas regras de acesso | Codex, com revisão do Claude quando retomar |

Codex assume a continuidade temporária a pedido do Simão enquanto Claude esgota sua sessão. Preservar entregas e referências do Claude, registrar decisões no chat e fazer revisão independente das alterações de acesso. Pendências anteriores continuam nos apontamentos.

## Aceite

- Um vendedor acompanha seus leads, conversa e métricas sem sair de Vendas; Peças faz o mesmo no seu módulo.
- Um usuário de outra unidade ou setor não obtém mensagens nem executa ações passando um ID conhecido diretamente.
- Troca de responsável ou unidade entre leitura e gravação não concede acesso indevido nem causa envio por um responsável antigo.
- Falha da fila ou da gravação não é apresentada ao cliente como encaminhamento concluído. Reprocessar a mesma mensagem não duplica cotação, encaminhamento ou aviso.
- Gerente compara as carteiras do seu setor; administrador consulta o conjunto dos setores. As contagens e taxas conferem com os registros autorizados.
- Migrações e integração são verificadas no desenvolvimento. Produção e operações destrutivas continuam exigindo autorização específica.
