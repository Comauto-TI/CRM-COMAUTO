# Changelog — Plataforma Comauto

Versionamento semântico a partir de **0.0.1** (decisão do Simão, 10/11/2026).
- Enquanto estivermos em `0.0.x`, cada entrega mesclada na `main` sobe o último número (0.0.1 → 0.0.2 → …).
- `0.1.0` = piloto na Comauto; `1.0.0` = produção no banco oficial.
- Toda versão mesclada ganha **tag git** `vX.Y.Z` e uma seção aqui. O que está numa branch e ainda não foi mesclado fica em "Não lançado".
- Quem mescla na `main` (Claude ou Codex) atualiza `package.json`, este arquivo e cria a tag.

## [Não lançado] — branch `claude/f2-piloto`
### Adicionado
- A1.1d, associação da mensagem de Vendas ao atendimento e guarda de autorização por origem, setor e responsável atuais. Origem simultânea em mais de um setor bloqueia vínculo, replay e guarda de leitura, inclusive quando surgir depois de uma associação existente, preservando os registros. Vínculos anteriores de Peças mantidos; sem liberar corpo de mensagem, UI ou envio. Requer `20261111150300_vinculo_vendas_atendimento`.
- A1.1c, proveniência da qualificação de Vendas por mensagem real do WhatsApp, separada do código de marketing. Registro de origem e efeitos do lead são persistidos juntos; requer `20261111144252_origem_bot_vendas`. Associação ao atendimento e mensagens seguintes continuam pendentes.
- A1.1b, vínculo da mensagem inicial de Peças com prova do encaminhamento do bot, cotação e atendimento. FKs preservam a origem e impedem reclassificar a mensagem vinculada como interna; auditoria e associação são atômicas. Sem importar histórico, integrar telas ou liberar envio. Requer `20261111142602_mensagens_atendimento`; proveniência de Vendas e mensagens seguintes permanecem pendentes.
- A1.1a, base local de atendimentos por oportunidade/cotação atribuída: contexto de acesso derivado no banco, abertura idempotente e posse com versão, reserva única por canal modular e auditoria atômica. Wrappers apenas no servidor, sem liberar interface, envio ou rotas legadas. Requer `20261111140755_atendimentos_modulares`; demais partes de A1 seguem pendentes.
- Plano técnico A1 por fatias para autorizar atendimentos por setor, vínculo de negócio, unidade e posse antes de compartilhar a interface WhatsApp; implementação e testes de login seguem pendentes.
- Matriz de testes por perfil, com rodadas de subagentes, logins/sessões isolados e cobertura das telas e acessos proibidos.
- F5 Aniversários: semáforo 🟡 próximo / 🟢 hoje / 🔴 passou sem contato na Visão geral (carteira do vendedor; gerente vê todas); "Contato feito" e lembrete insistente em pop-up até registrar o contato.
- Ficha do cliente: editar nome, e-mail, cidade, CPF/CNPJ (validado, mascarado, sem duplicar ficha) e data de nascimento.
- Transferir lead (botão de setas no cartão e no painel): dono ou gerente passa para outro vendedor com motivo; registra na linha do tempo, avisa o novo vendedor e pode mover a carteira do cliente.
- Transferir carteira (gerente/admin, férias/saída): cartões abertos de um vendedor para outro ou divididos no rodízio.
- Equipe em Configurações: o admin cadastra a pessoa (login + papel, setor e unidade) com senha provisória exibida uma vez (nunca na URL); vincula e-mail que já tem login em outro sistema do grupo sem trocar a senha; nova senha só para quem foi criado pela plataforma.
- Prontidão do piloto (Gestão): o que bloqueia e o que falta, com a ação de cada item — só verifica se as chaves existem, nunca mostra valores.
- Pedido de peças pelo WhatsApp entra direto na fila de cotações de Peças (sem duplicar se a mensagem chegar repetida); o aviso à equipe abre a cotação.
### Alterado
- Direção de organização por setores documentada: atendimento, relacionamento, carteira e métricas em Vendas, Peças e Oficina; visão pessoal, gerencial e administrativa com escopo validado no servidor.
- Troca de vendedor só pela transferência (registrada e avisada); saiu o campo solto do formulário de qualificação.
- Painel sem animações contínuas nem desfoque.
### Corrigido
- Bot de Vendas: criação/atualização, atividade, aviso, auditoria e carteira são atômicos e reprocessamento da mensagem não duplica efeitos. Mantém responsável existente e decisões de qualificação da equipe; novo lead considera vendedores com unidade adicional, com supervisão elegível quando necessário. Falha da transação não confirma sucesso.
- Aniversários: notas internas e mensagens com falha não contam como contato; datas respeitam o fuso configurado, a carteira é lida em páginas e lembretes pendentes não expiram depois de sete dias. Registro de contato, nota, auditoria e conclusão são atômicos; o pop-up só remove após sucesso e informa falhas. Administrador pode atuar nas unidades ativas; demais perfis mantêm carteira/unidade. Requer a migration `20261111134242_aniversarios_contatos`.
- Meus lembretes orienta para a ficha do cliente e respeita o acesso do perfil nos links, inclusive Peças e Financeiro. Smoke de navegador atualizado para os seletores da central de atendimento atual.
- Cadastro da equipe: origem do login validada em metadados controlados pelo servidor, retomada de cadastro parcial com senha provisória, busca de contas sem corte nas primeiras 20 páginas e proteção do próprio administrador contra desativação pelo formulário.
- Encaminhamento interno de Peças/triagem: confirma registro apenas após gravar pedido, nota e avisos na mesma transação; repetição da mensagem preserva os efeitos únicos e destinatários incluem unidades adicionais. Contexto da conversa acompanha o `wamid`; requer a migration `20261111130139_encaminhamentos_bot`.
- Rótulos do funil de Vendas não quebram mais no meio da palavra.
- Transferências (revisão do Codex, F1-V-T001–T005): destino precisa ter acesso a Vendas e à unidade (inclusive adicional); lote valida cada unidade; troca de responsável, carteira e nota gravadas juntas (RPC `vendas_transferir`); lote grande lido em páginas com aviso de parcial; responsável não muda mais pelo formulário de qualificação.

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
