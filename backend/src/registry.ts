/**
 * Service registry — the store of marketplace services.
 *
 * Starts as an in-memory store seeded with sample services so the
 * agent (M3) and frontend (M5) can integrate immediately. Swapped
 * for SQLite persistence in a later phase without changing this API.
 */

import { randomUUID } from "node:crypto";
import type { Service, CreateServiceRequest } from "./types.js";

/** In-memory store. Keyed by service id. */
const services = new Map<string, Service>();

/** List all services (discovery). */
export function listServices(): Service[] {
  return Array.from(services.values());
}

/** Get one service by id. */
export function getService(id: string): Service | undefined {
  return services.get(id);
}

/** Find a service by its endpoint path (used by the payment gate to price a request). */
export function getServiceByEndpoint(endpoint: string): Service | undefined {
  return Array.from(services.values()).find((s) => s.endpoint === endpoint);
}

/** Create and store a new service. */
export function createService(
  input: CreateServiceRequest,
  providerId: string,
): Service {
  const service: Service = {
    id: `svc_${randomUUID().slice(0, 8)}`,
    name: input.name,
    description: input.description,
    endpoint: input.endpoint,
    queryType: input.queryType,
    priceHbar: input.priceHbar,
    providerId,
    createdAt: new Date().toISOString(),
  };
  services.set(service.id, service);
  return service;
}

/** Seed sample services so discovery is non-empty on boot. */
export function seedServices(): void {
  if (services.size > 0) return; // idempotent

  createService(
    {
      name: "IP Reputation Lookup",
      description:
        "Check whether an IP address is malicious. Returns a 0-100 threat score.",
      endpoint: "/api/ip-reputation",
      queryType: "ip",
      priceHbar: 0.01,
    },
    "prov_seed",
  );

  createService(
    {
      name: "File Hash Check",
      description:
        "Check a file hash against malware databases. Returns detection count and verdict.",
      endpoint: "/api/hash-check",
      queryType: "hash",
      priceHbar: 0.02,
    },
    "prov_seed",
  );
}
