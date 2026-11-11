# A1 — Plano de acesso aos atendimentos por módulo

Status: A1 em andamento. As fatias A1.1a a A1.1d e A1.2a a A1.2c têm código local isolado, descrito abaixo.
O MVP local de Peças integra quadro e conversa no recorte de `docs/PECAS-MVP-PILOTO.md`.
Demais fatias continuam propostas; não houve teste de login, E2E nem aplicação destas migrations em dev/produção.

Levantamento inicial: branch `codex/atendimento-modulos`, base `f6370a1`.
Nenhum acesso a Auth/banco remoto é necessário para preparar e testar o contrato localmente.

## Consolidação por módulo e prioridade atual — 11/11/2026

Decisão atual do Simão: manter um arquivo reaplicável por módulo. F5 e a proveniência
do bot em Vendas pertencem a `0003_vendas.sql`; a camada entre setores pertence a
`0006_atendimento.sql`. Alterações futuras entram no arquivo do módulo dono, sem criar
migrations avulsas com timestamp. O mapeamento dos nove artefatos anteriores é:

| Artefato anterior | Arquivo atual do módulo |
| --- | --- |
| `20261111130139_encaminhamentos_bot.sql` | `0006_atendimento.sql` |
| `20261111134242_aniversarios_contatos.sql` | `0003_vendas.sql` |
| `20261111140755_atendimentos_modulares.sql` | `0006_atendimento.sql` |
| `20261111142602_mensagens_atendimento.sql` | `0006_atendimento.sql` |
| `20261111144252_origem_bot_vendas.sql` | `0003_vendas.sql` |
| `20261111150300_vinculo_vendas_atendimento.sql` | `0006_atendimento.sql` |
| `20261111152147_leitura_mensagens_atendimento.sql` | `0006_atendimento.sql` |
| `20261111154525_lista_atendimentos.sql` | `0006_atendimento.sql` |
| `20261111160139_leituras_usuario_atendimento.sql` | `0006_atendimento.sql` |

Os dois DDLs compartilhados de A1.1b (coluna gerada de entrada externa e índice composto
de `mensagens`) ficam em `0003_vendas`, antes da FK do ledger de Vendas. A associação
e os demais índices de A1.1b ficam em `0006_atendimento`. As definições foram preservadas;
essa antecipação permite instalar Vendas sem depender de Peças/Atendimento.

Instalação limpa: `0001 → 0002 → 0003 → 0005 → 0006`. Em banco existente, conferir
o histórico e aplicar os módulos necessários na ordem, sem recriar o banco ou manipular
usuários Auth. Executar cada módulo alterado inteiro em uma transação. Aplicar `0003`
e `0006` antes de subir o código que chama as novas RPCs (CR-A1-001); SQL local validado
não comprova que essa integração de dev já aconteceu.

**Consolidação validada localmente.** Instalação limpa com os cinco módulos e nove contratos,
reaplicação sobre dados e upgrade da base `84b95e5` passaram com e sem defaults permissivos.
O upgrade extraiu os quatro módulos e nove arquivos antigos pelo Git, com fixture populada;
preservou dados, IDs, datas, marcas, vínculos, slots, FKs, índices, triggers, sequências e ACLs
de tabela/coluna/função. Corpos de funções normalizados por fim de linha permaneceram iguais.
`0003_vendas` também foi instalado e reaplicado isoladamente, sem Peças/Atendimento,
exercitando F5 e o bot de Vendas. Revisão independente confirmou o movimento literal dos
blocos e a ordem dos pré-requisitos. Harness local: `work/validar-consolidacao-modulos.mjs`.
Os commits, contagens de testes e SHA256 das fatias abaixo permanecem como histórico dos
artefatos originais. Nenhuma dessas provas equivale a login/E2E, multissessão ou banco remoto.

**Prioridade de produto:** após a consolidação, entregar o MVP kanban de Peças, reutilizando
o componente de quadro que o Claude extrairá. O primeiro fluxo usa a cotação e o atendimento
do próprio setor para abrir, consultar e responder ao lead, com contexto e autorização atuais.
As respostas passam pelo `outbound.ts` existente; texto livre somente dentro da janela de
24h, preservando opt-out, consentimento e as demais regras de envio. Não criar transporte
paralelo nem usar o histórico global do cliente como autorização.

Não avançar novas fatias de A1.3 nem acrescentar runtime nesta consolidação. As fatias e
limites descritos a seguir continuam como referência; integração de UI, logins/E2E e aplicação
no dev ainda precisam ser comprovadas no recorte liberado.

## A1.1a — Contexto e posse de registros atribuídos

Implementação local na branch `codex/atendimento-modulos`, após `6f87052`:

- Definições de contexto e posse em `0006_atendimento.sql`, dependente de 0001, 0002, 0003 e 0005.
- `atendimentos_modulares` mantém um vínculo tipado e único por oportunidade ou cotação, com
  cliente, conversa física e unidade derivados do negócio. `atendimento_canais` reserva um
  único atendimento modular por conversa, com FK composta que impede cruzar os canais.
- `contexto_atendimento_modular` revalida usuário ativo, papel/setor, unidade ativa, unidade
  principal/adicional e responsável atual. Admin tem alcance global em unidades ativas.
  A carteira do cliente não concede acesso a uma oportunidade de outro vendedor.
