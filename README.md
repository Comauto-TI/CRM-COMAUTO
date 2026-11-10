# Assistente WhatsApp — Comauto

Chatbot oficial de WhatsApp (Cloud API da Meta) com IA Claude Haiku para **agendamento de revisões e serviços**, **eventos e campanhas**, **follow-up**, **atendimento humano pela recepção** (estilo CRM) e **painel com financeiro detalhado**.

> Regras de negócio obrigatórias: [Regras a serem respeitadas.md](Regras%20a%20serem%20respeitadas.md) · Plano, escopo e decisões: [docs/PLANO.md](docs/PLANO.md) · Instruções para agentes (Codex/Claude): [AGENTS.md](AGENTS.md)

## O que já funciona
- **Conversa com IA** (Claude Haiku 5.5, prompt cacheado): agenda, remarca, cancela, consulta horários **reais**, confirma presença em evento, registra interesse e consentimento.
- **Segurança em 4 camadas:** recusa fixa (sem chamar a IA) para pedidos de código, receitas, cupons, chaves/senhas e tentativas de manipulação; prompt com regras e canário; a IA nunca recebe segredo; filtro de saída antes de enviar. Tudo fica registrado em *Segurança*.
- **Regras da Meta e da LGPD aplicadas no código:** consentimento separado (serviço/eventos/marketing), opt-out imediato (SAIR, PARAR, CANCELAR…), janela de 24h, só template aprovado, horário comercial, anti-spam, cartão e CPF mascarados, exportar e anonimizar dados.
- **Agenda sem conflito garantida pelo banco** (exclusion constraint), com histórico completo e **quem confirmou, quando e por qual canal**.
- **Lembretes** 24h e 2h com botões Confirmar/Remarcar/Cancelar; lembrete de véspera de evento.
- **Follow-ups:** pós-serviço, não compareceu, revisão periódica, lead que não agendou (no máximo 1 tentativa, sem insistência).
- **Campanhas:** pré-checagem (consentimento, opt-out, duplicados, inválidos), custo estimado, grupo de teste, lotes, limite diário, pausa automática por falhas.
- **Atendimento humano:** pediu atendente → cliente avisado → alerta no WhatsApp das recepcionistas + popup com som e notificação no painel → janela de chat com a ficha do lead (veículos, agendamentos, consentimentos, notas, tags) → assumir, responder, devolver ao bot, encerrar. Com SLA e reenvio do alerta.
- **Links e QR Code rastreados:** gera link wa.me e QR (PNG/SVG) com mensagem pronta. O cliente chama primeiro (sem template e sem custo de disparo) e o painel mostra o funil por origem: escaneou → conversou → agendou → custo.
- **Financeiro:** custo real por mensagem entregue (categoria vinda da Meta), IA por token (com % de cache), fixos, por campanha, por agendamento confirmado, por cliente, projeção do mês, gráfico diário, simulador de evento e exportação em CSV.

## Rodar localmente
```bash
npm install
cp .env.example .env.local      # preencha (NUNCA commite este arquivo)
npm test                        # 109 testes
npm run dev                     # http://localhost:3000
```

## Colocar no ar (passo a passo)
1. **Supabase** (plano Pro): crie o projeto e rode `supabase/migrations/0001_init.sql` e depois `supabase/seed.sql` (SQL Editor ou `supabase db push`).
2. **Primeiro usuário do painel:** crie em *Authentication → Users* e depois rode:
   ```sql
   insert into admin_usuarios (user_id, nome, papel) values ('<uuid do usuário>', 'Seu Nome', 'admin');
   ```
3. **Meta:** Business verificado, número dedicado na WhatsApp Cloud API, token de **System User** (permanente). Crie no WhatsApp Manager cada template de *Configurações → Templates* com o **mesmo nome e texto** e envie para aprovação.
4. **Vercel** (plano Pro, pelos crons): importe o repositório, configure as variáveis do `.env.example` e faça o deploy. Os crons de `vercel.json` já vêm configurados (horários em UTC).
5. **Webhook na Meta:** URL `https://SEU-DOMINIO/api/webhook/whatsapp`, token de verificação = `WHATSAPP_VERIFY_TOKEN`, assine o campo **messages**.
6. No painel: preencha *Configurações* (endereço, serviços e preços de referência, horários, equipe com WhatsApp para alertas). Marque cada template como **aprovado** só depois da aprovação da Meta.
7. **Antes do primeiro deploy:** `npm run lint:secrets` (gitleaks). **Obrigatório.**
8. **Go-live em fases** (ver docs/PLANO.md § 6): teste interno → receptivo com QR/links (não precisa de template) → lembretes (templates utility) → marketing/eventos (empresa verificada).

## Estrutura
Ver [AGENTS.md § 4](AGENTS.md).
