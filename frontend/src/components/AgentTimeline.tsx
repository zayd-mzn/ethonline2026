import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Clock, Database, ExternalLink, Radio, Shield, Wifi } from "lucide-react";
import { useRef, useState } from "react";

// ── types ─────────────────────────────────────────────────────────────────────
export type TimelineStage = 0 | 1 | 2 | 3;

/** Live activity event from the agent SSE stream (mirrors agent/src/types.ts). */
export interface LiveEvent {
  ts: number;
  stage: "discover" | "call" | "402" | "paying" | "paid" | "data";
  detail: string;
}

interface NodeDef {
  label:   string;
  method:  string;
  title:   string;
  status:  string;
  statusColor: string;
  dotColor:    string;
  icon:    typeof Database;
  summary: string;
  meta:    Record<string, string>;
  code:    string;
  hashScanHref?: string;
}

// ── node definitions ──────────────────────────────────────────────────────────
const NODES: NodeDef[] = [
  {
    label:       "NODE 01",
    method:      "GET /marketplace/services",
    title:       "Discovery",
    status:      "RESOLVED",
    statusColor: "text-cim-success bg-cim-success/10 border-cim-success/30",
    dotColor:    "var(--cim-success)",
    icon:        Wifi,
    summary:     "Agent queried the service registry, evaluated available intelligence feeds by price and latency, and selected IP Reputation as the optimal data source for this investigation.",
    meta: {
      "Agent":       "investigator-01",
      "Registry":    "/marketplace/services",
      "Selected":    "IP Reputation",
      "Price":       "0.010 HBAR / query",
      "Latency P50": "184 ms",
    },
    code: `{
  "services": [
    {
      "id": "svc_ip_01",
      "name": "IP Reputation",
      "priceHbar": 0.010,
      "queryType": "ip",
      "providerId": "0.0.512390"
    }
  ]
}`,
  },
  {
    label:       "NODE 02",
    method:      "HTTP 402 Payment Required",
    title:       "402 Challenge",
    status:      "INTERCEPTED",
    statusColor: "text-cim-warning bg-cim-warning/10 border-cim-warning/30",
    dotColor:    "var(--cim-warning)",
    icon:        Shield,
    summary:     "Provider responded with HTTP 402. Server demands 0.010 HBAR settled via Blocky402 facilitator before releasing data. Request nonce issued to prevent replay.",
    meta: {
      "Status":      "402 Payment Required",
      "Amount":      "0.010 HBAR",
      "Facilitator": "blocky402",
      "Recipient":   "0.0.10446679",
    },
    code: `{
  "amountHbar": 0.010,
  "recipient":  "0.0.512390",
  "facilitator": "blocky402",
  "requestId":  "req_01K4F8A2XZ"
}`,
  },
  {
    label:       "NODE 03",
    method:      "HBAR Transfer Complete",
    title:       "Hedera Settlement",
    status:      "CONFIRMED",
    statusColor: "text-cim-violet-soft bg-cim-violet/10 border-cim-violet/30",
    dotColor:    "var(--cim-violet)",
    icon:        CheckCircle2,
    summary:     "Agent signed the transaction via Hedera Agent Kit. Network reached consensus in 2.8 s. Blocky402 verified settlement and released the data gate.",
    meta: {
      "From":     "0.0.10446789",
      "To":       "0.0.10446679",
      "Amount":   "0.010 HBAR",
      "Finality": "2.8 s",
      "HCS Topic": "0.0.10449900",
    },
    code: `{
  "transactionId": "0.0.10446789@1788994742.041874961",
  "status":        "SUCCESS",
  "consensusAt":   "2026-09-09T22:51:40Z",
  "hcsTopicId":    "0.0.10449900"
}`,
    hashScanHref: "https://hashscan.io/testnet/topic/0.0.10449900",
  },
  {
    label:       "NODE 04",
    method:      "200 OK — Malicious IP Flagged",
    title:       "Data Ingestion",
    status:      "THREAT DETECTED",
    statusColor: "text-cim-danger bg-cim-danger/10 border-cim-danger/30",
    dotColor:    "var(--cim-danger)",
    icon:        Database,
    summary:     "Provider returned AbuseIPDB verdict. IP 185.220.101.42 classified malicious with confidence 96/100. Result appended to active threat report.",
    meta: {
      "IP":         "185.220.101.42",
      "Verdict":    "MALICIOUS",
      "Confidence": "96 / 100",
      "ISP":        "Tor Exit Node",
      "Country":    "DE",
    },
    code: `{
  "ip":            "185.220.101.42",
  "malicious":     true,
  "abuseScore":    96,
  "isp":           "Tor Exit Node",
  "countryCode":   "DE",
  "lastReported":  "2026-09-07T18:44:12Z",
  "totalReports":  312
}`,
  },
];

