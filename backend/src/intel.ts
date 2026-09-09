/**
 * Threat-intel providers.
 *
 * Calls real APIs (AbuseIPDB, VirusTotal) when an API key is configured,
 * and falls back to deterministic mock data otherwise or on error. The
 * mock fallback keeps the full flow — and the demo — working without keys.
 */

import type { IpReputationResult, HashCheckResult } from "./types.js";

/** Deterministic pseudo-score from a string (stable demos). Range 0-100. */
function stableScore(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 101;
}

/* ----------------------------- mock fallbacks ----------------------------- */

function mockIp(ip: string): IpReputationResult {
  const score = stableScore(ip);
  return { ip, malicious: score >= 50, score, source: "mock" };
}

function mockHash(hash: string): HashCheckResult {
  const score = stableScore(hash);
  const detections = score % 70;
  const verdict: HashCheckResult["verdict"] =
    detections > 30 ? "malicious" : detections > 5 ? "suspicious" : "clean";
  return { hash, detections, verdict, source: "mock" };
}

/* ------------------------------- real APIs -------------------------------- */

/** Look up IP reputation via AbuseIPDB, falling back to mock. */
export async function lookupIpReputation(ip: string): Promise<IpReputationResult> {
  const key = process.env.ABUSEIPDB_API_KEY;
  if (!key) return mockIp(ip);

  try {
    const url = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`;
    const res = await fetch(url, {
      headers: { Key: key, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return mockIp(ip);

    const data = (await res.json()) as {
      data?: { abuseConfidenceScore?: number };
    };
    const score = data.data?.abuseConfidenceScore ?? 0;
    return { ip, malicious: score >= 50, score, source: "abuseipdb" };
  } catch {
    return mockIp(ip);
  }
}

/** Check a file hash via VirusTotal, falling back to mock. */
export async function checkHash(hash: string): Promise<HashCheckResult> {
  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) return mockHash(hash);

  try {
    const url = `https://www.virustotal.com/api/v3/files/${encodeURIComponent(hash)}`;
    const res = await fetch(url, {
      headers: { "x-apikey": key },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return mockHash(hash);

    const data = (await res.json()) as {
      data?: { attributes?: { last_analysis_stats?: { malicious?: number; suspicious?: number } } };
    };
    const stats = data.data?.attributes?.last_analysis_stats;
    const detections = (stats?.malicious ?? 0) + (stats?.suspicious ?? 0);
    const verdict: HashCheckResult["verdict"] =
      (stats?.malicious ?? 0) > 0 ? "malicious" : (stats?.suspicious ?? 0) > 0 ? "suspicious" : "clean";
    return { hash, detections, verdict, source: "virustotal" };
  } catch {
    return mockHash(hash);
  }
}
