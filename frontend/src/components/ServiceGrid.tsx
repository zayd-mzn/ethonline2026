import { motion } from "framer-motion";
import { ChevronRight, Globe2, Hash, ShieldCheck } from "lucide-react";
import { EvervaultCard } from "./ui/evervault-card";

export interface ServiceDef {
  name:        string;
  description: string;
  price:       string;
  latency:     string;
  calls:       string;
  type:        "ip" | "hash";
  category:    "network" | "malware";
  bazantic:    boolean;
}

export function ServiceGrid({
  services,
  onTry,
}: {
  services: ServiceDef[];
  onTry:    () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-0 border border-[#1d3029] lg:grid-cols-3">
      {services.map((service, index) => {
        const isIp = service.type === "ip";
        const Icon = isIp ? Globe2 : Hash;

        return (
          <motion.div
            key={service.name}
            className={[
              index % 3 !== 2 ? "lg:border-r"  : "",
              index < services.length - 3 ? "border-b" : "",
              "border-[#1d3029]",
            ].join(" ")}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, delay: index * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <EvervaultCard title={service.name}>
              <div className="flex min-h-[310px] flex-col p-6">
                {/* header */}
                <div className="flex items-center justify-between">
                  <span className={`grid h-10 w-10 place-items-center rounded border ${
                    isIp
                      ? "border-[#285246] bg-[#0d2921] text-[#55e6c2]"
                      : "border-[#5f4929] bg-[#2a2111] text-[#ffbd59]"
                  }`}>
                    <Icon size={20} />
                  </span>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="flex items-center gap-1 font-mono text-[8px] font-bold tracking-[.1em] text-[#b8f34b]">
                      <ShieldCheck size={12} /> VERIFIED
                    </span>
                    {service.bazantic && (
                      <span className="flex items-center gap-1 rounded border border-[#f97316]/30 bg-[#f97316]/10 px-1.5 py-0.5 font-mono text-[7px] font-bold tracking-widest text-[#f97316]">
                        ⚡ BAZANTIC
                      </span>
                    )}
                  </div>
                </div>

                {/* title + description */}
                <h3 className="mt-6 text-lg font-semibold text-white">{service.name}</h3>
                <p className="mt-2 flex-1 text-xs leading-6 text-[#82988f]">{service.description}</p>

                {/* stats */}
                <div className="my-4 grid grid-cols-2 border-y border-[#1d3029] py-3 font-mono text-[9px] text-[#667b72]">
                  <span><b className="block text-[#b6c6c0]">{service.latency}</b>P50 LATENCY</span>
                  <span><b className="block text-[#b6c6c0]">{service.calls}</b>PAID CALLS</span>
                </div>

                {/* price + cta */}
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-lg text-[#b8f34b]">{service.price}</strong>
                    <small className="font-mono text-[8px] text-[#82988f]"> HBAR/query</small>
                  </div>
                  <button
                    onClick={onTry}
                    className="flex items-center gap-1 font-mono text-[10px] font-bold text-[#55e6c2] transition hover:text-white"
                  >
                    Try with agent <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </EvervaultCard>
          </motion.div>
        );
      })}
    </div>
  );
}
