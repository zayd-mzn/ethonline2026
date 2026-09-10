# CIM Frontend — Cyber Intel Marketplace

React + Vite dashboard for CIM: marketplace directory, live agent monitor,
provider console, World Selfie Check flow, and the HashPack "fund agent" view.

## Run

```bash
pnpm install
pnpm dev
```

Open the URL printed by Vite (default `http://localhost:5173`). API calls are
proxied to the backend (`:3001`) and agent event stream (`:3002`) — see
`vite.config.ts`.

## Views

- Marketplace directory and operational metrics
- Live agent payment monitor (with live agent balance)
- Provider publishing console
- World Selfie Check demo flow
- Fund agent (HashPack / WalletConnect, one-time funding)
