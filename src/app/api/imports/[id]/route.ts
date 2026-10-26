import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { isBatchLocked, recordAudit, sweepStalled, recomputeCounters, batchHasLiveLease, getResearchQueue, isResearchQueueRunning, parseStoredFile } from "@/lib/enrich/engine";
import { assertAccess } from "@/lib/auth";
import { setorDeCnae } from "@/lib/enrich/segmentos";
import type { ResearchPacketView } from "@/lib/types";
import type { FontesProveniencia } from "@/lib/enrich/cadastro-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CNPJ_FILTERS = ["VALIDA", "INVALIDA", "DUPLICADA", "SEM_CNPJ", "REFERENCIA"] as const;
const LOOKUP_FILTERS: Record<string, string[]> = {
  ENRIQUECIDO: ["ENRIQUECIDO"],
  FILA: ["PENDENTE", "EM_FILA", "CONSULTANDO"],
  FALHAS: ["NAO_ENCONTRADO", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"],
};
const AI_FILTERS: Record<string, string[]> = {
  OK: ["OK"],
  PENDENTE: ["EM_FILA", "GERANDO"],
  ERRO: ["FALHOU"],
  FORA: ["IGNORADO"],
};
// Mesa de Contas (v0.9.0): visibilidade do estado da PESQUISA por conta
const RESEARCH_FILTERS: Record<string, string[] | null> = {
  com_dossie: ["OK"],
  gerando: ["GERANDO"],
  falhou: ["FALHOU"],
  sem_pesquisa: null, // researchStatus nunca pedido (null) —_where especial_
};

/** v0.11.3 (missão Lotes+Mesa): MESMA definição canônica de “sem bloqueio de
 * identidade” usada pelo contador totalReview (engine.recomputeCounters) e pelo
 * conjunto “Identificadas” da tabela — decisão humana pendente (REVIEW) ou registro
 * localizado divergente (LOCALIZADO com ficha coletada) BLOQUEIAM o dossiê na Mesa.
 * A conta continua visível em Lotes (pendente de revisão) — nunca desaparece. */
const SEM_BLOQUEIO_IDENTIDADE = [
  { OR: [{ resolutionState: null }, { resolutionState: { not: "REVIEW" } }] },
  { OR: [{ identityStage: null }, { identityStage: { not: "LOCALIZADO" } }] },
];

/** v0.11.3: filtro canônico do filtro rápido “Dossiês” da Mesa — pesquisa solicitada
 * e CONCLUÍDA (researchStatus OK), síntese concluída (aiStatus OK), cadastro coletado
 * e identidade sem bloqueio. É a MESMA população do contador pesquisaProfunda.dossiesProntos:
 * o número do botão e a tabela filtrada contam exatamente o mesmo conjunto. */
const DOSSIE_PRONTO_WHERE = {
  researchStatus: "OK",
  aiStatus: "OK",
  lookupStatus: "ENRIQUECIDO",
  AND: SEM_BLOQUEIO_IDENTIDADE,
};

const RESOLUTION_FILTERS: Record<string, string> = {
  CONFIRMED: "CONFIRMED",
  REVIEW: "REVIEW",
  UNRESOLVED: "UNRESOLVED",
};

// v0.10.12: "Revisar" inclui registro LOCALIZADO (divergência de identidade);
// "Identificadas" exclui divergentes (não são identificadas até revisar/validar) e
// INCLUDE linhas de CNPJ direto enriquecidas (resolutionState null — o rótulo novo
// do filtro é "Identificadas", não mais "resolução CONFIRMED").
const whereResolucao = (filtro: string): Record<string, unknown> | null => {
  // v0.11.2 (UX): "Revisar" alinhado ao contador do engine (totalReview, engine.ts):
  // REVIEW OU LOCALIZADO COM ficha coletada. Antes o filtro incluía LOCALIZADO sem
  // coleta (em processamento) — clicar em "Revisar agora" mostrava mais linhas do
  // que a contagem do chip, e a mensagem parecia contradizer os filtros rápidos.
  if (filtro === "REVIEW") return { OR: [{ resolutionState: "REVIEW" }, { identityStage: "LOCALIZADO", lookupStatus: "ENRIQUECIDO" }] };
  if (filtro === "CONFIRMED") {
    return {
      identityStage: { not: "LOCALIZADO" },
      OR: [{ resolutionState: "CONFIRMED" }, { resolutionState: null, lookupStatus: "ENRIQUECIDO" }],
    };
  }
  if (filtro === "UNRESOLVED") {
    // v0.11.0 (homologação Gate 2): o `not` do Prisma EXCLUI nulos — toda linha
    // UNRESOLVED de pipeline tem identityStage NULL e o filtro devolvia 0 mesmo com
    // linhas "Não encontrada" no lote (contadores e filtro divergiam). NULL participa.
    return {
      resolutionState: "UNRESOLVED",
      OR: [{ identityStage: null }, { identityStage: { not: "LOCALIZADO" } }],
    };
  }
  return null;
};

/**
 * GET /api/imports/:id?page=1&pageSize=50&cnpj=ALL&lookup=ALL
 * Detalhe + linhas paginadas/filtradas + últimos eventos de auditoria.
 * G9: a guarda vem ANTES de qualquer efeito colateral — o sweep de recuperação
 * (mutação de estado) SÓ roda para chamadas autorizadas; anônimo recebe 401
 * sem tocar no banco.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertAccess(req); // G9: leitura protegida — sweep só depois
    if (denied) return denied;
    const { id } = await ctx.params;
    await sweepStalled(); // recuperação idempotente a cada consulta AUTORIZADA
    // auto-cura dos contadores (idempotente, barato no SQLite): mantém a UI sempre
    // coerente com as linhas reais, mesmo após reinícios/falhas no meio do processamento
    const exists = await db.importBatch.findUnique({ where: { id }, select: { status: true } });
    if (!exists) return errRes("NOT_FOUND", "Lote não encontrado.", 404);
    if (exists.status !== "PREVIEW") {
      await recomputeCounters(id);
    }

    const batch = await db.importBatch.findUnique({ where: { id } });
    if (!batch) return errRes("NOT_FOUND", "Lote não encontrado.", 404);

    // paginação/filtros
    const url = req.nextUrl;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(url.searchParams.get("pageSize")) || 50));
    const cnpjFilter = url.searchParams.get("cnpj") ?? "ALL";
    const lookupFilter = url.searchParams.get("lookup") ?? "ALL";
    const aiFilter = url.searchParams.get("ai") ?? "ALL";
    const resolucaoFilter = url.searchParams.get("resolucao") ?? "ALL";
    const pesquisaFilter = url.searchParams.get("pesquisa") ?? "ALL";
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);

    const where: Record<string, unknown> = { batchId: id };
    if (CNPJ_FILTERS.includes(cnpjFilter as (typeof CNPJ_FILTERS)[number])) {
      where.cnpjStatus = cnpjFilter;
    }
    if (lookupFilter in LOOKUP_FILTERS) {
      where.lookupStatus = { in: LOOKUP_FILTERS[lookupFilter] };
    }
    if (aiFilter in AI_FILTERS) {
      where.aiStatus = { in: AI_FILTERS[aiFilter] };
    }
    if (resolucaoFilter in RESOLUTION_FILTERS) {
      const wr = whereResolucao(resolucaoFilter);
      if (wr) Object.assign(where, wr);
    }
    if (pesquisaFilter in RESEARCH_FILTERS) {
      const statuses = RESEARCH_FILTERS[pesquisaFilter];
      if (statuses) where.researchStatus = { in: statuses };
      else where.researchStatus = null; // sem_pesquisa: nunca pedido
    } else if (pesquisaFilter === "dossie_pronto") {
      // v0.11.3 (missão Lotes+Mesa): população da Mesa — composta (pesquisa+síntese+
      // identidade), não apenas researchStatus. where.AND não conflita com where.OR da busca q.
      Object.assign(where, DOSSIE_PRONTO_WHERE);
    }
    if (q) {
      const digits = q.replace(/\D+/g, "");
      const orConditions: Record<string, unknown>[] = [
        { rawCnpj: { contains: q } },
        { legalName: { contains: q } },
        { referenceValue: { contains: q.toLowerCase() } },
      ];
      if (digits.length >= 3) {
        orConditions.push({ normalizedCnpj: { contains: digits } });
        orConditions.push({ resolvedCnpj: { contains: digits } });
      }
      where.OR = orConditions;
    }

    const [totalFiltered, rows, events, totalMatriz, totalDirectCnpj, alertBaixada, alertMatriz, alertHumana, sectorAgg, ufAgg, situAgg, pjRaizesIdentificadas, pjRaizesLocalizadas, matrizRaizes, cnaeRows, totalFalhasConsulta, totalFila, ppSolicitadas, ppConcluidas, ppEmExecucao, ppSintetizando, ppFalhas, ppDossiesProntos, ppElegiveis] = await Promise.all([
      db.importRow.count({ where }),
      db.importRow.findMany({
        where,
        orderBy: { rowNumber: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.auditEvent.findMany({
        where: { batchId: id },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      // métrica operacional para a superfície do produto: quantas matrizes foram confirmadas
      // pelo campo oficial identificador_matriz_filial = 1 (somente leitura; não altera o pipeline)
      db.importRow.count({ where: { batchId: id, matrizStatus: "RESOLVIDA" } }),
      // entradas que já vieram com CNPJ válido e foram concluídas — contam como identificadas
      // v0.11.0 (Gate 3/C): EXCLUI as linhas LOCALIZADO (registro localizado com
      // divergência — a tabela as marca como "Revisar"). Antes o contador somava
      // essas linhas em "Identificadas" E em "Revisar" ao mesmo tempo: o botão
      // dizia 62, o filtro que ele mesmo aplica devolvia 54.
      db.importRow.count({
        where: {
          batchId: id,
          cnpjStatus: "VALIDA",
          lookupStatus: "ENRIQUECIDO",
          OR: [{ identityStage: null }, { identityStage: { not: "LOCALIZADO" } }],
        },
      }),
      // alertas materiais (batch-wide): devem saltar na tela antes de qualquer exportação
      db.importRow.count({ where: { batchId: id, lookupStatus: "ENRIQUECIDO", registrationStatus: { in: ["BAIXADA", "SUSPENSA", "INAPTA", "NULA"] } } }),
      db.importRow.count({ where: { batchId: id, matrizStatus: "NAO_LOCALIZADA" } }),
      db.importRow.count({ where: { batchId: id, resolutionConfidence: "HUMANA" } }),
      // panorama do lote: distribuições batch-wide (top 6) — setor vem da leitura de IA,
      // UF/situação vêm dos fatos confirmados das fontes públicas
      db.importRow.groupBy({
        by: ["aiSector"],
        where: { batchId: id, aiStatus: "OK", aiSector: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { aiSector: "desc" } },
        take: 6,
      }),
      db.importRow.groupBy({
        by: ["uf"],
        where: { batchId: id, lookupStatus: "ENRIQUECIDO", uf: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { uf: "desc" } },
        take: 6,
      }),
      db.importRow.groupBy({
        by: ["registrationStatus"],
        where: { batchId: id, lookupStatus: "ENRIQUECIDO", registrationStatus: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { registrationStatus: "desc" } },
      }),
      // v0.10.7 (auditoria): quantidades DISTINTAS pela raiz — a raiz é a pessoa
      // jurídica; linhas da mesma raiz (matriz+filiais) não são empresas distintas.
      // v0.10.14 (reconciliação): "identificadas" = o conjunto que a tabela marca
      // como Identificada (ficha coletada, sem divergência de identidade pendente);
      // "localizadas" = toda raiz com ficha coletada, incluindo as 6+ em revisão.
      // O resumo passa a distinguir os dois números em vez de chamar tudo de identificado.
      db.importRow.groupBy({
        by: ["cnpjRoot"],
        where: {
          batchId: id,
          lookupStatus: "ENRIQUECIDO",
          cnpjRoot: { not: null },
          identityStage: { not: "LOCALIZADO" },
          OR: [{ resolutionState: null }, { resolutionState: "CONFIRMED" }],
        },
      }),
      db.importRow.groupBy({
        by: ["cnpjRoot"],
        where: { batchId: id, lookupStatus: "ENRIQUECIDO", cnpjRoot: { not: null } },
      }),
      db.importRow.groupBy({
        by: ["headquartersCnpj"],
        where: { batchId: id, matrizStatus: "RESOLVIDA", headquartersCnpj: { not: null } },
      }),
      // v0.10.8 (coerência sem IA): setor CADASTRAL pela tabela CNAE 2.0 — derivado
      // localmente do código já coletado na ficha (zero IA, zero rede).
      db.importRow.findMany({
        where: { batchId: id, lookupStatus: "ENRIQUECIDO", cnaeCode: { not: null } },
        select: { cnaeCode: true },
      }),
      // v0.10.15 (reconciliação): consultas terminadas em FALHA de fonte — separadas
      // de "não identificadas" (pista insuficiente) na leitura do lote
      db.importRow.count({
        where: { batchId: id, lookupStatus: { in: ["NAO_ENCONTRADO", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"] } },
      }),
      // v0.11.0 (Gate 3/C): contador do filtro rápido "Pendentes" — mesma população
      // do LOOKUP_FILTERS.FILA, para o número do botão bater com a tabela filtrada.
      db.importRow.count({ where: { batchId: id, lookupStatus: { in: LOOKUP_FILTERS.FILA } } }),
      // v0.11.3 (missão Lotes+Mesa): dimensão PESQUISA PROFUNDA do contrato de estados —
      // contadores batch-wide diretos da fonte canônica (campos das linhas). A fila
      // por seleção (filaPesquisa) é um DETALHE de execução; estes números são o estado
      // consolidado do lote. "Dossiês prontos" usa EXATAMENTE o DOSSIE_PRONTO_WHERE
      // (mesma população do filtro rápido da Mesa) — contador e tabela nunca divergem.
      db.importRow.count({ where: { batchId: id, researchStatus: { not: null } } }),
      db.importRow.count({ where: { batchId: id, researchStatus: "OK" } }),
      db.importRow.count({ where: { batchId: id, researchStatus: "GERANDO" } }),
      db.importRow.count({ where: { batchId: id, researchStatus: "OK", aiStatus: { in: ["EM_FILA", "GERANDO"] } } }),
      db.importRow.count({ where: { batchId: id, OR: [{ researchStatus: "FALHOU" }, { researchStatus: "OK", aiStatus: "FALHOU" }] } }),
      db.importRow.count({ where: { batchId: id, ...DOSSIE_PRONTO_WHERE } }),
      db.importRow.count({ where: { batchId: id, lookupStatus: "ENRIQUECIDO", AND: SEM_BLOQUEIO_IDENTIDADE } }),
    ]);

    const header = JSON.parse(batch.headerJson || "[]") as string[];
    // v0.9.1 — recuperação de PRÉVIA: um lote PREVIEW não tem linhas no banco (linhas
    // nascem no confirm) e estava INALCANÇÁVEL após perder o estado do cliente
    // (reload/navegação) — o upload do operador desaparecia. Reconstruímos a prévia
    // do ARQUIVO salvo (determinístico, zero chamada externa) para o cliente reabrir.
    const previewRecoveravel = await (async () => {
      if (batch.status !== "PREVIEW" || !batch.storedPath) return null;
      try {
        const parsed = await parseStoredFile(batch.storedPath);
        const hasHeader = batch.hasHeader;
        const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
        if (dataRows.length === 0) return null;
        return {
          header,
          sampleRows: dataRows.slice(0, 5),
          cnpjColumnIndex: batch.cnpjColumnIndex,
          rowCount: dataRows.length,
        };
      } catch {
        // arquivo sumiu/ilegível: prévia irrecuperável — o lote segue arquivável via histórico
        return null;
      }
    })();
    return okRes({
      batch: {
        id: batch.id,
        fileName: batch.fileName,
        status: batch.status,
        sourceType: batch.sourceType,
        fileSize: batch.fileSize,
        delimiter: batch.delimiter,
        encoding: batch.encoding,
        hasHeader: batch.hasHeader,
        header,
        cnpjColumnIndex: batch.cnpjColumnIndex,
        rowCount: batch.rowCount,
        totalValid: batch.totalValid,
        totalInvalid: batch.totalInvalid,
        totalDuplicate: batch.totalDuplicate,
        totalReference: batch.totalReference,
        totalResolved: batch.totalResolved,
        totalEnriched: batch.totalEnriched,
        totalPending: batch.totalPending,
        totalConfirmed: batch.totalConfirmed,
        totalLocalizado: batch.totalLocalizado,
        totalValidado: batch.totalValidado,
        totalReview: batch.totalReview,
        totalUnresolved: batch.totalUnresolved,
        totalMatriz,
        totalDirectCnpj,
        // v0.11.0 (Gate 3/C): população EXATA do filtro rápido "Pendentes"
        // (lookup FILA: PENDENTE/EM_FILA/CONSULTANDO). O totalPending do lote
        // segue existindo para "X de Y consultas concluídas" (lá as falhas
        // recuperáveis contam como não concluídas — semântica diferente).
        totalFila,
        // v0.10.7 (auditoria): contagens DISTINTAS exibidas nos indicadores —
        // pessoas jurídicas (raízes com coleta concluída) e matrizes distintas
        // confirmadas (uma por raiz); os contadores por linha seguem ao lado.
        // v0.10.14 (reconciliação): identificadas = raízes compatíveis com as pistas;
        // localizadas = todas as raízes com ficha coletada (inclui as em revisão).
        totalPessoasJuridicas: pjRaizesIdentificadas.length,
        totalPessoasJuridicasLocalizadas: pjRaizesLocalizadas.length,
        totalMatrizesDistintas: matrizRaizes.length,
        totalFalhasConsulta,
        alertBaixada,
        alertMatriz,
        alertHumana,
        sectorDist: sectorAgg.map((s) => ({ key: String(s.aiSector), count: s._count._all })),
        cnaeDist: cnaeDistDe(cnaeRows),
        ufDist: ufAgg.map((s) => ({ key: String(s.uf), count: s._count._all })),
        situacaoDist: situAgg.map((s) => ({ key: String(s.registrationStatus), count: s._count._all })),
        aiEnabled: batch.aiEnabled,
        aiTotal: batch.aiTotal,
        aiDone: batch.aiDone,
        aiFailed: batch.aiFailed,
        aiSummary: safeParse(batch.aiSummary ?? "") || null,
        aiSummaryAt: batch.aiSummaryAt,
        createdAt: batch.createdAt,
        confirmedAt: batch.confirmedAt,
        processingAt: batch.processingAt,
        finishedAt: batch.finishedAt,
        processingNow: isBatchLocked(id) || batchHasLiveLease(batch), // G6: lease no banco vale entre processos
        // v0.9.1: prévia reconstruída do arquivo salvo (lote PREVIEW ficou inalcançável)
        previewRecoveravel,
        // Mesa de Contas (v0.9.0): estado durável da fila de pesquisa por seleção
        filaPesquisa: await (async () => {
          const q = await getResearchQueue(id);
          if (!q) return null;
          return {
            estado: q.estado,
            posicao: q.posicao,
            total: q.rowNumbers.length,
            concluidas: q.concluidas,
            puladas: q.puladas,
            falhas: q.falhas,
            motivoPausa: q.motivoPausa,
            solicitadoEm: q.solicitadoEm,
            heartbeat: q.heartbeat,
            executorVivo: isResearchQueueRunning(id),
            // contas ainda não processadas — visibilidade per/linha na coluna Scout
            pendentes: q.rowNumbers.slice(q.posicao).slice(0, 500),
          };
        })(),
        // v0.11.3 (missão Lotes+Mesa): contadores canônicos da pesquisa profunda —
        // cada etapa com o próprio número e denominador; 11 identificadas com 3
        // dossiês prontos NUNCA aparecem como 11 prontos.
        pesquisaProfunda: {
          solicitadas: ppSolicitadas,
          concluidas: ppConcluidas,
          emExecucao: ppEmExecucao,
          sintetizando: ppSintetizando,
          falhas: ppFalhas,
          dossiesProntos: ppDossiesProntos,
          identificadasElegiveis: ppElegiveis,
        },
      },
      rows: rows.map((r) => ({
        id: r.id, // Lote B: identificador da linha para o laboratório de comparação
        rowNumber: r.rowNumber,
        entrada: safeFirstCell(r.originalCellsJson),
        lookupKind: r.lookupKind,
        referenceValue: r.referenceValue,
        resolvedCnpj: r.resolvedCnpj,
        reverseSource: r.reverseSource,
        clues: safeParse(r.cluesJson ?? "") || null,
        resolution: safeParse(r.resolutionJson ?? "") || null,
        resolutionState: r.resolutionState,
        resolutionConfidence: r.resolutionConfidence,
        identityStage: r.identityStage,
        identityDivergencias: (() => {
          try {
            const arr = r.identityDivergenciasJson ? (JSON.parse(r.identityDivergenciasJson) as { tipo: string; severidade: string; descricao: string }[]) : [];
            return Array.isArray(arr) ? arr : [];
          } catch {
            return [];
          }
        })(),
        cnpjRoot: r.cnpjRoot,
        headquartersCnpj: r.headquartersCnpj,
        foundIsHeadquarters: r.foundIsHeadquarters,
        matrizStatus: r.matrizStatus,
        branchIdentifier: r.branchIdentifier,
        rawCnpj: r.rawCnpj,
        normalizedCnpj: r.normalizedCnpj,
        cnpjStatus: r.cnpjStatus,
        invalidReason: r.invalidReason,
        duplicateOf: r.duplicateOf,
        lookupStatus: r.lookupStatus,
        lookupError: r.lookupError,
        legalName: r.legalName,
        tradeName: r.tradeName,
        registrationStatus: r.registrationStatus,
        branchType: r.branchType,
        municipality: r.municipality,
        uf: r.uf,
        cnaeDescription: r.cnaeDescription,
        openingDate: r.openingDate,
        source: r.source,
        queriedAt: r.queriedAt,
        collectedAt: r.collectedAt,
        fontes: parseFontesView(r.fontesJson),
        aiStatus: r.aiStatus,
        aiReading: r.aiReading,
        aiSector: r.aiSector,
        aiSize: r.aiSize,
        aiProfile: r.aiProfile,
        aiModel: r.aiModel,
        aiModelRequested: r.aiModelRequested,
        aiHypotheses: safeJsonArray(r.aiHypothesesJson),
        aiDossier: safeParse(r.aiDossierJson ?? "") || null,
        researchStatus: r.researchStatus,
        researchAt: r.researchAt,
        researchError: r.researchError,
        research: parseResearchView(r.researchJson),
        socios: safeJsonRaw(r.sociosJson) as { nome: string; qual: string; entrada: string }[],
        extra: safeParse(r.extraJson ?? "") || null,
        aiProcessedAt: r.aiProcessedAt,
        aiError: r.aiError,
      })),
      pagination: {
        page,
        pageSize,
        total: totalFiltered,
        totalPages: Math.max(1, Math.ceil(totalFiltered / pageSize)),
      },
      events: events.map((e) => ({
        id: e.id,
        ts: e.createdAt,
        event: e.event,
        rowNumber: e.rowNumber,
        detail: safeParse(e.detail),
      })),
    });
  } catch (err) {
    return fail500(err);
  }
}

/** DELETE /api/imports/:id — arquivar (remover da lista) um lote. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertAccess(req); // G9: mutação de dados exige autorização
    if (denied) return denied;
    const { id } = await ctx.params;
    const batch = await db.importBatch.findUnique({ where: { id } });
    if (!batch) return errRes("NOT_FOUND", "Lote não encontrado.", 404);
    await recordAudit(id, "ARCHIVED");
    await db.importBatch.delete({ where: { id } });
    return okRes({ deleted: id });
  } catch (err) {
    return fail500(err);
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** v0.10.8: distribuição de SETOR CADASTRAL (seção CNAE 2.0) derivada localmente
 *  do código do registro — determinística, sem IA, sem rede. Sem código legível →
 *  sem entrada (honesto: nunca inventar setor). Top 6. */
function cnaeDistDe(rows: { cnaeCode: string | null }[]): { key: string; count: number }[] {
  const contagem = new Map<string, number>();
  for (const r of rows) {
    if (!r.cnaeCode) continue;
    const s = setorDeCnae(r.cnaeCode);
    if (!s) continue;
    const chave = `${s.secao} — ${s.secaoNome}`;
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

/** Normaliza texto para matching determinístico de atribuição de sinais. */
function normParaMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

/** v0.9.1: para cada sinal de porte, encontra a fonte (título + URL) nos resultados
 *  crus das buscas salvas e nas notícias — atribuição de entidade no dossiê SEM
 *  tocar no pacote persistido (hashes de evidência permanecem intactos). */
function sinaisPorteFontes(
  sinais: string[],
  buscas: { resultados?: unknown[] }[],
  noticias: { titulo: string; fonte: string; link: string }[],
): ({ fonte: string; url: string | null } | null)[] {
  interface ResultadoCru { titulo?: string; url?: string; snippet?: string }
  const candidatos: { chave: string; fonte: string; url: string | null }[] = [];
  for (const b of buscas) {
    for (const raw of b.resultados ?? []) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as ResultadoCru;
      if (!r.titulo) continue;
      candidatos.push({
        chave: normParaMatch(`${r.titulo}. ${r.snippet ?? ""}`),
        fonte: r.titulo,
        url: r.url ?? null,
      });
    }
  }
  for (const n of noticias) {
    candidatos.push({ chave: normParaMatch(`${n.titulo} (${n.fonte})`), fonte: `${n.titulo}${n.fonte ? ` (${n.fonte})` : ""}`, url: n.link || null });
  }
  return sinais.map((sinal) => {
    const alvo = normParaMatch(sinal);
    if (!alvo) return null;
    const achou = candidatos.find(
      (c) => c.chave.includes(alvo) || (c.chave.length >= 24 && alvo.includes(c.chave)),
    );
    return achou ? { fonte: achou.fonte, url: achou.url } : null;
  });
}

/** Proveniência de fontes/campos da linha (v0.10.0) — tolerante a JSON antigo/corrompido. */
function parseFontesView(json: string | null): FontesProveniencia | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Partial<FontesProveniencia>;
    if (!p.primaria || typeof p.primaria.fonte !== "string") return null;
    return {
      primaria: { fonte: p.primaria.fonte, coletadoEm: String(p.primaria.coletadoEm ?? "") },
      complementacoes: Array.isArray(p.complementacoes)
        ? p.complementacoes
            .filter((c) => c && typeof c.fonte === "string" && Array.isArray(c.campos))
            .map((c) => ({ fonte: c.fonte, campos: c.campos, coletadoEm: String(c.coletadoEm ?? "") }))
        : [],
      cache: p.cache && typeof p.cache.consultaOriginal === "string"
        ? {
            consultaOriginal: p.cache.consultaOriginal,
            validoAte: String(p.cache.validoAte ?? ""),
            reaproveitadoEm: String(p.cache.reaproveitadoEm ?? ""),
          }
        : null,
    };
  } catch {
    return null;
  }
}

