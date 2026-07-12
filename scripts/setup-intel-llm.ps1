#!/usr/bin/env pwsh
# Set up local Qwen3 on Intel Arc via IPEX-LLM's Ollama portable zip (OpenAI-compatible at :11434).
# Idempotent: re-running skips the download if already extracted and just (re)starts + pulls.
# Then point Vishu at it:  $env:VISHU_PROVIDER="intel"; $env:VISHU_API_KEY="local"; vishu jarvis
#
#   pwsh scripts/setup-intel-llm.ps1                 # qwen3:8b (default)
#   pwsh scripts/setup-intel-llm.ps1 -Model qwen3:4b # lighter fallback if 8b is heavy on shared RAM
param(
  [string]$Model = "qwen3:8b",
  [string]$InstallDir = "D:\claude-tools\ipex-llm-ollama"
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$exe = Join-Path $InstallDir "ollama.exe"
if (-not (Test-Path $exe)) {
  Write-Host "[1/4] Resolving latest IPEX-LLM Ollama portable (Windows) from GitHub releases..."
  $rel = Invoke-RestMethod "https://api.github.com/repos/intel/ipex-llm/releases?per_page=30" -Headers @{ "User-Agent" = "vishu-setup" }
  $asset = $rel.assets + ($rel | ForEach-Object { $_.assets }) |
    Where-Object { $_.name -match '^ollama.*win.*\.zip$' } |
    Select-Object -First 1
  if (-not $asset) { throw "No 'ollama-*-win.zip' asset found in the last 30 ipex-llm releases. Check https://github.com/intel/ipex-llm/releases and download manually." }
  $zip = Join-Path $env:TEMP $asset.name
  Write-Host "      -> $($asset.name) ($([math]::Round($asset.size/1MB)) MB)"
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip
  Write-Host "[2/4] Extracting to $InstallDir ..."
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
  # Portable zips sometimes nest one folder deep — flatten so ollama.exe sits at $InstallDir.
  if (-not (Test-Path $exe)) {
    $inner = Get-ChildItem $InstallDir -Recurse -Filter "ollama.exe" | Select-Object -First 1
    if ($inner) { Get-ChildItem $inner.Directory | Move-Item -Destination $InstallDir -Force }
  }
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "[1-2/4] Already installed at $InstallDir — skipping download."
}
if (-not (Test-Path $exe)) { throw "ollama.exe not found under $InstallDir after extract." }

Write-Host "[3/4] Starting Ollama server (Intel Arc GPU) ..."
$bat = Join-Path $InstallDir "start-ollama.bat"
$env:OLLAMA_HOST = "127.0.0.1:11434"
if (Test-Path $bat) { Start-Process -FilePath $bat -WorkingDirectory $InstallDir -WindowStyle Minimized }
else { Start-Process -FilePath $exe -ArgumentList "serve" -WorkingDirectory $InstallDir -WindowStyle Minimized }

# Wait for the server to accept connections.
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:11434/api/version" -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep -Seconds 1 }
}
if (-not $up) { throw "Ollama did not come up on :11434 within 60s. Check the server window." }

Write-Host "[4/4] Pulling $Model (first run downloads several GB) ..."
& $exe pull $Model
Write-Host ""
Write-Host "Done. Qwen3 is live at http://127.0.0.1:11434/v1 (model: $Model)."
Write-Host 'Use it in Vishu:  $env:VISHU_PROVIDER="intel"; $env:VISHU_API_KEY="local"; vishu jarvis'
