# QA somente leitura — Peças e gerente de Peças

Rodada de 11/11/2026 no servidor **já existente** `http://localhost:3000`, fonte compartilhada com versão `0.0.5`. Checkout de QA: `codex/oficina-fila`, HEAD `e6a5a8c`. Nenhum servidor foi iniciado pelo agente. O trabalho de Oficina permaneceu congelado.

Esta rodada amplia o QA por perfil sem repetir o roteiro já aprovado. Foram inventariadas as **21 rotas de página** existentes no checkout que serve a aplicação, incluindo as novas `/painel/conta` e `/painel/usuarios`. Páginas de leitura autorizadas e recusas por perfil estão discriminadas abaixo; isso não certifica os fluxos de escrita dessas telas.

## Ambiente e proteção

- Chrome instalado: `157.0.8103.40`; BrowserContext descartável e separado para cada perfil.
- Credenciais documentadas interpretadas em memória como `login | papel/setor | senha`, sem valores no código, relatório, screenshots ou traces. Não houve alternativa de senha, reset, criação de conta ou Auth admin.
- Identidade conferida no `span[title]` do perfil no rodapé: Gerente/Peças ou Peças/Peças. O link do nome para Minha conta não foi usado como prova de papel.
- Somente o POST de login foi autorizado. POSTs de domínio, envios, claims, reatribuições, marcações de notificação, cancelamentos e mudanças de senha permaneceram bloqueados e não foram tentados.
- GET geral de conversa, que altera contador, bloqueado. Detalhe de campanha com `?ver=` e exportação LGPD, que escrevem em GET, também bloqueados, inclusive por prefetch.
- Não houve seed, fixture nova, acesso direto ao Supabase, RPC avulsa, consulta com service role, exportação de dados ou envio de WhatsApp.
- Registros existentes foram usados somente dentro da sessão autorizada. Nomes, telefones, IDs de clientes/cotações, corpos de mensagens e valores de credenciais não foram copiados aos artefatos de resultado.

Fingerprint público observado na rodada final: login com título **Acesse sua conta**, botão **Entrar**; hash SHA-256 do DOM público `0a09272b9a68a2bab96694637443e7f8b72e7bbaff94c33b8d8fd4807b054ebe`. Esse hash identifica o HTML observado, sem substituir um pin de deployment. A interface estava sendo atualizada durante o QA.

Fontes do servidor conferidas durante a rodada:

| Arquivo | SHA-256 |
|---|---|
| `src/lib/permissoes.ts` | `0EA92A2DE5E284337437880D6F50A323E0C0D34808B6447E01AF0A93A6CC6E96` |
| `src/app/painel/layout.tsx` | `21CD01896B485AA41A4A2D3E753A0F1F27FAD205EF3249BF607E04F70A5DA989` |

## Resultado e evidência

| Rodada | Gerente Peças | Peças |
|---|---|---|
| Adicional completo, 20:32–20:34 UTC | 18 passou, 1 skip | 18 passou, 2 skip |
| Detalhes e negativa conferidos, 20:37–20:39 UTC | 3 passou | 3 passou, 1 skip |
| Pendente após a conferência | Nenhuma das páginas adicionais de leitura | Detalhe/conversa **próprios**: conta sem cartão autorizado visível |

A conferência direcionada resolveu o skip inicial do detalhe gerencial e comprovou uma negativa real do operador usando a mesma cotação existente. Login e guarda readonly reaparecem nos resultados direcionados como pré-requisitos, e não como novos casos de cobertura. Nenhuma das demais telas aprovadas foi repetida para essa conferência.

Artefatos locais, fora do código do produto:

- Scratch: `work/qa-pecas-todas-telas.mjs` (na pasta `work`, ao lado do checkout).
- Relatórios adicionais: `work/qa-pecas-todas-telas/gerente_pecas-final.json` e `pecas-final.json`.
- Conferência final: `gerente_pecas-detalhes-conferidos.json` e `pecas-detalhes-conferidos.json` na mesma pasta.
- SHA-256 do scratch final: `b280dd1724cd8da8a6cad462c6311ef3119f3917b349ccca4535b16f3309a2bc`.
- Referências anteriores preservadas: `work/qa-perfis-005/{gerente_pecas,pecas}.json` e respectivos `-recheck.json`. O quadro passou nos dois perfis após corrigir o seletor do teste para considerar as duas instâncias intencionais (abertas e encerradas).

