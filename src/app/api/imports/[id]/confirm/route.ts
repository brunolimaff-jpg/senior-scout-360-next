import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { confirmBatch, confirmTextBatch } from "@/lib/enrich/engine";
import { assertMutationAllowed } from "@/lib/export-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/imports/:id/confirm — valida mapeamento e materializa as linhas do lote.
 *  Lotes TEXT (dados colados) ignoram cnpjColumnIndex/hasHeader.
 *  Lote A2: aiEnabled default FALSE — IA só por decisão EXPLÍCITA do operador.
 *  Importar/confirmar NUNCA consome cota de modelo sozinho. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertMutationAllowed(req); // P0-08: fronteira de escrita
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      cnpjColumnIndex?: unknown;
      hasHeader?: unknown;
      aiEnabled?: unknown;
    };
    const aiEnabled = body.aiEnabled === undefined ? false : Boolean(body.aiEnabled);

    const batch = await db.importBatch.findUnique({ where: { id }, select: { sourceType: true } });
    if (!batch) return errRes("NOT_FOUND", "Lote não encontrado.", 404);

    if (batch.sourceType === "TEXT") {
      const outcome = await confirmTextBatch(id, aiEnabled);
      if (!outcome.ok) {
        return errRes("CONFIRM_FAILED", outcome.error ?? "Falha ao confirmar lote.", 422);
      }
      return okRes({ batchId: outcome.batchId, aiEnabled });
    }

    const idx = Number(body.cnpjColumnIndex);
    if (!Number.isInteger(idx) || idx < 0) {
      return errRes("BAD_MAPPING", "cnpjColumnIndex deve ser um inteiro >= 0.", 422);
    }
    const hasHeader = body.hasHeader === undefined ? true : Boolean(body.hasHeader);

    const outcome = await confirmBatch(id, idx, hasHeader, aiEnabled);
    if (!outcome.ok) {
      return errRes("CONFIRM_FAILED", outcome.error ?? "Falha ao confirmar lote.", 422);
    }
    return okRes({ batchId: outcome.batchId, aiEnabled });
  } catch (err) {
    return fail500(err);
  }
}