- A abertura só aceita negócios **abertos e já atribuídos**. Vendas exige oportunidade não
  encerrada e funil ativo; Peças segue seus status abertos, inclusive uma cotação aprovada
  cuja venda já foi confirmada. Sem responsável, é preciso atribuir pelo domínio existente
  antes de abrir o atendimento; não há atalho de fila que exponha o histórico do cliente.
- A conversa é derivada do cliente. Sua unidade física não substitui a unidade do negócio.
  A RPC recusa um vínculo existente se cliente, conversa ou unidade do negócio mudaram,
  preservando o registro original. Não faz rebind automático.
- `abrir_atendimento_modular` reutiliza o mesmo ID sem repetir auditoria. `assumir_atendimento_modular`
  exige versão exata, conversa humana e posse legada vazia. Dois atendimentos modulares
  não reservam o mesmo canal. Replay do ator com a **versão corrente** mantém a versão;
  versão antiga retorna conflito, mesmo se tiver sido a tentativa anterior do mesmo ator.
- A posse guarda o dono do negócio na ocasião. Após transferir o negócio, o responsável
  antigo perde acesso; o novo pode substituir essa posse obsoleta no mesmo atendimento,
  mediante versão corrente. Isso ainda não implementa a transferência completa da A1.3.
- As RPCs mantêm locks nas linhas usadas de ator, domínio, unidade, autorização adicional
  e cliente. A ordem de escrita modular é canal e depois atendimento. Slot, posse,
  incremento de versão e auditoria ficam na mesma transação; falha deve desfazer tudo.
- RLS fechado, `SECURITY INVOKER`, `search_path` vazio e grants explícitos. Só o servidor
  pode executar. Os wrappers em `src/modulos/atendimento/acesso.ts` recebem o usuário já
  autenticado e enviam sua identidade, referências e versão; não aceitam cliente, unidade,
  conversa ou posse do navegador como autoridade. Nenhuma rota pública foi adicionada.

Contratos de retorno: sucesso contém `ok`, `id`, `versao`, `setor` e `registroId`.
Ausência ou registro fora do escopo usa `nao_encontrado`; conflito usa `conflito`, sem nome,
e-mail ou posse de terceiros. O wrapper normaliza entrada inválida, falta de acesso,
ausência, conflito e indisponibilidade em 400/403/404/409/503 e descarta detalhes internos.

Validação local: typecheck, 846 testes Vitest (71 novos dos wrappers) e contratos em
`tests/sql/contratos-atendimentos.sql` passaram. PostgreSQL/PGlite executou as RPCs como
`service_role`, com e sem defaults permissivos, incluindo rollback real da auditoria,
replay, revogações e reaplicação com dados. SQL e wrapper tiveram revisão independente.
Artefato original revisado, antes da consolidação: SHA256 `97bb8a1f243e2e8fb0b671fd85eb09cfab3e2afcd54f016fbf2dd93de337fb5d`.

**Ainda pendente após A1.1a:** classificar e associar mensagens, vincular os encaminhamentos do bot,
Oficina/triagem, filas sem dono, leitura/listagem/contadores por módulo, liberação do canal,
encerramento/reabertura, transferências completas, envio e adaptadores legados.
A reserva nova não impede uma API legada de assumir depois, nem libera o envio modular.
Por isso esta fatia permanece sem UI e não prova exclusividade entre todos os fluxos do sistema.
Os testes de concorrência entre sessões e os logins reais continuam necessários antes da integração.

## A1.1b — Mensagem inicial comprovada de Peças

Definições de associação da mensagem inicial de Peças em `0006_atendimento.sql`, após os
blocos de encaminhamento do bot e contexto de A1.1a, mais os schemas dos módulos já indicados.

- O vínculo só aceita a mensagem inicial identificada por `encaminhamentos_bot`, para uma
  cotação de Peças aberta, já atribuída e com atendimento existente. O banco revalida o
  responsável atual/supervisão, unidade e cliente usando o contexto da A1.1a.
- Atendimento, cotação, cliente, conversa, unidade e referência precisam coincidir. A cotação
  deve corroborar `origem=whatsapp` e `origem_ref` no momento da associação. O ledger
  permanece como prova histórica; essa checagem não congela eternamente os metadados
  de origem da cotação. As identidades do ledger associado ficam protegidas por FK.
- `atendimento_mensagens` guarda uma única associação por mensagem e referência, com
  três FKs compostas para atendimento, ledger e mensagem. Não existe operação genérica
  de anexar um ID de mensagem do histórico ao cliente ou ao setor.
- A coluna gerada `mensagens.entrada_cliente_externa` é verdadeira somente para entrada
  com autor cliente e sinal `metadata.interno` ausente ou booleano falso. A FK exige esse
  valor verdadeiro, impedindo associar alertas internos e retaggear uma mensagem vinculada
  para interna, outro autor, direção, cliente, conversa ou referência.
- Atualizar status e metadados de processamento, ou redigir conteúdo e remover metadata
  na anonimização, preserva a classificação externa e não exige desfazer o vínculo.
  O acesso atual ao cliente anonimizado continua recusado pelo resolvedor de contexto.
- A associação e a auditoria são atômicas. Repetição no mesmo atendimento não duplica
  efeitos; o contexto atual é conferido também no replay. Essa operação classifica a origem,
  sem assumir o canal nem exigir a posse de envio da A1.1a.
- Wrappers server-only enviam somente atendimento, referência exata e ator autenticado.
  RLS permanece fechado; o serviço recebe SELECT/INSERT na associação, sem UPDATE/DELETE.
  O ledger continua sem UPDATE concedido ao serviço; a FK comprova a chave referenciada
  na inserção. A ordem de locks de canal e atendimento acompanha a A1.1a.

