/**
 * Service registry — SQLite-backed store of marketplace services.
 *
 * Uses better-sqlite3 (synchronous), so the public function signatures are
 * unchanged from the in-memory version — callers (index.ts, payment gate)
 * need no changes. The DB file lives at backend/data/registry.db (gitignored).
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Service, CreateServiceRequest } from "./types.js";

const DB_PATH = process.env.DB_PATH ?? "data/registry.db";

// Ensure the data/ directory exists before opening the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create the table on first run.
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    queryType   TEXT NOT NULL,
    priceHbar   REAL NOT NULL,
    providerId  TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  )
`);

/** List all services (discovery). */
export function listServices(): Service[] {
  return db.prepare("SELECT * FROM services").all() as Service[];
}

/** Get one service by id. */
export function getService(id: string): Service | undefined {
  return db.prepare("SELECT * FROM services WHERE id = ?").get(id) as
    | Service
    | undefined;
}

/** Find a service by its endpoint path (used by the payment gate to price a request). */
export function getServiceByEndpoint(endpoint: string): Service | undefined {
  return db.prepare("SELECT * FROM services WHERE endpoint = ?").get(endpoint) as
    | Service
    | undefined;
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
  db.prepare(
    `INSERT INTO services (id, name, description, endpoint, queryType, priceHbar, providerId, createdAt)
     VALUES (@id, @name, @description, @endpoint, @queryType, @priceHbar, @providerId, @createdAt)`,
  ).run(service);
  return service;
}

/** Seed sample services only if the table is empty (idempotent across restarts). */
export function seedServices(): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number }).n;
  if (count > 0) return;

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
