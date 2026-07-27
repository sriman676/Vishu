import { useEffect, useRef, useState } from "react";

/** Voice-reactive avatar orb (Phase 8): a Canvas 2D orb that is *alive* — it breathes gently at idle and
 * swells + glows with live mic amplitude while listening. Click to start/stop. ponytail: Canvas 2D +
 * getUserMedia, no Three.js — an avatar orb is a pulsing light, not a 3D scene; swap in a mesh only if a
 * real 3D avatar is ever needed. Design (taste): motivated motion only (idle breath reads as presence,
 * amplitude reads as hearing), one mint→teal accent, honors prefers-reduced-motion, tactile hover. */
export function Orb() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const level = useRef(0); // live mic loudness 0..~1, written by the analyser, read by the draw loop
  const [on, setOn] = useState(false);
  const [hover, setHover] = useState(false);
  const reduce = usePrefersReducedMotion();

  // Draw loop. Idle: a slow breath (skipped under reduced motion). Listening: breath + amplitude swell.
  // Static single frame when reduced-motion AND idle, so the orb never animates against the user's wish.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const accent = cssVar("--accent", "#4fd6c2");
    const accent2 = cssVar("--accent-2", "#39b6c9");
    let raf = 0;
    let stop = false;

    const paint = (t: number) => {
      const breath = reduce ? 0 : Math.sin(t * 0.0011) * 0.5 + 0.5; // 0..1, ~0.2 Hz
      const lvl = level.current;
      const cx = c.width / 2;
      const cy = c.height / 2;
      const r = 13 + breath * 2.5 + lvl * 20; // core radius
      const glow = 8 + breath * 5 + lvl * 46; // outer bloom

      g.clearRect(0, 0, c.width, c.height);

      // soft halo ring — presence without a hard edge
      g.save();
      g.globalAlpha = 0.16 + breath * 0.08 + lvl * 0.35;
      g.strokeStyle = accent2;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, r + 6 + lvl * 8, 0, Math.PI * 2);
      g.stroke();
      g.restore();

      // core: mint centre → teal rim, with a bloom sized by breath + amplitude
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, accent2);
      g.fillStyle = grad;
      g.shadowColor = accent;
      g.shadowBlur = glow;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    };

    if (reduce && !on) {
      paint(0); // one static frame; no animation loop
      return;
    }
    const frame = (t: number) => {
      if (stop) return;
      paint(t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [on, reduce]);

  // Mic: feed live amplitude into `level` while listening; silence (0) resets it when off.
  useEffect(() => {
    if (!on) {
      level.current = 0;
      return;
    }
    let ctx: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let raf = 0;
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
      const tick = () => {
        if (stop) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / buf.length) / 128; // 0..~1 loudness
        level.current = level.current * 0.7 + rms * 0.3; // smooth so the orb glides, not jitters
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      level.current = 0;
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
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={on ? "Orb listening — click to stop" : "Click to activate the voice orb"}
      style={{
        cursor: "pointer",
        width: 36,
        height: 36,
        opacity: on ? 1 : 0.55,
        transform: `scale(${hover ? 1.08 : 1})`,
        transition: "transform var(--dur, 140ms) var(--ease-out, ease), opacity var(--dur, 140ms) ease",
      }}
    />
  );
}

/** The page's --accent tokens are oklch; the Tauri/Chromium canvas parses oklch color strings directly. */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Track prefers-reduced-motion reactively so the orb goes still if the user flips the OS setting. */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}
