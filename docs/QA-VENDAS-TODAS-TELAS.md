# QA ampliado de Vendas — navegação e permissões

Rodada autorizada pelo Simão em 11/11/2026. Ambiente informado: `http://localhost:3000`, v0.0.5.
Execução em Chrome headless real, sessão isolada por perfil, viewport 1440 × 1000.
Nenhuma credencial, nome de cliente, telefone, conteúdo de conversa ou ID de cliente é copiado para este documento ou para os relatórios.

## Controles da rodada

- Único POST liberado: login. Demais métodos mutantes são interceptados antes de sair do navegador.
- Bloqueados também GET de conversa geral que marca contador, links públicos `/r/*`, cron,
  detalhe de campanha `?ver=...` inclusive prefetch e busca numérica/documental.
- Sem criar fixtures, editar cadastros, trocar senhas, assumir/devolver, mover/transferir cartões,
  concluir tarefas, marcar/dispensar notificações, gerar disparos, exportar ou enviar mensagens.
- Sem screenshots, traces ou alteração da suíte comum. Oficina permanece congelada.
- A conta nova de vendedor é criada exclusivamente pelo responsável administrativo; não se usa/resetam as contas antigas.

## Runtime observado

O login foi atualizado durante a preparação: título `Acesse sua conta`, botão `Entrar`, campos E-mail/Senha.
O script antigo procurava `Entrar no painel` e parou antes do POST. Isso foi classificado como seletor desatualizado, não falha de senha.
O script próprio foi ajustado depois da leitura do DOM público; identidade usa `span[title='Gerente · Vendas']` ou `span[title='Vendedor · Vendas']`.

Fingerprint SHA256 do texto público do login observado:
`D88EAC90D1CBA4526F16E99F545FB987A4BC2A32A2B49DA9BD14079CCA861ACD`.
O rodapé não expôs versão na sessão; portanto v0.0.5 é a versão informada pela coordenação, não uma inferência do DOM.
Na sessão do vendedor, o fingerprint público foi `B44190EEAFC10E785E8AC183A670036C93286DAD96FF6F707E27A0CE2848DE5C`;
o título/botão permaneceram os mesmos. O hash do texto sozinho não comprova alteração de release.

## Gerente de Vendas

Primeira rodada ampliada autenticada: **17 casos passaram e 1 asserção de URL precisou recuperação de sincronismo**.
A asserção consultava a URL imediatamente após `domcontentloaded`; a recuperação focada esperou o redirecionamento
e confirmou o menu e as sete recusas por URL. **Nenhuma falha de permissão ficou pendente.**
As demais telas/formulários já aprovados não foram repetidos na recuperação.

| Área | Evidência observada |
|---|---|
| Login e perfil | Autenticação e identificação Gerente · Vendas confirmadas. |
| Minha conta | Página e formulário de senha abriram; nenhum campo preenchido ou enviado. |
| Busca | Página e busca por nome abriram; não houve busca por documento. |
| Visão geral | Cabeçalho e Meu dia abriram. |
| Clientes | Filtros e atalhos carteira/novos no mês/falaram em 7 dias abriram. |
| Ficha existente | Autorizações, veículos, oportunidades, agendamentos e formulários de dados/lembrete abriram sem gravação. |
| Meus lembretes | Listas de lembretes e mensagens agendadas abriram, sem cancelar. |
| Notificações | Lista abriu sem marcar ou dispensar. |
| Atendimento geral | Abas Em espera, Em atendimento, Finalizados e Assistente abriram; nenhuma conversa física selecionada. |
| Links e QR | Lista, formulário e QR existente carregaram; nenhum link público/wa.me foi aberto. |
| Campanhas | Lista e formulários abriram; detalhe e pré-checagem excluídos por escrita no GET. |
| Follow-ups | Estados pendente, enviado, respondido, sem consentimento, falhou e cancelado abriram sem ação. |
| Importação | Tela abriu sem selecionar arquivo ou submeter. |
| Vendas | Novos/Seminovos e formulário Nova oportunidade abriram, sem criar. |
| Cartão | Conversa e seções/formulários de atividades, tarefas, qualificação e vínculos abriram, sem ações. |
| Métricas | Tela carregou. |
| Barreira de escrita | Nenhum POST de negócio foi liberado; duas tentativas de prefetch do detalhe de campanha foram interceptadas. |
| Menu/URLs proibidas | Menu e recusas por URL confirmados: Peças, Agenda, Financeiro, Configurações, Piloto, Segurança e Usuários. |

