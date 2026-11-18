import { NextRequest, NextResponse } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { authConfigError, authMode, clearSessionCookie, currentSecret, isAuthorized, tryIssueSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session — estado do acesso (NUNCA devolve o segredo).
 * A UI usa isso para mostrar "acesso local aberto" ou pedir desbloqueio.
 * Em produção sem SCOUT_EXPORT_TOKEN, configError explica o 503 das rotas.
 */
export async function GET(req: NextRequest) {
  try {
    const mode = authMode();
    const secret = await currentSecret();
    const configError = authConfigError();
    return okRes({
      authMode: mode,
      configError,
      authenticated: mode === "TOKEN" ? isAuthorized(req, secret) : configError === null,
    });
  } catch (err) {
    return fail500(err);
  }
}

/**
 * POST /api/auth/session — desbloqueio: o operador informa o token UMA vez;
 * o servidor valida e emite cookie httpOnly assinado. O token não é armazenado
 * no cliente (nem em código, nem em localStorage).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const cookie = await tryIssueSession(body.token ?? "");
    if (!cookie) {
      return errRes("UNAUTHORIZED", "Token inválido para este ambiente. Confira SCOUT_EXPORT_TOKEN com quem opera o servidor.", 401);
    }
    return new NextResponse(JSON.stringify({ ok: true, authenticated: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie, "Cache-Control": "no-store" },
    });
  } catch (err) {
    return fail500(err);
  }
}

/** DELETE /api/auth/session — encerra a sessão local (higiene ao sair da máquina). */
export async function DELETE() {
  return new NextResponse(JSON.stringify({ ok: true, authenticated: false }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" },
  });
}
