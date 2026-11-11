# QA ampliado e vendedor adicional — 11/11/2026

Pedido do Simão: vários subagentes conferindo todas as telas e mais um vendedor para testar. Rodada
concluída com o coordenador e três subagentes, em contextos separados no servidor local existente.
Inventário: **21 padrões de página do painel**, incluindo Conta, Usuários e detalhe de cotação, além de Login.
Foram testadas navegação, formulários sem submissão, filtros seguros, menus, leituras permitidas e recusas.
Não é certificação de todos os fluxos de gravação ou de isolamento quantitativo sem fixtures comparáveis.

## Vendedor adicional

- Conta criada pelo fluxo **Administração → Usuários → Equipe**, com nome **Vendedor QA 2**, login
  vendedor.qa2.20261111@comauto.demo, papel vendedor, setor vendas e unidade comauto.
- Auth e perfil confirmados em leitura no projeto dev csgrnmoyowjhzlibbilk, com origem plataforma-comauto
  controlada pelo servidor. Criação registrada em 11/11/2026 às 17:32:38 (America/Sao_Paulo).
- A credencial provisória foi preparada exclusivamente para essa conta nova e guardada no arquivo
  ignorado tests/e2e/.env.vendedor-qa2.local. O Codex não redefiniu nem alterou contas antigas.
- O login da nova conta passou. Papel e nome exatos foram comprovados no rodapé/link Minha conta.
  A tela Minhas métricas abriu sem controles de terceiros, comparação por vendedor ou funil global de eventos.
- Um caso de carteira alheia/quantitativo permaneceu sem prova por falta de dados comparáveis autorizados.
  A conta antiga vendedor.teste não foi usada; isso não foi disfarçado como teste dessa conta.

## Resultado por perfil

| Perfil | Resultado da rodada ampliada |
|---|---|
| Administrador | Login e 20 rotas abertas; usuários/equipe e cadastros inspecionados. Leitura aprovada; único cadastro enviado foi a conta adicional expressamente solicitada. |
| Financeiro | Login e 20 URLs conferidas, com leitura das permitidas e negação das demais. Minha conta e Configurações financeiras abriram; Usuários/Segurança/Piloto foram recusados. |
| Gerente Vendas | Telas/formulários e 7 URLs proibidas conferidos. Uma asserção de redirecionamento foi recuperada esperando a navegação, sem falha de permissão. |
| Vendedor QA 2 | 25 verificações passaram, 10 URLs proibidas recusadas; 1 caso quantitativo/carteira alheia sem dados suficientes. |
| Gerente Peças | Telas adicionais e detalhe de cotação existente aprovados, incluindo controle positivo usado no teste do operador. |
| Peças | Telas e negativas aprovadas; cotação do controle gerencial mostrou notFound sem Solicitação e API404 sem mensagens/nome. Positivo próprio ficou pendente: não havia cartão autorizado. |
| Recepção | 25 de 26 verificações passaram; falha visual mobile de Agenda, com causa e correção mínima comprovadas depois. |
| Consultor | 25 de 26 verificações passaram; mesma falha visual mobile, demais rotas/permissões aprovadas. |

Não somar mecanicamente as rodadas antigas/rechecks: há verificações de identidade/segurança repetidas
por necessidade de sessão e casos agrupados em cada roteiro. Os relatórios específicos preservam esses limites.

## Problemas encontrados e encaminhamento

1. **Agenda no celular:** filtros sem quebra de linha ampliavam o documento para 563px em viewport 390px.
   Causa identificada no cabeçalho; a tabela já rolava dentro do wrapper. Regra de wrap até 560px reduziu
   documento/body/main para 390px em experimento em memória, mantendo a rolagem interna da tabela.
   Correção preparada no commit isolado **0fb2a00**, revisão independente e typecheck aprovados; ainda
   requer integração do Claude. Não afirmar que foi aplicada ao servidor.
2. **Busca no perfil Peças:** atalho Atendimento era oferecido, mas a rota recusava o próprio perfil.
   A mesma entrega 0fb2a00 condiciona só o atalho à permissão existente. Consulta, máscaras e política
   do gerente permanecem iguais. Revisão independente aprovada, sem nova liberação de área.
3. **Campanhas:** GET de detalhe chama preChecagem e grava totais/custo; prefetch tentou essa rota ao
   abrir lista. O navegador bloqueou antes de qualquer gravação. Separar cálculo puro e persistência
   em ação autorizada continua com Claude; nenhuma alteração de núcleo foi aplicada pelo QA.
4. **Gerente Peças em Marketing/Inbox:** listas gerais são permitidas pelo mapa atual. Registrado como
   decisão de separação setorial, sem chamar o comportamento contratado de regressão.

## Ambiente, recuperação dos testes e proteção

A interface mudou durante a preparação: login passou a Acesse sua conta/Entrar, equipe mudou para
Usuários e o nome ganhou link Minha conta; o título público posteriormente exibiu ShiftUP · Comauto.
O checkout que serve a aplicação estava em 573bfa2, package 0.0.5, com trabalho do Claude em andamento.
O QA não atribui toda a rodada ao antigo pin 16b873b. Fingerprints/horários dos roteiros estão nos
relatórios individuais. Os falsos negativos de seletores, título pessoal e espera de redirect foram
recuperados somente no caso afetado; as telas já aprovadas não foram repetidas por esses ajustes.

A navegação bloqueou métodos mutantes após login e GETs conhecidos com efeitos (contador de conversa,
exportação, campanha por ver e links rastreados). Busca somente por nome. Sem importação, envios WhatsApp,
claim/devolução, transferências, marcas de leitura, alteração de clientes, fixtures, exportação ou snapshots
com dados pessoais. A exceção administrativa foi somente criar e preparar o acesso da conta nova,
conforme pedido direto do Simão. Nenhum trace/screenshot/storageState foi persistido.

O coordenador recuperou o JSON original de Admin da saída já capturada após o recheck de Atendimento
sobrescrever seu arquivo. O artefato recuperado identifica essa origem; a conferência do Atendimento
usou o campo acessível Pesquisar conversas, sem selecionar conversa individual. Financeiro foi gravado
separadamente. Não foi inferida aprovação de caso sem evidência.

## Evidências e limites

- [Vendas e vendedor novo](QA-VENDAS-TODAS-TELAS.md)
- [Peças e gerente](QA-PECAS-TODAS-TELAS.md)
- [Recepção/Consultor e diagnóstico mobile](QA-OFICINA-RECEPCAO-TODAS-TELAS.md)
- Admin/Financeiro: work/qa-todas-telas, incluindo admin-original-recuperado.json e recheck.
- Roteiro comum atualizado somente para os seletores conhecidos de login/rodapé e Minhas métricas:
  tests/e2e/perfis-readonly.mjs. Check sintático, typecheck e gitleaks passaram.

Não testados: envio/persistência dos formulários, campanhas/disparos, dados estrangeiros com todos os
controles positivos de carteira/unidade, concorrência multissessão ou toda a UI mobile. O detalhe de
campanha não foi aberto porque escreve em GET. A fila própria de Oficina ainda não está publicada;
seu WIP permaneceu preservado. Login de Vendedor QA 2 comprova o perfil novo, não a senha da conta antiga.
