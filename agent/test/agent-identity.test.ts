/**
 * Tests for agent identity registration (Member 4).
 *
 * The agent no longer invents its own id — it registers with the backend
 * using its human owner's World proof and receives a backend-issued agentId.
 * These tests mock global fetch to exercise that flow.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { registerAgentWithBackend } from "../src/agent-identity.js";

const realFetch = globalThis.fetch;

describe("Agent Identity", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns a human-backed identity when the backend accepts the proof", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 201,
      json: async () => ({ agentId: "agent_00000000deadbeef" }),
    })) as unknown as typeof fetch;

    const identity = await registerAgentWithBackend("http://backend", "proof-json");

    assert.strictEqual(identity.agentId, "agent_00000000deadbeef");
    assert.strictEqual(identity.isHumanBacked, true);
  });

  it("returns a non-backed identity when the backend rejects the proof", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    })) as unknown as typeof fetch;

    const identity = await registerAgentWithBackend("http://backend", "bad-proof");

    assert.strictEqual(identity.agentId, "");
    assert.strictEqual(identity.isHumanBacked, false);
  });

  it("returns a non-backed identity when the backend omits an agentId", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 201,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const identity = await registerAgentWithBackend("http://backend", "proof-json");

    assert.strictEqual(identity.isHumanBacked, false);
  });

  it("sends the proof in the X-Selfie-Check-Proof header", async () => {
    let sentHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
      sentHeaders = init.headers;
      return {
        ok: true,
        status: 201,
        json: async () => ({ agentId: "agent_00000000deadbeef" }),
      };
    }) as unknown as typeof fetch;

    await registerAgentWithBackend("http://backend", "my-proof");

    assert.strictEqual(sentHeaders?.["X-Selfie-Check-Proof"], "my-proof");
  });
});
