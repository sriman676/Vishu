# Vishu vs. the entire PA-AI field — feature-gap analysis (2026-07-28)

Web-grounded (live research 2026-07-28), not from training memory. Scope is **all**
personal-assistant AIs the user named plus the wider field, in four tiers:

- **Big-tech assistants:** ChatGPT (OpenAI), Gemini (Google), Apple Intelligence / Siri,
  Amazon Alexa+, Microsoft 365 Copilot.
- **Hardware / agent PAs:** Rabbit R1 (LAM), Limitless Pendant (now Meta), Friend pendant,
  Humane (defunct).
- **Open-source / self-hosted:** Leon 2.0, Khoj, Open Interpreter, Home Assistant Assist.
- **Vishu** is the baseline being scored.

Method note: this reports what each product *ships or has announced for 2026*; it does not
credit roadmap-only items as delivered. Vishu rows reflect verified code (see git + the
2026-07-27 item-5 audit), with voice/local-model still flagged unverified.

## What the field looks like in 2026

The whole field has converged on the same assistant shape: **automatic memory + proactive,
24/7, agentic help that takes real actions across your apps.** ChatGPT folded Operator and
Deep Research into one *Agent* that drives a virtual computer; Gemini replaced Google
Assistant and added on-device *Proactive Assistance* that reads your screen and notifications;
Alexa+ books Uber/OpenTable/Expedia autonomously and senses room presence ("Omnisense");
Copilot's *Work IQ* is long-term memory with background "autopilot" agents in Entra; Apple's
new LLM-Siri exposes every app through *App Intents* + on-screen awareness. The open-source
tier (Leon 2.0, Khoj) matches Vishu's *philosophy* — self-hosted, model-agnostic, skill/agent
modular, scheduled automations — but not its breadth.

## Capability matrix (representative leaders)

