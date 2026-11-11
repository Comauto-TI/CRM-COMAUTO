# Revisão formal dos PRs #4 e #5 — 11/11/2026

**Decisão: não aprovar as duas HEADs isoladamente no estado revisado.**
Revisão dos diffs completos, contexto e SQL, com reproduções sobre fontes extraídas por `git show`.
As correções posteriores do Codex foram conferidas separadamente, sem usá-las para aprovar uma HEAD antiga.
Nenhum merge, comentário remoto, alteração de Auth ou envio real foi realizado nesta revisão.

## PR #4 — piloto

[PR #4](https://github.com/Comauto-TI/CRM-COMAUTO/pull/4): base
`0478833f4c878331875220f57e2f9e7624a460a0`, HEAD `96bd0908d8e4d090b9f90521b3dda22e886a6d5f`.
40 arquivos, 2.652 adições e 51 remoções. **Não aprovado isoladamente.**

1. **P1 — reset de conta externa aceita marca editável.**
   [equipe.ts:100](https://github.com/Comauto-TI/CRM-COMAUTO/blob/96bd0908d8e4d090b9f90521b3dda22e886a6d5f/src/lib/equipe.ts#L100).
   `user_metadata.origem` decide se o administrador pode redefinir a senha de um login do Auth compartilhado.
   A reprodução usou uma conta vinculada, sem marca confiável em `app_metadata`, com a marca editável forjada;
   `updateUserById(password)` foi chamado. O fluxo exige administrador: o problema é permitir que essa ação
   administrativa altere a senha de uma conta externa com uma prova que o titular pode modificar.
   A própria [documentação do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
   distingue metadados editáveis de dados de autorização controlados pelo servidor. Correção posterior:
   `f6370a1`, fora da HEAD deste PR.

2. **P1 — aniversários de gerente atravessam unidades.**
   [aniversarios-dados.ts:19](https://github.com/Comauto-TI/CRM-COMAUTO/blob/96bd0908d8e4d090b9f90521b3dda22e886a6d5f/src/modulos/vendas/aniversarios-dados.ts#L19).
   A consulta retira o filtro de carteira para gerente sem incluir unidade. Um gerente apenas da Comauto
   recebeu nome, aniversário e idade de cliente da Motomecânica na reprodução. A guarda de escrita nas
   linhas 64–66 repete a ausência. Aplicar a política de unidades na seleção e na gravação; correção posterior
   em `67983b5`, ausente desta HEAD.

3. **P1 — bot anuncia encaminhamento de Peças sem persistência.**
   [leads.ts:99](https://github.com/Comauto-TI/CRM-COMAUTO/blob/96bd0908d8e4d090b9f90521b3dda22e886a6d5f/src/modulos/vendas/leads.ts#L99).
   Cotação recusada, erro na nota e zero avisos persistidos ainda produziram `{ok:true,destino:"pecas"}`.
   A ferramenta anuncia retorno da equipe para um pedido que não entrou na fila. É o F2-P-001;
   correção posterior em `2d8292f`, não incluída na HEAD revisada.

4. **P2 — contato de aniversário confirma gravações que falharam.**
   [aniversarios-dados.ts:76](https://github.com/Comauto-TI/CRM-COMAUTO/blob/96bd0908d8e4d090b9f90521b3dda22e886a6d5f/src/modulos/vendas/aniversarios-dados.ts#L76).
   UPDATE do lembrete, INSERT alternativo e INSERT de nota falharam com `42501`, mas a função retornou
   `{ok:true}`. A UI pode retirar a pendência sem salvar contato. É o F5-004, já tratado em `67983b5`
   pela RPC atômica e confirmação de sucesso; essa correção ainda precisa acompanhar a integração.

5. **P2 — transferência com carteira depende de grants implícitos.**
   [0003_vendas.sql:284](https://github.com/Comauto-TI/CRM-COMAUTO/blob/96bd0908d8e4d090b9f90521b3dda22e886a6d5f/supabase/migrations/0003_vendas.sql#L284).
   A RPC atualiza `clientes.vendedor_id` sem explicitar essa dependência nos grants. Instalação limpa da HEAD,
   `service_role` e defaults fechados reproduziram `42501 permission denied for table clientes` em
   `vendas_transferir(...,p_mover_carteira=true)`. O rollback preservou o responsável, mas a operação padrão
   ficou indisponível. A permissão necessária aparece no consolidado `2006bf2`, posterior à HEAD.

Os quatro commits de correção citados não são ancestrais de `96bd090`. O texto do PR informa que as
continuações entrarão depois; isso não torna esta versão independente pronta para o piloto. Os fixes já
presentes na integração precisam acompanhar a implantação antes de habilitar esses fluxos. Não é necessário
reescrevê-los nem aplicar uma migração indiscriminada de contas externas.

## PR #5 — telas por setor

[PR #5](https://github.com/Comauto-TI/CRM-COMAUTO/pull/5): base
`96bd0908d8e4d090b9f90521b3dda22e886a6d5f`, HEAD `92a0556b3cded6f556559ae22ab0465b3068b450`.
31 arquivos, 1.565 adições e 236 remoções. **Não aprovado até corrigir os itens abaixo.**

1. **P2 — importação sobrescreve edição concorrente.**
   [dados.ts:135](https://github.com/Comauto-TI/CRM-COMAUTO/blob/92a0556b3cded6f556559ae22ab0465b3068b450/src/modulos/importacao/dados.ts#L135).
   O patch nasce do SELECT, mas o UPDATE só protege anonimização e vendedor. Uma correção de e-mail feita
   entre leitura e gravação foi substituída pelo CSV; uma chave acrescentada em `ids_externos` no intervalo
   também foi apagada. Completar cada campo vazio e acrescentar a chave externa precisam preservar o valor
   atual atomicamente, inclusive durante outra edição.

2. **P2 — erro de persistência é contado como linha sem mudança.**
   [dados.ts:138](https://github.com/Comauto-TI/CRM-COMAUTO/blob/92a0556b3cded6f556559ae22ab0465b3068b450/src/modulos/importacao/dados.ts#L138).
   UPDATE com erro produziu `ok:true, completados:0, semMudanca:1, recusados:0`. O resultado anuncia conclusão
   sem informar a falha. Separar erro de gravação de dado realmente inalterado e conservar um resultado
   verificável para a linha recusada.

3. **P2 — nota interna oculta lead sem primeiro contato.**
   [meu-dia.ts:45](https://github.com/Comauto-TI/CRM-COMAUTO/blob/92a0556b3cded6f556559ae22ab0465b3068b450/src/modulos/vendas/meu-dia.ts#L45).
   Qualquer atividade com ator diferente de `assistente` comprova contato. Uma única nota de gerente ou de
   `sistema` retirou do Meu Dia um lead de seis horas que nunca foi contatado. Filtrar o tipo de contato
   e a autoria humana; anotações administrativas não concluem esse trabalho.

4. **P2 — lote aceito não cabe na Server Action.**
   [Importador.tsx:52](https://github.com/Comauto-TI/CRM-COMAUTO/blob/92a0556b3cded6f556559ae22ab0465b3068b450/src/app/painel/clientes/importar/Importador.tsx#L52).
   A prévia e a confirmação enviam as 3.000 linhas juntas. Um lote aceito pelas regras produziu
   **1.678.909 bytes com `React.encodeReply`**; o projeto mantém o limite padrão de 1 MiB da Server Action.
   A requisição é recusada antes de alcançar o tratamento da action. Fracionar o envio ou definir um limite
   explícito coerente com o volume suportado, mantendo progresso e repetição verificáveis.

5. **P2 preexistente — histórico truncado afeta também a nova faixa individual.**
   [dados.ts:41](https://github.com/Comauto-TI/CRM-COMAUTO/blob/92a0556b3cded6f556559ae22ab0465b3068b450/src/modulos/metricas/dados.ts#L41).
   F8-002-R1 permanece: histórico sem paginação. Com 300 oportunidades e 1.500 eventos, simulando o teto de
   1.000 registros, a faixa por vendedor mostrou 200/300 (67%) em Negociação e `parcial=false`. O defeito já
   está na base e não foi introduzido por este PR, mas o novo gráfico também depende dessa leitura.
   Paginar os eventos ou sinalizar incompletude antes de publicar a taxa como completa.

Esses arquivos de PR #5 ainda não foram corrigidos na integração `dc8247e`/`9adcfd4`.

## Evidências e continuidade

- PR #4: `C:/Users/LENOVO/Documents/Codex/2026-11-10/cod/work/revisar-pr4-96bd090.mjs`,
  SHA256 `873B1BC253CD9CD081071A8B176510E833189C1110409C9694C3620F873E99B1`.
- PR #5: `C:/Users/LENOVO/Documents/Codex/2026-11-10/cod/work/revisao-pr5-92a0556/reproduzir.mjs`.
  SHA256 `608A9517CEBC946EF34E1EC1EC75D9A601912AEF15B2532AB3BAA8E199BEB091`.
  Reproduções com fontes imutáveis do Git, I/O simulado e serialização local; sem banco remoto ou WhatsApp.
- As respostas de metadados do GitHub foram conferidas com os SHAs acima. A aplicação de Peças no dev é
  um evento separado destas revisões. Não declarar as duas HEADs aprovadas por causa do teste dessa integração.
- Próxima conversa de Vendas preparada em `VENDAS-CONVERSA-CONTRATO.md`; sem abrir transferências avançadas.
