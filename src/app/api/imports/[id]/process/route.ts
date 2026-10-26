import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { startBatch } from "@/lib/enrich/engine";
import { assertMutationAllowed } from "@/lib/export-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/imports/:id/process — inicia processamento assíncrono (idempotente). */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertMutationAllowed(_req); // P0-08: fronteira de escrita (comando explícito)
    if (denied) return denied;
    const { id } = await ctx.params;
    const batch = await db.importBatch.findUnique({ where: { id } });
    if (!batch) return errRes("NOT_FOUND", "Lote não encontrado.", 404);
    if (batch.status === "PREVIEW") {
      return errRes("NOT_CONFIRMED", "Confirme o mapeamento antes de processar.", 409);
    }
    const res = await startBatch(id);
    return okRes({ started: res.started, reason: res.reason ?? null });
  } catch (err) {
    return fail500(err);
  }
}
