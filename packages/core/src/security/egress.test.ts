import assert from "node:assert/strict";
import { test } from "node:test";
import { decideEgress, egressAllowlist } from "./policy.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import { makePolicy } from "./policy.js";

test("decideEgress: allowlisted provider hosts pass, others warn", () => {
  const allow = egressAllowlist();
  assert.equal(decideEgress("https://api.openai.com/v1/chat", allow).allowlisted, true);
  assert.equal(decideEgress("http://localhost:8080/api", allow).allowlisted, true);
  assert.equal(decideEgress("https://evil.example.com/steal", allow).allowlisted, false);
  assert.equal(decideEgress("not a url", allow).allowlisted, false); // malformed → not allowlisted
});

test("decideEgress: VISHU_EGRESS_ALLOWLIST extends the set", () => {
  process.env.VISHU_EGRESS_ALLOWLIST = "search.mine.internal";
  try {
    assert.equal(decideEgress("https://search.mine.internal/q").allowlisted, true);
  } finally {
    delete process.env.VISHU_EGRESS_ALLOWLIST;
  }
});

test("web_fetch: a non-allowlisted outbound URL triggers an [egress] warning", async () => {
  const registry = registerBuiltins(new ToolRegistry());
  const webFetch = registry.get("web_fetch");
  assert.ok(webFetch, "web_fetch tool registered");

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("hello", { headers: { "content-type": "text/plain" } });
  try {
    const ctx = { policy: makePolicy("full", process.cwd()), terminal: {} as never };
    const out = await webFetch.run({ url: "https://evil.example.com/x" }, ctx);
    assert.match(out, /\[egress\] outbound to non-allowlisted host/);

    const clean = await webFetch.run({ url: "https://api.openai.com/x" }, ctx);
    assert.doesNotMatch(clean, /\[egress\]/); // allowlisted host: no warning
  } finally {
    globalThis.fetch = realFetch;
  }
});
