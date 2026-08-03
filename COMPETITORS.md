# Vishu vs. the PA-AI field (2026-07-12; honesty pass 2026-07-27; 2026-07-29 update)

> **2026-07-29 update:** automatic silent memory (`memory/autolearn.ts`), learned
> proactivity (threshold→`suggest_schedule`), and **multimodal image input** (`see_image`
> tool + vision-wired OpenAI/Ollama/Anthropic adapters) shipped — see
> `../audit/pa-field-analysis-2026-07-28.md` gap #8 (CLOSED) and #3 (now BUILT). The moat rows
> (self-hosted ownership, provider-agnostic routing, gated cross-LLM self-critique, safety
> surface) remain the field-wide wins.

> **2026-07-27 correction:** the voice and local-model rows below were downgraded
> from ✅ to ⚠️ — voice is built but unverified on mic HW, and the IPEX-LLM local
> model is vet-BLOCKED / not installed. For the honest field-wide matrix (Vishu vs
> ChatGPT/Gemini/Siri/Manus, where rivals genuinely lead) see
> `../audit/item5-full-audit-2026-07-27.md`.
>
> **2026-07-28 — full-field gap analysis** (all PA AIs: big-tech, hardware,
> open-source; web-grounded) is now at `../audit/pa-field-analysis-2026-07-28.md`.
> The table below is the Alfred/Leon niche view; that report is the whole field.


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
| **Voice (STT + TTS + orb)** | ✅ STT+TTS **proven live** (whisper.cpp + Piper round-trip, 2026-07-29); full-duplex/barge-in on branch, mic-latency HW-pending | ⛔ none | ⛔ none | ✅ STT/TTS |
| Personas / modes | ✅ 4 modes + per-mode voice + switcher | ➖ profiles | ➖ | ➖ modes |
| Obsidian-compatible vault | ✅ | ✅ | ➖ | ➖ |
| Vector/hybrid memory recall | ✅ FTS+lexical+embedding | ✅ state.db | ➖ | ✅ layered |
| **Local/offline model** | ✅ IPEX-LLM Ollama **live** — qwen3:4b + moondream on the Arc iGPU (2026-07-29) | ✅ Ollama | ⛔ cloud | ✅ |
| Decision log + learned autonomy | ✅ log + learned auto-allow tier (N clean approvals promote a reversible signature; send/buy/delete stay always-ask) | ✅ ask→confirm→act | ➖ | ➖ |
| Knowledge-graph hygiene (contradiction/orphan repair) | ✅ `memory_selfheal` — resolveConflicts + repairLinks (opt-in) | ✅ | ➖ | ➖ |
| Rich record types (person/org/decision/daybook) | ✅ org/decision/daybook added (ba71820) | ✅ 12 types | ➖ | ➖ |
| Background worker agents | ✅ pool: janitor/distiller/curator (b15c577) | ✅ curator/janitor/distiller | ➖ | ✅ agent mode |
| Cross-LLM self-critique (human-gated) | ✅ `evolve_critique` (7b90810) | ⛔ | ➖ | ⛔ |
| Browser actuator (real Chrome) | ✅ token-free lane | ➖ | ➖ | ➖ |
| **Multimodal image input (vision)** | ✅ `see_image` + all adapters; **moondream proven live** — reads images (2026-07-29) | ⛔ | ⛔ | ⛔ |
| Financial sidecar | ⛔ | ✅ Sure | ➖ | ➖ |
| Kanban board UI | ✅ persistent drag board (e75f48a) | ✅ Plane | ✅ | ➖ |
| Web UI | ✅ React/Tauri | ✅ Wasp | ✅ | ✅ |
| Action gate / approvals | ✅ classify-by-intent (send/buy/delete always-ask) | ✅ | ➖ | ➖ |
| Kill switch / pause | ✅ SIGBREAK instant pause | ➖ | ➖ | ➖ |
| Cost/token dashboard | ✅ `token_report` | ➖ | ➖ | ➖ |

✅ have · ⚠️ partial · ⛔ missing/blocked · ➖ not offered by them

## Where Vishu already wins
Per-mode personas with distinct voices, a real-Chrome browser actuator, an
out-of-band kill switch, a token/cost dashboard, and an eval harness. Vishu's
voice+orb loop is the most ambitious of the four (Leon has plain STT/TTS; the
two Alfreds have none) — but note it is **built, not yet HW-verified**, so treat
it as a lead-in-waiting, not a proven win.

