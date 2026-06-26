# Vishu — Implementation Plan

The single source we build by. Dependency-ordered: each phase is buildable only after the ones
before it, ends in a **verifiable green check**, and nothing later starts until the current
phase is green. Reference contracts live in `docs/` (the blueprint).

> **Auto-invoke `/ponytail:ponytail` first, every coding session — no exceptions.**
> Lazy-senior-dev discipline: stdlib/native first, shortest working diff, no speculative
> abstractions, one runnable check per non-trivial unit. (See Standing rules for the full workflow.)

---

## Locked decisions
- **Core language:** TypeScript / Node 24+ is the spine (CLI, RPC, agent loop) — fastest to iterate,
  cross-platform, same as the frontend. **But not TS-only:** use the best language per job (e.g. Python
  for ML/embeddings, Rust/Go for perf-critical or native bits) at subsystem/sidecar/skill boundaries,
  talking to the core over RPC/stdio. Ask before adding cross-language IPC/build cost. (User override.)
- **Contracts kept from the blueprint:** `vishu.*` JSON-RPC names, `RpcOutcome<T>` envelope,
  `action_dir` vs `workspace_dir` security split, security tiers + command classification,
  unified tool registry, provider abstraction.
- **Branding:** Vishu from the start — `vishu` CLI, `vishu.*` RPC, `VISHU_*` env, `~/.vishu/...`
  workspace, a project logo. Must run on Windows; cross-platform.
- **Memory:** plaintext, Obsidian-editable markdown vault is the **source of truth**; SQLite
  (vectors+FTS) is a **derived, rebuildable** index. Secrets live in the OS keychain, never the vault.
- **Providers:** one interface; OpenAI-compatible adapter (covers OpenRouter, NVIDIA NIM, Google
  AI Studio, local) + native Anthropic + Ollama; router rotates provider+key on quota/limit errors.
- **Orchestration engine:** Arbor pattern (Coordinator/Executor + hypothesis tree + git-worktree
  isolation + dev/test validation), reimplemented in TS (check Arbor's license before reusing code).

## Positioning, metrics & launch (do these at the marked stages)
These aren't features — they decide whether anyone ever sees or keeps the project. Each is tied
to a stage so it actually happens.

- **Wedge / positioning — define BEFORE Phase 0, lead the README with it.** Pick the ONE painful
  thing Vishu is undeniably best at; everything else is supporting cast. Strongest candidates:
  the local-first plaintext Obsidian-vault memory, the Arbor-style *verified* secure app builder,
  or provider-rotation-that-never-hits-a-limit. Write it as: "Vishu is what you reach for when ___."
- **Differentiation vs OpenHuman — answer BEFORE Phase 0.** Vishu is close to a TS reimplementation
  of OpenHuman/Aetheria, which already exists, is further along, and is in Rust. Have a real reason
  someone picks Vishu (e.g. local-first + editable vault + verified app builder), or the wedge above
  *is* the answer. Don't ship a "clone in another language" with no reason to switch.
- **Success metrics / benchmarks — define a small suite by Phase 2, run in CI thereafter.** Defend
  every claim with numbers, not marketing: token reduction (Phase 5 — % vs baseline on fixed tasks),
  reliability (Phase 4 — task success rate with/without self-verification), security (Phase 11 —
  planted-vuln catch rate). If you can't measure it, don't claim it.
- **DX / onboarding — skeleton in Phase 0, polished before any public launch.** One-command install,
  a README that sells in 10 seconds, and a 30-second demo people can share. Half of whether anyone
  sees it lives here, not in the feature list.
- **Launch-readiness gate — after Phase 8 (the shippable core).** Phases 0–8 = a token-frugal,
  provider-agnostic, reliable agent that builds software: the sharp, demoable thing worth launching.
  Polish DX + demo, then launch (HN / Reddit / X / Product Hunt). Everything after Phase 8 layers on.
- **Sustainability — ongoing discipline.** Solo + broad scope = burnout/abandonment risk; abandoned
  repos bleed momentum. Ship one phase at a time, depth over breadth, resist adding the optional
  modules until the core is genuinely good.

## Standing rules (apply to every phase)
- **Auto-invoke ponytail (every coding session).** Invoke `/ponytail:ponytail` before writing any code,
  every session — lazy-senior-dev discipline is the default mode, not an opt-in.
- **Best language per job (not TS-only).** TS is the spine, but reach for the right language for the
  work (Python for ML/embeddings, Rust/Go for perf-critical or native) at subsystem/sidecar/skill
  boundaries, over RPC/stdio. (Locked-decision override — see above.)
- **Ask before proceeding on genuine forks.** If a decision is really the user's (ambiguous scope,
  a real trade-off, anything hard to reverse, or adding cross-language IPC/build cost), ask first
  instead of guessing. Sensible defaults are fine for conventional choices; surface the call either way.
- **Compare PLAN vs blueprint, take the best (every phase).** Before building any phase, read both
  this PLAN section *and* the matching original blueprint in `docs/NN-*.md`, then adopt the best
  approach — PLAN's, the original's, or a combination of both. State the call (which ideas from each,
  and why) before writing code, and record it as a "Format decision" note under the phase. The
  PLAN's locked decisions win on direct conflicts; the original docs are a mature idea source, not
  automatically right per phase. (Established with the user; applies in every session — no need to
  restate it.)
- **Tests/CI:** every phase ships with tests (unit + integration; mock provider/backend). Lint,
  format, typecheck, coverage gate.
- **Edge-case discipline:** every external boundary (network/disk/DB/subprocess/model) gets a
  transient-vs-fatal classifier + retry on transient + a classified user-facing error on fatal —
  never an unhandled crash.
- **Security:** every executable tool runs through `SecurityPolicy` + the path boundary;
  `workspace_dir` is never agent-writable; secrets never enter the model context.
- **Logging:** verbose, grep-friendly (`[domain]`), never secrets/PII.

