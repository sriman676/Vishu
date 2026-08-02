# OpenWorker vs Vishu — capability & efficiency comparison (2026-08-03)

Source: `andrewyng/openworker` @ shallow clone, `D:\claude-tools\repos\openworker` (MIT, Python, 37.2k LOC backend, 11.9k★, active). Read-only compare — **no code copied**.

Both are the same *shape*: a local-first, BYO-model AI agent that delivers finished work, gates consequential actions behind approval, speaks MCP, and ships a Tauri desktop shell + voice sidecar. The question the user asked: **can Vishu run more efficiently than OpenWorker?** Grounded answer below.

## Architecture map (near 1:1)

| Concern | OpenWorker (`coworker/`) | Vishu (`packages/core/src/`) |
|---|---|---|
| Providers | `providers/` — openai/anthropic/gemini/bedrock/vertex/ollama, prefix-routed | `transport/providers/` — same set + more, **key auto-detect by prefix** |
| Agents | `agents/` chat·code·cowork·myhelper·subagent | `orchestration/` (Arbor tree, subagents in worktrees) + modes |
| Tools | `tools/` files·git·shell·search·plan·todo·ask·subagent | `tools/` same + code-graph retrieval, persistent terminal |
| MCP | `mcp/` client + oauth (**consumer only**) | `connectors/` McpClient **+ `mcp-serve` (bidirectional)** + DomainManager |
| Connectors | `connectors/` ~25 hardcoded (gmail/gcal/github/slack/hubspot/browser) + OAuth broker | Composio (**1000+ apps, one key**) + native MCP + `vishu connect <app>` |
| Memory | `memory/sqlite_store.py` | markdown vault (Obsidian-editable) + derived SQLite vector/FTS |
| Automation | `automation/scheduler.py` | `automation/` scheduler + always-on host |
| Voice | `stt/` Rust STT (input only) | STT (whisper.cpp) **+ TTS (Piper) + streaming/barge-in** |
| Vision | image parts → cloud vision model | same **+ verified LOCAL offline vision (moondream/IPEX)** |
| Distribution | **signed+notarized macOS, auto-update** | unsigned, run-from-source |

## Where Vishu is already MORE efficient (verified in source)

1. **The rate-limit wedge — decisive.** OpenWorker's `providers/router.py` builds **one client per provider from a single `api_key`** (`profile.get("api_key")`), cached; `providers/errors.py` treats 429 as "slow down". Its only retries (`_param_fix_retry`) fix unsupported params, **not** quota. → Under a 429 or a multi-agent burst, OpenWorker **stalls or errors on the one key**. Vishu pools *many* keys per provider with `failover` (rotate on quota/5xx) and `balance` (round-robin) modes, and folds a local model in as just another key in the ring. **This is a real, structural throughput advantage — OpenWorker has no equivalent.**
2. **Bidirectional MCP.** OpenWorker is an MCP *consumer*. Vishu also **re-exposes itself** (`vishu mcp-serve`) so it can be composed into other agents/clients. More reach, same code.
3. **Connector breadth per LOC.** OpenWorker hand-maintains ~25 connectors (real code + an OAuth-broker cloud service). Vishu funnels the long tail through Composio (1000+ apps, one mount) → broader coverage, far less connector code to carry, and zero per-connector spawn lag.
4. **Local capability depth.** Both do Ollama. Vishu adds GPU-offloaded IPEX local models (Arc), **proven offline vision** (moondream), and a **fuller voice stack** (STT+TTS+barge-in vs OpenWorker's STT-only).
5. **Reliability extras Vishu already ships:** model-reroute down a chain, learned auto-allow tier from the approval log, budget cap + cost meter, self-verification + git-worktree checkpoint/undo, KG memory hygiene. OpenWorker's README shows approval-gating + an unattended "ask inbox" but not these.

## Where OpenWorker is ahead (honest gaps → Vishu's to-do to stay ahead)

- **Turnkey connectors + OAuth brokering.** 25 first-party integrations that "just work" via a hosted OAuth handshake. Vishu leans on Composio (needs a key; its Windows CLI has been flaky per project history). *Gap: connect-without-a-key smoothness.*
- **Slack remote-trigger UX.** `@OpenWorker` in a channel opens a desktop session and replies in-thread — a clean remote entrypoint. Vishu's `reach` module has nothing this polished. *Gap: a first-class remote/chat trigger.*
- **Packaged distribution.** Signed/notarized macOS + auto-update. Vishu is run-from-source / unsigned. *Gap: a real installer story (partially addressed by this session's `install.ps1`).*

## Concrete moves to guarantee Vishu's edge (proposed, NOT yet done)

Cheapest-first, each independently shippable:

1. **Prove the wedge, publicly.** Add a tiny bench that fires N concurrent calls against a single throttled key: OpenWorker-style single-client vs Vishu `balance`/`failover`. Put the number in the README. *(Small; turns an architectural claim into a demonstrated one.)*
2. **Slack remote-trigger** for Vishu (mirror the `@mention → session → thread reply` loop) via the existing MCP/Composio Slack mount + `reach`. *(Medium.)*
3. **Keyless connector smoothing** — document/one-command the Composio OAuth path so "connect X" matches OpenWorker's turnkey feel. *(Small–medium.)*
4. **Absorb nothing by copy** — MIT allows it, but OpenWorker's value is turnkey connectors + distribution, both of which Vishu meets with Composio + `install.ps1`; lifting its provider/agent code would be a *downgrade* (no key-ring). Recommend **reference-only**.

## Verdict
On the axis that matters for an always-on worker — **throughput under rate limits** — Vishu is structurally ahead and OpenWorker has no answer. OpenWorker's genuine leads are **connector turnkey-ness, a Slack trigger, and signed distribution**; none require copying its code, and moves 1–3 close them. Recommendation: keep OpenWorker as a **reference clone only**, ship the throughput bench (move 1) to make Vishu's edge legible, and optionally build the Slack trigger (move 2).
