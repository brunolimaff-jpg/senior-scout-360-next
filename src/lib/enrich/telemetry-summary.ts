/**
 * Visão consolidada da telemetria (Lote A3 — 5.4/5.5).
 * Agrega TelemetryEvent + contadores de linhas do lote — NADA inventado:
 * todo número vem de eventos persistidos; "não informado" nunca vira zero.
 */
import { db } from "@/lib/db";
import { PROMPT_VERSION } from "@/lib/enrich/ai";
import { appVersion } from "@/lib/version";

export interface TelemetrySummary {
  lote: {
    id: string;
    arquivo: string;
    status: string;
    confirmadoEm: string | null;
    appVersao: string;
    promptVersao: string;
  };
  contas: {
    linhas: number;
    identificadas: number;
    enriquecidas: number;
    emRevisao: number;
    naoIdentificadas: number;
    descartadasSemPista: number;
    duplicadas: number;
    comLeituraIa: number;
    leiturasFalhadas: number;
  };
  coleta: {
    consultasCadastro: number;
    cacheCadastro: number;
    buscasWeb: number;
    leiturasPagina: number;
    buscas429: number;
    leituras429: number;
    pesquisasIncompletas: number; // pacotes com buscas recusadas por cota
    pesquisasReutilizadas: number; // pacotes reaproveitados (cache < 24h)
    cacheReutilizado: number; // eventos com cacheHit=true (qualquer tipo)
    tempoMedioBuscaMs: number | null;
    tempoMedioLeituraMs: number | null;
    /** v0.10.0 P1: telemetria POR FONTE de cadastro (consultas, 429, latência) */
    fontesCadastro: { fonte: string; consultas: number; sucesso: number; bloqueado: number; falha: number; tempoMedioMs: number | null }[];
  };
  ia: {
    chamadas: number;
    cacheHits: number;
    regeneracoesManuais?: number;
    tokens: { prompt: number | null; completion: number | null; total: number | null; informadas: number; naoInformadas: number };
    tempoMedioMs: number | null;
    modelos: { solicitado: string | null; efetivo: string | null; chamadas: number }[];
    erros: number;
  };
  etapas: {
    etapa: string;
    execucoes: number;
    sucesso: number;
    parcial: number;
    falha: number;
    bloqueado: number;
    duracaoMediaMs: number | null;
  }[];
}

