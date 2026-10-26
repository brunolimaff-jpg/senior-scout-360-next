import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { investigarMatrizFiliais, httpStatusDeResultado } from "@/lib/relations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  lote_nao_encontrado: "Lote não encontrado.",
  linha_nao_encontrada: "Linha não encontrada neste lote.",
  linha_nao_investigavel: "Complete a identificação desta empresa antes de investigar os estabelecimentos.",
  participante_invalido: "Não foi possível investigar os estabelecimentos agora. Os dados já encontrados continuam disponíveis.",
};

/**
 * POST /api/imports/:id/rows/:rowNumber/matriz-filiais — FRENTE B (v0.10.5).
 * Descoberta de estabelecimentos da MESMA RAIZ (pessoa jurídica) via quadros
 * societários públicos + confirmação INDIVIDUAL pelo registro oficial.
 * Teto de participantes consultados e de confirmações por rodada; cobertura
 * sempre rotulada como PARCIAL. Matriz/filial SEMPE pelo campo oficial —
 * nunca pela suposição da ordem 0001. Sem IA, sem download nacional, sem lote.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    const denied = await assertAccess(req);
    if (denied) return denied;
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }
    const r = await investigarMatrizFiliais(id, n);
    if (!r.ok) {
      const http = httpStatusDeResultado(r);
      return errRes(r.motivo.toUpperCase(), MENSAGENS[r.motivo] ?? "Não foi possível investigar os estabelecimentos da raiz.", http, r.erroFonte ? { fonte: r.erroFonte } : undefined);
    }
    return okRes({ matrizFiliais: r.view });
  } catch (err) {
    return fail500(err);
  }
}
