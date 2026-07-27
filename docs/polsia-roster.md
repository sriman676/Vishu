# Polsia roster → Vishu workflows (governed)

Borrowed from Polsia's "runs your company while you sleep" model: 9 scheduled agents.
Polsia runs them **ungated** (sandbox flag only). The Vishu port keeps every outward
action behind the F0 approval gate — the brain lane does the ops, but send/spend/deploy
stay fail-closed when no human is present.

**Status: SPEC ONLY — not registered.** Registering these arms cron jobs that make model
calls on a schedule (token cost) and, once approved, act outward. Enable per-agent on the
user's explicit go via `TriggerManager` + `WorkflowStore`, starting read-only.

| # | Agent | Schedule | Lane | Outward action → gate class |
|---|-------|----------|------|------------------------------|
| 1 | Orchestrator | 06:00, 20:00 | brain | none (plans/summaries) → read |
| 2 | Business Planning | daily | brain | none (strategy/KPIs) → read |
| 3 | Competitor Research | daily | brain | web_search → read |
| 4 | Social Media | every 2h | brain | post tweet → **send** (gated) |
| 5 | Email Outreach | every 3h | brain | find prospects (read) + send sequence → **send** (gated, ≤30/day cap) |
| 6 | Customer Support | every 3h | brain | read inbox (read) + reply → **send** (gated) |
| 7 | Ads Management | every 6h | brain | change Google/Meta budgets → **spend** (gated, typed confirm) |
| 8 | Code Generation | on demand | **builder** | open PR / commit → **irreversible** (gated) |
| 9 | Finance | every 6h | brain | Stripe sync (read) + spend tracking → read |

## Wiring (when enabled)
- Each row = a `WorkflowStore` entry (the agent prompt) + a `TriggerManager` cron trigger.
- Read-only agents (1,2,3,9) can run automatic; they never touch the gate.
- Send/spend/irreversible agents (4,5,6,7,8) draft + park a gate approval — nothing goes
  out unattended (matches the pa/ career-apply + comms pattern already shipped).
- Agent #8 routes through the **builder** lane (co-founder mode) via `auto_mode`.

## Not ported
- Polsia's `claude -p` subprocess model — Vishu has its own multi-provider router
  (NIM/Ollama), so it doesn't shell out to Claude Code for every step.
- Polsia's Postgres/Redis/Celery stack — Vishu's TriggerManager (5s cron) + SQLite covers
  the same scheduling without the infra.
