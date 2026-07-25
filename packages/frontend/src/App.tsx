import { useEffect, useRef, useState } from "react";
import { type Mode, modeActivate, modeList, startTurn, subscribeEvents } from "./api.js";
import { Orb } from "./Orb.js";
import { Activity, Board, Calendar, Empty, Eval, Inbox, Matters, Memory, Settings } from "./Panels.js";
import { Tokens } from "./Tokens.js";
import { Visualize } from "./Visualize.js";

type Tab = "chat" | "inbox" | "matters" | "board" | "calendar" | "activity" | "visualize" | "notifications" | "tokens" | "eval" | "memory" | "settings";

interface Msg {
  role: "user" | "assistant" | "error";
  content: string;
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("vishu.token") ?? "");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [notifs, setNotifs] = useState<string[]>([]);
  const [seen, setSeen] = useState(0);
  const [model, setModel] = useState(() => localStorage.getItem("vishu.model") ?? "");
  const [voiceOut, setVoiceOut] = useState(() => localStorage.getItem("vishu.voiceOut") === "1");
  const [modes, setModes] = useState<Mode[]>([]);
  const [activeMode, setActiveMode] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const sessionId = useRef<string | undefined>(undefined);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => localStorage.setItem("vishu.token", token), [token]);
  useEffect(() => localStorage.setItem("vishu.model", model), [model]);
  useEffect(() => localStorage.setItem("vishu.voiceOut", voiceOut ? "1" : "0"), [voiceOut]);
  useEffect(() => {
    if (tab === "notifications") setSeen(notifs.length);
  }, [tab, notifs.length]);
  // Desktop harness: ask the Rust host for a ready session so the user never pastes a token.
  // No-op in the browser/PWA (no __TAURI__), where the paste box stays the path. Polls until ready.
  useEffect(() => {
    const invoke = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string) => Promise<{ token: string; ready: boolean }> } } }).__TAURI__?.core?.invoke;
    if (!invoke) return;
    let stop = false;
    const tick = async () => {
      const s = await invoke("harness_session").catch(() => undefined);
      if (s?.ready && s.token) setToken(s.token);
      else if (!stop) setTimeout(tick, 500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    modeList(token).then((r) => { setModes(r.modes); setActiveMode(r.active); }).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!token) return;
    return subscribeEvents(token, (e) => {
      const s = JSON.stringify(e);
      setEvents((prev) => [...prev.slice(-49), s]);
      if (s.includes("notification")) setNotifs((prev) => [...prev.slice(-99), s]); // system/notification events
    });
  }, [token]);
  useEffect(() => log.current?.scrollTo(0, log.current.scrollHeight), [msgs]);
  // PWA share target: text shared into Vishu arrives as ?text= — prefill the composer.
  useEffect(() => {
    const shared = new URLSearchParams(location.search).get("text");
    if (shared) setInput((cur) => cur || shared);
  }, []);

  // Speak the assistant reply in the active mode's voice (§8): match the mode's voiceId hint loosely against
  // the browser's installed SpeechSynthesis voices; fall back to the default when none matches.
  function speak(text: string) {
    if (!voiceOut || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const want = modes.find((m) => m.name === activeMode)?.voiceId;
    if (want) {
      const v = speechSynthesis.getVoices().find((v) => v.name.toLowerCase().includes(want.toLowerCase()));
      if (v) u.voice = v;
    }
    speechSynthesis.speak(u);
  }

  async function switchMode(name: string) {
    if (!name || name === activeMode) return;
    const prev = activeMode;
    setActiveMode(name); // optimistic
    const r = await modeActivate(token, name).catch(() => ({ activated: false, reason: "rpc failed" }));
    if (!r.activated) {
      setActiveMode(prev);
      alert(`Couldn't switch mode: ${r.reason ?? "unknown"}`);
    }
  }

  function startVoice() {
    if ("speechSynthesis" in window) speechSynthesis.cancel(); // barge-in: stop TTS the moment the mic opens
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => any; SpeechRecognition?: new () => any });
    const Ctor = SR.SpeechRecognition ?? SR.webkitSpeechRecognition;
    if (!Ctor) return alert("Voice capture isn't supported in this browser.");
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.onresult = (e: any) => setInput((cur) => (cur ? `${cur} ` : "") + e.results[0][0].transcript);
    rec.start();
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const r = await startTurn(token, message, sessionId.current, model || undefined);
      sessionId.current = r.sessionId;
      setMsgs((m) => [...m, { role: "assistant", content: r.final }]);
      speak(r.final);
    } catch (e) {
      setMsgs((m) => [...m, { role: "error", content: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <strong style={{ fontSize: 18, letterSpacing: "-0.02em", color: "var(--accent)", fontFamily: "var(--font-display)" }}>Vishu</strong>
        <Orb />
        <nav style={S.tabs}>
          {(["chat", "inbox", "matters", "board", "calendar", "activity", "visualize", "notifications", "tokens", "eval", "memory", "settings"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "btn on" : "btn"} onClick={() => setTab(t)} disabled={t !== "chat" && !token}>
              {t === "notifications" ? `Notifications${notifs.length > seen ? ` (${notifs.length - seen})` : ""}` : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        {modes.length > 0 && (
          <select className="input" style={{ marginLeft: "auto", width: 150 }} value={activeMode} onChange={(e) => switchMode(e.target.value)} title="Active persona/mode">
            {modes.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        )}
        <input
          className="input"
          style={{ marginLeft: modes.length > 0 ? undefined : "auto", width: 280 }}
          type="password"
          placeholder="paste core.token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </header>

      {tab === "inbox" && <Inbox token={token} />}
      {tab === "matters" && <Matters token={token} />}
      {tab === "board" && <Board token={token} />}
      {tab === "calendar" && <Calendar token={token} />}
      {tab === "activity" && <Activity events={events} />}
      {tab === "visualize" && <Visualize token={token} />}
      {tab === "tokens" && <Tokens token={token} />}
      {tab === "eval" && <Eval token={token} />}
      {tab === "memory" && <Memory token={token} />}
      {tab === "settings" && <Settings token={token} model={model} setModel={setModel} />}
      {tab === "notifications" && (
        <div style={{ ...S.chat, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
          {notifs.length === 0 && <Empty>No notifications yet — budget alerts, triggers, and triage land here.</Empty>}
          {notifs.map((n, i) => (
            <div key={i} style={S.event}>{n}</div>
          ))}
        </div>
      )}
      {tab === "chat" && (
        <>
      <div style={S.body}>
        <div ref={log} style={S.chat}>
          {msgs.length === 0 && <Empty>Start a turn — same `vishu.*` contract as the CLI.</Empty>}
          {msgs.map((m, i) => (
            <div key={i} style={{ ...S.msg, ...(roleStyle[m.role]) }}>
              <span style={S.role}>{m.role}</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
            </div>
          ))}
        </div>
        <aside style={S.events}>
          <div style={S.eventsTitle}>events ({events.length})</div>
          {events.map((e, i) => (
            <div key={i} style={S.event}>
              {e}
            </div>
          ))}
        </aside>
      </div>

      <footer style={S.footer}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={token ? "Message Vishu…" : "Set the token first"}
          value={input}
          disabled={!token || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn" onClick={startVoice} disabled={!token} title="Voice capture (barge-in stops speech)">
          🎤
        </button>
        <button className={voiceOut ? "btn on" : "btn"} onClick={() => setVoiceOut((v) => !v)} title="Speak replies aloud">
          {voiceOut ? "🔊" : "🔈"}
        </button>
        <button className="btn primary" onClick={send} disabled={!token || busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </footer>
        </>
      )}
    </div>
  );
}

const roleStyle: Record<Msg["role"], React.CSSProperties> = {
  user: { background: "var(--surface-2)" },
  assistant: { background: "color-mix(in oklab, var(--accent) 12%, var(--surface-1))" },
  error: { background: "color-mix(in oklab, var(--danger) 16%, var(--surface-1))", color: "var(--danger)" },
};

const S: Record<string, React.CSSProperties> = {
  page: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "var(--font-body)" },
  header: { display: "flex", gap: "var(--space-md)", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--line)" },
  tabs: { display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" },
  body: { display: "flex", flex: 1, minHeight: 0 },
  chat: { flex: 1, overflowY: "auto", padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" },
  msg: { padding: "8px 12px", borderRadius: "var(--radius)", display: "flex", flexDirection: "column", gap: 4, maxWidth: 760 },
  role: { fontSize: 11, textTransform: "uppercase", color: "var(--accent)", letterSpacing: 0.5 },
  events: { width: 320, borderLeft: "1px solid var(--line)", overflowY: "auto", padding: "var(--space-md)", fontSize: 11, fontFamily: "var(--font-mono)" },
  eventsTitle: { color: "var(--ink-muted)", marginBottom: "var(--space-sm)" },
  event: { padding: "4px 0", borderBottom: "1px solid var(--line)", wordBreak: "break-all", color: "var(--ink-muted)" },
  footer: { display: "flex", gap: "var(--space-sm)", padding: "var(--space-md)", borderTop: "1px solid var(--line)" },
};