| Capability | Vishu | ChatGPT | Gemini | Siri/Apple | Alexa+ | Copilot | Khoj/Leon |
|---|---|---|---|---|---|---|---|
| Persistent cross-session memory | ✅ vault + hybrid recall + self-heal | ✅ auto | ✅ auto | ✅ personal context | ✅ | ✅ Work IQ (Nov'26) | ✅ |
| **Automatic/silent memory inference** | ✅ `autolearn.ts` (silent per-turn) + twin | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Proactive / anticipatory (behavior-driven) | ⚠️ triggers + threshold-suggest (behavior-learning WIP) | ✅ Tasks | ✅ Proactive Assist | ✅ | ✅ Daily Insights | ✅ autopilots | ⚠️ schedules |
| Agentic end-to-end task (book/buy/forms) | ⚠️ browser actuator, not productized | ✅ Agent VM | ✅ | ✅ App Actions | ✅ Uber/OpenTable | ✅ agent mode | ⚠️ |
| Real browser/computer use | ✅ real-Chrome, token-free | ✅ virtual computer | ✅ | ➖ | ✅ web nav | ✅ | ⚠️ Open Interpreter=code |
| **Native OS / app-intent integration** | ⛔ web/Tauri app only | ⚠️ connectors | ✅ Android core | ✅ system-wide App Intents | ✅ Echo/home | ✅ M365 native | ⛔ |
| **On-screen / ambient awareness** | ⛔ | ⚠️ | ✅ screen+notifs | ✅ onscreen | ✅ Omnisense sensors | ⚠️ | ⛔ |
| **Multimodal (vision/camera/images)** | ⚠️ `see_image` tool + all adapters vision-wired (2026-07-29); needs a vision model configured | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Real-time natural voice | ⚠️ full-duplex built, HW-unverified | ✅ Advanced Voice | ✅ Live | ✅ | ✅ | ✅ | ✅ basic STT/TTS |
| **Mobile app + phone push** | ⛔ desktop/web (msg channels only) | ✅ | ✅ | ✅ | ✅ app | ✅ | ⛔ |
| **Wearable / always-on capture** | ⛔ | ➖ | ⚠️ Ray-Ban | ⚠️ Watch | ⚠️ | ➖ | ⛔ |
| Multi-app integrations | ✅ Composio + MCP gateway | ✅ connectors | ✅ extensions | ✅ App Intents | ✅ | ✅ Graph | ⚠️ |
| **Provider-agnostic / swap any model** | ✅ router+key registry+local lane | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ |
| Self-hosted / full data ownership | ✅ Obsidian vault, local-first | ⛔ | ⛔ (on-device infer) | ⚠️ on-device | ⛔ | ⛔ | ✅ |
| On-device / offline model | ⚠️ lane wired, IPEX vet-blocked | ⛔ | ⚠️ on-device infer | ✅ 1.2T MoE on-device | ⛔ | ⛔ | ✅ |
| Self-improvement (cross-LLM critique) | ✅ evolve_critique, human-gated | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Cost/token transparency + eval harness | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⚠️ |
| Out-of-band kill switch / pause | ✅ SIGBREAK | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| Intent-classified action gate (send/buy/delete ask) | ✅ | ⚠️ Lockdown mode | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⛔ |

✅ have · ⚠️ partial/unverified · ⛔ missing · ➖ not applicable

## What Vishu is MISSING vs the field (the answer)

**A. Structural gaps** — present across most rivals, hard for a self-hosted TS app to close
because they require being an OS vendor, a device maker, or a mobile-platform owner:

1. **Native OS / system-wide app-intent integration.** Siri (App Intents), Gemini (Android
   core), Alexa (Echo), Copilot (M365) act *inside every app and the OS*. Vishu is a
   web/Tauri app + MCP — it can't read arbitrary app state or trigger system intents. **Biggest gap.**
2. **On-screen & ambient awareness.** Gemini reads on-screen content + notifications; Siri has
   onscreen awareness; Alexa "Omnisense" uses room sensors. Vishu has zero screen/sensor input.
3. ~~**Multimodal (vision/camera/images).**~~ **BUILT (2026-07-29):** `see_image` tool +
   `modules/vision.ts` (`imageToDataUrl`) + vision serialization across every adapter (OpenAI/NIM/
   OpenRouter parts, Ollama base64 `images[]`, Anthropic content-block base64/url). Routes to
   `VISHU_VISION_MODEL`. Now ⚠️ (image *input* at parity; live camera/screen capture is still gap #2).
4. **First-class mobile app + phone push.** All big-tech PAs live on the phone with native push.
   Vishu is desktop/web; it only reaches you via Telegram/Slack/SMS relays.
5. **Wearable / always-on capture.** Limitless/Friend/Ray-Ban capture and remember real-world
   conversations. Vishu has no capture device.

**B. Buildable gaps** — rivals lead but Vishu *could* close these with software work:

6. **Behavior-driven anticipatory proactivity.** Vishu proactivity is schedule/rule-based
   (triggers + daily brief). Rivals *learn from behavior/sensors* to anticipate ("leave earlier,
   traffic"). Vishu could add a learned-signal layer over its existing trigger engine.
7. **Productized end-to-end agentic tasks.** Vishu has a real-Chrome actuator but no hardened
   "book the reservation, fill the form, confirm to phone" flow like Alexa+/ChatGPT Agent. The
   substrate exists; the reliability + task library don't.
8. ~~**Automatic silent memory inference.**~~ **CLOSED (2026-07-28, `memory/autolearn.ts`):** a
   zero-token regex gate fronts one cheap classifier call that silently extracts + stores durable
   facts per turn (fire-and-forget, restated facts supersede). Now at field parity.
9. **Verified real-time voice.** Full-duplex + barge-in are *built* but unproven on mic HW; the
   latency/quality bar set by ChatGPT Advanced Voice / Gemini Live is unmet until HW-tested.
10. **Local council-grade model.** The local lane is wired but IPEX-LLM is vet-blocked and no
    strong local model is installed — Apple runs a 1.2T MoE *on-device*; Vishu's offline story
    is a stub by comparison.

## Where Vishu genuinely leads (no major rival matches all of these)

- **Full data ownership + self-hosted, Obsidian-compatible vault** — rivals are cloud (Apple/
  Gemini only push *inference* on-device, not the data store).
- **Provider-agnostic multi-model routing + 22-key registry + local lane** — every big-tech PA
  locks you to one model family; only the open-source tier competes, and none as deep.
- **Cross-LLM self-critique through a human approval gate** (`evolve_critique`) — a genuinely
  novel capability; no rival critiques its own prompts with a *different* model behind an F0 gate.
- **Safety surface:** intent-classified action gate (send/buy/delete always-ask), out-of-band
  SIGBREAK kill switch, token/cost dashboard, eval harness — rivals hide cost and have no
  user-held kill switch.
- **MCP-native "connect any app" gateway** and a **token-free real-Chrome actuator.**

## Honest verdict

Vishu is best understood as the **privacy-first, developer-owned, model-agnostic PA**: it
matches or beats the entire field on ownership, transparency, model freedom, safety, and
extensibility, and it has one capability (gated cross-LLM self-improvement) nobody else ships.
It **trails the big platforms on the things only a platform/device owner can do well** — OS-level
app integration, on-screen/ambient/multimodal awareness, phone presence, wearable capture — and
trails on a few *buildable* fronts: learned anticipatory proactivity, productized agentic task
completion, automatic memory, verified real-time voice, and a real local model.

Recommended framing (unchanged from the item-5 audit): **"own-and-audit," not "smartest."**
The realistic roadmap is the *buildable* list (6–10) plus a thin mobile/push client; the
structural list (1–5) is a deliberate non-goal unless Vishu ships a companion mobile/OS agent.

## Sources
- [ChatGPT features 2026 (Suprmind)](https://suprmind.ai/hub/chatgpt/features/) · [ChatGPT Agent 2026](https://www.usecarly.com/blog/chatgpt-agent-mode/)
- [Gemini Proactive Assistance (Android Authority)](https://www.androidauthority.com/google-gemini-proactive-assistance-3661314/) · [Gemini Intelligence on Android (blog.google)](https://blog.google/products-and-platforms/platforms/android/gemini-intelligence/)
- [Apple introduces Siri AI (Apple Newsroom)](https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/) · [Advanced App Intents for Siri (WWDC26)](https://developer.apple.com/videos/play/wwdc2026/343/)
- [Alexa+ at CES 2026 (Gadget Flow)](https://thegadgetflow.com/blog/alexa-unleashed-at-ces-2026/) · [Alexa+ proactive smart home (FinancialContent)](https://markets.financialcontent.com/stocks/article/tokenring-2026-2-5-amazons-alexa-revolution-the-dawn-of-the-proactive-smart-home)
- [Copilot 2026 agents (Context Studios)](https://www.contextstudios.ai/blog/microsoft-365-ai-agents-the-complete-guide-to-building-and-running-agents-with-copilot-copilot-studio-and-agent-365-in-2026) · [M365 Copilot memory Nov 2026 (Windows News)](https://windowsnews.ai/article/microsoft-365-copilot-to-gain-memory-based-personalization-in-november-2026.429482)
- [AI wearables 2026 (Tom's Guide)](https://www.tomsguide.com/ai/rabbit-r1-vs-humane-ai-pin-vs-limitless-pendant-which-ai-wearable-could-win)
- [Best open-source PAs 2026 (Vellum)](https://www.vellum.ai/blog/best-open-source-personal-ai-assistants) · [Khoj (GitHub)](https://github.com/khoj-ai/khoj) · [Leon (GitHub)](https://github.com/leon-ai/leon)
