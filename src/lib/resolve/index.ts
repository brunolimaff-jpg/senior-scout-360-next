/**
 * resolve_company_identity — camada de resolução de identidade (contrato Senior Scout 360).
 *
 * Transforma pistas incompletas em candidatos de empresa/CNPJ:
 *   CNPJ → consulta direta | e-mail → domínio | domínio → evidência no próprio site
 *   → RDAP registro.br | nome → varredura na web com ENTITY_BINDING → confirmação na Receita.
 *
 * Regras absolutas:
 * - Validar que o CNPJ EXISTE não valida o VÍNCULO com a pista: antes de virar candidato,
 *   cada CNPJ precisa de binding (binding.ts): 1 evidência FORTE ou 2 MODERADAS independentes.
 * - O CNPJ do DONO/PUBLISHER da página (marketplace, notícia, classificado, órgão público)
 *   nunca é atribuído à entidade mencionada na página — PAGE_OWNER_ONLY descarta.
 * - "Situação cadastral confirmada" valida o REGISTRO, nunca a identidade — vive em
 *   dadosJuridicos, separada dos sinais de vínculo.
 * - O modelo de linguagem NUNCA decide qual empresa existe — web_search apenas recolhe
 *   evidências indexadas; a confirmação é determinística.
 * - Confiança vem da EVIDÊNCIA (tabela de forças), não de score inventado.
 * - cnpj_encontrado ≠ cnpj_matriz: a matriz é localizada pelo campo oficial
 *   identificador_matriz_filial = 1, NUNCA inferida pelo sufixo "0001".
 * - Sem vínculo suficiente → REVIEW/descarte; sem candidato → UNRESOLVED (honesto —
 *   melhor UNRESOLVED do que candidato contaminado).
 *
 * Nota de arquitetura: web_search/page_reader rodam no mini serviço resolve-service
 * (bun, :3030) — o SDK derruba o processo Next quando invocado inline (verificado).
 */
import { classifyToken, hostnameFromUrl } from "@/lib/extract";
import { normalizeCnpj, validateCnpj, formatCnpj, cnpjFromRoot } from "@/lib/cnpj";
import { lookupCnpjComCache } from "@/lib/enrich/cadastro-cache";
import { plural } from "@/lib/linguagem";
import { reverseCnpjFromDomain } from "@/lib/rdap";
import { acquireServiceSlot } from "@/lib/ratelimit";
import { recordTelemetry } from "@/lib/telemetry";
import {
  classifyHost,
  evaluateBindingGate,
  hostMatchesLegalName,
  isPublisherHost,
  makeBinding,
  publisherMotivo,
  titleMentionsEntity,
  tokenSimilarity,
  nomeCorresponde,
  type BindingEvidence,
  type DiscardedCandidate,
  type HostKind,
} from "./binding";

/* --------------------- Ponte para o resolve-service --------------------- */

const RESOLVE_SERVICE_URL = process.env.RESOLVE_SERVICE_URL ?? "http://127.0.0.1:3030";

interface SearchItem {
  url?: string;
  name?: string;
  snippet?: string;
  host_name?: string;
  rank?: number;
}

interface PageReaderData {
  html?: string;
  title?: string;
  url?: string;
}

