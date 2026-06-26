// Dep-free SVG pie chart — arc math only, no charting library.

export interface Slice {
  label: string;
  value: number;
  color: string;
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

export function Pie({ slices, size = 180 }: { slices: Slice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2;
  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="no usage">
        <circle cx={r} cy={r} r={r - 1} fill="#161a20" stroke="#2a2f37" />
      </svg>
    );
  }
  // A lone slice can't be drawn as an arc (a0===a1) — render a full disc instead.
  if (slices.filter((s) => s.value > 0).length === 1) {
    const only = slices.find((s) => s.value > 0)!;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${only.label} 100%`}>
        <circle cx={r} cy={r} r={r - 1} fill={only.color} />
      </svg>
    );
  }
  let a0 = -Math.PI / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="token usage by category">
      {slices.map((s) => {
        const a1 = a0 + (s.value / total) * 2 * Math.PI;
        const d = arc(r, r, r - 1, a0, a1);
        a0 = a1;
        return <path key={s.label} d={d} fill={s.color}>
          <title>{`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`}</title>
        </path>;
      })}
    </svg>
  );
}

/** Stable, readable palette for category slices (cycled if there are more categories than colors). */
export const PALETTE = ["#4fd1c5", "#63b3ed", "#f6ad55", "#fc8181", "#b794f4", "#68d391", "#f6e05e", "#cbd5e0"];
