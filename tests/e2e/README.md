# Smoke do painel

Execute a partir da raiz em uma cópia de teste do projeto. Use um
Supabase local, o seed inicial e o seed demo recém-carregado, com
conversas aguardando atendimento. Crie um usuário de teste no Auth e
vincule seu ID na tabela `usuarios` (antes da migration 0002: `admin_usuarios`) com papel `admin` e setor `administracao`.

Configure o `.env.local` com as credenciais do Supabase local e valores
fictícios para os demais serviços. Passe `COMAUTO_E2E_EMAIL` e
`COMAUTO_E2E_SENHA` no ambiente. Use uma cópia dedicada do banco, pois
a suíte assume e devolve uma conversa de demonstração.

```powershell
npm ci
npx playwright install chromium
npx playwright test --config tests/e2e/playwright.config.mjs
```

O Playwright sobe o painel local na porta 3300. O processo do Next
intercepta o transporte do Graph e só aceita respostas a números da
demo. O fluxo cobre login, popup da fila, assumir, responder, devolver
ao bot e abrir o financeiro.

