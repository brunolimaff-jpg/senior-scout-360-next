'use client';

/**
 * HEADER SCOUT 360 — v3: presença e respiro.
 * 72px em repouso → 60px rolado (desktop) · 64 → 56 (mobile): altura de header
 * institucional, não de barra de utilidades. Marca em lockup de duas linhas
 * ("Scout 360" / "Enriquecimento de contas") SEMPRE visível, logo maior,
 * "Como funciona" como botão de vidro com borda — controle permanente da jornada.
 * Sombra que acorda com o scroll, hairline inferior constante e barra de
 * progresso de leitura. Luz espectral atravessando o vidro. Toda física de mola;
 * respeita prefers-reduced-motion via MotionConfig.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CircleHelp, Hash, Rocket, Sparkles } from "lucide-react";
import { SPRING } from "@/components/motion/primitives";

const HOW_IT_WORKS = [
  {
    icon: Rocket,
    title: "1. Envie as pistas que você tem",
    text: "Cole ou envie uma planilha com CNPJ, site, domínio, e-mail ou nome da empresa. Não precisa ter tudo isso: uma pista já basta para começar.",
  },
  {
    icon: Hash,
    title: "2. Confira as empresas",
    text: "O Scout consulta fontes públicas e mostra o que cada cadastro tem em comum com a sua pista. O que já bate aparece como identificado. O que precisa da sua olhada aparece como revisar.",
  },
  {
    icon: Sparkles,
    title: "3. Investigue mais quando quiser",
    text: "Na ficha de cada empresa, peça informações adicionais de fontes públicas e a leitura inteligente. Você escolhe onde investigar e exporta a planilha pronta para o seu dia.",
  },
];

export function AppHeader() {
  const { scrollY, scrollYProgress } = useScroll();
  // barra de leitura com mola — nunca salta, sempre persegue
  const progresso = useSpring(scrollYProgress, { stiffness: 160, damping: 36, mass: 0.5 });
  const [rolado, setRolado] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setRolado(v > 10));
  // alturas generosas por breakpoint: 72→60 desktop · 64→56 mobile
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const altura = rolado ? (mobile ? 56 : 60) : mobile ? 64 : 72;

  return (
    <motion.header
      // v0.10.12: SEM animação de entrada — o header está visível no primeiro paint
      className="glass-strong sticky top-0 z-40 overflow-hidden border-x-0 border-t-0 border-b border-b-[#00968C26]"
      data-testid="header"
    >
      {/* v0.10.12: o span de varredura de luz foi removido (elemento morto desde a v0.10.11) */}

      {/* profundidade que aparece só quando importa (rolou) */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        animate={{ opacity: rolado ? 1 : 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={{ boxShadow: "0 14px 40px -16px rgba(8, 107, 107, 0.30)" }}
      />

      <motion.div
        animate={{ height: altura }}
        transition={{ type: "spring", stiffness: 300, damping: 32, mass: 0.8 }}
        className="relative mx-auto flex max-w-[1140px] items-center justify-between gap-2.5 px-4 sm:gap-4 sm:px-6"
      >
        {/* ── marca: logo maior + lockup de duas linhas, sempre visível ── */}
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-4">
          <motion.div
            whileHover={{ scale: 1.04, rotate: -1.2 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING}
            className="shrink-0 origin-left"
          >
            <Image
              src="/senior-logo-verde.png"
              alt="Senior"
              // dimensões intrínsecas reais do PNG (816×266) — evita aspect-ratio
              // derivado errado que cortava/achatava o desenho
              width={816}
              height={266}
              priority
              className="h-7 w-auto sm:h-9 md:h-10"
              data-testid="header-logo"
            />
          </motion.div>
          <span className="hidden h-9 w-px bg-gradient-to-b from-transparent via-senior-cinza-300 to-transparent sm:block" aria-hidden="true" />
          <span
            className="flex min-w-0 flex-col justify-center gap-0.5 whitespace-nowrap"
            aria-label="Scout 360, enriquecimento de contas"
            data-testid="header-brand"
          >
            <span className="text-[15px] font-bold leading-5 tracking-[0.15px] text-senior-azul sm:text-lg">
              Scout <span className="text-[#00968C]">360</span>
            </span>
            <span className="ds-caption hidden leading-[14px] text-senior-cinza-600 sm:block">
              Enriquecimento de contas
            </span>
          </span>
        </div>

        {/* ── controle da jornada: sempre perceptível, jamais escondido ── */}
        <div className="flex shrink-0 items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="glass-chip press-feedback group h-11 gap-1.5 rounded-full border-[#00968C]/35 bg-white/70 px-3 text-xs font-semibold text-[#086B6B] hover:border-[#00968C]/70 hover:bg-[#00968C]/10 sm:h-10 sm:gap-2 sm:px-5 sm:text-sm"
                data-testid="how-it-works"
              >
                <CircleHelp className="h-4 w-4 transition-transform duration-300 ease-out group-hover:rotate-[14deg] group-hover:scale-110" />
                Como funciona
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="glass-strong w-80 rounded-[14px] border-transparent p-4 text-senior-azul"
              data-testid="how-it-works-content"
            >
              <p className="ds-title-md mb-3 text-senior-azul">Da pista à conta pronta</p>
              <ol className="space-y-3">
                {HOW_IT_WORKS.map((s) => (
                  <li key={s.title} className="flex items-start gap-2.5">
                    <span className="glass-chip flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                      <s.icon className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="ds-title-md block text-senior-azul">{s.title}</span>
                      <span className="ds-caption mt-0.5 block leading-4 text-senior-cinza-600">{s.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="ds-caption mt-3 border-t border-[#F2F2F2] pt-2.5 text-senior-cinza-600">
                A leitura com IA gera hipóteses. Confirme as informações com a empresa.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </motion.div>

      {/* barra de progresso de leitura — só existe quando há leitura em curso;
          em repouso o hairline constante faz a separação limpa do conteúdo */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gradient-to-r from-[#086B6B] via-[#00968C] to-[#12F7D1]"
        style={{ scaleX: progresso, opacity: rolado ? 1 : 0 }}
        data-testid="header-progress"
      />
    </motion.header>
  );
}
