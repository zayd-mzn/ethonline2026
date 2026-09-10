/**
 * Service registry — SQLite-backed store of marketplace services.
 *
 * Uses Node.js built-in `node:sqlite` (available Node 22+) instead of
 * better-sqlite3, so no native binary build is required. The public function
 * signatures are identical — callers (index.ts, payment gate) are unchanged.
 * The DB file lives at backend/data/registry.db (gitignored).
 */

// node:sqlite is experimental in Node 22/24 — suppress the warning in prod
// by setting NODE_NO_WARNINGS=1, but it works fine for our purposes.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Service, CreateServiceRequest } from "./types.js";

const DB_PATH = process.env.DB_PATH ?? "data/registry.db";

// Ensure the data/ directory exists before opening the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");

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

// Agent registry: the human↔agent accountability link. Each row ties an
// agentId to the World nullifier_hash of the real human who verified. The
// nullifier_hash is unique per human, so this is the "who is responsible"
// record — durable across restarts (unlike the in-memory provider map).
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    agentId       TEXT PRIMARY KEY,
    nullifierHash TEXT NOT NULL UNIQUE,
    createdAt     TEXT NOT NULL
  )
`);

/** List all services (discovery). */
export function listServices(): Service[] {
  return db.prepare("SELECT * FROM services").all() as unknown as Service[];
}

/** Get one service by id. */
export function getService(id: string): Service | undefined {
  return db.prepare("SELECT * FROM services WHERE id = ?").get(id) as
    | Service
    | undefined;
}

/** Find a service by its endpoint path (used by the payment gate to price a request). */
export function getServiceByEndpoint(endpoint: string): Service | undefined {
  return db
    .prepare("SELECT * FROM services WHERE endpoint = ?")
    .get(endpoint) as Service | undefined;
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
     VALUES (:id, :name, :description, :endpoint, :queryType, :priceHbar, :providerId, :createdAt)`,
  ).run(service as unknown as Record<string, string | number>);
  return service;
}

/** Seed sample services only if the table is empty (idempotent across restarts). */
export function seedServices(): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number };
  if (row.n > 0) return;

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

/* ------------------------------------------------------------------ *
 * Agent registry — the human↔agent accountability link.
 * ------------------------------------------------------------------ */

/** A registered agent, tied to the human who verified via World. */
export interface AgentRecord {
  agentId: string;
  nullifierHash: string;
  createdAt: string;
}

/**
 * Record (or return the existing) link between an agent and the human's
 * World nullifier_hash. Idempotent: the same human re-registering the same
 * agent returns the existing row rather than creating a duplicate.
 */
export function upsertAgent(agentId: string, nullifierHash: string): AgentRecord {
  const existing = getAgent(agentId);
  if (existing) return existing;

  const record: AgentRecord = {
    agentId,
    nullifierHash,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO agents (agentId, nullifierHash, createdAt)
     VALUES (:agentId, :nullifierHash, :createdAt)`,
  ).run(record as unknown as Record<string, string>);
  return record;
}

/** Look up a registered agent by its id. */
export function getAgent(agentId: string): AgentRecord | undefined {
  return db.prepare("SELECT * FROM agents WHERE agentId = ?").get(agentId) as
    | AgentRecord
    | undefined;
}

/** True if the agent is registered (i.e. backed by a verified human). */
export function isAgentRegistered(agentId: string): boolean {
  return getAgent(agentId) !== undefined;
}
