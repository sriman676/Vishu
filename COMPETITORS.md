# Vishu vs. the PA-AI field (2026-07-12)

Benchmarked against the assistants the user named: **Alfred Black**
(`ssdavidai/alfred`, the self-hosted anticipatory butler), **get-alfred.ai**
(the consumer Alfred), and **Leon** (`leon-ai/leon`, the open-source assistant),
plus the wider open-source PA field.

## Feature matrix

| Capability | **Vishu** | Alfred Black | get-alfred.ai | Leon |
|---|---|---|---|---|
| Email triage (tier + summary) | ✅ `connectors_daily` | ✅ | ✅ | ➖ |
| Draft reply **in your voice** | ✅ (now profile-personalized) | ✅ | ✅ | ➖ |
| Task extraction linked to source | ✅ todo `[[from]]` | ✅ | ✅ | ➖ |
| Matters (ongoing concerns) | ✅ matter record + cosine match | ✅ | ➖ | ➖ |
| Daily brief | ✅ `daily_briefing` | ✅ | ✅ (7am) | ➖ |
| Calendar conflict/focus logic | ⛔ stub (needs cal token) | ✅ | ✅ | ➖ |
| Messaging channels | ✅ Telegram/Slack/SMS | ✅ Telegram/Slack | ✅ SMS | ➖ |
| 1000+ app integrations | ✅ Composio domain | ✅ Composio | ➖ | ➖ |
| **Voice (STT + TTS + orb)** | ✅ **full-duplex + barge-in** | ⛔ none | ⛔ none | ✅ STT/TTS |
| Personas / modes | ✅ 4 modes + per-mode voice + switcher | ➖ profiles | ➖ | ➖ modes |
| Obsidian-compatible vault | ✅ | ✅ | ➖ | ➖ |
| Vector/hybrid memory recall | ✅ FTS+lexical+embedding | ✅ state.db | ➖ | ✅ layered |
| **Local/offline model** | ✅ **IPEX-LLM + Qwen3-8B on Arc** | ✅ Ollama | ⛔ cloud | ✅ |
| Decision log + learned autonomy | ⚠️ gate+runlog (no learned tiers) | ✅ ask→confirm→act | ➖ | ➖ |
| Knowledge-graph hygiene (contradiction/orphan repair) | ⚠️ `memory_selfheal` (partial) | ✅ | ➖ | ➖ |
| Rich record types (person/org/decision/daybook) | ⚠️ matter/todo/draft/note | ✅ 12 types | ➖ | ➖ |
| Background worker agents | ⚠️ evolve/twin (no pool) | ✅ curator/janitor/distiller | ➖ | ✅ agent mode |
| Browser actuator (real Chrome) | ✅ token-free lane | ➖ | ➖ | ➖ |
| Financial sidecar | ⛔ | ✅ Sure | ➖ | ➖ |
| Kanban board UI | ⚠️ list panels (no board) | ✅ Plane | ✅ | ➖ |
| Web UI | ✅ React/Tauri | ✅ Wasp | ✅ | ✅ |
| Action gate / approvals | ✅ classify-by-intent (send/buy/delete always-ask) | ✅ | ➖ | ➖ |
| Kill switch / pause | ✅ SIGBREAK instant pause | ➖ | ➖ | ➖ |
| Cost/token dashboard | ✅ `token_report` | ➖ | ➖ | ➖ |

✅ have · ⚠️ partial · ⛔ missing/blocked · ➖ not offered by them

## Where Vishu already wins
Voice (all three rivals lack it), per-mode personas with distinct voices, a
real-Chrome browser actuator, an out-of-band kill switch, a token/cost
dashboard, and an eval harness. Vishu is the only one of the four with a
first-class voice+orb loop.

## Gaps closed in this run
1. **Draft in your voice** — daily-driver reply drafts now inject the identity
   profile so replies sound like the user (Alfred parity, cheap win).
2. **Local/offline model** — IPEX-LLM (Ollama-compatible) + Qwen3-8B on the Arc
   iGPU, wired as the `intel` provider preset. Matches Alfred/Leon offline story.
3. **Decision records + autonomy hint** — every gated approval is logged; after N
   approvals of the same action class Vishu *suggests* automating it (never
   auto-sends: send/buy/delete stay always-ask, per the locked gate decision).
4. **Person/org records + knowledge-graph hygiene** — extract people/orgs from
   inbound mail into linked records; extend self-heal to flag contradictions and
   orphaned links.

## Backlogged (blocked or heavy, not this run)
- **Calendar conflict/focus logic** — blocked on a real calendar token
  (`VISHU_GCAL_TOKEN`); the panel + stub seam are ready.
- **Financial sidecar (Sure-equivalent)** — large, out of PA scope for now.
- **Kanban board UI** — list panels cover it; a drag board is polish.
- **Background worker pool (curator/janitor/distiller)** — overlaps with
  evolve/twin; revisit once the local model frees budget.