async function callService(path: string, body: Record<string, unknown>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${RESOLVE_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Busca na web via resolve-service. Nunca lança: erro vira lista vazia + flag transitória. */
async function webSearch(query: string, num = 8): Promise<{ items: SearchItem[]; transitorio: boolean }> {
  const release = await acquireServiceSlot("WEB_SEARCH");
  const t0 = Date.now();
  try {
    const res = await callService("/web-search", { query, num });
    if (res.status === 429 || res.status === 504 || res.status === 503) {
      recordTelemetry({
        tipo: "WEB_SEARCH",
        fonte: "z-ai-web_search (resolução de identidade)",
        operacao: "busca_web",
        alvo: query,
        httpStatus: res.status,
        erro: `serviço respondeu ${res.status}`,
        tentativas: 1,
        cacheHit: false,
        resultados: 0,
        duracaoMs: Date.now() - t0,
        estadoFinal: res.status === 429 ? "bloqueado" : "falha",
      });
      return { items: [], transitorio: true };
    }
    if (!res.ok) {
      recordTelemetry({
        tipo: "WEB_SEARCH",
        fonte: "z-ai-web_search (resolução de identidade)",
        operacao: "busca_web",
        alvo: query,
        httpStatus: res.status,
        erro: `serviço respondeu ${res.status}`,
        tentativas: 1,
        cacheHit: false,
        resultados: 0,
        duracaoMs: Date.now() - t0,
        estadoFinal: "falha",
      });
      return { items: [], transitorio: false };
    }
    const json = (await res.json()) as { ok?: boolean; items?: SearchItem[] };
    const items = Array.isArray(json.items) ? json.items : [];
    recordTelemetry({
      tipo: "WEB_SEARCH",
      fonte: "z-ai-web_search (resolução de identidade)",
      operacao: "busca_web",
      alvo: query,
      httpStatus: res.status,
      tentativas: 1,
      cacheHit: false,
      resultados: items.length,
      aproveitaveis: items.filter((it) => (it.url ?? "").length > 0).length,
      duracaoMs: Date.now() - t0,
      estadoFinal: items.length === 0 ? "parcial" : "sucesso",
    });
    return { items, transitorio: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordTelemetry({
      tipo: "WEB_SEARCH",
      fonte: "z-ai-web_search (resolução de identidade)",
      operacao: "busca_web",
      alvo: query,
      erro: msg,
      tentativas: 1,
      cacheHit: false,
      resultados: 0,
      duracaoMs: Date.now() - t0,
      estadoFinal: "falha",
    });
    return { items: [], transitorio: isTransientMessage(msg) };
  } finally {
    release();
  }
}

/** Leitura da página inicial via resolve-service. Nunca lança. */
async function pageReader(url: string): Promise<{ data: PageReaderData | null; erro?: string }> {
  const release = await acquireServiceSlot("PAGE_READER");
  const t0 = Date.now();
  try {
    const res = await callService("/page-reader", { url });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      recordTelemetry({
        tipo: "PAGE_READER",
        fonte: "z-ai-page_reader (resolução de identidade)",
        operacao: "leitura_pagina",
        alvo: url,
        httpStatus: res.status,
        erro: json.error ?? `serviço respondeu ${res.status}`,
        tentativas: 1,
        cacheHit: false,
        resultados: 0,
        duracaoMs: Date.now() - t0,
        estadoFinal: res.status === 429 ? "bloqueado" : "falha",
      });
      return { data: null, erro: json.error ?? `serviço respondeu ${res.status}` };
    }
    const json = (await res.json()) as { ok?: boolean; data?: PageReaderData | null };
    const data = json.data ?? null;
    recordTelemetry({
      tipo: "PAGE_READER",
      fonte: "z-ai-page_reader (resolução de identidade)",
      operacao: "leitura_pagina",
      alvo: url,
      httpStatus: res.status,
      tentativas: 1,
      cacheHit: false,
      resultados: data ? 1 : 0,
      aproveitaveis: data && (data.html ?? "").length > 200 ? 1 : 0,
      duracaoMs: Date.now() - t0,
      estadoFinal: data ? "sucesso" : "falha",
      motivoDescarte: data ? null : "página sem conteúdo",
    });
    return { data, erro: data ? undefined : "página sem conteúdo" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordTelemetry({
      tipo: "PAGE_READER",
      fonte: "z-ai-page_reader (resolução de identidade)",
      operacao: "leitura_pagina",
      alvo: url,
      erro: msg,
      tentativas: 1,
      cacheHit: false,
      resultados: 0,
      duracaoMs: Date.now() - t0,
      estadoFinal: "falha",
    });
    return { data: null, erro: msg };
  } finally {
    release();
  }
}

/* ------------------------------ Tipos ------------------------------ */

export interface Clues {
  cnpj: string | null; // 14 dígitos DV-válidos encontrados na própria linha
  emails: string[];
  domains: string[]; // domínios canônicos (e-mail → pós-@; URL → host; domínio solto)
  disposableEmail: boolean; // gmail/hotmail/... = pista quase nula
  phones: string[];
  names: string[]; // possíveis razões sociais / nomes fantasia
  uf: string | null; // UF detectada como token independente (whitelist)
  rawLine: string | null;
}

export type EvidenceStrength = "MUITO_FORTE" | "FORTE" | "MEDIA" | "BAIXA";

export interface ResolutionSource {
  fonte: string;
  url: string | null;
  detalhe?: string;
}

export interface ResolutionCandidate {
  cnpj: string;
  strength: EvidenceStrength;
  sinais: string[]; // VÍNCULO com a pista (nunca dados de registro)
  contradicoes: string[];
  fontes: ResolutionSource[];
  /** ENTITY_BINDING: o que cada fonte prova (ou não) sobre o vínculo pista↔CNPJ */
  bindings: BindingEvidence[];
  /** dados do registro oficial (existência, situação, local) — validam o CNPJ, não o vínculo */
  dadosJuridicos: string[];
  confirmado: {
    razaoSocial: string;
    uf: string;
    municipio: string;
    identificador: number | null;
    fonte: string;
  } | null;
}

export type ResolutionState = "CONFIRMED" | "REVIEW" | "UNRESOLVED";

export interface IdentityResolution {
  estado: ResolutionState;
  confianca: EvidenceStrength | null;
  metodo: string[]; // passos executados, em ordem (auditoria)
  notas: string[]; // observações honestas (ex.: e-mail pessoal = pista fraca)
  candidatos: ResolutionCandidate[];
  /** CNPJs/fontes rejeitados pelo ENTITY_BINDING — auditoria do que NÃO virou candidato e por quê */
  descartados: DiscardedCandidate[];
  escolhido: string | null; // CNPJ escolhido (apenas quando CONFIRMED)
  pistas: Clues;
  /** true = falhas só de rede/timeout, sem candidato algum → linha pode ser reprocessada */
  transitorio: boolean;
}

export interface ResolveInput {
  clues: Clues;
  /** rótulo amigável da linha para auditoria (ex.: "brasildigital.net.br") */
  label?: string;
}

/* ------------------------------ Pistas ------------------------------ */

const DISPOSABLE_EMAIL_RE =
  /@(gmail|googlemail|hotmail|outlook|live|yahoo|yahoo\.com\.br|bol|uol|ig|terra|icloud|me)\./i;

const UF_SET = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

const PHONE_RE = /\(?\d{2}\)?\s?(?:9\s?\d{4}|\d{4})-?\d{4}/g;

/** CNPJ formatado em prosa (com separadores) — numérico OU alfanumérico: letras
 *  A–Z em QUALQUER uma das 12 primeiras posições, inclusive a raiz (IN RFB 2229/2024;
 *  ex. oficial 12.ABC.345/01DE-35). Validação de DV descarta falsos positivos.
 *  v0.10.12 (bug real da suíte de identidade): o lookbehind impede que o padrão ancore
 *  DENTRO de uma palavra (ex.: "CNPJ 00002000000120" casava "PJ 000020000001" e rejeitava
 *  por dígito adjacente — o CNPJ inteiro se perdia). O match agora começa em fronteira. */
const CNPJ_PROSE_RE = /(?<![0-9A-Za-z])[0-9A-Za-z]{2}[.\s]?[0-9A-Za-z]{3}[.\s]?[0-9A-Za-z]{3}[/\s]?[0-9A-Za-z]{4}-?\d{2}/g;

function extractCnpjLiterals(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(CNPJ_PROSE_RE)) {
    const start = m.index ?? 0;
    const before = text[start - 1];
    const after = text[start + m[0].length];
    if ((before && /\d/.test(before)) || (after && /\d/.test(after))) continue; // colado em número maior
    const digits = normalizeCnpj(m[0]);
    if (digits.length !== 14) continue;
    if (validateCnpj(digits).valid) found.push(digits);
  }
  return [...new Set(found)];
}

function looksLikeCompanyName(token: string): boolean {
  const letters = token.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  if (letters.length < 4) return false;
  if (/^\d+$/.test(token.replace(/\s/g, ""))) return false;
  return true;
}

/** Extrai pistas estruturadas de uma linha original (células do CSV ou texto colado). */
export function extractClues(cells: string[], lookupKind: string, referenceValue: string | null): Clues {
  const rawLine = cells.map((c) => String(c ?? "").trim()).filter(Boolean).join(" · ").trim() || null;
  const clues: Clues = {
    cnpj: null,
    emails: [],
    domains: [],
    disposableEmail: false,
    phones: [],
    names: [],
    uf: null,
    rawLine,
  };

  const tokens = cells
    .flatMap((c) => String(c ?? "").split(/[\s;|,]+/))
    .map((t) => t.trim())
    .filter(Boolean);
  for (const tok of tokens) {
    const c = classifyToken(tok);
    if (c.kind === "CNPJ") {
      const v = validateCnpj(c.raw);
      if (v.valid && !clues.cnpj) clues.cnpj = v.normalized;
    } else if (c.kind === "EMAIL") {
      if (c.email && !clues.emails.includes(c.email)) clues.emails.push(c.email);
      if (c.domain && !clues.domains.includes(c.domain)) clues.domains.push(c.domain);
    } else if (c.kind === "URL" || c.kind === "DOMAIN") {
      if (c.domain && !clues.domains.includes(c.domain)) clues.domains.push(c.domain);
    } else if (c.kind === "TEXT") {
      if (looksLikeCompanyName(tok) && !clues.names.includes(tok.trim())) clues.names.push(tok.trim());
    }
  }

  // CNPJ em prosa (fora dos tokens limpos)
  if (!clues.cnpj && rawLine) {
    const literal = extractCnpjLiterals(rawLine);
    if (literal.length > 0) clues.cnpj = literal[0];
  }

  // e-mails em prosa
  for (const m of (rawLine ?? "").matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const email = m[0].toLowerCase();
    if (!clues.emails.includes(email)) clues.emails.push(email);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (!clues.domains.includes(domain)) clues.domains.push(domain);
  }

  // telefone
  if (rawLine) {
    for (const m of rawLine.matchAll(PHONE_RE)) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 11 && !clues.phones.includes(digits)) clues.phones.push(digits);
    }
  }

  clues.disposableEmail = clues.emails.some((e) => DISPOSABLE_EMAIL_RE.test(e));

  // v0.10.12: NOME COMPOSTO — as palavras textuais da linha formam UM nome de empresa
  // ("12.345.678/0001-90 AUTO PECAS JASMINE LTDA" → "AUTO PECAS JASMINE LTDA"). O nome
  // inteiro entra como candidato PRINCIPAL (melhora a correspondência pistas × cadastro e
  // o texto humano da divergência), sem remover os tokens individuais da comparação.
  if (clues.names.length > 1) {
    const composto = clues.names.join(" ");
    if (!clues.names.includes(composto)) clues.names.unshift(composto);
  }

  // UF: token independente na whitelist (ex.: "Porto Velho / RO")
  for (const t of tokens) {
    const norm = t.toUpperCase().replace(/[^A-Z]/g, "");
    if (UF_SET.has(norm) && t.length <= 3) {
      clues.uf = norm;
      break;
    }
  }

  // lookupKind NAME/EMAIL/URL/DOMAIN traz a referência canônica — entra como pista principal
  if (lookupKind === "NAME" && referenceValue && !clues.names.includes(referenceValue)) {
    clues.names.unshift(referenceValue);
  }
  if ((lookupKind === "DOMAIN" || lookupKind === "URL") && referenceValue) {
    const d = hostnameFromUrl(referenceValue) ?? referenceValue.toLowerCase();
    if (!clues.domains.includes(d)) clues.domains.unshift(d);
  }
  if (lookupKind === "EMAIL" && referenceValue) {
    const email = referenceValue.toLowerCase();
    if (!clues.emails.includes(email)) clues.emails.unshift(email);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (domain.includes(".") && !clues.domains.includes(domain)) clues.domains.unshift(domain);
  }

  return clues;
}

