import type { DomainEvent, EventBus } from "../transport/events.js";

export type NotificationSink = (event: DomainEvent) => void;

/** Deliver `system/notification` events to a sink. Trigger firings already publish these onto the bus;
 * this turns them into something a human sees.
 * ponytail: default sink writes to stderr. The real OS/desktop toast (node-notifier, or the Tauri
 * notification API) hooks this same seam in the Phase 14 shell — swap the `deliver` fn, nothing else. */
export function attachNotificationSink(bus: EventBus, deliver?: NotificationSink): () => void {
  const sink: NotificationSink = deliver ?? ((e) => process.stderr.write(`[notify] ${JSON.stringify(e.payload ?? {})}\n`));
  return bus.subscribeDomain("system", (e) => {
    if (e.type === "notification") sink(e);
  });
}