export async function buildTelemetrySummary(batchId: string): Promise<TelemetrySummary | null> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return null;

  const [
    porTipo,
    porTipoCache,
    por429,
    etapas,
    modelos,
    iaSemToken,
    iaErros,
    rows,
    deepPacotes,
    cadastroPorFonte,
  ] = await Promise.all([
    db.telemetryEvent.groupBy({
      by: ["tipo"],
      _count: { _all: true },
      _sum: { duracaoMs: true, tokensPrompt: true, tokensCompletion: true, tokensTotal: true, resultados: true },
      _avg: { duracaoMs: true },
      where: { batchId },
    }),
    db.telemetryEvent.groupBy({ by: ["tipo", "cacheHit"], _count: { _all: true }, where: { batchId, cacheHit: true } }),
    db.telemetryEvent.groupBy({ by: ["tipo"], _count: { _all: true }, where: { batchId, httpStatus: 429 } }),
    db.telemetryEvent.groupBy({
      by: ["etapa", "estadoFinal"],
      _count: { _all: true },
      _avg: { duracaoMs: true },
      where: { batchId, tipo: "ETAPA" },
    }),
    db.telemetryEvent.groupBy({
      by: ["modeloSolicitado", "modeloEfetivo"],
      _count: { _all: true },
      where: { batchId, tipo: "IA_CHAT" },
    }),
    db.telemetryEvent.count({ where: { batchId, tipo: "IA_CHAT", cacheHit: false, tokensInformado: false } }),
    db.telemetryEvent.count({ where: { batchId, tipo: "IA_CHAT", estadoFinal: { in: ["falha", "bloqueado"] } } }),
    db.importRow.findMany({
      where: { batchId },
      select: { lookupStatus: true, cnpjStatus: true, resolvedCnpj: true, normalizedCnpj: true, aiStatus: true, aiReading: true, researchJson: true, resolutionState: true },
    }),
    db.telemetryEvent.count({ where: { batchId, tipo: "ETAPA", etapa: "PESQUISA_PROFUNDA", cacheHit: true } }),
    db.telemetryEvent.groupBy({
      by: ["fonte", "estadoFinal"],
      _count: { _all: true },
      _avg: { duracaoMs: true },
      where: { batchId, tipo: "COLETA_CADASTRO", cacheHit: false },
    }),
  ]);

  const tipoStat = (t: string) => porTipo.find((p) => p.tipo === t);
  const count = (t: string) => tipoStat(t)?._count._all ?? 0;
  const cacheOf = (t: string) => porTipoCache.find((p) => p.tipo === t)?._count._all ?? 0;

  const contas = {
    linhas: rows.length,
    // identificada = resolvida por pista OU veio com CNPJ válido e concluiu
    identificadas: rows.filter((r) => r.resolvedCnpj || r.cnpjStatus === "VALIDA").length,
    enriquecidas: rows.filter((r) => r.lookupStatus === "ENRIQUECIDO").length,
    // revisão = tudo que precisa de decisão humana (REVIEW explícito ou NAO_ENCONTRADO honesto)
    emRevisao: rows.filter((r) => r.resolutionState === "REVIEW" || r.lookupStatus === "NAO_ENCONTRADO").length,
    naoIdentificadas: rows.filter((r) => r.lookupStatus === "NAO_ENCONTRADO").length,
    descartadasSemPista: rows.filter((r) => r.cnpjStatus === "SEM_CNPJ").length,
    duplicadas: rows.filter((r) => r.cnpjStatus === "DUPLICADA").length,
    comLeituraIa: rows.filter((r) => r.aiStatus === "OK" && r.aiReading).length,
    leiturasFalhadas: rows.filter((r) => r.aiStatus === "FALHOU").length,
  };

  let pacotesIncompletos = 0;
  for (const r of rows) {
    if (!r.researchJson) continue;
    try {
      const p = JSON.parse(r.researchJson) as { buscasRecusadasCota?: number };
      if ((p.buscasRecusadasCota ?? 0) > 0) pacotesIncompletos++;
    } catch {
      /* tolerante */
    }
  }

  const etapasAgr = new Map<string, { n: number; dur: number[]; by: Map<string, number> }>();
  for (const e of etapas) {
    const key = e.etapa ?? "(sem etapa)";
    const acc = etapasAgr.get(key) ?? { n: 0, dur: [], by: new Map<string, number>() };
    acc.n += e._count._all;
    if (typeof e._avg.duracaoMs === "number") acc.dur.push(e._avg.duracaoMs * e._count._all);
    acc.by.set(e.estadoFinal ?? "—", (acc.by.get(e.estadoFinal ?? "—") ?? 0) + e._count._all);
    etapasAgr.set(key, acc);
  }

  const iaStat = tipoStat("IA_CHAT");
  const somaTokens = {
    prompt: iaStat?._sum.tokensPrompt ?? null,
    completion: iaStat?._sum.tokensCompletion ?? null,
    total: iaStat?._sum.tokensTotal ?? null,
  };

  return {
    lote: {
      id: batch.id,
      arquivo: batch.fileName,
      status: batch.status,
      confirmadoEm: batch.confirmedAt?.toISOString() ?? null,
      appVersao: appVersion(),
      promptVersao: PROMPT_VERSION,
    },
    contas,
    coleta: {
      consultasCadastro: count("COLETA_CADASTRO"),
      cacheCadastro: cacheOf("COLETA_CADASTRO"),
      buscasWeb: count("WEB_SEARCH"),
      leiturasPagina: count("PAGE_READER"),
      buscas429: por429.find((p) => p.tipo === "WEB_SEARCH")?._count._all ?? 0,
      leituras429: por429.find((p) => p.tipo === "PAGE_READER")?._count._all ?? 0,
      pesquisasIncompletas: pacotesIncompletos,
      pesquisasReutilizadas: deepPacotes,
      cacheReutilizado: porTipoCache.reduce((n, p) => n + p._count._all, 0),
      tempoMedioBuscaMs: tipoStat("WEB_SEARCH")?._avg.duracaoMs ?? null,
      tempoMedioLeituraMs: tipoStat("PAGE_READER")?._avg.duracaoMs ?? null,
      fontesCadastro: (() => {
        const agr = new Map<string, { n: number; sucesso: number; bloqueado: number; falha: number; durSom: number }>();
        for (const e of cadastroPorFonte) {
          const f = e.fonte ?? "(sem fonte)";
          const acc = agr.get(f) ?? { n: 0, sucesso: 0, bloqueado: 0, falha: 0, durSom: 0 };
          acc.n += e._count._all;
          if (e.estadoFinal === "sucesso") acc.sucesso += e._count._all;
          else if (e.estadoFinal === "bloqueado") acc.bloqueado += e._count._all;
          else acc.falha += e._count._all;
          if (typeof e._avg.duracaoMs === "number") acc.durSom += e._avg.duracaoMs * e._count._all;
          agr.set(f, acc);
        }
        return [...agr.entries()]
          .map(([fonte, a]) => ({
            fonte,
            consultas: a.n,
            sucesso: a.sucesso,
            bloqueado: a.bloqueado,
            falha: a.falha,
            tempoMedioMs: a.n > 0 ? Math.round(a.durSom / a.n) : null,
          }))
          .sort((a, b) => b.consultas - a.consultas);
      })(),
    },
    ia: {
      chamadas: count("IA_CHAT") - cacheOf("IA_CHAT"),
      cacheHits: cacheOf("IA_CHAT"),
      tokens: {
        ...somaTokens,
        informadas: (iaStat?._count._all ?? 0) - cacheOf("IA_CHAT") - iaSemToken,
        naoInformadas: iaSemToken,
      },
      tempoMedioMs: iaStat?._avg.duracaoMs ?? null,
      modelos: modelos
        .map((m) => ({ solicitado: m.modeloSolicitado, efetivo: m.modeloEfetivo, chamadas: m._count._all }))
        .sort((a, b) => b.chamadas - a.chamadas),
      erros: iaErros,
    },
    etapas: [...etapasAgr.entries()].map(([etapa, acc]) => {
      const total = acc.n || 1;
      const durMedia = acc.dur.length ? Math.round(acc.dur.reduce((a, b) => a + b, 0) / total) : null;
      return {
        etapa,
        execucoes: acc.n,
        sucesso: acc.by.get("sucesso") ?? 0,
        parcial: acc.by.get("parcial") ?? 0,
        falha: acc.by.get("falha") ?? 0,
        bloqueado: acc.by.get("bloqueado") ?? 0,
        duracaoMediaMs: durMedia,
      };
    }),
  };
}
