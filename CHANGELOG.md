# Changelog — Plataforma Comauto

Versionamento semântico a partir de **0.0.1** (decisão do Simão, 10/11/2026).
- Enquanto estivermos em `0.0.x`, cada entrega mesclada na `main` sobe o último número (0.0.1 → 0.0.2 → …).
- `0.1.0` = piloto na Comauto; `1.0.0` = produção no banco oficial.
- Toda versão mesclada ganha **tag git** `vX.Y.Z` e uma seção aqui. O que está numa branch e ainda não foi mesclado fica em "Não lançado".
- Quem mescla na `main` (Claude ou Codex) atualiza `package.json`, este arquivo e cria a tag.

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
- Peças (`codex/pecas`): primeira fila por unidade e cadastro de cotação de balcão, com vínculo a cliente e veículo quando informado.
- Peças (`codex/pecas`): assumir a cotação atribui o responsável e registra a mudança de etapa no histórico.
- Peças (`codex/pecas`): detalhe da cotação com inclusão de itens pelo responsável, quantidade, preço, custo opcional e total cotado.
- Peças (`codex/pecas`): edição dos itens em cotação com verificação de versão para preservar alterações recentes.
- Peças (`codex/pecas`): registro da apresentação leva a Aguardando cliente, confirma a versão dos itens e guarda a mudança no histórico.
- Peças (`codex/pecas`): registro da aprovação do cliente com histórico da etapa, separado da confirmação de venda.
- Peças (`codex/pecas`): entrada de pedidos do WhatsApp na fila, com identificação da origem e uma cotação por mensagem.
- Peças (`codex/pecas`): confirmação de venda separada da aprovação, com total e margem bruta quando todos os itens têm custo.
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
