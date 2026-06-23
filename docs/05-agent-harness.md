# 05 — Agent Harness (`src/aetheria/agent/harness/`)

The harness runs a single AI agent turn: assemble the prompt, loop over tool calls, manage
the session/transcript, and (optionally) spawn subagents. ~22k LOC across ~51 non-test files.

## Module map (by responsibility)

| File / dir | Responsibility |
| --- | --- |
| `session/turn.rs` | The agent turn lifecycle (largest file, ~89K) — one full provider+tool loop |
| `session/builder.rs` | Builds the session: assembles tools, providers, context, summarizer |
| `session/transcript.rs` | JSONL transcript, compaction, tool-result compression |
| `session/runtime.rs`, `session/types.rs` | Session runtime state + shapes |
| `session/turn_engine_adapter.rs` | Adapter between session and the engine |
| `session/agent_tool_exec.rs` | Executes agent tool calls within a turn |
| `session/migration.rs`, `session/turn_checkpoint.rs` | Session persistence/migration + checkpoints |
| `engine/core.rs` | Core turn engine (provider call + tool dispatch) |
| `engine/{tools,tool_source,state,progress,parser,checkpoint}.rs` | Engine sub-concerns (one each) |
| `tool_loop.rs` | The tool-calling loop |
| `tool_filter.rs` | Filters which tools are available to a turn |
| `tool_result_artifacts/` | Capture/large-result artifact handling |
| `subagent_runner/{mod,ops,types,tool_prep,extract_tool,handoff,autonomous}.rs` | Spawning + running subagents |
| `payload_summarizer.rs` | Compresses oversized tool results via a `summarizer` subagent |
| `definition.rs`, `definition_loader.rs`, `builtin_definitions.rs` | Agent definitions (archetypes) + loading |
| `memory_context.rs`, `memory_context_safety.rs` | Injects recalled memory into the prompt |
| `token_budget.rs` | Token budgeting for prompt assembly |
| `self_healing.rs` | Recovery from malformed model output |
| `prompts/` (`agent/prompts/`) | Bundled system prompts (also shipped as Tauri resources) |
| `interrupt.rs`, `session_queue.rs`, `run_queue/` | Interruption + queueing |
| `sandbox_context.rs`, `spawn_depth_context.rs`, `fork_context.rs`, `credentials.rs` | Per-turn context (sandbox, depth, fork, creds) |

## Key contracts

- **Agent definition** (`definition.rs`): an archetype = system prompt source + tool scope +
  model spec + sandbox mode + permission level. Built-ins in `builtin_definitions.rs`;
  custom ones loaded from `<workspace>/agents/*.toml` by `definition_loader.rs`.
- **Tool loop**: model → tool call(s) → execute (gated by SecurityPolicy) → feed results
  back → repeat until done or max-iterations. Oversized results go through
  `payload_summarizer` (a single-method async trait `PayloadSummarizer` with the production
  impl `SubagentPayloadSummarizer`).
- **Subagent runner** (`subagent_runner/ops.rs`): runs another full turn one level down,
  with its own filtered tools and prompt; the inner future is boxed to bound stack growth.
- **Transcript**: JSONL with compaction + tool-result compression to stay within context.

## Notes for rebuild

- A turn + nested subagent is a very large async state machine — give Tokio workers a
  roomier stack (`AGENT_WORKER_STACK_BYTES`) or risk SIGABRT stack overflow.
- Keep the engine sub-concerns split one-per-file (state/progress/parser/tools/tool_source) —
  this is intentional separation, not over-engineering.
- The `summarizer` agent definition is resolved once at build time from the definition registry.
