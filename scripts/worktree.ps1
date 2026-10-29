<#
.SYNOPSIS
  Izolowane worktree dla rownoleglej pracy agentow AI nad story PhysioBook.

.DESCRIPTION
  Kazde worktree dostaje:
    * wlasny branch  (type/story-nazwa, zgodnie z CLAUDE.md)
    * wlasny folder  (..\physiobook.worktrees\<story>-<nazwa>)
    * wlasny .env    (skopiowany z glownego repo, z przesunietymi portami
                      i osobnym COMPOSE_PROJECT_NAME -> osobne kontenery i baza)
    * wlasne node_modules (pnpm install --frozen-lockfile)
    * CLAUDE.local.md z portami/URL-ami, zeby agent nie celowal w localhost:3000

  Slot N (1..9) przesuwa kazdy port o N*10, np. slot 1:
    Postgres 5442, Mailpit SMTP 1035 / UI 8035, backend 3010, frontend 5183.

.EXAMPLE
  .\scripts\worktree.ps1 new -Story 3.2 -Name book-appointment
  .\scripts\worktree.ps1 new -Story 3.3 -Name cancel-appointment -Up
  .\scripts\worktree.ps1 list
  .\scripts\worktree.ps1 remove -Name 3.2-book-appointment -DeleteBranch
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('new', 'remove', 'list')]
  [string]$Command,

  # new: numer story z BACKLOG.csv, np. 3.2
  [string]$Story,
  # new: krotki opis w kebab-case; remove: nazwa folderu worktree (np. 3.2-book-appointment)
  [string]$Name,
  # new: prefiks brancha
  [ValidateSet('feat', 'fix', 'chore', 'refactor', 'test', 'docs')]
  [string]$Type = 'feat',
  # new: branch bazowy
  [string]$Base = 'main',
  # new: wymuszony slot portow 1..9 (domyslnie pierwszy wolny)
  [ValidateRange(1, 9)]
  [int]$Slot = 0,
  # new: pomin pnpm install
  [switch]$NoInstall,
  # new: od razu postaw stack docker compose i zrob db:migrate
  [switch]$Up,
  # remove: usun tez lokalny branch (tylko jesli zmergowany; z -Force takze niezmergowany)
  [switch]$DeleteBranch,
  # remove: usun worktree mimo niezacommitowanych zmian
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Pomocnicze ---------------------------------------------------------------

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "UWAGA: $msg" -ForegroundColor Yellow }

function Invoke-Native {
  # Uruchamia polecenie zewnetrzne i przerywa skrypt, jesli zwroci kod != 0.
  param([string]$Exe, [string[]]$Arguments)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Polecenie nie powiodlo sie ($LASTEXITCODE): $Exe $($Arguments -join ' ')" }
}

function Get-MainRoot {
  # Dziala z dowolnego worktree: wspolny katalog .git wskazuje glowne repo.
  $common = (& git rev-parse --path-format=absolute --git-common-dir 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $common) { throw 'Uruchom skrypt z wnetrza repozytorium physiobook.' }
  return (Split-Path ([IO.Path]::GetFullPath($common)) -Parent)
}

function Get-WorktreesBase([string]$mainRoot) {
  $parent = Split-Path $mainRoot -Parent
  $leaf = Split-Path $mainRoot -Leaf
  return (Join-Path $parent "$leaf.worktrees")
}

function Get-Worktrees([string]$mainRoot) {
  # Zwraca liste @{ Path; Branch } z `git worktree list --porcelain`.
  $out = & git -C $mainRoot worktree list --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'git worktree list nie powiodlo sie.' }
  $list = @()
  $cur = $null
  foreach ($line in $out) {
    if ($line -like 'worktree *') {
      if ($cur) { $list += [pscustomobject]$cur }
      $cur = @{ Path = [IO.Path]::GetFullPath($line.Substring(9)); Branch = '' }
    } elseif ($line -like 'branch *' -and $cur) {
      $cur.Branch = $line.Substring(7) -replace '^refs/heads/', ''
    }
  }
  if ($cur) { $list += [pscustomobject]$cur }
  return $list
}

function Read-EnvLines([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return @() }
  return @([IO.File]::ReadAllLines($file))
}

function Get-EnvValue([string[]]$lines, [string]$key) {
  foreach ($l in $lines) {
    if ($l -match "^\s*$([regex]::Escape($key))\s*=(.*)$") { return $Matches[1].Trim() }
  }
  return $null
}

