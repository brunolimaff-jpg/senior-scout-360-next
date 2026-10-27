'use client';

/**
 * Primitivas visuais do Senior Design System + microcopy humana.
 * REGRA DO PRODUTO: nenhum código interno, enum, termo técnico ou nome de
 * provedor/API aparece na interface. Toda tradução de estado interno → linguagem
 * humana vive AQUI — e a camada de fontes usa o mecanismo único de
 * apresentação (lib/fontes-apresentacao.ts); proveniência fica na aba Evidências.
 */

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { AnimatedNumber, SectionReveal } from "@/components/motion/primitives";
import {
  CircleCheck, CircleAlert, CircleHelp, Ban, ChevronDown, ChevronRight, CircleDashed, Loader2, UserCheck,
} from "lucide-react";
import { useState } from "react";
import type { RowDetail } from "@/lib/types";
import { categoriaDeFonte, detalheTecnicoDeFonte } from "@/lib/fontes-apresentacao";

/* ============================ microcopy ============================ */

/** Estado da resolução de identidade — o que o LDR lê (v0.10.12: identificar ≠ confirmar). */
export const RESOLUTION_STATE: Record<string, { label: string; hint: string }> = {
  CONFIRMED: { label: "Identificada", hint: "O cadastro corresponde às pistas que você enviou, com dados prontos para uso." },
  REVIEW: { label: "Revisar", hint: "Encontramos mais de uma possibilidade. Confirme qual é a empresa certa." },
  UNRESOLVED: { label: "Não encontrada", hint: "Não houve evidência suficiente para identificar a empresa." },
};

/** v0.10.12: estágio de confiança da identidade — registro localizado ≠ correspondência ≠ validação humana. */
export const IDENTITY_STAGE: Record<string, { label: string; hint: string }> = {
  LOCALIZADO: { label: "Registro localizado", hint: "Achamos o registro cadastral, mas ele diverge das pistas. Revise antes de usar." },
  CORRESPONDENTE: { label: "Corresponde às pistas", hint: "O cadastro oficial corresponde às pistas que você enviou." },
  VALIDADO: { label: "Validado por você", hint: "Você confirmou que este registro é a empresa certa." },
};

/** Estado do lote — linguagem de pessoa, não de pipeline.
 *  v0.10.8 (coerência): CONFIRMED = lote confirmado AGUARDANDO o comando de início.
 *  Não há fila nem processamento neste estado — nada consulta antes do clique. */
export const BATCH_STATE: Record<string, string> = {
  PREVIEW: "Prévia",
  CONFIRMED: "Aguardando início",
  PROCESSING: "Consultando dados públicos",
  DONE: "Concluído",
  PARTIAL: "Concluído com pendências",
  FAILED: "Não concluído",
};

/** Força da evidência → confiança em três níveis que o LDR entende. */
export const CONFIDENCE: Record<string, string> = {
  HUMANA: "Confirmado por você",
  MUITO_FORTE: "Alta confiança",
  FORTE: "Alta confiança",
  MEDIA: "Confiança média",
  BAIXA: "Confiança baixa",
};

/** Tipo da pista original. */
export const KIND: Record<string, string> = {
  CNPJ: "CNPJ",
  DOMAIN: "Domínio",
  EMAIL: "E-mail",
  URL: "Site",
  NAME: "Nome da empresa",
};

/** Estado da consulta — nunca mostra o código.
 *  v0.10.8: EM_FILA é estado de LINHA preparada (nada consultou ainda) — o rótulo
 *  distingue estado do lote (Aguardando início) do estado da linha. */
export const LOOKUP_STATE: Record<string, string> = {
  PENDENTE: "Aguardando consulta",
  EM_FILA: "Preparada para consulta",
  CONSULTANDO: "Consultando fontes",
  ENRIQUECIDO: "Dados prontos",
  NAO_ENCONTRADO: "Sem dados públicos",
  RATE_LIMITED: "Não conseguimos concluir",
  TIMEOUT: "Não conseguimos concluir",
  ERRO_REDE: "Não conseguimos concluir",
  ERRO_SERVIDOR: "Não conseguimos concluir",
  IGNORADO: "Não processada",
};

/** Estado da leitura inteligente (IA). */
export const AI_STATE: Record<string, string> = {
  EM_FILA: "Leitura na fila",
  GERANDO: "Preparando leitura",
  OK: "Leitura pronta",
  FALHOU: "Leitura indisponível",
  IGNORADO: "Fora do limite do lote",
};

