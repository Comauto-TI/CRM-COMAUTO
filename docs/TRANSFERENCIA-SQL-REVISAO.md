# Transferência entre setores — revisão local do SQL

12/11/2026. Implementação local autorizada diretamente pelo Simão, com revisão do Claude antes
de qualquer aplicação no banco. **Correções T-001/T-002 prontas para revalidação do Claude;
interface de transferência e integração de dev permanecem pendentes.** Nenhum banco remoto,
usuário real, envio ou produção foi alterado pelo Codex.

## Fonte atual e fatias

- SQL final: `supabase/migrations/0006_atendimento.sql`.
- SHA256: `C5221A2388294302B4493338A9A569A060C987516137C76619C759896B14888C`.
- Correção SQL/contratos/CHANGELOG isolada: `bda5b631fd1a24f37d7937513ef023fa8d849d45`, sobre a
  implementação `abb9031`. Revisar o conteúdo final C522 antes de aplicar; abb9031 isolado contém
  os dois bloqueios encontrados pelo Claude.
- Adaptador servidor da nova assinatura: `adf0f6794bfb95e96e3c9c0fb3e87e35c812b522`.
  O aviso estruturado veio em `0bffe79`; autoria bot/sistema no diálogo, em `2bf3e72`.
- Base de upgrade: `abb9031~1` (`2bf3e72`); seu blob0006 é o mesmo de `74cc99e`.
- Dependência: `0004_oficina` antes de `0006`. Um arquivo reaplicável por módulo; WIP anterior
  incompleto não deve ser reaplicado. Não mesclar toda a branch para obter estas fatias.

## Resposta à revisão do Claude

| Item | Resultado local |
|---|---|
| T-001 · Auth compartilhado | Removidos DO, grants e consulta a `auth.users`. `p_ator_email` obrigatório ao final da RPC vem exclusivamente de `u.email` da sessão; campos forjados do form/DTO são ignorados. UUID/ator ativo/setor/unidade continuam revalidados no banco. O mesmo e-mail segue à política e seleção do snapshot central. |
| Assinaturas | RPC de transferência com 10 argumentos, seletor de origem com 7 e política central com 4. Sem DEFAULT; antigas aridades9/6/3 têm DROP explícito, sem CASCADE. Nenhuma outra função/dado é removido. |
| T-002 · Oficina | Retirado UPDATE de descrição; permanece somente o grant adicional de `responsavel_id`. Descrição nova é INSERT; origem e itens reutilizados não são reescritos. Contrato original de Oficina passou. |
| T-003 · Ambiguidade | Intencional: mesmo wamid em ledgers Peças/triagem **e** Vendas é ambíguo. Comentário e casos preservados, incluindo associação inicial com `atendimento_id` nulo. Não escolher um setor nem anexar aos dois. |
| T-004 · Sem destinatário | Permanece `conflito` nesta fatia; código específico/explicação da UI fica registrado como refinamento baixo. |

Remover um GRANT do arquivo não revoga uma ACL historicamente concedida. Claude informou que não
aplicou abb9031 no dev. Esta correção **não executa REVOKE no Auth compartilhado**, não altera
contas nem afirma auditoria das permissões remotas. O contrato MVP de Peças foi restaurado
exatamente à baseline, com os asserts originais estritos de ausência de acesso Auth.

## Comportamento mantido

Uma RPC autoriza origem/posse/versão e destino atuais, reaproveita pedido aberto ou cria um novo,
registra nota/snapshot/evento/aviso/audit e muda a rota atomicamente. Replay reautoriza e não duplica;
falhas reais revertem efeitos. Negócio de origem mantém dados comerciais e histórico.

Fila ou pessoa elegível nos três destinos. Dono existente é preservado; alternativa indicada recebe
somente aviso genérico, sem propriedade/leitura/link. Sem dono, a pessoa escolhida pode receber o
pedido. Vendas/Peças passam a receber entradas no destino; Oficina é só domínio e novas mensagens
vão à central da recepção.

Snapshot contém apenas mensagens autorizadas no contexto de origem, com IDs/intervalo auditados.
Vínculos e leituras originais não são alterados; destino volta a conferir ator, dono, unidade, cliente
não anonimizado e estado. Bot/sistema cliente-visíveis preservam autoria. Nota bruta fica somente no
ledger protegido; descrições/atividades novas são genéricas. Anonimização redige nota/cópias novas,
preserva IDs/audit/vizinhos e reversão de flag não restaura texto. Não certifica retenção dos domínios antigos.

