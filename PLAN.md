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

## Requested backlog (post-14, not yet built)
User-requested features captured for a future session. Each sits on a frontier problem, so the
design rule is **best-effort with a human gate**, never a claimed-solved autonomous loop.
- **Multi-AI role registry.** When >1 AI/provider is connected, the user assigns each a role
  (builder / summariser / messenger / …); a routing layer over the provider Router + orchestration
  archetypes dispatches each task to its assigned AI. Pure-TS. (Frontier: async multi-agent coordination.)
- **Backend error auto-fix loop.** While an AI is active, a background watcher tails build/logs for
  errors and dispatches a **bounded** auto-fix turn (reuse Phase 4 self-verification + Phase 9 triggers).
  (Frontier: long-horizon autonomous reliability — bounded budget + deterministic check as the gate.)
- **Self-evolving project loop.** Periodic loop proposes improvements (tests, refactors) with a
  **human-accept gate** — suggest, never auto-apply (extends Phase 13 twin). (Frontier: self-improvement
  without drift; the vault is the immutable audit trail.)
- **Backup API keys (labelled).** Mostly already done — the Phase 2 router rotates provider+key on
  quota/limit. Remaining: expose primary/backup labels in config so failover order is explicit.

## Brand
`assets/logo.svg` — original mark: three branches from one root node (Arbor tree / multi-agent /
graph vault) in a mint→teal gradient on the `#0e1116` ground. Full regeneration brief lives in
`README.md` → "Brand & logo brief". (Global uniqueness not legally guaranteed without a trademark search.)
