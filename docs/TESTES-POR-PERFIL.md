# Testes do painel por perfil

Pedido do Simão em 11/11/2026: usar subagentes com logins diferentes para verificar todas as telas e os limites de cada acesso.

## Estado da preparação

### Atualização após a integração de Peças — 11/11/2026

Claude registrou a aprovação de CR-PEC-001 e aplicação de 0002/0003/0005/0006 no commit
`9adcfd43e69250d4b3dad5287cde33d96da8e49b`. O runtime dessa integração é idêntico a `dc8247e`;
as diferenças são apenas dois documentos. O coordenador confirmou HTTP 200 em `localhost:3000/login`
e presença das dez rotas/RPCs/views esperadas de Peças no OpenAPI do dev `csgrnmoyowjhzlibbilk`.
Isso confirma disponibilidade do contrato HTTP, sem certificar sua execução, login ou concorrência.

Foi preparada uma rodada separada de **acesso somente de leitura**:
`tests/e2e/playwright.pecas-readonly.config.mjs` + `pecas-acesso.spec.mjs`, com seis casos.
Ela não inicia servidor, não compartilha storage state e bloqueia ações de escrita após login;
traces, vídeos e screenshots ficam desligados. O ambiente usa uma conta própria de Peças e
credenciais em configuração local ignorada. A cotação própria só é exigida no teste do cartão;
cada negativa de carteira/unidade exige uma fixture existente e controle positivo em outra sessão.
Requisitos ausentes ficam explicitamente como skip, sem substituí-los por IDs inexistentes.

Sintaxe e descoberta dos seis casos passaram. **Navegador/E2E real ainda não executado:** a tentativa
de confirmar a credencial local da conta demo não autenticou; não houve tentativa de outras senhas,
reset ou alteração de Auth. Conferir a configuração local antes de executar. Nenhum dado de domínio
foi criado/alterado e nenhuma mensagem foi enviada nesta preparação.

O smoke mutável abaixo continua restrito ao Supabase local dedicado; esta rodada nova não remove
essa proteção nem autoriza executar o smoke antigo no dev compartilhado.

### Levantamento inicial preservado

Três subagentes levantaram Administrador, Vendedor e Peças na base `f6370a1`. A cobertura abaixo está **planejada**; nenhum login de navegador foi executado nesta rodada. A suíte existente é um smoke de administrador, não uma certificação de todos os perfis.

No inventário local desta rodada, não foram identificados servidor do painel ativo, `.env.local` no checkout, Docker ou Chromium do Playwright. Preparar ambiente e contas fictícias antes da execução. Os testes de unidade já aprovados não substituem o login e a navegação reais.

## Rodadas e isolamento

| Rodada | Subagente 1 | Subagente 2 | Subagente 3 |
|---|---|---|---|
| 1 | Administrador | Vendedor A | Peças A |
| 2 | Gerente de Vendas | Consultor de Oficina | Recepção |
| 3 | Gerente de Peças | Gerente de Oficina | Financeiro |

- Um login por agente em cada rodada, com `BrowserContext` e sessão próprios; não compartilhar cookies, storage state ou perfil persistente.
- Reusar no máximo um servidor de teste coordenado. A configuração atual sobe a porta 3300 e não admite que três agentes iniciem servidores concorrentes nessa mesma porta; ampliar a configuração antes de executar as rodadas em paralelo.
- Usar Supabase local dedicado e fixtures identificadas por perfil. Os testes mutam apenas essas fixtures; não executar seed/reset sobre o dev compartilhado.
- Senhas e sessões ficam em configuração local ignorada pelo Git. Relatórios identificam perfil e caso, sem credenciais ou tokens.
- Todo envio externo é simulado. O Graph falso atual aceita apenas texto para números demo; testar templates exige ampliar o simulador antes da execução desses casos.

## Matriz de telas

