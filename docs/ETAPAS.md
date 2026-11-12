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
| F0-3 | Contexto de acesso: `exigirPapel` devolve usuário + setor + papel + unidade; RLS por unidade como 2ª barreira | 🟨 `exigirAcesso(area)` + mapa `src/lib/permissoes.ts` (testado) em todas as páginas/APIs; 0002 aplicada no dev. Bloqueio por unidade validado em fixtures do db2d58f. F0-3-004-R1 revalidado no snapshot bb85c40 para erro de gravação, recusa e auditoria após sucesso; validação por perfil segue para integração. F0-TEL-001 revalidado no bb85c40: as duas variantes gravaram na ficha antiga após a colisão. RLS por unidade junto com a primeira tela multiunidade | ✅ na main (v0.0.4): menu e permissões por setor, acesso direto por URL barrado (QA Peças passou) — Usuário de um setor não abre página de outro… |
| F0-4 | Casca comum: menu por setor, busca global (CPF, telefone, nome), central de notificações | 🟨 menu por permissão, busca global (`/painel/busca`) e sino + `/painel/notificacoes` prontos; notificações ligam com a 0002 | ✅ na main (v0.0.4): menu por setor, busca global, central de notificações — Busca acha cliente em todo o grupo; sino mostra avisos… |
| F0-5 | PWA instalável (manifest + ícones) | ✅ manifest + ícones (sem service worker, para não guardar dado do painel no navegador); instalar exige HTTPS → depende da F0-6 | Instala como app num PC da Comauto |
| F0-6 | Deploy na Vercel | ⛔ aguarda token válido da Vercel | Painel acessível pela internet com login |

