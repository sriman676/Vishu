import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type Workflow, WorkflowStore } from "../automation/workflows.js";
import type { EventBus } from "../transport/events.js";

/** Phase 13 self-evolving loop (extends the digital twin, suggest-only). A periodic pass scans the
 * project for cheap, deterministic improvement opportunities and records them as **proposals** the
 * user must accept or dismiss. Nothing is ever auto-applied — the human gate is the whole point, and
 * the JSON store is the audit trail (frontier rule: self-improvement without drift).
 * ponytail: heuristic analyzer (oversized files, TODO/FIXME markers, no-tests) over a flat walk — no
 * AST/complexity metric, no LLM. Stable signatures (no volatile line counts) so re-runs don't pile
 * duplicates. Richer analysis (refactor candidates from the codegraph, LLM-proposed tests) is the
 * named upgrade; it rides the same propose/accept seam. */

export type ProposalStatus = "pending" | "accepted" | "dismissed";

export interface Proposal {
  /** Stable id: same opportunity → same sig across runs (so a re-scan never re-proposes it). */
  sig: string;
  kind: "split" | "todo" | "tests";
  target: string; // relative path, or "project"
  detail: string;
  status: ProposalStatus;
  firstSeen: number; // ms epoch
}

interface EvolveData {
  proposals: Record<string, Proposal>;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".vishu", "coverage"]);
const SRC = /\.(?:js|mjs|cjs|ts|jsx|tsx|py|rb|php|go|java|cs|rs)$/i;
const TEST_FILE = /\.(?:test|spec)\.|_test\.|(?:^|[/\\])tests?[/\\]/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(full));
    } else if (SRC.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Deterministic, dependency-free scan → improvement opportunities (no status yet). */
export function analyzeProject(dir: string): Omit<Proposal, "status" | "firstSeen">[] {
  const found: Omit<Proposal, "status" | "firstSeen">[] = [];
  const files = walk(dir);
  let hasTest = false;
  for (const f of files) {
    const rel = relative(dir, f).replace(/\\/g, "/");
    if (TEST_FILE.test(f)) hasTest = true;
    const lines = readFileSync(f, "utf8").split("\n");
    if (lines.length > 400) {
      found.push({ sig: `split:${rel}`, kind: "split", target: rel, detail: `${lines.length} LOC — split this oversized file` });
    }
    const todos = lines.filter((l) => /\b(?:TODO|FIXME)\b/.test(l)).length;
    if (todos > 0) {
      found.push({ sig: `todo:${rel}`, kind: "todo", target: rel, detail: `${todos} TODO/FIXME marker(s) — resolve or ticket them` });
    }
  }
  if (files.length > 0 && !hasTest) {
    found.push({ sig: "tests:project", kind: "tests", target: "project", detail: "no tests found — add coverage" });
  }
  return found;
}

export class ProjectEvolver {
  private data: EvolveData = { proposals: {} };

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8")) as EvolveData;
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file); // atomic: a crash mid-write never corrupts the audit trail
  }

  /** Scan the project and record any newly-seen opportunities as pending proposals (deduped by sig).
   * Returns only the proposals added this pass. Re-recording a dismissed/accepted sig is a no-op —
   * the human decision sticks. */
  propose(dir: string): Proposal[] {
    const added: Proposal[] = [];
    for (const f of analyzeProject(dir)) {
      const existing = this.data.proposals[f.sig];
      if (existing) {
        // Keep the human decision, but refresh the detail (e.g. LOC changed) for a still-pending item.
        if (existing.status === "pending") existing.detail = f.detail;
        continue;
      }
      const proposal: Proposal = { ...f, status: "pending", firstSeen: Date.now() };
      this.data.proposals[f.sig] = proposal;
      added.push(proposal);
    }
    if (added.length > 0) this.persist();
    return added;
  }

  /** Proposals still awaiting the user's decision. */
  pending(): Proposal[] {
    return Object.values(this.data.proposals).filter((p) => p.status === "pending");
  }

  list(): Proposal[] {
    return Object.values(this.data.proposals);
  }

  /** Human gate: accept a proposal. Never applies the change — records the decision (audit trail) and,
   * if a WorkflowStore is given, saves the suggestion as a one-step Workflow a human/agent can run
   * later. Returns the proposal, or undefined if the sig is unknown. */
  accept(sig: string, workflows?: WorkflowStore): Proposal | undefined {
    const p = this.data.proposals[sig];
    if (!p) return undefined;
    p.status = "accepted";
    if (workflows) {
      const wf: Workflow = { name: `improve: ${p.target}`, steps: [`${p.target}: ${p.detail}`] };
      workflows.save(wf);
    }
    this.persist();
    return p;
  }

  /** Human gate: dismiss a proposal so it is never re-proposed. */
  dismiss(sig: string): Proposal | undefined {
    const p = this.data.proposals[sig];
    if (!p) return undefined;
    p.status = "dismissed";
    this.persist();
    return p;
  }
}

/** One periodic pass: scan + record, and notify (suggest-only) when new proposals appear. A scheduler
 * (the Phase 9 cron, or a plain interval) calls this; it never acts on the proposals itself. */
export function runEvolutionPass(evolver: ProjectEvolver, dir: string, bus?: EventBus): Proposal[] {
  const added = evolver.propose(dir);
  if (added.length > 0 && bus) {
    bus.publish({ domain: "system", type: "notification", payload: { evolve: "new_proposals", count: added.length, sigs: added.map((p) => p.sig) } });
  }
  return added;
}
