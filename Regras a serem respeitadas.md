# Regras a serem respeitadas — Agente de IA para agendamento e eventos no WhatsApp

Este documento serve como **instrução obrigatória** para qualquer agente de IA, desenvolvedor ou ferramenta de automação que participe da construção do sistema.

O objetivo é criar um agente que faça **agendamentos**, envie **confirmações e lembretes** e realize **disparos para eventos** pelo WhatsApp de forma segura, autorizada e dentro das regras da Meta e da LGPD.

## 1. Regra principal

O agente só pode enviar mensagens iniciadas pela empresa quando a pessoa tiver dado **consentimento prévio e comprovado** para receber mensagens no WhatsApp.

Nunca envie mensagens para contatos comprados, raspados, importados sem permissão ou obtidos de listas de terceiros.

Toda mensagem enviada por iniciativa da empresa deve usar um **modelo de mensagem (template) aprovado pela Meta**.

## 2. Regras obrigatórias de consentimento

Antes de enviar qualquer mensagem, o sistema deve verificar se existe consentimento válido.

O consentimento precisa informar claramente:

- O nome da empresa que enviará as mensagens.
- Que as mensagens serão enviadas pelo WhatsApp.
- Quais tipos de mensagens a pessoa receberá.
- Como cancelar o recebimento das mensagens.
- Que os dados serão usados para agendamento, avisos ou divulgação de eventos, conforme o caso.

Exemplo de texto de consentimento:

> “Autorizo a [Nome da Empresa] a me contatar pelo WhatsApp para confirmações, lembretes e informações sobre eventos dos quais eu me inscrevi. Posso cancelar a qualquer momento enviando SAIR.”

### Separação de consentimentos

O agente deve separar pelo menos três tipos de permissão:

| Tipo de mensagem | Consentimento necessário |
|---|---|
| Confirmação de agendamento | Consentimento para comunicações de serviço |
| Lembrete de compromisso | Consentimento para comunicações de serviço |
| Alteração ou cancelamento de agendamento | Consentimento para comunicações de serviço |
| Convite para evento | Consentimento específico para eventos |
| Divulgação, promoção ou campanha | Consentimento específico para marketing |

Nunca use um consentimento de agendamento para enviar publicidade sem autorização específica.

## 3. Regras de opt-out

O agente deve reconhecer pedidos de descadastro em português, incluindo, no mínimo:

- “SAIR”
- “CANCELAR”
- “NÃO QUERO RECEBER”
- “REMOVER MEU NÚMERO”
- “PARAR”

Ao identificar um pedido de descadastro, o agente deve:

1. Interromper imediatamente novos disparos para aquele número.
2. Registrar a data, o horário e a origem do pedido.
3. Impedir envios futuros de mensagens de marketing.
4. Manter apenas os dados mínimos necessários para comprovar o descadastro, conforme a política de privacidade.

O descadastro deve ser respeitado mesmo se a pessoa ainda tiver um agendamento ativo. Nesse caso, envie uma confirmação final apenas se for necessário e permitido, sem continuar campanhas promocionais.

## 4. Regras de templates da Meta

Todo envio iniciado pela empresa deve usar um template aprovado pela Meta.

### Categorias de template

| Categoria | Quando usar | Exemplo |
|---|---|---|
| Utility | Confirmações, lembretes, alterações e cancelamentos | “Sua consulta foi confirmada para dia e hora.” |
| Marketing | Convites, divulgação e campanhas de eventos | “Você está convidado para o evento X.” |
| Authentication | Códigos de verificação e confirmação de identidade | “Seu código é 123456.” |

### Regras de criação de template

- Não prometa nada falso ou enganoso.
- Não use linguagem enganosa, ameaçadora ou sensacionalista.
- Não envie conteúdo irrelevante para a pessoa.
- Não use o mesmo template para finalidades diferentes.
- Use variáveis apenas para informações reais, como nome, data, horário, local e link.
- Não envie links suspeitos, encurtadores desconhecidos ou arquivos não solicitados.
- Teste o template antes de usar em grande escala.
- Mantenha uma versão clara de confirmação, lembrete, alteração, cancelamento e convite.

## 5. Regras da janela de 24 horas

A janela de atendimento de 24 horas funciona assim:

- Quando o cliente envia uma mensagem, a empresa pode responder livremente por até 24 horas.
- Cada nova mensagem do cliente reinicia a janela de 24 horas.
- Após esse prazo, a empresa não pode enviar mensagem livre; deve usar um template aprovado.
- O agente deve consultar o horário da última mensagem do cliente antes de decidir se usará resposta livre ou template.

