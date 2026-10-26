/**
 * /api/lab/config — Lote B: credencial efêmera de provedor externo.
 *
 * POST   define {baseUrl, apiKey, modelId} → grava SÓ em memória (vault efêmero),
 *        vínculo por cookie httpOnly `scout_lab`. A chave NUNCA volta ao cliente
 *        nem vai para banco/ZIP/log.
 * GET    estado seguro (sem segredo) para a UI.
 * DELETE descarte imediato da credencial desta sessão.
 *
 * Sem fallback, sem uso pelos fluxos oficiais: o provedor padrão continua sendo
 * o Z.ai nativo. Chamada de inferência externa só acontece em POST /api/lab/compare.
 */
import { NextRequest, NextResponse } from "next/server";
import { errRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth"; // v0.10.8: mesma fronteira das rotas principais
import {
  LAB_COOKIE,
  deleteLabConfig,
  getLabStatus,
  labDisabledRes,
  labEnabled,
  labTtlMinutes,
  setLabConfig,
} from "@/lib/lab/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieFrom(req: NextRequest): string | undefined {
  return req.cookies.get(LAB_COOKIE)?.value;
}

export async function GET(req: NextRequest) {
  try {
    // v0.10.11 (piloto): gate server-side do laboratório — antes de qualquer outra verificação.
    if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
    // v0.10.8 (auditoria): estado da credencial é fronteira do modo TOKEN também.
    const denied = await assertAccess(req);
    if (denied) return denied;
    return NextResponse.json({ ok: true, status: getLabStatus(cookieFrom(req)), ttlMinutos: labTtlMinutes() });
  } catch (e) {
    return fail500(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    // v0.10.11 (piloto): gate server-side do laboratório.
    if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
    // v0.10.8 (auditoria): gravar credencial experimental exige a mesma autorização.
    const denied = await assertAccess(req);
    if (denied) return denied;
    const body = (await req.json().catch(() => null)) as { baseUrl?: unknown; apiKey?: unknown; modelId?: unknown } | null;
    const r = setLabConfig({
      baseUrl: body?.baseUrl,
      apiKey: body?.apiKey,
      modelId: body?.modelId,
    });
    if (!r.ok) {
      return errRes(r.code, r.message, 400);
    }
    const res = NextResponse.json({
      ok: true,
      status: { ...getLabStatus(r.cookieValue) },
      ttlMinutos: labTtlMinutes(),
      aviso:
        "Credencial guardada só na memória do servidor, vinculada a esta sessão. Ela expira automaticamente e nunca é gravada no banco, em ZIP ou em log.",
    });
    res.cookies.set(LAB_COOKIE, r.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * labTtlMinutes(),
      secure: false, // sandbox de dev roda em http; em https de produção, ligar
    });
    return res;
  } catch (e) {
    return fail500(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // v0.10.11 (piloto): gate server-side do laboratório.
    if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
    // v0.10.8 (auditoria): descartar credencial também fica atrás da fronteira.
    const denied = await assertAccess(req);
    if (denied) return denied;
    const existed = deleteLabConfig(cookieFrom(req));
    const res = NextResponse.json({ ok: true, descartada: existed, status: getLabStatus(undefined) });
    res.cookies.set(LAB_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return fail500(e);
  }
}
