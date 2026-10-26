'use client';

/**
 * v0.11.3 (missão Lotes+Mesa) — PAINÉIS DO CONTRATO DE ESTADOS.
 *
 * Contrato (seção 3 da missão): identificação cadastral, revisão de identidade,
 * pesquisa profunda e prontidão do dossiê são DIMENSÕES INDEPENDENTES que coexistem
 * na mesma conta. Estes painéis mostram cada etapa com o próprio número e
 * denominador — NUNCA um percentual único representando processos diferentes.
 *
 * Fonte canônica: detail.pesquisaProfunda (calculada pelo servidor direto dos
 * campos researchStatus/aiStatus/lookupStatus das linhas — mesma população do
 * filtro dossie_pronto) e detail.filaPesquisa (fila por seleção).
 */

import { ArrowRight, CircleAlert, Clock, FileSearch, Layers, Loader2, ListChecks, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BatchDetail } from "@/lib/types";
import { plural } from "@/lib/linguagem";

/* ============================================================================
 * ACOMPANHAMENTO — faixa de UMA LINHA com as etapas do lote (área Lotes).
 * Entradas → Identificadas → Revisão → Pesquisa profunda (prontos/executando/
 * fila/falhas) → Dossiês prontos. Cada número é um contador canônico próprio.
 * ========================================================================== */
