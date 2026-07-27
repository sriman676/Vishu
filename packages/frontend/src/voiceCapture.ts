// §12b: capture mic audio in the browser and encode it as a 16 kHz mono 16-bit WAV (what whisper.cpp
// wants), base64'd for the vishu.voice_transcribe RPC. This replaces the browser SpeechRecognition
// dependency — the audio is transcribed server-side, so it works cross-browser and headless-capable.

import { rmsEnergy } from "./voiceStream.js";

export interface Recording {
  /** Stop the mic and resolve the captured audio as a base64 WAV. */
  stop(): Promise<string>;
}

/** Begin recording from the default mic. Rejects if getUserMedia/MediaRecorder are unavailable. */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise<string>((resolve, reject) => {
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          try {
            const raw = await new Blob(chunks).arrayBuffer();
            const ctx = new AudioContext();
            const decoded = await ctx.decodeAudioData(raw);
            await ctx.close();
            resolve(base64(wavFromBuffer(decoded)));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
  };
}

const TARGET_RATE = 16_000;

/** Linear-resample a mono Float32 buffer to 16 kHz 16-bit PCM.
 * ponytail: linear resample — fine for speech; a windowed-sinc is the upgrade if quality matters. */
function resampleTo16k(mono: Float32Array, srcRate: number): Int16Array {
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.floor(mono.length / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const frac = src - lo;
    const sample = mono[lo] * (1 - frac) + (mono[lo + 1] ?? mono[lo]) * frac;
    pcm[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }
  return pcm;
}

/** Downmix an AudioBuffer to mono, resample to 16 kHz, encode a 16-bit PCM WAV. */
function wavFromBuffer(buf: AudioBuffer): ArrayBuffer {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const mono = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let s = 0;
    for (const ch of chans) s += ch[i];
    mono[i] = s / chans.length;
  }
  return encodeWav(resampleTo16k(mono, buf.sampleRate), TARGET_RATE);
}

export interface Streaming {
  /** Stop the mic, flush nothing (the caller ends the STT session), release the audio graph. */
  stop(): Promise<void>;
}

/** Full-duplex capture: stream the growing utterance as a 16 kHz WAV every `intervalMs` (for live STT
 * partials) and report per-frame mic energy (for barge-in VAD). Rejects if getUserMedia is unavailable.
 * echoCancellation is requested so the assistant's own TTS playing through the speakers doesn't feed
 * back as "user speech" — real acoustic isolation still depends on the hardware/room (a tuning knob).
 * ponytail: ScriptProcessorNode (deprecated but universal) + whole-utterance re-encode each tick — an
 * AudioWorklet + incremental encoder is the upgrade if CPU matters on long dictation. */
export async function startStreaming(opts: {
  onChunk: (wavBase64: string) => void;
  onFrame?: (energy: number) => void;
  intervalMs?: number;
}): Promise<Streaming> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const samples: number[] = [];
  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) samples.push(input[i]);
    opts.onFrame?.(rmsEnergy(input));
  };
  source.connect(node);
  node.connect(ctx.destination); // some browsers only fire onaudioprocess when the node is connected out
  const tick = setInterval(() => {
    if (samples.length) opts.onChunk(base64(encodeWav(resampleTo16k(Float32Array.from(samples), ctx.sampleRate), TARGET_RATE)));
  }, opts.intervalMs ?? 1500);
  return {
    stop: async () => {
      clearInterval(tick);
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

/** 44-byte canonical WAV header + interleaved 16-bit PCM (mono). */
function encodeWav(pcm: Int16Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate (rate * blockAlign)
  view.setUint16(32, 2, true); // block align (mono * 16-bit)
  view.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return buffer;
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
