/**
 * Real identity verifier using World Selfie Check and AgentKit (Member 4)
 *
 * Replaces identity.stub.ts. Implements the same IdentityVerifier interface
 * so callers need zero changes.
 */

import type { IdentityVerifier } from "./types.js";
import { upsertAgent, isAgentRegistered } from "./registry.js";
import crypto from "node:crypto";
import { getWorldRpConfig } from "./worldRp.js";

// World ID app credentials from environment
const WORLD_APP_ID = process.env.WORLD_APP_ID ?? "";
const WORLD_ACTION = process.env.WORLD_ACTION ?? "publish-service";

/** Result of verifying a World proof: the unique per-human nullifier. */
interface ProofVerification {
  success: boolean;
  nullifier_hash?: string;
}

/** Looks like an IDKit 4.x result (protocol_version + responses[]). */
function isIdKitV4Result(proof: unknown): proof is {
  protocol_version: string;
  responses: Array<{ nullifier?: string; session_nullifier?: string[] }>;
} {
  return (
    typeof proof === "object" &&
    proof !== null &&
    typeof (proof as { protocol_version?: unknown }).protocol_version === "string" &&
    Array.isArray((proof as { responses?: unknown }).responses)
  );
}

/**
 * Verify an IDKit 4.x result against World ID 4.0:
 * POST https://developer.world.org/api/v4/verify/{rp_id}
 *
 * The payload is forwarded exactly as IDKit returned it (World requires no
 * remapping). Works for both 4.0 proofs and legacy 3.0 proofs produced with
 * `allow_legacy_proofs`.
 */
async function verifyWorldV4(proof: {
  protocol_version: string;
  responses: Array<{ nullifier?: string; session_nullifier?: string[] }>;
}): Promise<ProofVerification> {
  const { rpId } = getWorldRpConfig();
  if (!rpId) {
    console.error("World ID 4.0 verification skipped: WORLD_RP_ID is not set");
    return { success: false };
  }

  const response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof),
    signal: AbortSignal.timeout(15000),
  });

  const result = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    code?: string;
    detail?: string;
    results?: Array<{ identifier?: string; success?: boolean; nullifier?: string }>;
  };

  if (!response.ok || !result.success) {
    console.error(
      `World ID 4.0 verification failed (${response.status}): ${result.code ?? "unknown"} — ${result.detail ?? ""}`,
    );
    return { success: false };
  }

  // Prefer the nullifier World confirmed; fall back to the one in the proof.
  const confirmed = result.results?.find((r) => r.success && r.nullifier)?.nullifier;
  const fromProof =
    proof.responses[0]?.nullifier ?? proof.responses[0]?.session_nullifier?.[0];
  const nullifier = confirmed ?? fromProof;
  if (!nullifier) {
    console.error("World ID 4.0 verification succeeded but no nullifier was returned");
    return { success: false };
  }
  return { success: true, nullifier_hash: nullifier };
}

/**
 * Verify a legacy (IDKit 1.x/2.x) proof against the World ID 3.0 cloud API:
 * POST https://developer.worldcoin.org/api/v1/verify/{app_id}
 */
async function verifyWorldLegacy(proof: {
  merkle_root: string;
  nullifier_hash: string;
  proof: string;
  verification_level?: string;
}): Promise<ProofVerification> {
  const verifyEndpoint = "https://developer.worldcoin.org/api/v1/verify";
  const verifyPayload = {
    merkle_root: proof.merkle_root,
    nullifier_hash: proof.nullifier_hash,
    proof: proof.proof,
    verification_level: proof.verification_level || "device",
    action: WORLD_ACTION,
    signal: "",
  };

  const response = await fetch(`${verifyEndpoint}/${WORLD_APP_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verifyPayload),
  });

  if (!response.ok) {
    console.error("World ID verification failed:", await response.text());
    return { success: false };
  }

  const result = (await response.json()) as { success?: boolean };
  return result.success
    ? { success: true, nullifier_hash: proof.nullifier_hash }
    : { success: false };
}

/**
 * Verifies a World proof captured by IDKit in the frontend.
 *
 * Accepts two wire formats:
 * - IDKit 4.x result (`protocol_version`, `responses[]`) → World ID 4.0 verify.
 * - Legacy IDKit result (`merkle_root`, `nullifier_hash`, `proof`) → v1 verify.
 *
 * Both resolve to the human's nullifier, which is what provider and agent
 * identities are derived from.
 */
async function verifySelfieCheckProof(proofString: string): Promise<ProofVerification> {
  try {
    const proof: unknown = JSON.parse(proofString);

    if (isIdKitV4Result(proof)) {
      return await verifyWorldV4(proof);
    }

    const legacy = proof as {
      merkle_root?: string;
      nullifier_hash?: string;
      proof?: string;
      verification_level?: string;
    };
    if (!legacy.merkle_root || !legacy.nullifier_hash || !legacy.proof) {
      return { success: false };
    }
    return await verifyWorldLegacy({
      merkle_root: legacy.merkle_root,
      nullifier_hash: legacy.nullifier_hash,
      proof: legacy.proof,
      verification_level: legacy.verification_level,
    });
  } catch (err) {
    console.error("Error verifying World proof:", err);
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
   * Register an agent by verifying its human owner's World Selfie Check proof.
   *
   * This is the accountability link: the human verifies with World, we take
   * their unique nullifier_hash, derive a stable agentId from it, and persist
   * the agentId → nullifier_hash pair. If the agent later misbehaves, the
   * agentId resolves back to exactly one verified human.
   *
   * The nullifier_hash is one-per-human, so one human maps to one agentId
   * (re-registering is idempotent).
   */
  async registerAgentWithProof(proof: string): Promise<{ agentId: string } | null> {
    const result = await verifySelfieCheckProof(proof);

    if (!result.success || !result.nullifier_hash) {
      return null;
    }

    // Derive a stable agentId from the human's nullifier_hash. Same human →
    // same agentId, so the link is deterministic and one-per-human.
    const agentId = `agent_${crypto
      .createHash("sha256")
      .update(result.nullifier_hash)
      .digest("hex")
      .substring(0, 16)}`;

    // Persist the human↔agent link (idempotent, survives restarts).
    upsertAgent(agentId, result.nullifier_hash);

    return { agentId };
  },

  /**
   * Resolve whether an agent is backed by a verified human.
   *
   * Checks the persistent agent registry: an agentId is backed only if it was
   * created by registerAgentWithProof (i.e. a real human verified with World).
   * A well-formed but unregistered id is NOT backed — closing the gap where
   * any made-up agent_<hash> string used to pass.
   */
  async resolveAgentBacking(agentId: string): Promise<boolean> {
    if (!agentId.startsWith("agent_")) {
      return false;
    }
    return isAgentRegistered(agentId);
  },
};