/* ------------------------------ Utilidades ------------------------------ */

const STOP_TOKENS = new Set([
  "LTDA", "LTD", "SA", "ME", "EPP", "EIRELI", "EIREL", "EMPRESA", "COMERCIO", "SERVICOS",
  "E", "DE", "DA", "DO", "DAS", "DOS",
]);

/** Normaliza nome para comparação: uppercase, sem acento, sem sufixos societários. */
export function normalizeName(name: string): string[] {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

/** Similaridade por interseção de tokens (0..1). Para GERAR/ORDENAR candidatos, nunca confirmar. */
export function nameSimilarity(a: string, b: string): number {
  const A = new Set(normalizeName(a));
  const B = new Set(normalizeName(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

function isTransientMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("tempo limite") || m.includes("timeout") || m.includes("rede") || m.includes("network") || m.includes("429");
}

/* --------------------------- Evidência no próprio site --------------------------- */

export interface SiteEvidence {
  cnpjs: string[]; // literais DV-válidos encontrados na página
  orgNames: string[]; // JSON-LD Organization legalName/name + og:site_name + título
  ok: boolean;
  error?: string;
}

function stripHtmlNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function extractJsonLdOrgNames(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      const stack: unknown[] = [parsed];
      let guard = 0;
      while (stack.length > 0 && guard < 500) {
        guard++;
        const cur = stack.pop();
        if (Array.isArray(cur)) {
          stack.push(...cur);
          continue;
        }
        if (!cur || typeof cur !== "object") continue;
        const obj = cur as Record<string, unknown>;
        const type = String(obj["@type"] ?? "");
        if (/Organization|LocalBusiness|Corporation|Store|Restaurant/i.test(type)) {
          for (const k of ["legalName", "name"]) {
            const v = obj[k];
            if (typeof v === "string" && v.trim().length >= 3) out.push(v.trim());
          }
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === "object") stack.push(v);
        }
      }
    } catch {
      /* JSON-LD malformado: ignora, é evidência auxiliar */
    }
  }
  return [...new Set(out)].slice(0, 5);
}

/** Lê a página inicial do domínio (via resolve-service) e extrai evidência determinística. */
export async function fetchSiteEvidence(domain: string): Promise<SiteEvidence> {
  const { data, erro } = await pageReader(`https://${domain}`);
  const html = data?.html ?? "";
  if (!data || !html) {
    return { cnpjs: [], orgNames: [], ok: false, error: erro ?? "site não retornou conteúdo" };
  }
  const visible = stripHtmlNoise(html).slice(0, 400_000);
  const cnpjs = extractCnpjLiterals(`${visible} ${html.slice(0, 100_000)}`);
  const orgNames = extractJsonLdOrgNames(html);
  const title = data.title ?? /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1] ?? "";
  const ogSite = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,120})["']/i.exec(html)?.[1];
  const names: string[] = [];
  for (const n of [...orgNames, ogSite ?? "", title.replace(/\s+[|\-–·»].*$/u, "").trim()]) {
    const clean = n.trim();
    if (clean && looksLikeCompanyName(clean) && !names.includes(clean)) names.push(clean);
  }
  return { cnpjs: cnpjs.slice(0, 3), orgNames: names.slice(0, 3), ok: true };
}

/* ---------------- Candidatos via busca web com ENTITY_BINDING ---------------- */

export interface CnpjSighting {
  cnpj: string;
  /** binding pré-verificação (coocorrência na página) — null = decide pós-verificação */
  binding: BindingEvidence | null;
  sourceUrl: string | null;
  sourceHost: string | null;
  hostKind: HostKind;
  mentionedEntity: string | null;
}

export interface WebSweep {
  sightings: CnpjSighting[];
  descartados: DiscardedCandidate[];
  transitorio: boolean;
  metodo: string[];
}

const MAX_PAGE_READS = 2;

/**
 * Varredura na web para GERAR candidatos — agora com binding de entidade:
 * - hosts publisher (marketplace/rede social/classificados/notícia) NUNCA geram candidato;
 * - páginas gov/diretório são lidas (máx. 2) para provar que o registro fala DA ENTIDADE;
 * - CNPJ avistado só entra como sighting — o vínculo é decidido pelo gate após a Receita.
 */
