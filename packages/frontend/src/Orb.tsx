import { useEffect, useRef, useState } from "react";

/** Voice-reactive orb (Phase 8): a canvas circle whose radius + glow track live mic amplitude via a Web
 * Audio AnalyserNode. Click to start/stop listening. ponytail: Canvas 2D + getUserMedia, no Three.js — an
 * orb is a pulsing circle, not a 3D scene; swap in a mesh only if a real 3D avatar is ever needed. */
export function Orb() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let ctx: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let stop = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setOn(false);
        return;
      }
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const c = canvas.current!;
      const g = c.getContext("2d")!;
      const draw = () => {
        if (stop) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / buf.length) / 128; // 0..~1 loudness
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6cf";
        g.clearRect(0, 0, c.width, c.height);
        g.beginPath();
        g.arc(c.width / 2, c.height / 2, 12 + rms * 24, 0, Math.PI * 2);
        g.fillStyle = accent;
        g.shadowColor = accent;
        g.shadowBlur = 8 + rms * 40;
        g.fill();
        raf = requestAnimationFrame(draw);
      };
      draw();
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [on]);
  return (
    <canvas
      ref={canvas}
      width={72}
      height={72}
      onClick={() => setOn((v) => !v)}
      title={on ? "Orb listening — click to stop" : "Click to activate the voice orb"}
      style={{ cursor: "pointer", opacity: on ? 1 : 0.35, width: 36, height: 36 }}
    />
  );
}
