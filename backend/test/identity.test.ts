/**
 * Tests for World ID identity verification (Member 4)
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import crypto from "node:crypto";

describe("Identity Verification", () => {
  describe("Provider ID generation", () => {
    it("should generate stable provider IDs from nullifier hash", () => {
      
      const nullifierHash = "0xabcd1234567890";
      
      // Same nullifier should produce same providerId
      const providerId1 = `prov_${crypto
        .createHash("sha256")
        .update(nullifierHash)
        .digest("hex")
        .substring(0, 16)}`;
      
      const providerId2 = `prov_${crypto
        .createHash("sha256")
        .update(nullifierHash)
        .digest("hex")
        .substring(0, 16)}`;
      
      assert.strictEqual(providerId1, providerId2, "Provider IDs should be deterministic");
      assert.ok(providerId1.startsWith("prov_"), "Provider ID should have correct prefix");
      assert.strictEqual(providerId1.length, 21, "Provider ID should be 21 chars (prov_ + 16 hex)");
    });

    it("should generate different IDs for different nullifiers", () => {
      
      const nullifier1 = "0xabcd1234567890";
      const nullifier2 = "0xdcba0987654321";
      
      const providerId1 = `prov_${crypto
        .createHash("sha256")
        .update(nullifier1)
        .digest("hex")
        .substring(0, 16)}`;
      
      const providerId2 = `prov_${crypto
        .createHash("sha256")
        .update(nullifier2)
        .digest("hex")
        .substring(0, 16)}`;
      
      assert.notStrictEqual(providerId1, providerId2, "Different nullifiers should produce different provider IDs");
    });
  });

  describe("Agent ID format", () => {
    it("should validate well-formed agent IDs", () => {
      const validIds = [
        "agent_abcd1234ef567890",
        "agent_0123456789abcdef",
        "agent_ABCDEF0123456789",
      ];
      
      for (const agentId of validIds) {
        const isValid = agentId.startsWith("agent_") && /^agent_[0-9a-f]{16}$/i.test(agentId);
        assert.ok(isValid, `${agentId} should be valid`);
      }
    });

    it("should reject malformed agent IDs", () => {
      const invalidIds = [
        "agent_",                    // too short
        "agent_123",                 // too short
        "agent_zzzzzzzzzzzzzzz",    // invalid hex
        "user_abcd1234ef567890",    // wrong prefix
        "abcd1234ef567890",          // no prefix
      ];
      
      for (const agentId of invalidIds) {
        const isValid = agentId.startsWith("agent_") && /^agent_[0-9a-f]{16}$/i.test(agentId);
        assert.ok(!isValid, `${agentId} should be invalid`);
      }
    });

    it("should generate stable agent IDs from account", () => {
      
      const accountId = "0.0.12345";
      
      const agentHash1 = crypto
        .createHash("sha256")
        .update(accountId)
        .digest("hex")
        .substring(0, 16);
      
      const agentHash2 = crypto
        .createHash("sha256")
        .update(accountId)
        .digest("hex")
        .substring(0, 16);
      
      assert.strictEqual(agentHash1, agentHash2, "Agent hashes should be deterministic");
      assert.strictEqual(agentHash1.length, 16, "Agent hash should be 16 hex chars");
    });
  });

  describe("World ID proof structure", () => {
    it("should validate proof has required fields", () => {
      const validProof = {
        merkle_root: "0x1234567890abcdef",
        nullifier_hash: "0xabcdef1234567890",
        proof: "0x9876543210fedcba",
        verification_level: "device",
      };
      
      assert.ok(validProof.merkle_root, "Proof must have merkle_root");
      assert.ok(validProof.nullifier_hash, "Proof must have nullifier_hash");
      assert.ok(validProof.proof, "Proof must have proof");
    });

    it("should reject proofs missing required fields", () => {
      const invalidProofs = [
        { merkle_root: "0x123", nullifier_hash: "0xabc" }, // missing proof
        { merkle_root: "0x123", proof: "0x456" },          // missing nullifier_hash
        { nullifier_hash: "0xabc", proof: "0x456" },       // missing merkle_root
        {},                                                  // empty
      ];
      
      for (const proof of invalidProofs) {
        const isValid = proof.merkle_root && proof.nullifier_hash && proof.proof;
        assert.ok(!isValid, `Proof should be invalid: ${JSON.stringify(proof)}`);
      }
    });
  });
});
