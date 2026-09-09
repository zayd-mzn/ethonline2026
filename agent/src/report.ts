/**
 * Threat report — consumes query results and aggregates a report.
 *
 * After paid queries return data, the agent collects the per-indicator
 * results (IP reputation, file-hash checks), aggregates them into a single
 * threat report with an overall verdict, and emits a `data` activity event.
 */

import type { ActivityEmitter } from "./activity.js";
import type { HashCheckResult, IpReputationResult } from "./types.js";

/** A single indicator's finding, normalized across query types. */
export interface Finding {
  indicator: string; // the IP or hash queried
  type: "ip" | "hash";
  malicious: boolean;
  /** 0-100 risk score. For hashes, derived from detections/verdict. */
  score: number;
  detail: string; // human-readable summary of the raw result
  source: string;
}

/** Overall verdict for the whole investigation. */
export type OverallVerdict = "malicious" | "suspicious" | "clean";

/** Aggregated threat report across all investigated indicators. */
export interface ThreatReport {
  generatedAt: string; // ISO timestamp
  totalIndicators: number;
  maliciousCount: number;
  suspiciousCount: number;
  cleanCount: number;
  highestRisk: Finding | null;
  overallVerdict: OverallVerdict;
  findings: Finding[];
}

/** Normalize an IP reputation result into a Finding. */
export function ipFinding(result: IpReputationResult): Finding {
  return {
    indicator: result.ip,
    type: "ip",
    malicious: result.malicious,
    score: result.score,
    detail: `reputation score ${result.score}/100 (${result.malicious ? "malicious" : "clean"})`,
    source: result.source,
  };
}

/** Normalize a hash-check result into a Finding. */
export function hashFinding(result: HashCheckResult): Finding {
  // Map verdict to a comparable score band; keep detections visible in detail.
  const score =
    result.verdict === "malicious" ? 90 : result.verdict === "suspicious" ? 55 : 5;
  return {
    indicator: result.hash,
    type: "hash",
    malicious: result.verdict === "malicious",
    score,
    detail: `${result.detections} detection(s), verdict ${result.verdict}`,
    source: result.source,
  };
}

/** Classify a single finding into a verdict band. */
function classify(f: Finding): OverallVerdict {
  if (f.malicious || f.score >= 70) return "malicious";
  if (f.score >= 40) return "suspicious";
  return "clean";
}

/**
 * Aggregate findings into a threat report. The overall verdict is the most
 * severe verdict among all findings (malicious > suspicious > clean).
 */
export function buildReport(
  findings: Finding[],
  emitter?: ActivityEmitter,
): ThreatReport {
  let maliciousCount = 0;
  let suspiciousCount = 0;
  let cleanCount = 0;
  let highestRisk: Finding | null = null;

  for (const f of findings) {
    switch (classify(f)) {
      case "malicious":
        maliciousCount++;
        break;
      case "suspicious":
        suspiciousCount++;
        break;
      default:
        cleanCount++;
    }
    if (!highestRisk || f.score > highestRisk.score) {
      highestRisk = f;
    }
  }

  const overallVerdict: OverallVerdict =
    maliciousCount > 0 ? "malicious" : suspiciousCount > 0 ? "suspicious" : "clean";

  const report: ThreatReport = {
    generatedAt: new Date().toISOString(),
    totalIndicators: findings.length,
    maliciousCount,
    suspiciousCount,
    cleanCount,
    highestRisk,
    overallVerdict,
    findings,
  };

  emitter?.emit(
    "data",
    `report: ${findings.length} indicator(s), verdict ${overallVerdict} ` +
      `(${maliciousCount} malicious, ${suspiciousCount} suspicious, ${cleanCount} clean)`,
  );

  return report;
}

/** Render a report as a readable multi-line string for console/demo output. */
export function formatReport(report: ThreatReport): string {
  const lines: string[] = [];
  lines.push(`Threat Report — ${report.generatedAt}`);
  lines.push(
    `Overall verdict: ${report.overallVerdict.toUpperCase()} ` +
      `(${report.totalIndicators} indicator(s))`,
  );
  lines.push(
    `  malicious: ${report.maliciousCount}  ` +
      `suspicious: ${report.suspiciousCount}  clean: ${report.cleanCount}`,
  );
  if (report.highestRisk) {
    lines.push(
      `Highest risk: ${report.highestRisk.indicator} ` +
        `(score ${report.highestRisk.score})`,
    );
  }
  lines.push("Findings:");
  for (const f of report.findings) {
    lines.push(`  - [${f.type}] ${f.indicator}: ${f.detail} [${f.source}]`);
  }
  return lines.join("\n");
}
