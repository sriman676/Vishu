#!/usr/bin/env pwsh
# One-click installer for Vishu (Windows-native). Idempotent — safe to re-run.
#   pwsh ./install.ps1
# Provisions pnpm, installs (frozen), builds, and runs the green gate.
# Also starts the local IPEX-LLM Ollama server if it's installed and not already up
# (needed for the local model / vision lane; skipped with a note if absent).
[CmdletBinding()]
param(
  [switch]$SkipOllama,   # don't touch the local model server
  [switch]$SkipGate      # install + build only, skip the tsc/test gate
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }

# --- Node ---
Step 'Node'
$nodeMajor = 0
try { $nodeMajor = [int](node -p 'process.versions.node.split(".")[0]') } catch {}
if ($nodeMajor -lt 24) { Warn "Vishu targets Node >= 24 (found major $nodeMajor). Continuing; upgrade if the build fails." }
else { Ok "Node $(node -v)" }

# --- pnpm (corepack first, then a global npm install) ---
Step 'pnpm'
function Have-Pnpm { try { pnpm --version *> $null; return $true } catch { return $false } }
if (-not (Have-Pnpm)) { try { corepack enable pnpm } catch {} }
if (-not (Have-Pnpm)) { npm install -g pnpm }
if (-not (Have-Pnpm)) { throw 'pnpm unavailable — install it (https://pnpm.io/installation) then re-run.' }
Ok "pnpm $(pnpm --version)"

# --- .env ---
Step '.env'
if (-not (Test-Path .env)) {
  if (Test-Path .env.example) { Copy-Item .env.example .env; Warn 'created .env from .env.example — paste your VISHU_API_KEY into it.' }
  else { Warn 'no .env and no .env.example found.' }
} else {
  $key = (Select-String -Path .env -Pattern '^\s*VISHU_API_KEY\s*=\s*(.+)$' -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($key -and $key.Matches[0].Groups[1].Value.Trim().Trim('"') -notin @('', 'your-key-here')) { Ok 'VISHU_API_KEY set' }
  else { Warn 'VISHU_API_KEY missing/placeholder in .env — cloud lanes stay off until set.' }
}

# --- local IPEX-LLM Ollama (optional, for the local model + vision lane) ---
if (-not $SkipOllama) {
  Step 'local model server (IPEX Ollama)'
  $up = try { (Test-NetConnection 127.0.0.1 -Port 11434 -InformationLevel Quiet -WarningAction SilentlyContinue) } catch { $false }
  if ($up) { Ok 'Ollama already listening on 127.0.0.1:11434' }
  else {
    $exe = 'D:\ipex-llm\ollama\ollama.exe'
    if (Test-Path $exe) {
      # ponytail: fixed Arc-iGPU launch recipe (see project_vishu_tier3_activation) — swap dir/env if the box changes.
      $env:OLLAMA_NUM_GPU = '999'; $env:ZES_ENABLE_SYSMAN = '1'; $env:OLLAMA_HOST = '127.0.0.1:11434'
      Start-Process -FilePath $exe -ArgumentList 'serve' -WorkingDirectory (Split-Path $exe) -WindowStyle Hidden
      Ok 'started IPEX Ollama (background) — pull a vision model with: ollama pull moondream'
    } else { Warn "IPEX Ollama not found at $exe — local model/vision lane stays off. Start it yourself if you use it." }
  }
} else { Warn 'skipped Ollama (-SkipOllama)' }

# --- install + build ---
Step 'install (frozen) + build'
pnpm install --frozen-lockfile
pnpm -r build
Ok 'workspace installed and built'

# --- green gate ---
if (-not $SkipGate) {
  Step 'green gate (tsc + tests)'
  Push-Location packages/core
  try {
    npx tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw "tsc reported type errors (exit $LASTEXITCODE)" }
    Ok 'tsc --noEmit clean'
    node --test --import tsx "src/**/*.test.ts"
    if ($LASTEXITCODE -ne 0) { throw "tests failed (exit $LASTEXITCODE)" }
    Ok 'tests passed'
  } finally { Pop-Location }
} else { Warn 'skipped green gate (-SkipGate)' }

Step 'done'
Write-Host @'
Vishu is installed and built.

Next:
  1. ensure .env has VISHU_API_KEY (and any provider keys you use)
  2. pnpm vishu chat "hello"          (or: agent / build / serve)
  3. connect a service:  pnpm vishu connect github   (or composio / browser / <app>)

Optional: voice/vision sidecars light up on next start if their models are on disk
(see scripts/setup-intel-llm.ps1 and packages/core/sidecar/setup-voice.ps1).
'@ -ForegroundColor Green
