# Etapas — Plataforma Comauto (Chatbot + CRM)

Fonte das decisões: `chatdesenvolvimento.txt` (consenso Claude × Codex aprovado pelo Simão em 10/11/2026).
Atualize o status aqui sempre que concluir algo.

> **Preparar desde já para a F8:** toda mudança de etapa (vendas, oficina, peças) grava data/hora e quem mudou — sem esse histórico não há funil nem previsão depois. Legenda: ⬜ a fazer · 🟨 em andamento · ✅ pronto · ⛔ bloqueado.

## Regras de convivência
- **Claude** = engenheiro-chefe: fundação (núcleo), Vendas, chatbot→CRM, vínculos Avaliex e Processo de Vendas, Bravus, aniversários, visão do admin.
- **Codex** = executor: Oficina/Agenda, Peças, vínculo Revisão, testes e2e/SQL de tudo, revisão dos PRs do Claude, apoio em Novos/Seminovos.
- Branches `claude/*` e `codex/*`; PR para `main` revisado pelo outro. Achados de revisão em `docs/apontamentos-codex.txt`.
- **A F0 precede as alterações compartilhadas dos módulos**: o Codex começa Oficina/Peças quando a F0-2 (núcleo) estiver ✅.
- Migrations por módulo: `0002_nucleo` e `0003_vendas` (Claude), `0004_oficina` e `0005_pecas` (Codex). Nada de alterar tabela na mão.
- Banco de desenvolvimento do CRM: Ambiente de testes (`csgrnmoyowjhzlibbilk`). Conferir a referência e usar o token restrito ao projeto antes de alterar o banco. O token da organização fica reservado para consulta. Preservar `empresas`, `profiles`, `propostas`, `convites` e os usuários de Auth dos demais sistemas. Credenciais em configuração local, fora do Git.
- Antes de comando destrutivo no banco: perguntar ao Simão.

## F0 — Fundação (Claude)
| # | Tarefa | Status | Pronto quando |
|---|---|---|---|
| F0-1 | Repositório Git + GitHub `Comauto-TI/CRM-COMAUTO` | ✅ `main` + tag v0.0.1 no GitHub; PR #1 (F0) aberto para revisão do Codex | `main` no GitHub, gitleaks limpo |
| F0-2 | Núcleo multiunidade (`0002_nucleo`): `unidades`, `usuarios` (setor/papel/unidade), `usuario_unidades`, cliente ampliado (CPF/CNPJ, nascimento, vendedor da carteira, ids externos), veículo ampliado (chassi, renavam), `notificacoes`, `lembretes`, `unidade` nas tabelas operacionais | ✅ `0002` validada no PR #1 (`16c1638`) e APLICADA no banco de dev em 10/11 (usuarios, unidades, travas de unidade, índices de busca conferidos) | Migration aplicada no banco de dev; testes verdes |
| F0-3 | Contexto de acesso: `exigirPapel` devolve usuário + setor + papel + unidade; RLS por unidade como 2ª barreira | 🟨 `exigirAcesso(area)` + mapa `src/lib/permissoes.ts` (testado) em todas as páginas/APIs; 0002 aplicada no dev. Bloqueio por unidade validado em fixtures do db2d58f. F0-3-004-R1 revalidado no snapshot bb85c40 para erro de gravação, recusa e auditoria após sucesso; validação por perfil segue para integração. F0-TEL-001 revalidado no bb85c40: as duas variantes gravaram na ficha antiga após a colisão. RLS por unidade junto com a primeira tela multiunidade | Usuário de um setor não abre página de outro |
| F0-4 | Casca comum: menu por setor, busca global (CPF, telefone, nome), central de notificações | 🟨 menu por permissão, busca global (`/painel/busca`) e sino + `/painel/notificacoes` prontos; notificações ligam com a 0002 | Busca acha cliente em todo o grupo; sino mostra avisos |
| F0-5 | PWA instalável (manifest + ícones) | ✅ manifest + ícones (sem service worker, para não guardar dado do painel no navegador); instalar exige HTTPS → depende da F0-6 | Instala como app num PC da Comauto |
| F0-6 | Deploy na Vercel | ⛔ aguarda token válido da Vercel | Painel acessível pela internet com login |