export function AcompanhamentoStrip({ detail }: { detail: BatchDetail }) {
  const pp = detail.pesquisaProfunda;
  const fila = detail.filaPesquisa;
  const naFila = fila && fila.estado !== "CONCLUIDA" ? fila.pendentes.length : 0;
  const interrompida = fila?.estado === "PAUSADA";
  const emExecucao = pp.emExecucao + pp.sintetizando;
  // G7 (P0 — contadores): identificadas = identidade confirmada (mesma população do
  // filtro CONFIRMED da lista). Antes: totalEnriched - totalReview, que contava a
  // consulta executada (inclusive "não encontrada") como identificação.
  const prontas = detail.totalConfirmed; // identidade confirmada, ainda sem pesquisa profunda

  return (
    <div
      className="sn-surface glass-reflex relative overflow-hidden rounded-[14px] px-4 py-2.5"
      data-testid="acompanhamento-strip"
      aria-label="Acompanhamento do lote por etapa"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="ds-caption shrink-0 text-[11px] font-semibold tracking-[0.08em] text-senior-cinza-600">ACOMPANHAMENTO</span>

        {/* etapa 1 — entradas recebidas */}
        <StageChip
          testId="acc-entradas"
          label="Entradas"
          value={detail.rowCount}
          hint={`${plural(detail.rowCount, "linha recebida", "linhas recebidas")} na planilha/pistas deste lote`}
        />
        <ArrowRight className="h-3 w-3 shrink-0 text-senior-cinza-400" aria-hidden="true" />

        {/* etapa 2 — cadastros identificados (dimensão cadastral, não dossiê) */}
        <StageChip
          testId="acc-identificadas"
          label="Identificadas"
          value={prontas}
          tone="verde"
          hint={`${plural(prontas, "conta com identidade confirmada", "contas com identidade confirmada")} — cadastro público localizado, ainda sem pesquisa profunda`}
        />
        <ArrowRight className="h-3 w-3 shrink-0 text-senior-cinza-400" aria-hidden="true" />

        {/* etapa 3 — identidades aguardando decisão humana */}
        <StageChip
          testId="acc-revisao"
          label="Revisão"
          value={detail.totalReview}
          tone={detail.totalReview > 0 ? "atencao" : "neutro"}
          hint={`${plural(detail.totalReview, "identidade aguardando", "identidades aguardando")} sua decisão — a conta segue em Lotes até a revisão`}
        />
        <ArrowRight className="h-3 w-3 shrink-0 text-senior-cinza-400" aria-hidden="true" />

        {/* etapa 4 — pesquisa profunda: sub-estágios honestos, sem percentual único */}
        <span
          className="inline-flex min-w-0 flex-wrap items-center gap-1.5 rounded-full border border-senior-cinza-300 bg-white px-2.5 py-0.5"
          data-testid="acc-pesquisa"
          title={`Pesquisa profunda do lote — ${pp.dossiesProntos} dossiê(s) pronto(s) · ${emExecucao} em execução · ${naFila} na fila · ${pp.falhas} com falha. Solicitadas em ${pp.solicitadas} linha(s) de ${pp.identificadasElegiveis} identificada(s).`}
        >
          <FileSearch className="h-3 w-3 shrink-0 text-[#086B6B]" aria-hidden="true" />
          <span className="ds-caption text-senior-cinza-600">Pesquisa:</span>
          <span className="ds-caption font-semibold tabular-nums text-[#00968C]" data-testid="acc-pesquisa-prontos">{pp.dossiesProntos}</span>
          <span className="ds-caption text-senior-cinza-600">pronto{pp.dossiesProntos === 1 ? "" : "s"}</span>
          {emExecucao > 0 && (
            <>
              <span className="ds-caption text-senior-cinza-400">·</span>
              <Loader2 className="h-3 w-3 animate-spin text-[#086B6B]" aria-hidden="true" />
              <span className="ds-caption font-semibold tabular-nums text-[#086B6B]" data-testid="acc-pesquisa-executando">{emExecucao}</span>
              <span className="ds-caption text-senior-cinza-600">executando</span>
            </>
          )}
          {naFila > 0 && (
            <>
              <span className="ds-caption text-senior-cinza-400">·</span>
              <Clock className="h-3 w-3 shrink-0 text-senior-cinza-600" aria-hidden="true" />
              <span className="ds-caption font-semibold tabular-nums text-senior-cinza-600" data-testid="acc-pesquisa-fila">{naFila}</span>
              <span className="ds-caption text-senior-cinza-600">na fila</span>
            </>
          )}
          {pp.falhas > 0 && (
            <>
              <span className="ds-caption text-senior-cinza-400">·</span>
              <CircleAlert className="h-3 w-3 shrink-0 text-[#8a6d00]" aria-hidden="true" />
              <span className="ds-caption font-semibold tabular-nums text-[#8a6d00]" data-testid="acc-pesquisa-falhas">{pp.falhas}</span>
              <span className="ds-caption text-senior-cinza-600">falha{pp.falhas === 1 ? "" : "s"}</span>
            </>
          )}
          {interrompida && (
            <>
              <span className="ds-caption text-senior-cinza-400">·</span>
              <PauseCircle className="h-3 w-3 shrink-0 text-[#8C2F39]" aria-hidden="true" />
              <span className="ds-caption font-medium text-[#8C2F39]" data-testid="acc-pesquisa-pausada">fila pausada</span>
            </>
          )}
        </span>
        <ArrowRight className="h-3 w-3 shrink-0 text-senior-cinza-400" aria-hidden="true" />

        {/* etapa 5 — dossiês prontos: resultado da investigação solicitada.
            CONTRATO: 11 identificadas com 3 prontas NÃO são 11 dossiês —
            o denominador honesto (de N identificadas) vem no hint. */}
        <span
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[#00968C55] bg-[#00968C14] px-2.5 py-0.5"
          data-testid="acc-dossies"
          title={`${plural(pp.dossiesProntos, "dossiê pronto", "dossiês prontos")} de ${plural(pp.identificadasElegiveis, "conta identificada", "contas identificadas")} — pesquisa profunda concluída e síntese pronta, sem bloqueio de identidade`}
        >
          <Layers className="h-3 w-3 shrink-0 text-[#086B6B]" aria-hidden="true" />
          <span className="ds-caption text-senior-cinza-600">Dossiês prontos</span>
          <span className="ds-caption font-semibold tabular-nums text-[#00968C]">
            {pp.dossiesProntos}
            <span className="font-normal text-senior-cinza-600"> de {pp.identificadasElegiveis}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

/* ============================================================================
 * MESA — cabeçalho compacto da área (dossiês disponíveis + retorno a Lotes).
 * ========================================================================== */
export function MesaIntro({
  detail,
  onAcompanharLotes,
}: {
  detail: BatchDetail;
  onAcompanharLotes: () => void;
}) {
  const pp = detail.pesquisaProfunda;
  const emExecucao = pp.emExecucao + pp.sintetizando;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 pb-1" data-testid="mesa-intro">
      <h2 className="ds-title-md flex min-w-0 items-center gap-2 text-senior-azul">
        <ListChecks className="h-4 w-4 shrink-0 text-[#00968C]" aria-hidden="true" />
        <span className="truncate">Mesa de investigação</span>
      </h2>
      <span
        className="ds-caption inline-flex items-center gap-1.5 rounded-full border border-[#00968C55] bg-[#00968C14] px-2.5 py-0.5 font-semibold tabular-nums text-[#086B6B]"
        data-testid="mesa-intro-dossies"
        title={`Dossiês com pesquisa profunda concluída, síntese pronta e identidade sem bloqueio — de ${pp.identificadasElegiveis} contas identificadas neste lote`}
      >
        {plural(pp.dossiesProntos, "dossiê pronto", "dossiês prontos")}
      </span>
      {emExecucao > 0 && (
        <span className="ds-caption inline-flex items-center gap-1 text-[#086B6B]" data-testid="mesa-intro-executando">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {plural(emExecucao, "pesquisa em execução", "pesquisas em execução")}
        </span>
      )}
      <span className="min-w-2 flex-1" aria-hidden="true" />
      <button
        type="button"
        onClick={onAcompanharLotes}
        className="ds-caption inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 font-medium text-[#086B6B] underline-offset-2 transition-colors hover:bg-[#00968C14] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C]"
        data-testid="mesa-intro-voltar-lotes"
        title="Voltar à área de Lotes: envio, acompanhamento do processamento e pendências"
      >
        Acompanhar em Lotes <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ============================================================================
 * MESA VAZIA — nenhum dossiê pronto: estado honesto + próximos passos.
 * A lista continua abaixo (filtro pode ser liberado) — nada desaparece.
 * ========================================================================== */
export function MesaEmptyState({
  detail,
  onAcompanharLotes,
  onVerTodas,
}: {
  detail: BatchDetail;
  onAcompanharLotes: () => void;
  onVerTodas: () => void;
}) {
  const pp = detail.pesquisaProfunda;
  return (
    <div className="sn-surface glass-reflex relative overflow-hidden rounded-[14px] px-6 py-6" data-testid="mesa-vazia">
      <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-[#00968C0D] blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-xl text-center">
        <span className="glass-chip mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full">
          <Layers className="h-5 w-5 text-senior-cinza-600" aria-hidden="true" />
        </span>
        <h3 className="ds-title-md text-senior-azul">Nenhum dossiê pronto neste lote</h3>
        <p className="ds-body mt-2 text-senior-cinza-600">
          A Mesa reúne as empresas cuja <b className="font-semibold text-senior-azul">pesquisa profunda foi concluída</b> e a
          identidade não tem bloqueio.
          {pp.identificadasElegiveis > 0
            ? ` Este lote tem ${plural(pp.identificadasElegiveis, "conta identificada", "contas identificadas")}; ${plural(pp.identificadasElegiveis, "ela ainda pode receber", "elas ainda podem receber")} pesquisa profunda.`
            : " Este lote ainda não tem conta identificada — as pendências de entrada e revisão ficam em Lotes."}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button className="sn-btn-verde h-8 px-4 text-[13px] font-semibold" onClick={onAcompanharLotes} data-testid="mesa-vazia-cta-lotes">
            Acompanhar em Lotes <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-[8px] border-senior-cinza-300 text-senior-azul hover:bg-[#F2F2F2]"
            onClick={onVerTodas}
            data-testid="mesa-vazia-cta-todas"
          >
            Ver todas as contas do lote
          </Button>
        </div>
        {detail.totalReview > 0 && (
          <p className="ds-caption mt-3 text-senior-cinza-600" data-testid="mesa-vazia-revisao">
            {plural(detail.totalReview, "identidade aguardando", "identidades aguardando")} revisão em Lotes — dossiês bloqueados
            até a decisão humana.
          </p>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * CHIP DE ETAPA — número com rótulo e hint; NUNCA cor sozinha (acessibilidade).
 * ========================================================================== */
function StageChip({
  label,
  value,
  tone = "neutro",
  hint,
  testId,
}: {
  label: string;
  value: number;
  tone?: "neutro" | "verde" | "atencao";
  hint: string;
  testId: string;
}) {
  const valueTone =
    tone === "verde" ? "text-[#00968C]" : tone === "atencao" ? "text-[#8a6d00]" : value === 0 ? "text-senior-cinza-400" : "text-senior-azul";
  const border = tone === "atencao" ? "border-[#FFC51166] bg-[#FFC51114]" : tone === "verde" ? "border-[#00968C40] bg-[#00968C0A]" : "border-senior-cinza-300 bg-white";
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${border}`}
      title={hint}
      data-testid={testId}
    >
      <span className="ds-caption text-senior-cinza-600">{label}</span>
      <span className={`ds-caption font-semibold tabular-nums ${valueTone}`}>{value}</span>
    </span>
  );
}
