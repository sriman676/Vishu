# 06 — Agent Orchestration & Registry

Orchestration sits above the single-turn harness: it decides *which* agent runs, spawns
subagents/worker threads as tools, routes to models, and manages agent archetypes.

## Domains involved

| Domain | Role |
| --- | --- |
| `agent_orchestration/` | The orchestration layer: deliberator, spawn tools, coordination |
| `agent_registry/` | Built-in agent archetypes (one subdir per agent, `mod.rs` re-export each) |
| `agent_tool_policy/` | Which tools each agent archetype may use |
| `council_registry/`, `model_council/` | Multi-model "council" deliberation |
| `routing/` | Model/route selection (`routing/factory.rs`, `routing/quality`) |
| `agent_experience/`, `agent_meetings/`, `agent_memory/` | UX, meetings, per-agent memory glue |

## Key pieces

- **`agent_orchestration/deliberator.rs`** — decides how to handle a request (single agent
  vs. orchestrated multi-step). Has a `main` (dev/test harness entry).
- **`agent_orchestration/tools/spawn_subagent.rs`** — the `spawn_subagent` agent tool:
  constructs `SubagentRunOptions` and calls `subagent_runner::run_subagent`. Returns a
  stringified `SubagentRunOutcome` in a tool-result block.
- **`agent_orchestration/tools/spawn_worker_thread.rs`** — long-running worker-thread spawns.
- **`agent_registry/agents/<name>/mod.rs`** — each archetype (researcher, planner, critic,
  orchestrator, summarizer, code_executor, crypto_agent, markets_agent, integrations_agent,
  scheduler_agent, screen_awareness_agent, task_manager_agent, tool_maker, trigger_reactor,
  trigger_triage, …). The one-line `mod.rs` re-exports are idiomatic — keep them.

## Archetype catalog (registry agents)

`account_admin_agent, archivist, code_executor, critic, crypto_agent,
desktop_control_agent, help, integrations_agent, markets_agent, mcp_setup,
morning_briefing, orchestrator, planner, presentation_agent, profile_memory_agent,
researcher, scheduler_agent, screen_awareness_agent, settings_agent, skill_creator,
summarizer, task_manager_agent, tools_agent, tool_maker, trigger_reactor, trigger_triage`

## Model routing

- `routing/factory.rs` builds the route; `routing/quality` does refusal/empty-noise
  detection on local-model responses (uses `aho-corasick`).
- Council (`model_council/`, `council_registry/`) runs several models and aggregates.

## Contracts to preserve

- Subagent spawning must thread parent context (no parent context → `NoParentContext` error).
- Tool policy is enforced per archetype before the tool loop sees the tool set.
- Orchestration produces the same `RpcOutcome`/tool-result envelope as a single turn so the
  UI and transcript handle both uniformly.
