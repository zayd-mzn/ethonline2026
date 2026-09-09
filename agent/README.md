# Cyber Intel Marketplace — AI Agent

Autonomous agent that discovers cyber-intel services, pays per query via x402 on
Hedera, and produces a threat report. It runs the loop:

```
discover → pick → pay (handle 402) → consume → report
```

Given a set of indicators (IPv4 addresses and/or file hashes), the agent finds a
matching marketplace service for each, pays the per-query price when the endpoint
returns `402 Payment Required`, consumes the result, and aggregates everything
into a single threat report with an overall verdict.

> **Payment status:** the pay step currently goes through `StubPaymentClient`
> (deterministic fake proof, no real funds move). It sits behind a `PaymentClient`
> seam so a real Hedera-backed client swaps in without touching callers.

---

## Requirements

- Node.js **>= 20**
- A Hedera **testnet** account (account id + DER private key)
- The marketplace **backend** running (Member 2), default `http://localhost:3001`

## Install

```bash
cd agent
npm install
```

> Heads-up: the install pulls in the official Hedera packages (`@hashgraph/sdk`,
> `hedera-agent-kit`), which bring a large transitive dependency tree and some
> `npm audit` warnings originating from those upstream packages.

## Configure

Copy the example env file and fill in real values. `.env` is gitignored — never
commit secrets.

```bash
cp .env.example .env
```

| Variable             | Required | Default                 | Description                                                        |
| -------------------- | :------: | ----------------------- | ------------------------------------------------------------------ |
| `HEDERA_ACCOUNT_ID`  |   yes    | —                       | Testnet account the agent pays from, e.g. `0.0.xxxxx`.             |
| `HEDERA_PRIVATE_KEY` |   yes    | —                       | DER-encoded private key for that account (`302e0201...`).          |
| `HEDERA_NETWORK`     |    no    | `testnet`               | `testnet` \| `mainnet` \| `previewnet`.                            |
| `BACKEND_URL`        |    no    | `http://localhost:3001` | Base URL of the marketplace backend (Member 2).                    |
| `MAX_SPEND_HBAR`     |    no    | `1.0`                   | Spend cap (HBAR) for a single run; the budget guard enforces it.   |
| `EVENT_STREAM_PORT`  |    no    | `3002`                  | Port for the activity event stream the frontend monitor connects to. |

Config is validated at startup and **fails fast** with a clear message if a
required value is missing or invalid.

## Fund the wallet

The agent pays real (testnet) HBAR per query, so the account needs a balance.

1. Create a testnet account and grab its id + DER private key from the
   [Hedera Portal](https://portal.hedera.com/) (or fund an existing one via the
   [testnet faucet](https://portal.hedera.com/faucet)).
2. Put the id and key in `.env` (`HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY`).
3. On startup the agent reads and logs the balance to confirm testnet
   connectivity. If the wallet check fails, the run still proceeds (the check is
   non-blocking) but real payments would fail — fund the account first.

Keep `MAX_SPEND_HBAR` at or below what you're willing to spend in one run; the
budget guard refuses any query that would push cumulative spend over the cap.

## Run the demo scenario

Build and run, or use the dev runner:

```bash
# one-off (compiled)
npm run build && npm start

# or live (tsx, no build step)
npm run dev
```

With no arguments the agent investigates a built-in demo set (two IPs and one
file hash). Pass your own indicators as CLI arguments to investigate them
instead:

```bash
npm start -- 1.2.3.4 8.8.8.8 44d88612fea8a8f36de82e1278abb02f
```

Indicators are auto-classified: anything matching an IPv4 pattern is queried as
an `ip`, everything else as a `hash`. Indicators with no matching service, or
whose paid request fails (e.g. budget refusal), are skipped with a warning so one
bad indicator doesn't sink the whole report.

Example console output (abridged):

```
budget: 1 HBAR available
wallet 0.0.xxxxx balance: 10 HBAR
event stream on http://localhost:3002/events (SSE)
investigating 3 indicator(s): 1.2.3.4, 8.8.8.8, 44d88612fea8a8f36de82e1278abb02f
[..] discover  found 2 service(s) at http://localhost:3001
[..] call      GET http://localhost:3001/api/ip-reputation?ip=1.2.3.4
[..] 402       payment required: 0.02 HBAR for /api/ip-reputation?ip=1.2.3.4
[..] paying    paying 0.02 HBAR to 0.0.yyyyy
[..] paid      paid 0.02 HBAR (tx stub-tx-...)
[..] data      report: 3 indicator(s), verdict malicious (...)

Threat Report — 2026-09-09T...
Overall verdict: MALICIOUS (3 indicator(s))
  malicious: 2  suspicious: 0  clean: 1
...
spent 0.04 HBAR of 1 cap
```

## Live activity stream (for the frontend)

While the agent runs, it serves its activity events over HTTP so the frontend
monitor can display live progress. The server starts before the loop and keeps
serving after the run completes (press `Ctrl-C` to exit).

| Endpoint    | Description                                                      |
| ----------- | ---------------------------------------------------------------- |
| `/events`   | Server-Sent Events (SSE) stream of `ActivityEvent` objects.      |
| `/activity` | JSON snapshot of recent buffered events (polling fallback).      |
| `/health`   | Liveness probe: `{ ok, clients }`.                               |

A ring buffer replays recent events to clients that connect mid-run, so a late
frontend isn't left blank. Each event is `{ ts, stage, detail }`, where `stage`
is one of `discover | call | 402 | paying | paid | data`.

Quick check:

```bash
curl -N http://localhost:3002/events      # live stream
curl    http://localhost:3002/activity    # buffered snapshot
```

## Test

Pure-logic pieces (budget math, discovery parsing, 402 parsing) are covered with
Node's built-in test runner — no extra test dependencies.

```bash
npm test
```

## Project layout

```
agent/src/
  index.ts         entry point: wires config, wallet, event stream, and the loop
  loop.ts          the end-to-end investigate() loop
  config.ts        env loading + validation (dependency-free)
  discovery.ts     GET /marketplace/services → typed Service[]
  paid-request.ts  402 → pay → retry-with-proof flow
  payment.ts       PaymentClient seam + StubPaymentClient
  budget.ts        spend guard against MAX_SPEND_HBAR
  wallet.ts        Hedera client init + balance / connectivity check
  report.ts        normalize findings → aggregate threat report
  event-stream.ts  SSE/polling server for the frontend monitor
  activity.ts      activity event emitter (progress bus)
  types.ts         shared contract shapes (mirror the backend)
agent/test/        unit tests (node:test via tsx)
```