/**
 * Fonte consultada — CAMADA DE APRESENTAÇÃO (v0.10.8): a interface comercial
 * descreve a FINALIDADE da consulta ("Cadastro empresarial"), nunca o provedor
 * técnico. Proveniência (provedor efetivo, URL, data) permanece:
 *  · aba Evidências → "Detalhes de origem" (sourceDetail);
 *  · exportações técnicas/JSONL e telemetria (inalteradas).
 */
export function sourceLabel(s: string | null | undefined): string {
  return categoriaDeFonte(s);
}

/** Detalhe técnico da fonte — exibido SÓ sob demanda (camada secundária de
 *  Evidências). null quando a fonte já é um nome legítimo sem tradução. */
export function sourceDetail(s: string | null | undefined): string | null {
  return detalheTecnicoDeFonte(s);
}

/** Situação cadastral da empresa. */
export function registrationLabel(s: string | null | undefined): string {
  if (!s) return "—";
  const map: Record<string, string> = {
    ATIVA: "Ativa",
    BAIXADA: "Baixada",
    SUSPENSA: "Suspensa",
    INAPTA: "Inapta",
    NULA: "Nula",
  };
  const key = s.toUpperCase();
  return map[key] ?? s;
}

/** Evento da auditoria em linguagem humana (fica na camada técnica). */
export function eventLabel(e: string): string {
  const map: Record<string, string> = {
    UPLOAD: "Lista recebida",
    CONFIRM: "Processamento confirmado",
    PROCESS_START: "Processamento iniciado",
    PROCESS_END: "Processamento concluído",
    ENGINE_ERROR: "Falha interna no processamento",
    RESOLVE_START: "Identificação iniciada",
    RESOLVE_DECISAO_HUMANA: "Decisão de identidade registrada",
    RESOLVE_NOVA_PISTA: "Nova pista informada na revisão",
    IDENTIDADE_AVALIADA: "Confiança da identidade avaliada",
    IDENTIDADE_VALIDADA: "Identidade validada por você",
    RESOLVE_OK: "Empresa identificada",
    RESOLVE_CACHE: "Identificação reaproveitada",
    RESOLVE_SEM_IDENTIDADE: "Sem pista suficiente para identificar",
    RESOLVE_END: "Identificação concluída",
    MATRIZ_START: "Busca da matriz iniciada",
    MATRIZ_END: "Matriz verificada",
    MATRIZ_CACHE: "Matriz reaproveitada",
    LOOKUP_START: "Consulta às fontes iniciada",
    LOOKUP_OK: "Consulta concluída",
    LOOKUP_CACHE: "Consulta reaproveitada de uma busca recente (pré-v0.10.0)",
    LOOKUP_FAIL: "Consulta não concluída",
    CADASTRO_CACHE: "Ficha cadastral reaproveitada (dentro da validade)",
    REVALIDACAO_START: "Revalidação da ficha iniciada",
    REVALIDACAO_OK: "Ficha revalidada com consulta nova",
    REVALIDACAO_FALHOU: "Revalidação não concluída",
    AI_START: "Leitura inteligente iniciada",
    AI_OK: "Leitura inteligente concluída",
    AI_FAIL: "Leitura inteligente falhou",
    AI_SKIP: "Leitura inteligente não solicitada",
    AI_CACHE: "Leitura inteligente reaproveitada",
    AI_RETRY: "Leitura reenfileirada",
    AI_RETRY_ALL: "Leituras pendentes reenfileiradas",
    AI_SUMMARY_START: "Resumo do lote iniciado",
    AI_SUMMARY_OK: "Resumo do lote concluído",
    AI_SUMMARY_FAIL: "Resumo do lote falhou",
    DEEP_RESEARCH_START: "Pesquisa profunda iniciada",
    DEEP_RESEARCH_PACKET: "Pacote de pesquisa montado",
    DEEP_RESEARCH_FAIL: "Pesquisa profunda falhou",
    DEEP_RESEARCH_ERROR: "Falha interna na pesquisa profunda",
  };
  return map[e] ?? e;
}

/* ====================== situação de uma linha ====================== */

export type Tone = "confirmado" | "revisao" | "nao" | "processando" | "erro" | "neutro";

export interface Situation {
  key: string;
  label: string;
  tone: Tone;
  hint: string;
}

/** Contexto do lote para a situação de linha — v0.10.8 (coerência de estados):
 *  linha preparada SEM execução ativa NÃO usa spinner nem "processando". */
