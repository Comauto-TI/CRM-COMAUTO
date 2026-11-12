# Transferência entre setores — contrato para revisão

Direção do Simão recebida pelo Claude em 12/11/2026. **Backend local entregue em `abb9031` para revisão
do Claude, após autorização direta do Simão; integração de dev e interface ainda pendentes.** Evidências,
ACLs e dependências de exposição em [TRANSFERENCIA-SQL-REVISAO.md](TRANSFERENCIA-SQL-REVISAO.md). Base: Claude
`588bc1c` (Oficina integrada), incorporada na
branch `codex/transferencias-setores` pelo merge `be4868b`. Não é publicação em produção.

## Ajuste posterior do Simão, repassado pelo Claude — contrato atual

Prefixo173664/SHA F9180B99DF24CE695EF048339240C10F0FB17345C6ED401B4F7AB4D7061A5EAD. Este
repasse substitui as restrições anteriores de destinatário e de compartilhamento:

- Quem encaminha escolhe **fila do setor** ou **pessoa elegível**, nos três destinos. Vendas:
  vendedor/gerente de Vendas; Peças: equipe/gerente de Peças; Oficina: recepção/consultor/gerente
  de Oficina. Aviso para a pessoa ou para fila/gestão conforme a escolha.
- **Histórico compartilhado por snapshot explícito e auditado** da conversa de origem. Não é consulta
  genérica do histórico do cliente, nem alteração dos vínculos originais das mensagens. A fonte deve
  selecionar exatamente o contexto autorizado da origem; mensagens de outros atendimentos não são
  incluídas só por estarem no mesmo canal físico. A leitura do snapshot passa pela política atual
  do destino, inclusive após mudança de responsável/unidade. Conteúdo interno e segredos não entram.
- Reuso de aberto permanece. Oficina modular continua **não decidido**: só pedido de domínio nesta
  fatia, com alternativas abaixo para decisão posterior. Não ampliar sua interface de WhatsApp agora.

Respostas posteriores do Claude, conferidas até174752/SHA
21F97DB68A2C53604129C6C11BA1CC397039E40D5AB96D68300A97772A903775:

- Se o destino aberto já tem dono, **mantém esse dono**. Nota/snapshot vão para o item e o dono atual
  é avisado. Se outra pessoa foi escolhida, ela recebe somente aviso; não ganha propriedade ou
  leitura por isso. A tela explica que o gerente do setor pode reatribuir. Se o item aberto não tem
  dono e uma pessoa elegível foi escolhida, ela passa a ser a responsável.
- Snapshot confirmado: só mensagens da conversa/contexto autorizado da origem, excluindo negócios
  anteriores que apenas compartilhem canal; registrar IDs/intervalo no audit. Isso não concede
  acesso ao histórico inteiro do cliente nem altera os vínculos originais.
- Oficina fica na **opção1** nesta fatia; opções2/3 ficam para decisão posterior do Simão.
- Claude reafirmou o pedido de edição local do `0006` como revisor, sem aplicar no dev, e informou
  levar a confirmação ao Simão. Esse repasse sozinho não substituiu a resposta direta; a autorização
  chegou posteriormente, conforme registro abaixo.

O DTO mínimo do adaptador `b9e64dd` ainda não transportava o aviso de responsável preservado. O retorno
combinado passa a exigir `avisoResponsavel: null | { nome: string }` no sucesso, validado e mascarado
no adaptador. Aviso só em reuso que preserva dono diferente do selecionado, inclusive escolha de fila;
erro fora do escopo continua sem nome/ID. Implementação concluída em `0bffe79`, com 133 testes de
parser/adaptador; `2bf3e72` preserva autoria bot/sistema nos diálogos, com 104 testes de compatibilidade.

### Autorização direta recebida — edição local

Simão respondeu diretamente à pergunta assíncrona deste chat: **"Autorizar implementação local com
revisão do Claude"**. A pergunta nomeava núcleo/roteamento, destinatário fila/pessoa e snapshot
auditado; a resposta libera essa implementação na branch local, com revisão do Claude antes de
qualquer aplicação no banco. A rejeição anterior permanece registrada como histórico, sem ser
contornada: a nova autorização é o fato que permite retomar.

Retomar da base ativa revisada, não reaplicar o WIP antigo. SQL, contratos de teste e adaptador têm
arquivos/donos separados. Dados remotos, Auth, produção e implantação continuam fora desta edição.

### Alternativas para a conversa de Oficina

