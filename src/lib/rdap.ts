/**
 * Busca reversa determinística: domínio .br → CNPJ do registrante.
 * Fonte: RDAP oficial do registro.br (https://rdap.registro.br). Sem IA.
 *
 * Regras:
 * - Domínios fora do .br são recusados ANTES de qualquer consulta (NOT_BR_DOMAIN) —
 *   o RDAP do registro.br só cobre o espaço .br.
 * - 404 → domínio não registrado (NOT_FOUND). Se o domínio tem ≥4 labels,
 *   tenta UMA vez o domínio pai (ex.: blog.x.com.br → x.com.br), auditável via queryDomain.
 * - O CNPJ só é aceito se passar na validação de DV (mesma regra da entrada direta).
 */
import https from "https";
import { formatCnpj, normalizeCnpj, validateCnpj } from "@/lib/cnpj";

const RDAP_BASE = "https://rdap.registro.br/domain/";
const TIMEOUT_MS = 8000;

export type ReverseErrorType =
  | "NOT_FOUND"
  | "NOT_BR_DOMAIN"
  | "NO_CNPJ_REGISTERED"
  | "INVALID_CNPJ_IN_RDAP"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "SERVER_ERROR"
  | "INVALID_RESPONSE";

export interface ReverseLookupResult {
  ok: boolean;
  cnpj: string | null; // 14 dígitos válidos (zeros à esquerda preservados)
  formattedCnpj: string | null;
  ownerName: string | null; // nome do registrante no registro.br (quando disponível)
  domain: string; // domínio solicitado originalmente
  queryDomain: string; // domínio efetivamente consultado (pode ser o pai, no fallback)
  source: "RDAP_REGISTRO_BR";
  errorType?: ReverseErrorType;
  message?: string;
}

function isBrDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/\.$/, "");
  return d === "br" || d.endsWith(".br");
}

function parentDomain(domain: string): string | null {
  const parts = domain.split(".");
  if (parts.length < 4) return null; // ex.: x.com.br → só tenta pai se ≥4 labels
  return parts.slice(1).join(".");
}

interface RdapEntity {
  handle?: string;
  roles?: string[];
  vcardArray?: unknown;
  publicIds?: { type?: string; identifier?: string }[];
  entities?: RdapEntity[];
}

function vcardName(entity: RdapEntity): string | null {
  const arr = entity.vcardArray;
  if (!Array.isArray(arr) || arr.length < 2 || !Array.isArray(arr[1])) return null;
  for (const entry of arr[1] as unknown[]) {
    if (Array.isArray(entry) && entry[0] === "fn") {
      const v = entry[3];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/** Procura CNPJ nas entidades RDAP: registrante com publicIds primeiro; handle de 14 dígitos como fallback. */
export function extractCnpjFromRdap(json: unknown): { cnpj: string | null; owner: string | null } {
  const root = json as { entities?: RdapEntity[] };
  const entities: RdapEntity[] = [];
  const walk = (list?: RdapEntity[]) => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      entities.push(e);
      walk(e.entities); // entidades aninhadas (ex.: administrativa dentro do registrante)
    }
  };
  walk(root?.entities);

  const withPublicId = entities.filter((e) =>
    Array.isArray(e.publicIds) && e.publicIds.some((p) => /cnpj/i.test(p.type ?? ""))
  );
  const pick = (list: RdapEntity[]): { cnpj: string | null; owner: string | null } => {
    for (const e of list) {
      const pid = (e.publicIds ?? []).find((p) => /cnpj/i.test(p.type ?? "") && p.identifier);
      if (!pid) continue;
      const digits = normalizeCnpj(pid.identifier ?? "");
      if (digits.length === 14) return { cnpj: digits, owner: vcardName(e) };
    }
    return { cnpj: null, owner: null };
  };

  // 1) registrante com CNPJ público
  const registrants = entities.filter((e) => (e.roles ?? []).some((r) => /registrant/i.test(r)));
  const fromRegistrant = pick(registrants);
  if (fromRegistrant.cnpj) return fromRegistrant;

  // 2) qualquer entidade com CNPJ público
  const fromAny = pick(withPublicId);
  if (fromAny.cnpj) return fromAny;

  // 3) handle do registrante = CNPJ cru (padrão comum no registro.br)
  for (const e of registrants) {
    if (e.handle && /^\d{14}$/.test(e.handle)) {
      return { cnpj: e.handle, owner: vcardName(e) };
    }
  }
  return { cnpj: null, owner: null };
}

interface RdapAttempt {
  status: number;
  json?: unknown;
}

/**
 * GET RDAP via https nativo com family: 4 (IPv4 forçado).
 * Motivo: ambientes sem IPv6 quebram o fetch (AggregateError) quando o host tem AAAA;
 * o registro.br publica AAAA. IPv4 é o caminho determinístico aqui.
 */
function rdapGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        family: 4,
        servername: u.hostname,
        timeout: TIMEOUT_MS,
        headers: { Accept: "application/rdap+json, application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("timeout", () => {
      req.destroy(new TimeoutError());
    });
    req.on("error", (e) => reject(e));
    req.end();
  });
}

