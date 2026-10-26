import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { investigarConexao, httpStatusDeResultado } from "@/lib/relations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  lote_nao_encontrado: "Lote não encontrado.",
  linha_nao_encontrada: "Linha não encontrada neste lote.",
  linha_nao_investigavel: "Complete a identificação desta empresa antes de investigar as relações.",
  // v0.10.16 (contrato de linguagem): mensagem comercial sem jargão. A falha é
  // permanente (identificador que a fonte não reconhece): sem "tentar de novo".
  // O detalhe técnico (formato esperado) fica separado, para auditoria.
  participante_invalido: "Não foi possível ampliar este vínculo. Os dados já encontrados foram mantidos.",
  DETALHE_TECNICO_participante_invalido: "O identificador do participante não é nem o código opaco que a fonte usa para pessoa física, nem um CNPJ com dígito verificador válido. A expansão exige identificador válido da fonte.",
};

/**
 * POST /api/imports/:id/rows/:rowNumber/relacoes-societarias/expansao — FRENTE A.
 * Expansão MANUAL de UMA conexão (1 hop, sob comando explícito): quadro
 * societário do participante. NUNCA encadeia outra expansão automaticamente.
 * Body JSON: { participanteId: string } — hash opaco da fonte (PF) ou CNPJ (PJ).
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
    let participanteId = "";
    try {
      const body = (await req.json()) as { participanteId?: unknown };
      participanteId = typeof body.participanteId === "string" ? body.participanteId : "";
    } catch {
      return errRes("BAD_BODY", "Corpo JSON com participanteId é obrigatório.", 422);
    }
    if (!participanteId) {
      return errRes("BAD_BODY", "participanteId é obrigatório.", 422);
    }
    const r = await investigarConexao(id, n, participanteId);
    if (!r.ok) {
      const http = httpStatusDeResultado(r);
      const detalheTecnico = MENSAGENS[`DETALHE_TECNICO_${r.motivo}`];
      const extra: Record<string, unknown> = {};
      if (detalheTecnico) extra.detalheTecnico = detalheTecnico;
      if (r.erroFonte) extra.fonte = r.erroFonte;
      return errRes(r.motivo.toUpperCase(), MENSAGENS[r.motivo] ?? "Não foi possível investigar esta conexão agora. Os dados já encontrados continuam disponíveis.", http, Object.keys(extra).length > 0 ? extra : undefined);
    }
    return okRes({ quadro: r.view });
  } catch (err) {
    return fail500(err);
  }
}
