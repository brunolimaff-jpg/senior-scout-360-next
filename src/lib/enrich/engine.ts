/**
 * Engine do pipeline de importação/enriquecimento — determinístico por padrão,
 * com estágio opcional de inteligência de conta via IA (opt-in no confirm).
 * IA: rate limit global + cache entre lotes; tudo auditado.
 */
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { formatCnpj, normalizeCnpj, validateCnpj } from "@/lib/cnpj";
import { parseCsvFromBytes, type Delimiter } from "@/lib/csv";
import { parseTextLines, referenceKey, classifyToken } from "@/lib/extract";
import { type CnpjLookupResult, type CnpjExtra, type CnpjSocio, gapsOf } from "@/lib/enrich/sources";
import { lookupCnpjComCache, updateMatrizCache, type FontesProveniencia } from "@/lib/enrich/cadastro-cache";
import { plural } from "@/lib/linguagem";
import { classificarSetorial } from "@/lib/enrich/segmentos";
import { contextoMunicipal } from "@/lib/enrich/ibge";
import { buildUserMessage, DOSSIER_TEMPERATURE, generateAccountIntelligence, generateBatchSummary, AiUnavailableError, PROMPT_VERSION, SYSTEM_PROMPT, SYSTEM_PROMPT_DEEP, type AccountAiInput, type ResearchPacketInput } from "@/lib/enrich/ai";
import { buildResearchPacket, toModelInput, type ModoPesquisa, type ResearchPacket } from "@/lib/enrich/research";
import { extractClues, resolveIdentity, resolveMatriz, type Clues, type IdentityResolution } from "@/lib/resolve";
import { avaliarIdentidade } from "@/lib/resolve/confianca";
import { newRunId, patchTelemetry, recordTelemetry, runWithTelemetry } from "@/lib/telemetry";
import {
  mayClaimQueue,
  parseQueueState,
  serializeQueue,
  type ResearchQueueState,
} from "@/lib/enrich/research-queue-state";

export const UPLOAD_DIR = path.join(process.cwd(), "upload");

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;
/** Pesquisa profunda pode esperar cota de busca (P0-06) — órfã é a GERANDO sem executor por > 30 min. */
const RESEARCH_STALE_MS = 30 * 60_000;
const AI_WINDOW = 2; // janelas de IA por loop (o rate limiter do ai.ts governa o ritmo global)
const AI_MAX_PER_BATCH = Math.max(1, Number(process.env.AI_MAX_PER_BATCH) || 100);

/* ---- Lease durável (G6, auditoria v0.6.1) ----
 * O lock em memória NÃO basta entre processos: dois servidores atrás do mesmo banco
 * ambos “não têm o lock” e duplicam execução. O lease VIVE NO BANCO (leaseOwner +
 * leaseExpiresAt): claim é updateMany condicional (1 vencedor), o heartbeat renova
 * a validade durante o trabalho e o sweep só retoma quando o lease EXPIROU —
 * um worker vivo (heartbeat a menos de LEASE_TTL_MS) nunca é tomado como órfão.
 */
const LEASE_TTL_MS = 60_000;    // validade de cada lease (4 heartbeats perdidos = morto)
const HEARTBEAT_MS = 15_000;    // renovação periódica durante runBatch