// ── live-event → node overrides ─────────────────────────────────────────────
// The agent SSE stream sends { stage, detail } events. We parse the human-readable
// `detail` strings (format defined in agent/src/*.ts) and surface the real values
// in the timeline, overriding the demo fixtures whenever a matching live event
// has arrived. Before any live event, the fixtures render as-is.

interface LiveOverride {
  summary?: string;
  meta?: Record<string, string>;
  code?: string;
  status?: string;
  hashScanHref?: string;
}

function num(re: RegExp, s: string): string | undefined {
  const m = s.match(re);
  return m?.[1];
}

/** Build per-node overrides from the live event list. Empty object = no live data yet. */
function buildOverrides(events: LiveEvent[]): [LiveOverride, LiveOverride, LiveOverride, LiveOverride] {
  const out: [LiveOverride, LiveOverride, LiveOverride, LiveOverride] = [{}, {}, {}, {}];
  const byStage = (stage: LiveEvent["stage"]) => events.find((e) => e.stage === stage);

  // NODE 01 — discovery: "found N service(s) at <url>"  (+ optional "call": "GET <url>")
  const discover = byStage("discover");
  const call = byStage("call");
  if (discover || call) {
    const count = discover ? num(/found (\d+) service/, discover.detail) : undefined;
    const url = call ? num(/GET (\S+)/, call.detail) : undefined;
    out[0] = {
      summary: `Agent queried the live service registry${count ? ` and found ${count} service(s)` : ""}${
        url ? `, then called ${url}` : ""
      }.`,
      meta: {
        ...(count ? { "Services found": count } : {}),
        ...(url ? { Endpoint: url } : {}),
        Source: "live SSE",
      },
    };
  }

  // NODE 02 — 402: "payment required: <amt> HBAR for <resource>"
  const gate = byStage("402");
  if (gate) {
    const amt = num(/payment required: ([\d.]+) HBAR/, gate.detail);
    const resource = num(/HBAR for (\S+)/, gate.detail);
    out[1] = {
      status: "INTERCEPTED",
      summary: `Provider responded with HTTP 402. Settlement of ${amt ?? "?"} HBAR via Blocky402 is required before the data gate opens.`,
      meta: {
        Status: "402 Payment Required",
        ...(amt ? { Amount: `${amt} HBAR` } : {}),
        Facilitator: "blocky402",
        ...(resource ? { Resource: resource } : {}),
      },
    };
  }

  // NODE 03 — settlement: "paying <amt> HBAR to <recipient>" then "paid <amt> HBAR (tx <txId>)"
  const paying = byStage("paying");
  const paid = byStage("paid");
  if (paying || paid) {
    const amt =
      (paid ? num(/paid ([\d.]+) HBAR/, paid.detail) : undefined) ??
      (paying ? num(/paying ([\d.]+) HBAR/, paying.detail) : undefined);
    const recipient = paying ? num(/to (\S+)/, paying.detail) : undefined;
    const txId = paid ? num(/tx ([^)]+)\)/, paid.detail) : undefined;
    out[2] = {
      status: paid ? "CONFIRMED" : "SETTLING",
      summary: paid
        ? `Payment settled on Hedera${txId ? ` (tx ${txId})` : ""}. Blocky402 verified settlement and released the data gate.`
        : `Signing and submitting the HBAR transfer via the agent's Hedera key…`,
      meta: {
        ...(amt ? { Amount: `${amt} HBAR` } : {}),
        ...(recipient ? { To: recipient } : {}),
        ...(txId ? { "Transaction ID": txId } : {}),
        Network: "Hedera testnet",
      },
      ...(txId
        ? { hashScanHref: `https://hashscan.io/testnet/transaction/${encodeURIComponent(txId)}` }
        : {}),
    };
  }

  // NODE 04 — data: "report: N indicator(s), verdict <v> (X malicious, Y suspicious, Z clean)"
  const data = byStage("data");
  if (data) {
    const total = num(/report: (\d+) indicator/, data.detail);
    const verdict = num(/verdict (\w+)/, data.detail);
    const malicious = num(/\((\d+) malicious/, data.detail);
    const suspicious = num(/(\d+) suspicious/, data.detail);
    const clean = num(/(\d+) clean/, data.detail);
    const mal = verdict === "malicious";
    out[3] = {
      status: mal ? "THREAT DETECTED" : verdict ? verdict.toUpperCase() : "COMPLETE",
      summary: `Agent aggregated ${total ?? "the"} indicator(s) into a threat report. Overall verdict: ${
        verdict ?? "—"
      }.`,
      meta: {
        ...(total ? { Indicators: total } : {}),
        ...(verdict ? { Verdict: verdict.toUpperCase() } : {}),
        ...(malicious ? { Malicious: malicious } : {}),
        ...(suspicious ? { Suspicious: suspicious } : {}),
        ...(clean ? { Clean: clean } : {}),
      },
    };
  }

  return out;
}

