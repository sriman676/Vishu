import { useEffect, useState } from "react";
import { type DashboardSnapshot, dashboardSnapshot, subscribeEvents } from "./api.js";

const ago = (ms: number) => {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const SRC_COLOR: Record<string, string> = { model: "#63b3ed", gate: "#f6ad55", memory: "#68d391" };

/** §9 "visualize" — read-only. Left: data map (paths only, never values). Right: live activity tail.
 * ponytail: poll every 4s (snapshot-on-poll v1); swap to SSE if the tail feels too coarse. */
export function Visualize({ token }: { token: string }) {
  const [snap, setSnap] = useState<DashboardSnapshot | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let live = true;
    const load = () =>
      dashboardSnapshot(token)
        .then((s) => live && (setSnap(s), setError("")))
        .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    load();
    // Live push: refresh the instant an activity log changes; the poll is just a slow fallback now.
    const unsub = subscribeEvents(token, (e) => {
      if ((e as { domain?: string })?.domain === "dashboard") load();
    });
    const id = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(id);
      unsub();
    };
  }, [token]);

  if (error) return <div style={{ padding: 16, color: "var(--danger)" }}>{error}</div>;
  if (!snap) return <div style={{ padding: 16, color: "var(--ink-faint)" }}>Loading…</div>;

  return (
    <div style={S.wrap}>
      <div style={S.col}>
        <div style={S.h}>Data map</div>
        <div style={S.sub}>Where every piece of data lives — paths only, never values.</div>
        {snap.dataMap.map((n) => (
          <div key={n.path} style={{ ...S.node, opacity: n.exists ? 1 : 0.5 }} title={n.path}>
            <div style={S.nodeTop}>
              <span style={S.label}>{n.label}</span>
              <span style={S.mut}>{n.exists ? ago(n.modified ?? 0) : "not yet created"}</span>
            </div>
            <div style={S.holds}>{n.holds}</div>
            <div style={S.path}>{n.path}</div>
          </div>
        ))}
      </div>

      <div style={S.col}>
        <div style={S.h}>Background activity</div>
        <div style={S.sub}>Live tail of model calls, gate decisions, and memory events.</div>
        {snap.activity.length === 0 ? (
          <div style={{ color: "var(--ink-faint)" }}>Nothing yet — run a turn, then check back.</div>
        ) : (
          snap.activity.map((e, i) => (
            <div key={i} style={S.evt}>
              <span style={{ ...S.tag, color: SRC_COLOR[e.source] ?? "var(--ink-muted)" }}>{e.source}</span>
              <span style={{ flex: 1 }}>{e.text}</span>
              <span style={S.mut}>{ago(e.ts)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, overflowY: "auto", padding: 20, display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" },
  col: { flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 8 },
  h: { fontSize: 16, fontWeight: 600 },
  sub: { color: "var(--ink-muted)", fontSize: 12, marginBottom: 6 },
  node: { border: "1px solid #2a2f37", borderRadius: 8, padding: "8px 10px", background: "#161a20" },
  nodeTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  label: { fontWeight: 600, fontSize: 13 },
  holds: { fontSize: 12, color: "#c8d0da", marginTop: 2 },
  path: { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#6b7480", marginTop: 3, wordBreak: "break-all" },
  evt: { display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0", borderBottom: "1px solid #1a1d22", fontSize: 13 },
  tag: { minWidth: 54, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  mut: { color: "var(--ink-muted)", fontSize: 12, whiteSpace: "nowrap" },
};