## Target layout (pnpm monorepo)
```
vishu/
├── package.json            # pnpm workspace root
├── assets/logo.svg
├── packages/core/src/
│   ├── transport/  config/  security/  providers/  agent/  tools/
│   ├── reliability/  tokenjuice/  skills/  memory/  orchestration/
│   ├── automation/  connectors/  appbuilder/  events/
│   └── bin/vishu.ts        # CLI: serve | chat | ...
└── packages/frontend/      # Phase 14
```

---

## Build sequence

**Status (2026-06-23):** Phases **0–14 COMPLETE and green** (81 core tests passing; frontend builds clean).
Deferred seams cleared this pass: MCP sampling (10), generic webhook connector (10), Semgrep SAST sidecar
(11), mobile PWA (12), Tauri desktop shell (14 — **compiles** on Windows; `pnpm tauri:dev` to run).
Webhook connector + MCP sampler are now wired into `serve` (`VISHU_WEBHOOKS`, sampling→Router). Remaining
seams: vendor channel clients (need creds), node-pty TTY (needs Python/node-gyp). **Phase 12 done** —
feature-flag module host + modules: artifacts, pairing, self-update, **wallet/web3** (EVM address/message/
tx-sign + broadcast, **Solana** ed25519 address+sign, **BTC** segwit address + hash-sign), **imagegen**
(OpenAI-compatible images), **voice** (whisper STT via a Python sidecar over stdio), **desktop** (cross-
platform screen capture). All off by default behind `VISHU_MODULES`; a throwing module can't crash the
core. Deps: `viem` + tiny `@noble`/`@scure` crypto. **Phase 13 done** — `personalization/twin.ts`:
frequency-based digital twin suggests a saved Workflow once a task repeats past a threshold; accept saves
it via the Phase 9 `WorkflowStore`. **Phase 14 done** (web app) — `packages/frontend` React+Vite UI over the `vishu.*` RPC + SSE contract,
via a dev proxy (no CORS change to core). Remaining: the optional native Tauri/CEF shell (Rust build
cost — deferred by the locked decision). **All 15 phases (0–14) are green; only the native desktop
wrapper is a named seam.** — including all
once-deferred items: persistent terminal + sandbox (3), embeddings + confidence decay (7), branch
harvest + multi-model council (8), CPU sensing + notification sink (9), MCP client + inbound triage +
outbound replies + realtime SSE/tool:sync + MCP resources/prompts/reconnect (10), plus the Memory Tree
rollup (7), plus the **flagship secure app builder** (11: `vishu build` — spec interview → verify →
chunked Arbor build → deterministic security scan + bounded remediation → maintainability gate). Still
deferred (seams in place): node-pty true TTY (3, blocked: node-gyp needs Python, absent here), **vendor**
channel API clients (10 — a generic `WebhookConnector` now ships + is tested; Slack/Gmail/etc. still need
creds). **Cleared this pass:** MCP sampling (10, server→LLM via injected sampler), generic webhook connector
(10), real SAST depth (11 — Semgrep Python sidecar, optional/advisory), mobile companion (12 → installable
**PWA**: manifest + service worker + Web Share target + voice capture), Tauri desktop shell (14, scaffolded —
run `cargo tauri dev`). LLM OWASP review stays advisory by design (gating on a non-deterministic verdict is
unsafe; the deterministic scanner + optional Semgrep are the gates).
**All phases 0–14 green.** Only remaining build: the optional native Tauri/CEF desktop wrapper (named seam).

### Phase 0 — Workspace & toolchain
pnpm workspace; `packages/core` (TS strict); `vishu` CLI stub; config load (file + `VISHU_*` env);
resolve `action_dir` (`~/Vishu/projects`) + `workspace_dir` (`~/.vishu/users/<id>/workspace`);
logo asset.
- ✅ `pnpm install` + `vishu --version` run on Windows; config + paths resolve.

### Phase 1 — Transport
JSON-RPC server on `127.0.0.1:<port>`; per-launch bearer token + `core.token` file; `RpcOutcome<T>`
envelope; `GET /health`; in-process event bus (pub/sub); CLI dispatch.
- ✅ `vishu serve` boots; `vishu.health_snapshot` round-trips one RPC.

### Phase 2 — Providers + failover
`Provider` interface (chat + streaming); adapters: OpenAI-compatible, Anthropic, Ollama; router
rotates provider+key on 429/quota/5xx/timeout.
- ✅ `vishu chat "hi"` completes; killing the first key auto-fails-over to the next.

### Phase 3 — Tools, security, tool loop, live terminal  ← feels like Claude Code / VS Code
Tool registry; builtins `read_file/write_file/list_dir/run_shell/web_fetch/web_search`; **live
terminal** (persistent PTY via node-pty); **codegraph** (code index so the agent retrieves
relevant files instead of dumping the repo). `SecurityPolicy`: tiers (`readonly/supervised/full`),
`classify_command`, path jail, **prompt-injection guard** (allow/review/block before any run),
**sandbox backends** (Docker / OS jail / noop). Tool loop: provider → tool calls → execute (gated)
→ feed back → repeat.
- ✅ "build a small app here" → writes under `action_dir`, runs it in the terminal, reports; a
  write outside `action_dir` is blocked.

> **Phase 3 deferred — DONE (completed this pass):**
> - **Persistent terminal.** ✅ `tools/terminal.ts` is now a long-lived shell per Terminal (sentinel-framed
>   exec); cwd + env persist across commands. Native-dep-free; `unref` + `close()` prevent process leaks.
>   Still deferred: a true node-pty TTY (ANSI color / curses) — the seam is named in the file.
> - **Sandbox backends.** ✅ `tools/sandbox.ts` — pluggable `Sandbox` (noop + docker); `Terminal` accepts one.
>   OS-jail backends (firejail/sandbox-exec/AppContainer) remain the named upgrade path.

