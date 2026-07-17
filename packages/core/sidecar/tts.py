#!/usr/bin/env python3
"""Vishu voice TTS sidecar (PLAN Phase 1 Step 4, flag `voice`). Reads ONE JSON request line on stdin
and writes ONE JSON line on stdout, mirroring whisper_stt.py's contract.

Request:  {"text": "...", "voice_id": "...", "out_path": "...", "play": false}
Response: {"audio_path": "...", "engine": "elevenlabs|piper"}   or   {"error": "..."}

Engine order: ElevenLabs when ELEVENLABS_API_KEY is set (cloud, high quality), else local piper
(offline, no key). Both are optional — absent both, a clear error, never a crash, so the core is
never blocked. stdlib only (urllib for the HTTP call) so the sidecar has no pip deps of its own.

ponytail: one-shot synth-to-file. Per-sentence streaming + hold-one-ahead buffering (the Trillion
sub-1s latency target) layers on this same seam and is the named upgrade, not built here."""
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # ElevenLabs "Rachel" — override per request/mode


def _out_path(req, suffix):
    p = req.get("out_path")
    if p:
        return p
    fd, path = tempfile.mkstemp(prefix="vishu-tts-", suffix=suffix)
    os.close(fd)
    return path


def _elevenlabs(text, req):
    """Synthesize via ElevenLabs REST → mp3 file. Intentional, declared egress (voice output)."""
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        return None
    voice = req.get("voice_id") or os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
    body = json.dumps({"text": text, "model_id": os.environ.get("ELEVENLABS_MODEL", "eleven_turbo_v2_5")}).encode()
    r = urllib.request.Request(url, data=body, method="POST", headers={
        "xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg",
    })
    out = _out_path(req, ".mp3")
    with urllib.request.urlopen(r, timeout=60) as resp, open(out, "wb") as f:
        f.write(resp.read())
    return out


def _piper(text, req):
    """Local offline synth via the piper CLI → wav. Needs PIPER_MODEL (a .onnx voice) set."""
    model = os.environ.get("PIPER_MODEL")
    piper = os.environ.get("PIPER_BIN", "piper")
    if not model:
        raise RuntimeError("PIPER_MODEL not set (path to a piper .onnx voice)")
    out = _out_path(req, ".wav")
    subprocess.run([piper, "--model", model, "--output_file", out], input=text.encode(),
                   check=True, capture_output=True)
    return out


def _play(path):
    """Best-effort local playback (opt-in). Never fatal — a failed play must not fail the synth."""
    try:
        if sys.platform == "win32":
            os.startfile(path)  # default player; non-blocking
        elif sys.platform == "darwin":
            subprocess.Popen(["afplay", path])
        else:
            subprocess.Popen(["aplay", path])
    except Exception:
        pass


def main():
    line = sys.stdin.readline()
    if not line.strip():
        print(json.dumps({"error": "no request"}))
        return
    try:
        req = json.loads(line)
    except Exception as e:
        print(json.dumps({"error": f"bad request json: {e}"}))
        return
    text = (req.get("text") or "").strip()
    if not text:
        print(json.dumps({"error": "text required"}))
        return
    try:
        path = _elevenlabs(text, req)
        engine = "elevenlabs"
        if path is None:
            path = _piper(text, req)
            engine = "piper"
    except urllib.error.URLError as e:
        print(json.dumps({"error": f"elevenlabs request failed: {e}"}))
        return
    except FileNotFoundError:
        print(json.dumps({"error": "no TTS engine available (set ELEVENLABS_API_KEY, or install piper + set PIPER_MODEL)"}))
        return
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return
    if req.get("play"):
        _play(path)
    print(json.dumps({"audio_path": path, "engine": engine}))


if __name__ == "__main__":
    main()
