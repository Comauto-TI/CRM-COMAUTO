# Plano do projeto — Assistente WhatsApp Comauto
Felder Systems · iniciado em 10/11/2026 · responsável: Simão

## 1. Listagem (o que é, como e etapas)
**O quê:** agente de IA no WhatsApp oficial para agendamento de revisões/serviços, eventos e marketing, follow-up e atendimento humano, com painel de controle e financeiro.
**Como:** Next.js 16 (Vercel) + Supabase + WhatsApp Cloud API + Claude Haiku 5.5. Regras da Meta e da LGPD implementadas no código, não só no prompt.
**Etapas atuais:** ver roadmap técnico. **Etapas futuras:** ver "Fora do escopo / v2".

## 2. Definição de pronto (escopo travado)
**Está incluído (v1):**
- Conversa com IA para agendar, remarcar, cancelar, consultar e confirmar evento; recusa de código, receitas, cupons e chaves.
- Consentimentos separados, opt-out, janela de 24h, templates, horário comercial, anti-spam, LGPD (exportar/anonimizar).
- Agenda com serviços, boxes, horários, bloqueios/feriados e trava de conflito.
- Lembretes 24h/2h, véspera de evento, follow-ups automáticos.
- Campanhas com pré-checagem, teste, lotes, limites e pausa automática.
- Atendimento humano estilo CRM (alerta no WhatsApp da recepção + popup + janela com ficha do lead).
- Painel: visão geral, atendimento, agendamentos, clientes, campanhas, follow-ups, financeiro, segurança, configurações.

**NÃO está incluído (v1):** áudio/imagem (a IA pede texto), pagamento/sinal pelo WhatsApp, integração com DMS/ERP da concessionária, Google Agenda, catálogo de veículos com estoque, formulário público de opt-in, recepcionista respondendo pelo WhatsApp pessoal (**descartado**), app mobile do painel.

**Revisões combinadas:** (definir com o cliente: sugestão de 2 rodadas de ajuste após o piloto).

## 3. Roadmap técnico (Simão)
| # | Etapa | Status |
|---|---|---|
| 1 | Schema + seed + RLS fechado | ✅ |
| 2 | Segurança (guard entrada/saída, opt-out, máscara LGPD) + 105 testes | ✅ |
| 3 | Envio (outbound), agenda, handoff, agente, orquestração | ✅ |
| 4 | Webhook, crons, campanhas, follow-ups, custos | ✅ |
| 5 | Painel completo + financeiro + CSV | ✅ |
| 6 | Build de produção + smoke test (webhook/HMAC/cron/auth/headers) | ✅ |
| 7 | Supabase Pro + Vercel Pro + domínio | ⏳ Simão |
| 8 | Meta: verificação, número, System User, templates aprovados | ⏳ Simão/cliente |
| 9 | gitleaks + CI (Codex C8) + red team (Codex C1) + testes de banco (C3) | ⏳ Codex |
| 10 | Links e QR Code rastreados (funil por origem) | ✅ |
| 11 | gitleaks instalado e validado (pega chave realista; varredura limpa) | ✅ |
| 12 | Go-live em fases 0→1→2→3 (ver seção 6) | ⏳ |

## 4. Roadmap do cliente (linguagem de resultado)
1. **Semana 1:** seu WhatsApp passa a agendar revisões sozinho, 24h por dia, sem conflito de horário.
2. **Semana 2:** clientes recebem confirmação e lembrete automáticos; menos faltas.
3. **Semana 3:** a recepção atende só o que precisa de gente, com aviso no celular e a ficha completa do cliente na tela.
4. **Semana 4:** convites de eventos e campanhas para a base autorizada, com custo previsto antes de enviar.
5. **Sempre:** painel mostra quanto custou cada mensagem, cada agendamento e cada evento.

