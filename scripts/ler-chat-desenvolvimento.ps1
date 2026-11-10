[CmdletBinding(DefaultParameterSetName = 'Ler')]
param(
  [string]$Chat = (Join-Path (Split-Path -Parent $PSScriptRoot) 'chatdesenvolvimento.txt'),
  [Parameter(Mandatory)]
  [string]$Estado,
  [Parameter(Mandatory, ParameterSetName = 'Confirmar')]
  [ValidateRange(0, 2147483647)]
  [int]$AteBytes,
  [Parameter(Mandatory, ParameterSetName = 'Confirmar')]
  [ValidatePattern('^[0-9a-fA-F]{64}$')]
  [string]$Sha256
)

$ErrorActionPreference = 'Stop'
$chatPath = [System.IO.Path]::GetFullPath($Chat)
$statePath = [System.IO.Path]::GetFullPath($Estado)
if ($chatPath -eq $statePath) { throw 'O arquivo de estado deve ser diferente do chat.' }

$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$bytes = [System.IO.File]::ReadAllBytes($chatPath)

function Get-PrefixHash([int]$Length) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    [Convert]::ToHexString($algorithm.ComputeHash($bytes, 0, $Length))
  } finally {
    $algorithm.Dispose()
  }
}

$checkpoint = $null
$prefixMatches = $false
if ([System.IO.File]::Exists($statePath)) {
  $checkpoint = [System.IO.File]::ReadAllText($statePath, $utf8) | ConvertFrom-Json
  if ($checkpoint.chat -ne $chatPath -or $null -eq $checkpoint.bytes -or
      $checkpoint.bytes -lt 0 -or $checkpoint.sha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'O estado de leitura é inválido ou pertence a outro arquivo.'
  }
  $prefixMatches = $checkpoint.bytes -le $bytes.Length -and
    (Get-PrefixHash $checkpoint.bytes) -eq $checkpoint.sha256
}

if ($PSCmdlet.ParameterSetName -eq 'Confirmar') {
  if ($AteBytes -gt $bytes.Length -or (Get-PrefixHash $AteBytes) -ne $Sha256) {
    throw 'O trecho observado mudou. Leia o chat novamente antes de confirmar.'
  }
  if ($prefixMatches -and $AteBytes -lt $checkpoint.bytes) {
    throw 'Este trecho já foi ultrapassado pelo estado atual.'
  }

  $state = @{ chat = $chatPath; bytes = $AteBytes; sha256 = $Sha256 } | ConvertTo-Json -Compress
  $tempPath = "$statePath.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [System.IO.File]::WriteAllText($tempPath, $state, $utf8)
    [System.IO.File]::Move($tempPath, $statePath, $true)
  } finally {
    [System.IO.File]::Delete($tempPath)
  }
  @{ situacao = 'confirmado'; ateBytes = $AteBytes } | ConvertTo-Json -Compress
  return
}

$start = if ($prefixMatches) { [int]$checkpoint.bytes } else { 0 }
if ($prefixMatches -and $start -eq $bytes.Length) {
  @{ situacao = 'sem_mudanca'; ateBytes = $start } | ConvertTo-Json -Compress
  return
}

# O estado usa os bytes originais. A saída omite formatos comuns de credenciais.
$conteudo = $utf8.GetString($bytes, $start, $bytes.Length - $start)
if ($start -eq 0) { $conteudo = $conteudo.TrimStart([char]0xFEFF) }
$conteudo = $conteudo -replace '(?i)(?:\b(?:sk-|sbp_|sb_secret_|ghp_|gho_|github_pat_|AIza|EAA)[A-Za-z0-9_-]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?://[^\s]+)', '[credencial omitida]'

$situacao = if ($prefixMatches) { 'acrescimo' } elseif ($checkpoint) { 'reescrito' } else { 'primeira_leitura' }
[ordered]@{
  situacao = $situacao
  aPartirDeBytes = $start
  ateBytes = $bytes.Length
  sha256 = Get-PrefixHash $bytes.Length
  conteudo = $conteudo
} | ConvertTo-Json -Compress
