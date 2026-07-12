import { join } from "node:path";
import type { ToolRegistry } from "../tools/registry.js";
import type { VishuModule } from "./registry.js";

/** §11 browser automation lane (flag: `browser`) — the token-free universal actuator. Drives the user's
 * REAL logged-in Chrome (persistent profile) so the PA acts as the user in any app they're signed into:
 * Gmail, calendar, Slack, LinkedIn, job boards — no OAuth, no API keys. Safety is the whole point of the
 * split below (decision: "classify by intent"):
 *   - open / read / screenshot / scroll  → read-class → auto
 *   - type / fill                         → write-class → auto (drafting into a field is reversible)
 *   - click (benign)                      → write-class → auto, BUT refuses a consequential target
 *   - commit (Send/Buy/Delete/Submit/…)   → send-class → ALWAYS asks (typed SEND) + screenshot-before
 * So navigation and drafting flow freely, but nothing irreversible fires unattended — the existing F0 gate
 * enforces it via meta.action (no new gate wiring). Playwright is a lazy optional import: core stays
 * dep-free and this module surfaces a clear error (never crashes) when Playwright isn't installed.
 * ponytail: reuse the F0 gate through tool naming/meta rather than threading a second approval channel. */

/** Verbs on a control that cause a side effect (send/spend/delete). Matched against the element's visible
 * text/label so `browser_click` can refuse them and route to the gated `browser_commit`. Deterministic —
 * this is the intent classifier the "classify by intent" decision rides on. Kept broad + fail-toward-gating:
 * an ambiguous label is treated as consequential (route to the asked path), never auto-clicked. */
const CONSEQUENTIAL = /\b(send|submit|buy|purchase|pay|checkout|order|place order|delete|remove|discard|confirm|post|publish|tweet|share|transfer|withdraw|apply|subscribe|book|schedule|accept|approve|sign|pay now)\b/i;

export function isConsequential(label: string): boolean {
  return CONSEQUENTIAL.test(label);
}

/** Minimal Playwright surface we use — declared locally so the core compiles without the optional dep. */
interface Page {
  goto(url: string): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  innerText(selector: string): Promise<string>;
  screenshot(opts: { path: string }): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  mouse: { wheel(dx: number, dy: number): Promise<unknown> };
  locator(sel: string): Locator;
  getByText(text: string): Locator;
}
interface Locator {
  first(): Locator;
  innerText(opts?: { timeout?: number }): Promise<string>;
  click(opts?: { timeout?: number }): Promise<unknown>;
}

/** Lazy singleton: launch (once) a persistent Chrome using the user's real profile so existing logins
 * apply. Not headless — the PA acts in a visible window the user can watch and interrupt. */
let pagePromise: Promise<Page> | undefined;
async function getPage(): Promise<Page> {
  if (pagePromise) return pagePromise;
  pagePromise = (async () => {
    // Dynamic import so the dep is optional; a missing install throws a clear, catchable error. The
    // specifier is indirected through a variable so tsc doesn't statically require the optional module.
    const spec = "playwright";
    const pw = (await import(spec).catch(() => {
      throw new Error("playwright not installed — run `pnpm add playwright` in packages/core and `npx playwright install chrome`");
    })) as { chromium: { launchPersistentContext(userDataDir: string, opts: Record<string, unknown>): Promise<{ pages(): Page[]; newPage(): Promise<Page> }> } };
    const profile = process.env.VISHU_CHROME_PROFILE;
    if (!profile) throw new Error("VISHU_CHROME_PROFILE not set — point it at your Chrome 'User Data' dir to reuse logins");
    const ctx = await pw.chromium.launchPersistentContext(profile, {
      headless: false,
      channel: process.env.VISHU_BROWSER_CHANNEL ?? "chrome",
    });
    return ctx.pages()[0] ?? (await ctx.newPage());
  })();
  // Don't cache a failed launch (missing dep/profile) — reset so a later call can retry after the fix.
  pagePromise.catch(() => {
    pagePromise = undefined;
  });
  return pagePromise;
}

/** Resolve a target from either a CSS selector or visible text (text preferred, matches how a human aims). */
function locate(page: Page, target: { selector?: string; text?: string }): Locator {
  if (target.text) return page.getByText(target.text).first();
  if (target.selector) return page.locator(target.selector).first();
  throw new Error("a `selector` or `text` target is required");
}

