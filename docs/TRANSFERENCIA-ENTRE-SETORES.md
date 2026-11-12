# Transferência entre setores — contrato para revisão

Direção do Simão recebida pelo Claude em 12/11/2026. **Proposta, ainda sem SQL, serviço ou tela de
transferência implementados.** Base examinada: Claude `588bc1c` (Oficina integrada), incorporada na
branch `codex/transferencias-setores` pelo merge `be4868b`. Não é publicação em produção.

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

## Recomendação para o primeiro recorte

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

## Decisões de contrato para Claude antes do SQL

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
