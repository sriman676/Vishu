#!/usr/bin/env pwsh
# Release + (optional) code-signing for Vishu.
#
# INERT WITHOUT A CERT — this is the signed-distribution machinery, ready but idle. It signs the given
# artifact ONLY when VISHU_SIGN_CERT (path to a .pfx) + VISHU_SIGN_PASS are set and signtool is on PATH;
# otherwise it builds, hashes, and writes an UNSIGNED manifest. Buy a Windows Authenticode cert
# (~$100-400/yr) and set those two env vars to flip signing on — no code change needed.
#
#   pwsh ./scripts/release.ps1 [-Artifact path\to\vishu.exe] [-Url https://host/latest.json]
#
# Publishes dist/latest.json {version, signed, sha256, url} — the feed `vishu update --check` reads
# (point VISHU_UPDATE_URL at the hosted copy of that file).
[CmdletBinding()]
param(
  [string]$Artifact,   # the packaged binary/installer to sign + hash (e.g. the Tauri .exe/.msi)
  [string]$Url = ""    # where the published latest.json will live, recorded into the manifest
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "== releasing Vishu $version" -ForegroundColor Cyan

# Build the workspace (the Tauri app packaging that produces -Artifact is the operator's step;
# this script's job is to sign + manifest whatever artifact they hand it).
pnpm -r build

$signed = $false
if ($Artifact) {
  if (-not (Test-Path $Artifact)) { throw "artifact not found: $Artifact" }
  if ($env:VISHU_SIGN_CERT -and $env:VISHU_SIGN_PASS) {
    $signtool = (Get-Command signtool -ErrorAction SilentlyContinue)?.Source
    if (-not $signtool) { throw "VISHU_SIGN_CERT is set but signtool is not on PATH — install the Windows SDK" }
    & $signtool sign /f $env:VISHU_SIGN_CERT /p $env:VISHU_SIGN_PASS /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $Artifact
    if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }
    $signed = $true
    Write-Host "  signed $Artifact" -ForegroundColor Green
  } else {
    Write-Host "  !! no VISHU_SIGN_CERT/VISHU_SIGN_PASS - UNSIGNED release (buy a cert to sign)" -ForegroundColor Yellow
  }
}

New-Item -ItemType Directory -Force dist | Out-Null
$sha = if ($Artifact) { (Get-FileHash $Artifact -Algorithm SHA256).Hash.ToLower() } else { $null }
[ordered]@{ version = $version; signed = $signed; sha256 = $sha; url = $Url } | ConvertTo-Json | Set-Content dist/latest.json -Encoding utf8
Write-Host "  wrote dist/latest.json (version $version, signed=$signed)" -ForegroundColor Green
