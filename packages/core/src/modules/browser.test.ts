import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { browserModule, isConsequential, shouldRefuseClick, classifyBrowserError, locateField, withRetry, registerBrowserTools } from "./browser.js";

const noSleep = async () => {};

test("isConsequential: gates send/buy/delete/submit labels, allows benign navigation", () => {
  for (const yes of ["Send", "Send message", "Buy now", "Pay", "Delete", "Submit application", "Post", "Publish", "Apply", "Confirm order"])
    assert.equal(isConsequential(yes), true, yes);
  for (const no of ["Inbox", "Next", "Settings", "Compose", "Reply", "Show more", "Tab 2", "Back"])
    assert.equal(isConsequential(no), false, no);
});

test("browser tools register with intent-correct action classes (F0 gate wiring)", () => {
  const tools = new ToolRegistry();
  registerBrowserTools(tools, "/tmp/ws");
  // read-class → auto; write-class → auto draft; send-class → ALWAYS asks (typed confirm).
  assert.equal(tools.getAction("browser_open"), "read");
  assert.equal(tools.getAction("browser_read"), "read");
  assert.equal(tools.getAction("browser_screenshot"), "read");
  assert.equal(tools.getAction("browser_scroll"), "read");
  assert.equal(tools.getAction("browser_type"), "write");
  assert.equal(tools.getAction("browser_click"), "write");
  assert.equal(tools.getAction("browser_commit"), "send"); // the only gated one
  assert.equal(browserModule.name, "browser");
});

test("browser tools surface a clean error (never crash) when a target/profile is missing", async () => {
  const tools = new ToolRegistry();
  registerBrowserTools(tools, "/tmp/ws");
  // No VISHU_CHROME_PROFILE / no playwright here → the lazy launch fails with a caught error string.
  const prev = process.env.VISHU_CHROME_PROFILE;
  delete process.env.VISHU_CHROME_PROFILE;
  const out = await tools.get("browser_open").run({ url: "https://example.com" }, {} as never);
  assert.match(String(out), /error\(not_installed\):/); // R3: classified error taxonomy, still never crashes
  if (prev !== undefined) process.env.VISHU_CHROME_PROFILE = prev;
});

test("S1 shouldRefuseClick: refuses consequential AND unreadable/empty labels, allows benign", () => {
  assert.equal(shouldRefuseClick("Submit application"), true); // consequential
  assert.equal(shouldRefuseClick(""), true); // unreadable → fail closed
  assert.equal(shouldRefuseClick("   "), true); // whitespace-only → fail closed
  assert.equal(shouldRefuseClick("Next"), false); // benign nav
  assert.equal(shouldRefuseClick("Show more"), false);
});

test("R3 classifyBrowserError: maps messages to actionable tags", () => {
  assert.equal(classifyBrowserError("playwright not installed — run pnpm add"), "not_installed");
  assert.equal(classifyBrowserError("VISHU_CHROME_PROFILE not set"), "not_installed");
  assert.equal(classifyBrowserError("locator.click: Timeout 5000ms exceeded — timed out"), "timeout");
  assert.equal(classifyBrowserError("element is not attached to the DOM (detached)"), "detached");
  assert.equal(classifyBrowserError("<button> intercepts pointer events"), "blocked");
  assert.equal(classifyBrowserError("locator resolved to 0 elements"), "no_target");
  assert.equal(classifyBrowserError("something odd happened"), "unknown");
});

test("R4 locateField: selector uses locator, text uses getByLabel, neither throws", () => {
  const calls: string[] = [];
  const loc = { first: () => loc } as never;
  const page = {
    locator(s: string) { calls.push(`locator:${s}`); return loc; },
    getByLabel(t: string) { calls.push(`label:${t}`); return loc; },
  } as never;
  locateField(page, { selector: "#email" });
  locateField(page, { text: "Email address" });
  assert.deepEqual(calls, ["locator:#email", "label:Email address"]);
  assert.throws(() => locateField(page, {}), /selector.*or.*text|text.*label/i);
});

test("R2 withRetry: retries a transient (timeout) action then succeeds", async () => {
  let n = 0;
  const out = await withRetry(async () => {
    if (++n < 3) throw new Error("locator.click: Timeout 5000ms exceeded");
    return "ok";
  }, 3, 1, noSleep);
  assert.equal(out, "ok");
  assert.equal(n, 3);
});

test("R2 withRetry: does NOT retry a non-retryable (no_target) error", async () => {
  let n = 0;
  await assert.rejects(
    withRetry(async () => {
      n++;
      throw new Error("locator resolved to 0 elements");
    }, 3, 1, noSleep),
    /resolved to 0/,
  );
  assert.equal(n, 1); // no wasted retries on a bad selector
});

test("R2 withRetry: rethrows after exhausting attempts", async () => {
  let n = 0;
  await assert.rejects(
    withRetry(async () => {
      n++;
      throw new Error("Timeout exceeded");
    }, 2, 1, noSleep),
    /Timeout/,
  );
  assert.equal(n, 2);
});
