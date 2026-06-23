import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../providers/types.js";
import { compactTranscript } from "./compact.js";
import { htmlToMarkdown } from "./html.js";
import { dedupeLines, summarizeToolResult } from "./summarize.js";

test("htmlToMarkdown shrinks HTML markedly and keeps text", () => {
  const html =
    "<html><head><style>body{color:red}</style><script>evil()</script></head>" +
    "<body><h1>Title</h1><p>Hello <a href='https://x.com'>link</a></p></body></html>";
  const md = htmlToMarkdown(html);
  assert.ok(md.includes("# Title"));
  assert.ok(md.includes("Hello"));
  assert.ok(!md.includes("evil()"));
  assert.ok(md.length < html.length / 2);
});

test("summarizeToolResult dedupes and clips", () => {
  const noisy = Array(500).fill("repeated log line").join("\n");
  assert.equal(dedupeLines(noisy), "repeated log line");
  const big = "x".repeat(20_000);
  assert.ok(summarizeToolResult(big, 1000).length < 1100);
});

test("compactTranscript condenses old tool results, keeps recent", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "tool", content: "OLD ".repeat(500), toolCallId: "0", name: "x" },
    ...Array.from({ length: 8 }, (_, i): ChatMessage => ({ role: "user", content: `recent ${i}` })),
  ];
  const compacted = compactTranscript(messages, { keepRecent: 8, staleToolMax: 100 });
  const oldTool = compacted.find((m) => m.role === "tool");
  assert.ok((oldTool?.content.length ?? 0) <= 200);
  assert.equal(compacted.at(-1)?.content, "recent 7");
});
