/**
 * Stub identity verifier — stands in for Member 4's real Selfie Check
 * integration until it lands. Implements the IdentityVerifier seam.
 *
 * DEV ONLY: accepts a fixed dev proof so publishing can be tested end-to-end.
 * Real implementation swaps in without changing callers.
 */

import type { IdentityVerifier } from "./types.js";
import { upsertAgent, isAgentRegistered } from "./registry.js";

const DEV_PROOF = "dev-selfie-proof";

export const stubIdentity: IdentityVerifier = {
  async verifySelfieCheck(proof: string) {
    if (proof === DEV_PROOF) {
      return { providerId: `prov_${Date.now().toString(36)}` };
    }
    return null;
  },
  async registerAgentWithProof(proof: string) {
    // Dev: the dev proof registers a fixed, deterministic agent so the
    // human↔agent link can be exercised without a real World verification.
    if (proof !== DEV_PROOF) return null;
    const agentId = "agent_devdevdevdevdev0";
    upsertAgent(agentId, "dev-nullifier-hash");
    return { agentId };
  },
  async resolveAgentBacking(agentId: string) {
    return isAgentRegistered(agentId);
  },
};