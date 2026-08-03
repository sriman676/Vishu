# Launch copy — ready to post

Popularity comes from putting this in front of the right audiences. The repo is launch-ready (video, honest README, a proven bench, MIT, one-click install). Below is tuned copy per channel — **you post these; they publish under your identity.**

Best-fit audiences, in order: **r/LocalLLaMA** (the local-first + key-ring angle lands hardest here), **Hacker News (Show HN)**, **X/Twitter**. Post the video natively where you can (upload `brag-output/brag.mp4`); it out-performs a link.

---

## Show HN

> **Title:** Show HN: Vishu – a local-first personal assistant that never hits a rate limit
>
> I got tired of agents stalling on a single provider's 429, so I built one that pools every key I have — Anthropic, OpenAI, a Gemini free tier, Groq, and my laptop's local model — into one ring. On a 429 it fails over; under a burst it load-balances. My laptop's model is just another key in the ring.
>
> It's a personal assistant, not just a coding tool: local offline vision (moondream), voice (STT/TTS + barge-in), an Obsidian-editable memory vault, and a two-way MCP gateway (`vishu connect <app>` mounts any of 1000+ apps; `vishu mcp-serve` re-exposes Vishu to other agents).
>
> The throughput claim isn't a slogan — there's a deterministic bench in the repo: 40/40 concurrent calls complete under a burst that stalls a single-client setup at 10/40.
>
> MIT, Node ≥ 24, one-click install on Windows. Feedback welcome, especially on the key-ring design.

---

## r/LocalLLaMA

> **Title:** I built a local-first assistant where your local model is just another key in a fail-over ring
>
> Cloud agents die on one provider's rate limit. Vishu treats every key you have — including your local Ollama/IPEX model — as a pool: `failover` rotates off a 429, `balance` round-robins a burst. So your local model isn't a fallback afterthought, it's a first-class member of the ring.
>
> Local all the way down: offline vision (moondream on an Arc iGPU), whisper.cpp + Piper voice, a plaintext markdown memory vault you own. MCP gateway both directions.
>
> Deterministic proof in the repo (no keys needed): 40/40 vs 10/40 under a burst. MIT. [link]

---

## X / Twitter

> Meet Vishu — a local-first personal-assistant AI that never hits a rate limit.
>
> Pool every provider key + your laptop's own model into one ring. One 429 → it fails over. Local vision, voice, two-way MCP gateway. 458 tests, 0 failing. MIT.
>
> [attach brag-output/brag.mp4]

*(Seed caption also in `brag-output/share-copy.txt`.)*

---

## Before you post — 15-minute repo polish

- [ ] Set the GitHub **social preview** image to `brag-output/brag.jpg` (repo → Settings → General → Social preview — this is a web-UI upload, the one thing the CLI can't do).
- [ ] Confirm repo **description + topics** are set (done via `gh` in this session — verify they read well).
- [ ] Cut a **v0.1.0 Release**: bump `package.json` (currently `0.0.0`), tag, paste the CHANGELOG "Unreleased" notes, attach `brag.mp4`. A release is a linkable launch artifact GitHub indexes.
- [ ] Pin the repo on your GitHub profile.
