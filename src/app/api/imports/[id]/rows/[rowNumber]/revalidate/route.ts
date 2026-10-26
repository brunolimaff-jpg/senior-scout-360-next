import { NextRequest } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { revalidarLinha } from "@/lib/enrich/engine";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOTIVO_HTTP: Record<string, number> = {
  lote_nao_encontrado: 404,
  linha_nao_encontrada: 404,
  linha_nao_revalidavel: 409,
  lote_em_processamento: 409,
  erro_revalidacao: 500,
  /** v0.10.1: fontes falharam (HTTP/timeout/429) — a ficha anterior foi PRESERVADA;
   *  a resposta é honesta (erro), nunca "sucesso" sobre uma revalidação fracassada. */
  revalidacao_falhou: 502,
};

/**
 * POST /api/imports/:id/rows/:rowNumber/revalidate — revalida a ficha de uma linha
 * ENRIQUECIDO: força consulta real às fontes (ignora a ficha cadastral dentro do TTL),
 * atualiza collectedAt/queriedAt e substitui a ficha. Custo: até 4 consultas públicas.
 * v0.10.1: se TODAS as fontes falharem (erro/timeout/429), responde ERRO (502) e a
 * ficha anterior permanece intacta — uma falha temporária não invalida o cadastro.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  try {
    const denied = await assertAccess(req); // mutação + consumo de fontes públicas
    if (denied) return denied;
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }
    const r = await revalidarLinha(id, n);
    if (!r.ok) {
      const http = MOTIVO_HTTP[r.motivo ?? ""] ?? 500;
      const msg: Record<string, string> = {
        lote_nao_encontrado: "Lote não encontrado.",
        linha_nao_encontrada: "Linha não encontrada neste lote.",
        linha_nao_revalidavel: "Só é possível revalidar linha enriquecida com CNPJ válido.",
        lote_em_processamento: "Lote em processamento — aguarde o fim antes de revalidar.",
        erro_revalidacao: "Erro durante a revalidação (registrado na auditoria).",
        revalidacao_falhou: r.detalhe ?? "Falha temporária nas fontes — a ficha anterior foi preservada.",
      };
      return errRes(r.motivo?.toUpperCase() ?? "ERRO", msg[r.motivo ?? ""] ?? "Não foi possível revalidar.", http);
    }
    return okRes({ revalidado: true, linha: r.linha });
  } catch (err) {
    return fail500(err);
  }
}
