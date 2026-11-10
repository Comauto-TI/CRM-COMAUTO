# Checagens de qualidade

Use Node 24, a versão do workflow. Instale as dependências com `npm ci`
e o lint com `npm ci --prefix tools/lint`. O lint usa o parser com
TypeScript 6 em um pacote separado. A checagem de tipos da aplicação
continua usando TypeScript 7.

Para verificar:

```sh
npm run typecheck
npm test
npm run lint
npm audit --audit-level=high
npm run lint:secrets
```

O último comando requer o Gitleaks no PATH. Para ativar a verificação
dos arquivos staged a cada commit, instale o pre-commit e rode
`pre-commit install` depois de configurar o repositório Git. O hook
fixa a versão do Gitleaks e usa as regras do projeto.

O workflow `Qualidade` executa typecheck, testes, auditoria,
contratos PostgreSQL e Gitleaks em pushes e pull requests. Use
`npm run test:e2e` conforme o guia em `tests/e2e/README.md`
para validar o painel com o Supabase local.

