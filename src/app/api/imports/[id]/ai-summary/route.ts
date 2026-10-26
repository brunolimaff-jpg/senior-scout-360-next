import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { generateBatchSummaryFor } from "@/lib/enrich/engine";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/imports/:id/ai-summary — gera/regenera o resumo executivo do lote via IA (1 chamada). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertAccess(req); // G9: consome cota de IA (auditoria v0.6.1)
    if (denied) return denied;
    const { id } = await ctx.params;
    const outcome = await generateBatchSummaryFor(id);
    if (!outcome.ok) {
      return errRes("AI_SUMMARY_FAILED", outcome.error ?? "Não foi possível gerar o resumo do lote.", 409);
    }
    const batch = await db.importBatch.findUnique({ where: { id }, select: { aiSummary: true, aiSummaryAt: true } });
    if (!batch?.aiSummary) return errRes("AI_SUMMARY_MISSING", "Resumo não encontrado após a geração.", 500);
    let summary: unknown = batch.aiSummary;
    try {
      summary = JSON.parse(batch.aiSummary);
    } catch {
      /* mantém string */
    }
    return okRes({ summary, at: batch.aiSummaryAt });
  } catch (err) {
    return fail500(err);
  }
}
