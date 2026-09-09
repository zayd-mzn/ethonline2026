/**
 * HCS (Hedera Consensus Service) audit logger — Member 1 deliverable.
 *
 * Creates a single HCS topic at backend startup and submits an immutable
 * on-chain record for every successfully paid request. Judges can verify
 * the full payment trail on HashScan without trusting our server.
 *
 * Usage:
 *   await initHcsTopic();          // call once at startup
 *   getTopicId();                  // expose in /health
 *   logPayment({ ... });           // call after each verified payment (fire-and-forget)
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { getHederaClient } from "./hederaClient.js";

/** Cached topic id after initHcsTopic() completes. */
let topicId: string | null = null;

/** Payment record written to HCS for each successful paid request. */
export interface HcsPaymentEntry {
  requestId: string;
  resource: string;    // e.g. "/api/ip-reputation"
  amountHbar: number;
  payer: string;       // Hedera account id of the agent
  txId: string;        // on-chain transfer transaction id
  timestamp: string;   // ISO-8601
}

/**
 * Create an HCS topic at startup and cache the topic id.
 * Safe to call multiple times — returns cached id after first call.
 * Throws if Hedera credentials are missing or the network is unreachable.
 */
export async function initHcsTopic(): Promise<string> {
  if (topicId) return topicId;

  const client = getHederaClient();

  const txResponse = await new TopicCreateTransaction()
    .setTopicMemo("Cyber Intel Marketplace — payment audit log")
    .execute(client);

  const receipt = await txResponse.getReceipt(client);

  if (!receipt.topicId) {
    throw new Error("HCS topic creation succeeded but topicId is missing in receipt");
  }

  topicId = receipt.topicId.toString();

  console.log(`✅ HCS topic created: ${topicId}`);
  console.log(`   Verify on HashScan: https://hashscan.io/testnet/topic/${topicId}`);

  return topicId;
}

/** Return the cached HCS topic id, or null if initHcsTopic() hasn't been called. */
export function getTopicId(): string | null {
  return topicId;
}

/**
 * Submit a payment record to the HCS topic.
 *
 * Fire-and-forget: errors are logged but never bubble up to the caller,
 * so a transient HCS failure never blocks the API response.
 */
export function logPayment(entry: HcsPaymentEntry): void {
  if (!topicId) {
    console.warn("HCS logPayment called before initHcsTopic — skipping");
    return;
  }

  const client = getHederaClient();
  const message = JSON.stringify(entry);

  new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .execute(client)
    .then((tx) => tx.getReceipt(client))
    .then(() => {
      console.log(`HCS audit: logged payment for ${entry.resource} (tx ${entry.txId})`);
    })
    .catch((err: unknown) => {
      // Non-fatal — the API already responded successfully
      console.error(
        "HCS audit log failed (non-fatal):",
        err instanceof Error ? err.message : String(err),
      );
    });
}
