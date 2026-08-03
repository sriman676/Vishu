# Changelog

All notable changes to Vishu. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- **One-click Windows installer** (`install.ps1`) — Node check → pnpm → install → build → test gate, optional local Ollama start.
- **Remote-trigger** (`vishu.connectors_trigger`) — an inbound message runs the full agent (every mounted MCP, present and future) and replies on the same channel; fail-closed behind `VISHU_TRIGGER_ALLOW`.
- **Turnkey connect** (`vishu connect <app> --auth`) — launches Composio's hosted OAuth, prints the link, waits until connected.
- **Rate-limit throughput bench** — proves the key-ring: 40/40 concurrent calls completed under a burst that stalls a single client at 10/40.
- **Signed-release + auto-update machinery** — `scripts/release.ps1` (build + optional Authenticode signing when a cert is supplied) and `vishu update --check`.
- **Launch video** — a 20-second brag reel linked from the README.

### Changed
- README re-framed from "coding agent" to a local-first **personal-assistant AI** (coding and job-hunting are one capability).

The wedge stays the same: **an agent that never hits a rate limit** — pool every provider key plus your local model into one ring with `failover` / `balance`.
