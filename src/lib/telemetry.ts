/**
 * Telemetria do Scout 360 (Lote A3) — evidência reconstruível de execução.
 *
 * Objetivo do contrato: enviar os eventos ao Planejador e reconstruir o que
 * aconteceu com CADA empresa — quais consultas, quais fontes, quais chamadas
 * de IA, quanto tempo, onde falhou, qual modelo gerou cada leitura e qual
 * consumo foi EFETIVAMENTE reportado pelo provedor.
 *
 * Princípios:
 * - Um evento por consulta/chamada/etapa — correlacionado por runId/batchId/rowId.
 * - Contexto de execução via AsyncLocalStorage: coletadores fundo (sources/research/ai)
 *   não precisam receber batchId/rowNumber por parâmetro — a correlação vem do contexto.
 * - Fire-and-forget: telemetria NUNCA quebra nem atrasa o fluxo de negócio.
 * - NUNCA registra segredos, headers de autenticação, PII desnecessária ou conteúdo
 *   bruto de páginas (só metadados: URL, contagens, duração, status).
 * - "Provedor não informou" ≠ "consumo zero": tokensInformado=false distingue ausência.
 */
import { AsyncLocalStorage } from "async_hooks";
import { db } from "@/lib/db";
import { appVersion } from "@/lib/version";

/* ------------------------------ Contexto ------------------------------ */

export interface TelemetryContext {
  runId: string;
  batchId: string | null;
  rowId: string | null;
  rowNumber: number | null;
  /** pista/razão social conhecida no momento — identidade empresarial do evento */
  empresa: string | null;
  cnpj: string | null;
  etapa: string | null;
  /** início da unidade de trabalho (para duração de etapa) */
  startedAt: number;
}

const als = new AsyncLocalStorage<TelemetryContext>();

/* ---- v0.10.11: escritas pendentes rastreáveis ----
 * A telemetria é fire-and-forget por contrato (nunca atrasa o negócio), mas
 * "fire-and-forget" não pode significar "perde-se em silêncio": cada create
 * fica registrado aqui até assentar (com UMA re-tentativa — banco ocupado não
 * apaga evidência). Quem PRECISA ler telemetria logo após uma ação (suítes,
 * provas) chama aguardarTelemetria() e não corre mais contra a escrita. */
const pendentes = new Set<Promise<unknown>>();

/** Resolve quando TODAS as escritas de telemetria disparadas até agora assentarem. */
export async function aguardarTelemetria(): Promise<void> {
  while (pendentes.size > 0) {
    await Promise.allSettled([...pendentes]);
  }
}

