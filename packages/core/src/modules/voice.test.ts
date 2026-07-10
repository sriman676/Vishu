import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { Registry } from "../transport/rpc.js";
import { MODULES } from "./all.js";
import { enabledModules, loadModules } from "./registry.js";
import { callSidecar } from "./voice.js";

// A node stub standing in for the python+whisper sidecar: reads one JSON line, echoes a transcript.
const ECHO_STUB = `let b="";process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>{const r=JSON.parse(b);process.stdout.write(JSON.stringify({text:"heard:"+r.audio_path})+"\\n")});`;
const ERR_STUB = `process.stdin.on("data",()=>{});process.stdout.write(JSON.stringify({error:"whisper not installed"})+"\\n");`;

test("voice: callSidecar round-trips one JSON request/response over stdio", async () => {
  const res = await callSidecar(["node", "-e", ECHO_STUB], { audio_path: "foo.wav" });
  assert.deepEqual(res, { text: "heard:foo.wav" });
});

test("voice: callSidecar rejects when the command can't spawn", async () => {
  await assert.rejects(callSidecar(["definitely-not-a-real-binary-xyz"], {}));
});

// A node stub for the TTS sidecar: echoes an audio_path + engine; and an error variant.
const TTS_STUB = `let b="";process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>{const r=JSON.parse(b);process.stdout.write(JSON.stringify({audio_path:"/tmp/out.mp3",engine:r.voice_id?"elevenlabs":"piper"})+"\\n")});`;
const TTS_ERR_STUB = `process.stdin.on("data",()=>{});process.stdout.write(JSON.stringify({error:"no TTS engine available"})+"\\n");`;

test("voice_speak: returns the audio path + engine, surfaces sidecar errors, never crashes", async () => {
  const prev = process.env.VISHU_TTS_CMD;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "voice" }));

    process.env.VISHU_TTS_CMD = JSON.stringify(["node", "-e", TTS_STUB]);
    assert.equal(await c.tools.get("voice_speak").run({ text: "hello" }, {} as never), "/tmp/out.mp3 (piper)");
    assert.equal(await c.tools.get("voice_speak").run({ text: "hi", voice_id: "v1" }, {} as never), "/tmp/out.mp3 (elevenlabs)");

    process.env.VISHU_TTS_CMD = JSON.stringify(["node", "-e", TTS_ERR_STUB]);
    assert.match(await c.tools.get("voice_speak").run({ text: "hi" }, {} as never), /no TTS engine available/);

    assert.match(await c.tools.get("voice_speak").run({}, {} as never), /text is required/);
  } finally {
    if (prev === undefined) delete process.env.VISHU_TTS_CMD;
    else process.env.VISHU_TTS_CMD = prev;
  }
});

test("voice_transcribe: returns text via the sidecar, surfaces sidecar errors, never crashes", async () => {
  const prev = process.env.VISHU_VOICE_CMD;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "voice" }));

    process.env.VISHU_VOICE_CMD = JSON.stringify(["node", "-e", ECHO_STUB]);
    assert.equal(await c.tools.get("voice_transcribe").run({ audio_path: "a.wav" }, {} as never), "heard:a.wav");

    process.env.VISHU_VOICE_CMD = JSON.stringify(["node", "-e", ERR_STUB]);
    assert.match(await c.tools.get("voice_transcribe").run({ audio_path: "a.wav" }, {} as never), /whisper not installed/);

    assert.match(await c.tools.get("voice_transcribe").run({}, {} as never), /audio_path is required/);
  } finally {
    if (prev === undefined) delete process.env.VISHU_VOICE_CMD;
    else process.env.VISHU_VOICE_CMD = prev;
  }
});
