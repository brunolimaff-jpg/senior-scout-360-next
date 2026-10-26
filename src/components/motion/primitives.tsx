'use client';

/**
 * AURORA MOTION — primitivas de movimento do Scout 360.
 * Física de mola (nunca tween seco), stagger para listas, reveal com blur,
 * números que contam. Tudo respeita prefers-reduced-motion via MotionConfig.
 */

import {
  motion,
  MotionConfig,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
  type HTMLMotionProps,
  type Variants,
} from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

/* ---------- tokens de movimento ---------- */

export const SPRING = { type: "spring" as const, stiffness: 260, damping: 28, mass: 0.9 };
export const SPRING_SUAVE = { type: "spring" as const, stiffness: 120, damping: 20 };
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/* ---------- wrapper global: reduz movimento quando o usuário pede ---------- */

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/* ---------- FadeUp: entra de baixo com blur saindo ---------- */

export function FadeUp({
  children,
  delay = 0,
  className,
  ...rest
}: { children: ReactNode; delay?: number; className?: string } & Omit<HTMLMotionProps<"div">, "children">) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ ...SPRING, delay }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* ---------- SectionReveal: v0.10.12 — SEM animação de entrada ----------
 * Título e conteúdo visíveis imediatamente (contrato de carregamento: nada que
 * atrasa a leitura ou provoca deslocamento). Mantém o layout e a API. */
export function SectionReveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

/* ---------- Stagger: lista que entra em cascata ---------- */

const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(5px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: SPRING },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

/* ---------- SpringCard: card que levita no hover ---------- */

export function SpringCard({
  children,
  className,
  interactive = true,
  ...rest
}: { children: ReactNode; className?: string; interactive?: boolean } & Omit<HTMLMotionProps<"div">, "children">) {
  return (
    <motion.div
      whileHover={interactive ? { y: -3 } : undefined}
      whileTap={interactive ? { scale: 0.99 } : undefined}
      transition={SPRING}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* ---------- AnimatedNumber: número que conta com mola ---------- */

export function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 24, mass: 0.8 });
  const text = useTransform(spring, (v) => `${Math.round(v).toLocaleString("pt-BR")}${suffix}`);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });

  useEffect(() => {
    if (inView) mv.set(value);
  }, [inView, value, mv]);

  return (
    <motion.span ref={ref} className="tabular-nums">
      {text}
    </motion.span>
  );
}

/* ---------- ScaleIn: para dropdowns/popovers criados fora do Radix ---------- */

export function ScaleIn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={SPRING}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ---------- AuroraBackground: campo de luz esmeralda atrás do produto ---------- */

export function AuroraBackground() {
  return (
    <div className="aurora-field" aria-hidden="true">
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
      <div className="aurora-blob aurora-blob-4" />
      <div className="aurora-grain" />
    </div>
  );
}
