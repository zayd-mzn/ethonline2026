/**
 * Activity event emitter — the agent's progress bus.
 *
 * Every stage of the loop (discover, call, 402, paying, paid, data) emits an
 * ActivityEvent. Subscribers receive events; a console subscriber is wired by
 * default. A frontend transport (websocket/polling) can subscribe later
 * without changing producers.
 */

import type { ActivityEvent, ActivityStage } from "./types.js";

/** A function that receives activity events. */
export type ActivityListener = (event: ActivityEvent) => void;

export class ActivityEmitter {
  private readonly listeners = new Set<ActivityListener>();

  /** Subscribe to events. Returns an unsubscribe function. */
  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Emit an event to all subscribers. Timestamp is stamped here. */
  emit(stage: ActivityStage, detail: string): ActivityEvent {
    const event: ActivityEvent = { ts: Date.now(), stage, detail };
    for (const listener of this.listeners) {
      listener(event);
    }
    return event;
  }
}

/** A ready-to-use console subscriber, handy for local runs and demos. */
export function consoleLogger(event: ActivityEvent): void {
  const iso = new Date(event.ts).toISOString();
  console.log(`[${iso}] ${event.stage.padEnd(8)} ${event.detail}`);
}
