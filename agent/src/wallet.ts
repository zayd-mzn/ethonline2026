/**
 * Hedera wallet — initialization, balance, and testnet connectivity.
 *
 * Wallet setup only (no payments yet). Wraps the official @hashgraph/sdk
 * Client so the rest of the agent has a single place to get a configured,
 * connectivity-checked wallet. Payments (the 402 flow) build on this later.
 */

import {
  AccountBalanceQuery,
  AccountId,
  Client,
  PrivateKey,
} from "@hashgraph/sdk";
import type { AgentConfig } from "./config.js";

/**
 * Parse a private key that may be DER-encoded ("3030..." or "302e..."),
 * HEX-encoded ("0x..." or raw hex), or ECDSA hex. Tries formats in order.
 */
export function parsePrivateKey(raw: string): PrivateKey {
  const s = raw.trim();
  // DER format — starts with 302e or 3030
  if (s.startsWith("302e") || s.startsWith("3030") || s.startsWith("302d")) {
    return PrivateKey.fromStringDer(s);
  }
  // HEX with 0x prefix (ECDSA secp256k1 — what the Hedera portal exports)
  if (s.startsWith("0x")) {
    return PrivateKey.fromStringECDSA(s.slice(2));
  }
  // Try ECDSA raw hex (64 chars)
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return PrivateKey.fromStringECDSA(s);
  }
  // Fallback: let the SDK decide
  return PrivateKey.fromStringDer(s);
}

/** Build a Hedera Client for the configured network. */
function makeClient(network: AgentConfig["hederaNetwork"]): Client {
  switch (network) {
    case "mainnet":
      return Client.forMainnet();
    case "previewnet":
      return Client.forPreviewnet();
    case "testnet":
    default:
      return Client.forTestnet();
  }
}

export class Wallet {
  private constructor(
    readonly client: Client,
    readonly accountId: AccountId,
  ) {}

  /**
   * Initialize a wallet from config: parse credentials, configure the client
   * as operator, and return a ready-to-use Wallet. Does not touch the network.
   */
  static init(config: AgentConfig): Wallet {
    const accountId = AccountId.fromString(config.hederaAccountId);
    const privateKey = parsePrivateKey(config.hederaPrivateKey);
    const client = makeClient(config.hederaNetwork);
    client.setOperator(accountId, privateKey);
    return new Wallet(client, accountId);
  }

  /** Query the account's HBAR balance. Confirms testnet connectivity. */
  async getBalanceHbar(): Promise<number> {
    const balance = await new AccountBalanceQuery()
      .setAccountId(this.accountId)
      .execute(this.client);
    // Hbar.toBigNumber() gives the value in HBAR (not tinybars).
    return balance.hbars.toBigNumber().toNumber();
  }

  /** Cleanly close network connections. */
  close(): void {
    this.client.close();
  }
}
