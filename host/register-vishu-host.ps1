# Install the Vishu PA always-on host as a per-user Startup shortcut that launches
# vishu-host.ps1 (the restart loop around `vishu jarvis`) hidden at every logon.
# Task Scheduler needs elevation on this machine ("Access is denied"); the Startup
# folder is the no-admin path (writes only to the current user's profile).
# Uninstall:  Remove-Item "$([Environment]::GetFolderPath('Startup'))\VishuPA.lnk"
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'VishuPA.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath       = 'pwsh.exe'
$sc.Arguments        = '-NoProfile -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'vishu-host.ps1') + '"'
$sc.WorkingDirectory = Split-Path $PSScriptRoot -Parent   # the vishu repo root (loads .env + jarvis.domains.json)
$sc.WindowStyle      = 7   # minimized launcher; pwsh -WindowStyle Hidden keeps the work invisible
$sc.Description       = 'Vishu PA always-on host'
$sc.Save()
Write-Output "installed Startup shortcut -> $lnk (runs at next logon)"
