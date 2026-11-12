# Oficina essencial — validação para revisão do Claude · 12/11/2026

**SQL e adaptador prontos para revisão cruzada. Nenhuma migration foi aplicada no dev pelo Codex.**
Agenda existente preservada. Esta entrega cobre somente cadastro da solicitação, fila autorizada,
filtro minhas e início da triagem, com as etapas `novo` e `em_triagem`.

| Parte | Referência isolada | Validação |
|---|---|---|
| SQL + contrato | `f6295a6` | Revisão estática independente aprovada no tree `a13b7219`; nenhuma mudança desde a matriz SQL anterior. |
| Adaptador + parser/testes | `3ee0a95` | 88 testes de `oficina-ficha.test.ts` e 7 de `oficina-atendimento.test.ts` passaram em 12/11. |
| Base | `16b873b` / main v0.0.5 | Não foi feita uma mescla geral do PR #8 nesta branch. |

SHA256 de `supabase/migrations/0004_oficina.sql`:
`A210A0A957D347B7BBC44EB5049821446FB20A6EE6D8686BC204D7219A36457B`.

Adaptador `atendimentos.ts`: `22D64066C61E088265CE81289B2511B2418E38A66CAF682B8A2CEA66D3FF11C1`.
Teste `oficina-ficha.test.ts`: `0680C26B9FE925A95F9B25825F0D66153BB2609BAA7C9012676904C0DA5E6191`.

## Evidência e limites

- A revisão independente confirmou a política antes de total/cursor/paginação: recepção/atendente
  têm coletivo das unidades e minhas; consultor, próprias e sem dono; gestão, unidades autorizadas;
  administrador, unidades ativas. Não se autoriza pelo vetor de unidades enviado ao adaptador.
- Ator ativo, unidade, cliente não anonimizado e vínculo do veículo são revalidados no SQL.
  Claim trava a linha, não rouba responsável e o replay não cria outro evento. Cadastro divergente
  é conflito; triagem e histórico integram a mesma chamada transacional.
- 0004 e os contratos SQL são idênticos aos já aprovados localmente em dois modos ACL, com
  reaplicação populada e upgrade de `35d56b2`. A fixture não concede permissões para mascarar
  a migration. Essa matriz não foi repetida, pois não houve alteração/falha que a justificasse.
- Os 95 testes atuais verificaram contrato do adaptador/parser: ator e filtros, cursor com micros,
  DTO mínimo e mascaramento, respostas malformadas, erros sem detalhe interno, telefone canônico,
  recusa prévia de perfis indevidos, criação e triagem. São testes simulados, não prova remota/E2E.
- Nenhuma tela de Oficina foi exposta nesta rodada; nenhuma conta, fixture, posse, mensagem,
  dado externo, SQL remoto, Auth ou configuração de produção foi alterado.

O typecheck global dessa mesma fonte havia passado na rodada de UI/QA. Agora os testes funcionais
que faltavam foram executados. Integração real Supabase/PostgREST, login por perfil e concorrência
multissessão continuam pendentes e não são substituídos por mocks/PGlite/revisão estática.

## Repasse e próxima dependência

Claude deve revisar/incorporar **primeiro o SQL isolado `f6295a6`** e aplicar 0004 no dev antes das telas.
O adaptador é a fatia separada `3ee0a95`; contém também documentação histórica, sem necessidade de
mesclar toda a branch. O vínculo com a Agenda é opcional verificável; nada de calendário paralelo.
Recuperação de órfã, WhatsApp de Oficina, transferências, novas etapas e Revisão permanecem fora do recorte.

O PR #8 foi revalidado e aprovado em `f12e0c1`, com parecer `202a781` na ref `codex/revalidacao-pr8`;
merge/tag/deploy seguem com Claude. A aprovação não foi convertida silenciosamente em nova base aqui.
