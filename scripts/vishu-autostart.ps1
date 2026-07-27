<#
.SYNOPSIS
  Register / unregister a Windows Scheduled Task that keeps Vishu (the PA runtime)
  always available: launches `vishu jarvis` at logon, hidden, and restarts it on crash.

.DESCRIPTION
  Reuses the existing `vishu jarvis` server (HTTP RPC + SSE /events + domain services,
  bound to 127.0.0.1:5712). No new daemon code — this is just the native Windows
  autostart wrapper. Run once with -Register; remove cleanly with -Unregister.

.EXAMPLE
  pwsh scripts\vishu-autostart.ps1 -Register     # install autostart
  pwsh scripts\vishu-autostart.ps1 -Status       # is it installed / running?
  pwsh scripts\vishu-autostart.ps1 -Unregister   # remove it

# ponytail: task action is node.exe directly so Task Scheduler tracks the process and
# restart-on-failure works. A brief console may flash at logon; upgrade path is a
# wscript/VBS hidden-launch shim if that ever matters.
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
  [Parameter(ParameterSetName = 'Register')]   [switch]$Register,
  [Parameter(ParameterSetName = 'Unregister')] [switch]$Unregister,
  [Parameter(ParameterSetName = 'Status')]     [switch]$Status,
  [string]$TaskName = 'VishuPA'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Entry    = Join-Path $RepoRoot 'packages\core\dist\bin\vishu.js'

function Get-NodePath {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { throw "node is not on PATH. Install Node.js or add it to PATH, then retry." }
  return $n.Source
}

if ($Register) {
  $node = Get-NodePath
  if (-not (Test-Path $Entry)) {
    throw "Build missing: $Entry`nRun the core build first (e.g. `pnpm --filter @vishu/core build`), then retry."
  }

  $action  = New-ScheduledTaskAction -Execute $node -Argument "`"$Entry`" jarvis" -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "Registered scheduled task '$TaskName' (ONLOGON -> vishu jarvis, hidden, restart-on-fail)."
  Write-Host "It starts at your next logon. To start it now:  Start-ScheduledTask -TaskName $TaskName"
  Write-Host "Then check reachability:  pwsh scripts\vishu-health.ps1"
  return
}

if ($Unregister) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host "Task '$TaskName' is not registered — nothing to remove."; return }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'. (The running server, if any, keeps going until you stop it.)"
  return
}

# Default: Status
$t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $t) {
  Write-Host "Autostart: NOT registered. Install it with:  pwsh scripts\vishu-autostart.ps1 -Register"
} else {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Autostart: REGISTERED  (state=$($t.State), lastRun=$($info.LastRunTime), lastResult=$($info.LastTaskResult))"
  Write-Host "  action : node `"$Entry`" jarvis   (cwd=$RepoRoot)"
}
