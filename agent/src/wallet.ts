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
    const privateKey = PrivateKey.fromStringDer(config.hederaPrivateKey);
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