O conjunto mantém a coluna gerada armazenada e os índices nas fontes existentes;
na organização atual a coluna e o índice de mensagem são criados em `0003_vendas`.
Antes de aplicar no dev, avaliar tamanho de `mensagens`, custo da reescrita e criação de
índices e a compatibilidade conjunta das migrations. Ainda não foi aplicada remotamente.

**Pendência identificada após A1.1b:** o roteamento de Vendas não registrava a referência da mensagem
em um ledger equivalente; `vendas_oportunidades.origem_ref` pode ser código de link/QR.
Não é uma prova para associar a conversa inteira ou escolher uma mensagem do histórico.
Essa proveniência é tratada na A1.1c abaixo; o vínculo com o atendimento ainda fica pendente.

**Próximas partes:** roteamento das novas mensagens com contexto comprovado, proveniência
de Vendas, Oficina/triagem, leitura e contadores por atendimento, lifecycle/transferência/posse,
envio e fechamento dos caminhos legados. Nenhum handler, API pública ou tela foi ligado
a essa associação nesta fatia. Nenhum histórico foi importado automaticamente.

Validação local: typecheck, 917 Vitest (71 novos do wrapper) e contratos SQL de vínculo,
rollback e reaplicação passaram. Os quatro contratos de Encaminhamentos, Aniversários,
Atendimentos e Mensagens também passaram juntos na base completa, com e sem defaults
permissivos. Processamento/status, redação de conteúdo e limpeza de metadata foram
conferidos sem desfazer a associação. SQL e wrapper tiveram revisão independente.
Artefato original revisado, antes da consolidação: SHA256 `762aae646a114fd58d1c9aac791fa07d633b3290741156180f5053d3f0aa8d8f`.
Não houve prova multissessão, login real, integração de runtime ou banco remoto.

## A1.1c — Qualificação e proveniência do bot em Vendas

Definições da proveniência do bot em `0003_vendas.sql`, após as tabelas de Vendas. A prova
de mensagem e as dependências entre módulos serão revalidadas na consolidação. O ramo Vendas de `rotearLead` usa somente o wrapper
`src/modulos/vendas/qualificacao-bot.ts` e a RPC `registrar_lead_vendas_bot`.

- A RPC comprova a mensagem recebida, cliente, conversa e unidade ativa. O funil Novos ou
  Seminovos é resolvido na unidade da conversa; não há fallback silencioso para Comauto.
- `vendas_encaminhamentos_bot` registra referência, mensagem, conversa, cliente, unidade,
  oportunidade, funil e resultado original de criação. FKs compostas preservam as identidades
  da mensagem externa e do negócio. O código de marketing continua em `origem_ref`,
  enquanto o `wamid` fica nesse ledger separado.
- Criação/atualização, atividade do assistente, notificações, auditoria, proveniência e eventual
  preenchimento da carteira ficam na mesma transação. Falha em qualquer gravação desfaz
  os efeitos; a ferramenta não confirma sucesso com erro ou resposta incompleta.
- Repetir a referência no mesmo contexto retorna o ID e o resultado `novo` originais sem
  duplicar efeitos. Referência reutilizada para outro funil é recusada. Nova mensagem usa
  a oportunidade aberta mais recente do cliente no funil, quando existe.
- A atualização mantém responsável, temperatura e carteira. Dados indefinidos não apagam
  dados concretos; `temTroca=null` preserva e `false` limpa a descrição. As decisões
  qualificado/desqualificado são preservadas; confirmação só promove `a_verificar`.
- Novo lead prefere o vendedor da carteira se elegível, inclusive por unidade adicional;
  depois usa menor carga global de oportunidades abertas, última criação e ID no desempate.
  Chamadas deste produtor do bot compartilham a trava de rodízio entre unidades. Carteira
  alheia é preservada; o novo dono só preenche `clientes.vendedor_id` se estiver nulo.
- Dono elegível recebe o aviso. Caso contrário, o aviso vai à supervisão de Vendas das
  unidades autorizadas; sem gerentes, usa administradores ativos. Sem destinatário, recusa
  antes das gravações, sem reatribuir automaticamente um negócio existente.
- O servidor envia contexto e dados normalizados de qualificação; o SQL deriva unidade,
  dono, oportunidade e elegibilidade. O agente recebe somente sucesso e indicação de novo
  cartão, sem ID interno, nome de funcionário ou detalhe do erro. Agenda e os encaminhamentos
  já existentes de Peças/triagem mantêm seus caminhos.

Validação local: typecheck e 1.022 Vitest (105 novos desta fatia) passaram. SQL executado
como `service_role`, com e sem defaults, cobriu replay, regras de qualificação/carteira,
rodízio, origem de marketing separada, destinatários e rollback real de auditoria, atividade,
aviso e histórico. Reaplicação populada preservou dados e permissões. Os cinco contratos
F2, F5, A1.1a, A1.1b e Vendas passaram juntos na base completa em ambos modos.
SQL e wrapper/roteamento tiveram revisão independente.
Artefato original revisado, antes da consolidação: SHA256 `ae07682ce23d45c0f262269eabe993d16d0dbe7175baa369d63c6b094e48f149`.