// Identidade durável do worker: sobrevive a HMR via globalThis (o pid muda só no restart real)
const gw = globalThis as unknown as { __scoutWorkerId?: string };
gw.__scoutWorkerId ??= `w_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const WORKER_ID = gw.__scoutWorkerId;

/** Claim atômico do lease no banco: em N processos simultâneos, exatamente UM vence. */
async function claimBatchLease(batchId: string): Promise<boolean> {
  const res = await db.importBatch.updateMany({
    where: {
      id: batchId,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    },
    data: { leaseOwner: WORKER_ID, leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) },
  });
  return res.count === 1;
}

/** Heartbeat: só o dono renova; count 0 = lease perdido (outro worker tomou após expirar). */
async function renewBatchLease(batchId: string): Promise<boolean> {
  const res = await db.importBatch.updateMany({
    where: { id: batchId, leaseOwner: WORKER_ID },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) },
  });
  return res.count === 1;
}

async function releaseBatchLease(batchId: string): Promise<void> {
  await db.importBatch
    .updateMany({ where: { id: batchId, leaseOwner: WORKER_ID }, data: { leaseOwner: null, leaseExpiresAt: null } })
    .catch(() => {});
}

// Locks em memória por batch (fast-path do MESMO processo; a verdade durável é o lease no banco)
const g = globalThis as unknown as { __cnpjBatchLocks?: Set<string>; __aiManualRegen?: Set<string>; __deepResearchLocks?: Set<string> };
g.__cnpjBatchLocks ??= new Set<string>();
const locks = g.__cnpjBatchLocks;
// Linhas com regeneração MANUAL de leitura IA: ignoram o cache entre lotes
// (o usuário pediu uma leitura nova — devolver cópia antiga seria desonesto).
g.__aiManualRegen ??= new Set<string>();
const aiManualRegen = g.__aiManualRegen;
// Pesquisas profundas em andamento (uma por linha — o clique duplo não duplica crawl)
g.__deepResearchLocks ??= new Set<string>();
const deepLocks = g.__deepResearchLocks;

/* ------------------------------ Auditoria ------------------------------ */

export async function recordAudit(
  batchId: string,
  event: string,
  detail: unknown = "",
  rowNumber?: number
) {
  await db.auditEvent.create({
    data: {
      batchId,
      event,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail),
      rowNumber: rowNumber ?? null,
    },
  });
}

/* ------------------------------ Upload/Preview ------------------------------ */

export interface ParseInfo {
  delimiter: Delimiter;
  encoding: string;
  header: string[];
  rowCount: number;
  sampleRows: string[][];
  cnpjColumnIndex: number;
  cnpjColumnDetectedBy: string;
}

const CNPJ_HEADER_RE = /^c\.?n\.?p\.?j/i;

/** Detecção determinística da coluna CNPJ: 1) por nome do cabeçalho; 2) por conteúdo. */
export function detectCnpjColumn(header: string[], sampleRows: string[][]): { index: number; detectedBy: string } {
  for (let i = 0; i < header.length; i++) {
    if (CNPJ_HEADER_RE.test(header[i].trim())) {
      return { index: i, detectedBy: "cabeçalho" };
    }
  }
  for (let i = 0; i < header.length; i++) {
    const hits = sampleRows.filter((r) => /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test((r[i] ?? "").trim())).length;
    if (sampleRows.length > 0 && hits / sampleRows.length >= 0.6) {
      return { index: i, detectedBy: "conteúdo das linhas" };
    }
  }
  return { index: 0, detectedBy: "padrão (primeira coluna)" };
}

export async function parseStoredFile(storedPath: string, delimiter?: Delimiter) {
  const buf = new Uint8Array(await fs.readFile(storedPath));
  return parseCsvFromBytes(buf, delimiter);
}

/* ------------------------------ Confirm (texto colado) ------------------------------ */

export interface TextLineStat { kind: string; count: number }

/**
 * Confirma um lote do tipo TEXT (dados colados não estruturados).
 * Cada linha já foi classificada na prévia; aqui re-parseamos do arquivo salvo
 * (fonte única de verdade) e materializamos as linhas com dedupe de CNPJ E de referência.
 */
export async function confirmTextBatch(batchId: string, aiEnabled = false): Promise<ConfirmOutcome> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, error: "Lote não encontrado" };
  if (batch.status !== "PREVIEW") {
    return { ok: false, error: `Lote já confirmado (status ${batch.status}). Cole novos dados para criar outro lote.` };
  }
  if (batch.sourceType !== "TEXT") {
    return { ok: false, error: "Lote não é do tipo texto colado. Use confirmBatch." };
  }

  const rawText = await fs.readFile(batch.storedPath, "utf8");
  const parsed = parseTextLines(rawText);
  if (parsed.lines.length === 0) {
    return { ok: false, error: "Texto colado não contém linhas de dados reconhecíveis." };
  }

  type Staged = {
    rowNumber: number;
    rawLine: string;
    lookupKind: "CNPJ" | "DOMAIN" | "EMAIL" | "URL" | "NAME";
    raw: string;
    normalized: string;
    referenceDomain: string | null;
    referenceValue: string | null;
    cnpjStatus: "VALIDA" | "INVALIDA" | "DUPLICADA" | "REFERENCIA";
    invalidReason: string | null;
    duplicateOf: number | null;
  };
  const staged: Staged[] = [];
  const firstValidByCnpj = new Map<string, number>();
  const firstByReference = new Map<string, number>();
  let totalValid = 0;
  let totalInvalid = 0;
  let totalDuplicate = 0;
  let totalReference = 0;

  for (const line of parsed.lines) {
    const rowNumber = line.rowNumber;
    if (line.lookupKind === "CNPJ") {
      if (line.cnpjValid) {
        const seen = firstValidByCnpj.get(line.normalizedCnpj);
        if (seen !== undefined) {
          staged.push({ rowNumber, rawLine: line.rawLine, lookupKind: "CNPJ", raw: line.rawCnpj, normalized: line.normalizedCnpj,
            referenceDomain: null, referenceValue: null, cnpjStatus: "DUPLICADA",
            invalidReason: null, duplicateOf: seen });
          totalDuplicate++;
        } else {
          firstValidByCnpj.set(line.normalizedCnpj, rowNumber);
          staged.push({ rowNumber, rawLine: line.rawLine, lookupKind: "CNPJ", raw: line.rawCnpj, normalized: line.normalizedCnpj,
            referenceDomain: null, referenceValue: null, cnpjStatus: "VALIDA", invalidReason: null, duplicateOf: null });
          totalValid++;
        }
      } else {
        staged.push({ rowNumber, rawLine: line.rawLine, lookupKind: "CNPJ", raw: line.rawCnpj, normalized: line.normalizedCnpj,
          referenceDomain: null, referenceValue: null, cnpjStatus: "INVALIDA", invalidReason: line.invalidReason, duplicateOf: null });
        totalInvalid++;
      }
      continue;
    }

    // pista de nome de empresa (ou referência): dedupe por chave canônica
    const dedupeKey =
      line.lookupKind === "NAME"
        ? `nome:${(line.referenceValue ?? "").toUpperCase().replace(/\s+/g, " ")}`
        : line.referenceDomain
          ? referenceKey(line.referenceDomain)
          : "";
    const seen = dedupeKey ? firstByReference.get(dedupeKey) : undefined;
    if (dedupeKey && seen !== undefined) {
      staged.push({ rowNumber, rawLine: line.rawLine, lookupKind: line.lookupKind, raw: "", normalized: "",
        referenceDomain: line.referenceDomain, referenceValue: line.referenceValue, cnpjStatus: "DUPLICADA",
        invalidReason: `Pista duplicada (${line.referenceValue} · ↳ linha ${seen})`, duplicateOf: seen });
      totalDuplicate++;
      continue;
    }
    if (dedupeKey) firstByReference.set(dedupeKey, rowNumber);
    staged.push({ rowNumber, rawLine: line.rawLine, lookupKind: line.lookupKind, raw: "", normalized: "",
      referenceDomain: line.referenceDomain, referenceValue: line.referenceValue,
      cnpjStatus: "REFERENCIA", invalidReason: null, duplicateOf: null });
    totalReference++;
  }

  await db.importRow.deleteMany({ where: { batchId } });

  const CHUNK = 200;
  for (let i = 0; i < staged.length; i += CHUNK) {
    await db.importRow.createMany({
      data: staged.slice(i, i + CHUNK).map((s) => ({
        batchId,
        rowNumber: s.rowNumber,
        originalCellsJson: JSON.stringify([s.rawLine]),
        lookupKind: s.lookupKind,
        // pista canônica: domínio para DOMAIN/EMAIL/URL; o próprio nome para pistas NAME
        referenceValue: s.lookupKind === "NAME" ? s.referenceValue : s.referenceDomain,
        rawCnpj: s.raw,
        normalizedCnpj: s.normalized,
        cnpjStatus: s.cnpjStatus,
        invalidReason: s.invalidReason,
        duplicateOf: s.duplicateOf,
        lookupStatus: s.cnpjStatus === "VALIDA" || s.cnpjStatus === "REFERENCIA" ? "EM_FILA" : "IGNORADO",
      })),
    });
  }

  await db.importBatch.update({
    where: { id: batchId },
    data: {
      rowCount: staged.length,
      status: "CONFIRMED",
      totalValid,
      totalInvalid,
      totalDuplicate,
      totalReference,
      totalResolved: 0,
      totalEnriched: 0,
      totalPending: totalValid + totalReference,
      aiEnabled,
      aiTotal: 0,
      aiDone: 0,
      aiFailed: 0,
      confirmedAt: new Date(),
    },
  });

  await recordAudit(batchId, "CONFIRM", {
    origem: "texto colado",
    linhas: staged.length,
    cnpjs_validos: totalValid,
    cnpjs_invalidos: totalInvalid,
    duplicadas: totalDuplicate,
    referencias: totalReference,
    ia_inteligencia: aiEnabled ? "ativa" : "desativada",
  });

  return { ok: true, batchId };
}

/* ------------------------------ Confirm ------------------------------ */

export interface ConfirmOutcome {
  ok: boolean
  error?: string;
  batchId?: string;
}

export async function confirmBatch(
  batchId: string,
  cnpjColumnIndex: number,
  hasHeader: boolean,
  aiEnabled = false
): Promise<ConfirmOutcome> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, error: "Lote não encontrado" };
  if (batch.status !== "PREVIEW") {
    return { ok: false, error: `Lote já confirmado (status ${batch.status}). Envie um novo arquivo para novo lote.` };
  }

  const parsed = await parseStoredFile(batch.storedPath);
  const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
  if (dataRows.length === 0) {
    return { ok: false, error: "Arquivo não contém linhas de dados além do cabeçalho." };
  }
  const header = hasHeader ? parsed.rows[0] ?? [] : dataRows[0].map((_, i) => `coluna_${i + 1}`);
  if (cnpjColumnIndex < 0 || cnpjColumnIndex >= header.length) {
    return { ok: false, error: `Índice da coluna CNPJ inválido (arquivo tem ${header.length} colunas).` };
  }

  // valida e deduplica ANTES de gravar
  type Staged = {
    rowNumber: number;
    cells: string[];
    raw: string;
    normalized: string;
    cnpjStatus: "VALIDA" | "INVALIDA" | "SEM_CNPJ" | "DUPLICADA" | "REFERENCIA";
    invalidReason: string | null;
    duplicateOf: number | null;
    /* Lote A1: pista alternativa quando a coluna CNPJ vem vazia — mesma estrutura
     * do caminho de texto colado; o worker roteia pelo MESMO pipeline de resolução. */
    lookupKind: "CNPJ" | "DOMAIN" | "EMAIL" | "URL" | "NAME";
    referenceDomain: string | null;
    referenceValue: string | null;
  };
  const staged: Staged[] = [];
  const firstValidByCnpj = new Map<string, number>();
  const firstByReference = new Map<string, number>();
  let totalValid = 0;
  let totalInvalid = 0;
  let totalDuplicate = 0;
  let totalReference = 0;

  /* --- Lote A1: colunas que NUNCA viram nome de empresa (cidade/UF/contato) --- */
  const NON_NAME_HEADER_RE = /(cidade|munic[ií]pio|uf|estado|telefone|fone|celular|c\.?n\.?p\.?j|e-?mail|site|url|dom[ií]nio)/i;
  const NAME_HEADER_RE = /(raz[aã]o ?social|nome ?fantasia|^nome$|empresa|fantasia)/i;
  const UF_TOKEN_RE = /^(ac|al|am|ap|ba|ce|df|es|go|ma|mg|ms|mt|pa|pb|pe|pi|pr|rj|rn|ro|rr|rs|sc|se|sp|to)$/i;

  /** Extrai pista alternativa de uma linha sem CNPJ (A1): domínio > e-mail > nome.
   *  Reusa a MESMA classificação de tokens do parser de texto — nenhuma pista some. */
  const clueFromRow = (row: string[]): { lookupKind: "DOMAIN" | "EMAIL" | "URL" | "NAME"; referenceDomain: string | null; referenceValue: string } | null => {
    const cells = row.map((c) => (c ?? "").trim());
    const classified = cells.map((c) => classifyToken(c));
    const domainTok = classified.find((c) => (c.kind === "DOMAIN" || c.kind === "URL") && c.domain);
    const emailTok = classified.find((c) => c.kind === "EMAIL" && c.email);
    if (domainTok?.domain) {
      return { lookupKind: domainTok.kind === "URL" ? "URL" : "DOMAIN", referenceDomain: domainTok.domain, referenceValue: domainTok.domain };
    }
    if (emailTok?.email) {
      return { lookupKind: "EMAIL", referenceDomain: emailTok.domain ?? null, referenceValue: emailTok.email };
    }
    // nome: 1) célula em coluna com cabeçalho de nome; 2) junção de tokens TEXT úteis
    let nameCandidate: string | null = null;
    for (let ci = 0; ci < header.length && ci < cells.length; ci++) {
      const h = (header[ci] ?? "").trim();
      if (NAME_HEADER_RE.test(h) && !NON_NAME_HEADER_RE.test(h.replace(NAME_HEADER_RE, ""))) {
        const v = cells[ci] ?? "";
        if (v && classifyToken(v).kind === "TEXT") {
          nameCandidate = v;
          break;
        }
      }
    }
    if (!nameCandidate) {
      const textCells = cells.filter((c, ci) => {
        if (!c || classified[ci].kind !== "TEXT") return false;
        if (UF_TOKEN_RE.test(c.toUpperCase()) && c.length <= 3) return false; // UF solta não é nome
        // coluna com cabeçalho de contato/local não vira nome
        const h = (header[ci] ?? "").trim();
        return !NON_NAME_HEADER_RE.test(h);
      });
      const joined = textCells.join(" ").replace(/\s+/g, " ").trim();
      const letters = joined.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
      if (joined.length >= 4 && letters.length >= 4) nameCandidate = joined.slice(0, 120);
    }
    if (nameCandidate) return { lookupKind: "NAME", referenceDomain: null, referenceValue: nameCandidate };
    return null;
  };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const raw = (row[cnpjColumnIndex] ?? "").trim();
    const rowNumber = i + 1;
    if (raw === "") {
      // Lote A1: sem CNPJ NÃO significa sem pista — procura nome/domínio/e-mail/site
      // nas demais colunas. Pista útil vira REFERENCIA e vai ao MESMO pipeline do
      // texto colado; linha sem pista alguma fica descartada com estado honesto.
      const clue = clueFromRow(row);
      if (clue) {
        const dedupeKey =
          clue.lookupKind === "NAME"
            ? `nome:${clue.referenceValue.toUpperCase().replace(/\s+/g, " ")}`
            : clue.referenceDomain
              ? referenceKey(clue.referenceDomain)
              : "";
        const seen = dedupeKey ? firstByReference.get(dedupeKey) : undefined;
        if (dedupeKey && seen !== undefined) {
          staged.push({ rowNumber, cells: row, raw: "", normalized: "", cnpjStatus: "DUPLICADA",
            invalidReason: `Pista duplicada (${clue.referenceValue} · ↳ linha ${seen})`, duplicateOf: seen,
            lookupKind: clue.lookupKind, referenceDomain: clue.referenceDomain, referenceValue: clue.referenceValue });
          totalDuplicate++;
        } else {
          if (dedupeKey) firstByReference.set(dedupeKey, rowNumber);
          staged.push({ rowNumber, cells: row, raw: "", normalized: "", cnpjStatus: "REFERENCIA", invalidReason: null, duplicateOf: null,
            lookupKind: clue.lookupKind, referenceDomain: clue.referenceDomain, referenceValue: clue.referenceValue });
          totalReference++;
        }
      } else {
        staged.push({ rowNumber, cells: row, raw: "", normalized: "", cnpjStatus: "SEM_CNPJ",
          invalidReason: "Sem pista utilizável — nenhuma coluna continha CNPJ, nome de empresa, site, domínio ou e-mail",
          duplicateOf: null, lookupKind: "CNPJ", referenceDomain: null, referenceValue: null });
        totalInvalid++;
      }
      continue;
    }
    const v = validateCnpj(raw);
    if (v.valid) {
      const seen = firstValidByCnpj.get(v.normalized);
      if (seen !== undefined) {
        staged.push({ rowNumber, cells: row, raw, normalized: v.normalized, cnpjStatus: "DUPLICADA", invalidReason: null, duplicateOf: seen,
          lookupKind: "CNPJ", referenceDomain: null, referenceValue: null });
        totalDuplicate++;
      } else {
        firstValidByCnpj.set(v.normalized, rowNumber);
        staged.push({ rowNumber, cells: row, raw, normalized: v.normalized, cnpjStatus: "VALIDA", invalidReason: null, duplicateOf: null,
          lookupKind: "CNPJ", referenceDomain: null, referenceValue: null });
        totalValid++;
      }
    } else {
      // A1: CNPJ inválido digitado NÃO esconde as outras pistas — se houver nome/site
      // válidos na linha, seguem como REFERENCIA (o CNPJ ruim fica registrado na pista).
      const clue = clueFromRow(row);
      if (clue) {
        staged.push({ rowNumber, cells: row, raw, normalized: v.normalized, cnpjStatus: "REFERENCIA",
          invalidReason: `CNPJ inválido (${v.reason}) — linha segue pela pista alternativa: ${clue.referenceValue}`,
          duplicateOf: null, lookupKind: clue.lookupKind, referenceDomain: clue.referenceDomain, referenceValue: clue.referenceValue });
        totalReference++;
      } else {
        staged.push({ rowNumber, cells: row, raw, normalized: v.normalized, cnpjStatus: "INVALIDA",
          invalidReason: `A coluna mapeada como CNPJ não contém um CNPJ válido (${v.reason.toLowerCase()}) e a linha não tem outras pistas utilizáveis`,
          duplicateOf: null, lookupKind: "CNPJ", referenceDomain: null, referenceValue: null });
        totalInvalid++;
      }
    }
  }

  // substitui eventuais linhas de pré-confirmação (idempotência)
  await db.importRow.deleteMany({ where: { batchId } });

  const CHUNK = 200;
  for (let i = 0; i < staged.length; i += CHUNK) {
    await db.importRow.createMany({
      data: staged.slice(i, i + CHUNK).map((s) => ({
        batchId,
        rowNumber: s.rowNumber,
        originalCellsJson: JSON.stringify(s.cells),
        // A1: pista canônica das linhas REFERENCIA (domínio p/ DOMAIN/EMAIL/URL, nome p/ NAME)
        lookupKind: s.lookupKind,
        referenceValue: s.cnpjStatus === "REFERENCIA" ? (s.lookupKind === "NAME" ? s.referenceValue : s.referenceDomain) : null,
        rawCnpj: s.raw,
        normalizedCnpj: s.normalized,
        cnpjStatus: s.cnpjStatus,
        invalidReason: s.invalidReason,
        duplicateOf: s.duplicateOf,
        lookupStatus: s.cnpjStatus === "VALIDA" || s.cnpjStatus === "REFERENCIA" ? "EM_FILA" : "IGNORADO",
      })),
    });
  }

  await db.importBatch.update({
    where: { id: batchId },
    data: {
      hasHeader,
      headerJson: JSON.stringify(header),
      delimiter: parsed.delimiter,
      encoding: parsed.encoding,
      cnpjColumnIndex,
      cnpjColumnDetect: `manual (${cnpjColumnIndex})`,
      rowCount: staged.length,
      status: "CONFIRMED",
      totalValid,
      totalInvalid,
      totalDuplicate,
      totalReference,
      totalEnriched: 0,
      totalPending: totalValid + totalReference,
      aiEnabled,
      aiTotal: 0,
      aiDone: 0,
      aiFailed: 0,
      confirmedAt: new Date(),
    },
  });

  await recordAudit(batchId, "CONFIRM", {
    coluna_cnpj: cnpjColumnIndex,
    com_cabecalho: hasHeader,
    linhas: staged.length,
    validas: totalValid,
    invalidas: totalInvalid,
    duplicadas: totalDuplicate,
    referencias: totalReference,
    pistas_alternativas: totalReference,
    ia_inteligencia: aiEnabled ? "ativa" : "desativada",
  });

  return { ok: true, batchId };
}

/* ------------------------------ Processamento ------------------------------ */

const RETRYABLE = ["PENDENTE", "EM_FILA", "CONSULTANDO", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"];

/**
 * Revalidação MANUAL de uma linha enriquecida (v0.10.0 P1, ENDURECIDA v0.10.1):
 * força consulta real (ignora a ficha cadastral), atualiza a linha com NOVA coleta
 * e substitui a ficha. GARANTIA v0.10.1: falha HTTP/timeout/429 NÃO destrói o último
 * cadastro válido — a ficha anterior é RESTAURADA (estado completo), a falha fica
 * registrada na auditoria com data e motivo, e a função devolve ok=false (a rota
 * responde erro — nada de "Ficha revalidada" sobre um fracasso). Nunca roda em
 * paralelo com o processamento do lote (guarda honesta). Requer linha ENRIQUECIDO
 * com CNPJ — é o botão "Revalidar" da ficha.
 */
export async function revalidarLinha(
  batchId: string,
  rowNumber: number
): Promise<{
  ok: boolean;
  motivo?: string;
  detalhe?: string;
  linha?: { lookupStatus: string; fonte: string | null; coletadoEm: string | null; consultadoEm: string | null; lookupError: string | null };
}> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (!batch) return { ok: false, motivo: "lote_nao_encontrado" };
  if (batch.status === "PROCESSING" || locks.has(batchId)) {
    return { ok: false, motivo: "lote_em_processamento" };
  }
  const row = await db.importRow.findFirst({ where: { batchId, rowNumber } });
  if (!row) return { ok: false, motivo: "linha_nao_encontrada" };
  if (row.lookupStatus !== "ENRIQUECIDO" || !row.normalizedCnpj) {
    return { ok: false, motivo: "linha_nao_revalidavel" };
  }

  await recordAudit(batchId, "REVALIDACAO_START", { cnpj: formatCnpj(row.normalizedCnpj) }, rowNumber);

  // SNAPSHOT da ficha válida ANTES de qualquer escrita (v0.10.1): se a tentativa falhar,
  // é ESTE estado que volta para a linha — o último cadastro conhecido não se perde.
  const snapshot = {
    lookupStatus: row.lookupStatus,
    lookupError: row.lookupError,
    source: row.source,
    queriedAt: row.queriedAt,
    collectedAt: row.collectedAt,
    rawJson: row.rawJson,
    legalName: row.legalName,
    tradeName: row.tradeName,
    registrationStatus: row.registrationStatus,
    statusDate: row.statusDate,
    situationReason: row.situationReason,
    branchType: row.branchType,
    openingDate: row.openingDate,
    cnaeCode: row.cnaeCode,
    cnaeDescription: row.cnaeDescription,
    municipality: row.municipality,
    uf: row.uf,
    sociosJson: row.sociosJson,
    extraJson: row.extraJson,
    fontesJson: row.fontesJson,
    retryCount: row.retryCount,
  };

  let processou = true;
  try {
    await processRow(
      batchId,
      {
        id: row.id,
        rowNumber: row.rowNumber,
        retryCount: row.retryCount,
        cnpjStatus: row.cnpjStatus,
        lookupKind: row.lookupKind,
        referenceValue: row.referenceValue,
        resolvedCnpj: row.resolvedCnpj,
        normalizedCnpj: row.normalizedCnpj,
        originalCellsJson: row.originalCellsJson,
        resolutionJson: row.resolutionJson,
        resolutionConfidence: row.resolutionConfidence,
      },
      false,
      true
    );
  } catch (err) {
    processou = false;
    await recordAudit(batchId, "REVALIDACAO_FALHOU", {
      cnpj: formatCnpj(row.normalizedCnpj),
      motivo: "excecao_durante_revalidacao",
      erro: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    }, rowNumber).catch(() => {});
  }

  const atualizada = await db.importRow.findUnique({ where: { id: row.id } });
  const status = atualizada?.lookupStatus ?? "";

  if (!processou || status !== "ENRIQUECIDO") {
    // v0.10.1: a tentativa falhou (erro, timeout, 429, todas as fontes em backoff…).
    // RESTAURA a ficha anterior (nem o status muda) e registra a falha com data + motivo.
    await db.importRow.update({ where: { id: row.id }, data: { ...snapshot } });
    const motivoFalha = processou
      ? `fontes não responderam com ficha válida (status final: ${status || "desconhecido"})`
      : "exceção durante a revalidação";
    await recordAudit(batchId, "REVALIDACAO_FALHOU", {
      cnpj: formatCnpj(row.normalizedCnpj),
      motivo: motivoFalha,
      status_tentativa: status || null,
      detalhe: atualizada?.lookupError ?? null,
      ficha_anterior_preservada: true,
    }, rowNumber).catch(() => {});
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "REVALIDACAO",
      estadoFinal: "falha",
      payload: { cnpj: formatCnpj(row.normalizedCnpj), status_tentativa: status || null, ficha_anterior_preservada: true },
    });
    return {
      ok: false,
      motivo: "revalidacao_falhou",
      detalhe: `Falha temporária nas fontes (${motivoFalha}) — a ficha anterior foi preservada.`,
      linha: {
        lookupStatus: snapshot.lookupStatus,
        fonte: snapshot.source,
        coletadoEm: snapshot.collectedAt?.toISOString() ?? null,
        consultadoEm: snapshot.queriedAt?.toISOString() ?? null,
        lookupError: snapshot.lookupError,
      },
    };
  }

  await recordAudit(batchId, "REVALIDACAO_OK", {
    cnpj: formatCnpj(row.normalizedCnpj),
    status_final: status,
    fonte: atualizada?.source ?? null,
  }, rowNumber);
  return {
    ok: true,
    linha: {
      lookupStatus: status,
      fonte: atualizada?.source ?? null,
      coletadoEm: atualizada?.collectedAt?.toISOString() ?? null,
      consultadoEm: atualizada?.queriedAt?.toISOString() ?? null,
      lookupError: atualizada?.lookupError ?? null,
    },
  };
}

const LOOKUP_TO_ROW: Record<string, string> = {
  ENRIQUECIDO: "ENRIQUECIDO",
  NOT_FOUND: "NAO_ENCONTRADO",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "ERRO_REDE",
  SERVER_ERROR: "ERRO_SERVIDOR",
  INVALID_RESPONSE: "ERRO_SERVIDOR",
};

function mapAttemptToStatus(attempt: CnpjLookupResult): string {
  return attempt.ok ? "ENRIQUECIDO" : LOOKUP_TO_ROW[attempt.errorType] ?? "ERRO_SERVIDOR";
}

export async function startBatch(batchId: string): Promise<{ started: boolean; reason?: string }> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { started: false, reason: "not_found" };
  if (batch.status === "PREVIEW") return { started: false, reason: "not_confirmed" };
  if (locks.has(batchId)) return { started: false, reason: "already_running" };

  // G6: claim ATÔMICO no banco ANTES de qualquer trabalho — em dois processos,
  // só um recebe count=1; o outro sai sem duplicar custo nem estado.
  const claimed = await claimBatchLease(batchId);
  if (!claimed) return { started: false, reason: "already_running" };

  locks.add(batchId);
  // fire-and-forget com captura de erro
  void runBatch(batchId)
    .catch(async (err) => {
      await recordAudit(batchId, "ENGINE_ERROR", err instanceof Error ? err.stack : String(err)).catch(() => {});
      await db.importBatch.update({ where: { id: batchId }, data: { status: "PARTIAL" } }).catch(() => {});
    })
    .finally(() => {
      locks.delete(batchId);
      void releaseBatchLease(batchId);
    });
  return { started: true };
}

async function runBatch(batchId: string) {
  await db.importBatch.update({
    where: { id: batchId },
    data: { status: "PROCESSING", processingAt: new Date() },
  });
  await recordAudit(batchId, "PROCESS_START", { worker: WORKER_ID });
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { aiEnabled: true } });
  const aiEnabled = batch?.aiEnabled ?? false;

  // G6: heartbeat renova o lease durante TODO o trabalho — um lote que leva minutos
  // não pode ser tomado por outro processo como “órfão” só porque processingAt é antigo.
  let leasePerdido = false;
  const heartbeat = setInterval(() => {
    renewBatchLease(batchId)
      .then((ok) => {
        if (!ok) leasePerdido = true; // outro worker assumiu após expiração — este run deve parar
      })
      .catch(() => {});
  }, HEARTBEAT_MS);

  try {
  for (;;) {
    if (leasePerdido) {
      await recordAudit(batchId, "LEASE_LOST", { motivo: "lease expirou e outro worker assumiu — este run encerra sem duplicar trabalho" }).catch(() => {});
      return;
    }
    const candidates = await db.importRow.findMany({
      where: { batchId, cnpjStatus: { in: ["VALIDA", "REFERENCIA"] }, lookupStatus: { in: RETRYABLE }, retryCount: { lt: MAX_RETRIES } },
      orderBy: { rowNumber: "asc" },
      take: 30,
    });
    if (candidates.length === 0) break;

    // executa em janelas com concorrência limitada
    for (let i = 0; i < candidates.length; i += MAX_CONCURRENCY) {
      if (leasePerdido) return;
      const window = candidates.slice(i, i + MAX_CONCURRENCY);
      await Promise.all(window.map((row) => processRow(batchId, row, aiEnabled)));
    }
  }

  /* etapa 2a (backfill idempotente): linhas enriquecidas sem etapa de matriz
     (ex.: processadas antes da camada existir ou com o client desatualizado). */
  const semMatriz = await db.importRow.findMany({
    where: { batchId, lookupStatus: "ENRIQUECIDO", matrizStatus: null, normalizedCnpj: { not: "" } },
    select: { id: true, rowNumber: true, normalizedCnpj: true, branchType: true },
    take: 100,
  });
  for (const r of semMatriz) {
    const identifier = r.branchType?.toUpperCase() === "MATRIZ" ? 1 : r.branchType?.toUpperCase() === "FILIAL" ? 2 : null;
    await applyMatrizStep(batchId, r.id, r.rowNumber, r.normalizedCnpj, identifier, null);
  }

  /* etapa 2 (opcional): inteligência de conta via IA para linhas enriquecidas.
     GERANDO também entra na seleção — dentro de um runBatch as janelas são aguardadas,
     então GERANDO aqui só existe em linha órfã de execução anterior (crash/HMR). */
  if (aiEnabled) {
    for (;;) {
      if (leasePerdido) return;
      const aiRows = await db.importRow.findMany({
        where: { batchId, aiStatus: { in: ["EM_FILA", "GERANDO"] } },
        orderBy: { rowNumber: "asc" },
        take: 30,
      });
      if (aiRows.length === 0) break;
      for (let i = 0; i < aiRows.length; i += AI_WINDOW) {
        if (leasePerdido) return;
        const window = aiRows.slice(i, i + AI_WINDOW);
        await Promise.all(window.map((row) => processRowAi(batchId, row)));
      }
    }
  }

  await recomputeCounters(batchId);
  const remaining = await db.importRow.count({
    where: { batchId, cnpjStatus: { in: ["VALIDA", "REFERENCIA"] }, lookupStatus: { in: RETRYABLE }, retryCount: { lt: MAX_RETRIES } },
  });
  const failedFinal = await db.importRow.count({
    where: { batchId, cnpjStatus: { in: ["VALIDA", "REFERENCIA"] }, lookupStatus: { in: RETRYABLE } },
  });
  const status = failedFinal === 0 ? "DONE" : "PARTIAL";
  await db.importBatch.update({ where: { id: batchId }, data: { status, finishedAt: new Date() } });
  await recordAudit(batchId, "PROCESS_END", {
    status,
    restantes_reprocessaveis: remaining,
    falhas_finais: failedFinal,
  });
  } finally {
    clearInterval(heartbeat); // o fim do run sempre para o heartbeat — o release do lease é no finally do startBatch
  }
}

/** Rótulo de fonte de resolução para a coluna reverseSource (auditoria amigável). */
function reverseSourceLabel(resolution: IdentityResolution): string {
  const chosen = resolution.candidatos.find((c) => c.cnpj === resolution.escolhido);
  const fonte = chosen?.fontes[0]?.fonte ?? "Resolução";
  if (fonte === "CNPJ informado") return "CNPJ_INFORMADO";
  if (fonte === "Site oficial") return "SITE_EVIDENCIA";
  if (fonte.startsWith("RDAP")) return "RDAP_REGISTRO_BR";
  if (fonte.startsWith("Busca na web")) return "BUSCA_WEB+RECEITA";
  return "RESOLVEDOR";
}

/**
 * v0.10.12: avalia a CONFIANÇA DA IDENTIDADE (pistas × ficha coletada) e grava o estágio
 * na linha — LOCALIZADO | CORRESPONDENTE | VALIDADO + divergências explicadas.
 * Determinístico, zero rede, zero IA. A ficha localizada NUNCA é descartada: divergência
 * vira explicação e a revisão permanece possível (rota decide).
 */
async function avaliarEGravarIdentidade(
  batchId: string,
  rowId: string,
  rowNumber: number,
  cnpj: string,
  clues: Clues,
  pistaEhCnpj: boolean,
  ficha: { legalName: string; tradeName: string; uf: string | null; municipio: string | null; emailDomain: string | null },
  ctx: { decididaPorOperador: boolean; dominioProvido: boolean }
): Promise<void> {
  const aval = avaliarIdentidade({
    clues,
    pistaEhCnpj,
    ficha,
    dominioProvido: ctx.dominioProvido,
    decididaPorOperador: ctx.decididaPorOperador,
  });
  await db.importRow.update({
    where: { id: rowId },
    data: {
      identityStage: aval.etapa,
      identityDivergenciasJson: aval.divergencias.length > 0 ? JSON.stringify(aval.divergencias) : null,
      cluesJson: JSON.stringify(clues),
    },
  });
  await recordAudit(batchId, "IDENTIDADE_AVALIADA", {
    cnpj,
    etapa: aval.etapa,
    similaridade_nome: aval.similaridadeNome,
    divergencias: aval.divergencias.length > 0 ? aval.divergencias.map((d) => `${d.tipo}:${d.severidade}`) : undefined,
    resumo: aval.resumo,
  }, rowNumber);
}

/**
 * Etapa de MATRIZ: guarda separadamente cnpj_encontrado e cnpj_matriz.
 * A matriz é SEMPRE confirmada pelo campo oficial identificador_matriz_filial=1
 * (nunca inferida pelo sufixo "0001"). Usa matriz já resolvida em outro lote como cache.
 * v0.10.0: DEVOLVE o resultado para a ficha cadastral (CadastroCache.matrizJson).
 */
async function applyMatrizStep(
  batchId: string,
  rowId: string,
  rowNumber: number,
  cnpj: string,
  identifier: number | null,
  cached: { headquartersCnpj: string | null; foundIsHeadquarters: boolean | null; matrizStatus: string | null; branchIdentifier: number | null } | null
): Promise<{ headquartersCnpj: string | null; foundIsHeadquarters: boolean | null; matrizStatus: string | null } | null> {
  const root = cnpj.slice(0, 8);
  if (cached?.headquartersCnpj || cached?.matrizStatus === "NAO_LOCALIZADA") {
    await db.importRow.update({
      where: { id: rowId },
      data: {
        branchIdentifier: identifier ?? cached.branchIdentifier,
        cnpjRoot: root,
        headquartersCnpj: cached.headquartersCnpj,
        foundIsHeadquarters: cached.foundIsHeadquarters,
        matrizStatus: cached.matrizStatus,
      },
    });
    await recordAudit(batchId, "MATRIZ_CACHE", {
      cnpj_encontrado: formatCnpj(cnpj),
      matriz: cached.headquartersCnpj ? formatCnpj(cached.headquartersCnpj) : null,
      status: cached.matrizStatus,
    }, rowNumber);
    return { headquartersCnpj: cached.headquartersCnpj, foundIsHeadquarters: cached.foundIsHeadquarters, matrizStatus: cached.matrizStatus };
  }
  await recordAudit(batchId, "MATRIZ_START", { cnpj: formatCnpj(cnpj), identificador: identifier }, rowNumber);
  const mz = await resolveMatriz(cnpj, identifier);
  await db.importRow.update({
    where: { id: rowId },
    data: {
      branchIdentifier: identifier,
      cnpjRoot: root,
      headquartersCnpj: mz.headquartersCnpj,
      foundIsHeadquarters: mz.foundIsHeadquarters,
      matrizStatus: mz.status,
    },
  });
  await recordAudit(batchId, "MATRIZ_END", {
    cnpj_encontrado: formatCnpj(cnpj),
    identificador_oficial: identifier,
    matriz: mz.headquartersCnpj ? formatCnpj(mz.headquartersCnpj) : null,
    status: mz.status,
    metodo: mz.metodo,
  }, rowNumber);
  return { headquartersCnpj: mz.headquartersCnpj, foundIsHeadquarters: mz.foundIsHeadquarters, matrizStatus: mz.status };
}

/**
 * Processa uma linha (wrapper de telemetria): cada linha é uma unidade de execução
 * com runId próprio — todo evento de coleta/pesquisa/IA gerado aqui sai correlacionado.
 * forceFresh (v0.10.0): ignora a ficha cadastral e revalida com consulta real.
 */
async function processRow(
  batchId: string,
  row: {
    id: string; rowNumber: number; retryCount: number; cnpjStatus: string;
    lookupKind: string; referenceValue: string | null; resolvedCnpj: string | null; normalizedCnpj: string;
    originalCellsJson: string; resolutionJson: string | null; resolutionConfidence: string | null;
  },
  aiEnabled = false,
  forceFresh = false
) {
  const cells = safeParseJsonArray<string>(row.originalCellsJson);
  const pista = cells.find((c) => (c ?? "").trim().length > 0)?.trim() ?? row.referenceValue ?? null;
  return runWithTelemetry(
    {
      runId: newRunId(),
      batchId,
      rowId: row.id,
      rowNumber: row.rowNumber,
      empresa: pista,
      cnpj: row.normalizedCnpj || null,
      etapa: "ENRIQUECIMENTO",
      startedAt: Date.now(),
    },
    () => processRowInner(batchId, row, aiEnabled, pista, forceFresh)
  );
}

async function processRowInner(
  batchId: string,
  row: {
    id: string; rowNumber: number; retryCount: number; cnpjStatus: string;
    lookupKind: string; referenceValue: string | null; resolvedCnpj: string | null; normalizedCnpj: string;
    originalCellsJson: string; resolutionJson: string | null; resolutionConfidence: string | null;
  },
  aiEnabled = false,
  pista: string | null = null,
  forceFresh = false
) {
  const { id: rowId, rowNumber, retryCount } = row;
  const tLinha = Date.now();
  await db.importRow.update({ where: { id: rowId }, data: { lookupStatus: "CONSULTANDO" } });

  // v0.10.12: pistas normalizadas para TODAS as linhas (antes só REFERENCIA tinha cluesJson) —
  // a avaliação de identidade compara pistas × ficha também para CNPJ direto.
  const cells = safeParseJsonArray<string>(row.originalCellsJson);
  const cluesLinha = extractClues(cells, row.lookupKind, row.referenceValue);
  const pistaEhCnpj = row.cnpjStatus === "VALIDA";
  // o vínculo do domínio já foi provado por fonte oficial (RDAP registro.br ou site do próprio domínio)?
  const dominioProvido = (() => {
    if (!row.resolutionJson) return false;
    try {
      const rj = JSON.parse(row.resolutionJson) as { candidatos?: { bindings?: { bindingType?: string }[] }[] };
      return (rj.candidatos ?? []).some((c) =>
        (c.bindings ?? []).some((b) => b.bindingType === "DOMAIN_REGISTRANT" || b.bindingType === "OFFICIAL_SITE")
      );
    } catch {
      return false;
    }
  })();
  const decididaPorOperador = row.resolutionConfidence === "HUMANA";
  let dominioProvidoCtx = dominioProvido;

  /* ---------- etapa 1: resolução de identidade (pistas sem CNPJ direto) ---------- */
  let cnpj = row.normalizedCnpj;
  if (row.cnpjStatus === "REFERENCIA" && !row.resolvedCnpj && row.referenceValue) {
    const pista = row.referenceValue;

    // cache de lote anterior: mesma pista já resolvida PELA CAMADA DE RESOLUÇÃO.
    // Só vale para resoluções no formato NOVO (com bindings de ENTITY_BINDING) — linhas
    // antigas (sem bindings, com o sinal proibido "situação cadastral confirmada") são
    // re-resolvidas para gerar a trilha nova.
    const cachedReverse = await db.importRow.findFirst({
      where: {
        referenceValue: pista,
        resolvedCnpj: { not: null },
        resolutionState: { not: null },
        batchId: { not: batchId },
        resolutionJson: { contains: '"bindings"' },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (cachedReverse?.resolvedCnpj) {
      cnpj = cachedReverse.resolvedCnpj;
      await db.importRow.update({
        where: { id: rowId },
        data: {
          resolvedCnpj: cnpj,
          normalizedCnpj: cnpj,
          reverseSource: cachedReverse.reverseSource ?? "RESOLVEDOR (cache)",
          cluesJson: cachedReverse.cluesJson,
          resolutionJson: cachedReverse.resolutionJson,
          resolutionState: cachedReverse.resolutionState,
          resolutionConfidence: cachedReverse.resolutionConfidence,
          identityStage: cachedReverse.identityStage,
          identityDivergenciasJson: cachedReverse.identityDivergenciasJson,
        },
      });
      await recordAudit(batchId, "RESOLVE_CACHE", {
        pista,
        cnpj_resolvido: formatCnpj(cnpj),
        lote_origem: cachedReverse.batchId,
        linha_origem: cachedReverse.rowNumber,
      }, rowNumber);
      recordTelemetry({
        tipo: "ETAPA",
        etapa: "RESOLUCAO_IDENTIDADE",
        operacao: "cache_entre_lotes",
        cacheHit: true,
        estadoFinal: "sucesso",
        duracaoMs: Date.now() - tLinha,
        override: { cnpj },
        payload: { pista, lote_origem: cachedReverse.batchId },
      });
    } else {
      await db.importRow.update({
        where: { id: rowId },
        data: { lookupStatus: "CONSULTANDO", cluesJson: JSON.stringify(cluesLinha) },
      });
      await recordAudit(batchId, "RESOLVE_START", {
        pista,
        tipo: row.lookupKind,
        pistas: {
          cnpj: cluesLinha.cnpj ? formatCnpj(cluesLinha.cnpj) : null,
          dominios: cluesLinha.domains,
          emails: cluesLinha.emails,
          nomes: cluesLinha.names.slice(0, 3),
          uf: cluesLinha.uf,
        },
      }, rowNumber);

      const tResolucao = Date.now();
      const resolution = await resolveIdentity({ clues: cluesLinha, label: pista });
      recordTelemetry({
        tipo: "ETAPA",
        etapa: "RESOLUCAO_IDENTIDADE",
        duracaoMs: Date.now() - tResolucao,
        estadoFinal: resolution.escolhido ? "sucesso" : resolution.transitorio ? "falha" : "parcial",
        payload: {
          pista,
          estado: resolution.estado,
          confianca: resolution.confianca,
          candidatos: resolution.candidatos.length,
          descartados: resolution.descartados.length,
          transitorio: resolution.transitorio,
        },
      });

      await db.importRow.update({
        where: { id: rowId },
        data: {
          cluesJson: JSON.stringify(cluesLinha),
          resolutionJson: JSON.stringify({
            metodo: resolution.metodo,
            notas: resolution.notas,
            candidatos: resolution.candidatos,
            descartados: resolution.descartados,
          }),
          resolutionState: resolution.estado,
          resolutionConfidence: resolution.confianca,
        },
      });
      await recordAudit(batchId, "RESOLVE_END", {
        pista,
        estado: resolution.estado,
        confianca: resolution.confianca,
        candidatos: resolution.candidatos.length,
        escolhido: resolution.escolhido ? formatCnpj(resolution.escolhido) : null,
      }, rowNumber);

      if (!resolution.escolhido) {
        // REVIEW/UNRESOLVED: resultado final honesto (revisão humana) — não escolhido por modelo
        const st = resolution.transitorio ? "ERRO_REDE" : "NAO_ENCONTRADO";
        await db.importRow.update({
          where: { id: rowId },
          data: {
            lookupStatus: st,
            lookupError: resolution.notas.join(" ") || "Pista insuficiente para identificar a empresa.",
            source: "RESOLVEDOR",
            queriedAt: new Date(),
            retryCount: resolution.transitorio ? retryCount + 1 : retryCount,
          },
        });
        await recordAudit(batchId, "RESOLVE_SEM_IDENTIDADE", {
          pista,
          estado: resolution.estado,
          transitorio: resolution.transitorio,
        }, rowNumber);
        recordTelemetry({
          tipo: "ETAPA",
          etapa: "ENRIQUECIMENTO",
          estadoFinal: "parcial",
          duracaoMs: Date.now() - tLinha,
          motivoDescarte: resolution.transitorio ? "falha transitória na resolução" : "identidade não confirmada — revisão humana",
          payload: { pista, estado_resolucao: resolution.estado, lookupStatus: st },
        });
        return;
      }

      cnpj = resolution.escolhido;
      patchTelemetry({ cnpj, etapa: "ENRIQUECIMENTO" });
      // v0.10.12: o vínculo do domínio pode ter sido provado AGORA (RDAP/site do CNPJ escolhido)
      const escolhidoObj = resolution.candidatos.find((c) => c.cnpj === cnpj);
      if (escolhidoObj?.bindings.some((b) => b.bindingType === "DOMAIN_REGISTRANT" || b.bindingType === "OFFICIAL_SITE")) {
        dominioProvidoCtx = true;
      }
      await db.importRow.update({
        where: { id: rowId },
        data: {
          resolvedCnpj: cnpj,
          normalizedCnpj: cnpj,
          reverseSource: reverseSourceLabel(resolution),
          lookupStatus: "CONSULTANDO",
        },
      });
      await recordAudit(batchId, "RESOLVE_OK", {
        pista,
        cnpj_resolvido: formatCnpj(cnpj),
        confianca: resolution.confianca,
      }, rowNumber);
    }
  }

  /* ---------- etapa 2: enriquecimento (mesmo caminho das linhas CNPJ direto) ---------- */

  // Ficha cadastral por CNPJ (v0.10.0 P1): ÚNICO caminho de reuso, com data da coleta
  // ORIGINAL preservada (collectedAt) e validade (TTL CADASTRO_TTL_DIAS). Expirou →
  // REVALIDA com consulta real (nova coleta). Nada é reaproveitado fora da validade.
  const lk = await lookupCnpjComCache(cnpj, { forceFresh });
  if (lk.via === "cache" && lk.resultado?.ok) {
    const cached = lk.resultado;
    const meta = lk.cacheMeta!;
    // IBGE é rederivado localmente (grátis/determinístico) — a ficha não guarda IBGE
    let extraData: CnpjExtra = { ...cached.data.extra };
    try {
      const ibgeCtx = await contextoMunicipal(extraData.codigoMunicipioIbge, cached.data.uf, cached.data.municipality);
      if (ibgeCtx) extraData = { ...extraData, ibge: ibgeCtx };
    } catch {
      /* tolerante — reuso vale sem IBGE */
    }
    // P3-A (v0.10.4): classificação multissetorial pelo CNAE — derivação LOCAL
    // (zero chamada, zero IA); setor cadastral ≠ operação comprovada
    const setorialCache = classificarSetorial(cached.data.cnaeCode, cached.data.extra.cnaesSecundarios, cached.data.extra.cnaesTruncados);
    extraData.setorPrimario = setorialCache.setorPrimario ?? undefined;
    extraData.setoresSecundarios = setorialCache.setoresSecundarios.length ? setorialCache.setoresSecundarios : undefined;
    extraData.multissetorial = setorialCache.multissetorial || undefined;
    extraData.avisosSetoriais = setorialCache.avisos.length ? setorialCache.avisos : undefined;
    const agora = new Date();
    const fontes: FontesProveniencia = {
      primaria: { fonte: cached.source, coletadoEm: meta.consultaOriginal },
      // v0.10.1: proveniência da coleta ORIGINAL restaurada da ficha — o reuso
      // continua mostrando QUE fonte complementar preencheu QUE campo (antes o campo
      // de complementações renascia vazio no reuso e a UI perdia a informação).
      complementacoes: lk.complementacoes.map((c) => ({ fonte: c.source, campos: c.campos, coletadoEm: c.coletadoEm })),
      cache: { consultaOriginal: meta.consultaOriginal, validoAte: meta.validoAte, reaproveitadoEm: agora.toISOString() },
    };
    await db.importRow.update({
      where: { id: rowId },
      data: {
        lookupStatus: "ENRIQUECIDO",
        lookupError: null,
        legalName: cached.data.legalName,
        tradeName: cached.data.tradeName,
        registrationStatus: cached.data.registrationStatus,
        statusDate: cached.data.statusDate,
        situationReason: cached.data.situationReason,
        branchType: cached.data.branchType,
        openingDate: cached.data.openingDate,
        cnaeCode: cached.data.cnaeCode,
        cnaeDescription: cached.data.cnaeDescription,
        municipality: cached.data.municipality,
        uf: cached.data.uf,
        source: cached.source,
        queriedAt: agora,
        collectedAt: new Date(meta.consultaOriginal),
        rawJson: cached.rawJson,
        sociosJson: cached.data.socios.length ? JSON.stringify(cached.data.socios) : null,
        extraJson: JSON.stringify(extraData),
        fontesJson: JSON.stringify(fontes),
        retryCount,
      },
    });
    await recordAudit(batchId, "CADASTRO_CACHE", {
      cnpj,
      fonte_original: cached.source,
      consulta_original: meta.consultaOriginal,
      valido_ate: meta.validoAte,
      reaproveitado_em: agora.toISOString(),
      setor_cnae: setorialCache.setorPrimario ?? undefined,
      multissetorial: setorialCache.multissetorial ? setorialCache.setoresSecundarios.join("+") : undefined,
      complementado_por: lk.complementacoes.length > 0
        ? lk.complementacoes.map((c) => `${c.source}(${c.campos.slice(0, 6).join(",")})`).join("; ")
        : undefined,
    }, rowNumber);
    // v0.10.12: confiança da identidade — pistas × ficha reutilizada (o reuso NÃO pula a avaliação)
    await avaliarEGravarIdentidade(batchId, rowId, rowNumber, cnpj, cluesLinha, pistaEhCnpj, {
      legalName: cached.data.legalName,
      tradeName: cached.data.tradeName,
      uf: cached.data.uf,
      municipio: cached.data.municipality,
      emailDomain: (extraData.email ?? "").split("@")[1]?.toLowerCase() ?? null,
    }, { decididaPorOperador, dominioProvido: dominioProvidoCtx });
    // P3-A: telemetria da segmentação (derivação local — nunca chamada, nunca IA)
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "SEGMENTACAO",
      estadoFinal: "sucesso",
      payload: {
        via: "ficha_cadastral",
        setor_primario: setorialCache.setorPrimario,
        setores_secundarios: setorialCache.setoresSecundarios,
        multissetorial: setorialCache.multissetorial,
        avisos: setorialCache.avisos.length ? setorialCache.avisos : undefined,
      },
    });
    recordTelemetry({
      tipo: "COLETA_CADASTRO",
      fonte: cached.source,
      operacao: "ficha_cadastral_reuso",
      alvo: formatCnpj(cnpj),
      cacheHit: true,
      resultados: 1,
      duracaoMs: Date.now() - tLinha,
      estadoFinal: "sucesso",
      override: { empresa: cached.data.legalName, cnpj },
      payload: { consulta_original: meta.consultaOriginal, valido_ate: meta.validoAte },
    });
    patchTelemetry({ empresa: cached.data.legalName ?? undefined, cnpj });
    // matriz: a ficha guarda a resolução anterior (sem nova consulta quando já resolvida)
    const ficha = await db.cadastroCache.findUnique({ where: { cnpj }, select: { matrizJson: true } });
    let matrizCacheada: { headquartersCnpj: string | null; foundIsHeadquarters: boolean | null; matrizStatus: string | null; branchIdentifier: number | null } | null = null;
    if (ficha?.matrizJson) {
      try { matrizCacheada = JSON.parse(ficha.matrizJson); } catch { /* tolerante */ }
    }
    const mzAplicada = await applyMatrizStep(batchId, rowId, rowNumber, cnpj, cached.data.branchIdentifier, matrizCacheada);
    if (mzAplicada) {
      await updateMatrizCache(cnpj, { ...mzAplicada, branchIdentifier: cached.data.branchIdentifier });
    }
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "ENRIQUECIMENTO",
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - tLinha,
      payload: { via: "ficha_cadastral", cnpj: formatCnpj(cnpj) },
    });
    if (aiEnabled) await queueAiFor(batchId, rowId, rowNumber);
    return;
  }

  await recordAudit(batchId, "LOOKUP_START", { cnpj, forcar_revalidacao: forceFresh }, rowNumber);
  const resultado = lk.resultado;
  const attempts = lk.attempts;
  const last = resultado ?? attempts[attempts.length - 1];
  const finalStatus = mapAttemptToStatus(last);
  // v0.10.1: lacunas que permanecem APÓS a cadeia inteira — auditadas como lacunas
  // honestas (e não como gatilho de mais consultas por campos que ninguém tem).
  const gapsRestantes = resultado?.ok ? gapsOf(resultado.data) : [];

  if (last.ok) {
    // CONTEXTO MUNICIPAL IBGE (população/região imediata/mesorregião) — mapeamento além
    // do cadastro. Falha de IBGE NUNCA atrasa nem derruba o enriquecimento do CNPJ.
    let extraData: CnpjExtra = last.data.extra;
    try {
      const ibgeCtx = await contextoMunicipal(
        last.data.extra.codigoMunicipioIbge,
        last.data.uf,
        last.data.municipality
      );
      if (ibgeCtx) extraData = { ...last.data.extra, ibge: ibgeCtx };
    } catch {
      /* tolerante — CNPJ enriquecido vale sem IBGE */
    }
    // P3-A (v0.10.4): classificação multissetorial pelo CNAE — derivação LOCAL
    // (zero chamada, zero IA); setor cadastral ≠ operação comprovada
    const setorial = classificarSetorial(last.data.cnaeCode, last.data.extra.cnaesSecundarios, last.data.extra.cnaesTruncados);
    extraData = {
      ...extraData,
      setorPrimario: setorial.setorPrimario ?? undefined,
      setoresSecundarios: setorial.setoresSecundarios.length ? setorial.setoresSecundarios : undefined,
      multissetorial: setorial.multissetorial || undefined,
      avisosSetoriais: setorial.avisos.length ? setorial.avisos : undefined,
    };
    await db.importRow.update({
      where: { id: rowId },
      data: {
        lookupStatus: "ENRIQUECIDO",
        lookupError: null,
        legalName: last.data.legalName,
        tradeName: last.data.tradeName,
        registrationStatus: last.data.registrationStatus,
        statusDate: last.data.statusDate,
        situationReason: last.data.situationReason,
        branchType: last.data.branchType,
        openingDate: last.data.openingDate,
        cnaeCode: last.data.cnaeCode,
        cnaeDescription: last.data.cnaeDescription,
        municipality: last.data.municipality,
        uf: last.data.uf,
        source: last.source,
        queriedAt: new Date(last.queriedAt),
        collectedAt: new Date(last.queriedAt),
        rawJson: last.rawJson,
        sociosJson: last.data.socios.length ? JSON.stringify(last.data.socios) : null,
        extraJson: extraData && Object.values(extraData).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && String(v ?? "").length > 0))
          ? JSON.stringify(extraData)
          : null,
        fontesJson: JSON.stringify({
          primaria: { fonte: last.source, coletadoEm: last.queriedAt },
          complementacoes: lk.complementacoes.map((c) => ({ fonte: c.source, campos: c.campos, coletadoEm: c.coletadoEm })),
          cache: null,
        } satisfies FontesProveniencia),
        retryCount,
      },
    });
    await recordAudit(batchId, "LOOKUP_OK", {
      cnpj,
      fonte: last.source,
      razao_social: last.data.legalName,
      complementado_por: lk.complementacoes.length > 0
        ? lk.complementacoes.map((c) => `${c.source}(${c.campos.slice(0, 6).join(",")})`).join("; ")
        : undefined,
      fontes_puladas_capacidade: lk.fontesPuladasCapacidade.length > 0
        ? lk.fontesPuladasCapacidade.join(", ")
        : undefined,
      lacunas_restantes: gapsRestantes.length > 0 ? gapsRestantes.join(", ") : undefined,
      municipio_pop: extraData.ibge?.populacao ?? undefined,
      mesorregiao: extraData.ibge?.mesorregiao ?? undefined,
      setor_cnae: setorial.setorPrimario ?? undefined,
      multissetorial: setorial.multissetorial ? setorial.setoresSecundarios.join("+") : undefined,
    }, rowNumber);
    // v0.10.12: confiança da identidade — pistas × ficha coletada agora
    await avaliarEGravarIdentidade(batchId, rowId, rowNumber, cnpj, cluesLinha, pistaEhCnpj, {
      legalName: last.data.legalName,
      tradeName: last.data.tradeName,
      uf: last.data.uf,
      municipio: last.data.municipality,
      emailDomain: (extraData.email ?? "").split("@")[1]?.toLowerCase() ?? null,
    }, { decididaPorOperador, dominioProvido: dominioProvidoCtx });
    // P3-A: telemetria da segmentação (derivação local — nunca chamada, nunca IA)
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "SEGMENTACAO",
      estadoFinal: "sucesso",
      payload: {
        setor_primario: setorial.setorPrimario,
        setores_secundarios: setorial.setoresSecundarios,
        multissetorial: setorial.multissetorial,
        avisos: setorial.avisos.length ? setorial.avisos : undefined,
      },
    });
    if (lk.complementacoes.length > 0 || lk.fontesPuladasCapacidade.length > 0) {
      recordTelemetry({
        tipo: "ETAPA",
        etapa: "COMPLEMENTACAO",
        estadoFinal: "sucesso",
        duracaoMs: Date.now() - tLinha,
        payload: {
          fonte_primaria: last.source,
          fontes: lk.complementacoes,
          fontes_puladas_capacidade: lk.fontesPuladasCapacidade.length > 0 ? lk.fontesPuladasCapacidade : undefined,
        },
      });
    }
    patchTelemetry({ empresa: last.data.legalName ?? undefined, cnpj });
    // matriz: campo oficial identificador_matriz_filial (nunca presumir 0001)
    const mzNova = await applyMatrizStep(batchId, rowId, rowNumber, cnpj, last.data.branchIdentifier, null);
    if (mzNova) {
      await updateMatrizCache(cnpj, { ...mzNova, branchIdentifier: last.data.branchIdentifier });
    }
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "ENRIQUECIMENTO",
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - tLinha,
      payload: { fonte: last.source, cnpj: formatCnpj(cnpj) },
    });
    if (aiEnabled) await queueAiFor(batchId, rowId, rowNumber);
    return;
  }

  await db.importRow.update({
    where: { id: rowId },
    data: {
      lookupStatus: finalStatus,
      lookupError: `${last.source}: ${last.message}`,
      source: last.source,
      queriedAt: new Date(),
      retryCount: retryCount + 1,
    },
  });
  const puladas = attempts.filter((a) => !a.ok && a.pulada).length;
  await recordAudit(batchId, "LOOKUP_FAIL", {
    cnpj,
    status: finalStatus,
    detalhe: last.message,
    fontes_puladas_backoff: puladas > 0 ? puladas : undefined,
  }, rowNumber);
  recordTelemetry({
    tipo: "ETAPA",
    etapa: "ENRIQUECIMENTO",
    estadoFinal: finalStatus === "RATE_LIMITED" ? "bloqueado" : "falha",
    duracaoMs: Date.now() - tLinha,
    erro: `${last.source}: ${last.message}`.slice(0, 300),
    payload: { fonte: last.source, status: finalStatus },
  });
}

/** Enfileira a inteligência de conta (IA) para uma linha enriquecida, respeitando o teto por lote.
 * P1-04 (auditoria): o teto mede CONSUMO REAL — leitura materializada (OK) ou em voo
 * (EM_FILA/GERANDO). Falha (FALHOU) e cap-skip (IGNORADO) não consomem teto, senão o
 * retry humano fica impossível e as leituras "evaporam" do orçamento. */
async function queueAiFor(batchId: string, rowId: string, rowNumber: number) {
  const used = await db.importRow.count({ where: { batchId, aiStatus: { in: ["OK", "EM_FILA", "GERANDO"] } } });
  if (used >= AI_MAX_PER_BATCH) {
    await db.importRow.update({
      where: { id: rowId },
      data: {
        aiStatus: "IGNORADO",
        aiError: "Teto de IA por lote atingido — use “Gerar leitura” nesta linha quando quiser.",
      },
    });
    await recordAudit(batchId, "AI_SKIP", { motivo: "teto_por_lote", teto: AI_MAX_PER_BATCH }, rowNumber);
    return;
  }
  await db.importRow.update({ where: { id: rowId }, data: { aiStatus: "EM_FILA" } });
}

/**
 * Inteligência de conta (IA) para uma linha ENRIQUECIDO (wrapper de telemetria).
 * Cache entre lotes primeiro (mesmo CNPJ já lido por IA em outro lote), depois chamada real
 * com rate limit. Falha de IA NÃO derruba a linha (permanece ENRIQUECIDO) — só marca a IA.
 */
async function processRowAi(
  batchId: string,
  row: { id: string; rowNumber: number; normalizedCnpj: string; referenceValue: string | null; legalName: string | null; tradeName: string | null; cnaeDescription: string | null; municipality: string | null; uf: string | null; branchType: string | null; registrationStatus: string | null; openingDate: string | null; sociosJson: string | null; extraJson: string | null; branchIdentifier: number | null; headquartersCnpj: string | null; foundIsHeadquarters: boolean | null; matrizStatus: string | null; resolutionState: string | null; resolutionConfidence: string | null; resolutionJson: string | null; reverseSource: string | null; researchJson: string | null; aiModelRequested?: string | null }
) {
  return runWithTelemetry(
    {
      runId: newRunId(),
      batchId,
      rowId: row.id,
      rowNumber: row.rowNumber,
      empresa: row.legalName ?? row.referenceValue ?? null,
      cnpj: row.normalizedCnpj || null,
      etapa: "SINTESE_IA",
      startedAt: Date.now(),
    },
    () => processRowAiInner(batchId, row)
  );
}

async function processRowAiInner(
  batchId: string,
  row: { id: string; rowNumber: number; normalizedCnpj: string; referenceValue: string | null; legalName: string | null; tradeName: string | null; cnaeDescription: string | null; municipality: string | null; uf: string | null; branchType: string | null; registrationStatus: string | null; openingDate: string | null; sociosJson: string | null; extraJson: string | null; branchIdentifier: number | null; headquartersCnpj: string | null; foundIsHeadquarters: boolean | null; matrizStatus: string | null; resolutionState: string | null; resolutionConfidence: string | null; resolutionJson: string | null; reverseSource: string | null; researchJson: string | null; aiModelRequested?: string | null }
) {
  const { id: rowId, rowNumber } = row;
  const tSintese = Date.now();
  await db.importRow.update({ where: { id: rowId }, data: { aiStatus: "GERANDO" } });

  // cache de lote anterior: mesma conta já com IA OK em OUTRO lote.
  // Regeneração manual ("Gerar de novo") NUNCA usa cache — o pedido é por leitura nova.
  // v0.10.2 (contrato do operador): reuso SÓ com o MESMO bloco de prompts —
  // dossiê gerado por prompt antigo (ou sem versão registrada) NÃO é reutilizado
  // involuntariamente; regenera com as regras atuais (temporalidade v0.10.2).
  const manual = aiManualRegen.delete(rowId);
  const cachedAi = manual
    ? null
    : await db.importRow.findFirst({
        where: {
          normalizedCnpj: row.normalizedCnpj,
          aiStatus: "OK",
          aiReading: { not: null },
          batchId: { not: batchId },
          dossierPromptVersion: PROMPT_VERSION,
        },
        orderBy: { aiProcessedAt: "desc" },
      });
  if (cachedAi?.aiReading) {
    await db.importRow.update({
      where: { id: rowId },
      data: {
        aiStatus: "OK",
        aiReading: cachedAi.aiReading,
        aiSector: cachedAi.aiSector,
        aiSize: cachedAi.aiSize,
        aiProfile: cachedAi.aiProfile,
        aiHypothesesJson: cachedAi.aiHypothesesJson,
        aiDossierJson: cachedAi.aiDossierJson,
        aiModel: cachedAi.aiModel ? `${cachedAi.aiModel.replace(/ \(cache\)/g, "")} (cache)` : null,
        aiModelRequested: cachedAi.aiModelRequested ?? null,
        // rastreabilidade A/B acompanha o dossiê em cache (mesma síntese de origem)
        dossierEvidenceSha: cachedAi.dossierEvidenceSha,
        dossierSystemSha: cachedAi.dossierSystemSha,
        dossierPromptVersion: cachedAi.dossierPromptVersion,
        dossierTemperature: cachedAi.dossierTemperature,
        aiProcessedAt: new Date(),
        aiError: null,
      },
    });
    await recordAudit(batchId, "AI_CACHE", {
      cnpj: formatCnpj(row.normalizedCnpj),
      lote_origem: cachedAi.batchId,
      linha_origem: cachedAi.rowNumber,
    }, rowNumber);
    recordTelemetry({
      tipo: "IA_CHAT",
      operacao: "cache_entre_lotes",
      cacheHit: true,
      modeloEfetivo: cachedAi.aiModel ?? null,
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - tSintese,
      payload: { cnpj: formatCnpj(row.normalizedCnpj), lote_origem: cachedAi.batchId, promptVersao: "(cache)" },
    });
    return;
  }

  // teia societária determinística + fatos extras capturados na consulta
  const socios = safeParseJsonArray<CnpjSocio>(row.sociosJson);
  const extra = safeParseJsonObject<Partial<CnpjExtra>>(row.extraJson);
  // resumo da resolução de identidade (evidência usada, sinais e contradições)
  const resolutionRaw = safeParseJsonObject<{ metodo?: string[]; notas?: string[]; candidatos?: { cnpj: string; strength: string; sinais?: string[]; contradicoes?: string[]; fontes?: { fonte: string; url: string | null }[]; confirmado?: { razaoSocial: string } | null }[] }>(row.resolutionJson);
  const chosen = resolutionRaw.candidatos?.find((c) => c.cnpj === row.normalizedCnpj) ?? null;
  const resolutionSummary = row.resolutionState
    ? {
        estado: row.resolutionState,
        confianca: row.resolutionConfidence,
        metodo: (resolutionRaw.metodo ?? []).slice(0, 6),
        // "situação cadastral confirmada" valida o registro, nunca o vínculo — nunca vai para a IA
        sinais: (chosen?.sinais ?? []).filter((s) => !/^situação cadastral confirmada/i.test(s)).slice(0, 5),
        contradicoes: (chosen?.contradicoes ?? []).slice(0, 5),
        fontes: (chosen?.fontes ?? []).slice(0, 4).map((f) => f.fonte + (f.url ? ` (${f.url})` : "")),
      }
    : null;
  const matrizDiferente = row.headquartersCnpj && row.headquartersCnpj !== row.normalizedCnpj;
  // pacote de pesquisa persistido (pesquisa profunda anterior) eleva a leitura de lote ao modo profundo
  const packet = safeParseJsonObject<ResearchPacket>(row.researchJson);
  const research: ResearchPacketInput | null = row.researchJson && (packet.siteOficial || packet.buscas)
    ? toModelInput({ ...(packet as unknown as ResearchPacket) })
    : null;
  const input: AccountAiInput = {
    normalizedCnpj: row.normalizedCnpj,
    legalName: row.legalName,
    tradeName: row.tradeName,
    cnaeDescription: row.cnaeDescription,
    municipality: row.municipality,
    uf: row.uf,
    branchType: row.branchType,
    registrationStatus: row.registrationStatus,
    openingDate: row.openingDate,
    socios,
    extra,
    referenceDomain: row.referenceValue,
    branchIdentifier: row.branchIdentifier,
    headquartersCnpj: matrizDiferente ? row.headquartersCnpj : null,
    matrizStatus: row.matrizStatus,
    resolution: resolutionSummary,
    research,
  };
  // Rastreabilidade A/B: hash do prompt EXATAMENTE como vai para o modelo (mesma
  // função que a comparação externa do laboratório reconstrói — comparabilidade provável).
  const abHashes = {
    dossierEvidenceSha: sha256Hex(buildUserMessage(input)),
    dossierSystemSha: sha256Hex(research ? SYSTEM_PROMPT_DEEP : SYSTEM_PROMPT),
    dossierPromptVersion: PROMPT_VERSION,
    dossierTemperature: research ? DOSSIER_TEMPERATURE : null,
  } as const;
  await recordAudit(batchId, "AI_START", {
    cnpj: formatCnpj(row.normalizedCnpj),
    com_teia: socios.length > 0,
    com_pacote_pesquisa: !!research,
  }, rowNumber);
  try {
    const res = await generateAccountIntelligence(input);
    await db.importRow.update({
      where: { id: rowId },
      data: {
        aiStatus: "OK",
        aiReading: res.reading,
        aiSector: res.sector,
        aiSize: res.size,
        aiProfile: res.profile,
        aiHypothesesJson: JSON.stringify(res.hypotheses),
        aiDossierJson: JSON.stringify(res.dossier),
        aiModel: res.model,
        aiModelRequested: res.modelRequested,
        ...abHashes,
        aiProcessedAt: new Date(),
        aiError: null,
      },
    });
    await recordAudit(batchId, "AI_OK", {
      cnpj: formatCnpj(row.normalizedCnpj),
      modelo: res.model,
      modelo_solicitado: res.modelRequested,
      fallback: res.modelFallback,
      profunda: !!research,
      tokens_prompt: res.dossier.tokens?.prompt ?? null,
      tokens_completion: res.dossier.tokens?.completion ?? null,
      tokens_total: res.dossier.tokens?.total ?? null,
      timestamp: new Date().toISOString(),
    }, rowNumber);
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "SINTESE_IA",
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - tSintese,
      modeloEfetivo: res.model,
      modeloSolicitado: res.modelRequested,
      tokens: res.dossier.tokens ?? null,
      payload: { modo: research ? "profunda" : "rapida", fallback: res.modelFallback },
    });
  } catch (err) {
    const friendly = err instanceof AiUnavailableError ? err.friendly : "A IA não conseguiu gerar a leitura desta conta agora. Você pode tentar novamente em instantes.";
    const internal = err instanceof Error ? err.message : String(err);
    await db.importRow.update({
      where: { id: rowId },
      data: { aiStatus: "FALHOU", aiError: friendly, aiProcessedAt: new Date() },
    });
    await recordAudit(batchId, "AI_FAIL", { cnpj: formatCnpj(row.normalizedCnpj), motivo: internal.slice(0, 300) }, rowNumber);
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "SINTESE_IA",
      estadoFinal: /429|too many/i.test(internal) ? "bloqueado" : "falha",
      duracaoMs: Date.now() - tSintese,
      erro: internal.slice(0, 300),
      payload: { modo: research ? "profunda" : "rapida" },
    });
  }
}

/** Reprocessa a IA de uma linha (FALHOU/IGNORADO ou regenerar um OK). Linha precisa estar ENRIQUECIDO. */
export async function retryAiRow(batchId: string, rowNumber: number): Promise<{ ok: boolean; error?: string; started?: boolean }> {
  const row = await db.importRow.findFirst({ where: { batchId, rowNumber } });
  if (!row) return { ok: false, error: "Linha não encontrada neste lote." };
  if (row.lookupStatus !== "ENRIQUECIDO") {
    return { ok: false, error: "A leitura com IA só existe para contas enriquecidas. Reprocesse a consulta primeiro." };
  }
  if (row.aiStatus === "EM_FILA" || row.aiStatus === "GERANDO") {
    return { ok: false, error: "A leitura desta conta já está em andamento." };
  }
  await db.importRow.update({
    where: { id: row.id },
    data: {
      aiStatus: "EM_FILA",
      aiError: null,
      aiReading: null,
      aiSector: null,
      aiSize: null,
      aiProfile: null,
      aiHypothesesJson: null,
      aiQuestionsJson: null,
      aiDossierJson: null,
      aiProcessedAt: null,
    },
  });
  await recordAudit(batchId, "AI_RETRY", { cnpj: row.normalizedCnpj ? formatCnpj(row.normalizedCnpj) : "", status_anterior: row.aiStatus ?? "—", regeneracao_manual: true }, rowNumber);
  // pedido manual liga a IA do lote — sem isso o loop de IA ignoraria a linha enfileirada
  await db.importBatch.update({ where: { id: batchId }, data: { aiEnabled: true } });
  // leitura pedida à mão: NÃO copiar cache de outro lote — gerar de verdade
  aiManualRegen.add(row.id);
  const start = await startBatch(batchId);
  return { ok: true, started: start.started };
}

/** Reenfileira TODAS as leituras IA que falharam ou ficaram fora do teto (só contas enriquecidas). */
export async function retryAllAi(batchId: string): Promise<{ ok: boolean; error?: string; queued?: number; started?: boolean }> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { aiEnabled: true } });
  if (!batch) return { ok: false, error: "Lote não encontrado." };
  const rows = await db.importRow.findMany({
    where: { batchId, lookupStatus: "ENRIQUECIDO", aiStatus: { in: ["FALHOU", "IGNORADO"] } },
    select: { id: true, rowNumber: true, normalizedCnpj: true, aiStatus: true },
    orderBy: { rowNumber: "asc" },
  });
  if (rows.length === 0) {
    return { ok: false, error: "Nenhuma leitura pendente — as contas com IA já estão prontas." };
  }
  // teto por lote volta a valer: consumo real = materializadas (OK) + em voo (EM_FILA/GERANDO).
  // P1-04: FALHOU NÃO consome teto — as leituras que falharam É que precisam do retry.
  const active = await db.importRow.count({ where: { batchId, aiStatus: { in: ["EM_FILA", "GERANDO"] } } });
  const materialized = await db.importRow.count({ where: { batchId, aiStatus: "OK" } });
  const capacidade = Math.max(0, AI_MAX_PER_BATCH - materialized - active);
  const elegiveis = rows.slice(0, Math.min(rows.length, capacidade));
  if (elegiveis.length === 0) {
    return { ok: false, error: `Teto de ${AI_MAX_PER_BATCH} leituras por lote atingido — gere individualmente nas linhas que quiser.` };
  }
  await db.importRow.updateMany({
    where: { id: { in: elegiveis.map((r) => r.id) } },
    data: { aiStatus: "EM_FILA", aiError: null, aiReading: null, aiSector: null, aiSize: null, aiProfile: null, aiHypothesesJson: null, aiQuestionsJson: null, aiDossierJson: null, aiProcessedAt: null },
  });
  await recordAudit(batchId, "AI_RETRY_ALL", { reenfileiradas: elegiveis.length, de: rows.length, capacidade });
  await db.importBatch.update({ where: { id: batchId }, data: { aiEnabled: true } });
  const start = await startBatch(batchId);
  return { ok: true, queued: elegiveis.length, started: start.started };
}

/* ------------------------------ Pesquisa profunda (nível 2) ------------------------------ */

export function isDeepResearchRunning(rowId: string): boolean {
  return deepLocks.has(rowId);
}

/**
 * Pesquisa profunda da conta (nível 2 — onde há AÇÃO comercial):
 *   1. monta o research_packet (site oficial rastreado + buscas públicas);
 *   2. persiste o pacote (auditoria e reuso);
 *   3. só ENTÃO chama a síntese com o modelo de dossiê (ZAI_DOSSIER_MODEL).
 * Fire-and-forget: o chamador marca GERANDO e a UI acompanha por polling.
 * Falha NUNCA derruba a linha — permanece ENRIQUECIDO com o que já tinha.
 */
export async function startDeepResearch(batchId: string, rowNumber: number, modo: ModoPesquisa = "COMPLETO"): Promise<{ ok: boolean; error?: string; started?: boolean }> {
  const row = await db.importRow.findFirst({ where: { batchId, rowNumber } });
  if (!row) return { ok: false, error: "Linha não encontrada neste lote." };
  if (row.lookupStatus !== "ENRIQUECIDO") {
    return { ok: false, error: "A pesquisa profunda precisa dos dados públicos prontos — confirme a identidade e conclua a consulta primeiro." };
  }
  if (row.aiStatus === "EM_FILA" || row.aiStatus === "GERANDO") {
    return { ok: false, error: "A leitura desta conta já está em andamento." };
  }
  if (deepLocks.has(row.id)) return { ok: false, error: "A pesquisa profunda já está em andamento." };

  deepLocks.add(row.id);
  void runDeepResearch(batchId, row.id, modo)
    .catch(async (err) => {
      await recordAudit(batchId, "DEEP_RESEARCH_ERROR", {
        cnpj: formatCnpj(row.normalizedCnpj),
        motivo: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      }, rowNumber).catch(() => {});
      await db.importRow.update({
        where: { id: row.id },
        data: { researchStatus: "FALHOU", researchError: "Falha inesperada na pesquisa profunda." },
      }).catch(() => {});
    })
    .finally(() => deepLocks.delete(row.id));
  return { ok: true, started: true };
}

/* ---------------- Fila de pesquisa profunda por seleção (Mesa de Contas v0.9.0) ----------------
 * Contrato: "importar 5 mil contas não autoriza pesquisar 5 mil contas" — a fila só
 * executa as contas EXPLICITAMENTE selecionadas. Durável no banco (researchQueueJson),
 * executor em memória (globalThis), UMA execução por lote, sem Redis/cron/queue externo.
 * - Parada honesta: contas concluídas mantêm o dossiê; pendentes ficam com estado visível.
 * - 429/cota: pausa a fila com motivo — retomada é sempre MANUAL.
 * - Retomada sem repetir chamadas: linha com pacote fresco e completo é PULADA (o
 *   runDeepResearch interno também reutiliza pacote salvo — dupla proteção).
 */
export type { ResearchQueueState } from "@/lib/enrich/research-queue-state";

const Q_HEARTBEAT_STALE_MS = 3 * 60_000; // fila sem heartbeat há mais tempo = executor morreu

interface QueueGlobal {
  __scoutResearchQueues?: Set<string>;
}
const qg = globalThis as unknown as QueueGlobal;
qg.__scoutResearchQueues ??= new Set<string>();
const researchQueueRunners = qg.__scoutResearchQueues;

/* ---- Claim distribuído da fila de pesquisa (G8.4) ----
 * O lease do lote (claimBatchLease) NÃO cobre a fila: `researchQueueJson` era gravado
 * com update cego, então dois processos sobre o mesmo banco liam o mesmo estado e
 * ambos tinham a escrita aceita — a mesma conta podia ser pesquisada duas vezes.
 * Aqui a exclusividade vem do mesmo padrão do lease: updateMany CONDICIONAL na string
 * exata recém-lida (CAS). Quem perde o CAS relê e recomeça; o dono renova o heartbeat
 * e, se outro assume, o executor antigo percebe e para sem duplicar trabalho.
 */
const Q_OWNER_RENEW_MS = 30_000; // renovação do dono (Q_HEARTBEAT_STALE_MS = 4 perdas)

const go = globalThis as unknown as { __scoutQueueExecId?: string };
go.__scoutQueueExecId ??= `q_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const QUEUE_EXECUTOR_ID = go.__scoutQueueExecId;

