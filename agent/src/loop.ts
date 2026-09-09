/**
 * The end-to-end agent loop: discover -> pick -> pay -> consume -> report.
 *
 * Given a set of indicators (IPs and/or file hashes), the agent discovers
 * available services, picks a matching one per indicator, runs the paid
 * request flow (handling 402 -> pay -> retry), consumes each result into a
 * normalized finding, and aggregates a single threat report.
 */

import type { ActivityEmitter } from "./activity.js";
import type { Budget } from "./budget.js";
import { DiscoveryClient } from "./discovery.js";
import { PaidRequester } from "./paid-request.js";
import type { PaymentClient } from "./payment.js";
import {
  buildReport,
  hashFinding,
  ipFinding,
  type Finding,
  type ThreatReport,
} from "./report.js";
import type {
  HashCheckResult,
  IpReputationResult,
  QueryType,
  Service,
} from "./types.js";
import type { FetchLike } from "./discovery.js";

export interface InvestigationOptions {
  backendUrl: string;
  emitter: ActivityEmitter;
  budget: Budget;
  payment: PaymentClient;
  fetchImpl?: FetchLike;
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Classify an indicator string into a query type. */
export function classifyIndicator(indicator: string): QueryType {
  return IPV4.test(indicator.trim()) ? "ip" : "hash";
}

/** Pick the first service that serves a given query type. */
export function pickService(
  services: Service[],
  queryType: QueryType,
): Service | undefined {
  return services.find((s) => s.queryType === queryType);
}

/** Build the full query URL for a service and indicator. */
function buildQueryUrl(
  backendUrl: string,
  service: Service,
  indicator: string,
): string {
  const param = service.queryType === "ip" ? "ip" : "hash";
  return `${backendUrl}${service.endpoint}?${param}=${encodeURIComponent(indicator)}`;
}

/**
 * Run the full investigation loop over the given indicators.
 * Indicators that have no matching service, or whose paid request fails
 * (e.g. budget refusal), are skipped with a logged warning; the loop
 * continues so one bad indicator doesn't sink the whole report.
 */
export async function investigate(
  indicators: string[],
  options: InvestigationOptions,
): Promise<ThreatReport> {
  const { backendUrl, emitter, budget, payment, fetchImpl } = options;

  // 1. Discover.
  const discovery = new DiscoveryClient({ backendUrl, emitter, fetchImpl });
  const services = await discovery.listServices();

  const requester = new PaidRequester({ emitter, budget, payment, fetchImpl });
  const findings: Finding[] = [];

  for (const indicator of indicators) {
    // 2. Pick a service for this indicator's type.
    const queryType = classifyIndicator(indicator);
    const service = pickService(services, queryType);
    if (!service) {
      console.warn(`no service for ${queryType} indicator "${indicator}" — skipped`);
      continue;
    }

    // 3 + 4. Pay (if gated) and consume the result.
    const url = buildQueryUrl(backendUrl, service, indicator);
    try {
      if (queryType === "ip") {
        const result = await requester.request<IpReputationResult>(url);
        findings.push(ipFinding(result));
      } else {
        const result = await requester.request<HashCheckResult>(url);
        findings.push(hashFinding(result));
      }
    } catch (err) {
      console.warn(
        `query for "${indicator}" failed: ` +
          `${err instanceof Error ? err.message : String(err)} — skipped`,
      );
    }
  }

  // 5. Report.
  return buildReport(findings, emitter);
}
