# A1 — Plano de acesso aos atendimentos por módulo

Status: A1 em andamento. A fatia A1.1a tem código local isolado, descrito abaixo.
As demais fatias continuam propostas; não houve integração de UI, teste de login, E2E
nem aplicação de migrations em dev/produção.

Levantamento inicial: branch `codex/atendimento-modulos`, base `f6370a1`.
Nenhum acesso a Auth/banco remoto é necessário para preparar e testar o contrato localmente.

## A1.1a — Contexto e posse de registros atribuídos

Implementação local na branch `codex/atendimento-modulos`, após `6f87052`:

- Migration `20261111140755_atendimentos_modulares.sql`, dependente de 0001, 0002, 0003 e 0005.
- `atendimentos_modulares` mantém um vínculo tipado e único por oportunidade ou cotação, com
  cliente, conversa física e unidade derivados do negócio. `atendimento_canais` reserva um
  único atendimento modular por conversa, com FK composta que impede cruzar os canais.
- `contexto_atendimento_modular` revalida usuário ativo, papel/setor, unidade ativa, unidade
  principal/adicional e responsável atual. Admin tem alcance global em unidades ativas.
  A carteira do cliente não concede acesso a uma oportunidade de outro vendedor.
- A abertura só aceita negócios **abertos e já atribuídos**. Vendas exige oportunidade não
  encerrada e funil ativo; Peças segue seus status abertos, inclusive uma cotação aprovada
  cuja venda já foi confirmada. Sem responsável, é preciso atribuir pelo domínio existente
  antes de abrir o atendimento; não há atalho de fila que exponha o histórico do cliente.
- A conversa é derivada do cliente. Sua unidade física não substitui a unidade do negócio.
  A RPC recusa um vínculo existente se cliente, conversa ou unidade do negócio mudaram,
  preservando o registro original. Não faz rebind automático.
- `abrir_atendimento_modular` reutiliza o mesmo ID sem repetir auditoria. `assumir_atendimento_modular`
  exige versão exata, conversa humana e posse legada vazia. Dois atendimentos modulares
  não reservam o mesmo canal. Replay do ator com a **versão corrente** mantém a versão;
  versão antiga retorna conflito, mesmo se tiver sido a tentativa anterior do mesmo ator.
- A posse guarda o dono do negócio na ocasião. Após transferir o negócio, o responsável
  antigo perde acesso; o novo pode substituir essa posse obsoleta no mesmo atendimento,
  mediante versão corrente. Isso ainda não implementa a transferência completa da A1.3.
- As RPCs mantêm locks nas linhas usadas de ator, domínio, unidade, autorização adicional
  e cliente. A ordem de escrita modular é canal e depois atendimento. Slot, posse,
  incremento de versão e auditoria ficam na mesma transação; falha deve desfazer tudo.
- RLS fechado, `SECURITY INVOKER`, `search_path` vazio e grants explícitos. Só o servidor
  pode executar. Os wrappers em `src/modulos/atendimento/acesso.ts` recebem o usuário já
  autenticado e enviam sua identidade, referências e versão; não aceitam cliente, unidade,
  conversa ou posse do navegador como autoridade. Nenhuma rota pública foi adicionada.

Contratos de retorno: sucesso contém `ok`, `id`, `versao`, `setor` e `registroId`.
Ausência ou registro fora do escopo usa `nao_encontrado`; conflito usa `conflito`, sem nome,
e-mail ou posse de terceiros. O wrapper normaliza entrada inválida, falta de acesso,
ausência, conflito e indisponibilidade em 400/403/404/409/503 e descarta detalhes internos.

Validação local: typecheck, 846 testes Vitest (71 novos dos wrappers) e contratos em
`tests/sql/contratos-atendimentos.sql` passaram. PostgreSQL/PGlite executou as RPCs como
`service_role`, com e sem defaults permissivos, incluindo rollback real da auditoria,
replay, revogações e reaplicação com dados. SQL e wrapper tiveram revisão independente.
Migration revisada: SHA256 `97bb8a1f243e2e8fb0b671fd85eb09cfab3e2afcd54f016fbf2dd93de337fb5d`.

**Ainda pendente:** classificar e associar mensagens, vincular os encaminhamentos do bot,
Oficina/triagem, filas sem dono, leitura/listagem/contadores por módulo, liberação do canal,
encerramento/reabertura, transferências completas, envio e adaptadores legados.
A reserva nova não impede uma API legada de assumir depois, nem libera o envio modular.
Por isso esta fatia permanece sem UI e não prova exclusividade entre todos os fluxos do sistema.
Os testes de concorrência entre sessões e os logins reais continuam necessários antes da integração.

