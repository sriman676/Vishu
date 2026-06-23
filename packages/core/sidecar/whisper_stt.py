#!/usr/bin/env python3
"""Vishu voice STT sidecar (Phase 12, flag `voice`). Reads ONE JSON request line on stdin
({"audio_path": "...", "model": "base"}) and writes ONE JSON line on stdout ({"text": "..."}
or {"error": "..."}). Whisper is an optional runtime dep — absent it returns a clear error,
never a crash, so the core is never blocked. ponytail: one-shot request/response; a long-lived
streaming sidecar is the named upgrade for live dictation."""
import sys
import json


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
        import whisper  # openai-whisper
    except Exception as e:
        print(json.dumps({"error": f"whisper not installed ({e}); pip install openai-whisper"}))
        return
    try:
        model = whisper.load_model(req.get("model", "base"))
        result = model.transcribe(path)
        print(json.dumps({"text": str(result.get("text", "")).strip()}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