| Opção | Vantagem | Limite / custo |
|---|---|---|
| 1. Fila/triagem + conversa na central da recepção (recorte atual) | Menor mudança; preserva o atendimento já disponível e deixa agendamento/triagem organizados. | Consultor usa a ficha de triagem; recepção continua a porta do WhatsApp. Exige guardar vínculo/corte/snapshot e autorização de unidade na central. |
| 2. Atalho contextual da triagem para a central, só para quem já pode acessá-la | Reduz navegação da recepção sem ampliar papéis ou criar canal novo. | Não resolve WhatsApp próprio do consultor; o atalho deve provar triagem/conversa/unidade no servidor e mostrar apenas o contexto autorizado. |
| 3. Oficina como terceiro contexto modular, com componente compartilhado | Consultor acompanha/responde no próprio setor com posse e histórico contextualizados. | Amplia contrato, SQL, roteamento, envio e testes de três setores; precisa decisão explícita e revisão antes de integrar. |

Decisão recebida: opção1 nesta entrega; as demais permanecem propostas futuras.
Não criar outro número/integração ou liberar histórico genérico como solução provisória.

### Histórico da suspensão e revisão automática

Na primeira preparação, parser/adaptador para pessoa/fila nos três destinos tiveram 114 testes com RPC simulada;
não há action/endpoint/UI expondo a operação. SQL e contratos locais anteriores ficaram desatualizados.
O WIP foi preservado privadamente com hashes e retirado do arquivo ativo; `0006` voltou exatamente à
base revisada. Nada desse SQL foi aplicado no dev ou validado funcionalmente.

A revisão automática rejeitou o `apply_patch` que acrescentaria o trigger de roteamento em `0006`,
alegando ausência de autorização específica para alterar núcleo/permissões e possível exposição de
histórico se integrado sem revisão. Um pedido restrito de filesystem do subagente não concedeu acesso.
O arquivo não foi reeditado por outro caminho. As entregas independentes foram concluídas; a edição
local agora foi autorizada diretamente pelo Simão, como registrado acima. O WIP antigo permanece
incompleto/superado e não deve ser reaplicado.

## Primeiro contrato fechado (histórico; supersedido nos pontos acima)

Repasse conferido até169975/SHA664291681E143C1A7B8405ACC9FEB0AA0DA469D0C2F40E791A6FD00880671714.

- **Encaminhar:** negócio de origem intacto, inclusive resultado comercial e decisão de aberto/fechado.
  Item nasce diretamente na fila do destino, sem aceite intermediário. Posse antiga é liberada na
  mesma transação e destino passa a controlar o roteamento da conversa.
- **Oficina:** só pedido de domínio, sem canal modular/WhatsApp nesta fatia. Mensagens seguintes
  vão para a central da recepção. Não compartilhar mensagens anteriores como consequência disso.
- **Reuso obrigatório:** aproveitar item aberto no destino (mesmo funil em Vendas; cotação aberta;
  solicitação aberta em Oficina), acrescentando a nota sem sobrescrever dono ou dados comerciais.
  Criar somente quando não existir. Vendas exige funil, responsável opcional elegível; novos itens
  de Peças/Oficina nascem sem dono. A falta de dono não autoriza histórico de outra carteira.
- **Quem encaminha:** dono atual ou supervisão do setor/unidades de origem/admin. Central:
  recepção/gestão de Oficina/administração/admin, fila ou posse própria; supervisão pode intervir.
  Modular exige versão exata; central confere posse atual sob lock, sem inventar versão da tela.
- **Dados e atomicidade:** somente nota explícita atravessa com setor e autor; destino, evento,
  aviso elegível e audit na mesma RPC. Sem wamid inventado, backfill de histórico ou confirmação
  falsa em erro. SQL primeiro para revisão do Claude; código/guards antes de expor UI.

RPC combinada para implementação e testes: `transferir_atendimento_setor(p_operacao uuid,
p_origem text, p_registro uuid, p_ator uuid, p_destino text, p_funil text, p_responsavel uuid,
p_nota text, p_versao integer)`. Origens central/Vendas/Peças/Oficina; destinos os três setores,
distintos da origem de setor. Nota de1 a1000 caracteres; UUID por tentativa; replay exato revalida
autorização. Ator vem da sessão, cliente/unidade/vínculo derivam da origem no banco.

Sucesso mínimo: `ok`, `operacaoId`, `setorDestino`, `idDestino`, `reutilizado`. Nenhuma mensagem,
cliente, e-mail ou nome de terceiro no retorno de falha. Esta definição não comprova implementação.