### Phase 4 — Reliability & oversight
**Self-verification loop** (run tests/linters/validators, read failure, correct, re-run within a
bounded budget; validate intermediate outputs, not just final); **checkpoints + undo** via git
worktrees; **fault isolation**; **risk-scoped approvals** (only interrupt for risky/irreversible/
credential/$$ actions; auto-allow reads + safe writes; **remember decisions**; preview/dry-run) +
autonomy levels (`ask_every_time` / `ask_once` / `automatic`) + plan-summary before acting;
**run log / audit trail**; **cost meter + budget cap**.
- ✅ A planted bug is caught by self-check and auto-corrected; a risky edit is undoable; the run
  log shows what happened; hitting the budget cap halts cleanly.

### Phase 5 — Agent RPC surface + TokenJuice
Expose the agent over `vishu.*` (`agent_start_turn`, `agent_stream`, session/transcript methods).
**TokenJuice**: HTML→Markdown, URL shortening, dedup, tool-result summarization, transcript
compaction, **active context curation** (evict stale turns, retrieve over dump — counter context rot).
- ✅ A frontend-shaped client drives a full turn over RPC; large/HTML tool outputs shrink markedly.

### Phase 6 — Skills (shared library) + token-frugal retrieval
Adopt **`SKILL.md`** as-is; incremental index rebuilt on every add; **3-tier progressive
disclosure** (cluster names in prompt → `skill_search` returns matched one-liners → full skill
loads only on invocation); bash-skill shim (Git Bash on Windows); **Python runtime** for python skills.
- ✅ Add a SKILL.md → indexed; a turn pulls only matched descriptors; a bash skill runs on Windows.

### Phase 7 — Memory: Obsidian vault + recall
Plaintext markdown vault = source of truth (entities/projects/tasks/people as notes with
frontmatter + `[[wikilinks]]` = knowledge graph; Memory Tree = rollup notes). Vault lives at
`~/Vishu/vault` (visible, openable in Obsidian); the derived index stays hidden under `~/.vishu`.
SQLite (`node:sqlite`) derived index (FTS5 + lexical now). Hybrid recall + **smart-walk over
links** (gather by traversal, not dumping). **Staleness/contradiction handling**: timestamp facts,
detect contradictions on write, supersede (keep history), recall prefers newest. Atomic writes +
event log + circuit breaker. Format decision: build this plaintext-vault design, **not** the
encrypted multi-domain design in `docs/07-memory-system.md` (that is historical Aetheria reference
only — encryption-at-rest is incompatible with an Obsidian-editable vault).
- ✅ Write a fact one session, recall it next; edit a note in Obsidian → agent sees it on re-index;
  delete the SQLite index → it rebuilds from markdown with no content loss.

> **Phase 7 deferred — DONE (completed this pass):**
> - **Real embedding vectors.** ✅ `embed()` added to the `Provider` interface (mock + OpenAI-compatible),
>   `Router.embed`/`canEmbed`; `MemoryIndex` stores float32-blob vectors and `MemoryStore.recall` blends
>   cosine into FTS + lexical. Optional — absent embedder = exact prior FTS behaviour (no regression).
> - **Confidence decay.** ✅ Age-based exponential half-life (30d) multiplies recall scores so newer facts
>   win near-ties (`memory/store.ts`).

### Phase 8 — Orchestration (Arbor engine) + subagents
Coordinator/Executor; **hypothesis tree** (branch per idea, prune on fail, harvest on success,
backpropagate learnings); subagents run in **isolated git worktrees** with dev/test validation;
archetypes (planner/researcher/coder/critic); **subagents inherit the parent SecurityPolicy + tool
policy — can only narrow, never widen.**
- ✅ An orchestrated multi-step request fans out to subagents, prunes a failed branch, and returns one result.

> **Format decision (PLAN vs `docs/06-agent-orchestration.md`):** built PLAN's Arbor hypothesis
> tree + git-worktree isolation; combined in the original's subagent-as-tool integration (reuse the
> tool loop as Executor, same tool-result envelope), per-archetype tool policy, and the
> NoParentContext contract. Kept PLAN's 4 archetypes (not the original's ~27).
>
> **Phase 8 deferred — branch harvest DONE; council intentionally skipped:**
> - **Branch harvest/merge.** ✅ `runSubagent({ harvest })` commits the winning worktree and `git merge
>   --no-ff` merges its branch back into the action repo; Coordinator harvests by default and reports
>   `merged`. Best-effort: a conflict aborts the merge and is logged (single-winner rarely conflicts).
> - **Multi-model council** — ✅ DONE. `orchestration/council.ts`: ask N models the same prompt, a judge
>   model picks the best (`council(members, prompt, { judge })`). Available as an optional deliberation
>   strategy. ponytail: judge-pick, not weighted voting/debate rounds — add those if one pass underdecides.
> - **Parallel execution / multitasking** — ✅ DONE. `util/parallel.ts` `parallelMap(items, fn, limit)` is
>   the bounded-concurrency primitive for I/O-bound fan-out (no deps, no worker threads — the work waits on
>   I/O). Council already races via `Promise.all`. `Coordinator.run(goal, { parallel: true, concurrency })`
>   now opt-in **races all hypothesis branches concurrently** (first PASS by order wins); the default stays
>   sequential (token-frugal early-exit + learning backprop). ponytail ceiling: parallel mode does NOT
>   auto-merge the winner (concurrent git merges into one repo race) and drops cross-branch learning —
>   auto-merging the parallel winner afterward is the named upgrade; use sequential when you need the merge.

### Phase 9 — Proactive automation
`cron` 5s tick + **triggers** (on inbound message / file change / schedule) + saved **workflows**
(repeatable automations) + background monitoring that **notifies you when something needs
attention**; scheduler throttle (battery/CPU). Gated by autonomy levels.
- ✅ A trigger fires on a scheduled task and runs a saved workflow unattended.

