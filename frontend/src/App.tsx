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
import { ThemeToggle } from "./components/ThemeToggle";
import { BackgroundBeams } from "./components/ui/background-beams";
import { RealisticNightGlobe } from "./components/ui/realistic-night-globe";
import { apiFetch, BACKEND_URL, AGENT_EVENTS_URL, fetchWorldRequestConfig, type WorldRequestConfig } from "./api";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";
import {
  connectHashPack,
  disconnectHashPack,
  fundAgent,
  isConnected as isHashPackConnected,
} from "./lib/hashpack";
import { fetchAccountBalanceHbar } from "./lib/mirror";

type View = "marketplace" | "monitor" | "provider" | "verify" | "wallet";
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
  discover: "text-cim-cyan", call: "text-cim-cyan", "402": "text-cim-warning",
  paying: "text-cim-warning", paid: "text-cim-cyan", data: "text-cim-cyan",
};

const nav = [
  { id: "marketplace" as const, label: "Marketplace", icon: LayoutGrid },
  { id: "monitor"     as const, label: "Agent monitor", icon: Activity },
  { id: "provider"    as const, label: "Provider", icon: Server },
  { id: "wallet"      as const, label: "Fund agent", icon: WalletCards },
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
  /** Real World ID proof (JSON string) captured by IDKit; sent when publishing. */
  const [verifiedProof, setVerifiedProof] = useState<string | null>(null);
  const [notice,   setNotice]   = useState("");
  const [publishing, setPublishing] = useState(false);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verified || !verifiedProof) { setNotice("Complete Selfie Check before publishing."); setView("verify"); return; }
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
          // Real World ID proof captured by IDKit on the verify screen.
          "X-Selfie-Check-Proof": verifiedProof,
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
    <div className="min-h-screen bg-cim-canvas text-cim-text">
      <BackgroundBeams />

      {/* ── sidebar ── */}
      <aside
        style={{ width: collapsed ? "72px" : "238px" }}
        className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r border-cim-border sidebar-glass backdrop-blur transition-[width] duration-200 ease-in-out md:flex"
      >
        {/* brand + collapse toggle */}
        <div className={`flex items-center pt-4 ${collapsed ? "justify-center px-2" : "justify-between px-3"}`}>
          <button onClick={() => setView("marketplace")} className="flex items-center gap-3 text-left">
            <img src="/cim-mark.webp" alt="CIM logo" className="h-10 w-10 flex-shrink-0 object-contain" />
            {!collapsed && <span><strong className="block text-sm tracking-[.16em]">CIM</strong><small className="block text-[9px] tracking-[.14em] text-cim-muted">CYBER INTEL MARKET</small></span>}
          </button>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="ml-2 rounded p-1.5 text-cim-faint transition hover:bg-cim-surface-3 hover:text-cim-text" aria-label="Collapse sidebar">
              <PanelLeftClose size={15} />
            </button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mt-3 rounded p-1.5 text-cim-faint transition hover:bg-cim-surface-3 hover:text-cim-text" aria-label="Expand sidebar">
            <PanelLeftOpen size={15} />
          </button>
        )}

        {/* nav */}
        <nav className="mt-10 px-2">
          {!collapsed && <p className="mb-3 px-2 text-[9px] font-bold tracking-[.18em] text-cim-subtle">OPERATIONS</p>}
          <div className="space-y-1">
            {nav.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setView(id)} title={collapsed ? label : undefined}
                className={`relative flex w-full items-center gap-3 rounded-md border px-2.5 py-2.5 text-left text-xs transition ${collapsed ? "justify-center" : ""} ${view === id ? "border-cim-border-strong bg-cim-surface-2 text-cim-text before:absolute before:-left-[9px] before:h-5 before:w-[3px] before:bg-cim-cyan before:shadow-[0_0_14px_rgba(24,213,242,0.45)]" : "border-transparent text-cim-muted hover:bg-cim-surface-3 hover:text-cim-text"}`}>
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
                {!collapsed && id === "monitor" && events.length > 0 && <i className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-cim-cyan text-[9px] font-bold not-italic text-cim-on-accent">{events.length}</i>}
                {collapsed && id === "monitor" && events.length > 0 && <i className="absolute right-1 top-1 h-2 w-2 rounded-full bg-cim-cyan" />}
              </button>
            ))}
          </div>
        </nav>

        {/* network card */}
        <div className={`mt-auto mx-2 mb-4 rounded-lg border border-cim-border bg-cim-surface-2 ${collapsed ? "p-2" : "p-4"}`}>
          {collapsed
            ? <div className="grid place-items-center"><i className="h-2 w-2 animate-pulse rounded-full bg-cim-success shadow-[0_0_10px_rgba(52,211,153,0.55)]" /></div>
            : <><div className="flex items-center gap-2 text-[9px] font-bold tracking-[.12em] text-cim-cyan"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cim-success shadow-[0_0_10px_rgba(52,211,153,0.55)]" />HEDERA TESTNET</div><strong className="mt-3 block font-mono text-xs">0.0.10446789</strong><small className="mt-1 block text-[9px] text-cim-muted">Agent {agentOnline ? <span className="text-cim-success">● online</span> : <span className="text-cim-danger">● offline</span>}</small></>
          }
        </div>
      </aside>

      {/* ── main ── */}
      <div className="min-w-0 transition-[margin] duration-200 ease-in-out" style={{ marginLeft: collapsed ? "72px" : "238px" }}>
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-cim-border header-glass px-5 backdrop-blur-xl lg:px-10">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[.12em] md:hidden"><img src="/cim-mark.webp" alt="CIM logo" className="h-[18px] w-[18px] object-contain" /> CIM</div>
          <div className="ml-auto flex items-center gap-5">
            <span className="hidden items-center gap-2 text-[9px] font-bold tracking-[.13em] text-cim-subtle sm:flex"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cim-success" />SYSTEMS OPERATIONAL</span>
            <ThemeToggle />
            <button onClick={() => setView("verify")} className={`flex items-center gap-2 rounded border px-3 py-2 text-[9px] font-bold tracking-[.08em] ${verified ? "border-cim-cyan/40 bg-cim-surface-2 text-cim-cyan" : "border-cim-border-strong bg-cim-surface-2 text-cim-text"}`}>
              {verified ? <ShieldCheck size={15} /> : <ScanFace size={15} />}{verified ? "HUMAN VERIFIED" : "VERIFY HUMAN"}
            </button>
          </div>
        </header>

        <main className="cyber-grid mx-auto min-h-[calc(100vh-72px)] max-w-[1500px] px-5 py-12 lg:px-10">
          {view === "marketplace" && <Marketplace services={services} servicesLoading={servicesLoading} servicesError={servicesError} investigate={investigate} onProvider={() => setView("provider")} />}
          {view === "monitor" && <Monitor events={events} running={running} investigate={investigate} activeStep={activeStep} agentOnline={agentOnline} />}
          {view === "provider" && <Provider verified={verified} notice={notice} publish={publish} verify={() => setView("verify")} publishing={publishing} />}
          {view === "wallet" && <FundAgent />}
          {view === "verify" && <Verification verified={verified} complete={(proof) => { setVerified(true); setVerifiedProof(proof); setNotice(""); }} />}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-4 border-t border-cim-border sidebar-glass p-2 backdrop-blur md:hidden">
        {nav.map(({ id, icon: Icon }) => <button key={id} onClick={() => setView(id)} className={`grid place-items-center rounded ${view === id ? "text-cim-cyan" : "text-cim-subtle"}`} aria-label={id}><Icon size={19} /></button>)}
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
      <div className="grid min-h-[390px] items-center gap-10 border-b border-cim-border lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <p className="mb-3 text-[10px] font-bold tracking-[.2em] text-cim-cyan">MACHINE-TO-MACHINE INTELLIGENCE</p>
          <h1 className="text-5xl font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl">Threat data that<br /><em className="brand-gradient-text not-italic">agents can buy.</em></h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-cim-muted">Discover human-verified cyber intelligence services. Pay per query in HBAR. Audit every result on-chain.</p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row">
            <button onClick={investigate} className="brand-button flex items-center justify-center gap-2 rounded px-4 py-3 text-xs font-bold transition hover:-translate-y-0.5"><Bot size={16} />Run investigation<ChevronRight size={15} /></button>
            <button onClick={onProvider} className="flex items-center justify-center gap-2 rounded border border-cim-border-strong px-4 py-3 text-xs font-bold transition hover:bg-cim-surface-3"><Plus size={16} />Publish a service</button>
          </div>
        </div>
        <SignalVisual />
      </div>

      <div className="my-7 grid grid-cols-2 overflow-hidden border border-cim-border bg-cim-surface xl:grid-cols-4">
        <Metric icon={<Database size={18} />} label="Available services" value={servicesLoading ? "…" : String(services.length)} detail="live from registry" />
        <Metric icon={<Zap size={18} />} label="Queries fulfilled" value="34,982" detail="across testnet" />
        <Metric icon={<CircleDollarSign size={18} />} label="Total settled" value="486.2" detail="HBAR" />
        <Metric icon={<UserRoundCheck size={18} />} label="Verified providers" value={servicesLoading ? "…" : String(new Set(services.map(s => s.providerId)).size)} detail="World ID backed" />
      </div>

      {/* ── search + filter ── */}
      <div className="mb-5 mt-16">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[.2em] text-cim-cyan">SERVICE REGISTRY</p>
            <h2 className="text-3xl font-semibold tracking-tight">Live intelligence feeds</h2>
          </div>
          <span className="hidden text-[9px] font-bold tracking-[.15em] text-cim-subtle sm:block">{filtered.length} SERVICES ONLINE</span>
        </div>

        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cim-muted" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search intelligence feeds…"
            className="w-full rounded border border-cim-border bg-cim-surface py-2.5 pl-9 pr-4 font-mono text-xs text-cim-text placeholder:text-cim-faint outline-none transition focus:border-cim-violet/60 focus:shadow-[0_0_0_1px_rgba(124,58,237,0.3)]" />
          {query && <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-cim-muted hover:text-cim-text">✕</button>}
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button key={tag.id} onClick={() => setFilter(tag.id)}
              className={`rounded border px-3 py-1.5 font-mono text-[9px] font-bold tracking-widest transition ${filter === tag.id
                ? tag.id === "bazantic" ? "border-[#f97316]/50 bg-[#f97316]/15 text-[#f97316]" : "border-cim-violet/50 bg-cim-violet/15 text-cim-text"
                : "border-cim-border bg-transparent text-cim-faint hover:border-cim-border-strong hover:text-cim-muted"}`}>
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      {servicesLoading && (
        <div className="grid min-h-[200px] place-items-center font-mono text-[10px] text-cim-faint">
          <span className="animate-pulse">Loading services from registry…</span>
        </div>
      )}
      {servicesError && (
        <div className="mb-4 rounded border border-cim-danger/30 bg-cim-danger/10 px-4 py-3 font-mono text-[10px] text-cim-danger">
          Registry unavailable: {servicesError} — showing cached services once backend is running.
        </div>
      )}
      {!servicesLoading && filtered.length > 0 && <ServiceGrid services={filtered} onTry={investigate} />}
      {!servicesLoading && !servicesError && filtered.length === 0 && (
        <div className="grid min-h-[200px] place-items-center rounded border border-cim-border bg-cim-surface font-mono text-[10px] text-cim-faint">
          No services match "{query}"
        </div>
      )}
    </section>
  );
}