**Limites:** a trava de criação cliente/funil é usada por este produtor do bot; os caminhos
manuais antigos não compartilham esse protocolo. Não houve prova multissessão ou login
real. Um mesmo `wamid` ainda pode ter encaminhamentos em setores distintos, caso o agente
chame ferramentas diferentes; os ledgers não representam uma escolha exclusiva de setor.
Não associar ambos automaticamente nem liberar o histórico por esse motivo.

O código substitui o ramo local de Vendas, mas não foi integrado ao dev. Esta fatia registra
a proveniência. A associação e o bloqueio de origens ambíguas estão na A1.1d abaixo; a resolução
da ambiguidade, mensagens seguintes, leitura/contadores, Oficina/triagem, lifecycle/posse,
envio e fechamento dos caminhos legados continuam pendentes. Nenhuma UI de conversa foi liberada.

## A1.1d — Associação de Vendas e guarda contra origem ambígua

Definições do vínculo de Vendas em `0006_atendimento.sql`, após a proveniência de `0003_vendas.sql`. A tabela de associações
ganha setor explícito e oportunidade, com CHECK de um único domínio por linha. Os vínculos
antigos recebem setor Peças e mantêm IDs, autoria, datas, referências e FKs. Não há movimento,
exclusão ou reatribuição de mensagem. PK por mensagem e referência única continuam globais.

- Peças mantém `vincular_mensagem_encaminhada`; Vendas usa `vincular_mensagem_vendas`.
  Ambas delegam ao resolvedor por setor, que prova domínio, escopo atual, snapshots,
  origem específica do negócio e mensagem externa antes de informar qualquer conflito.
- As FKs adicionais de Vendas ligam atendimento e ledger à oportunidade, conversa,
  cliente e unidade exatos. Fonte de outro negócio, mesmo cliente ou unidade não autoriza
  associação. Não se infere autorização por carteira global do cliente.
- Se uma referência aparecer no ledger de Peças/triagem e no de Vendas, ambos os caminhos
  retornam `origem_ambigua`, sem nomear equipe, IDs ou dados de outro setor. O wrapper
  apresenta conflito genérico e pede revisão. Não existe eleição automática do primeiro setor.
- Se a segunda origem chegar depois de um vínculo, a linha original permanece preservada;
  novas autorizações e replays passam a recusar a ambiguidade. Resolução explícita ainda
  será implementada; não há sobrescrita ou anexação da mesma mensagem aos dois setores.
- `autorizar_mensagem_atendimento` exige associação exata já gravada e revalida origem,
  setor, responsável/supervisão e unidade. Uma referência ambígua de outro atendimento
  retorna ausência antes de revelar conflito, evitando sondagem por IDs conhecidos.
- A guarda retorna somente referências e setor. **Não retorna conteúdo nem emite uma
  permissão reutilizável.** A futura leitura deve autorizar e consultar o corpo na mesma
  transação, com a mesma política aplicada antes da paginação e das contagens.
- Os wrappers mantêm RPCs de vínculo específicas por setor e validam a correlação dos
  retornos. Usuário autenticado vem do chamador no servidor; setor informado no pré-filtro
  de autorização não substitui a prova do domínio no banco. RLS/ACL seguem fechados.

Validação local: typecheck, 1.090 Vitest (68 novos) e contratos SQL com/sem defaults passaram.
A migração foi aplicada em base com Peças já vinculada, preservando todos os campos antigos.
Ambiguidade nas duas ordens e após o vínculo, transferência sem carteira, revogações, FKs,
rollback real da auditoria e reaplicação populada foram verificados. Os seis contratos SQL
passaram juntos na base completa nos dois modos. SQL e wrapper tiveram
revisão independente. Artefato original revisado, antes da consolidação: SHA256
`9e3a0bf3d6c7fa871e9f694ce0678dfaffd4340970555d111cca2089bf8ca65f`.

**Limites:** a guarda verifica a origem no ponto da autorização; não impede outra ferramenta
de criar um encaminhamento depois nem resolve a ambiguidade. Novas leituras precisam
revalidar o estado atual. Não houve prova multissessão, login/E2E, banco remoto, leitura de
corpo, envio ou UI. Rotas legadas continuam pendentes; associação isolada não concede acesso.

**Após A1.1d:** A1.2, leitura paginada e contadores apenas de mensagens associadas e
autorizadas, com DTO mínimo e autorização/consulta na mesma transação. Mensagens seguintes,
resolução de ambiguidade, Oficina/triagem, filas sem dono, lifecycle/transferência/posse,
envio e fechamento dos caminhos legados permanecem no plano.

## A1.2a — Leitura paginada de um atendimento

Definições da leitura de mensagens em `0006_atendimento.sql`, usando as guardas de A1.1d. A RPC
`ler_mensagens_atendimento` revalida usuário ativo, papel/setor, unidade, responsável do
negócio, cliente, conversa e snapshots; o servidor não reutiliza uma autorização anterior.

- A prova de origem foi centralizada em `prova_origem_mensagem_atendimento`, função SQL
  `STABLE` que também serve ao resolvedor de vínculo/guarda. Ela prova a origem, sem
  autorizar um ator isoladamente. Helpers e RPCs permanecem fechados ao navegador.
- Corpo, total, indicação de revisão e cursor são calculados por uma única instrução SQL,
  com o mesmo snapshot. A política é aplicada às associações exatas do atendimento antes
  da contagem e da paginação. Não há consulta posterior separada por IDs autorizados.
