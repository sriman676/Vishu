// §12b: capture mic audio in the browser and encode it as a 16 kHz mono 16-bit WAV (what whisper.cpp
// wants), base64'd for the vishu.voice_transcribe RPC. This replaces the browser SpeechRecognition
// dependency — the audio is transcribed server-side, so it works cross-browser and headless-capable.

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

/** Downmix to mono, linear-resample to 16 kHz, and encode a 16-bit PCM WAV.
 * ponytail: linear resample — fine for speech; a windowed-sinc is the upgrade if quality matters. */
function wavFromBuffer(buf: AudioBuffer): ArrayBuffer {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const mono = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let s = 0;
    for (const ch of chans) s += ch[i];
    mono[i] = s / chans.length;
  }
  const ratio = buf.sampleRate / TARGET_RATE;
  const outLen = Math.floor(mono.length / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const frac = src - lo;
    const sample = mono[lo] * (1 - frac) + (mono[lo + 1] ?? mono[lo]) * frac;
    pcm[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }
  return encodeWav(pcm, TARGET_RATE);
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
