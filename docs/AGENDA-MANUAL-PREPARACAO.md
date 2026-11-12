# Agenda manual — preparação de A/B

Pedido do Simão repassado pelo Claude em 12/11/2026: descrição livre do serviço e início/fim ou
duração livres com recurso. Prioridade de implementação depois do SQL de transferência. Este
levantamento é independente e **somente de preparação**, enquanto a autorização do núcleo está
pendente. Não modifica SQL, agenda, bot, banco, contas ou o acompanhamento do Claude.

Fonte compartilhada observada: `775f39e465ca9989823ed5957d7d464f71c8da39`; leitura dos arquivos
atuais não significa incorporação desse commit na branch do Codex. Conferir a ref antes de editar.

## Contratos atuais que a mudança precisa preservar

- `0001_init.sql:161–185`: serviço e recurso obrigatórios, fim maior que início, `sem_conflito`
  por recurso e intervalo `[início,fim)` para status pendente/confirmado. Não retirar a exclusion
  constraint para aceitar horário manual; conflito concorrente continua sendo `23P01`.
- `0002_nucleo` liga serviço/recurso/agendamento à unidade. Permitir serviço nulo não permite
  aceitar recurso estrangeiro, unidade inativa ou unidade não autorizada ao ator.
- `booking.ts:93–127`/`slotExato`: criação atual procura slot do catálogo. Duração, recurso e
  horários do bot vêm desse serviço; esse caminho não pode receber livremente a nova descrição
  como se fosse serviço cadastrado ou substituir preço/duração por valores inventados.
- `agendamentos/actions.ts:50–95`: formulário atual exige serviço e deriva unidade dele, sem
  recurso/fim informados. Também envia pedido oficial de confirmação depois de gravar. A criação
  manual precisa derivar unidade do recurso autorizado e guardar início/fim explícitos no servidor.
- `booking.ts:236–262`: reagendamento atual passa `ag.servico_id` a `slotExato`/`alternativas`.
  Depois de tornar o serviço opcional, é obrigatório tratar manual com serviço nulo antes dessas
  chamadas. Não considerar isso bug atual: o banco hoje exige serviço; é dependência da alteração.

## SQL proposto para revisão posterior

Em `0004_oficina`, reaplicável, sem migration avulsa:

1. Acrescentar `agendamentos.descricao_servico`; tornar `servico_id` opcional preservando FK e
   dados existentes. A constraint exige serviço válido ou descrição não vazia de pelo menos3
   caracteres após normalização. **Tratar NULL explicitamente:** um CHECK que só compara tamanho
   pode aceitar NULL. Não usar a mudança para criar linhas sem ambos os campos.
2. Preservar recurso obrigatório, fim maior que início e conflito por recurso. Recurso/unidade
   ativos e autorização atual do ator devem ser comprovados na escrita; IDs do form não bastam.
3. Criação manual e histórico precisam ser atômicos e idempotentes por tentativa. Falha de histórico
   não pode deixar agendamento sem registro, nem retry criar dois agendamentos ou dois avisos.
4. Não fazer backfill de descrição/chegada/data de atualização com texto ou horários fictícios.
   Histórico da criação manual guarda descrição e intervalo efetivamente aceitos.

Definir com Claude antes de implementar: limite de texto/duração e tratamento de horário manual
fora do expediente ou sobre bloqueio explícito. "Livre" remove a dependência dos slots do catálogo;
não presume permissão para ultrapassar bloqueios administrativos.

## Código e pontos de exibição

| Ponto | Adaptação necessária após SQL aprovado |
|---|---|
| Form e action de Agendamentos | Descrição escrita, recurso autorizado, início e fim/duração; validação real de data/horário, unidade e autor no servidor. Mostrar conflito com mensagem clara. |
| Lista de Agendamentos | Descrição livre quando presente, senão nome do catálogo; exibir intervalo aceito e recurso. |
| Acompanhamento do dia, campo `acomp-servico` | Acrescentar descrição ao SELECT/tipo e usar o mesmo fallback. Claude é dono da tela; fazer integração dirigida, sem reescrever os grupos/atalhos já entregues. |
| Resumo do painel e ficha da conversa | Incluir descrição na consulta/DTO e no rótulo; não deixar serviço manual sem identificação. |
| `agendamentosDoCliente` e ferramentas do bot | Mostrar o texto real, sem inventar preço/duração; tratamento explícito do reagendamento manual para recepção. |
| Confirmação/lembretes/templates e exportação LGPD | Auditar consumidores do nome do catálogo e substituir pelo rótulo do agendamento. Manter consentimento/opt-out/janela/templates/outbound. |
| Marcar comparecimento/revisão | Não alimentar automaticamente revisão periódica por uma expressão livre ambígua. Preservar a regra do catálogo ou exigir classificação explícita aprovada. |

O item(C), acompanhamento, já foi assumido pelo Claude. A/B não incluem mudar sua regra de atraso,
taxa de comparecimento, tolerância, atalhos ou atualização automática. Não iniciar outro servidor.

## Matriz de validação preparada, não executada

- SQL: serviço legado válido; manual com descrição válida e serviço nulo; recusar ambos nulos,
  texto vazio/curto, fim igual/anterior e recurso/unidade indevidos. Reaplicação populada preserva
  registros/FKs/ACL/identidades. Anon/authenticated não ganham escrita direta.
- Intervalo: mesmo recurso sobreposto recusa com23P01; limites adjacentes aceitam; recursos
  distintos aceitam quando autorizados; confirmar/restaurar status revalida conflito.
- Operador: recepção/consultor/gerente Oficina e admin conforme unidade; outro setor, ator inativo
  e unidade extra revogada recusam sem efeito. Campos forjados de cliente/ator/unidade não comandam
  autorização. Falha real após INSERT deve desfazer agendamento e histórico.
- Form: datas impossíveis, fim/duração inconsistentes, duplicidade de campos, texto longo e
  tentativa repetida. UI não anuncia confirmação ou WhatsApp enviado quando a operação falhou.
- Regressão do bot: continua catálogo; lista manual sem exceção em serviço nulo; reagendamento
  manual encaminhado/tratado pelo caminho autorizado, sem escolher preço/horário arbitrário.
- Apresentação: mesmo rótulo/intervalo em lista, acompanhamento, resumo, conversa, lembretes e
  exportação; nenhuma descrição real deve aparecer em testes/relatórios de QA.

Não foram executados testes funcionais novos nem login/CRUD/concorrência reais nesta preparação.
PGlite de uma conexão não substituirá a disputa multissessão. Nenhum item de A/B está entregue.
