import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { investigarRelacoes, httpStatusDeResultado, type ResultadoInvestigacao } from "@/lib/relations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  lote_nao_encontrado: "Lote não encontrado.",
  linha_nao_encontrada: "Linha não encontrada neste lote.",
  linha_nao_investigavel: "Complete a identificação desta empresa antes de investigar as relações.",
  participante_invalido: "Não foi possível investigar esta relação agora. Os dados já encontrados continuam disponíveis.",
};

/**
 * POST /api/imports/:id/rows/:rowNumber/relacoes-societarias — FRENTE A (v0.10.5).
 * Investigação SOB COMANDO EXPLÍCITO para este CNPJ: relações diretas do quadro
 * público (MinhaReceita Grafo). Sem IA, sem recursão, sem lote.
 * Expansão de conexões individuais é outra rota (expansao), sempre 1 hop.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    const denied = await assertAccess(req); // mutação + consumo de fonte pública
    if (denied) return denied;
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }
    const r: ResultadoInvestigacao = await investigarRelacoes(id, n);
    if (!r.ok) {
      const http = httpStatusDeResultado(r);
      return errRes(r.motivo.toUpperCase(), MENSAGENS[r.motivo] ?? "Não foi possível investigar as relações.", http, r.erroFonte ? { fonte: r.erroFonte } : undefined);
    }
    return okRes({ relacoes: r.view });
  } catch (err) {
    return fail500(err);
  }
}