export async function sweepWebForCandidates(
  queries: string[],
  clueDomains: string[],
  entityName: string | null
): Promise<WebSweep> {
  const sightings = new Map<string, CnpjSighting>();
  const descartados: DiscardedCandidate[] = [];
  const metodo: string[] = [];
  let transitorio = false;
  const readQueue: { url: string; host: string; kind: HostKind }[] = [];
  const queuedHosts = new Set<string>();

  const isClueDomain = (host: string): boolean =>
    clueDomains.some((d) => host === d || host.endsWith(`.${d}`) || d.endsWith(`.${host}`));

  const upsert = (
    cnpj: string,
    sourceUrl: string | null,
    sourceHost: string | null,
    hostKind: HostKind,
    binding: BindingEvidence | null,
    mentionedEntity: string | null
  ) => {
    const existing = sightings.get(cnpj);
    if (!existing) {
      sightings.set(cnpj, { cnpj, binding, sourceUrl, sourceHost, hostKind, mentionedEntity });
      return;
    }
    if (binding && (!existing.binding || existing.binding.strength === "MODERADA")) {
      existing.binding = binding; // guarda o binding mais forte do sighting
    }
    if (!existing.mentionedEntity && mentionedEntity) existing.mentionedEntity = mentionedEntity;
  };

  for (const query of queries.slice(0, 3)) {
    if (query.trim().length < 4) continue;
    const { items, transitorio: t } = await webSearch(query, 8);
    transitorio = transitorio || t;
    for (const item of items.slice(0, 8)) {
      const url = item.url ?? null;
      const host = (url ? hostnameFromUrl(url) : (item.host_name ?? "").toLowerCase()) || null;
      const kind = classifyHost(host, url);

      // REGRA DO CONTRATO: dono da página ≠ entidade buscada. Publisher nunca gera candidato.
      if (isPublisherHost(kind)) {
        descartados.push({ cnpj: null, host, fonte: url, bindingType: "PAGE_OWNER_ONLY", motivo: publisherMotivo(kind, host) });
        metodo.push(`fonte ${host ?? "?"} descartada (${kind.toLowerCase()} — PAGE_OWNER_ONLY)`);
        continue;
      }

      const haystack = `${item.url ?? ""} ${item.name ?? ""} ${item.snippet ?? ""}`;
      const snippetCnpjs = extractCnpjLiterals(haystack);

      // site oficial da pista: o CNPJ publicado lá é binding FORTE (fluxo do domínio também cobre)
      if (host && isClueDomain(host)) {
        for (const cnpj of snippetCnpjs) {
          upsert(
            cnpj,
            url,
            host,
            kind,
            makeBinding({
              bindingType: "OFFICIAL_SITE",
              sourceUrl: url,
              sourceOwner: host,
              mentionedEntity: entityName,
              bindingEvidence: `Site do domínio da pista (${host}) publica este CNPJ.`,
            }),
            entityName
          );
        }
        continue;
      }

      // gov/diretório: ler a página para provar que o registro trata da entidade buscada
      if (kind === "GOV" || kind === "DIRECTORY") {
        for (const cnpj of snippetCnpjs) upsert(cnpj, url, host, kind, null, item.name ?? null);
        if (readQueue.length < MAX_PAGE_READS && host && !queuedHosts.has(host)) {
          readQueue.push({ url: url ?? `https://${host}`, host, kind });
          queuedHosts.add(host);
        }
        continue;
      }

      // COMPANY/UNKNOWN: CNPJ no snippet é sighting neutro — o gate pós-Receita decide
      for (const cnpj of snippetCnpjs) {
        upsert(cnpj, url, host, kind, null, item.name ?? null);
      }
    }
  }

  // leitura limitada (máx. 2): título da página prova que o registro menciona a entidade
  for (const rq of readQueue) {
    const { data } = await pageReader(rq.url);
    if (!data?.html) continue;
    const title = (data.title ?? "").trim();
    const text = stripHtmlNoise(data.html).slice(0, 300_000);
    const pageCnpjs = extractCnpjLiterals(`${title} ${text}`);
    const mentions = entityName ? titleMentionsEntity(title, entityName) : false;
    metodo.push(
      `página ${rq.host} lida (${rq.kind.toLowerCase()}) — título${mentions ? "" : " NÃO"} menciona a entidade buscada`
    );
    if (!mentions && pageCnpjs.length === 0) continue;
    for (const cnpj of pageCnpjs) {
      const binding = mentions
        ? makeBinding({
            // coocorrência nome↔CNPJ na página: FORÇA MODERADA até a Receita confirmar o nome
            bindingType: rq.kind === "GOV" ? "GOVERNMENT_RECORD" : "BUSINESS_DIRECTORY",
            strength: "MODERADA",
            sourceUrl: rq.url,
            sourceOwner: rq.host,
            mentionedEntity: title || entityName,
            bindingEvidence: `A página (${rq.host}) associa "${title.slice(0, 70) || entityName}" a este CNPJ — força limitada até a confirmação na base oficial.`,
          })
        : null;
      upsert(cnpj, rq.url, rq.host, rq.kind, binding, title || entityName);
    }
  }

  return { sightings: [...sightings.values()], descartados, transitorio, metodo };
}

/* ------------------------------ Resolução ------------------------------ */

const STRENGTH_RANK: Record<EvidenceStrength, number> = {
  MUITO_FORTE: 4,
  FORTE: 3,
  MEDIA: 2,
  BAIXA: 1,
};

interface VerifyOutcome {
  ok: boolean;
  transitorio: boolean;
  data: {
    razaoSocial: string;
    tradeName: string;
    uf: string;
    municipio: string;
    identificador: number | null;
    fonte: string;
    emailDomain: string;
    telefone: string;
    registrationStatus: string;
  } | null;
}

async function verifyCandidate(cnpj: string): Promise<VerifyOutcome> {
  // v0.10.0: verificação passa pela FICHA CADASTRAL sem complementação —
  // candidato só precisa de identidade; reuso dentro do TTL evita repetir HTTP.
  const lk = await lookupCnpjComCache(cnpj, { complementar: false });
  const result = lk.resultado;
  if (result?.ok) {
    return {
      ok: true,
      transitorio: false,
      data: {
        razaoSocial: result.data.legalName,
        tradeName: result.data.tradeName,
        uf: result.data.uf,
        municipio: result.data.municipality,
        identificador: result.data.branchIdentifier,
        fonte: result.source,
        emailDomain: (result.data.extra.email.split("@")[1] ?? "").toLowerCase(),
        telefone: result.data.extra.telefone,
        registrationStatus: result.data.registrationStatus,
      },
    };
  }
  const last = result ?? lk.attempts[lk.attempts.length - 1];
  const transitorio =
    !result && last && !last.ok && ["TIMEOUT", "NETWORK_ERROR", "RATE_LIMITED", "SERVER_ERROR"].includes(last.errorType);
  return { ok: false, transitorio, data: null };
}

/** Pior→melhor força de binding de um candidato (para ordenar a verificação). */
function bindingRank(c: ResolutionCandidate): number {
  let r = 0;
  for (const b of c.bindings) {
    if (b.strength === "FORTE") r = Math.max(r, 3);
    else if (b.strength === "MODERADA") r = Math.max(r, 2);
    else if (b.strength === "FRACA") r = Math.max(r, 1);
  }
  return r;
}

/**
 * O CNPJ confirmado pertence ao DONO/PUBLISHER de alguma fonte? Compara a razão social
 * confirmada com os hosts/org-names das fontes de terceiros. Fontes que são o próprio
 * domínio da pista, o registro.br e bindings "o dono é a empresa" (OFFICIAL_SITE,
 * LEGAL_DISCLOSURE, DOMAIN_REGISTRANT) ficam fora — ali o dono É a empresa buscada.
 */
function candidateOwnerHint(
  cand: ResolutionCandidate,
  razaoSocial: string,
  tradeName: string,
  clueDomains: string[]
): string | null {
  const hints: string[] = [];
  for (const f of cand.fontes) {
    if (!f.url) continue;
    const h = hostnameFromUrl(f.url);
    if (!h) continue;
    if (clueDomains.some((d) => h === d || h.endsWith(`.${d}`) || d.endsWith(`.${h}`))) continue;
    if (h === "registro.br" || h.endsWith(".registro.br")) continue; // fonte oficial do registro, não publisher
    hints.push(h);
  }
  for (const b of cand.bindings) {
    if (b.bindingType === "OFFICIAL_SITE" || b.bindingType === "LEGAL_DISCLOSURE" || b.bindingType === "DOMAIN_REGISTRANT") continue;
    if (b.sourceOwner && !b.sourceOwner.includes("Base oficial")) hints.push(b.sourceOwner);
  }
  for (const hint of [...new Set(hints)]) {
    const hits =
      hint.includes(".")
        ? hostMatchesLegalName(hint, razaoSocial) || (tradeName ? hostMatchesLegalName(hint, tradeName) : false)
        : tokenSimilarity(hint, razaoSocial) >= 0.6 || (tradeName ? tokenSimilarity(hint, tradeName) >= 0.6 : false);
    if (hits) return hint;
  }
  return null;
}

