import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errRes, fail500 } from "@/lib/api";
import { assertExportAllowed } from "@/lib/export-guard";
import { classificarTriagemLinha } from "@/lib/triage/engine";
import { lacunaParaTriagemV1, validarPacoteTriagemV1, paraJsonl, TRIAGEM_V1_VERSAO, fatosExportaveisDe } from "@/lib/triage/contrato";
import { recordTelemetry } from "@/lib/telemetry";
import { plural } from "@/lib/linguagem";
import { recordAudit } from "@/lib/enrich/engine";
import { sanitizeFileBase } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/imports/:id/triagem?formato=json|jsonl&rows=1,2 — TRIAGEM_V1 (v0.10.7).
 * Contrato de exportação NEUTRO e versionado das lacunas de triagem: UMA entrada
 * por pergunta de UMA entidade. Requer AÇÃO EXPLÍCITA do usuário (guarda de export).
 * v0.10.7 (auditoria): evidencias_referenciadas, fontes_consultadas e bloqueios são
 * POR PERGUNTA (não mais a relação completa das seis perguntas da linha); fatos de
 * origem "sinal" (texto livre) passam pelo pipeline reforçado de privacidade — nome
 * de PF, e-mail e telefone suprimidos; fato com nome de PF provável residual NÃO
 * exporta. Sanitização dura (CPF/mascarado/hash de PF → "[suprimido]") e validação
 * por esquema — nada sai sem passar. Sem SDK de consumidor, sem endpoint externo,
 * sem execução automática: esta rota só SERIALIZA o estado local.
 * GATE: zero IA, zero busca web.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertExportAllowed(req);
    if (denied) return denied;
    const { id } = await ctx.params;

    const batch = await db.importBatch.findUnique({ where: { id } });
    if (!batch) return errRes("NOT_FOUND", "Lote não encontrado.", 404);
    if (batch.status === "PREVIEW") {
      return errRes("NOT_CONFIRMED", "Confirme o lote antes de exportar.", 409);
    }

    const formato = req.nextUrl.searchParams.get("formato") === "jsonl" ? "jsonl" : "json";
    const rowsParam = req.nextUrl.searchParams.get("rows");
    let rowNumbers: number[] | null = null; // null = todas as linhas com coleta concluída
    if (rowsParam) {
      rowNumbers = rowsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1);
      if (rowNumbers.length === 0) return errRes("BAD_ROWS", "Parâmetro rows inválido (use números separados por vírgula).", 422);
    }

    const rows = await db.importRow.findMany({
      where: { batchId: id, ...(rowNumbers ? { rowNumber: { in: rowNumbers } } : {}) },
      select: { rowNumber: true, lookupStatus: true },
      orderBy: { rowNumber: "asc" },
    });
    // Exportação cobre linhas com coleta concluída (ou qualquer linha pedida explicitamente —
    // a triagem delas devolve honestamente a lacuna de identidade).
    const alvoRows = rowNumbers ? rows : rows.filter((r) => r.lookupStatus === "ENRIQUECIDO");
    if (alvoRows.length === 0) {
      return errRes("SEM_LINHAS", "Nenhuma linha elegível para triagem neste lote.", 409);
    }

    const t0 = Date.now();
    const dataReferencia = new Date().toISOString();
    const entradas: unknown[] = [];
    for (const r of alvoRows) {
      const tri = await classificarTriagemLinha(id, r.rowNumber);
      if (!tri.ok) continue; // linha sumiu entre a listagem e o cálculo — nada inventado
      // v0.10.7 (auditoria): contexto POR PERGUNTA — cada entrada carrega só as
      // evidências/fontes/bloqueios da SUA pergunta, não as das seis.
      for (const lacuna of tri.lacunas) {
        const fatosExportaveis = fatosExportaveisDe(lacuna);
        const fontesConsultadas = [...new Set(fatosExportaveis.map((f) => f.fonte).filter((f): f is string => !!f))];
        const evidencias = [
          {
            tipo: `triagem:${lacuna.perguntaId}`,
            referencia: `Linha ${r.rowNumber} do lote ${batch.id.slice(-6)} — ${plural(fatosExportaveis.length, "fato exportável", "fatos exportáveis")}, estado ${lacuna.estado}`,
            data: fatosExportaveis[0]?.data ?? null,
          },
        ];
        const bloqueios =
          lacuna.estado === "INDISPONIVEL"
            ? [
                {
                  fonte: fatosExportaveis[0]?.fonte ?? lacuna.fatos[0]?.fonte ?? "fonte externa",
                  tipo: lacuna.motivo.slice(0, 200),
                  data: dataReferencia,
                },
              ]
            : [];
        entradas.push(
          lacunaParaTriagemV1(lacuna, {
            cnpjCompleto: tri.cnpj,
            cnpjRaiz: tri.cnpjRaiz,
            dataReferencia,
            fontesConsultadas,
            evidencias,
            bloqueios,
          })
        );
      }
    }

    const validacao = validarPacoteTriagemV1(entradas);
    if (!validacao.ok) {
      // falha de schema é erro honesto — nunca export silenciosamente corrompido
      console.error("[triagem-v1] validação falhou:", validacao.erros.slice(0, 5));
      return errRes("SCHEMA_INVALIDO", "O pacote de triagem não passou na validação do contrato TRIAGEM_V1 — nada foi exportado.", 500, { erros: validacao.erros.slice(0, 10) });
    }

    recordTelemetry({
      tipo: "TRIAGEM",
      etapa: "EXPORT_TRIAGEM_V1",
      cacheHit: false,
      resultados: validacao.entradas.length,
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - t0,
      payload: { formato, linhas: alvoRows.length, ia: 0, buscaWeb: 0, contrato: TRIAGEM_V1_VERSAO },
    });
    await recordAudit(id, "triagem_export", {
      contrato: TRIAGEM_V1_VERSAO,
      formato,
      linhas: alvoRows.length,
      entradas: validacao.entradas.length,
    });

    const base = sanitizeFileBase(batch.fileName);
    const shortId = batch.id.slice(-6);
    const nomeArquivo = `triagem-v1-${base}-${shortId}.${formato}`;
    const corpo = formato === "jsonl" ? paraJsonl(validacao.entradas) : JSON.stringify({ versao_contrato: TRIAGEM_V1_VERSAO, geradoEm: dataReferencia, total_entradas: validacao.entradas.length, entradas: validacao.entradas }, null, 2);
    return new NextResponse(corpo, {
      status: 200,
      headers: {
        "Content-Type": formato === "jsonl" ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return fail500(err);
  }
}
