# Revisão funcional do PR #9

Histórico do pin8df62ff. A revalidação posterior de `5941347` está em
[REVALIDACAO-PR9.md](REVALIDACAO-PR9.md): cinco itens corrigidos, ACOMP003 ainda com o cenário R1.

12/11/2026. [PR #9](https://github.com/Comauto-TI/CRM-COMAUTO/pull/9), consultado pelo conector GitHub:
aberto, não mesclado. Base `bc14aa1e90e440ec87e6fc88a275c817041b7f87`; candidato
`8df62ff429bf24406a7f1d552319d43cf32a27a8`. Parecer vale somente para esse par imutável.

**Requer ajustes.** Dois consumidores herdados ficaram sem a política de setor introduzida pelo PR;
o acompanhamento também apresenta dois defeitos funcionais novos. Há dois ajustes baixos adicionais.
As provas abaixo executam fonte original do candidato, com fronteiras em memória e dados fictícios.
Não foram executadas chamadas HTTP, Auth/banco reais, envios ou criação de dados no dev.

## PR9-SETOR-001 · QR por ID ignora o setor do link · média

`src/app/api/painel/links/[id]/qr/route.ts:18–24` confere somente acesso à área `links` e procura o
registro por ID. O novo `src/lib/escopo-setor.ts:8–23`, aplicado à lista e à ação `alternarLink`,
não alcança a rota de QR. Logo, esconder o link na lista não impede a leitura por esse consumidor.

Cenário controlado: gerente de Vendas, permitido em Links, conhece um ID de link de Peças da fixture.
A rota original retorna status 200; com `direto=1`, o destino passado à biblioteca QR contém a
mensagem inicial fictícia de Peças. O próprio link de Vendas também retorna 200, e o helper original
`noEscopo(gerenteVendas, "pecas")` retorna false. Não houve teste ou alegação de adivinhação de IDs.

Impacto demonstrado: a consulta de QR ultrapassa a separação por setor prometida na nova tela.
Não foi demonstrada alteração do link, envio, acesso anônimo ou obtenção de segredo.

Correção proposta ao Claude: aplicar o mesmo recorte de setor na busca do link, antes de usar
nome/código/mensagem para gerar a resposta; preservar o acesso global autorizado de admin/gestão
da administração. Cobrir link próprio, alheio e ID inexistente com os formatos direto e rastreado.

## PR9-SETOR-002 · Métricas de Vendas incluem eventos de outro setor · média

`src/modulos/metricas/dados.ts:108–120` limita `listarEventos` e a busca inicial de
`carregarFunilEvento` somente por unidade. O funil segue agregando inscrições e campanhas pelo ID
desse evento sem aplicar a nova política. `/painel/metricas` usa os dois consumidores para gerente
de Vendas; a seleção por query string também aceita um evento alheio conhecido na mesma unidade.

Cenário controlado: gerente de Vendas em Comauto recebe os eventos fictícios de Vendas **e Peças**
na lista. Ao consultar o evento de Peças, recebe seu nome/funil e contagens chamados=1,
confirmados=1 e recusaram=1. O evento de Vendas funciona como controle positivo.

Impacto demonstrado: estatísticas de outro setor aparecem em Métricas de Vendas apesar do novo
isolamento de marketing. A prova não usou dados de clientes reais nem mostrou histórico de WhatsApp.

Correção proposta ao Claude: aplicar a política comum na lista e na autorização do evento antes de
qualquer agregação. Conferir também campanhas vinculadas ao evento para que uma associação cruzada
não reabra o recorte. Preservar a visão global expressamente autorizada.

## PR9-ACOMP-003 · Desfazer pode restaurar o status errado · média

`src/app/painel/agendamentos/acompanhamento/actions.ts:18,36` escolhe o status de retorno pela
existência de `confirmado_em`, que não representa necessariamente o status anterior à chegada.

Estado alcançável pela ação original da base: um agendamento já confirmado é colocado em `pendente`
por `mudarStatus`; a confirmação antiga não é limpa. Na ação nova, marcar Chegou e depois Desfazer
termina em **confirmado**, embora a própria chegada tenha gravado `de_status=pendente` no histórico.
Os controles pendente sem confirmação antiga e confirmado com confirmação restauram corretamente.

Impacto: Desfazer confirma implicitamente uma solicitação que estava pendente. Corrigir guardando
e restaurando o estado real da transição, com a mesma proteção de concorrência. Não inferir o
estado anterior apenas por um timestamp de confirmação antigo.

## PR9-ACOMP-004 · Falha de leitura aparece como dia sem agendamentos · média

`src/app/painel/agendamentos/acompanhamento/page.tsx:47–48,124,132` descarta o erro da consulta,
converte `data=null` em lista vazia e exibe os indicadores zerados e "Nenhum agendamento neste dia".

Prova controlada: a consulta retorna erro `08006` e nenhum dado; a página original renderiza o dia
vazio sem indicar falha. Isso comunica ausência de clientes quando o dado está indisponível.
Tratar o erro como estado de carregamento falho, com aviso/tentativa, sem apresentar zero como medição.

## Ajustes baixos, sem bloquear isoladamente o PR

- **PR9-BAIXA-005:** `acompanhamento/page.tsx:25,34,38–43` valida a forma textual da data, mas aceita
  `2026-13-01`; `toISOString()` lança `RangeError` antes da consulta. Validar o calendário e devolver
  uma data segura/erro de entrada. Reproduzido no componente original, sem HTTP.
- **PR9-BAIXA-006:** `Abertura.tsx:39,43` registra callback anônimo de `load`; o cleanup remove
  timers, mas não o listener. Desmontar antes de `load` e dispará-lo depois agenda callbacks e
  atualizações no componente desmontado. Usar handler removível/cancelamento. Reproduzido com
  hooks/document/window/relógio em memória; não foi demonstrada falha visual no navegador real.

## Origem dos achados e evidência

Os dois arquivos consumidores são byte a byte iguais aos da base `bc14aa1`. Antes deste PR não
havia o campo/política `setor` de marketing. São omissões de adaptação ao novo contrato do PR,
não alterações ocultas nas linhas antigas, nem um pedido futuro de métricas de Peças/Oficina.

O harness privado `work/pr9-marketing-revisao.cjs` carrega as funções/rota originais do SHA por
Next SWC/VM, com `permissoes.ts` e `escopo-setor.ts` originais. DB/Auth/config/gerador QR são
fronteiras substituídas. O resultado sanitizado está em `work/pr9-marketing-revisao.json`.
As consultas registradas comprovam filtro por ID/unidade e ausência de setor; os controles do
próprio setor passam. Essa execução não equivale a sessão real, resposta HTTP ou QR gráfico real.

A prova de acompanhamento usa `work/revisao-pr9-acompanhamento.mjs` e resultado
`work/revisao-pr9-acompanhamento-resultados.json`: 9 casos, incluindo a preparação de estado pela
ação original da baseline e controles de CAS, unidade revogada antes de gravar e conflito `23P01`.
Datas de revisão não restauradas foram reproduzidas também na ação antiga: comportamento herdado,
sem achado independente neste PR.

## Escopo e validação

- A lista do GitHub contém 64 arquivos, incluindo documentação e assets. O delta foi lido no SHA;
  não foi aplicado à branch de transferência nem ao checkout do Claude.
- Oficina (`src/app/painel/oficina`, módulo, `0004` e testes) coincide com a entrega aprovada
  `6f75cd0`; a matriz já aprovada não foi repetida sem alteração.
- Os blobs de `0002_nucleo` e `0004_oficina` coincidem com a fonte local já usada na validação SQL
  anterior. Essa equivalência não é uma nova execução do schema do PR no dev.
- Gitleaks do intervalo conferido passou, com 29 commits analisados; `git diff --check` passou.
- Três revisores independentes dividiram marketing, acompanhamento e frontend; raiz conferiu fontes,
  evidências e equivalências. Abertura concluiu em quatro caminhos controlados: documento pronto,
  load tardio, timeout e reduced motion; cookie removido em `/painel`. Cleanup tem o ajuste baixo acima.
- Parser PostCSS do pin passou, inclusive `560px` fora de `900px` e reduced motion. Cinco assets
  usados pela abertura existem no commit. Cinco verificações da função original de mascaramento
  de telefone passaram. Evidência complementar: `work/pr9-root-conferencias.json`.
- A rodada não executou build completo, nova sessão/login, hidratação, mobile real ou servidor.
  `document.readyState` não comprova por si só prontidão de navegação RSC; sem falha real demonstrada,
  isso permaneceu limite de cobertura, não um achado adicional.

Transferência, agenda manual A/B, métricas próprias de Peças/Oficina, login/E2E adicional e
concorrência real permanecem nas suas fatias. Não são tratados como bugs deste PR por ainda não
estarem implementados. A revisão do PR #8 já encerrada não foi reaberta.

Claude corrige o núcleo e disponibiliza novo pin para revalidação dirigida. Não declarar aprovação,
merge, tag ou release v0.0.7 com base neste relatório.