| Tela | Administrador | Vendedor | Peças | Verificação principal |
|---|---|---|---|---|
| Login e saída | Executar | Executar | Executar | Identidade, sessão, senha inválida, logout |
| Visão geral | Permitida | Permitida | Permitida | Blocos compatíveis com o perfil |
| Buscar cliente | Permitida | Permitida | Permitida | Ficha compartilhada, máscara e busca |
| Clientes | Permitida | Permitida | Permitida | Ficha, lembretes e ações autorizadas |
| Vendas | Permitida | Próprios e sem dono | Negada | Novos/Seminovos, posse, transferência e tarefas |
| Atendimento geral | Permitida | Permitida pelo mapa atual | Negada atualmente | Exige fechamento do contexto A1 antes de certificar carteira/setor |
| Agendamentos | Permitida | Negada | Negada | Reserva, conflito, confirmação, alteração e histórico |
| Peças e detalhe | Permitida | Negada | Unidades autorizadas | Fila, itens, próxima ação, aprovação, venda e encerramento |
| Meus lembretes | Próprios | Próprios | Próprios | Cancelamento e todos os links visíveis autorizados |
| Notificações | Próprias | Próprias | Próprias | Leitura/marcação só do usuário |
| Campanhas/eventos | Permitida | Negada | Negada | Público, consentimento, pré-checagem, teste e pausa |
| Links/QR | Permitida | Permitida | Negada | Criação, cópia, imagem e rastreio |
| Follow-ups | Permitida | Negada | Negada | Filtros e cancelamento de fixture |
| Métricas | Permitida | Pessoal ainda planejada | Do setor ainda planejada | Denominador, filtros, unidade e carteira |
| Financeiro | Permitida | Negada | Negada | Indicadores, gráfico, CSV e simulador |
| Configurações/equipe | Permitida | Negada | Negada | Cadastro, origem do login, retomada e proteção do admin |
| Segurança | Permitida | Negada | Negada | Eventos e auditoria |
| Prontidão do piloto | Permitida | Negada | Negada | Estado e dependências |

Gerentes repetem os cenários do próprio setor com visão da equipe e das unidades autorizadas. Oficina/Recepção testam também fila, reserva concorrente, reagendamento e devolução ao bot. Financeiro testa os blocos financeiros e a recusa das ações administrativas. Incluir o papel legado `atendente` na equivalência com Recepção.

## Dados e testes de acesso

Preparar um cliente compartilhado, dois responsáveis da mesma unidade e um responsável de outra unidade; unidades principal, adicional e revogada; oportunidades/cotações próprias, de colega, sem dono, encerradas e transferidas; conversas livres e assumidas; lembretes e notificações de cada login.

Para cada perfil, verificar tanto o menu quanto URL direta, API e ação submetida com ID conhecido. Repetir após mudança de dono/unidade e revogação de acesso. Uma tela ausente não conta como prova de autorização. O administrador acessa as áreas, mas regras de posse e etapa ainda valem: em Peças ele pode reatribuir antes de operar como responsável.

## Seletores e lacunas conhecidos

- Login usa **Entrar no painel**. O toast abre a central `/painel/conversas`, sem o antigo diálogo; a conversa usa `.wa-chat`, **Assumir atendimento** e o campo **Digite uma mensagem (sai pelo número oficial)**. O menu **Gestão** precisa estar aberto para clicar em Financeiro.
- Atendimento integrado em Peças/Vendas, relacionamento por setor e métricas pessoais seguem A1–A4. Sua ausência planejada não deve ser classificada como regressão.
- A fila de Peças atualmente permite ler cotações das unidades autorizadas; as alterações comerciais exigem responsabilidade. Testar essa distinção e a reatribuição exclusiva da supervisão.
- `/painel/oficina` e `/painel/revisao` não existem nesta base. A fila de Oficina da branch isolada só entra na matriz executada após integração; Agendamentos já existe.
- As APIs gerais de conversa ainda precisam provar vínculo, setor, unidade e posse. `GET conversa` também altera a contagem de não lidas; usar apenas fixtures próprias de teste.
- Incluir os links dos avisos gerados pelo cron: a página Meus lembretes já respeita a área do perfil nos seus links, mas o helper do cron ainda escolhe Vendas/Busca sem conferir o destinatário. Verificar após mudança de papel e com login sem acesso à Busca.
- O resumo/faixa de Vendas ainda recebe funil/período, enquanto os cartões filtram carteira. A certificação das métricas pessoais depende da A4.

## Registro de resultado

Cada agente informa perfil, caso, rota, resultado esperado/observado, evidência e ambiente/commit testado. Usar estados **passou**, **falhou**, **bloqueado pelo ambiente** ou **ainda não implementado**. Separar análise de fonte, testes simulados e E2E executado. Somente consolidar “todas as telas testadas” após fechar a matriz de cada perfil e suas rotas proibidas.
