import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Database,
  Fingerprint,
  Globe2,
  Hash,
  LayoutGrid,
  LockKeyhole,
  Plus,
  Radar,
  ScanFace,
  Search,
  Server,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRoundCheck,
  WalletCards,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AgentTimeline } from "./components/AgentTimeline";
import { ServiceGrid } from "./components/ServiceGrid";
import { BackgroundBeams } from "./components/ui/background-beams";
import { GitHubGlobe } from "./components/ui/github-globe";
import { apiFetch, BACKEND_URL, AGENT_EVENTS_URL } from "./api";

type View = "marketplace" | "monitor" | "provider" | "verify";
type Stage = "discover" | "call" | "402" | "paying" | "paid" | "data";

interface AgentEvent { stage: Stage; detail: string; ts: number }

// UI-enriched service type (adds display fields that come from our fixtures
// for services the backend seeds; live services use sensible defaults)
interface Service {
  // from backend
  id:          string;
  name:        string;
  description: string;
  endpoint:    string;
  queryType:   "ip" | "hash";
  priceHbar:   number;
  providerId:  string;
  // UI helpers
  type:        "ip" | "hash";
  category:    "network" | "malware";
  bazantic:    boolean;
  price:       string;   // formatted string for display
  latency:     string;
  calls:       string;
}

// Static enrichment for well-known endpoints; unknown services get defaults
const ENRICHMENT: Record<string, Partial<Service>> = {
  "/api/ip-reputation": { category: "network", bazantic: true,  latency: "184ms", calls: "12,842" },
  "/api/hash-check":    { category: "malware", bazantic: true,  latency: "312ms", calls: "7,231"  },
};

function enrichService(raw: Omit<Service, "type" | "category" | "bazantic" | "price" | "latency" | "calls">): Service {
  const extra = ENRICHMENT[raw.endpoint] ?? {};
  return {
    ...raw,
    type:     raw.queryType,
    category: extra.category ?? (raw.queryType === "ip" ? "network" : "malware"),
    bazantic: extra.bazantic ?? false,
    price:    raw.priceHbar.toFixed(3),
    latency:  extra.latency ?? "—",
    calls:    extra.calls   ?? "0",
  };
}

const stageColor: Record<Stage, string> = {
  discover: "text-[#55e6c2]", call: "text-[#55e6c2]", "402": "text-[#ffbd59]",
  paying: "text-[#ffbd59]", paid: "text-[#b8f34b]", data: "text-[#b8f34b]",
};

const nav = [
  { id: "marketplace" as const, label: "Marketplace", icon: LayoutGrid },
  { id: "monitor"     as const, label: "Agent monitor", icon: Activity },
  { id: "provider"    as const, label: "Provider", icon: Server },
  { id: "verify"      as const, label: "Verification", icon: Fingerprint },
];

