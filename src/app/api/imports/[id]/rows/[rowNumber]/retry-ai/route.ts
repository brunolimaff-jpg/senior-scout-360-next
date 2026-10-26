import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { retryAiRow } from "@/lib/enrich/engine";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/imports/:id/rows/:rowNumber/retry-ai — gera/regenera a leitura IA da conta. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    const denied = await assertAccess(req); // G9: consome cota de IA (auditoria v0.6.1)
    if (denied) return denied;
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }
    const outcome = await retryAiRow(id, n);
    if (!outcome.ok) {
      return errRes("AI_RETRY_FAILED", outcome.error ?? "Não foi possível enfileirar a leitura.", 409);
    }
    return okRes({ queued: true, started: outcome.started ?? false });
  } catch (err) {
    return fail500(err);
  }
}
