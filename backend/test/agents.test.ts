/**
 * Tests for the agent registry — the persistent human↔agent accountability
 * link. Uses a throwaway DB file so it never touches the real registry.
 *
 * DB_PATH is set before importing registry.ts because the module opens the
 * database at import time.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the registry at a temp DB before it is imported.
const tmpDir = mkdtempSync(join(tmpdir(), "cim-agents-"));
process.env.DB_PATH = join(tmpDir, "test-registry.db");

// Dynamic import so the DB_PATH override is in effect when the module loads.
const { upsertAgent, getAgent, isAgentRegistered } = await import("../src/registry.js");
const { stubIdentity } = await import("../src/identity.stub.js");

describe("Agent registry (human↔agent link)", () => {
  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("an unregistered agent is not backed", () => {
    assert.strictEqual(isAgentRegistered("agent_notregistered0"), false);
  });

  it("upsertAgent stores the human↔agent link", () => {
    const rec = upsertAgent("agent_1111111111111111", "nullifier-abc");
    assert.strictEqual(rec.agentId, "agent_1111111111111111");
    assert.strictEqual(rec.nullifierHash, "nullifier-abc");
    assert.ok(rec.createdAt, "should have a createdAt timestamp");
    assert.strictEqual(isAgentRegistered("agent_1111111111111111"), true);
  });

  it("upsertAgent is idempotent (same agent returns the existing record)", () => {
    const first = upsertAgent("agent_2222222222222222", "nullifier-def");
    const second = upsertAgent("agent_2222222222222222", "nullifier-different");
    // Existing row is returned unchanged — the nullifier is not overwritten.
    assert.strictEqual(second.nullifierHash, first.nullifierHash);
    assert.strictEqual(getAgent("agent_2222222222222222")?.nullifierHash, "nullifier-def");
  });

  describe("resolveAgentBacking (via stub identity)", () => {
    it("rejects a well-formed but unregistered agent id", async () => {
      const backed = await stubIdentity.resolveAgentBacking("agent_deadbeefdeadbeef");
      assert.strictEqual(backed, false, "unregistered id must not be backed");
    });

    it("accepts an agent registered through the dev proof", async () => {
      const reg = await stubIdentity.registerAgentWithProof("dev-selfie-proof");
      assert.ok(reg, "dev proof should register an agent");
      const backed = await stubIdentity.resolveAgentBacking(reg!.agentId);
      assert.strictEqual(backed, true, "registered id must be backed");
    });

    it("rejects registration with a bad proof", async () => {
      const reg = await stubIdentity.registerAgentWithProof("not-the-dev-proof");
      assert.strictEqual(reg, null);
    });
  });
});
