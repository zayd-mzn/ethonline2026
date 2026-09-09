/**
 * Stub payment gate — stands in for Member 1's real Blocky402 / Hedera
 * settlement until it lands. Implements the payment side of the x402 flow
 * as a Fastify preHandler hook (mirrors identity.stub.ts).
 *
 * DEV ONLY: does not verify real on-chain settlement. It emits a proper
 * 402 Payment Required (matching the agent's expected shape) and accepts a
 * deterministic stub proof so the full call -> 402 -> pay -> retry loop works
 * end-to-end. The real gate swaps in behind the same hook signature.
 *
 * Contract shared with the agent (agent/src/paid-request.ts):
 *   - 402 body:  { error: "payment_required", payment: PaymentRequirement }
 *   - proof header: "x-payment-proof"
 *   - stub proof value: "stub-proof:<requestId>"
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { PaymentGateOptions, PaymentRequiredResponse } from "./types.js";

/** Header the agent uses to return payment proof (must match the agent). */
export const PAYMENT_PROOF_HEADER = "x-payment-proof";

/** DEV recipient account. Replaced by M1's real treasury account id. */
const STUB_RECIPIENT = process.env.HEDERA_RECIPIENT ?? "0.0.STUB";

/** Build the deterministic stub proof the agent's StubPaymentClient returns. */
function expectedStubProof(requestId: string): string {
  return `stub-proof:${requestId}`;
}

/**
 * Create a Fastify preHandler that gates a route behind payment.
 *
 * Behaviour:
 *   - No/invalid x-payment-proof header  -> reply 402 with PaymentRequirement.
 *   - Valid stub proof                   -> return (let the route handler run).
 *
 * The requestId is embedded in both the 402 requirement and the expected proof,
 * so a proof only satisfies the specific request it was issued for.
 */
export function paymentGate(options: PaymentGateOptions) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const proof = request.headers[PAYMENT_PROOF_HEADER];

    // Reconstruct the resource (path + query) for the requirement / audit.
    const resource = options.resource || request.url;

    if (typeof proof === "string") {
      // Extract the requestId the proof claims to satisfy and validate it.
      const requestId = proof.startsWith("stub-proof:")
        ? proof.slice("stub-proof:".length)
        : "";
      if (requestId && proof === expectedStubProof(requestId)) {
        // Accepted (dev). Real gate would verify settlement on Hedera here.
        return;
      }
      // A proof was supplied but it isn't valid — fall through to 402.
    }

    // No valid payment yet: issue a fresh requirement.
    const requestId = `req_${randomUUID().slice(0, 8)}`;
    const payload: PaymentRequiredResponse = {
      error: "payment_required",
      payment: {
        amountHbar: options.priceHbar,
        recipient: STUB_RECIPIENT,
        facilitator: "blocky402",
        requestId,
        resource,
      },
    };
    await reply.code(402).send(payload);
  };
}
