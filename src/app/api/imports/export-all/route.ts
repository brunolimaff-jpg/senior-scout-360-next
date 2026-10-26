import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errRes, fail500 } from "@/lib/api";
import { recordAudit } from "@/lib/enrich/engine";
import { toCsv } from "@/lib/csv";
import { formatCnpj } from "@/lib/cnpj";
import { assertExportAllowed } from "@/lib/export-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/imports/export-all?type=result|audit|summary
 * Exporta TODOS os lotes confirmados em um único arquivo (visão consolidada).
 * Rota estática — em Next.js tem precedência sobre /api/imports/[id].
 * O CSV consolidado usa um schema uniforme: identificação do lote + células originais
 * em JSON (sem perda, pois cabeçalhos variam entre lotes) + colunas derivadas padronizadas.
 *
 * GUARDA DE EXPORTAÇÃO (G7): se SCOUT_EXPORT_TOKEN estiver definido no ambiente, o download
 * só passa com o header `x-export-token` igual ao valor — sem a variável, exporta livre (dev).
 */
export async function GET(req: NextRequest) {
  try {
    const denied = await assertExportAllowed(req);
    if (denied) return denied;

    const type = req.nextUrl.searchParams.get("type") ?? "result";

    const batches = await db.importBatch.findMany({ orderBy: { createdAt: "asc" } });
    const exportable = batches.filter((b) => b.status !== "PREVIEW");

    if (exportable.length === 0) {
      return errRes("EMPTY", "Nenhum lote confirmado para exportar.", 409);
    }

    if (type === "result") {
      const DERIVED_HEADER = [
        "tipo_entrada", "referencia", "cnpj_resolvido_reversa",
        "cnpj_normalizado", "cnpj_valido", "status_linha", "status_enriquecimento",
        "razao_social", "nome_fantasia", "situacao_cadastral", "data_situacao",
        "motivo_situacao", "tipo_matriz_filial", "data_abertura",
        "cnae_codigo", "cnae_descricao", "municipio", "uf",
        "contato_email", "contato_telefone", "contato_telefone_2",
        "capital_social", "natureza_juridica", "municipio_populacao", "regiao_imediata", "socios_qsa", "qtd_socios",
        "fonte", "data_consulta", "erro",
        "ia_status", "ia_setor", "ia_porte", "ia_perfil_classificacao", "ia_leitura_executiva",
      ];
      const out: (string | number)[][] = [
        ["lote_arquivo", "id_lote", "linha", "cnpj_original", "colunas_originais_json", ...DERIVED_HEADER],
      ];

      for (const batch of exportable) {
        const rows = await db.importRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: "asc" } });
        const enrichedByCnpj = new Map<string, (typeof rows)[number]>();
        for (const r of rows) {
          if (r.cnpjStatus === "VALIDA" && r.lookupStatus === "ENRIQUECIDO" && r.normalizedCnpj) {
            enrichedByCnpj.set(r.normalizedCnpj, r);
          }
        }
        const eff = (r: (typeof rows)[number]) =>
          r.lookupStatus === "ENRIQUECIDO" ? r : enrichedByCnpj.get(r.normalizedCnpj) ?? r;

        for (const r of rows) {
          const e = eff(r);
          const enriched = e.lookupStatus === "ENRIQUECIDO";
          const aiOk = e.aiStatus === "OK" && !!e.aiReading;
          const socios = enriched && e.sociosJson ? safeSocios(e.sociosJson) : [];
          const sociosTxt = socios
            .slice(0, 12)
            .map((s) => [s.nome, s.qual, s.entrada].filter((x) => x && x.length > 0).join(" — "))
            .join(" | ");
          const extra = (enriched && e.extraJson ? safeParse(e.extraJson) : null) as {
            capitalSocial?: string; naturezaJuridica?: string; email?: string; telefone?: string; telefone2?: string;
            mei?: string; simples?: string; porte?: string; regimeTributario?: string;
            ibge?: { populacao?: string; regiaoImediata?: string } | null;
          } | null;
          const orig = (r.originalCellsJson ? (JSON.parse(r.originalCellsJson) as string[]) : []).map((v) => v ?? "");
          out.push([
            batch.fileName,
            batch.id,
            r.rowNumber,
            r.rawCnpj,
            JSON.stringify(orig),
            r.lookupKind || "CNPJ",
            r.referenceValue ?? "",
            r.resolvedCnpj ? formatCnpj(r.resolvedCnpj) : "",
            r.normalizedCnpj || "",
            r.cnpjStatus === "VALIDA" ? "SIM" : "NAO",
            r.cnpjStatus,
            enriched ? "ENRIQUECIDO" : e.lookupStatus,
            enriched ? e.legalName ?? "" : "",
            enriched ? e.tradeName ?? "" : "",
            enriched ? e.registrationStatus ?? "" : "",
            enriched ? e.statusDate ?? "" : "",
            enriched ? e.situationReason ?? "" : "",
            enriched ? e.branchType ?? "" : "",
            enriched ? e.openingDate ?? "" : "",
            enriched ? e.cnaeCode ?? "" : "",
            enriched ? e.cnaeDescription ?? "" : "",
            enriched ? e.municipality ?? "" : "",
            enriched ? e.uf ?? "" : "",
            enriched ? extra?.email ?? "" : "",
            enriched ? extra?.telefone ?? "" : "",
            enriched ? extra?.telefone2 ?? "" : "",
            enriched ? String(extra?.capitalSocial ?? "") : "",
            enriched ? String(extra?.naturezaJuridica ?? "") : "",
            enriched ? extra?.ibge?.populacao ?? "" : "",
            enriched ? extra?.ibge?.regiaoImediata ?? "" : "",
            enriched ? sociosTxt : "",
            enriched ? String(socios.length) : "",
            enriched ? e.source ?? "" : "",
            enriched && e.queriedAt ? e.queriedAt.toISOString() : "",
            !enriched ? e.lookupError ?? "" : "",
            e.aiStatus ?? "",
            aiOk ? e.aiSector ?? "" : "",
            aiOk ? e.aiSize ?? "" : "",
            aiOk ? e.aiProfile ?? "" : "",
            aiOk ? e.aiReading ?? "" : "",
          ]);
        }
        await recordAudit(batch.id, "EXPORT", { tipo: "consolidado:result" });
      }

      const body = "\uFEFF" + toCsv(out, ";");
      return fileResponse(body, "text/csv; charset=utf-8", "resultado-consolidado.csv");
    }

    if (type === "audit") {
      const batchMap = new Map(batches.map((b) => [b.id, b]));
      const events = await db.auditEvent.findMany({ orderBy: { createdAt: "asc" } });
      const lines = events.map((e) => {
        const b = batchMap.get(e.batchId);
        return JSON.stringify({
          ts: e.createdAt.toISOString(),
          lote: b ? { id: b.id, arquivo: b.fileName } : { id: e.batchId },
          evento: e.event,
          linha: e.rowNumber,
          detalhe: safeParse(e.detail),
        });
      });
      for (const b of exportable) {
        await recordAudit(b.id, "EXPORT", { tipo: "consolidado:audit" });
      }
      return fileResponse(lines.join("\n") + "\n", "application/x-ndjson; charset=utf-8", "auditoria-consolidada.jsonl");
    }

    if (type === "summary") {
      const bySource = new Map<string, number>();
      const byStatus = new Map<string, number>();
      let totalRows = 0;
      const lotes: unknown[] = [];

      for (const batch of exportable) {
        const rows = await db.importRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: "asc" } });
        totalRows += rows.length;
        for (const r of rows) {
          if (r.lookupStatus === "ENRIQUECIDO" && r.source) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
          const k = `${r.cnpjStatus}/${r.lookupStatus}`;
          byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
        }
        lotes.push({
          id: batch.id,
          arquivo: batch.fileName,
          status: batch.status,
          criado_em: batch.createdAt,
          finalizado_em: batch.finishedAt,
          contagens: {
            linhas: batch.rowCount,
            cnpjs_validos: batch.totalValid,
            cnpjs_invalidos: batch.totalInvalid,
            cnpjs_duplicados: batch.totalDuplicate,
            referencias: batch.totalReference,
            referencias_resolvidas: batch.totalResolved,
            enriquecidos: batch.totalEnriched,
            pendentes: batch.totalPending,
          },
          ia: batch.aiEnabled
            ? { ativa: true, elegiveis: batch.aiTotal, leituras: batch.aiDone, falhadas: batch.aiFailed, resumo_gerado: !!batch.aiSummary }
            : { ativa: false },
        });
        await recordAudit(batch.id, "EXPORT", { tipo: "consolidado:summary" });
      }

      const summary = {
        consolidado: { gerado_em: new Date(), lotes: exportable.length, linhas: totalRows },
        enriquecimento_por_fonte: Object.fromEntries(bySource),
        linhas_por_status: Object.fromEntries(byStatus),
        lotes,
      };
      return fileResponse(JSON.stringify(summary, null, 2), "application/json; charset=utf-8", "summary-consolidado.json");
    }

    return errRes("BAD_TYPE", "type deve ser result|audit|summary.", 422);
  } catch (err) {
    return fail500(err);
  }
}

function fileResponse(body: string, contentType: string, filename: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function safeSocios(json: string): { nome: string; qual: string; entrada: string }[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      return arr
        .filter((s) => s && typeof s === "object")
        .map((s) => ({ nome: String(s.nome ?? ""), qual: String(s.qual ?? ""), entrada: String(s.entrada ?? "") }));
    }
  } catch {
    /* ignore */
  }
  return [];
}
