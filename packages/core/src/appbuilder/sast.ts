import { fileURLToPath } from "node:url";
import { callSidecar } from "../modules/voice.js"; // shared stdio-JSON sidecar IPC helper

export interface SastFinding {
  rule?: string;
  path?: string;
  line?: number;
  severity?: string;
  message?: string;
}

function sidecarArgv(env = process.env): string[] {
  if (env.VISHU_SAST_CMD) return JSON.parse(env.VISHU_SAST_CMD) as string[];
  const python = env.VISHU_VOICE_PYTHON ?? "python";
  const sidecar = env.VISHU_SAST_SIDECAR ?? fileURLToPath(new URL("../../sidecar/semgrep_scan.py", import.meta.url));
  return [python, sidecar];
}

/** Phase 11 "real SAST depth": run Semgrep over a built app via the Python sidecar (authz/RLS/taint rules
 * the deterministic scanner can't express). Optional — semgrep/Python absent returns `{ available:false }`
 * so the deterministic scanner stays the hard gate and this only *adds* findings. ponytail: advisory by
 * default (`gate:true` makes any error/high finding blocking once you trust your rule set). */
export async function semgrepScan(
  path: string,
  opts: { config?: string } = {},
  env = process.env,
): Promise<{ available: boolean; findings: SastFinding[]; error?: string }> {
  try {
    const res = await callSidecar(sidecarArgv(env), { path, config: opts.config ?? "auto" });
    if (res.error) return { available: false, findings: [], error: String(res.error) };
    return { available: true, findings: (res.findings as SastFinding[]) ?? [] };
  } catch (e) {
    return { available: false, findings: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Blocking SAST findings (error/high severity) — empty unless you opt into gating on Semgrep. */
export function blockingFindings(findings: SastFinding[]): SastFinding[] {
  return findings.filter((f) => /error|high|critical/i.test(f.severity ?? ""));
}
