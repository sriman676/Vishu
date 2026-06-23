import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { VishuModule } from "./registry.js";

/** Default screen-capture argv per platform (dep-free, native tools). Overridable via
 * `VISHU_SCREENSHOT_CMD` (JSON argv with a `{out}` placeholder) — also how the tests inject a stub
 * without a display. ponytail: capture-only; keyboard/mouse control + overlay are native (nut.js/Tauri)
 * and land with the Phase 14 desktop shell — named seam, not built here. */
function captureArgv(out: string, env = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (env.VISHU_SCREENSHOT_CMD) return (JSON.parse(env.VISHU_SCREENSHOT_CMD) as string[]).map((a) => a.replaceAll("{out}", out));
  if (platform === "win32")
    return [
      "powershell",
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $bmp.Save('${out}'); $g.Dispose(); $bmp.Dispose()`,
    ];
  if (platform === "darwin") return ["screencapture", "-x", out];
  return ["gnome-screenshot", "-f", out]; // linux; scrot/imagemagick are the named fallbacks
}

function runToEnd(argv: string[], timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(argv[0]!, argv.slice(1), { stdio: "ignore" });
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("screenshot timeout"));
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e); // capture tool not installed / not on PATH
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`screenshot exited ${code}`));
    });
  });
}

/** Phase 12 desktop/OS module (flag: `desktop`). Screen awareness: capture the screen to a PNG under
 * `<workspace>/screenshots` the agent can then read. Native screenshot tool absent → a clear error,
 * never a crash. Control/overlay are deferred to the Phase 14 native shell. */
export const desktopModule: VishuModule = {
  name: "desktop",
  setup({ tools, workspaceDir }) {
    const dir = join(workspaceDir, "screenshots");
    tools.register({
      name: "screen_capture",
      description: "Capture the screen to a PNG in the workspace and return its path (for the agent to read).",
      parameters: { type: "object", properties: { name: { type: "string", description: "output filename (optional)" } } },
      run: async (args) => {
        try {
          mkdirSync(dir, { recursive: true });
          const raw = basename(String(args.name ?? `screen-${Date.now()}.png`)); // jail: no traversal out of screenshots/
          const out = join(dir, raw.endsWith(".png") ? raw : `${raw}.png`);
          await runToEnd(captureArgv(out));
          if (!existsSync(out)) return "error: screenshot command produced no file";
          return out;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
  },
};