> **Format decision (PLAN vs blueprint):** built PLAN's cron/triggers/workflows; combined in the
> blueprint's 5s tick, `cron`/`webhook` event domains (triggers subscribe to the Phase 1 `EventBus`),
> and the `scheduler_gate` throttle ("background/cron pass through; interactive is parked"). Triggers
> support schedule (cron tick) / event (EventBus) / file (`fs.watch`). Reused Phase 4 autonomy.
>
> **Phase 9 deferred — DONE (completed this pass):**
> - **Battery/CPU sensing.** ✅ `automation/sensor.ts` — `startResourceGuard` samples CPU busy fraction
>   (`os.cpus()` delta) and flips the `SchedulerGate` (pause above 85%). Battery has no portable Node API:
>   the sampler is injectable, so a battery-aware sampler drops in without other changes.
> - **Notification delivery.** ✅ `automation/notify.ts` — `attachNotificationSink` delivers
>   `system/notification` events (default stderr sink, wired in `serve`). Real OS toast still swaps in at
>   the same seam in Phase 14.

### Phase 10 — Connectors + inbound triage
MCP client (external tools into the registry); channel connectors (WhatsApp, Gmail/email, Slack,
Telegram, Notion, …); inbound normalized → AI **triage** (summary + tier: skip/info/urgent/
needs_action) → notifications + tasks in the vault; outbound replies; realtime socket + `tool:sync`.
- ✅ An external MCP tool is callable; an inbound message gets a summary + urgency tier; an urgent one notifies.

