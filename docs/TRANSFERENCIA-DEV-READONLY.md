# Transferência — conferência real somente leitura no dev

12/11/2026, 17:04 UTC. Projeto conferido: `csgrnmoyowjhzlibbilk`, por URL exata validada antes das
requisições. Claude aprovou bda5b63 e informou que aplicou seu0006 no dev, incluindo transparência
sobre o ensaio que acabou executando COMMIT. Essa aplicação foi dele, não executada pelo Codex.

O Codex conferiu **11 casos PASS** via PostgREST, sem alterar dados:

| Conferência | Resultado |
|---|---|
| OpenAPI da transferência | RPC com10 argumentos; `p_ator_email` obrigatório. Não foi chamada a operação de transferência. |
| Três tabelas novas | HEAD do servidor leu contagens: ledger, snapshot e rota estavam vazios. |
| Acesso anônimo às três tabelas | GET mínimo de um ID recusado com SQL42501/HTTP401, sem linhas. |
| Leitor de operação ausente | Recepção, Peças e vendedor ativos retornaram somente `ok:false/codigo:nao_encontrado`, sem nota/corpo/metadados. Perfis/IDs ficaram apenas em memória. |
| Leitor anônimo | Execução recusada com42501. |

As contas conectadas do plugin Supabase não incluíam esse projeto. Foi usada configuração local
documentada; somente três variáveis Supabase foram lidas, sem imprimir/gravar seus valores. O script
tem allowlist de origem, caminhos, métodos e limites; só GET/HEAD e a RPC STABLE de leitura. Não usa
Auth admin, login ou credenciais de usuários. Chaves não aparecem no resultado.

Durante o preparo, uma expectativa incorreta do harness para a recusa em HEAD foi corrigida: HEAD
não devolve corpo JSON e o projeto responde401/42501 ao papel anon, não403. Um GET mínimo confirmou
a recusa antes da rodada final. Isso não foi uma alteração de ACL, nem defeito da aplicação.

Artefatos privados: `work/verificar-transferencia-dev-readonly.mjs` e
`work/transferencia-dev-readonly.json`, `writes:0`. Não foram chamados transferência, claim, reservas,
marcas, envios ou seed. Nenhum perfil, Auth ou dado externo foi alterado.

Limites: OpenAPI/recusas em banco vazio não comprovam transferência real, histórico positivo,
login/E2E ou concorrência. O corpo SQL/hash e a ausência de SELECT em Auth foram conferidos e
informados pelo Claude; esta rodada verificou somente o contrato PostgREST e as recusas descritas.
Antes da UI, seguem os controles em `TRANSFERENCIA-CENTRAL-PREREQUISITOS.md`.
