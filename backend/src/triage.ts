/**
 * Triage — batch scoring and stack-ranking of threat indicators.
 *
 * Takes a mixed list of indicators (IPs and file hashes), classifies each,
 * queries the matching intel provider, normalizes to a single 0-100 threat
 * score, and returns them sorted worst-first. This is the capability the
 * Bazantic recipe builds on: "given suspicious indicators, stack-rank by
 * threat score and surface the malicious ones."
 */

import { lookupIpReputation, checkHash } from "./intel.js";
import type {
  QueryType,
  TriageItem,
  TriageResponse,
  IpReputationResult,
  HashCheckResult,
} from "./types.js";

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Classify an indicator string into a query type (mirrors the agent's logic). */
export function classifyIndicator(indicator: string): QueryType {
  return IPV4.test(indicator.trim()) ? "ip" : "hash";
}

/**
 * Normalize a hash-check result to a 0-100 score comparable with IP scores.
 * Verdict drives the band; detections nudge within it.
 */
function hashScore(result: HashCheckResult): number {
  const base =
    result.verdict === "malicious" ? 70 : result.verdict === "suspicious" ? 40 : 0;
  const bump = Math.min(result.detections, 30); // cap the contribution
  return Math.min(base + bump, 100);
}

/** Score a single indicator into a TriageItem. */
async function scoreOne(indicator: string): Promise<TriageItem> {
  const queryType = classifyIndicator(indicator);

  if (queryType === "ip") {
    const detail: IpReputationResult = await lookupIpReputation(indicator);
    return {
      indicator,
      queryType,
      score: detail.score,
      malicious: detail.malicious,
      detail,
    };
  }

  const detail: HashCheckResult = await checkHash(indicator);
  const score = hashScore(detail);
  return {
    indicator,
    queryType,
    score,
    malicious: detail.verdict === "malicious",
    detail,
  };
}

/**
 * Score and stack-rank a batch of indicators, worst-first.
 * Queries run in parallel; the result is sorted by score descending.
 */
export async function triage(indicators: string[]): Promise<TriageResponse> {
  const items = await Promise.all(indicators.map(scoreOne));
  items.sort((a, b) => b.score - a.score);

  return {
    ranked: items,
    count: items.length,
    maliciousCount: items.filter((i) => i.malicious).length,
  };
}