> **Format decision (PLAN vs `docs/09-channels-integrations-mcp.md`):** built PLAN's MCP client
> (`connectors/mcp.ts`: stdio JSON-RPC `initialize`/`tools/list`/`tools/call`), inbound triage
> (`connectors/triage.ts`: summary + tier → vault task + `system/notification`, reusing the Phase 9 sink),
> outbound `Connector` seam + one reference `LocalConnector`, and `vishu.connectors_inbound` RPC. Adopted
> from the blueprint: the canonical inbound envelope, namespaced tool names (`serverId__tool`), and
> `tool:sync` broadcast on every tool-set change. Diverged: MCP over **stdio JSON-RPC** (real MCP
> transport + cross-platform locked decision, not the blueprint's Socket.IO); **skipped Composio**
> (paid SaaS layer) and **CEF account-scanners** (desktop, Phase 14) — one connector seam over five
> half-built API clients (sustainability rule).
>
> **Phase 10 completion update:**
> - **Outbound replies** — ✅ DONE. `vishu.connectors_send {channel,to,text}` dispatches through a
>   registered `Connector`; `serve` registers the `LocalConnector` (`local` channel).
> - **Realtime socket + tool:sync** — ✅ DONE. SSE `GET /events?token=` streams every bus event
>   (tool:sync, notifications) to authenticated clients — dep-free over the existing http server
>   (`flushHeaders` + `closeAllConnections` so it neither deadlocks nor blocks shutdown).
>
> **Phase 10 completion update (2):**
> - **MCP breadth** — ✅ DONE. `connectors/mcp.ts` now covers `resources/list`+`read`, `prompts/list`+`get`,
>   and auto-reconnect (500ms backoff, single respawn per close) on top of tools. Tested against a stub
>   stdio server (round-trip + respawn-after-crash). ponytail: sampling still skipped (see below).
>
> **Phase 10 still deferred (do later — seams exist):**
> - **Real channel clients.** Only `LocalConnector` ships; email/Slack/Telegram/etc. implement the same
>   `Connector` interface with their API client (+ creds) when needed — depth over breadth (kept as the
>   seam by explicit user decision this pass: no creds/live account to test against yet).
> - **MCP sampling.** Server-initiated `sampling/createMessage` (server calls back into our LLM) is the one
>   MCP method still unhandled — wire it through the provider Router at the `onData` seam when a server needs it.

### Phase 11 — Flagship: guided secure app builder
1. **Spec interview** — interconnected clarifying questions until requirements are complete; build
   + **persist** a structured spec (pages, data model, flows, constraints).
2. **User verifies** the spec before any code.
3. **Content-rich build prompt** from the verified spec (no filler/guessing).
4. **Chunked multi-agent build** on the Arbor engine — supervisor decomposes, coder subagents build
   each chunk, **verify each against the spec** (grounded, not hallucinated), then integrate.
5. **Security hardening** — OWASP Top-10 + known-CVE pentest during each chunk and after
   integration; block on injection, missing authz/RLS, hardcoded secrets, missing input validation.
6. **Scalability/maintainability gate** — modularity, no duplication, edge-case + integration
   coverage (beat the 80/20 wall) before "done".
- ✅ "build me an app" → spec interview → user approves → secure, modular, tested codebase + clean
  pentest report; a planted SQL-injection/hardcoded-secret is caught and fixed before done.

> **Format decision (PLAN vs blueprint):** no blueprint doc covers the app builder — this is a
> PLAN-original flagship — so built PLAN's design directly. Reused existing engine: `runSubagent`
> (worktree isolation + validate + harvest/merge) for chunk builds, `SecurityPolicy` + action-dir jail,
> the Phase 7 vault for spec persistence. ponytail: chunk subagents build sequentially and merge back,
> rather than the Coordinator's compete-and-prune (chunks are complementary, not competing hypotheses).
>
> **Phase 11 — DONE (all six PLAN steps).** `appbuilder/`:
> - **`spec.ts`** — stepwise `interviewStep` (model returns `Q:` lines or a `SPEC:` JSON); CLI drives the
>   loop with the real user; approved spec persists to the vault (`persistSpec`, subject-keyed so re-runs
>   supersede). User verifies the rendered spec before any code (step 2).
> - **`build.ts`** — `buildApp`: decompose spec → chunks → coder subagent per chunk (isolated worktree).
>   Each chunk is validated by `chunkValidator` = **per-chunk security scan (block on vuln) + grounded
>   `specVerify` (PASS/FAIL on the code actually produced, anti-hallucination)** before it merges (steps
>   4 + 5 "during each chunk"). Then `harden` scans the integrated repo and runs **bounded** remediation
>   subagents until no blocking finding remains (step 5 "after integration" — catch-and-fix before done),
>   `maintainabilityGate` runs (step 6), and `llmReview` adds an advisory OWASP-breadth note.
> - **`security.ts`** — deterministic, dependency-free scanner over `readCode`. `block`-severity rules
>   (hardcoded secret, AWS key, SQL-injection-by-concat) reliably catch the planted vulns the criterion
>   names and spare parameterized queries; `warn` rules (eval, weak crypto). `llmReview` = advisory breadth.
> - **`gate.ts`** — maintainability gate: oversized files, copy-paste duplication, missing tests.
> - **CLI** `vishu build <what>` wires interview → verify → build → security/gate/review report (chosen
>   surface: CLI only; no `vishu.appbuild_*` RPC until the Phase 14 frontend needs it).
>
> **Phase 11 ponytail ceilings (by design, not unfinished):** `llmReview` is advisory not a hard gate —
> the deterministic scanner is the block gate, since gating on a non-deterministic LLM verdict is unsafe;
> promote it once a provider makes it reliable. `specVerify`/`chunkValidator` defaults can be overridden
> per build. Real SAST depth (authz/RLS, input-validation breadth) is the named upgrade: a Semgrep sidecar
> over stdio (polyglot boundary — ask before adding). Channel/MCP-breadth seams unchanged.

### Phase 12 — Optional modules (feature-flagged; never block the core)
Voice & meetings (STT/TTS, dictation, meeting agent); Desktop/OS integration (screen awareness,
overlay assistant, desktop control); Wallet/web3 (BTC/EVM/Solana signing); Mobile companion
(native app + share-sheet/voice capture); smaller: artifacts, image gen, self-update, device pairing.
- ✅ Each enabled module works behind its flag with the core unaffected when off.

> **Format decision:** PLAN-original framing (no single blueprint doc); the *mechanism* (off-by-default,
> never-block-the-core) is the real Phase-12 deliverable, so it was built first — the specific heavy
> modules are deferred behind it pending the user's pick (each adds external-dep/IPC cost the locked
> decision says to ask about).
>
> **Phase 12 backbone — DONE.** `modules/`:
> - **`registry.ts`** — `VishuModule { name, setup(ctx) }`; `enabledModules()` reads `VISHU_MODULES`
>   (comma-separated, unset = none); `loadModules` sets up only enabled modules and **skips a throwing
>   module** (logged) so an optional module can never crash the core. A module only *adds* tools/RPC.
> - **`artifacts.ts`** — dep-free reference module (`artifact_save`/`artifact_list` under the workspace,
>   `basename` path-jailed) proving the seam.
> - **`pairing.ts`** — dep-free device pairing: one-time 5-min `pair_request`/`pair_verify` codes for a
>   future mobile/desktop companion. **`selfupdate.ts`** — dep-free `self_update_check` + `cmpVersion`.
> - **`all.ts`** — `MODULES` aggregator (heavy modules append here once their deps are approved).
> - **`serve`** loads enabled modules after the core is built; core runs identically when none are on.
> - Tests: off-by-default leaves the registry empty; each enabled module wires tools + works end-to-end;
>   a failing module is skipped without taking down the core.
>
> **Phase 12 heavy modules — DONE (all built this pass, each off-by-default behind its flag):**
> - **`wallet` (web3)** — EVM address / EIP-191 message sign / offline EIP-1559 tx sign (`wallet_sign_tx`) /
>   raw broadcast (`wallet_send_tx` via `VISHU_WALLET_RPC_URL`); **Solana** ed25519 address + message sign;
>   **BTC** native-segwit (P2WPKH) address + secp256k1 hash sign. Encrypted-at-rest keystore (scrypt →
>   AES-256-GCM); key loaded-then-discarded, never in model context. Deps: `viem` + `@noble`/`@scure`.
>   ponytail ceilings: nonce/gas auto-fill (needs a network RPC client), BTC PSBT/UTXO + Solana tx build
>   (need network) — the offline signing primitives are shipped; the network-tx layer is the named upgrade.
> - **`imagegen`** — one call to an OpenAI-compatible images endpoint; PNG saved path-jailed under the
>   workspace, key never echoed. Provider is env config (base URL + model).
> - **`voice`** — STT via an optional Python+whisper sidecar over **stdio JSON** (`callSidecar` = the
>   cross-language IPC seam, locked-decision compliant). Whisper/Python absent → clear error, never a crash.
>   ponytail: STT one-shot; TTS + live meeting agent ride the same seam later.
> - **`desktop`** — screen awareness: cross-platform `screen_capture` (Windows PowerShell/.NET, macOS
>   `screencapture`, Linux `gnome-screenshot`), dep-free, argv-injectable. Keyboard/mouse control + overlay
>   are native and land with the Phase 14 desktop shell (named seam).
>
> Still deferred by choice: mobile companion (its own native app project). Each heavy module ships with a
> stub-test that exercises its wiring without the external dep present (no whisper/display/RPC node needed).

### Phase 13 — Personalization / digital twin (aspirational; built small-first)
Learn from usage patterns → suggest/auto-create task-specific agents; a "digital twin" profile for
repeated tasks; periodic auto-fetch context building. No accuracy claims — emergent, incremental.
- ✅ A repeated task gets a suggested saved workflow/agent the user can accept.

> **Phase 13 — DONE.** `personalization/twin.ts`: `DigitalTwin` counts repeated task signatures
> (case/whitespace-folded), and at a threshold `suggestions()` surfaces the first-seen sample; `accept()`
> saves it as a single-step `Workflow` via the Phase 9 `WorkflowStore` and stops re-suggesting it. Atomic
> JSON store, dep-free, no ML. ponytail ceilings: frequency count (not embedding clusters); auto-recording
> is a one-line `twin.record(prompt)` hook in the agent loop (named integration point); a richer twin
> "profile" + periodic auto-fetch are the named upgrades.