- Mensagens sem vínculo, de outro negócio no mesmo cliente/canal, internas, sem prova
  atual ou com origem ambígua não entram no corpo nem no total. `revisaoPendente` apenas
  sinaliza associação própria indisponível, sem retornar IDs, referências ou contagem omitida.
  Mensagens antigas sem associação não são importadas nem sinalizadas como pendência.
- A ordem é data de criação decrescente e ID decrescente. Cursor contém a tupla exata
  de uma mensagem ainda autorizada desse atendimento; caso deixe de ser utilizável ou
  pertença a outro atendimento, é recusado sem dados ou total. Cada página aceita de 1 a
  100 mensagens; o total corresponde a todas as autorizadas, independentemente do cursor.
- O wrapper mantém a string temporal com até seis casas, sem reduzir microssegundos
  para milissegundos. Calendário, hora, fuso aceito pelo PostgreSQL, IDs, opções e retorno
  são validados. Próximo cursor deve corresponder à última mensagem da página cheia.
- O DTO contém somente identificação, tipo, data, direção/autor/status e conteúdo permitido.
  O servidor reutiliza `mascararDadosSensiveis` para CPF/cartão antes de retornar o texto;
  conteúdo nulo é preservado. Não retorna campos de metadata, telefone, custos ou registros
  de outros atendimentos.
- A operação não assume canal, não marca leitura, não zera `nao_lidas` e não grava auditoria
  ou estado de negócio. Ler mensagens próprias não concede autorização de envio.

Validação local: typecheck, 1.232 Vitest e sete contratos SQL juntos passaram com e sem
defaults permissivos. Há 128 testes do wrapper de leitura; a rodada também incluiu 14
regressões da correção de UUID, versionada separadamente em `d5be89c`.
SQL verificou 1.005 mensagens no mesmo atendimento, 1.001 com data empatada, diferenças
de microssegundos, páginas sem perdas/duplicações, cursores alheios/ocultos inválidos,
contagem após ambiguidade, preservação dos dados e reaplicação. SQL e wrapper tiveram
revisão independente. Artefato original revisado, antes da consolidação: SHA256
`16531ab8193b934513b708f21a0a489331ad23d4cbe2daa70573aa86e4b9868e`.

A correção UUID exige string com 36 caracteres antes da regex nas entradas e IDs de
retorno dos wrappers; uma quebra de linha final não chega ao banco. Referências de mensagem
permanecem opacas. O mascaramento do texto usa o helper existente, sem alterar a origem.

**Limites:** leitura de um atendimento e suas mensagens atualmente associadas, sem inbox,
prévias, contador de não lidas por usuário, mensagens seguintes ou UI. A política usa o estado
visível no SELECT; outra origem pode chegar depois e deve ser revalidada na próxima leitura.
Não houve prova multissessão, login/E2E, banco remoto ou envio. Código e migrations continuam
pendentes de integração no dev; rotas legadas não foram liberadas por essa entrega.

**Próxima parte:** A1.2b, lista/prévias e contadores dos atendimentos permitidos, reutilizando
a mesma política antes da paginação. Leitura individual, mensagens seguintes, ambiguidades,
Oficina/triagem, filas sem dono, lifecycle/posse/transferência, envio e fechamento do legado
continuam necessários antes da interface por setor.

## A1.2b — Lista, prévias e totais por setor

Definições da lista em `0006_atendimento.sql`, usando a política de A1.2a. A RPC
`listar_atendimentos` recebe ator autenticado no servidor, setor e opções de paginação;
não recebe cliente, unidade ou responsável como autoridade do navegador.

- `atendimentos_legiveis` é a fonte SQL `STABLE` comum da política para lista e detalhe.
  Exige ator ativo, papel/setor, unidade ativa e principal/adicional (admin global),
  negócio aberto e atribuído, responsável atual ou supervisão, cliente não anonimizado
  e snapshots exatos de negócio, cliente, conversa e unidade. Não acrescenta exigência
  de posse de envio, canal humano ou responsável ativo à política de leitura existente.
- `associacoes_mensagens_atendimento` centraliza as associações exatas e a prova de
  origem. Não autoriza um ator isoladamente. Lista e detalhe aplicam primeiro o escopo
  legível e consultam os vínculos, o corpo e as contagens na mesma instrução/snapshot.
  O detalhe preserva seus locks e também recusa se o gate final não contiver o atendimento.
- Cada linha contém atendimento, setor, referência do negócio, unidade, nome do cliente,
  criação, total de mensagens autorizadas, sinal de revisão e prévia nullable. Não inclui
  telefone, metadata, posse de terceiros nem o histórico global do cliente. Nome e conteúdo
  usam o mascaramento existente de CPF/cartão no servidor; só então a prévia é cortada
  em 160 caracteres. O helper não promete anonimizar todo dado pessoal em texto livre.
- Atendimentos autorizados com zero mensagens permanecem na lista, com prévia nula.
  A prévia é a última mensagem autorizada, ordenada por data/ID. Mensagem mais recente
  sem associação ou com origem ambígua não vira prévia e não entra no total.
- `totalAtendimentos` e `totalMensagens` correspondem ao escopo inteiro autorizado do
  setor, antes do cursor. O sinal de revisão só indica associações próprias indisponíveis;
  não revela os itens omitidos. As contagens são de registros e mensagens, **não de não lidas**.
