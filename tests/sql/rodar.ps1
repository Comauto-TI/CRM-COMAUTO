param([switch]$IncluirDemo)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new()
$raiz = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$container = 'comauto-sql-' + [guid]::NewGuid().ToString('N').Substring(0, 12)

if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker precisa estar disponível para rodar os contratos SQL.'
}

function Executar-Sql([string]$Sql) {
    $Sql | docker exec -i $container psql -X -U postgres -d comauto_contratos -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao executar SQL. Veja a saída do psql.' }
}

function Executar-Arquivo([string]$Caminho) {
    Executar-Sql (Get-Content -LiteralPath (Join-Path $raiz $Caminho) -Raw -Encoding utf8)
}

docker run --rm --detach --name $container --network none --env POSTGRES_DB=comauto_contratos --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker não conseguiu subir o Postgres de teste.' }

try {
    $pronto = $false
    for ($tentativa = 0; $tentativa -lt 45; $tentativa++) {
        # O servidor temporário de initdb não escuta em TCP.
        docker exec $container pg_isready -h 127.0.0.1 -U postgres -d comauto_contratos | Out-Null
        if ($LASTEXITCODE -eq 0) { $pronto = $true; break }
        Start-Sleep -Seconds 1
    }
    if (!$pronto) { throw 'O Postgres de teste não iniciou em 45 segundos.' }

    Executar-Sql @'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
'@
    Executar-Arquivo 'supabase\migrations\0001_init.sql'
    Executar-Arquivo 'supabase\seed.sql'
    Executar-Arquivo 'tests\sql\contratos.sql'

    if ($IncluirDemo) {
        $seed = Get-Content -LiteralPath (Join-Path $raiz 'supabase\seed_demo.sql') -Raw -Encoding utf8
        Executar-Sql ("SET comauto.ambiente = 'demo';" + [Environment]::NewLine + $seed)
        Executar-Sql ("SET comauto.ambiente = 'demo';" + [Environment]::NewLine + $seed)
        Executar-Sql @'
do $$
begin
  if (select count(*) from clientes where origem = 'demo') <> 60 then
    raise exception 'C5: esperado 60 clientes demo após duas execuções';
  end if;
  if (select count(distinct a.status) from agendamentos a where a.origem = 'demo') <> 5 then
    raise exception 'C5: esperado agendamento demo em todos os cinco status';
  end if;
  if not exists (select from conversas v join clientes c on c.id = v.cliente_id where c.origem = 'demo' and v.status = 'humano' and v.assumida_por is null) then
    raise exception 'C5: esperado atendimento humano aguardando na fila';
  end if;
  if (select count(distinct ocorrido_em::date) from custos where metadata @> '{"demo":true}') <> 30 then
    raise exception 'C5: esperado histórico de custos em 30 dias';
  end if;
  raise notice 'C5 OK: dados de demo e reexecução';
end;
$$;
'@
    }
} finally {
    docker stop $container | Out-Null
}