export interface BatchSituationContext {
  /** o lote está efetivamente em execução (PROCESSING ou lease vivo)? */
  loteEmExecucao: boolean;
}

/** Decide qual é a SITUAÇÃO de uma linha — única fonte da coluna e do expansion.
 *  `ctx` é opcional para compatibilidade; SEM ctx, trata como lote em execução
 *  (comportamento pré-v0.10.8) — call sites do lote real SEMPRE passam contexto. */
export function rowSituation(r: RowDetail, ctx?: BatchSituationContext): Situation {
  const loteAtivo = ctx?.loteEmExecucao ?? true;
  if (r.cnpjStatus === "SEM_CNPJ") {
    // Lote A1 (QA 18/19 do diagnóstico): descartada com estado HONESTO — nunca "Aguardando"
    return { key: "DESCARTADA", label: "Sem pista utilizável", tone: "neutro", hint: "Nenhuma coluna continha CNPJ, nome de empresa, site, domínio ou e-mail. Nada foi processado nem será consultado." };
  }
  if (r.cnpjStatus === "INVALIDA") {
    return { key: "INVALIDA", label: "Entrada inválida", tone: "neutro", hint: "O CNPJ informado não é válido. Confira a digitação." };
  }
  if (r.cnpjStatus === "DUPLICADA") {
    return { key: "DUPLICADA", label: "Entrada repetida", tone: "neutro", hint: `Igual à linha ${r.duplicateOf ?? "anterior"}: os dados não são processados duas vezes.` };
  }
  // v0.10.12: registro localizado com divergência — NÃO é "identificada": revisão honesta
  // com o cadastro preservado e as divergências explicadas (nunca só pela cor/ícone).
  if (r.lookupStatus === "ENRIQUECIDO" && r.identityStage === "LOCALIZADO") {
    const div = r.identityDivergencias?.[0]?.descricao;
    return {
      key: "LOCALIZADO",
      label: "Revisar",
      tone: "revisao",
      hint: `Encontramos o registro cadastral, mas ele diverge das pistas. Confirme se é a empresa certa antes de usar.${div ? ` ${div}` : ""}`,
    };
  }
  if (r.resolutionState && RESOLUTION_STATE[r.resolutionState]) {
    const s = RESOLUTION_STATE[r.resolutionState];
    const hint =
      r.resolutionState === "CONFIRMED" && r.identityStage === "VALIDADO"
        ? "Você validou a identidade desta empresa: dados prontos para uso."
        : s.hint;
    return { key: r.resolutionState, label: s.label, tone: r.resolutionState === "CONFIRMED" ? "confirmado" : r.resolutionState === "REVIEW" ? "revisao" : "nao", hint };
  }
  if (r.lookupStatus === "ENRIQUECIDO") {
    return {
      key: "CONFIRMED",
      label: "Identificada",
      tone: "confirmado",
      hint: r.identityStage === "VALIDADO" ? "Você validou a identidade desta empresa: dados prontos para uso." : "O cadastro corresponde às pistas e os dados estão prontos para uso.",
    };
  }
  if (r.lookupStatus === "PENDENTE" || r.lookupStatus === "EM_FILA" || r.lookupStatus === "CONSULTANDO") {
    if (!loteAtivo && r.lookupStatus !== "CONSULTANDO") {
      // v0.10.8: lote confirmado mas NÃO iniciado — linha preparada, zero execução,
      // zero animação. O estado do lote ("Aguardando início") domina a comunicação.
      return { key: "AGUARDANDO_INICIO", label: "Preparada para consulta", tone: "neutro", hint: "Pronta para consultar as fontes públicas. Clique em Iniciar agora para começar." };
    }
    return { key: "AGUARDANDO", label: "Consultando", tone: "processando", hint: "Vamos identificar esta empresa nas fontes públicas." };
  }
  if (r.lookupStatus === "NAO_ENCONTRADO") {
    return { key: "UNRESOLVED", label: "Não encontrada", tone: "nao", hint: "As fontes públicas não trouxeram evidência para esta pista. Vale revisar com outra pista ou decidir manualmente." };
  }
  if (r.lookupStatus === "RATE_LIMITED" || r.lookupStatus === "TIMEOUT" || r.lookupStatus === "ERRO_REDE" || r.lookupStatus === "ERRO_SERVIDOR") {
    return { key: "ERRO", label: "Tentar novamente", tone: "erro", hint: "A consulta não concluiu por indisponibilidade da fonte. Clique em tentar novamente: nada foi perdido." };
  }
  return { key: "NEUTRO", label: "Aguardando", tone: "neutro", hint: "Esta entrada ainda não foi processada." };
}

