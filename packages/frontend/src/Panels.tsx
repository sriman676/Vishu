import { useEffect, useState } from "react";
import { automationAddTrigger, automationList, automationSaveWorkflow, careerAchievementAdd, careerAchievements, careerResume, type Achievement, configSummary, type ConfigSummary, connectorsDaily, type DailyResult, dailyBriefing, evalRun, type EvalReport, type EvalTrend, memoryRecall, memoryTodoSet, type Recalled, startTurn, type Trigger, type Workflow } from "./api.js";

const box: React.CSSProperties = { flex: 1, overflowY: "auto", padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-md)" };

/** Consistent empty/placeholder line — one muted, tokenized style for every panel's "nothing yet" state. */
export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: "var(--ink-faint)", fontSize: 13, padding: "var(--space-sm) 0" }}>{children}</div>
);

const TIER_COLOR: Record<string, string> = { urgent: "var(--danger)", needs_action: "var(--accent)", info: "var(--ink-muted)", skip: "var(--ink-faint)" };

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
          <div style={{ color: TIER_COLOR[res.triage.tier] ?? "var(--ink-muted)", fontWeight: 600 }}>{res.triage.tier.toUpperCase()}</div>
          <div style={{ marginTop: 4 }}>{res.triage.summary}</div>
          {res.task && <div style={{ marginTop: 8 }}>📋 to-do: <strong>{res.task.task}</strong>{res.task.due ? ` (due: ${res.task.due})` : ""}</div>}
          {res.matters.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-muted)" }}>related matters: {res.matters.map((m) => m.name).join(", ")}</div>
          )}
          {res.draft && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>filed reply draft (not sent):</div>
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
            {data.trend.delta !== undefined && <span style={{ color: data.trend.delta >= 0 ? "var(--ok)" : "var(--danger)", marginLeft: 8 }}>{data.trend.delta >= 0 ? "+" : ""}{data.trend.delta.toFixed(2)} vs prev</span>}
          </div>
          {data.report.results.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, padding: "3px 0", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
              <span style={{ color: r.passed ? "var(--ok)" : "var(--danger)" }}>{r.passed ? "✓" : "✗"}</span>
              <span style={{ flex: 1 }}>{r.id}</span>
              <span style={{ color: "var(--ink-muted)" }}>{r.ms}ms</span>
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
      {notes.length === 0 && <Empty>Recall gathers matched notes + linked neighbours — never a vault dump.</Empty>}
      {notes.map((n) => (
        <div key={n.name} className="card">
          <div style={{ color: "var(--ink-muted)", fontSize: 12, marginBottom: 4 }}>{n.name} ({n.type}) · via {n.via} · {n.score.toFixed(2)}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Cold-apply pipeline: resume page — assemble the resume (profile + achievements + GitHub projects) and
 * capture achievements (timestamped). Generation/scoring/outreach run through the agent chat; this page is
 * the resume view + achievement capture. */
export function Resume({ token }: { token: string }) {
  const [markdown, setMarkdown] = useState("");
  const [items, setItems] = useState<Achievement[]>([]);
  const [text, setText] = useState("");
  const load = async () => {
    try {
      const [r, a] = await Promise.all([careerResume(token), careerAchievements(token)]);
      setMarkdown(r.markdown);
      setItems(a.items);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };
  const add = async () => {
    if (!text.trim()) return;
    try {
      await careerAchievementAdd(token, text);
      setText("");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (token) load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="add an achievement (use #tags to group)…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add}>Add</button>
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      {items.length === 0 && <Empty>Tell Vishu your achievements (chat or here) — they're timestamped and feed the resume.</Empty>}
      {items.map((a) => (
        <div key={`${a.at}-${a.text}`} style={{ color: "var(--ink-muted)", fontSize: 12 }}>
          {a.at.slice(0, 10)} — {a.text}
        </div>
      ))}
      {markdown && (
        <div className="card">
          <div style={{ color: "var(--ink-muted)", fontSize: 12, marginBottom: 4 }}>Assembled resume</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{markdown}</div>
        </div>
      )}
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
      {notes.length === 0 && <Empty>No matters or to-dos filed yet — triage a message in Inbox to file some.</Empty>}
      {(["matter", "todo"] as const).map((t) =>
        group(t).length === 0 ? null : (
          <div key={t}>
            <div style={{ color: "var(--accent)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0" }}>{t === "matter" ? "Matters" : "To-dos"}</div>
            {group(t).map((n) => (
              <div key={n.name} className="card" style={{ marginBottom: 8 }}>
                <div style={{ color: "var(--ink-muted)", fontSize: 12, marginBottom: 4 }}>{n.name}</div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.body}</div>
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

/** §11g Board: a read-only Kanban derived from recalled notes. Todo notes carry checklist lines —
 * "- [ ]" items land in To-do, "- [x]" in Done; matter notes form a Backlog column. Moving cards would
 * be memory writes, so this stays read-only (ponytail: read first). Reuses memory_recall_memories. */
const colHead: React.CSSProperties = { color: "var(--accent)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0" };

/** Kanban board over the memory vault. To-do/Done are live checkbox lines from todo notes; dragging a
 * card between them flips its `- [ ]`/`- [x]` and persists via memory_todo_set (survives reload). Backlog
 * (matters) is read-only — matters aren't checkbox items, so there's nothing to toggle. */
export function Board({ token }: { token: string }) {
  const [notes, setNotes] = useState<Recalled[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const load = () => {
    if (!token) return;
    memoryRecall(token, "open matters todo tasks", 30)
      .then((r) => setNotes(r.notes.filter((n) => n.type === "todo" || n.type === "matter")))
      .catch((e) => alert(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [token]);

  const items = (checked: boolean) =>
    notes
      .filter((n) => n.type === "todo")
      .flatMap((n) =>
        n.body
          .split("\n")
          .filter((l) => l.trim().toLowerCase().startsWith(checked ? "- [x]" : "- [ ]"))
          .map((l) => ({ note: n.name, text: l.replace(/^-\s*\[[ xX]\]\s*/, "").trim() })),
      );

  const drop = (raw: string, done: boolean) => {
    setOver(null);
    try {
      const { note, text } = JSON.parse(raw) as { note: string; text: string };
      if (note && text) memoryTodoSet(token, note, text, done).then(load).catch((e) => alert(e instanceof Error ? e.message : String(e)));
    } catch {
      /* drop payload wasn't a draggable card — ignore */
    }
  };

  const column = (title: string, done: boolean, cards: { note: string; text: string }[]) => (
    <div
      style={{ flex: 1, minWidth: 0, borderRadius: 6, outline: over === title ? "1px dashed var(--accent)" : "none", padding: 2 }}
      onDragOver={(e) => { e.preventDefault(); setOver(title); }}
      onDragLeave={() => setOver((o) => (o === title ? null : o))}
      onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData("text/plain"), done); }}
    >
      <div style={colHead}>{title} ({cards.length})</div>
      {cards.map((c) => (
        <div
          key={`${c.note}::${c.text}`}
          className="card"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ note: c.note, text: c.text }))}
          style={{ marginBottom: 8, cursor: "grab" }}
        >
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{c.text}</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 11, marginTop: 4 }}>{c.note}</div>
        </div>
      ))}
    </div>
  );

  const backlog = notes.filter((n) => n.type === "matter");
  return (
    <div style={box}>
      {notes.length === 0 && <Empty>No tasks or matters yet — triage a message in Inbox to fill the board.</Empty>}
      <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-start" }}>
        {column("To-do", false, items(false))}
        {column("Done", true, items(true))}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={colHead}>Backlog ({backlog.length})</div>
          {backlog.map((n) => (
            <div key={n.name} className="card" style={{ marginBottom: 8 }}>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.body.slice(0, 120)}</div>
              <div style={{ color: "var(--ink-muted)", fontSize: 11, marginTop: 4 }}>{n.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** §11g Calendar: no live calendar until a token is wired (StubCalendar throws), so this shows the
 * connect-a-token placeholder plus any to-dos that carry a due date (the daily-driver writes them as
 * "… (due: <when>)"). ponytail: parse the due out of the note body — no calendar API until creds land. */
export function Calendar({ token }: { token: string }) {
  const [due, setDue] = useState<{ name: string; text: string; when: string }[]>([]);
  useEffect(() => {
    if (!token) return;
    memoryRecall(token, "todo due date", 20)
      .then((r) =>
        setDue(
          r.notes
            .filter((n) => n.type === "todo")
            .map((n) => ({ name: n.name, text: n.body, when: /due:\s*([^)\n]+)/i.exec(n.body)?.[1]?.trim() ?? "" }))
            .filter((d) => d.when),
        ),
      )
      .catch(() => {});
  }, [token]);
  return (
    <div style={box}>
      <div className="card" style={{ color: "var(--ink-muted)" }}>
        📅 No calendar connected. Set <code>VISHU_GCAL_TOKEN</code> (or <code>VISHU_OUTLOOK_TOKEN</code>) to sync live events. Until then, dated to-dos appear below.
      </div>
      {due.length === 0 && <Empty>No dated to-dos yet.</Empty>}
      {due.map((d) => (
        <div key={d.name} className="card">
          <div style={{ color: "var(--accent)", fontSize: 12 }}>due: {d.when}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 4 }}>{d.text}</div>
        </div>
      ))}
    </div>
  );
}

/** §9 Activity dashboard: the SSE bus as a categorized live feed. Sorts each event into gate / trigger /
 * sync / notification by its domain/type/payload, colours it, and shows a per-category count. */
type Cat = "gate" | "trigger" | "sync" | "notification" | "other";
const CAT_COLOR: Record<Cat, string> = { gate: "#c58af9", trigger: "#7aa2f7", sync: "var(--ok)", notification: "#e0af68", other: "var(--ink-faint)" };
function categorize(raw: string): { cat: Cat; text: string } {
  let e: { domain?: string; type?: string; payload?: Record<string, unknown> } = {};
  try {
    e = JSON.parse(raw);
  } catch {
    return { cat: "other", text: raw };
  }
  const p = e.payload ?? {};
  let cat: Cat = "other";
  if (e.domain === "tool" && e.type === "sync") cat = "sync";
  else if ("trigger" in p) cat = "trigger";
  else if ("decision" in p || "gate" in p || "action" in p || "approval" in p) cat = "gate";
  else if (e.type === "notification") cat = "notification";
  return { cat, text: raw };
}

export function Activity({ events }: { events: string[] }) {
  const items = events.map(categorize);
  const counts = items.reduce<Record<string, number>>((a, { cat }) => ((a[cat] = (a[cat] ?? 0) + 1), a), {});
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(["gate", "trigger", "sync", "notification", "other"] as Cat[]).map((c) => (
          <span key={c} className="card" style={{ padding: "4px 10px", fontSize: 12, borderLeft: `3px solid ${CAT_COLOR[c]}` }}>
            {c}: <strong>{counts[c] ?? 0}</strong>
          </span>
        ))}
      </div>
      {items.length === 0 && <Empty>No activity yet — gate decisions, triggers, tool syncs, and notifications stream here live.</Empty>}
      {items
        .slice()
        .reverse()
        .map((it, i) => (
          <div key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, padding: "4px 8px", borderLeft: `3px solid ${CAT_COLOR[it.cat]}`, wordBreak: "break-all" }}>
            {it.text}
          </div>
        ))}
    </div>
  );
}

/** §12d Automation: a visual workflow builder. The agent proposes a workflow (or you build one by hand),
 * you review/edit the steps on the canvas, optionally attach a trigger, then save — which round-trips
 * through vishu.automation_save_workflow + automation_add_trigger and shows up in automation_list.
 * ponytail: a reorderable step-card list, not a drag-graph editor — the workflow model is a linear step
 * array, so cards are the right altitude; a node graph is the upgrade if steps ever branch. */
export function Automation({ token }: { token: string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  // Optional trigger to attach on save. Blank id = save the workflow only.
  const [trigId, setTrigId] = useState("");
  const [trigKind, setTrigKind] = useState<"schedule" | "file">("schedule");
  const [trigEveryMin, setTrigEveryMin] = useState("60");
  const [trigPath, setTrigPath] = useState("");

  const refresh = async () => {
    try {
      const r = await automationList(token);
      setWorkflows(r.workflows);
      setTriggers(r.triggers);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (token) refresh();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStep = (i: number, v: string) => setSteps((s) => s.map((x, j) => (j === i ? v : x)));
  const addStep = () => setSteps((s) => [...s, ""]);
  const removeStep = (i: number) => setSteps((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : s));
  const moveStep = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const c = [...s];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  // Agent proposes a workflow: ask for strict JSON, parse {name, steps} into the canvas for review.
  const propose = async () => {
    if (!goal.trim()) return;
    setBusy("propose");
    setMsg("");
    try {
      const r = await startTurn(
        token,
        `Propose an automation workflow for this goal. Reply with ONLY JSON: {"name": string, "steps": string[]} where each step is one imperative instruction. Goal: ${goal.trim()}`,
      );
      const json = r.final.slice(r.final.indexOf("{"), r.final.lastIndexOf("}") + 1);
      const wf = JSON.parse(json) as Workflow;
      if (wf.name) setName(wf.name);
      if (Array.isArray(wf.steps) && wf.steps.length) setSteps(wf.steps.map(String));
      setMsg("Proposed — review and edit below, then Save.");
    } catch (e) {
      setMsg(`Couldn't parse a workflow from the reply: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
    if (!name.trim() || cleanSteps.length === 0) return setMsg("Name and at least one step are required.");
    setBusy("save");
    setMsg("");
    try {
      await automationSaveWorkflow(token, name.trim(), cleanSteps);
      if (trigId.trim()) {
        const spec: Trigger["spec"] =
          trigKind === "schedule"
            ? { type: "schedule", everyMs: Math.max(1, Number(trigEveryMin) || 60) * 60_000 }
            : { type: "file", path: trigPath.trim() };
        await automationAddTrigger(token, { id: trigId.trim(), spec, workflow: name.trim() });
      }
      setMsg(`Saved "${name.trim()}"${trigId.trim() ? ` + trigger "${trigId.trim()}"` : ""}.`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={box}>
      <div className="card">
        <div style={{ color: "var(--accent)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Build a workflow</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input className="input" placeholder="describe a goal for the agent to propose…" value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && propose()} />
          <button className="btn" disabled={!!busy || !token || !goal.trim()} onClick={propose}>{busy === "propose" ? "…" : "Propose"}</button>
        </div>
        <input className="input" placeholder="workflow name" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 8 }} />
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <span style={{ color: "#8aa", fontFamily: "ui-monospace, monospace", fontSize: 12, width: 20 }}>{i + 1}</span>
            <input className="input" style={{ flex: 1 }} placeholder={`step ${i + 1}`} value={s} onChange={(e) => setStep(i, e.target.value)} />
            <button className="btn" title="up" disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
            <button className="btn" title="down" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
            <button className="btn" title="remove" onClick={() => removeStep(i)}>✕</button>
          </div>
        ))}
        <button className="btn" onClick={addStep} style={{ marginBottom: 12 }}>+ step</button>

        <div style={{ color: "var(--accent)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 8px" }}>Trigger (optional)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" style={{ width: 140 }} placeholder="trigger id" value={trigId} onChange={(e) => setTrigId(e.target.value)} />
          <select className="input" value={trigKind} onChange={(e) => setTrigKind(e.target.value as "schedule" | "file")}>
            <option value="schedule">every N min</option>
            <option value="file">on file change</option>
          </select>
          {trigKind === "schedule" ? (
            <input className="input" style={{ width: 90 }} type="number" min={1} value={trigEveryMin} onChange={(e) => setTrigEveryMin(e.target.value)} />
          ) : (
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="path to watch" value={trigPath} onChange={(e) => setTrigPath(e.target.value)} />
          )}
        </div>

        <button className="btn primary" disabled={!!busy || !token} onClick={save} style={{ marginTop: 12 }}>{busy === "save" ? "saving…" : "Save workflow"}</button>
        {msg && <div style={{ marginTop: 8, fontSize: 12, color: "#8aa", whiteSpace: "pre-wrap" }}>{msg}</div>}
      </div>

      <div style={{ color: "var(--accent)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0" }}>Saved ({workflows.length})</div>
      {workflows.length === 0 && <div style={{ color: "#888" }}>No workflows yet — build one above and Save.</div>}
      {workflows.map((w) => {
        const trigs = triggers.filter((t) => t.workflow === w.name);
        return (
          <div key={w.name} className="card">
            <div style={{ fontWeight: 600 }}>{w.name}</div>
            <ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13 }}>
              {w.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 2 }}>{s}</li>
              ))}
            </ol>
            {trigs.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#8aa" }}>
                triggers: {trigs.map((t) => `${t.id} (${t.spec.type === "schedule" ? `every ${Math.round(t.spec.everyMs / 60000)}m` : t.spec.type})`).join(", ")}
              </div>
            )}
          </div>
        );
      })}
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
