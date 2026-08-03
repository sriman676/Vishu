export interface UpdateManifest {
  version: string;
  signed?: boolean;
  sha256?: string | null;
  url?: string;
}

export interface UpdateStatus {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/** True when `b` is strictly newer than `a`. Compares dotted numeric cores (a leading `v` and any
 * pre-release suffix are ignored) — enough for "is there a newer build?". */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((s) => parseInt(s, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

export function updateStatus(current: string, manifest: UpdateManifest): UpdateStatus {
  return { current, latest: manifest.version, updateAvailable: isNewer(current, manifest.version) };
}

/** Fetch a release manifest (dist/latest.json, published by scripts/release.ps1) and compare it to the
 * running version. Network — the CLI wraps this; the pure compare above is what's unit-tested. */
export async function checkUpdate(url: string, current: string, fetchImpl: typeof fetch = fetch): Promise<UpdateStatus> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`update check failed: ${res.status} ${res.statusText}`);
  const manifest = (await res.json()) as UpdateManifest;
  if (!manifest.version) throw new Error("update manifest is missing a version");
  return updateStatus(current, manifest);
}
