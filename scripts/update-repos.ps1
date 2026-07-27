#!/usr/bin/env pwsh
# Update the cloned capability repos (taste-skill, Agent-Reach, free-for-dev) to latest, and re-sync the
# installed design skill. Run manually, or wire to a Scheduled Task for the "update repos frequently" ask.
# ponytail: a git-pull loop + a skill re-copy + Agent-Reach's own health check; NO auto-scheduling here —
# registering a Scheduled Task is a standing system change, left for the operator (see the register hint).
#
# Register (operator, once):  schtasks /Create /SC DAILY /TN "vishu-update-repos" /TR "pwsh -File $PSCommandPath" /ST 09:00

$ErrorActionPreference = 'Stop'
$root  = 'D:\claude-tools\repos'
$repos = @('taste-skill', 'Agent-Reach', 'free-for-dev')

foreach ($r in $repos) {
  $path = Join-Path $root $r
  if (Test-Path $path) {
    Write-Host "== pulling $r =="
    try { git -C $path pull --ff-only } catch { Write-Warning "$r pull failed: $_" }
  } else {
    Write-Host "== $r missing at $path (skip) =="
  }
}

# Re-sync the installed design-taste-frontend skill from the freshly pulled clone.
$skillSrc = Join-Path $root 'taste-skill\skills\taste-skill'
$skillDst = Join-Path $env:USERPROFILE '.claude\skills\design-taste-frontend'
if (Test-Path $skillSrc) {
  New-Item -ItemType Directory -Force -Path $skillDst | Out-Null
  Copy-Item -Recurse -Force (Join-Path $skillSrc '*') $skillDst
  Write-Host "== re-synced design-taste-frontend skill =="
}

# Agent-Reach ships a health + update check meant for scheduled runs; use it when the CLI is installed.
if (Get-Command agent-reach -ErrorAction SilentlyContinue) {
  Write-Host "== agent-reach watch =="
  agent-reach watch
}
