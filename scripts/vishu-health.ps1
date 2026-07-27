<#
.SYNOPSIS
  Ping the Vishu PA runtime to confirm the gateway is reachable.

.DESCRIPTION
  GETs the unauthenticated /health liveness endpoint of `vishu jarvis`
  (default 127.0.0.1:5712). Exit 0 = reachable, exit 1 = not. Use after
  registering autostart, or from any other tool that wants to know the PA is up.

.EXAMPLE
  pwsh scripts\vishu-health.ps1
  pwsh scripts\vishu-health.ps1 -Port 5712 -TimeoutSec 5
#>
param(
  [int]$Port = $(if ($env:VISHU_PORT) { [int]$env:VISHU_PORT } else { 5712 }),
  [string]$VishuHost = $(if ($env:VISHU_CORE_HOST) { $env:VISHU_CORE_HOST } else { '127.0.0.1' }),
  [int]$TimeoutSec = 5
)

$url = "http://${VishuHost}:${Port}/health"
try {
  $r = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec $TimeoutSec
  if ($r.ok) {
    Write-Host "REACHABLE  $url  -> $($r.result.status)"
    exit 0
  }
  Write-Host "UNEXPECTED  $url  -> $($r | ConvertTo-Json -Compress)"
  exit 1
} catch {
  Write-Host "UNREACHABLE  $url  -> $($_.Exception.Message)"
  Write-Host "Start it with:  Start-ScheduledTask -TaskName VishuPA   (or)   node packages\core\dist\bin\vishu.js jarvis"
  exit 1
}