// ── tracing beam ──────────────────────────────────────────────────────────────
function TracingBeam({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 40%"] });
  const spring = useSpring(scrollYProgress, { stiffness: 80, damping: 22 });
  const height  = useTransform(spring, [0, 1], ["0%", "100%"]);

  return (
    <div ref={ref} className="relative pl-12 md:pl-16">
      {/* track */}
      <div className="absolute bottom-0 left-[15px] top-0 w-px bg-cim-border md:left-[21px]" />
      {/* glowing fill */}
      <motion.div
        className="absolute left-[13px] top-0 w-[5px] rounded-full md:left-[19px]"
        style={{
          height,
          background: "linear-gradient(to bottom, var(--cim-violet), var(--cim-cyan))",
          boxShadow: "0 0 14px rgba(124,58,237,0.55)",
        }}
      />
      {/* travelling dot */}
      <motion.div
        className="absolute left-[11px] h-3 w-3 rounded-full border border-cim-cyan bg-cim-canvas shadow-[0_0_16px_rgba(24,213,242,0.7)] md:left-[17px]"
        style={{ top: height }}
      />
      <div>{children}</div>
    </div>
  );
}

// ── collapsible code block ────────────────────────────────────────────────────
function CodeBlock({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 overflow-hidden rounded border border-cim-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-cim-surface-2/80 px-3 py-2 text-left font-mono text-[9px] font-bold uppercase tracking-widest text-cim-subtle transition hover:text-cim-text"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        RESPONSE PAYLOAD
      </button>
      {open && (
        <motion.pre
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="overflow-x-auto bg-cim-canvas/90 p-4 font-mono text-[10px] leading-5 text-cim-text"
        >
          {code}
        </motion.pre>
      )}
    </div>
  );
}

// ── single timeline node ──────────────────────────────────────────────────────
function TimelineNode({ node, index, active, override }: { node: NodeDef; index: number; active: boolean; override?: LiveOverride }) {
  const Icon = node.icon;
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);

  // Live values (from the agent SSE stream) take precedence over demo fixtures.
  const summary = override?.summary ?? node.summary;
  const meta = override?.meta ?? node.meta;
  const status = override?.status ?? node.status;
  const hashScanHref = override?.hashScanHref ?? node.hashScanHref;
  const isLive = !!override && Object.keys(override).length > 0;

  return (
    <motion.div
      className="relative mb-8 last:mb-0"
      initial={{ opacity: 0, x: 18 }}
      animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: 18 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {/* node dot on the beam */}
      <div
        className="absolute -left-[45px] top-[18px] h-3 w-3 rounded-full border border-cim-border-strong bg-cim-canvas shadow-lg md:-left-[53px]"
        style={{ boxShadow: active ? `0 0 12px ${node.dotColor}` : "none", borderColor: node.dotColor }}
      >
        <div className="absolute inset-[2px] rounded-full" style={{ background: node.dotColor, opacity: active ? 1 : 0.25 }} />
      </div>

      <div className="rounded-xl border border-cim-border bg-cim-surface/90 p-5 backdrop-blur">
        {/* header row */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border"
              style={{
                borderColor: `color-mix(in srgb, ${node.dotColor} 28%, transparent)`,
                background: `color-mix(in srgb, ${node.dotColor} 8%, transparent)`,
                color: node.dotColor,
              }}
            >
              <Icon size={17} />
            </span>
            <div>
              <div className="font-mono text-[8px] font-bold tracking-[.18em] text-cim-subtle">{node.label}</div>
              <h3 className="mt-0.5 text-base font-semibold text-cim-text">{node.title}</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded border px-2 py-0.5 font-mono text-[8px] font-bold tracking-widest ${node.statusColor}`}>
              {status}
            </span>
            {isLive && (
              <span className="rounded border border-cim-cyan/40 bg-cim-cyan/10 px-1.5 py-0.5 font-mono text-[7px] font-bold tracking-widest text-cim-cyan">
                LIVE
              </span>
            )}
            {active && (
              <span className="flex items-center gap-1 font-mono text-[8px] text-cim-subtle">
                <Radio size={10} className="animate-pulse" style={{ color: node.dotColor }} />
                {ts}
              </span>
            )}
          </div>
        </div>

        {/* method pill */}
        <div className="mb-4 inline-block rounded bg-cim-surface-2 px-3 py-1.5 font-mono text-[9px] text-cim-text">
          &gt; {node.method}
        </div>

        {/* summary */}
        <p className="mb-4 text-sm leading-6 text-cim-muted">{summary}</p>

        {/* metadata grid */}
        <div className="mb-1 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-cim-border/60 pt-4 font-mono text-[9px]">
          {Object.entries(meta).map(([k, v]) => (
            <div key={k}>
              <span className="text-cim-faint">{k}: </span>
              <span className="text-cim-text">{v}</span>
            </div>
          ))}
        </div>

        {/* HashScan link on settlement node */}
        {hashScanHref !== undefined && (
          <a
            href={hashScanHref}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded border border-cim-violet/30 bg-cim-violet/10 px-3 py-1.5 font-mono text-[9px] font-bold text-cim-violet-soft transition hover:bg-cim-violet/20"
          >
            <ExternalLink size={11} />
            View on HashScan
          </a>
        )}

        {/* timing footer */}
        <div className="mt-4 flex items-center gap-2 border-t border-cim-border/60 pt-3 font-mono text-[8px] text-cim-faint">
          <Clock size={9} />
          <span>STEP {index + 1} OF {NODES.length}</span>
          <ArrowUpRight size={9} className="ml-auto" />
        </div>

        <CodeBlock code={node.code} />
      </div>
    </motion.div>
  );
}

// ── exported component ────────────────────────────────────────────────────────
export function AgentTimeline({
  activeStep,
  running,
  events = [],
}: {
  activeStep: number;
  running: boolean;
  events?: LiveEvent[];
}) {
  const overrides = buildOverrides(events);
  return (
    <div className="h-[calc(100vh-140px)] overflow-y-auto pr-2">
      <TracingBeam>
        <div className="pb-8 pt-2">
          {NODES.map((node, index) => (
            <TimelineNode
              key={node.label}
              node={node}
              index={index}
              active={index <= activeStep}
              override={overrides[index]}
            />
          ))}
          {running && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 pl-1 font-mono text-[9px] text-cim-subtle"
            >
              <span className="h-2 w-1 animate-pulse bg-cim-cyan" />
              Processing next action…
            </motion.div>
          )}
        </div>
      </TracingBeam>
    </div>
  );
}
