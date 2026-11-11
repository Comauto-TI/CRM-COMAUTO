# Conversa no cartão de Vendas — proposta para o Claude

Pedido registrado no commit de integração `9adcfd43e69250d4b3dad5287cde33d96da8e49b`, em 11/11/2026.
Este documento prepara a implementação autorizada; não declara o contrato aprovado nem uma tela entregue.
As revisões formais dos PRs #4 e #5 vêm primeiro.

## Recorte

Conversa no painel do próprio cartão de Novos/Seminovos, com assumir, devolver ao bot e responder.
Reutilizar o quadro comum, a apresentação WhatsApp e o outbound já existentes. Manter as informações,
atividades, tarefas e vínculos atuais da oportunidade acessíveis no painel. Sem campanhas, templates novos,
transferências avançadas ou histórico global do cliente nesta entrega.

## Contrato proposto

- Vendedor opera a própria oportunidade; gerente/admin opera apenas no setor e nas unidades autorizadas.
  A função do domínio `podeMexer` já admite supervisão; a posse da conversa continua explícita e versionada.
- **Ponto a confirmar com o Claude:** supervisão assume temporariamente a conversa de oportunidade alheia,
  preservando `vendedor_id`, ou precisa reatribuir antes? Peças hoje exige a própria cotação para assumir;
  a supervisão pode devolver uma posse elegível, mas não responde pela posse de outra pessoa.
- Fila sem vendedor exige atribuição atômica pelo domínio antes da abertura do atendimento. Um GET não
  atribui, cria canal nem marca leitura. Sem conversa ainda criada, o DTO precisa permitir assumir sem
  inventar histórico. O cadastro de oportunidade e os filtros existentes devem continuar funcionando.
- Canal físico único por cliente: reserva ativa de Peças/legado/outro atendimento impede segundo claimant.
  Assumir/devolver usa versão atual, ator ativo, unidade/setor e snapshot do responsável na transação.
- Usar a proveniência de `vendas_encaminhamentos_bot` com referência de mensagem/conversa reais;
  `origem_ref` pode ser código de marketing e não identifica uma mensagem. Definir qual encaminhamento
  inicia o atendimento, sem anexar silenciosamente todo o conjunto de ledgers históricos da oportunidade.
- Somente a mensagem inicial comprovada e entradas recebidas durante a posse válida entram no diálogo.
  Mensagens internas, outras oportunidades, outros setores e histórico legado sem vínculo ficam fora.
  Nova origem ambígua bloqueia leitura daquele item e reserva/despacho; devolver permanece possível.
- DTO com identidade da oportunidade/atendimento, versão, nome mínimo, estado, janela e capacidades explícitas.
  As últimas 100 mensagens autorizadas aparecem cronologicamente. Não zerar o contador físico nem mudar
  leituras de outro usuário. Peças mantém sua API e seus contratos existentes.
- Resposta usa a linha reservada em `mensagens`, UUID por tentativa e CAS na autorização do despacho.
  Outbound oficial preserva opt-out, janela de 24h e filtro de segredos. Timeout ou persistência incerta
  não reenvia automaticamente; finalização não restaura corpo removido por LGPD.
- Encerrar, reatribuir ou mover para Ganho/Perdido com posse ativa exige devolver antes. Fechamento de Vendas
  e a mudança de responsável não podem deixar uma autorização antiga reutilizável ou travar outro setor.
  O retorno ao atendimento geral usa o mesmo conceito de ativo aprovado em CR-PEC-001.

## Entregas pequenas

1. Contrato de posse/proveniência e guardas SQL no arquivo de módulo correspondente, com testes isolados.
2. Extrair apenas a apresentação/estado de conversa que Peças e Vendas realmente compartilham, mantendo
   adaptadores próprios de transporte e identidade. Rascunho e tentativa separados por setor/registro.
3. Adaptador/rota/actions de Vendas e montagem no cartão, sem liberar a rota geral por cliente.
4. Revisão do Claude, banco antes do código e teste por login no dev. Não expor a UI antes das guardas.

## Aceite

Mesmo cliente com duas oportunidades e uma cotação não compartilha corpos por carteira/cliente.
Testar dono, colega, supervisão, unidade extra/revogada, usuário inativo, claim concorrente, versão antiga,
devolução, troca de responsável/fechamento e origem ambígua antes/depois da reserva. Transporte simulado
para resposta e repetição; login/E2E e concorrência real recebem evidências próprias, sem confundir com mocks.