## Problema e limites atuais

- `conversas.cliente_id` é UNIQUE: existe um canal físico por cliente, não uma conversa por setor.
- Inbox/fila atuais consultam contagens e prévias globais; detalhe consulta somente o ID da conversa,
  reúne dados de vários atendimentos do cliente e zera o contador global de mensagens não lidas.
- Actions recebem conversa/cliente sem vínculo de módulo; handoff usa e-mail para posse e
  `supervisiona()` sem provar setor, unidade e vínculo.
- Ter uma oportunidade ou cotação autorizada não permite ler todo o histórico físico do cliente.
- O ledger `encaminhamentos_bot` prova a origem e deduplica o encaminhamento, mas não comprova
  permissão atual, posse ou a quais atendimentos pertencem as mensagens posteriores.
- Rotas antigas também precisam passar pelas guardas: novos wrappers seguros não eliminam o
  bypass pelos endpoints/actions globais existentes.

## Contrato de autorização proposto

Separar o canal físico de um atendimento de negócio com ID próprio. Cada atendimento tem
conversa, cliente, unidade, módulo, vínculo tipado de negócio, estado, responsável humano UUID,
versão e datas. O vínculo aponta para oportunidade de Vendas, cotação de Peças, atendimento ou
agendamento de Oficina, ou encaminhamento de triagem. Preferir FKs reais; adicionar dependências
de Oficina somente quando suas migrations estiverem integradas.

O servidor recebe intenção e ID de registro, resolve o vínculo e deriva cliente/unidade/conversa.
Ator vem da sessão. Papel, setor, usuário ativo, unidade principal/adicional e unidade ativa são
conferidos no banco, inclusive na gravação. Campos enviados pelo navegador não concedem acesso.
O administrador tem alcance global nas unidades ativas; os demais perfis permanecem limitados
às suas unidades e ao setor autorizado. Esse alcance não elimina a prova de vínculo e posse.

| Operação | Prova exigida |
| --- | --- |
| Listar fila | Área/setor e unidade elegíveis; resumo apenas do atendimento autorizado |
| Ler detalhe/histórico | Vínculo exato, unidade e permissão atual de carteira/responsável/supervisão |
| Assumir | Elegibilidade atual, registro disponível e atualização condicional com um vencedor |
| Gravar/enviar | Todas as provas anteriores, posse vigente, estado permitido e versão esperada |
| Transferir | Permissão no registro, destino ativo/elegível, unidade e invalidação da posse anterior |
| Supervisionar | Área, setor e unidade compatíveis; `supervisiona()` isoladamente não autoriza |

Retornos: 401 sem sessão; 403 sem acesso à área; 404 para registro inexistente ou fora do escopo;
409 para conflito de posse/versão. Não expor nome/e-mail de terceiros em erros fora do escopo.

## Carteiras, fila sem dono e transferências

- Em Vendas, o dono da oportunidade é a referência do atendimento. Se não houver dono, mas o
  cliente já tiver carteira, restringir a resolução ao dono dessa carteira/supervisor até atribuição
  explícita. Não liberar histórico do cliente ao setor inteiro apenas por `vendedor_id IS NULL`.
- Uma oportunidade transferida sem mover carteira passa a autorizar o novo vendedor naquele
  atendimento. O vendedor antigo não conserva acesso por um OR com `clientes.vendedor_id`.
- Peças e Oficina usam o responsável do próprio registro; carteira de Vendas não concede acesso.
- Fila elegível pode mostrar o resumo mínimo do pedido. Histórico anterior de outros atendimentos
  não acompanha a condição de "sem dono".
- Trocar setor cria atendimento de destino, com resumo compartilhado explicitamente. Não copia
  automaticamente mensagens do setor anterior.
- A unidade do atendimento deriva do registro. `conversas.unidade` não deve virar um seletor
  mutável que transfere todo o histórico entre lojas/setores.
- Um atendimento por vez controla o envio no canal físico. Outros pedidos podem permanecer
  pendentes, sem ganhar acesso às mensagens do atendimento que está usando o canal.
- Transferências invalidam versões/posses antigas. Toda consulta e escrita volta ao responsável
  atual no banco; autorização não pode depender apenas de uma fotografia de ACL antiga.

## Histórico e dados retornados