/** Roda fn com um contexto de telemetria próprio (nova unidade de trabalho). */
export async function runWithTelemetry<T>(ctx: TelemetryContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

/** Contexto atual (ou null fora de uma unidade instrumentada). */
export function currentTelemetry(): TelemetryContext | null {
  return als.getStore() ?? null;
}

/** Novo runId curto e único (uma execução de linha/pesquisa/síntese/resumo). */
export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Dados parciais para DERIVAR contexto (ex.: enriquecer empresa após lookup). */
export function patchTelemetry(patch: Partial<Omit<TelemetryContext, "runId" | "startedAt">>): void {
  const store = als.getStore();
  if (!store) return;
  if (patch.empresa !== undefined) store.empresa = patch.empresa;
  if (patch.cnpj !== undefined) store.cnpj = patch.cnpj;
  if (patch.etapa !== undefined) store.etapa = patch.etapa;
}

/* ------------------------------ Gravação ------------------------------ */

export type TelemetryTipo =
  | "COLETA_CADASTRO" // HTTP a fonte de cadastro (BrasilAPI, OpenCNPJ, ReceitaWS, MinhaReceita, IBGE, RSS…)
  | "WEB_SEARCH"      // busca web via resolve-service (SDK web_search)
  | "PAGE_READER"     // leitura de página via resolve-service (SDK page_reader)
  | "IA_CHAT"         // chamada de modelo via resolve-service (/scout-chat)
  | "AI_GUARD"        // v0.10.2: guarda determinística de temporalidade corrigiu a síntese do modelo
  | "RELACAO_GRAFO"   // v0.10.5 FRENTE A: consulta de relações societárias (MinhaReceita Grafo)
  | "RELACAO_EXPANSAO" // v0.10.5 FRENTE A: expansão manual de UMA conexão (quadro do participante)
  | "DESCOBERTA_ROOT" // v0.10.5 FRENTE B: descoberta de estabelecimentos pela raiz + confirmações
  | "TRIAGEM"         // v0.10.6: triagem local determinística (cálculo/exportação de lacunas — zero IA)
  | "PLANO"           // v0.10.9 P4: planejador de consultas (geração/exportação do plano — zero IA, zero execução)
  | "ETAPA";          // unidade de trabalho: RESOLUCAO_IDENTIDADE | ENRIQUECIMENTO | PESQUISA_PROFUNDA | SINTESE_IA | RESUMO_LOTE

export interface TelemetryEventInput {
  tipo: TelemetryTipo;
  etapa?: string | null;
  fonte?: string | null;
  operacao?: string | null;
  alvo?: string | null;
  httpStatus?: number | null;
  erro?: string | null;
  tentativas?: number | null;
  cacheHit?: boolean | null;
  resultados?: number | null;
  aproveitaveis?: number | null;
  motivoDescarte?: string | null;
  modeloSolicitado?: string | null;
  modeloEfetivo?: string | null;
  /** null = provedor não informou (tokensInformado=false); número só quando reportado de verdade */
  tokens?: { prompt: number | null; completion: number | null; total: number | null } | null;
  pacoteChars?: number | null;
  duracaoMs?: number | null;
  estadoFinal?: "sucesso" | "parcial" | "falha" | "bloqueado" | "cancelado" | null;
  payload?: Record<string, unknown> | null;
  /** sobrescreve campos do contexto (quando o evento sabe mais que o contexto) */
  override?: Partial<Pick<TelemetryContext, "batchId" | "rowId" | "rowNumber" | "empresa" | "cnpj" | "etapa">>;
}

/** Sanitiza: corta strings longas e remove segredos acidentais do payload. */
function sanitize(value: unknown, max = 300): unknown {
  if (typeof value === "string") {
    return value.replace(/(api[_-]?key|authorization|token|senha|password)"?\s*[:=]\s*\S+/gi, "$1=[REDACTED]").slice(0, max);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = sanitize(v, max);
    }
    return out;
  }
  return value;
}

/**
 * Grava um evento de telemetria (fire-and-forget). Fora de contexto, registra
 * apenas o que o evento trouxe (ids nulos) — nunca lança.
 */
export function recordTelemetry(evt: TelemetryEventInput): void {
  try {
    const ctx = currentTelemetry();
    const dados = {
      runId: ctx?.runId ?? null,
      batchId: evt.override?.batchId ?? ctx?.batchId ?? null,
      rowId: evt.override?.rowId ?? ctx?.rowId ?? null,
      rowNumber: evt.override?.rowNumber ?? ctx?.rowNumber ?? null,
      empresa: evt.override?.empresa ?? ctx?.empresa ?? null,
      cnpj: evt.override?.cnpj ?? ctx?.cnpj ?? null,
      etapa: evt.etapa ?? evt.override?.etapa ?? ctx?.etapa ?? null,
      tipo: evt.tipo,
      fonte: evt.fonte ?? null,
      operacao: evt.operacao ?? null,
      alvo: evt.alvo ? String(evt.alvo).slice(0, 500) : null,
      httpStatus: typeof evt.httpStatus === "number" ? evt.httpStatus : null,
      erro: evt.erro ? String(evt.erro).slice(0, 500) : null,
      tentativas: typeof evt.tentativas === "number" ? evt.tentativas : null,
      cacheHit: typeof evt.cacheHit === "boolean" ? evt.cacheHit : null,
      resultados: typeof evt.resultados === "number" ? evt.resultados : null,
      aproveitaveis: typeof evt.aproveitaveis === "number" ? evt.aproveitaveis : null,
      motivoDescarte: evt.motivoDescarte ? String(evt.motivoDescarte).slice(0, 300) : null,
      modeloSolicitado: evt.modeloSolicitado ?? null,
      modeloEfetivo: evt.modeloEfetivo ?? null,
      tokensPrompt: evt.tokens && typeof evt.tokens.prompt === "number" ? evt.tokens.prompt : null,
      tokensCompletion: evt.tokens && typeof evt.tokens.completion === "number" ? evt.tokens.completion : null,
      tokensTotal: evt.tokens && typeof evt.tokens.total === "number" ? evt.tokens.total : null,
      // "não informado" ≠ zero: true só quando o provedor reportou AO MENOS um valor
      tokensInformado: evt.tokens
        ? [evt.tokens.prompt, evt.tokens.completion, evt.tokens.total].some((v) => typeof v === "number")
        : null,
      pacoteChars: typeof evt.pacoteChars === "number" ? evt.pacoteChars : null,
      duracaoMs: typeof evt.duracaoMs === "number" ? evt.duracaoMs : null,
      appVersao: appVersion(),
      promptVersao: evt.tipo === "IA_CHAT" ? (evt.payload?.promptVersao as string | undefined) ?? null : null,
      estadoFinal: evt.estadoFinal ?? null,
      payloadJson: evt.payload ? JSON.stringify(sanitize(evt.payload)) : null,
    };
    const tarefa = (async () => {
      // UMA re-tentativa: corrida de escrita (SQLite ocupado) não apaga evidência
      for (let i = 0; i < 2; i++) {
        try {
          await db.telemetryEvent.create({ data: dados });
          return;
        } catch {
          if (i === 1) return; // desiste em silêncio — negócio segue, mas tentou 2×
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    })();
    pendentes.add(tarefa);
    void tarefa.finally(() => pendentes.delete(tarefa));
  } catch {
    /* telemetria nunca lança */
  }
}

/** Evento de ETAPA (início/fim de unidade de trabalho) com duração do contexto. */
export function recordEtapaFinal(params: {
  etapa: string;
  estadoFinal: "sucesso" | "parcial" | "falha" | "bloqueado" | "cancelado";
  motivo?: string | null;
  payload?: Record<string, unknown> | null;
}): void {
  const ctx = currentTelemetry();
  recordTelemetry({
    tipo: "ETAPA",
    etapa: params.etapa,
    estadoFinal: params.estadoFinal,
    erro: params.motivo ?? null,
    duracaoMs: ctx ? Date.now() - ctx.startedAt : null,
    payload: params.payload ?? null,
  });
}