function Set-EnvValue([string[]]$lines, [string]$key, [string]$value) {
  $found = $false
  $result = @(foreach ($l in $lines) {
    if ($l -match "^\s*$([regex]::Escape($key))\s*=") { $found = $true; "$key=$value" } else { $l }
  })
  if (-not $found) { $result += "$key=$value" }
  return $result
}

function Write-TextFile([string]$file, [string[]]$lines) {
  # UTF-8 bez BOM i LF: BOM w .env psuje pierwszy klucz dla docker compose.
  $enc = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($file, (($lines -join "`n") + "`n"), $enc)
}

function Test-PortFree([int]$port) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
    $listener.Start()
    return $true
  } catch { return $false } finally { if ($listener) { $listener.Stop() } }
}

function Get-UsedSlots([string]$mainRoot) {
  $used = @()
  foreach ($wt in (Get-Worktrees $mainRoot)) {
    $s = Get-EnvValue (Read-EnvLines (Join-Path $wt.Path '.env')) 'WORKTREE_SLOT'
    if ($s) { $used += [int]$s }
  }
  return $used
}

# Klucze portow i ich wartosci domyslne (gdyby nie bylo ich w .env).
$PortKeys = [ordered]@{
  POSTGRES_PORT     = 5432
  MAILPIT_SMTP_PORT = 1025
  MAILPIT_UI_PORT   = 8025
  BACKEND_PORT      = 3000
  FRONTEND_PORT     = 5173
}

# --- new ----------------------------------------------------------------------

