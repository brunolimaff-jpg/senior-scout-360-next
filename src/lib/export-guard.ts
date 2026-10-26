/**
 * export-guard.ts — GUARDA DE FRONTEIRA (G9, auditoria v0.6.1).
 *
 * A lógica vivia aqui; agora é centralizada em src/lib/auth.ts (sessão de servidor
 * httpOnly + header para chamadas diretas). Mantemos os MESMOS nomes exportados
 * para as rotas já guardadas — a fronteira ficou mais ampla: com o modo TOKEN ativo,
 * leitura E escrita de dados exigem autorização (não só export/mutação).
 *
 * Uso na rota:
 *   const denied = await assertExportAllowed(req);      // exportações
 *   const denied = await assertMutationAllowed(req);    // mutações
 *   const denied = await assertAccess(req);             // leitura de dados
 */
import type { NextRequest, NextResponse } from "next/server";
import { assertAccess } from "@/lib/auth";

export function assertExportAllowed(req: NextRequest): Promise<NextResponse | null> {
  return assertAccess(req);
}

export function assertMutationAllowed(req: NextRequest): Promise<NextResponse | null> {
  return assertAccess(req);
}

export { assertAccess };