O agente nunca deve tentar contornar a janela de 24 horas nem usar recursos não oficiais do WhatsApp.

## 6. Regras de agendamento

O agente deve seguir este fluxo:

1. Identificar a intenção do cliente.
2. Solicitar apenas os dados necessários.
3. Consultar horários disponíveis na agenda.
4. Confirmar data, horário, serviço e dados do cliente.
5. Verificar disponibilidade antes de confirmar.
6. Registrar o agendamento no banco de dados.
7. Enviar confirmação.
8. Agendar lembretes automáticos.
9. Permitir reagendamento e cancelamento.
10. Registrar toda alteração no histórico.

### Dados mínimos do agendamento

O banco de dados deve guardar, no mínimo:

- Nome do cliente.
- Telefone com DDI e DDD.
- Serviço ou evento.
- Data e horário.
- Duração estimada.
- Profissional, sala, unidade ou local, se aplicável.
- Status: pendente, confirmado, compareceu, cancelado ou não compareceu.
- Consentimento para comunicações.
- Origem do contato.
- Histórico de mensagens enviadas.
- Data e hora do último contato recebido do cliente.
- Motivo de cancelamento, se informado.

### Regras de conflito

O agente nunca deve confirmar dois agendamentos no mesmo horário para o mesmo recurso.

Antes de confirmar, ele deve verificar:

- Disponibilidade do profissional.
- Disponibilidade da sala, mesa, equipamento ou local.
- Horário de funcionamento.
- Intervalos entre atendimentos.
- Feriados e bloqueios na agenda.
- Limite de vagas do evento.

## 7. Regras para eventos em massa

Disparos para eventos são permitidos apenas para pessoas que autorizaram receber comunicações sobre eventos.

### Antes do disparo

- Validar se o número está ativo e formatado corretamente.
- Remover duplicidades da lista.
- Remover números que pediram descadastro.
- Remover números sem consentimento para eventos.
- Separar a base por interesse, cidade, evento ou público.
- Criar template específico para o evento.
- Fazer teste com um grupo pequeno antes do disparo completo.
- Definir limite diário compatível com o nível atual da conta.

### Durante o disparo

- Enviar em lotes controlados.
- Registrar cada envio, entrega, leitura, resposta, falha e bloqueio.
- Não repetir envio para quem já recebeu a mesma mensagem.
- Pausar o disparo se houver aumento anormal de falhas, bloqueios ou reclamações.
- Respeitar limites de mensagens por segundo e limites de contatos únicos por 24 horas.

### Depois do disparo

- Analisar taxa de entrega.
- Analisar respostas e confirmações.
- Identificar descadastros.
- Identificar números inválidos.
- Atualizar o status de cada contato.
- Não reenviar automaticamente para quem não respondeu sem uma nova autorização ou justificativa legítima.

## 8. Limites de envio

O agente deve consultar e respeitar o limite atual do portfólio empresarial antes de qualquer campanha.

Regras práticas:

- Nunca iniciar uma conta nova com disparos para milhares de pessoas.
- Começar com volumes baixos e aumentar gradualmente.
- Não usar 100% do limite diário sem necessidade.
- Distribuir os envios ao longo do dia.
- Não enviar mensagens em horários inadequados.
- Acompanhar qualidade, bloqueios e respostas antes de aumentar o volume.
- Não compartilhar o mesmo número entre várias empresas sem controle adequado.

## 9. Regras de atendimento humano

O agente deve sempre oferecer uma forma de falar com uma pessoa humana.

O agente deve transferir para atendimento humano quando:

- O cliente pedir para falar com atendente.
- O agente não entender a solicitação após tentativas razoáveis.
- Houver reclamação, conflito, emergência ou situação sensível.
- Houver dúvida sobre pagamento, reembolso, saúde, segurança ou dados pessoais.
- O cliente pedir exclusão de dados ou exercer direitos previstos na LGPD.

O agente nunca deve fingir ser uma pessoa humana.

## 10. Regras de segurança e privacidade

O agente deve proteger dados pessoais e conversas.

Regras obrigatórias:

- Não expor telefones, e-mails, documentos ou dados de clientes em mensagens públicas.
- Não enviar dados sensíveis sem necessidade.
- Não armazenar senhas, códigos de acesso ou dados de cartão em texto aberto.
- Restringir acesso ao banco de dados apenas a pessoas autorizadas.
- Registrar quem criou, alterou ou excluiu informações.
- Criar backup periódico dos dados.
- Usar conexão segura, como HTTPS.
- Não compartilhar tokens, chaves de API ou credenciais da Meta.
- Não usar dados dos clientes para treinar modelos de IA sem base legal e autorização adequada.

