/**
 * World ID 4.0 relying-party (RP) helpers.
 *
 * World ID 4.0 requires every proof request to be signed server-side with the
 * RP signing key issued by the Developer Portal. The frontend asks this
 * backend for a fresh signature right before opening IDKit, and never sees
 * the key itself.
 *
 * Env:
 *   WORLD_APP_ID       app_...   (Developer Portal > World ID Configuration)
 *   WORLD_RP_ID        rp_...    (same page)
 *   WORLD_ACTION       action identifier, e.g. "publish-service"
 *   WORLD_ENVIRONMENT  "staging" (simulator.worldcoin.org) | "production" (World App)
 *   RP_SIGNING_KEY     0x-prefixed hex private key — SECRET, shown once by the portal
 */

import { signRequest } from "@worldcoin/idkit-core/signing";

export type WorldEnvironment = "production" | "staging";

export interface WorldRpConfig {
  appId: string;
  rpId: string;
  action: string;
  environment: WorldEnvironment;
}

/** Public World ID configuration the frontend needs to open IDKit. */
export function getWorldRpConfig(): WorldRpConfig {
  const env = (process.env.WORLD_ENVIRONMENT ?? "production").toLowerCase();
  return {
    appId: process.env.WORLD_APP_ID ?? "",
    rpId: process.env.WORLD_RP_ID ?? "",
    action: process.env.WORLD_ACTION ?? "publish-service",
    environment: env === "staging" ? "staging" : "production",
  };
}

/** True when the backend is configured for World ID 4.0 (RP id + signing key). */
export function isWorldV4Configured(): boolean {
  const { rpId } = getWorldRpConfig();
  return rpId.startsWith("rp_") && Boolean(process.env.RP_SIGNING_KEY);
}

/** RP signature payload in the wire shape IDKit expects for `rp_context`. */
export interface RpSignaturePayload {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/**
 * Sign a proof request for the configured action.
 * Throws if the RP signing key or RP id is missing.
 */
export function signRpRequest(action: string): RpSignaturePayload {
  const signingKeyHex = process.env.RP_SIGNING_KEY;
  const { rpId } = getWorldRpConfig();
  if (!signingKeyHex || !rpId) {
    throw new Error("WORLD_RP_ID and RP_SIGNING_KEY must be set for World ID 4.0");
  }
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex, action });
  return { rp_id: rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig };
}
