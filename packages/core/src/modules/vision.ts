/** Multimodal: turn a local image path into a data: URL so it can ride ChatMessage.images to a vision
 * model. http(s) and data: URLs pass through untouched (providers fetch/accept them directly).
 * ponytail: extension→mime lookup, no magic-byte sniffing — that's the upgrade path if a caller feeds
 * a mislabelled file. */
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** MIME for an image path by extension; defaults to image/png for unknown types. Exported for testing. */
export function mimeForImage(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "image/png";
}

/** A local path becomes a base64 data: URL; an http(s) or data: URL passes through unchanged. */
export function imageToDataUrl(pathOrUrl: string): string {
  if (/^(https?:\/\/|data:)/i.test(pathOrUrl)) return pathOrUrl;
  const b64 = readFileSync(pathOrUrl).toString("base64");
  return `data:${mimeForImage(pathOrUrl)};base64,${b64}`;
}
