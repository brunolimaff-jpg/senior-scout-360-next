/**
 * compare.ts — Lote B: comparação GLM nativo vs. modelo externo com o MESMO
 * pacote de evidências e o MESMO prompt (mesma versão).
 *
 * Regras:
 * - O dossiê experimental NUNCA substitui o oficial: resultado vai para
 *   LabComparison (tabela separada); aiReading/aiDossierJson oficiais ficam intactos.
 * - Nenhuma busca nova acontece aqui: o pacote é REUTILIZADO da pesquisa salva
 *   (researchJson) — 0 chamadas web/leitura (comparabilidade e economia de cota).
 * - Sem fallback: se o provedor externo falhar, o erro é retornado/registrado
 *   como estado visível; o nativo nunca é acionado no lugar.
 * - Telemetria: tipo IA_CHAT com fonte = host externo (distinta do nativo
 *   "z-ai-gateway (via resolve-service)").
 */

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { recordTelemetry } from "@/lib/telemetry";
import { appVersion } from "@/lib/version";
import {
  buildUserMessage,
  DOSSIER_TEMPERATURE,
  parseAiJson,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_DEEP,
  type AccountAiInput,
  type ResearchPacketInput,
} from "@/lib/enrich/ai";
import { toModelInput } from "@/lib/enrich/research";
import type { CnpjExtra, CnpjSocio } from "@/lib/enrich/sources";
import { callExternalChatCompletion, type ExternalAiCallResult } from "@/lib/providers/external-ai";
import { redactKey, type LabConfig } from "@/lib/lab/vault";

type ImportRow = Awaited<ReturnType<typeof db.importRow.findFirst>>;

function safeParseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
function safeParseJsonObject<T>(raw: string | null): T {
  if (!raw) return {} as T;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Reconstrói o AccountAiInput EXATAMENTE como o engine.ts faz na síntese oficial
 * (mesmas fontes: colunas da linha + resolutionJson + researchJson). Assim a
 * mensagem do usuário é byte-a-byte a mesma que o GLM nativo recebeu.
 */
export function buildInputFromRow(row: NonNullable<ImportRow>): AccountAiInput {
  const socios = safeParseJsonArray<CnpjSocio>(row.sociosJson);
  const extra = safeParseJsonObject<Partial<CnpjExtra>>(row.extraJson);
  const resolutionRaw = safeParseJsonObject<{
    metodo?: string[];
    candidatos?: { cnpj: string; sinais?: string[]; contradicoes?: string[]; fontes?: { fonte: string; url: string | null }[] }[];
  }>(row.resolutionJson);
  const chosen = resolutionRaw.candidatos?.find((c) => c.cnpj === row.normalizedCnpj) ?? null;
  const resolutionSummary = row.resolutionState
    ? {
        estado: row.resolutionState,
        confianca: row.resolutionConfidence,
        metodo: (resolutionRaw.metodo ?? []).slice(0, 6),
        sinais: (chosen?.sinais ?? []).filter((s) => !/^situação cadastral confirmada/i.test(s)).slice(0, 5),
        contradicoes: (chosen?.contradicoes ?? []).slice(0, 5),
        fontes: (chosen?.fontes ?? []).slice(0, 4).map((f) => f.fonte + (f.url ? ` (${f.url})` : "")),
      }
    : null;
  const matrizDiferente = row.headquartersCnpj && row.headquartersCnpj !== row.normalizedCnpj;
  const packet = safeParseJsonObject<Record<string, unknown>>(row.researchJson);
  const research: ResearchPacketInput | null =
    row.researchJson && (packet.siteOficial || packet.buscas) ? toModelInput(packet as never) : null;
  return {
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
}

export interface ComparisonOutcome {
  ok: boolean;
  code: string;
  message?: string;
  equivalencia?: Equivalencia;
  comparacao?: {
    id: string;
    provider: string;
    modelRequested: string;
    modelEffective: string | null;
    promptVersion: string;
    evidenceChars: number;
    evidenceHash: string;
    packetReuse: boolean;
    parsedOk: boolean;
    tokens: { prompt: number | null; completion: number | null; total: number | null; informed: boolean } | null;
    durationMs: number;
    httpStatus: number | null;
    estadoFinal: string;
    content: string | null;
    error: string | null;
    createdAt: string;
  };
}

export interface Equivalencia {
  /** EQUIVALENTE | NAO_EQUIVALENTE | HISTORICA */
  estado: string;
  motivo: string;
}

/**
 * Reconcilia a comparação com o dossiê OFICIAL da linha. Só declara A/B
 * equivalente quando hash das evidências, hash do prompt de sistema, versão
 * do prompt e parâmetro de temperatura conferem. Dossiê oficial sem hash
 * (gerado antes da rastreabilidade) => sempre "histórica" — nunca "equivalente"
 * por supuesto. É o veredito EXIBIDO, não uma garantia de igualdade de saída.
 */
function reconcileEquivalencia(row: NonNullable<ImportRow>, evidenceHash: string, systemSha: string): Equivalencia {
  const semHash = !row.dossierEvidenceSha || !row.dossierSystemSha;
  if (semHash) {
    return {
      estado: "HISTORICA",
      motivo: "Comparação histórica — entradas não comprovadamente equivalentes: o dossiê oficial não tem hash de evidência/prompt registrado (gerado antes da rastreabilidade A/B). Re-sintetize a conta para habilitar comparação equivalente.",
    };
  }
  const dif: string[] = [];
  if (row.dossierEvidenceSha !== evidenceHash) dif.push("hash das evidências diverge (pacote/estado da linha mudou desde a síntese oficial)");
  if (row.dossierSystemSha !== systemSha) dif.push("hash do prompt de sistema diverge (versão de prompt diferente)");
  if (row.dossierPromptVersion && row.dossierPromptVersion !== PROMPT_VERSION) dif.push(`versão do prompt oficial ${row.dossierPromptVersion} ≠ atual ${PROMPT_VERSION}`);
  if (row.dossierTemperature !== null && Math.abs((row.dossierTemperature ?? 0) - DOSSIER_TEMPERATURE) > 1e-9) dif.push(`temperature oficial ${row.dossierTemperature} ≠ comparação ${DOSSIER_TEMPERATURE}`);
  if (dif.length === 0) {
    return { estado: "EQUIVALENTE", motivo: "A/B equivalente: hash das evidências, hash do prompt, versão do prompt e temperature reconciliados com a síntese oficial." };
  }
  return { estado: "NAO_EQUIVALENTE", motivo: `Comparação histórica — entradas não comprovadamente equivalentes: ${dif.join("; ")}.` };
}

/**
 * Executa a comparação de UMA conta: pacote salvo → prompt idêntico → provedor externo.
 * Guarda em LabComparison + telemetria. NUNCA toca nos campos oficiais da linha.
 */
export async function runExternalComparison(rowId: string, cfg: LabConfig): Promise<ComparisonOutcome> {
  const row = await db.importRow.findFirst({ where: { id: rowId } });
  if (!row) return { ok: false, code: "LINHA_NAO_ENCONTRADA", message: "A conta selecionada não existe mais." };
  if (!row.researchJson) {
    return {
      ok: false,
      code: "SEM_PESQUISA_SALVA",
      message: "Esta conta ainda não tem pesquisa salva — rode a pesquisa profunda dela primeiro (a comparação reutiliza as evidências, não refaz buscas).",
    };
  }

  const input = buildInputFromRow(row);
  if (!input.research) {
    return { ok: false, code: "SEM_PACOTE_UTILIZAVEL", message: "O pacote salvo desta conta não tem conteúdo utilizável para comparação." };
  }
  const deep = true; // comparação sempre no modo profundo (é o modo do dossiê oficial com pacote)
  const systemPrompt = deep ? SYSTEM_PROMPT_DEEP : SYSTEM_PROMPT;
  const userMessage = buildUserMessage(input);
  const evidenceChars = userMessage.length;
  const evidenceHash = sha256(userMessage);
  const systemSha = sha256(systemPrompt);
  const host = (() => {
    try {
      return new URL(cfg.baseUrl).host;
    } catch {
      return "provedor-externo";
    }
  })();

  const res: ExternalAiCallResult = await callExternalChatCompletion(cfg, {
    system: systemPrompt,
    user: userMessage,
    temperature: DOSSIER_TEMPERATURE, // MESMO parâmetro do caminho nativo (comparabilidade)
  });
  const equivalencia = reconcileEquivalencia(row, evidenceHash, systemSha);

  // dossiê experimental: parse apenas INFORMATIVO (para render bonito) — o texto
  // bruto é sempre preservado; parse ruim NUNCA é erro de comparação por si só.
  let parsedOk: boolean | null = null;
  if (res.ok && res.content) {
    try {
      parseAiJson(res.content);
      parsedOk = true;
    } catch {
      parsedOk = false;
    }
  }

  const id = `labcmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const estadoFinal = res.ok ? "OK" : "ERRO";
  await db.labComparison.create({
    data: {
      id,
      rowId: row.id,
      batchId: row.batchId,
      rowNumber: row.rowNumber,
      empresa: row.legalName ?? row.tradeName ?? null,
      cnpj: row.normalizedCnpj ?? null,
      provider: host,
      baseUrlPath: (() => {
        try {
          return new URL(cfg.baseUrl).pathname === "/" ? null : new URL(cfg.baseUrl).pathname;
        } catch {
          return null;
        }
      })(),
      modelRequested: cfg.modelId,
      modelEffective: res.modelEffective,
      promptVersion: PROMPT_VERSION,
      appVersion: appVersion(),
      systemPromptSha: systemSha,
      evidenceChars,
      evidenceHash,
      packetReuse: true, // pacote SEMPRE reutilizado — nenhuma busca nova acontece aqui
      content: res.ok ? res.content : null,
      parsedOk,
      tokensPrompt: res.tokens?.prompt ?? null,
      tokensCompletion: res.tokens?.completion ?? null,
      tokensTotal: res.tokens?.total ?? null,
      tokensInformado: res.tokens?.informed ?? false,
      durationMs: res.durationMs,
      httpStatus: res.httpStatus,
      error: res.error ? redactKey(res.error.slice(0, 500), cfg.apiKey) : null,
      estadoFinal,
    },
  });

  recordTelemetry({
    tipo: "IA_CHAT",
    etapa: "COMPARACAO_EXTERNA",
    fonte: `${host} (laboratório lote B)`,
    operacao: "comparacao_modelo_externo",
    alvo: cfg.modelId,
    httpStatus: res.httpStatus,
    erro: res.error ? redactKey(res.error.slice(0, 300), cfg.apiKey) : null,
    tentativas: 1, // sem retry por contrato
    modeloSolicitado: cfg.modelId,
    modeloEfetivo: res.modelEffective,
    tokens: res.tokens ? { prompt: res.tokens.prompt, completion: res.tokens.completion, total: res.tokens.total } : null,
    pacoteChars: evidenceChars,
    duracaoMs: res.durationMs,
    estadoFinal: res.ok ? "sucesso" : "falha",
    payload: {
      cnpj: row.normalizedCnpj,
      empresa: row.legalName,
      promptVersao: PROMPT_VERSION,
      evidenciaSha256: evidenceHash,
      pacoteReutilizado: true,
      buscasNovas: 0,
      parsedOk,
      appVersao: appVersion(),
    },
    override: { batchId: row.batchId, rowId: row.id, rowNumber: row.rowNumber, empresa: row.legalName ?? undefined, cnpj: row.normalizedCnpj ?? undefined },
  });

  return {
    ok: res.ok,
    code: res.ok ? "OK" : "PROVEDOR_FALHOU",
    message: res.error ?? undefined,
    equivalencia,
    comparacao: {
      id,
      provider: host,
      modelRequested: cfg.modelId,
      modelEffective: res.modelEffective,
      promptVersion: PROMPT_VERSION,
      evidenceChars,
      evidenceHash,
      packetReuse: true,
      parsedOk: parsedOk ?? false,
      tokens: res.tokens,
      durationMs: res.durationMs,
      httpStatus: res.httpStatus,
      estadoFinal,
      content: res.content,
      error: res.error,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Histórico de comparações de uma linha (para exibir ao lado do dossiê oficial).
 *  Cada item traz o veredito de equivalência RECONCILIADO AGORA com o estado atual
 *  da linha (hashes oficiais) — não é claim congelado do momento da comparação. */
export async function listComparisons(rowId: string) {
  const [items, row] = await Promise.all([
    db.labComparison.findMany({
      where: { rowId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.importRow.findFirst({ where: { id: rowId } }),
  ]);
  return items.map((c) => ({
    id: c.id,
    provider: c.provider,
    modelRequested: c.modelRequested,
    modelEffective: c.modelEffective,
    promptVersion: c.promptVersion,
    evidenceChars: c.evidenceChars,
    evidenceHash: c.evidenceHash,
    packetReuse: c.packetReuse,
    parsedOk: c.parsedOk,
    equivalencia: row
      ? reconcileEquivalencia(row, c.evidenceHash ?? "", c.systemPromptSha ?? "")
      : { estado: "HISTORICA", motivo: "Linha não encontrada — comparação histórica." },
    tokens: {
      prompt: c.tokensPrompt,
      completion: c.tokensCompletion,
      total: c.tokensTotal,
      informed: c.tokensInformado ?? false,
    },
    durationMs: c.durationMs,
    httpStatus: c.httpStatus,
    estadoFinal: c.estadoFinal,
    content: c.content,
    error: c.error,
    createdAt: c.createdAt.toISOString(),
  }));
}
