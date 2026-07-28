/** Cold-apply pipeline S5: assemble a cold-outreach email from the cover letter + job + contact. DRAFT
 * ONLY — this builds the message; sending stays a separate, explicitly-approved step (never auto-send).
 * ponytail: pure assembly, no transport here; the draft is written to an outbox for the user to review. */

export interface ColdMail {
  to?: string;
  subject: string;
  body: string;
}

export interface DraftInput {
  job: { title: string; company: string };
  contact?: { name?: string; email?: string };
  coverLetter: string;
  fromName?: string;
  resumePath?: string;
}

function greeting(name?: string): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hello,";
}

/** Compose the draft. Subject is deterministic ("Application: <role> — <name>"); body = greeting + the
 * cover letter + a sign-off, with a resume-attachment note when a path is provided (the user attaches it). */
export function buildColdMail(input: DraftInput): ColdMail {
  const who = input.fromName?.trim();
  const subject = `Application: ${input.job.title} at ${input.job.company}${who ? ` — ${who}` : ""}`;
  const body = [
    greeting(input.contact?.name),
    input.coverLetter.trim(),
    input.resumePath ? `(Resume attached: ${input.resumePath})` : "",
    who ? `Best,\n${who}` : "Best regards,",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { to: input.contact?.email, subject, body };
}

/** Render a draft to a plain reviewable text block (To/Subject headers + body). */
export function renderDraft(mail: ColdMail): string {
  return [`To: ${mail.to ?? "(unknown — fill in)"}`, `Subject: ${mail.subject}`, "", mail.body].join("\n");
}
