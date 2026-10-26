import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errRes, fail500 } from "@/lib/api";
import { recordAudit } from "@/lib/enrich/engine";
import { sanitizeFileBase, toCsv, type Delimiter } from "@/lib/csv";
import { formatCnpj } from "@/lib/cnpj";
import { assertExportAllowed } from "@/lib/export-guard";
import { construirDatasetExportacao, linhaEmRevisao } from "@/lib/export/dataset";
import { escopoDe } from "@/lib/export/escopo";
import { gerarExcelLote, nomeArquivoExcel } from "@/lib/export/excel";
import { gerarPdfEmpresa, gerarPdfLote, PdfLimiteError } from "@/lib/export/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/imports/:id/export?type=result|result_confirmed|result_selected|result_review|pending|summary|audit|ai|teia|telemetria|telemetria-resumo|excel|pdf_lote|pdf_empresa
 * Exporta o lote: todas as linhas originais preservadas + colunas derivadas.
 * Linhas DUPLICADA herdam o enriquecimento da primeira ocorrência (por CNPJ ou por
 * referência — via duplicateOf), sem consulta repetida.
 * result_selected aceita &rows=1,2,3 (números das linhas selecionadas pelo usuário).
 * v0.10.15: seleção completa dentro do limite seguro (5000) — acima disso recusa
 * ANTES com explicação, nunca trunca em silêncio; result_review = CSV aditivo das
 * linhas em revisão; excel/pdf_lote/pdf_empresa = formatos comerciais novos.
 *
 * GUARDA DE EXPORTAÇÃO (G7): se SCOUT_EXPORT_TOKEN estiver definido no ambiente, o download
 * só passa com o header `x-export-token` igual ao valor — sem a variável, exporta livre (dev).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertExportAllowed(req);
    if (denied) return denied;

    const { id } = await ctx.params;
    const type = req.nextUrl.searchParams.get("type") ?? "result";

    const batch = await db.importBatch.findUnique({ where: { id } });
    if (!batch) return errRes("NOT_FOUND", "Lote não encontrado.", 404);
    if (batch.status === "PREVIEW") {
      return errRes("NOT_CONFIRMED", "Confirme o lote antes de exportar.", 409);
    }

    const isText = batch.sourceType === "TEXT";
    const header = (JSON.parse(batch.headerJson || "[]") as string[]).map((h, i) => (h.trim() ? h : `coluna_${i + 1}`));
    // Lotes TEXT exportam a coluna canônica "entrada" (linha original colada)
    const outHeader = isText ? ["entrada"] : header;
    const rows = await db.importRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });

    // mapa de enriquecimento por CNPJ (para propagar aos duplicados)
    const enrichedByCnpj = new Map<string, (typeof rows)[number]>();
    const rowByNumber = new Map<number, (typeof rows)[number]>();
    for (const r of rows) {
      rowByNumber.set(r.rowNumber, r);
      if (r.cnpjStatus === "VALIDA" && r.lookupStatus === "ENRIQUECIDO" && r.normalizedCnpj) {
        enrichedByCnpj.set(r.normalizedCnpj, r);
      }
    }

    const delimiter: Delimiter = (batch.delimiter as Delimiter) || ";";
    const base = sanitizeFileBase(batch.fileName);
    const shortId = batch.id.slice(-6);

    // Linha efetiva de enriquecimento: a própria, o dono do CNPJ ou a linha original
    // da qual esta é duplicada (dedupe de referência usa duplicateOf → linha).
    const eff = (r: (typeof rows)[number]): (typeof rows)[number] => {
      if (r.lookupStatus === "ENRIQUECIDO") return r;
      const byCnpj = r.normalizedCnpj ? enrichedByCnpj.get(r.normalizedCnpj) : undefined;
      if (byCnpj) return byCnpj;
      if (r.duplicateOf != null) {
        const orig = rowByNumber.get(r.duplicateOf);
        if (orig) return eff(orig);
      }
      return r;
    };

    const origCells = (r: (typeof rows)[number]): string[] => {
      if (isText) {
        const cells = r.originalCellsJson ? (JSON.parse(r.originalCellsJson) as string[]) : [];
        return [cells[0] ?? ""];
      }
      const orig = (r.originalCellsJson ? (JSON.parse(r.originalCellsJson) as string[]) : []).map((v) => v ?? "");
      while (orig.length < header.length) orig.push("");
      return orig;
    };

    const deriveCols = (r: (typeof rows)[number]) => {
      const e = eff(r);
      const enriched = e.lookupStatus === "ENRIQUECIDO";
      const aiOk = e.aiStatus === "OK" && !!e.aiReading;
      const socios = enriched && e.sociosJson ? safeArray(e.sociosJson) : [];
      // v0.11.0 (Gate 9/F3): sem truncamento silencioso — a teia exporta todos e
      // qtd_socios conta todos; cortar em 12 aqui contradizia o próprio cabeçalho.
      const sociosTxt = socios
        .map((s) => [s.nome, s.qual, s.entrada].filter((x) => x && x.length > 0).join(" — "))
        .join(" | ");
      const extra = (enriched && e.extraJson ? safeParseObj(e.extraJson) : null) as {
        capitalSocial?: string; naturezaJuridica?: string; email?: string; telefone?: string; telefone2?: string;
        mei?: string; simples?: string; porte?: string; regimeTributario?: string;
        ibge?: { populacao?: string; regiaoImediata?: string } | null;
      } | null;
      // Fase 1.1: SEM faixa de faturamento inferida — os campos factuais do cadastro
      // (capital_social, natureza_juridica) seguem no CSV; faturamento só com dado publicado.
      const dossier = (aiOk && e.aiDossierJson ? safeParseObj(e.aiDossierJson) : null) as { teia?: string[]; operacao?: string[]; tecnologia?: string[]; aderencia?: { produto?: string; processo?: string; hipotese?: string }[] } | null;
      const resolution = (r.resolutionJson ? safeParseObj(r.resolutionJson) : null) as { metodo?: string[]; notas?: string[] } | null;
      // v0.10.12: estágio de confiança da identidade + divergências explicadas
      const divergencias = (() => {
        try {
          return r.identityDivergenciasJson ? (JSON.parse(r.identityDivergenciasJson) as { tipo: string; severidade: string; descricao: string }[]) : [];
        } catch {
          return [];
        }
      })();
      const matrizDiferente = e.headquartersCnpj && e.headquartersCnpj !== e.normalizedCnpj;
      return [
        r.lookupKind || "CNPJ",
        r.referenceValue ?? "",
        r.resolvedCnpj ? formatCnpj(r.resolvedCnpj) : "",
        r.reverseSource ?? "",
        r.resolutionState ?? "",
        r.resolutionConfidence ?? "",
        r.identityStage ?? "",
        divergencias.map((d) => `${d.tipo}:${d.severidade} ${d.descricao}`).join(" | "),
        (resolution?.metodo ?? []).map(String).join(" > "),
        (resolution?.notas ?? []).map(String).join(" | "),
        r.normalizedCnpj || "",
        r.cnpjStatus === "VALIDA" ? "SIM" : r.cnpjStatus === "REFERENCIA" ? "REFERENCIA" : "NAO",
        r.cnpjStatus,
        enriched ? "ENRIQUECIDO" : e.lookupStatus,
        enriched ? e.legalName ?? "" : "",
        enriched ? e.tradeName ?? "" : "",
        enriched ? e.registrationStatus ?? "" : "",
        enriched ? e.statusDate ?? "" : "",
        enriched ? e.situationReason ?? "" : "",
        enriched ? e.branchType ?? "" : "",
        enriched ? (e.branchIdentifier != null ? String(e.branchIdentifier) : "") : "",
        enriched ? (e.cnpjRoot ?? "") : "",
        enriched ? (matrizDiferente ? formatCnpj(e.headquartersCnpj!) : "") : "",
        enriched ? (e.matrizStatus ?? "") : "",
        enriched ? e.openingDate ?? "" : "",
        enriched ? e.cnaeCode ?? "" : "",
        enriched ? e.cnaeDescription ?? "" : "",
        enriched ? e.municipality ?? "" : "",
        enriched ? e.uf ?? "" : "",
        enriched ? extra?.email ?? "" : "",
        enriched ? extra?.telefone ?? "" : "",
        enriched ? extra?.telefone2 ?? "" : "",
        enriched ? extra?.capitalSocial ?? "" : "",
        enriched ? extra?.naturezaJuridica ?? "" : "",
        enriched ? extra?.ibge?.populacao ?? "" : "",
        enriched ? extra?.ibge?.regiaoImediata ?? "" : "",
        enriched ? sociosTxt : "",
        enriched ? String(socios.length) : "",
        enriched ? e.source ?? "" : "",
        enriched && e.queriedAt ? e.queriedAt.toISOString() : "",
        !enriched ? e.lookupError ?? r.invalidReason ?? "" : "",
        e.aiStatus ?? "",
        aiOk ? e.aiSector ?? "" : "",
        aiOk ? e.aiSize ?? "" : "",
        aiOk ? e.aiProfile ?? "" : "",
        aiOk ? e.aiReading ?? "" : "",
        aiOk ? (dossier?.teia ?? []).map(String).join(" | ") : "",
        aiOk ? (dossier?.operacao ?? []).map(String).join(" | ") : "",
        aiOk ? (dossier?.tecnologia ?? []).map(String).join(" | ") : "",
        aiOk ? (dossier?.aderencia ?? []).map((f) => [f.produto, f.processo, f.hipotese].filter((x) => x && String(x).length > 0).join(": ")).join(" | ") : "",
      ];
    };

    const DERIVED_HEADER = [
      "tipo_entrada", "referencia", "cnpj_encontrado", "fonte_descoberta",
      "estado_resolucao", "confianca_evidencia", "etapa_identidade", "divergencias_identidade", "metodo_resolucao", "notas_resolucao",
      "cnpj_normalizado", "cnpj_valido", "status_linha", "status_enriquecimento",
      "razao_social", "nome_fantasia", "situacao_cadastral", "data_situacao",
      "motivo_situacao", "tipo_matriz_filial", "identificador_matriz_filial", "cnpj_raiz",
      "cnpj_matriz", "status_matriz", "data_abertura",
      "cnae_codigo", "cnae_descricao", "municipio", "uf",
      "contato_email", "contato_telefone", "contato_telefone_2",
      "capital_social", "natureza_juridica", "municipio_populacao", "regiao_imediata",
      "socios_qsa", "qtd_socios",
      "fonte", "data_consulta", "erro",
      "ia_status", "ia_setor", "ia_porte", "ia_perfil_classificacao", "ia_leitura_executiva",
      "ia_teia_societaria", "ia_operacao", "ia_tecnologia", "ia_aderencia_portfolio",
    ];

    const auditEvents = await db.auditEvent.findMany({ where: { batchId: id }, orderBy: { createdAt: "asc" } });

    // CSV de resultado — reutilizado por result / result_confirmed / result_selected
    const buildResultCsv = (list: typeof rows): string => {
      const out: (string | number)[][] = [["linha", ...outHeader, ...DERIVED_HEADER]];
      for (const r of list) {
        out.push([r.rowNumber, ...origCells(r), ...deriveCols(r)]);
      }
      return "\uFEFF" + toCsv(out, delimiter);
    };

    // conta "sem revisão pendente" (v0.10.15: rótulo comercial — correspondência
    // cadastral não é validação humana; o type segue result_confirmed por compatibilidade).
    // enriquecida e sem pendência de identidade (REVIEW/UNRESOLVED/LOCALIZADO
    // ficam de fora; entradas que já vieram com CNPJ válido e fecharam na fonte entram).
    // v0.10.12: registro LOCALIZADO (divergente) NÃO é conta confirmada — só sai aqui
    // depois de revisão (VALIDADO pelo operador) — o registro diverge das pistas.
    const isConfirmed = (r: (typeof rows)[number]): boolean => {
      const e = eff(r);
      if (e.lookupStatus !== "ENRIQUECIDO") return false;
      if (e.identityStage === "LOCALIZADO") return false;
      const st = e.resolutionState ?? r.resolutionState;
      return st === null || st === "CONFIRMED";
    };

    // v0.10.15 (reconciliação): em revisão = MESMA união do resumo e da tabela
    // (REVIEW ∨ LOCALIZADO coletado) — partilhada com Excel/PDF via dataset.
    const emRevisaoRow = (r: (typeof rows)[number]): boolean => {
      const e = eff(r);
      return linhaEmRevisao({
        identityStage: e.lookupStatus === "ENRIQUECIDO" ? e.identityStage : null,
        resolutionState: e.lookupStatus === "ENRIQUECIDO" ? e.resolutionState : null,
        lookupStatus: e.lookupStatus,
      });
    };

    let body: string;
    let filename: string;
    let contentType: string;

    if (type === "result" || type === "result_confirmed" || type === "result_selected" || type === "result_review") {
      let list = rows;
      if (type === "result_confirmed") {
        list = rows.filter(isConfirmed);
        if (list.length === 0) {
          return errRes("NO_CONFIRMED", "Nenhuma conta sem revisão pendente neste lote ainda — revise as identificações pendentes primeiro.", 422);
        }
      } else if (type === "result_selected") {
        // v0.10.15: seleção COMPLETA dentro do limite seguro — acima disso recusa
        // com explicação ANTES de gerar nada (nunca truncar em silêncio).
        const wanted = new Set(
          (req.nextUrl.searchParams.get("rows") ?? "")
            .split(",")
            .map((v) => Number.parseInt(v, 10))
            .filter((n) => Number.isInteger(n) && n > 0)
        );
        if (wanted.size === 0) {
          return errRes("NO_SELECTION", "Selecione contas na prévia antes de exportar apenas as selecionadas.", 422);
        }
        if (wanted.size > 5000) {
          return errRes("SELECAO_ACIMA_DO_LIMITE", `Seleção com ${wanted.size} linhas passa o limite seguro de 5000 por exportação. Divida a seleção ou exporte todas as empresas.`, 413);
        }
        list = rows.filter((r) => wanted.has(r.rowNumber));
        if (list.length === 0) {
          return errRes("NO_SELECTION", "As linhas selecionadas não existem mais neste lote.", 422);
        }
      } else if (type === "result_review") {
        // CSV aditivo (mesmo contrato do result) — somente as linhas em revisão
        list = rows.filter(emRevisaoRow);
        if (list.length === 0) {
          return errRes("NO_REVIEW", "Nenhuma conta em revisão neste lote.", 422);
        }
      }
      body = buildResultCsv(list);
      filename = `${type === "result" ? "resultado" : type === "result_confirmed" ? "confirmadas" : type === "result_selected" ? "selecionadas" : "revisoes"}-${base}-${shortId}.csv`;
      contentType = "text/csv; charset=utf-8";
    } else if (type === "excel") {
      // v0.10.15 — Excel comercial: 6 abas, escopo e seleção pela MESMA regra da interface.
      const escopo = escopoDe(req.nextUrl.searchParams.get("scope"));
      const rowsParam = req.nextUrl.searchParams.get("rows");
      const selecionadas = rowsParam
        ? rowsParam.split(",").map((v) => Number.parseInt(v, 10)).filter((n) => Number.isInteger(n) && n > 0)
        : undefined;
      const ds = await construirDatasetExportacao(id, escopo, selecionadas);
      if (!ds.ok) {
        return errRes(ds.codigo, ds.mensagem, ds.codigo === "SELECAO_ACIMA_DO_LIMITE" ? 413 : 422);
      }
      const buf = await gerarExcelLote(ds.dataset, id);
      await recordAudit(id, "EXPORT", { tipo: "excel", escopo, linhas: ds.dataset.linhas.length });
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${nomeArquivoExcel(base, shortId, escopo)}"`,
          "Cache-Control": "no-store",
        },
      });
    } else if (type === "pdf_lote") {
      // v0.10.15 — relatório compacto do lote no escopo escolhido.
      const escopo = escopoDe(req.nextUrl.searchParams.get("scope"));
      const rowsParam = req.nextUrl.searchParams.get("rows");
      const selecionadas = rowsParam
        ? rowsParam.split(",").map((v) => Number.parseInt(v, 10)).filter((n) => Number.isInteger(n) && n > 0)
        : undefined;
      const ds = await construirDatasetExportacao(id, escopo, selecionadas);
      if (!ds.ok) {
        return errRes(ds.codigo, ds.mensagem, ds.codigo === "SELECAO_ACIMA_DO_LIMITE" ? 413 : 422);
      }
      try {
        const { gerarPdfLote } = await import("@/lib/export/pdf");
        const buf = await gerarPdfLote(ds.dataset);
        await recordAudit(id, "EXPORT", { tipo: "pdf_lote", escopo, linhas: ds.dataset.linhas.length });
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="resumo-${base}-${shortId}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        if (e instanceof PdfLimiteError) {
          return errRes(e.codigo, e.message, 413, { orientacao: "Use a exportação Excel (.xlsx), que comporta o volume completo do lote." });
        }
        throw e;
      }
    } else if (type === "pdf_empresa") {
      // v0.10.15 — PDF comercial da ficha única (uma linha). Sem IA, sem reconsulta.
      const rowParam = Number.parseInt(req.nextUrl.searchParams.get("row") ?? "", 10);
      if (!Number.isInteger(rowParam) || rowParam < 1) {
        return errRes("BAD_ROW", "Informe a linha da empresa: &row=N.", 422);
      }
      const ds = await construirDatasetExportacao(id, "TODAS", undefined);
      if (!ds.ok) return errRes(ds.codigo, ds.mensagem, 422);
      const linha = ds.dataset.linhas.find((l) => l.rowNumber === rowParam);
      if (!linha) return errRes("NOT_FOUND", "Linha não encontrada neste lote.", 404);
      // O que falta descobrir: mesmo motor de triagem da ficha (local, sem rede).
      const { classificarTriagemLinha } = await import("@/lib/triage/engine");
      const tri = await classificarTriagemLinha(id, rowParam);
      const lacunas = tri.ok
        ? tri.lacunas.map((lac) => ({ pergunta: lac.pergunta, estado: lac.estado, falta: lac.falta, proximaVerificacao: lac.proximaVerificacao }))
        : [];
      // v0.10.22 — dois níveis do MESMO motor: executivo (seções comerciais +
      // fontes, 1–2 páginas) e completo (dossiê com anexos). Nenhum gera IA,
      // nenhum reconsulta.
      const nivelParam = req.nextUrl.searchParams.get("nivel");
      const nivel = nivelParam === "executivo" ? "executivo" as const : "completo" as const;
      const buf = await gerarPdfEmpresa(ds.dataset, linha, lacunas, { nivel });
      await recordAudit(id, "EXPORT", { tipo: `pdf_empresa_${nivel}`, linha: rowParam });
      // v0.10.16: nome de arquivo LEGÍVEL — razão social sanitizada antes do número da linha
      const nomeLegivel = sanitizeFileBase(linha.razaoSocial || linha.nomeFantasia || `linha-${rowParam}`).replace(/\s+/g, "-");
      const prefixo = nivel === "executivo" ? "ficha-executiva" : "ficha";
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${prefixo}-${nomeLegivel}-linha-${rowParam}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } else if (type === "pending") {
      const out: (string | number)[][] = [["linha", "entrada", "cnpj_original", "cnpj_normalizado", "referencia", "status", "motivo"]];
      for (const r of rows) {
        const active = r.cnpjStatus === "VALIDA" || r.cnpjStatus === "REFERENCIA";
        if (active && r.lookupStatus !== "ENRIQUECIDO") {
          out.push([
            r.rowNumber,
            isText ? origCells(r)[0] ?? "" : "",
            r.rawCnpj,
            r.normalizedCnpj || (r.resolvedCnpj ? formatCnpj(r.resolvedCnpj) : ""),
            r.referenceValue ?? "",
            r.lookupStatus,
            r.lookupError ?? r.invalidReason ?? "",
          ]);
        }
      }
      body = "\uFEFF" + toCsv(out, delimiter);
      filename = `pendente-${base}-${shortId}.csv`;
      contentType = "text/csv; charset=utf-8";
    } else if (type === "summary") {
      const bySource = new Map<string, number>();
      const byReverse = new Map<string, number>();
      for (const r of rows) {
        if (r.lookupStatus === "ENRIQUECIDO" && r.source) {
          bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
        }
        if (r.resolvedCnpj && r.reverseSource) {
          byReverse.set(r.reverseSource, (byReverse.get(r.reverseSource) ?? 0) + 1);
        }
      }
      const byStatus = new Map<string, number>();
      for (const r of rows) {
        const k = `${r.cnpjStatus}/${r.lookupStatus}`;
        byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
      }
      const aiRows = rows.filter((r) => r.aiStatus != null);
      const aiByStatus = new Map<string, number>();
      for (const r of aiRows) aiByStatus.set(r.aiStatus!, (aiByStatus.get(r.aiStatus!) ?? 0) + 1);
      const resolucaoPorEstado = new Map<string, number>();
      for (const r of rows) {
        if (r.resolutionState) resolucaoPorEstado.set(r.resolutionState, (resolucaoPorEstado.get(r.resolutionState) ?? 0) + 1);
      }
      // v0.10.15 (reconciliação): o resumo técnico expõe o MESMO conjunto da interface —
      // estágio de identidade por linha + pessoas jurídicas por raiz + revisão pela união.
      const estagioPorIdentidade = new Map<string, number>();
      let linhasEmRevisao = 0;
      let linhasValidadas = 0;
      let linhasColetadas = 0;
      const raizesComFicha = new Set<string>();
      const raizesIdentificadas = new Set<string>();
      for (const r of rows) {
        if (r.lookupStatus !== "ENRIQUECIDO") continue;
        linhasColetadas++;
        const e = eff(r);
        const estagio = e.identityStage ?? "(sem estágio)";
        estagioPorIdentidade.set(estagio, (estagioPorIdentidade.get(estagio) ?? 0) + 1);
        if (emRevisaoRow(r)) linhasEmRevisao++;
        if (e.identityStage === "VALIDADO") linhasValidadas++;
        if (r.cnpjRoot) {
          raizesComFicha.add(r.cnpjRoot);
          if (e.identityStage !== "LOCALIZADO" && (e.resolutionState === null || e.resolutionState === "CONFIRMED")) {
            raizesIdentificadas.add(r.cnpjRoot);
          }
        }
      }
      const matrizesPorStatus = new Map<string, number>();
      for (const r of rows) {
        if (r.matrizStatus) matrizesPorStatus.set(r.matrizStatus, (matrizesPorStatus.get(r.matrizStatus) ?? 0) + 1);
      }
      const summary = {
        lote: { id: batch.id, arquivo: batch.fileName, status: batch.status, criado_em: batch.createdAt, finalizado_em: batch.finishedAt },
        origem: isText ? "texto colado (não estruturado)" : "arquivo CSV",
        arquivo_original: { nome: batch.fileName, bytes: batch.fileSize, encoding: batch.encoding, delimitador: delimiter === "\t" ? "\\t" : delimiter, com_cabecalho: batch.hasHeader },
        nota_encoding: "CSV UTF-8 com BOM; delimitador documentado acima; valores iniciados por = + - @ são prefixados com ' para bloquear CSV injection.",
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
        resolucao_identidade: {
          nota: "Pista → candidatos → confirmação na base oficial. REVIEW e UNRESOLVED não são escolhidos por modelo.",
          estados: Object.fromEntries(resolucaoPorEstado),
          estagio_identidade: Object.fromEntries(estagioPorIdentidade),
          pessoas_juridicas: {
            localizadas: raizesComFicha.size,
            identificadas: raizesIdentificadas.size,
            nota: "Contagem por RAIZ (pessoa jurídica distinta) — matriz e filiais da mesma raiz são UMA empresa; linhas contam entradas do arquivo.",
          },
          revisao: {
            nota: "Mesma união da interface: REVIEW ∨ LOCALIZADO com ficha coletada.",
            linhas: linhasEmRevisao,
            validadas_pelo_operador: linhasValidadas,
            linhas_coletadas: linhasColetadas,
          },
          matrizes: Object.fromEntries(matrizesPorStatus),
        },
        ia: {
          ativa: batch.aiEnabled,
          elegiveis: batch.aiTotal,
          leituras_geradas: batch.aiDone,
          leituras_falhadas: batch.aiFailed,
          linhas_por_status: Object.fromEntries(aiByStatus),
          nota: "Leitura comercial gerada por IA a partir dos dados públicos consultados — hipóteses a validar, nunca conclusões.",
        },
        tempos: {
          processamento_ms: batch.processingAt && batch.finishedAt ? batch.finishedAt.getTime() - batch.processingAt.getTime() : null,
          tempo_medio_ms_por_enriquecido:
            batch.processingAt && batch.finishedAt && batch.totalEnriched > 0
              ? Math.round((batch.finishedAt.getTime() - batch.processingAt.getTime()) / batch.totalEnriched)
              : null,
          fonte_dados: "processingAt → finishedAt do lote (inclui consultas externas e espera por backoff)",
        },
        enriquecimento_por_fonte: Object.fromEntries(bySource),
        busca_reversa_por_fonte: Object.fromEntries(byReverse),
        linhas_por_status: Object.fromEntries(byStatus),
      };
      body = JSON.stringify(summary, null, 2);
      filename = `summary-${base}-${shortId}.json`;
      contentType = "application/json; charset=utf-8";
    } else if (type === "ai") {
      // Planilha Scout 360: uma linha por conta com o dossiê completo
      // (sem score, sem faixa de faturamento inferida, sem perguntas de abordagem — Fases 1.1/1.3/1.4)
      const out: (string | number)[][] = [[
        "linha", "cnpj", "razao_social", "setor_ia", "porte_ia", "perfil_classificacao_ia",
        "contato_email", "contato_telefone", "contato_telefone_2",
        "sintese_executiva_ia", "teia_societaria_ia", "operacao_ia", "tecnologia_ia", "aderencia_portfolio_ia",
        "hipoteses_a_validar",
        "socios_qsa", "fonte_dados_publicos",
      ]];
      for (const r of rows) {
        const e = eff(r);
        if (e.aiStatus !== "OK" || !e.aiReading) continue;
        const d = (e.aiDossierJson ? safeParseObj(e.aiDossierJson) : null) as { teia?: string[]; operacao?: string[]; tecnologia?: string[]; aderencia?: { produto?: string; processo?: string; hipotese?: string }[] } | null;
        const socios = e.sociosJson ? safeArray(e.sociosJson) : [];
        const sociosTxt = socios
          .slice(0, 12)
          .map((s) => [s.nome, s.qual, s.entrada].filter((x) => x && x.length > 0).join(" — "))
          .join(" | ");
        const extra = (e.extraJson ? safeParseObj(e.extraJson) : null) as { naturezaJuridica?: string; email?: string; telefone?: string; telefone2?: string; mei?: string; simples?: string; porte?: string; regimeTributario?: string } | null;
        out.push([
          r.rowNumber,
          r.normalizedCnpj ? formatCnpj(r.normalizedCnpj) : "",
          e.legalName ?? "",
          e.aiSector ?? "",
          e.aiSize ?? "",
          e.aiProfile ?? "",
          extra?.email ?? "",
          extra?.telefone ?? "",
          extra?.telefone2 ?? "",
          e.aiReading ?? "",
          (d?.teia ?? []).map(String).join(" | "),
          (d?.operacao ?? []).map(String).join(" | "),
          (d?.tecnologia ?? []).map(String).join(" | "),
          (d?.aderencia ?? []).map((f) => [f.produto, f.processo, f.hipotese].filter((x) => x && String(x).length > 0).join(": ")).join(" | "),
          // v0.11.0 (Gate 9/F5): o motor grava hypotheses como string[] — a guarda
          // safeArray() só aceita objetos e descartava TODAS as hipóteses em silêncio.
          safeHypotheses(e.aiHypothesesJson),
          sociosTxt,
          extra?.naturezaJuridica ? `${e.source ?? ""} · ${extra.naturezaJuridica}` : e.source ?? "",
        ]);
      }
      body = "\uFEFF" + toCsv(out, delimiter);
      filename = `inteligencia-${base}-${shortId}.csv`;
      contentType = "text/csv; charset=utf-8";
    } else if (type === "teia") {
      // Teia societária consolidada: UMA LINHA POR SÓCIO (fatos do QSA das fontes públicas).
      // Sócio no CNPJ NÃO prova grupo econômico — o CSV expõe fatos, dedução é do analista.
      const out: (string | number)[][] = [[
        "linha", "cnpj_conta", "razao_social", "tipo_unidade", "cnpj_matriz",
        "socio_nome", "qualificacao", "data_entrada", "fonte", "data_consulta",
      ]];
      let contasComTeia = 0;
      let totalSocios = 0;
      for (const r of rows) {
        const e = eff(r);
        if (e.lookupStatus !== "ENRIQUECIDO") continue;
        const socios = e.sociosJson ? safeArray(e.sociosJson) : [];
        if (socios.length === 0) continue;
        contasComTeia++;
        totalSocios += socios.length;
        const matrizDiferente = e.headquartersCnpj && e.headquartersCnpj !== e.normalizedCnpj ? formatCnpj(e.headquartersCnpj) : "";
        // v0.10.0 (P1): teia exportada COMPLETA — sem corte em 30
        for (const s of socios) {
          out.push([
            r.rowNumber,
            e.normalizedCnpj ? formatCnpj(e.normalizedCnpj) : "",
            e.legalName ?? "",
            e.branchType ?? "",
            matrizDiferente,
            s.nome,
            s.qual,
            s.entrada,
            e.source ?? "",
            e.queriedAt ? e.queriedAt.toISOString() : "",
          ]);
        }
      }
      if (out.length === 1) {
        return errRes("NO_TEIA", "Nenhuma conta deste lote retornou quadro de sócios nas fontes públicas. Use o dossiê com IA para a leitura qualificada.", 422);
      }
      await recordAudit(id, "EXPORT", { tipo: "teia", contas_com_teia: contasComTeia, socios: totalSocios });
      body = "\uFEFF" + toCsv(out, delimiter);
      filename = `teia-societaria-${base}-${shortId}.csv`;
      contentType = "text/csv; charset=utf-8";
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } else if (type === "audit") {
      const lines = auditEvents.map((e) =>
        JSON.stringify({
          ts: e.createdAt.toISOString(),
          evento: e.event,
          linha: e.rowNumber,
          detalhe: safeParse(e.detail),
        })
      );
      body = lines.join("\n") + "\n";
      filename = `audit-${base}-${shortId}.jsonl`;
      contentType = "application/x-ndjson; charset=utf-8";
    } else if (type === "telemetria") {
      // Lote A3 (5.5): export sanitizado e correlacionável — um evento JSONL por
      // consulta/chamada/etapa. Sem segredos (nunca existem nos eventos), sem conteúdo bruto.
      const events = await db.telemetryEvent.findMany({ where: { batchId: id }, orderBy: { startedAt: "asc" } });
      const lines = events.map((e) =>
        JSON.stringify({
          ts: e.startedAt.toISOString(),
          runId: e.runId,
          batchId: e.batchId,
          rowId: e.rowId,
          rowNumber: e.rowNumber,
          empresa: e.empresa,
          cnpj: e.cnpj,
          etapa: e.etapa,
          tipo: e.tipo,
          fonte: e.fonte,
          operacao: e.operacao,
          alvo: e.alvo,
          httpStatus: e.httpStatus,
          erro: e.erro,
          tentativas: e.tentativas,
          cacheHit: e.cacheHit,
          resultados: e.resultados,
          aproveitaveis: e.aproveitaveis,
          motivoDescarte: e.motivoDescarte,
          modelo: e.modeloSolicitado ? { solicitado: e.modeloSolicitado, efetivo: e.modeloEfetivo } : null,
          tokens: e.tipo === "IA_CHAT"
            ? {
                prompt: e.tokensPrompt,
                completion: e.tokensCompletion,
                total: e.tokensTotal,
                informado: e.tokensInformado, // false = provedor não reportou (nunca confundir com 0)
              }
            : undefined,
          pacoteChars: e.pacoteChars,
          duracaoMs: e.duracaoMs,
          appVersao: e.appVersao,
          promptVersao: e.promptVersao,
          estadoFinal: e.estadoFinal,
          payload: safeParse(e.payloadJson ?? ""),
        })
      );
      body = lines.join("\n") + "\n";
      filename = `telemetria-${base}-${shortId}.jsonl`;
      contentType = "application/x-ndjson; charset=utf-8";
    } else if (type === "telemetria-resumo") {
      // Lote A3 (5.4): resumo consolidado legível — para o Planejador confrontar
      // telemetria × dossiês × mídia sem ler o JSONL inteiro.
      const { buildTelemetrySummary } = await import("@/lib/enrich/telemetry-summary");
      const summary = await buildTelemetrySummary(id);
      if (!summary) return errRes("NOT_FOUND", "Lote não encontrado.", 404);
      body = JSON.stringify(summary, null, 2) + "\n";
      filename = `telemetria-resumo-${base}-${shortId}.json`;
      contentType = "application/json; charset=utf-8";
    } else {
      return errRes("BAD_TYPE", "type deve ser result|result_confirmed|result_selected|result_review|pending|summary|ai|teia|audit|telemetria|telemetria-resumo|excel|pdf_lote|pdf_empresa.", 422);
    }

    await recordAudit(id, "EXPORT", { tipo: type, arquivo: filename });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return fail500(err);
  }
}