- A lista ordena pela criação do atendimento e ID, ambos decrescentes. Não usa a data da
  última mensagem como cursor mutável. Aceita de 1 a 100 linhas e cursor com tupla exata
  de atendimento ainda legível; cursor alheio, revogado ou divergente é recusado sem totais.
  O wrapper compartilha a validação temporal/UUID e preserva microssegundos.
- Para calcular totais e selecionar prévias, a lista materializa IDs/datas das mensagens
  autorizadas; busca o corpo somente das prévias da página, dentro da mesma consulta.
  O total global ainda exige examinar o conjunto autorizado: sem promessa de custo
  constante ou benchmark de produção.
- Nenhuma leitura altera `nao_lidas`, marcas por usuário, posse, auditoria ou negócio.
  A lista usa o snapshot de seu SELECT, sem travar cada atendimento. Transferência ou
  revogação posterior exige nova autorização na próxima consulta/ação; cursor não concede
  acesso entre requisições. Não há garantia de snapshot único entre páginas separadas.

Validação local: 1.322 Vitest em 29 arquivos, typecheck e diffcheck passaram. A rodada
incluiu 90 testes novos da lista e os 128 de regressão do detalhe. Oito contratos SQL
passaram na base completa com e sem defaults permissivos, incluindo 1.005 atendimentos,
1.001 datas empatadas, microssegundos, expectativas explícitas de escopo, diferencial
com o contexto anterior, revogações, prévias após ambiguidade e reaplicação populada.
A revisão independente comparou 154 combinações com 11 perfis entre contexto, helper,
lista e detalhe; verificou ACL e leitura sem mutação em 17 tabelas. SQL e wrappers sem
achados bloqueantes no recorte. Artefato original revisado, antes da consolidação: SHA256
`56bd1145d69075fdd0aed307e8a62a850e8410e78e42d67f62a6bafd9b3e231f`.

**Próxima parte:** A1.2c, leitura/não lidas por atendimento e usuário, com operações
explícitas e autorizadas, sem zerar o canal físico nem marcar mensagens omitidas como lidas.
Mensagens seguintes/roteamento, ambiguidades, Oficina/triagem, filas sem dono, lifecycle,
transferências, envio e adaptadores legados seguem pendentes antes da UI por setor.
Código e migrations aguardam integração no dev; login real/E2E, concorrência multissessão
e validação de volume/índices no ambiente de destino ainda não foram executados.

## A1.2c — Leitura explícita por usuário

Definições das marcas de leitura em `0006_atendimento.sql`, após os blocos de leitura/lista. As três RPCs
novas não alteram o contrato de lista ou corpo já existente, nem integram UI ou envio.

- `atendimento_leituras` guarda uma marca por atendimento, mensagem e usuário, com
  horário do servidor. FK composta exige a associação exata; não bastam FKs individuais
  para um atendimento e uma mensagem de outro vínculo. Marcas acompanham uma eventual
  exclusão administrativa do usuário, preservando o lifecycle anterior de contas.
  Não existe nova operação de exclusão de usuários, Auth ou dados externos.
- RLS permanece fechado e sem políticas; navegador não pode ler ou escrever a tabela.
  O serviço recebe SELECT e INSERT apenas nas três referências. Não pode informar
  `lido_em`, atualizar ou apagar marcas. Helpers de autorização existentes continuam
  como fonte comum de escopo e prova atual das mensagens.
- `marcar_mensagens_lidas_atendimento` recebe de 1 a 100 IDs explícitos, únicos e não
  nulos. Array inválido, vazio, multidimensional ou com repetidos é recusado. Ator vem
  do chamador autenticado no servidor; não existe alvo de leitura ou data escolhidos
  pelo navegador. O wrapper normaliza os UUIDs em uma cópia, sem alterar a entrada.
- A transação revalida o domínio e mantém a ordem de locks já usada pelo detalhe.
  Escopo atual, prova das mensagens e INSERT pertencem à mesma instrução/snapshot.
  A validade do lote é predicado do próprio INSERT: se qualquer ID não estiver associado
  e autorizado nesse atendimento, nada do lote é gravado e o retorno é ausência genérica,
  inclusive quando alguns IDs já tinham marca pessoal. Não retorna IDs ou dados omitidos.
- Replay revalida todo o lote e retorna `marcadas=0` quando nada foi acrescentado.
  `ON CONFLICT DO NOTHING` conserva o primeiro horário. Falha do banco desfaz a operação;
  resposta perdida pode ser repetida sem duplicar a marca. Isso não prova que uma pessoa
  viu fisicamente a mensagem: registra a ação explícita recebida pelo servidor.
- `obter_leitura_atendimento` retorna total autorizado, lidas, não lidas e sinal de revisão
  daquele atendimento. `resumir_leituras_atendimentos` calcula os mesmos totais no escopo
  atual do setor, número de atendimentos e quantos têm mensagens não lidas. Ambos contam
  apenas associações atualmente autorizadas e marcas do próprio ator na mesma consulta.
  Não devolvem conteúdo, referências de mensagens ou leituras de outro usuário.
- Transferência não copia marcas do vendedor anterior; supervisão não herda a leitura
  da equipe. Revogação tira o atendimento das consultas atuais sem apagar marcas históricas.
  Se o mesmo usuário recuperar acesso, suas marcas anteriores continuam preservadas.
  Origem que passar a ser ambígua sai de total/lidas/não lidas, mantendo a marca e o sinal
  de revisão. A marca histórica não é permissão reutilizável para consultar a mensagem.
