import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import { registerBuiltins } from "./builtins.js";
import { ToolRegistry } from "./registry.js";

// A 3-page site: / links to /a and /b; /a links back to /. Enough to exercise BFS + dedup + caps.
function site(): Server {
  return createServer((req, res) => {
    const path = req.url ?? "/";
    const html =
      path === "/a" ? `<html><body>page A <a href="/">home</a></body></html>`
      : path === "/b" ? `<html><body>page B</body></html>`
      : `<html><body>home <a href="/a">A</a> <a href="/b">B</a> <a href="https://evil.example/x">off</a></body></html>`;
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
}

const crawl = registerBuiltins(new ToolRegistry()).get("web_crawl");
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, () => r((s.address() as AddressInfo).port)));

test("web_crawl follows same-origin links breadth-first and dedups", async () => {
  const s = site();
  const port = await listen(s);
  try {
    const out = String(await crawl.run({ url: `http://127.0.0.1:${port}/` }, {} as never));
    assert.match(out, /page A/, "reached /a");
    assert.match(out, /page B/, "reached /b");
    assert.doesNotMatch(out, /## https:\/\/evil\.example/, "never fetched the off-origin link");
    // home is fetched once despite /a linking back to it (dedup by seen-set)
    assert.equal(out.match(/## http:\/\/127\.0\.0\.1/g)?.length, 3, "exactly 3 pages, home not re-crawled");
  } finally {
    s.close();
  }
});

test("web_crawl honors the page cap", async () => {
  const s = site();
  const port = await listen(s);
  try {
    const out = String(await crawl.run({ url: `http://127.0.0.1:${port}/`, maxPages: 1 }, {} as never));
    assert.equal(out.match(/## http:/g)?.length, 1, "stopped at 1 page");
  } finally {
    s.close();
  }
});
