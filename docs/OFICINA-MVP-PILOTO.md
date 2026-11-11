# Oficina — continuidade sobre a main

Claude liberou a próxima tarefa no repasse do PR #7 em 11/11/2026. Agenda continua a tela principal;
fila/triagem reutiliza a implementação existente em 35d56b2 (codex/oficina-v002), atualizada sobre a main.
Primeiro entregar 0004 separado para Claude revisar/aplicar; depois telas e validação. Não copiar o Nav,
as permissões ou documentos antigos por cima das correções atuais. O resumo de Oficina já usa agenda.

## Primeira fatia executável

Recuperar o domínio já existente com status novo e em_triagem, tornando 0004 reaplicável. Revalidar
ator ativo, papel/setor, unidade principal/adicional ou admin global, cliente não anonimizado e vínculo
do veículo no banco. Preservar IDs/eventos na reaplicação, idempotência do cadastro e da triagem e
rollback do histórico. Autorizar fila por ator antes de paginar; a consulta antiga por lista de unidades
mostrava colegas e não provava autorização do registro. Não esconder erro como fila vazia.

Claude confirmou: recepção/atendente vê a fila inteira das unidades autorizadas, com filtro minhas;
consultor técnico vê próprias e sem dono; gerente de Oficina/administração vê suas unidades; admin
todas as ativas. Assumir triagem não rouba responsável vigente. Recuperação
explícita de órfãos precisa ser tratada sem reatribuir silenciosamente. Essa semântica será alinhada com
Claude antes de ampliar o ciclo. Não inventar novas etapas ou confirmar agendamento sem a agenda existente.

## Interface a preparar após o SQL

Agenda permanece na entrada/menu e no cartão de Visão geral. Fila/triagem pode usar o quadro comum com
as duas etapas existentes, cards de cliente, veículo, solicitação, responsável e data, mais a ação de
iniciar triagem. Mostrar saída para a agenda existente; não criar um calendário paralelo ou copiar
permissões antigas. A extensão das contagens de Oficina precisa usar a mesma política da fila.

## Identidade confirmada e conversa em fatia posterior

A1/0006 e a guarda atual só aceitam Vendas/Peças. Claude confirmou a triagem como registro do domínio,
com vínculo opcional verificável ao agendamento. Recepção terá visão coletiva da unidade; consultor,
próprias e sem dono. Antes do WhatsApp ainda faltam o vínculo/proveniência do bot, as guardas de posse
e o ciclo explícito de devolução/encerramento. Não ligar rota geral por cliente nem montar o diálogo antes
dessas provas. A primeira fatia 0004/fila pode avançar independentemente desse contrato. Conversa de
Oficina, novas etapas, envio e integração com Revisão ficam em fatias explícitas posteriores.

## Riscos da branch antiga e validação

0004 usa CREATE simples e a fixture SQL concede grants do núcleo, mascarando instalação sem defaults.
As RPCs não validam perfil/setor; cadastro restringe à unidade principal, assumir não libera admin global,
e fila corta 100 sem cursor. Triagem não revalida anonimização/veículo, nem recupera em_triagem sem dono.
Esses pontos são correções da fatia inicial; a conversa modular não está implementada nessa branch.
O mapa antigo liberava Agenda a gerentes de outros setores; a main atual já corrigiu isso e deve ser
preservada. Provar permissões reais, histórico/rollback, reaplicação populada e paginação com dois modos
ACL; mocks não substituem SQL nem login/E2E. Sem Auth/seed/dados externos ou produção nesta preparação.


PR #7 confirmado merged no GitHub às 19:55:57 UTC em 11/11/2026; main v0.0.5 no pin
16b873b0b801beca8f17d19853609503ae174a55. O clone compartilhado ainda mantém refs/heads/main em
5e73115, mas claude/pos-v004 já aponta ao mesmo pin confirmado. A fatia será rebaseada nesse pin após
congelar os arquivos em edição; não usar origin/main antigo nem copiar permissões do legado.
