import { test } from "node:test";
import assert from "node:assert/strict";
import { buildColdMail, renderDraft } from "./draft.js";

test("buildColdMail: subject, greeting by first name, sign-off, resume note", () => {
  const mail = buildColdMail({
    job: { title: "Backend Engineer", company: "Acme" },
    contact: { name: "Jane Doe", email: "jane@acme.com" },
    coverLetter: "I build reliable services.",
    fromName: "Sriman",
    resumePath: "C:/resume.pdf",
  });
  assert.equal(mail.to, "jane@acme.com");
  assert.equal(mail.subject, "Application: Backend Engineer at Acme — Sriman");
  assert.match(mail.body, /^Hi Jane,/);
  assert.match(mail.body, /I build reliable services\./);
  assert.match(mail.body, /Resume attached: C:\/resume\.pdf/);
  assert.match(mail.body, /Best,\nSriman$/);
});

test("buildColdMail: neutral greeting + placeholder when contact unknown", () => {
  const mail = buildColdMail({ job: { title: "Dev", company: "X" }, coverLetter: "Hello." });
  assert.equal(mail.to, undefined);
  assert.match(mail.body, /^Hello,/);
  assert.match(renderDraft(mail), /To: \(unknown — fill in\)/);
  assert.match(renderDraft(mail), /Subject: Application: Dev at X/);
});
