import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok } from "../transport/rpc.js";
import type { VishuModule } from "./registry.js";

/** Spawn a sidecar process, send ONE JSON request line, read ONE JSON response line. This is the
 * cross-language IPC seam (stdio JSON, per the locked decision) reused by any sidecar — kept tiny and
 * injectable (argv) so it unit-tests against a stub command without the real Python/whisper installed. */
export async function callSidecar(argv: string[], request: unknown, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const p = spawn(argv[0]!, argv.slice(1)); // default stdio is pipe on all three
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("voice sidecar timeout"));
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e); // e.g. python not on PATH
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.trim());
      if (!line) return reject(new Error(`voice sidecar: no output (exit ${code})${err ? `: ${err.trim()}` : ""}`));
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch {
        reject(new Error(`voice sidecar: non-JSON output: ${line}`));
      }
    });
    p.stdin.write(`${JSON.stringify(request)}\n`);
    p.stdin.end();
  });
}

/** Default argv: `python <bundled whisper_stt.py>`. Overridable via env for a different interpreter,
 * a moved sidecar, or (tests) a stub command. ponytail: path resolves relative to this file's source
 * tree — running from a compiled `dist/` needs `VISHU_VOICE_SIDECAR` set; named as the ceiling. */
function sidecarArgv(env = process.env): string[] {
  if (env.VISHU_VOICE_CMD) return JSON.parse(env.VISHU_VOICE_CMD) as string[];
  const python = env.VISHU_VOICE_PYTHON ?? "python";
  const sidecar = env.VISHU_VOICE_SIDECAR ?? fileURLToPath(new URL("../../sidecar/whisper_stt.py", import.meta.url));
  return [python, sidecar];
}

/** Default argv for the TTS sidecar: `python <bundled tts.py>`. Same override knobs as STT, plus a
 * dedicated `VISHU_TTS_CMD`/`VISHU_TTS_SIDECAR` so STT and TTS can point at different commands. */
function ttsArgv(env = process.env): string[] {
  if (env.VISHU_TTS_CMD) return JSON.parse(env.VISHU_TTS_CMD) as string[];
  const python = env.VISHU_VOICE_PYTHON ?? "python";
  const sidecar = env.VISHU_TTS_SIDECAR ?? fileURLToPath(new URL("../../sidecar/tts.py", import.meta.url));
  return [python, sidecar];
}

/** Phase 12 voice module (flag: `voice`). STT (whisper) + TTS (elevenlabs→piper) via optional Python
 * sidecars over the same stdio-JSON seam. An engine/interpreter being absent → a clear error, never a
 * crash — the core is never blocked. ponytail: half-duplex synth-to-file; per-sentence streaming +
 * full duplex/barge-in are the named upgrades (PLAN Step 4 latency + Phase 4). */
const AUDIO_MIME: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg" };

export const voiceModule: VishuModule = {
  name: "voice",
  setup({ tools, rpc }) {
    tools.register({
      name: "voice_speak",
      description: "Synthesize speech from text (ElevenLabs if ELEVENLABS_API_KEY is set, else local piper). Returns the audio file path.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          voice_id: { type: "string", description: "ElevenLabs voice id (optional; per-mode voice)" },
          out_path: { type: "string", description: "where to write the audio (optional; a temp file otherwise)" },
          play: { type: "boolean", description: "best-effort local playback after synth (optional)" },
        },
        required: ["text"],
      },
      run: async (args) => {
        const text = String(args.text ?? "");
        if (!text) return "error: text is required";
        try {
          const res = await callSidecar(ttsArgv(), {
            text,
            voice_id: args.voice_id ? String(args.voice_id) : undefined,
            out_path: args.out_path ? String(args.out_path) : undefined,
            play: args.play === true,
          });
          if (res.error) return `error: ${String(res.error)}`;
          return typeof res.audio_path === "string" ? `${res.audio_path} (${String(res.engine ?? "?")})` : "error: sidecar returned no audio_path";
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    tools.register({
      name: "voice_transcribe",
      description: "Transcribe a local audio file to text via the whisper sidecar. Requires Python + openai-whisper.",
      parameters: {
        type: "object",
        properties: { audio_path: { type: "string" }, model: { type: "string", description: "whisper model, e.g. base/small (optional)" } },
        required: ["audio_path"],
      },
      run: async (args) => {
        const audio_path = String(args.audio_path ?? "");
        if (!audio_path) return "error: audio_path is required";
        try {
          const res = await callSidecar(sidecarArgv(), { audio_path, model: args.model ? String(args.model) : undefined });
          if (res.error) return `error: ${String(res.error)}`;
          return typeof res.text === "string" ? res.text : "error: sidecar returned no text";
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    // §12b: the same STT/TTS pipeline over RPC so a headless client (or the Tauri UI, replacing its
    // browser Web Speech dependency) can drive voice without going through the agent tool loop. Audio
    // crosses as base64 so the browser never needs to read a server-side file path.
    rpc.register("vishu.voice_transcribe", async (params) => {
      const p = (params ?? {}) as { audio_path?: string; audio_base64?: string; format?: string; model?: string };
      // A base64 blob (browser mic capture) is written to a temp file the sidecar can read, then removed.
      let path = p.audio_path;
      let tempDir: string | undefined;
      if (!path && p.audio_base64) {
        tempDir = mkdtempSync(join(tmpdir(), "vishu-stt-"));
        path = join(tempDir, `in.${(p.format || "wav").replace(/[^a-z0-9]/gi, "")}`);
        writeFileSync(path, Buffer.from(p.audio_base64, "base64"));
      }
      if (!path) return err("invalid_params", "audio_path or audio_base64 is required");
      try {
        const res = await callSidecar(sidecarArgv(), { audio_path: path, model: p.model });
        if (res.error) return err("stt_failed", String(res.error));
        return ok({ text: String(res.text ?? ""), engine: res.engine ? String(res.engine) : undefined });
      } catch (e) {
        return err("stt_failed", e instanceof Error ? e.message : String(e));
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      }
    });

    rpc.register("vishu.voice_speak", async (params) => {
      const p = (params ?? {}) as { text?: string; voice_id?: string };
      const text = (p.text ?? "").trim();
      if (!text) return err("invalid_params", "text is required");
      try {
        const res = await callSidecar(ttsArgv(), { text, voice_id: p.voice_id });
        if (res.error) return err("tts_failed", String(res.error));
        const audioPath = typeof res.audio_path === "string" ? res.audio_path : "";
        if (!audioPath) return err("tts_failed", "sidecar returned no audio_path");
        const bytes = readFileSync(audioPath);
        rmSync(audioPath, { force: true }); // stream the bytes back; don't leave temp audio on disk
        const mime = AUDIO_MIME[extname(audioPath).toLowerCase()] ?? "application/octet-stream";
        return ok({ engine: String(res.engine ?? "?"), mime, audio_base64: bytes.toString("base64") });
      } catch (e) {
        return err("tts_failed", e instanceof Error ? e.message : String(e));
      }
    });
  },
};