/**
 * Resolve a identidade da empresa a partir das pistas. Determinístico de ponta a ponta:
 * cada candidato só vira "empresa" depois de (a) confirmado na base oficial da Receita e
 * (b) comprovado o VÍNCULO com a pista pelo gate de bindings — CNPJ existente ≠ empresa certa.
 */
export async function resolveIdentity(input: ResolveInput): Promise<IdentityResolution> {
  const { clues } = input;
  const metodo: string[] = [];
  const notas: string[] = [];
  const descartados: DiscardedCandidate[] = [];
  const candidatos = new Map<string, ResolutionCandidate>();
  let transitorio = false;

  const addCandidate = (
    cnpj: string,
    strength: EvidenceStrength,
    fonte: ResolutionSource,
    sinal?: string,
    binding?: BindingEvidence
  ) => {
    const existing = candidatos.get(cnpj);
    if (existing) {
      if (STRENGTH_RANK[strength] > STRENGTH_RANK[existing.strength]) existing.strength = strength;
      if (!existing.fontes.some((f) => f.fonte === fonte.fonte && f.url === fonte.url)) existing.fontes.push(fonte);
      if (sinal && !existing.sinais.includes(sinal)) existing.sinais.push(sinal);
      if (binding && !existing.bindings.some((b) => b.bindingType === binding.bindingType && (b.sourceUrl ?? "") === (binding.sourceUrl ?? ""))) {
        existing.bindings.push(binding);
      }
      return;
    }
    candidatos.set(cnpj, {
      cnpj,
      strength,
      sinais: sinal ? [sinal] : [],
      contradicoes: [],
      fontes: [fonte],
      bindings: binding ? [binding] : [],
      dadosJuridicos: [],
      confirmado: null,
    });
  };

  // ---- 1) CNPJ direto na linha: candidato mais forte possível (a pista É o CNPJ) ----
  if (clues.cnpj) {
    metodo.push("CNPJ na própria linha (DV válido) → consulta direta");
    addCandidate(
      clues.cnpj,
      "MUITO_FORTE",
      { fonte: "CNPJ informado", url: null },
      undefined,
      makeBinding({
        bindingType: "LEGAL_DISCLOSURE",
        sourceOwner: "linha de entrada",
        candidateCnpj: clues.cnpj,
        bindingEvidence: "O CNPJ foi informado na própria pista — a consulta oficial confirma o registro jurídico.",
      })
    );
  }

  // ---- 2) e-mail: domínio corporativo é pista; e-mail pessoal é quase nula ----
  if (clues.emails.length > 0 && clues.disposableEmail) {
    notas.push("E-mail pessoal (gmail/hotmail/…) — pista quase nula para identificar a empresa.");
    metodo.push("e-mail pessoal descartado como pista forte");
  }

  const domain = clues.domains[0] ?? null;

  // ---- 3) domínio: evidência no PRÓPRIO site primeiro (contrato), depois RDAP ----
  if (domain) {
    if (clues.emails.length > 0 && !clues.disposableEmail) {
      metodo.push(`e-mail corporativo → domínio ${domain}`);
    } else if (clues.emails.length === 0) {
      metodo.push(`domínio/site → evidência no próprio domínio ${domain}`);
    }
    const site = await fetchSiteEvidence(domain);
    if (site.ok) {
      for (const cnpj of site.cnpjs) {
        metodo.push("CNPJ literal encontrado no próprio site");
        addCandidate(
          cnpj,
          "MUITO_FORTE",
          { fonte: "Site oficial", url: `https://${domain}`, detalhe: "CNPJ publicado na página" },
          undefined,
          makeBinding({
            bindingType: "OFFICIAL_SITE",
            sourceUrl: `https://${domain}`,
            sourceOwner: domain,
            mentionedEntity: clues.names[0] ?? null,
            candidateCnpj: cnpj,
            bindingEvidence: `O site oficial do domínio da pista (${domain}) publica este CNPJ.`,
          })
        );
      }
      if (site.orgNames.length > 0) {
        // v0.11.0 (homologação Gate 4/C6): nomes colhidos NO PRÓPRIO SITE (JSON-LD/
        // título/og:site_name) são EVIDÊNCIA DE DESCOBERTA, nunca pista do usuário.
        // Antes eles entravam em clues.names e contaminavam a avaliação de identidade:
        // o nome colhido no site da própria candidata sempre "bateria" com a ficha
        // dela (similaridade 1) e aprovava identidade falsa SEM divergência — e o
        // objeto pistas é compartilhado com o motor (mutação por referência), que
        // persistia a versão contaminada em cluesJson. Reproduzido e corrigido.
        metodo.push("identidade do site extraída (JSON-LD/título/og:site_name)");
        if (clues.names.length > 0) {
          const best = Math.max(
            ...clues.names.map((n) => Math.max(...site.orgNames.map((o) => tokenSimilarity(n, o))))
          );
          if (best < 0.25) {
            notas.push(`O site ${domain} se apresenta como "${site.orgNames[0]}" — confira se é a empresa buscada.`);
          }
        }
      }
    } else if (site.error && isTransientMessage(site.error)) {
      transitorio = true;
    }

    // RDAP registro.br: CNPJ do registrante (fonte oficial do .br)
    const rdap = await reverseCnpjFromDomain(domain);
    if (rdap.ok && rdap.cnpj) {
      metodo.push(`registro.br: CNPJ do registrante de ${rdap.queryDomain}`);
      addCandidate(
        rdap.cnpj,
        "FORTE",
        {
          fonte: "RDAP registro.br",
          url: `https://rdap.registro.br/domain/${rdap.queryDomain}`,
          detalhe: rdap.ownerName ? `registrante: ${rdap.ownerName}` : undefined,
        },
        rdap.ownerName ? `registrante declarado: ${rdap.ownerName}` : undefined,
        makeBinding({
          bindingType: "DOMAIN_REGISTRANT",
          sourceUrl: `https://rdap.registro.br/domain/${rdap.queryDomain}`,
          sourceOwner: rdap.ownerName ?? domain,
          candidateCnpj: rdap.cnpj,
          bindingEvidence: `O registro oficial do domínio ${rdap.queryDomain} no registro.br declara este CNPJ como registrante${rdap.ownerName ? ` (${rdap.ownerName})` : ""}.`,
        })
      );
      // v0.11.0 (homologação Gate 4/C6): o nome do registrante é evidência da
      // fonte oficial do DOMÍNIO — não entra em clues.names pelo mesmo motivo dos
      // nomes do site: não é pista do usuário e não pode validar a ficha contra si.
      if (rdap.ownerName) {
        metodo.push(`registrante declarado no registro.br: ${rdap.ownerName.slice(0, 60)}`);
      }
    } else {
      const type = rdap.errorType ?? "";
      if (["TIMEOUT", "NETWORK_ERROR", "SERVER_ERROR", "RATE_LIMITED"].includes(type)) transitorio = true;
      metodo.push(`registro.br sem CNPJ público (${type || "sem resposta"} — segue o fluxo)`);
    }
  }

  // ---- 4) nome: varredura na web com ENTITY_BINDING (nunca confirmação) ----
  const primaryName = clues.names[0] ?? null;
  if (primaryName && candidatos.size < 4) {
    metodo.push(`nome "${primaryName.slice(0, 60)}" → busca na web com vínculo entidade↔CNPJ`);
    const queries = [`"${primaryName}" CNPJ`];
    if (clues.uf) queries.push(`${primaryName} ${clues.uf} CNPJ`);
    if (domain) queries.push(`${domain} CNPJ`);
    const sweep = await sweepWebForCandidates(queries, clues.domains, primaryName);
    transitorio = transitorio || sweep.transitorio;
    metodo.push(...sweep.metodo.slice(0, 6));
    descartados.push(...sweep.descartados);
    for (const s of sweep.sightings) {
      const rotulo =
        s.binding?.bindingType === "OFFICIAL_SITE"
          ? "Site oficial"
          : s.binding?.bindingType === "BUSINESS_DIRECTORY"
            ? "Diretório empresarial"
            : s.binding?.bindingType === "GOVERNMENT_RECORD"
              ? "Fonte governamental"
              : "Busca na web";
      addCandidate(s.cnpj, "BAIXA", { fonte: rotulo, url: s.sourceUrl, detalhe: s.sourceHost ?? undefined }, undefined, s.binding ?? undefined);
    }
    if (sweep.sightings.length === 0) {
      metodo.push("busca na web não retornou CNPJ com vínculo plausível para esta pista");
    }
  }

  // ---- 5) verificação na base oficial + bindings pós-verificação (máx. 4) ----
  const ordered = [...candidatos.values()]
    .sort((a, b) => bindingRank(b) - bindingRank(a) || STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength])
    .slice(0, 4);
  let verifyTransitorio = false;
  const vivos: ResolutionCandidate[] = [];
  for (const cand of ordered) {
    const v = await verifyCandidate(cand.cnpj);
    if (v.ok && v.data) {
      const d = v.data;
      cand.confirmado = {
        razaoSocial: d.razaoSocial,
        uf: d.uf,
        municipio: d.municipio,
        identificador: d.identificador,
        fonte: d.fonte,
      };
      metodo.push(`confirmação na Receita (${d.fonte}): ${formatCnpj(cand.cnpj)} — ${d.razaoSocial.slice(0, 60)}`);

      // ---- dados jurídicos: validam o REGISTRO, nunca o vínculo com a pista ----
      cand.dadosJuridicos.push(
        `Registro localizado na fonte oficial (${d.fonte})`,
        `Situação cadastral: ${d.registrationStatus || "não informada"}`,
        `Sede do registro: ${[d.municipio, d.uf].filter(Boolean).join("/")}`,
        d.identificador === 1
          ? "Estabelecimento é MATRIZ (campo oficial)"
          : d.identificador === 2
            ? "Estabelecimento é FILIAL (campo oficial)"
            : ""
      );

      // ---- a) nome da pista ↔ nome confirmado (decide se "dono da página" é a entidade) ----
      // v0.10.12: similaridade por token + contenção do nome achatado ("RAIADROGASIL" ⊂ "RAIA DROGASIL S/A")
      const bestDeNome = (n: string): number => {
        let s = Math.max(tokenSimilarity(n, d.razaoSocial), d.tradeName ? tokenSimilarity(n, d.tradeName) : 0);
        if (nomeCorresponde(n, d.razaoSocial) || (d.tradeName && nomeCorresponde(n, d.tradeName))) s = Math.max(s, 1);
        return s;
      };
      const best =
        clues.names.length > 0
          ? Math.max(...clues.names.map(bestDeNome))
          : 0;

      // ---- b) PAGE_OWNER_ONLY: o CNPJ é do dono/publisher de alguma fonte → descartar.
      //      Se o dono da página É a entidade buscada (nome da pista bate), a página é
      //      divulgação legal do próprio titular — prova, não descarte (ex.: ri.empresa.com). ----
      const ownerHint = candidateOwnerHint(cand, d.razaoSocial, d.tradeName, clues.domains);
      if (ownerHint && best < 0.6) {
        cand.bindings = [
          makeBinding({
            bindingType: "PAGE_OWNER_ONLY",
            strength: "INVALIDA",
            sourceOwner: ownerHint,
            candidateLegalName: d.razaoSocial,
            candidateCnpj: cand.cnpj,
            bindingEvidence: `O CNPJ pertence a "${d.razaoSocial}" — dono/publisher da fonte (${ownerHint}) — e não à entidade buscada.`,
          }),
        ];
        descartados.push({
          cnpj: cand.cnpj,
          host: ownerHint,
          fonte: cand.fontes[0]?.url ?? null,
          bindingType: "PAGE_OWNER_ONLY",
          motivo: `${formatCnpj(cand.cnpj)} — ${d.razaoSocial.slice(0, 50)}: descartado porque o CNPJ é do dono da página (${ownerHint}), não da empresa buscada.`,
        });
        metodo.push(`descartado ${formatCnpj(cand.cnpj)} (${d.razaoSocial.slice(0, 40)}): CNPJ do publisher da fonte — PAGE_OWNER_ONLY`);
        continue;
      }
      if (ownerHint) {
        cand.bindings.push(
          makeBinding({
            bindingType: "LEGAL_DISCLOSURE",
            sourceUrl: cand.fontes[0]?.url ?? null,
            sourceOwner: ownerHint,
            candidateLegalName: d.razaoSocial,
            candidateCnpj: cand.cnpj,
            bindingEvidence: `A página (${ownerHint}) pertence ao próprio titular ("${d.razaoSocial.slice(0, 60)}") e publica este CNPJ.`,
          })
        );
      }

      // ---- c) DOMAIN_REGISTRANT decisivo: o registrante do domínio da pista é a própria
      //      empresa confirmada → identidade MUITO_FORTE (para pista de domínio/e-mail) ----
      const rdapBinding = cand.bindings.find((b) => b.bindingType === "DOMAIN_REGISTRANT");
      if (
        rdapBinding?.sourceOwner &&
        (tokenSimilarity(rdapBinding.sourceOwner, d.razaoSocial) >= 0.6 ||
          (d.tradeName && tokenSimilarity(rdapBinding.sourceOwner, d.tradeName) >= 0.6) ||
          hostMatchesLegalName(rdapBinding.sourceOwner, d.razaoSocial))
      ) {
        cand.strength = "MUITO_FORTE";
        cand.sinais.push("o registrante do domínio da pista é a própria empresa confirmada");
      }

      // ---- d) binding pós-verificação: nome (razão social OU fantasia) na base oficial ----
      if (clues.names.length > 0 && best >= 0.6) {
        const viaTrade = !clues.names.some((n) => tokenSimilarity(n, d.razaoSocial) >= 0.6);
        const localOk = !clues.uf || d.uf.toUpperCase() === clues.uf;
        cand.bindings.push(
          makeBinding({
            bindingType: "GOVERNMENT_RECORD",
            strength: localOk ? "FORTE" : "FRACA",
            sourceOwner: "Base oficial da Receita (BrasilAPI → OpenCNPJ → ReceitaWS)",
            mentionedEntity: clues.names[0],
            candidateLegalName: d.razaoSocial,
            candidateCnpj: cand.cnpj,
            bindingEvidence: localOk
              ? `A base oficial da Receita registra este CNPJ com ${viaTrade ? `nome fantasia compatível com a pista ("${d.tradeName.slice(0, 60)}")` : `razão social compatível com a pista ("${d.razaoSocial.slice(0, 60)}")`}${clues.uf ? ` e a UF coincide (${d.uf})` : ""}.`
              : `Nome compatível ("${(viaTrade ? d.tradeName : d.razaoSocial).slice(0, 60)}"), mas o registro está em ${d.uf} e a pista indica ${clues.uf}.`,
          })
        );
        cand.sinais.push(
          `${viaTrade ? "nome fantasia" : "nome"} compatível com a pista ("${(viaTrade ? d.tradeName : d.razaoSocial).slice(0, 60)}")`
        );
      } else if (clues.names.length > 0 && best < 0.35) {
        // v0.11.0: sem nome de pista não há o que comparar — a contradição de nome
        // só faz sentido quando o USUÁRIO forneceu um nome (pista de domínio/e-mail
        // pura não gera "nome sem relação").
        // v0.10.12: similaridade ZERO agora É registrada (antes a condição `best > 0` ignorava
        // exatamente o caso mais grave: nome da pista sem NENHUMA relação com o cadastro).
        cand.contradicoes.push(
          best === 0
            ? "nome da pista não tem nenhuma relação com o nome registrado (similaridade zero)"
            : "razão social pouco parecida com o nome da pista"
        );
      }
      if (clues.uf && d.uf) {
        if (clues.uf === d.uf.toUpperCase()) {
          cand.sinais.push(`UF coincide (${clues.uf})`);
        } else {
          cand.contradicoes.push(`UF da pista (${clues.uf}) difere do cadastro (${d.uf})`);
        }
      }
      if (domain && d.emailDomain) {
        if (d.emailDomain === domain || d.emailDomain.endsWith(`.${domain}`) || domain.endsWith(`.${d.emailDomain}`)) {
          cand.bindings.push(
            makeBinding({
              bindingType: "SAME_EMAIL_DOMAIN",
              sourceOwner: "Base oficial da Receita",
              candidateLegalName: d.razaoSocial,
              candidateCnpj: cand.cnpj,
              bindingEvidence: `O e-mail público do registro usa o domínio da pista (${domain}).`,
            })
          );
          cand.sinais.push(`e-mail público no domínio da pista (${domain})`);
        } else {
          cand.contradicoes.push(`e-mail público da empresa (${d.emailDomain}) difere do domínio da pista`);
        }
      }
      if (clues.phones.length > 0 && d.telefone) {
        const receitaParts = d.telefone.split(/[/|,]/).map((p) => p.replace(/\D/g, ""));
        const match = clues.phones.find((p) =>
          receitaParts.some((r) => r.length >= 8 && (r === p || r.endsWith(p.slice(-8)) || p.endsWith(r.slice(-8))))
        );
        if (match) {
          cand.bindings.push(
            makeBinding({
              bindingType: "SAME_PHONE",
              sourceOwner: "Base oficial da Receita",
              candidateLegalName: d.razaoSocial,
              candidateCnpj: cand.cnpj,
              bindingEvidence: "O telefone do registro oficial coincide com o telefone da pista.",
            })
          );
          cand.sinais.push("telefone do registro coincide com a pista");
        }
      }

      vivos.push(cand);
    } else if (v.transitorio) {
      verifyTransitorio = true;
    } else {
      metodo.push(`candidato ${formatCnpj(cand.cnpj)} não existe na base oficial — descartado`);
      descartados.push({
        cnpj: cand.cnpj,
        host: null,
        fonte: cand.fontes[0]?.url ?? null,
        bindingType: "UNRELATED",
        motivo: `${formatCnpj(cand.cnpj)} descartado: CNPJ não existe nas fontes oficiais.`,
      });
    }
  }
  transitorio = transitorio || verifyTransitorio;

  // ---- 6) gate de vínculo + decisão (por evidência, nunca por modelo) ----
  const gates = new Map(vivos.map((c) => [c.cnpj, evaluateBindingGate(c.bindings)]));
  const promotable = vivos.filter((c) => gates.get(c.cnpj)?.promotable);
  const reviewable = vivos.filter(
    (c) => !gates.get(c.cnpj)?.promotable && c.bindings.some((b) => b.strength === "FRACA" || b.strength === "MODERADA")
  );
  for (const c of vivos) {
    const g = gates.get(c.cnpj);
    if (g?.promotable || reviewable.includes(c)) continue;
    descartados.push({
      cnpj: c.cnpj,
      host: c.fontes[0]?.url ? hostnameFromUrl(c.fontes[0].url) : null,
      fonte: c.fontes[0]?.url ?? null,
      bindingType: "UNRELATED",
      motivo: `${formatCnpj(c.cnpj)} — ${c.confirmado?.razaoSocial.slice(0, 50) ?? ""}: existe na base oficial, mas nenhuma fonte comprova vínculo com a pista ("o termo apareceu na página" não é vínculo).`,
    });
  }

  const muitoFortes = promotable.filter((c) => c.strength === "MUITO_FORTE");

  // ---- v0.10.12: divergência de nome NÃO confirma identidade por si só ----
  // Um candidato com nome da pista sem relação (similaridade < 0.35) e SEM prova de domínio
  // (site do próprio domínio ou RDAP registro.br) vai para REVISÃO com o cadastro PRESERVADO:
  // o operador decide se é a empresa certa. "O termo apareceu" nunca confirma identidade.
  const dominioProvaVinculo = (c: ResolutionCandidate): boolean =>
    c.bindings.some((b) => b.bindingType === "OFFICIAL_SITE" || b.bindingType === "DOMAIN_REGISTRANT");
  const nomeDivergente = (c: ResolutionCandidate): boolean => {
    if (clues.names.length === 0 || !c.confirmado) return false;
    const best = Math.max(...clues.names.map((n) => {
      let s = tokenSimilarity(n, c.confirmado!.razaoSocial);
      if (nomeCorresponde(n, c.confirmado!.razaoSocial)) s = Math.max(s, 1);
      return s;
    }));
    return best < 0.35;
  };
  const divergentesSemProva = new Set(
    promotable.filter((c) => c.confirmado && nomeDivergente(c) && !dominioProvaVinculo(c)).map((c) => c.cnpj)
  );
  const efetivamentePromotaveis = promotable.filter((c) => !divergentesSemProva.has(c.cnpj));
  if (divergentesSemProva.size > 0) {
    for (const c of promotable) {
      if (!divergentesSemProva.has(c.cnpj)) continue;
      const nota = `Registro localizado (${formatCnpj(c.cnpj)} — ${c.confirmado?.razaoSocial.slice(0, 60) ?? ""}), mas o nome da pista não tem relação com o cadastro e nenhuma fonte oficial provou o vínculo — revisão humana necessária. O registro permanece disponível para revisão.`;
      if (!notas.includes(nota)) notas.push(nota);
      metodo.push(`decisão: REVIEW para ${formatCnpj(c.cnpj)} — nome divergente sem prova de vínculo (registro preservado)`);
    }
  }

  let estado: ResolutionState;
  let confianca: EvidenceStrength | null;
  let escolhido: string | null = null;

  if (muitoFortes.length === 1 && !divergentesSemProva.has(muitoFortes[0].cnpj)) {
    estado = "CONFIRMED";
    confianca = "MUITO_FORTE";
    escolhido = muitoFortes[0].cnpj;
  } else if (muitoFortes.length > 1) {
    // dois CNPJs muito fortes distintos (ex.: site publica um, RDAP outro) — humano decide
    estado = "REVIEW";
    confianca = null;
    notas.push("Dois CNPJs fortes diferentes aparecem na evidência — revisão humana necessária.");
  } else if (efetivamentePromotaveis.length === 1) {
    estado = "CONFIRMED";
    confianca = gates.get(efetivamentePromotaveis[0].cnpj)?.base === "FORTE" ? "FORTE" : "MEDIA";
    escolhido = efetivamentePromotaveis[0].cnpj;
  } else if (efetivamentePromotaveis.length > 1) {
    const roots = new Set(efetivamentePromotaveis.map((c) => c.cnpj.slice(0, 8)));
    if (roots.size === 1) {
      // mesma raiz = mesma empresa, estabelecimentos diferentes: prefere a matriz oficial
      const matriz = efetivamentePromotaveis.find((c) => c.confirmado?.identificador === 1) ?? efetivamentePromotaveis[0];
      estado = "CONFIRMED";
      confianca = gates.get(matriz.cnpj)?.base === "FORTE" ? "FORTE" : "MEDIA";
      escolhido = matriz.cnpj;
      matriz.sinais.push(`${plural(efetivamentePromotaveis.length, "estabelecimento", "estabelecimentos")} da mesma raiz confirmados na base oficial`);
      if (matriz.confirmado?.identificador !== 1) {
        notas.push("Candidatos pertencem à mesma empresa (estabelecimentos diferentes) — escolhido o primeiro confirmado.");
      }
    } else {
      estado = "REVIEW";
      confianca = null;
      notas.push("Mais de uma empresa diferente comprovou vínculo com a pista — revise.");
    }
  } else if (reviewable.length >= 1) {
    estado = "REVIEW";
    confianca = "BAIXA";
    notas.push("Candidato existe na base oficial, mas o vínculo com a pista não está comprovado — decidir manualmente.");
  } else if (divergentesSemProva.size > 0) {
    // v0.10.12: só havia candidato(s) com nome divergente sem prova de vínculo —
    // REVISÃO com o registro preservado (nunca UNRESOLVED escondendo o cadastro localizado).
    estado = "REVIEW";
    confianca = "BAIXA";
  } else {
    estado = "UNRESOLVED";
    confianca = null;
    if (candidatos.size === 0) {
      notas.push("Nenhum candidato a empresa foi encontrado para esta pista.");
    } else {
      notas.push(
        "Nenhum CNPJ comprovou vínculo com a pista: os encontrados pertenciam aos donos das páginas (marketplace/notícia/classificado) ou não têm relação com a entidade buscada. Melhor não resolver do que resolver errado."
      );
    }
  }

  if (estado === "CONFIRMED") metodo.push(`decisão: CONFIRMED (confiança ${confianca}) pela evidência`);
  else if (estado === "REVIEW") metodo.push("decisão: REVIEW — evidência insuficiente ou ambígua, segue para revisão");
  else metodo.push("decisão: UNRESOLVED — pista insuficiente");

  return {
    estado,
    confianca,
    metodo,
    notas,
    candidatos: [...promotable, ...reviewable],
    descartados,
    escolhido,
    pistas: clues,
    transitorio: transitorio && vivos.length === 0,
  };
}