- Não há backfill ou watermark por data. Uma mensagem associada depois, mesmo com
  horário antigo, começa não lida para quem não a marcou. Não há operação "ler tudo até
  o cursor", nem marca automática em GET. Somente IDs explícitos comprovados são marcados.
- Nenhuma operação altera `conversas.nao_lidas`, status de entrega/leitura da Meta,
  posse, negócio, auditoria global ou estado de outro setor/usuário. A tabela registra
  autoria e primeiro horário da própria ação. Não se envia recibo de leitura ao WhatsApp.

Validação local: 1.409 Vitest em 30 arquivos (87 novos), typecheck e diffcheck passaram.
Os nove contratos SQL passaram na base completa com e sem defaults permissivos, incluindo
1.005 mensagens, lotes inválidos/mistos e falha CHECK real sem marcas parciais, replay
preservando a primeira data, mensagem associada com data antiga, isolamento pessoal,
transferências/revogações, ambiguidade, FK/cascade/ACL e reaplicação populada.
A revisão independente comprovou também falha na segunda inserção desfazendo a primeira,
timestamp explícito negado ao serviço e preservação das 17 tabelas do núcleo observadas.
SQL e wrapper sem bloqueantes no recorte. Artefato original revisado, antes da consolidação: SHA256
`5e35495e465fb8054718147db4620c6277bd1e7978d5a56ca9836b7e093131e6`.

**Prioridade após A1.2c:** consolidar os arquivos por módulo e seguir com o MVP kanban de Peças,
conforme a prioridade atual acima. A1.3 permanece planejada para revisão posterior de posse,
liberação do canal e transferências com versão e autorização atuais. Mensagens seguintes/roteamento, ambiguidades, Oficina,
filas sem dono e fechamento do legado continuam pendentes. A lista e o corpo não passaram
a marcar leitura por efeito colateral; a integração futura da interface deverá enviar
somente IDs explícitos e revalidar cada ação. Login real/E2E, concorrência multissessão,
aplicação das migrations e validação de volume/índices no dev continuam necessários.

## Problema e limites atuais

- `conversas.cliente_id` é UNIQUE: existe um canal físico por cliente, não uma conversa por setor.
- Inbox/fila atuais consultam contagens e prévias globais; detalhe consulta somente o ID da conversa,
  reúne dados de vários atendimentos do cliente e zera o contador global de mensagens não lidas.
- Actions recebem conversa/cliente sem vínculo de módulo; handoff usa e-mail para posse e
  `supervisiona()` sem provar setor, unidade e vínculo.
- Ter uma oportunidade ou cotação autorizada não permite ler todo o histórico físico do cliente.
- O ledger `encaminhamentos_bot` prova a origem e deduplica o encaminhamento, mas não comprova
  permissão atual, posse ou a quais atendimentos pertencem as mensagens posteriores.
- Rotas antigas também precisam passar pelas guardas: novos wrappers seguros não eliminam o
  bypass pelos endpoints/actions globais existentes.

## Contrato de autorização proposto

Separar o canal físico de um atendimento de negócio com ID próprio. Cada atendimento tem
conversa, cliente, unidade, módulo, vínculo tipado de negócio, estado, responsável humano UUID,
versão e datas. O vínculo aponta para oportunidade de Vendas, cotação de Peças, atendimento ou
agendamento de Oficina, ou encaminhamento de triagem. Preferir FKs reais; adicionar dependências
de Oficina somente quando suas migrations estiverem integradas.

O servidor recebe intenção e ID de registro, resolve o vínculo e deriva cliente/unidade/conversa.
Ator vem da sessão. Papel, setor, usuário ativo, unidade principal/adicional e unidade ativa são
conferidos no banco, inclusive na gravação. Campos enviados pelo navegador não concedem acesso.
O administrador tem alcance global nas unidades ativas; os demais perfis permanecem limitados
às suas unidades e ao setor autorizado. Esse alcance não elimina a prova de vínculo e posse.

| Operação | Prova exigida |
| --- | --- |
| Listar fila | Área/setor e unidade elegíveis; resumo apenas do atendimento autorizado |
| Ler detalhe/histórico | Vínculo exato, unidade e permissão atual de carteira/responsável/supervisão |
| Assumir | Elegibilidade atual, registro disponível e atualização condicional com um vencedor |
| Gravar/enviar | Todas as provas anteriores, posse vigente, estado permitido e versão esperada |
| Transferir | Permissão no registro, destino ativo/elegível, unidade e invalidação da posse anterior |
| Supervisionar | Área, setor e unidade compatíveis; `supervisiona()` isoladamente não autoriza |

Retornos: 401 sem sessão; 403 sem acesso à área; 404 para registro inexistente ou fora do escopo;
409 para conflito de posse/versão. Não expor nome/e-mail de terceiros em erros fora do escopo.

## Carteiras, fila sem dono e transferências

- Em Vendas, o dono da oportunidade é a referência do atendimento. Se não houver dono, mas o
  cliente já tiver carteira, restringir a resolução ao dono dessa carteira/supervisor até atribuição
  explícita. Não liberar histórico do cliente ao setor inteiro apenas por `vendedor_id IS NULL`.
- Uma oportunidade transferida sem mover carteira passa a autorizar o novo vendedor naquele
  atendimento. O vendedor antigo não conserva acesso por um OR com `clientes.vendedor_id`.
- Peças e Oficina usam o responsável do próprio registro; carteira de Vendas não concede acesso.
- Fila elegível pode mostrar o resumo mínimo do pedido. Histórico anterior de outros atendimentos
  não acompanha a condição de "sem dono".