class TimeoutError extends Error {
  name = "TimeoutError";
}

async function rdapQuery(domain: string): Promise<RdapAttempt> {
  try {
    const { status, body } = await rdapGet(RDAP_BASE + encodeURIComponent(domain.toLowerCase()));
    let json: unknown;
    if (status !== 404) {
      try {
        json = JSON.parse(body);
      } catch {
        return { status: 502, json: undefined };
      }
    }
    return { status, json };
  } catch (err) {
    if (err instanceof TimeoutError || (err instanceof Error && err.name === "TimeoutError")) {
      const e = new Error("timeout");
      e.name = "TimeoutError";
      throw e;
    }
    throw err;
  }
}

/** Consulta o RDAP do registro.br e devolve o CNPJ do registrante (se existir e for DV-válido). */
export async function reverseCnpjFromDomain(domain: string): Promise<ReverseLookupResult> {
  const clean = domain.toLowerCase().trim();
  const base: Omit<ReverseLookupResult, "ok" | "queryDomain" | "cnpj" | "formattedCnpj" | "ownerName"> = {
    domain: clean,
    source: "RDAP_REGISTRO_BR",
  };
  const fail = (queryDomain: string, errorType: ReverseErrorType, message: string): ReverseLookupResult => ({
    ...base,
    ok: false,
    queryDomain,
    cnpj: null,
    formattedCnpj: null,
    ownerName: null,
    errorType,
    message,
  });

  if (!clean || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
    return fail(clean, "NOT_BR_DOMAIN", `Domínio inválido para busca reversa: "${clean}".`);
  }
  if (!isBrDomain(clean)) {
    return fail(clean, "NOT_BR_DOMAIN", "Domínio fora do .br — a busca reversa cobre apenas domínios .br (registro.br).");
  }

  const candidates: string[] = [clean];
  const parent = parentDomain(clean);
  if (parent && isBrDomain(parent)) candidates.push(parent);

  let lastError: { type: ReverseErrorType; message: string } | null = null;

  for (const candidate of candidates) {
    let attempt: RdapAttempt;
    try {
      attempt = await rdapQuery(candidate);
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      lastError = isTimeout
        ? { type: "TIMEOUT", message: `RDAP registro.br não respondeu em ${TIMEOUT_MS / 1000}s (${candidate}).` }
        : { type: "NETWORK_ERROR", message: `Falha de rede consultando o RDAP registro.br (${candidate}): ${err instanceof Error ? err.message : String(err)}.` };
      continue; // erro transitório: não adianta tentar o pai com a mesma rede
    }

    if (attempt.status === 404) {
      lastError = { type: "NOT_FOUND", message: `Domínio ${candidate} não encontrado no registro.br.` };
      continue; // tenta o pai (ex.: subdomínio não registrado)
    }
    if (attempt.status === 429) {
      lastError = { type: "RATE_LIMITED", message: "Limite de consultas do registro.br atingido (429)." };
      break;
    }
    if (attempt.status >= 500 || attempt.status === 502) {
      lastError = { type: "SERVER_ERROR", message: `RDAP registro.br respondeu ${attempt.status}.` };
      break;
    }
    if (attempt.status !== 200 || attempt.json === undefined) {
      lastError = { type: "INVALID_RESPONSE", message: `RDAP registro.br respondeu ${attempt.status} sem JSON válido.` };
      break;
    }

    const { cnpj, owner } = extractCnpjFromRdap(attempt.json);
    if (!cnpj) {
      return {
        ...base, ok: false, queryDomain: candidate, cnpj: null, formattedCnpj: null, ownerName: owner,
        errorType: "NO_CNPJ_REGISTERED",
        message: `Domínio ${candidate} registrado no .br, mas sem CNPJ público do registrante no registro.br.`,
      };
    }
    const v = validateCnpj(cnpj);
    if (!v.valid) {
      return {
        ...base, ok: false, queryDomain: candidate, cnpj: null, formattedCnpj: null, ownerName: owner,
        errorType: "INVALID_CNPJ_IN_RDAP",
        message: `CNPJ ${formatCnpj(cnpj)} do registro.br (${candidate}) não passou na validação de dígitos — não será enriquecido.`,
      };
    }
    return {
      ...base,
      ok: true,
      queryDomain: candidate,
      cnpj: v.normalized,
      formattedCnpj: formatCnpj(v.normalized),
      ownerName: owner,
    };
  }

  return fail(clean, lastError?.type ?? "NETWORK_ERROR", lastError?.message ?? "Falha desconhecida na busca reversa.");
}
