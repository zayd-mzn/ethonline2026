# Payment Flow — Member 1 (Hedera & Payments)

## Overview

Every threat-intel query is pay-per-call using the **x402 protocol v2** on
Hedera testnet. The agent automatically pays before receiving data; no manual
steps are required. All payments are settled by the **Blocky402 facilitator**
and every transaction is permanently recorded on the **Hedera Consensus
Service (HCS)**.

---

## Accounts

| Role | Account ID | Purpose |
|---|---|---|
| Treasury | `0.0.10446679` | Receives HBAR payments from agents |
| Agent wallet | `0.0.10446789` | Pays for queries during the demo run |
| Blocky402 fee-payer | `0.0.7162784` | Co-signs transactions as facilitator |

---

## The Payment Flow (step by step)

```
Agent                    Backend                  Blocky402
  |                         |                         |
  |-- GET /api/ip-rep ------>|                         |
  |<-- 402 {x402Version:2,  |                         |
  |    accepts:[{amount,     |                         |
  |    payTo, feePayer}]} ---|                         |
  |                         |                         |
  |-- ExactHederaScheme signs TransferTransaction      |
  |-- POST /settle ---------------------------------->|
  |<-- {success:true, transaction:"0.0.7162784@..."} -|
  |                         |                         |
  |-- GET /api/ip-rep ------>|                         |
  |   X-PAYMENT: base64(...) |                         |
  |                         |-- POST /verify -------->|
  |                         |<-- {isValid:true} -------|
  |                         |-- logPayment (HCS) ----->Hedera
  |<-- 200 {ip, score} -----|                         |
```

### 1. Agent hits a gated endpoint
The backend replies `402 Payment Required` with an x402 v2 body:
```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "1000000",
    "payTo": "0.0.10446679",
    "asset": "0.0.0",
    "extra": { "feePayer": "0.0.7162784" }
  }]
}
```

### 2. Agent signs and settles via Blocky402
`@x402/hedera` `ExactHederaScheme` builds a partially-signed
`TransferTransaction`. The agent calls:
- `POST https://api.testnet.blocky402.com/verify` — pre-flight check
- `POST https://api.testnet.blocky402.com/settle` — Blocky402 co-signs as
  fee-payer and submits to Hedera

### 3. Agent retries with proof
The settled `paymentPayload` is base64-encoded and sent as `X-PAYMENT` header.

### 4. Backend verifies
The gate decodes the header and calls Blocky402 `/verify`. On `isValid: true`
it writes an HCS audit record and lets the route handler run.

---

## Proof Format

```
Header name:  X-PAYMENT
Value:        base64(JSON(paymentPayload))
```

Where `paymentPayload` is:
```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "hedera:testnet",
  "accepted": { ... payment requirements ... },
  "payload": { "transaction": "<base64 signed TransferTransaction>" }
}
```

---

## HCS Audit Trail

Every verified payment writes an immutable record to a Hedera Consensus
Service topic. Judges can verify the full payment trail without trusting
our server.

| | |
|---|---|
| **Topic ID** | `0.0.10449784` |
| **HashScan** | https://hashscan.io/testnet/topic/0.0.10449784 |
| **Network** | Hedera Testnet |

Each HCS message contains:
```json
{
  "requestId": "req_xxxxxxxx",
  "resource": "/api/ip-reputation",
  "amountHbar": 0.01,
  "payer": "0.0.10446789",
  "txId": "0.0.7162784@...",
  "timestamp": "2026-09-09T22:51:40.000Z"
}
```

---

## Prices

Prices are stored in the service registry (SQLite) and resolved at request
time — changing a price requires no code edit, just a DB update.

| Service | Endpoint | Price |
|---|---|---|
| IP Reputation Lookup | `/api/ip-reputation` | 0.01 HBAR |
| File Hash Check | `/api/hash-check` | 0.02 HBAR |

---

## Environment Variables

### Backend (`backend/.env`)
```
HEDERA_ACCOUNT_ID=0.0.10446679      # treasury account
HEDERA_PRIVATE_KEY=0x...            # treasury private key (HEX or DER)
HEDERA_RECIPIENT=0.0.10446679       # receives payments
HEDERA_NETWORK=testnet
BLOCKY402_URL=https://api.testnet.blocky402.com
```

### Agent (`agent/.env`)
```
HEDERA_ACCOUNT_ID=0.0.10446789      # agent wallet
HEDERA_PRIVATE_KEY=0x...            # agent private key (HEX or DER)
HEDERA_NETWORK=testnet
BLOCKY402_URL=https://api.testnet.blocky402.com
MAX_SPEND_HBAR=1.0                  # spend cap per run
```

---

## Key Files

| File | Purpose |
|---|---|
| `backend/src/paymentGate.ts` | Fastify preHandler — issues 402, verifies X-PAYMENT via Blocky402 |
| `backend/src/hcsLogger.ts` | Creates HCS topic at startup, writes audit record per payment |
| `backend/src/hederaClient.ts` | Shared Hedera SDK client singleton |
| `agent/src/payment.ts` | `Blocky402HederaPaymentClient` — signs + settles via Blocky402 |
| `agent/src/paid-request.ts` | 402 → pay → retry orchestration loop |
| `agent/src/wallet.ts` | Hedera wallet init, balance check, HEX/DER key parsing |
