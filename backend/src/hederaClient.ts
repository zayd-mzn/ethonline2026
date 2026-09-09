/**
 * Shared Hedera client singleton for the backend.
 *
 * Initialised once at startup; all backend modules (payment gate, HCS logger)
 * share the same client instance. Supports both DER and HEX private keys,
 * matching the format exported by the Hedera portal.
 */

import { AccountId, Client, PrivateKey } from "@hashgraph/sdk";

let _client: Client | null = null;

/**
 * Parse a private key that may be DER-encoded ("302e..." / "3030...") or
 * ECDSA HEX ("0x..." or raw 64-char hex) — same logic as agent/src/wallet.ts.
 */
function parsePrivateKey(raw: string): PrivateKey {
  const s = raw.trim();
  if (s.startsWith("302e") || s.startsWith("3030") || s.startsWith("302d")) {
    return PrivateKey.fromStringDer(s);
  }
  if (s.startsWith("0x")) {
    return PrivateKey.fromStringECDSA(s.slice(2));
  }
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return PrivateKey.fromStringECDSA(s);
  }
  return PrivateKey.fromStringDer(s);
}

/**
 * Return the shared Hedera Client, initialising it on first call.
 * Requires HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in the environment.
 */
export function getHederaClient(): Client {
  if (_client) return _client;

  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  const network = process.env.HEDERA_NETWORK ?? "testnet";

  if (!accountId || !privateKey) {
    throw new Error(
      "HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set in the environment",
    );
  }

  switch (network) {
    case "mainnet":
      _client = Client.forMainnet();
      break;
    case "previewnet":
      _client = Client.forPreviewnet();
      break;
    default:
      _client = Client.forTestnet();
  }

  _client.setOperator(
    AccountId.fromString(accountId),
    parsePrivateKey(privateKey),
  );

  return _client;
}

/** Close the client on graceful shutdown (optional). */
export function closeHederaClient(): void {
  _client?.close();
  _client = null;
}
