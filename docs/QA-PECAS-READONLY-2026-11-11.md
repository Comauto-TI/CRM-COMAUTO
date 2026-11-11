# QA Peças somente leitura — 11/11/2026

- Registro UTC: 2026-11-11T19:33:09.128Z
- Checkout: `d0b7bba`
- Servidor existente: `http://localhost:3000` (nenhum servidor iniciado pelo runner).
- Spec SHA-256: `f58d2f83eb96e65915f06871c4bdc9448b03964427d000876b5c9b9d39d38720`
- Configuração: `tests/e2e/playwright.pecas-readonly.config.mjs`

A conta documentada foi interpretada no formato confirmado `login | papel/setor | senha`: célula 0 para login, célula 1 validada como Peças/Peças e célula 2 para senha, sem tentar alternativas. Valores ficaram somente no arquivo de ambiente ignorado e na memória dos processos. Nenhum valor de credencial é registrado neste documento.

Pré-checagem de autenticação: **confirmada**. Cotação própria existente com diálogo validado por RPCs de leitura: **indisponível**. Controles positivos de cotações estrangeiras no navegador: **não disponíveis**; os casos estrangeiros não certificam isolamento nesta rodada.

Consulta complementar de leitura esclareceu a ausência de fixture: a RPC do quadro retornou sucesso com **0 cotações autorizadas, 0 próprias e 0 próprias abertas**, sem erros de consulta. Portanto, o caso positivo não foi executado por falta de cotações disponíveis para essa conta; não houve diálogo recusado que permita atribuir o skip ao CR002. A correção do CR002 permanece sem verificação nesse dev por falta desse dado.

A primeira execução no sandbox não alcançou o servidor, antes de qualquer autenticação. A rodada efetiva usou a permissão de rede elevada autorizada, sem iniciar outro servidor.

| Caso | Resultado | Requisito pendente |
|---|---|---|
| Peças entra na visão geral com o menu do próprio perfil | passou | — |
| Peças lê o quadro e abre somente a conversa e o detalhe da cotação própria | skip | Requisito ausente: COMAUTO_E2E_PECAS_COTACAO_PROPRIA. |
| Peças não lê cotação de carteira de colega por cartão, URL ou API | skip | Requisito ausente: COMAUTO_E2E_PECAS_COTACAO_COLEGA. |
| Peças não lê cotação de unidade não autorizada por cartão, URL ou API | skip | Requisito ausente: COMAUTO_E2E_PECAS_COTACAO_OUTRA_UNIDADE. |
| Peças recebe recusa em Vendas e Atendimento geral por URL direta | passou | — |
| Peças recebe recusa nas APIs gerais sem abrir um contador real | passou | — |

Os testes usam Chrome instalado, um BrowserContext descartável por caso e bloqueiam ações de escrita no painel após o login, além do GET geral que altera o contador de mensagens. Login/sessões de teste são as únicas operações de autenticação usadas; não houve Auth admin, criação/reset de contas, seed, claim, edição de domínio ou envio de WhatsApp. Traces, screenshots e vídeo ficam desativados.

Esta rodada cobre somente os casos marcados como passou. Casos skip, interrompidos ou bloqueados continuam pendentes; não representa validação de todos os perfis, envios ou fluxos de escrita.