### Phase 14 — Frontend + desktop shell
React app talking to the core **only** via `vishu.*` RPC; thin Tauri/CEF host (spawns core, relays
RPC); branding + logo.
- ✅ `pnpm dev:app` boots; UI sends a turn end-to-end via the same contract as the CLI.

> **Phase 14 — web app DONE; native shell deferred (Rust build cost).** `packages/frontend/` (Vite +
> React 18, builds clean): `src/api.ts` speaks the exact `vishu.*` JSON-RPC contract (`agent_start_turn`,
> RpcOutcome envelope, bearer token) + the SSE `/events` bus; `src/App.tsx` is a chat UI (session-threaded
> turns, live event feed, token paste). Browser→core is cross-origin, so a **Vite dev proxy** (`/rpc`,
> `/events` → `:5712`) keeps the app same-origin with **no CORS change to the core's security surface**.
> Run: start `vishu serve`, then `pnpm dev:app` and paste the printed `core.token`.
> ponytail: the **thin Tauri/CEF host** (spawns core, relays RPC) is the one remaining piece — it pulls in
> the Rust toolchain + a native build (the locked-decision "ask before build cost" trigger), and the web
> app already satisfies the green-check (same contract as the CLI). Named seam: wrap this Vite app in Tauri
> when a packaged desktop binary is wanted; it also absorbs the `desktop` module's keyboard/mouse/overlay.
>
> **Phase 14 — native harness DONE (Rust, compiles on Windows; `cargo 1.95`).** `packages/frontend/src-tauri/`
> is now a real **harness layer between the user and the AI**, not a fire-and-forget webview:
> - **Problems the old shell had (now solved):** (1) it spawned `vishu serve` and forgot it — no
>   supervision; a core crash left the UI permanently dead. (2) The user had to **manually paste**
>   `core.token` into the UI. (3) No process ownership — a closed window could orphan the core.
> - **Design (`src/main.rs`, std::process + tauri only — dropped the `tauri-plugin-shell` dep + its
>   `shell:*` capability):** a supervisor thread spawns the core, streams its stdout, parses the
>   `[serve] … on http://…` (base URL) and `[serve] token: <path>` lines to build a `Session {base,
>   token, ready}`, **restarts on crash** (capped 1→30s backoff), and **kills the core on
>   `ExitRequested`** (no orphan). The webview calls the `harness_session` Tauri command and
>   auto-connects — **no token paste** (`App.tsx` polls it when `window.__TAURI__` exists; the browser/PWA
>   paste box is untouched). All memory/skills/prompts/loops stay in the TS core; the harness only owns
>   lifecycle + input routing and drives the core over the existing `vishu.*` RPC.
> - **`VISHU_BIN`/`VISHU_ARGS`** override the launcher/args (dev: `node dist/bin/vishu.js serve`).
> - **ponytail ceiling (named upgrade):** dev-shell path uses `tauri dev` where the Vite proxy handles
>   `/rpc`+`/events`, so no CORS work was needed. The **packaged binary's** webview→core call is
>   cross-origin; solve it then with either core CORS or a harness-side HTTP/SSE proxy (the harness is
>   already the middle layer). `bundle.active` stays `false` until that's wired. Native keyboard/mouse/
>   overlay (the `desktop` module) also lands here next.

---

## Frontier problems (industry-unsolved — addressed best-effort, not claimed solved)
Memory staleness/contradiction (Phase 7), long-horizon/multi-agent eval (eval harness in CI +
Phase 8 dev/test discipline), guardrail propagation (Phase 8 inherit-and-narrow), deterministic
replay (best-effort via run log), cross-session identity / unbounded memory growth / async
multi-agent coordination (documented as known-open; bounded by vault compaction + synchronous-first).

## Honest scope note
Taken whole this is large. The viral, demoable, star-worthy core is **Phases 0–8** — a
token-frugal, provider-agnostic, reliable agent that builds software. Ship that first; everything
else layers on once it's green.

## Requested backlog — ✅ ALL DONE
User-requested features, all now built (each sits on a frontier problem, so the design rule held:
**best-effort with a human gate**, never a claimed-solved autonomous loop).
- **Multi-AI role registry.** ✅ DONE. `orchestration/roles.ts`: `RoleRegistry` maps a role
  (builder / summariser / messenger / …) → a `Router`; `for(role)` dispatches to that role's AI, falling
  back to a default when unassigned. Pure-TS, dep-free. ponytail: a Map + fallback over the existing
  Router — building one named Router per connected AI from config is the named upgrade (the core builds a
  single Router today). (Frontier: async multi-agent coordination.)
- **Backend error auto-fix loop.** ✅ DONE. `automation/autofix.ts`: `autoFixPass` runs a validator
  (build/tests/lint) and, **only at `automatic` autonomy**, dispatches a **bounded** `selfVerify` fix
  loop (Phase 4); otherwise it **parks the failure for approval** (`onParked`). The deterministic
  validator exit code is the gate, never an LLM verdict. The poke source (a Phase 9 file/cron trigger or
  a manual call) is injected. (Frontier: long-horizon autonomous reliability — bounded budget +
  deterministic check as the gate.)
- **Self-evolving project loop.** ✅ DONE. `personalization/evolve.ts`: `ProjectEvolver` +
  `analyzeProject` deterministically scan a project (oversized files, TODO/FIXME markers, no-tests) and
  record **proposals** with stable sigs (re-scans never duplicate); `runEvolutionPass` notifies via a
  `system/notification` event when new ones appear. Strict **human gate** — `accept`/`dismiss` only;
  nothing is auto-applied, accept optionally saves the suggestion as a runnable Workflow, and the atomic
  JSON store is the audit trail. ponytail: heuristic analyzer (no AST/LLM); codegraph/LLM proposals are
  the named upgrade on the same propose/accept seam. Periodic wiring (cron/interval → `runEvolutionPass`)
  is the named integration seam.
