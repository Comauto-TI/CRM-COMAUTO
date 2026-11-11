# MVP de atendimento de Peças — 11/11/2026

Entrega local da etapa 2, limitada ao quadro e à conversa do setor. Reutiliza o quadro comum do Claude
(`06b7cb5be0f43230587b7a24305cb81cf7532a92`) e a apresentação das mensagens já usada na recepção.
A base `claude/quadro-comum` até `21606ae` foi incorporada por merge em `7b5c65d`; os componentes
comuns permanecem iguais aos do Claude. SQL: `c020b63`; primeiro quadro: `e250d9d`; núcleo: `7c44e9c`.
Peças continua como CRM comercial, sem estoque ou faturamento. A1 inteiro permanece parcial.

## Comportamento

- A equipe vê suas cotações e a fila sem responsável; a gestão vê o setor/unidades autorizados;
  administrador vê unidades ativas. A política do banco também protege o acesso direto ao detalhe.
- O cartão mostra cliente, solicitação, valor cotado, responsável e contato comprovado daquele vínculo.
  Não usa a última mensagem global do cliente como contato daquela cotação. Encerradas ficam recolhidas.
- Arrastar usa as transições já existentes: iniciar cotação, registrar apresentação com versões dos itens,
  registrar aprovação, perda ou cancelamento com motivo. Aprovação não confirma uma venda.
  Preparo e entrega antigos permanecem consultáveis; o quadro não cria um fluxo de estoque.
- Assumir o atendimento atribui a cotação quando necessário, reserva o canal físico, incrementa a versão
  e pausa o bot atomicamente. Outra pessoa, canal ocupado ou versão antiga não produz efeitos parciais.
- Assumir exige cotação própria ou fila sem dono, inclusive para gestão. Devolver libera somente a reserva daquele atendimento. A gestão autorizada pode recuperar uma posse
  cujo atendente foi desativado; essa capacidade não permite responder na posse de outra pessoa.
- Encerrar ou reatribuir uma cotação com reserva ativa exige devolver antes. Transferências avançadas
  continuam congeladas até o Simão validar a tela.

## Mensagens e resposta

A mensagem inicial exige o encaminhamento comprovado do bot. Origem que se torne ambígua após assumir
ou reservar bloqueia tanto a reserva como o despacho; a devolução continua permitida. Entradas seguintes são vinculadas no INSERT
ao atendimento de Peças que tinha posse válida naquele instante. A devolução não importa mensagens
recebidas fora da posse nem reclassifica histórico antigo por cliente. Saídas reservadas têm FK composta
para atendimento, conversa e cliente. Mensagens internas e origens ambíguas ficam fora do diálogo.

O GET retorna as últimas 100 mensagens autorizadas em ordem cronológica e não marca leitura ou zera
o contador físico do canal. As RPCs pessoais anteriores permanecem separadas.

Cada tentativa de resposta usa o UUID da própria linha em `mensagens`. A reserva guarda corpo mascarado
e ator; o CAS de despacho revalida a posse/versão e autoriza uma única chamada ao `outbound.ts` existente.
Opt-out, janela de 24h e filtro de segredos continuam obrigatórios. Depois da autorização de despacho,
uma chamada HTTP em voo pode terminar; devolver não promete cancelá-la. Timeout ou persistência incerta
preservam a incerteza e não provocam reenvio automático. A finalização não restaura texto removido por LGPD.

CR-PEC-001: a exclusão das views gerais e do envio humano sem contexto vale enquanto houver negócio
modular aberto ou reserva vigente. Devolver o slot sem encerrar a cotação não devolve o canal à recepção;
encerrar todos os negócios e liberar as reservas permite novo atendimento geral, inclusive retomada
pelas regras existentes. O histórico de mensagens já associado ao módulo continua fora da leitura geral.

Pedido humano durante um atendimento ativo é registrado pela RPC `registrar_pedido_humano_modular`:
notifica o claimant elegível ou responsável do negócio; na falta deles, recepção/gestão elegível da
unidade recebe o aviso na central existente. A notificação e a auditoria são atômicas, sem copiar corpo
de mensagem ou motivo bruto. A reserva/status não são alterados. Ausência de destinatário ou erro
não vira transferência bem-sucedida: ferramentas e handler conferem o resultado e avisam a falha
ao cliente pelo outbound. Uma falha no ACK opcional não desfaz um aviso já confirmado no banco.

