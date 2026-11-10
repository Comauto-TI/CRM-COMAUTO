# Contratos de banco

Na raiz do projeto, com o Docker iniciado, rode no PowerShell:

```powershell
.\tests\sql\rodar.ps1
.\tests\sql\rodar.ps1 -IncluirDemo
```

O runner usa um Postgres 17 descartável sem portas publicadas. Cria os
papéis e a tabela de autenticação mínimos exigidos pela migração e
aplica a migração, o seed inicial e os quatro contratos. A opção
`-IncluirDemo` carrega o seed fictício duas vezes e valida os dados e
a reexecução. Ao final o container é removido.

Para carregar a demo em um banco local de apresentação, aplique
`supabase/seed.sql` uma vez e execute `SET comauto.ambiente = 'demo';`
junto de `supabase/seed_demo.sql` na mesma sessão. Use uma instância
isolada com integrações externas desativadas.

