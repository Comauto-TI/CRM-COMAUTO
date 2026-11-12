# PR #9 — aprovação funcional após revalidação

12/11/2026. **APROVADO no pin `98156e10781c7e141a0a257c94cfd0d1a63931e2`**, base
`bc14aa1e90e440ec87e6fc88a275c817041b7f87`. Parecer C7 funcional, composto pela revisão inicial
e revalidações dirigidas; não é novo scan de segurança ou prova de integração/concorrência real.
Na consulta GitHub, o PR continuava aberto/não mesclado; nenhuma release/tag v0.0.7 foi inferida.

O fix `69a256e` corrigiu ACOMP003-R1: Desfazer seleciona a última marcação que veio de pendente ou
confirmado, ignorando eventos sem mudança. Salvar na Agenda com o mesmo status retorna sem escrita,
histórico ou audit. Os demais cinco achados haviam sido conferidos no pin5941347 e suas fontes
não mudaram neste delta.

**Nove casos dirigidos passaram**, executando as funções originais do pin por Next SWC/VM:

- Cadeia atual pendente com confirmação antiga → Chegou → Salvar compareceu → Desfazer volta a
  pendente e não cria evento sem mudança.
- Evento sem mudança já existente, produzido pela ação original do pin anterior, não oculta a
  chegada efetiva. Desfazer encontra o `de_status` correto e volta a pendente.
- Controles de confirmado/pendente, ciclos de chegada/ausência/desfazer, CAS, unidade alterada e
  conflito `23P01` preservados.

Raiz leu o delta integral5941347→98156e1: dois arquivos de ações e coordenação. Diffcheck e gitleaks
dos três commits passaram. Evidência privada atual: `work/revisao-pr9-acompanhamento.mjs` e
`work/revisao-pr9-acompanhamento-resultados.json`; originais594/8df preservados separadamente.
Relatórios anteriores `REVISAO-PR9.md` e `REVALIDACAO-PR9.md` continuam como histórico.

Sem repetir marketing/abertura/Oficina/SQL inalterados, sem novo build, login, navegador, servidor,
HTTP, Auth/banco real ou envio nesta revalidação. Claude informou seus checks/rebuilds separadamente;
o Codex não os atribui a esta execução. Integração e publicação permanecem com Claude.

Os gates da futura transferência central são outra fatia, em
`TRANSFERENCIA-CENTRAL-PREREQUISITOS.md`; não foram confundidos com bugs novos deste PR.