## Matriz das páginas reais

**Anterior** indica prova da suíte por perfil já executada nesta sessão, mantida por orientação de não repetir casos aprovados. **Adicional** indica a presente rodada.

| Rota | Gerente Peças | Peças | Cobertura |
|---|---|---|---|
| `/painel` | Permitida | Permitida | Anterior: início, Meu dia/setores e menu |
| `/painel/conta` | Permitida | Permitida | Adicional: Minha conta/Trocar senha renderizam; senha não preenchida |
| `/painel/usuarios` | Negada | Negada | Adicional: redireciona a `sem_permissao` |
| `/painel/busca` | Permitida | Permitida | Adicional: vazio e busca por nome; telefones mascarados |
| `/painel/clientes` | Permitida | Permitida | Adicional: lista, filtros por nome/Minha carteira e ficha de cliente existente |
| `/painel/clientes/importar` | Negada | Negada | Anterior: URL direta recusada |
| `/painel/lembretes` | Permitida | Permitida | Adicional: Lembretes e Mensagens agendadas; sem cancelar; sem links para Vendas |
| `/painel/notificacoes` | Permitida | Permitida | Adicional: central e API; sem marcar leitura |
| `/painel/pecas` | Permitida | Permitida | Anterior: quadro aprovado; adicional usa como pré-requisito de seleção |
| `/painel/pecas/[id]` | Detalhe existente abriu | Cotação do controle gerencial recusada; próprio pendente | Adicional: Solicitação/Próxima ação/Itens no gerente; página notFound para operador sem cartão |
| `/painel/conversas` | Permitida pelo mapa atual | Negada | Adicional: gerente abre Inbox sem selecionar conversa; operador recebe recusa |
| `/painel/campanhas` | Lista permitida pelo mapa atual | Negada | Adicional: lista; detalhe `?ver=` não executado por escrever em GET |
| `/painel/links` | Permitida pelo mapa atual | Negada | Adicional: lista/formulários, sem criar/alternar/baixar/seguir link rastreado |
| `/painel/followups` | Permitida pelo mapa atual | Negada | Adicional: seis filtros GET; sem cancelar |
| `/painel/vendas` | Negada | Negada | Anterior: URL direta recusada |
| `/painel/metricas` | Negada | Negada | Anterior: métricas atuais são de Vendas |
| `/painel/agendamentos` | Negada | Negada | Anterior: filtro setorial Oficina preservado |
| `/painel/financeiro` | Negada | Negada | Anterior: URL direta recusada; API CSV adicional recusada |
| `/painel/configuracoes` | Negada | Negada | Adicional: URL direta recusada |
| `/painel/seguranca` | Negada | Negada | Adicional: URL direta recusada |
| `/painel/piloto` | Negada | Negada | Adicional: URL direta recusada |

A ficha de Clientes exibiu seções compartilhadas de autorizações, veículos e agendamentos. Telefone mascarado foi conferido na busca/lista; documentos presentes na ficha estavam mascarados. Exportação, anonimização e links de oportunidades de Vendas estavam ausentes para ambos. Formulários de edição, opt-out e agendamento não foram submetidos.

O filtro por vendedor existe na lista de Clientes do gerente e não aparece para o operador. Renderização dos filtros foi validada; diferenças quantitativas de carteira não foram certificadas sem registros comparáveis conhecidos.

## APIs e escopo da cotação

| API GET | Gerente Peças | Peças |
|---|---|---|
| `/api/painel/notificacoes` | 200, DTO válido, sem aniversários de Vendas | Mesmo resultado |
| `/api/painel/inbox` | 200 conforme permissão atual | 401 |
| `/api/painel/fila` | 200 conforme permissão atual | 401 |
| `/api/painel/financeiro/csv` | 401 | 401 |
| `/api/painel/pecas/[id]/conversa` | Diálogo vazio autorizado aprovado na rodada anterior | Cotação do controle gerencial: 404, `ok:false`, sem `clienteNome` e sem `mensagens` |

