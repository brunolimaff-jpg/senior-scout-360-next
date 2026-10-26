/**
 * external-ai.ts — Lote B: conector para provedores externos compatíveis com OpenAI.
 *
 * Contrato do usuário (2026-10-21):
 * 1. Z.ai nativo permanece o provedor PADRÃO — nada aqui participa dos fluxos oficiais.
 * 2. A chave externa nunca entra no ZIP, nos logs nem no banco (vault efêmero em memória,
 *    src/lib/lab/vault.ts). Este módulo RECEBE a chave por parâmetro e a redai de erros.
 * 3. Nenhum fallback automático para API paga: cada chamada externa exige escolha
 *    explícita do operador (POST /api/lab/compare). Falha vira estado visível, nunca
 *    degradação silenciosa para o provedor nativo.
 * 4. Resultados experimentais NUNCA sobrescrevem os oficiais (tabela LabComparison).
 * 5. Telemetria distingue provedor/modelo (TelemetryEvent.fonte = host externo).
 * 6. Dados corporativos só vão ao provedor externo por autorização expressa
 *    (o clique em "Comparar" é a autorização, com aviso na UI).
 *
 * Compatibilidade: API OpenAI — POST {base}/chat/completions com Bearer token.
 * Sem retry automático (contrato). Timeout configurável pelo chamador.
 */

import { redactKey, type LabConfig } from "@/lib/lab/vault";

export const EXTERNAL_AI_IMPLEMENTED = true as const;

export interface ExternalTokens {
  prompt: number | null;
  completion: number | null;
  total: number | null;
  /** true somente quando o provedor REPORTOU usage de verdade — nunca inventado */
  informed: boolean;
}

interface ExternalCallCore {
  ok: boolean;
  content: string | null;
  modelEffective: string | null;
  tokens: ExternalTokens | null;
  httpStatus: number | null;
  error: string | null;
}

export interface ExternalAiCallResult extends ExternalCallCore {
  modelRequested: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** Formato de resposta chat/completions (subset OpenAI). */
interface OpenAiChatResponse {
  choices?: { message?: { content?: unknown } }[];
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
}

/**
 * Uma chamada chat/completions OpenAI-compatible. SEM retry — falha volta
 * estruturada para o operador decidir (contrato: sem fallback silencioso).
 */
export async function callExternalChatCompletion(
  cfg: LabConfig,
  opts: { system: string; user: string; temperature?: number; timeoutMs?: number }
): Promise<ExternalAiCallResult> {
  const started = Date.now();
  const core = (r: Omit<ExternalCallCore, "modelEffective"> & { modelEffective?: string | null }): ExternalAiCallResult => ({
    ok: r.ok,
    content: r.content,
    modelRequested: cfg.modelId,
    modelEffective: r.modelEffective ?? null,
    tokens: r.tokens,
    durationMs: Date.now() - started,
    httpStatus: r.httpStatus,
    error: r.error,
  });

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.modelId,
        temperature: opts.temperature ?? 0.2,
        stream: false,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const friendly = /timeout|TimeoutError|aborted/i.test(raw)
      ? "O provedor externo não respondeu dentro do tempo limite — nada foi salvo como resultado."
      : `Falha de rede ao contatar o provedor externo (${redactKey(raw, cfg.apiKey)}).`;
    return core({ ok: false, content: null, tokens: null, httpStatus: null, error: friendly });
  }

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    // corpo de erro pode ser verboso — corta e redai qualquer eco de chave
    const excerpt = redactKey(bodyText.slice(0, 300), cfg.apiKey) || "(sem corpo)";
    return core({
      ok: false,
      content: null,
      tokens: null,
      httpStatus: res.status,
      error:
        res.status === 401 || res.status === 403
          ? `Provedor externo recusou a credencial (HTTP ${res.status}). Confira a API key — nenhum resultado foi salvo.`
          : `Provedor externo respondeu HTTP ${res.status}: ${excerpt}`,
    });
  }

  let json: OpenAiChatResponse | null;
  try {
    json = JSON.parse(bodyText) as OpenAiChatResponse;
  } catch {
    return core({ ok: false, content: null, tokens: null, httpStatus: res.status, error: "Resposta do provedor não é JSON válido." });
  }

  const content = typeof json?.choices?.[0]?.message?.content === "string" ? json.choices[0].message.content : null;
  if (content === null) {
    return core({ ok: false, content: null, tokens: null, httpStatus: res.status, error: "Resposta sem conteúdo em choices[0].message.content." });
  }
  const modelEffective = typeof json?.model === "string" && json.model.length > 0 ? json.model : null;

  // usage EXPLICITAMENTE reportado — se faltar, informed=false e valores null (nunca 0)
  const u = json?.usage;
  const prompt = typeof u?.prompt_tokens === "number" && Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
  const completion = typeof u?.completion_tokens === "number" && Number.isFinite(u.completion_tokens) ? u.completion_tokens : null;
  const total = typeof u?.total_tokens === "number" && Number.isFinite(u.total_tokens) ? u.total_tokens : null;
  const informed = prompt !== null || completion !== null || total !== null;

  return core({
    ok: true,
    content,
    modelEffective,
    tokens: informed ? { prompt, completion, total, informed: true } : null,
    httpStatus: res.status,
    error: null,
  });
}

/** Teste de conexão: GET {base}/models — NÃO dispara inferência (custo zero em tokens). */
export interface ExternalProbeResult {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  modelos: string[];
  modeloPresente: boolean | null; // null = não deu para listar
  error: string | null;
}

interface OpenAiModelsResponse {
  data?: unknown;
}

export async function probeExternalProvider(cfg: LabConfig): Promise<ExternalProbeResult> {
  const started = Date.now();
  const done = (r: Omit<ExternalProbeResult, "durationMs">): ExternalProbeResult => ({ ...r, durationMs: Date.now() - started });
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return done({ ok: false, httpStatus: null, modelos: [], modeloPresente: null, error: `Falha de rede (${redactKey(raw, cfg.apiKey)}).` });
  }
  if (!res.ok) {
    return done({
      ok: false,
      httpStatus: res.status,
      modelos: [],
      modeloPresente: null,
      error:
        res.status === 401 || res.status === 403
          ? `Credencial recusada pelo provedor (HTTP ${res.status}).`
          : `Provedor respondeu HTTP ${res.status} em /models.`,
    });
  }
  let json: OpenAiModelsResponse | null;
  try {
    json = JSON.parse(await res.text()) as OpenAiModelsResponse;
  } catch {
    return done({ ok: true, httpStatus: res.status, modelos: [], modeloPresente: null, error: "Conectou, mas /models não devolveu JSON esperado." });
  }
  const modelos = Array.isArray(json?.data)
    ? json.data
        .map((m) => (m && typeof m === "object" && "id" in m ? String((m as { id: unknown }).id) : ""))
        .filter((s) => s.length > 0)
        .slice(0, 100)
    : [];
  return done({
    ok: true,
    httpStatus: res.status,
    modelos,
    modeloPresente: modelos.length > 0 ? modelos.includes(cfg.modelId) : null,
    error: null,
  });
}
