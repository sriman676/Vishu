import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { Registry } from "../transport/rpc.js";
import { MODULES } from "./all.js";
import { enabledModules, loadModules } from "./registry.js";

test("report: assembles a structured markdown doc (title, TOC, sections, sources) under reports/", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "vishu-report-"));
  const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir };
  try {
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "report" }));
    const out = await c.tools.get("report_save").run(
      {
        title: "State of Local AI",
        sections: [
          { heading: "Overview", content: "Local models are improving." },
          { heading: "Findings", content: "Latency dropped 40%." },
        ],
        sources: ["https://example.com/a"],
      },
      {} as never,
    );
    assert.match(out, /reports[\\/]state-of-local-ai\.md$/); // slugged + jailed into reports/
    const md = readFileSync(out.replace(/^saved report /, ""), "utf8");
    assert.match(md, /^# State of Local AI/m);
    assert.match(md, /## Contents/);
    assert.match(md, /\[Overview\]\(#overview\)/); // TOC links to the section
    assert.match(md, /## Findings\n\nLatency dropped 40%\./);
    assert.match(md, /## Sources\n\n- https:\/\/example\.com\/a/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("report: off by default — the tool is absent unless the flag enables it", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "vishu-report-"));
  const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir };
  try {
    await loadModules(MODULES, c, enabledModules({})); // no VISHU_MODULES
    assert.throws(() => c.tools.get("report_save"));
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
