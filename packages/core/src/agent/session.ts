import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../providers/types.js";

export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  turns: number;
}

/** In-memory session/transcript store (Phase 7 will persist transcripts to the vault). */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(system?: string): Session {
    const session: Session = {
      id: randomUUID(),
      messages: system ? [{ role: "system", content: system }] : [],
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`unknown session: ${id}`);
    return session;
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => ({ id: s.id, createdAt: s.createdAt, turns: s.messages.length }));
  }
}
