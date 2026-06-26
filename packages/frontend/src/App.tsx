import { useEffect, useRef, useState } from "react";
import { startTurn, subscribeEvents } from "./api.js";
import { Tokens } from "./Tokens.js";

interface Msg {
  role: "user" | "assistant" | "error";
  content: string;
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("vishu.token") ?? "");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"chat" | "tokens">("chat");
  const sessionId = useRef<string | undefined>(undefined);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => localStorage.setItem("vishu.token", token), [token]);
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
    return subscribeEvents(token, (e) => setEvents((prev) => [...prev.slice(-49), JSON.stringify(e)]));
  }, [token]);
  useEffect(() => log.current?.scrollTo(0, log.current.scrollHeight), [msgs]);
  // PWA share target: text shared into Vishu arrives as ?text= — prefill the composer.
  useEffect(() => {
    const shared = new URLSearchParams(location.search).get("text");
    if (shared) setInput((cur) => cur || shared);
  }, []);

  function startVoice() {
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
      const r = await startTurn(token, message, sessionId.current);
      sessionId.current = r.sessionId;
      setMsgs((m) => [...m, { role: "assistant", content: r.final }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "error", content: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <strong style={{ fontSize: 18 }}>Vishu</strong>
        <nav style={S.tabs}>
          <button style={tab === "chat" ? S.tabOn : S.tab} onClick={() => setTab("chat")}>Chat</button>
          <button style={tab === "tokens" ? S.tabOn : S.tab} onClick={() => setTab("tokens")} disabled={!token}>Tokens</button>
        </nav>
        <input
          style={S.token}
          type="password"
          placeholder="paste core.token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </header>

      {tab === "tokens" ? (
        <Tokens token={token} />
      ) : (
        <>
      <div style={S.body}>
        <div ref={log} style={S.chat}>
          {msgs.length === 0 && <div style={{ color: "#888" }}>Start a turn — same `vishu.*` contract as the CLI.</div>}
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
          style={S.input}
          placeholder={token ? "Message Vishu…" : "Set the token first"}
          value={input}
          disabled={!token || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button style={S.mic} onClick={startVoice} disabled={!token} title="Voice capture">
          🎤
        </button>
        <button style={S.send} onClick={send} disabled={!token || busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </footer>
        </>
      )}
    </div>
  );
}

const roleStyle: Record<Msg["role"], React.CSSProperties> = {
  user: { background: "#1e2a3a" },
  assistant: { background: "#1c2a1c" },
  error: { background: "#3a1e1e", color: "#ffb4b4" },
};

const S: Record<string, React.CSSProperties> = {
  page: { display: "flex", flexDirection: "column", height: "100vh", margin: 0, fontFamily: "system-ui, sans-serif", background: "#0e1116", color: "#e6e6e6" },
  header: { display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #222" },
  tabs: { display: "flex", gap: 4 },
  tab: { padding: "5px 12px", background: "transparent", color: "#8aa", border: "1px solid #2a2f37", borderRadius: 6, cursor: "pointer" },
  tabOn: { padding: "5px 12px", background: "#1e2a3a", color: "#e6e6e6", border: "1px solid #2b6cb0", borderRadius: 6, cursor: "pointer" },
  token: { marginLeft: "auto", width: 280, padding: "6px 8px", background: "#161a20", color: "#e6e6e6", border: "1px solid #2a2f37", borderRadius: 6 },
  body: { display: "flex", flex: 1, minHeight: 0 },
  chat: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 },
  msg: { padding: "8px 12px", borderRadius: 8, display: "flex", flexDirection: "column", gap: 4, maxWidth: 760 },
  role: { fontSize: 11, textTransform: "uppercase", color: "#8aa", letterSpacing: 0.5 },
  events: { width: 320, borderLeft: "1px solid #222", overflowY: "auto", padding: 12, fontSize: 11, fontFamily: "ui-monospace, monospace" },
  eventsTitle: { color: "#8aa", marginBottom: 8 },
  event: { padding: "4px 0", borderBottom: "1px solid #1a1d22", wordBreak: "break-all", color: "#9bb" },
  footer: { display: "flex", gap: 8, padding: 12, borderTop: "1px solid #222" },
  input: { flex: 1, padding: "10px 12px", background: "#161a20", color: "#e6e6e6", border: "1px solid #2a2f37", borderRadius: 8 },
  mic: { padding: "10px 14px", background: "#161a20", color: "#e6e6e6", border: "1px solid #2a2f37", borderRadius: 8, cursor: "pointer" },
  send: { padding: "10px 20px", background: "#2b6cb0", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
};
