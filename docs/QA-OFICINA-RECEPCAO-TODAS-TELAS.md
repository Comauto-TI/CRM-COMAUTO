# QA de telas — Recepção e Consultor de Oficina

Rodada real de leitura em `http://localhost:3000`, em 11/11/2026, das 17:33:20 às 17:36:09 (America/Sao_Paulo). Resultado: **50 verificações passaram e duas falharam**, uma por perfil, pelo mesmo overflow horizontal na Agenda em viewport de 390 × 844. Cada perfil teve 26 verificações; não houve caso pulado.

## Ambiente observado

- Um navegador/contexto novo por perfil, com uma única autenticação em cada sessão. Nenhum login foi criado ou redefinido.
- Identidades de papel/setor conferidas no rodapé: Recepção · Oficina e Consultor técnico · Oficina. O seletor usado foi `.lateral-usuario > span[title]`, evitando o título do novo link Minha conta.
- Login público observado: título `Comauto — Painel do Assistente`, cabeçalho `Acesse sua conta`, botão `Entrar`.
- Fingerprint SHA-256 dos caminhos dos assets públicos: `19bbf2cbdc8ecd0e2582b01d7dc0afa40c72949c850fcb14f569cae285d04a82`, igual nas duas sessões.
- O servidor não expôs versão no login. A base informada para o QA era v0.0.5, mas o runtime recebeu mudanças de layout durante a preparação; não atribuí esta execução a um SHA de produto não comprovado pelo servidor.
- SHA-256 do roteiro executado: `e9e07a435f7440ac7ce58cac81ca9609cd13b2e5c7dee5b3e53706f4543b9f79`.

## Proteção de leitura

O navegador bloqueou solicitações externas e todas as mutações, exceto um `POST /login` por sessão. Também bloqueou previamente GETs conhecidos com efeitos: conversa individual `/api/painel/conversa/*`, exportação de cliente, rastreamento `/r/*`, campanha com query `ver` e buscas fora do nome fixo do roteiro. Não foi usado `APIRequestContext`, que contornaria essa interceptação; as consultas auxiliares foram feitas por `fetch` no próprio navegador.

Os dois relatórios terminaram com **zero tentativa de mutação de negócio, zero tentativa dos GETs com efeito, zero requisição externa e zero erro JavaScript de página**. Credenciais ficaram apenas em memória. Não foram gravados screenshots, traces, storageState, conteúdo de cliente, telefone, documentos ou identificadores reais nos relatórios.

## Cobertura de rotas

“Negada” significa acesso direto redirecionado para `/painel?erro=sem_permissao`, além de ausência no menu. O inventário contém 21 padrões de rota, incluindo Minha conta e Usuários, acrescentados ao runtime durante a preparação.

| Rota | Recepção | Consultor | O que foi conferido |
|---|---|---|---|
| `/painel` | Passou | Passou | Login, identidade e menu; dashboard/Meu Dia/resumo já passaram na rodada comum anterior. |
| `/painel/busca` | Passou | Passou | Busca GET somente por nome e indicação do resultado. |
| `/painel/clientes` | Passou | Passou | Lista, filtro de nome e ficha já existente. Seções LGPD, veículos e agendamentos; oportunidades/exportação/anonimização ausentes para estes perfis. |
| `/painel/lembretes` | Passou | Passou | Listas Meus lembretes, Lembretes e Mensagens agendadas. |
| `/painel/notificacoes` | Passou | Passou | Página e API GET; sem marcar ou abrir link de notificação. |
| `/painel/conversas` | Passou | Passou | Somente inbox, quatro abas e pesquisa; nenhuma conversa individual selecionada. |
| `/painel/agendamentos` | Falha mobile | Falha mobile | Filtro GET de pendentes e campos de data passaram; overflow da página em 390 × 844. |
| `/painel/conta` | Passou | Passou | Minha conta e opção Trocar senha visíveis; nenhum campo preenchido ou envio. |
| `/painel/links` | Passou | Negada | Recepção leu lista e gerou SVG de QR existente em memória, sem download ou visita ao link rastreado. |
| `/painel/followups` | Passou | Negada | Recepção abriu os seis filtros: pendente, enviado, respondido, sem consentimento, falhou e cancelado. |
| `/painel/vendas` | Negada | Negada | URL direta e menu. |
| `/painel/pecas` | Negada | Negada | URL direta e menu. |
| `/painel/pecas/[id]` | Negada | Negada | URL direta com UUID fictício, sem sondar um registro real. |
| `/painel/metricas` | Negada | Negada | URL direta e menu. |
| `/painel/clientes/importar` | Negada | Negada | URL direta e menu. |
| `/painel/campanhas` | Negada | Negada | URL sem query `ver`; nenhum pré-check executado. |
| `/painel/financeiro` | Negada | Negada | URL direta e menu. |
| `/painel/configuracoes` | Negada | Negada | URL direta e menu. |
| `/painel/usuarios` | Negada | Negada | Nova rota administrativa, URL direta e menu. |
| `/painel/seguranca` | Negada | Negada | URL direta e menu. |
| `/painel/piloto` | Negada | Negada | URL direta e menu. |

As APIs de conversa de Vendas e Peças também recusaram os dois perfis com status 401/403, usando UUID fictício. Nenhuma requisição foi feita à API geral de conversa que altera contador.

## Achado — overflow horizontal na Agenda

**Gravidade:** média, apresentação mobile. **Rota:** `/painel/agendamentos`, com filtro `status=pendente`.

Reprodução observada independentemente nos dois contextos:

1. Abrir Agendamentos e aplicar o filtro Pendentes por GET.
2. Alterar o viewport para 390 × 844.
3. Conferir o título e os campos De/Até, que continuam visíveis.
4. Medir `document.documentElement.scrollWidth` e `innerWidth`: a condição `scrollWidth <= innerWidth + 2` falha.

