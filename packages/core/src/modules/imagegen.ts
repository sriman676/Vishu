import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { VishuModule } from "./registry.js";

/** Phase 12 image-generation module (flag: `imagegen`). One call to an OpenAI-compatible images endpoint;
 * the returned PNG is written under `<workspace>/images` (path-jailed) and only the file path is returned —
 * never the API key. ponytail: b64 response → file; no streaming, no edits/variations endpoints (add the
 * same way when needed). Provider is config, not code: base URL + model come from env. */
export const imagegenModule: VishuModule = {
  name: "imagegen",
  setup({ tools, workspaceDir }) {
    const dir = join(workspaceDir, "images");
    tools.register({
      name: "image_generate",
      description: "Generate an image from a text prompt; saves a PNG to the workspace and returns its path.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          size: { type: "string", description: "e.g. 1024x1024 (provider-dependent)" },
          name: { type: "string", description: "output filename (optional)" },
        },
        required: ["prompt"],
      },
      run: async (args) => {
        const prompt = String(args.prompt ?? "");
        if (!prompt) return "error: prompt is required";
        const key = process.env.VISHU_IMAGE_API_KEY;
        if (!key) return "error: set VISHU_IMAGE_API_KEY to generate images";
        const base = (process.env.VISHU_IMAGE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
        const model = process.env.VISHU_IMAGE_MODEL ?? "gpt-image-1";
        try {
          const res = await fetch(`${base}/images/generations`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, prompt, size: args.size ? String(args.size) : undefined, response_format: "b64_json" }),
          });
          const body = (await res.json()) as { data?: { b64_json?: string }[]; error?: { message?: string } };
          if (body.error) return `error: provider: ${body.error.message ?? JSON.stringify(body.error)}`;
          const b64 = body.data?.[0]?.b64_json;
          if (!b64) return "error: provider returned no image data";
          mkdirSync(dir, { recursive: true });
          const name = basename(String(args.name ?? `image-${Date.now()}.png`)); // jail: no traversal out of images/
          const path = join(dir, name.endsWith(".png") ? name : `${name}.png`);
          writeFileSync(path, Buffer.from(b64, "base64"));
          return path;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
  },
};
