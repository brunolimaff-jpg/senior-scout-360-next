import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { recordAudit, startBatch } from "@/lib/enrich/engine";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETRYABLE = new Set(["RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR", "NAO_ENCONTRADO"]);

/** POST /api/imports/:id/rows/:rowNumber/retry — reprocessa uma linha (falha transitória OU revisão manual após revisão). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    const denied = await assertAccess(req); // G9: mutação + pode disparar consumo de fontes
    if (denied) return denied;
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }

    const row = await db.importRow.findFirst({ where: { batchId: id, rowNumber: n } });
    if (!row) return errRes("NOT_FOUND", "Linha não encontrada neste lote.", 404);
    if (!RETRYABLE.has(row.lookupStatus)) {
      return errRes(
        "NOT_RETRYABLE",
        `Status "${row.lookupStatus}" não é reprocessável (esperado: falha transitória, não encontrado ou para revisar).`,
        409
      );
    }

    await db.importRow.update({
      where: { id: row.id },
      data: {
        lookupStatus: "EM_FILA",
        lookupError: null,
        retryCount: 0,
        // NAO_ENCONTRADO reprocessável: revisão humana. CNPJ direto mantém o número;
        // pista (REFERENCIA) limpa a resolução anterior para refazer de ponta a ponta.
        ...(row.lookupStatus === "NAO_ENCONTRADO" && row.cnpjStatus !== "VALIDA"
          ? { resolvedCnpj: null, normalizedCnpj: "", resolutionState: null, resolutionConfidence: null, resolutionJson: null, cluesJson: null }
          : {}),
      },
    });
    await recordAudit(id, "ROW_RETRY", { cnpj: row.normalizedCnpj, status_anterior: row.lookupStatus }, n);

    const start = await startBatch(id);
    if (!start.started && start.reason === "already_running") {
      return okRes({ queued: true, note: "lote já em processamento; a linha será consumida pelo worker ativo" });
    }
    return okRes({ queued: true, started: start.started });
  } catch (err) {
    return fail500(err);
  }
}
