# CIM — Cyber Intel Marketplace

A marketplace where **autonomous AI agents pay per query** — via **x402 on Hedera** —
for **cybersecurity threat intelligence**, with providers and agents gated behind
**World human-verification**.

Threat intelligence today is locked behind flat-rate subscriptions and human-only
portals, leaving autonomous security agents with no clean way to acquire data on
demand. CIM turns threat-intel services into metered, machine-payable endpoints an
agent can discover, pay for, and consume with no human in the loop.

> **Status:** the full discover → pay → consume → report loop works end-to-end, and a
> **real on-chain payment has been settled and verified on Hedera testnet** via the
> Blocky402 x402 v2 facilitator. See [Verified payment](#verified-on-chain-payment).

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Payment flow (x402 on Hedera)](#payment-flow-x402-on-hedera)
- [Identity (World)](#identity-world)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start (local, no funds)](#quick-start-local-no-funds)
- [Running a real on-chain payment](#running-a-real-on-chain-payment)
- [Verified on-chain payment](#verified-on-chain-payment)
- [API reference](#api-reference)
- [Testing](#testing)
- [Sponsor tracks](#sponsor-tracks)
- [Current status & known gaps](#current-status--known-gaps)
- [Team](#team)
- [Further docs](#further-docs)

---

## What it does

1. **Providers publish** priced threat-intel services (IP reputation, file-hash checks)
   to a registry — publishing is gated behind a **World Selfie Check** (anti-sybil).
2. **An autonomous agent** is given a set of indicators (IPs / file hashes). For each,
   it:
   - **discovers** a matching service from the marketplace,
   - **calls** the gated endpoint and receives an `HTTP 402 Payment Required`,
   - checks the charge against a **hard spend cap** (budget guard),
   - **settles** the HBAR micro-payment via **x402 / Blocky402** on Hedera,
   - **retries** with the payment proof and **consumes** the result,
   - **aggregates** all findings into a single **threat report** with an overall verdict.
3. **Every stage** (`discover → call → 402 → paying → paid → data`) is streamed live over
   **Server-Sent Events** to a real-time dashboard.
4. **Every paid request** is written to a **Hedera Consensus Service (HCS)** topic as an
   immutable audit record, verifiable on HashScan.

---

## Architecture

```
                    ┌─────────────────────────────┐
                    │   Frontend (React + Vite)    │  :5173
                    │  marketplace · monitor · UI  │
                    └───────┬──────────────┬───────┘
                            │ REST         │ SSE (/events, /activity)
                            ▼              ▼
        ┌───────────────────────────┐   ┌─────────────────────────────┐
        │   Backend (Fastify)       │   │   Agent (TypeScript)         │
        │   :3001                   │   │   :3002 (event stream)       │
        │  · service registry (DB)  │   │  · discover → pay → consume  │
        │  · x402 payment gate      │◀──│  · budget guard              │
        │  · World Selfie Check     │   │  · threat report             │
        │  · HCS audit logger       │   │  · Blocky402 payment client  │
        └───────────┬───────────────┘   └──────────────┬──────────────┘
                    │                                   │
                    │        x402 verify / settle       │
                    ▼                                   ▼
            ┌──────────────────────────────────────────────────┐
            │   Blocky402 facilitator  +  Hedera Testnet (HBAR) │
            └──────────────────────────────────────────────────┘
```

- **Language:** TypeScript everywhere. **Runtime:** Node.js ≥ 20.
- **Backend:** Fastify + SQLite (`better-sqlite3`) for the service registry.
- **Agent:** dependency-light TypeScript; `@hashgraph/sdk` + `@x402/hedera`.
- **Frontend:** React 19 + Vite + Tailwind (with Three.js globe, Framer Motion timeline).
- **Chain:** Hedera Testnet. **Payments:** x402 v2 via the hosted Blocky402 facilitator.
- **Identity:** World Selfie Check (providers) + AgentKit/AgentBook (agents).

---

## Payment flow (x402 on Hedera)

```
Agent                     Backend                   Blocky402
  |-- GET /api/ip-reputation ->|                        |
  |<-- 402 { x402Version:2,    |                        |
  |     accepts:[{amount,payTo, |                        |
  |     feePayer}] } -----------|                        |
  |-- sign TransferTransaction (ExactHederaScheme) ----->|
  |-- POST /verify, /settle --------------------------->|  (co-signs as fee-payer,
  |<-- { success, transaction } ------------------------|   submits to Hedera)
  |-- GET /api/ip-reputation -->|                        |
  |    X-PAYMENT: base64(proof) |-- POST /verify ------->|
  |                             |<-- { isValid:true } ---|
  |                             |-- logPayment → HCS      |
  |<-- 200 { ip, score } -------|                        |
```

The agent pays **only the exact service price**; the Blocky402 fee-payer covers the
Hedera network fee. Full details in [`docs/PAYMENTS.md`](docs/PAYMENTS.md).

---

## Identity (World)

- **Provider onboarding — real.** Publishing a service (`POST /marketplace/services`)
  requires a valid **World Selfie Check** proof, verified against World's API. The
  `nullifier_hash` yields one stable provider ID per human (anti-sybil).
- **Agent onboarding — real accountability link.** The agent's human owner verifies
  with **World Selfie Check**, and the backend (`POST /agents/register`) ties the
  resulting `agent_<hash>` ID to that human's `nullifier_hash`, persisted in the DB.
  The agent sends this ID as an `X-Agent-Id` header on gated requests. When
  `REQUIRE_AGENT_BACKING=true`, the backend rejects requests whose agent ID is **not**
  in the verified registry with `403` **before** any payment is quoted (dev-bypass off
  by default so local runs stay frictionless). Because the ID is derived from the
  `nullifier_hash` (one per human), a misbehaving agent resolves back to exactly one
  verified human — the accountability the marketplace needs.

---

## Funding the agent (HashPack, one-time)

The agent pays autonomously using **its own Hedera key** — no human in the loop per
query. To bankroll it, the dashboard has a **Fund agent** view that connects
**HashPack** over WalletConnect and approves a **single** HBAR transfer into the
agent's account:

1. The human clicks **Connect HashPack** (one interactive pairing).
2. They enter an amount and approve **one** transfer to the agent's account.
3. The agent then spends per query on its own — **no further wallet prompts**.

This is a deliberate design: a browser wallet like HashPack never releases its key, so
"connect once and let the agent sign forever" is impossible by construction. Instead the
human authorises *funding* once; the agent's budget guard (`MAX_SPEND_HBAR`) caps how
much it can spend. Top-ups are just another one-time approval.

Setup:
- Backend: set `AGENT_ACCOUNT_ID` (the agent's own account) — exposed via
  `GET /agent-info` so the frontend knows where to send funds.
- Frontend: set `VITE_WALLETCONNECT_PROJECT_ID` in `frontend/.env.local`
  (free id from <https://cloud.reown.com>).

---

## Repository layout

```
ethonline2026/
├── agent/       # Autonomous AI agent — discover → pay → consume → report loop
├── backend/     # Fastify API: registry, x402 gate, Selfie Check, HCS audit
├── frontend/    # React dashboard: marketplace, live agent monitor, provider console
├── contracts/   # (reserved)
└── docs/        # API contract, payments, AI usage, World integration
```

Each of `agent/` and `backend/` has its own README with module-specific detail.

---

## Prerequisites

- **Node.js ≥ 20**
- **npm** (backend, agent) and **pnpm** (frontend)
- For real payments only: a **funded Hedera testnet account** with an **ECDSA** key
  (from <https://portal.hedera.com>)

---

## Quick start (local, no funds)

The stack defaults to **stub payments** — no funds move — so you can run the whole thing
without any Hedera credentials. Use three terminals:

```bash
# 1) Backend  → http://localhost:3001
cd backend && npm install && npm run dev

# 2) Agent    → event stream on http://localhost:3002
cd agent && npm install && npm run dev

# 3) Frontend → http://localhost:5173
cd frontend && pnpm install && pnpm dev
```

Then open <http://localhost:5173>. The marketplace lists seeded services and the agent
monitor shows the run. The agent investigates a demo indicator set by default; pass your
own as CLI args:

```bash
cd agent && npm run dev -- 1.2.3.4 8.8.8.8 44d88612fea8a8f36de82e1278abb02f
```

> **Frontend dev note:** the frontend talks to the backend/agent through Vite's proxy.
> If the marketplace looks empty, ensure API calls use relative paths (see
> `frontend/src/api.ts`) so they route same-origin and avoid CORS.

---

## Running a real on-chain payment

The stack settles real HBAR when `PAYMENT_MODE=real`. **Two rules:**

1. Use an **ECDSA** key (HEX `0x…`) — the real client uses `fromStringECDSA`.
2. The **recipient must differ from the payer** — a self-transfer nets to zero and
   Blocky402 rejects it with `invalid_exact_hedera_payload_amount_mismatch`.

`agent/.env`:
```
HEDERA_ACCOUNT_ID=0.0.xxxxx           # payer
HEDERA_PRIVATE_KEY=0x...              # ECDSA hex
HEDERA_NETWORK=testnet
BACKEND_URL=http://localhost:3001
MAX_SPEND_HBAR=1.0
PAYMENT_MODE=real
BLOCKY402_URL=https://api.testnet.blocky402.com
```

`backend/.env`:
```
HEDERA_ACCOUNT_ID=0.0.xxxxx           # operator / treasury
HEDERA_PRIVATE_KEY=0x...
HEDERA_RECIPIENT=0.0.yyyyy            # MUST differ from the agent payer
HEDERA_NETWORK=testnet
BLOCKY402_URL=https://api.testnet.blocky402.com
```

Run the three services as above, then verify the printed `txId` on HashScan or the
mirror node. Full runbook: [`docs/PAYMENTS.md`](docs/PAYMENTS.md).

> `.env` files are gitignored — never commit secrets.

---

## Verified on-chain payment

A real paid request was settled end-to-end on Hedera testnet:

| | |
|---|---|
| Payer (agent) | `0.0.8496637` |
| Recipient (treasury) | `0.0.10450266` |
| Amount | 0.01 HBAR (agent pays exact price; facilitator covers the fee) |
| Transaction | `0.0.7162784@1788996589.198259785` — **SUCCESS** |
| HashScan | <https://hashscan.io/testnet/transaction/0.0.7162784@1788996589.198259785> |

Verify independently via the public mirror node:
```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1788996589-198259785"
```

---

## API reference

Base URL: `http://localhost:3001`

| Method | Path | Description | Gated by |
|---|---|---|---|
| `GET` | `/health` | Liveness + HCS topic id / HashScan link | — |
| `GET` | `/agent-info` | Agent's fund-recipient account + network (for HashPack funding) | — |
| `GET` | `/marketplace/services` | List discoverable services | open |
| `POST` | `/marketplace/services` | Publish a service | World Selfie Check |
| `POST` | `/agents/register` | Register an agent to a verified human → `{ agentId }` | World Selfie Check |
| `GET` | `/api/ip-reputation?ip=` | IP reputation → `{ ip, malicious, score }` | x402 payment |
| `GET` | `/api/hash-check?hash=` | Hash check → `{ hash, detections, verdict }` | x402 payment |
| `POST` | `/api/triage` | Stack-rank a list of indicators worst-first | open |

Agent event stream (port `3002`):

| Method | Path | Description |
|---|---|---|
| `GET` | `/events` | SSE stream of `ActivityEvent` objects |
| `GET` | `/activity` | JSON snapshot of buffered recent events |
| `GET` | `/health` | Liveness + connected client count |

Frozen contract shapes live in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

---

## Testing

```bash
cd backend && npm test     # Fastify + identity + registry tests
cd agent   && npm test     # budget guard, discovery parsing, 402 flow
```

Both suites use Node's built-in test runner (`node:test` via `tsx`) — no extra deps.
Type-check either package with `npm run typecheck`.

---

## Sponsor tracks

- **Hedera** — x402 pay-per-query, real HBAR settlement via Blocky402, HCS audit log.
  *One real paid request completed end-to-end (verified above).*
- **World** — Selfie Check gates provider publishing; AgentKit/AgentBook for agent
  human-backing.
- **Bazantic** — threat-intel API exposed via an x402/MPP gateway + Recipe
  (see `backend/openapi.yaml`).

---

## Current status & known gaps

**Working & verified**
- Full agent loop: discover → pick → 402 → pay → consume → aggregate report.
- **Real on-chain payment** via Blocky402 on Hedera testnet (verified).
- x402 v2 payment gate, HCS audit logging, service registry (SQLite).
- World Selfie Check for provider publishing.
- Live SSE activity stream consumed by the frontend dashboard.
- Backend and agent test suites passing; both type-check clean.

**Known gaps**
- **Agent human-backing now resolves to a real human.** The agent's owner verifies
  with World Selfie Check; `POST /agents/register` derives the `agent_<hash>` ID from
  the human's `nullifier_hash` and persists the link in the DB. The payment gate
  (`REQUIRE_AGENT_BACKING=true`) rejects any agent ID not in that verified registry
  with `403` before payment. Format-only validation has been removed — a made-up ID no
  longer passes.
- Provider verified-state is held in memory (not yet persisted to the DB).
- Real-payment mode requires an ECDSA key and a distinct recipient (documented).

### World ID 4.0 (resolved blocker — staging vs production)

The frontend now uses **IDKit 4** (`@worldcoin/idkit@4.x`) and the backend verifies
proofs with **World ID 4.0** (`POST /api/v4/verify/{rp_id}`). The old blocker was that
the World Developer Portal no longer creates `app_staging_…` apps: **staging is now a
property of the action and of the IDKit request**, and the Simulator only accepts
requests sent with `environment: "staging"`.

**How it works**
- `POST /world/rp-signature` (backend) returns the public World config plus a fresh RP
  signature (`rp_context`). The RP signing key never leaves the backend.
- The `Verification` screen opens `IDKitRequestWidget` with that config and forwards the
  full IDKit result to the backend as `X-Selfie-Check-Proof` when publishing / registering.
- The backend forwards the result as-is to World's v4 verify endpoint and derives the
  provider / agent id from the returned nullifier. Legacy IDKit 1.x proofs are still
  accepted via the v1 endpoint.

**Portal setup (once)**
1. Developer Portal → your app → *World ID Configuration* → **Register relying party**.
   Copy `app_id`, `rp_id` and the signing key (shown once).
2. Create the action `publish-service`. The dashboard creates it in **production**;
   for Simulator testing also create it in **staging** through the Developer Portal MCP
   (`create_world_id_action` with `environment: "staging"`).
3. `backend/.env`: `WORLD_APP_ID`, `WORLD_ACTION`, `WORLD_RP_ID`, `RP_SIGNING_KEY`, and
   `WORLD_ENVIRONMENT=staging` (Simulator) or `production` (real World App).
   The frontend needs no World env vars.

---

## Team

Built by a five-person team for ETHOnline 2026:

- **Member 1** — Hedera & Payments (x402 gate, Blocky402 settlement, HCS audit)
- **Member 2** — Backend & Services (API, registry, metering, Bazantic gateway)
- **Member 3** — AI Agent (autonomous discover→pay→consume loop, event stream)
- **Member 4** — Identity & World (Selfie Check, AgentKit/AgentBook)
- **Member 5** — Frontend, Demo & Docs (dashboard, monitor, video)

---

## Further docs

- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — frozen integration shapes
- [`docs/PAYMENTS.md`](docs/PAYMENTS.md) — x402 flow, HCS, verified payment, reproduce guide
- [`docs/AI_USAGE.md`](docs/AI_USAGE.md) — AI-tool usage attribution
- [`agent/README.md`](agent/README.md) — agent module detail
- [`backend/openapi.yaml`](backend/openapi.yaml) — OpenAPI spec (Bazantic gateway)

---

*Hedera Testnet · World ID Sandbox · x402 v2 / Blocky402. AI-assisted development is
disclosed in [`docs/AI_USAGE.md`](docs/AI_USAGE.md).*
