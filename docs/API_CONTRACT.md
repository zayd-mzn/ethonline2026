# Integration API Contract

Freeze these shapes early so payment, backend, agent, identity, and frontend work can proceed in parallel. Changes require team agreement.

## Service registry entry

```ts
type QueryType = "ip" | "hash";

interface Service {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  priceHbar: number;
  providerId: string;
  queryType: QueryType;
}
```

### `GET /marketplace/services`

Returns discoverable services.

```json
{
  "services": [{
    "id": "svc_ip_01",
    "name": "IP Reputation",
    "description": "Threat confidence for an IP address",
    "endpoint": "/api/ip-reputation",
    "priceHbar": 0.01,
    "providerId": "0.0.7124901",
    "queryType": "ip"
  }]
}
```

### `POST /marketplace/services`

Publishes a provider service. Requires a valid World ID proof, sent in the
`X-Selfie-Check-Proof` header (not the body) as the JSON-stringified IDKit result.

```json
{
  "name": "IP Reputation",
  "description": "Threat confidence for an IP address",
  "endpoint": "https://provider.example/intel",
  "priceHbar": 0.01,
  "queryType": "ip"
}
```

Responses: `201` created, `400` invalid input, `401` invalid identity proof, `409` duplicate endpoint.

## World ID 4.0 verification

The backend owns the World config and the RP signing key; the frontend fetches a
signed request just before opening IDKit, then sends the resulting proof back as a
header when publishing / registering an agent.

### `POST /world/rp-signature`

Returns the public World config plus a fresh, server-signed relying-party context.

```json
{
  "app_id": "app_e2c0af203369e1d934c1782a8abd051a",
  "action": "publish-service",
  "environment": "staging",
  "rp_context": {
    "rp_id": "rp_947aa566a5ef35bc",
    "nonce": "0x...",
    "created_at": 1789135789,
    "expires_at": 1789136089,
    "signature": "0x..."
  }
}
```

Responses: `200` config + signature, `503 world_not_configured` if `WORLD_RP_ID` /
`RP_SIGNING_KEY` are unset. The frontend forwards the full IDKit result as the
`X-Selfie-Check-Proof` header; the backend verifies it at
`POST https://developer.world.org/api/v4/verify/{rp_id}` (legacy IDKit 1.x proofs are
still accepted via the v1 endpoint).

## Gated intelligence endpoints

- `GET /api/ip-reputation?ip=<address>` → `{ ip, malicious, score }`
- `GET /api/hash-check?hash=<hash>` → `{ hash, detections, verdict }`

### `402 Payment Required`

```ts
interface PaymentRequired {
  amountHbar: number;
  recipient: string;
  facilitator: "blocky402";
  requestId: string;
}
```

```json
{
  "amountHbar": 0.01,
  "recipient": "0.0.7124901",
  "facilitator": "blocky402",
  "requestId": "req_01K4..."
}
```

## Agent activity stream

Prefer SSE for a one-way demo stream unless Member 3 needs bidirectional WebSockets.

```ts
type ActivityStage = "discover" | "call" | "402" | "paying" | "paid" | "data";

interface ActivityEvent {
  ts: number;
  stage: ActivityStage;
  detail: string;
}
```

Suggested endpoint: `GET /agent/events` with `text/event-stream`.

## Open integration decisions

- Authentication/session format for providers
- x402 payment headers versus JSON body
- Agent event transport (SSE versus WebSocket)
- HCS audit response fields (`topicId`, transaction ID, HashScan URL)
- Error envelope shared across endpoints

## Resolved decisions

- **World proof payload & verification** — resolved with World ID 4.0. The IDKit result
  is sent verbatim in the `X-Selfie-Check-Proof` header and verified at
  `/api/v4/verify/{rp_id}`; the request is signed server-side (see `POST /world/rp-signature`).
