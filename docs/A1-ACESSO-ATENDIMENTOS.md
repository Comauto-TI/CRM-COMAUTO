# A1 — Plano de acesso aos atendimentos por módulo

Status: proposta técnica por fatias. Não representa runtime implementado, integração de UI,
teste de login, E2E executado nem aplicação de migrations em dev/produção.

Levantamento inicial: branch `codex/atendimento-modulos`, base `f6370a1`.
Nenhum acesso a Auth/banco remoto é necessário para preparar e testar o contrato localmente.

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
