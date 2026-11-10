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
- Banco de desenvolvimento: Supabase "Ambiente de testes" (também é o banco de teste do processo-vendas-teste). **Não criar** tabelas `empresas`, `profiles`, `propostas`, `convites`. Chaves em `secrets/CHAVES-DESENVOLVIMENTO.txt` (fora do git).
- Antes de comando destrutivo no banco: perguntar ao Simão.

## F0 — Fundação (Claude)
| # | Tarefa | Status | Pronto quando |
|---|---|---|---|
| F0-1 | Repositório Git + GitHub `Comauto-TI/CRM-COMAUTO` | ✅ `main` + tag v0.0.1 no GitHub; PR #1 (F0) aberto para revisão do Codex | `main` no GitHub, gitleaks limpo |
| F0-2 | Núcleo multiunidade (`0002_nucleo`): `unidades`, `usuarios` (setor/papel/unidade), `usuario_unidades`, cliente ampliado (CPF/CNPJ, nascimento, vendedor da carteira, ids externos), veículo ampliado (chassi, renavam), `notificacoes`, `lembretes`, `unidade` nas tabelas operacionais | ✅ `0002` validada no PR #1 (`16c1638`) e APLICADA no banco de dev em 10/11 (usuarios, unidades, travas de unidade, índices de busca conferidos) | Migration aplicada no banco de dev; testes verdes |
| F0-3 | Contexto de acesso: `exigirPapel` devolve usuário + setor + papel + unidade; RLS por unidade como 2ª barreira | 🟨 `exigirAcesso(area)` + mapa `src/lib/permissoes.ts` (testado) em todas as páginas/APIs; setor passa a valer quando a 0002 for aplicada. RLS por unidade: junto com a 1ª tela multiunidade | Usuário de um setor não abre página de outro |
| F0-4 | Casca comum: menu por setor, busca global (CPF, telefone, nome), central de notificações | 🟨 menu por permissão, busca global (`/painel/busca`) e sino + `/painel/notificacoes` prontos; notificações ligam com a 0002 | Busca acha cliente em todo o grupo; sino mostra avisos |
| F0-5 | PWA instalável (manifest + ícones) | ✅ manifest + ícones (sem service worker, para não guardar dado do painel no navegador); instalar exige HTTPS → depende da F0-6 | Instala como app num PC da Comauto |
| F0-6 | Deploy na Vercel | ⛔ aguarda token válido da Vercel | Painel acessível pela internet com login |

