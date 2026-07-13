/**
 * DLP redaction (PAUL govern): mask secrets/PII in tool output before it re-enters the transcript
 * and is shipped to the (possibly cloud) provider. High-precision patterns only — a false redaction
 * corrupts the model's context, so these match real credential shapes, not any long string.
 */
const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { kind: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "api-key", re: /\b(?:sk-ant-|sk-or-|sk-|ghp_|gho_|ghs_|ghu_|github_pat_|xox[baprs]-|AIza)[A-Za-z0-9_-]{16,}\b/g },
  { kind: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

/** Standard Luhn checksum — gates card redaction so arbitrary long digit runs (ids, hashes) survive. */
function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0 && digits.length >= 13;
}

/** Replace secrets/PII with `[REDACTED:<kind>]`; leaves ordinary text untouched. */
export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { kind, re } of PATTERNS) out = out.replace(re, `[REDACTED:${kind}]`);
  // Cards last: only mask 13–19 digit runs that actually pass Luhn.
  out = out.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => (luhn(m.replace(/[ -]/g, "")) ? "[REDACTED:card]" : m));
  return out;
}