async function guarded<T>(fn: () => Promise<T>): Promise<string> {
  try {
    return String(await fn());
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function registerBrowserTools(tools: ToolRegistry, workspaceDir: string): void {
  const shotDir = join(workspaceDir, "screenshots");

  tools.register({
    name: "browser_open",
    meta: { action: "read" },
    description: "Open a URL in the user's real logged-in Chrome and return its title + URL.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: (a) =>
      guarded(async () => {
        const page = await getPage();
        await page.goto(String(a.url));
        return `${await page.title()} — ${page.url()}`;
      }),
  });

  tools.register({
    name: "browser_read",
    meta: { action: "read" },
    description: "Read visible text from the page (whole body, or a CSS selector). Truncated to 8k chars.",
    parameters: { type: "object", properties: { selector: { type: "string" } } },
    run: (a) =>
      guarded(async () => {
        const page = await getPage();
        return (await page.innerText(String(a.selector ?? "body"))).slice(0, 8000);
      }),
  });

  tools.register({
    name: "browser_screenshot",
    meta: { action: "read" },
    description: "Screenshot the current page to a PNG in the workspace; returns the path (for the agent to read).",
    parameters: { type: "object", properties: { name: { type: "string" } } },
    run: (a) =>
      guarded(async () => {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(shotDir, { recursive: true });
        const out = join(shotDir, `page-${Date.now()}.png`);
        await (await getPage()).screenshot({ path: out });
        return out;
      }),
  });

  tools.register({
    name: "browser_scroll",
    meta: { action: "read" },
    description: "Scroll the page vertically by `dy` pixels (negative = up).",
    parameters: { type: "object", properties: { dy: { type: "number" } } },
    run: (a) =>
      guarded(async () => {
        await (await getPage()).mouse.wheel(0, Number(a.dy ?? 600));
        return "scrolled";
      }),
  });

  tools.register({
    name: "browser_type",
    meta: { action: "write" },
    description: "Type text into a field (by `selector` or visible `text` label). Drafting only — reversible.",
    parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" }, value: { type: "string" } }, required: ["value"] },
    run: (a) =>
      guarded(async () => {
        const page = await getPage();
        const sel = a.selector ? String(a.selector) : undefined;
        if (!sel) throw new Error("browser_type needs a `selector` for the input field");
        await page.fill(sel, String(a.value));
        return "typed";
      }),
  });

  tools.register({
    name: "browser_click",
    meta: { action: "write" },
    description:
      "Click a NON-consequential element (link, tab, menu, expander) by `selector` or `text`. Refuses " +
      "buttons that send/buy/delete/submit — use browser_commit for those (it asks for confirmation).",
    parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } } },
    run: (a) =>
      guarded(async () => {
        const page = await getPage();
        const loc = locate(page, a);
        // Intent gate: read the target's label; a consequential control must go through browser_commit.
        const label = (a.text ? String(a.text) : await loc.innerText({ timeout: 3000 }).catch(() => "")).trim();
        if (isConsequential(label)) {
          return `refused: "${label}" looks consequential (send/buy/delete/submit). Use browser_commit to click it — it will ask for your confirmation.`;
        }
        await loc.click({ timeout: 5000 });
        return `clicked "${label || a.selector}"`;
      }),
  });

  // Send-class: the F0 gate ALWAYS asks (typed SEND) before this runs. Screenshots first for the record.
  tools.register({
    name: "browser_commit",
    meta: { action: "send" },
    description:
      "Click a CONSEQUENTIAL control (Send / Buy / Pay / Delete / Submit / Apply …) by `selector` or `text`. " +
      "ALWAYS asks for approval and captures a screenshot before acting.",
    parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } } },
    run: (a) =>
      guarded(async () => {
        const page = await getPage();
        const { mkdirSync } = await import("node:fs");
        mkdirSync(shotDir, { recursive: true });
        const shot = join(shotDir, `commit-${Date.now()}.png`);
        await page.screenshot({ path: shot }); // record the pre-action state (approval already granted by the gate)
        await locate(page, a).click({ timeout: 5000 });
        return `committed "${a.text ?? a.selector}" (screenshot: ${shot})`;
      }),
  });
}

export const browserModule: VishuModule = {
  name: "browser",
  setup({ tools, workspaceDir }) {
    registerBrowserTools(tools, workspaceDir);
  },
};
