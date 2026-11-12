# Transferência — mínimo necessário na central antes da UI

12/11/2026. SQL C522 aprovado/aplicado no dev pelo Claude; Codex conferiu11 casos PostgREST somente
leitura. UI deve consumir o backend existente, mas os caminhos legados abaixo ainda não provam
contexto/unidade/posse no mesmo statement. Dois inventários independentes readonly, sobre blobs
idênticos entre d596aef e98156e1. Este documento propõe contrato/donos; não é código já entregue.

## Leituras que o piloto atravessa

| Fonte | Desvio concreto |
|---|---|
| `api/painel/inbox/route.ts:15–38,48–73` | Contagens/limite80 sem unidade; prévia por amostra global pode omitir chats. Timestamp físico pode ser de contexto oculto. |
| `api/painel/fila/route.ts:13–35` | Limite50 antes de separar espera/posse; sem unidade. |
| `api/painel/conversa/[id]/route.ts:14–51` | Nove extras globais por cliente, segundo gate só por ID legado não detecta mudança de fase; GET zera contador físico. |
| `painel/layout.tsx:30–42`, `painel/page.tsx:45–53` | Badge/fila e contatos globais fora da política central. |
| `Conversa`, `Inbox`, `AlertaFila` | Respostas antigas podem sobreviver a troca/recusa; falta cancelar e invalidar contexto. |

Proposta de leitura central específica, reutilizando views, formatadores e componentes atuais:

- Lista/resumo/prévia e detalhe consultam política + corpo juntos. Ator ativo/papel/unidades ativas
  e vínculos extras atuais entram antes de count, filtro, ordenação e paginação. Um vetor de
  unidades lido em outra requisição não vira permissão reutilizável.
- Recepção/atendente e gestão Oficina/administração: coletivo das unidades autorizadas; admin,
  todas as ativas. Posse restringe mutação, não muda silenciosamente as abas coletivas. Confirmar
  essa semântica com Claude; `central_transferencia_legivel` atual é guarda de transferência,
  não uma política de lista bot/finalizados.
- Detalhe mínimo: contexto/canal/unidade/fase/versão, cliente mínimo, mensagens autorizadas,
  janela/opt-out e capacidades. Ao voltar para recepção/Oficina, somente snapshot recebido e
  mensagens novas da fase, sem anexar negócios anteriores por canal ou cliente.
- Não consultar `extraCliente` global como consequência da transferência. A ficha ampliada pode
  continuar por seus acessos específicos; não tratar todos os extras como autorizados no chat.
- GET sem escrita. Contador operacional da fase deve ser identificado como tal; nenhuma leitura
  pessoal fictícia. Marcas centrais por usuário/mensagem não estão aprovadas nesta fatia.
  Notificações pessoais existentes permanecem separadas.
- Prévia só das conversas da página, cursor estável data/ID e mesmo denominador das contagens.
  Erro deve indicar indisponibilidade; 403/404 ou fase diferente limpam contexto/drafts e respostas
  tardias, sem sugerir conversa disponível quando a capacidade é false.

## Posse e despacho

| Fonte | Corrida concreta |
|---|---|
| `conversas/actions.ts:45–58`; `outbound.ts:155–171` | Lê posse/legado, depois envia sem reserva central. A rota pode mudar entre as consultas e o HTTP. |
| `handoff.ts:162–180,192–206`; `actions.ts:23–35` | Confere view legada e atualiza a tabela física depois, sem a mesma rota/versionamento na própria mutação. |
| `actions.ts:68–75`; `outbound.ts:214–219,292–313` | Retomada verifica ausência modular, depois envia template sem callback final; autor sistema não entra na guarda de pendência só de atendente. |
| `handler.ts:214–215,247–248,346–353,425` | Bot usa contexto obtido antes do processamento; verificação isolada posterior também pode anteceder transferência. |

Proposta mínima para contrato do Claude:

1. Versão monotônica do contexto central distingue rota e ciclos devolver/reassumir pela mesma
   pessoa. Email/horário isolados não protegem retorno ao mesmo estado.
2. Mutações concretas de posse autorizam ator UUID/email da sessão, unidade/cliente/rota/versão
   atuais, UPDATE e audit sob lock na mesma RPC. Preservar ordem de locks existente.
3. Tentativa central usa UUID e mensagem reservada → despachando, reaproveitando o protocolo
   modular de mensagens/erros. Guardar modo/corpo/contexto; replay não despacha outra vez.
4. Transferir e mudar posse recusam tentativa central pendente, inclusive template. Autorizar
   despacho com CAS e política atual imediatamente antes do transporte pelo outbound existente.
5. Recusa determinística antes do HTTP cancela só reserva ainda não despachada; timeout ou resultado
   desconhecido permanece incerto, sem retry. Finalização não restaura texto após LGPD.
6. Não fingir que central é atendimento modular de Oficina. Retomada permanece em `notificar`,
   preservando consentimento/opt-out/template/horário. Bot/ACKs de opt-out precisam de autoridade
   atual/finalidade explícita; `autor=sistema` não deve virar exceção geral.

## Divisão proposta e pontos a confirmar

Codex: leitura/posse central em0006, adaptadores e UI reutilizando `Inbox`, `Conversa`,
`DialogoMensagens` e formulário de transferência. Claude: contrato e proteção do núcleo
`outbound/handoff/handler` (frente dele), ou delegação explícita do recorte concreto.

Confirmar coletivo por unidades, contador operacional sem novas marcas pessoais, detalhe mínimo
sem extras globais e os donos do fence de bot/retomada. Um componente de formulário pode ser
preparado/testado isoladamente, mas botão/action/endpoint não serão expostos antes desses gates.

Testes: política antes da paginação/contagem; retorno de Oficina sem vazamento; resposta tardia;
transferência versus claim/devolver/despacho; um CAS vencedor/um transporte; opt-out/24h/template;
falha real com rollback, revogação, anonimização e persistência incerta. Duas conexões reais para
concorrência; PGlite sequencial não substitui essa prova. Sem alterar Auth ou dados compartilhados.
