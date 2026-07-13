import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./dlp.js";

test("redact masks secrets and PII", () => {
  assert.match(redact("key AKIA1234567890ABCDEF here"), /\[REDACTED:aws-key\]/);
  assert.match(redact("auth sk-ant-api03-abcdefghijklmnop1234"), /\[REDACTED:api-key\]/);
  assert.match(redact("token ghp_abcdefghijklmnopqrstuvwxyz0123"), /\[REDACTED:api-key\]/);
  assert.match(redact("mail me at jane.doe@example.com ok"), /\[REDACTED:email\]/);
  assert.match(redact("Authorization: Bearer abcdefghijklmnopqrstuvwx"), /\[REDACTED:bearer\]/);
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
  assert.equal(redact(pem), "[REDACTED:private-key]");
});

test("redact masks Luhn-valid cards but leaves other long digit runs alone", () => {
  assert.match(redact("card 4111 1111 1111 1111 charged"), /\[REDACTED:card\]/);
  const notACard = "order 4111111111111112 shipped"; // 16 digits, fails Luhn
  assert.equal(redact(notACard), notACard);
  const orderId = "ref 1234567890 done"; // 10 digits, too short for a card
  assert.equal(redact(orderId), orderId);
});

test("redact leaves ordinary text and empty input untouched", () => {
  assert.equal(redact(""), "");
  const plain = "Build succeeded in 12s with 0 errors.";
  assert.equal(redact(plain), plain);
});
