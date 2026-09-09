/**
 * Tests for agent identity registration (Member 4)
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { registerAgent } from "../src/agent-identity.js";

describe("Agent Identity", () => {
  describe("registerAgent", () => {
    it("should generate a valid agent ID from Hedera account", async () => {
      const accountId = "0.0.12345";
      const identity = await registerAgent(accountId);
      
      assert.ok(identity.agentId.startsWith("agent_"), "Agent ID should have correct prefix");
      assert.strictEqual(identity.agentId.length, 22, "Agent ID should be 22 chars (agent_ + 16 hex)");
      assert.ok(/^agent_[0-9a-f]{16}$/i.test(identity.agentId), "Agent ID should match format");
    });

    it("should generate consistent IDs for the same account", async () => {
      const accountId = "0.0.12345";
      
      const identity1 = await registerAgent(accountId);
      const identity2 = await registerAgent(accountId);
      
      assert.strictEqual(identity1.agentId, identity2.agentId, "Same account should produce same agent ID");
    });

    it("should generate different IDs for different accounts", async () => {
      const identity1 = await registerAgent("0.0.12345");
      const identity2 = await registerAgent("0.0.67890");
      
      assert.notStrictEqual(identity1.agentId, identity2.agentId, "Different accounts should produce different agent IDs");
    });

    it("should mark agent as human-backed when proof is provided", async () => {
      const accountId = "0.0.12345";
      const worldIdProof = JSON.stringify({
        merkle_root: "0x123",
        nullifier_hash: "0xabc",
        proof: "0x456",
      });
      
      const identity = await registerAgent(accountId, worldIdProof);
      
      assert.strictEqual(identity.isHumanBacked, true, "Agent should be marked as human-backed");
      assert.strictEqual(identity.worldIdProof, worldIdProof, "World ID proof should be stored");
    });

    it("should mark agent as not human-backed when no proof provided", async () => {
      const accountId = "0.0.12345";
      const identity = await registerAgent(accountId);
      
      assert.strictEqual(identity.isHumanBacked, false, "Agent should not be marked as human-backed without proof");
      assert.strictEqual(identity.worldIdProof, undefined, "World ID proof should be undefined");
    });
  });
});
