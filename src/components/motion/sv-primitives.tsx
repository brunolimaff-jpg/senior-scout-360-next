'use client';

/**
 * SV PRIMITIVES — kit de micro-motion extraído do ecossistema SV
 * (sv-animations / sv-table / sv-blocks / sv-agentation), adaptado ao
 * branding Senior (teal/esmeralda). Regras do kit:
 *   - só transform/opacity/filter (nada de repaint de layout);
 *   - molas críticas ou easings curtos — nunca salto;
 *   - prefers-reduced-motion degrada para estado estático legível.
 */

import { useEffect, useRef, type ReactNode } from "react";
import {
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";

/* ── 1. Number Ticker — contador com mola crítica (stiffness 100 / damping 60) ──
   Sobe quando entra na viewport (once), formata pt-BR, dígitos tabulares
   para a coluna nunca tremer. Reduced motion → valor estático. */
const fmtPtBr = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function Ticker({
  value,
  format,
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 100, damping: 60 });
  const text = useTransform(spring, (v) => (format ?? ((n: number) => fmtPtBr.format(n)))(Math.round(v)));

  useEffect(() => {
    if (inView) mv.set(value);
  }, [inView, value, mv]);

  if (reduce) return <span className={cn("tabular-nums", className)}>{format ? format(value) : fmtPtBr.format(value)}</span>;
  return <motion.span ref={ref} className={cn("tabular-nums", className)}>{text}</motion.span>;
}

/* ── 2. Blur-Fade — entrada desfocada em cascata (stagger 40ms) ──
   Para grades, listas e seções: cada item des-blura e assenta. */
export const blurContainerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
};
export const blurItemVariants = {
  hidden: { opacity: 0, y: 6, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.4, ease: "easeOut" as const } },
};

export function BlurFadeGroup({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "ul" | "ol";
}) {
  // v0.10.12: SEM animação de entrada — conteúdo visível imediatamente
  return <div className={className}>{children}</div>;
}

export function BlurFadeItem({ children, className }: { children: ReactNode; className?: string }) {
  // v0.10.12: SEM animação de entrada — conteúdo visível imediatamente
  return <div className={className}>{children}</div>;
}

/* ── 3. SpotlightCard — Magic Card: holofote teal que segue o cursor ──
   Borda + tinta interna radial; some ao sair; custo ~zero (transform). */
export function SpotlightCard({ children, className }: { children: ReactNode; className?: string }) {
  const mx = useMotionValue(-240);
  const my = useMotionValue(-240);

  const tinta = useMotionTemplate`radial-gradient(220px circle at ${mx}px ${my}px, rgba(0, 150, 140, 0.10), transparent 72%)`;
  const borda = useMotionTemplate`radial-gradient(220px circle at ${mx}px ${my}px, rgba(0, 150, 140, 0.45), rgba(0, 150, 140, 0.06) 55%, transparent 75%)`;

  return (
    <div
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(e.clientX - r.left);
        my.set(e.clientY - r.top);
      }}
      onPointerLeave={() => {
        mx.set(-240);
        my.set(-240);
      }}
      className={cn("group/spot relative rounded-[10px] border border-transparent p-px", className)}
    >
      <motion.div
        aria-hidden="true"
        style={{ background: borda }}
        className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
      />
      <motion.div
        aria-hidden="true"
        style={{ background: tinta }}
        className="pointer-events-none absolute inset-[1px] rounded-[9px] opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
      />
      <div className="relative rounded-[9px]">{children}</div>
    </div>
  );
}

/* ── 4. StatusPing — ponto "ao vivo" (halo ping esmeralda + núcleo sólido) ── */
export function StatusPing({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
      {label ? <span className="text-xs font-medium text-emerald-700">{label}</span> : null}
    </span>
  );
}

/* ── 5. EmptyStateRow — estado vazio como linha da tabela (nunca tela morta) ── */
export function EmptyStateRow({
  colSpan,
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  testId,
}: {
  colSpan: number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <motion.div
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex min-h-52 flex-col items-center justify-center gap-2 p-6 text-center"
          data-testid={testId}
        >
          {Icon ? <Icon strokeWidth={1.4} className="h-8 w-8 text-senior-cinza-500" aria-hidden="true" /> : null}
          <p className="text-sm font-semibold text-senior-azul">{title}</p>
          {description ? <p className="max-w-sm text-xs leading-5 text-senior-cinza-600">{description}</p> : null}
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="press-feedback mt-1 inline-flex h-9 items-center rounded-lg border border-[#00968C]/40 bg-white/70 px-3 text-xs font-semibold text-[#086B6B] hover:bg-[#00968C]/10"
            >
              {actionLabel}
            </button>
          ) : null}
        </motion.div>
      </td>
    </tr>
  );
}

/* ── 6. FloatingActionBar — barra de ações em massa flutuando do rodapé ──
   (sv-table: entra com fly 24px, vidro, contador aria-live) */
export function FloatingActionBar({
  show,
  countLabel,
  children,
}: {
  show: boolean;
  countLabel: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={false}
      animate={show ? { y: 0, opacity: 1 } : { y: 24, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-xl border border-[#00968C]/25 bg-white/95 p-2 shadow-lg ring-1 ring-[#086B6B]/5 backdrop-blur transition-opacity supports-[backdrop-filter]:bg-white/85",
          show ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="px-1.5 text-xs font-semibold text-senior-azul">{countLabel}</span>
        <span className="h-5 w-px bg-[#E2E8E8]" aria-hidden="true" />
        {children}
      </div>
    </motion.div>
  );
}
