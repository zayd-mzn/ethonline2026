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

## Deployment

Hosted on **Vercel** (static build): <https://ethonline-dun.vercel.app/>. Vercel runs
`npm ci` + `npm run build` and rewrites same-origin API paths to the Railway backend/agent
(see `vercel.json`), so no CORS config is needed. Leave `VITE_BACKEND_URL` / `VITE_AGENT_URL`
unset in production so calls stay same-origin and the rewrites apply. Set
`VITE_WALLETCONNECT_PROJECT_ID` for the HashPack funding flow. See the root README's
[Live demo & deployment](../README.md#live-demo--deployment) section for the full picture.