- Trocar setor cria atendimento de destino, com resumo compartilhado explicitamente. Não copia
  automaticamente mensagens do setor anterior.
- A unidade do atendimento deriva do registro. `conversas.unidade` não deve virar um seletor
  mutável que transfere todo o histórico entre lojas/setores.
- Um atendimento por vez controla o envio no canal físico. Outros pedidos podem permanecer
  pendentes, sem ganhar acesso às mensagens do atendimento que está usando o canal.
- Transferências invalidam versões/posses antigas. Toda consulta e escrita volta ao responsável
  atual no banco; autorização não pode depender apenas de uma fotografia de ACL antiga.

## Histórico e dados retornados

Criar associação explícita entre mensagem e atendimento, comprovando que ambos pertencem à
mesma conversa/cliente. A consulta modular retorna somente suas mensagens e dados necessários.

Excluir alertas internos para equipe (`cliente_id` nulo/metadata interno), notas globais e registros
de outros setores/unidades. Prévia, contagem, busca e notificações seguem o mesmo predicado do
detalhe, aplicado antes da paginação. Paginar de modo estável.

Registrar leitura por atendimento/usuário; um GET de Peças não pode zerar os não lidos de Vendas.
Não atribuir automaticamente todo o legado ao dono atual. Histórico sem classificação permanece
preservado, mas fora da leitura modular até existir um vínculo comprovado.

## Fatias e critérios de saída

### A1.1 — Modelo e autorização, sem UI

- Definições de atendimento, vínculos e associação de mensagens em `0006_atendimento.sql`; RLS fechado e ACLs
  explícitas de servidor.
- Resolução central de acesso e RPCs de abertura/claim com contexto derivado do banco.
- Encaminhamento novo aponta para o mesmo atendimento em reenvios; ledger continua idempotente.
- Testes SQL locais: vínculo trocado, cliente/unidade divergentes, usuário inativo, unidade extra
  removida, gerente de outro setor e disputa de claim.

Saída: contrato local verificável de usuário/área/setor/unidade/vínculo, sem tela nova liberada.

### A1.2 — Leitura protegida

- Listagem, contadores, prévias e detalhe usam a mesma política de acesso.
- DTO mínimo por módulo e histórico explicitamente associado ao atendimento.
- Leitura individual, sem zerar o contador físico compartilhado.
- Testes com o mesmo cliente em oportunidades de vendedores distintos, Peças e Oficina.

Saída: nenhuma informação fora do vínculo em lista, busca, detalhe, totais ou notificações.

### A1.3 — Posse e transferências

- Claim condicional com um vencedor e replay idempotente do mesmo ator.
- Transferência/reatribuição invalida versões anteriores e reavalia o responsável atual do domínio.
- Reabertura e encerramento não alteram implicitamente outros atendimentos do cliente.
- Testes de duas abas, transferência com sessão antiga e carteira não movida.

Saída: antigo responsável perde autorização para novas consultas/gravações daquele atendimento.

### A1.4 — Gravação e envio

- Notas, tags, retomada, devolução e encerramento recebem atendimento/vínculo.
- Envio usa reserva identificada/versionada e valida novamente no despacho; somente depois chama
  `outbound.ts`, preservando suas regras e registrando atendimento/ator na saída.
- Tratar transferência enquanto há envio reservado/em andamento. Definir o ponto de autorização:
  HTTP já despachado pode terminar; não prometer cancelamento de envio em voo.
- Dedupe por operação; resultado incerto não pode provocar reenvio automático.
- Testes locais com transporte simulado: replay, reserva antiga, troca de responsável e falhas.

Saída: nenhuma mutação autorizada apenas pela checagem prévia da tela.

### A1.5 — Adaptadores legados e interface

- Submeter endpoints/actions antigos à mesma política, sem fallback global por cliente.
- Extrair apresentação de `Conversa`, com adaptadores definidos por módulo e capacidades vindas
  do servidor. Não ampliar simplesmente o papel aceito em `atendimento`.
- Priorizar o MVP kanban de Peças com o componente de quadro que o Claude extrairá e as
  respostas pelo `outbound.ts` existente, respeitando a janela de 24h e o contexto autorizado.
- Somente então integrar Vendas, Peças e Oficina e executar a matriz de logins em contextos isolados.

Saída: UI reaproveitada sem caminho alternativo que contorne vínculo, unidade ou posse.

## Matriz mínima de aceitação

1. Mesmo cliente, oportunidades de donos diferentes e atendimento em outro setor.
2. Unidade principal, extra, removida, inativa e fora do escopo.
3. Ator inativo, gerente de outro setor, vínculo falso e referência de mensagem divergente.
4. Fila sem dono sem liberar histórico de outra carteira/setor.
5. Dois claims simultâneos, transferência com aba antiga e escrita com versão defasada.
6. Totais, prévias, busca, notificações e histórico sem dados de outro atendimento.
7. Leitura que não altera contadores de outro setor; alertas internos excluídos.
8. Replay de encaminhamento e envio sem duplicação; resultado incerto preservado.
9. Endpoints/actions legados sem bypass e falhas de banco sem confirmação falsa.
10. Nenhuma alteração de dados de outros sistemas ou teste de produção implícito.

Oficina e seu vínculo com Peças foram lidos nas refs `codex/oficina-v002` e
`codex/oficina-pecas-v002`; ainda não estão integrados na base deste levantamento.
