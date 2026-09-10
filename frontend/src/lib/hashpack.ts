/**
 * HashPack (Hedera WalletConnect) integration — Option 1: fund-the-agent once.
 *
 * The human connects HashPack once and approves a SINGLE HBAR transfer that
 * funds the agent's own Hedera account. After that, the agent spends
 * autonomously using its own key — no further wallet prompts. This module
 * only handles the one-time connect + fund step in the browser.
 *
 * We use the classic DAppConnector API from @hashgraph/hedera-wallet-connect
 * (v1.x): pair over WalletConnect, then sign+submit a TransferTransaction
 * through the connected wallet (HashPack holds the key — the app never sees it).
 */

import {
  DAppConnector,
  HederaJsonRpcMethod,
  HederaSessionEvent,
  HederaChainId,
  transactionToBase64String,
} from "@hashgraph/hedera-wallet-connect";
import {
  AccountId,
  Hbar,
  LedgerId,
  TransferTransaction,
} from "@hashgraph/sdk";

/** WalletConnect project id — get a free one at https://cloud.reown.com. */
const PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";

/** dApp metadata shown inside HashPack when pairing. */
const METADATA = {
  name: "Cyber Intel Marketplace",
  description: "Fund your autonomous threat-intel agent",
  url: typeof window !== "undefined" ? window.location.origin : "https://localhost",
  icons: [] as string[],
};

let connector: DAppConnector | null = null;

/** True once the user has an active HashPack session. */
export function isConnected(): boolean {
  return !!connector && connector.signers.length > 0;
}

/** The connected account id (payer), or null if not connected. */
export function connectedAccountId(): string | null {
  if (!connector || connector.signers.length === 0) return null;
  return connector.signers[0].getAccountId().toString();
}

/**
 * Initialise the connector (idempotent). Must be called before connect().
 * Throws a clear error if the WalletConnect project id is missing.
 */
async function ensureConnector(): Promise<DAppConnector> {
  if (connector) return connector;

  if (!PROJECT_ID) {
    throw new Error(
      "VITE_WALLETCONNECT_PROJECT_ID is not set — get a free project id at " +
        "https://cloud.reown.com and add it to frontend/.env.local",
    );
  }

  connector = new DAppConnector(
    METADATA,
    LedgerId.TESTNET,
    PROJECT_ID,
    Object.values(HederaJsonRpcMethod),
    [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
    [HederaChainId.Testnet],
  );

  await connector.init({ logger: "error" });
  return connector;
}

/**
 * Open the HashPack pairing modal and establish a session.
 * Returns the connected account id. This is the ONLY interactive connect step.
 */
export async function connectHashPack(): Promise<string> {
  const c = await ensureConnector();
  await c.openModal();
  const accountId = connectedAccountId();
  if (!accountId) {
    throw new Error("HashPack connection did not return an account");
  }
  return accountId;
}

/** Disconnect all active sessions. */
export async function disconnectHashPack(): Promise<void> {
  if (!connector) return;
  await connector.disconnectAll();
}

/**
 * Fund the agent's account with a one-time HBAR transfer, signed by the
 * connected HashPack wallet. Returns the on-chain transaction id.
 *
 * @param agentAccountId  the agent's Hedera account (recipient)
 * @param amountHbar      how much to send (the agent's spending budget)
 */
export async function fundAgent(
  agentAccountId: string,
  amountHbar: number,
): Promise<string> {
  if (!connector || connector.signers.length === 0) {
    throw new Error("Connect HashPack before funding the agent");
  }
  if (!(amountHbar > 0)) {
    throw new Error("Funding amount must be greater than zero");
  }

  const signer = connector.signers[0];
  const payer = signer.getAccountId();
  const recipient = AccountId.fromString(agentAccountId);

  if (payer.toString() === recipient.toString()) {
    throw new Error("The funding wallet and the agent account must differ");
  }

  const amount = new Hbar(amountHbar);

  const tx = new TransferTransaction()
    .addHbarTransfer(payer, amount.negated())
    .addHbarTransfer(recipient, amount);

  // Freeze via the connected signer so it stamps a transaction id and node
  // account ids (no local Client available in the browser). This resolves the
  // "`transactionId` must be set or `client` must be provided" error.
  const frozen = await tx.freezeWithSigner(signer);

  // Ask HashPack to sign + submit this single transfer. The human approves
  // it once in the wallet; the app never touches the key.
  const result = await connector.signAndExecuteTransaction({
    signerAccountId: `hedera:testnet:${payer.toString()}`,
    transactionList: transactionToBase64String(frozen),
  });

  const txId =
    (result as { result?: { transactionId?: string } }).result?.transactionId ??
    (result as { transactionId?: string }).transactionId ??
    "submitted";
  return txId;
}
