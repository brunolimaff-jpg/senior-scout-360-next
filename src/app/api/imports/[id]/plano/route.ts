import { NextRequest, NextResponse } from "next/server";
import { okRes, errRes, fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth";
import { assertExportAllowed } from "@/lib/export-guard";
import { db } from "@/lib/db";
import { gerarPlanoConsultas } from "@/lib/plano/planner";
import { PLANO_CONSULTAS_VERSAO, planoParaJsonl } from "@/lib/plano/contrato";
import { recordTelemetry } from "@/lib/telemetry";
import { recordAudit } from "@/lib/enrich/engine";
import { sanitizeFileBase } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/imports/:id/plano — PLANEJADOR DE CONSULTAS (P4, v0.10.9).
 * Consolida as lacunas COMPLEMENTAR_API da triagem em um plano ORDENADO de
 * consultas candidatas, com custo contado ANTES de executar. GATE CENTRAL:
 * gerar o plano é SÓ LEITURA do estado local — zero IA, zero busca web, zero
 * HTTP externo; NADA executa sem o comando explícito do operador (os botões de
 * aprovação chamam os MESMOS endpoints de comando da ficha — nenhum executor novo).
 *
 * Sem `formato` → JSON para a UI (leitura). `?formato=json|jsonl` → EXPORTAÇÃO do
 * artefato PLANO_CONSULTAS_V1: requer ação explícita (guarda de export), auditoria
 * e telemetria — mesmo regime do TRIAGEM_V1. Validado por esquema: falha de schema
 * é erro honesto de servidor, nunca export silenciosamente corrompido.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertAccess(req); // leitura de dados do lote
    if (denied) return denied;
    const { id } = await ctx.params;

    const formatoParam = req.nextUrl.searchParams.get("formato");
    const isExport = formatoParam === "json" || formatoParam === "jsonl";
    if (isExport) {
      const deniedExport = await assertExportAllowed(req);
      if (deniedExport) return deniedExport;
    }

    const batch = await db.importBatch.findUnique({ where: { id }, select: { id: true, fileName: true, status: true } });
    if (!batch) return errRes("NOT_FOUND", "Lote não encontrado.", 404);

    const t0 = Date.now();
    const r = await gerarPlanoConsultas(id);
    if (!r.ok) {
      switch (r.motivo) {
        case "lote_nao_encontrado":
          return errRes("NOT_FOUND", "Lote não encontrado.", 404);
        case "lote_preview":
          return errRes("NOT_CONFIRMED", "Confirme o lote antes de gerar o plano de consultas.", 409);
        case "sem_linhas":
          return errRes("SEM_LINHAS", "Nenhuma linha com cadastro concluído neste lote.", 409);
        case "schema_invalido":
          console.error("[plano-v1] validação falhou:", r.erros?.slice(0, 5));
          return errRes("SCHEMA_INVALIDO", "O plano não passou na validação do contrato PLANO_CONSULTAS_V1 — nada foi publicado.", 500, { erros: r.erros?.slice(0, 10) });
      }
    }

    const plano = r.plano;
    recordTelemetry({
      tipo: "PLANO",
      etapa: isExport ? "EXPORT_PLANO_V1" : "GERAR_PLANO",
      cacheHit: true, // cálculo 100% local sobre fatos persistidos
      resultados: plano.itens.length,
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - t0,
      payload: { itens: plano.itens.length, chamadas: plano.resumo.chamadas_totais, fora: plano.fora_do_escopo_api.length, ia: 0, buscaWeb: 0, contrato: PLANO_CONSULTAS_VERSAO, execucaoAutomatica: false },
    });

    if (!isExport) {
      return okRes({ plano });
    }

    await recordAudit(id, "plano_export", {
      contrato: PLANO_CONSULTAS_VERSAO,
      formato: formatoParam,
      itens: plano.itens.length,
      chamadas: plano.resumo.chamadas_totais,
      fora: plano.fora_do_escopo_api.length,
    });

    const base = sanitizeFileBase(batch.fileName);
    const shortId = batch.id.slice(-6);
    const nomeArquivo = `plano-consultas-v1-${base}-${shortId}.${formatoParam}`;
    const corpo = formatoParam === "jsonl" ? planoParaJsonl(plano) : JSON.stringify(plano, null, 2);
    return new NextResponse(corpo, {
      status: 200,
      headers: {
        "Content-Type": formatoParam === "jsonl" ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return fail500(err);
  }
}
