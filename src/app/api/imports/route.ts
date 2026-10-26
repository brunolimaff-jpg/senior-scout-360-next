import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { detectCnpjColumn, parseStoredFile, recordAudit, UPLOAD_DIR } from "@/lib/enrich/engine";
import { sanitizeFileBase } from "@/lib/csv";
import { assertAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/** POST /api/imports — upload + preview determinístico (cria lote PREVIEW persistido). */
export async function POST(req: NextRequest) {
  try {
    const denied = await assertAccess(req); // G9: escrita de dados exige autorização
    if (denied) return denied;
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return errRes("NO_FILE", "Nenhum arquivo enviado (campo 'file' ausente).", 400);
    }
    if (file.size === 0) {
      return errRes("EMPTY_FILE", "Arquivo vazio.", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return errRes("TOO_LARGE", "Arquivo maior que 8 MB.", 413);
    }
    const originalName = file.name || "sem-nome.csv";

    const bytes = new Uint8Array(await file.arrayBuffer());
    const batchId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const storedPath = path.join(UPLOAD_DIR, `${batchId}_${sanitizeFileBase(originalName)}.csv`);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(storedPath, bytes);

    const parsed = await parseStoredFile(storedPath);
    if (parsed.rows.length === 0) {
      await fs.rm(storedPath, { force: true });
      return errRes("NO_ROWS", "Arquivo sem linhas legíveis (CSV vazio ou malformado).", 422, {
        encoding: parsed.encoding,
      });
    }

    const hasHeader = parsed.rows.length > 1 || /[^0-9]/.test(parsed.rows[0]?.[0] ?? "");
    const header = hasHeader ? parsed.rows[0] : parsed.rows[0].map((_, i) => `coluna_${i + 1}`);
    const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
    const sampleRows = dataRows.slice(0, 5);
    const det = detectCnpjColumn(header, sampleRows);

    const batch = await db.importBatch.create({
      data: {
        id: batchId,
        fileName: originalName,
        storedPath,
        fileSize: file.size,
        delimiter: parsed.delimiter,
        encoding: parsed.encoding,
        hasHeader,
        headerJson: JSON.stringify(header),
        cnpjColumnIndex: det.index,
        cnpjColumnDetect: det.detectedBy,
        rowCount: dataRows.length,
        status: "PREVIEW",
      },
    });

    await recordAudit(batch.id, "UPLOAD", {
      arquivo: originalName,
      bytes: file.size,
      encoding: parsed.encoding,
      delimitador: parsed.delimiter === "\t" ? "\\t" : parsed.delimiter,
      linhas_dados: dataRows.length,
      coluna_cnpj: det.index,
      detecção: det.detectedBy,
      aspas_malformadas: parsed.malformedQuotes,
    });

    return okRes({
      batch: {
        id: batch.id,
        fileName: batch.fileName,
        fileSize: batch.fileSize,
        delimiter: batch.delimiter,
        encoding: batch.encoding,
        hasHeader: batch.hasHeader,
        header,
        cnpjColumnIndex: det.index,
        cnpjColumnDetectedBy: det.detectedBy,
        rowCount: batch.rowCount,
        sampleRows,
        status: batch.status,
        createdAt: batch.createdAt,
      },
    });
  } catch (err) {
    return fail500(err);
  }
}

/** GET /api/imports — histórico persistido de lotes. */
export async function GET(req: NextRequest) {
  try {
    const denied = await assertAccess(req); // G9: leitura de dados também é fronteira
    if (denied) return denied;
    const batches = await db.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return okRes({
      batches: batches.map((b) => ({
        id: b.id,
        fileName: b.fileName,
        status: b.status,
        sourceType: b.sourceType,
        rowCount: b.rowCount,
        totalValid: b.totalValid,
        totalInvalid: b.totalInvalid,
        totalDuplicate: b.totalDuplicate,
        totalReference: b.totalReference,
        totalResolved: b.totalResolved,
        totalEnriched: b.totalEnriched,
        totalPending: b.totalPending,
        totalConfirmed: b.totalConfirmed,
        totalReview: b.totalReview,
        delimiter: b.delimiter,
        encoding: b.encoding,
        createdAt: b.createdAt,
        finishedAt: b.finishedAt,
      })),
    });
  } catch (err) {
    return fail500(err);
  }
}
