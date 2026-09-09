/**
 * Tests for the 402 payment-required parsing and pay/retry flow.
 *
 * Exercises PaidRequester.request with an injected fake fetch and a stub
 * payment client, covering requirement parsing (toRequirement), the budget
 * guard, and the retry-with-proof behaviour — no live backend needed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ActivityEmitter } from "../src/activity.js";
import { Budget } from "../src/budget.js";
import { PaidRequester, PAYMENT_PROOF_HEADER } from "../src/paid-request.js";
import { StubPaymentClient, type PaymentClient } from "../src/payment.js";
import type { PaymentRequirement } from "../src/types.js";

interface FakeResponse {
  status: number;
  body: unknown;
}

/**
 * A scripted fetch: returns the queued responses in order. Records the headers
 * each call was made with so we can assert the proof was attached on retry.
 */
function scriptedFetch(responses: FakeResponse[]) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const queue = [...responses];
  const fetchImpl = async (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    calls.push({ url, headers: init?.headers });
    const next = queue.shift();
    if (!next) throw new Error("scriptedFetch: no more responses queued");
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { fetchImpl, calls };
}

function requirement(overrides: Partial<PaymentRequirement> = {}): PaymentRequirement {
  return {
    amountHbar: 0.02,
    recipient: "0.0.12345",
    facilitator: "blocky402",
    requestId: "req-1",
    resource: "/api/ip-reputation?ip=1.2.3.4",
    ...overrides,
  };
}

function paymentRequired(overrides: Partial<PaymentRequirement> = {}) {
  return { status: 402, body: { error: "payment_required", payment: requirement(overrides) } };
}

function makeRequester(
  fetchImpl: ReturnType<typeof scriptedFetch>["fetchImpl"],
  opts: { budget?: Budget; payment?: PaymentClient; emitter?: ActivityEmitter } = {},
) {
  return new PaidRequester({
    emitter: opts.emitter ?? new ActivityEmitter(),
    budget: opts.budget ?? new Budget(1.0),
    payment: opts.payment ?? new StubPaymentClient(),
    fetchImpl,
  });
}

test("returns the body directly when the endpoint is not gated", async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { status: 200, body: { ip: "1.2.3.4", malicious: false, score: 0, source: "x" } },
  ]);
  const requester = makeRequester(fetchImpl);

  const result = await requester.request<{ ip: string }>("http://x/api/ip");
  assert.equal(result.ip, "1.2.3.4");
  assert.equal(calls.length, 1); // no retry needed
});

test("handles 402 by paying and retrying with the proof header", async () => {
  const { fetchImpl, calls } = scriptedFetch([
    paymentRequired(),
    { status: 200, body: { ip: "1.2.3.4", malicious: true, score: 90, source: "x" } },
  ]);
  const budget = new Budget(1.0);
  const requester = makeRequester(fetchImpl, { budget });

  const result = await requester.request<{ malicious: boolean }>("http://x/api/ip");
  assert.equal(result.malicious, true);

  // Two calls: the initial gated call, then the paid retry.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers, undefined);
  assert.equal(calls[1].headers?.[PAYMENT_PROOF_HEADER], "stub-proof:req-1");

  // The successful charge was recorded against the budget.
  assert.equal(budget.totalSpent, 0.02);
});

test("emits the call -> 402 -> paying -> paid stages", async () => {
  const emitter = new ActivityEmitter();
  const stages: string[] = [];
  emitter.subscribe((e) => stages.push(e.stage));
  const { fetchImpl } = scriptedFetch([
    paymentRequired(),
    { status: 200, body: {} },
  ]);
  await makeRequester(fetchImpl, { emitter }).request("http://x/api/ip");

  assert.deepEqual(stages, ["call", "402", "paying", "paid"]);
});

test("throws on a 402 whose body is not a valid payment requirement", async () => {
  const { fetchImpl } = scriptedFetch([
    { status: 402, body: { error: "payment_required", payment: { amountHbar: "lots" } } },
  ]);
  await assert.rejects(
    makeRequester(fetchImpl).request("http://x/api/ip"),
    /could not parse payment requirement/,
  );
});

test("budget guard refuses a charge that exceeds the cap; no payment, no retry", async () => {
  const { fetchImpl, calls } = scriptedFetch([paymentRequired({ amountHbar: 5.0 })]);
  let paid = false;
  const payment: PaymentClient = {
    async pay(req) {
      paid = true;
      return { proof: `stub-proof:${req.requestId}` };
    },
  };
  const budget = new Budget(1.0);

  await assert.rejects(
    makeRequester(fetchImpl, { budget, payment }).request("http://x/api/ip"),
    /Budget guard refused/,
  );
  assert.equal(paid, false); // never paid
  assert.equal(calls.length, 1); // never retried
  assert.equal(budget.totalSpent, 0); // nothing charged
});

test("throws when the paid retry itself fails", async () => {
  const { fetchImpl } = scriptedFetch([
    paymentRequired(),
    { status: 500, body: {} },
  ]);
  await assert.rejects(
    makeRequester(fetchImpl).request("http://x/api/ip"),
    /Retry after payment failed with status 500/,
  );
});

test("throws on an unexpected non-402 error status", async () => {
  const { fetchImpl } = scriptedFetch([{ status: 404, body: {} }]);
  await assert.rejects(
    makeRequester(fetchImpl).request("http://x/api/ip"),
    /status 404/,
  );
});
