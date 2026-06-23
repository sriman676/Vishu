/** Drop consecutive duplicate lines (noisy logs, repeated stack frames). */
export function dedupeLines(text: string): string {
  const out: string[] = [];
  let prev: string | undefined;
  for (const line of text.split("\n")) {
    if (line.trim() && line === prev) continue;
    out.push(line);
    prev = line;
  }
  return out.join("\n");
}

/** Replace long/query-heavy URLs with a short origin+path form to save tokens. */
export function shortenUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s)]+/g, (url) => {
    if (url.length <= 60) return url;
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname.slice(0, 40)}…`;
    } catch {
      return `${url.slice(0, 57)}…`;
    }
  });
}

/** Clip an over-long tool result, keeping head + tail (where errors usually live). */
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n…[${text.length - max} chars elided]…\n${text.slice(-tail)}`;
}

/** Full tool-result squeeze: dedupe → shorten URLs → clip. */
export function summarizeToolResult(text: string, max = 8000): string {
  return clipMiddle(shortenUrls(dedupeLines(text)), max);
}
