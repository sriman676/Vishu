# Vishu — Implementation Plan

The single source we build by. Dependency-ordered: each phase is buildable only after the ones
before it, ends in a **verifiable green check**, and nothing later starts until the current
phase is green. Reference contracts live in `docs/` (the blueprint).

> **When writing code, invoke the `/ponytail:ponytail` skill first, every coding session.**
> Lazy-senior-dev discipline: stdlib/native first, shortest working diff, no speculative
> abstractions, one runnable check per non-trivial unit.

---

## Locked decisions
- **Core language:** TypeScript / Node 24+ (same as the frontend; fastest to iterate; cross-platform).
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

> **Phase 3 deferred (built but simplified — do later, not dropped; seams exist):**
> - **Persistent PTY terminal.** The live terminal is per-exec `spawn` (platform shell, fixed cwd),
>   not a persistent node-pty TTY. Covers "run the app, report"; upgrade to node-pty when REPLs /
>   curses apps / colored interactive output are needed (`tools/terminal.ts` names the upgrade path).
> - **Sandbox backends.** No Docker / OS-jail / noop sandbox layer yet — isolation currently relies
>   on the path jail + `SecurityPolicy`. Add pluggable sandbox backends before running untrusted
>   code or for defense-in-depth beyond the action_dir boundary.

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

> **Phase 7 deferred (do later, not dropped — keep the seams):**
> - **Real embedding vectors.** Recall ships FTS5 + lexical + smart-walk now. No embedding provider
>   exists yet (Phase 2 added only `chat()`) and `node:sqlite` has no vector type. Add an `embed()`
>   provider method + float32-blob cosine blended into recall in a later pass; keep recall scoring
>   pluggable so this drops in without a rewrite.
> - **Confidence decay.** Ships with timestamp + supersede-on-write only. Add age-based confidence
>   decay to ranking later if recall quality needs it.

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
> **Phase 8 deferred (do later, not dropped — keep the seams):**
> - **Branch harvest/merge.** A winning branch's worktree is removed after capturing its final text;
>   `git`-merging the winning branch back into the action repo is the upgrade path (the outcome
>   already carries the branch's result).
> - **Multi-model council** (original's `model_council`/`council_registry`) — out of PLAN Phase 8
>   scope; add as an optional deliberation strategy if single-model branching proves insufficient.

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
> **Phase 9 deferred (do later, not dropped — seams exist):**
> - **Battery/CPU sensing.** `SchedulerGate` is a manual `always_on`/`paused` knob; wire real
>   battery/CPU sensing to flip it later.
> - **Notification delivery.** Firings publish a `system/notification` event on the bus; an actual
>   OS/desktop notification sink hooks onto that event in the frontend/shell phases.

### Phase 10 — Connectors + inbound triage
MCP client (external tools into the registry); channel connectors (WhatsApp, Gmail/email, Slack,
Telegram, Notion, …); inbound normalized → AI **triage** (summary + tier: skip/info/urgent/
needs_action) → notifications + tasks in the vault; outbound replies; realtime socket + `tool:sync`.
- ✅ An external MCP tool is callable; an inbound message gets a summary + urgency tier; an urgent one notifies.

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

### Phase 12 — Optional modules (feature-flagged; never block the core)
Voice & meetings (STT/TTS, dictation, meeting agent); Desktop/OS integration (screen awareness,
overlay assistant, desktop control); Wallet/web3 (BTC/EVM/Solana signing); Mobile companion
(native app + share-sheet/voice capture); smaller: artifacts, image gen, self-update, device pairing.
- ✅ Each enabled module works behind its flag with the core unaffected when off.

### Phase 13 — Personalization / digital twin (aspirational; built small-first)
Learn from usage patterns → suggest/auto-create task-specific agents; a "digital twin" profile for
repeated tasks; periodic auto-fetch context building. No accuracy claims — emergent, incremental.
- ✅ A repeated task gets a suggested saved workflow/agent the user can accept.

### Phase 14 — Frontend + desktop shell
React app talking to the core **only** via `vishu.*` RPC; thin Tauri/CEF host (spawns core, relays
RPC); branding + logo.
- ✅ `pnpm dev:app` boots; UI sends a turn end-to-end via the same contract as the CLI.

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