/* ============================ cores DS ============================ */

const TONE_BADGE: Record<Tone, string> = {
  // verde institucional domina a identidade; amarelo = atenção; cinza = ausência; vermelho só erro técnico
  confirmado: "bg-[#00968C1A] text-[#086B6B] border-transparent",
  revisao: "bg-[#FFC51133] text-[#33466C] border-transparent",
  nao: "bg-[#F2F2F2] text-[#77736E] border-transparent",
  processando: "bg-[#00968C1A] text-[#086B6B] border-transparent",
  erro: "bg-[#FDECEC] text-[#8C2F39] border-transparent",
  neutro: "bg-[#F2F2F2] text-[#77736E] border-transparent",
};

/** Ícones de tone — exportado para chips clicáveis que replicam o visual do badge. */
export const TONE_ICON: Record<Tone, React.ReactNode> = {
  confirmado: <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />,
  revisao: <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />,
  nao: <Ban className="h-3.5 w-3.5" aria-hidden="true" />,
  processando: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />,
  erro: <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />,
  neutro: <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />,
};

/* ============================ componentes ============================ */

/** Badge de situação — curto, humano, sem quebra de texto. */
export function SituationBadge({ s, testId }: { s: Situation; testId?: string }) {
  return (
    <Badge variant="outline" className={`max-w-44 gap-1 truncate whitespace-nowrap text-[13px] font-medium ${TONE_BADGE[s.tone]}`} title={s.label} data-testid={testId}>
      {TONE_ICON[s.tone]}
      <span className="truncate">{s.label}</span>
    </Badge>
  );
}

/** Estado do lote (Concluído / Aguardando início / Consultando…).
 *  v0.10.8: CONFIRMED = neutro (sem spinner) — confirmação NÃO é execução. */
export function BatchStateBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "DONE" ? "confirmado"
    : status === "PARTIAL" ? "revisao"
    : status === "FAILED" ? "erro"
    : status === "PROCESSING" ? "processando"
    : "neutro";
  return (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap text-[13px] font-medium ${TONE_BADGE[tone]}`} data-testid="detail-status">
      {status === "PROCESSING" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : TONE_ICON[tone]}
      {BATCH_STATE[status] ?? status}
    </Badge>
  );
}

/** Chip de confiança (Alta / Média / Baixa / Confirmado por você). */
export function TrustChip({ confidence }: { confidence: string | null }) {
  if (!confidence) return <span className="text-sm text-senior-cinza-500">—</span>;
  if (confidence === "HUMANA") {
    return (
      <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border border-[#00968C40] bg-white px-2 py-0.5 text-[13px] font-medium text-[#086B6B]" title={CONFIDENCE.HUMANA}>
        <UserCheck className="h-3 w-3" aria-hidden="true" /> {CONFIDENCE.HUMANA}
      </span>
    );
  }
  const nivel = confidence === "MUITO_FORTE" || confidence === "FORTE" ? 1 : confidence === "MEDIA" ? 2 : 3;
  const cls = nivel === 1 ? "text-[#086B6B] bg-[#00968C1A]" : nivel === 2 ? "text-[#33466C] bg-[#FFC51133]" : "text-[#77736E] bg-[#F2F2F2]";
  return (
    <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium ${cls}`} title={CONFIDENCE[confidence]}>
      {CONFIDENCE[confidence] ?? confidence}
    </span>
  );
}

