# CRM Comauto (protótipo)

## Rodar no PC

```bash
cd crm
npm install
npm run dev
```

Abra http://localhost:3000. Na primeira execução o banco local é criado em `.data/` e recebe os dados de demonstração.

Precisa de um arquivo `.env.local` com:

```
SESSION_SECRET=<texto aleatório longo>
```

Para gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## Contas de demonstração

Senha de todas: `comauto123` (dados fictícios).

| E-mail | Função |
|---|---|
| admin@comauto.demo | Administrador |
| gerente@comauto.demo | Gerente |
| carla@comauto.demo, diego@comauto.demo, paula@comauto.demo | Vendedores |
| posvenda@comauto.demo | Pós-venda |

## Ver como (admin)

Admin → **Ver como** → escolha uma pessoa. As telas aparecem exatamente como ela vê, com uma faixa amarela no topo. É somente leitura: o servidor bloqueia qualquer alteração. Entradas, saídas e tentativas bloqueadas ficam em **Auditoria**.

## Banco

- Zerar os dados de demonstração: pare o servidor e apague a pasta `.data/`.
- Mudou o esquema (`src/db/schema.ts`)? Rode `npx drizzle-kit generate`. A migração é aplicada sozinha quando o servidor sobe.
- O PGlite só deixa um processo abrir o banco por vez: pare o `npm run dev` antes de rodar `npm run build`.