## 11. Regras da LGPD

Como o sistema será usado no Brasil, o agente deve respeitar a LGPD.

O sistema deve permitir:

- Informar quais dados são coletados.
- Informar a finalidade do uso dos dados.
- Obter consentimento quando necessário.
- Permitir acesso aos dados pessoais.
- Permitir correção de dados incorretos.
- Permitir exclusão ou anonimização quando aplicável.
- Registrar consentimentos e revogações.
- Garantir segurança dos dados.
- Responder a pedidos de titulares dentro de prazo razoável.

## 12. Regras de qualidade e anti-spam

O agente deve evitar comportamento de spam.

Nunca fazer:

- Envio em massa sem segmentação.
- Envio repetido para quem não respondeu.
- Envio para números comprados.
- Uso de mensagens genéricas sem relação com o cliente.
- Promessas falsas de sorteio, prêmio, desconto ou urgência.
- Uso de links enganosos.
- Envio fora do horário comercial sem justificativa.
- Uso de um número pessoal comum para operação comercial em massa.

Sempre fazer:

- Enviar apenas para bases próprias e consentidas.
- Personalizar mensagens com informações verdadeiras.
- Oferecer valor real na mensagem.
- Facilitar o cancelamento.
- Monitorar qualidade da conta.
- Corrigir templates reprovados antes de reenviar.

## 13. Mapa mental do sistema

```text
AGENTE DE IA PARA WHATSAPP
│
├── CONSENTIMENTO
│   ├── Opt-in de serviço
│   ├── Opt-in de eventos
│   ├── Opt-in de marketing
│   └── Opt-out imediato
│
├── AGENDAMENTO
│   ├── Identificar intenção
│   ├── Mostrar horários
│   ├── Confirmar dados
│   ├── Verificar disponibilidade
│   ├── Registrar no banco
│   ├── Enviar confirmação
│   └── Agendar lembretes
│
├── EVENTOS
│   ├── Cadastro do evento
│   ├── Segmentação do público
│   ├── Template aprovado
│   ├── Envio em lotes
│   ├── Confirmação de presença
│   └── Avisos de alteração
│
├── WHATSAPP OFICIAL
│   ├── Cloud API
│   ├── Templates aprovados
│   ├── Janela de 24 horas
│   ├── Limites de envio
│   └── Qualidade da conta
│
├── IA
│   ├── Entender mensagem
│   ├── Responder com clareza
│   ├── Não inventar informações
│   ├── Transferir para humano
│   └── Registrar histórico
│
└── CONFORMIDADE
    ├── LGPD
    ├── Consentimento
    ├── Segurança
    ├── Auditoria
    └── Anti-spam
```

## 14. Checklist antes de colocar no ar

### Conta e acesso

- [ ] Criar ou usar uma conta Meta Business válida.
- [ ] Verificar a empresa no Meta Business Manager.
- [ ] Criar um portfólio empresarial.
- [ ] Cadastrar um número WhatsApp Business dedicado.
- [ ] Conectar o número ao WhatsApp Business Platform ou a um fornecedor oficial.
- [ ] Configurar permissões de acesso apenas para pessoas autorizadas.
- [ ] Guardar chaves de API em local seguro, nunca no código exposto.

### Consentimento

- [ ] Criar formulário ou fluxo de opt-in.
- [ ] Informar o nome da empresa.
- [ ] Informar que o canal é o WhatsApp.
- [ ] Separar consentimento de serviço, eventos e marketing.
- [ ] Registrar data, hora, origem e texto do consentimento.
- [ ] Criar fluxo de opt-out.
- [ ] Criar lista de bloqueio permanente.
- [ ] Testar o pedido de descadastro.

### Templates

- [ ] Criar template de confirmação de agendamento.
- [ ] Criar template de lembrete 24 horas antes.
- [ ] Criar template de lembrete próximo ao horário.
- [ ] Criar template de alteração de horário.
- [ ] Criar template de cancelamento.
- [ ] Criar template de convite para evento.
- [ ] Criar template de alteração de evento.
- [ ] Criar template de confirmação de presença.
- [ ] Enviar templates para aprovação da Meta.
- [ ] Testar templates com variáveis reais.

### Agendamento

