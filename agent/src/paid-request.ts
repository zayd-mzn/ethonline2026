/**
 * Paid request flow — the core of Phase 3.
 *
 * Calls a gated endpoint; if the backend answers 402 Payment Required, parses
 * the requirement, checks the budget guard, settles payment via the injected
 * PaymentClient, and retries the request with the proof attached. Emits the
 * activity stages call -> 402 -> paying -> paid along the way.
 *
 * The PaymentClient is a seam (stubbed for now), so this flow is complete and
 * testable before Member 1's real Hedera payment path lands.
 */

import type { ActivityEmitter } from "./activity.js";
import type { Budget } from "./budget.js";
import type { FetchLike } from "./discovery.js";
import type { PaymentClient } from "./payment.js";
import type { PaymentRequiredResponse, PaymentRequirement } from "./types.js";

/** Header the agent uses to return payment proof — x402 v2 standard. */
export const PAYMENT_PROOF_HEADER = "x-payment";

export interface PaidRequestOptions {
  emitter: ActivityEmitter;
  budget: Budget;
  payment: PaymentClient;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Narrow an unknown body into a PaymentRequirement, or null if it doesn't fit. */
function toRequirement(value: unknown): PaymentRequirement | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Partial<PaymentRequiredResponse>;
  if (body.error !== "payment_required") return null;
  const p = body.payment;
  if (typeof p !== "object" || p === null) return null;
  if (
    typeof p.amountHbar !== "number" ||
    typeof p.recipient !== "string" ||
    p.facilitator !== "blocky402" ||
    typeof p.requestId !== "string" ||
    typeof p.resource !== "string"
  ) {
    return null;
  }
  return p;
}

/**
 * Perform a request that may be payment-gated. Returns the parsed JSON body of
 * the successful (post-payment) response. Throws on budget rejection, payment
 * failure, or an unexpected status.
 */
export class PaidRequester {
  private readonly emitter: ActivityEmitter;
  private readonly budget: Budget;
  private readonly payment: PaymentClient;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: PaidRequestOptions) {
    this.emitter = options.emitter;
    this.budget = options.budget;
    this.payment = options.payment;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  private async fetchJson(
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal, headers });
      const body = await res.json().catch(() => undefined);
      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Call `url`, handling a possible 402 by paying and retrying. */
  async request<T = unknown>(url: string): Promise<T> {
    this.emitter.emit("call", `GET ${url}`);
    const first = await this.fetchJson(url);

    // Not gated (or already satisfied): return as-is if OK.
    if (first.status !== 402) {
      if (!first.ok) {
        throw new Error(`Request failed with status ${first.status}`);
      }
      return first.body as T;
    }

    // Gated: parse the payment requirement.
    const requirement = toRequirement(first.body);
    if (!requirement) {
      throw new Error("Received 402 but could not parse payment requirement");
    }
    this.emitter.emit(
      "402",
      `payment required: ${requirement.amountHbar} HBAR for ${requirement.resource}`,
    );

    // Budget guard: refuse if this would exceed the cap.
    if (!this.budget.canAfford(requirement.amountHbar)) {
      throw new Error(
        `Budget guard refused ${requirement.amountHbar} HBAR ` +
          `(remaining ${this.budget.remaining} HBAR)`,
      );
    }

    // Settle payment.
    this.emitter.emit(
      "paying",
      `paying ${requirement.amountHbar} HBAR to ${requirement.recipient}`,
    );
    const proof = await this.payment.pay(requirement);
    this.budget.charge(requirement.amountHbar);
    this.emitter.emit(
      "paid",
      `paid ${requirement.amountHbar} HBAR${proof.txId ? ` (tx ${proof.txId})` : ""}`,
    );

    // Retry with proof attached.
    const second = await this.fetchJson(url, {
      [PAYMENT_PROOF_HEADER]: proof.proof,
    });
    if (!second.ok) {
      throw new Error(`Retry after payment failed with status ${second.status}`);
    }
    return second.body as T;
  }
}
