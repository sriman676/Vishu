#!/usr/bin/env py
"""Turnkey Composio OAuth for `vishu connect <app> --auth`.

Initiates the hosted OAuth handshake for one app, prints the click-through URL, and blocks until
the connection goes ACTIVE — so "connect X" needs no dashboard trip. Uses the pip `composio` SDK
(proven on Windows; the Composio CLI is not). Degrades loudly: a missing key or missing SDK prints
a one-line fix and exits non-zero, so `vishu connect` can fall back to the manual hint.

Usage:  py scripts/composio-connect.py <app>   (COMPOSIO_API_KEY in env; VISHU_USER optional)
"""
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: composio-connect.py <app>", file=sys.stderr)
        return 2
    app = sys.argv[1]
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("COMPOSIO_API_KEY is not set — export it, then retry.", file=sys.stderr)
        return 1
    try:
        from composio import Composio
    except ImportError:
        print("composio SDK not installed — run:  py -m pip install composio", file=sys.stderr)
        return 1

    composio = Composio(api_key=key)
    user = os.environ.get("VISHU_USER", "vishu")
    session = composio.create(user_id=user)
    req = session.authorize(app)
    print(f"\n  Authorize {app} here (opens in your browser):\n  {req.redirect_url}\n")
    print("  waiting for you to finish authorizing… (up to 3 min)")
    try:
        account = req.wait_for_connection(180000)
    except Exception as e:  # timeout or auth failure — surface it, don't hang the caller
        print(f"  not connected: {e}", file=sys.stderr)
        return 1
    print(f"  connected: {app} (account {account.id}). Its tools mount as composio__* on next 'vishu jarvis'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