- [ ] Criar banco de dados de clientes.
- [ ] Criar banco de dados de agenda.
- [ ] Criar banco de dados de eventos.
- [ ] Criar controle de horários disponíveis.
- [ ] Criar controle de conflitos.
- [ ] Criar fluxo de confirmação.
- [ ] Criar fluxo de reagendamento.
- [ ] Criar fluxo de cancelamento.
- [ ] Criar histórico de mensagens.
- [ ] Criar lembretes automáticos.

### Eventos

- [ ] Criar cadastro do evento.
- [ ] Criar limite de vagas.
- [ ] Criar lista de inscritos.
- [ ] Criar segmentação do público.
- [ ] Criar controle de consentimento para eventos.
- [ ] Criar envio em lotes.
- [ ] Criar controle de duplicidade.
- [ ] Criar controle de opt-out.
- [ ] Criar relatório de entrega e resposta.
- [ ] Criar plano de contingência para falhas.

### IA e atendimento

- [ ] Definir os assuntos que o agente pode responder.
- [ ] Definir os assuntos que exigem atendente humano.
- [ ] Criar respostas claras e curtas.
- [ ] Impedir que o agente invente horários, preços ou regras.
- [ ] Criar base de conhecimento oficial da empresa.
- [ ] Criar opção de transferência para humano.
- [ ] Registrar todas as conversas.
- [ ] Criar regras para mensagens ambíguas.
- [ ] Criar regras para pedidos de exclusão de dados.

### Segurança e conformidade

- [ ] Criar política de privacidade.
- [ ] Criar política de retenção de dados.
- [ ] Criar controle de acesso por função.
- [ ] Criar logs de alterações.
- [ ] Criar backup dos dados.
- [ ] Criar monitoramento de bloqueios.
- [ ] Criar monitoramento de reclamações.
- [ ] Criar monitoramento de qualidade da conta.
- [ ] Criar teste de segurança antes do lançamento.

## 15. Etapas para construir o agente

### Etapa 1 — Definir o objetivo

Defina exatamente o que o agente deve fazer.

Exemplo:

> “O agente deve agendar consultas, confirmar presença, enviar lembretes e avisar clientes sobre eventos.”

Não comece programando antes de definir:

- Quais serviços serão agendados.
- Quais eventos serão divulgados.
- Quem será o público.
- Quais mensagens serão enviadas.
- Quem poderá alterar a agenda.
- Quais horários serão permitidos.
- O que acontece quando não há vaga.

### Etapa 2 — Mapear os fluxos

Crie um fluxo para cada situação.

Fluxos mínimos:

- Primeiro contato.
- Agendamento.
- Confirmação de agendamento.
- Reagendamento.
- Cancelamento.
- Lembrete.
- Convite para evento.
- Confirmação de presença.
- Alteração de evento.
- Pedido de descadastro.
- Fala com atendente.

### Etapa 3 — Criar a base de consentimento

Antes de qualquer disparo, crie o mecanismo de opt-in.

O consentimento deve ser registrado com:

- Nome da pessoa.
- Telefone.
- Data e hora.
- Origem do consentimento.
- Texto exibido no momento do aceite.
- Tipo de comunicação autorizada.
- Status atual do consentimento.

### Etapa 4 — Criar a estrutura de dados

Crie tabelas ou coleções para:

- Clientes.
- Consentimentos.
- Agendamentos.
- Eventos.
- Inscrições em eventos.
- Templates.
- Mensagens enviadas.
- Respostas recebidas.
- Descadastros.
- Usuários administradores.
- Logs de auditoria.

### Etapa 5 — Conectar o WhatsApp oficial

Use o WhatsApp Business Platform, Cloud API ou uma plataforma parceira oficial.

Nunca use ferramentas não oficiais de automação, número modificado ou disparo em massa fora da API.

### Etapa 6 — Criar e aprovar templates

Crie os templates antes de colocar o agente no ar.

Comece com:

- Confirmação de agendamento.
- Lembrete de agendamento.
- Cancelamento.
- Convite para evento.
- Alteração de evento.
- Confirmação de presença.

### Etapa 7 — Construir o agente de IA

O agente deve seguir regras rígidas:

- Não inventar horários.
- Não inventar disponibilidade.
- Não confirmar agendamento sem verificar a agenda.
- Não enviar mensagem sem consentimento.
- Não prometer descontos ou condições não cadastradas.
- Não responder assuntos fora do escopo.
- Transferir para humano quando necessário.

### Etapa 8 — Criar testes

Antes de usar com clientes reais, teste:

