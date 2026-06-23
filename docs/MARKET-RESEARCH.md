# Vishu — Market Research: Validated Complaints & Gaps

> Web research (2026) on what people actually complain about with current AI assistants/agents.
> Goal: confirm what Vishu already solves, and surface problems **not yet in PLAN.md**.

## Part A — Complaints Vishu already targets (validated, keep)

| Real complaint (sourced) | Vishu answer (PLAN.md) |
| --- | --- |
| **Mid-stream usage-limit cuts** — Codex's 5-hour rolling limits "bite harder than the price"; opaque long-agent costs. | Provider **router/fallback** (Phase 1) — rotate provider+key on quota/429. Directly solves this. |
| **Token waste / "lazy architecture"** — devs dump whole codebases/PDFs into context; "financially catastrophic"; vector retrieval is fractions of a cent. | **TokenJuice** (Phase 3) + **smart-walk recall** + skill progressive disclosure (Phase 4). |
| **Stateless "context tax"** — assistants forget you; users spend ~2 min re-explaining every session. | **Persistent Obsidian memory vault** (Phase 5) — cross-session identity + recall. |
| **Fragmented apps + subscription stacking** — email AI + calendar AI + Slack AI as separate subs cost more than one unified assistant. | **Connectors + inbound triage** (Phase 7) — one assistant across channels. |
| **Privacy / trust** — 90% don't trust AI with their data; local-first is now a mainstream selling point (Jan.ai 5.3M downloads). | **Local-first, plaintext vault on your machine, secrets in OS keychain.** |
| **Bash skill / tooling fragmentation.** | Shared **SKILL.md** library + Git Bash shim (Phase 4). |

Market context: personal-AI-assistant market $4.84B (2026) → projected $19.63B (2030), 41.9% CAGR.

## Part B — NEW problems to solve (NOT yet in the plan)

These are the highest-signal gaps. The dominant finding across every "why agents fail" source:
**reliability and oversight kill agents in production, not model quality.** Gartner predicts
40%+ of agentic projects scrapped by 2027 over cost/control/risk — only ~10–23% reach
production at scale.

### G1 — Compounding error over long tool chains  ← biggest one
85% success per step over 8 steps ≈ **27% end-to-end success**. Long refactors loop or finish
half-done (top Cursor complaint).
→ **Add**: per-step **verification/checkpoints**, **fault isolation** (one tool failure doesn't
cascade), **undo/rollback** (checkpoint the workspace before risky edits), bounded retries with
a different strategy. Treat reliability as a first-class engineering concern (typed tool
interfaces, observability).

### G2 — Approval fatigue defeats the autonomy feature
If users are prompted too often they enable auto-approve / click through — "the policy exists
but supervision no longer does." This directly threatens your ask-every-time / once / auto levels.
→ **Add**: **risk-scoped prompting** (only interrupt for genuinely risky/destructive/irreversible
or money/credential actions; auto-allow reads + safe writes), **remembered decisions** ("always
allow X in this project"), and **dry-run/preview** so a single approval covers a previewed batch.

### G3 — No observability / audit trail
Orgs "lack the visibility to manage agents safely"; agent activity is siloed and untraceable.
→ **Add**: a transparent **run log** — every tool call, file change, external call, and decision,
auditable after the fact ("what did it actually do?"). Maps to blueprint `run_telemetry` / `mcp_audit`.

### G4 — Cost is opaque / unbudgeted
"Hidden, escalating costs"; premium output tokens 8× input (GPT-5.2 Pro $21 vs $168 /M).
→ **Add**: a live **cost meter + budget cap** per session/project (tokens + $), shown to the user;
stop or downshift model when a cap is hit. Maps to blueprint `cost` domain.

### G5 — Credentials reaching the model context
Security-focused teams now demand architectures where **credentials never enter the model context**.
→ **Add (principle)**: tools hold credentials; the model sees handles/results, never secrets.
Strengthens the keychain decision into an enforced boundary.

### G6 — Context rot (quality degrades long before the window fills)
200K-advertised models degrade measurably around ~130K tokens; long chats "go off the rails."
→ **Add**: **active context curation** (not just compaction) — keep working context small via
retrieval, evict stale turns, summarize aggressively. A goal, layered on TokenJuice.

### G7 — Weak whole-repo code understanding (the VS-Code side)
Cursor criticized on "repo-wide understanding," incomplete refactors, looping.
→ **Add**: a **code index (codegraph)** so the coding agent retrieves relevant files/symbols
instead of guessing or dumping the repo. Maps to blueprint `codegraph`. Pairs with G1/G6.

## Recommended plan changes
- New **Phase 2.5 — Reliability & oversight**: checkpoints/undo, fault isolation, risk-scoped
  approvals + remembered decisions, run log, cost meter. (Addresses G1–G4 — the production killers.)
- Fold **G5** (credentials never in model context) into the security layer as a hard rule.
- Fold **G6** (active context curation) into TokenJuice (Phase 3).
- Add **codegraph** (G7) to the tools/coding path (Phase 2 or a dedicated coding phase).

## Sources
- [Best AI Coding Agents 2026 — Faros](https://www.faros.ai/blog/best-ai-coding-agents-2026)
- [Best AI Coding Agents — Firecrawl](https://www.firecrawl.dev/blog/best-ai-coding-agents)
- [Why AI Agents Fail in Production — NeuralWired](https://neuralwired.com/2026/04/28/why-ai-agents-fail-production/)
- [The Reliability Gap — Inovabeing](https://www.inovabeing.com/blog/ai-agent-reliability-production-failure-2026)
- [77% Never Reach Production — Umesh Malik](https://umesh-malik.com/blog/autonomous-ai-agents-production-gap-2026)
- [88% Fail Production — Digital Applied](https://www.digitalapplied.com/blog/88-percent-ai-agents-never-reach-production-failure-framework)
- [AI Memory Problem — Arsturn](https://www.arsturn.com/blog/the-ai-memory-problem-why-your-assistant-forgets-and-whats-next)
- [Context Rot — Product Talk](https://www.producttalk.org/context-rot/)
- [Why Your AI Assistant Forgets You — Slime](https://getslime.app/blog/ai-assistant-memory-problem)
- [LLM Token Optimization — Redis](https://redis.io/blog/llm-token-optimization-speed-up-apps/)
- [Why Token Pricing Misleads — CodeAnt](https://www.codeant.ai/blogs/why-token-pricing-misleads-llm-buyers)
- [10 Best Private Personal AI Assistants — Vellum](https://www.vellum.ai/blog/best-private-personal-ai-assistants)
- [90% Don't Trust AI With Data — Malwarebytes](https://www.malwarebytes.com/blog/privacy/2026/03/90-of-people-dont-trust-ai-with-their-data)
- [Human Oversight Fails First — NHIMG](https://nhimg.org/articles/human-oversight-fails-first-in-ai-agent-governance/)
- [Measuring Agent Autonomy — Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)
- [Best AI Assistants for Email/Calendar/Slack — Vellum](https://www.vellum.ai/blog/best-ai-assistant-for-email-calendar-slack)