function SignalVisual() {
  return (
    <div className="relative hidden h-[390px] bg-transparent lg:block">
      <RealisticNightGlobe />
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
    <div ref={ref} className="flex gap-3 border-b border-r border-cim-border p-5 text-cim-cyan xl:border-b-0">
      <span>{icon}</span>
      <span>
        <small className="block text-[9px] font-bold uppercase tracking-[.08em] text-cim-muted">{label}</small>
        <strong className="mt-2 block font-mono text-2xl tabular-nums text-cim-text">{display}</strong>
        <em className="mt-1 block text-[9px] not-italic text-cim-subtle">{detail}</em>
      </span>
    </div>
  );
}

function PageHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="mb-12 max-w-3xl"><p className="mb-3 text-[10px] font-bold tracking-[.2em] text-cim-cyan">{eyebrow}</p><h1 className="text-4xl font-semibold tracking-[-.045em] sm:text-6xl">{title}</h1><p className="mt-5 max-w-2xl leading-7 text-cim-muted">{text}</p></div>;
}

function Monitor({ events, running, investigate, activeStep, agentOnline }: { events: AgentEvent[]; running: boolean; investigate: () => void; activeStep: number; agentOnline: boolean }) {
  return (
    <section className="view-enter pb-20"><PageHead eyebrow="AUTONOMOUS WORKFLOW" title="Agent activity monitor" text="Watch discovery, x402 settlement, and intelligence delivery happen in real time." />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="overflow-hidden rounded-lg border border-cim-border bg-cim-surface">
          <div className="flex h-12 items-center border-b border-cim-border px-4">
            <div className="flex gap-1.5"><i className="h-2 w-2 rounded-full bg-[#da665b]" /><i className="h-2 w-2 rounded-full bg-cim-warning" /><i className="h-2 w-2 rounded-full bg-[#6bbf73]" /></div>
            <small className="mx-auto font-mono text-[9px] text-cim-muted">
              agent-investigator-01 · {agentOnline ? <span className="text-cim-cyan">● live</span> : <span className="text-cim-danger">● offline — start the agent to connect</span>}
            </small>
            <button onClick={investigate} disabled={running || !agentOnline} className="border border-cim-cyan/35 px-2 py-1 font-mono text-[8px] text-cim-cyan disabled:opacity-40">
              {running ? "RUNNING…" : agentOnline ? "RUN AGAIN" : "OFFLINE"}
            </button>
          </div>
          <div className="p-5">
            {activeStep === -1 && !running ? (
              <div className="grid min-h-[360px] place-items-center text-center text-cim-subtle">
                <div>
                  <Terminal size={30} className="mx-auto" />
                  <p className="my-4 text-xs">No active investigation</p>
                  {agentOnline
                    ? <button onClick={investigate} className="text-[10px] text-cim-cyan">Start agent workflow</button>
                    : <p className="text-[9px] text-cim-danger/70">Start the agent process to enable live monitoring</p>
                  }
                </div>
              </div>
            ) : (
              <AgentTimeline activeStep={activeStep} running={running} events={events} />
            )}
          </div>
        </div>
        <aside className="h-max rounded-lg border border-cim-border bg-cim-surface p-6">
          <div className="relative mb-6 grid h-14 w-14 place-items-center rounded border border-cim-cyan/35 bg-cim-surface-2 text-cim-cyan">
            <Bot size={28} />
            <i className={`absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-cim-canvas ${agentOnline ? "bg-cim-success" : "bg-cim-danger"}`} />
          </div>
          <p className="mb-1 text-[9px] font-bold tracking-[.18em] text-cim-cyan">ACTIVE AGENT</p>
          <h3 className="mb-6 text-lg font-semibold">Investigator-01</h3>
          <dl className="space-y-0 text-[10px]">
            {[
              ["Status",       agentOnline ? "● Online" : "● Offline"],
              ["Human backing","✓ Verified"],
              ["Budget cap",   "1.00 HBAR"],
              ["Spent this run", events.some(e => e.stage === "paid") ? "~0.01 HBAR" : "0.00 HBAR"],
              ["Network",      "Hedera testnet"],
            ].map(([key, value]) => (
              <div key={key} className="flex justify-between border-b border-cim-border py-3">
                <dt className="text-cim-muted">{key}</dt>
                <dd className={key === "Human backing" || (key === "Status" && agentOnline) ? "text-cim-success" : key === "Status" ? "text-cim-danger" : "text-cim-text"}>{value}</dd>
              </div>
            ))}
          </dl>
          <AgentBalance />
          {/* HashScan link — wire in live testnet transaction ID from Member 1 */}
          <a href="https://hashscan.io/testnet" target="_blank" rel="noreferrer" className="mt-6 flex items-center gap-1 text-[10px] text-cim-cyan">View HCS audit trail<ArrowUpRight size={13} /></a>
        </aside>
      </div>
    </section>
  );
}