/* ------------------------------ Matriz ------------------------------ */

export interface MatrizResolution {
  root: string | null;
  foundIsHeadquarters: boolean | null;
  headquartersCnpj: string | null;
  status: "RESOLVIDA" | "NAO_LOCALIZADA";
  metodo: string[];
}

/**
 * Localiza a matriz a partir do CNPJ ENCONTRADO, usando SEMPRE o campo oficial
 * identificador_matriz_filial = 1. O sufixo "0001" é apenas uma hipótese a verificar —
 * com o CNPJ alfanumérico (2026) a associação 0001=matriz não é permanente.
 */
export async function resolveMatriz(cnpjFound: string, identifier: number | null | undefined): Promise<MatrizResolution> {
  const digits = normalizeCnpj(cnpjFound);
  const root = digits.length === 14 ? digits.slice(0, 8) : null;
  const metodo: string[] = [];

  if (identifier === 1) {
    metodo.push("campo oficial identificador_matriz_filial=1: o CNPJ encontrado É a matriz");
    return { root, foundIsHeadquarters: true, headquartersCnpj: digits, status: "RESOLVIDA", metodo };
  }

  if (!root) {
    metodo.push("CNPJ sem 14 dígitos — matriz não pesquisável");
    return { root, foundIsHeadquarters: null, headquartersCnpj: null, status: "NAO_LOCALIZADA", metodo };
  }

  // hipótese a verificar: primeiro estabelecimento da raiz ("0001") — o campo oficial decide
  const candidate = cnpjFromRoot(root, "0001");
  if (!candidate) {
    metodo.push("sem candidato verificável de matriz para esta raiz");
    return { root, foundIsHeadquarters: identifier === 2 ? false : null, headquartersCnpj: null, status: "NAO_LOCALIZADA", metodo };
  }
  if (candidate === digits) {
    // o próprio encontrado ocupa a ordem 0001 mas o campo oficial diz que não é matriz
    // (possível desde o CNPJ alfanumérico de 2026) — sem varredura de 9999 ordens: honesto.
    metodo.push(
      "o estabelecimento encontrado ocupa a ordem 0001 e o campo oficial diz não ser matriz — matriz precisa do cadastro completo de estabelecimentos da raiz"
    );
    return { root, foundIsHeadquarters: false, headquartersCnpj: null, status: "NAO_LOCALIZADA", metodo };
  }

  metodo.push(
    `encontrado é ${identifier === 2 ? "filial" : "de tipo desconhecido"} — verificando matriz candidata ${formatCnpj(candidate)} na base oficial`
  );
  // v0.10.0: matriz passa pela FICHA CADASTRAL (reuso dentro do TTL evita repetir HTTP
  // para a mesma matriz em várias filiais do lote; expirada → revalida)
  const lk = await lookupCnpjComCache(candidate);
  const result = lk.resultado;
  if (result?.ok && result.data.branchIdentifier === 1) {
    metodo.push(`matriz confirmada pelo campo oficial (identificador=1): ${result.data.legalName.slice(0, 60)}`);
    return { root, foundIsHeadquarters: false, headquartersCnpj: candidate, status: "RESOLVIDA", metodo };
  }
  if (result?.ok) {
    metodo.push(`matriz candidata existe mas o campo oficial diz identificador=${result.data.branchIdentifier ?? "?"} — matriz NÃO presumida`);
  } else {
    metodo.push("matriz candidata não localizada nas fontes públicas");
  }
  return { root, foundIsHeadquarters: identifier === 2 ? false : null, headquartersCnpj: null, status: "NAO_LOCALIZADA", metodo };
}
