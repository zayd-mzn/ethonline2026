/**
 * Shared API contract types for the Cyber Intel Marketplace backend.
 *
 * This file is the single source of truth for the shapes exchanged
 * between the backend (M2) and its consumers: the agent (M3),
 * payments (M1), identity (M4), and frontend (M5).
 */

/** What kind of indicator a service queries. Drives both the
 *  query parameter the agent sends and per-type pricing. */
export type QueryType = "ip" | "hash";      // only two for now

/** A service listed in the marketplace registry. */
export interface Service {
  id: string;
  name: string;
  description: string;
  endpoint: string;      // relative path, e.g. "/api/ip-reputation"
  queryType: QueryType;
  priceHbar: number;     // per-query price
  providerId: string;
  createdAt: string;
}

/** Body for publishing a service. Backend fills id/providerId/createdAt. */
export interface CreateServiceRequest {
  name: string;
  description: string;
  endpoint: string;
  queryType: QueryType;
  priceHbar: number;
}

/** Response of GET /marketplace/services (discovery). */
export interface ServicesListResponse {
  services: Service[];
}

/** Payment details returned inside a 402 response. Fields come from M1. */
export interface PaymentRequirement {
  amountHbar: number;
  recipient: string;      // Hedera account id, e.g. "0.0.xxxxx"
  facilitator: "blocky402";
  requestId: string;      // ties a payment to this specific request
  resource: string;       // what is being paid for (endpoint + query)
}

/** Body of a 402 Payment Required response. */
export interface PaymentRequiredResponse {
  error: "payment_required";
  payment: PaymentRequirement;
}

/** Successful result of GET /api/ip-reputation. */
export interface IpReputationResult {
  ip: string;
  malicious: boolean;
  score: number;          // 0-100
  source: string;         // e.g. "abuseipdb"
}

/** Successful result of GET /api/hash-check. */
export interface HashCheckResult {
  hash: string;
  detections: number;
  verdict: "malicious" | "suspicious" | "clean";
  source: string;         // e.g. "virustotal"
}

/** Body of POST /api/triage — a batch of indicators to score and rank. */
export interface TriageRequest {
  indicators: string[];   // mix of IPs and file hashes
}

/** One ranked indicator in a triage response. */
export interface TriageItem {
  indicator: string;      // the original input
  queryType: QueryType;   // how it was classified ("ip" | "hash")
  score: number;          // normalized threat score 0-100 (higher = worse)
  malicious: boolean;     // convenience flag
  detail: IpReputationResult | HashCheckResult; // the underlying result
}

/** Response of POST /api/triage — indicators sorted worst-first. */
export interface TriageResponse {
  ranked: TriageItem[];   // sorted by score descending
  count: number;
  maliciousCount: number;
}

/** Consistent error envelope for all non-2xx (except 402, which has its own shape). */
export interface ApiError {
  error: string;          // machine-readable code
  message: string;        // human-readable detail
}

/* ------------------------------------------------------------------ *
 * Integration seams — interfaces for teammates' modules.
 * Backend codes against these; real implementations swap in later.
 * ------------------------------------------------------------------ */

/** Member 4 — identity. Verifies a Selfie Check proof (X-Selfie-Check-Proof header). */
export interface IdentityVerifier {
  verifySelfieCheck(proof: string): Promise<{ providerId: string } | null>;
  resolveAgentBacking(agentId: string): Promise<boolean>;
}

/** Member 1 — payments. Options the payment gate needs per protected route.
 *  Price is resolved from the registry (single source of truth) at request
 *  time via lookupPrice, keyed by the route's resource path. */
export interface PaymentGateOptions {
  resource: string;                                       // endpoint path, e.g. "/api/ip-reputation"
  lookupPrice: (resource: string) => number | undefined;  // returns priceHbar from the registry
}