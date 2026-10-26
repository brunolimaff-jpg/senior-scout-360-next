import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { okRes, errRes, fail500 } from "@/lib/api";
import { normalizeCnpj, validateCnpj, formatCnpj } from "@/lib/cnpj";
import { recordAudit, startBatch } from "@/lib/enrich/engine";
import { assertMutationAllowed } from "@/lib/export-guard";
import type { DecideRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/imports/:id/rows/:rowNumber/decide
 *
 * Revisão humana da identidade (contrato Senior Scout 360) — SEM beco sem saída:
 * - { cnpj: "..." }           → o usuário confirma qual candidato é a empresa certa (ou informa
 *   um CNPJ que sabe estar correto). A linha segue para enriquecimento/matriz/leitura
 *   com a decisão registrada na trilha (confiança HUMANA — a evidência é a decisão dela).
 * - { cnpj: null }            → legado "nenhuma destas": fica Não identificada (mantido por
 *   compatibilidade; o caminho novo é { action: "NOT_FOUND" }).
 * - { action: "CLUE", value } → NOVA PISTA (site/domínio/CNPJ/telefone/cidade): reprocessa a
 *   MESMA linha com a pista informada, preservando o histórico de auditoria.
 * - { action: "NOT_FOUND" }   → encerra a investigação como "Pistas insuficientes — revisão
 *   manual" (decisão resolvida, sem candidatos pendurados — eles ficam arquivados no
 *   registro e { action: "BACK" } reabre a revisão).
 * - { action: "BACK" }        → volta a mostrar os candidatos atuais da linha.
 *
 * Resposta: { ok: true, decided: "CLUE_QUEUED" | "NOT_FOUND" | "BACK" | <cnpj> }.
 * O modelo NUNCA decide — esta rota é a porta de entrada da decisão humana.
 */

const MOTIVO_HUMANO = "Pistas insuficientes — revisão manual";

