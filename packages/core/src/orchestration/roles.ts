import type { ProviderConfig } from "../config/config.js";
import { buildRouter } from "../providers/factory.js";
import type { Router } from "../providers/router.js";
import type { UsageLog } from "../usage/log.js";

/** Multi-AI role registry (requested backlog). When more than one provider/AI is connected, assign each
 * a role (builder / summariser / messenger / …); `for(role)` dispatches a task to that role's Router,
 * falling back to a default when a role is unassigned. ponytail: a Map + fallback over the existing
 * Router — no new provider machinery. Building one named Router per connected AI from config is the
 * named upgrade (today the core builds a single Router); this is the routing layer that sits on top. */
export class RoleRegistry {
  private readonly assigned = new Map<string, Router>();
  private readonly models = new Map<string, string>();

  constructor(
    private readonly fallback: Router,
    private readonly fallbackModel?: string,
  ) {}

  /** Point a role at a specific AI (its Router) — optionally pinning the model that AI runs (e.g. the
   * builder role → a large NIM model). Re-assigning replaces the previous binding. */
  assign(role: string, router: Router, model?: string): this {
    this.assigned.set(role, router);
    if (model !== undefined) this.models.set(role, model);
    return this;
  }

  /** The Router for a role, or the fallback when the role has no dedicated AI. */
  for(role: string): Router {
    return this.assigned.get(role) ?? this.fallback;
  }

  /** The model a role runs — its pinned model, else the fallback model (may be undefined if none set). */
  modelFor(role: string): string | undefined {
    return this.models.get(role) ?? this.fallbackModel;
  }

  /** Roles that have a dedicated AI assigned (excludes ones served only by the fallback). */
  roles(): string[] {
    return [...this.assigned.keys()];
  }
}

/** Build a RoleRegistry from config: one named Router per configured AI, assigned to roles; the
 * default provider is the fallback. Closes the "config builds a single Router" gap (open problem #6).
 * An assignment that names an unknown provider is skipped (that role falls back). */
export function buildRoles(
  fallback: Router,
  fallbackModel: string,
  providers: Record<string, ProviderConfig>,
  roleMap: Record<string, string>,
  usageLog?: UsageLog,
): RoleRegistry {
  const routers = new Map<string, Router>();
  for (const [name, cfg] of Object.entries(providers)) routers.set(name, buildRouter(cfg, usageLog));
  const reg = new RoleRegistry(fallback, fallbackModel);
  for (const [role, providerName] of Object.entries(roleMap)) {
    const r = routers.get(providerName);
    if (r) reg.assign(role, r, providers[providerName]?.model); // pin the role to its provider's model
  }
  return reg;
}

/** Cheap, high-frequency roles that should run on the fast local lane when one is configured. */
const FAST_ROLES = ["fast", "worker", "summariser", "classifier", "embedder"] as const;

/**
 * Turnkey fast-lane default (user: "faster and faster"). When a local LLM is configured
 * (`VISHU_LOCAL_BASE_URL` / `VISHU_LOCAL_MODEL`), bind the cheap high-frequency roles to it so
 * classify/summarise/route work runs on-device while `main` reasoning stays on the cloud fallback.
 * No local endpoint → every role falls back to `main` (a no-op registry, zero behavior change).
 * Call sites opt a step onto the lane via `roles.for("fast")` / `modelFor("fast")`.
 */
export function fastLaneRoles(main: Router, mainModel: string, env: NodeJS.ProcessEnv = process.env, usageLog?: UsageLog): RoleRegistry {
  const reg = new RoleRegistry(main, mainModel);
  const base = env.VISHU_LOCAL_BASE_URL;
  if (!base) return reg;
  const local = buildRouter({ type: "ollama", baseUrl: base, model: env.VISHU_LOCAL_MODEL ?? "" } as ProviderConfig, usageLog);
  for (const role of FAST_ROLES) reg.assign(role, local, env.VISHU_LOCAL_MODEL);
  return reg;
}
