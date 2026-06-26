import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../providers/types.js";
import { compactTranscript } from "./compact.js";
import { htmlToMarkdown } from "./html.js";
import { compressShellOutput } from "./shellfilter.js";
import { dedupeLines, summarizeToolResult } from "./summarize.js";

test("compressShellOutput drops install noise, keeps errors, leaves short output alone", () => {
  const noisy = [
    "$ npm install",
    ...Array(30).fill("npm warn deprecated foo@1.0.0: do not use"),
    "added 250 packages",
    "audited 400 packages",
    "npm error could not resolve dependency bar@2",
  ].join("\n");
  const { text } = compressShellOutput("npm install", noisy, 0);
  assert.match(text, /could not resolve dependency bar@2/); // real error survives
  assert.doesNotMatch(text, /added 250 packages/); // install noise dropped
  assert.ok(text.length < noisy.length / 2, "noisy output is markedly smaller");

  const short = "exit=0\nall good";
  assert.equal(compressShellOutput("ls", short, 0).text, short); // short output untouched
});

test("compressShellOutput preserves failure context (non-zero exit skips command filters)", () => {
  const out = ["building…", ...Array(20).fill("added 1 package"), "FAILED: linker error"].join("\n");
  const { text } = compressShellOutput("npm install", out, 1);
  assert.match(text, /FAILED: linker error/);
  assert.match(text, /added 1 package/); // not stripped on failure — context kept
});

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
