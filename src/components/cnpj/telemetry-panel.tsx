"use client";

/**
 * TelemetryPanel (Lote A3 — 5.4): visão consolidada e honesta do consumo do lote.
 * Todos os números vêm de /api/telemetry/summary (eventos persistidos) — "não
 * informado" é exibido como tal, nunca convertido em zero.
 */
import { useEffect, useState } from "react";
import { Activity, ChevronDown, CircleAlert, Gauge, RefreshCw, Search, Sparkles, Timer } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { plural } from "@/lib/linguagem";
import { sourceLabel } from "./senior";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Summary {
  lote: { id: string; arquivo: string; status: string; appVersao: string; promptVersao: string };
  contas: {
    linhas: number; identificadas: number; enriquecidas: number; emRevisao: number;
    naoIdentificadas: number; descartadasSemPista: number; duplicadas: number;
    comLeituraIa: number; leiturasFalhadas: number;
  };
  coleta: {
    consultasCadastro: number; cacheCadastro: number; buscasWeb: number; leiturasPagina: number;
    buscas429: number; leituras429: number; pesquisasIncompletas: number; pesquisasReutilizadas: number;
    cacheReutilizado: number; tempoMedioBuscaMs: number | null; tempoMedioLeituraMs: number | null;
    fontesCadastro?: { fonte: string; consultas: number; sucesso: number; bloqueado: number; falha: number; tempoMedioMs: number | null }[];
  };
  ia: {
    chamadas: number; cacheHits: number;
    tokens: { prompt: number | null; completion: number | null; total: number | null; informadas: number; naoInformadas: number };
    tempoMedioMs: number | null;
    modelos: { solicitado: string | null; efetivo: string | null; chamadas: number }[];
    erros: number;
  };
  etapas: { etapa: string; execucoes: number; sucesso: number; parcial: number; falha: number; bloqueado: number; duracaoMediaMs: number | null }[];
}