/**
 * POST /api/imports/:id/export — MESMO contrato do GET, com parâmetros no corpo.
 * v0.10.15: a seleção completa (até 5000 linhas) não cabe numa URL — o diálogo de
 * exportação usa POST quando o escopo é SELECIONADAS ou a lista é grande.
 * Delega ao GET reconstruindo a query — UMA implementação, zero divergência.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const body = (await req.json().catch(() => null)) as { type?: string; scope?: string; rows?: number[]; row?: number } | null;
    if (!body?.type) {
      return errRes("BAD_BODY", "Envie { type, scope?, rows?, row? } no corpo da requisição.", 422);
    }
    const qs = new URLSearchParams({ type: body.type });
    if (body.scope) qs.set("scope", body.scope);
    if (Array.isArray(body.rows) && body.rows.length > 0) qs.set("rows", body.rows.join(","));
    if (typeof body.row === "number" && body.row > 0) qs.set("row", String(body.row));
    const url = new URL(req.url);
    url.search = qs.toString();
    return GET(new NextRequest(url, { method: "GET", headers: req.headers }), ctx);
  } catch (err) {
    return fail500(err);
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function safeArray(json: string | null): { nome: string; qual: string; entrada: string }[] {
  if (!json) return [];
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

function safeHypotheses(json: string | null): string {
  if (!json) return "";
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr))
      return arr
        .map((h) =>
          typeof h === "string"
            ? h
            : String((h as { hipotese?: string })?.hipotese ?? (h as { texto?: string })?.texto ?? "")
        )
        .filter(Boolean)
        .join(" | ");
  } catch {
    /* ignore */
  }
  return "";
}

function safeParseObj(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}
