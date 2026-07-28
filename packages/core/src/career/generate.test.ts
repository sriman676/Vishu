import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJobPosting, generateCoverLetter } from "./generate.js";

test("parseJobPosting: structures a posting from model JSON", async () => {
  const complete = async () => '{"title":"Backend Engineer","company":"Acme","domain":"acme.com","description":"Build APIs. Need Go."}';
  const job = await parseJobPosting(complete, "We are hiring a Backend Engineer at Acme...");
  assert.deepEqual(job, { title: "Backend Engineer", company: "Acme", domain: "acme.com", description: "Build APIs. Need Go." });
});

test("parseJobPosting: empty domain omitted; empty input/garbage => null", async () => {
  const job = await parseJobPosting(async () => '{"title":"Dev","company":"X","domain":"","description":"d"}', "text");
  assert.equal(job?.domain, undefined);
  assert.equal(await parseJobPosting(async () => "{}", ""), null); // empty input, no model call needed
  assert.equal(await parseJobPosting(async () => "no json here", "text"), null);
  assert.equal(await parseJobPosting(async () => '{"title":"","company":"","description":""}', "text"), null);
});

test("generateCoverLetter: passes resume + job + contact into the prompt", async () => {
  let seenUser = "";
  const complete = async (_s: string, u: string) => {
    seenUser = u;
    return "  Dear Jane,\n\nI'd be a great fit...\n  ";
  };
  const letter = await generateCoverLetter(complete, {
    resumeMarkdown: "# Resume\nBackend engineer",
    job: { title: "Backend Engineer", company: "Acme", description: "Build APIs" },
    contactName: "Jane Doe",
  });
  assert.equal(letter, "Dear Jane,\n\nI'd be a great fit..."); // trimmed
  assert.match(seenUser, /Hiring contact: Jane Doe/);
  assert.match(seenUser, /Role: Backend Engineer at Acme/);
  assert.match(seenUser, /Backend engineer/); // resume included
});