function New-StoryWorktree {
  if (-not $Story -or -not $Name) { throw 'Podaj -Story (np. 3.2) i -Name (np. book-appointment).' }
  if ($Name -notmatch '^[a-z0-9][a-z0-9-]*$') { throw '-Name ma byc w kebab-case: male litery, cyfry, myslniki.' }
  if ($Story -notmatch '^[0-9A-Za-z.]+$') { throw '-Story ma zawierac tylko cyfry/litery/kropki, np. 3.2.' }

  $mainRoot = Get-MainRoot
  $branch = "$Type/$Story-$Name"
  $folder = "$Story-$Name"
  $wtBase = Get-WorktreesBase $mainRoot
  $wtPath = Join-Path $wtBase $folder

  if (Test-Path -LiteralPath $wtPath) { throw "Folder juz istnieje: $wtPath" }

  # Slot portow
  $used = Get-UsedSlots $mainRoot
  if ($Slot -eq 0) {
    $Slot = (1..9 | Where-Object { $used -notcontains $_ } | Select-Object -First 1)
    if (-not $Slot) { throw 'Brak wolnych slotow (1..9). Usun nieuzywane worktree.' }
  } elseif ($used -contains $Slot) {
    throw "Slot $Slot jest juz zajety przez inne worktree."
  }
  $offset = $Slot * 10

  # Branch
  Write-Step "Pobieram origin"
  Invoke-Native git @('-C', $mainRoot, 'fetch', 'origin', '--prune')

  New-Item -ItemType Directory -Force -Path $wtBase | Out-Null

  & git -C $mainRoot show-ref --verify --quiet "refs/heads/$branch"
  $localExists = ($LASTEXITCODE -eq 0)
  & git -C $mainRoot show-ref --verify --quiet "refs/remotes/origin/$branch"
  $remoteExists = ($LASTEXITCODE -eq 0)

  if ($localExists) {
    Write-Step "Branch $branch juz istnieje lokalnie - podpinam go w worktree"
    Invoke-Native git @('-C', $mainRoot, 'worktree', 'add', $wtPath, $branch)
  } elseif ($remoteExists) {
    Write-Step "Branch $branch istnieje na origin - tworze lokalny z trackingiem"
    Invoke-Native git @('-C', $mainRoot, 'worktree', 'add', '--track', '-b', $branch, $wtPath, "origin/$branch")
  } else {
    Write-Step "Tworze branch $branch z origin/$Base"
    Invoke-Native git @('-C', $mainRoot, 'worktree', 'add', '--no-track', '-b', $branch, $wtPath, "origin/$Base")
  }

  # .env
  $srcEnv = Join-Path $mainRoot '.env'
  if (-not (Test-Path -LiteralPath $srcEnv)) {
    $srcEnv = Join-Path $mainRoot '.env.example'
    Write-Warn 'Brak .env w glownym repo - uzywam .env.example.'
  }
  $envLines = Read-EnvLines $srcEnv
  $ports = [ordered]@{}
  foreach ($k in $PortKeys.Keys) {
    $baseVal = Get-EnvValue $envLines $k
    if (-not $baseVal) { $baseVal = $PortKeys[$k] }
    $ports[$k] = [int]$baseVal + $offset
    $envLines = Set-EnvValue $envLines $k $ports[$k]
  }
  $dbUrl = Get-EnvValue $envLines 'DATABASE_URL'
  if ($dbUrl) {
    $envLines = Set-EnvValue $envLines 'DATABASE_URL' ($dbUrl -replace '(@[^:/@]+:)\d+', "`${1}$($ports.POSTGRES_PORT)")
  }
  $project = "physiobook-wt$Slot"
  $envLines += ''
  $envLines += '# --- Worktree (wygenerowane przez scripts/worktree.ps1) -----------------------'
  $envLines += '# Nadpisuje `name: physiobook` z docker-compose.yml -> osobne kontenery, siec i wolumen bazy.'
  $envLines = Set-EnvValue $envLines 'COMPOSE_PROJECT_NAME' $project
  $envLines = Set-EnvValue $envLines 'WORKTREE_SLOT' $Slot
  Write-TextFile (Join-Path $wtPath '.env') $envLines
  Write-Step ".env utworzony (slot $Slot, projekt compose $project)"

  # Lokalne ustawienia Claude Code (nie sa w gicie)
  $srcSettings = Join-Path $mainRoot '.claude/settings.local.json'
  if (Test-Path -LiteralPath $srcSettings) {
    New-Item -ItemType Directory -Force -Path (Join-Path $wtPath '.claude') | Out-Null
    Copy-Item -LiteralPath $srcSettings -Destination (Join-Path $wtPath '.claude/settings.local.json')
  }

  # Pliki lokalne wykluczone z gita w .git/info/exclude (wspolne dla wszystkich
  # worktree): nie trafia do commitow i nie blokuja `git worktree remove`.
  $excludeFile = Join-Path $mainRoot '.git/info/exclude'
  New-Item -ItemType Directory -Force -Path (Split-Path $excludeFile -Parent) | Out-Null
  $exclude = Read-EnvLines $excludeFile
  foreach ($pattern in @('/CLAUDE.local.md', '/.claude/settings.local.json')) {
    if ($exclude -notcontains $pattern) { Add-Content -LiteralPath $excludeFile -Value $pattern }
  }

  $note = @(
    "# Lokalny kontekst worktree (nie commitowac)",
    "",
    "Pracujesz w izolowanym worktree dla story **$Story** na branchu ``$branch``.",
    "Rownolegle w tym samym repozytorium pracuje inny agent w innym worktree.",
    "",
    "- Folder roboczy: ``$wtPath`` - nie wychodz poza niego i nie przelaczaj brancha.",
    "- Projekt docker compose: ``$project`` (ustawiony w .env, zwykle ``docker compose up`` wystarczy).",
    "- Porty tego worktree (NIE uzywaj domyslnych 3000/5173/5432):",
    "  - frontend: http://localhost:$($ports.FRONTEND_PORT)",
    "  - backend API (tylko stack dev): http://localhost:$($ports.BACKEND_PORT)",
    "  - Postgres: localhost:$($ports.POSTGRES_PORT)",
    "  - Mailpit UI: http://localhost:$($ports.MAILPIT_UI_PORT), SMTP: $($ports.MAILPIT_SMTP_PORT)",
    "- Stack produkcyjny (``docker compose -f docker-compose.yml up``) w tym worktree nie zadziala:",
    "  docker/frontend/nginx.conf ma na sztywno ``backend:3000``. Uzywaj stacku dev.",
    "- Zmiany commituj i pushuj tylko na ``$branch``; PR do ``$Base``."
  )
  Write-TextFile (Join-Path $wtPath 'CLAUDE.local.md') $note

  # Zaleznosci
  if (-not $NoInstall) {
    Write-Step 'pnpm install --frozen-lockfile'
    Push-Location $wtPath
    try { Invoke-Native pnpm @('install', '--frozen-lockfile') } finally { Pop-Location }
  }

  # Kontrola portow
  foreach ($k in $ports.Keys) {
    if (-not (Test-PortFree $ports[$k])) { Write-Warn "Port $($ports[$k]) ($k) jest juz zajety na tym komputerze." }
  }

  # Opcjonalnie stack + migracje
  if ($Up) {
    Push-Location $wtPath
    try {
      Write-Step "docker compose up (projekt $project)"
      Invoke-Native docker @('compose', '-p', $project, 'up', '-d', '--build', '--wait')
      Write-Step 'pnpm db:migrate'
      $prev = $env:DATABASE_URL
      $env:DATABASE_URL = Get-EnvValue $envLines 'DATABASE_URL'
      try { Invoke-Native pnpm @('db:migrate') } finally { $env:DATABASE_URL = $prev }
    } finally { Pop-Location }
  }

  Write-Host ''
  Write-Host "Gotowe: $wtPath" -ForegroundColor Green
  Write-Host "  branch   : $branch"
  Write-Host "  slot     : $Slot  (compose: $project)"
  Write-Host "  frontend : http://localhost:$($ports.FRONTEND_PORT)"
  Write-Host "  backend  : http://localhost:$($ports.BACKEND_PORT)"
  Write-Host "  postgres : localhost:$($ports.POSTGRES_PORT)"
  Write-Host "  mailpit  : http://localhost:$($ports.MAILPIT_UI_PORT)"
  Write-Host ''
  Write-Host 'Nastepnie:'
  Write-Host "  cd `"$wtPath`""
  if (-not $Up) { Write-Host '  docker compose up -d --build --wait; pnpm db:migrate   # jesli story potrzebuje stacku' }
  Write-Host '  claude                                                 # uruchom agenta w tym folderze'
}

# --- remove -------------------------------------------------------------------

function Remove-StoryWorktree {
  if (-not $Name) { throw 'Podaj -Name, czyli nazwe folderu worktree (zobacz: worktree.ps1 list).' }
  $mainRoot = Get-MainRoot
  $wtPath = [IO.Path]::GetFullPath((Join-Path (Get-WorktreesBase $mainRoot) $Name))
  $wt = Get-Worktrees $mainRoot | Where-Object { $_.Path -eq $wtPath } | Select-Object -First 1
  if (-not $wt) { throw "Nie znaleziono worktree: $wtPath" }
  if ($wt.Path -eq [IO.Path]::GetFullPath($mainRoot)) { throw 'To jest glowne repo - nie usuwam.' }

  $envLines = Read-EnvLines (Join-Path $wtPath '.env')
  $project = Get-EnvValue $envLines 'COMPOSE_PROJECT_NAME'
  if ($project -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Step "docker compose down -v (projekt $project)"
    Push-Location $wtPath
    try { & docker compose -p $project down -v --remove-orphans } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Write-Warn 'docker compose down nie powiodlo sie - sprawdz kontenery recznie.' }
  }

  Write-Step "git worktree remove $wtPath"
  $rmArgs = @('-C', $mainRoot, 'worktree', 'remove', $wtPath)
  if ($Force) { $rmArgs += '--force' }
  Invoke-Native git $rmArgs
  Invoke-Native git @('-C', $mainRoot, 'worktree', 'prune')

  if ($DeleteBranch -and $wt.Branch) {
    $flag = '-d'
    if ($Force) { $flag = '-D' }
    Write-Step "git branch $flag $($wt.Branch)"
    & git -C $mainRoot branch $flag $wt.Branch
    if ($LASTEXITCODE -ne 0) { Write-Warn "Branch $($wt.Branch) nie jest zmergowany - zostawiam go (uzyj -Force, by usunac)." }
  }
  Write-Host 'Usunieto.' -ForegroundColor Green
}

# --- list ---------------------------------------------------------------------

function Show-StoryWorktrees {
  $mainRoot = Get-MainRoot
  Get-Worktrees $mainRoot | ForEach-Object {
    $lines = Read-EnvLines (Join-Path $_.Path '.env')
    $slot = Get-EnvValue $lines 'WORKTREE_SLOT'
    if (-not $slot) { $slot = '-' }
    [pscustomobject]@{
      Folder   = Split-Path $_.Path -Leaf
      Branch   = $_.Branch
      Slot     = $slot
      Frontend = Get-EnvValue $lines 'FRONTEND_PORT'
      Backend  = Get-EnvValue $lines 'BACKEND_PORT'
      Postgres = Get-EnvValue $lines 'POSTGRES_PORT'
    }
  } | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
}

switch ($Command) {
  'new'    { New-StoryWorktree }
  'remove' { Remove-StoryWorktree }
  'list'   { Show-StoryWorktrees }
}
