import { useEffect, useState } from "react";
import { type TokenReport, tokenReport } from "./api.js";
import { PALETTE, Pie } from "./Pie.js";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const WASTE_LABEL: Record<string, string> = {
  context_bloat: "Context bloat",
  model_overkill: "Model overkill",
  duplicate: "Repeat / dedup",
};

/** Token report panel: where tokens go (pie + %), then where they're wasted ($ savings). */
export function Tokens({ token }: { token: string }) {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<TokenReport | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let live = true;
    tokenReport(token, days)
      .then((r) => live && (setReport(r), setError("")))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [token, days]);

  if (error) return <div style={{ padding: 16, color: "var(--danger)" }}>{error}</div>;
  if (!report) return <div style={{ padding: 16, color: "var(--ink-faint)" }}>Loading token report…</div>;

  const slices = report.byCategory.map((c, i) => ({ label: c.category, value: c.tokens, color: PALETTE[i % PALETTE.length] }));

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <div style={S.h}>Token report — last {report.days}d</div>
          <div style={S.sub}>
            {report.totalCalls} calls · {report.totalTokens.toLocaleString()} tokens · {usd(report.totalUsd)}
          </div>
        </div>
        <select style={S.select} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>

      {report.totalTokens === 0 ? (
        <div style={{ color: "var(--ink-faint)" }}>No usage recorded yet — run some turns, then check back.</div>
      ) : (
        <>
          <div style={S.chartRow}>
            <Pie slices={slices} />
            <div style={{ flex: 1 }}>
              {report.byCategory.map((c, i) => (
                <div key={c.category} style={S.legend}>
                  <span style={{ ...S.dot, background: PALETTE[i % PALETTE.length] }} />
                  <span style={{ flex: 1 }}>{c.category}</span>
                  <span style={S.mut}>{c.pct.toFixed(1)}%</span>
                  <span style={S.num}>{c.tokens.toLocaleString()}</span>
                  <span style={S.num}>{usd(c.usd)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={S.h2}>
            Where it's wasted{report.waste.length > 0 && <span style={S.save}> — save ~{usd(report.savingsUsd)}</span>}
          </div>
          {report.waste.length === 0 ? (
            <div style={{ color: "var(--ok)" }}>Nothing flagged. 🎉</div>
          ) : (
            report.waste.map((w) => (
              <div key={w.kind} style={S.waste}>
                <span style={S.wasteTag}>{WASTE_LABEL[w.kind] ?? w.kind}</span>
                <span style={S.mut}>{w.calls} call(s)</span>
                <span style={{ flex: 1 }}>{w.action}</span>
                <span style={S.num}>{w.tokens ? `${w.tokens.toLocaleString()} tok` : usd(w.usd)}</span>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 },
  top: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  h: { fontSize: 16, fontWeight: 600 },
  sub: { color: "var(--ink-muted)", fontSize: 12, marginTop: 2 },
  select: { padding: "6px 8px", background: "#161a20", color: "#e6e6e6", border: "1px solid #2a2f37", borderRadius: 6 },
  chartRow: { display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" },
  legend: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid #1a1d22", fontSize: 13 },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0 },
  mut: { color: "var(--ink-muted)", fontSize: 12 },
  num: { fontFamily: "ui-monospace, monospace", fontSize: 12, minWidth: 76, textAlign: "right" },
  h2: { fontSize: 14, fontWeight: 600, marginTop: 8 },
  save: { color: "var(--ok)", fontWeight: 400, fontSize: 13 },
  waste: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #1a1d22", fontSize: 13 },
  wasteTag: { color: "#f6ad55", minWidth: 110 },
};
