/**
 * vault.ts — Lote B: cofre EFÊMERO para credenciais de provedor externo.
 *
 * Regras do contrato (usuário, 2026-10-21):
 * - A API key vive SÓ na memória deste processo (Map) — NUNCA no banco (Prisma),
 *   NUNCA no ZIP, NUNCA em storage do navegador, NUNCA em log.
 * - Vínculo por sessão: cookie httpOnly `scout_lab` (id aleatório). Outro
 *   navegador não lê nem usa a configuração de outro.
 * - Expiração automática (TTL padrão 60 min) + descarte explícito (DELETE).
 * - Z.ai nativo permanece o provedor PADRÃO: nada aqui é usado pelos fluxos
 *   oficiais (importar → identificar → revisar → selecionar → pesquisar → sintetizar).
 * - Sem fallback automático: chamada externa só acontece por ação explícita.
 *
 * Segurança do Preview público: o laboratório é experimental. Em ambiente
 * público sem isolamento, o teste externo real deve acontecer no ambiente
 * privado do operador (aviso exibido na UI). A chave NUNCA volta ao cliente.
 */

import { authMode } from "@/lib/auth";

export interface LabConfig {
  /** Base URL normalizada, sem barra final (ex.: https://api.fornecedor.com/v1) */
  baseUrl: string;
  /** API key descartável — SOMENTE memória */
  apiKey: string;
  /** Model ID conforme o provedor (ex.: "gpt-6-luna") */
  modelId: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
}

const TTL_MS = parseTtl();
const MAX_SESSIONS = 8;

/**
 * v0.10.11 — GATE SERVER-SIDE do laboratório (piloto comercial).
 *
 * O laboratório NÃO faz parte da jornada comercial: a UI dele foi retirada da
 * página principal e o acesso à API é decidido AQUI, no servidor (nunca só por
 * ocultação visual):
 *   - SCOUT_LAB_ENABLED="0" ........ laboratório FECHADO em qualquer modo (404).
 *   - modo OPEN (sem token/env) .... liberado — ambiente de desenvolvimento/kit
 *     local; é o modo documentado onde TODAS as rotas de dados são abertas.
 *   - modo TOKEN ................... FECHADO por padrão (corporativo). Só abre
 *     com SCOUT_LAB_ENABLED="1" — decisão explícita do operador, além do login.
 *
 * Rotas cobertas: /api/lab/config, /api/lab/test, /api/lab/compare e o
 * provedor mock /api/lab/mock/v1 (fixture sintética, mesma regra).
 */
export function labEnabled(): boolean {
  const flag = (process.env.SCOUT_LAB_ENABLED ?? "").trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return authMode() === "OPEN";
}

/** Resposta única para laboratório fechado — 404 (não revela que a área existe). */
export function labDisabledRes(): Response {
  return Response.json(
    { ok: false, error: { code: "LAB_INDISPONIVEL", message: "Área experimental indisponível neste ambiente." } },
    { status: 404, headers: { "Cache-Control": "no-store" } }
  );
}

function parseTtl(): number {
  const raw = Number(process.env.SCOUT_LAB_TTL_MS ?? "");
  // override só para testes; produção fica no padrão de 60 min
  if (Number.isFinite(raw) && raw >= 60_000 && raw <= 24 * 3600_000) return raw;
  return 60 * 60_000;
}

/**
 * O Map vive em globalThis: no dev do Next (Turbopack) cada rota compila seu
 * próprio bundle e instanciaria um Map DIFERENTE por rota — a credencial
 * "sumiria" entre chamadas. Em globalThis, o estado é único por processo
 * (e sobrevive a recompilações de rota).
 */
interface VaultGlobal {
  __scoutLabVault?: Map<string, LabConfig>;
}
const g = globalThis as unknown as VaultGlobal;
const vault: Map<string, LabConfig> = (g.__scoutLabVault ??= new Map<string, LabConfig>());

function now(): number {
  return Date.now();
}

function isExpired(c: LabConfig): boolean {
  return c.expiresAt <= now();
}

