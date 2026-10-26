import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { recordAudit, UPLOAD_DIR } from "@/lib/enrich/engine";
import { parseTextLines, type TextStats } from "@/lib/extract";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_LINES = 5000;

/**
 * POST /api/imports/text — cria lote PREVIEW a partir de texto colado não estruturado.
 * Aceita CNPJ, domínio, e-mail, site ou pares mistos por linha (tab ; | , espaço).
 * Body JSON: { text: string }
 */
export async function POST(req: NextRequest) {
  try {
    const denied = await assertAccess(req); // G9: escrita de dados exige autorização
    if (denied) return denied;
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text : "";

    if (text.trim().length === 0) {
      return errRes("EMPTY_TEXT", "Nada foi colado. Cole CNPJs, domínios, e-mails ou sites (um por linha).", 400);
    }
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_TEXT_BYTES) {
      return errRes("TOO_LARGE", `Texto colado maior que 1 MB (${(bytes / 1024 / 1024).toFixed(2)} MB). Use um arquivo CSV.`, 413);
    }

    const parsed = parseTextLines(text, { maxLines: MAX_LINES + 1, maxLineLength: 2000 });
    if (parsed.lines.length === 0) {
      return errRes("NO_LINES", "Nenhuma linha de dados encontrada no texto colado.", 422);
    }
    if (parsed.lines.length > MAX_LINES) {
      return errRes("TOO_MANY_LINES", `Texto tem mais de ${MAX_LINES} linhas de dados. Divida em vários lotes ou use CSV.`, 413);
    }

    const batchId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const storedPath = path.join(UPLOAD_DIR, `${batchId}_colado.txt`);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(storedPath, text, "utf8");

    const batch = await db.importBatch.create({
      data: {
        id: batchId,
        fileName: "Dados colados",
        storedPath,
        fileSize: bytes,
        sourceType: "TEXT",
        delimiter: "\t", // tab real: toCsv cita campos de entrada contendo tab (ex.: pares CNPJ⇥domínio)
        encoding: "UTF-8",
        hasHeader: parsed.headerCells !== null,
        headerJson: JSON.stringify(parsed.headerCells ?? ["entrada"]),
        cnpjColumnIndex: null,
        cnpjColumnDetect: null,
        rowCount: parsed.lines.length,
        status: "PREVIEW",
      },
    });

    await recordAudit(batch.id, "UPLOAD", {
      origem: "texto colado",
      bytes,
      linhas_dados: parsed.lines.length,
      com_cabecalho: parsed.headerCells !== null,
      separador: parsed.detectedSeparator,
      resumo: parsed.stats,
    });

    // amostra: primeiras 5 linhas já classificadas
    const sampleRows = parsed.lines.slice(0, 5).map((l) => ({
      rowNumber: l.rowNumber,
      entrada: l.rawLine,
      kind: l.kind,
      cnpj: l.rawCnpj || null,
      referencia: l.referenceValue,
      valido: l.kind === "INVALID" ? false : l.kind === "CNPJ" ? l.cnpjValid : true,
      motivo: l.invalidReason,
    }));

    return okRes({
      batch: {
        id: batch.id,
        fileName: batch.fileName,
        fileSize: batch.fileSize,
        sourceType: "TEXT",
        delimiter: batch.delimiter,
        encoding: batch.encoding,
        hasHeader: batch.hasHeader,
        header: parsed.headerCells ?? ["entrada"],
        cnpjColumnIndex: 0,
        cnpjColumnDetectedBy: "classificação automática por linha",
        rowCount: batch.rowCount,
        sampleRows,
        status: batch.status,
        textStats: parsed.stats satisfies TextStats,
        createdAt: batch.createdAt,
      },
    });
  } catch (err) {
    return fail500(err);
  }
}
