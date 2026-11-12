# Revalidação dirigida do PR #9

Histórico do pin5941347. R1 foi corrigido e conferido no pin98156e1; parecer atual em
[APROVACAO-PR9.md](APROVACAO-PR9.md).

12/11/2026. Candidato `5941347fbf043e2eb4511f4585559e7f521add4e`, sobre a base
`bc14aa1e90e440ec87e6fc88a275c817041b7f87`. Delta reconferido desde o pin revisado `8df62ff`:
fix `8c8fc18` e dois commits de coordenação. PR consultado aberto/não mesclado.

**Requer ajuste em ACOMP003-R1.** Cinco achados anteriores foram corrigidos; o caso simples de
Desfazer também foi corrigido, mas um evento sem mudança real de status ainda oculta a chegada.
Não declarar APROVADO com base nas demais correções.

## ACOMP003-R1 · Salvar sem mudar status oculta a chegada válida

`src/app/painel/agendamentos/acompanhamento/actions.ts:40–42` procura o último histórico cujo
`para_status` é igual ao status atual. Não descarta um evento `compareceu → compareceu`.
`src/lib/scheduling/acompanhamento.ts:53–55` rejeita esse `de_status` e volta à inferência pelo
timestamp antigo `confirmado_em`, embora exista uma chegada válida anterior.

Cenário reproduzido com funções originais e relógio determinístico:

1. Agendamento já confirmado é posto em `pendente` pela ação original da Agenda. Seu timestamp
   antigo de confirmação continua preenchido, comportamento alcançável na baseline.
2. Chegou registra `pendente → compareceu`.
3. Salvar na Agenda mantendo o status selecionado como `compareceu` registra um evento sem
   alteração real: `compareceu → compareceu`. O harness chamou a ação original; não inseriu esse
   evento artificialmente.
4. Desfazer seleciona o evento sem mudança mais recente e termina **confirmado**, quando deveria
   restaurar **pendente**.

O controle com a mesma preparação, sem o passo3, volta a pendente. Outros ciclos de chegada,
ausência e desfazer, com ordenação temporal, também foram conferidos. Portanto a falha restante é
a seleção do histórico, não somente a função pura que interpreta o `de_status`.

Correção proposta: selecionar a marcação efetiva de presença correspondente ao estado atual,
ignorando eventos que não mudam status; restaurar o estado real sob CAS. Acrescentar o cenário de
Salvar sem mudança ao teste da ação, além dos testes isolados de `statusAoDesfazer`.

## Correções conferidas

| Achado | Evidência controlada no pin5941347 |
|---|---|
| SETOR-001 | QR próprio200; alheio/inexistente404 em SVG/PNG antes de configuração/geração; ausência de sessão401 sem consulta. |
| SETOR-002 | Lista/funil só do setor para gerentes; evento alheio devolve null antes das contagens. Admin/gerente administração globais preservados. Campanha de Peças vinculada a evento de Vendas é excluída do gerente setorial, mantida no global. |
| ACOMP-004 | Erro08006 mostra aviso/tentar de novo; não mostra KPIs zerados ou mensagem de dia vazio. |
| BAIXA-005 | Mês13 e30/fevereiro usam data segura, sem RangeError; calendário válido preservado. |
| BAIXA-006 | Handler nomeado é removido no cleanup. Fonte antiga executava3 callbacks após desmontar; nova executou0. |

## Método e limites

- Marketing: **23 casos PASS**, funções/rota/política originais por Next SWC/VM e fronteiras em
  memória. Artefatos privados `work/pr9-marketing-revisao.cjs/.json`; evidência antiga preservada
  em `pr9-marketing-revisao-8df62ff.cjs/.json`.
- Acompanhamento: **10 casos executados**, com R1 reproduzido e controles de CAS/unidade/23P01.
  `work/revisao-pr9-acompanhamento.mjs` e `work/revisao-pr9-acompanhamento-resultados.json`;
  artefatos originais8df preservados separadamente.
- Abertura: **10 verificações offline PASS**, documento pronto/load/timeout/reduced motion e
  seis desmontagens em momentos diferentes, com hooks/window/document/relógio simulados.
- Raiz leu o delta integral; diffcheck e gitleaks dos três commits passaram. Oficina/SQL e demais
  fontes imutáveis não tiveram suas matrizes repetidas.

Sem nova sessão, HTTP, Auth/banco real, envio, build completo, hidratação ou mobile real nesta
revalidação. Os resultados não substituem esses testes. Nenhuma fonte do Claude foi corrigida pelo
Codex nem novo scan do PR8 foi aberto. Claude pode corrigir somente R1 e disponibilizar novo pin.