async function readQueueRaw(batchId: string): Promise<{ raw: string | null; state: ResearchQueueState | null }> {
  const b = await db.importBatch.findUnique({ where: { id: batchId }, select: { researchQueueJson: true } });
  const raw = b?.researchQueueJson ?? null;
  return { raw, state: parseQueueState(raw) };
}

async function readQueue(batchId: string): Promise<ResearchQueueState | null> {
  return (await readQueueRaw(batchId)).state;
}

/**
 * CAS: grava `next` somente se o banco ainda contém `expectedRaw` — a string que o
 * chamador leu. `null` significa "a fila não existe". Retorna true se esta chamada ganhou.
 */
async function casQueue(batchId: string, expectedRaw: string | null, next: ResearchQueueState): Promise<boolean> {
  const res = await db.importBatch.updateMany({
    where: { id: batchId, researchQueueJson: expectedRaw },
    data: { researchQueueJson: serializeQueue(next) },
  });
  return res.count === 1;
}

/**
 * Retoma uma fila sem dono vivo. O CAS garante UM vencedor entre processos; os perdedores
 * apenas saem. Usado no sweep de restart e não substitui o claim do executor.
 */
async function claimOrphanQueue(
  batchId: string
): Promise<{ state: ResearchQueueState; raw: string } | null> {
  const { raw, state } = await readQueueRaw(batchId);
  if (!state || raw === null) return null;
  if (!mayClaimQueue(state, QUEUE_EXECUTOR_ID, Date.now(), Q_HEARTBEAT_STALE_MS)) return null;
  const next: ResearchQueueState = { ...state, dono: QUEUE_EXECUTOR_ID, heartbeat: new Date().toISOString() };
  const nextRaw = serializeQueue(next);
  return (await casQueue(batchId, raw, next)) ? { state: next, raw: nextRaw } : null;
}