/** Pacote de pesquisa resumido para a UI (sem os trechos completos — só metadados). */
function parseResearchView(json: string | null): ResearchPacketView | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as {
      siteOficial?: { dominio?: string | null; paginas?: { url: string; titulo: string; tipo: string }[]; erro?: string | null };
      buscas?: { query: string; objetivo?: string; resultados?: unknown[] }[];
      notas?: string[];
      sinaisDigitais?: string[];
      noticias?: { titulo: string; fonte: string; data: string | null; link: string }[];
      sinaisPorte?: string[];
      teiaBuscada?: string[];
      paginasOk?: number;
      paginasTentadas?: number;
      buscasOk?: number;
      geradoEm?: string;
      modoPesquisa?: string;
      buscasRecusadasCota?: number;
    };
    // dimensões com buscas EFETIVAS (objetivo da consulta) — NÃO_ENCONTRADO só é
    // permitido quando houve pesquisa; sem pesquisa é NÃO_PESQUISADO (contrato E4)
    const objetivos = (p.buscas ?? []).map((b) => `${b.objetivo ?? ""} ${b.query}`).join(" ");
    const dimensoesPesquisadas = {
      identidade: /identidade|fundação|grupo|presença|marca/i.test(objetivos),
      tecnologia: /tecnologia/i.test(objetivos),
      escala: /porte|escala|headcount|receita|funcionári|investimento/i.test(objetivos),
      comercial: /estrutura comercial|fornecedor|compras/i.test(objetivos),
      teia: /teia societária/i.test(objetivos),
      periodo: /relações com investidores|receita\/lucro|plano de investimentos|período/i.test(objetivos),
    };
    return {
      dominio: p.siteOficial?.dominio ?? null,
      paginas: (p.siteOficial?.paginas ?? []).map((pg) => ({ url: pg.url, titulo: pg.titulo, tipo: pg.tipo })),
      buscas: (p.buscas ?? []).map((b) => ({ query: b.query, objetivo: b.objetivo, resultados: (b.resultados ?? []).length })),
      notas: (p.notas ?? []).slice(0, 8),
      sinaisDigitais: (p.sinaisDigitais ?? []).slice(0, 4),
      noticias: (p.noticias ?? []).slice(0, 6),
      sinaisPorte: (p.sinaisPorte ?? []).slice(0, 6),
      sinaisPorteFontes: sinaisPorteFontes(
        (p.sinaisPorte ?? []).slice(0, 6),
        p.buscas ?? [],
        (p.noticias ?? []).map((n) => ({ titulo: n.titulo, fonte: n.fonte, link: n.link ?? "" })),
      ),
      teiaBuscada: (p.teiaBuscada ?? []).slice(0, 3),
      paginasOk: p.paginasOk ?? 0,
      paginasTentadas: p.paginasTentadas ?? 0,
      buscasOk: p.buscasOk ?? 0,
      geradoEm: p.geradoEm ?? null,
      modoPesquisa: p.modoPesquisa ?? null,
      buscasRecusadasCota: p.buscasRecusadasCota ?? 0,
      dimensoesPesquisadas,
    };
  } catch {
    return null;
  }
}

function safeFirstCell(json: string): string | null {
  try {
    const arr = JSON.parse(json);
    // Lote A1 (QA 18/19): a primeira célula do CSV pode ser o CNPJ vazio — a pista
    // exibida é a PRIMEIRA CÉLULA ÚTIL (nome/site/e-mail), nunca vazio em silêncio.
    if (Array.isArray(arr)) {
      for (const c of arr) {
        if (typeof c === "string" && c.trim().length > 0) return c.trim();
      }
      return null;
    }
    if (typeof arr === "string") return arr.trim() || null;
  } catch {
    /* ignore */
  }
  return null;
}

function safeJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr.map(String).slice(0, 10);
  } catch {
    /* ignore */
  }
  return [];
}

/** Array de objetos (ex.: QSA/teia societária) sem converter itens em string.
 *  v0.10.0 (P1): SEM corte em 30 — o quadro entra completo; a UI corta só na exibição. */
function safeJsonRaw(json: string | null): unknown[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr;
  } catch {
    /* ignore */
  }
  return [];
}
