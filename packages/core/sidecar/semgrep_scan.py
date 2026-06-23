#!/usr/bin/env python3
"""Vishu SAST sidecar (Phase 11 "real SAST depth"). Reads ONE JSON request line on stdin
({"path": "<dir>", "config": "auto"}) and writes ONE JSON line on stdout: {"findings": [...]} or
{"error": "..."}. Semgrep is an optional dep — absent it returns a clear error, never a crash, so the
app builder's deterministic scanner remains the hard gate and this only *adds* depth (authz/RLS/taint).
ponytail: one-shot scan via the semgrep CLI JSON output; a long-lived server is the named upgrade."""
import sys
import json
import subprocess


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
    path = req.get("path")
    if not path:
        print(json.dumps({"error": "path required"}))
        return
    config = req.get("config", "auto")
    try:
        proc = subprocess.run(
            ["semgrep", "scan", "--config", config, "--json", "--quiet", path],
            capture_output=True, text=True, timeout=req.get("timeout", 300),
        )
    except FileNotFoundError:
        print(json.dumps({"error": "semgrep not installed; pip install semgrep"}))
        return
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return
    try:
        data = json.loads(proc.stdout or "{}")
    except Exception:
        print(json.dumps({"error": f"semgrep produced no JSON (exit {proc.returncode}): {proc.stderr.strip()[:400]}"}))
        return
    findings = [
        {
            "rule": r.get("check_id"),
            "path": r.get("path"),
            "line": (r.get("start") or {}).get("line"),
            "severity": (r.get("extra") or {}).get("severity"),
            "message": (r.get("extra") or {}).get("message"),
        }
        for r in data.get("results", [])
    ]
    print(json.dumps({"findings": findings}))


if __name__ == "__main__":
    main()