## Vendedor novo

**Conta adicional criada exclusivamente pelo responsável administrativo e confirmada antes do QA.**
A credencial foi lida diretamente do arquivo ignorado `tests/e2e/.env.vendedor-qa2.local`, sem cópia para outro formato.
A conta antiga `vendedor.teste` não foi usada ou redefinida. Sessões próprias conferiram perfil exato e,
na validação pontual final, texto exato do link `.lateral-usuario .link-conta` contra o nome do arquivo ignorado.

Rodada ampliada: **24 casos passaram, 1 asserção de título foi recuperada e 1 caso permaneceu SKIP por falta de dados comparáveis**.
A tela pessoal usa `Minhas métricas`; a expectativa inicial procurava o título genérico `Métricas`.
A recuperação repetiu somente login/identidade e Métricas, confirmando título pessoal, ausência de filtro de terceiros,
ausência de comparação por vendedor e ausência de funil global de eventos. Não há falha funcional pendente observada.

| Área | Evidência observada |
|---|---|
| Identidade adicional | Role Vendedor · Vendas e nome exato do link da conta conferidos; nenhuma credencial copiada para o relatório. |
| Áreas comuns | Minha conta, Busca por nome, Visão geral/Meu dia, Clientes/ficha, lembretes e notificações abriram sem gravação. |
| Atendimento e QR | Abas gerais abriram sem selecionar conversa física; QR existente e formulário abriram sem criar ou acessar link público. |
| Carteira e formulários | Novos/Seminovos, Nova oportunidade e painel de cartão/formulários abriram sem assumir, mover, transferir ou submeter. Abertura do painel não prova leitura de histórico quando o domínio ainda não está atribuído. |
| Métricas pessoais | `Minhas métricas`, indicação de oportunidades próprias e ausência dos controles/visões globais conferidas. |
| Recusas por URL | Peças, Agenda, Financeiro, Configurações, Piloto, Segurança, Usuários, Campanhas, Follow-ups e Importação foram recusados. |
| Carteira alheia/API | SKIP: a ficha disponível não forneceu oportunidade alheia verificável; nenhuma identidade foi adivinhada e nenhum registro criado. |
| Escritas | Nenhum POST de negócio liberado, nenhuma senha preenchida em Minha conta e nenhuma mensagem enviada. |

## Limites materiais

- `GET /painel/campanhas?ver=...` chama `preChecagem`, que atualiza `total_previsto` e `custo_estimado_brl`.
  O GET não é tratado como leitura segura; seu prefetch foi bloqueado antes de abrir a lista.
- Busca por CPF/CNPJ gera auditoria no servidor; essa modalidade ficou fora desta rodada.
- Validação quantitativa entre carteiras/unidades exige dados comparáveis. A rodada não cria nem modifica registros para produzir esses casos.
- Controles de escrita foram conferidos pela interceptação do navegador e pelo inventário do código; não houve snapshot/preflight adicional de Auth ou banco.
- Não há prova de envio, persistência de formulários, concorrência multissessão ou layout mobile nesta rodada.

## Artefatos locais

- Script próprio: `work/qa-vendas-ampliado.mjs`, fora do Git.
- JSONs: `work/qa-vendas-todas-telas/gerente_vendas.json` e `gerente_vendas-permissoes.json`.
- Vendedor adicional: `vendedor_novo.json` e `vendedor_novo-metricas-identidade.json`, na mesma pasta de relatórios.
- Tentativa interrompida por seletor antigo preservada em `gerente_vendas-login-seletor-antigo.json`.
- Esta rodada não editou `tests/e2e/perfis-readonly.mjs`; alterações da coordenação/outros agentes foram preservadas.
