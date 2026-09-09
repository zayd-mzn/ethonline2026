/**
 * Payment path — the seam for Member 1's real Hedera payment implementation.
 *
 * The agent codes against the PaymentClient interface. A stub is provided so
 * the full 402 -> pay -> retry flow works end-to-end before M1's real path
 * lands (mirrors backend/src/identity.stub.ts). The real implementation
 * (actual HBAR transfer via the wallet) swaps in without changing callers.
 */

import type { PaymentRequirement } from "./types.js";

/** Result of settling a payment: a proof the backend can verify. */
export interface PaymentProof {
  /** Opaque proof string sent back to the gated endpoint. */
  proof: string;
  /** Optional on-chain transaction id, when a real payment was made. */
  txId?: string;
}

/** Member 1 — payments. Settles a 402 requirement and returns a proof. */
export interface PaymentClient {
  pay(requirement: PaymentRequirement): Promise<PaymentProof>;
}

/**
 * DEV ONLY stub payment client. Does not move real funds; returns a
 * deterministic fake proof derived from the request id so the flow can be
 * exercised end-to-end. Swap for the real Hedera-backed client later.
 */
export class StubPaymentClient implements PaymentClient {
  async pay(requirement: PaymentRequirement): Promise<PaymentProof> {
    const txId = `stub-tx-${requirement.requestId}`;
    return { proof: `stub-proof:${requirement.requestId}`, txId };
  }
}
