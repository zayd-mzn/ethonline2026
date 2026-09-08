/**
 * Stub identity verifier — stands in for Member 4's real Selfie Check
 * integration until it lands. Implements the IdentityVerifier seam.
 *
 * DEV ONLY: accepts a fixed dev proof so publishing can be tested end-to-end.
 * Real implementation swaps in without changing callers.
 */

import type { IdentityVerifier } from "./types.js";

const DEV_PROOF = "dev-selfie-proof";

export const stubIdentity: IdentityVerifier = {
  async verifySelfieCheck(proof: string) {
    if (proof === DEV_PROOF) {
      return { providerId: `prov_${Date.now().toString(36)}` };
    }
    return null;
  },
  async resolveAgentBacking(_agentId: string) {
    return true; // dev: treat all agents as human-backed
  },
};