type ResolutionJson = {
  metodo?: string[];
  notas?: string[];
  candidatos?: unknown[];
  descartados?: unknown[];
  /** NOT_FOUND arquiva os candidatos aqui — BACK restaura (nenhum caminho irreversível). */
  candidatos_arquivados?: unknown[];
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; rowNumber: string }> }) {
  const denied = await assertMutationAllowed(req); // P0-08: decisão humana muda estado do lote
  if (denied) return denied;
  try {
    const { id, rowNumber } = await ctx.params;
    const n = Number(rowNumber);
    if (!Number.isInteger(n) || n < 1) {
      return errRes("BAD_ROW", "Número de linha inválido.", 422);
    }

    const body = (await req.json().catch(() => null)) as DecideRequest | null;
    if (!body || typeof body !== "object") {
      return errRes("BAD_REQUEST", "Envie { cnpj: string | null } ou { action } — veja o contrato da rota.", 422);
    }

    const row = await db.importRow.findFirst({ where: { batchId: id, rowNumber: n } });
    if (!row) return errRes("NOT_FOUND", "Linha não encontrada neste lote.", 404);
    // v0.11.0 (homologação Gate 4/C6): identidade confirmada AUTOMATICAMENTE pelo
    // resolvedor (evidência, não decisão humana) PODE ser reaberta/corrigida pelo
    // operador — "SEM beco sem saída" é o contrato desta rota e da avaliação de
    // identidade (confianca.ts). Só a decisão HUMANA (resolutionConfidence HUMANA,
    // oriunda de decide/VALIDAR_REGISTRO) é lei e permanece fechada.
    const confirmadaAuto = row.resolutionState === "CONFIRMED" && row.resolutionConfidence !== "HUMANA";
    // v0.10.12: linha VALIDA com divergência de identidade (LOCALIZADO) TEM revisão —
    // o registro localizado não pode virar beco sem saído. Só VALIDA sem divergência é
    // indecidível (identificação direta pelo CNPJ da planilha, sem nada a decidir).
    if (row.cnpjStatus === "VALIDA" && row.identityStage !== "LOCALIZADO" && !confirmadaAuto) {
      return errRes("NOT_DECIDABLE", "Esta entrada já veio com CNPJ válido — nada a decidir.", 409);
    }

    let resolution: ResolutionJson | null = null;
    try {
      resolution = row.resolutionJson ? (JSON.parse(row.resolutionJson) as ResolutionJson) : null;
    } catch {
      resolution = null;
    }

    /* ================== ações explícitas da revisão (Fase 5) ================== */

    /* ---------- VALIDAR_REGISTRO (v0.10.12): operador valida o CNPJ divergente ---------- */
    if ("action" in body && body.action === "VALIDAR_REGISTRO") {
      if (row.cnpjStatus !== "VALIDA" || row.identityStage !== "LOCALIZADO") {
        return errRes("NOT_VALIDABLE", "Só é possível validar um registro localizado com divergência de identidade.", 409);
      }
      const notas = [...(resolution?.notas ?? [])];
      const nota = "Revisão humana: você validou o registro localizado apesar da divergência com as pistas.";
      if (!notas.includes(nota)) notas.push(nota);
      await db.importRow.update({
        where: { id: row.id },
        data: {
          identityStage: "VALIDADO",
          // divergências preservadas como contexto (nada é apagado)
          resolutionState: "CONFIRMED",
          resolutionConfidence: "HUMANA",
          resolutionJson: JSON.stringify({ ...(resolution ?? {}), notas }),
        },
      });
      await recordAudit(id, "IDENTIDADE_VALIDADA", {
        cnpj: row.normalizedCnpj,
        origem: "operador_validou_registro_divergente",
      }, n);
      return okRes({ decided: "VALIDADO" });
    }

    /* ---------- BACK: volta a mostrar os candidatos ---------- */
    if ("action" in body && body.action === "BACK") {
      const current = Array.isArray(resolution?.candidatos) ? resolution!.candidatos! : [];
      const arquivados = resolution?.candidatos_arquivados;
      if (current.length === 0 && Array.isArray(arquivados) && arquivados.length > 0 && row.resolutionState === "UNRESOLVED") {
        // a linha foi encerrada como não identificada: reabre a revisão com os candidatos arquivados
        await db.importRow.update({
          where: { id: row.id },
          data: {
            resolutionState: "REVIEW",
            lookupError: null,
            resolutionJson: JSON.stringify({ ...(resolution ?? {}), candidatos: arquivados, candidatos_arquivados: undefined }),
          },
        });
        await recordAudit(id, "RESOLVE_REABRIR_CANDIDATOS", { pista: row.referenceValue }, n);
        return okRes({ decided: "BACK", reaberto: true, candidatos: arquivados });
      }
      // revisão ainda aberta: nada muda — apenas devolve os candidatos atuais
      return okRes({ decided: "BACK", reaberto: false, candidatos: current });
    }

    /* ---------- NOT_FOUND: encerra como não identificada (com saída de volta) ---------- */
    if ("action" in body && body.action === "NOT_FOUND") {
      if (row.cnpjStatus === "VALIDA") {
        return errRes(
          "NOT_DECIDABLE",
          "Este CNPJ veio da sua planilha: se não é a empresa certa, informe a pista correta (ação de nova pista) ou valide o registro se for esta mesmo.",
          409
        );
      }
      if (row.resolutionState === "CONFIRMED" && !confirmadaAuto) {
        return errRes("ALREADY_CONFIRMED", "Esta empresa já foi confirmada.", 409);
      }
      const notas = [...(resolution?.notas ?? [])];
      const nota = `Revisão humana: ${MOTIVO_HUMANO}.`;
      if (!notas.includes(nota)) notas.push(nota);
      const candidatos = Array.isArray(resolution?.candidatos) ? resolution!.candidatos! : [];
      await db.importRow.update({
        where: { id: row.id },
        data: {
          resolutionState: "UNRESOLVED",
          resolutionConfidence: null,
          // a decisão fica limpa (sem candidatos pendurados); o registro arquiva para BACK reabrir
          resolutionJson: JSON.stringify({ ...(resolution ?? {}), notas, candidatos: [], candidatos_arquivados: candidatos }),
          lookupStatus: "NAO_ENCONTRADO",
          lookupError: MOTIVO_HUMANO,
          source: "RESOLVEDOR",
        },
      });
      await recordAudit(id, "RESOLVE_NAO_IDENTIFICADA", {
        pista: row.referenceValue,
        motivo: MOTIVO_HUMANO,
        candidatos_arquivados: candidatos.length,
      }, n);
      return okRes({ decided: "NOT_FOUND" });
    }

    /* ---------- CLUE: reprocessa a MESMA linha com a nova pista ---------- */
    if ("action" in body && body.action === "CLUE") {
      const value = typeof body.value === "string" ? body.value.trim() : "";
      if (!value) {
        return errRes("BAD_CLUE", "Informe a nova pista — site, domínio, CNPJ, telefone ou cidade.", 422);
      }
      if (value.length > 200) {
        return errRes("BAD_CLUE", "Pista longa demais — envie site, domínio, CNPJ, telefone ou cidade.", 422);
      }
      // v0.11.0 (Gate 4/C6): identidade AUTOMÁTICA confirmada aceita nova pista —
      // o CNPJ auto-resolvido sai junto (a correção fica na auditoria com o original).
      if ((row.resolutionState === "CONFIRMED" || row.resolvedCnpj) && !confirmadaAuto) {
        return errRes("ALREADY_CONFIRMED", "Esta empresa já tem identidade resolvida.", 409);
      }
      // v0.10.12: linha VALIDA divergente aceita nova pista — o CNPJ errado é REMOVIDO das
      // células (a correção fica na auditoria com o valor original) e a linha vira REFERENCIA.
      const ehValidaDivergente = row.cnpjStatus === "VALIDA" && row.identityStage === "LOCALIZADO";
      if (row.cnpjStatus !== "REFERENCIA" && !ehValidaDivergente) {
        return errRes("NOT_RETRYABLE", "Só entradas por pista (sem CNPJ direto) aceitam nova pista de busca.", 409);
      }

      // Classificação da pista com a MESMA gramática da entrada (resolve/extractClues):
      // estruturais viram a referência primária; texto (cidade/nome/telefone) soma às células.
      const digits = normalizeCnpj(value);
      const stripped = value.replace(/^https?:\/\//i, "");
      const host = stripped.split(/[/\s?#]/)[0] ?? "";
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      const isDomain = !isEmail && host.includes(".") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host);
      const isUrl = /^https?:\/\//i.test(value) || (isDomain && stripped.includes("/"));

      let clueKind = row.lookupKind; // texto livre mantém o kind original
      let clueRef = row.referenceValue;
      if (validateCnpj(digits).valid) {
        clueKind = "CNPJ";
        clueRef = digits;
      } else if (isEmail) {
        clueKind = "EMAIL";
        clueRef = value.toLowerCase();
      } else if (isUrl || isDomain) {
        clueKind = isUrl ? "URL" : "DOMAIN";
        clueRef = isUrl ? value : host;
      } else {
        // texto (cidade/complemento/nome): entra na busca ao lado da pista original
        clueRef = row.referenceValue ? `${row.referenceValue} ${value}` : value;
      }

      const pistaOriginal = row.referenceValue ?? row.lookupKind;
      const cells = (() => {
        try {
          const arr = JSON.parse(row.originalCellsJson);
          return Array.isArray(arr) ? arr.map((c) => String(c ?? "")) : [];
        } catch {
          return [];
        }
      })();
      // v0.10.12: em linha VALIDA divergente, o CNPJ contestado sai das células antes da nova pista
      const cnpjAntigo = row.normalizedCnpj || "";
      const cellsCorrigidas = ehValidaDivergente && cnpjAntigo
        ? cells.map((c) => ((c ?? "").replace(/\D/g, "").includes(cnpjAntigo) ? "" : c))
        : cells;

      await db.importRow.update({
        where: { id: row.id },
        data: {
          // a nova pista entra nas células — extractClues reclassifica (CNPJ/domínio/e-mail/
          // telefone/UF) junto com as pistas originais
          originalCellsJson: JSON.stringify([...cellsCorrigidas, value]),
          lookupKind: clueKind,
          referenceValue: clueRef,
          // reinício completo da resolução: o worker refaz identidade → enriquecimento →
          // matriz → leitura (mesmo pipeline do retry de linha)
          resolvedCnpj: null,
          normalizedCnpj: ehValidaDivergente || confirmadaAuto ? "" : row.normalizedCnpj,
          rawCnpj: ehValidaDivergente || confirmadaAuto ? "" : row.rawCnpj,
          cnpjStatus: ehValidaDivergente ? "REFERENCIA" : row.cnpjStatus,
          reverseSource: null,
          resolutionState: null,
          resolutionConfidence: null,
          resolutionJson: null,
          cluesJson: null,
          identityStage: null,
          identityDivergenciasJson: null,
          lookupStatus: "EM_FILA",
          lookupError: null,
          retryCount: 0,
        },
      });
      // histórico preservado: o evento de auditoria registra a pista original e a informada
      await recordAudit(id, "RESOLVE_NOVA_PISTA", {
        pista_original: pistaOriginal,
        pista_informada: value,
        kind: clueKind,
        acao: "CLUE",
        ...(ehValidaDivergente ? { cnpj_contestado_removido: cnpjAntigo } : {}),
        ...(confirmadaAuto ? { identidade_automatica_reaberta: cnpjAntigo || row.resolvedCnpj || true } : {}),
      }, n);

      const start = await startBatch(id);
      return okRes({
        decided: "CLUE_QUEUED",
        queued: start.started || start.reason === "already_running",
        note: start.started || start.reason === "already_running"
          ? undefined
          : "lote não iniciado automaticamente — use “Iniciar agora” no lote",
      });
    }

    /* ================== contrato legado: { cnpj } ================== */

    const raw = "cnpj" in body ? body.cnpj : undefined;

    /* ---------- "nenhuma destas é a empresa" (legado — mantido por compat) ---------- */
    if (raw === null || raw === undefined || raw === "") {
      if (row.resolutionState === "CONFIRMED") {
        return errRes("ALREADY_CONFIRMED", "Esta empresa já foi confirmada.", 409);
      }
      const notas = [...(resolution?.notas ?? [])];
      const nota = "Revisão humana: nenhuma empresa foi confirmada para esta pista.";
      if (!notas.includes(nota)) notas.push(nota);
      await db.importRow.update({
        where: { id: row.id },
        data: {
          resolutionState: "UNRESOLVED",
          resolutionConfidence: null,
          resolutionJson: JSON.stringify({ ...(resolution ?? {}), notas }),
          lookupStatus: "NAO_ENCONTRADO",
          lookupError: nota,
          source: "RESOLVEDOR",
        },
      });
      await recordAudit(id, "RESOLVE_DECISAO_HUMANA", { pista: row.referenceValue, escolhido: null }, n);
      return okRes({ decided: "none" });
    }

    /* ---------- confirmação de um CNPJ ---------- */
    if (typeof raw !== "string") {
      return errRes("BAD_REQUEST", "CNPJ deve ser texto ou null.", 422);
    }
    const digits = normalizeCnpj(raw);
    const check = validateCnpj(digits);
    if (!check.valid) {
      return errRes("INVALID_CNPJ", "Este CNPJ não passou na validação — confira a digitação.", 422);
    }

    const candidates = Array.isArray(resolution?.candidatos) ? resolution.candidatos : [];
    const fromCandidate = candidates.some((c) => (c as { cnpj?: string })?.cnpj === digits);
    // v0.10.12: linha VALIDA divergente aceita CORREÇÃO de CNPJ (o operador informa o certo)
    const correcaoValidaDivergente =
      row.cnpjStatus === "VALIDA" && row.identityStage === "LOCALIZADO" && digits !== row.normalizedCnpj;
    // v0.11.0 (Gate 4/C6): correção de identidade AUTOMÁTICA confirmada — o operador
    // informa o CNPJ certo (que pode estar fora dos candidatos) e a decisão automática
    // é substituída pela humana, com o valor anterior preservado na auditoria.
    const correcaoAuto = confirmadaAuto && digits !== row.resolvedCnpj;
    const decidable =
      row.resolutionState === "REVIEW" || row.resolutionState === "UNRESOLVED" || fromCandidate || correcaoValidaDivergente || correcaoAuto;
    if (!decidable) {
      return errRes("NOT_DECIDABLE", "Esta linha não está aguardando decisão de identidade.", 409);
    }

    const notas = [...(resolution?.notas ?? [])];
    const notaDecisao = correcaoValidaDivergente
      ? `Revisão humana: você corrigiu o CNPJ de ${formatCnpj(row.normalizedCnpj ?? "")} para ${formatCnpj(digits)}.`
      : correcaoAuto
        ? `Revisão humana: você corrigiu a identidade automática (${formatCnpj(row.resolvedCnpj ?? "")}) para ${formatCnpj(digits)}.`
        : fromCandidate
          ? "Revisão humana: você confirmou esta empresa entre as possibilidades encontradas."
          : "Revisão humana: você informou o CNPJ correto desta empresa.";
    if (!notas.includes(notaDecisao)) notas.push(notaDecisao);

    // v0.10.12: na correção de VALIDA divergente, o CNPJ antigo sai das células e o novo entra
    // (a trilha de auditoria preserva o valor original); identidade é reavaliada no reprocesso.
    const cellsCorrigidasCnpj = (() => {
      if (!correcaoValidaDivergente) return row.originalCellsJson;
      try {
        const arr = JSON.parse(row.originalCellsJson);
        const limpas = Array.isArray(arr) ? arr.map((c: unknown) => (String(c ?? "").replace(/\D/g, "").includes(row.normalizedCnpj ?? "") ? "" : c)) : [];
        return JSON.stringify([...limpas, formatCnpj(digits)]);
      } catch {
        return row.originalCellsJson;
      }
    })();

    await db.importRow.update({
      where: { id: row.id },
      data: {
        resolvedCnpj: digits,
        normalizedCnpj: digits,
        rawCnpj: correcaoValidaDivergente || correcaoAuto ? formatCnpj(digits) : row.rawCnpj,
        originalCellsJson: cellsCorrigidasCnpj,
        resolutionState: "CONFIRMED",
        resolutionConfidence: "HUMANA",
        // identidade do operador é lei: VALIDADO — na CORREÇÃO as divergências antigas
        // (do CNPJ contestado/auto-resolvido) saem; a reavaliação no reprocesso recria o contexto real.
        identityStage: "VALIDADO",
        identityDivergenciasJson: correcaoValidaDivergente || correcaoAuto ? null : row.identityDivergenciasJson,
        reverseSource: fromCandidate ? "Decisão humana na revisão" : correcaoValidaDivergente || correcaoAuto ? "CNPJ corrigido na revisão" : "CNPJ informado na revisão",
        cluesJson: row.cluesJson,
        resolutionJson: JSON.stringify({
          ...(resolution ?? {}),
          notas,
          decisao_humana: { cnpj: digits, origem: correcaoValidaDivergente ? "correcao_cnpj" : fromCandidate ? "candidato" : "informado_manualmente", em: new Date().toISOString() },
        }),
        lookupStatus: "PENDENTE",
        lookupError: null,
        retryCount: 0,
      },
    });
    await recordAudit(id, "RESOLVE_DECISAO_HUMANA", {
      pista: row.referenceValue,
      escolhido: formatCnpj(digits),
      origem: correcaoValidaDivergente || correcaoAuto ? "correcao_cnpj" : fromCandidate ? "candidato" : "informado_manualmente",
      ...(correcaoValidaDivergente ? { cnpj_anterior: row.normalizedCnpj } : {}),
      ...(correcaoAuto ? { cnpj_automatico_anterior: row.resolvedCnpj } : {}),
      candidatos_disponiveis: candidates.length,
    }, n);

    // retoma o lote: enriquecimento → matriz → leitura inteligente (quando ativa)
    const start = await startBatch(id);
    if (!start.started && start.reason === "already_running") {
      return okRes({ decided: digits, queued: true, note: "lote já em processamento; a linha será consumida pelo worker ativo" });
    }
    return okRes({ decided: digits, queued: start.started });
  } catch (err) {
    return fail500(err);
  }
}
