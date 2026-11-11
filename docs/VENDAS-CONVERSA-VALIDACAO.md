# Validação visual da conversa de Vendas

Em 11/11/2026, o layout da seção **Atendimento WhatsApp** passou na inspeção offline em desktop e mobile. A correção do botão × foi revalidada somente no mobile, no estado `minha`; o botão agora permanece dentro do painel da oportunidade.

Foram usados os componentes reais `ConversaVendas`, `ConversaAtendimento`, `DialogoMensagens` e `QuadroKanban`, com o `globals.css` do checkout. O contêiner de detalhe reproduz a composição da página de Vendas. A fixture foi inserida em memória antes do render JSX/SSR, sem editar os componentes. Nome longo, texto longo e 34 mensagens fictícias exercitaram a largura estreita e a rolagem.

## Versões e evidências

Checkout na revalidação do ×: `d8edfb6`. Os hashes identificam exatamente as fontes renderizadas; a correção de CSS estava no diretório de trabalho dessa revisão.

| Fonte | SHA-256 |
|---|---|
| `ConversaVendas.tsx` | `127e5904e103f1ee0386207d71d799073bcc2d9c57c1c04b70e0c1fa9bdedab6` |
| `ConversaAtendimento.tsx` | `aaabf95468aa3823d07b69d72e70a5d7351b7d728d49e66624d453c009aa50bc` |
| `DialogoMensagens.tsx` | `46da33a27e5a0b94c1ff9e1256a2e0c29e46a79a2c96d1106708024ce77153d7` |
| `globals.css`, inspeção inicial | `d91e4f8aa7fdaec7960f6ab3ce40a47e49b0f40d12f6483bd4ce7904f34d06f7` |
| `globals.css`, após correção do × | `6feec64c1bee43af8df4b74db89268b4d9ecaffe9dee23860018cab6e0c99734` |

Os artefatos ficam no workspace, fora do repositório, em `work/qa-vendas-ui`. Os links abaixo apontam para essa pasta irmã do checkout.

| Estado | Viewport | Verificado | Captura |
|---|---|---|---|
| `minha` | 1600 × 1000 | Cabeçalho, Devolver, compositor e rolagem; CSS inicial | [Desktop](../../qa-vendas-ui/vendas-minha-desktop.png) |
| `livre` | 1600 × 1000 | Assumir visível; escrita desabilitada e aviso de 24h; CSS inicial | [Desktop livre](../../qa-vendas-ui/vendas-livre-desktop.png) |
| `livre` | 390 × 844 | Cabeçalho e botão cabem; escrita desabilitada; CSS inicial, anterior ao ajuste do × | [Mobile livre](../../qa-vendas-ui/vendas-livre-mobile.png) |
| `minha` | 390 × 844 | Revalidação do × dentro do painel; rodapé contido e mensagens ainda roláveis; CSS corrigido | [Mobile atualizado](../../qa-vendas-ui/vendas-minha-mobile.png) |

As medidas e hashes da inspeção inicial estão em [medidas.json](../../qa-vendas-ui/medidas.json). A revalidação pontual está em [fechar-mobile-depois.json](../../qa-vendas-ui/fechar-mobile-depois.json). O harness inicial é `work/qa-vendas-ui.cjs`; a revalidação aproveitou apenas seu render do estado `minha`, sem repetir a matriz completa.

## Resultado observado

- Sem overflow horizontal global nos viewports de 1600 e 390 px. Painel com 400 px no desktop e 358 px no mobile.
- Cabeçalho, botão de assumir/devolver e textarea permaneceram dentro da largura do chat na inspeção inicial. O rótulo acessível observado foi **Conversa de Vendas**.
- No estado `minha`, a área de mensagens tinha aproximadamente 295–300 px de altura e mais de 2300 px de conteúdo; `overflow-y: auto` e alteração de `scrollTop` comprovaram a rolagem própria. O rodapé permaneceu dentro do chat.
- O × antes aparecia em `y=10`, enquanto o painel mobile começava em `y=554`. Após a regra `.vendas .painel-lateral { position: relative }` no breakpoint de 1100 px, o painel ficou em `y=570,25` e o × em `y=581,25`, inteiramente dentro dele. A regra desktop não foi alterada; desktop não foi reexecutado nesta correção pontual.

## Limites

Esta é validação visual offline com Chrome headless isolado, JavaScript do navegador desabilitado, contexto offline e bloqueio de todas as requests. Foram observadas **zero requests**. Não usou o servidor do Claude, banco, Auth, credenciais nem transportes reais.

Os estados e mensagens são fixtures inseridas no render; não validam polling, ações, autorização, janela de atendimento no servidor, envio ou persistência. Os botões não foram acionados. O estado `livre` não foi reexecutado depois da correção pontual do ×. A página completa de Vendas, com todas as suas consultas e formulários, não foi executada neste harness.

Este registro não constitui E2E de Vendas nem validação de SQL. Resultados dessas camadas devem ser acrescentados separadamente.


## Contratos locais e integração pendente

A implementação local passou 1.713 testes Vitest em 41 arquivos, typecheck, gitleaks e build Webpack.
A refatoração preservou os 65 testes de Peças e acrescentou 18 casos do adaptador Vendas: contrato próprio,
perfis/identidade, capacidades de supervisão, replay, ambiguidade entre reserva/despacho, opt-out e 24 horas.
Ações e API autenticam Vendas no servidor; o GET usa no-store e não marca leitura.

0006 SHA-256 A27B9D04B39BEFBE65C57DB4FBE2012C2703E26C4AEA315A8D9B8D807A7EF98F; contrato Vendas
SHA-256 8B8664D18025E4E5BFF64377596B4DCAA6920B94616EC619112F54AB86C3B599. Contratos PGlite passaram
com defaults fechados e permissivos, reaplicação populada, rollback real de timeline/notificação/auditoria,
GET sem gravações, supervisor preservando dono, duas oportunidades/Peças no canal, origem única congelada,
sem ledger sem histórico, ledger incompatível, ambiguidade tardia, snapshots e lifecycle. Os contratos
Peças MVP/quadro/retorno passaram nos dois modos no hash 20EA2E0B, anterior somente ao último ajuste de
abertura de Vendas sem ledger; o trigger compartilhado e as regras Peças não mudaram depois dessa rodada.
Runner local: work/validar-vendas-atendimento.mjs. Revisão independente do SQL em conclusão, sem aplicar dev.

Entrega deve partir de main v0.0.4 (5e73115), confirmada após merge real do PR #6. Claude revisa/aplica
0006 antes do código, recarrega schema cache e recompila. Login de Vendas, fluxo real por cartão, envio
real e concorrência multissessão continuam pendentes; testes locais e visual offline não os substituem.
