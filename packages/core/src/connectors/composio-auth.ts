export interface AuthPlan {
  /** true → launch the Composio OAuth helper; false → print `note` and skip. */
  run: boolean;
  note: string;
}

/** Decide what `vishu connect <app> --auth` should do. Keyless-connect smoothing routes only through
 * Composio (curated MCPs mount directly with no OAuth), and only when a key is present — otherwise we
 * hand back the manual hint instead of failing. Pure so the degrade branches are testable offline. */
export function authPlan(app: string, wantAuth: boolean, viaComposio: boolean, env: NodeJS.ProcessEnv = process.env): AuthPlan {
  if (!wantAuth) return { run: false, note: "" };
  if (!viaComposio) return { run: false, note: `--auth applies to Composio-routed apps; "${app}" mounts directly.` };
  if (!env.COMPOSIO_API_KEY) return { run: false, note: `set COMPOSIO_API_KEY to auto-authorize "${app}", or authorize it in the Composio dashboard.` };
  return { run: true, note: "" };
}
