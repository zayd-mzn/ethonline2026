/**
 * Activity event stream server — the frontend's live feed into the agent.
 *
 * Exposes the agent's ActivityEmitter over HTTP so Member 5's monitor can
 * consume progress events as they happen. Uses Server-Sent Events (SSE): a
 * dependency-free, browser-native, one-way stream that maps directly onto the
 * emitter's subscribe() seam — producers never change.
 *
 * Endpoints (all dependency-free, built on node:http):
 *   GET /events   → SSE stream of ActivityEvent objects (live)
 *   GET /activity → JSON snapshot of buffered recent events (polling fallback)
 *   GET /health   → liveness probe
 *
 * A small ring buffer of recent events is kept so a frontend that connects
 * mid-run immediately replays what it missed instead of starting blank.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { ActivityEmitter } from "./activity.js";
import type { ActivityEvent } from "./types.js";

export interface EventStreamOptions {
  /** The emitter whose events are streamed to clients. */
  emitter: ActivityEmitter;
  /** How many recent events to retain for replay/polling. Default 100. */
  bufferSize?: number;
}

/**
 * HTTP server that broadcasts activity events to connected frontends.
 *
 * Call start() to begin listening and stop() to shut down. Safe to run
 * alongside the agent loop in the same process.
 */
export class EventStreamServer {
  private readonly emitter: ActivityEmitter;
  private readonly bufferSize: number;
  private readonly buffer: ActivityEvent[] = [];
  private readonly clients = new Set<ServerResponse>();
  private readonly server = createServer((req, res) => this.handle(req, res));
  private unsubscribe?: () => void;

  constructor(options: EventStreamOptions) {
    this.emitter = options.emitter;
    this.bufferSize = options.bufferSize ?? 100;
  }

  /** Start listening on the given port. Resolves with the bound port. */
  start(port: number): Promise<number> {
    // Subscribe once; fan every event out to buffer + all live clients.
    this.unsubscribe = this.emitter.subscribe((event) => this.broadcast(event));

    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, () => {
        this.server.off("error", reject);
        const bound = (this.server.address() as AddressInfo).port;
        resolve(bound);
      });
    });
  }

  /** Stop the server and drop all client connections. */
  stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** Record an event and push it to every connected SSE client. */
  private broadcast(event: ActivityEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }
    const frame = this.formatSse(event);
    for (const client of this.clients) {
      client.write(frame);
    }
  }

  /** Encode an event as a single SSE frame. */
  private formatSse(event: ActivityEvent): string {
    return `event: activity\ndata: ${JSON.stringify(event)}\n\n`;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    // Permissive CORS so a separately-served frontend can connect during the demo.
    res.setHeader("Access-Control-Allow-Origin", "*");

    const url = (req.url ?? "/").split("?")[0];

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    switch (url) {
      case "/events":
        this.handleSse(res);
        return;
      case "/activity":
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ events: this.buffer }));
        return;
      case "/health":
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, clients: this.clients.size }));
        return;
      default:
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    }
  }

  /** Open a long-lived SSE connection and replay buffered events. */
  private handleSse(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Replay recent history so a late client isn't left blank.
    for (const event of this.buffer) {
      res.write(this.formatSse(event));
    }

    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
    });
  }
}