/**
 * Live agent balance — reads the agent account (from /agent-info) and its
 * HBAR balance from the public Hedera mirror node. Auto-refreshes every 15s
 * and offers a manual refresh.
 */
function AgentBalance() {
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (acct: string) => {
    setLoading(true);
    setError(null);
    try {
      setBalance(await fetchAccountBalanceHbar(acct));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Discover the agent account once.
  useEffect(() => {
    apiFetch<{ agentAccountId: string | null }>(`${BACKEND_URL}/agent-info`)
      .then((d) => setAccount(d.agentAccountId))
      .catch(() => setAccount(null));
  }, []);

  // Fetch + poll the balance whenever we have an account.
  useEffect(() => {
    if (!account) return;
    refresh(account);
    const id = setInterval(() => refresh(account), 15000);
    return () => clearInterval(id);
  }, [account, refresh]);

  return (
    <div className="mt-6 rounded border border-cim-border-strong bg-cim-surface-2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-[.14em] text-cim-cyan">
          <WalletCards size={13} /> AGENT BALANCE
        </span>
        <button
          onClick={() => account && refresh(account)}
          disabled={!account || loading}
          className="text-[8px] font-bold tracking-[.1em] text-cim-muted hover:text-cim-text disabled:opacity-40"
        >
          {loading ? "…" : "↻ REFRESH"}
        </button>
      </div>
      {error ? (
        <p className="text-[10px] text-cim-danger">{error}</p>
      ) : (
        <p className="font-mono text-lg text-cim-cyan">
          {balance === null ? "—" : `${balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} `}
          {balance !== null && <span className="text-xs text-cim-subtle">HBAR</span>}
        </p>
      )}
      {account && (
        <a
          href={`https://hashscan.io/testnet/account/${account}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 flex items-center gap-1 font-mono text-[9px] text-cim-subtle hover:text-cim-cyan"
        >
          {account} <ArrowUpRight size={11} />
        </a>
      )}
    </div>
  );
}

function Provider({ verified, notice, publish, verify, publishing }: { verified: boolean; notice: string; publish: (event: FormEvent<HTMLFormElement>) => void; verify: () => void; publishing: boolean }) {
  return (
    <section className="view-enter pb-20">
      <PageHead eyebrow="PROVIDER CONSOLE" title="Publish intelligence" text="List a metered API for autonomous agents. Selfie Check is required before publishing." />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="relative">
          <form onSubmit={publish} className={`rounded-lg border border-cim-border bg-cim-surface p-6 transition-all duration-300 ${!verified ? "pointer-events-none select-none opacity-30 blur-[2px]" : ""}`}>
            <div className="mb-7 flex items-center gap-3 text-cim-cyan"><Server size={20} /><span><strong className="block text-sm text-cim-text">New service</strong><small className="text-[8px] tracking-[.12em] text-cim-muted">REGISTRY ENTRY</small></span></div>
            <Field label="Service name"><input name="svc-name" required placeholder="e.g. Domain Risk Score" /></Field>
            <Field label="Description"><textarea name="svc-description" required rows={3} placeholder="What intelligence does your API provide?" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Query type"><select name="svc-queryType" defaultValue="ip"><option value="ip">IP address</option><option value="hash">File hash</option></select></Field>
              <Field label="Price per call"><input name="svc-price" required type="number" min="0.001" step="0.001" defaultValue="0.01" /></Field>
            </div>
            <Field label="Endpoint URL"><input name="svc-endpoint" required type="url" placeholder="https://api.example.com/intel" /></Field>
            <button disabled={publishing} className="flex w-full items-center justify-center gap-2 rounded bg-cim-cyan py-3 text-xs font-bold text-cim-on-accent disabled:opacity-60">
              <Plus size={16} />{publishing ? "Publishing…" : "Publish to registry"}
            </button>
            {notice && <p className={`mt-4 text-center text-[10px] ${notice.startsWith("Publish failed") ? "text-cim-danger" : "text-cim-cyan"}`}>{notice}</p>}
          </form>

          {!verified && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 rounded-lg border border-cim-violet/30 theme-overlay backdrop-blur-md">
              <div className="grid h-20 w-20 place-items-center rounded-full border border-cim-violet/40 bg-cim-violet/10 shadow-[0_0_40px_rgba(124,58,237,0.25)]">
                <LockKeyhole size={36} className="text-cim-violet" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-cim-text">Publishing locked</p>
                <p className="mt-2 max-w-xs text-xs leading-5 text-cim-muted">Complete World ID Selfie Check to prove you are a unique human before publishing a service. This prevents sybil attacks on the marketplace.</p>
              </div>
              <button type="button" onClick={verify} className="flex items-center gap-2 rounded border border-cim-cyan/40 bg-cim-cyan/10 px-5 py-2.5 font-mono text-[10px] font-bold tracking-widest text-cim-cyan transition hover:bg-cim-cyan/20">
                <ShieldCheck size={14} /> COMPLETE SELFIE CHECK
              </button>
              <p className="font-mono text-[8px] tracking-widest text-cim-faint">WORLD ID · ZERO KNOWLEDGE PROOF</p>
            </div>
          )}
        </div>

        <aside className="h-max rounded-lg border border-cim-border bg-cim-surface p-6">
          <p className="text-[9px] font-bold tracking-[.18em] text-cim-cyan">PROVIDER EARNINGS</p>
          <strong className="mt-6 block text-3xl">24.82 <small className="text-[9px] text-cim-muted">HBAR</small></strong>
          <span className="mt-1 block text-[9px] text-cim-cyan">+18.4% this week</span>
          <div className="mt-8 flex h-36 items-end gap-1 border-b border-cim-border">
            {[28,42,34,58,48,74,88,68,96,82,104,120].map((height, index) => (
              <i key={index} className="bar-grow flex-1 bg-gradient-to-t from-cim-blue to-cim-violet opacity-80" style={{ height }} />
            ))}
          </div>
          {verified && (
            <div className="mt-5 flex items-center gap-2 rounded border border-cim-cyan/35 bg-cim-surface-2 px-3 py-2">
              <ShieldCheck size={14} className="text-cim-cyan" /><span className="font-mono text-[9px] font-bold text-cim-cyan">IDENTITY VERIFIED</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mb-4 block text-[9px] font-bold tracking-[.06em] text-cim-muted [&_input]:mt-2 [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-cim-border-strong [&_input]:bg-cim-canvas [&_input]:p-3 [&_input]:text-xs [&_textarea]:mt-2 [&_textarea]:w-full [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-cim-border-strong [&_textarea]:bg-cim-canvas [&_textarea]:p-3 [&_textarea]:text-xs [&_select]:mt-2 [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-cim-border-strong [&_select]:bg-cim-canvas [&_select]:p-3 [&_select]:text-xs">{label}{children}</label>;
}

function Verification({ verified, complete }: { verified: boolean; complete: (proof: string) => void }) {
  // World ID 4.0 flow: ask the backend for a signed request (rp_context), then
  // open IDKit. On success we forward the full IDKit result (as JSON) up to App
  // state so it can be sent to the backend on publish, which verifies it with
  // World's /api/v4/verify/{rp_id}.
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<WorldRequestConfig | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setError("");
    setPreparing(true);
    try {
      const cfg = await fetchWorldRequestConfig();
      setConfig(cfg);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparing(false);
    }
  }

  const onSuccess = (result: IDKitResult) => {
    complete(JSON.stringify(result));
  };

  const scanHint = config?.environment === "staging"
    ? "Staging mode: open simulator.worldcoin.org and paste the QR link."
    : "Scan the QR with the World App on your phone.";

  return (
    <section className="view-enter pb-20"><div className="mx-auto max-w-3xl text-center"><PageHead eyebrow="WORLD IDENTITY" title="Prove personhood, preserve privacy" text="One human, one provider. Verification prevents sybil abuse without exposing personal information." /></div>
      <div className="mx-auto max-w-md rounded-lg border border-cim-border bg-cim-surface p-8 text-center">
        <div className="relative mx-auto mb-6 grid h-32 w-32 place-items-center overflow-hidden rounded-full border border-cim-cyan/35 bg-[radial-gradient(circle,var(--cim-surface-3),var(--cim-surface)_70%)] text-cim-cyan"><ScanFace size={72} /><i className="scan-line absolute h-px w-full bg-cim-cyan shadow-[0_0_12px_rgba(24,213,242,0.75)]" /></div>
        <div className="inline-flex items-center gap-1.5 text-[9px] font-bold tracking-[.12em] text-cim-cyan"><Sparkles size={14} />WORLD ID</div><h2 className="my-4 text-2xl font-semibold">{verified ? "You're verified" : "Verify with World ID"}</h2><p className="text-xs leading-6 text-cim-muted">{verified ? "This identity can publish services and back autonomous agents." : "Prove you're a unique human with World ID. Scan the QR with the World App (or the World Simulator) to generate a zero-knowledge proof."}</p>
        <div className="my-6 flex gap-3 rounded border border-cim-border-strong bg-cim-surface-2 p-3 text-left text-cim-cyan"><ShieldCheck size={18} /><span><strong className="block text-[10px] text-cim-text">Privacy preserved</strong><small className="text-[8px] text-cim-subtle">No image is stored. Only a zero-knowledge proof is shared.</small></span></div>
        {verified ? (
          <button disabled className="flex w-full items-center justify-center gap-2 rounded bg-cim-cyan py-3 text-xs font-bold text-cim-on-accent disabled:opacity-60"><Check size={17} />Verification complete</button>
        ) : (
          <button onClick={start} disabled={preparing} className="flex w-full items-center justify-center gap-2 rounded bg-cim-cyan py-3 text-xs font-bold text-cim-on-accent disabled:opacity-60"><ScanFace size={17} />{preparing ? "Preparing request…" : "Verify with World ID"}</button>
        )}
        {config && !verified && (
          <IDKitRequestWidget
            open={open}
            onOpenChange={setOpen}
            app_id={config.app_id}
            action={config.action}
            rp_context={config.rp_context}
            environment={config.environment}
            allow_legacy_proofs={true}
            preset={proofOfHuman()}
            onSuccess={onSuccess}
            onError={(code) => setError(`World ID error: ${code}`)}
          />
        )}
        {error && <p className="mt-3 text-[10px] leading-5 text-cim-danger">{error}</p>}
        <small className="mt-3 block text-[8px] tracking-[.12em] text-cim-subtle">{config ? scanHint.toUpperCase() : "WORLD ID · SCAN WITH WORLD APP OR SIMULATOR"}</small>
      </div>
    </section>
  );
}

/**
 * Fund-the-agent view — Option 1 wallet flow.
 *
 * The human connects HashPack ONCE and approves a single HBAR transfer to the
 * agent's own account. After that the agent spends autonomously with its own
 * key — no further wallet prompts. This is the only interactive wallet step.
 */
function FundAgent() {
  const [agentAccount, setAgentAccount] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(isHashPackConnected());
  const [account, setAccount] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("5");
  const [busy, setBusy] = useState<"idle" | "connecting" | "funding">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);

  // Discover which account the agent pays from (the fund recipient).
  useEffect(() => {
    apiFetch<{ agentAccountId: string | null }>(`${BACKEND_URL}/agent-info`)
      .then((d) => setAgentAccount(d.agentAccountId))
      .catch(() => setAgentAccount(null));
  }, []);

  const onConnect = async () => {
    setError(null);
    setBusy("connecting");
    try {
      const acct = await connectHashPack();
      setAccount(acct);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  };

  const onDisconnect = async () => {
    await disconnectHashPack().catch(() => {});
    setConnected(false);
    setAccount(null);
  };

  const onFund = async () => {
    setError(null);
    setTxId(null);
    if (!agentAccount) {
      setError("Agent account is not configured on the backend (AGENT_ACCOUNT_ID).");
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Enter a funding amount greater than zero.");
      return;
    }
    setBusy("funding");
    try {
      const id = await fundAgent(agentAccount, amt);
      setTxId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  };

  return (
    <section className="view-enter pb-20">
      <div className="mx-auto max-w-3xl text-center">
        <PageHead
          eyebrow="AGENT WALLET"
          title="Fund your agent once, then let it run"
          text="Connect HashPack and approve a single transfer to your agent's account. After that, the agent pays per query on its own — no wallet prompts, no human in the loop."
        />
      </div>

      <div className="mx-auto max-w-md rounded-lg border border-cim-border bg-cim-surface p-8">
        {/* Step 1 — connect */}
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-bold tracking-[.14em] text-cim-cyan">
            <WalletCards size={14} /> STEP 1 · CONNECT WALLET
          </div>
          {connected ? (
            <div className="flex items-center justify-between rounded border border-cim-cyan/40 bg-cim-surface-2 px-3 py-3 text-xs text-cim-cyan">
              <span className="flex items-center gap-2"><Check size={16} /> {account ?? "Connected"}</span>
              <button onClick={onDisconnect} className="text-[9px] font-bold tracking-[.1em] text-cim-muted hover:text-cim-text">DISCONNECT</button>
            </div>
          ) : (
            <button
              onClick={onConnect}
              disabled={busy !== "idle"}
              className="flex w-full items-center justify-center gap-2 rounded bg-cim-cyan py-3 text-xs font-bold text-cim-on-accent disabled:opacity-60"
            >
              <WalletCards size={17} />
              {busy === "connecting" ? "Opening HashPack…" : "Connect HashPack"}
            </button>
          )}
        </div>

        {/* Step 2 — fund */}
        <div className="mb-2 flex items-center gap-2 text-[9px] font-bold tracking-[.14em] text-cim-cyan">
          <CircleDollarSign size={14} /> STEP 2 · FUND AGENT
        </div>
        <div className="rounded border border-cim-border-strong bg-cim-surface-2 p-3">
          <div className="mb-3 flex items-center justify-between text-[10px] text-cim-muted">
            <span>Agent account</span>
            <span className="font-mono text-cim-text">{agentAccount ?? "not configured"}</span>
          </div>
          <label className="mb-1 block text-[9px] font-bold tracking-[.12em] text-cim-subtle">AMOUNT (HBAR)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mb-3 w-full rounded border border-cim-border-strong bg-cim-canvas px-3 py-2 font-mono text-sm text-cim-text"
          />
          <button
            onClick={onFund}
            disabled={!connected || busy !== "idle" || !agentAccount}
            className="flex w-full items-center justify-center gap-2 rounded border border-cim-cyan/35 bg-cim-surface-2 py-3 text-xs font-bold text-cim-cyan disabled:opacity-50"
          >
            <Zap size={16} />
            {busy === "funding" ? "Awaiting approval in HashPack…" : "Fund agent (one-time)"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded border border-cim-danger/30 bg-cim-danger/10 px-3 py-2 text-[10px] text-cim-danger">
            {error}
          </div>
        )}
        {txId && (
          <a
            href={`https://hashscan.io/testnet/transaction/${txId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center justify-between rounded border border-cim-cyan/40 bg-cim-surface-2 px-3 py-3 text-[10px] text-cim-cyan"
          >
            <span className="flex items-center gap-2"><Check size={14} /> Funded — view on HashScan</span>
            <ArrowUpRight size={14} />
          </a>
        )}

        <div className="mt-6 flex gap-3 rounded border border-cim-border-strong bg-cim-surface-2 p-3 text-left text-cim-cyan">
          <Bot size={18} />
          <span>
            <strong className="block text-[10px] text-cim-text">Autonomous after funding</strong>
            <small className="text-[8px] text-cim-subtle">You approve one transfer. The agent then pays per query with its own key — no further prompts.</small>
          </span>
        </div>
      </div>
    </section>
  );
}

export default App;
