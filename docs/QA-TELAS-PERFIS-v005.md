# QA das telas por perfil — v0.0.5

Rodada em 11/11/2026 na produção local http://localhost:3000, com Chrome headless e contextos descartáveis
separados. Base remota confirmada: main 16b873b (PR #7 merged). Resultado consolidado: **47 casos
passaram, 0 falharam após corrigir o seletor do teste, 2 pendências**. Sete perfis autenticados;
Vendedor não teve tentativa porque Claude informou senha pendente.

| Perfil | Login | Menu/URLs | Início | Vendas quadro/conversa | Peças quadro/conversa | Métricas | Importar | Agenda | Financeiro |
|---|---|---|---|---|---|---|---|---|---|
| Administrador | Passou | Passou | Passou | Passou / Passou | Passou / Passou | Passou | Passou | Passou | Passou |
| Gerente Vendas | Passou | Passou | Passou | Passou / Passou | Barrado/fora do perfil / Barrado/fora do perfil | Passou | Passou | Barrado/fora do perfil | Barrado/fora do perfil |
| Vendedor | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente |
| Gerente Peças | Passou | Passou | Passou | Barrado/fora do perfil / Barrado/fora do perfil | Passou / Passou | Barrado/fora do perfil | Barrado/fora do perfil | Barrado/fora do perfil | Barrado/fora do perfil |
| Peças | Passou | Passou | Passou | Barrado/fora do perfil / Barrado/fora do perfil | Passou / Pendente | Barrado/fora do perfil | Barrado/fora do perfil | Barrado/fora do perfil | Barrado/fora do perfil |
| Recepção | Passou | Passou | Passou | Barrado/fora do perfil / Barrado/fora do perfil | Barrado/fora do perfil / Barrado/fora do perfil | Barrado/fora do perfil | Barrado/fora do perfil | Passou | Barrado/fora do perfil |
| Consultor | Passou | Passou | Passou | Barrado/fora do perfil / Barrado/fora do perfil | Barrado/fora do perfil / Barrado/fora do perfil | Barrado/fora do perfil | Barrado/fora do perfil | Passou | Barrado/fora do perfil |
| Financeiro | Passou | Passou | Passou | Barrado/fora do perfil / Barrado/fora do perfil | Barrado/fora do perfil / Barrado/fora do perfil | Passou | Barrado/fora do perfil | Barrado/fora do perfil | Passou |

“Barrado/fora do perfil” refere-se às URLs negadas ou a um componente que não se aplica ao roteiro do
perfil. A linha Vendedor permanece inteiramente pendente; nenhuma marca nessa linha comprova negação.
Os menus e as URLs proibidas foram conferidos para cada um dos sete perfis autenticados. Meu Dia aparece
para gerente de Vendas; os cartões de setores foram conferidos conforme acesso de cada perfil.

## Pendências e limites

- Vendedor: falta a credencial válida documentada solicitada ao Claude; não houve reset nem tentativa com senha antiga/alternativa. A visão pessoal de Métricas e o isolamento quantitativo da carteira desse perfil não foram testados no navegador.
- Peças: quadro abriu, mas não havia cartão autorizado visível para a conta Peças. A conversa desse perfil ficou pendente; não foi criado registro para satisfazer a fixture.
- Conversas de Vendas abriram para admin e gerente Vendas; Peças abriu para admin e gerente Peças. Os diálogos retornaram autorizados e vazios. Isso prova abertura/leitura vazia, sem prova de conteúdo histórico, envio ou disputa de posse.
- Importação foi aberta somente pelos perfis autorizados (admin e gerente Vendas); a URL foi negada nos demais perfis testados. Nenhum arquivo foi importado.
- Não foi executada matriz completa de todos os subformulários, relatórios/exportações, carteiras estrangeiras com controle positivo, CRUD, agendamento ou concorrência multissessão.

## Proteção da rodada e recheck

Somente o POST de login foi permitido. As requests de negócio mutantes e o GET legado que altera contador
foram bloqueados antes de chegar ao servidor. Os sete perfis autenticados terminaram com ausência dessas
tentativas; somente navegações e leituras modulares. Sem Auth admin/reset, seed, claim, envio de WhatsApp,
marcação de leitura, screenshots, traces, vídeos ou storageState persistente. A configuração de conta ficou
em memória, lida do arquivo local ignorado; os relatórios não contêm credenciais nem corpos de clientes.

O primeiro teste de quadro Peças encontrou duas instâncias intencionais (abertas e encerradas): falso
negativo de seletor, sem defeito do produto comprovado. Corrigido para o primeiro quadro visível e
reexecutado **só Quadro Peças**, com login/guarda obrigatórios, nos dois perfis. Os demais casos aprovados
não foram repetidos. Um bloqueio de rede do sandbox anterior à autenticação de gerente Vendas foi
recuperado com a permissão de execução prevista; sem mudança de credencial.

Suíte versionada: tests/e2e/perfis-readonly.mjs. Runner local privado: work/executar-qa-perfis-005.mjs.
Relatórios por perfil e rechecks preservados em work/qa-perfis-005. Fontes originais e hashes de cada
execução constam dos JSONs; o seletor foi alterado somente depois de terminar o primeiro lote.

Oficina permanece congelada por essa prioridade: SQL local preparado/testado, revisão independente não
executada; adaptador/testes escritos ainda sem execução. Nada aplicado ao dev. Próxima fila confirmada por
Claude/Simão: concluir QA, Oficina só agenda existente+fila/triagem essencial, depois E2E do bot com
simulador e classificação funciona/quebra/depende de chave. F2-3 Revisão e recursos novos congelados;
publicação Vercel por último.