## F1 — Setores (em paralelo, após F0-2)
| # | Tarefa | Dono | Status |
|---|---|---|---|
| F1-V | Vendas: funis Novos/Seminovos, etapas configuráveis (Novo → Em atendimento → Negociação → Proposta → Ganho/Perdido), cartões com arrastar, qualificação separada da etapa, carteira. **Referência visual (Simão, 10/11):** colunas por etapa com cartões, faixa do funil com % no topo, KPIs ao lado e painel de detalhe do cartão à direita (com conversa) | Claude | ✅ na main (v0.0.4/v0.0.5): quadro comum, transferências, métricas por pessoa, Meu dia, conversa no cartão — 🟨 `0003_vendas` + módulo + `/painel/vendas` (funil, kanban … |
| F1-O | Oficina/Agenda: fila, triagem, reserva/confirmação/reagendamento, histórico e vínculo externo | Codex | 🟨 fila e triagem atualizadas para main v0.0.2 no commit 35d56b2 em codex/oficina-v002. Menu agrupado e ficha pelos dois formatos do celular. Typecheck, 607 Vitest e contratos SQL locais passaram. Vínculo com Agenda segue para revisão cruzada e validação de acesso |
| F1-P | Peças: conversas e leads, promoções, cotação, acompanhamento e registro da venda (+ perda/cancelamento), valores comerciais e métricas | Codex | ✅ MVP na main (v0.0.4): quadro + conversa no cartão + assumir/devolver; QA readonly passou — 🟨 PR #3 revisado pelo Claude. F1-P-001/002/003 tratados no … |

## F2 — Chatbot → CRM e vínculos
| # | Tarefa | Dono | Status |
|---|---|---|---|
| F2-1 | `qualificar_lead` no agente; cartão no setor certo; confirmado pelo cliente × a verificar; triagem humana para intenção incerta | Claude | ✅ na main (v0.0.4): bot → Vendas/Peças/triagem com transação e identidade da mensagem — 🟨 integração original ligada ao bot no dev pelo Claude. Con… |
| F2-2 | Vínculo manual por ID/link: Avaliex e Processo de Vendas | Claude | ✅ na main (v0.0.4) — 🟨 pronto em `claude/f1-vendas` e testado no dev: colar link… |
| F2-3 | Vínculo manual por ID/link: Revisão | Codex | 🟨 Revisão local confirmou a rota por unidade. O acesso direto ao registro precisa de rota interna autenticada por unidade, tipo e ID. Links públicos de assinatura ficam fora do vínculo |

## Piloto Comauto

Equipe corrigida em f6370a1 (codex/atendimento-modulos): EQUIPE-001–004 tratados com origem do login controlada pelo servidor, proteção do próprio admin, recuperação de cadastro parcial e paginação do Auth. Typecheck e 701 Vitest passaram, com revisão independente. Sem alterar Auth remoto; integração do código ao dev ainda pendente.
QR Code + filas → validação → lote de até 10 convites autorizados. Instalação como app num PC da Comauto.

## Depois do piloto
| Fase | Tarefa | Dono |
|---|---|---|
| F3 | Consulta automática de status (sob demanda, cache 5 min, "desatualizado" em falha) conforme acessos liberados. Contrato de leitura do Processo de Vendas conferido no código local: empresa e ID da proposta → status. Integração aguarda identidade de leitura com escopo por empresa e mapeamento de unidades | Claude (Avaliex, PV) · Codex (Revisão) |
| F4 | Importação Bravus em lotes (amostra anonimizada, prévia de duplicados, repetição idempotente) | Claude (+ testes Codex) | 🟨 importador CSV genérico pronto em `claude/quadro-comum` (PR #5): mapeamento sugerido, prévia, duplicados por telefone com/sem 9 e CPF, só completa vazio, carteira opcional, sem consentimento; testado no dev 2× sem duplicar. Falta a **amostra exportada do Bravus** (Simão) para afinar o reconhecimento das colunas |
| F5 | Aniversários e lembrete insistente | Codex (continuidade autorizada) | ✅ na main (v0.0.4) com correções F5-001–005 — 🟨 F5-001–005 corrigidos localmente em 67983b5, codex/atendi… |
| F6 | Visão geral do administrador | Claude | ✅ em `claude/quadro-comum` (PR #5): cartões por setor (Vendas, Peças, Oficina) conforme o perfil — admin vê todos, gerente o setor, vendedor/peças o que é deles + sem dono; conferido com 6 perfis no dev |
| F7 | Captação e IA | Ambos |
| F2-4 | **Lembretes e mensagens agendadas** (pedido do Simão, 10/11): o usuário agenda um lembrete para si sobre um cliente específico (vira pop-up na hora) ou agenda uma mensagem para o cliente. A mensagem sai pelo `outbound.ts`: dentro da janela de 24h texto livre; fora dela só template aprovado e com consentimento do tipo certo (senão o sistema avisa e não envia) | Claude | ✅ na main — 🟨 pronto em `claude/f1-vendas` e testado no dev: agendar pe… |
| F2-5 | **Aba Clientes reorganizada** (pedido do Simão, 10/11): lista mais organizada no padrão do quadro (filtros no topo, ficha com abas: dados, veículos, oportunidades, agendamentos, conversas, lembretes) | Claude | ✅ na main — 🟨 pronta em `claude/f1-vendas` e testada no dev: filtros + … |
| F8 | 🟨 **F8 v1 pronta antes do piloto (decisão do Simão, 10/11)** em `claude/f1-vendas`: /painel/metricas com KPIs, funil contínuo (desenho do Codex), previsão do mês com confiança, conversão por vendedor/origem, tempo por etapa, motivos de perda e funil de eventos (Chamados → Confirmados → Presentes → Vendidos). F8-001 revalidado no carregador do bb85c40. F8-001-R1: origem_ref do lead de link usa código, enquanto a métrica exige o ID do evento. F8-002 revalidado com 5.200 oportunidades. F8-002-R1: histórico por lote sem paginação pode truncar tempos e chances quando a API limita linhas. **Aba Métricas e previsões** (pedido do Simão, 10/11). Centraliza o dashboard e os relatórios, incluindo o funil de Vendas e a seção Eventos. Funil de conversão por etapa com % e volume (Novos, Seminovos, Oficina, Peças, chatbot/QR/campanhas), tempo médio por etapa, conversão por vendedor/origem/unidade; **previsões** que melhoram com o histórico (vendas do mês, agenda da oficina, demanda de peças) a partir de séries diárias guardadas no banco; metas definidas pelos dados que já temos. Começa simples (médias móveis e taxa histórica por etapa), sem prometer precisão antes de ter volume | Claude (painel e modelo de previsão) · Codex (consultas SQL/views, testes de cálculo e de carga) | ✅ v1 na main + métricas por pessoa (v0.0.4) — …
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


## Prioridade atual — consolidação e piloto de Peças · 11/11/2026

Decisão do Simão repassada pelo Claude no chat: cumprir a ordem abaixo antes de ampliar A1.

**CR-PEC-002:** descoberta e correção local do bloqueio em cotação própria atribuída sem canal físico.
GET agora retorna diálogo vazio com capacidade de assumir, sem criar conversa ou atendimento. Claim versão zero
continua responsável pela criação atômica. Contrato SQL novo passou com/sem defaults, reaplicação populada,
recusas e revalidação após anonimização; contrato MVP anterior compatível e 65 testes do adaptador passaram.
Claude precisa revisar e reaplicar `0006` no dev; esta correção não foi aplicada remotamente pelo Codex.

**Revisão CR-PEC-001:** Claude aprovou o desenho do núcleo `7c44e9c` e identificou um bloqueio de retorno
à recepção após encerramento. Corrigido localmente: view de atendimentos ativos compartilhada com outbound,
histórico setorial preservado fora da leitura geral e pedido humano ativo com notificação/auditoria atômicas,
sem alterar posse. Ferramenta/handler verificam falha e avisam o cliente. **1.695 Vitest / 40 arquivos**, typecheck,
gitleaks e contrato SQL novo com/sem defaults/reaplicação passaram; revisão independente sem bloqueantes.
Correção disponibilizada em `dc8247e` e aprovada pelo Claude na integração `9adcfd4`.
Claude registrou aplicação de 0002/0003/0005/0006 no dev e recompilação; o Codex confirmou HTTP 200
no login local e presença dos dez contratos de Peças no OpenAPI do projeto correto. Execução por login
e concorrência real continuam pendentes; a credencial local de QA não foi confirmada, sem reset de Auth.

**Revisões formais #4/#5:** diffs completos de `96bd090` e `92a0556` revistos com reproduções imutáveis.
Não aprovados isoladamente: cinco riscos em #4, com correções posteriores já entregues, e quatro bugs novos
mais F8-002-R1 preexistente afetando #5. [Achados, linhas e evidências](REVISAO-PRS-4-5.md).
Conversa no cartão de Vendas liberada como próximo recorte pelo Claude; [contrato proposto](VENDAS-CONVERSA-CONTRATO.md)
preparado, aguardando definir a posse temporária de supervisão. Sem transferências avançadas.

1. Consolidar os nove arquivos avulsos em 0003_vendas (F5 e proveniência de Vendas) e 0006_atendimento (encaminhamentos e A1.1/A1.2), sem mudar contratos. Estado: CONCLUÍDO LOCALMENTE — instalação limpa com nove contratos, reaplicação e upgrade populado PGlite passaram com e sem defaults permissivos; dados e schema preservados. Reorganização em commit separado.
2. MVP kanban de Peças implementado e levado ao dev pelo Claude até `dc8247e`/`9adcfd4`: quadro comum `06b7cb5`, conversa no cartão, assumir/devolver/responder pelo outbound dentro de 24h, vínculo explícito das novas mensagens e desvios legados do piloto bloqueados. Quadro/detalhe usam política de carteira/unidade atual no banco; movimentações reaproveitam o domínio e seu histórico. SQL com/sem defaults, reaplicação populada, Vitest, typecheck e visual offline passaram. [Recorte, integração e limites](PECAS-MVP-PILOTO.md). Ainda aguarda validação por login; A1 não está concluída.
3. Entregas em commits menores, conforme novo repasse do Claude: SQL `c020b63`, quadro primeiro `e250d9d`, núcleo isolado `7c44e9c` e depois conversa. Base `claude/quadro-comum` incorporada por merge `7b5c65d`. Após revisão, Claude publica o PR/aplica no dev e Simão valida por partes com a conta de teste de Peças. Conector GitHub do Codex está somente leitura; nenhum PR remoto foi declarado criado. Login/E2E, dev e produção ainda não comprovados nesta entrega.

Transferências entre pessoas e outras expansões de A1 ficam congeladas. WIP anterior de liberação preservado fora da entrega em stash 6e0aa074dc35d9cec78b6c3ada484c5ccd78f518; seus testes SQL não foram executados. Não aplicar o stash inteiro sobre os módulos consolidados.

AGENTS na branch reflete um arquivo reaplicável por módulo, sem novos avulsos da CLI. Documentação e repasses novos são alterados e commitados somente na branch do Codex; não sujar o checkout/chat do Claude, conforme o pedido posterior dele. Núcleo terá diff separado para revisão. Preservar os arquivos do Claude e dados/credenciais de outros sistemas.

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


## Divisão retomada e recorte do piloto de Peças — 11/11/2026 · 11/11/2026

Claude confirmou no chat: Codex continua A1.3 isolada; Claude assume revisão da base claude/f2-piloto/PR, revisão do conjunto codex/atendimento-modulos e integração de dev com migrations/custos/contexto validados. Fundação das telas vem após fechar os controles e caminhos legados necessários ao fluxo piloto. Codex concordou com timestamps da CLI nas próximas migrations, preservando os arquivos e histórico já existentes; Claude atualizará AGENTS.

Prioridade acordada para a próxima fatia: primeiro fluxo de Peças com lista, detalhe e resposta. Implementar e revisar a posse/versionamento/liberação e a autorização nos caminhos que esse fluxo atravessa antes de expor a UI; manter Oficina e transferências avançadas em fatias posteriores. Não considerar todo A1 concluído nem banco dev validado. Demais setores e restrições permanecem no plano. Nenhum código foi integrado ou banco alterado por esta coordenação.


## Conversa no cartão de Vendas — implementação local · 11/11/2026

Recorte confirmado pelo Claude após a integração de Peças: vendedor atende a própria oportunidade;
gerente de Vendas/admin pode assumir temporariamente a conversa sem trocar vendedor_id. Nota na timeline,
aviso ao responsável, posse/versionamento e reserva física fazem parte da mesma transação. Transferência
permanente continua no domínio existente. Plano concreto em docs/VENDAS-CONVERSA-CONTRATO.md.

Codex prepara SQL separado em 0006 (sem migration avulsa), adaptadores Vendas e interface compartilhada com
Peças. A mensagem inicial fica congelada na primeira abertura; não se importa todo o histórico do cliente.
A resposta reutiliza o outbound oficial, consentimento/opt-out/janela de 24h e a mesma tentativa UUID.
SQL, UI e revisão ainda em validação nesta seção; integração no dev e login de Vendas permanecem pendentes.

QA real de Peças: login confirmado, 3 casos de entrada/menu e recusas por URL/API passaram; 3 casos de
cartões ficaram skip por falta de fixtures autorizadas existentes (quadro retornou 0 cotações autorizadas).
Nenhuma conta/dado criado nem posse/envio executado. Evidências em docs/QA-PECAS-READONLY-2026-11-11.md.
Claude informou revisar/aplicar CR-PEC-002 no dev após d0b7bba; a rodada de QA sem cotações não comprova esse fluxo.

Revisão do fix 58327bb encontrou risco residual de sobrescrita de ids_externos na importação. Claude corrigiu
em 8e34a99, removendo alteração do JSON das fichas existentes; revalidação do PR #6 pin 279f553 em andamento.
O PR #6 substitui #4/#5; não declarar merge/tag até evidência remota.


**Atualização de base:** Claude lançou v0.0.4; PR #6 confirmado merged na API do GitHub em
11/11/2026 às 19:42:06 UTC, main 5e73115c5dc77394966b38f738c0453693f55feb. A aprovação Codex foi
sobre 279f553 (runtime); os commits posteriores da versão são package/CHANGELOG. A continuidade de Vendas
será rebaseada nessa main, mantendo a próxima entrega em Não lançado até novo merge real. CR-PEC-002
já foi revisada/aplicada no dev pelo Claude; evidência de navegador desse fluxo ainda depende de fixtures.


## Oficina — primeira fatia isolada · 11/11/2026

Após Vendas/PR #7, Claude liberou Oficina. Branch codex/oficina-fila no checkout Codex existente,
recuperando pontualmente 35d56b2: 0004, validadores e contratos. Agenda continua principal; Nav/Resumo
atuais preservados. Claude confirmou triagem como domínio, vínculo opcional verificável ao agendamento,
recepção na fila coletiva com filtro minhas, consultor próprias+sem dono, gestão unidades autorizadas.

Em andamento: 0004 reaplicável, grants reais, perfil/ator/unidade atual e revalidação de cliente/veículo;
fila paginada por política no banco e adaptador server-only com DTO mínimo. SQL/contrato e adaptação serão
commits separados. Ainda não há telas de Oficina restauradas nem conversa/0006 expandida. Próximo aceite:
SQL em dois modos/reapply/rollback e revisão independente; Claude revisa/aplica antes da UI. Recuperação
explícita de triagem órfã em alinhamento, sem transferência de dono vigente. Plano docs/OFICINA-MVP-PILOTO.md.

Base remota v0.0.5 confirmada via PR #7 (main 16b873b); clone compartilhado main ainda 5e73115.
Rebase somente após congelar arquivos dos subagentes, preservando hashes e trabalho em andamento.



**Prioridade posterior do Simão via Claude:** antes de continuar Oficina, QA somente leitura de todas as telas/perfis na produção local v0.0.5. WIP Oficina congelado: SQL A210A0A9 passou contratos locais em dois modos/reapply/upgrade; revisão independente não executada. Adaptador 22D64066 e testes 0680C26B escritos, ainda não executados. Nenhuma integração remota. Preservar essa distinção ao retomar.



## QA prioritária das telas — v0.0.5 · 11/11/2026

Rodada real readonly consolidada em docs/QA-TELAS-PERFIS-v005.md: 7 perfis autenticados, 47 casos passaram,
nenhuma falha de produto comprovada nos casos executados após recheck do seletor; 2 pendências: login de
Vendedor aguarda senha válida documentada e conversa de Peças sem cartão autorizado. Admin e gerentes
abriram conversas autorizadas vazias, sem testar envios/histórico. Visão pessoal de Métricas do vendedor
continua pendente. URLs negadas/menu/início e telas permitidas cobertos no roteiro, sem CRUD/WhatsApp.
Oficina está congelada no WIP 0004 A210A0A9 (contratos locais passaram; revisão independente pendente),
adaptador 22D64066/testes0680C26B ainda não executados. Branch rebaseada no pin main v0.0.5 16b873b.

Fila atual do Simão via Claude: QA por perfil → Oficina somente agenda existente + fila/triagem essencial
(0004 separado → telas) → E2E do bot com simulador e relatório funciona/quebra/depende de chave. Recursos
novos e vínculo Revisão F2-3 congelados; publicar na Vercel fica por último. Sem alterar Auth/dados externos.


## QA ampliado e vendedor adicional — pedido direto do Simão · 11/11/2026

Executado com três subagentes mais coordenador: inventário de 21 páginas reais do painel, incluindo
Minha conta/Usuários adicionadas ao runtime. Vendedor QA 2 criado explicitamente a pedido do Simão
(vendedor/Vendas/Comauto), origem Auth do CRM e perfil confirmados; credencial somente no env ignorado.
A conta adicional foi testada em sessão isolada: 25 verificações aprovadas, Minhas métricas sem globais,
10 URLs recusadas; quantitativo/carteira estrangeira continua sem fixture comparável. Contas antigas
preservadas. A antiga pendência de senha não impede validar o perfil novo; não alegar teste da conta antiga.

Resultados e limites em docs/QA-TODAS-TELAS-CONSOLIDADO.md e relatórios específicos de Vendas, Peças,
Recepção/Consultor. Correções pequenas de UI em commit isolado 0fb2a00 (filtros da Agenda até560px e
atalho Busca condicionado à permissão). Typecheck/revisão independente aprovados; CSS foi comprovado
em memória, falta integração do Claude. Campanhas GET/prefetch ainda grava estimativa e foi bloqueado
no QA: apontamento de núcleo para correção, sem executar o detalhe. A carteira própria Peças sem cartão
mantém seu positivo pendente. Não tratar navegação como envio/CRUD/concorrência. Runtime estava em
trabalho do Claude no checkout573bfa2/package0.0.5; seletores foram adaptados ao DOM conferido.

Oficina WIP permanece intacto: SQL A210A0A9 com contratos locais, revisão independente pendente;
adaptador/testes ainda não executados funcionalmente. O typecheck global passou durante validação dos
ajustes UI, sem ativar o módulo. Continuar só a fila essencial após repasses/integração; sem extras/F2-3.

## Continuidade de 12/11 — PR #8 aprovado e Oficina pronta para revisão cruzada

PR #8 aprovado no pin f12e0c102d3ade6db9d8ee8c841711991e052348: convite corrigido confirmado por
verificador independente (51 chamadas controladas), origem só app_metadata, parser CSS, quatro testes
focados, build Webpack/TypeScript e gitleaks. Parecer em 202a781/ref codex/revalidacao-pr8; scan original
selado preservado. Sem merge/tag/deploy ou Auth remoto pelo Codex. Decisão de autoidentificação do piloto
registrada pelo Claude; confirmação de caixa postal fica para Segurança.

Oficina: revisão estática independente APROVOU 0004 A210A0A9 no pin a13b721, sem bug funcional encontrado.
Os 88 testes do adaptador e 7 do parser foram executados e passaram. SQL/contratos permanecem idênticos
à matriz local anterior de dois modos ACL/reaplicação/upgrade, sem repetição desnecessária. Repasse em
docs/OFICINA-FILA-VALIDACAO.md: Claude revisa/aplica primeiro f6295a6/0004; adaptador separado3ee0a95.
Nada aplicado no dev e nenhuma tela nova exposta. UI exige SQL/contrato aprovados e contexto validado;
Supabase/PostgREST, login/E2E e concorrência multissessão continuam pendentes. Sem ampliar Oficina.

## Base de Oficina alinhada à v0.0.6 · 12/11/2026

PR #8 confirmado merged pelo GitHub em bc14aa1e90e440ec87e6fc88a275c817041b7f87, com tag local
v0.0.6 nesse commit. Delta desde o pin aprovado f12e0c1 é somente versão/changelog/coordenação.
Merge na branch codex/oficina-fila preserva 0004 A210A0A9 e adaptador22D64066, commits e stashes.
CSS coincide com a main e chat preserva os dois históricos; src/app/src/lib/Vendas/0002 iguais à main.
Typecheck e 99 testes focados passaram após combinar as fontes. Sem repetir a matriz SQL inalterada.
Claude informou iniciar revisão/aplicação de f6295a6 e depois3ee0a95; ainda não declarar o dev validado.
Repasse de identidade visual final/loading foi lido e permanece com Claude, sem editar essa frente aqui.

## Oficina: PostgREST e pendência de métricas · 12/11/2026

Claude confirmou 0004 revisada/aplicada no dev. Codex comprovou leitura real via PostgREST em 11 casos:
recepção/consultor autorizados com filas vazias e minhas; perfis indevidos recusados sem total/corpo;
ator inexistente, limite inválido e chamada anônima recusados. Sem writes/sessões/fixtures ou leitura
de dados pessoais em relatório. Evidência/limites em docs/OFICINA-POSTGREST-READONLY.md. Não é login/E2E,
corpo de cartão ou isolamento quantitativo real. Preparação da tela essencial avança isoladamente;
Claude ainda integra o adaptador, e a revisão/integração da UI permanece com ele.

Simão perguntou pela aba de métricas de Peças e pela visão do vendedor. **Métricas de Peças seguem
pendentes na A4**: o menu só tem Cotações e não existe página ligada ao setor. O vendedor já tem a rota
/painel/metricas com recorte pessoal e título Minhas métricas; o menu genérico confundia. Fix isolado
f2b5cb6 muda somente seu rótulo para Minhas métricas, mantendo permissões e consultas. Peças precisa
da entrega A4 com carteira própria, gerente por setor/unidades e admin; não liberar métricas de Vendas
para Peças nem fingir que o dashboard pessoal já foi entregue nesse módulo.

## Tela essencial de Oficina pronta · 12/11/2026

Código isolado6f75cd0: /painel/oficina com fila geral/Minhas, duas etapas, cursor, registro e início de
triagem autorizados. Agenda existente preservada; sem dinheiro/WhatsApp/etapas extras. 65 testes de
ações/filtros +33 SSR passaram; revisão React/Next/acesso independente aprovada; 34 medições offline
passaram em390/1440px sem overflow do documento. Build Webpack/TypeScript/diffcheck/gitleaks passaram.
Detalhes e limites em docs/OFICINA-TELA-MVP.md. SQL0004 foi aplicado pelo Claude e lido realmente em11
casos readonly; filas vazias não provam cartões, escrita ou E2E. Integração do adaptador3ee0a95 precede
esta UI; servidor/dev e testes reais continuam com Claude/Simão. Nenhum novo servidor ou write remoto.

## Fila atualizada pelo Simão via Claude · 12/11/2026

Repasses conferidos até167538/SHA E1DDDF76AB2E34B0E739A05F85F0BEE01EE7C4431799CFD091687A5C36136AC9.
Oficina UI6f75cd0 está pronta para revisão e integração depois do adaptador3ee0a95. Claude liberou
transferência entre setores como próximo recorte prioritário: central/triagem ou cartão para lead de
Vendas, cotação de Peças ou triagem de Oficina, preservando cliente único, nota/histórico e aviso ao
destino. A liberação substitui o congelamento anterior desse recurso; contrato e revisão do núcleo
continuam com Claude. Não confundir essa direção com transferência já implementada ou com autorização
para expor histórico de outro setor.

Depois: métricas de Peças e Oficina (Codex), pessoais para operador, setor/unidades para gerente e
geral para administrador; depois E2E do bot. Marketing/campanhas por setor e identidade visual seguem
com Claude. Peças ainda não tem página de métricas. Rótulo Minhas métricas do vendedor (f2b5cb6) foi
cherry-picked pelo Claude e conferido na fonte compartilhada; nenhuma nova consulta foi entregue aqui.

Do QA do Claude, registrar para correção dirigida em Peças: iniciais do avatar incluindo parêntese
e distinção visual entre responsável da cotação e posse ativa da conversa. Layout F9 permanece para
trabalho com Simão. Sem repetir os testes já aprovados nem confundir mudanças informadas pelo Claude
com execução de E2E ou aplicação remota pelo Codex.

## Oficina integrada e contrato de transferência preparado · 12/11/2026

Claude confirmou Oficina (adaptador +6f75cd0) integrada no merge287c498, 1.919 Vitest, servidor local
recompilado e navegação de recepção/consultor autorizada, vendedor recusado. Esta execução é relato
do Claude; Codex não repetiu os testes nem fez novas gravações no dev. Nova branch codex/transferencias-setores
incorporou Claude588bc1c em be4868b; runtime coincide com essa fonte e ambos os históricos do chat
foram preservados. codex/oficina-fila e stashes anteriores permanecem intactos.

Próximo recorte: proposta concreta em docs/TRANSFERENCIA-ENTRE-SETORES.md, com duas análises
independentes readonly. Central/Oficina não têm a versão dos diálogos, Oficina ainda não participa
do canal modular e negócio aberto continua excluindo o legado mesmo sem slot. Esses fatos impedem
tratar um INSERT no destino como transferência completa. Proposta exige alinhar com Claude estado
do fluxo, tratamento de Oficina, destinatário/reuso e concorrência antes do SQL/UI. Nenhum contrato
novo de núcleo, transferência ou histórico cruzado está implementado/liberado por esta preparação.

Claude fechou o contrato no prefixo169975: ENCAMINHAR preserva negócio de origem e move fluxo ativo;
Oficina só domínio, novas mensagens na central; reusar destino aberto, Vendas com funil e responsável
opcional; nota/evento/aviso/audit atômicos. Implementação SQL, adaptador e testes isolados iniciados
com donos distintos. SQL primeiro para revisão; guards de código da central antes da UI/transferência
real, pois consultas extras por cliente e falta de recorte por unidade não são corrigidas pelo ledger.
Ainda sem SQL remoto, envio, E2E ou transferência concluída.

Repasse posterior173664 mudou para pessoa/fila nos3 destinos e histórico compartilhado por snapshot
explícito auditado, sem consulta genérica por cliente. Parser/adaptador atualizados:114 testes
simulados PASS; nenhum endpoint exposto. SQL/testes antigos NÃO aprovados nem compatíveis com esse
contrato; WIP privado preservado com hashes, migration ativa restaurada à base. Revisão automática
rejeitou a edição do trigger0006 por alegada falta de autorização de núcleo/permissões; não houve
reexecução por outro caminho, banco remoto ou Auth alterados. Detalhes, alternativas Oficina e
questão de reuso/responsável em docs/TRANSFERENCIA-ENTRE-SETORES.md.

Agenda Oficina: Claude assumiu/implementou acompanhamento do dia (C). Codex ficou com descrição
livre(A) e horário/recurso livres(B), após SQL da transferência e revisão. Ainda não implementados
aqui; não editar acompanhamento concorrentemente nem retirar as travas de conflito23P01 do banco.

## Respostas de contrato recebidas, autorização ainda pendente · 12/11/2026

Prefixo174752: reuso mantém responsável existente; pessoa alternativa recebe só aviso, sem nova posse
ou acesso. Sem dono, pessoa elegível escolhida vira responsável. Snapshot restrito ao contexto
autorizado da origem, com IDs/intervalo auditados; Oficina permanece na central/opção1. Claude
reafirmou o pedido de edição local0006 e informou consultar Simão. Não é a resposta direta da
autorização pendente neste chat: núcleo continua intacto e suspenso. Nenhum teste foi repetido ou
novo runtime entregue nesta leitura; DTO do adaptador precisará aviso estruturado antes da UI.

## Preparação independente da agenda manual · 12/11/2026

Sem tocar o núcleo suspenso, foi mapeada A/B na fonte compartilhada775f39e. Documento
docs/AGENDA-MANUAL-PREPARACAO.md registra campo/constraint, recurso/unidade, escrita atômica,
reagendamento com serviço nulo, consumidores do rótulo e matriz a executar. Não é SQL implementado
ou nova validação funcional; acompanhamento(C) permanece com Claude. Implementação conserva a
prioridade depois do SQL da transferência; autorização pendente não foi presumida nem contornada.

Claude fechou A/B no prefixo175859: descrição3..500 com NULL explicitamente recusado; início + duração
15min..8h em passos15min; expediente/bloqueios sempre respeitados; reagendamento manual mantém
duração/recurso por caminho explícito; revisão periódica só catálogo; templates usam rótulo até60
caracteres. Documento atualizado, sem código/SQL/testes novos. Ordem e autorização pendente mantidas.

## Autorização direta para retomar núcleo local · 12/11/2026

Simão respondeu à pergunta específica de núcleo/roteamento/snapshot: "Autorizar implementação local
com revisão do Claude". Retomada em codex/transferencias-setores a partir da base revisada; sem
aplicar o WIP antigo. Subagentes com arquivos separados implementam0006, contratos SQL e aviso
estruturado do adaptador; revisão independente e revisão do Claude precedem banco/dev. A rejeição
anterior ficou documentada; a autorização direta posterior resolve aquela falta de escopo.
Nada aplicado remotamente. Ainda não afirmar transferência pronta ou teste SQL funcional aprovado.

## Backend local de transferência entregue para revisão · 12/11/2026

`abb9031` contém somente a fatia SQL0006/contratos/CHANGELOG. Origem mantém negócio; destino aberto
é reutilizado, responsável existente é preservado e pessoa alternativa recebe só aviso. Operação
une rota, snapshot autorizado, evento, notificação e audit; replay revalida, falhas revertem efeitos.
Nota bruta fica no ledger protegido; anonimização redige as novas cópias. Hash0006:
2141BE5DFB1465C9538704CC86A38043E014D402EE860B747E347D881F7C7853.

402 verificações por modo ACL passaram, incluindo limpa, upgrade real com54 tabelas/115FKs legadas
preservadas e reaplicação populada. Quatro contratos dirigidos Peças/Vendas passaram nos dois modos.
Contrato antigo A1 falha55000 também na baseline74cc99e: incompatibilidade preexistente documentada,
sem chamá-la aprovação. Revisão independente identificou/cobriu guardaNULL da rota e cópias da nota;
parecer final no hash acima. Diffcheck/gitleaks passaram. Typecheck e133 testes do adaptador0bffe79
e104 da compatibilidade de diálogo2bf3e72 passaram; estes últimos preservam autoria bot/sistema.

Revisão do Claude deve avaliar especialmente o grant mínimo service_role→auth.users(id,email),
sem escrita ou colunas sensíveis. Nada aplicado no dev/Auth. Evidências e limitações em
docs/TRANSFERENCIA-SQL-REVISAO.md. Antes da UI: central com unidade/política antes de count/corpo,
guard de despacho legado e nota/snapshot com saída filtrada/paginada. PGlite sequencial não prova
concorrência multissessão, HTTP, PostgREST, login ou WhatsApp. Transferência completa ainda pendente.
Agenda A/B segue na prioridade acordada depois desta fatia SQL; acompanhamento(C) é do Claude.

Ponte dirigida posterior: 3 casos PASS com JSON real do PGlite → criarDialogo original por Next SWC/VM.
Central → Vendas/Peças antes/depois do claim preservam autoria cliente/bot/sistema, IDs únicos,
pendente booleano e mascaramento real; interno/outro negócio omitidos. Reuso Peças sem dono com versão >0
retorna versão real e resumo vazio, assume com essa versão e lê histórico autorizado. Fontes/hash
inalterados; sem repetir 402, sem HTTP/Auth/UI/envio reais. Artefatos privados referidos no relatório.

Repasse posterior conferido até 176356/SHA 19DDBCCC0BD3377FB11617925EEFEC58B37C74E649FF1E0C5CE6E921C3CCA240:
Claude solicitou revisão do PR #9 (claude/pos-v004 → main, futura v0.0.7) entre fatias da transferência.
Oficina, acompanhamento, marketing por setor, central/triagem, identidade e QA compõem a descrição
recebida. Revisão ainda não iniciada/pin não conferido; não declarar aprovação, merge ou nova versão.
Pedido não suspende o backend prioritário, que já foi entregue para revisão local em abb9031.

## PR #9 revisado e retorno do núcleo · 12/11/2026

PR9 fixado em bc14aa1 → 8df62ff429bf24406a7f1d552319d43cf32a27a8, aberto/não mesclado na consulta.
Parecer REQUER AJUSTES em docs/REVISAO-PR9.md: QR por ID e métricas de eventos não aplicam o novo
setor; Desfazer pode confirmar uma chegada que partiu de pendente com confirmação antiga; erro de
consulta vira dia vazio. Duas observações baixas: data inválida e cleanup do listener da abertura.
Três revisores, fontes originais em memória, controles positivos/CAS/unidade/23P01; sem HTTP/Auth/dev.
Oficina idêntica à fatia já aprovada, sem repetir matriz; CSS/assets/mascaramento dirigidos passaram,
assim como gitleaks do range e diffcheck. Não é aprovação global, build ou QA real do candidato.

No prefixo178737/SHA A1BED2C263FF8B474AF1262A81848D19970912216951E6CCE361DF8B55B1858D, Claude revisou
abb9031 e NÃO aprovou ainda: T-001 remove dependência/grants de Auth e passa e-mail da sessão;
T-002 restringe UPDATE de Oficina a responsável; T-003 pede explicação do dual ledger; T-004 baixa
propõe código sem destinatário. Correção local autorizada iniciada com donos separados em0006,
adaptador e contratos/runner. Assinaturas ganharão p_ator_email obrigatório ao final, sem sobrecarga
antiga ou DEFAULT. Nenhum SQL remoto. Matriz anterior402 não certifica esta revisão ainda em andamento.

## Retorno T-001/T-002 concluído localmente · 12/11/2026

SQL isolado bda5b631fd1a24f37d7937513ef023fa8d849d45 corrige abb9031: hash final C5221A2388294302B4493338A9A569A060C987516137C76619C759896B14888C.
Adaptador adf0f6794bfb95e96e3c9c0fb3e87e35c812b522 passa somente e-mail/UUID da sessão atual, ignora
identidade forjada no request e preserva DTO mínimo. Sem Auth read/grant/REVOKE ou alteração remota.
Oficina UPDATE adicional somente de responsável. T-003 dual ledger intencional comentado e coberto;
T-004 continua conflito, refinamento baixo reservado à UI. Fonte/hash ficaram inalterados nos testes.

Matriz completa:18 contratos por modo ACL,16 PASS e2 falhas também presentes em abb9031~1 nos dois
modos. Sete regressões Auth e Oficina voltaram a PASS, com assert MVP restaurado exatamente à base.
Transferência428 verificações PASS por modo + reaplicação populada/replay + upgrade real com54tabelas
preservadas. Falhas mantidas: A1/atendimentos55000 guarda de posse; Peças antigoP0001 na comparação
envolvendo atualizado_em. Runner sai1, não toda verde; contratos antigos não foram alterados para passar.
140 Vitest do adaptador, typecheck,3pontes SQL→leitor original e revisão estática independente passaram;
diffcheck/gitleaks das fatias passaram. Sem novo build, HTTP/Auth/UI/envio/dev ou disputa multissessão.
Relatório atual docs/TRANSFERENCIA-SQL-REVISAO.md; usar runner privado validar-transferencia-t001-t002.mjs,
pois o anterior ainda mira aridade9. Claude revalida o conteúdo final antes de aplicar dev, banco antes
do adaptador novo. UI/central/dispatch fences e prioridades de agenda/métricas continuam pendentes.
