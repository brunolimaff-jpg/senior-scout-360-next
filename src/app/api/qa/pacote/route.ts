import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/qa/pacote[?arquivo=<nome>]
 *
 * TRANSFERÊNCIA DO PACOTE DE AUDITORIA v0.11.1 (desvio A do delta).
 *
 * SIMPLIFICAÇÃO (decisão do Bruno, delta-OPEN): sem chave de transferência —
 * o Scout 360 está em modo OPEN no Z.ai (ambiente temporário de
 * desenvolvimento/testes, sem login/tokens nesta fase) e a cerimônia de chave
 * só atrapalhava a entrega. O código de autenticação existente permanece:
 *
 *  1. assertAccess() — mesma fronteira de todas as rotas de dados (G9). No
 *     modo OPEN essa camada passa; no modo TOKEN exige sessão/token como
 *     qualquer outra rota (nenhum bypass criado aqui).
 *  2. ALLOWLIST rígida (defesa contra path traversal e furo de diretório):
 *       - padrão  `pacote-*.tar.gz`  (pacotes de auditoria sanitizados)
 *       - padrão  `SHA256SUMS*.txt`  (somas de verificação)
 *     Nada mais é servido — qualquer outro nome devolve 404 genérico.
 *
 * O arquivo é servido byte a byte do disco (nada é regenerado) — o SHA-256
 * baixado tem de bater com o de SHA256SUMS.txt. Padrões sensíveis
 * (.env, .git, db, tokens, logs) já estão excluídos do pacote na origem.
 *
 * Histórico: a versão com chave obrigatória (024cc93) foi substituída nesta
 * simplificação por decisão do operador; a chave de transferência foi removida
 * do disco e do fluxo nesta mesma simplificação.
 */

const PACOTE_DIR = path.join(process.cwd(), "qa", "consolidacao-v0111", "pacote");
// Pacote padrão: regenerado no fechamento do handoff (DELTA-AUD-5) após o reset
// da VM — os pacotes anteriores (92999024… / 7a9d44fe…) pereceram com a pasta
// qa/ (gitignored). O manifesto do pacote novo declara a proveniência completa.
const ARQUIVO_PADRAO = "pacote-reauditoria-v0111-regenerado.tar.gz";

function allowlist(nome: string): boolean {
  return /^pacote-[A-Za-z0-9._-]+\.tar\.gz$/.test(nome) || /^SHA256SUMS[A-Za-z0-9._-]*\.txt$/.test(nome);
}

function generico404(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "NAO_ENCONTRADO", message: "Recurso não disponível." } },
    { status: 404, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(req: NextRequest) {
  const denied = await assertAccess(req);
  if (denied) return denied;

  const pedido = (req.nextUrl.searchParams.get("arquivo") ?? ARQUIVO_PADRAO).trim();
  const nome = path.basename(pedido); // mata qualquer traversal
  if (!allowlist(nome)) return generico404();

  const caminho = path.join(PACOTE_DIR, nome);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(caminho);
  } catch {
    return generico404();
  }

  const ehSums = nome.endsWith(".txt");
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": ehSums ? "text/plain; charset=utf-8" : "application/gzip",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}
