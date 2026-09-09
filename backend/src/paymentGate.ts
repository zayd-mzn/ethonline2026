/**
 * Real payment gate — Member 1 deliverable.
 *
 * Replaces paymentGate.stub.ts. Same Fastify preHandler signature so the
 * swap in index.ts is a one-line import change.
 *
 * Flow:
 *   1. Request arrives with no x-payment-proof header → reply 402 with
 *      PaymentRequiredResponse (amount from registry, real treasury recipient).
 *   2. Request arrives with x-payment-proof: hedera-tx:<txId> → query the
 *      Hedera ledger to confirm the transfer settled for at least the expected
 *      amount to the treasury account.
 *   3. Verified → write HCS audit entry (fire-and-forget) → let route run.
 *   4. Invalid proof → reply 402 again (fresh requestId).
 *
 * Proof format agreed with the agent (agent/src/payment.ts):
 *   "hedera-tx:<transactionId>"
 *   e.g. "hedera-tx:0.0.10446789@1234567890.000000000"
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  AccountId,
  TransactionId,
  TransactionRecordQuery,
} from "@hashgraph/sdk";
import { getHederaClient } from "./hederaClient.js";
import { logPayment } from "./hcsLogger.js";
import type { PaymentGateOptions, PaymentRequiredResponse } from "./types.js";

/** Header name shared with the agent — must never change. */
export const PAYMENT_PROOF_HEADER = "x-payment-proof";

/** Treasury account that receives payments. Set in HEDERA_RECIPIENT env var. */
const RECIPIENT = process.env.HEDERA_RECIPIENT ?? "0.0.STUB";

/** 1% tolerance for tinybar rounding when comparing transfer amounts. */
const AMOUNT_TOLERANCE = 0.99;

/**
 * Parse "hedera-tx:<txId>" from the proof header.
 * Returns the raw transaction id string, or null if the format is wrong.
 */
function parseTxId(proof: string): string | null {
  if (!proof.startsWith("hedera-tx:")) return null;
  const txId = proof.slice("hedera-tx:".length).trim();
  return txId.length > 0 ? txId : null;
}

/**
 * Query the Hedera ledger and verify that txId transferred at least
 * expectedAmountHbar to expectedRecipient.
 *
 * Returns { valid: true, payer } on success, { valid: false, payer: "" } on
 * any failure (network error, wrong amount, wrong recipient, etc.).
 */
async function verifyTransfer(
  txIdStr: string,
  expectedRecipient: string,
  expectedAmountHbar: number,
): Promise<{ valid: boolean; payer: string }> {
  try {
    const client = getHederaClient();
    const txId = TransactionId.fromString(txIdStr);

    const record = await new TransactionRecordQuery()
      .setTransactionId(txId)
      .execute(client);

    const recipientId = AccountId.fromString(expectedRecipient);
    const tinybarsExpected = Math.round(expectedAmountHbar * 100_000_000);

    // Walk the transfer list looking for a credit to the treasury account
    for (const transfer of record.transfers) {
      if (transfer.accountId.toString() === recipientId.toString()) {
        // hbar value is positive for credits, negative for debits
        const tinybarsReceived = transfer.amount.toBigNumber().toNumber() * 100_000_000;
        if (tinybarsReceived >= tinybarsExpected * AMOUNT_TOLERANCE) {
          // Payer = the account that signed the transaction
          const payer = txId.accountId?.toString() ?? "unknown";
          return { valid: true, payer };
        }
      }
    }

    // No matching credit found
    return { valid: false, payer: "" };
  } catch (err) {
    console.error(
      "Payment verification error:",
      err instanceof Error ? err.message : String(err),
    );
    return { valid: false, payer: "" };
  }
}

/**
 * Create a Fastify preHandler that gates a route behind x402 payment.
 *
 * Drop-in replacement for paymentGate.stub — same function signature and
 * same 402 body shape. index.ts only needs the import line changed.
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

    const proofHeader = request.headers[PAYMENT_PROOF_HEADER];

    if (typeof proofHeader === "string") {
      const txId = parseTxId(proofHeader);

      if (txId) {
        const { valid, payer } = await verifyTransfer(txId, RECIPIENT, price);

        if (valid) {
          // ✅ Payment verified on-chain — write HCS audit record and proceed.
          logPayment({
            requestId: `req_${randomUUID().slice(0, 8)}`,
            resource: options.resource,
            amountHbar: price,
            payer,
            txId,
            timestamp: new Date().toISOString(),
          });
          return; // let the route handler run
        }
      }
    }

    // No valid payment — issue a fresh 402 requirement.
    const requestId = `req_${randomUUID().slice(0, 8)}`;
    const payload: PaymentRequiredResponse = {
      error: "payment_required",
      payment: {
        amountHbar: price,
        recipient: RECIPIENT,
        facilitator: "blocky402",
        requestId,
        resource: options.resource,
      },
    };
    await reply.code(402).send(payload);
  };
}
