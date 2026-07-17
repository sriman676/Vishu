import { spawn } from "node:child_process";
import type { EventBus } from "../transport/events.js";
import type { VishuModule } from "./registry.js";

/** Run a PowerShell one-liner and resolve trimmed stdout (Windows glue). Caller catches errors. */
function pwsh(script: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("glue command timeout"));
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

const psq = (s: string) => s.replaceAll("'", "''");

/** Schedule a one-shot reminder: after `delayMs`, publish a `system/notification` the Phase-9 sink already
 * delivers. Exported + returns the timer so it can be tested/cancelled. ponytail: in-memory setTimeout —
 * lost on restart; a durable reminder would save a TriggerManager workflow (named upgrade). */
export function scheduleReminder(bus: EventBus, delayMs: number, text: string): NodeJS.Timeout {
  return setTimeout(() => {
    bus.publish({ domain: "system", type: "notification", payload: { kind: "reminder", text } });
  }, Math.max(0, delayMs)).unref();
}

/** F-PA-GLUE module (flag: `glue`). Small OS conveniences over the same dep-free PowerShell seam: clipboard
 * read/write, app launch, and in-memory reminders on the existing event bus. Windows-first (this box); a
 * non-Windows call returns a clean error. Nothing here is irreversible, so classes stay read/write. */
export const glueModule: VishuModule = {
  name: "glue",
  setup({ tools, bus }) {
    const winOnly = () => process.platform === "win32";

    tools.register({
      name: "clipboard_read",
      meta: { action: "read" },
      description: "Read the current clipboard text.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        if (!winOnly()) return "error: clipboard_read is Windows-only in v1";
        try {
          return (await pwsh("Get-Clipboard -Raw")) || "(empty)";
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    tools.register({
      name: "clipboard_write",
      meta: { action: "write" },
      description: "Put text on the clipboard.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: async (a) => {
        if (!winOnly()) return "error: clipboard_write is Windows-only in v1";
        try {
          await pwsh(`Set-Clipboard -Value '${psq(String(a.text ?? ""))}'`);
          return "copied";
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    tools.register({
      name: "app_launch",
      meta: { action: "write" },
      description: "Launch an app or open a file/URL with its default handler (e.g. 'notepad', a path, a URL).",
      parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
      run: async (a) => {
        if (!winOnly()) return "error: app_launch is Windows-only in v1";
        const target = String(a.target ?? "").trim();
        if (!target) return "error: target is required";
        try {
          await pwsh(`Start-Process '${psq(target)}'`);
          return `launched ${target}`;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    tools.register({
      name: "reminder_set",
      meta: { action: "write" },
      description: "Remind me after N minutes — fires a notification with your text.",
      parameters: { type: "object", properties: { minutes: { type: "number" }, text: { type: "string" } }, required: ["minutes", "text"] },
      run: async (a) => {
        const mins = Number(a.minutes);
        const text = String(a.text ?? "");
        if (!Number.isFinite(mins) || mins <= 0) return "error: minutes must be a positive number";
        if (!text) return "error: text is required";
        scheduleReminder(bus, mins * 60_000, text);
        return `reminder set for ${mins} min: ${text}`;
      },
    });
  },
};
