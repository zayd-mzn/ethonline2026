import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Clock, Database, ExternalLink, Radio, Shield, Wifi } from "lucide-react";
import { useRef, useState } from "react";

// ── types ─────────────────────────────────────────────────────────────────────
export type TimelineStage = 0 | 1 | 2 | 3;

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
    statusColor: "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/30",
    dotColor:    "#22c55e",
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
    statusColor: "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30",
    dotColor:    "#f59e0b",
    icon:        Shield,
    summary:     "Provider responded with HTTP 402. Server demands 0.010 HBAR settled via Blocky402 facilitator before releasing data. Request nonce issued to prevent replay.",
    meta: {
      "Status":      "402 Payment Required",
      "Amount":      "0.010 HBAR",
      "Facilitator": "blocky402",
      "Recipient":   "0.0.512390",
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
    statusColor: "text-[#9333ea] bg-[#9333ea]/10 border-[#9333ea]/30",
    dotColor:    "#9333ea",
    icon:        CheckCircle2,
    summary:     "Agent signed the transaction via Hedera Agent Kit. Network reached consensus in 2.8 s. Blocky402 verified settlement and released the data gate.",
    meta: {
      "From":     "0.0.845921",
      "To":       "0.0.512390",
      "Amount":   "0.010 HBAR",
      "Finality": "2.8 s",
      "HCS Topic": "0.0.3901234",
    },
    code: `{
  "transactionId": "0.0.845921@1788793122.441",
  "status":        "SUCCESS",
  "consensusAt":   "2026-09-07T18:58:26Z",
  "hcsTopicId":    "0.0.3901234"
}`,
    hashScanHref: "#", // wire in live HashScan URL once Member 1 provides testnet IDs
  },
  {
    label:       "NODE 04",
    method:      "200 OK — Malicious IP Flagged",
    title:       "Data Ingestion",
    status:      "THREAT DETECTED",
    statusColor: "text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30",
    dotColor:    "#ef4444",
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

// ── tracing beam ──────────────────────────────────────────────────────────────
function TracingBeam({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 40%"] });
  const spring = useSpring(scrollYProgress, { stiffness: 80, damping: 22 });
  const height  = useTransform(spring, [0, 1], ["0%", "100%"]);

  return (
    <div ref={ref} className="relative pl-12 md:pl-16">
      {/* track */}
      <div className="absolute bottom-0 left-[15px] top-0 w-px bg-slate-800 md:left-[21px]" />
      {/* glowing fill */}
      <motion.div
        className="absolute left-[13px] top-0 w-[5px] rounded-full md:left-[19px]"
        style={{
          height,
          background: "linear-gradient(to bottom, #9333ea, #22c55e)",
          boxShadow: "0 0 14px #9333ea88",
        }}
      />
      {/* travelling dot */}
      <motion.div
        className="absolute left-[11px] h-3 w-3 rounded-full border border-[#22c55e] bg-black shadow-[0_0_16px_#22c55e] md:left-[17px]"
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
    <div className="mt-4 overflow-hidden rounded border border-slate-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-slate-900/60 px-3 py-2 text-left font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500 transition hover:text-slate-300"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        RESPONSE PAYLOAD
      </button>
      {open && (
        <motion.pre
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="overflow-x-auto bg-black/70 p-4 font-mono text-[10px] leading-5 text-slate-300"
        >
          {code}
        </motion.pre>
      )}
    </div>
  );
}

// ── single timeline node ──────────────────────────────────────────────────────
function TimelineNode({ node, index, active }: { node: NodeDef; index: number; active: boolean }) {
  const Icon = node.icon;
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);

  return (
    <motion.div
      className="relative mb-8 last:mb-0"
      initial={{ opacity: 0, x: 18 }}
      animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: 18 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {/* node dot on the beam */}
      <div
        className="absolute -left-[45px] top-[18px] h-3 w-3 rounded-full border border-slate-700 bg-black shadow-lg md:-left-[53px]"
        style={{ boxShadow: active ? `0 0 12px ${node.dotColor}` : "none", borderColor: node.dotColor }}
      >
        <div className="absolute inset-[2px] rounded-full" style={{ background: node.dotColor, opacity: active ? 1 : 0.25 }} />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-5 backdrop-blur">
        {/* header row */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border"
              style={{ borderColor: `${node.dotColor}44`, background: `${node.dotColor}12`, color: node.dotColor }}
            >
              <Icon size={17} />
            </span>
            <div>
              <div className="font-mono text-[8px] font-bold tracking-[.18em] text-slate-500">{node.label}</div>
              <h3 className="mt-0.5 text-base font-semibold text-white">{node.title}</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded border px-2 py-0.5 font-mono text-[8px] font-bold tracking-widest ${node.statusColor}`}>
              {node.status}
            </span>
            {active && (
              <span className="flex items-center gap-1 font-mono text-[8px] text-slate-500">
                <Radio size={10} className="animate-pulse" style={{ color: node.dotColor }} />
                {ts}
              </span>
            )}
          </div>
        </div>

        {/* method pill */}
        <div className="mb-4 inline-block rounded bg-slate-900 px-3 py-1.5 font-mono text-[9px] text-slate-300">
          &gt; {node.method}
        </div>

        {/* summary */}
        <p className="mb-4 text-sm leading-6 text-slate-400">{node.summary}</p>

        {/* metadata grid */}
        <div className="mb-1 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-800/60 pt-4 font-mono text-[9px]">
          {Object.entries(node.meta).map(([k, v]) => (
            <div key={k}>
              <span className="text-slate-600">{k}: </span>
              <span className="text-slate-300">{v}</span>
            </div>
          ))}
        </div>

        {/* HashScan link on settlement node */}
        {node.hashScanHref !== undefined && (
          <a
            href={node.hashScanHref}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded border border-[#9333ea]/30 bg-[#9333ea]/10 px-3 py-1.5 font-mono text-[9px] font-bold text-[#9333ea] transition hover:bg-[#9333ea]/20"
          >
            <ExternalLink size={11} />
            View on HashScan {/* replace href with live testnet link from Member 1 */}
          </a>
        )}

        {/* timing footer */}
        <div className="mt-4 flex items-center gap-2 border-t border-slate-800/60 pt-3 font-mono text-[8px] text-slate-600">
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
}: {
  activeStep: number;
  running: boolean;
}) {
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
            />
          ))}
          {running && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 pl-1 font-mono text-[9px] text-slate-500"
            >
              <span className="h-2 w-1 animate-pulse bg-[#22c55e]" />
              Processing next action…
            </motion.div>
          )}
        </div>
      </TracingBeam>
    </div>
  );
}
