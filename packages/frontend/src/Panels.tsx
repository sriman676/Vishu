import { useEffect, useState } from "react";
import { configSummary, type ConfigSummary, evalRun, type EvalReport, type EvalTrend, memoryRecall, type Recalled } from "./api.js";

const box: React.CSSProperties = { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const card: React.CSSProperties = { background: "#161a20", border: "1px solid #2a2f37", borderRadius: 8, padding: 12 };
const btn: React.CSSProperties = { padding: "6px 14px", background: "#1e2a3a", color: "#e6e6e6", border: "1px solid #2b6cb0", borderRadius: 6, cursor: "pointer" };
const inp: React.CSSProperties = { flex: 1, padding: "8px 10px", background: "#0e1116", color: "#e6e6e6", border: "1px solid #2a2f37", borderRadius: 6 };

/** Eval dashboard: run a runner against the suite, show pass-rate + per-task + trend (vishu.eval_run). */
export function Eval({ token }: { token: string }) {
  const [data, setData] = useState<{ report: EvalReport; trend: EvalTrend }>();
  const [busy, setBusy] = useState("");
  const run = async (runner: string) => {
    setBusy(runner);
    try {
      setData(await evalRun(token, runner));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 8 }}>
        {["baseline", "effort", "moa"].map((r) => (
          <button key={r} style={btn} disabled={!!busy} onClick={() => run(r)}>{busy === r ? "running…" : r}</button>
        ))}
      </div>
      {data && (
        <div style={card}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>
            {data.report.runner}: <strong>{Math.round(data.report.passRate * 100)}%</strong> pass
            {data.trend.delta !== undefined && <span style={{ color: data.trend.delta >= 0 ? "#7c7" : "#d77", marginLeft: 8 }}>{data.trend.delta >= 0 ? "+" : ""}{data.trend.delta.toFixed(2)} vs prev</span>}
          </div>
          {data.report.results.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, padding: "3px 0", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
              <span style={{ color: r.passed ? "#7c7" : "#d77" }}>{r.passed ? "✓" : "✗"}</span>
              <span style={{ flex: 1 }}>{r.id}</span>
              <span style={{ color: "#8aa" }}>{r.ms}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Memory/vault browser: hybrid recall over the Obsidian vault (vishu.memory_recall_memories). */
export function Memory({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<Recalled[]>([]);
  const search = async () => {
    if (!q.trim()) return;
    try {
      setNotes((await memoryRecall(token, q)).notes);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={inp} placeholder="search the vault…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button style={btn} onClick={search}>Recall</button>
      </div>
      {notes.length === 0 && <div style={{ color: "#888" }}>Recall gathers matched notes + linked neighbours — never a vault dump.</div>}
      {notes.map((n) => (
        <div key={n.name} style={card}>
          <div style={{ color: "#8aa", fontSize: 12, marginBottom: 4 }}>{n.name} ({n.type}) · via {n.via} · {n.score.toFixed(2)}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Settings: active provider/model/key-mode + pool, and the preset model list for the switcher. */
export function Settings({ token, model, setModel }: { token: string; model: string; setModel: (m: string) => void }) {
  const [cfg, setCfg] = useState<ConfigSummary>();
  useEffect(() => {
    configSummary(token).then(setCfg).catch(() => {});
  }, [token]);
  return (
    <div style={box}>
      {cfg && (
        <div style={card}>
          <div>provider: <strong>{cfg.provider}</strong></div>
          <div>default model: <strong>{cfg.model}</strong></div>
          <div>key mode: <strong>{cfg.keyMode}</strong> {cfg.keyMode === "balance" ? "(parallel pool)" : cfg.keyMode === "local" ? "(local-first)" : "(failover)"}</div>
          {cfg.pool.length > 0 && <div>pool: <strong>{cfg.pool.join(" + ")}</strong></div>}
        </div>
      )}
      <div style={card}>
        <div style={{ marginBottom: 8 }}>Model for new turns (override; blank = server default). Ignored when a pool is active.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={inp} placeholder="e.g. claude-opus-4-… / gpt-4o / llama-3.3-70b" value={model} onChange={(e) => setModel(e.target.value)} />
          {model && <button style={btn} onClick={() => setModel("")}>clear</button>}
        </div>
        {cfg && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {cfg.presets.map((p) => (
              <button key={p.name} style={{ ...btn, fontSize: 12 }} title={p.model} onClick={() => setModel(p.model)}>{p.name}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
