import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { quadrosEmCacheDaLinha } from "@/lib/relations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/imports/:id/rows/:rowNumber/relacoes-societarias/quadros — v0.10.23.
 * LEITURA PURA DO CACHE LOCAL (zero rede, zero IA, zero consulta externa):
 * devolve os quadros de participantes JÁ expandidos por comando e ainda válidos.
 * Alimenta o mapa de relações (experimento controlado) sem disparar nenhuma
 * consulta — para criar ligação nova, o comando continua sendo o botão
 * "Investigar conexão" (POST /expansao).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    const denied = await assertAccess(req); // expõe dados de cache do lote
    if (denied) return denied;
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }
    const resultado = await quadrosEmCacheDaLinha(id, n);
    return okRes(resultado);
  } catch (err) {
    return fail500(err);
  }
}
