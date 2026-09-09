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

Publishes a provider service. Requires a valid Selfie Check proof.

```json
{
  "name": "IP Reputation",
  "description": "Threat confidence for an IP address",
  "endpoint": "https://provider.example/intel",
  "priceHbar": 0.01,
  "queryType": "ip",
  "selfieProof": "world-proof-placeholder"
}
```

Responses: `201` created, `400` invalid input, `401` invalid identity proof, `409` duplicate endpoint.

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
- Exact World proof payload and verification response
- x402 payment headers versus JSON body
- Agent event transport (SSE versus WebSocket)
- HCS audit response fields (`topicId`, transaction ID, HashScan URL)
- Error envelope shared across endpoints
