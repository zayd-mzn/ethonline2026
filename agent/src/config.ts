/**
 * Agent configuration — loads and validates environment settings.
 *
 * Reads from process.env (populated from a .env file if present).
 * Fails fast with a clear message if a required value is missing or invalid,
 * so misconfiguration surfaces at startup rather than mid-run.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Supported Hedera networks. */
export type HederaNetwork = "testnet" | "mainnet" | "previewnet";

/** Validated, ready-to-use agent configuration. */
export interface AgentConfig {
  hederaAccountId: string;
  hederaPrivateKey: string;
  hederaNetwork: HederaNetwork;
  backendUrl: string;
  maxSpendHbar: number;
  eventStreamPort: number;
  paymentMode: PaymentMode;
  /** World Selfie Check proof for the agent's human owner (JSON string). */
  worldProof?: string;
}

/** How the agent settles payments. */
export type PaymentMode = "stub" | "real";

/**
 * Minimal .env loader (no external dependency). Parses KEY=VALUE lines,
 * ignores blanks and comments, and does not overwrite variables already
 * set in the real environment.
 */
function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/config.ts and dist/config.js both sit one level below the package root.
  const envPath = resolve(here, "..", ".env");
  let contents: string;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    return; // no .env file — rely on the real environment
  }

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Read a required string env var or throw. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNetwork(value: string): HederaNetwork {
  if (value === "testnet" || value === "mainnet" || value === "previewnet") {
    return value;
  }
  throw new Error(
    `Invalid HEDERA_NETWORK "${value}" (expected testnet | mainnet | previewnet)`,
  );
}

function parsePositiveNumber(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${name} "${value}" (expected a positive number)`);
  }
  return n;
}

function parsePort(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Invalid ${name} "${value}" (expected a port 0-65535)`);
  }
  return n;
}

function parsePaymentMode(value: string): PaymentMode {
  if (value === "stub" || value === "real") return value;
  throw new Error(
    `Invalid PAYMENT_MODE "${value}" (expected stub | real)`,
  );
}

/** Load, validate, and return the agent configuration. */
export function loadConfig(): AgentConfig {
  loadDotEnv();

  return {
    hederaAccountId: required("HEDERA_ACCOUNT_ID"),
    hederaPrivateKey: required("HEDERA_PRIVATE_KEY"),
    hederaNetwork: parseNetwork(process.env.HEDERA_NETWORK ?? "testnet"),
    backendUrl: (process.env.BACKEND_URL ?? "http://localhost:3001").replace(
      /\/+$/,
      "",
    ),
    maxSpendHbar: parsePositiveNumber(
      "MAX_SPEND_HBAR",
      process.env.MAX_SPEND_HBAR ?? "1.0",
    ),
    eventStreamPort: parsePort(
      "EVENT_STREAM_PORT",
      process.env.EVENT_STREAM_PORT ?? "3002",
    ),
    // Default to "stub" so local/demo runs work without real funds. Set
    // PAYMENT_MODE=real to settle on-chain via Blocky402.
    paymentMode: parsePaymentMode(process.env.PAYMENT_MODE ?? "stub"),
    // World Selfie Check proof for the agent's human owner. When set, the
    // agent registers with the backend to obtain a human-backed agentId.
    worldProof: process.env.WORLD_PROOF || undefined,
  };
}
