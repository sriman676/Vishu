# Browser actuator reliability audit — 2026-07-28

Scope: `packages/core/src/modules/browser.ts` (the real-Chrome universal actuator) + its test file.
Goal: what stops it booking/filling/confirming an end-to-end task *reliably*. Report only — no code
changed. Ranked by severity; each gap cites evidence and the minimal fix.

## What exists today (the model is sound)

Persistent real Chrome (user's logged-in profile), intent-classified tools wired to the F0 gate:
open/read/screenshot/scroll (read) · type/click (write, click refuses consequential labels) · commit
(send, always asks + pre-shot). Optional Playwright import degrades to a clean error. The *safety
architecture* is good. The *reliability* — does an action actually land, and recover when it doesn't —
is where the gaps are. Current tests cover only intent classification, action-class wiring, and the
missing-dep error path (`browser.test.ts`) — nothing exercises verification or recovery.

## SAFETY hole (fix first, cheap)

**S1 — consequential-label read fails OPEN.** `browser_click` reads the target label with a 3s timeout
and `.catch(() => "")` (browser.ts:173). On a slow-rendering or child-node label the read yields `""`,
`isConsequential("")` is false, and the control is **auto-clicked** as benign. A Submit/Send button whose
text renders late could fire unattended — the exact thing the send-class gate exists to prevent.
Minimal fix: on an empty/failed label read, treat the target as consequential (route to commit) — fail
*toward* the gate, matching the stated "ambiguous = consequential" rule (browser.ts:22). ~2 lines + test.

## Reliability gaps (ranked)

**R1 — no post-action verification (the core ask).** `type` returns `"typed"` and `click` returns
`"clicked …"` without confirming the field holds the value or the click had an effect (browser.ts:157,
178). The agent is flying blind: a silently-dropped fill or a no-op click looks like success. Fix:
after `fill`, read the field's `value` back and compare; after `click`, capture a cheap signal (URL
change / target detached / a caller-supplied expected-text appears). Return `ok`/`mismatch` so the loop
can react. This is the heart of item 3.

**R2 — no retry on transient failure.** A `click`/`fill` timeout collapses straight to `error:` with no
retry (browser.ts:81-89). Real pages flake: element not yet actionable, covered by an overlay, mid-
animation. Fix: bounded retry (2-3 attempts, short backoff, scroll-into-view between) on the
actionability class of error only — not on "not installed" / "profile missing".

**R3 — error taxonomy is a flat string.** Everything is `error: <msg>` (browser.ts:87). The agent
can't tell "element not found" (retry with a better target) from "playwright not installed" (abort) from
"timeout" (wait+retry). Fix: classify into a small enum (`not_installed | no_target | timeout |
detached | blocked | unknown`) so R2's retry and the agent both branch correctly.

**R4 — `browser_type` contradicts its own contract.** The description advertises "by `selector` or
visible `text` label" but the code throws without a CSS `selector` (browser.ts:149,155). Fills against
text-labeled inputs (most forms) just fail. Fix: route through the same `locate()` used by click, or use
Playwright `getByLabel`.

**R5 — no settle/wait after navigation-causing actions.** `open` uses `goto` (auto-waits, ok), but a
`click` that triggers an SPA route change or async form step returns immediately; the next `read`/`click`
races the new DOM (browser.ts:177). Fix: an explicit `browser_wait_for(text|selector|urlChange)` tool,
or await network-idle after write-class clicks.

**R6 — iframes/frames unreachable.** `page.fill` / `getByText` operate on the top frame only. Many job
applications, payment forms, and embedded widgets live in an iframe — the actuator can't see or fill
them. Fix: frame-aware `locate()` (search `page.frames()`), or accept a `frame` hint. Higher effort.

**R7 — single global page, no tab/popup handling.** One `pagePromise` singleton (browser.ts:49-66). An
OAuth popup, a payment window, or a "opens in new tab" apply flow can't be targeted. Fix: track context
pages, expose the active/last-opened. Higher effort; only needed for flows that spawn windows.

**R8 — commit captures pre-state only.** `browser_commit` screenshots *before* clicking (browser.ts:196)
but never after, so "did the submit actually go through?" is unverifiable. Fix: post-click settle +
second screenshot + a success/failure read, returned to the agent.

## Staged build plan (cost-ordered, when greenlit)

- **Stage C1 (cheapest, do-first):** S1 fail-closed label + R4 type-by-text + R3 error enum. Small,
  pure-logic, unit-testable without a live browser (mock Page). Closes the safety hole and the two
  cheapest reliability bugs. ~1 file touched + tests.
- **Stage C2 (the core ask):** R1 post-action verification + R2 bounded retry + R8 post-commit capture.
  Testable with a mock Page returning scripted success/flake/mismatch. This is "book/fill/confirm
  reliably" for single-frame, single-tab flows — covers the majority of real tasks.
- **Stage C3 (scope-gated, higher effort):** R5 wait-for + R6 iframes + R7 tabs/popups. Needed only for
  flows that use SPAs with slow transitions, embedded iframes, or popups. Verify against ONE concrete
  target flow (e.g. a specific job-board application) before building — don't build generically.

Recommendation: build C1 + C2 (mock-tested, no live-browser dependency, high reliability payoff), stop,
and gate C3 on a real target flow you pick. C1+C2 is the honest "harden the actuator" deliverable
without a token-fake of full end-to-end automation.