- **Backup API keys (labelled).** ✅ DONE. The Phase 2 router rotates provider+key on quota/limit;
  config now carries an explicit label per key (file config: `apiKeys: [{key,label}|"key"]`; env keys
  default to `primary`/`backup1`/…), surfaced in the provider name so router failover logs name the
  dropped key. Array order = failover order. (`config/config.ts`, `providers/factory.ts`.)

## Shipped — Phase 15 (capability + autonomy build-out)
Done this session — each its own commit, full core suite green (115/115), no push:
- **Token report** — real per-call usage captured at the Router chokepoint (`usage/`), CLI `vishu report
  [days]`, RPC `vishu.token_report`, dep-free React `Pie.tsx` + Tokens tab, static $ price table, waste
  heuristics (context bloat / model overkill / repeat-dedup) with $ savings.
- **Multi-provider config** — named AIs (`config.providers`) + `roles` map; `buildRoles` builds one Router
  per AI into `RoleRegistry`; `orchestrate` dispatches the "builder" role (closes open problem #6).
- **Budget alerts** — `budgetUsd` config + `BudgetWatcher` publishes a `system/notification` when weekly
  spend first crosses budget (edge-triggered, rides the existing notify seam).
- **Self-evolving loop** — `runEvolutionPass` on a daily (unref'd) cron in `serve` + `vishu.evolve_*` RPC.
- **Parallel auto-merge** — parallel Coordinator merges the winner serially post-race + backpropagates
  cross-branch learnings (closes the parallel half of open problem #2; `git worktree add` race remains).
- **Agent task queue** — `AgentQueue` bounded-concurrency multitasking (`VISHU_AGENT_CONCURRENCY`) +
  `vishu.agent_queue_*`; per-task Terminal so concurrent shells don't interleave.
- **Digital-twin auto-record** — `twin.record` one-liner in `startTurn` + `vishu.twin_*` RPC.
- **Core CORS** — allowlisted CORS + OPTIONS preflight on the transport server (in-code half of #1).
- **Auto-fix loop** — `vishu.autofix` (shell validator + agent fix; deterministic exit code is the gate).

## Next session — capability amplification ("use 100% of the model") + Set C standout
Approved direction: **test-time compute / scaffolding** that extracts more capability from the *same*
weights. (The "we only use 10–20%" papers really mean: a single-shot call leaves capability on the table;
sampling, verification, ensembling, and reflection recover a lot of it.) Build one at a time, verified,
commit per item. Highest-leverage order:

**Capability amplifiers (pure-code over the existing Router / council / multi-provider — no new deps):**
1. **Self-consistency + best-of-N** — ✅ DONE. `reasoning/selfconsistency.ts` `bestOfN(router, model, prompt,
   opts)` samples N candidates across a [0.2,1.0] temperature spread and selects by majority **vote** (default,
   ties → first-seen) or a **judge** model (bracket-pick, mirrors `council.ts`). Exposed as the `best_of_n`
   agent tool (`reasoning/tools.ts`) + `vishu.reasoning_best_of_n` RPC (`reasoning/rpc.ts`), both wired in
   `serve`. Tests cover majority aggregation, tie-break, judge selection, and N=1 degenerate (119/119 green).
   ponytail ceilings: vote normalization is string-equality (trim/lower/collapse ws) not semantic — a verifier
   that scores free-form answers is the named upgrade; samples run concurrently on one Router (multi-model
   spread rides item 2's MoA).
2. **Mixture-of-Agents** — ✅ DONE. `council.ts` `mixtureOfAgents(members, prompt, opts)` (Wang et al.):
   N proposers answer, each later layer sees the prior layer's proposals as references, then an aggregator
   synthesizes one answer. True multi-model ensemble when members use different routers; degrades cleanly to
   a single Router. Tests: 2-layer ensemble, default-aggregator, single-Router degrade (122/122 green).
   Library function (same surface as `council`); its consumer is item 4's effort router (hard→MoA) — no
   speculative tool/RPC. ponytail ceiling: fixed L layers, no early-stop on convergence (named upgrade).
3. **Reflexion self-critique** — ✅ DONE. `reasoning/reflexion.ts` `reflexion(router, model, prompt, opts)`:
   generate → the model critiques its own answer → revise, bounded by `maxIterations` and stopped early when
   the critic returns the `NO_CHANGE` sentinel. The LLM-critique analog of the deterministic `selfVerify`
   loop, applied to any answer. Library function (item 4's consumer). Tests: one-revision-then-approve,
   approved-first-answer, budget-cap-on-never-satisfied-critic (125/125 green). ponytail ceiling: single
   critic voice, no separate verifier model — a distinct judge/verifier is the named upgrade.
4. **Difficulty / effort router** — ✅ DONE. `reasoning/effort.ts`: `classifyEffort(prompt)` (heuristic:
   length + reasoning-marker keywords + question count) picks trivial/medium/hard; `effortRoute(router,
   model, prompt, opts)` dispatches trivial→single call, medium→`bestOfN`, hard→`mixtureOfAgents`, and tags
   each call's usage `category` as `effort:<level>` so the token report shows where compute went. Surfaced
   as the `solve` agent tool + `vishu.reasoning_solve` RPC (the suite's front door), wired in `serve`. Tests:
   classifier tiers + all three dispatch paths (129/129 green). ponytail ceilings: keyword/length heuristic
   (small-model classifier is the named upgrade); hard path defaults to a single-Router MoA — pass
   `members` from the RoleRegistry for a true multi-model ensemble.

**Set C — frontier mitigations that differentiate (bounded, honest ceilings, NOT "solved"):**
5. **Deterministic record/replay** — ✅ DONE. `replay/cassette.ts` `Cassette` keys each Router call by a
   sha256 of {model, messages, temperature, maxTokens, tools} → `ChatResponse`, persisted to
   `workspaceDir/cassette.json`. `record` captures every call at the Router chokepoint; `replay` serves
   recordings (streaming consumers still get `onDelta`), a miss falls through to the provider. Toggle via
   `VISHU_REPLAY=record|replay` (wired in `serve`) or the `vishu.replay_status` RPC. Tests: record→replay
   round-trip without re-calling the provider, replay-miss fall-through, off-mode never records (131/131).
   ponytail ceiling: per-call file write (fine for a debug/test feature) — batch if a hot loop needs it.
6. **Cross-session identity profile** — ✅ DONE. `personalization/profile.ts` `IdentityProfile`: an atomic
   JSON store of deduped per-user notes; `render()` produces a system-prompt block that `AgentService`
   prepends to every new session (empty profile = no noise). `absorbTwin()` folds the digital twin's
   recurring tasks in as context; memory-rollup notes use the same `note()` seam. Surfaced over
   `vishu.profile_get|note|absorb`. Tests: dedupe/persist/render, twin absorption, and the profile reaching
   a live session's system prompt (134/134). ponytail ceiling: flat note list (no structured prefs/embeddings).
7. **Self-healing memory** — ✅ DONE. `memory/rollup.ts` `selfHealMemory(store)` + two `MemoryStore`
   methods: `pruneSuperseded(olderThanDays)` evicts stale superseded notes (bounds unbounded growth, rebuilds
   the index once) and `conflicts()` flags subjects with more than one live note (e.g. edited directly in
   Obsidian, where supersede-on-write didn't fire). Recall already applies recency/decay weighting (Phase 7);
   this is the periodic maintenance + conflict-surfacing pass. Surfaced over `vishu.memory_selfheal`. Test:
   eviction removes the file + flags the same-subject conflict (135/135). ponytail ceiling: time-based prune,
   no value scoring; conflict detection is exact-subject (semantic conflict needs a model).
8. **Long-horizon eval harness** — a task suite + scorer to measure multi-step / multi-agent quality over
   time (largest, least user-visible — do last, or skip if budget is tight).

**#9 stays advisory by design** — the deterministic scanner + optional Semgrep are the gates; gating on a
non-deterministic LLM verdict can both block valid builds and pass bad ones.

> Cost note: the Phase-15 build above ran the session to ~$125. Budget the amplifier work accordingly —
> consider a cheaper model (`/model`) for the mechanical items and reserve the top model for the tricky ones.

## Open problems — present and NOT yet solved
Known ceilings/seams carried by the current green build (each has a named upgrade path in its phase):
1. **Packaged desktop cross-origin.** ✅ *Phase 15: core CORS + preflight shipped.* Remaining: `bundle.active`
   stays `false` until the Tauri build/signing toolchain is available to produce + verify a packaged binary.
2. **Parallel Coordinator.** ✅ *Phase 15: winner auto-merged serially post-race + cross-branch learnings
   backpropagated.* Remaining ceiling: high `concurrency` can still race on `git worktree add`.
3. **Token usage uncaptured.** ✅ *RESOLVED Phase 15 — usage captured at the Router chokepoint (token report).*
4. **No true PTY.** Phase 3 terminal is sentinel-framed exec, not a real node-pty TTY (blocked: node-gyp
   needs Python, absent here).
5. **No real channel clients.** Only `LocalConnector` + a generic `WebhookConnector`; Slack/Gmail/Telegram/
   etc. need creds + their API client.
6. **RoleRegistry has one Router.** ✅ *RESOLVED Phase 15 — `config.providers` + `roles` + `buildRoles` give
   one named Router per AI; `orchestrate` dispatches the "builder" role.*
7. **Wallet is offline-signing only.** No nonce/gas auto-fill, BTC PSBT/UTXO, or Solana tx build (need network RPC).
8. **Voice is one-shot STT.** No TTS, streaming dictation, or live meeting agent.
9. **LLM OWASP review is advisory** (by design — gating on a non-deterministic verdict is unsafe); the
   deterministic scanner + optional Semgrep are the gates.
10. **Frontier (documented, best-effort, not claimed solved):** memory staleness/contradiction, long-horizon
    multi-agent eval, deterministic replay, cross-session identity, unbounded memory growth. → *Now planned
    as Set C (items 5–8) in the Next-session section above: bounded mitigations, honest ceilings, not "solved".*

## Missing features — should be added (backlog v2)
Shipped Phase 15 (✅): **token/cost report** + **$ price table** + **budget alerts**; **auto-merge the
parallel winner** + cross-branch learning; **multi-provider config**; **self-evolving cron** (heuristic
analyzer — codegraph/LLM-proposed improvements remain the upgrade); **digital-twin auto-record**;
**agent-level task queue**. (Details in the Phase-15 "Shipped" section above.)

Still open:
- **Capability amplifiers** — ✅ DONE (items 1–4): self-consistency/best-of-N, Mixture-of-Agents, Reflexion,
  difficulty/effort router. `reasoning/` module + `solve`/`best_of_n` tools + `vishu.reasoning_*` RPC.
- **Set C frontier mitigations** — record/replay, cross-session identity, self-healing memory, eval harness.
  *(Planned as items 5–8 in the Next-session section.)*
- **Packaged desktop installer** (Tauri bundle); CORS is done, bundle/signing toolchain still needed. Absorb
  the `desktop` module's keyboard/mouse/overlay into the harness.
- **Real channel connectors** behind creds (Slack/Gmail/Telegram/Notion); inbound triage already exists.
- **TTS + live voice/meeting agent** on the existing `callSidecar` seam.
- **Wallet network-tx layer** (nonce/gas, PSBT/UTXO, Solana build + broadcast).
- **Codegraph/LLM-proposed improvements** in the evolver (today's cron is heuristic-only).
- **True PTY terminal** when Python/node-gyp is available (ANSI/curses).

## Brand
`assets/logo.svg` — original mark: three branches from one root node (Arbor tree / multi-agent /
graph vault) in a mint→teal gradient on the `#0e1116` ground. Full regeneration brief lives in
`README.md` → "Brand & logo brief". (Global uniqueness not legally guaranteed without a trademark search.)
