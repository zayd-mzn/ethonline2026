/**
 * Cyber Intel Marketplace — AI Agent (Member 3)
 *
 * Entry point. Wires the Phase 2 building blocks: config, activity emitter,
 * service discovery, budget guard, and Hedera wallet. The full
 * discover -> pick -> pay -> consume -> report loop lands in Phase 3.
 */

import { ActivityEmitter, consoleLogger } from "./activity.js";
import { Budget } from "./budget.js";
import { loadConfig } from "./config.js";
import { DiscoveryClient } from "./discovery.js";
import { Wallet } from "./wallet.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const emitter = new ActivityEmitter();
  emitter.subscribe(consoleLogger);

  const budget = new Budget(config.maxSpendHbar);
  console.log(`budget: ${budget.remaining} HBAR available`);

  // Discovery — list services from the backend.
  const discovery = new DiscoveryClient({
    backendUrl: config.backendUrl,
    emitter,
  });
  try {
    const services = await discovery.listServices();
    for (const s of services) {
      console.log(`  - ${s.name} (${s.queryType}) @ ${s.priceHbar} HBAR`);
    }
  } catch (err) {
    console.warn(
      `discovery skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Wallet — initialize and confirm connectivity by reading balance.
  let wallet: Wallet | undefined;
  try {
    wallet = Wallet.init(config);
    const bal = await wallet.getBalanceHbar();
    console.log(`wallet ${config.hederaAccountId} balance: ${bal} HBAR`);
  } catch (err) {
    console.warn(
      `wallet check skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    wallet?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
