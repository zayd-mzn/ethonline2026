/**
 * Agent human-backing gate — Member 4 / identity deliverable.
 *
 * Runs as a Fastify preHandler BEFORE the payment gate on protected routes.
 * An unverified agent is rejected with 403 before any price is quoted or any
 * payment is attempted, so the request path actually enforces agent identity
 * (closing the "no route rejects unverified agents" gap).
 *
 * Wire protocol:
 *   - Agent sends its identity in the `X-Agent-Id` header (format: agent_<hex>).
 *   - The gate calls IdentityVerifier.resolveAgentBacking(agentId).
 *   - Backed  → let the request continue to the payment gate.
 *   - Missing / not backed → 403 { error: "agent_not_verified" }.
 *
 * Enforcement is opt-in via REQUIRE_AGENT_BACKING so local/demo runs
 * (stub payments, no creds) stay frictionless:
 *   - REQUIRE_AGENT_BACKING unset/"false" → gate is a no-op (dev bypass).
 *   - REQUIRE_AGENT_BACKING="true"        → gate enforces backing.
 *
 * NOTE (honesty): resolveAgentBacking currently validates the agentId format,
 * not real World/AgentBook humanity. This gate therefore enforces the presence
 * and shape of a registered agent identity at the edge; swapping in real
 * AgentBook resolution behind the same seam upgrades it with zero route changes.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdentityVerifier } from "./types.js";

/** Header the agent uses to present its identity. */
export const AGENT_ID_HEADER = "x-agent-id";

/** Whether agent-backing enforcement is switched on. Defaults to off. */
export function agentBackingRequired(): boolean {
  return (process.env.REQUIRE_AGENT_BACKING ?? "false").toLowerCase() === "true";
}

/**
 * Create a Fastify preHandler that gates a route behind agent human-backing.
 * No-op when REQUIRE_AGENT_BACKING is not "true".
 */
export function agentGate(identity: IdentityVerifier) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Dev bypass: enforcement disabled → let everything through.
    if (!agentBackingRequired()) return;

    const raw = request.headers[AGENT_ID_HEADER];
    const agentId = Array.isArray(raw) ? raw[0] : raw;

    if (typeof agentId !== "string" || agentId.length === 0) {
      await reply.code(403).send({
        error: "agent_not_verified",
        message: `Missing ${AGENT_ID_HEADER} header — agent identity is required`,
      });
      return;
    }

    const backed = await identity.resolveAgentBacking(agentId);
    if (!backed) {
      await reply.code(403).send({
        error: "agent_not_verified",
        message: "Agent is not a verified human-backed identity",
      });
      return;
    }

    // Backed → fall through to the payment gate / route handler.
  };
}
