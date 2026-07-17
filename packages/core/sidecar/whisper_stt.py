#!/usr/bin/env python3
"""Vishu voice STT sidecar (Phase 12, flag `voice`). Reads ONE JSON request line on stdin
({"audio_path": "...", "model": "base"}) and writes ONE JSON line on stdout
({"text": "...", "engine": "..."} or {"error": "..."}).

Engine order (native/offline first, per §12b):
  1. whisper.cpp — set WHISPER_CPP_BIN (the whisper-cli/main binary) + WHISPER_CPP_MODEL (a ggml
     .bin). Pure native, no Python ML deps. Needs a 16 kHz mono WAV.
  2. openai-whisper — the Python fallback (pip install openai-whisper) when whisper.cpp isn't set.
Absent both → a clear error, never a crash, so the core is never blocked. ponytail: one-shot
request/response; a long-lived streaming sidecar is the named upgrade for live dictation."""
import os
import subprocess
import sys
import json


def _whisper_cpp(path):
    """Native whisper.cpp transcription. Returns text, or None when not configured."""
    binary = os.environ.get("WHISPER_CPP_BIN")
    model = os.environ.get("WHISPER_CPP_MODEL")
    if not binary or not model:
        return None
    # -nt: no timestamps, emit plain text to stdout. check=True → a real failure raises, not silence.
    r = subprocess.run([binary, "-m", model, "-f", path, "-nt"], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def _openai_whisper(path, model_name):
    import whisper  # openai-whisper
    model = whisper.load_model(model_name)
    return str(model.transcribe(path).get("text", "")).strip()


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
    path = req.get("audio_path")
    if not path:
        print(json.dumps({"error": "audio_path required"}))
        return
    try:
        text = _whisper_cpp(path)
        if text is not None:
            print(json.dumps({"text": text, "engine": "whisper.cpp"}))
            return
    except Exception as e:
        print(json.dumps({"error": f"whisper.cpp failed: {e}"}))
        return
    try:
        text = _openai_whisper(path, req.get("model", "base"))
        print(json.dumps({"text": text, "engine": "openai-whisper"}))
    except ImportError as e:
        print(json.dumps({"error": f"no STT engine: set WHISPER_CPP_BIN+WHISPER_CPP_MODEL, or pip install openai-whisper ({e})"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
