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
  /**
   * Optional handler invoked by POST /investigate to start a fresh run.
   * Receives the indicators to investigate (empty = use the caller's default).
   * Should resolve when the run completes. Errors are caught and reported.
   */
  onRun?: (indicators: string[]) => Promise<void>;
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
  private readonly onRun?: (indicators: string[]) => Promise<void>;
  /** True while an investigation triggered via POST /investigate is running. */
  private runInFlight = false;

  constructor(options: EventStreamOptions) {
    this.emitter = options.emitter;
    this.bufferSize = options.bufferSize ?? 100;
    this.onRun = options.onRun;
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const url = (req.url ?? "/").split("?")[0];

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    // POST /investigate — trigger a fresh investigation run on demand.
    if (req.method === "POST" && url === "/investigate") {
      void this.handleInvestigate(req, res);
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

  /**
   * Handle POST /investigate — start a fresh investigation via the onRun hook.
   *
   * Body (optional): { "indicators": ["1.2.3.4", "<hash>", ...] }
   * An empty or missing list tells the handler to use its default set.
   *
   * Returns 202 Accepted immediately and runs in the background so the client
   * isn't held open for the whole run — progress is streamed over /events.
   * Rejects with 409 if a run is already in flight, or 501 if no onRun hook
   * was provided.
   */
  private async handleInvestigate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.onRun) {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_implemented", message: "no run handler configured" }));
      return;
    }
    if (this.runInFlight) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "run_in_progress", message: "an investigation is already running" }));
      return;
    }

    let indicators: string[] = [];
    try {
      const body = await this.readJsonBody(req);
      const raw = (body as { indicators?: unknown })?.indicators;
      if (Array.isArray(raw)) {
        indicators = raw.filter((x): x is string => typeof x === "string" && x.trim() !== "");
      }
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad_request", message: "invalid JSON body" }));
      return;
    }

    // Acknowledge immediately; the run streams its progress over /events.
    this.runInFlight = true;
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ started: true, indicators }));

    try {
      await this.onRun(indicators);
    } catch (err) {
      console.error(
        `investigation run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.runInFlight = false;
    }
  }

  /** Read and JSON-parse a request body (rejects on invalid JSON or > 64KB). */
  private readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!text) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }
}
