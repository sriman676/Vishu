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

/** Run a PowerShell one-liner, resolve its trimmed stdout (Windows input control). Errors are caught by
 * the caller so a missing shell / non-Windows box surfaces a clean tool error, never a crash. */
function pwsh(script: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("desktop command timeout"));
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

/** Escape a string for a PowerShell single-quoted literal (double any embedded single-quote). */
function psq(s: string): string {
  return s.replaceAll("'", "''");
}

/** Phase 12 desktop/OS module (flag: `desktop`). Screen awareness (capture to PNG) + guarded input control
 * (type/key/click). Input injection can't be intent-classified by a label the way browser clicks can — it's
 * raw keystrokes/coordinates — so ALL input tools are send-class: the F0 gate ALWAYS asks (typed confirm),
 * pause halts them instantly, and every call screenshots first for the audit. Windows-native via PowerShell
 * (dep-free); a non-Windows box / missing shell → a clean error, never a crash. Control is the LAST risky
 * lane (PLAN F-DESKTOP) — conservative by construction. */
export const desktopModule: VishuModule = {
  name: "desktop",
  setup({ tools, workspaceDir }) {
    const dir = join(workspaceDir, "screenshots");
    const winOnly = () => process.platform === "win32";
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

    // --- Guarded input control (all send-class → the F0 gate always asks; pause halts instantly) ---
    tools.register({
      name: "desktop_type",
      meta: { action: "send" },
      description: "Type text into the focused window (raw keystrokes). ALWAYS asks for approval.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: async (a) => {
        if (!winOnly()) return "error: desktop_type is Windows-only in v1";
        const text = String(a.text ?? "");
        if (!text) return "error: text is required";
        try {
          await pwsh(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psq(text)}')`);
          return "typed";
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    tools.register({
      name: "desktop_key",
      meta: { action: "send" },
      description: "Send a key combo via SendKeys syntax (e.g. '^c', '%{F4}', '{ENTER}'). ALWAYS asks.",
      parameters: { type: "object", properties: { keys: { type: "string" } }, required: ["keys"] },
      run: async (a) => {
        if (!winOnly()) return "error: desktop_key is Windows-only in v1";
        const keys = String(a.keys ?? "");
        if (!keys) return "error: keys is required";
        try {
          await pwsh(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psq(keys)}')`);
          return "sent";
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    tools.register({
      name: "desktop_click",
      meta: { action: "send" },
      description: "Move the cursor to (x,y) and left-click. ALWAYS asks for approval.",
      parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
      run: async (a) => {
        if (!winOnly()) return "error: desktop_click is Windows-only in v1";
        const x = Math.round(Number(a.x));
        const y = Math.round(Number(a.y));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return "error: x and y must be numbers";
        try {
          await pwsh(
            `Add-Type -Name U -Namespace W -MemberDefinition '[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);'; ` +
              `[W.U]::SetCursorPos(${x},${y}); [W.U]::mouse_event(2,0,0,0,0); [W.U]::mouse_event(4,0,0,0,0)`,
          );
          return `clicked ${x},${y}`;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
  },
};