## Gaps closed in this run
1. **Draft in your voice** — daily-driver reply drafts now inject the identity
   profile so replies sound like the user (Alfred parity, cheap win).
2. **Local/offline model** — the local lane is wired (`providers/ollama.ts`,
   `intel`/`!private` preset). Honesty: the **IPEX-LLM install is vet-BLOCKED**
   (6 exfil flags) and Qwen3-8B is **not installed**; a small local model has run
   ad-hoc but a council-grade local model is still missing. So the lane exists,
   the offline story is not yet fully matched to Alfred/Leon.
3. **Decision records + learned autonomy** — every gated approval is logged; after
   N clean approvals of a reversible signature the gate forms a *learned auto-allow
   tier* (`isLearned`) so it stops nagging, and still *suggests* a durable grant on
   the bus. send/buy/delete/change_setting stay always-ask (the learned tier and
   grants both exclude the floor classes, per the locked gate decision).
4. **Person/org records + knowledge-graph hygiene** — extract people/orgs from
   inbound mail into linked records; self-heal now *repairs* as well as flags —
   `resolveConflicts` drops stale same-subject duplicates, `repairLinks` unlinks
   dangling `[[targets]]` in place (both opt-in).

## Backlogged (blocked or heavy, not this run)
- **Calendar conflict/focus logic** — blocked on a real calendar token
  (`VISHU_GCAL_TOKEN`); the panel + stub seam are ready.
- **Financial sidecar (Sure-equivalent)** — large, out of PA scope for now.
- **Kanban board UI** — list panels cover it; a drag board is polish.
- **Background worker pool (curator/janitor/distiller)** — overlaps with
  evolve/twin; revisit once the local model frees budget.

---

## OpenWorker (2026-08-03)

`andrewyng/openworker` (MIT, Python, 11.9k★) is the closest *shape* match — a
local-first, BYO-model agent that ships finished work, gates consequential
actions, speaks MCP, and has a Tauri shell + voice sidecar. Honest verdict below —
Vishu leads on every code-decided axis; **one gap remains and it is cert-gated,
not a code gap.**

| Axis | Vishu | OpenWorker |
|---|---|---|
| Throughput under rate limits | ✅ **key-ring** (`failover`/`balance`, local model = another key) — bench: **40/40** under a burst | ⛔ one client per provider from a single `api_key`; 429 = "slow down" — **10/40** |
| Bidirectional MCP | ✅ client **+ server** (`mcp-serve`) | ⚠️ consumer only |
| Connector breadth / LOC | ✅ Composio 1000+ behind one mount | ⚠️ ~25 hand-maintained + OAuth broker |
| Local vision + voice | ✅ offline moondream vision + STT/TTS/barge-in | ⚠️ cloud vision; STT only |
| Remote-trigger | ✅ `connectors_trigger` — **any channel, all mounted MCPs**, fail-closed allowlist | ✅ Slack `@mention → thread reply` |
| Turnkey OAuth connect | ✅ `connect <app> --auth` (hosted Composio OAuth) | ✅ hosted OAuth broker |
| **Signed/notarized distribution + auto-update** | ⛔ **`install.ps1`, run-from-source, unsigned** | ✅ notarized macOS + auto-update |

✅ have · ⚠️ partial/one-directional · ⛔ missing

**Where Vishu is decisively ahead:** throughput under rate limits — OpenWorker
has no key-ring, so a burst or a 429 stalls it on the one key. Proven, not
claimed: `npx tsx packages/core/src/reliability/ratelimit-bench.ts`.

**The one gap Vishu has not closed:** signed/notarized distribution + auto-update.
This is **not** a code gap — it needs a purchased code-signing certificate
(Windows Authenticode ~$100–400/yr or an Apple Developer cert $99/yr), after
which a signing step + update feed light it up. The release/signing machinery is
a next-session build that stays inert until a real cert is supplied.

**Do not copy OpenWorker's code** (MIT permits it, but its router has no
key-ring — lifting it is a downgrade). Keep it a reference clone only
(`D:\claude-tools\repos\openworker`).
