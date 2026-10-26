import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { startDeepResearch } from "@/lib/enrich/engine";
import { assertMutationAllowed } from "@/lib/export-guard";
import type { ModoPesquisa } from "@/lib/enrich/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/imports/:id/rows/:rowNumber/deep-research
 * Pesquisa profunda da conta (nível 2): monta o research packet (site oficial + buscas)
 * e depois sintetiza o dossiê completo com o modelo de dossiê. Fire-and-forget —
 * a UI acompanha por polling (researchStatus/aiStatus).
 * Body opcional: { modo: "COMPLETO" | "ADAPTATIVO" } (v0.9.0 — default COMPLETO).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  const denied = await assertMutationAllowed(req); // P0-08: pesquisa profunda consome cota de busca/IA
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => null)) as { modo?: unknown } | null;
    const modo: ModoPesquisa = body?.modo === "ADAPTATIVO" ? "ADAPTATIVO" : "COMPLETO";
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }
    const outcome = await startDeepResearch(id, n, modo);
    if (!outcome.ok) {
      return errRes("DEEP_RESEARCH_FAILED", outcome.error ?? "Não foi possível iniciar a pesquisa profunda.", 409);
    }
    return okRes({ started: outcome.started ?? false, modo });
  } catch (err) {
    return fail500(err);
  }
}
