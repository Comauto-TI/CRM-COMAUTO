# Changelog — Plataforma Comauto

Versionamento semântico a partir de **0.0.1** (decisão do Simão, 10/11/2026).
- Enquanto estivermos em `0.0.x`, cada entrega mesclada na `main` sobe o último número (0.0.1 → 0.0.2 → …).
- `0.1.0` = piloto na Comauto; `1.0.0` = produção no banco oficial.
- Toda versão mesclada ganha **tag git** `vX.Y.Z` e uma seção aqui. O que está numa branch e ainda não foi mesclado fica em "Não lançado".
- Quem mescla na `main` (Claude ou Codex) atualiza `package.json`, este arquivo e cria a tag.

## [Não lançado] — branch `claude/f0-nucleo` (F0 Fundação)
### Adicionado
- Migration `0002_nucleo`: unidades, usuarios (setor/papel/unidade), usuario_unidades, ficha única de cliente
  (CPF/CNPJ, nascimento, vendedor da carteira, ids externos), veículo (chassi/renavam), `unidade` nas tabelas
  operacionais, notificações e lembretes. **Ainda não aplicada no banco de dev.**
- Permissões por área (`src/lib/permissoes.ts`) e `exigirAcesso(area)` / `usuarioApi(area)` no lugar de `exigirPapel`.
- Menu por permissão, busca global (`/painel/busca`: CPF/CNPJ, telefone, placa, nome), central de notificações e sino.
- PWA instalável (manifest + ícones).
### Alterado
- Gerente também supervisiona conversas (pode intervir na posse), como o admin.

## [0.0.1] — 10/11/2026 — Base inicial
- Chatbot de WhatsApp (agendamento, campanhas/eventos, follow-up, atendimento humano estilo CRM),
  painel com financeiro detalhado, links/QR rastreados, segurança (guard + filtro de saída), LGPD.
