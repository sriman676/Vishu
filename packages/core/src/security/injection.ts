export type InjectionVerdict = "allow" | "review" | "block";

// Strong signals of an attempt to exfiltrate secrets — block before any run.
const BLOCK = [
  /\b(print|show|reveal|send|exfiltrate|leak)\b[^\n]*\b(api[_ -]?key|secret|token|password|credential|\.env)\b/i,
  /\bcat\b[^\n]*(\.env|id_rsa|core\.token|credentials)/i,
];

// Classic prompt-injection phrasing — flag for review (the caller may downgrade to allow).
const REVIEW = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts|rules)/i,
  /disregard (the )?(system|previous|above)/i,
  /you are now\b|new instructions:/i,
  /\bsystem prompt\b/i,
];

/** Scan untrusted text (tool inputs, fetched content) before it drives an action. */
export function guardInjection(text: string): InjectionVerdict {
  if (BLOCK.some((re) => re.test(text))) return "block";
  if (REVIEW.some((re) => re.test(text))) return "review";
  return "allow";
}
