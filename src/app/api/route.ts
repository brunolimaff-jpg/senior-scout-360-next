/**
 * GET /api — verificação de saúde e versão (v0.10.8).
 *
 * Resposta mínima SEM segredos: nome do produto, versão efetiva (package.json
 * via appVersion) e modo de acesso. Não expõe tokens, contadores, dados nem
 * detalhes de infraestrutura. Substitui o "Hello, world!" herético do scaffold.
 */
import { NextResponse } from "next/server";
import { appVersion } from "@/lib/version";
import { authMode } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      servico: "Scout 360",
      versao: appVersion(),
      modoAcesso: authMode(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
