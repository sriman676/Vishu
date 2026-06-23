import { EventEmitter } from "node:events";

export interface DomainEvent {
  domain: string;
  type: string;
  payload?: unknown;
}

/** In-process pub/sub. Domains publish; subscribers (and Phase 14's socket) consume. */
export class EventBus {
  private readonly em = new EventEmitter();

  publish(event: DomainEvent): void {
    this.em.emit("event", event);
    this.em.emit(`domain:${event.domain}`, event);
  }

  subscribe(handler: (e: DomainEvent) => void): () => void {
    this.em.on("event", handler);
    return () => this.em.off("event", handler);
  }

  subscribeDomain(domain: string, handler: (e: DomainEvent) => void): () => void {
    const key = `domain:${domain}`;
    this.em.on(key, handler);
    return () => this.em.off(key, handler);
  }
}

/** Process-wide singleton bus. */
export const bus = new EventBus();
