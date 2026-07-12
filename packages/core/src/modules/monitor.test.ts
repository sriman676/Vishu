import assert from "node:assert/strict";
import { test } from "node:test";
import { _sources, checkSource } from "./monitor.js";

const github = _sources.find((s) => s.name === "github")!;

test("checkSource: unconfigured source reports so, never fakes", async () => {
  const out = await checkSource(github, {} as NodeJS.ProcessEnv);
  assert.match(out, /github: not configured \(set GITHUB_TOKEN\)/);
});

test("checkSource: configured source fetches + summarizes; non-2xx surfaces", async () => {
  const okFetch = (async () => ({ ok: true, status: 200, json: async () => [1, 2, 3] }) as unknown as Response) as typeof fetch;
  assert.match(await checkSource(github, { GITHUB_TOKEN: "t" } as NodeJS.ProcessEnv, okFetch), /3 unread GitHub/);

  const badFetch = (async () => ({ ok: false, status: 401 }) as unknown as Response) as typeof fetch;
  assert.match(await checkSource(github, { GITHUB_TOKEN: "t" } as NodeJS.ProcessEnv, badFetch), /error 401/);
});
