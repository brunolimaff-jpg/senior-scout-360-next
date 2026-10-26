/**
 * GET /api/imports/:id/pessoas — INVESTIGAÇÃO REVERSA DO LOTE (v0.11.1, Gate 4).
 *
 * LEITURA PURA dos caches de relações já coletados SOB COMANDO: nenhuma consulta
 * externa acontece aqui (o Gate central é o mesmo das rotas de relações). Devolve
 * o resumo de cobertura e as pessoas identificadas por participanteId — nomes
 * iguais nunca são unidos.
 */
import { NextRequest } from "next/server";
import { okRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { lerPessoasReversas } from "@/lib/pessoas/reversa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertAccess(req); // leitura protegida como o resto da mesa
    if (denied) return denied;
    const { id } = await ctx.params;
    const tudo = await lerPessoasReversas(id);
    if (!tudo) return okRes({ ok: true, resumo: null, pessoas: [], motivo: "lote_nao_encontrado" });
    return okRes({ ok: true, resumo: tudo.resumo, pessoas: tudo.pessoas });
  } catch (err) {
    return fail500(err);
  }
}
