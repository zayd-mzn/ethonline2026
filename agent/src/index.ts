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

  const usingReal = config.paymentMode === "real" && wallet;
  console.log(
    `payment mode: ${usingReal ? "real (Blocky402 on-chain)" : "stub (no funds moved)"}`,
  );

  /**
   * Run one full investigation over the given indicators (or the demo set when
   * empty). Reused for the initial boot run and each POST /investigate trigger.
   * A fresh Budget is created per run so the spend cap resets each time.
   */
  async function runInvestigation(indicators: string[]): Promise<void> {
    const targets = indicators.length > 0 ? indicators : DEMO_INDICATORS;
    const budget = new Budget(config.maxSpendHbar);
    console.log(`budget: ${budget.remaining} HBAR available`);
    console.log(`investigating ${targets.length} indicator(s): ${targets.join(", ")}`);

    const payment = usingReal
      ? new Blocky402HederaPaymentClient(wallet!)
      : new StubPaymentClient();

    try {
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
    }
  }

  // Expose the activity stream so the frontend monitor can consume live events,
  // and let it trigger fresh runs on demand via POST /investigate.
  const eventStream = new EventStreamServer({ emitter, onRun: runInvestigation });
  try {
    const port = await eventStream.start(config.eventStreamPort);
    console.log(`event stream on http://localhost:${port}/events (SSE)`);
    console.log(`trigger a run:  POST http://localhost:${port}/investigate`);
  } catch (err) {
    console.warn(
      `event stream disabled: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Indicators from CLI args, or the demo set — the initial boot run.
  const indicators = process.argv.slice(2);
  await runInvestigation(indicators);

  // Keep the event stream alive after the run so the frontend can still read
  // the final buffered events and trigger new runs. The wallet stays open for
  // the process lifetime so on-demand real-mode runs can reuse it; it's closed
  // on shutdown. Shut down cleanly on Ctrl-C.
  console.log("run complete — event stream still serving (Ctrl-C to exit)");
  const shutdown = async () => {
    try {
      wallet?.close();
    } catch {
      /* ignore */
    }
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
