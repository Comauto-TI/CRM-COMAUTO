# Changelog — Protótipo "Mesa de leads" (CRM Comauto)

Mesmo padrão do CRM-COMAUTO: versionamento semântico a partir de **0.0.1**.
- Enquanto estivermos em `0.0.x`, cada entrega sobe o último número (0.0.1 → 0.0.2 → …).
- Versão em `crm/package.json`, seção aqui e tag git **`prototipo-vX.Y.Z`** (prefixo para não colidir com as tags `vX.Y.Z` do CRM-COMAUTO).
- Branch no repositório: `claude/prototipo-mesa-de-leads`. O que ainda não virou versão fica em "Não lançado".

## [Não lançado]

## [0.0.1] — 18/11/2026 — Pesquisa, checklist e esqueleto do protótipo
### Adicionado
- Relatório de pesquisa (`reports/`) e notas (`research_notes/`): CRMs brasileiros e internacionais, rentabilidade por departamento, qualificação de leads e contexto da Comauto.
- `CHECKLIST.txt` (passo a passo com caixinhas) e `DECISOES.md` (log de decisões).
- Protótipo em `crm/`: Next.js 16 + Drizzle + PGlite (Postgres local, sem Supabase).
- Login por função (admin, gerente, vendedor, pós-venda) com senha em hash e sessão assinada.
- Telas: fila de próximas ações e meus leads (vendedor), painel e todos os leads (gerente), revisões e alerta de garantia (pós-venda), usuários e auditoria (admin).
- **Ver como** do admin: abre as telas de uma pessoa específica em somente leitura, com faixa no topo, bloqueio de escrita no servidor e registro na auditoria.
- Pontuação de leads por regras (0–100, faixas A/B/C) e botão de WhatsApp no card.
- Dados de demonstração fictícios (senha `comauto123`).