O roteiro inicial registrou `overflow_horizontal_mobile`, sem persistir larguras numéricas. Após solicitação do coordenador, foi feita uma única sessão adicional de Recepção, restrita à Agenda, para diagnosticar a geometria antes/depois do filtro e experimentar a correção apenas no DOM. Os contextos anteriores já estavam encerrados; não foram repetidas as demais telas.

### Diagnóstico focado e correção proposta

Diagnóstico em 11/11/2026, das 17:41:03 às 17:41:09 (America/Sao_Paulo), viewport/`innerWidth`/viewport visual de 390 px. O título público já era `ShiftUP · Comauto`; o fingerprint dos caminhos de assets continuou igual ao da rodada inicial. O CSS atual do checkout Claude teve o mesmo SHA-256 antes e depois: `54cb9177b8474379df9040d33da69371f1ea3e065e6a10d7ef59c19d13b59faa`.

| Medida em px | Antes do filtro | Pendentes | Pendentes com regra temporária no DOM |
|---|---:|---:|---:|
| Viewport / largura do documento | 390 / 390 | 390 / 390 | 390 / 390 |
| `documentElement.scrollWidth` | 563 | 563 | 390 |
| `body.scrollWidth` | 563 | 563 | 390 |
| `main.conteudo` largura / `scrollWidth` | 390 / 563 | 390 / 563 | 390 / 390 |
| `form.linha-form` largura | 546,56 | 546,56 | 358 |
| `form.linha-form` borda direita | 562,56 | 562,56 | 374 |
| `.tabela-wrap` `clientWidth` / `scrollWidth` | 356 / 722 | 356 / 593 | 356 / 593 |
| Rolagem interna máxima observada da tabela | 366 | 237 | 237 |

**Causa comprovada:** o formulário de filtros do cabeçalho permanece em uma única linha. No CSS atual do Claude, [globals.css:362](<C:/Users/LENOVO/Documents/Comauto Projetos/IA CHATBOT/src/app/globals.css:362>) aplica `.cabecalho .linha-form { flex-wrap: nowrap; }`, e a linha 364 impõe `min-width: 150px` aos três controles. A largura total é 546,56 px; `.cabecalho > .acoes` cresce para a mesma largura. Os elementos sem contenção que atravessam a borda são `div.acoes`, `form.linha-form`, o terceiro `label`/`select` (x336 até486) e `button.btn` (x496 até562,56).

A tabela está contida corretamente: `.tabela-wrap` ocupa x16 até374, com `overflow-x: auto`, e aceita rolagem interna. A tabela e suas células ultrapassam sua área visível, mas o wrapper as contém; não são a causa do excesso do documento. A regra existente fica em [globals.css:225](<C:/Users/LENOVO/Documents/Comauto Projetos/IA CHATBOT/src/app/globals.css:225>), e o wrapper da Agenda em [page.tsx:93](<C:/Users/LENOVO/Documents/Comauto Projetos/IA CHATBOT/src/app/painel/agendamentos/page.tsx:93>).

Regra mínima compatível com o seletor atual, a ser integrada pelo Claude após a regra de `nowrap`:

```css
@media (max-width: 560px) {
  .cabecalho .linha-form { flex-wrap: wrap; }
}
```

Essa regra foi validada com `page.addStyleTag`, exclusivamente em memória: o formulário passou a 358 px e documento/body/main passaram a `scrollWidth: 390`, mantendo os controles e a rolagem interna da tabela. **Nenhum CSS, arquivo de produto ou servidor foi alterado**, nem foi ocultado overflow do documento. O experimento comprova a correção em 390 px; outras larguras e demais cabeçalhos não foram retestados nesta sessão focada.

O diagnóstico salvou apenas medidas, tags, classes CSS e contenção, sem texto/atributos de cliente. Houve um `POST /login` e zero mutação de negócio, GET com efeito ou requisição externa.

Limite do roteiro: a restauração para desktop ficava após essa asserção; como ela falhou, os casos seguintes de Links/Follow-ups e de negação de URLs foram executados ainda no viewport mobile e passaram. Esta rodada não comprova a apresentação desktop dessas duas telas posteriores.

## Evidências e limites

- Roteiro próprio, sem alteração da suíte comum: `C:/Users/LENOVO/Documents/Codex/2026-11-10/cod/work/qa-oficina-recepcao-todas-telas.mjs`.
- Resultados completos: `C:/Users/LENOVO/Documents/Codex/2026-11-10/cod/work/qa-oficina-recepcao-ampliado/recepcao.json` e `consultor.json` na mesma pasta.
- Diagnóstico focado: `C:/Users/LENOVO/Documents/Codex/2026-11-10/cod/work/diagnosticar-agenda-overflow.mjs`, com medidas em `C:/Users/LENOVO/Documents/Codex/2026-11-10/cod/work/qa-oficina-recepcao-ampliado/diagnostico-agenda.json`.
- A rodada comum anterior aprovou cinco verificações por perfil (login/menu/dashboard/Agenda básica/proteção de leitura), com relatórios em `work/qa-perfis-005`, antes das alterações de login e Conta desta rodada.
- Esta entrega verifica acesso, navegação, filtros e leitura autorizada da interface disponível. Não valida criação/edição, opt-out, exportação, atribuição/transferência, envio WhatsApp, troca de senha, marcação de notificação ou os fluxos de gravação de cada tela.
- A fila própria de Oficina ainda estava em WIP pausado por decisão do coordenador. Não foi tratada como tela publicada nem testada nesta rodada. Nenhum arquivo de produto, migration ou contrato de Oficina foi alterado.
