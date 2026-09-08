/**
 * Threat-intel providers.
 *
 * Returns intel for a given indicator. Starts with deterministic mock
 * data so the full agent → pay → consume flow works without external
 * API keys. Real AbuseIPDB / VirusTotal wrapping swaps in later behind
 * these same function signatures.
 */

import type { IpReputationResult, HashCheckResult } from "./types.js";

/** Deterministic pseudo-score from a string, so the same input always
 *  returns the same result (stable demos). Range 0-100. */
function stableScore(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 101;
}

/** Look up IP reputation. Mock implementation. */
export async function lookupIpReputation(ip: string): Promise<IpReputationResult> {
  const score = stableScore(ip);
  return {
    ip,
    malicious: score >= 50,
    score,
    source: "mock",
  };
}

/** Check a file hash. Mock implementation. */
export async function checkHash(hash: string): Promise<HashCheckResult> {
  const score = stableScore(hash);
  const detections = score % 70;
  const verdict: HashCheckResult["verdict"] =
    detections > 30 ? "malicious" : detections > 5 ? "suspicious" : "clean";
  return {
    hash,
    detections,
    verdict,
    source: "mock",
  };
}
