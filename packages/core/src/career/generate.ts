/** Cold-apply pipeline S2/S3: LLM generation steps — parse a pasted job posting into structure, and draft
 * a tailored cover letter. The model call is injected (`complete`) so both are unit-testable with a fake,
 * and so callers pick the lane (cheap extraction vs quality writing). ponytail: no external MCP needed —
 * generation is a plain Vishu LLM call; careerops' cover_letter is an alternative, not a requirement. */

export interface JobPosting {
  title: string;
  company: string;
  domain?: string;
  description: string;
}

type Complete = (system: string, user: string) => Promise<string>;

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const JOB_SYSTEM =
  "Extract the job posting into JSON. Reply with ONE object: " +
  '{"title":"","company":"","domain":"<company email domain if inferable, else empty>","description":"<the role summary + key requirements, trimmed>"}. ' +
  "Use empty strings for anything not present. No prose outside the JSON.";

/** Structure a pasted job posting (raw text or a fetched page) into {title, company, domain, description}.
 * Returns null when the model can't produce a usable object (never throws). */
export async function parseJobPosting(complete: Complete, raw: string): Promise<JobPosting | null> {
  if (!raw.trim()) return null;
  const j = firstJson(await complete(JOB_SYSTEM, raw));
  if (!j) return null;
  const title = str(j.title);
  const company = str(j.company);
  const description = str(j.description);
  if (!title && !company && !description) return null;
  const domain = str(j.domain) || undefined;
  return { title, company, description, domain };
}

const CL_SYSTEM =
  "You write concise, specific cover letters. 3 short paragraphs, no clichés or filler, no invented facts — " +
  "use only what the resume and job provide. Address the hiring contact by name if given, else a neutral " +
  "greeting. Output only the letter text.";

export interface CoverLetterInput {
  resumeMarkdown: string;
  job: JobPosting;
  contactName?: string;
}

/** Draft a tailored cover letter from the resume + structured job (+ optional contact name). */
export async function generateCoverLetter(complete: Complete, input: CoverLetterInput): Promise<string> {
  const user = [
    input.contactName ? `Hiring contact: ${input.contactName}` : "",
    `Role: ${input.job.title} at ${input.job.company}`,
    `Job description:\n${input.job.description}`,
    `Candidate resume:\n${input.resumeMarkdown}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return (await complete(CL_SYSTEM, user)).trim();
}
