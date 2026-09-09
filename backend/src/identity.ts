/**
 * Real identity verifier using World Selfie Check and AgentKit (Member 4)
 *
 * Replaces identity.stub.ts. Implements the same IdentityVerifier interface
 * so callers need zero changes.
 */

import type { IdentityVerifier } from "./types.js";
import crypto from "node:crypto";

// World ID app credentials from environment
const WORLD_APP_ID = process.env.WORLD_APP_ID ?? "";
const WORLD_ACTION = process.env.WORLD_ACTION ?? "publish-service";

/**
 * Verifies a World Selfie Check proof.
 * 
 * The proof is expected to be a JSON string containing:
 * - merkle_root: The root of the merkle tree
 * - nullifier_hash: Unique identifier preventing double-verification
 * - proof: The zero-knowledge proof
 * - verification_level: "orb" or "device"
 * 
 * In production, this calls the World ID verification API.
 * For Sandbox testing, use the Sandbox App credentials.
 */
async function verifySelfieCheckProof(proofString: string): Promise<{ success: boolean; nullifier_hash?: string }> {
  try {
    const proof = JSON.parse(proofString);
    
    // Required fields from World Selfie Check
    if (!proof.merkle_root || !proof.nullifier_hash || !proof.proof) {
      return { success: false };
    }

    // World ID verification endpoint
    const verifyEndpoint = "https://developer.worldcoin.org/api/v1/verify";
    
    const verifyPayload = {
      merkle_root: proof.merkle_root,
      nullifier_hash: proof.nullifier_hash,
      proof: proof.proof,
      verification_level: proof.verification_level || "device",
      action: WORLD_ACTION,
      signal: "",  // Empty for Selfie Check (no additional data)
    };

    const response = await fetch(`${verifyEndpoint}/${WORLD_APP_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(verifyPayload),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("World ID verification failed:", error);
      return { success: false };
    }

    const result = await response.json();
    
    if (result.success) {
      return { 
        success: true, 
        nullifier_hash: proof.nullifier_hash 
      };
    }

    return { success: false };
  } catch (err) {
    console.error("Error verifying Selfie Check proof:", err);
    return { success: false };
  }
}

/**
 * In-memory storage for verified providers.
 * In production, this should be persisted to the database.
 */
const verifiedProviders = new Map<string, string>(); // nullifier_hash -> providerId

export const worldIdentity: IdentityVerifier = {
  /**
   * Verify a World Selfie Check proof and return a stable provider ID.
   * The nullifier_hash ensures one provider ID per human.
   */
  async verifySelfieCheck(proof: string): Promise<{ providerId: string } | null> {
    const result = await verifySelfieCheckProof(proof);
    
    if (!result.success || !result.nullifier_hash) {
      return null;
    }

    // Check if this human has already been verified (idempotency)
    let providerId = verifiedProviders.get(result.nullifier_hash);
    
    if (!providerId) {
      // Generate a stable, unique provider ID from the nullifier hash
      providerId = `prov_${crypto
        .createHash("sha256")
        .update(result.nullifier_hash)
        .digest("hex")
        .substring(0, 16)}`;
      
      verifiedProviders.set(result.nullifier_hash, providerId);
    }

    return { providerId };
  },

  /**
   * Resolve whether an agent is backed by a verified human via AgentBook.
   * 
   * For the hackathon, agents register their World ID in the agentId format:
   * "agent_<nullifier_hash_prefix>"
   * 
   * In production, this would query the AgentBook registry on-chain or via API.
   */
  async resolveAgentBacking(agentId: string): Promise<boolean> {
    // Accept agent IDs in format: agent_<hash> where hash comes from World ID
    if (!agentId.startsWith("agent_")) {
      return false;
    }

    // For hackathon: if it has the right format, consider it backed
    // In production: verify against AgentBook registry
    const agentHash = agentId.slice(6); // Remove "agent_" prefix
    
    // Basic validation: hash should be hexadecimal and reasonable length
    if (!/^[0-9a-f]{16,64}$/i.test(agentHash)) {
      return false;
    }

    // TODO: Query AgentBook when World provides the API/contract
    // For now, accept well-formed agent IDs as human-backed
    return true;
  },
};
