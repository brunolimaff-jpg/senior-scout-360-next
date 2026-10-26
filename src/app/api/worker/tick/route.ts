import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, fail500 } from "@/lib/api";
import { sweepStalled } from "@/lib/enrich/engine";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/worker/tick — recupera lotes órfãos (restart/HMR) e informa fila ativa.
 * G9: tick MUDA ESTADO (retomada de execução) — sem autorização, 401 e nenhum sweep.
 */
export async function POST(req: NextRequest) {
  try {
    const denied = await assertAccess(req);
    if (denied) return denied;
    const { resumed } = await sweepStalled();
    const activeCount = await db.importBatch.count({ where: { status: "PROCESSING" } });
    const pendingRows = await db.importRow.count({ where: { lookupStatus: { in: ["PENDENTE", "EM_FILA", "CONSULTANDO"] } } });
    return okRes({ resumed, activeBatches: activeCount, pendingRows });
  } catch (err) {
    return fail500(err);
  }
}
