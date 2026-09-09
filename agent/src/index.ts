/**
 * Cyber Intel Marketplace — AI Agent (Member 3)
 *
 * Entry point. Runs the full loop: discover -> pick -> pay -> consume ->
 * report over a set of indicators (the demo scenario "investigate N
 * indicators"). Payment currently uses StubPaymentClient; the real
 * Hedera-backed client swaps in behind the PaymentClient seam later.
 */

import { ActivityEmitter, consoleLogger } from "./activity.js";
import { Budget } from "./budget.js";
import { loadConfig } from "./config.js";
import { EventStreamServer } from "./event-stream.js";
import { investigate } from "./loop.js";
import { StubPaymentClient } from "./payment.js";
import { formatReport } from "./report.js";
import { Wallet } from "./wallet.js";

/** Default indicators used when none are passed on the command line. */
const DEMO_INDICATORS = ["1.2.3.4", "8.8.8.8", "44d88612fea8a8f36de82e1278abb02f"];

async function main(): Promise<void> {
  const config = loadConfig();

  const emitter = new ActivityEmitter();
  emitter.subscribe(consoleLogger);

  // Expose the activity stream so the frontend monitor can consume live events.
  const eventStream = new EventStreamServer({ emitter });
  try {
    const port = await eventStream.start(config.eventStreamPort);
    console.log(`event stream on http://localhost:${port}/events (SSE)`);
  } catch (err) {
    console.warn(
      `event stream disabled: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const budget = new Budget(config.maxSpendHbar);
  console.log(`budget: ${budget.remaining} HBAR available`);

  // Optional wallet connectivity check (does not block the loop if it fails).
  let wallet: Wallet | undefined;
  try {
    wallet = Wallet.init(config);
    const bal = await wallet.getBalanceHbar();
    console.log(`wallet ${config.hederaAccountId} balance: ${bal} HBAR`);
  } catch (err) {
    console.warn(
      `wallet check skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Indicators from CLI args, or the demo set.
  const indicators = process.argv.slice(2);
  const targets = indicators.length > 0 ? indicators : DEMO_INDICATORS;
  console.log(`investigating ${targets.length} indicator(s): ${targets.join(", ")}`);

  try {
    const report = await investigate(targets, {
      backendUrl: config.backendUrl,
      emitter,
      budget,
      payment: new StubPaymentClient(),
    });
    console.log("\n" + formatReport(report));
    console.log(`\nspent ${budget.totalSpent} HBAR of ${config.maxSpendHbar} cap`);
  } catch (err) {
    console.error(
      `investigation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    wallet?.close();
  }

  // Keep the event stream alive after the run so the frontend can still read
  // the final buffered events. Shut down cleanly on Ctrl-C.
  console.log("run complete — event stream still serving (Ctrl-C to exit)");
  const shutdown = async () => {
    await eventStream.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