## F1 — Setores (em paralelo, após F0-2)
| # | Tarefa | Dono | Status |
|---|---|---|---|
| F1-V | Vendas: funis Novos/Seminovos, etapas configuráveis (Novo → Em atendimento → Negociação → Proposta → Ganho/Perdido), cartões com arrastar, qualificação separada da etapa, carteira. **Referência visual (Simão, 10/11):** colunas por etapa com cartões, faixa do funil com % no topo, KPIs ao lado e painel de detalhe do cartão à direita (com conversa) | Claude | 🟨 `0003_vendas` + módulo + `/painel/vendas` (funil, kanban com arrastar, ficha, tarefas, contatos, histórico) na branch `claude/f1-vendas` (PR #2), 0003 aplicada no dev em 10/11 e testada no navegador (criar, arrastar, histórico). Revalidação de 438d361 confirmou seis correções. F1-V-005-R1 revalidado em db2d58f, em instalação limpa e upgrades locais. A recuperação de motivos depende de registro disponível. Barras do funil de Vendas mais estreitas e juntas no commit 93ebeac. Prévia de faixa contínua como referência para F8. Transferências c650eb5 revisadas em fixture local: F1-V-T001–T005 corrigidos pelo Claude em 11/11 (RPC vendas_transferir atômica aplicada no dev, destino validado por setor/unidade, lote paginado por unidade, setter legado removido). Revalidação com Codex |
| F1-O | Oficina/Agenda: fila, triagem, reserva/confirmação/reagendamento, histórico e vínculo externo | Codex | 🟨 fila e triagem atualizadas para main v0.0.2 no commit 35d56b2 em codex/oficina-v002. Menu agrupado e ficha pelos dois formatos do celular. Typecheck, 607 Vitest e contratos SQL locais passaram. Vínculo com Agenda segue para revisão cruzada e validação de acesso |
| F1-P | Peças: conversas e leads, promoções, cotação, acompanhamento e registro da venda (+ perda/cancelamento), valores comerciais e métricas | Codex | 🟨 PR #3 revisado pelo Claude. F1-P-001/002/003 tratados no commit 28f9aea em codex/pecas-v002: migration 0005 reaplicável, reatribuição por gestão com histórico e retomada de órfãs, fila aberta/encerrada com paginação. Typecheck, 643 Vitest e contratos PGlite com reaplicação sobre dados preenchidos/ACL passaram. Fluxo comercial até Venda confirmada, sem controles de estoque/preparo/entrega na tela. Referência local atualizada para o Claude publicar e revisar; merge 0.0.3 e aplicação no dev ficam com ele. Vínculo Oficina → Peças em codex/oficina-pecas-v002 (0868487) aguarda incorporar estes ajustes após a revisão |

## F2 — Chatbot → CRM e vínculos
| # | Tarefa | Dono | Status |
|---|---|---|---|
| F2-1 | `qualificar_lead` no agente; cartão no setor certo; confirmado pelo cliente × a verificar; triagem humana para intenção incerta | Claude | 🟨 integração original ligada ao bot no dev pelo Claude. Continuidade Codex: encaminhamentos corrigidos em 2d8292f (codex/atendimento-modulos), tratando F2-P-001/002/003: transação única de cotação/nota/avisos, identidade da mensagem e conversa, replay sem duplicação e equipe por unidade principal/extra. Typecheck, 669 Vitest, SQL PGlite e revisão independente passaram. Nova migration 20261111130139_encaminhamentos_bot e código ainda aguardam integração no dev; acesso completo por módulo é a próxima etapa |
| F2-2 | Vínculo manual por ID/link: Avaliex e Processo de Vendas | Claude | 🟨 pronto em `claude/f1-vendas` e testado no dev: colar link ou ID da proposta/avaliação no cartão, link exibido sempre montado do endereço oficial, aviso de proposta já vinculada e de unidade diferente; situação automática fica na F3 |
| F2-3 | Vínculo manual por ID/link: Revisão | Codex | 🟨 Revisão local confirmou a rota por unidade. O acesso direto ao registro precisa de rota interna autenticada por unidade, tipo e ID. Links públicos de assinatura ficam fora do vínculo |

## Piloto Comauto

Equipe corrigida em f6370a1 (codex/atendimento-modulos): EQUIPE-001–004 tratados com origem do login controlada pelo servidor, proteção do próprio admin, recuperação de cadastro parcial e paginação do Auth. Typecheck e 701 Vitest passaram, com revisão independente. Sem alterar Auth remoto; integração do código ao dev ainda pendente.
QR Code + filas → validação → lote de até 10 convites autorizados. Instalação como app num PC da Comauto.

## Depois do piloto
| Fase | Tarefa | Dono |
|---|---|---|
| F3 | Consulta automática de status (sob demanda, cache 5 min, "desatualizado" em falha) conforme acessos liberados. Contrato de leitura do Processo de Vendas conferido no código local: empresa e ID da proposta → status. Integração aguarda identidade de leitura com escopo por empresa e mapeamento de unidades | Claude (Avaliex, PV) · Codex (Revisão) |
| F4 | Importação Bravus em lotes (amostra anonimizada, prévia de duplicados, repetição idempotente) | Claude (+ testes Codex) |
| F5 | Aniversários e lembrete insistente | Codex (continuidade autorizada) | 🟨 F5-001–005 corrigidos localmente em 67983b5, codex/atendimento-modulos. Contato verificável, fuso local, paginação, lembrete sem expiração, RPC atômica e erro visível. Typecheck, 775 Vitest e SQL local com/sem defaults passaram. Migration 20261111134242_aniversarios_contatos e código ainda aguardam integração/revisão no dev; sem E2E por login nesta rodada |
| F6 | Visão geral do administrador | Claude |
| F7 | Captação e IA | Ambos |
| F2-4 | **Lembretes e mensagens agendadas** (pedido do Simão, 10/11): o usuário agenda um lembrete para si sobre um cliente específico (vira pop-up na hora) ou agenda uma mensagem para o cliente. A mensagem sai pelo `outbound.ts`: dentro da janela de 24h texto livre; fora dela só template aprovado e com consentimento do tipo certo (senão o sistema avisa e não envia) | Claude | 🟨 pronto em `claude/f1-vendas` e testado no dev: agendar pelo cartão de Vendas, pop-up na hora, mensagem respeitando opt-out/janela/template, aviso de falha; página Meus lembretes. Ficha do cliente incorporada na F2-5. F2-4-001 revalidado com transporte simulado no 4e9bb90. F2-4-001-R1 revalidado no 35ee85d: reservas legadas e antigas encerradas como resultado incerto, com aviso e sem reenvio. Reservas recentes preservadas. Concorrência real no banco segue pendente |
| F2-5 | **Aba Clientes reorganizada** (pedido do Simão, 10/11): lista mais organizada no padrão do quadro (filtros no topo, ficha com abas: dados, veículos, oportunidades, agendamentos, conversas, lembretes) | Claude | 🟨 pronta em `claude/f1-vendas` e testada no dev: filtros + atalhos (carteira, novos no mês, falaram 7 dias), lista enxuta e ficha lateral (autorizações, veículos, oportunidades, agendamentos, lembrete/mensagem, LGPD) |
| F8 | 🟨 **F8 v1 pronta antes do piloto (decisão do Simão, 10/11)** em `claude/f1-vendas`: /painel/metricas com KPIs, funil contínuo (desenho do Codex), previsão do mês com confiança, conversão por vendedor/origem, tempo por etapa, motivos de perda e funil de eventos (Chamados → Confirmados → Presentes → Vendidos). F8-001 revalidado no carregador do bb85c40. F8-001-R1: origem_ref do lead de link usa código, enquanto a métrica exige o ID do evento. F8-002 revalidado com 5.200 oportunidades. F8-002-R1: histórico por lote sem paginação pode truncar tempos e chances quando a API limita linhas. **Aba Métricas e previsões** (pedido do Simão, 10/11). Centraliza o dashboard e os relatórios, incluindo o funil de Vendas e a seção Eventos. Funil de conversão por etapa com % e volume (Novos, Seminovos, Oficina, Peças, chatbot/QR/campanhas), tempo médio por etapa, conversão por vendedor/origem/unidade; **previsões** que melhoram com o histórico (vendas do mês, agenda da oficina, demanda de peças) a partir de séries diárias guardadas no banco; metas definidas pelos dados que já temos. Começa simples (médias móveis e taxa histórica por etapa), sem prometer precisão antes de ter volume | Claude (painel e modelo de previsão) · Codex (consultas SQL/views, testes de cálculo e de carga) |
| F9 | **Otimização dos layouts (ETAPA FINAL, decisão do Simão 11/11)**: depois que tudo estiver validado, Simão + Claude revisam tela por tela para reduzir a densidade de informação (o que é essencial fica à vista; o resto em abas, detalhes ou ao passar o mouse) sem perder o que é importante. Até lá a prioridade é função | Claude + Simão |

## F8 — visão do Codex

Proposta complementar para a aba **Métricas**, depois do piloto e com dados consistentes. O Simão compara as duas visões antes da implementação.

- **Referência visual.** Usar o painel enviado pelo Simão como referência de composição. Cards com números principais e funil de conversão no topo, com detalhamento por etapa e filtros abaixo. Reutilizar o funil de Vendas com entrada mais grossa, afunilamento proporcional e transição de cores.
- **Conversão por operação.** Vendas acompanha lead recebido, qualificação, proposta e venda, separando Novos e Seminovos. Oficina acompanha pedido, agendamento e comparecimento. Peças acompanha cotação, aprovação e venda confirmada. Filtrar por período, unidade, setor, responsável e origem ou campanha quando disponível. Exibir contagens e taxas com base no mesmo conjunto de registros.
- **Eventos.** Seção por evento e unidade. O funil principal segue **Chamados → Confirmados → Presentes → Vendidos**. A base conta pessoas únicas com convite ou contato registrado para o evento. Em Vendidos, contar pessoas desse grupo com presença e venda confirmada atribuída ao evento. Público selecionado, qualificação, oportunidades e propostas ficam no detalhamento conforme os registros disponíveis.
  - **Comunicação.** Acompanhar convites entregues, lidos e respondidos quando o canal registrar esses dados. Exibir como etapas intermediárias se for possível vincular os registros ao mesmo grupo de pessoas. Com dados parciais, mostrar como indicadores ao lado.
  - **Conversão.** Contar pessoas únicas no mesmo grupo por evento e mostrar o total e a taxa de passagem em cada etapa. Inscrições espontâneas, lista de espera, recusas, cancelamentos e faltas têm contagens separadas. Propostas e vendas entram quando o vínculo com o evento estiver registrado.
- **Indicadores configuráveis.** A gestão escolhe nome, eventos de início e fim, filtros, meta e período. Mostrar fórmula, quantidade de registros e fonte de cada indicador. Versionar alterações de definição para manter comparações históricas verificáveis.
- **Previsões.** Começar pelas séries históricas de conversão, volume e prazo. Validar as estimativas contra períodos anteriores, separar realizado de previsto e mostrar horizonte e faixa de incerteza. Exibir o histórico observado quando a amostra ainda for insuficiente para prever.
- **Dependência dos dados.** Usar origem e histórico de eventos do CRM, com desfechos oficiais dos sistemas vinculados quando conferidos. Respeitar permissões por unidade e setor. Na F1, preservar os registros de etapa, responsável e data já previstos no fluxo.

**Aceite:** a gestão consegue conferir uma taxa e seu denominador contra os registros da origem, mudar a meta sem perder o histórico da definição e distinguir realizado, previsão e histórico insuficiente.

## Preparação F1 — Oficina, Agenda e Peças (Codex)

**Status da preparação:** ✅ fluxos e critérios de aceite definidos. Base verificada em 10/11/2026 com typecheck aprovado e 532 testes Vitest aprovados. F0-2 está aplicada no dev. F1-O e F1-P seguem em branches isoladas. As telas entram no painel após validar os acessos da F0-3.

### F1-O — Oficina e Agenda

- A fila mostra unidade, cliente, veículo, serviço ou problema, responsável e próxima ação. Fluxo: **Novo → Em triagem → Aguardando cliente → Agendado → Em atendimento → Concluído**. Cancelamento e falta ficam no histórico.
- Reutilizar a agenda do CRM e seus recursos, horários e bloqueios. A agenda é a referência para os horários do piloto Comauto. Antes do piloto, a equipe lança os compromissos existentes e os bloqueios dos recursos disponibilizados.
- Só mover para **Agendado** quando a reserva estiver gravada e vinculada ao atendimento. Ao perder uma disputa por horário, mostrar alternativas sem confirmar nem mover o cartão. Reagendamento e cancelamento preservam o histórico.
- Um atendimento pode originar uma cotação de Peças e receber referência de uma oferta ou orçamento extra no Revisão. A execução e a aprovação do orçamento oficial permanecem no Revisão.

### F1-P — Peças

**Escopo de Peças confirmado pelo Simão em 11/11/2026:** CRM comercial para conversas com leads, qualificação, promoções/anúncios autorizados, cotação e acompanhamento da venda. Estoque, disponibilidade física, reserva, separação operacional e faturamento pertencem aos sistemas oficiais da empresa. Quantidades e preços na cotação descrevem a negociação. O CRM registra o atendimento e a conversão.

- **Balcão** cria um pedido próprio. **Oficina** abre o pedido a partir do atendimento, mantendo a mesma ficha e veículo. A fila diferencia origem, responsável, prazo e próxima ação.
- O fluxo comercial acompanha **Novo → Em cotação → Aguardando cliente → Aprovado → Venda confirmada**, com perda e cancelamento registrados. O responsável conduz a conversa, informa os valores consultados na origem e registra prazo e próxima ação. Revisar os controles locais de preparo e entrega antes de integrar, conforme o foco comercial confirmado.
- Acompanhar cotação, aprovação e venda confirmada separadamente. A margem bruta usa valor de venda e custo quando o custo estiver informado. A operação de estoque e o faturamento são responsabilidade dos sistemas oficiais da empresa.
- A cotação de balcão nasce no CRM. A cotação da Oficina pode apontar para um orçamento extra que já existe no Revisão, mantendo o ID e o status da origem separados da etapa comercial do cartão.

### Validação para o piloto

| Caso | Resultado exigido |
|---|---|
| O-01 · Bot e recepção tentam reservar o mesmo recurso e horário | Uma reserva é confirmada. A outra tentativa recebe conflito e horários alternativos. |
| O-02 · Reagendar e cancelar | A agenda e o cartão exibem a situação correta, liberam o horário quando aplicável e preservam a trilha do que mudou. |
| P-01 · Balcão e Oficina | Dois pedidos percorrem a fila de Peças, com origem, responsável e vínculo corretos. Repetir a mesma ação não cria pedido ou venda duplicados. |
| P-02 · Venda e custo | Aprovação ainda não conta como venda. Após confirmar a venda, o total confere com os itens e a margem só aparece para venda com custo registrado. |
| A-01 · Unidade e setor | A mesma ficha é localizável no grupo. Operadores veem e alteram apenas os atendimentos permitidos. |
| R-01 · Vínculo com Revisão | O link manual funciona com unidade, tipo e ID. Quando a consulta de status for liberada, falha da origem sinaliza status desatualizado e preserva o cartão. |
| V-01 · Revisão conjunta com Claude | Validar Novos sem troca, Novos com troca, Seminovos com usado na troca e proposta devolvida. Qualificação, etapa do CRM, status da proposta e avaliação do usado continuam distinguíveis. |

Primeiro PR do Codex após F0-2: módulo em branch `codex/*` com escopo e critérios acima. Mudanças na agenda compartilhada e no núcleo passam pela revisão do Claude. A visão geral do administrador continua em F6, após validar os dados que a alimentam.


## Continuidade por setores — Simão/Codex · 11/11/2026

Direção consolidada em `docs/ATENDIMENTO-POR-SETOR.md`, commit 5ed1660 em `codex/atendimento-modulos`, sobre a entrega 3f71be9 do Claude. Codex assume a continuidade temporária a pedido do Simão, preservando o código e os repasses do Claude. A preparação 5ed1660 documentou a direção; as correções posteriores de runtime estão registradas abaixo. Versão permanece 0.0.3 até a próxima entrega mesclada.

- A organização principal é por **Vendas, Peças, Oficina e Gestão**. Atendimento WhatsApp, relacionamento, carteira e métricas ficam contextualizados no setor. Vendas mantém Novos/Seminovos; Peças também terá relacionamento e métricas próprios; Oficina reutiliza a agenda existente.
- **Vendedor:** sua carteira e métricas. **Gerente:** setor e unidades que gerencia. **Administrador:** todos os setores. A mesma regra vale para consultas, ações, exportações e agregados de métricas.
- **Antes de encaixar a conversa nas telas:** validar no servidor o vínculo lead/atendimento/cotação ↔ conversa ↔ unidade e a posse. Reutilizar a interface e os serviços existentes, com contexto por módulo. A rota geral atual não prova esse contexto sozinha.
- **Validação concluída:** transferências F1-V-T001–T005 revalidadas em ff7c6d4; F2-P-001/002/003 tratados em 2d8292f; EQUIPE-001–004 em f6370a1; F5-001–005 em 67983b5. Correções novas ainda aguardam integração no dev. A1 exige autorização completa de atendimento antes das telas.
- **Próximas etapas:** completar o contrato A1 (mensagens/vínculos, leitura protegida, liberação e transferência de posse, envio e rotas legadas) antes da conversa nas telas; adaptar Oficina; organizar relacionamento e métricas pessoais/setoriais. Ajustes visuais seguem na F9.


**Continuidade 2d8292f — 11/11/2026:** F2-P-001/002/003 tratados localmente e referência de revisão atualizada. Primeiro vínculo persistido entre mensagem, conversa, cliente, unidade, destino e cotação. A1 ainda exige autorização de leitura/envio e posse antes de incorporar a interface. Validar integração da migration e código em dev; sem mudanças de produção. F5 segue pendente; Equipe foi tratada em f6370a1 conforme a continuidade abaixo.


**Continuidade f6370a1 — 11/11/2026:** EQUIPE-001–004 tratados localmente. Contas externas e legadas sem prova de criação pelo CRM preservadas; nenhuma promoção automática por user_metadata. F5 permanece pendente. Próximo foco: contrato de acesso e posse do atendimento modular antes das telas.


## QA por login — 7beb6f0 · 11/11/2026

Simão pediu mais subagentes, com um login por agente, para cobrir todas as telas. Matriz versionada em `docs/TESTES-POR-PERFIL.md`, na branch codex/atendimento-modulos. Rodada 1 preparada por três subagentes: Administrador, Vendedor e Peças. Próximas rodadas: gerentes dos setores, Oficina, Recepção e Financeiro. Usar contextos de navegador e fixtures independentes, um servidor coordenado e somente transporte simulado.

**Preparação concluída; E2E por login NÃO executado.** O ambiente local dedicado ainda precisa de Supabase, configuração, contas e navegador. A suíte atual continua sendo um smoke de administrador; seus seletores foram atualizados para a central atual e a matriz aponta as lacunas A1–A4. Testes de unidade não contam como login real. Typecheck, sintaxe do smoke e diff --check passaram. Nenhuma conta criada ou redefinida.

Levantamento também encontrou a orientação de Lembretes para Vendas no login Peças. A página agora orienta para Clientes e só mostra links compatíveis com a área do usuário; caso Financeiro não ganha link de cliente. Patch revisado pelo subagente de Peças. Links gerados pelo cron continuam na cobertura futura, assim como posse/unidade nos destinos.


## F5 corrigido localmente — 67983b5 · 11/11/2026

Notas administrativas, propostas e automação não contam como contato humano; mensagem precisa ter saída humana bem-sucedida e data a partir da meia-noite local do aniversário. Contato explícito fica em aniversarios_contatos. O lembrete conserva dataAlvo original, sem corte inferior de sete dias; uma data invalidada pela correção do nascimento deixa de insistir sem reescrever o registro. Carteira/auxiliares e popup são paginados; Visão geral ganha Anteriores/Próximos para alcançar além do 15º aniversário.

RPCs invoker registram contato, nota, auditoria e conclusão na mesma transação e serializam ativação/contato por cliente/data. Replays não duplicam nota/auditoria; falha não vira sucesso e o popup só remove após confirmação. Admin ativo pode atuar em qualquer unidade ativa; vendedor só carteira própria e gerente unidades autorizadas. Revisão independente de três subagentes e correções cruzadas concluídas. 775 Vitest, typecheck, diff --check e SQL PGlite com/sem defaults legados, rollback e reaplicação populada passaram.

Limites: sem Auth/banco remoto, transporte real, login/E2E ou prova de concorrência multissessão. Não inferimos contatos a partir de lembretes legados concluídos, pois cancelamento usa o mesmo campo. Meus lembretes continua mostrando apenas registros com hora marcada; não fornece cancelamento de aniversários. Falhas das notificações comuns e demais achados fora de F5 seguem separados. Versão 0.0.3, CHANGELOG em Não lançado. Integrar somente após revisar migration e código correspondentes.

**Próxima fatia A1:** plano técnico em docs/A1-ACESSO-ATENDIMENTOS.md (6f87052), sem runtime implementado. Separa canal físico WhatsApp de atendimento por negócio/setor, prova vínculo/cliente/unidade/posse no banco e fecha rotas legadas antes de compartilhar UI. Começar A1.1 isolada com testes SQL, preservando integrações ainda não presentes de Oficina. Matriz TESTES-POR-PERFIL permanece preparada, não executada.


## A1.1a local — c292c57 · 11/11/2026

Contexto, abertura e posse de atendimento por oportunidade/cotação atribuída implementados localmente em codex/atendimento-modulos. SQL deriva cliente/conversa/unidade e revalida ator ativo, papel/setor, unidade principal/adicional e dono atual; admin global nas unidades ativas. Carteira de cliente não concede acesso à oportunidade transferida para outro vendedor. Sem dono, a atribuição explícita pelo domínio deve preceder a abertura.

Abertura reutiliza ID; claim exige versão exata, conversa humana e posse legada vazia. Canal aceita um atendimento modular; slot, posse, versão e audit são atômicos. Novo dono pode substituir posse obsoleta no mesmo atendimento, enquanto o anterior perde acesso. Snapshot cliente/unidade/conversa divergente é recusado sem rebind. RLS/ACL fechados, invoker e search_path vazio. Wrappers server-only enviam somente referências, versão e ID autenticado; erros não expõem dados.

Validação: typecheck, 846 Vitest e contratos SQL locais service_role passaram com e sem defaults, incluindo permissões, rollback induzido e reaplicação populada. Revisão independente de SQL/wrapper concluída; três subagentes usados. Código e migration 20261111140755_atendimentos_modulares ainda não aplicados no dev. Não houve conta, Auth, banco remoto, mensagem real, login/E2E ou prova multissessão. Versão 0.0.3; CHANGELOG Não lançado.

**A1 não está concluída.** Esta é a fatia A1.1a, sem UI. A reserva não bloqueia todas as APIs legadas; envio modular não está liberado. Pendentes: associação de mensagens e encaminhamentos do bot, Oficina/triagem, filas sem dono, consultas/contadores, liberação/encerramento, transferência completa e envio/legado. Próxima fatia executável: vínculo explícito de mensagens ao atendimento, com prova de cliente/canal/origem e sem atribuir todo histórico legado ao dono atual. Plano detalhado atualizado em docs/A1-ACESSO-ATENDIMENTOS.md.


## A1.1b local — fb4a458 · 11/11/2026

Mensagem inicial de Peças agora tem associação comprovada com encaminhamento do bot e atendimento atribuído. Ator, responsável atual do negócio, unidade e snapshots são revalidados no SQL. Atendimento/cotação/cliente/conversa/unidade/referência precisam coincidir; três FKs compostas preservam as identidades das fontes. Associação e auditoria são atômicas e replay não duplica efeitos. Nenhum histórico foi importado nem mensagem arbitrária anexada por cliente.

Migration 20261111142602_mensagens_atendimento acrescenta a coluna gerada mensagens.entrada_cliente_externa e índices. A FK exige entrada com autor cliente e metadata.interno ausente ou false; mudanças posteriores para interna ou outra identidade ficam barradas. Processamento/status e redação LGPD com metadata={} foram conferidos. Ledger continua sem UPDATE para o serviço. Origem/ref da cotação corroboram a prova sob lock no momento do vínculo; não são congelados eternamente, e o ledger preserva a prova histórica.

Validação: typecheck, 917 Vitest, SQL local service_role com/sem defaults, rollback real da auditoria e reaplicação populada passaram. Contratos anteriores F2, F5 e A1.1a passaram junto com A1.1b na base completa em ambos modos de grants. Revisão independente de SQL e wrapper por subagente; outros dois cuidaram de wrappers/testes e contratos SQL. Sem prova multissessão, login/E2E, Auth/banco remoto ou transporte real. Versão 0.0.3/Não lançado mantida; código e migration aguardam integração no dev. Avaliar tamanho de mensagens e custo da coluna armazenada/índices antes da aplicação.

**A1 ainda em andamento:** esta fatia só cobre a mensagem inicial comprovada de Peças. Vendas ainda não grava proveniência equivalente: origem_ref pode ser link/QR. Próximo foco é registrar essa proveniência na criação/atualização do lead e definir o roteamento das mensagens seguintes por contexto. Permanecem pendentes leitura/contadores, Oficina/triagem, filas sem dono, lifecycle e transferência/posse, envio e bloqueio dos caminhos legados. Nenhum handler, API ou UI foi ligado ao novo vínculo.


## A1.1c local — ac0c5cd · 11/11/2026

Proveniência de Vendas implementada no ramo local do bot. registrar_lead_vendas_bot comprova entrada externa real, cliente/conversa/unidade ativa e funil; vendas_encaminhamentos_bot registra referência, mensagem, oportunidade e resultado original, separando wamid de origem_ref de marketing. FKs compostas impedem retargeting silencioso de mensagem/negócio. Qualificação, atividade, aviso, auditoria, proveniência e eventual carteira são transacionais. Reprocessar a mensagem retorna o resultado original sem repetir efeitos; outro funil com a mesma referência é recusado.

Atualização preserva responsável/temperatura/carteira e decisões qualificado/desqualificado; indefinidos não apagam dados concretos e troca NULL preserva/false limpa. Novo lead prefere carteira elegível (unidade principal/adicional), depois menor carga global e desempates. Trava de rodízio é compartilhada entre unidades deste produtor do bot. Carteira alheia preservada; nova atribuição só preenche NULL. Aviso vai ao dono elegível, senão gerentes do setor/unidades e por último admin ativo global; sem equipe, recusa antes das gravações. Agenda e Peças/triagem preservados.

Validação: typecheck, 1.022 Vitest, contratos SQL locais com/sem defaults, rollback real de audit/atividade/aviso/histórico e reaplicação populada passaram. Cinco contratos F2/F5/A1.1a/A1.1b/Vendas passaram juntos na base completa nos dois modos. Revisão independente de SQL e wrapper/roteamento concluída. Sem multissessão, login/E2E, Auth/banco remoto ou transporte real. Migration 20261111144252_origem_bot_vendas e código ainda aguardam integração no dev. Versão 0.0.3/Não lançado mantida.

**Próximo foco:** ligar essa prova à associação de atendimento de Vendas, com decisão explícita quando uma mensagem tiver encaminhamentos em mais de um setor. Não associar ambos nem conceder histórico por cliente. A1 segue parcial: mensagens seguintes, leitura/contadores, filas sem dono, lifecycle/transferência/posse, Oficina, envio e caminhos legados continuam pendentes. A dedupe cliente/funil é do produtor bot; os caminhos manuais antigos não tomam essas travas. Nenhuma UI de conversa foi liberada.


## A1.1d local — c1f3b30 · 11/11/2026

Associação de Vendas ao atendimento implementada com RPC própria e resolvedor comum por setor; Peças mantém seu contrato. A tabela preserva PK global por mensagem/referência e vínculos Peças existentes, recebendo setor e oportunidade com CHECK de domínio exclusivo e FKs compostas. Sem mover, apagar ou duplicar mensagem. Fonte exata e escopo atual são comprovados antes de informar qualquer ambiguidade, inclusive para impedir sonda de wamid alheio por quem tem outro atendimento próprio.

Uma referência presente nos ledgers de Peças/triagem e Vendas bloqueia vínculo, replay e a nova guarda de leitura, sem nomes/IDs de terceiros. Se a segunda origem chega após vínculo, a linha fica preservada mas novas autorizações recusam até resolução explícita futura. autorizar_mensagem_atendimento exige associação exata já existente e retorna só IDs/ref/setor, sem texto. Não é permissão reutilizável: A1.2 deve autorizar e consultar o corpo dentro da mesma transação. A guarda não impede outra ferramenta de criar origem depois; novas leituras precisam revalidar.

Typecheck, 1.090 Vitest, SQL local com/sem defaults, upgrade de Peças populada, rollback real da auditoria e reaplicação passaram. Os seis contratos SQL passaram juntos na base completa nos dois modos. Três subagentes dividiram wrappers/testes, contratos SQL e revisão independente; nenhum bloqueante restante. Sem multissessão, login/E2E, corpo/histórico, envio, UI ou banco remoto. Migration 20261111150300_vinculo_vendas_atendimento e código aguardam integração no dev. Versão 0.0.3/Não lançado mantida.

**Próxima parte A1.2:** leitura paginada/contadores de mensagens explicitamente associadas e autorizadas, com DTO mínimo, política antes de paginação/contagens e autorização+consulta na mesma transação. IDs retornados pela guarda não autorizam um SELECT posterior separado. A1 ainda exige mensagens seguintes, resolução de ambiguidades, filas sem dono, Oficina/triagem, lifecycle/transferência/posse, envio e fechamento das rotas legadas; não integrar a conversa às telas antes dessas provas.


## A1.2a local — c2cb788 · 11/11/2026

Leitura paginada e total de mensagens de um atendimento atribuível/autorizado em Peças ou Vendas, sem UI. A RPC ler_mensagens_atendimento revalida domínio/responsável atual, ator, setor, unidade, cliente, canal e associação explícita. Origem e ambiguidade são filtradas antes de contar/paginar. Autorização, corpo, total, sinal de revisão e cursor derivam da mesma consulta/snapshot na transação; não se usa ID de guarda anterior como permissão reutilizável. O resolvedor pontual compartilha a prova STABLE de origem, sem transformá-la em autorização do ator.

DTO mínimo com conteúdo mascarado pelo helper de CPF/cartão, tipo, data, status e autor/direção; sem metadata, telefone ou dados de outro negócio. Paginação por criado_em/ID preserva microssegundos e valida cursor ainda autorizado no mesmo atendimento. Total considera apenas mensagens autorizadas, independentemente do cursor. revisaoPendente avisa sobre associações próprias sem prova/ambíguas, sem IDs, corpos ou contagem omitida. Histórico não associado do mesmo cliente continua fora. Nenhum contador físico/leitura/claim/auditoria é alterado pelo GET.

Correção isolada d5be89c exige UUID com 36 caracteres nos wrappers de atendimento/encaminhamento/qualificação/aniversários e nas respostas, recusando a quebra de linha que a âncora do regex aceitava. Sem trim nem mudança de referências opacas.

Validação: 1.232 Vitest em 28 arquivos, typecheck, diffcheck e sete contratos SQL juntos na base PGlite completa, com e sem defaults permissivos. Paginação real de 1.005 mensagens sem perda/duplicação, empates e microssegundos, mudança de origem após vínculo, cursor inválido/oculto, transferências/revogações e ausência de mutações. Wrappers, SQL e revisão independente divididos entre três subagentes; sem bloqueantes no recorte. Migration 20261111152147_leitura_mensagens_atendimento, SHA256 16531AB8193B934513B708F21A0A489331AD23D4CBE2DAA70573AA86E4B9868E. Código e migrations ainda aguardam integração no dev. Versão 0.0.3/Não lançado mantida.

**Próxima parte A1.2b:** lista de atendimentos, prévias e totais/contadores com a mesma política, aplicada antes de paginação e agregação; leitura por usuário é separada do contador físico do canal. A1 permanece parcial: mensagens seguintes/roteamento, resolução de origem ambígua, filas sem dono, Oficina/triagem, lifecycle/posse/transferências, envio e caminhos legados. Sem login real/E2E, concorrência multissessão ou banco remoto. Não integrar UI/envio antes das provas e fechamento dos caminhos legados; avaliar volume/custo da coluna gerada e índices antes de aplicar no dev.


## A1.2b local — ca79618 · 11/11/2026

Lista de atendimentos por setor, prévias e totais implementados sem UI. Fonte comum SQL STABLE de autorização no detalhe e na lista: ator/papel/setor/unidade principal ou extra (admin global), cliente não anonimizado, negócio aberto e atribuído, responsável atual/supervisão e snapshots exatos. Associações e origem também compartilham helper; nenhum helper de origem isolado concede acesso ao ator. O detalhe mantém locks e novo gate final 404. Lista autoriza, prova origem, conta e busca prévia na mesma consulta/snapshot, sem contexto PL/pgSQL por linha.

Totais globais do setor antes do cursor, só no escopo autorizado. Atendimento sem mensagens permanece com prévia nula. Origem ambígua ou sem prova atual fica fora do total/prévia e sinaliza revisão sem expor itens omitidos; legado sem associação não acompanha o cliente. Ordem da lista por criação/ID do atendimento; a última mensagem autorizada define só a prévia. Cursor revogado/alheio/data divergente é recusado sem totais. Materializa IDs/datas para contagem e busca corpo só das prévias da página; contagem global ainda examina todo o conjunto autorizado.

DTO mínimo, nome e conteúdo com CPF/cartão mascarados; depois corte Unicode de 160 caracteres na prévia. Validadores/DTO temporais compartilhados com o detalhe, microssegundos preservados e retorno incoerente recusado. Não altera contador físico, marcas de leitura, posse ou negócio. Totais não representam não lidas. Versão 0.0.3/Não lançado mantida.

Validação: 1.322 Vitest/29 arquivos, typecheck e diffcheck; oito contratos SQL na base completa, com/sem defaults permissivos, reaplicação populada e ACL. Lista paginou 1.005 atendimentos (1.001 empates mais micros), comparou os escopos com expectativas explícitas e com o contexto anterior, incluindo transferências/revogação/owner inativo sob gestão. Revisão independente: 154 comparações em 11 perfis, lista/prévia/detalhe equivalentes, dados inalterados em 17 tabelas. Três subagentes dividiram wrappers/testes, SQL e revisão. Migration 20261111154525_lista_atendimentos, SHA256 56BD1145D69075FDD0AED307E8A62A850E8410E78E42D67F62A6BAFD9B3E231F. Código/migrations aguardam integração no dev; sem login real/E2E, multissessão ou banco remoto.

**Próxima parte A1.2c:** marcas explícitas de leitura e não lidas por atendimento/usuário, sem zerar o canal físico nem marcar itens omitidos. A1 permanece parcial: mensagens seguintes/roteamento, resolução de ambiguidades, Oficina/triagem, filas sem dono, lifecycle/posse/transferências, envio e fechamento do legado antes da UI. Validar migrations/contexto/custo de índices e volume no destino antes da integração de dev; produção/operações destrutivas seguem com autorização específica.


## A1.2c local — 84b95e5 · 11/11/2026

Marcas explícitas de leitura por atendimento/mensagem/usuário e contadores pessoais implementados em três RPCs novas. RLS fechado; FK composta comprova o par da associação, FK do usuário acompanha sua exclusão administrativa já existente. Serviço só lê e insere referências, sem informar horário, atualizar ou apagar marcas. Sem backfill, cópia entre usuários ou watermark temporal. Contratos de lista/detalhe existentes preservados; nenhuma integração de UI.

Marcação de 1 a 100 IDs únicos, revalidando contexto/locks e escopo/prova no mesmo statement do INSERT. A validade integral do lote é predicado da escrita: qualquer mensagem ausente, fora do vínculo ou sem prova/ambígua recusa todo o lote sem revelar quais IDs falharam. Replay revalida inclusive marcas antigas e mantém o primeiro horário, com marcadas=0 se não houver novos registros. O estado por atendimento e resumo por setor contam somente associações atualmente autorizadas e marcas do ator; não devolvem conteúdo/IDs omitidos. Transferência não herda leitura do vendedor anterior; retorno do mesmo usuário preserva suas marcas. Ambiguidade posterior tira a mensagem das contagens sem apagar a marca histórica.

Validação: 1.409 Vitest/30 arquivos, typecheck, diffcheck e nove contratos SQL locais compatíveis nos dois modos de defaults, incluindo 1.005 mensagens, isolamento pessoal/setorial, lote misto sem efeito parcial, replay/timestamp, mensagem associada com data antiga, revogações, ambiguidade e reaplicação. Revisão independente confirmou rollback por falha CHECK no segundo INSERT, FKs, timestamp explícito negado, cascade do usuário sintético e ACL. As 17 tabelas do núcleo observadas permaneceram iguais; só a nova tabela recebeu marcas. Três subagentes dividiram wrapper/testes, SQL e revisão, sem bloqueantes no recorte. Migration 20261111160139_leituras_usuario_atendimento, SHA256 5E35495E465FB8054718147DB4620C6277BD1E7978D5A56CA9836B7E093131E6. Versão 0.0.3/Não lançado.

Próximo foco: A1.3 em fatias, começando pela revisão de posse, liberação do canal e transferências com versão/autorização atuais. A1 permanece parcial: mensagens seguintes/roteamento, resolução de ambiguidades, Oficina/triagem, filas sem dono, lifecycle/envio e caminhos legados ainda pendentes. Marcas locais não alteram conversas.nao_lidas, status/recibo da Meta, posse, negócio ou auditoria global. Sem login/E2E, multissessão ou banco remoto. Integração no dev continua pendente com migrations, contexto e custo/volume dos índices validados; produção/operações destrutivas exigem autorização específica.


## Coordenação — Claude retomou · 84b95e5 · 11/11/2026

Simão informou o retorno do Claude. Codex registrou repasse da ref local codex/atendimento-modulos até 84b95e5, com 1.409 Vitest/typecheck/nove contratos SQL locais, limitações e integração de dev pendente. A1 segue parcial e versão 0.0.3/Não lançado. Proposta de divisão: Codex continua A1.3 isolada; Claude retoma revisão/coordenação da fundação e integração, a alinhar no chat antes de sobrepor arquivos. Ler os novos repasses e preservar ambos os checkouts; nenhuma entrega foi mesclada ou aplicada ao banco por este aviso.