function App() {
  const [view, setView] = useState<View>("marketplace");

  // ── services ──────────────────────────────────────────────────────
  const [services, setServices]       = useState<Service[]>([]);
  const [servicesLoading, setSvcLoad] = useState(true);
  const [servicesError,   setSvcErr]  = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setSvcLoad(true);
    setSvcErr(null);
    try {
      const data = await apiFetch<{ services: Omit<Service, "type"|"category"|"bazantic"|"price"|"latency"|"calls">[] }>(
        `${BACKEND_URL}/marketplace/services`
      );
      setServices(data.services.map(enrichService));
    } catch (err) {
      setSvcErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSvcLoad(false);
    }
  }, []);

  useEffect(() => { loadServices(); }, [loadServices]);

  // ── agent SSE ─────────────────────────────────────────────────────
  const [events,     setEvents]     = useState<AgentEvent[]>([]);
  const [running,    setRunning]    = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [agentOnline, setAgentOnline] = useState(false);
  const [agentBalance, setAgentBalance] = useState<string>("—");
  const sseRef = useRef<EventSource | null>(null);

  // Stage → step index for the tracing beam
  const STAGE_STEP: Partial<Record<Stage, number>> = {
    discover: 0, call: 0, "402": 1, paying: 1, paid: 2, data: 3,
  };

  function connectSSE() {
    if (sseRef.current) { sseRef.current.close(); }
    const es = new EventSource(`${AGENT_EVENTS_URL}/events`);
    sseRef.current = es;
    setRunning(true);
    setEvents([]);
    setActiveStep(-1);

    es.addEventListener("activity", (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        setEvents((cur) => [...cur, event]);
        const step = STAGE_STEP[event.stage];
        if (step !== undefined) setActiveStep(step);
        if (event.stage === "data") { setRunning(false); }
      } catch { /* malformed frame */ }
    });

    es.onerror = () => {
      setRunning(false);
      setAgentOnline(false);
    };
  }

  // Poll agent /health to know if it's running
  useEffect(() => {
    async function ping() {
      try {
        await fetch(`${AGENT_EVENTS_URL}/health`);
        setAgentOnline(true);
        // Grab buffered events if agent already ran
        const snap = await apiFetch<{ events: AgentEvent[] }>(`${AGENT_EVENTS_URL}/activity`);
        if (snap.events.length > 0) {
          setEvents(snap.events);
          const lastStep = Math.max(
            ...snap.events.map((ev) => STAGE_STEP[ev.stage] ?? -1)
          );
          setActiveStep(lastStep);
        }
      } catch { setAgentOnline(false); }
    }
    ping();
    const t = window.setInterval(ping, 8000);
    return () => window.clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function investigate() {
    if (running) return;
    setView("monitor");
    connectSSE();
  }

  // ── provider publish ──────────────────────────────────────────────
  const [verified, setVerified] = useState(false);
  const [notice,   setNotice]   = useState("");
  const [publishing, setPublishing] = useState(false);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verified) { setNotice("Complete Selfie Check before publishing."); setView("verify"); return; }
    setPublishing(true);
    setNotice("");
    const form = event.currentTarget;
    const body = {
      name:        (form.elements.namedItem("svc-name")        as HTMLInputElement).value,
      description: (form.elements.namedItem("svc-description") as HTMLTextAreaElement).value,
      queryType:   (form.elements.namedItem("svc-queryType")   as HTMLSelectElement).value,
      priceHbar:   parseFloat((form.elements.namedItem("svc-price") as HTMLInputElement).value),
      endpoint:    (form.elements.namedItem("svc-endpoint")    as HTMLInputElement).value,
    };
    try {
      await apiFetch(`${BACKEND_URL}/marketplace/services`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          // Member 4's World ID proof goes here; stub value passes the backend stub
          "X-Selfie-Check-Proof": "stub-proof",
        },
        body: JSON.stringify(body),
      });
      setNotice("Service published successfully.");
      await loadServices(); // refresh the grid
    } catch (err) {
      setNotice(`Publish failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPublishing(false);
    }
  }

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#07100d] text-[#e9f5ee]">
      <BackgroundBeams />

      {/* ── sidebar ── */}
      <aside
        style={{ width: collapsed ? "72px" : "238px" }}
        className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r border-[#1d3029] bg-[#08110e]/95 backdrop-blur transition-[width] duration-200 ease-in-out md:flex"
      >
        {/* brand + collapse toggle */}
        <div className={`flex items-center pt-4 ${collapsed ? "justify-center px-2" : "justify-between px-3"}`}>
          <button onClick={() => setView("marketplace")} className="flex items-center gap-3 text-left">
            <span className="flex-shrink-0 grid h-10 w-10 place-items-center bg-[#b8f34b] text-[#07100d] [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]"><Radar size={21} /></span>
            {!collapsed && <span><strong className="block text-sm tracking-[.16em]">SIGNAL</strong><small className="block text-[9px] tracking-[.16em] text-[#82988f]">MARKET</small></span>}
          </button>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="ml-2 rounded p-1.5 text-[#4a5f6a] transition hover:bg-white/[.04] hover:text-white" aria-label="Collapse sidebar">
              <PanelLeftClose size={15} />
            </button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mt-3 rounded p-1.5 text-[#4a5f6a] transition hover:bg-white/[.04] hover:text-white" aria-label="Expand sidebar">
            <PanelLeftOpen size={15} />
          </button>
        )}

        {/* nav */}
        <nav className="mt-10 px-2">
          {!collapsed && <p className="mb-3 px-2 text-[9px] font-bold tracking-[.18em] text-[#61766e]">OPERATIONS</p>}
          <div className="space-y-1">
            {nav.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setView(id)} title={collapsed ? label : undefined}
                className={`relative flex w-full items-center gap-3 rounded-md border px-2.5 py-2.5 text-left text-xs transition ${collapsed ? "justify-center" : ""} ${view === id ? "border-[#284038] bg-[#13231e] text-white before:absolute before:-left-[9px] before:h-5 before:w-[3px] before:bg-[#b8f34b] before:shadow-[0_0_12px_#b8f34b77]" : "border-transparent text-[#82988f] hover:bg-white/[.03] hover:text-white"}`}>
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
                {!collapsed && id === "monitor" && events.length > 0 && <i className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[#b8f34b] text-[9px] font-bold not-italic text-[#07100d]">{events.length}</i>}
                {collapsed && id === "monitor" && events.length > 0 && <i className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#b8f34b]" />}
              </button>
            ))}
          </div>
        </nav>

        {/* network card */}
        <div className={`mt-auto mx-2 mb-4 rounded-lg border border-[#1d3029] bg-[#0d1915] ${collapsed ? "p-2" : "p-4"}`}>
          {collapsed
            ? <div className="grid place-items-center"><i className="h-2 w-2 animate-pulse rounded-full bg-[#b8f34b] shadow-[0_0_8px_#b8f34b]" /></div>
            : <><div className="flex items-center gap-2 text-[9px] font-bold tracking-[.12em] text-[#55e6c2]"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b8f34b] shadow-[0_0_8px_#b8f34b]" />HEDERA TESTNET</div><strong className="mt-3 block font-mono text-xs">0.0.845921</strong><small className="mt-1 block text-[9px] text-[#82988f]">Agent {agentOnline ? <span className="text-[#b8f34b]">● online</span> : <span className="text-[#ff6b6b]">● offline</span>}</small></>
          }
        </div>
      </aside>

      {/* ── main ── */}
      <div className="min-w-0 transition-[margin] duration-200 ease-in-out" style={{ marginLeft: collapsed ? "72px" : "238px" }}>
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#1d3029] bg-[#07100d]/85 px-5 backdrop-blur-xl lg:px-10">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[.12em] md:hidden"><Radar size={18} className="text-[#b8f34b]" /> SIGNAL MARKET</div>
          <div className="ml-auto flex items-center gap-5">
            <span className="hidden items-center gap-2 text-[9px] font-bold tracking-[.13em] text-[#789087] sm:flex"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b8f34b]" />SYSTEMS OPERATIONAL</span>
            <button onClick={() => setView("verify")} className={`flex items-center gap-2 rounded border px-3 py-2 text-[9px] font-bold tracking-[.08em] ${verified ? "border-[#547028] bg-[#182415] text-[#b8f34b]" : "border-[#2c443c] bg-[#10201b] text-white"}`}>
              {verified ? <ShieldCheck size={15} /> : <ScanFace size={15} />}{verified ? "HUMAN VERIFIED" : "VERIFY HUMAN"}
            </button>
          </div>
        </header>

        <main className="cyber-grid mx-auto min-h-[calc(100vh-72px)] max-w-[1500px] px-5 py-12 lg:px-10">
          {view === "marketplace" && <Marketplace services={services} servicesLoading={servicesLoading} servicesError={servicesError} investigate={investigate} onProvider={() => setView("provider")} />}
          {view === "monitor" && <Monitor events={events} running={running} investigate={investigate} activeStep={activeStep} agentOnline={agentOnline} />}
          {view === "provider" && <Provider verified={verified} notice={notice} publish={publish} verify={() => setView("verify")} publishing={publishing} />}
          {view === "verify" && <Verification verified={verified} complete={() => { setVerified(true); setNotice(""); }} />}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-4 border-t border-[#1d3029] bg-[#08110e]/95 p-2 backdrop-blur md:hidden">
        {nav.map(({ id, icon: Icon }) => <button key={id} onClick={() => setView(id)} className={`grid place-items-center rounded ${view === id ? "text-[#b8f34b]" : "text-[#61766e]"}`} aria-label={id}><Icon size={19} /></button>)}
      </nav>
    </div>
  );
}

function Marketplace({ services, servicesLoading, servicesError, investigate, onProvider }: {
  services: Service[]; servicesLoading: boolean; servicesError: string | null;
  investigate: () => void; onProvider: () => void;
}) {
  const [query,  setQuery]  = useState("");
  const [filter, setFilter] = useState<"all" | "network" | "malware" | "bazantic">("all");

  const filtered = services.filter((s) => {
    const matchesText = s.name.toLowerCase().includes(query.toLowerCase()) ||
                        s.description.toLowerCase().includes(query.toLowerCase());
    const matchesTag  = filter === "all"      ? true
                      : filter === "bazantic" ? s.bazantic
                      : s.category === filter;
    return matchesText && matchesTag;
  });

  const tags: { id: "all" | "network" | "malware" | "bazantic"; label: string }[] = [
    { id: "all",      label: "All"              },
    { id: "network",  label: "Network"          },
    { id: "malware",  label: "Malware"          },
    { id: "bazantic", label: "⚡ Bazantic Gateway" },
  ];

  return (
    <section className="view-enter pb-20">
      <div className="grid min-h-[390px] items-center gap-10 border-b border-[#1d3029] lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <p className="mb-3 text-[10px] font-bold tracking-[.2em] text-[#55e6c2]">MACHINE-TO-MACHINE INTELLIGENCE</p>
          <h1 className="text-5xl font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl">Threat data that<br /><em className="not-italic text-[#b8f34b]">agents can buy.</em></h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#93a89f]">Discover human-verified cyber intelligence services. Pay per query in HBAR. Audit every result on-chain.</p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row">
            <button onClick={investigate} className="flex items-center justify-center gap-2 rounded bg-[#b8f34b] px-4 py-3 text-xs font-bold text-[#07100d] transition hover:-translate-y-0.5 hover:bg-[#cbff67]"><Bot size={16} />Run investigation<ChevronRight size={15} /></button>
            <button onClick={onProvider} className="flex items-center justify-center gap-2 rounded border border-[#30463f] px-4 py-3 text-xs font-bold transition hover:bg-white/[.04]"><Plus size={16} />Publish a service</button>
          </div>
        </div>
        <SignalVisual />
      </div>

      <div className="my-7 grid grid-cols-2 overflow-hidden border border-[#1d3029] bg-[#0a1512] xl:grid-cols-4">
        <Metric icon={<Database size={18} />} label="Available services" value={servicesLoading ? "…" : String(services.length)} detail="live from registry" />
        <Metric icon={<Zap size={18} />} label="Queries fulfilled" value="34,982" detail="across testnet" />
        <Metric icon={<CircleDollarSign size={18} />} label="Total settled" value="486.2" detail="HBAR" />
        <Metric icon={<UserRoundCheck size={18} />} label="Verified providers" value={servicesLoading ? "…" : String(new Set(services.map(s => s.providerId)).size)} detail="World ID backed" />
      </div>

      {/* ── search + filter ── */}
      <div className="mb-5 mt-16">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[.2em] text-[#55e6c2]">SERVICE REGISTRY</p>
            <h2 className="text-3xl font-semibold tracking-tight">Live intelligence feeds</h2>
          </div>
          <span className="hidden text-[9px] font-bold tracking-[.15em] text-[#657970] sm:block">{filtered.length} SERVICES ONLINE</span>
        </div>

        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82988f]" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search intelligence feeds…"
            className="w-full rounded border border-[#1d3029] bg-[#0a1512] py-2.5 pl-9 pr-4 font-mono text-xs text-white placeholder-[#4a5f6a] outline-none transition focus:border-[#9333ea]/60 focus:shadow-[0_0_0_1px_rgba(147,51,234,0.3)]" />
          {query && <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#82988f] hover:text-white">✕</button>}
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button key={tag.id} onClick={() => setFilter(tag.id)}
              className={`rounded border px-3 py-1.5 font-mono text-[9px] font-bold tracking-widest transition ${filter === tag.id
                ? tag.id === "bazantic" ? "border-[#f97316]/50 bg-[#f97316]/15 text-[#f97316]" : "border-[#9333ea]/50 bg-[#9333ea]/15 text-white"
                : "border-[#1d3029] bg-transparent text-[#4a5f6a] hover:border-[#2d4838] hover:text-[#82988f]"}`}>
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      {servicesLoading && (
        <div className="grid min-h-[200px] place-items-center font-mono text-[10px] text-[#4a5f6a]">
          <span className="animate-pulse">Loading services from registry…</span>
        </div>
      )}
      {servicesError && (
        <div className="mb-4 rounded border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 font-mono text-[10px] text-[#ef4444]">
          Registry unavailable: {servicesError} — showing cached services once backend is running.
        </div>
      )}
      {!servicesLoading && filtered.length > 0 && <ServiceGrid services={filtered} onTry={investigate} />}
      {!servicesLoading && !servicesError && filtered.length === 0 && (
        <div className="grid min-h-[200px] place-items-center rounded border border-[#1d3029] bg-[#0a1512] font-mono text-[10px] text-[#4a5f6a]">
          No services match "{query}"
        </div>
      )}
    </section>
  );
}

function SignalVisual() {
  return (
    <div className="relative hidden h-[390px] bg-transparent lg:block">
      <GitHubGlobe />
    </div>
  );
}

function useCountUp(target: number, duration = 1800) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start    = performance.now();
        const animate  = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          // ease-out cubic
          const eased   = 1 - Math.pow(1 - progress, 3);
          setCount(Math.floor(eased * target));
          if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration]);
  return { count, ref };
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  // parse a numeric value out of the string (strip commas, dots-as-decimal)
  const numeric = parseFloat(value.replace(/,/g, ""));
  const isFloat = value.includes(".");
  const { count, ref } = useCountUp(isNaN(numeric) ? 0 : numeric);

  const display = isNaN(numeric)
    ? value
    : isFloat
    ? count.toFixed(1)
    : count.toLocaleString();

  return (
    <div ref={ref} className="flex gap-3 border-b border-r border-[#1d3029] p-5 text-[#55e6c2] xl:border-b-0">
      <span>{icon}</span>
      <span>
        <small className="block text-[9px] font-bold uppercase tracking-[.08em] text-[#82988f]">{label}</small>
        <strong className="mt-2 block font-mono text-2xl tabular-nums text-white">{display}</strong>
        <em className="mt-1 block text-[9px] not-italic text-[#647a71]">{detail}</em>
      </span>
    </div>
  );
}

function PageHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="mb-12 max-w-3xl"><p className="mb-3 text-[10px] font-bold tracking-[.2em] text-[#55e6c2]">{eyebrow}</p><h1 className="text-4xl font-semibold tracking-[-.045em] sm:text-6xl">{title}</h1><p className="mt-5 max-w-2xl leading-7 text-[#82988f]">{text}</p></div>;
}

function Monitor({ events, running, investigate, activeStep, agentOnline }: { events: AgentEvent[]; running: boolean; investigate: () => void; activeStep: number; agentOnline: boolean }) {
  return (
    <section className="view-enter pb-20"><PageHead eyebrow="AUTONOMOUS WORKFLOW" title="Agent activity monitor" text="Watch discovery, x402 settlement, and intelligence delivery happen in real time." />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="overflow-hidden rounded-lg border border-[#1d3029] bg-[#0a1512]">
          <div className="flex h-12 items-center border-b border-[#1d3029] px-4">
            <div className="flex gap-1.5"><i className="h-2 w-2 rounded-full bg-[#da665b]" /><i className="h-2 w-2 rounded-full bg-[#ffbd59]" /><i className="h-2 w-2 rounded-full bg-[#6bbf73]" /></div>
            <small className="mx-auto font-mono text-[9px] text-[#82988f]">
              agent-investigator-01 · {agentOnline ? <span className="text-[#b8f34b]">● live</span> : <span className="text-[#ff6b6b]">● offline — start the agent to connect</span>}
            </small>
            <button onClick={investigate} disabled={running || !agentOnline} className="border border-[#3e5626] px-2 py-1 font-mono text-[8px] text-[#b8f34b] disabled:opacity-40">
              {running ? "RUNNING…" : agentOnline ? "RUN AGAIN" : "OFFLINE"}
            </button>
          </div>
          <div className="p-5">
            {activeStep === -1 && !running ? (
              <div className="grid min-h-[360px] place-items-center text-center text-[#53675f]">
                <div>
                  <Terminal size={30} className="mx-auto" />
                  <p className="my-4 text-xs">No active investigation</p>
                  {agentOnline
                    ? <button onClick={investigate} className="text-[10px] text-[#b8f34b]">Start agent workflow</button>
                    : <p className="text-[9px] text-[#ff6b6b]/70">Start the agent process to enable live monitoring</p>
                  }
                </div>
              </div>
            ) : (
              <AgentTimeline activeStep={activeStep} running={running} />
            )}
          </div>
        </div>
        <aside className="h-max rounded-lg border border-[#1d3029] bg-[#0a1512] p-6">
          <div className="relative mb-6 grid h-14 w-14 place-items-center rounded border border-[#4c672b] bg-[#15221a] text-[#b8f34b]">
            <Bot size={28} />
            <i className={`absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-[#07100d] ${agentOnline ? "bg-[#b8f34b]" : "bg-[#ff6b6b]"}`} />
          </div>
          <p className="mb-1 text-[9px] font-bold tracking-[.18em] text-[#55e6c2]">ACTIVE AGENT</p>
          <h3 className="mb-6 text-lg font-semibold">Investigator-01</h3>
          <dl className="space-y-0 text-[10px]">
            {[
              ["Status",       agentOnline ? "● Online" : "● Offline"],
              ["Human backing","✓ Verified"],
              ["Budget cap",   "1.00 HBAR"],
              ["Spent this run", events.some(e => e.stage === "paid") ? "~0.01 HBAR" : "0.00 HBAR"],
              ["Network",      "Hedera testnet"],
            ].map(([key, value]) => (
              <div key={key} className="flex justify-between border-b border-[#1d3029] py-3">
                <dt className="text-[#82988f]">{key}</dt>
                <dd className={key === "Human backing" || (key === "Status" && agentOnline) ? "text-[#b8f34b]" : key === "Status" ? "text-[#ff6b6b]" : "text-[#bfd0c9]"}>{value}</dd>
              </div>
            ))}
          </dl>
          {/* HashScan link — wire in live testnet transaction ID from Member 1 */}
          <a href="https://hashscan.io/testnet" target="_blank" rel="noreferrer" className="mt-6 flex items-center gap-1 text-[10px] text-[#55e6c2]">View HCS audit trail<ArrowUpRight size={13} /></a>
        </aside>
      </div>
    </section>
  );
}

