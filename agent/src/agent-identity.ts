/**
 * Agent identity module (Member 4).
 *
 * The agent must be backed by a real, verified human for accountability: if
 * the agent misbehaves, its id resolves back to exactly one World-verified
 * person. To get that, the human owner verifies with World once and the agent
 * registers with the backend, which ties the agentId to the human's
 * nullifier_hash and returns the id.
 *
 * The agentId is NOT invented locally — it is issued by the backend from the
 * human's World proof. This is what makes the human↔agent link trustworthy.
 */

export interface AgentIdentity {
  agentId: string;
  isHumanBacked: boolean;
}

/**
 * Register the agent with the backend using its human owner's World proof.
 *
 * The proof is the JSON World Selfie Check result the human produced (via the
 * World app / MiniKit). The backend verifies it, derives the agentId from the
 * human's nullifier_hash, stores the link, and returns the id.
 *
 * Throws on a network error; returns a non-backed identity if the backend
 * rejects the proof.
 */
export async function registerAgentWithBackend(
  backendUrl: string,
  worldProof: string,
): Promise<AgentIdentity> {
  const res = await fetch(`${backendUrl}/agents/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Selfie-Check-Proof": worldProof,
    },
  });

  if (!res.ok) {
    return { agentId: "", isHumanBacked: false };
  }

  const body = (await res.json()) as { agentId?: string };
  if (!body.agentId) {
    return { agentId: "", isHumanBacked: false };
  }

  return { agentId: body.agentId, isHumanBacked: true };
}
