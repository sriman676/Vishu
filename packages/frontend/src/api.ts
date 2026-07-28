// The same `vishu.*` JSON-RPC contract the CLI speaks, over the Vite proxy (same-origin /rpc, /events).

type RpcOutcome<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string } };
type JsonRpcResponse = { result?: RpcOutcome<unknown>; error?: { code: number; message: string } };

export async function rpc<T>(token: string, method: string, params?: unknown): Promise<T> {
  const res = await fetch("/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (res.status === 401) throw new Error("unauthorized — token mismatch (paste the core.token contents)");
  const body = (await res.json()) as JsonRpcResponse;
  if (body.error) throw new Error(body.error.message); // JSON-RPC protocol error
  const outcome = body.result;
  if (!outcome) throw new Error("empty response");
  if (!outcome.ok) throw new Error(outcome.error.message); // domain error envelope
  return outcome.result as T;
}

export interface TurnResult {
  sessionId: string;
  final: string;
  iterations: number;
  turns: number;
}

export const startTurn = (token: string, message: string, sessionId?: string, model?: string) =>
  rpc<TurnResult>(token, "vishu.agent_start_turn", { message, sessionId, model });

export interface ConfigSummary {
  provider: string;
  model: string;
  keyMode: string;
  pool: string[];
  presets: { name: string; model: string }[];
}
export const configSummary = (token: string) => rpc<ConfigSummary>(token, "vishu.config_summary");

export interface EvalResult { id: string; passed: boolean; score: number; ms: number; detail?: string }
export interface EvalReport { runner: string; passRate: number; meanScore: number; results: EvalResult[] }
export interface EvalTrend { runs: number; latest: number; previous?: number; delta?: number }
export const evalRun = (token: string, runner: string) =>
  rpc<{ report: EvalReport; trend: EvalTrend }>(token, "vishu.eval_run", { runner });

export interface Recalled { name: string; type: string; body: string; score: number; via: string }
export const memoryRecall = (token: string, query: string, limit = 8) =>
  rpc<{ notes: Recalled[]; text: string }>(token, "vishu.memory_recall_memories", { query, limit });

/** Board drag write-back: flip a todo checkbox line (To-do↔Done) and persist it. */
export const memoryTodoSet = (token: string, note: string, text: string, done: boolean) =>
  rpc<{ name: string }>(token, "vishu.memory_todo_set", { note, text, done });

// §11a daily-driver: triage a pasted message → tier/summary + matched matters + extracted to-do + filed draft.
export type Tier = "skip" | "info" | "urgent" | "needs_action";
export interface DailyResult {
  triage: { summary: string; tier: Tier };
  matters: { name: string; body: string; score: number }[];
  task: { task: string; due?: string } | null;
  draft?: string;
}
export const connectorsDaily = (token: string, msg: { channel?: string; from: string; text: string; id?: string }) =>
  rpc<DailyResult>(token, "vishu.connectors_daily", msg);
export const dailyBriefing = (token: string) => rpc<{ briefing: string }>(token, "vishu.daily_briefing");

// F12 personas/modes: list for the switcher + the active mode's voiceId (§8 voice).
export interface Mode { name: string; system: string; tools: string[] | "inherit"; memoryFolder: string; voiceId?: string }
export const modeList = (token: string) => rpc<{ modes: Mode[]; active: string }>(token, "vishu.mode_list");
export const modeActivate = (token: string, name: string) =>
  rpc<{ activated: boolean; reason?: string }>(token, "vishu.mode_activate", { name });

export interface CategoryStat {
  category: string;
  calls: number;
  tokens: number;
  pct: number;
  usd: number;
}
export interface WasteItem {
  kind: "context_bloat" | "model_overkill" | "duplicate";
  calls: number;
  tokens: number;
  usd: number;
  action: string;
}
export interface TokenReport {
  days: number;
  totalCalls: number;
  totalTokens: number;
  totalUsd: number;
  byCategory: CategoryStat[];
  waste: WasteItem[];
  savingsTokens: number;
  savingsUsd: number;
}

export const tokenReport = (token: string, days = 7) =>
  rpc<TokenReport>(token, "vishu.token_report", { days });

// §12d visual workflow builder: propose → review → save round-trips to the workflow store + triggers.json.
export interface Workflow { name: string; steps: string[] }
export type TriggerSpec =
  | { type: "schedule"; everyMs: number }
  | { type: "event"; domain: string; eventType?: string }
  | { type: "file"; path: string };
export interface Trigger { id: string; spec: TriggerSpec; workflow: string }
export const automationList = (token: string) =>
  rpc<{ workflows: Workflow[]; triggers: Trigger[] }>(token, "vishu.automation_list");
export const automationSaveWorkflow = (token: string, name: string, steps: string[]) =>
  rpc<{ name: string }>(token, "vishu.automation_save_workflow", { name, steps });
export const automationAddTrigger = (token: string, trigger: Trigger) =>
  rpc<{ id: string }>(token, "vishu.automation_add_trigger", trigger);
// §12b server-side voice: STT (whisper.cpp) + TTS (Piper) over RPC, replacing the browser Web Speech API.
export const voiceSpeak = (token: string, text: string, voiceId?: string) =>
  rpc<{ engine: string; mime: string; audio_base64: string }>(token, "vishu.voice_speak", { text, voice_id: voiceId });
export const voiceTranscribe = (token: string, audioBase64: string, format = "wav") =>
  rpc<{ text: string; engine?: string }>(token, "vishu.voice_transcribe", { audio_base64: audioBase64, format });

// Full-duplex streaming STT: open a session, push the growing mic WAV for live partials, end for final.
export const voiceSttStart = (token: string, model?: string) =>
  rpc<{ sessionId: string }>(token, "vishu.voice_stt_start", { model });
export const voiceSttChunk = (token: string, sessionId: string, audioBase64: string, format = "wav") =>
  rpc<{ partial: string; engine?: string }>(token, "vishu.voice_stt_chunk", { sessionId, audio_base64: audioBase64, format });
export const voiceSttEnd = (token: string, sessionId: string) =>
  rpc<{ final: string }>(token, "vishu.voice_stt_end", { sessionId });

// §9 "visualize" — read-only data-map + activity feed. Poll to refresh (snapshot-on-poll v1).
export interface DataNode {
  label: string;
  path: string;
  exists: boolean;
  modified: number | null;
  holds: string;
}
export interface ActivityEvent {
  ts: number;
  source: "model" | "gate" | "memory";
  text: string;
}
export interface DashboardSnapshot {
  dataMap: DataNode[];
  activity: ActivityEvent[];
}

export const dashboardSnapshot = (token: string, limit = 40) =>
  rpc<DashboardSnapshot>(token, "vishu.dashboard_snapshot", { limit });

// Cold-apply pipeline: resume page — assemble the resume + capture achievements (timestamped).
export interface Achievement { text: string; at: string; tags: string[] }
export const careerResume = (token: string, projectsJson?: string) =>
  rpc<{ markdown: string }>(token, "vishu.career_resume", { projectsJson });
export const careerAchievementAdd = (token: string, text: string) =>
  rpc<Achievement>(token, "vishu.career_achievement_add", { text });
export const careerAchievements = (token: string, tag?: string) =>
  rpc<{ items: Achievement[] }>(token, "vishu.career_achievements", { tag });

/** Subscribe to the core's SSE bus (tool:sync, notifications). Returns an unsubscribe. */
export function subscribeEvents(token: string, onEvent: (e: unknown) => void): () => void {
  const es = new EventSource(`/events?token=${encodeURIComponent(token)}`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore non-JSON keepalives */
    }
  };
  return () => es.close();
}
