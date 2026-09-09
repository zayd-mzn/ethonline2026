/**
 * Service discovery client.
 *
 * Calls the backend's GET /marketplace/services, validates the payload into
 * typed Service[], and emits a `discover` activity event. Testable against
 * mock/seed data by injecting a custom fetch and emitter.
 */

import type { ActivityEmitter } from "./activity.js";
import type { Service, ServicesListResponse } from "./types.js";

/** Minimal fetch signature so tests can inject a stub. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface DiscoveryClientOptions {
  backendUrl: string;
  emitter: ActivityEmitter;
  /** Defaults to global fetch; override in tests. */
  fetchImpl?: FetchLike;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

/** Narrow an unknown value into a Service, or return null if it doesn't fit. */
function toService(value: unknown): Service | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const queryType = v.queryType;
  if (queryType !== "ip" && queryType !== "hash") return null;
  if (
    typeof v.id !== "string" ||
    typeof v.name !== "string" ||
    typeof v.description !== "string" ||
    typeof v.endpoint !== "string" ||
    typeof v.priceHbar !== "number" ||
    typeof v.providerId !== "string" ||
    typeof v.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    endpoint: v.endpoint,
    queryType,
    priceHbar: v.priceHbar,
    providerId: v.providerId,
    createdAt: v.createdAt,
  };
}

export class DiscoveryClient {
  private readonly backendUrl: string;
  private readonly emitter: ActivityEmitter;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: DiscoveryClientOptions) {
    this.backendUrl = options.backendUrl.replace(/\/+$/, "");
    this.emitter = options.emitter;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  /** Fetch and return the list of available services. */
  async listServices(): Promise<Service[]> {
    const url = `${this.backendUrl}/marketplace/services`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let payload: unknown;
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Discovery request failed with status ${res.status}`);
      }
      payload = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const raw = (payload as ServicesListResponse | undefined)?.services;
    if (!Array.isArray(raw)) {
      throw new Error("Discovery response missing a 'services' array");
    }

    const services: Service[] = [];
    for (const item of raw) {
      const service = toService(item);
      if (service) services.push(service);
    }

    this.emitter.emit(
      "discover",
      `found ${services.length} service(s) at ${this.backendUrl}`,
    );
    return services;
  }
}
