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
import { Blocky402HederaPaymentClient, StubPaymentClient } from "./payment.js";
import { formatReport } from "./report.js";
import { Wallet } from "./wallet.js";
import { registerAgentWithBackend } from "./agent-identity.js";

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

  // Register agent identity with the backend using the human owner's World
  // proof. This ties the agent to a verified human (accountability link). If
  // no proof is configured, the agent runs unbacked — it will be rejected by
  // gated routes when the backend has REQUIRE_AGENT_BACKING=true.
  let agentId: string | undefined;
  if (config.worldProof) {
    const identity = await registerAgentWithBackend(config.backendUrl, config.worldProof);
    if (identity.isHumanBacked) {
      agentId = identity.agentId;
      console.log(`agent registered to a verified human: ${agentId}`);
    } else {
      console.warn("⚠️  agent registration rejected — World proof invalid; running unbacked");
    }
  } else {
    console.warn(
      "⚠️  no WORLD_PROOF set — agent is not human-backed; gated routes will reject it " +
        "when the backend enforces backing (REQUIRE_AGENT_BACKING=true)",
    );
  }

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
    const usingReal = config.paymentMode === "real" && wallet;
    const payment = usingReal
      ? new Blocky402HederaPaymentClient(wallet!)
      : new StubPaymentClient();
    console.log(
      `payment mode: ${usingReal ? "real (Blocky402 on-chain)" : "stub (no funds moved)"}`,
    );
    const report = await investigate(targets, {
      backendUrl: config.backendUrl,
      emitter,
      budget,
      payment,
      agentId,
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