## 5. Log de decisões (o porquê)
| Data | Decisão | Motivo |
|---|---|---|
| 10/11 | Next.js 16 + Supabase + Vercel | Já previsto nos PDFs de custo; um único deploy para webhook, crons e painel. |
| 10/11 | Claude Haiku 5.5, `effort: low`, sem desligar o thinking | Pedido do Simão; é o mais barato (US$ 0,10/0,50 por MTok). A documentação recomenda baixar o effort em vez de desligar. |
| 10/11 | Prompt congelado + contexto em mensagem `system` no fim | Prompt caching (cache read a 10% do preço). |
| 10/11 | Recusas por filtro determinístico ANTES da IA | Não dá para manipular, custo zero, auditável. A IA é só a 2ª barreira. |
| 10/11 | "Códigos" = programação **e** cupons/códigos promocionais | Decisão do Simão. |
| 10/11 | Conflito de agenda garantido no Postgres (exclusion constraint) | Duas mensagens simultâneas nunca marcam o mesmo box. |
| 10/11 | RLS ligado e sem políticas; painel só via servidor | O navegador nunca acessa o banco; menor superfície de ataque. |
| 10/11 | Popup da fila por polling de 5 s (não Realtime) | O Realtime exigiria abrir o RLS para o navegador. |
| 10/11 | Recepção responde só pelo painel (v1) | Ponte pelo WhatsApp pessoal é frágil; descartada pelo Simão. |
| 10/11 | Custo da Meta lançado no "delivered" com a categoria do webhook | A Meta cobra por entregue e pode reclassificar template; assim o financeiro fica certo. |
| 10/11 | Projeto único na raiz; scaffold `comauto-whatsapp/` excluído | Pasta paralela criada durante o trabalho; decisão do Simão: manter a raiz. |
| 10/11 | Go-live em fases, começando pelo receptivo + links/QR | Quando o cliente chama primeiro, não precisa de template nem verificação; a parte cara (marketing) entra quando a conta já tem histórico. |
| 10/11 | QR aponta para /r/<código> (link curto nosso) | Conta escaneamentos; opção wa.me direto para quando o painel estiver fora. |

## 6. Go-live em fases (decidido em 10/11)
O cliente chamando primeiro não depende de template nem de verificação da Meta: a janela de 24h permite resposta livre. Então o lançamento NÃO espera a Meta aprovar tudo.

| Fase | O que liga | Depende de | Como gerar movimento |
|---|---|---|---|
| **0. Teste interno** | Equipe testa o bot com o número de teste da Cloud API (até 5 telefones cadastrados) | Anthropic + Supabase + número de teste | — |
| **1. Receptivo** | Bot responde quem chama: agenda, dúvidas, recusas de segurança, recepção | Número oficial na Cloud API (sem template) | **Links e QR Code** do painel: QR no balcão/oficina, link na bio do Instagram e no site, anúncio Click-to-WhatsApp (janela grátis de 72h). Tudo rastreado: cliques → conversas → agendamentos → custo |
| **2. Lembretes** | Confirmação + lembretes 24h/2h + follow-up pós-serviço | Templates *utility* aprovados | Consentimento de serviço coletado ao agendar |
| **3. Marketing e eventos** | Convites, campanhas, revisão periódica | Verificação da empresa + qualidade da conta + base com consentimento de marketing | Campanhas do painel (teste → lotes → limite diário) |

## 7. Checklist de go-live
- [ ] Meta Business verificado · número dedicado · token System User
- [ ] Todos os templates criados e **aprovados** (e marcados como aprovados no painel)
- [ ] Endereço, serviços, preços de referência, horários e feriados preenchidos
- [ ] Recepcionistas cadastradas com WhatsApp e "recebe alertas"
- [ ] Política de privacidade publicada (link no perfil do WhatsApp Business)
- [ ] `npm run lint:secrets` limpo · variáveis só na Vercel · `.env.local` fora do git
- [ ] Testes do item 14 das regras (agendamento, horário ocupado, opt-out, fora do horário, atendente, evento esgotado, número inválido)
- [ ] Piloto interno → 10-50 clientes → escala gradual

## 8. Pendências que dependem de terceiros
- **Cliente:** endereço, horários reais, preços de referência (ou "sob consulta"), lista de recepcionistas, política de privacidade, aprovação dos textos dos templates.
- **Simão:** contas Supabase/Vercel/Meta, domínio, preço do projeto e contrato mínimo (escopo, prazo, valor, pagamento).
- **A confirmar:** preços da Meta (vêm do PDF; não deu para conferir na fonte oficial) e a cobrança de mensagens de serviço desde out/2026.

## 9. Handoff ao cliente (quando entregar)
Acessos do painel por pessoa (papel admin/atendente/financeiro), manual curto de 1 página por papel, o que fazer se o bot falhar (desligar o assistente em Configurações = tudo vai para a recepção), contato de suporte e SLA de manutenção.