- Agendamento correto.
- Agendamento em horário ocupado.
- Cancelamento.
- Reagendamento.
- Lembrete.
- Template com variáveis.
- Descadastro.
- Mensagem fora do horário comercial.
- Cliente que pede atendente.
- Evento com vagas esgotadas.
- Envio para número inválido.

### Etapa 9 — Fazer lançamento controlado

Comece com uma base pequena e autorizada.

Sugestão:

1. Teste interno com a equipe.
2. Teste com 10 a 50 clientes voluntários.
3. Acompanhe respostas, falhas e bloqueios.
4. Corrija problemas.
5. Aumente gradualmente para 100, 250 e depois volumes maiores.
6. Só aumente o volume se a qualidade e as entregas estiverem boas.

### Etapa 10 — Monitorar e melhorar

Acompanhe semanalmente:

- Mensagens entregues.
- Mensagens lidas.
- Respostas recebidas.
- Agendamentos concluídos.
- Cancelamentos.
- Bloqueios.
- Reclamações.
- Descadastros.
- Falhas de template.
- Uso do limite diário.
- Qualidade da conta.

## 16. Regras de decisão para o agente

O agente deve seguir estas decisões:

| Situação | Ação obrigatória |
|---|---|
| Cliente pede agendamento | Mostrar horários disponíveis reais |
| Horário já ocupado | Oferecer apenas horários livres |
| Cliente confirma | Registrar agendamento e enviar confirmação |
| Cliente pede cancelamento | Cancelar e registrar motivo, se informado |
| Cliente pede reagendamento | Consultar nova disponibilidade antes de confirmar |
| Cliente pede atendente | Transferir para humano |
| Cliente pede para não receber mensagens | Registrar opt-out imediatamente |
| Não há consentimento | Não enviar mensagem iniciada pela empresa |
| Template não aprovado | Não enviar |
| Limite diário atingido | Pausar disparo e agendar para o próximo período permitido |
| Evento esgotado | Informar esgotamento e oferecer lista de espera, se existir |
| Dado sensível é solicitado | Não solicitar ou expor dados desnecessários |
| Dúvida fora do escopo | Transferir para humano ou responder que não possui essa informação |

## 17. Frases prontas para o agente

### Primeiro contato

> Olá! Sou o assistente virtual da [Nome da Empresa]. Posso ajudar você a agendar um horário, confirmar presença em um evento ou tirar dúvidas sobre nossos serviços.

### Mostrar horários

> Encontrei estes horários disponíveis para [serviço]:  
> - [Opção 1]  
> - [Opção 2]  
> - [Opção 3]  
> Qual você prefere?

### Confirmar agendamento

> Perfeito! Seu agendamento para [serviço] está confirmado para [dia], às [horário].  
> Local: [local].  
> Se precisar alterar ou cancelar, responda aqui.

### Lembrete

> Olá, [nome]! Este é um lembrete do seu [serviço] agendado para amanhã, às [horário], no [local].  
> Se precisar alterar ou cancelar, responda aqui.

### Convite para evento

> Olá, [nome]! Você está convidado para [nome do evento].  
> Data: [data]  
> Horário: [horário]  
> Local: [local]  
> Toque abaixo para confirmar presença.

### Evento esgotado

> Obrigado pelo interesse no [nome do evento]. As vagas disponíveis já foram preenchidas.  
> Se desejar, posso cadastrar você na lista de espera para próximas edições.

### Descadastro

> Entendido. Registramos seu pedido para não receber mais mensagens pelo WhatsApp. Seu número foi removido das próximas comunicações.

### Transferência para humano

> Entendi. Vou encaminhar seu atendimento para uma pessoa da nossa equipe. Em instantes alguém entrará em contato com você.

## 18. Regra final para os agentes de IA

Todo agente que construir este sistema deve seguir estas instruções:

1. Nunca enviar mensagens sem consentimento válido.
2. Nunca usar ferramenta não oficial do WhatsApp.
3. Nunca enviar template não aprovado.
4. Nunca inventar horários, preços, regras, locais ou disponibilidade.
5. Nunca confirmar agendamento sem verificar a agenda.
6. Nunca enviar marketing para quem autorizou apenas comunicação de serviço.
7. Nunca ignorar pedido de descadastro.
8. Nunca expor dados pessoais desnecessários.
9. Nunca fingir ser humano.
10. Sempre registrar consentimento, agendamento, envio, resposta, cancelamento e opt-out.
11. Sempre oferecer opção de atendimento humano.
12. Sempre respeitar limites da Meta e regras da LGPD.
