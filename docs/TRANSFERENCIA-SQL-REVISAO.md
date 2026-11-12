# Transferência entre setores — revisão local do SQL

12/11/2026. Implementação autorizada diretamente pelo Simão, na branch local, com revisão do
Claude antes de qualquer aplicação no banco. **Entrega de backend para revisão; não é liberação
da interface de transferência.** Nenhum banco remoto, usuário real, envio ou produção foi alterado.

**Histórico do commit abb9031, ainda não aprovado pelo Claude.** A revisão cruzada posterior encontrou
T-001 (dependência/grants Auth incompatíveis com sete contratos originais) e T-002 (UPDATE de descrição
Oficina excedente). Correção local em andamento no hash `C5221A2388294302B4493338A9A569A060C987516137C76619C759896B14888C`:
e-mail confiável da sessão como parâmetro, sem leitura/grants Auth; UPDATE só de responsável.
Os resultados 402 abaixo pertencem ao hash antigo e não certificam a revisão nova. A matriz completa
e a nova evidência serão anexadas após a execução; nenhum grant será revogado no Auth compartilhado.

## Fonte conferida

- Migration única do módulo: `supabase/migrations/0006_atendimento.sql`.
- Commit isolado SQL/contratos/CHANGELOG: `abb9031bb6a73d17717cdf77fd1c0b13f7c04d10`.
- SHA256: `2141BE5DFB1465C9538704CC86A38043E014D402EE860B747E347D881F7C7853`.
- Base de comparação/upgrade: `74cc99e`, sobre a integração do Claude `588bc1c` e main `v0.0.6`.
- A nova fatia depende de `0004_oficina` antes de `0006`; não criar arquivo timestamp ou reaplicar
  o backup incompleto do contrato anterior.

## Comportamento implementado

Uma chamada a `transferir_atendimento_setor` confere ator, setor/unidade, origem, posse/versão e
destino atuais; reaproveita um pedido aberto ou cria o destino; registra nota/snapshot/evento,
notificação e audit na mesma transação. Replay exato não duplica, argumentos divergentes recusam.
Falhas reais durante a escrita desfazem os efeitos parciais.

Negócio de origem preserva seus dados comerciais e histórico. A rota explícita muda o controle
ativo e impede novo claim/resposta pela versão anterior. Vendas/Peças recebem mensagens novas no
contexto de destino mesmo enquanto aguardam alguém assumir. Oficina recebe só o pedido de domínio;
novas mensagens seguem a central da recepção, sem recuperar histórico genérico por cliente.

O destino aceita fila ou pessoa elegível. Pedido aberto já atribuído mantém o dono; outra pessoa
indicada recebe só aviso, sem adquirir propriedade/leitura. Pedido sem dono pode ser atribuído à
pessoa elegível escolhida. O resultado inclui aviso estruturado de responsável preservado.

Snapshot guarda apenas mensagens do contexto autorizado da origem, com IDs/intervalo auditados,
sem alterar os vínculos originais ou suas leituras. Bot/sistema cliente-visíveis da central
preservam a autoria. Leituras voltam a conferir ator ativo, dono/setor/unidade, cliente não
anonimizado e estado do destino; uma notificação não vira permissão de consulta.

Nota bruta fica somente no ledger protegido. Atividades e descrições novas usam texto genérico;
descrições preexistentes não são reescritas. A anonimização já existente aciona remoção do conteúdo
das novas cópias e da nota desse cliente; IDs/audit e vizinhos permanecem. Reverter a flag não
restaura o texto. Isso não certifica toda a política de retenção dos domínios antigos.

## Validação executada

