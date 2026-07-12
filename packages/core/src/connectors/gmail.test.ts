import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessage, dotStuff, GmailConnector } from "./gmail.js";

test("dotStuff: leading-dot lines are escaped and newlines become CRLF", () => {
  assert.equal(dotStuff("hello\n.hidden\nworld"), "hello\r\n..hidden\r\nworld");
  assert.equal(dotStuff("...boom"), "....boom"); // only the first dot column is doubled
  assert.equal(dotStuff("no dots"), "no dots");
});

test("buildMessage: has required headers, blank line before body, and dot-stuffed body", () => {
  const msg = buildMessage("me@gmail.com", "you@x.com", "Hi", ".dangerous\nline");
  assert.match(msg, /^From: me@gmail\.com\r\n/);
  assert.match(msg, /\r\nTo: you@x\.com\r\n/);
  assert.match(msg, /\r\nSubject: Hi\r\n/);
  assert.match(msg, /\r\n\r\n\.\.dangerous\r\nline$/); // header/body separator + escaped leading dot
});

test("GmailConnector: unconfigured is not `configured` and send throws (never silently drops)", async () => {
  const c = new GmailConnector(undefined, undefined);
  assert.equal(c.configured, false);
  await assert.rejects(() => c.send("you@x.com", "hi"), /not configured/);
});
