/**
 * Read the agent account's live HBAR balance from the public Hedera mirror
 * node. Read-only, no key required.
 */

const MIRROR_BASE = "https://testnet.mirrornode.hedera.com";

/** Fetch an account's balance in HBAR. Throws on network/parse failure. */
export async function fetchAccountBalanceHbar(accountId: string): Promise<number> {
  const res = await fetch(`${MIRROR_BASE}/api/v1/accounts/${accountId}`);
  if (!res.ok) {
    throw new Error(`Mirror node returned ${res.status}`);
  }
  const data = (await res.json()) as { balance?: { balance?: number } };
  const tinybars = data.balance?.balance;
  if (typeof tinybars !== "number") {
    throw new Error("Balance not found in mirror node response");
  }
  return tinybars / 100_000_000; // tinybars → HBAR
}
