/**
 * /api/lab/compare — Lote B: comparação manual GLM vs. modelo externo.
 *
 * POST {rowId} — o clique é a AUTORIZAÇÃO EXPRESSA de envio do pacote de
 * evidências ao provedor externo (aviso na UI). Reutiliza a pesquisa salva da
 * conta (0 buscas novas), monta a mensagem com o MESMO código do provedor
 * nativo (mesma versão de prompt), chama o provedor externo e guarda o
 * resultado EXPERIMENTAL em LabComparison — nunca nos campos oficiais da linha.
 * Sem retry e sem fallback para o nativo.
 *
 * GET ?rowId= — histórico de comparações da conta (lateral a lado na UI).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth"; // v0.10.8: mesma fronteira das rotas principais
import { LAB_COOKIE, getLabConfig, labDisabledRes, labEnabled, redactKey } from "@/lib/lab/vault";
import { listComparisons, runExternalComparison } from "@/lib/lab/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // v0.10.11 (piloto): gate server-side do laboratório.
    if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
    // v0.10.8 (auditoria): o histórico de comparações é DADO do Scout — no modo TOKEN
    // não pode ser lido apenas conhecendo um rowId. Guarda idêntica às rotas principais.
    const denied = await assertAccess(req);
    if (denied) return denied;
    const rowId = req.nextUrl.searchParams.get("rowId") ?? "";
    if (!rowId) return NextResponse.json({ ok: false, code: "ROW_ID_OBRIGATORIO", message: "Informe rowId." }, { status: 400 });
    return NextResponse.json({ ok: true, comparacoes: await listComparisons(rowId) });
  } catch (e) {
    return fail500(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    // v0.10.11 (piloto): gate server-side do laboratório.
    if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
    // v0.10.8 (auditoria): a comparação envia o pacote de evidências ao provedor
    // externo — fronteira de acesso obrigatória também na escrita.
    const denied = await assertAccess(req);
    if (denied) return denied;
    const cfg = getLabConfig(req.cookies.get(LAB_COOKIE)?.value);
    if (!cfg) {
      return NextResponse.json(
        {
          ok: false,
          code: "LAB_NAO_CONFIGURADO",
          message: "Configure o provedor externo no laboratório antes de comparar.",
        },
        { status: 400 }
      );
    }
    const body = (await req.json().catch(() => null)) as { rowId?: unknown } | null;
    const rowId = typeof body?.rowId === "string" ? body.rowId : "";
    if (!rowId) return NextResponse.json({ ok: false, code: "ROW_ID_OBRIGATORIO", message: "Selecione a conta a comparar." }, { status: 400 });

    const outcome = await runExternalComparison(rowId, cfg);
    const status = outcome.ok ? 200 : outcome.code === "PROVEDOR_FALHOU" ? 502 : 422;
    return NextResponse.json(
      {
        ok: outcome.ok,
        code: outcome.code,
        message: outcome.message ? redactKey(outcome.message, cfg.apiKey) : undefined,
        equivalencia: outcome.equivalencia,
        comparacao: outcome.comparacao,
      },
      { status }
    );
  } catch (e) {
    return fail500(e);
  }
}