## Integração e revisão

1. Revisar primeiro os módulos reaplicáveis `0005_pecas.sql` e `0006_atendimento.sql`, sobre a consolidação
   `2006bf2`. Banco antes do código, conforme CR-A1-001. Não criar migration avulsa com timestamp.
2. Revisar separadamente o diff do núcleo: outbound, handoff e adaptações dos endpoints/actions legados.
   O pedido posterior do Claude foi um recorte pequeno de revisão para essas mudanças.
3. Integrar o quadro e o adaptador de Peças, preservando a implementação comum do Claude. Se esse código
   já estiver na base integrada, manter uma única cópia dos componentes iguais.
4. Claude aplica no dev e rebuilda; Simão valida com a conta de teste de Peças. Não alterar Auth ou migrar
   metadados de outras contas nesta entrega. Sem produção ou operação destrutiva implícita.

## Evidências e limites

CR-PEC-001: regressão final com **1.695 Vitest / 40 arquivos**, typecheck, gitleaks e diff check aprovados.
Contrato `tests/sql/contratos-pecas-retorno-legado.sql` validado nos dois modos de permissões e com
reaplicação populada: abertos/encerrados Peças e Vendas, reserva ainda vigente, mistura de ativos,
retorno à recepção sem histórico setorial, destinatários atuais e falhas reais de notificação/auditoria
com rollback integral. Harness local `work/validar-pecas-retorno-legado.mjs`. O restante da matriz SQL
inalterada não foi repetido. Fonte 0006 revisada: SHA256 `F764326CF1F3EBEF6FD9D39EE5AF9F6A74BB322FE1181FAC4BA6692D9EA90CE5`.

SQL PGlite: MVP, quadro/mover e reaplicação populada passaram com defaults fechados e permissivos.
Os nove contratos anteriores passaram na rodada de regressão; a fixture de reatribuição agora comprova
o bloqueio com posse ativa e usa devolver antes de trocar o responsável. Após incorporar a base do Claude,
**1.628 testes Vitest / 37 arquivos**, typecheck, build com `npm run build -- --webpack` e gitleaks passaram.
O Turbopack padrão não resolve o `node_modules` por symlink deste checkout; a alternativa foi somente
no comando de validação, sem mudar a configuração do produto.
O visual foi conferido offline em 1600 e 390 pixels com CSS/componentes reais e dados fictícios,
sem Auth, banco ou envio. As capturas ficam em `work/qa-pecas-ui` no workspace do Codex.

Claude aprovou CR-PEC-001 e registrou a integração/recompilação no dev em `9adcfd4`; o runtime é idêntico
a `dc8247e`. O Codex confirmou HTTP 200 no login local e presença dos dez contratos de Peças no OpenAPI
do projeto `csgrnmoyowjhzlibbilk`, por consulta somente de leitura. Ainda não comprovados: execução do fluxo
por login, E2E com as contas e concorrência multissessão em PostgreSQL. Não tratar disponibilidade do schema,
fixtures, SSR ou PGlite como essas validações. As leituras do detalhe
usam RPC SETOF com relacionamentos do PostgREST; a atualização do schema cache e esse contrato HTTP devem
ser conferidos na integração. O quadro retorna o conjunto autorizado completo; carga/volume do dev ainda
precisam ser medidos antes de ampliar o piloto.

O conector GitHub desta sessão oferece leitura, sem push; o `gh` não está disponível no shell. A branch
e os commits são disponibilizados no clone local compartilhado para o Claude publicar/revisar o PR.
Não declarar um PR remoto criado ou merge/tag que ainda não aconteceu. Versão mantida em 0.0.3/Não lançado.

O formatador comum apresenta valor ausente como zero; o adaptador indica “Valor a cotar” para distinguir
solicitações ainda sem itens. Ajuste do formatador comum deve ser alinhado com o Claude.
