import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_LOOKUP = ["PENDENTE", "EM_FILA", "CONSULTANDO"];
const FAILED_LOOKUP = ["NAO_ENCONTRADO", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"];
const MAX_UF_BARS = 12;

/** Contador flexível: encontra o grupo pela chave e devolve _count._all (0 se ausente). */
function countOf(groups: { key: string; count: number }[], key: string): number {
  return groups.find((g) => g.key === key)?.count ?? 0;
}

/**
 * GET /api/stats
 * Agregações globais determinísticas (GROUP BY/COUNT no SQLite) para o painel "Visão geral".
 * Sem IA: apenas contagens e agrupamentos sobre ImportBatch/ImportRow/AuditEvent.
 * Contrato: { ok: true, stats: {...} }
 */
export async function GET(req: NextRequest) {
  try {
    const denied = await assertAccess(req); // G9: leitura de dados também é fronteira
    if (denied) return denied;
    const [
      batchesByStatus,
      byCnpjStatusRaw,
      byLookupRaw,
      byUf,
      bySource,
      cacheHits,
      reverseHits,
      auditEvents,
      recent,
    ] = await Promise.all([
      db.importBatch.groupBy({ by: ["status"], _count: { _all: true } }),
      db.importRow.groupBy({ by: ["cnpjStatus"], _count: { _all: true } }),
      db.importRow.groupBy({ by: ["lookupStatus"], _count: { _all: true } }),
      db.importRow.groupBy({
        by: ["uf"],
        where: { lookupStatus: "ENRIQUECIDO", uf: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { uf: "desc" } },
        take: MAX_UF_BARS,
      }),
      db.importRow.groupBy({
        by: ["source"],
        where: { lookupStatus: "ENRIQUECIDO", source: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
      }),
      db.auditEvent.count({ where: { event: "LOOKUP_CACHE" } }),
      db.auditEvent.count({ where: { event: "REVERSE_OK" } }),
      db.auditEvent.count(),
      db.importBatch.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          fileName: true,
          status: true,
          rowCount: true,
          totalValid: true,
          totalEnriched: true,
          totalPending: true,
          createdAt: true,
        },
      }),
    ]);

    const byCnpjStatus = byCnpjStatusRaw
      .map((g) => ({ key: g.cnpjStatus, count: g._count._all }))
      .sort((a, b) => b.count - a.count);
    const byLookup = byLookupRaw
      .map((g) => ({ key: g.lookupStatus, count: g._count._all }))
      .sort((a, b) => b.count - a.count);

    const valid = byCnpjStatus
      .filter((g) => g.key !== "INVALIDA" && g.key !== "SEM_CNPJ")
      .reduce((acc, g) => acc + g.count, 0);
    const reference = countOf(byCnpjStatus, "REFERENCIA");
    const resolved = await db.importRow.count({ where: { cnpjStatus: "REFERENCIA", resolvedCnpj: { not: null } } });
    const enriched = countOf(byLookup, "ENRIQUECIDO");
    const pending = byLookup.filter((g) => PENDING_LOOKUP.includes(g.key)).reduce((acc, g) => acc + g.count, 0);
    const failed = byLookup.filter((g) => FAILED_LOOKUP.includes(g.key)).reduce((acc, g) => acc + g.count, 0);
    const totalRows = byCnpjStatus.reduce((acc, g) => acc + g.count, 0);

    return okRes({
      stats: {
        batches: {
          total: batchesByStatus.reduce((acc, g) => acc + g._count._all, 0),
          byStatus: batchesByStatus.map((g) => ({ status: g.status, count: g._count._all })),
        },
        rows: {
          total: totalRows,
          valid,
          invalid: countOf(byCnpjStatus, "INVALIDA"),
          duplicate: countOf(byCnpjStatus, "DUPLICADA"),
          semCnpj: countOf(byCnpjStatus, "SEM_CNPJ"),
          reference,
          resolved,
          enriched,
          pending,
          failed,
          taxaEnriquecimento: valid > 0 ? Math.round((enriched / valid) * 100) : 0,
        },
        byCnpjStatus,
        byLookup,
        topUf: byUf.map((g) => ({ uf: g.uf ?? "—", count: g._count._all })),
        bySource: bySource.map((g) => ({ source: g.source ?? "—", count: g._count._all })),
        cacheHits,
        reverseHits,
        auditEvents,
        recent,
      },
    });
  } catch (err) {
    return fail500(err);
  }
}
