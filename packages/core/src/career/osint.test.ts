import { test } from "node:test";
import assert from "node:assert/strict";
import { contactSource, guessEmails, parseContacts } from "./osint.js";

test("contactSource: key precedence, free web default", () => {
  assert.equal(contactSource({ APOLLO_API_KEY: "k" } as never), "apollo");
  assert.equal(contactSource({ HUNTER_API_KEY: "k" } as never), "hunter");
  assert.equal(contactSource({} as never), "web");
});

test("guessEmails: common corporate patterns from name + domain", () => {
  const g = guessEmails("Jane Q. Doe", "acme.com");
  assert.deepEqual(g, ["jane.doe@acme.com", "janedoe@acme.com", "jdoe@acme.com", "jane_doe@acme.com", "jane@acme.com", "doe@acme.com"]);
  // domain is normalised (strip @, scheme, path)
  assert.deepEqual(guessEmails("Sam Lee", "https://Corp.io/team"), [
    "sam.lee@corp.io",
    "samlee@corp.io",
    "slee@corp.io",
    "sam_lee@corp.io",
    "sam@corp.io",
    "lee@corp.io",
  ]);
  assert.deepEqual(guessEmails("Cher", "x.com"), ["cher@x.com"]); // single name
  assert.deepEqual(guessEmails("", "x.com"), []);
  assert.deepEqual(guessEmails("Jane Doe", ""), []);
});

test("parseContacts: bare array, wrappers, JSON string, garbage", () => {
  assert.deepEqual(parseContacts([{ name: "Jane", email: "j@a.com", title: "HR Lead" }], "apollo"), [
    { name: "Jane", email: "j@a.com", role: "HR Lead", source: "apollo" },
  ]);
  // Hunter-style: first/last split + `value` email
  assert.deepEqual(parseContacts({ emails: [{ first_name: "Sam", last_name: "Lee", value: "s@a.com", position: "Recruiter" }] }, "hunter"), [
    { name: "Sam Lee", email: "s@a.com", role: "Recruiter", source: "hunter" },
  ]);
  assert.equal(parseContacts('{"people":[{"email":"x@y.com"}]}').length, 1);
  assert.deepEqual(parseContacts("not json"), []);
  assert.deepEqual(parseContacts({ nothing: 1 }), []);
});
