# Oficina — tela essencial pronta para revisão · 12/11/2026

Código isolado: **`6f75cd0`**. Depende do adaptador `3ee0a95` e da 0004 já revisada/aplicada pelo Claude.
Não mesclar toda a branch para incorporar essa fatia. Menu pessoal do vendedor é o commit separado
`f2b5cb6`; ele não implementa métricas de Peças.

## Entrega

- Oficina → Fila e triagem, com duas colunas: Novas solicitações e Em triagem.
- Agenda existente acessível por link; nenhum calendário, etapa ou conversa adicional.
- Fila geral/Minhas, total autorizado e contagens explícitas da página, paginação por cursor preciso.
- Registro por telefone de cliente existente, placa opcional e descrição; unidade vem da sessão.
- Iniciar triagem aparece somente com a capacidade retornada pelo servidor; a ação revalida sessão,
  ID e serviço. Não há arrastar de volta, transferência ou recuperação automática de órfão.
- Estados de falha não mostram fila vazia como sucesso nem habilitam o formulário de registro.
- Botões refletem o envio pendente; rótulos e erros são fixos. As mensagens da URL são filtradas.

Reutiliza Cabecalho/Vazio e o CSS do quadro comum, com renderização no servidor. O Kanban cliente
genérico de Vendas/Peças exige valores monetários e movimentação de etapas; a Oficina não ganhou
dinheiro fictício nem movimentações não autorizadas para caber nesse contrato. Só o botão usa cliente.
Nenhuma alteração no núcleo, SQL, login, marca ou loading foi feita nesta fatia.

## Validação

- Adaptador/parser já aprovados: 88 + 7 testes; SQL e contratos locais preservados.
- Actions e filtros novos: **65 testes passaram**, incluindo guard, ator da sessão, campos forjados,
  entrada inválida, destino fixo, revalidação somente no sucesso e precisão do cursor.
- Página/quadro reais em SSR com fronteiras simuladas: **33 testes passaram**, incluindo autorização,
  falhas, texto escapado, capacidade de assumir e navegação sem ampliar escopo.
- Revisão independente React/Next/acesso: aprovada sem bug real identificado.
- Medição visual offline com componentes reais e dados fictícios: **34 casos passaram**. Em 390px,
  documento/body 390; quadro visível358/total512 com rolagem interna154. Em1440px, documento1440 e
  quadro1128/1128. Zero requisições; sem overflow do documento.
- Build Webpack, TypeScript, diffcheck e gitleaks passaram. Nenhum segundo servidor foi iniciado.

Resultados visuais privados em `work/qa-oficina-visual/results.json`; capturas são somente fixtures
identificadas como fictícias. Leitura remota real anterior em docs/OFICINA-POSTGREST-READONLY.md:
11 casos, filas vazias e recusas; sem gravação. Não chamar SSR/mocks de login/hidratação/E2E.

## Integração e pendências

Claude revisa e integra o adaptador antes desta UI, recompila o servidor existente e então valida
por partes com Simão. Ainda faltam login real desta rota, cartão autorizado, cadastro/claim reais e
concorrência multissessão. Não criar dados/contas só para eliminar skips sem autorização adequada.
WhatsApp Oficina, novas etapas/transferências/órfão, Revisão e publicação em produção ficam fora.

Métricas de Peças continuam pendentes na A4, conforme apontado pelo Simão. O vendedor já tem a rota
pessoal `/painel/metricas`; `f2b5cb6` apenas deixa o menu explícito como Minhas métricas. Sua incorporação
no runtime é responsabilidade do Claude; não declarar o rótulo disponível antes de confirmar integração.
