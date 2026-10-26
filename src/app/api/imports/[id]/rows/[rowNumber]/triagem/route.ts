import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { classificarTriagemLinha } from "@/lib/triage/engine";
import { recordTelemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/imports/:id/rows/:rowNumber/triagem — TRIAGEM LOCAL DETERMINÍSTICA (v0.10.6).
 * Classifica lacunas desta linha usando EXCLUSIVAMENTE fatos já coletados em banco.
 * GATE CENTRAL: zero chamada de IA, zero busca web — este caminho não faz HTTP externo.
 * Somente leitura (sem mutação, sem consulta a fontes externas).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    const denied = await assertAccess(req); // leitura de dados
    if (denied) return denied;
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }
    const t0 = Date.now();
    const r = await classificarTriagemLinha(id, n);
    if (!r.ok) {
      return errRes(r.motivo.toUpperCase(), r.motivo === "linha_nao_encontrada" ? "Linha não encontrada neste lote." : "Lote não encontrado.", 404);
    }
    recordTelemetry({
      tipo: "TRIAGEM",
      etapa: "TRIAGEM_LINHA",
      alvo: r.cnpj,
      cacheHit: true, // cálculo 100% local sobre fatos persistidos
      resultados: r.lacunas.length,
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - t0,
      payload: { via: "calculo_local", resumo: r.resumo, ia: 0, buscaWeb: 0 },
    });
    return okRes({ triagem: r });
  } catch (err) {
    return fail500(err);
  }
}
