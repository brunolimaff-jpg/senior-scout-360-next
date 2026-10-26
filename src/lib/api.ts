import { NextResponse } from "next/server";

/** Contrato único: sucesso SEMPRE com ok:true + payload nomeado. */
export function okRes(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function errRes(code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: { code, message, ...extra } }, { status });
}

export function fail500(err: unknown) {
  const message = err instanceof Error ? err.message : "Erro interno desconhecido";
  console.error("[api]", err);
  return errRes("INTERNAL", message, 500);
}