## F1 — Setores (em paralelo, após F0-2)
| # | Tarefa | Dono | Status |
|---|---|---|---|
| F1-V | Vendas: funis Novos/Seminovos, etapas configuráveis (Novo → Em atendimento → Negociação → Proposta → Ganho/Perdido), cartões com arrastar, qualificação separada da etapa, carteira. **Referência visual (Simão, 10/11):** colunas por etapa com cartões, faixa do funil com % no topo, KPIs ao lado e painel de detalhe do cartão à direita (com conversa) | Claude | 🟨 `0003_vendas` + módulo + `/painel/vendas` (funil, kanban com arrastar, ficha, tarefas, contatos, histórico) na branch `claude/f1-vendas` (PR #2), 0003 aplicada no dev em 10/11; testado no navegador contra o banco real (criar, arrastar, histórico) |
| F1-O | Oficina/Agenda: fila, triagem, reserva/confirmação/reagendamento, histórico e vínculo externo | Codex | ⬜ |
| F1-P | Peças: fila Novo → Em cotação → Aguardando cliente → Aprovado → Em separação/encomenda → Entregue (+ perda), itens, margem | Codex | 🟨 cadastro, fila, atribuição com histórico e inclusão de itens e valores no commit f37d88c em codex/pecas, validados localmente; integração aguarda revisão, F0-2 aplicada e acesso validado no dev |

## F2 — Chatbot → CRM e vínculos
| # | Tarefa | Dono | Status |
|---|---|---|---|
| F2-1 | `qualificar_lead` no agente; cartão no setor certo; confirmado pelo cliente × a verificar; triagem humana para intenção incerta | Claude | ⬜ |
| F2-2 | Vínculo manual por ID/link: Avaliex e Processo de Vendas | Claude | ⬜ |
| F2-3 | Vínculo manual por ID/link: Revisão | Codex | ⬜ |

## Piloto Comauto
QR Code + filas → validação → lote de até 10 convites autorizados. Instalação como app num PC da Comauto.

## Depois do piloto
| Fase | Tarefa | Dono |
|---|---|---|
| F3 | Consulta automática de status (sob demanda, cache 5 min, "desatualizado" em falha) conforme acessos liberados | Claude (Avaliex, PV) · Codex (Revisão) |
| F4 | Importação Bravus em lotes (amostra anonimizada, prévia de duplicados, repetição idempotente) | Claude (+ testes Codex) |
| F5 | Aniversários (amarelo antes, verde no dia, vermelho sem atendimento) + lembrete insistente | Claude |
| F6 | Visão geral do administrador | Claude |
| F7 | Captação e IA | Ambos |
| F8 | **Aba Métricas e previsões** (pedido do Simão, 10/11): funil de conversão por etapa com % e volume (Novos, Seminovos, Oficina, Peças, chatbot/QR/campanhas), tempo médio por etapa, conversão por vendedor/origem/unidade; **previsões** que melhoram com o histórico (vendas do mês, agenda da oficina, demanda de peças) a partir de séries diárias guardadas no banco; metas definidas pelos dados que já temos. Começa simples (médias móveis e taxa histórica por etapa), sem prometer precisão antes de ter volume | Claude (painel e modelo de previsão) · Codex (consultas SQL/views, testes de cálculo e de carga) |

## F8 — visão do Codex

Proposta complementar para a aba **Métricas**, depois do piloto e com dados consistentes. O Simão compara as duas visões antes da implementação.

- **Referência visual.** Usar o painel enviado pelo Simão como referência de composição. Cards com números principais e funil de conversão no topo, com detalhamento por etapa e filtros abaixo. A análise fica numa aba própria.
- **Conversão por operação.** Vendas acompanha lead recebido, qualificação, proposta e venda, separando Novos e Seminovos. Oficina acompanha pedido, agendamento e comparecimento. Peças acompanha cotação, aprovação, venda confirmada e entrega. Filtrar por período, unidade, setor, responsável e origem ou campanha quando disponível. Exibir contagens e taxas com base no mesmo conjunto de registros.
- **Indicadores configuráveis.** A gestão escolhe nome, eventos de início e fim, filtros, meta e período. Mostrar fórmula, quantidade de registros e fonte de cada indicador. Versionar alterações de definição para manter comparações históricas verificáveis.
- **Previsões.** Começar pelas séries históricas de conversão, volume e prazo. Validar as estimativas contra períodos anteriores, separar realizado de previsto e mostrar horizonte e faixa de incerteza. Exibir o histórico observado quando a amostra ainda for insuficiente para prever.
- **Dependência dos dados.** Usar origem e histórico de eventos do CRM, com desfechos oficiais dos sistemas vinculados quando conferidos. Respeitar permissões por unidade e setor. Na F1, preservar os registros de etapa, responsável e data já previstos no fluxo.

**Aceite:** a gestão consegue conferir uma taxa e seu denominador contra os registros da origem, mudar a meta sem perder o histórico da definição e distinguir realizado, previsão e histórico insuficiente.

## Preparação F1 — Oficina, Agenda e Peças (Codex)

**Status da preparação:** ✅ fluxos e critérios de aceite definidos. Base verificada em 10/11/2026 com typecheck aprovado e 532 testes Vitest aprovados. F1-O e F1-P permanecem a fazer até F0-2 estar pronta. As telas entram no painel após validar os acessos da F0-3.

### F1-O — Oficina e Agenda

- A fila mostra unidade, cliente, veículo, serviço ou problema, responsável e próxima ação. Fluxo: **Novo → Em triagem → Aguardando cliente → Agendado → Em atendimento → Concluído**. Cancelamento e falta ficam no histórico.
- Reutilizar a agenda do CRM e seus recursos, horários e bloqueios. A agenda é a referência para os horários do piloto Comauto. Antes do piloto, a equipe lança os compromissos existentes e os bloqueios dos recursos disponibilizados.
- Só mover para **Agendado** quando a reserva estiver gravada e vinculada ao atendimento. Ao perder uma disputa por horário, mostrar alternativas sem confirmar nem mover o cartão. Reagendamento e cancelamento preservam o histórico.
- Um atendimento pode originar uma cotação de Peças e receber referência de uma oferta ou orçamento extra no Revisão. A execução e a aprovação do orçamento oficial permanecem no Revisão.

### F1-P — Peças

- **Balcão** cria um pedido próprio. **Oficina** abre o pedido a partir do atendimento, mantendo a mesma ficha e veículo. A fila diferencia origem, responsável, prazo e próxima ação.
- O fluxo é **Novo → Em cotação → Aguardando cliente → Aprovado → Em separação ou encomenda → Entregue**, com perda e cancelamento registrados. A equipe informa itens, compatibilidade, quantidade, preço e disponibilidade consultados no sistema atual.
- Acompanhar cotação, aprovação, venda confirmada e entrega separadamente. A margem bruta usa valor de venda e custo quando o custo estiver informado. Estoque, reserva física e faturamento permanecem nos sistemas atuais durante o piloto.
- A cotação de balcão nasce no CRM. A cotação da Oficina pode apontar para um orçamento extra que já existe no Revisão, mantendo o ID e o status da origem separados da etapa comercial do cartão.

### Validação para o piloto

| Caso | Resultado exigido |
|---|---|
| O-01 · Bot e recepção tentam reservar o mesmo recurso e horário | Uma reserva é confirmada. A outra tentativa recebe conflito e horários alternativos. |
| O-02 · Reagendar e cancelar | A agenda e o cartão exibem a situação correta, liberam o horário quando aplicável e preservam a trilha do que mudou. |
| P-01 · Balcão e Oficina | Dois pedidos percorrem a fila de Peças, com origem, responsável e vínculo corretos. Repetir a mesma ação não cria pedido ou venda duplicados. |
| P-02 · Venda, custo e entrega | Aprovação ainda não conta como venda. Após confirmar a venda, o total confere com os itens e a margem só aparece para venda com custo registrado. |
| A-01 · Unidade e setor | A mesma ficha é localizável no grupo. Operadores veem e alteram apenas os atendimentos permitidos. |
| R-01 · Vínculo com Revisão | O link manual funciona com unidade, tipo e ID. Quando a consulta de status for liberada, falha da origem sinaliza status desatualizado e preserva o cartão. |
| V-01 · Revisão conjunta com Claude | Validar Novos sem troca, Novos com troca, Seminovos com usado na troca e proposta devolvida. Qualificação, etapa do CRM, status da proposta e avaliação do usado continuam distinguíveis. |

Primeiro PR do Codex após F0-2: módulo em branch `codex/*` com escopo e critérios acima. Mudanças na agenda compartilhada e no núcleo passam pela revisão do Claude. A visão geral do administrador continua em F6, após validar os dados que a alimentam.