/** Chip do estágio de identidade (v0.10.12) — ícone SEMPRE acompanhado de texto. */
export function IdentityStageChip({ stage }: { stage: string | null }) {
  if (!stage || !IDENTITY_STAGE[stage]) return null;
  const s = IDENTITY_STAGE[stage];
  const tone: Tone = stage === "VALIDADO" ? "confirmado" : stage === "LOCALIZADO" ? "revisao" : "confirmado";
  const cls = stage === "LOCALIZADO" ? "bg-[#FFC51133] text-[#33466C]" : "bg-[#00968C1A] text-[#086B6B]";
  const icon = stage === "VALIDADO" ? <UserCheck className="h-3 w-3" aria-hidden="true" /> : TONE_ICON[tone];
  return (
    <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium ${cls}`} title={s.hint}>
      {icon} {s.label}
    </span>
  );
}

/** Tipo do estabelecimento encontrado — filial NÃO é falha, é informação. */
export function FoundTypeChip({ isHeadquarters }: { isHeadquarters: boolean | null }) {
  if (isHeadquarters === null) return null;
  return isHeadquarters ? (
    <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full bg-[#00968C1A] px-2 py-0.5 text-[13px] font-medium text-[#086B6B]">
      <CircleCheck className="h-3 w-3" aria-hidden="true" /> Matriz confirmada
    </span>
  ) : (
    <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full bg-[#F2F2F2] px-2 py-0.5 text-[13px] font-medium text-[#33466C]">
      <CircleHelp className="h-3 w-3" aria-hidden="true" /> Filial encontrada
    </span>
  );
}

/** Métrica operacional do lote — número que conta + rótulo humano.
 *  v0.10.7 (auditoria): `hint` opcional mostra o que o contador representa
 *  (ex.: linhas por trás de uma quantidade distinta) — rótulo nunca mente. */
export function OpMetric({ value, label, suffix, tone = "default", testId, hint }: { value: number | string; label: string; suffix?: string; tone?: "default" | "verde" | "atencao" | "neutro"; testId?: string; hint?: string }) {
  const color = tone === "verde" ? "text-[#00968C]" : tone === "atencao" ? "text-[#33466C]" : tone === "neutro" ? "text-[#77736E]" : "text-[#33466C]";
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className={`truncate text-2xl font-bold leading-8 ${color}`}>
        {typeof value === "number" ? <AnimatedNumber value={value} suffix={suffix ?? ""} /> : <span className="tabular-nums">{value}</span>}
      </p>
      {/* v0.10.18: o rótulo quebra em duas linhas em vez de cortar — em telas
          estreitas "Pessoas jurídicas identificadas" e "Matrizes distintas
          confirmadas" não podem perder o fim ("id…", "c…"). Em telas largas
          continua em uma linha, sem mudar nada do leiaute. */}
      <p className="ds-caption mt-0.5 whitespace-normal leading-tight text-senior-cinza-600">{label}</p>
      {hint && <p className="whitespace-normal text-[13px] leading-tight text-senior-cinza-500">{hint}</p>}
    </div>
  );
}

/** Título de seção do produto (widget-title DS) — revela ao entrar na tela. */
export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <SectionReveal className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="ds-widget-title text-senior-azul">{title}</h2>
        {subtitle && <p className="ds-lead mt-1 flex flex-wrap items-center gap-2 text-senior-cinza-600">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </SectionReveal>
  );
}

/** Bloco "Detalhes técnicos" — camada secundária, fechado por padrão. */
export function TechDisclosure({ title, subtitle, children, testId }: { title: string; subtitle?: string; children: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-[10px] border border-senior-cinza-300 bg-white" data-testid={testId}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" aria-expanded={open}>
          <span>
            <span className="ds-title-md block text-senior-azul">{title}</span>
            {subtitle && <span className="ds-caption mt-0.5 block text-senior-cinza-600">{subtitle}</span>}
          </span>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-senior-cinza-600" /> : <ChevronRight className="h-4 w-4 shrink-0 text-senior-cinza-600" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-senior-cinza-300 px-4 py-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Linha de definição (rótulo → valor) usada nos detalhes. */
export function DefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="ds-caption w-44 shrink-0 text-senior-cinza-600">{label}</dt>
      <dd className="ds-body min-w-0 text-senior-azul">{children}</dd>
    </div>
  );
}

/** Ação de linha no estilo DS (link discreto). */
export function RowAction({ onClick, disabled, children, testId, title }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; testId?: string; title?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className="h-8 gap-1.5 rounded-[5px] px-2 text-[13px] font-medium text-[#086B6B] hover:bg-[#00968C14] hover:text-[#086B6B] disabled:text-senior-cinza-500"
    >
      {children}
    </Button>
  );
}

/** Data/hora no formato do DS (pt-BR). */
export function formatBR(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "—";
  try {
    // P0-05: data civil (YYYY-MM-DD) é formatada pelas PRÓPRIAS PARTES, sem Date.
    // `new Date("2011-11-11")` é meia-noite UTC e, em fusos negativos (America/Cuiaba),
    // renderiza o dia anterior (10/11). Datas abertura/consulta são civis — sem hora.
    const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (civil) return `${civil[3]}/${civil[2]}/${civil[1]}`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("pt-BR", withTime ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Capital social em R$. */
export function formatBRL(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".")) : v;
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}
