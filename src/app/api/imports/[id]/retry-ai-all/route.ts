import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { retryAllAi } from "@/lib/enrich/engine";
import { assertMutationAllowed } from "@/lib/export-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/imports/:id/retry-ai-all — reenfileira todas as leituras IA falhadas/fora do teto. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertMutationAllowed(_req); // P0-08: consome cota de IA
    if (denied) return denied;
    const { id } = await ctx.params;
    const outcome = await retryAllAi(id);
    if (!outcome.ok) {
      return errRes("AI_RETRY_ALL_FAILED", outcome.error ?? "Não foi possível reenfileirar as leituras.", 409);
    }
    return okRes({ queued: outcome.queued ?? 0, started: outcome.started ?? false });
  } catch (err) {
    return fail500(err);
  }
}
