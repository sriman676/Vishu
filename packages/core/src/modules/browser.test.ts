import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { browserModule, isConsequential, registerBrowserTools } from "./browser.js";

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
  assert.match(String(out), /error:/);
  if (prev !== undefined) process.env.VISHU_CHROME_PROFILE = prev;
});