Criar associação explícita entre mensagem e atendimento, comprovando que ambos pertencem à
mesma conversa/cliente. A consulta modular retorna somente suas mensagens e dados necessários.

Excluir alertas internos para equipe (`cliente_id` nulo/metadata interno), notas globais e registros
de outros setores/unidades. Prévia, contagem, busca e notificações seguem o mesmo predicado do
detalhe, aplicado antes da paginação. Paginar de modo estável.

Registrar leitura por atendimento/usuário; um GET de Peças não pode zerar os não lidos de Vendas.
Não atribuir automaticamente todo o legado ao dono atual. Histórico sem classificação permanece
preservado, mas fora da leitura modular até existir um vínculo comprovado.

## Fatias e critérios de saída

### A1.1 — Modelo e autorização, sem UI

- Migration isolada para atendimento, vínculos e associação de mensagens; RLS fechado e ACLs
  explícitas de servidor.
- Resolução central de acesso e RPCs de abertura/claim com contexto derivado do banco.
- Encaminhamento novo aponta para o mesmo atendimento em reenvios; ledger continua idempotente.
- Testes SQL locais: vínculo trocado, cliente/unidade divergentes, usuário inativo, unidade extra
  removida, gerente de outro setor e disputa de claim.

Saída: contrato local verificável de usuário/área/setor/unidade/vínculo, sem tela nova liberada.

### A1.2 — Leitura protegida

- Listagem, contadores, prévias e detalhe usam a mesma política de acesso.
- DTO mínimo por módulo e histórico explicitamente associado ao atendimento.
- Leitura individual, sem zerar o contador físico compartilhado.
- Testes com o mesmo cliente em oportunidades de vendedores distintos, Peças e Oficina.

Saída: nenhuma informação fora do vínculo em lista, busca, detalhe, totais ou notificações.

### A1.3 — Posse e transferências

- Claim condicional com um vencedor e replay idempotente do mesmo ator.
- Transferência/reatribuição invalida versões anteriores e reavalia o responsável atual do domínio.
- Reabertura e encerramento não alteram implicitamente outros atendimentos do cliente.
- Testes de duas abas, transferência com sessão antiga e carteira não movida.

Saída: antigo responsável perde autorização para novas consultas/gravações daquele atendimento.

### A1.4 — Gravação e envio

- Notas, tags, retomada, devolução e encerramento recebem atendimento/vínculo.
- Envio usa reserva identificada/versionada e valida novamente no despacho; somente depois chama
  `outbound.ts`, preservando suas regras e registrando atendimento/ator na saída.
- Tratar transferência enquanto há envio reservado/em andamento. Definir o ponto de autorização:
  HTTP já despachado pode terminar; não prometer cancelamento de envio em voo.
- Dedupe por operação; resultado incerto não pode provocar reenvio automático.
- Testes locais com transporte simulado: replay, reserva antiga, troca de responsável e falhas.

Saída: nenhuma mutação autorizada apenas pela checagem prévia da tela.

### A1.5 — Adaptadores legados e interface

- Submeter endpoints/actions antigos à mesma política, sem fallback global por cliente.
- Extrair apresentação de `Conversa`, com adaptadores definidos por módulo e capacidades vindas
  do servidor. Não ampliar simplesmente o papel aceito em `atendimento`.
- Somente então integrar Vendas, Peças e Oficina e executar a matriz de logins em contextos isolados.

Saída: UI reaproveitada sem caminho alternativo que contorne vínculo, unidade ou posse.

## Matriz mínima de aceitação

1. Mesmo cliente, oportunidades de donos diferentes e atendimento em outro setor.
2. Unidade principal, extra, removida, inativa e fora do escopo.
3. Ator inativo, gerente de outro setor, vínculo falso e referência de mensagem divergente.
4. Fila sem dono sem liberar histórico de outra carteira/setor.
5. Dois claims simultâneos, transferência com aba antiga e escrita com versão defasada.
6. Totais, prévias, busca, notificações e histórico sem dados de outro atendimento.
7. Leitura que não altera contadores de outro setor; alertas internos excluídos.
8. Replay de encaminhamento e envio sem duplicação; resultado incerto preservado.
9. Endpoints/actions legados sem bypass e falhas de banco sem confirmação falsa.
10. Nenhuma alteração de dados de outros sistemas ou teste de produção implícito.

Oficina e seu vínculo com Peças foram lidos nas refs `codex/oficina-v002` e
`codex/oficina-pecas-v002`; ainda não estão integrados na base deste levantamento.
