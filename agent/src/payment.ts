/**
 * Payment path — Member 1 (Hedera & Payments).
 *
 * Implements the x402 v2 payment flow using @x402/hedera and the hosted
 * Blocky402 facilitator (https://api.testnet.blocky402.com).
 *
 * Flow:
 *   1. Build PaymentRequirements from the 402 body (already correct shape).
 *   2. Sign a TransferTransaction with ExactHederaScheme (creates payload).
 *   3. POST /verify to the facilitator — confirms the payload is valid.
 *   4. POST /settle to the facilitator — co-signs and submits to Hedera.
 *   5. Return the base64-encoded paymentPayload as proof.
 *      Backend gate receives it in X-PAYMENT header and verifies via /verify.
 *
 * Proof format (wire):  base64(JSON(paymentPayload))
 * Header name:          X-PAYMENT  (x402 v2 standard)
 */

import {
  ExactHederaScheme,
  createClientHederaSigner,
  PrivateKey,
  HBAR_ASSET_ID,
  HEDERA_TESTNET_CAIP2,
  type ExactHederaPayloadV2,
} from "@x402/hedera";
import type { PaymentRequirements } from "@x402/core/types";
import type { PaymentRequirement } from "./types.js";
import type { Wallet } from "./wallet.js";

const BLOCKY402_URL =
  process.env.BLOCKY402_URL ?? "https://api.testnet.blocky402.com";

/** The facilitator's fee-payer account (from GET /supported, hedera:testnet). */
const BLOCKY402_FEE_PAYER = "0.0.7162784";

/**
 * Retry a transient async operation with short exponential backoff.
 *
 * Used only around payload *creation* (which signs locally + reads from a
 * Hedera node but moves no funds), so retrying is safe. NOT used for
 * /verify or /settle, where a retry could risk a double settlement.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * i));
        console.warn(`${label} attempt ${i}/${attempts} failed (${msg}) — retrying`);
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${label} failed after ${attempts} attempts: ${msg}`);
}

/**
 * fetch() that retries ONLY when the request throws at the network layer
 * (e.g. "fetch failed" — connection reset/timeout, no response received).
 * Once any HTTP response comes back, it is returned as-is with no retry.
 *
 * Safe for /verify and /settle: a thrown fetch means the request almost
 * certainly never completed server-side, so retrying cannot double-settle.
 * A returned response (even an error status) is trusted and never retried.
 */
async function fetchWithNetworkRetry(
  label: string,
  url: string,
  init: RequestInit,
  attempts = 5,
  baseDelayMs = 500,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * i));
        console.warn(`${label} network attempt ${i}/${attempts} failed (${msg}) — retrying`);
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${label} network-failed after ${attempts} attempts: ${msg}`);
}

/** x402 v2 PaymentPayload shape (sent as base64 in X-PAYMENT header). */
interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string;
  accepted: PaymentRequirements;
  payload: ExactHederaPayloadV2;
}

/** Result of settling a payment: a proof the backend can verify. */
export interface PaymentProof {
  /** base64(JSON(paymentPayload)) — sent as X-PAYMENT header. */
  proof: string;
  /** On-chain transaction id returned by the facilitator. */
  txId?: string;
}

/** PaymentClient interface — the seam M3's loop codes against. */
export interface PaymentClient {
  pay(requirement: PaymentRequirement): Promise<PaymentProof>;
}

/**
 * DEV ONLY stub — no real funds move. Kept so local dev works without
 * Hedera credentials. Swap for Blocky402HederaPaymentClient in production.
 */
export class StubPaymentClient implements PaymentClient {
  async pay(requirement: PaymentRequirement): Promise<PaymentProof> {
    return {
      proof: `stub-proof:${requirement.requestId}`,
      txId: `stub-tx-${requirement.requestId}`,
    };
  }
}

/**
 * Real x402 v2 Blocky402 payment client for Hedera testnet.
 *
 * Uses @x402/hedera ExactHederaScheme to sign a TransferTransaction,
 * then calls the Blocky402 facilitator to verify and settle it.
 * The settled paymentPayload is base64-encoded and returned as the proof.
 * The backend gate decodes it and calls /verify to confirm.
 */
export class Blocky402HederaPaymentClient implements PaymentClient {
  constructor(private readonly wallet: Wallet) {}

  async pay(requirement: PaymentRequirement): Promise<PaymentProof> {
    // 1. Convert amountHbar → tinybars string (x402 v2 uses smallest unit)
    const tinybars = String(Math.round(requirement.amountHbar * 100_000_000));

    const paymentRequirements: PaymentRequirements = {
      scheme: "exact",
      network: HEDERA_TESTNET_CAIP2,
      amount: tinybars,
      payTo: requirement.recipient,
      maxTimeoutSeconds: 300,
      asset: HBAR_ASSET_ID,           // "0.0.0" = native HBAR
      extra: { feePayer: BLOCKY402_FEE_PAYER },
    };
    const rawKey = process.env.HEDERA_PRIVATE_KEY ?? "";
    const signer = createClientHederaSigner(
      this.wallet.accountId.toString(),
      PrivateKey.fromStringECDSA(
        rawKey.startsWith("0x") ? rawKey.slice(2) : rawKey,
      ),
      { network: HEDERA_TESTNET_CAIP2 },
    );

    // 3. Sign the TransferTransaction (partial — facilitator co-signs as fee-payer)
    // Wrapped in retry: createPaymentPayload reads from a Hedera node while
    // signing and can fail transiently with a bare "fetch failed". It moves no
    // funds, so retrying is safe (unlike /settle below).
    const scheme = new ExactHederaScheme(signer);
    const signed = await withRetry("createPaymentPayload", () =>
      scheme.createPaymentPayload(2, paymentRequirements),
    );

    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      scheme: "exact",
      network: HEDERA_TESTNET_CAIP2,
      accepted: paymentRequirements,
      payload: signed.payload as ExactHederaPayloadV2,
    };

    const body = {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    };

    // 4. Verify with facilitator
    const verifyRes = await fetchWithNetworkRetry("Blocky402 /verify", `${BLOCKY402_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const verify = (await verifyRes.json()) as {
      isValid?: boolean;
      invalidMessage?: string;
      invalidReason?: string;
    };
    if (!verify.isValid) {
      throw new Error(
        `Blocky402 verify failed: ${verify.invalidMessage ?? verify.invalidReason ?? "unknown"}`,
      );
    }

    // 5. Settle with facilitator (co-signs + submits to Hedera)
    const settleRes = await fetchWithNetworkRetry("Blocky402 /settle", `${BLOCKY402_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const settle = (await settleRes.json()) as {
      success?: boolean;
      transaction?: string;
      errorMessage?: string;
      errorReason?: string;
    };
    if (!settle.success) {
      throw new Error(
        `Blocky402 settle failed: ${settle.errorMessage ?? settle.errorReason ?? "unknown"}`,
      );
    }

    // 6. Encode payload as base64 — this is the proof sent to the backend
    const proof = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
    return { proof, txId: settle.transaction };
  }
}
