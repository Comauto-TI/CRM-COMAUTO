# Revisão independente do PR #5 — 58327bb

Revisão do commit imutável `58327bbdf35b46bf2cd55dc6bfbd1587de1973b9`, em 11/11/2026.
O commit pretende corrigir os cinco pontos levantados sobre o HEAD anterior
`92a0556b3cded6f556559ae22ab0465b3068b450`.

**Parecer: ainda há um bloqueador P2 na importação.** Nenhuma correção de fonte foi feita nesta revisão.

## P2 — O UPDATE da importação ainda pode apagar chaves de `ids_externos`

Arquivo e linhas no commit revisado:

- `src/modulos/importacao/dados.ts:110–111`: monta o JSON inteiro a partir da ficha lida anteriormente.
- `src/modulos/importacao/dados.ts:136–140`: atualiza esse JSON inteiro e verifica somente se a chave `importacao` continua ausente.

Trechos relevantes:

```ts
patch.ids_externos = {
  ...(f.ids_externos ?? {}),
  importacao: { codigo: c.codigo_externo, em: agora, por: u.email },
};
```

```ts
q = campo === "ids_externos"
  ? q.is("ids_externos->importacao", null)
  : q.is(campo, null);
```

### Reprodução

1. A ficha já possui os campos escalares que o CSV informa; o único campo a completar é o código externo da importação.
2. O SELECT retorna `ids_externos = {"bravus":"original"}`.
3. Outro fluxo acrescenta `avaliex` ao JSON antes do UPDATE da importação.
4. `ids_externos->importacao IS NULL` continua verdadeiro: a outra gravação não criou essa chave.
5. O UPDATE grava o snapshot antigo acrescido de `importacao`, eliminando `avaliex`.

Resultado observado executando a fonte exata do commit:

```text
completados = 1
filtros = id = fixture-c1; anonimizado = false; ids_externos->importacao IS NULL
ids_externos final = {bravus: original, importacao: {...}}
ids_externos.avaliex = ausente
```

O guard adicionado protege a chave `importacao`, mas não preserva as demais chaves
que podem mudar entre a leitura e a escrita. A correção dos campos escalares passa
no caso equivalente: quando o e-mail é preenchido nesse intervalo, seu `.is(null)` impede a sobrescrita.

### Correção mínima sugerida

Uma das duas opções, preservando as verificações de ficha e anonimização:

- Comparar o **JSON inteiro** com o snapshot lido antes de substituí-lo; qualquer diferença deve impedir a escrita e exigir nova leitura.
- Usar uma RPC que trave a ficha, releia `ids_externos` e acrescente somente `importacao` ao JSON atual, na mesma transação. Não transportar o snapshot completo como novo valor.

Acrescentar regressão em que outra chave é incluída e outra em que uma chave já existente é alterada entre SELECT e UPDATE.

## Prova executada e limites

Fixture fora do repositório do produto:

```text
C:\Users\LENOVO\Documents\Codex\2026-11-10\cod\work\revisao-pr5-92a0556\revalidar-58327bb.mjs
```

Execução:

```powershell
node --experimental-vm-modules C:/Users/LENOVO/Documents/Codex/2026-11-10/cod/work/revisao-pr5-92a0556/revalidar-58327bb.mjs
```

A fixture carrega as fontes pelo Git e SHA exatos. O I/O do banco é simulado e aplica
os filtros emitidos pela implementação; a prova demonstra o interleaving descrito,
sem alegar execução concorrente multissessão no PostgreSQL. Não usa Auth, dados reais,
credenciais, servidor ou transporte de mensagens.

As demais reproduções anteriores passaram: preservação de campo escalar concorrente;
erro de UPDATE contado como recusado; nota interna fora do contato; histórico de
1.500 eventos paginado e `parcial=true` em erro/teto; CSV anterior reduzido a 1.000
linhas e corpo de 558.909 bytes no encoder real do React, abaixo de 1 MiB.

## Limite de autoria no Meu Dia

Em `src/modulos/vendas/meu-dia.ts:47`, o filtro continua excluindo somente
`ator = assistente`. Na fixture, uma atividade `tipo = whatsapp` com `ator = sistema`
ou `bot` ainda retira o lead de “sem contato”. Não foi comprovado produtor atual
desses registros; o automatizado atual de Vendas usa `assistente`. Portanto este
resultado fica registrado como limite do contrato, sem bloqueador adicional.
