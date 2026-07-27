#!/usr/bin/env python3
"""Vishu streaming STT sidecar (Phase 12b full-duplex). Long-lived, unlike the one-shot whisper_stt.py:
it loads the model ONCE and then loops, reading one JSON request line per turn and writing one JSON
line back — so live partials during dictation don't pay the model-load cost on every chunk (the win).

Protocol (stdio JSON, one object per line, one response per request):
  {"audio_path": "<growing wav so far>", "model": "base"}  -> {"partial": "<text>", "engine": "..."}
  {"final": true}                                           -> {"final": "<text>"} then exit
  bad input                                                 -> {"error": "..."}  (never a crash)

Engine order mirrors whisper_stt.py: whisper.cpp (WHISPER_CPP_BIN + WHISPER_CPP_MODEL) native first,
else openai-whisper. Absent both -> a clear error, so the core is never blocked.

ponytail: each chunk re-transcribes the whole audio-so-far (whisper is not an incremental decoder); the
model stays warm but per-chunk cost grows with utterance length — a real streaming decoder is the named
upgrade if long dictation lags."""
import json
import os
import subprocess
import sys

_model = None  # openai-whisper model, loaded once and kept warm across chunks


def _transcribe(path, model_name):
    """Transcribe the audio-so-far. Returns (text, engine). Raises on a real engine failure."""
    binary = os.environ.get("WHISPER_CPP_BIN")
    model = os.environ.get("WHISPER_CPP_MODEL")
    if binary and model:
        # -nt: no timestamps, plain text. check=True → a real failure raises, not silence.
        r = subprocess.run([binary, "-m", model, "-f", path, "-nt"], capture_output=True, text=True, check=True)
        return r.stdout.strip(), "whisper.cpp"
    global _model
    import whisper  # openai-whisper
    if _model is None:
        _model = whisper.load_model(model_name)  # the load we pay once, not per chunk
    return str(_model.transcribe(path).get("text", "")).strip(), "openai-whisper"


def main():
    last = ""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            print(json.dumps({"error": f"bad request json: {e}"}), flush=True)
            continue
        if req.get("final"):
            print(json.dumps({"final": last}), flush=True)
            return
        path = req.get("audio_path")
        if not path:
            print(json.dumps({"error": "audio_path required"}), flush=True)
            continue
        try:
            text, engine = _transcribe(path, req.get("model") or "base")
            last = text
            print(json.dumps({"partial": text, "engine": engine}), flush=True)
        except ImportError as e:
            print(json.dumps({"error": f"no STT engine: set WHISPER_CPP_BIN+WHISPER_CPP_MODEL, or pip install openai-whisper ({e})"}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
