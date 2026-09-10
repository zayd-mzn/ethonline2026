/**
 * Tests for the agent human-backing gate (agentGate preHandler).
 *
 * Exercises the preHandler directly with a mock Fastify reply and a mock
 * IdentityVerifier — no server boot required.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { agentGate, AGENT_ID_HEADER, agentBackingRequired } from "../src/agentGate.js";
import type { IdentityVerifier } from "../src/types.js";

/** Minimal mock of the bits of FastifyReply the gate touches. */
function mockReply() {
  const state: { statusCode?: number; payload?: unknown } = {};
  const reply = {
    code(status: number) {
      state.statusCode = status;
      return reply;
    },
    async send(payload: unknown) {
      state.payload = payload;
      return reply;
    },
  };
  return { reply, state };
}

/** Mock request with the given headers. */
function mockRequest(headers: Record<string, string | string[]>) {
  return { headers } as unknown as Parameters<ReturnType<typeof agentGate>>[0];
}

/** Verifier whose resolveAgentBacking answer is configurable. */
function verifierReturning(backed: boolean): IdentityVerifier {
  return {
    async verifySelfieCheck() {
      return null;
    },
    async resolveAgentBacking() {
      return backed;
    },
  };
}

describe("agentGate", () => {
  const original = process.env.REQUIRE_AGENT_BACKING;

  beforeEach(() => {
    delete process.env.REQUIRE_AGENT_BACKING;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REQUIRE_AGENT_BACKING;
    else process.env.REQUIRE_AGENT_BACKING = original;
  });

  describe("dev bypass (enforcement off)", () => {
    it("is off by default", () => {
      assert.strictEqual(agentBackingRequired(), false);
    });

    it("lets any request through when REQUIRE_AGENT_BACKING is unset", async () => {
      const gate = agentGate(verifierReturning(false));
      const { reply, state } = mockReply();
      await gate(mockRequest({}), reply as never);
      assert.strictEqual(state.statusCode, undefined, "should not reply — request continues");
    });

    it('lets any request through when REQUIRE_AGENT_BACKING="false"', async () => {
      process.env.REQUIRE_AGENT_BACKING = "false";
      const gate = agentGate(verifierReturning(false));
      const { reply, state } = mockReply();
      await gate(mockRequest({}), reply as never);
      assert.strictEqual(state.statusCode, undefined);
    });
  });

  describe("enforcement on", () => {
    beforeEach(() => {
      process.env.REQUIRE_AGENT_BACKING = "true";
    });

    it("reports enforcement enabled", () => {
      assert.strictEqual(agentBackingRequired(), true);
    });

    it("rejects with 403 when the agent id header is missing", async () => {
      const gate = agentGate(verifierReturning(true));
      const { reply, state } = mockReply();
      await gate(mockRequest({}), reply as never);
      assert.strictEqual(state.statusCode, 403);
      assert.strictEqual((state.payload as { error: string }).error, "agent_not_verified");
    });

    it("rejects with 403 when the agent is not backed", async () => {
      const gate = agentGate(verifierReturning(false));
      const { reply, state } = mockReply();
      await gate(
        mockRequest({ [AGENT_ID_HEADER]: "agent_00000000deadbeef" }),
        reply as never,
      );
      assert.strictEqual(state.statusCode, 403);
      assert.strictEqual((state.payload as { error: string }).error, "agent_not_verified");
    });

    it("lets a backed agent through", async () => {
      const gate = agentGate(verifierReturning(true));
      const { reply, state } = mockReply();
      await gate(
        mockRequest({ [AGENT_ID_HEADER]: "agent_00000000deadbeef" }),
        reply as never,
      );
      assert.strictEqual(state.statusCode, undefined, "should not reply — request continues");
    });

    it("handles a header delivered as an array (takes the first value)", async () => {
      const gate = agentGate(verifierReturning(true));
      const { reply, state } = mockReply();
      await gate(
        mockRequest({ [AGENT_ID_HEADER]: ["agent_00000000deadbeef", "extra"] }),
        reply as never,
      );
      assert.strictEqual(state.statusCode, undefined);
    });
  });
});