const fmt = (n: number | null | undefined): string => (typeof n === "number" ? n.toLocaleString("pt-BR") : "—");
const fmtMs = (n: number | null | undefined): string => (typeof n === "number" ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} s` : "—");

function Stat({ icon, label, value, hint, testId, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; testId: string; tone?: "alerta" | "ok" }) {
  return (
    <div
      className="rounded-[10px] border border-senior-cinza-200 bg-white px-3 py-2.5"
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 text-senior-cinza-600">
        {icon}
        <span className="ds-caption">{label}</span>
      </div>
      <p className={`ds-title-md mt-0.5 ${tone === "alerta" ? "text-[#8a6d00]" : "text-senior-azul"}`}>{value}</p>
      {hint && <p className="ds-caption mt-0.5 text-senior-cinza-400">{hint}</p>}
    </div>
  );
}

const ETAPA_LABEL: Record<string, string> = {
  RESOLUCAO_IDENTIDADE: "Resolução de identidade",
  ENRIQUECIMENTO: "Consulta cadastral",
  PESQUISA_PROFUNDA: "Pesquisa profunda",
  SINTESE_IA: "Síntese IA",
  RESUMO_LOTE: "Resumo do lote",
  COMPLEMENTACAO: "Complementação por fonte",
};

export function TelemetryPanel({ batchId }: { batchId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v0.10.11 (piloto): detalhe TÉCNICO nasce RECOLHIDO — a jornada comercial
  // mostra primeiro o resultado; o consumo fica a um clique (e os números só
  // são buscados quando alguém abre o painel — menos 1 request por visita).
  const [aberta, setAberta] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/telemetry/summary?batchId=${encodeURIComponent(batchId)}`);
      const json = (await res.json()) as { ok?: boolean; summary?: Summary; error?: string };
      if (json.ok && json.summary) setSummary(json.summary);
      else setError(json.error ?? "Telemetria indisponível.");
    } catch {
      setError("Telemetria indisponível agora.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (aberta && !summary && !error) void load();
  }, [batchId, aberta]);

  if (!aberta) {
    return (
      <div className="sn-surface sn-shadow-suave" data-testid="telemetria">
        <button
          type="button"
          onClick={() => setAberta(true)}
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-[#00968C08]"
          aria-expanded={false}
          aria-controls="telemetria-corpo"
          data-testid="telemetria-toggle"
        >
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#00968C]" aria-hidden="true" />
            <span className="ds-title-md text-senior-azul">Consumo do lote</span>
            <span className="ds-caption hidden text-senior-cinza-600 sm:inline">buscas, IA, cache e limites (detalhe técnico)</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-senior-cinza-400" aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sn-surface sn-shadow-suave p-5" data-testid="telemetria">
        <h3 className="ds-title-md text-senior-azul">Telemetria do lote</h3>
        <p className="ds-body mt-1 text-senior-cinza-600">{error}</p>
        <Button variant="ghost" size="sm" className="mt-2 text-[13px] text-[#086B6B]" onClick={() => { setError(null); void load(); }}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="sn-surface sn-shadow-suave p-5" data-testid="telemetria">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 animate-pulse text-senior-cinza-400" aria-hidden="true" />
          <p className="ds-body text-senior-cinza-600">Carregando telemetria…</p>
        </div>
      </div>
    );
  }

  const total429 = summary.coleta.buscas429 + summary.coleta.leituras429;
  const tokensLabel =
    summary.ia.tokens.naoInformadas > 0 && summary.ia.tokens.informadas === 0
      ? "não informado"
      : fmt(summary.ia.tokens.total);

  return (
    <div className="sn-surface sn-shadow-suave p-5" data-testid="telemetria" id="telemetria-corpo">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#00968C]" aria-hidden="true" />
          <h3 className="ds-title-md text-senior-azul">Consumo do lote</h3>
          <Badge variant="outline" className="hidden text-[13px] text-senior-cinza-500 sm:inline-flex">
            app {summary.lote.appVersao} · prompts {summary.lote.promptVersao}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label="Atualizar telemetria" data-testid="telemetria-refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            Atualizar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAberta(false)} aria-label="Recolher consumo do lote" aria-expanded={true} aria-controls="telemetria-corpo">
            <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
            Recolher
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />} label="Buscas na web" value={fmt(summary.coleta.buscasWeb)} hint={`leituras de página: ${fmt(summary.coleta.leiturasPagina)}`} testId="tel-buscas" />
        <Stat icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />} label="Chamadas de IA" value={fmt(summary.ia.chamadas)} hint={summary.ia.cacheHits > 0 ? `${summary.ia.cacheHits} por cache` : "sem cache nesta rodada"} testId="tel-ia" />
        <Stat icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />} label="Tokens (quando informado)" value={tokensLabel} hint={summary.ia.tokens.naoInformadas > 0 ? `${plural(summary.ia.tokens.naoInformadas, "chamada", "chamadas")} sem relato do provedor` : "relato do gateway"} testId="tel-tokens" />
        <Stat icon={<CircleAlert className={`h-3.5 w-3.5 ${total429 > 0 ? "text-[#8a6d00]" : ""}`} aria-hidden="true" />} label="Consultas com limite atingido" value={fmt(total429)} hint={summary.coleta.pesquisasIncompletas > 0 ? `${plural(summary.coleta.pesquisasIncompletas, "pesquisa incompleta", "pesquisas incompletas")}` : "nenhuma pesquisa interrompida"} tone={total429 > 0 ? "alerta" : undefined} testId="tel-429" />
        <Stat icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} label="Cache aproveitado" value={fmt(summary.coleta.cacheReutilizado)} hint={`${plural(summary.coleta.pesquisasReutilizadas, "pacote de pesquisa reutilizado", "pacotes de pesquisa reutilizados")}`} testId="tel-cache" />
        <Stat icon={<Timer className="h-3.5 w-3.5" aria-hidden="true" />} label="Tempo médio (busca)" value={fmtMs(summary.coleta.tempoMedioBuscaMs)} hint={`leitura de página: ${fmtMs(summary.coleta.tempoMedioLeituraMs)}`} testId="tel-tempo-busca" />
        <Stat icon={<Timer className="h-3.5 w-3.5" aria-hidden="true" />} label="Tempo médio (IA)" value={fmtMs(summary.ia.tempoMedioMs)} hint={`${fmt(summary.ia.tokens.informadas)} com relato · ${fmt(summary.ia.tokens.naoInformadas)} sem`} testId="tel-tempo-ia" />
        <Stat icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />} label="Contas identificadas" value={`${fmt(summary.contas.identificadas)} / ${fmt(summary.contas.linhas)}`} hint={`${summary.contas.emRevisao} em revisão · ${summary.contas.descartadasSemPista} sem pista`} testId="tel-contas" />
      </div>

      {summary.coleta.fontesCadastro && summary.coleta.fontesCadastro.length > 0 && (
        <div className="mt-4 overflow-x-auto" data-testid="tel-fontes-cadastro">
          <p className="ds-caption mb-1 font-medium text-senior-cinza-500">Consulta cadastral (consultas reais; reuso de ficha não conta como consulta)</p>
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="border-b border-senior-cinza-200">
                <th className="ds-caption py-1.5 font-medium text-senior-cinza-500">Consulta</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Consultas</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">OK</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Limite</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Falha</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Tempo médio</th>
              </tr>
            </thead>
            <tbody>
              {summary.coleta.fontesCadastro.map((f) => (
                <tr key={f.fonte} className="border-b border-senior-cinza-100 last:border-0">
                  <td className="ds-body py-1.5 font-medium text-senior-azul" title={f.fonte}>{sourceLabel(f.fonte)}</td>
                  <td className="ds-body py-1.5 text-right">{fmt(f.consultas)}</td>
                  <td className="ds-body py-1.5 text-right text-[#086B6B]">{fmt(f.sucesso)}</td>
                  <td className={`ds-body py-1.5 text-right ${f.bloqueado > 0 ? "text-[#8a6d00]" : ""}`}>{fmt(f.bloqueado) || "—"}</td>
                  <td className={`ds-body py-1.5 text-right ${f.falha > 0 ? "text-[#8C2F39]" : ""}`}>{fmt(f.falha) || "—"}</td>
                  <td className="ds-body py-1.5 text-right">{fmtMs(f.tempoMedioMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.etapas.length > 0 && (
        <div className="mt-4 overflow-x-auto" data-testid="tel-etapas">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-senior-cinza-200">
                <th className="ds-caption py-1.5 font-medium text-senior-cinza-500">Etapa</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Execuções</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">OK</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Parcial</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Falha</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Bloqueada</th>
                <th className="ds-caption py-1.5 text-right font-medium text-senior-cinza-500">Tempo médio</th>
              </tr>
            </thead>
            <tbody>
              {summary.etapas.map((e) => (
                <tr key={e.etapa} className="border-b border-senior-cinza-100 last:border-0">
                  <td className="ds-body py-1.5 font-medium text-senior-azul">{ETAPA_LABEL[e.etapa] ?? e.etapa}</td>
                  <td className="ds-body py-1.5 text-right">{fmt(e.execucoes)}</td>
                  <td className="ds-body py-1.5 text-right text-[#086B6B]">{fmt(e.sucesso)}</td>
                  <td className="ds-body py-1.5 text-right">{fmt(e.parcial) || "—"}</td>
                  <td className={`ds-body py-1.5 text-right ${e.falha > 0 ? "text-[#8C2F39]" : ""}`}>{fmt(e.falha) || "—"}</td>
                  <td className={`ds-body py-1.5 text-right ${e.bloqueado > 0 ? "text-[#8a6d00]" : ""}`}>{fmt(e.bloqueado) || "—"}</td>
                  <td className="ds-body py-1.5 text-right">{fmtMs(e.duracaoMediaMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.ia.modelos.length > 0 && (
        <p className="ds-caption mt-3 text-senior-cinza-500" data-testid="tel-modelos">
          Análises por IA: {plural(summary.ia.modelos.reduce((acc, m) => acc + m.chamadas, 0), "chamada executada", "chamadas executadas")}. Os modelos usados ficam na exportação técnica de auditoria.
        </p>
      )}
      <p className="ds-caption mt-1.5 text-senior-cinza-400">
        Valores medidos nos eventos do lote. A plataforma não expõe limite de cota; nenhum número aqui é estimado.
      </p>
    </div>
  );
}