| Camada | Evidência e limite |
|---|---|
| Contrato SQL novo | **402 verificações** passaram em cada modo de ACL (com/sem defaults permissivos), em base limpa, upgrade real, reaplicação populada e replay. Fonte permaneceu inalterada. |
| Upgrade | Dados/colunas de **54 tabelas** e **115 FKs legadas** preservados; sem backfill de dados fictícios. |
| Regressões dirigidas | Peças atendimento, Vendas atendimento, retorno ao legado e cotação sem canal passaram nos dois modos. |
| Auth mínimo | Contrato confere leitura apenas de `auth.users.id/email` pelo servidor, sem DML, colunas sensíveis ou acesso de navegador. Compatibilidade de stub só-ID e stub com e-mail/colunas sensíveis fictícias passou nos dois modos. |
| Parser/adaptador da transferência (`0bffe79`) | **133 testes** passaram; ator vem da sessão, uma RPC, sem retry automático, DTO mínimo e aviso validado/mascarado. São RPCs simuladas. |
| Compatibilidade dos diálogos (`2bf3e72`) | **104 testes** passaram em Peças/Vendas; saída de bot/sistema preservada, direção validada, pendência só para saída bloqueada de atendente. Não são os antigos 104 de transferência. |
| SQL → adaptador original | **3 casos dirigidos** passaram com JSON real de PGlite entregue ao `criarDialogo` original (Next SWC/VM), antes/depois do claim: central→Vendas, central→Peças e reuso Peças sem dono com versão positiva. Autoria cliente/bot/sistema, IDs únicos, pendente booleano e mascaramento real de CPF/cartão conferidos; interno/outro negócio omitidos. Fronteiras DB/outbound/env/server-only substituídas, sem HTTP/Auth/UI reais. |
| Revisões | Revisão independente identificou e conferiu a correção da guarda NULL da rota e das cópias da nota; parecer final no hash acima. Typecheck, diffcheck e gitleaks das fatias TypeScript passaram. |

A suíte cobre nove caminhos entre central e setores; fila/pessoa; reuso e autoria; unidades/atores
revogados; origem sem atendimento modular tentando desviar rota alheia; ambiguidade inicial;
veículo reatribuído; envio reservado/incerto; snapshot/contexto e leituras antigas; anonimização;
falhas forçadas em destino, snapshot, notificação e audit, com comparação integral antes/depois.

O contrato antigo `contratos-atendimentos.sql` **não passou**: falha `55000` na guarda de posse de
Vendas também na baseline `74cc99e`. A comparação foi executada e ficou registrada. Não chamar a
validação de toda a matriz antiga de aprovada, nem esconder essa incompatibilidade preexistente.

Artefatos privados do trabalho: `work/transferencia-sql-atual-resultados.json` e
`work/validar-transferencia-setores-atual.mjs`. O contrato reproduzível fica versionado em
`tests/sql/contratos-transferencia-setores.sql`. PGlite usa uma conexão: **não comprova disputa
multissessão, PostgREST, login, HTTP real ou envio WhatsApp**.

A ponte dirigida está em `work/validar-ponte-transferencia-dialogo.mjs` e
`work/ponte-transferencia-dialogo-resultados.json`, sem repetir a matriz SQL nem alterar fontes.
O caso sem dono confirma versão real no resumo vazio, seguida de claim com essa versão e leitura
autorizada das mensagens. O harness confere o hash final de `0006` e fonte original de permissões,
guard e validadores; não é E2E de navegador ou de sessão.

## Pontos para a revisão do Claude

O diff concede ao `service_role` leitura mínima de `auth.users.id/email`, quando a coluna existe,
para relacionar o UUID autenticado à posse legada guardada por e-mail. Não concede escrita ou
colunas adicionais; não altera usuários/metadata. O assert antigo que proibia todo USAGE do schema
foi substituído por verificações específicas mais restritas sobre as colunas permitidas/negadas.
Esse é um delta intencional para revisar, sem alegar auditoria das ACLs do projeto remoto.

Locks novos usam `NOWAIT`; indisponibilidade/deadlock vira conflito com rollback, sem retry. Isso
não é evidência de concorrência real nem promessa de cancelar HTTP que já começou a ser enviado.

## Antes de expor transferência ao usuário

1. Claude revisa o SQL/ACL e decide a integração de dev; banco antes do código que chama a RPC.
2. Fechar os caminhos da central que o piloto atravessa: unidade/política antes de contagem,
   paginação e corpo; dados globais por cliente não acompanham a transferência automaticamente.
   Autorizar leitura/corpo no mesmo contexto, sem IDs usados como ACL posterior.
3. Proteger despacho legado da central com tentativa/versão/rota e autorização atuais. Hoje ele
   pode checar a posse antes e despachar depois; o SQL sozinho não cancela esse intervalo.
4. Adaptar UI/DTO de nota/snapshot e aviso de responsável preservado. Não mostrar "disponível"
   quando `podeAssumir=false`; não transformar histórico do assistente em fala de atendente.
   Filtrar segredos na saída e mascarar dados; o SQL filtra formatos conhecidos, sem receber env.
5. Completar leitura/paginação e exportação dos novos dados no código autorizado, sem histórico
   por cliente ou marcas de leitura herdadas. Validar login, fluxo real e concorrência antes do aceite.

Agenda manual A/B permanece na próxima prioridade combinada, seguida das etapas de interface/
métricas/E2E conforme o Claude e Simão coordenarem. Acompanhamento do dia permanece com Claude.
