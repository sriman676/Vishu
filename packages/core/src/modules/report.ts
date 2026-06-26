import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleContext, VishuModule } from "./registry.js";

interface Section {
  heading?: string;
  content?: string;
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";

/** Build a structured markdown research report: title, date, a table of contents, the sections, and a
 * sources list. The agent does the research (web/memory tools) and synthesis; this assembles the document. */
function renderReport(title: string, sections: Section[], sources: string[]): string {
  const toc = sections.filter((s) => s.heading).map((s) => `- [${s.heading}](#${slug(s.heading!)})`);
  const body = sections.map((s) => `${s.heading ? `## ${s.heading}\n\n` : ""}${s.content ?? ""}`.trim());
  return [
    `# ${title}`,
    `*Generated ${new Date().toISOString().slice(0, 10)}*`,
    ...(toc.length ? ["## Contents", toc.join("\n")] : []),
    ...body,
    ...(sources.length ? ["## Sources", sources.map((s) => `- ${s}`).join("\n")] : []),
  ].join("\n\n");
}

/** Phase 12 module: research-report generation (the DeerFlow output-gen gap, scoped to docs). Dep-free —
 * writes a structured markdown report under `<workspace>/reports`, path-jailed by a slug.
 * ponytail: markdown is the source of truth; PDF/slide/podcast rendering is the named upgrade (pipe the
 * markdown through the existing make-pdf skill or a pandoc/puppeteer step). */
export const reportModule: VishuModule = {
  name: "report",
  setup({ tools, workspaceDir }: ModuleContext) {
    const dir = join(workspaceDir, "reports");
    tools.register({
      name: "report_save",
      description: "Assemble a structured markdown research report (title, contents, sections, sources) and save it under the workspace reports folder.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, content: { type: "string" } } } },
          sources: { type: "array", items: { type: "string" } },
        },
        required: ["title", "sections"],
      },
      run: async (args) => {
        const title = String(args.title ?? "Report");
        const sections = Array.isArray(args.sections) ? (args.sections as Section[]) : [];
        const sources = Array.isArray(args.sources) ? (args.sources as string[]).map(String) : [];
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${slug(title)}.md`); // slug jails the name into the reports dir
        writeFileSync(file, renderReport(title, sections, sources));
        return `saved report ${file}`;
      },
    });
  },
};
