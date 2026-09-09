import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useEffect, useState } from "react";
import { cn } from "../../lib/utils";

function randomHex(length = 24) {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16))
    .join("")
    .toUpperCase();
}

export function EvervaultCard({
  title,
  children,
  className,
}: {
  title:     string;
  children:  ReactNode;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [cipher, setCipher] = useState(() => Array.from({ length: 22 }, () => randomHex()));

  useEffect(() => {
    if (!hovered) return;
    const timer = window.setInterval(() => {
      setCipher(Array.from({ length: 22 }, () => randomHex()));
    }, 80);
    return () => window.clearInterval(timer);
  }, [hovered]);

  return (
    <motion.article
      className={cn(
        "group relative min-h-[310px] overflow-hidden border border-[#1d3029] bg-[#07100d]",
        className,
      )}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ borderColor: "rgba(147,51,234,0.65)" }}
      transition={{ duration: 0.2 }}
    >
      <AnimatePresence>
        {hovered && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-black/94 p-3 font-mono text-[9px] leading-[1.55] text-[#9333ea]/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* hex grid */}
            <div className="grid grid-cols-2 gap-x-3 break-all">
              {cipher.map((line, i) => (
                <span key={`${i}-${line}`}>0x{line}</span>
              ))}
            </div>

            {/* dark vignette so center text pops */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,black_80%)]" />

            {/* service name revealed in center */}
            <motion.div
              className="absolute inset-0 grid place-items-center px-6"
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.22 }}
            >
              <span className="text-center font-sans text-2xl font-semibold tracking-tight text-white drop-shadow-[0_0_20px_#9333ea]">
                {title}
              </span>
            </motion.div>

            {/* scan line */}
            <motion.div
              className="absolute inset-x-0 h-px bg-[#b8f34b]/75 shadow-[0_0_14px_#b8f34b]"
              animate={{ top: ["0%", "100%"] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* card content sits below the overlay */}
      <div className="relative z-0 h-full">{children}</div>
    </motion.article>
  );
}
