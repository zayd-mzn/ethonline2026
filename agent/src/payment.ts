/**
 * Payment path — the seam for Member 1's real Hedera payment implementation.
 *
 * The agent codes against the PaymentClient interface. A stub is provided so
 * the full 402 -> pay -> retry flow works end-to-end before M1's real path
 * lands (mirrors backend/src/identity.stub.ts). The real implementation
 * (actual HBAR transfer via the wallet) swaps in without changing callers.
 */

import {
  AccountId,
  Hbar,
  TransferTransaction,
} from "@hashgraph/sdk";
import type { Wallet } from "./wallet.js";
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

/**
 * Real Hedera payment client.
 *
 * Transfers requirement.amountHbar from the agent wallet to the recipient
 * account, waits for consensus, and returns the transaction ID as the proof.
 *
 * Proof format:  "hedera-tx:<transactionId>"
 * The backend gate parses this, queries the ledger, and verifies the transfer
 * actually settled for at least the expected amount to the expected recipient.
 */
export class HederaPaymentClient implements PaymentClient {
  constructor(private readonly wallet: Wallet) {}

  async pay(requirement: PaymentRequirement): Promise<PaymentProof> {
    const recipient = AccountId.fromString(requirement.recipient);

    // Convert HBAR to tinybars (1 HBAR = 100,000,000 tinybars)
    const tinybars = Math.round(requirement.amountHbar * 100_000_000);
    const amount = Hbar.fromTinybars(tinybars);

    // Build and execute the transfer transaction
    const txResponse = await new TransferTransaction()
      .addHbarTransfer(this.wallet.accountId, amount.negated())
      .addHbarTransfer(recipient, amount)
      .execute(this.wallet.client);

    // Wait for consensus and confirm SUCCESS
    const receipt = await txResponse.getReceipt(this.wallet.client);

    if (receipt.status.toString() !== "SUCCESS") {
      throw new Error(
        `Payment transaction failed with status: ${receipt.status.toString()}`,
      );
    }

    const txId = txResponse.transactionId.toString();
    return {
      proof: `hedera-tx:${txId}`,
      txId,
    };
  }
}
