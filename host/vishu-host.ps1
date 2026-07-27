# Vishu PA always-on host — keeps `vishu jarvis` (the full PA runtime) running.
# Launched at logon by the scheduled task "VishuPA" (register-vishu-host.ps1).
# ponytail: naive restart loop w/ 5s backoff — fine for a single-user PA. If it
# ever hot-loops on a boot crash, add exponential backoff + a crash counter here.
$ErrorActionPreference = 'Continue'
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\ms-playwright'   # C: is full; Chromium lives here
$env:OLLAMA_MODELS            = 'D:\ipex-llm\models' # local qwen for the gate-free classify path
$root  = 'D:\Job Project\project vishu'              # cwd => loads its .env + jarvis.domains.json
$entry = Join-Path $root 'packages\core\dist\bin\vishu.js'
Set-Location $root
while ($true) {
  Write-Output "[vishu-host] starting jarvis $(Get-Date -Format o)"
  & node $entry jarvis   # blocks until the runtime exits/crashes; the F0 gate stays fail-closed while detached
  Write-Output "[vishu-host] jarvis exited ($LASTEXITCODE) — restarting in 5s"
  Start-Sleep -Seconds 5
}