O controle positivo foi o detalhe de uma cotação **existente**, aberto pelo gerente na mesma execução direcionada. A cotação não aparecia no quadro do operador. Ao acessar o mesmo ID, o operador recebeu corpo de página **notFound**, sem a seção Solicitação. O transporte da página respondeu **HTTP 200** por streaming do Next; a API respondeu **404**. O primeiro assert do teste, que exigia HTTP 404 da página sem conferir seu corpo, foi um falso negativo corrigido no roteiro. Não houve evidência de acesso aos dados dessa cotação.

Essa prova cobre uma cotação fora do escopo da conta operacional. Não permite afirmar separadamente se a restrição decorreu de responsável, unidade principal ou extra. Não substitui uma matriz com controles positivos para cada combinação.

## Achados que precisam de decisão ou correção

### QA-PEC-TELAS-001 — detalhe de campanha escreve durante GET/prefetch

- **Tipo:** bug de semântica de leitura, observado; prioridade média.
- **Fonte:** `src/app/painel/campanhas/page.tsx:36` chama `preChecagem(c.id)` ao abrir `?ver=`; `src/lib/campaigns.ts:90` executa UPDATE em `total_previsto` e `custo_estimado_brl`.
- **Evidência de navegador:** ao abrir a lista de campanhas no gerente, houve tentativa automática de prefetch de detalhe. O scratch interceptou e abortou o GET antes da execução. Relatório gerencial registra `getsMutantesBloqueados: ["pré-checagem de campanha"]`.
- **Efeito:** a navegação/antecipação de um link pode atualizar os valores da campanha. Nesta rodada a proteção impediu a escrita; detalhes de campanha permanecem fora da prova readonly.
- **Encaminhamento:** tornar o cálculo do GET puro e deixar persistência em ação explícita autorizada; impedir prefetch ajuda como medida imediata, mas não elimina a mutação por acesso direto. Nenhuma correção de produto foi feita neste QA.

### QA-PEC-TELAS-002 — Busca oferece Atendimento geral ao operador recusado

- **Tipo:** defeito de interface, observado; prioridade baixa.
- **Fonte:** `src/app/painel/busca/page.tsx:79` monta o link `/painel/conversas` no rodapé sem checar o acesso.
- **Evidência:** o operador Peças vê o link; abrir a rota diretamente foi recusado corretamente com `sem_permissao`.
- **Efeito:** atalho leva a uma área indisponível. Não representa liberação da conversa ou vazamento.

### QA-PEC-TELAS-003 — alcance do gerente de Peças precisa de decisão setorial

- **Tipo:** política atual/decisão pendente, não classificado como regressão.
- `AREAS` permite gerente em Atendimento, campanhas, links e follow-ups; `SETOR_DA_AREA` não aplica filtro de setor a essas áreas. A UI e as URLs seguiram esse contrato.
- O gerente Peças abriu essas listas gerais e suas APIs de leitura. Importação, métricas/Vendas, agenda, financeiro e administração foram recusados conforme o mapa atual.
- Caso o requisito final seja gerente restrito às funções do próprio setor também nessas áreas, ajustar política e serviços com uma tarefa própria. Este QA não alterou o alcance de nenhum perfil.

## Limites e pendências

- Operador sem cotação própria autorizada: detalhe/conversa positivos, estados livre/minha/outra, resposta e carteiras comparáveis continuam pendentes. Nenhuma cotação foi criada ou assumida para preencher essa lacuna.
- Diálogo gerencial vazio comprovado anteriormente; não certifica exibição de mídias, paginação extensa ou histórico com mensagens reais.
- Lembretes/notificações abriram sem marcação; isolamento quantitativo entre usuários não foi inferido sem fixtures comparáveis.
- Fluxos de escrita, envio, drag-and-drop, itens, aprovação, venda, cancelamento, opt-out, edição de cliente, troca de senha, campanhas e exportações ficaram fora desta rodada readonly.
- As duas interrupções iniciais foram mudanças de seletores da UI de login/rodapé: botão passou de Entrar no painel para Entrar; o nome ganhou link Minha conta com atributo title. As credenciais não foram classificadas como inválidas. JSONs iniciais foram preservados e não contam como falhas de produto.
- Apenas este documento novo foi adicionado ao repositório pelo agente nesta tarefa; scratch e resultados ficaram em `work`. Sem alterações de produto, SQL, suíte comum, Oficina, stage ou commit.