/** Remove sessões expiradas e, se acima do limite, as mais antigas. */
function sweep(): void {
  for (const [k, v] of vault) if (isExpired(v)) vault.delete(k);
  if (vault.size > MAX_SESSIONS) {
    const ordered = [...vault.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    while (ordered.length > MAX_SESSIONS) {
      const [k] = ordered.shift()!;
      vault.delete(k);
    }
  }
}

export interface LabConfigInput {
  baseUrl: unknown;
  apiKey: unknown;
  modelId: unknown;
}

export type LabConfigResult =
  | { ok: true; cookieValue: string; expiresAt: number }
  | { ok: false; code: string; message: string };

/** Validação e gravação em memória. Erros são PT-BR e sem ecoar a chave. */
export function setLabConfig(input: LabConfigInput): LabConfigResult {
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const modelId = typeof input.modelId === "string" ? input.modelId.trim() : "";

  if (!baseUrl) return { ok: false, code: "BASE_URL_OBRIGATORIA", message: "Informe a Base URL do provedor (ex.: https://api.fornecedor.com/v1)." };
  if (!apiKey) return { ok: false, code: "API_KEY_OBRIGATORIA", message: "Informe a API key descartável." };
  if (apiKey.length < 8) return { ok: false, code: "API_KEY_CURTA", message: "API key muito curta (mínimo 8 caracteres)." };
  if (apiKey.length > 512) return { ok: false, code: "API_KEY_LONGA", message: "API key maior que 512 caracteres — verifique se colou o valor correto." };
  if (!modelId) return { ok: false, code: "MODEL_ID_OBRIGATORIO", message: "Informe o Model ID (ex.: gpt-4o-mini, deepseek-chat)." };
  if (modelId.length > 128) return { ok: false, code: "MODEL_ID_LONGO", message: "Model ID maior que 128 caracteres." };

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, code: "BASE_URL_INVALIDA", message: "Base URL inválida — informe uma URL completa (ex.: https://api.fornecedor.com/v1)." };
  }
  if (url.search || url.hash) {
    return { ok: false, code: "BASE_URL_COM_QUERY", message: "Base URL não pode conter query string nem fragmento." };
  }
  const host = url.hostname.toLowerCase();
  const localHttp = url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost" || host === "::1");
  if (url.protocol !== "https:" && !localHttp) {
    return { ok: false, code: "BASE_URL_INSEGURA", message: "Base URL deve usar https (http só é aceito para 127.0.0.1/localhost — testes sintéticos locais)." };
  }
  // v0.9.0 — controle mínimo anti-SSRF para o Preview aberto: a credencial da sessão
  // não pode ser usada para alcançar serviços internos da VM via https também.
  // Regra: hostname literal-IP só é aceito para loopback (mock local); ranges privados
  // (10/172.16-31/192.168/169.254), *.local e *.internal são recusados SEMPRE.
  const ip4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  const blockInternal = (motivo: string) => ({ ok: false as const, code: "BASE_URL_INTERNA", message: `Base URL recusada (${motivo}) — o laboratório só alcança provedores externos ou o mock local 127.0.0.1.` });
  if (ip4) {
    const [, a, b] = ip4;
    if (a === "10" || a === "192" || a === "169" || a === "127" || a === "0") {
      const okLoopback = a === "127" || (a === "0" ? false : false);
      if (!okLoopback) return blockInternal("endereço IP privado/loopback não permitido exceto 127.0.0.1");
      void b;
    }
    if (a === "172" && Number(b) >= 16 && Number(b) <= 31) return blockInternal("faixa 172.16-31 é privada");
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal" || host.startsWith("169.254.")) {
    return blockInternal("hostname reservado de rede interna");
  }
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;

  sweep();
  const cookieValue = `lab_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "")}`;
  const cfg: LabConfig = {
    baseUrl: normalized,
    apiKey,
    modelId,
    createdAt: now(),
    expiresAt: now() + TTL_MS,
    lastUsedAt: now(),
  };
  vault.set(cookieValue, cfg);
  return { ok: true, cookieValue, expiresAt: cfg.expiresAt };
}

/** Busca a configuração da sessão (null se ausente/expirada). Renova lastUsedAt. */
export function getLabConfig(cookieValue: string | undefined | null): LabConfig | null {
  sweep();
  if (!cookieValue) return null;
  const cfg = vault.get(cookieValue);
  if (!cfg) return null;
  if (isExpired(cfg)) {
    vault.delete(cookieValue);
    return null;
  }
  cfg.lastUsedAt = now();
  return cfg;
}

/** Descarte imediato (botão "Descartar agora" e expiração). */
export function deleteLabConfig(cookieValue: string | undefined | null): boolean {
  if (!cookieValue) return false;
  return vault.delete(cookieValue);
}

export interface LabStatus {
  configurado: boolean;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  modelId: string | null;
  criadoEm: string | null;
  expiraEm: string | null;
  ttlRestanteS: number | null;
  /** chave NUNCA é exposta — só o fato de existir e seu tamanho aproximado */
  chavePresente: boolean;
  chaveTamanho: number | null;
}

/** Estado seguro para a UI — sem segredo. */
export function getLabStatus(cookieValue: string | undefined | null): LabStatus {
  const cfg = getLabConfig(cookieValue);
  if (!cfg) {
    return {
      configurado: false,
      baseUrlHost: null,
      baseUrlPath: null,
      modelId: null,
      criadoEm: null,
      expiraEm: null,
      ttlRestanteS: null,
      chavePresente: false,
      chaveTamanho: null,
    };
  }
  const u = new URL(cfg.baseUrl);
  return {
    configurado: true,
    baseUrlHost: u.host,
    baseUrlPath: u.pathname === "/" ? null : u.pathname,
    modelId: cfg.modelId,
    criadoEm: new Date(cfg.createdAt).toISOString(),
    expiraEm: new Date(cfg.expiresAt).toISOString(),
    ttlRestanteS: Math.max(0, Math.round((cfg.expiresAt - now()) / 1000)),
    chavePresente: true,
    chaveTamanho: cfg.apiKey.length,
  };
}

/** Redação da chave em textos de erro/telemetria (defesa em profundidade). */
export function redactKey(text: string, key: string): string {
  if (!key || key.length < 8) return text;
  return text.split(key).join("***");
}

/** Nome do cookie de sessão do laboratório (httpOnly, setado só nas rotas /api/lab). */
export const LAB_COOKIE = "scout_lab";

/** TTL efetivo (para exibição honesta na UI antes de configurar). */
export function labTtlMinutes(): number {
  return Math.round(TTL_MS / 60_000);
}
