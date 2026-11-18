# Decisões do projeto CRM Comauto

Log curto: o que escolhemos e por quê (Regra 13).

## 18/11/2026

- **Stack: Next.js 16 + React 19 + Tailwind 4 + Drizzle ORM.** Uma base só para telas e servidor, versões conferidas no npm em 18/11/2026. Drizzle porque o mesmo esquema funciona no Postgres local e no de produção.
- **Banco no protótipo: PGlite (Postgres rodando dentro do Node), não Supabase nem Docker.** Não precisa instalar nada no Windows. O `embedded-postgres` foi descartado porque o npm bloqueia o script de instalação dele. Na produção: trocar o driver para um Postgres comum. O esquema e as migrações continuam os mesmos.
- **`cacheComponents` desligado.** Todas as telas do CRM dependem de quem está logado, então o cache estático só complicaria sem ganho.
- **Login próprio (bcrypt + cookie assinado com jose), sem biblioteca de auth.** Para o protótipo é suficiente e fácil de auditar. Reavaliar (ex.: Better Auth) antes de ir para produção, principalmente se entrar login com Google ou 2FA.
- **"Ver como" do admin = visualização somente leitura de um usuário específico, não troca de login.** Escolhemos a pessoa (e não só a função) porque a tela do vendedor só faz sentido com os leads de alguém. O bloqueio de escrita é feito no servidor (`exigirEscrita`), não só no botão. Toda entrada, saída e tentativa bloqueada vai para a auditoria (LGPD).
- **Pontuação de leads por regras (0 a 100, faixas A/B/C), sem IA por enquanto.** O gerente consegue entender e auditar. Os pesos iniciais vêm da pesquisa (origem, test drive, troca, financiamento, cliente da casa) e devem ser recalibrados com o histórico do DuLeads.
