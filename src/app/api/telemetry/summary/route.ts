import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { buildTelemetrySummary } from "@/lib/enrich/telemetry-summary";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/telemetry/summary?batchId=... — visão consolidada da telemetria do lote (Lote A3).
 * Todos os números vêm de eventos persistidos (TelemetryEvent) + contadores de linha —
 * nada inventado; "não informado" é distinto de zero.
 */
export async function GET(req: NextRequest) {
  try {
    const denied = await assertAccess(req); // G9: leitura de dados exige autorização em TOKEN
    if (denied) return denied;
    const batchId = req.nextUrl.searchParams.get("batchId") ?? "";
    if (!batchId) {
      return errRes("BAD_REQUEST", "Informe ?batchId= do lote.", 422);
    }
    const summary = await buildTelemetrySummary(batchId);
    if (!summary) return errRes("NOT_FOUND", "Lote não encontrado.", 404);
    return okRes({ ok: true, summary });
  } catch (err) {
    return fail500(err);
  }
}