/** Pacote salvo é fresco (<24 h), completo e sem recusa de cota → a fila PULA sem novas chamadas. */
function packetFresco(row: { researchStatus: string | null; researchAt: Date | null; researchJson: string | null }): boolean {
  if (row.researchStatus !== "OK" || !row.researchJson) return false;
  const age = row.researchAt ? Date.now() - new Date(row.researchAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (age >= 24 * 3600 * 1000) return false;
  const p = safeParseJsonObject<ResearchPacket>(row.researchJson);
  return !!(p.siteOficial && p.instrumentacao && (p.buscasRecusadasCota ?? 0) === 0);
}

export async function getResearchQueue(batchId: string): Promise<ResearchQueueState | null> {
  return readQueue(batchId);
}

export function isResearchQueueRunning(batchId: string): boolean {
  return researchQueueRunners.has(batchId);
}

/** Enfileira a pesquisa profunda das contas selecionadas (Mesa de Contas). */
export async function startResearchQueue(
  batchId: string,
  rowNumbersInput: number[],
  modo: ModoPesquisa = "COMPLETO"
): Promise<
  | { ok: true; enfileiradas: number; naoElegiveis: number; estado: ResearchQueueState }
  | { ok: false; error: string }
> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (!batch) return { ok: false, error: "Lote não encontrado." };
  if (batch.status === "PREVIEW") return { ok: false, error: "Confirme o lote antes de pesquisar contas." };

  const pedidas = [...new Set(rowNumbersInput.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (pedidas.length === 0) return { ok: false, error: "Selecione ao menos uma conta para pesquisar." };
  if (pedidas.length > 500) return { ok: false, error: "Máximo de 500 contas por fila — selecione em blocos menores." };

  const rows = await db.importRow.findMany({
    where: { batchId, rowNumber: { in: pedidas } },
    select: { rowNumber: true, lookupStatus: true, researchStatus: true, researchAt: true, researchJson: true },
  });
  if (rows.length === 0) return { ok: false, error: "Nenhuma das contas selecionadas existe neste lote." };
  const elegiveis = rows.filter((r) => r.lookupStatus === "ENRIQUECIDO");
  const naoElegiveis = rows.length - elegiveis.length;
  if (elegiveis.length === 0) {
    return { ok: false, error: "As contas selecionadas ainda não têm dados públicos prontos — conclua a identificação e a consulta primeiro." };
  }

  const { raw: existingRaw, state: existing } = await readQueueRaw(batchId);
  const novas = elegiveis.map((r) => r.rowNumber);
  let state: ResearchQueueState;
  if (existing && (existing.estado === "RODANDO" || existing.estado === "PAUSADA" || existing.estado === "PARADA")) {
    // fila viva: acrescenta as NOVAS contas (não presentes na lista) ao final —
    // o que já passou da posição NÃO é reprocessado, e as pendentes continuam.
    const jaNaFila = new Set(existing.rowNumbers);
    const adicionadas = novas.filter((n) => !jaNaFila.has(n));
    state = {
      ...existing,
      rowNumbers: [...existing.rowNumbers, ...adicionadas],
      estado: "RODANDO",
      modoPesquisa: modo, // modo da última seleção vence (auditoria registra a troca)
      motivoPausa: null,
      heartbeat: new Date().toISOString(),
      // `dono` NÃO muda aqui: se a fila já roda, quem está executando continua dono.
      // O executor vivo descobre as novas contas pelo tamanho de rowNumbers.
    };
  } else {
    // fila nova (ou anterior CONCLUIDA): contadores zerados, ordem da planilha.
    // `puladas` começa em 0 e é contado pelo executor: pré-carregar o número de pacotes
    // frescos contava a mesma linha duas vezes (ao iniciar e de novo ao pular).
    state = {
      rowNumbers: novas,
      estado: "RODANDO",
      modoPesquisa: modo,
      posicao: 0,
      motivoPausa: null,
      solicitadoEm: new Date().toISOString(),
      heartbeat: new Date().toISOString(),
      concluidas: 0,
      puladas: 0,
      falhas: 0,
      dono: null,
    };
  }
  // CAS: se o executor avançou entre a leitura e aqui, o pedido do operador não pode
  // sobrescrever o progresso — relê e reaplica a intenção sobre o estado atual.
  if (!(await casQueue(batchId, existingRaw, state))) {
    return startResearchQueue(batchId, rowNumbersInput, modo);
  }
  await recordAudit(batchId, "RESEARCH_QUEUE_START", {
    contas: state.rowNumbers.length,
    novas: novas.length,
    modo_pesquisa: modo,
    selecao: novas.slice(0, 20).join(",") + (novas.length > 20 ? "…" : ""),
  }).catch(() => {});
  if (!researchQueueRunners.has(batchId)) void runResearchQueue(batchId);
  return { ok: true, enfileiradas: state.rowNumbers.length, naoElegiveis, estado: state };
}

/** Interrompe a fila SEM perder o trabalho concluído (as pendentes ficam pendentes). */
export async function stopResearchQueue(batchId: string): Promise<{ ok: boolean; error?: string; estado?: ResearchQueueState }> {
  const { raw, state } = await readQueueRaw(batchId);
  if (!state || raw === null) return { ok: false, error: "Nenhuma fila de pesquisa ativa neste lote." };
  if (state.estado !== "RODANDO") return { ok: true, estado: state };
  const novo: ResearchQueueState = {
    ...state,
    estado: "PARADA",
    motivoPausa: "Interrompida pelo operador — as contas já pesquisadas mantêm o dossiê; as restantes continuam na fila para retomada.",
    heartbeat: new Date().toISOString(),
    dono: null,
  };
  // CAS: se o executor gravou (posicao/heartbeat) entre a leitura e aqui, o editor relê
  // em vez de sobrescrever um avanço. A parada é intenção do operador: tenta de novo.
  if (!(await casQueue(batchId, raw, novo))) {
    return stopResearchQueue(batchId);
  }
  await recordAudit(batchId, "RESEARCH_QUEUE_STOP", { posicao: state.posicao, total: state.rowNumbers.length }).catch(() => {});
  return { ok: true, estado: novo };
}

/** Retomada manual: processa as pendências sem repetir o que já produziu evidência válida. */
export async function resumeResearchQueue(batchId: string): Promise<{ ok: boolean; error?: string; estado?: ResearchQueueState }> {
  const { raw, state } = await readQueueRaw(batchId);
  if (!state || raw === null) return { ok: false, error: "Nenhuma fila de pesquisa neste lote." };
  if (state.estado === "RODANDO") return { ok: true, estado: state };
  if (state.posicao >= state.rowNumbers.length) {
    const concluida: ResearchQueueState = { ...state, estado: "CONCLUIDA", heartbeat: new Date().toISOString() };
    if (!(await casQueue(batchId, raw, concluida))) return resumeResearchQueue(batchId);
    return { ok: true, estado: concluida };
  }
  const novo: ResearchQueueState = { ...state, estado: "RODANDO", motivoPausa: null, heartbeat: new Date().toISOString(), dono: null };
  if (!(await casQueue(batchId, raw, novo))) return resumeResearchQueue(batchId);
  await recordAudit(batchId, "RESEARCH_QUEUE_RESUME", { posicao: novo.posicao, total: novo.rowNumbers.length }).catch(() => {});
  if (!researchQueueRunners.has(batchId)) void runResearchQueue(batchId);
  return { ok: true, estado: novo };
}

/** Executor da fila: UMA conta por vez (controle de cota honesto), checando a fila entre contas.
 *  `claimed` é o estado que ESTE executor ganhou por CAS; sem ele, busca o claim.
 *  `claimedRaw` é a string exata gravada no claim — sem ela, o CAS do claim corrente falha. */
async function runResearchQueue(batchId: string, claimed?: ResearchQueueState, claimedRaw?: string): Promise<void> {
  researchQueueRunners.add(batchId);
  let state = claimed ?? null;
  // A string exata que ESTE executor gravou por último: é ela que o próximo CAS espera.
  let owned = state ? (claimedRaw ?? serializeQueue(state)) : null;

  // Heartbeat do dono: renova a posse sem mexer em posicao/contadores. Se outro assumiu
  // (heartbeat velho + CAS alheio), o CAS falha e o executor para sem duplicar trabalho.
  const beats = setInterval(() => {
    if (!state || owned === null) return;
    const snapshot = state;
    const expected = owned;
    const beatState: ResearchQueueState = { ...snapshot, heartbeat: new Date().toISOString() };
    // Aborta se o estado local avançou (novo owned) OU o run já recomeçou sem posse.
    const stillOwner = () => state === snapshot && owned === expected;
    void casQueue(batchId, expected, beatState)
      .then((ok) => {
        if (!stillOwner()) return;
        if (ok) {
          // A batida virou a string atual do banco: o próximo CAS do laço espera por ela.
          state = beatState;
          owned = serializeQueue(beatState);
          return;
        }
        // Falha sem avanço local significa que outro executor assumiu: este run encerra.
        state = { ...snapshot, estado: "PARADA" } as ResearchQueueState;
      })
      .catch(() => {});
  }, Q_OWNER_RENEW_MS);

  try {
    for (;;) {
      if (!state || owned === null) {
        // Sem claim (chamada de iniciar/retomar em outro processo): tenta assumir.
        const fresh = await readQueueRaw(batchId);
        if (!fresh.state || fresh.raw === null) break;
        if (!mayClaimQueue(fresh.state, QUEUE_EXECUTOR_ID, Date.now(), Q_HEARTBEAT_STALE_MS)) break;
        const next: ResearchQueueState = { ...fresh.state, dono: QUEUE_EXECUTOR_ID, heartbeat: new Date().toISOString() };
        if (!(await casQueue(batchId, fresh.raw, next))) continue; // perdeu a corrida — relê
        state = next;
        owned = serializeQueue(next);
      }
      if (state.estado !== "RODANDO") break;
      if (state.dono !== QUEUE_EXECUTOR_ID) break; // lease de fila perdido (heartbeat ou CAS alheio)
      // Relê entre contas: o operador pode ter ACRESCENTADO contas à fila viva
      // (startResearchQueue) e o heartbeat pode ter avançado a string. Adota o que
      // está no banco desde que a posse continue sendo deste executor.
      {
        const fresh = await readQueueRaw(batchId);
        if (!fresh.state || fresh.raw === null) break;
        if (fresh.state.dono !== QUEUE_EXECUTOR_ID) { state = null; owned = null; continue; }
        if (fresh.raw !== owned) {
          state = fresh.state;
          owned = fresh.raw;
        }
      }
      if (state.posicao >= state.rowNumbers.length) {
        const done: ResearchQueueState = { ...state, estado: "CONCLUIDA", heartbeat: new Date().toISOString() };
        if (!(await casQueue(batchId, owned, done))) {
          // Alguém acrescentou contas ou gravou entre a releitura e aqui: relê e segue.
          state = null;
          owned = null;
          continue;
        }
        state = done;
        owned = serializeQueue(done);
        await recordAudit(batchId, "RESEARCH_QUEUE_DONE", { concluidas: done.concluidas, puladas: done.puladas, falhas: done.falhas }).catch(() => {});
        break;
      }
      const rowNumber = state.rowNumbers[state.posicao];
      const row = await db.importRow.findFirst({ where: { batchId, rowNumber } });
      const skip = async (motivo: string) => {
        void recordAudit(batchId, "RESEARCH_QUEUE_SKIP", { linha: rowNumber, motivo }, rowNumber).catch(() => {});
        const next: ResearchQueueState = {
          ...state!,
          puladas: state!.puladas + 1,
          posicao: state!.posicao + 1,
          heartbeat: new Date().toISOString(),
        };
        // CAS: se outro executor mexeu no estado entre a leitura e aqui, este run perde
        // a posse e relê — a linha pulada fica para quem é dono agora.
        if (await casQueue(batchId, owned, next)) {
          state = next;
          owned = serializeQueue(next);
        } else {
          state = null;
          owned = null;
        }
      };
      if (!row) { await skip("linha não existe mais"); continue; }
      if (row.lookupStatus !== "ENRIQUECIDO") { await skip("sem dados públicos prontos"); continue; }
      if (packetFresco(row)) { await skip("já tem dossiê fresco — nenhuma chamada repetida"); continue; }
      if (deepLocks.has(row.id) || row.aiStatus === "EM_FILA" || row.aiStatus === "GERANDO") { await skip("execução já em andamento"); continue; }

      deepLocks.add(row.id);
      try {
        await runDeepResearch(batchId, row.id, state.modoPesquisa ?? "COMPLETO");
      } catch {
        // runDeepResearch já registra FALHOU + telemetria internamente — defesa extra
      } finally {
        deepLocks.delete(row.id);
      }

      const after = await db.importRow.findFirst({
        where: { batchId, rowNumber },
        select: { researchStatus: true, researchError: true, researchJson: true },
      });
      // coleta com recusa de cota também é LIMITE ATINGIDO (contrato): o pacote salva
      // honesto (OK + buscasRecusadasCota>0) mas a fila NÃO segue adiante procurando
      // evidência com a cota esgotada — pausa para retomada manual.
      let recusadasNaColeta = 0;
      if (after?.researchJson) {
        try {
          recusadasNaColeta = (JSON.parse(after.researchJson) as { buscasRecusadasCota?: number }).buscasRecusadasCota ?? 0;
        } catch {
          recusadasNaColeta = 0;
        }
      }
      const base: ResearchQueueState = {
        ...state,
        posicao: state.posicao + 1,
        heartbeat: new Date().toISOString(),
      };
      if (after?.researchStatus === "FALHOU") {
        base.falhas += 1;
        if (/429|too many|cota|limite/i.test(after.researchError ?? "")) {
          // contrato: 429/cota mantém estado honesto e exige retomada MANUAL
          const pausada: ResearchQueueState = {
            ...base,
            estado: "PAUSADA",
            motivoPausa: `Cota de pesquisa recusada pelo gateway (linha ${rowNumber}) — contas concluídas mantêm o dossiê. Retome manualmente quando a cota voltar.`,
          };
          if (await casQueue(batchId, owned, pausada)) { state = pausada; owned = serializeQueue(pausada); }
          await recordAudit(batchId, "RESEARCH_QUEUE_PAUSED", { motivo: "cota_429", linha: rowNumber }, rowNumber).catch(() => {});
          break;
        }
      } else if (recusadasNaColeta > 0) {
        const pausada: ResearchQueueState = {
          ...base,
          estado: "PAUSADA",
          motivoPausa: `Cota de busca esgotada durante a coleta (linha ${rowNumber}: ${plural(recusadasNaColeta, "busca recusada", "buscas recusadas")}) — pacote salvo com PESQUISA INCOMPLETA (nunca conclusivo). Retome manualmente quando a cota voltar.`,
        };
        if (await casQueue(batchId, owned, pausada)) { state = pausada; owned = serializeQueue(pausada); }
        await recordAudit(batchId, "RESEARCH_QUEUE_PAUSED", { motivo: "cota_parcial", linha: rowNumber, recusadas: recusadasNaColeta }, rowNumber).catch(() => {});
        break;
      } else if (after?.researchStatus === "OK") {
        base.concluidas += 1;
      }
      if (await casQueue(batchId, owned, base)) {
        state = base;
        owned = serializeQueue(base);
      } else {
        // Outro executor assumiu durante a conta: ele é o dono agora. Encerra sem gravar.
        state = null;
        owned = null;
      }
    }
  } finally {
    clearInterval(beats);
    researchQueueRunners.delete(batchId);
  }
}

/** Fila RODANDO sem heartbeat há > 3 min (restart do servidor) → religa SEM repetir chamadas
 *  (o executor pula contas com pacote fresco). Chamada pelo sweepStalled (não é cron). */
async function reviveStalledResearchQueues(): Promise<void> {
  const batches = await db.importBatch.findMany({
    where: { researchQueueJson: { not: null } },
    // A decisão de retomar é do claimOrphanQueue (estado + dono + heartbeat velho, com
    // CAS). Aqui só se pula quem JÁ tem executor neste processo.
    select: { id: true },
    take: 50,
  });
  for (const b of batches) {
    if (researchQueueRunners.has(b.id)) continue;
    const claimed = await claimOrphanQueue(b.id);
    if (!claimed) continue;
    await recordAudit(b.id, "RESEARCH_QUEUE_REVIVE", { motivo: "heartbeat expirado (restart)", dono: QUEUE_EXECUTOR_ID }).catch(() => {});
    void runResearchQueue(b.id, claimed.state, claimed.raw);
  }
}

async function runDeepResearch(batchId: string, rowId: string, modo: ModoPesquisa = "COMPLETO") {
  const row0 = await db.importRow.findUnique({ where: { id: rowId } });
  if (!row0) return;
  // wrapper de telemetria: a pesquisa inteira (pacote + síntese) é UMA unidade correlacionada
  return runWithTelemetry(
    {
      runId: newRunId(),
      batchId,
      rowId,
      rowNumber: row0.rowNumber,
      empresa: row0.legalName ?? row0.referenceValue ?? null,
      cnpj: row0.normalizedCnpj || null,
      etapa: "PESQUISA_PROFUNDA",
      startedAt: Date.now(),
    },
    () => runDeepResearchInner(batchId, rowId, modo)
  );
}

async function runDeepResearchInner(batchId: string, rowId: string, modo: ModoPesquisa = "COMPLETO") {
  const row = await db.importRow.findUnique({ where: { id: rowId } });
  if (!row) return;
  const { rowNumber } = row;
  const tTotal = Date.now();

  await db.importRow.update({
    where: { id: rowId },
    // researchAt também sela o INÍCIO da pesquisa (lease/heartbeat de recuperação — P0-07):
    // a varredura de órfãs usa "GERANDO + researchAt velho" para achar execuções perdidas.
    data: { researchStatus: "GERANDO", researchError: null, researchAt: new Date() },
  });
  await recordAudit(batchId, "DEEP_RESEARCH_START", { cnpj: formatCnpj(row.normalizedCnpj), modo_pesquisa: modo }, rowNumber);

  /* -------- etapa 1: pacote de pesquisa — reusa o salvo quando fresco E COMPLETO --------
   * G5 (auditoria v0.6.1): pacote marcado com buscasRecusadasCota > 0 é COLETA INCOMPLETA —
   * reusá-lo preservaria o buraco de evidências para sempre (o “Pesquisar de novo” não
   * pesquisaria nada). Recusa por cota => coleta nova quando o pedido é de PESQUISA.
   * (Refazer SÓ a síntese continua reaproveitando o pacote — rota retry-ai.)
   */
  let packet: ResearchPacket;
  let pacoteMs = 0;
  const existing = row.researchJson ? safeParseJsonObject<ResearchPacket>(row.researchJson) : null;
  const researchAgeMs = row.researchAt ? Date.now() - new Date(row.researchAt).getTime() : Number.MAX_SAFE_INTEGER;
  const recusadasNoSalvo = existing?.buscasRecusadasCota ?? 0;
  if (existing && existing.siteOficial && existing.instrumentacao && recusadasNoSalvo === 0 && researchAgeMs < 24 * 3600 * 1000) {
    // guardas acima validam os campos críticos do pacote salvo — o JSON persistido
    // vem do próprio buildResearchPacket, logo o resto do contrato está intacto.
    packet = existing as ResearchPacket;
    packet.instrumentacao.usouCache = true;
    pacoteMs = 0; // pacote reutilizado — nova pesquisa não executada
    await recordAudit(batchId, "DEEP_RESEARCH_CACHE", {
      cnpj: formatCnpj(row.normalizedCnpj),
      gerado_em: packet.geradoEm,
      estrategia: packet.estrategia ?? null,
    }, rowNumber);
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "PESQUISA_PROFUNDA",
      operacao: "cache_entre_lotes",
      cacheHit: true,
      estadoFinal: "sucesso",
      duracaoMs: 0,
      payload: { gerado_em: packet.geradoEm, estrategia: packet.estrategia ?? null },
    });
  } else if (existing && recusadasNoSalvo > 0) {
    await recordAudit(batchId, "DEEP_RESEARCH_CACHE_SKIP", {
      cnpj: formatCnpj(row.normalizedCnpj),
      motivo: `pacote salvo tem ${plural(recusadasNoSalvo, "busca recusada", "buscas recusadas")} por cota — coleta nova obrigatória`,
    }, rowNumber);
    const t0 = Date.now();
    try {
      packet = await buildResearchPacket({
        normalizedCnpj: row.normalizedCnpj,
        legalName: row.legalName,
        tradeName: row.tradeName,
        municipality: row.municipality,
        uf: row.uf,
        email: safeParseJsonObject<Partial<CnpjExtra>>(row.extraJson).email ?? null,
        referenceValue: row.referenceValue,
        cnaeDescription: row.cnaeDescription,
        socios: safeParseJsonArray<CnpjSocio>(row.sociosJson),
      }, modo);
    } catch (err) {
      const internal = err instanceof Error ? err.message : String(err);
      await db.importRow.update({
        where: { id: rowId },
        data: { researchStatus: "FALHOU", researchError: "Não conseguimos pesquisar as fontes públicas agora. Tente novamente.", researchAt: new Date() },
      });
      await recordAudit(batchId, "DEEP_RESEARCH_FAIL", { etapa: "pacote", motivo: internal.slice(0, 300) }, rowNumber);
      recordTelemetry({
        tipo: "ETAPA",
        etapa: "PESQUISA_PROFUNDA",
        estadoFinal: "falha",
        duracaoMs: Date.now() - tTotal,
        erro: internal.slice(0, 300),
        payload: { etapa_falha: "pacote", cnpj: formatCnpj(row.normalizedCnpj) },
      });
      return;
    }
    pacoteMs = Date.now() - t0;
    packet.instrumentacao = { ...packet.instrumentacao, usouCache: false };
  } else {
    const t0 = Date.now();
    try {
      packet = await buildResearchPacket({
        normalizedCnpj: row.normalizedCnpj,
        legalName: row.legalName,
        tradeName: row.tradeName,
        municipality: row.municipality,
        uf: row.uf,
        email: safeParseJsonObject<Partial<CnpjExtra>>(row.extraJson).email ?? null,
        referenceValue: row.referenceValue,
        cnaeDescription: row.cnaeDescription,
        socios: safeParseJsonArray<CnpjSocio>(row.sociosJson),
      }, modo);
    } catch (err) {
      const internal = err instanceof Error ? err.message : String(err);
      await db.importRow.update({
        where: { id: rowId },
        data: { researchStatus: "FALHOU", researchError: "Não conseguimos pesquisar as fontes públicas agora. Tente novamente.", researchAt: new Date() },
      });
      await recordAudit(batchId, "DEEP_RESEARCH_FAIL", { etapa: "pacote", motivo: internal.slice(0, 300) }, rowNumber);
      recordTelemetry({
        tipo: "ETAPA",
        etapa: "PESQUISA_PROFUNDA",
        estadoFinal: "falha",
        duracaoMs: Date.now() - tTotal,
        erro: internal.slice(0, 300),
        payload: { etapa_falha: "pacote", cnpj: formatCnpj(row.normalizedCnpj) },
      });
      return;
    }
    pacoteMs = Date.now() - t0;
    packet.instrumentacao = { ...packet.instrumentacao, usouCache: false };
  }
  await db.importRow.update({
    where: { id: rowId },
    data: {
      researchJson: JSON.stringify(packet),
      researchStatus: "OK",
      researchAt: new Date(),
      researchError: null,
    },
  });
  await recordAudit(batchId, "DEEP_RESEARCH_PACKET", {
    cnpj: formatCnpj(row.normalizedCnpj),
    estrategia: packet.estrategia,
    dominio: packet.siteOficial.dominio,
    paginas_lidas: packet.paginasOk,
    paginas_tentadas: packet.paginasTentadas,
    buscas_com_resultado: packet.buscasOk,
    noticias: packet.noticias.length,
    sinais_porte: packet.sinaisPorte.length,
    sinais_identidade: packet.sinaisIdentidade?.length ?? 0,
    sinais_tecnologia: packet.sinaisTecnologia?.length ?? 0,
    sinais_comerciais: packet.sinaisComerciais?.length ?? 0,
    fontes_rejeitadas: packet.fontesRejeitadas?.length ?? 0,
    instrumentacao: packet.instrumentacao,
    tempo_pacote_ms: pacoteMs || undefined,
  }, rowNumber);

  /* -------- etapa 2: síntese profunda com o modelo de dossiê -------- */
  await db.importRow.update({ where: { id: rowId }, data: { aiStatus: "GERANDO", aiError: null } });
  const tSintese = Date.now();

  // teia societária + fatos extras + resumo da resolução (mesma montagem da leitura de lote)
  const socios = safeParseJsonArray<CnpjSocio>(row.sociosJson);
  const extra = safeParseJsonObject<Partial<CnpjExtra>>(row.extraJson);
  const resolutionRaw = safeParseJsonObject<{ metodo?: string[]; candidatos?: { cnpj: string; sinais?: string[]; contradicoes?: string[]; fontes?: { fonte: string; url: string | null }[] }[] }>(row.resolutionJson);
  const chosen = resolutionRaw.candidatos?.find((c) => c.cnpj === row.normalizedCnpj) ?? null;
  const resolutionSummary = row.resolutionState
    ? {
        estado: row.resolutionState,
        confianca: row.resolutionConfidence,
        metodo: (resolutionRaw.metodo ?? []).slice(0, 6),
        // mesmo filtro da leitura de lote — e MESMO bloco que a comparação externa do
        // laboratório reconstrói (buildInputFromRow): comparabilidade A/B byte-a-byte.
        sinais: (chosen?.sinais ?? []).filter((s) => !/^situação cadastral confirmada/i.test(s)).slice(0, 5),
        contradicoes: (chosen?.contradicoes ?? []).slice(0, 5),
        fontes: (chosen?.fontes ?? []).slice(0, 4).map((f) => f.fonte + (f.url ? ` (${f.url})` : "")),
      }
    : null;
  const matrizDiferente = row.headquartersCnpj && row.headquartersCnpj !== row.normalizedCnpj;
  const input: AccountAiInput = {
    normalizedCnpj: row.normalizedCnpj,
    legalName: row.legalName,
    tradeName: row.tradeName,
    cnaeDescription: row.cnaeDescription,
    municipality: row.municipality,
    uf: row.uf,
    branchType: row.branchType,
    registrationStatus: row.registrationStatus,
    openingDate: row.openingDate,
    socios,
    extra,
    referenceDomain: row.referenceValue,
    branchIdentifier: row.branchIdentifier,
    headquartersCnpj: matrizDiferente ? row.headquartersCnpj : null,
    matrizStatus: row.matrizStatus,
    resolution: resolutionSummary,
    research: toModelInput(packet),
  };
  // Rastreabilidade A/B: o hash é do prompt EXATAMENTE como vai ao modelo —
  // reconciliável com LabComparison.evidenceHash/systemPromptSha (veredito na UI).
  const abHashes = {
    dossierEvidenceSha: sha256Hex(buildUserMessage(input)),
    dossierSystemSha: sha256Hex(SYSTEM_PROMPT_DEEP),
    dossierPromptVersion: PROMPT_VERSION,
    dossierTemperature: DOSSIER_TEMPERATURE,
  } as const;
  await recordAudit(batchId, "AI_START", {
    cnpj: formatCnpj(row.normalizedCnpj),
    modo: "pesquisa_profunda",
    com_teia: socios.length > 0,
    com_pacote_pesquisa: true,
  }, rowNumber);
  try {
    const res = await generateAccountIntelligence(input);
    await db.importRow.update({
      where: { id: rowId },
      data: {
        aiStatus: "OK",
        aiReading: res.reading,
        aiSector: res.sector,
        aiSize: res.size,
        aiProfile: res.profile,
        aiHypothesesJson: JSON.stringify(res.hypotheses),
        aiDossierJson: JSON.stringify(res.dossier),
        aiModel: res.model,
        aiModelRequested: res.modelRequested,
        ...abHashes,
        aiProcessedAt: new Date(),
        aiError: null,
      },
    });
    await recordAudit(batchId, "AI_OK", {
      cnpj: formatCnpj(row.normalizedCnpj),
      modo: "pesquisa_profunda",
      modelo: res.model,
      modelo_solicitado: res.modelRequested,
      fallback: res.modelFallback,
      tokens_prompt: res.dossier.tokens?.prompt ?? null,
      tokens_completion: res.dossier.tokens?.completion ?? null,
      tokens_total: res.dossier.tokens?.total ?? null,
      tempo_sintese_ms: Date.now() - tSintese,
      evidencias: res.dossier.evidencias?.length ?? 0,
      entidade_escopo: res.dossier.entidadeEscopo ?? null,
      timestamp: new Date().toISOString(),
    }, rowNumber);
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "PESQUISA_PROFUNDA",
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - tTotal,
      modeloEfetivo: res.model,
      modeloSolicitado: res.modelRequested,
      tokens: res.dossier.tokens ?? null,
      payload: {
        estrategia: packet.estrategia ?? null,
        tempo_pacote_ms: pacoteMs || undefined,
        usou_cache_pacote: !!packet.instrumentacao?.usouCache,
        buscas: packet.buscasOk,
        paginas: packet.paginasOk,
        buscas_recusadas_cota: packet.buscasRecusadasCota ?? 0,
      },
    });
  } catch (err) {
    const friendly = err instanceof AiUnavailableError ? err.friendly : "A IA não conseguiu gerar a leitura desta conta agora. Você pode tentar novamente em instantes.";
    const internal = err instanceof Error ? err.message : String(err);
    // o pacote continua salvo — a próxima tentativa reusa a pesquisa e só refaz a síntese
    await db.importRow.update({
      where: { id: rowId },
      data: { aiStatus: "FALHOU", aiError: friendly, aiProcessedAt: new Date() },
    });
    await recordAudit(batchId, "AI_FAIL", {
      cnpj: formatCnpj(row.normalizedCnpj),
      modo: "pesquisa_profunda",
      motivo: internal.slice(0, 300),
    }, rowNumber);
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "PESQUISA_PROFUNDA",
      estadoFinal: /429|too many/i.test(internal) ? "bloqueado" : "falha",
      duracaoMs: Date.now() - tTotal,
      erro: internal.slice(0, 300),
      payload: {
        etapa_falha: "sintese",
        // o pacote continua salvo — retry-ai refaz SÓ a síntese (G5)
        pacote_salvo: true,
        estrategia: packet.estrategia ?? null,
        tempo_pacote_ms: pacoteMs || undefined,
      },
    });
  }
}

