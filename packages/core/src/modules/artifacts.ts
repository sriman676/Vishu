import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ModuleContext, VishuModule } from "./registry.js";

/** Reference Phase 12 module (dependency-free) proving the flag seam: save/list named text artifacts
 * under `<workspace>/artifacts`. Heavy modules (voice, web3, desktop, mobile) implement the same
 * `VishuModule` interface with their own deps + flag. ponytail: flat text files, no metadata DB. */
export const artifactsModule: VishuModule = {
  name: "artifacts",
  setup({ tools, workspaceDir }: ModuleContext) {
    const dir = join(workspaceDir, "artifacts");
    tools.register({
      name: "artifact_save",
      description: "Save a named text artifact to the workspace artifacts store.",
      parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] },
      run: async (args) => {
        mkdirSync(dir, { recursive: true });
        const name = basename(String(args.name)); // jail: no path traversal out of the artifacts dir
        writeFileSync(join(dir, name), String(args.content ?? ""));
        return `saved ${name}`;
      },
    });
    tools.register({
      name: "artifact_list",
      description: "List saved artifacts, or read one by name.",
      parameters: { type: "object", properties: { name: { type: "string" } } },
      run: async (args) => {
        try {
          if (args.name) return readFileSync(join(dir, basename(String(args.name))), "utf8");
          return readdirSync(dir).join("\n") || "(no artifacts)";
        } catch {
          return "(no artifacts)";
        }
      },
    });
  },
};
