# Changelog — Plataforma Comauto

Versionamento semântico a partir de **0.0.1** (decisão do Simão, 10/11/2026).
- Enquanto estivermos em `0.0.x`, cada entrega mesclada na `main` sobe o último número (0.0.1 → 0.0.2 → …).
- `0.1.0` = piloto na Comauto; `1.0.0` = produção no banco oficial.
- Toda versão mesclada ganha **tag git** `vX.Y.Z` e uma seção aqui. O que está numa branch e ainda não foi mesclado fica em "Não lançado".
- Quem mescla na `main` (Claude ou Codex) atualiza `package.json`, este arquivo e cria a tag.

## [Não lançado] — branch `claude/f2-piloto`
### Adicionado
- Transferir lead (botão de setas no cartão e no painel): dono ou gerente passa para outro vendedor com motivo; registra na linha do tempo, avisa o novo vendedor e pode mover a carteira do cliente.
- Transferir carteira (gerente/admin, férias/saída): cartões abertos de um vendedor para outro ou divididos no rodízio.
- Equipe em Configurações: o admin cadastra a pessoa (login + papel, setor e unidade) com senha provisória exibida uma vez (nunca na URL); vincula e-mail que já tem login em outro sistema do grupo sem trocar a senha; nova senha só para quem foi criado pela plataforma.
- Prontidão do piloto (Gestão): o que bloqueia e o que falta, com a ação de cada item — só verifica se as chaves existem, nunca mostra valores.
### Alterado
- Troca de vendedor só pela transferência (registrada e avisada); saiu o campo solto do formulário de qualificação.
- Painel sem animações contínuas nem desfoque.
### Corrigido
- Rótulos do funil de Vendas não quebram mais no meio da palavra.

## [0.0.3] — 11/11/2026 — Setor Peças (PR #3, Codex; revisado pelo Claude)
### Adicionado
- Fila de cotações por unidade, com responsável, origem, próxima ação e prazo.
- Itens e valores com controle de versão, apresentação ao cliente e aprovação.
- Registro comercial da venda, total e margem bruta quando os custos estão completos.
- Encerramento por perda ou cancelamento com motivo e histórico.
- Entrada de pedidos do WhatsApp com proteção contra duplicação por mensagem.
- Menu de Peças no grupo próprio e busca da ficha pelos dois formatos do celular.
- Reatribuição de cotações pela gestão, retomada de cotações sem responsável e histórico da troca.
### Alterado
- A tela acompanha o fluxo comercial até a venda confirmada, conforme o escopo definido pelo Simão.
- Fila separada entre abertas e encerradas, com paginação para consultar pedidos antigos.
- Migration de Peças reaplicável, preservando cotações e permissões.

## [0.0.2] — 11/11/2026 — Vendas, chatbot→CRM, lembretes, Clientes, Métricas (PR #2)
### Adicionado
- F8 (v1): aba Métricas — KPIs, funil contínuo de Vendas (desenho do Codex), previsão do mês com nível de confiança, conversão por vendedor e origem, tempo por etapa, motivos de perda e funil de eventos.
- F2-2: vínculo do cartão com a proposta do Processo de Vendas e a avaliação do Avaliex (link ou ID), com links montados só a partir dos endereços oficiais.
- F2-5: aba Clientes reorganizada — filtros e atalhos no topo, lista enxuta e ficha lateral com autorizações, veículos, oportunidades, agendamentos, lembrete/mensagem e LGPD.
- F2-4: lembretes (pop-up na hora) e mensagens agendadas para o cliente pelo cartão de Vendas; envio respeita opt-out, janela de 24h e template aprovado; falha avisa quem agendou. Página "Meus lembretes".
- F2-1: ferramenta `qualificar_lead` do assistente — lead de novo/seminovo vira cartão no funil (sem duplicar), dono pela carteira ou rodízio; peças e incerto avisam a equipe.
- Notificações em pop-up (canto superior) com som e aviso do navegador.
- Migration `0003_vendas`: funis Novos/Seminovos e etapas configuráveis, oportunidades (qualificação separada da etapa,
  troca separada do veículo desejado, canal varejo/venda direta), histórico de etapas, atividades, tarefas, motivo de perda obrigatório.
- `/painel/vendas`: faixa do funil (90 dias) + indicadores, kanban com arrastar, carteira do vendedor + leads sem dono (assumir),
  painel lateral com qualificação, tarefas, contatos e linha do tempo.

### F0 Fundação (PR #1)
### Corrigido
- Opt-out e ficha única reconhecem o mesmo celular com e sem o 9º dígito.
- Mensagens agendadas não ficam presas em "enviando" (F2-4-001).
- Consultas de agenda com FK composta (PGRST201) e grants explícitos para o servidor.
- 0002: delimitadores `$` dos blocos DO (F0-2-003, achado também pelo Codex). Validada em Postgres local.
### Adicionado
- Migration `0002_nucleo`: unidades, usuarios (setor/papel/unidade), usuario_unidades, ficha única de cliente
  (CPF/CNPJ, nascimento, vendedor da carteira, ids externos), veículo (chassi/renavam), `unidade` nas tabelas
  operacionais, notificações e lembretes. **Ainda não aplicada no banco de dev.**
- Permissões por área (`src/lib/permissoes.ts`) e `exigirAcesso(area)` / `usuarioApi(area)` no lugar de `exigirPapel`.
- Menu por permissão, busca global (`/painel/busca`: CPF/CNPJ, telefone, placa, nome), central de notificações e sino.
- PWA instalável (manifest + ícones).
### Corrigido (revisão do Codex)
- Agenda respeita a unidade no banco (FK composta) e no servidor; pg_trgm independe do search_path.
- Exportação integral do cliente só com permissão LGPD; início mostra só o que o perfil pode ver.
- Equipe: papéis compatíveis com a tabela antiga e auditoria só após gravar.
### Alterado
- Caixa de busca da lateral removida (busca pelo menu "Buscar cliente").
- Gerente também supervisiona conversas (pode intervir na posse), como o admin.
- Retirada a caixa de busca da lateral. Buscar cliente continua acessível pelo menu.

## [0.0.1] — 10/11/2026 — Base inicial
- Chatbot de WhatsApp (agendamento, campanhas/eventos, follow-up, atendimento humano estilo CRM),
  painel com financeiro detalhado, links/QR rastreados, segurança (guard + filtro de saída), LGPD.