/**
 * Resumo executivo do LOTE via IA (1 chamada rate-limitada, cacheada no lote).
 * Só usa dados agregados já presentes no banco (setores/UFs das leituras OK).
 */
export async function generateBatchSummaryFor(batchId: string): Promise<{ ok: boolean; error?: string }> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, error: "Lote não encontrado." };
  if (!batch.aiEnabled) return { ok: false, error: "Este lote foi processado sem IA. Gere uma leitura de conta para habilitar o resumo." };
  return runWithTelemetry(
    {
      runId: newRunId(),
      batchId,
      rowId: null,
      rowNumber: null,
      empresa: null,
      cnpj: null,
      etapa: "RESUMO_LOTE",
      startedAt: Date.now(),
    },
    () => generateBatchSummaryInner(batchId, batch.rowCount, batch.totalEnriched)
  );
}

async function generateBatchSummaryInner(batchId: string, rowCount: number, totalEnriched: number): Promise<{ ok: boolean; error?: string }> {
  const tResumo = Date.now();
  const rows = await db.importRow.findMany({
    where: { batchId, lookupStatus: "ENRIQUECIDO", aiStatus: "OK", aiReading: { not: null } },
    select: { legalName: true, aiSector: true, aiSize: true, uf: true, municipality: true },
  });
  if (rows.length < 2) {
    return { ok: false, error: "O resumo do lote precisa de pelo menos 2 contas com leitura pronta." };
  }

  const bySector = new Map<string, number>();
  const byUf = new Map<string, number>();
  for (const r of rows) {
    const setor = (r.aiSector ?? "").trim();
    if (setor) bySector.set(setor, (bySector.get(setor) ?? 0) + 1);
    if (r.uf) byUf.set(r.uf, (byUf.get(r.uf) ?? 0) + 1);
  }
  const setores = [...bySector.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([setor, contas]) => ({ setor, contas }));
  const ufs = [...byUf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([uf, contas]) => ({ uf, contas }));
  const amostra = rows.slice(0, 20).map((r) => ({ nome: r.legalName ?? "", setor: r.aiSector ?? "", uf: r.uf ?? "" }));
  const semDados = await db.importRow.count({ where: { batchId, lookupStatus: { in: ["NAO_ENCONTRADO", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"] } } });

  await recordAudit(batchId, "AI_SUMMARY_START", { contas: rows.length });
  try {
    const res = await generateBatchSummary({
      totalLinhas: rowCount,
      contasEnriquecidas: totalEnriched,
      contasComLeitura: rows.length,
      setores,
      ufs,
      amostra,
      semDados,
    });
    await db.importBatch.update({
      where: { id: batchId },
      data: {
        aiSummary: JSON.stringify({ resumo_executivo: res.resumoExecutivo, destaques: res.destaques, prioridades: res.prioridades, modelo: res.model }),
        aiSummaryAt: new Date(),
      },
    });
    await recordAudit(batchId, "AI_SUMMARY_OK", { modelo: res.model });
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "RESUMO_LOTE",
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - tResumo,
      modeloEfetivo: res.model,
      payload: { contas_com_leitura: rows.length },
    });
    return { ok: true };
  } catch (err) {
    const internal = err instanceof Error ? err.message : String(err);
    const friendly = err instanceof AiUnavailableError ? err.friendly : "A IA não conseguiu gerar o resumo do lote agora. Tente novamente em instantes.";
    await recordAudit(batchId, "AI_SUMMARY_FAIL", { motivo: internal.slice(0, 300) });
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "RESUMO_LOTE",
      estadoFinal: /429|too many/i.test(internal) ? "bloqueado" : "falha",
      duracaoMs: Date.now() - tResumo,
      erro: internal.slice(0, 300),
    });
    return { ok: false, error: friendly };
  }
}

/* ------------------------------ Contadores ------------------------------ */

export async function recomputeCounters(batchId: string) {
  const [enriched, pending, invalid, duplicate, reference, resolved, valid, aiTotal, aiDone, aiFailed, confirmed, review, unresolved, localizado, validado] = await Promise.all([
    db.importRow.count({ where: { batchId, lookupStatus: "ENRIQUECIDO" } }),
    db.importRow.count({
      where: { batchId, cnpjStatus: { in: ["VALIDA", "REFERENCIA"] }, lookupStatus: { notIn: ["ENRIQUECIDO", "NAO_ENCONTRADO"] } },
    }),
    db.importRow.count({ where: { batchId, cnpjStatus: { in: ["INVALIDA", "SEM_CNPJ"] } } }),
    db.importRow.count({ where: { batchId, cnpjStatus: "DUPLICADA" } }),
    db.importRow.count({ where: { batchId, cnpjStatus: "REFERENCIA" } }),
    db.importRow.count({ where: { batchId, cnpjStatus: "REFERENCIA", resolvedCnpj: { not: null } } }),
    db.importRow.count({ where: { batchId, cnpjStatus: "VALIDA" } }),
    db.importRow.count({ where: { batchId, aiStatus: { not: null } } }),
    db.importRow.count({ where: { batchId, aiStatus: "OK" } }),
    db.importRow.count({ where: { batchId, aiStatus: "FALHOU" } }),
    db.importRow.count({ where: { batchId, resolutionState: "CONFIRMED" } }),
    // v0.10.14 (reconciliação): "Para revisão" = o MESMO conjunto que a tabela marca
    // como "Revisar" — decisão pendente (REVIEW) OU registro localizado divergente
    // (identityStage LOCALIZADO com ficha coletada). Antes contava só resolutionState
    // REVIEW: 6 linhas pediam revisão na tabela e o resumo exibia zero.
    db.importRow.count({
      where: {
        batchId,
        OR: [
          { resolutionState: "REVIEW" },
          { identityStage: "LOCALIZADO", lookupStatus: "ENRIQUECIDO" },
        ],
      },
    }),
    db.importRow.count({ where: { batchId, resolutionState: "UNRESOLVED" } }),
    // v0.10.12: estágio de confiança da identidade
    db.importRow.count({ where: { batchId, identityStage: "LOCALIZADO" } }),
    db.importRow.count({ where: { batchId, identityStage: "VALIDADO" } }),
  ]);
  await db.importBatch.update({
    where: { id: batchId },
    data: {
      totalValid: valid, totalInvalid: invalid, totalDuplicate: duplicate,
      totalReference: reference, totalResolved: resolved,
      totalEnriched: enriched, totalPending: pending,
      aiTotal, aiDone, aiFailed,
      totalConfirmed: confirmed, totalReview: review, totalUnresolved: unresolved,
      totalLocalizado: localizado, totalValidado: validado,
    },
  });
}

/* ------------------------------ Recuperação (stale sweep) ------------------------------ *
 * G1/P0-02 (auditoria v0.6.0): INTENÇÃO HUMANA é lei.
 *  - Lote CONFIRMED que o humano NUNCA iniciou jamais é iniciado por cron/tick/GET —
 *    permanece CONFIRMED até o clique em “Iniciar agora” (comando explícito e idempotente).
 *    (O auto-start antigo “RECOVERY_START_CONFIRMED” após 30s FOI REMOVIDO.)
 *  - Lote PROCESSING sem lock em memória = execução perdida (restart/HMR): o trabalho
 *    já foi autorizado por humano — retomar é RECUPERAÇÃO, feita com LEASE ATÔMICO no
 *    banco (P0-07: em N chamadas simultâneas, só uma retoma) + recuperação de linhas órfãs.
 */

/** Linhas órfãs de execução morta voltam a estados honestos e reenfileiráveis.
 *  G6 (auditoria v0.6.1): só é chamada quando o chamador JÁ detém o lease do lote
 *  (claim atômico venceu) — nunca toca nas linhas de um worker vivo.
 *  Cinto + suspensório: linha GERANDO com researchAt recente (< 120s) também é
 *  poupada — protege execuções que acabaram de começar em outro processo legado.
 */
async function recoverOrphanRows(batchId: string): Promise<void> {
  // síntese rápida GERANDO sem executor → volta pra fila (runBatch reprocessa EM_FILA)
  await db.importRow.updateMany({
    where: { batchId, aiStatus: "GERANDO", researchStatus: null },
    data: { aiStatus: "EM_FILA" },
  });
  await db.importRow.updateMany({
    where: { batchId, aiStatus: "GERANDO", researchStatus: "FALHOU" },
    data: { aiStatus: "EM_FILA" },
  });
  // pesquisa profunda GERANDO sem executor → FALHOU honesto (o pacote não chegou a ser
  // salvo; reexecutar sem consentimento repetiria o custo de busca — a UI oferece reexecute)
  const deepOrfas = await db.importRow.findMany({
    where: {
      batchId,
      researchStatus: "GERANDO",
      // idade mínima: se a pesquisa começou agora, NÃO é órfã (G6 — “sem falso órfão”)
      OR: [{ researchAt: null }, { researchAt: { lt: new Date(Date.now() - 120_000) } }],
    },
    select: { id: true, rowNumber: true, aiStatus: true },
  });
  for (const r of deepOrfas) {
    await db.importRow.update({
      where: { id: r.id },
      data: {
        researchStatus: "FALHOU",
        researchError: "Pesquisa interrompida por reinício do servidor — reexecute para concluir.",
        aiStatus: r.aiStatus === "OK" ? "OK" : "FALHOU",
        aiError: r.aiStatus === "OK" ? null : "Pesquisa interrompida antes da síntese — reexecute a pesquisa desta conta.",
      },
    });
    await recordAudit(batchId, "DEEP_RESEARCH_ORPHAN", { motivo: "execução perdida (restart/HMR)" }, r.rowNumber).catch(() => {});
  }
}

export async function sweepStalled(): Promise<{ resumed: string[] }> {
  const resumed: string[] = [];
  const now = Date.now();
  const processing = await db.importBatch.findMany({ where: { status: "PROCESSING" } });
  for (const b of processing) {
    if (locks.has(b.id)) continue; // este processo está com o lote AGORA
    // G6: lease durável é a verdade entre processos — worker VIVO (heartbeat renovou
    // leaseExpiresAt há menos de LEASE_TTL_MS) JAMAIS é tomado como órfão.
    const leaseVivo = (b.leaseExpiresAt?.getTime() ?? 0) > now;
    if (leaseVivo) continue;
    // Lease expirado (ou inexistente — lote legado): startBatch faz o claim ATÔMICO;
    // em N chamadas simultâneas, só UMA vence e retoma. As outras saem sem tocar.
    const start = await startBatch(b.id);
    if (!start.started) continue;
    resumed.push(b.id);
    await recordAudit(b.id, "RECOVERY_RESUME").catch(() => {});
    await recoverOrphanRows(b.id);
  }

  // Órfãs GLOBAIS fora de lotes ativos (pesquisa/leitura manual interrompida por restart):
  // honestidade primeiro — nada volta a GERANDO sem executor.
  const deepOrfas = await db.importRow.findMany({
    where: {
      researchStatus: "GERANDO",
      researchAt: { lt: new Date(Date.now() - RESEARCH_STALE_MS) },
      batch: { status: { in: ["CONFIRMED", "DONE", "PARTIAL", "FAILED"] } },
    },
    select: { id: true, batchId: true, rowNumber: true, aiStatus: true },
    take: 50,
  });
  for (const r of deepOrfas) {
    await db.importRow.update({
      where: { id: r.id },
      data: {
        researchStatus: "FALHOU",
        researchError: "Pesquisa interrompida por reinício do servidor — reexecute para concluir.",
        aiStatus: r.aiStatus === "OK" ? "OK" : "FALHOU",
        aiError: r.aiStatus === "OK" ? null : "Pesquisa interrompida antes da síntese — reexecute a pesquisa desta conta.",
      },
    });
    await recordAudit(r.batchId, "DEEP_RESEARCH_ORPHAN", { motivo: "execução perdida (restart)" }, r.rowNumber).catch(() => {});
  }

  // Fila de pesquisa por seleção (Mesa de Contas): executor morreu (restart) → religa.
  // Idempotente: contas com pacote fresco são PULADAS, nada é repesquisado.
  await reviveStalledResearchQueues();

  // Leitura pedida por humano (EM_FILA) que ficou para trás em lote encerrado:
  // retomar UMA vez honra a intenção sem despachar trabalho novo (lock evita duplicidade).
  const filasPerdidas = await db.importRow.findMany({
    where: { aiStatus: "EM_FILA", batch: { status: { in: ["DONE", "PARTIAL", "FAILED"] } } },
    select: { batchId: true },
    distinct: ["batchId"],
    take: 10,
  });
  for (const f of filasPerdidas) {
    if (locks.has(f.batchId)) continue;
    await recordAudit(f.batchId, "RECOVERY_RESUME_AI").catch(() => {});
    void startBatch(f.batchId);
  }

  return { resumed };
}

export function isBatchLocked(batchId: string): boolean {
  return locks.has(batchId);
}

/** G6: “em processamento” entre processos = lock em memória OU lease vivo no banco.
 *  Versão async para rotas que não têm o batch em mãos.
 */
export function batchHasLiveLease(batch: { leaseExpiresAt?: Date | null }): boolean {
  return (batch.leaseExpiresAt?.getTime() ?? 0) > Date.now();
}
export async function isBatchLockedAnyWorker(batchId: string): Promise<boolean> {
  if (locks.has(batchId)) return true;
  const b = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { leaseExpiresAt: true },
  });
  return batchHasLiveLease(b ?? {});
}

/* ------------------------------ Helpers JSON seguros ------------------------------ */

function safeParseJsonArray<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) return v as T[];
  } catch {
    /* ignorado — dado de auditoria, não bloqueia o fluxo */
  }
  return [];
}

function safeParseJsonObject<T>(json: string | null): Partial<T> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Partial<T>;
  } catch {
    /* ignorado */
  }
  return {};
}
