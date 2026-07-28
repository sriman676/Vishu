# Cold-apply pipeline — live verification runbook

Run this once your MCPs/creds are set to prove the whole flow works against a REAL job posting. Each step
lists: what to do, the exact chat prompt (Vishu's agent chains the tools), what a PASS looks like, and the
degrade message you'll see if a dependency isn't wired yet. Nothing sends until you explicitly approve.

## 0. Preconditions (set what you have; each step degrades cleanly without its dep)

| Env var | For | If unset |
|---|---|---|
| `VISHU_HIRING_AGENT_DIR` | resume scoring | `resume_score` says "set VISHU_HIRING_AGENT_DIR…" |
| hiring-agent LLM env (`OPENAI_API_KEY`+NIM, or Ollama/Gemini per its `.env.example`) | scoring runs | score returns `{error: OPENAI_API_KEY not set}` |
| `VISHU_PYTHON` (default `py`) | scoring subprocess | uses `py` |
| `APOLLO_API_KEY` / `HUNTER_API_KEY` | OSINT source | falls back to free web lane |
| `GMAIL_APP_PASSWORD` (+ Gmail user) | actually sending | draft still saved; send is blocked |
| careerops / GitHub / job MCP (`vishu connect …`) | live job + project import | use manual paste / no projects |

Start Vishu (`vishu serve` or the UI). Confirm `career_*` tools exist: ask "list your career tools".
PASS = you see career_achievement_add, resume_build, job_parse, cover_letter_generate, resume_score,
osint_contacts, coldmail_draft.

## 1. Capture achievements

Chat: `Remember these achievements: shipped the payments service #backend; cut p99 latency 40% #perf`
(or use the **Resume** tab's add box). PASS = `career_achievements` (or the tab) lists both with today's date.

## 2. Get a job posting

- Manual (no MCP): copy a real posting, then chat: `Parse this job posting: <paste the full text>`.
  PASS = `job_parse` returns JSON with a sensible title/company/domain/description.
- Via MCP (once connected): `Find backend jobs` → careerops `discover_jobs`, then parse one.

## 3. Build the resume

Chat: `Build my resume`. To include GitHub projects, first have the GitHub MCP list your repos and pass
that JSON: `Build my resume with these projects: <repos JSON>`.
PASS = `resume_build` returns markdown with Summary + (Projects) + Achievements. Also viewable in the
Resume tab.

## 4. Score it and iterate (the hiring-agent loop)

Chat: `Score my resume` (Vishu passes the built markdown to `resume_score`).
PASS = a score line (`score: N (categories …, +bonus, -deductions)`) plus an `improve:` list. Apply a
couple of the suggestions (edit achievements / summary), rebuild, re-score — the score should move.
DEGRADE = the env message from step 0 if hiring-agent isn't wired; the rest of the flow still works.

## 5. Generate the cover letter

Chat: `Write a cover letter for this job using my resume` (Vishu feeds resume markdown + the step-2 job
JSON to `cover_letter_generate`). PASS = a 3-paragraph, specific letter with no invented facts, addressed
to the contact if known.

## 6. Find the HR contact (OSINT)

Chat: `Find HR contacts at <company>, domain <company.com>`. With Apollo/Hunter connected, pass the
lookup JSON; otherwise you get the free lane + guessed email patterns (`jane.doe@…`, `jdoe@…`).
PASS = `osint_contacts` prints `source: apollo|hunter|web` and at least one contact or a set of email
guesses to try.

## 7. Draft the cold mail (never auto-sends)

Chat: `Draft the outreach email` (Vishu calls `coldmail_draft` with the cover letter + job + contact).
PASS = a `draft saved: <workspace>/outbox/draft-*.txt` path + the rendered To/Subject/body. Open the file
and review.

## 8. Approve and send (explicit)

Review the draft. Only when you say so: `Send it` → the send-class F0 gate asks for a typed confirm, then
the GmailConnector sends (needs `GMAIL_APP_PASSWORD`). Or send manually from the outbox file. PASS = one
message sent, logged in the audit trail; the daily send-cap decremented.

## End-to-end PASS

Achievements captured → resume built → scored + improved → cover letter written → HR contact found →
draft saved → sent only on your explicit approval. Any step whose MCP/cred is missing degrades to a clear
message without breaking the others — wire that dep and re-run just that step.
