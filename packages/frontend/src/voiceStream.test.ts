import assert from "node:assert/strict";
import { test } from "node:test";
import { isSpeech, rmsEnergy, splitSentences } from "./voiceStream.js";

test("splitSentences: chunks on sentence boundaries, keeps a punctuation-less run whole", () => {
  assert.deepEqual(splitSentences("Hi there. How are you? I am fine!"), ["Hi there.", "How are you?", "I am fine!"]);
  assert.deepEqual(splitSentences("no punctuation here"), ["no punctuation here"]);
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences('She said "Go." We went.'), ['She said "Go."', "We went."]);
  // A decimal over-splits at worst — still non-empty chunks, never data loss.
  assert.equal(splitSentences("Pi is 3.14 roughly.").join(" "), "Pi is 3.14 roughly.");
});

test("rmsEnergy + isSpeech: silence reads quiet, a loud frame reads as speech", () => {
  assert.equal(rmsEnergy(new Float32Array(0)), 0);
  assert.equal(rmsEnergy(new Float32Array([0, 0, 0, 0])), 0);
  const loud = new Float32Array(256).fill(0.5);
  assert.ok(rmsEnergy(loud) > 0.4);
  assert.equal(isSpeech(loud), true);
  assert.equal(isSpeech(new Float32Array(256).fill(0.001)), false);
});
