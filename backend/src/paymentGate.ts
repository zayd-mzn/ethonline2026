/**
 * Real x402 v2 payment gate — Member 1 deliverable.
 *
 * Replaces paymentGate.stub.ts. Same Fastify preHandler signature so the
 * swap in index.ts stays a one-line import change.
 *
 * Wire protocol (x402 v2):
 *   - 402 body shape:  { x402Version: 2, accepts: [PaymentRequirements] }
 *   - Payment header:  X-PAYMENT: <base64(JSON(paymentPayload))>
 *   - Facilitator:     Blocky402 (https://api.testnet.blocky402.com)
 *
 * On every request:
 *   1. No X-PAYMENT header → reply 402 with x402 v2 PaymentRequirements.
 *   2. X-PAYMENT present → base64-decode → POST /verify to Blocky402.
 *   3. isValid → write HCS audit log (fire-and-forget) → let route run.
 *   4. !isValid → reply 402 again (fresh requirements).
 *
 * NOTE: We verify only (not re-settle) on the server side. The agent already
 * settled with Blocky402; the server just confirms the proof is valid before
 * releasing the data. This matches the x402 v2 resource-server pattern.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { logPayment } from "./hcsLogger.js";
import type { PaymentGateOptions, PaymentRequiredResponse } from "./types.js";

/** Header name per x402 v2 spec. */
export const PAYMENT_PROOF_HEADER = "x-payment";

/** Blocky402 facilitator base URL. */
const BLOCKY402_URL =
  process.env.BLOCKY402_URL ?? "https://api.testnet.blocky402.com";

/** Treasury account — receives HBAR payments. */
const RECIPIENT = process.env.HEDERA_RECIPIENT ?? "0.0.STUB";

/** Blocky402 fee-payer for Hedera testnet (from GET /supported). */
const BLOCKY402_FEE_PAYER = "0.0.7162784";

/** x402 v2 PaymentRequirements shape (what goes inside the 402 body). */
interface X402PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;          // tinybars as string
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { feePayer: string };
  resource: string;        // extra field so agent/frontend can identify the service
  description?: string;
}

/**
 * Decode X-PAYMENT header (base64 JSON) and call Blocky402 /verify.
 * Returns { valid, payer } or { valid: false } on any failure.
 */
async function verifyX402Payment(
  xPaymentHeader: string,
  requirements: X402PaymentRequirements,
): Promise<{ valid: boolean; payer: string }> {
  try {
    const paymentPayload = JSON.parse(
      Buffer.from(xPaymentHeader, "base64").toString("utf8"),
    ) as unknown;

    const body = {
      x402Version: 2,
      paymentPayload,
      paymentRequirements: requirements,
    };

    const res = await fetch(`${BLOCKY402_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    const result = (await res.json()) as {
      isValid?: boolean;
      payer?: string;
      invalidMessage?: string;
    };

    if (result.isValid) {
      return { valid: true, payer: result.payer ?? "unknown" };
    }

    console.warn(
      `Blocky402 verify rejected: ${result.invalidMessage ?? "no reason"}`,
    );
    return { valid: false, payer: "" };
  } catch (err) {
    console.error(
      "Blocky402 verify error:",
      err instanceof Error ? err.message : String(err),
    );
    return { valid: false, payer: "" };
  }
}

/**
 * Build x402 v2 PaymentRequirements for a given resource and price.
 * Tinybars = amountHbar × 100_000_000.
 */
function buildRequirements(
  resource: string,
  amountHbar: number,
): X402PaymentRequirements {
  return {
    scheme: "exact",
    network: "hedera:testnet",
    amount: String(Math.round(amountHbar * 100_000_000)),
    payTo: RECIPIENT,
    maxTimeoutSeconds: 300,
    asset: "0.0.0",             // native HBAR
    extra: { feePayer: BLOCKY402_FEE_PAYER },
    resource,
  };
}

/**
 * Create a Fastify preHandler that gates a route behind x402 v2 payment.
 * Drop-in replacement for paymentGate.stub — same function signature.
 */
export function paymentGate(options: PaymentGateOptions) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Price is resolved from the registry — single source of truth.
    const price = options.lookupPrice(options.resource);
    if (price === undefined) {
      await reply.code(500).send({
        error: "misconfigured_gate",
        message: `No registered service for ${options.resource}`,
      });
      return;
    }

    const requirements = buildRequirements(options.resource, price);
    const xPayment = request.headers[PAYMENT_PROOF_HEADER];

    if (typeof xPayment === "string" && xPayment.length > 0) {
      const { valid, payer } = await verifyX402Payment(xPayment, requirements);

      if (valid) {
        // ✅ Payment verified by Blocky402 — write HCS audit and proceed.
        logPayment({
          requestId: `req_${randomUUID().slice(0, 8)}`,
          resource: options.resource,
          amountHbar: price,
          payer,
          txId: xPayment.slice(0, 32) + "…", // truncated proof for log
          timestamp: new Date().toISOString(),
        });
        return; // let the route handler run
      }
    }

    // No valid payment — issue x402 v2 requirements.
    // We also send the legacy PaymentRequiredResponse shape in parallel so
    // the existing agent code (paid-request.ts) can still parse it.
    const requestId = `req_${randomUUID().slice(0, 8)}`;

    // x402 v2 body
    const x402Body = {
      x402Version: 2,
      accepts: [requirements],
      // Legacy compat fields so the existing agent loop still works:
      error: "payment_required" as const,
      payment: {
        amountHbar: price,
        recipient: RECIPIENT,
        facilitator: "blocky402",
        requestId,
        resource: options.resource,
      } satisfies PaymentRequiredResponse["payment"],
    };

    await reply.code(402).send(x402Body);
  };
}