**Dependências de código antes de testar transferência real:** central atual consulta dados extras
por cliente (incluindo notas) e inbox/fila não recortam unidades no query. RPC/rota nova sozinhas não
fecham esses caminhos. Adaptar leituras, contagens, capacidades e ações que o piloto atravessa com
escopo atual; preservar só nota/novas mensagens explicitamente autorizadas após ida para Oficina.
Não aplicar a UI de transferência sobre o legado sem essa validação.

## Resultado esperado

Da central/triagem ou de um cartão, encaminhar o pedido para Vendas, Peças ou Oficina mantendo o
mesmo cliente. O destino recebe seu registro, nota explícita, evento e aviso interno. O ator não
ganha acesso ao restante do setor de destino. Recepção continua na central; operadores trabalham
nos cartões de seu setor. Peças permanece CRM comercial, sem estoque/faturamento.

**Criar o cartão de destino, sozinho, não completa uma transferência de conversa.** É necessário
definir também quem recebe a próxima mensagem e impedir resposta pela posse anterior. Não fechar
uma oportunidade como perdida ou cancelar cotação apenas para liberar o canal: isso falseia métricas.

## O que a fonte atual permite e o que falta

| Ponto | Evidência no pin | Consequência |
|---|---|---|
| Central usa posse por e-mail | `src/app/painel/conversas/actions.ts:15`; `conversas.assumida_por` | Não possui a versão inteira dos diálogos modulares. Guarda de área isolada não prova unidade/posse da origem. |
| Atendimento modular só Vendas/Peças | `0006_atendimento.sql:140–156` | Oficina ainda não tem vínculo modular/conversa/versão. Não inserir um setor inválido nem simular esse vínculo por cliente. |
| Negócio aberto ou slot mantém canal fora do legado | `0006_atendimento.sql:1424–1445` | Só devolver/apagar slot não desativa o roteamento anterior. |
| Próxima entrada usa slot autorizado | `0006_atendimento.sql:1987` | Trocar apenas responsável ou criar destino não direciona a próxima mensagem. |
| Mensagem vinculada é imutável | `0006_atendimento.sql:1107–1112`, `1151` | Não mover mensagens antigas para o destino ou forjar proveniência do bot. |
| Oficina atual é domínio de triagem | `0004_oficina.sql:3–35` | Pode originar/receber uma solicitação, mas WhatsApp de Oficina ainda depende de decisão expressa de contrato. |

## Proposta histórica para revisão (9bcab0f, substituída onde divergir do contrato fechado)

1. Manter a unidade da origem; transferência entre unidades fica fora deste recorte. Ator, cliente,
   unidade e eventual conversa são derivados novamente do registro no servidor, nunca livres do form.
2. Novo registro de destino por operação autorizada, sem reutilizar silenciosamente oportunidade,
   cotação ou triagem anterior. UUID de tentativa + versão da origem impedem duplicação/replay
   conflitante. Cliente e veículo válidos são referências preservadas, sem criar outra ficha.
3. Destino Vendas exige escolher funil ativo Novos/Seminovos e responsável elegível daquela unidade,
   sem alterar a carteira geral do cliente. Peças/Oficina podem entrar na fila sem responsável,
   conforme suas políticas existentes. Não copiar preço, qualificação ou confirmação do cliente
   como se tivessem sido verificados pelo destino.
4. Histórico e nota compartilhada pertencem ao encaminhamento. Nota fica somente no painel; não é
   WhatsApp. Destino não recebe mensagens, leituras ou atividades antigas automaticamente, nem
   acesso por conhecer o ID do cliente. Uma transferência não resolve origem ambígua de mensagem.
5. Origem preserva resultado comercial e histórico; precisa de um estado explícito de encaminhamento
   para cessar controle ativo do canal. A nota/evento não substitui esse estado. Leitura do histórico
   original permanece sujeita à política original; destino recebe apenas seu contexto.
6. Uma RPC transacional em `0006_atendimento`, com dependências dos módulos explícitas: autorizar
   origem e versão → conferir destino → criar registro → alterar roteamento/invalidar posse antiga
   → gravar ledger/históricos → notificar elegíveis → auditar. Falha de qualquer parte desfaz tudo.
   Não compor isso com vários INSERTs/actions independentes nem chamar o produtor do bot com wamid falso.
7. Usar locks compatíveis com claims/produtores existentes, após inventariar as ordens reais. Para
   disputa de canal, travar cliente/canal e revalidar origem/destino sob lock; não afirmar que uma
   ordem nova evita deadlock antes dos testes de duas conexões.
