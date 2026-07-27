// Pure helpers for full-duplex voice: sentence chunking (per-sentence TTS) and mic-energy VAD
// (barge-in). No DOM deps here on purpose, so they unit-test in plain node (see voiceStream.test.ts).
// The DOM orchestration that consumes them lives in App.tsx.

/** Split a reply into speakable chunks on sentence boundaries, so TTS can start synthesizing/playing
 * sentence 1 while later sentences are still synthesizing. Over-splitting (e.g. across "3.5") only
 * yields an extra audio chunk — benign for playback. A run with no terminal punctuation stays whole.
 * ponytail: regex boundary split; a real prosody-aware segmenter is the upgrade only if a split
 * mid-thought sounds wrong. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** RMS energy of a mono Float32 PCM frame, in ~[0,1]. The barge-in VAD uses this to notice the user
 * starting to talk over the assistant while TTS is playing. */
export function rmsEnergy(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

/** True when a frame's energy crosses the speech threshold (default tuned for typical mic gain — the
 * physical calibration knob; raise it in a noisy room, lower it for a quiet mic).
 * ponytail: single fixed threshold, not an adaptive noise floor — that's the upgrade if it mis-triggers. */
export function isSpeech(pcm: Float32Array, threshold = 0.02): boolean {
  return rmsEnergy(pcm) >= threshold;
}
