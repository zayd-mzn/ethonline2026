/**
 * Agent identity module using World AgentKit (Member 4)
 * 
 * Handles agent registration and World ID integration so the agent
 * can be verified as human-backed before making transactions.
 */

import crypto from "node:crypto";

export interface AgentIdentity {
  agentId: string;
  worldIdProof?: string;
  isHumanBacked: boolean;
}

/**
 * Registers an agent with a World ID proof.
 * 
 * In production, this would:
 * 1. Prompt the human owner to verify via World ID
 * 2. Register the agent in AgentBook with the proof
 * 3. Return the agent identity
 * 
 * For the hackathon, we create a deterministic agent ID from
 * the Hedera account (assuming the account owner has verified separately).
 */
export async function registerAgent(
  accountId: string,
  worldIdProof?: string
): Promise<AgentIdentity> {
  // Generate a stable agent ID from the Hedera account
  const agentHash = crypto
    .createHash("sha256")
    .update(accountId)
    .digest("hex")
    .substring(0, 16);
  
  const agentId = `agent_${agentHash}`;

  // In production: submit to AgentBook and verify the World ID proof
  // For hackathon: assume the agent is backed if proof is provided
  const isHumanBacked = !!worldIdProof;

  return {
    agentId,
    worldIdProof,
    isHumanBacked,
  };
}

/**
 * Verifies the agent's human backing status with the backend.
 */
export async function verifyAgentBacking(
  agentId: string,
  backendUrl: string
): Promise<boolean> {
  try {
    // For hackathon: backend accepts well-formed agent IDs
    // In production: this would query AgentBook via the backend
    return agentId.startsWith("agent_") && /^agent_[0-9a-f]{16}$/i.test(agentId);
  } catch (err) {
    console.error("Error verifying agent backing:", err);
    return false;
  }
}