## Validação atual

| Camada | Evidência e limite |
|---|---|
| Todos os contratos SQL | **18 executados por modo ACL**, com/sem defaults permissivos: **16 PASS e 2 falhas também presentes na baseline**, sem falha nova observada. Processo encerrou com código1 pelas duas falhas, não é uma matriz toda verde. |
| Transferência | **428 verificações PASS por modo**, base limpa, reaplicação populada/replay e upgrade real da baseline seguido de contrato/reaplicação. Fonte C522 permaneceu inalterada. |
| Sete regressões Auth + Oficina | Aniversários, vendas-bot, leitura-atendimento, leituras-usuario, lista-atendimentos, mensagens-atendimento, vínculo-vendas e Oficina passaram em ambos os modos, sem enfraquecer seus contratos. |
| Upgrade/reaplicação | Dados e identidades das colunas existentes de **54 tabelas** preservados. Reaplicação comparou dados, schema, ACL, funções e FKs. |
| Adaptador | **140 Vitest PASS** (66 parser +74 wrapper). Ator/e-mail exclusivamente da sessão atual, request forjado ignorado, uma RPC/sem retry, aviso mínimo/mascarado, e-mail não aparece em DTO/erro. Typecheck global passou. |
| Ponte SQL → leitor | **3 casos PASS** no C522: central→Vendas, central→Peças e reuso Peças sem dono com versão positiva. RPC real10args, central assumida por e-mail da fixture, JSON real entregue ao `criarDialogo` original por Next SWC/VM. Autoria/máscara/IDs/direção/pendente booleano e claim com versão real conferidos; fila sem dono não revelou histórico. |
| Revisão independente | Parecer estático do delta abb9031→C522 sem bug material identificado; fechamento de overloads, ausência de dependência Auth, grant Oficina e política/corpo conferidos. Diffcheck/gitleaks das fatias passaram. |

As duas incompatibilidades antigas ocorreram igualmente na baseline e no candidato, nos dois modos:

- `contratos-atendimentos.sql`: `55000`, guarda de posse de Vendas exige devolver antes de encerrar/reatribuir.
- `contratos-pecas.sql`: `P0001`, assert de preservação compara também `atualizado_em`, que o trigger
  existente modifica com `clock_timestamp()`. Contrato e `0005` são iguais aos da baseline.

Esses contratos não foram ajustados para passar nem excluídos. Os resultados antigos402/133 do
hash2141 são históricos e não substituem esta rodada mais ampla.

Artefatos privados: `work/validar-transferencia-t001-t002.mjs`,
`work/transferencia-t001-matriz-false.json` e `work/transferencia-t001-matriz-true.json`.
Usar este runner; `validar-transferencia-setores-atual.mjs` antigo ainda corresponde à assinatura9.
Ponte: `work/validar-ponte-transferencia-dialogo.mjs` / `work/ponte-transferencia-dialogo-resultados.json`.
Contrato versionado: `tests/sql/contratos-transferencia-setores.sql`.

PGlite usa uma conexão por cenário. Fronteiras DB/outbound/env/server-only da ponte foram
substituídas; permissões/guard/validadores são originais. Não são prova de PostgREST, sessão/Auth,
HTTP, navegador, envio WhatsApp ou concorrência multissessão reais. Nenhum novo build/servidor foi iniciado.

## Antes da exposição

1. Claude revalida SQL/ACL e decide a integração de dev; conteúdo final do banco antes do adaptador
   que chama a assinatura10. Sem action/endpoint/UI de transferência expostos nesta fatia.
2. Central: unidade/política antes de contagens, paginação e corpo; fechar extras globais por cliente.
   Autorizar corpo no mesmo contexto, sem IDs usados como ACL posterior.
3. Proteger despacho legado com tentativa/rota/versão/autorização atuais. O SQL não cancela HTTP já
   iniciado entre uma checagem antiga de posse e o envio; NOWAIT não é prova de concorrência real.
4. UI/DTO de nota/snapshot/aviso e estado: não sugerir disponível quando `podeAssumir=false`,
   filtrar segredos/mascarar dados e manter a autoria real.
5. Paginação/exportação autorizadas dos novos dados, login/fluxo real e disputa multissessão.

Agenda manual A/B segue na prioridade combinada após esta fatia. Acompanhamento(C), marketing e
integração são do Claude; revisão do PR9 está em `docs/REVISAO-PR9.md`, ainda requer ajustes.
