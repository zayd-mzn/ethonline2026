/**
 * Shared contract types for the agent (Member 3).
 *
 * These mirror the backend's API contract (backend/src/types.ts) so the
 * agent codes against the same shapes the server actually returns, plus
 * the agent-local ActivityEvent used to report progress to the frontend.
 */

/** What kind of indicator a service queries. */
export type QueryType = "ip" | "hash";

/** A service listed in the marketplace registry (discovery result). */
export interface Service {
  id: string;
  name: string;
  description: string;
  endpoint: string; // relative path, e.g. "/api/ip-reputation"
  queryType: QueryType;
  priceHbar: number; // per-query price
  providerId: string;
  createdAt: string;
}

/** Response of GET /marketplace/services. */
export interface ServicesListResponse {
  services: Service[];
}

/** Payment details carried inside a 402 response (from Member 1 / backend). */
export interface PaymentRequirement {
  amountHbar: number;
  recipient: string; // Hedera account id, e.g. "0.0.xxxxx"
  facilitator: "blocky402";
  requestId: string; // ties a payment to this specific request
  resource: string; // what is being paid for (endpoint + query)
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
  score: number; // 0-100
  source: string;
}

/** Successful result of GET /api/hash-check. */
export interface HashCheckResult {
  hash: string;
  detections: number;
  verdict: "malicious" | "suspicious" | "clean";
  source: string;
}

/** Stages of the agent loop, emitted as activity events for the frontend. */
export type ActivityStage =
  | "discover"
  | "call"
  | "402"
  | "paying"
  | "paid"
  | "data";

/** A single progress event produced by the agent. */
export interface ActivityEvent {
  ts: number; // epoch milliseconds
  stage: ActivityStage;
  detail: string;
}
