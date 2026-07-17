#!/usr/bin/env pwsh
# §12b one-time voice setup (Windows). Downloads the native whisper.cpp + Piper binaries and a model
# each into sidecar/voice-models/ (gitignored — never committed), then prints the env vars to set.
# Offline/native STT+TTS: no cloud key, no browser. Re-run to refresh. Requires PowerShell 7 + internet.
#
# Usage:  pwsh packages/core/sidecar/setup-voice.ps1
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "voice-models"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Fetch($url, $out) {
  if (Test-Path $out) { Write-Host "  have $(Split-Path $out -Leaf)"; return }
  Write-Host "  downloading $(Split-Path $out -Leaf) ..."
  Invoke-WebRequest -Uri $url -OutFile $out
}

# 1. whisper.cpp ggml model (base.en — small, English). Stable HuggingFace URL.
$whisperModel = Join-Path $dir "ggml-base.en.bin"
Fetch "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" $whisperModel

# 2. Piper voice (en_US amy, medium). Two files: the .onnx and its .json config.
$piperVoice = Join-Path $dir "en_US-amy-medium.onnx"
$base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium"
Fetch "$base/en_US-amy-medium.onnx" $piperVoice
Fetch "$base/en_US-amy-medium.onnx.json" "$piperVoice.json"

# 3. Native binaries from the latest GitHub release (Windows x64). Auto-pick the asset; on any failure
#    fall back to a clear manual pointer — the models above still work with a hand-installed binary.
function LatestWindowsAsset($repo, $match) {
  try {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "vishu" }
    ($rel.assets | Where-Object { $_.name -match $match } | Select-Object -First 1).browser_download_url
  } catch { $null }
}
function InstallZip($repo, $match, $subdir, $exe) {
  $target = Join-Path $dir $subdir
  $found = Get-ChildItem -Path $target -Recurse -Filter $exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { Write-Host "  have $exe"; return $found.FullName }
  $url = LatestWindowsAsset $repo $match
  if (-not $url) { Write-Warning "Could not resolve a Windows release for $repo — install $exe manually into $target"; return $null }
  $zip = Join-Path $dir "$subdir.zip"
  Fetch $url $zip
  Expand-Archive -Path $zip -DestinationPath $target -Force
  Remove-Item $zip -Force
  (Get-ChildItem -Path $target -Recurse -Filter $exe | Select-Object -First 1)?.FullName
}
$whisperBin = InstallZip "ggerganov/whisper.cpp" "win.*x64|x64.*win|windows" "whisper" "whisper-cli.exe"
if (-not $whisperBin) { $whisperBin = InstallZip "ggerganov/whisper.cpp" "win.*x64|x64.*win|windows" "whisper" "main.exe" }
$piperBin = InstallZip "rhasspy/piper" "windows.*amd64|windows.*x64|windows" "piper" "piper.exe"

Write-Host ""
Write-Host "Voice models + binaries under: $dir"
Write-Host "Set these env vars (add to D:\Job Project\.env or your shell) then run with VISHU_MODULES=voice:"
Write-Host "  WHISPER_CPP_MODEL = $whisperModel"
if ($whisperBin) { Write-Host "  WHISPER_CPP_BIN   = $whisperBin" } else { Write-Host "  WHISPER_CPP_BIN   = <path to whisper-cli.exe>" }
Write-Host "  PIPER_MODEL       = $piperVoice"
if ($piperBin) { Write-Host "  PIPER_BIN         = $piperBin" } else { Write-Host "  PIPER_BIN         = <path to piper.exe>" }
