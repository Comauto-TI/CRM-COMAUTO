# Oficina — conferência real de leitura no dev · 12/11/2026

Claude informou a revisão/aplicação da 0004 (`f6295a6`). Codex conferiu a RPC real pelo PostgREST
do projeto de testes confirmado `csgrnmoyowjhzlibbilk`, usando configuração local sem copiar chaves.

**11 casos passaram; nenhuma gravação de produto, criação de sessão, conta ou fixture.**

| Caso | Resultado |
|---|---|
| Recepção: fila geral e minhas | Autorizadas, ambas vazias |
| Consultor técnico: fila e minhas | Autorizadas, ambas vazias |
| Gerente Vendas, gerente Peças, financeiro e vendedor QA 2 | Recusados com `nao_encontrado`, sem corpo/total |
| Ator inexistente | Recusado |
| Limite zero | Recusado como `invalido` |
| Chamada direta anônima à RPC | Recusada com erro SQL `42501` |

As identidades foram limitadas aos endereços de teste documentados; perfis atuais foram conferidos
por ID, papel, setor, unidade e ativo antes dos testes. A primeira busca por endereços presumidos
não encontrou todos os perfis; o runner foi corrigido para ler os endereços exatos do arquivo local.
Isso não foi falha da fila nem tentativa de senha alternativa.

O runner privado `work/verificar-oficina-dev-readonly.mjs` permite apenas GET dos perfis/configuração
necessários e POST de `oficina_fila`, com host exato. Nenhuma RPC de cadastro/claim/envio foi chamada.
Saída sanitizada em `work/oficina-dev-readonly.json`: só casos, contagens e flags; sem IDs de pessoas,
contatos, nomes de clientes, senhas, tokens ou dados do corpo dos cartões.

**Limites:** filas reais sem registros não comprovam isolamento quantitativo entre carteiras, corpo
de cartão, escrita, login do painel ou concorrência multissessão. A matriz SQL local anterior continua
sendo a evidência com dados fictícios para essas políticas; não a chamar de teste remoto/E2E.
Essa conferência comprova disponibilidade da leitura, aceitação/recusa dos atores testados e bloqueio
do chamador anônimo. O adaptador ainda é integrado pelo Claude; telas ficam isoladas na branch até sua revisão.
