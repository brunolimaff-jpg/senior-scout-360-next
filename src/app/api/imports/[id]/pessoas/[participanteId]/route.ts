/**
 * GET /api/imports/:id/pessoas/:participanteId — DOSSIÊ DA PESSOA (v0.11.1, Gate 4).
 *
 * LEITURA PURA: a pessoa (por participanteId da fonte — nunca por nome), as
 * empresas do lote onde aparece, os papéis registrados com origem honesta
 * (identificador × nome) e o quadro ampliado em cache. Nenhuma consulta
 * externa acontece nesta rota: a expansão de quadro continua sendo comando
 * explícito (rota própria).
 */
import { NextRequest } from "next/server";
import { errRes, okRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { lerPessoaReversa } from "@/lib/pessoas/reversa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; participanteId: string }> }) {
  try {
    const denied = await assertAccess(req);
    if (denied) return denied;
    const { id, participanteId } = await ctx.params;
    if (!participanteId || participanteId.length > 200) {
      return errRes("PARTICIPANTE_INVALIDO", "Identificador de participante inválido.", 422);
    }
    const pessoa = await lerPessoaReversa(id, participanteId);
    if (!pessoa) {
      return okRes({ ok: true, pessoa: null, motivo: "pessoa_nao_encontrada_no_lote" });
    }
    return okRes({ ok: true, pessoa });
  } catch (err) {
    return fail500(err);
  }
}
