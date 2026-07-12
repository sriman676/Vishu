import { useEffect, useState } from "react";
import { configSummary, type ConfigSummary, connectorsDaily, type DailyResult, dailyBriefing, evalRun, type EvalReport, type EvalTrend, memoryRecall, type Recalled } from "./api.js";

const box: React.CSSProperties = { flex: 1, overflowY: "auto", padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-md)" };

const TIER_COLOR: Record<string, string> = { urgent: "var(--danger)", needs_action: "var(--accent)", info: "#8aa", skip: "#888" };

/** §11g Inbox/triage: paste an inbound message → connectors_daily triages it, matches Matters, files a to-do
 * and a reply draft (never sent). Also fires the one-shot daily briefing. */
export function Inbox({ token }: { token: string }) {
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  const [res, setRes] = useState<DailyResult>();
  const [brief, setBrief] = useState<string>();
  const [busy, setBusy] = useState("");
  const triage = async () => {
    if (!from.trim() || !text.trim()) return;
    setBusy("triage");
    try {
      setRes(await connectorsDaily(token, { from: from.trim(), text: text.trim() }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const briefing = async () => {
    setBusy("brief");
    try {
      setBrief((await dailyBriefing(token)).briefing || "Quiet day — nothing to surface.");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="from (sender)" value={from} onChange={(e) => setFrom(e.target.value)} />
        <button className="btn" disabled={!!busy} onClick={briefing}>{busy === "brief" ? "…" : "Daily briefing"}</button>
      </div>
      <textarea className="input" style={{ minHeight: 90, fontFamily: "inherit" }} placeholder="paste the message to triage…" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn primary" disabled={!!busy || !from.trim() || !text.trim()} onClick={triage}>{busy === "triage" ? "triaging…" : "Triage"}</button>
      {brief && <div className="card" style={{ whiteSpace: "pre-wrap" }}>{brief}</div>}
      {res && (
        <div className="card">
          <div style={{ color: TIER_COLOR[res.triage.tier] ?? "#8aa", fontWeight: 600 }}>{res.triage.tier.toUpperCase()}</div>
          <div style={{ marginTop: 4 }}>{res.triage.summary}</div>
          {res.task && <div style={{ marginTop: 8 }}>📋 to-do: <strong>{res.task.task}</strong>{res.task.due ? ` (due: ${res.task.due})` : ""}</div>}
          {res.matters.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#8aa" }}>related matters: {res.matters.map((m) => m.name).join(", ")}</div>
          )}
          {res.draft && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: "#8aa" }}>filed reply draft (not sent):</div>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{res.draft}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
          <button key={r} className="btn" disabled={!!busy} onClick={() => run(r)}>{busy === r ? "running…" : r}</button>
        ))}
      </div>
      {data && (
        <div className="card">
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
        <input className="input" placeholder="search the vault…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="btn" onClick={search}>Recall</button>
      </div>
      {notes.length === 0 && <div style={{ color: "#888" }}>Recall gathers matched notes + linked neighbours — never a vault dump.</div>}
      {notes.map((n) => (
        <div key={n.name} className="card">
          <div style={{ color: "#8aa", fontSize: 12, marginBottom: 4 }}>{n.name} ({n.type}) · via {n.via} · {n.score.toFixed(2)}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

/** §11g Matters/to-do: recall the vault and show what the daily-driver filed — open Matters and to-dos.
 * Reuses memory_recall_memories, then splits by record type (matter/todo). */
export function Matters({ token }: { token: string }) {
  const [q, setQ] = useState("open matters todo");
  const [notes, setNotes] = useState<Recalled[]>([]);
  const search = async () => {
    if (!q.trim()) return;
    try {
      setNotes((await memoryRecall(token, q, 20)).notes.filter((n) => n.type === "matter" || n.type === "todo"));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (token) search();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const group = (t: string) => notes.filter((n) => n.type === t);
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="btn" onClick={search}>Recall</button>
      </div>
      {notes.length === 0 && <div style={{ color: "#888" }}>No matters or to-dos filed yet — triage a message in Inbox to file some.</div>}
      {(["matter", "todo"] as const).map((t) =>
        group(t).length === 0 ? null : (
          <div key={t}>
            <div style={{ color: "var(--accent)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0" }}>{t === "matter" ? "Matters" : "To-dos"}</div>
            {group(t).map((n) => (
              <div key={n.name} className="card" style={{ marginBottom: 8 }}>
                <div style={{ color: "#8aa", fontSize: 12, marginBottom: 4 }}>{n.name}</div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.body}</div>
              </div>
            ))}
          </div>
        ),
      )}
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
        <div className="card">
          <div>provider: <strong>{cfg.provider}</strong></div>
          <div>default model: <strong>{cfg.model}</strong></div>
          <div>key mode: <strong>{cfg.keyMode}</strong> {cfg.keyMode === "balance" ? "(parallel pool)" : cfg.keyMode === "local" ? "(local-first)" : "(failover)"}</div>
          {cfg.pool.length > 0 && <div>pool: <strong>{cfg.pool.join(" + ")}</strong></div>}
        </div>
      )}
      <div className="card">
        <div style={{ marginBottom: 8 }}>Model for new turns (override; blank = server default). Ignored when a pool is active.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" placeholder="e.g. claude-opus-4-… / gpt-4o / llama-3.3-70b" value={model} onChange={(e) => setModel(e.target.value)} />
          {model && <button className="btn" onClick={() => setModel("")}>clear</button>}
        </div>
        {cfg && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {cfg.presets.map((p) => (
              <button key={p.name} className="btn" style={{ fontSize: 12 }} title={p.model} onClick={() => setModel(p.model)}>{p.name}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