8. Envio reservado, despachando ou incerto, posse de terceiro e origem ambígua são conflitos explícitos.
   Nenhuma transferência cancela HTTP já enviado. Uma tentativa antiga não pode ganhar nova
   autorização após troca de contexto; `outbound.ts` e seu ponto de despacho precisam da mesma guarda.

## Perguntas históricas respondidas pelo contrato fechado

| Decisão | Recomendação / limite |
|---|---|
| Mover o fluxo ou abrir solicitação paralela? | Mover o fluxo ativo, preservando o negócio anterior e registrando encaminhamento. Caso seja pedido paralelo, nomear assim e não prometer transferência do canal. Definir onde fica a autoridade do roteamento, inclusive enquanto destino não assume. |
| Oficina participa agora do canal? | Confirmar expressamente. Até aqui só fila/triagem foi aprovada e integrada, sem WhatsApp. Se continuar só domínio, definir comportamento visível do canal ao encaminhar para Oficina; não devolver histórico integral à central como atalho. |
| Responsável/reuso no destino | Validar recomendação de Vendas com responsável elegível, Peças/Oficina em fila e registro novo por tentativa. Reuso existente exige escolha/revalidação explícitas, nunca por cliente sozinho. |
| Concorrência central/Oficina | Definir versão persistida dessas origens antes de expor ação; timestamp da tela não é substituto implícito. Definir intervenção da gestão em posse alheia e destinatários mínimos da notificação. |

Essas decisões não são pedidos de nova permissão ao Simão. São o alinhamento de arquitetura delegado
ao Claude. Enquanto não fechadas, avançar preparação e ajustes dirigidos sem expor uma transferência
parcial como concluída.

## Matriz mínima de testes

- Nove caminhos: central → três setores; cada setor → os outros dois. Mesmo cliente, destino correto,
  nota/evento/aviso únicos e outros negócios intactos.
- Dono/triagem/supervisão elegíveis; recusas de outro operador, gerente de outro setor, ator inativo,
  unidade extra revogada/inativa, registro estrangeiro e `anon`/`authenticated`.
- Versão antiga, posse/reserva alheia, saída reservada/incerta e origem ambígua recusam sem efeitos.
- Replay exato revalida o ator e não duplica nada. Mesmo UUID com argumentos diferentes recusa;
  usuário revogado não consulta resultado antigo como autorização persistente.
- Forçar falha real em destino, histórico, notificação e audit: snapshot antes/depois idêntico,
  incluindo ledger, negócios dos três setores, mensagens, marcas, slots e notificações.
- Mensagens antigas ficam na origem; destino não recebe prévia/total/não lidas/cursor indevidos.
  Próxima entrada tem exatamente um destino, sem reclassificar histórico pelo dono atual.
- Duas conexões reais: duas transferências, transferência × claim e transferência × despacho.
  Verificar resultado único, ausência de órfãos e política de recuperação de deadlock delimitada.

Reuso local: `contratos-pecas-atendimento.sql` fornece snapshot/rollback com falha SQL real;
`contratos-lista-atendimentos.sql` e `contratos-leitura-atendimento.sql` cobrem revogação e histórico.
Harness PGlite atual usa uma conexão e chamadas sequenciais: prova ACL/replay/rollback local, **não**
concorrência multissessão, PostgREST, login ou envio. Nova suíte precisa carregar `0001` a `0006`,
incluindo Oficina; o runner inicial `tests/sql/rodar.ps1` sozinho não comprova esses módulos.

## Estado de integração

Claude confirmou Oficina (adaptador + UI) em merge `287c498`, 1.919 Vitest e servidor local recompilado;
relatou recepção/consultor autorizados e vendedor recusado no navegador. Codex não repetiu nem atribuiu
a si essa execução. Nesta fatia foram feitas análise da fonte e duas revisões independentes readonly;
nenhum SQL remoto, dado, Auth, envio ou servidor foi alterado.

Backend atual separado: `abb9031` contém `0006` e contratos SQL; `0bffe79` contém o aviso estruturado
do adaptador; `2bf3e72` contém a compatibilidade de autoria do diálogo. O novo contrato passou 402
verificações em cada modo ACL, upgrade real e reaplicação populada; quatro regressões dirigidas
passaram. O contrato antigo de A1 falha também na baseline, conforme relatório. Nenhum desses
resultados comprova multissessão, login, PostgREST ou envio real. Claude revisa SQL/ACL antes do dev;
caminhos legados da central e interface permanecem como gates explícitos antes da exposição.
