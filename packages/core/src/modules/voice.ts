import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok } from "../transport/rpc.js";
import { withHeavy } from "../reliability/heavy.js";
import type { VishuModule } from "./registry.js";

/** Spawn a sidecar process, send ONE JSON request line, read ONE JSON response line. This is the
 * cross-language IPC seam (stdio JSON, per the locked decision) reused by any sidecar — kept tiny and
 * injectable (argv) so it unit-tests against a stub command without the real Python/whisper installed. */
export async function callSidecar(argv: string[], request: unknown, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  // §4b: a sidecar spawn (whisper.cpp / Piper) is a heavy subsystem — cap concurrency so STT+TTS+browser
  // don't all run at once and thrash on a 16 GB box.
  return withHeavy(() => new Promise((resolve, reject) => {
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
  }));
}

export interface SidecarStream {
  /** Send one request line and resolve with the sidecar's next response line (FIFO 1:1). */
  send(request: unknown): Promise<Record<string, unknown>>;
  /** End stdin and kill the child. Safe to call more than once. */
  close(): void;
}

/** Spawn a LONG-LIVED sidecar and drive it with many request/response turns over the same stdio-JSON
 * seam (vs callSidecar's one-shot). Responses are line-buffered and matched to pending requests in FIFO
 * order — the streaming STT protocol is strictly one response per request line. Injectable argv so it
 * unit-tests against a node stub without Python/whisper installed. */
export function callSidecarStream(argv: string[]): SidecarStream {
  const p = spawn(argv[0]!, argv.slice(1));
  const waiters: Array<{ resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }> = [];
  let buf = "";
  const failAll = (e: Error) => {
    while (waiters.length) waiters.shift()!.reject(e);
  };
  p.stdout.on("data", (d) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const w = waiters.shift();
      if (!w) continue; // an unsolicited line (shouldn't happen in a 1:1 protocol) is dropped
      try {
        w.resolve(JSON.parse(line) as Record<string, unknown>);
      } catch {
        w.reject(new Error(`stream sidecar: non-JSON output: ${line}`));
      }
    }
  });
  p.on("error", (e) => failAll(e)); // e.g. python not on PATH
  p.on("close", (code) => failAll(new Error(`stream sidecar exited (${code})`)));
  return {
    send: (request) =>
      new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        p.stdin.write(`${JSON.stringify(request)}\n`);
      }),
    close: () => {
      try {
        p.stdin.end();
        p.kill();
      } catch {
        /* already gone */
      }
    },
  };
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

/** Default argv for the long-lived streaming STT sidecar. Same override knobs as the one-shot STT,
 * plus a dedicated `VISHU_STT_STREAM_CMD`/`VISHU_STT_STREAM_SIDECAR` (tests point this at a node stub). */
function streamArgv(env = process.env): string[] {
  if (env.VISHU_STT_STREAM_CMD) return JSON.parse(env.VISHU_STT_STREAM_CMD) as string[];
  const python = env.VISHU_VOICE_PYTHON ?? "python";
  const sidecar = env.VISHU_STT_STREAM_SIDECAR ?? fileURLToPath(new URL("../../sidecar/whisper_stream.py", import.meta.url));
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

    // §12b full-duplex: streaming STT over a warm, long-lived sidecar. The browser opens a session, then
    // pushes the growing mic WAV every ~1.5s and gets back a live partial transcript; end() returns the
    // final. Keeping the model loaded across chunks (vs voice_transcribe's one-shot spawn) is the point.
    interface SttSession {
      stream: SidecarStream;
      dir: string;
      model?: string;
      timer: ReturnType<typeof setTimeout>;
    }
    const STT = new Map<string, SttSession>();
    const IDLE_MS = 120_000; // reap an abandoned session's warm child so a dropped client can't leak python

    const endStt = (id: string): void => {
      const s = STT.get(id);
      if (!s) return;
      clearTimeout(s.timer);
      s.stream.close();
      rmSync(s.dir, { recursive: true, force: true });
      STT.delete(id);
    };
    const armIdle = (id: string): void => {
      const s = STT.get(id);
      if (!s) return;
      clearTimeout(s.timer);
      s.timer = setTimeout(() => endStt(id), IDLE_MS);
      s.timer.unref?.(); // don't keep the process alive just for the reaper
    };

    rpc.register("vishu.voice_stt_start", async (params) => {
      const p = (params ?? {}) as { model?: string };
      const id = randomUUID();
      const dir = mkdtempSync(join(tmpdir(), "vishu-stt-"));
      const timer = setTimeout(() => endStt(id), IDLE_MS);
      timer.unref?.();
      STT.set(id, { stream: callSidecarStream(streamArgv()), dir, model: p.model, timer });
      return ok({ sessionId: id });
    });

    rpc.register("vishu.voice_stt_chunk", async (params) => {
      const p = (params ?? {}) as { sessionId?: string; audio_base64?: string; format?: string };
      const s = p.sessionId ? STT.get(p.sessionId) : undefined;
      if (!s) return err("invalid_params", "unknown or expired stt session");
      if (!p.audio_base64) return err("invalid_params", "audio_base64 required");
      armIdle(p.sessionId!);
      // Overwrite the session's single wav with the growing audio-so-far; the sidecar re-transcribes it.
      const path = join(s.dir, `in.${(p.format || "wav").replace(/[^a-z0-9]/gi, "")}`);
      writeFileSync(path, Buffer.from(p.audio_base64, "base64"));
      try {
        const res = await s.stream.send({ audio_path: path, model: s.model });
        if (res.error) return err("stt_failed", String(res.error));
        return ok({ partial: String(res.partial ?? ""), engine: res.engine ? String(res.engine) : undefined });
      } catch (e) {
        endStt(p.sessionId!); // the sidecar died — tear the session down rather than wedge it
        return err("stt_failed", e instanceof Error ? e.message : String(e));
      }
    });

    rpc.register("vishu.voice_stt_end", async (params) => {
      const p = (params ?? {}) as { sessionId?: string };
      const s = p.sessionId ? STT.get(p.sessionId) : undefined;
      if (!s) return ok({ final: "" }); // already reaped/ended — idempotent
      let final = "";
      try {
        const res = await s.stream.send({ final: true });
        final = String(res.final ?? res.partial ?? "");
      } catch {
        /* sidecar already gone — fall through to cleanup with whatever we have */
      }
      endStt(p.sessionId!);
      return ok({ final });
    });
  },
};