function Provider({ verified, notice, publish, verify, publishing }: { verified: boolean; notice: string; publish: (event: FormEvent<HTMLFormElement>) => void; verify: () => void; publishing: boolean }) {
  return (
    <section className="view-enter pb-20">
      <PageHead eyebrow="PROVIDER CONSOLE" title="Publish intelligence" text="List a metered API for autonomous agents. Selfie Check is required before publishing." />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="relative">
          <form onSubmit={publish} className={`rounded-lg border border-[#1d3029] bg-[#0a1512] p-6 transition-all duration-300 ${!verified ? "pointer-events-none select-none opacity-30 blur-[2px]" : ""}`}>
            <div className="mb-7 flex items-center gap-3 text-[#55e6c2]"><Server size={20} /><span><strong className="block text-sm text-white">New service</strong><small className="text-[8px] tracking-[.12em] text-[#82988f]">REGISTRY ENTRY</small></span></div>
            <Field label="Service name"><input name="svc-name" required placeholder="e.g. Domain Risk Score" /></Field>
            <Field label="Description"><textarea name="svc-description" required rows={3} placeholder="What intelligence does your API provide?" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Query type"><select name="svc-queryType" defaultValue="ip"><option value="ip">IP address</option><option value="hash">File hash</option></select></Field>
              <Field label="Price per call"><input name="svc-price" required type="number" min="0.001" step="0.001" defaultValue="0.01" /></Field>
            </div>
            <Field label="Endpoint URL"><input name="svc-endpoint" required type="url" placeholder="https://api.example.com/intel" /></Field>
            <button disabled={publishing} className="flex w-full items-center justify-center gap-2 rounded bg-[#b8f34b] py-3 text-xs font-bold text-[#07100d] disabled:opacity-60">
              <Plus size={16} />{publishing ? "Publishing…" : "Publish to registry"}
            </button>
            {notice && <p className={`mt-4 text-center text-[10px] ${notice.startsWith("Publish failed") ? "text-[#ff6b6b]" : "text-[#55e6c2]"}`}>{notice}</p>}
          </form>

          {!verified && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 rounded-lg border border-[#9333ea]/30 bg-[#07100d]/80 backdrop-blur-md">
              <div className="grid h-20 w-20 place-items-center rounded-full border border-[#9333ea]/40 bg-[#9333ea]/10 shadow-[0_0_40px_rgba(147,51,234,0.25)]">
                <LockKeyhole size={36} className="text-[#9333ea]" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-white">Publishing locked</p>
                <p className="mt-2 max-w-xs text-xs leading-5 text-[#82988f]">Complete World ID Selfie Check to prove you are a unique human before publishing a service. This prevents sybil attacks on the marketplace.</p>
              </div>
              <button type="button" onClick={verify} className="flex items-center gap-2 rounded border border-[#b8f34b]/40 bg-[#b8f34b]/10 px-5 py-2.5 font-mono text-[10px] font-bold tracking-widest text-[#b8f34b] transition hover:bg-[#b8f34b]/20">
                <ShieldCheck size={14} /> COMPLETE SELFIE CHECK
              </button>
              <p className="font-mono text-[8px] tracking-widest text-[#3a4f47]">WORLD ID · ZERO KNOWLEDGE PROOF</p>
            </div>
          )}
        </div>

        <aside className="h-max rounded-lg border border-[#1d3029] bg-[#0a1512] p-6">
          <p className="text-[9px] font-bold tracking-[.18em] text-[#55e6c2]">PROVIDER EARNINGS</p>
          <strong className="mt-6 block text-3xl">24.82 <small className="text-[9px] text-[#82988f]">HBAR</small></strong>
          <span className="mt-1 block text-[9px] text-[#b8f34b]">+18.4% this week</span>
          <div className="mt-8 flex h-36 items-end gap-1 border-b border-[#1d3029]">
            {[28,42,34,58,48,74,88,68,96,82,104,120].map((height, index) => (
              <i key={index} className="bar-grow flex-1 bg-gradient-to-t from-[#416025] to-[#b8f34b] opacity-80" style={{ height }} />
            ))}
          </div>
          {verified && (
            <div className="mt-5 flex items-center gap-2 rounded border border-[#405c27] bg-[#142016] px-3 py-2">
              <ShieldCheck size={14} className="text-[#b8f34b]" /><span className="font-mono text-[9px] font-bold text-[#b8f34b]">IDENTITY VERIFIED</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mb-4 block text-[9px] font-bold tracking-[.06em] text-[#a8bbb3] [&_input]:mt-2 [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-[#293d36] [&_input]:bg-[#07100d] [&_input]:p-3 [&_input]:text-xs [&_textarea]:mt-2 [&_textarea]:w-full [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-[#293d36] [&_textarea]:bg-[#07100d] [&_textarea]:p-3 [&_textarea]:text-xs [&_select]:mt-2 [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-[#293d36] [&_select]:bg-[#07100d] [&_select]:p-3 [&_select]:text-xs">{label}{children}</label>;
}

function Verification({ verified, complete }: { verified: boolean; complete: () => void }) {
  return (
    <section className="view-enter pb-20"><div className="mx-auto max-w-3xl text-center"><PageHead eyebrow="WORLD IDENTITY" title="Prove personhood, preserve privacy" text="One human, one provider. Verification prevents sybil abuse without exposing personal information." /></div>
      <div className="mx-auto max-w-md rounded-lg border border-[#1d3029] bg-[#0a1512] p-8 text-center">
        <div className="relative mx-auto mb-6 grid h-32 w-32 place-items-center overflow-hidden rounded-full border border-[#3d5b29] bg-[radial-gradient(circle,#1b2c1a,#0a1512_70%)] text-[#b8f34b]"><ScanFace size={72} /><i className="scan-line absolute h-px w-full bg-[#b8f34b] shadow-[0_0_10px_#b8f34b]" /></div>
        <div className="inline-flex items-center gap-1.5 text-[9px] font-bold tracking-[.12em] text-[#55e6c2]"><Sparkles size={14} />WORLD ID SANDBOX</div><h2 className="my-4 text-2xl font-semibold">{verified ? "You're verified" : "Complete Selfie Check"}</h2><p className="text-xs leading-6 text-[#82988f]">{verified ? "This demo identity can publish services and back autonomous agents." : "A quick facial uniqueness check confirms that a real, unique human controls this provider account."}</p>
        <div className="my-6 flex gap-3 rounded border border-[#23473d] bg-[#0c211b] p-3 text-left text-[#55e6c2]"><ShieldCheck size={18} /><span><strong className="block text-[10px] text-[#bcd1c8]">Privacy preserved</strong><small className="text-[8px] text-[#6f8d82]">No image is stored. Only a zero-knowledge proof is shared.</small></span></div>
        <button onClick={complete} disabled={verified} className="flex w-full items-center justify-center gap-2 rounded bg-[#b8f34b] py-3 text-xs font-bold text-[#07100d] disabled:opacity-60">{verified ? <><Check size={17} />Verification complete</> : <><ScanFace size={17} />Start Selfie Check</>}</button><small className="mt-3 block text-[8px] tracking-[.12em] text-[#51655d]">DEMO MODE · WORLD ID SANDBOX PLACEHOLDER</small>
      </div>
    </section>
  );
}

export default App;
