/**
 * research_packet — pacote de pesquisa da conta (o que alimenta a síntese profunda).
 *
 * Arquitetura do motor de investigação (nível 2, on-demand por conta priorizada):
 *   1. DESCUBRIR o site oficial (pista do lote, e-mail público ou busca web);
 *   2. RASTREAR o site oficial: homepage + páginas-chave (sobre, produtos, contato,
 *      blog/unidades) — NÃO fica só na página inicial;
 *   3. BUSCAR na web: atividade, produtos, notícias, sinais de tecnologia;
 *   4. MONTAR o pacote com trechos + URLs de origem — a síntese do modelo acontece
 *      SOMENTE DEPOIS, sobre este pacote (GLM não pesquisa magicamente).
 *
 * Cobertura barata: crawler próprio via resolve-service (page_reader + web_search
 * com rate limit). Busca agentic não é usada aqui — pacote determinístico e auditável.
 *
 * v0.9.0 — PESQUISA ADAPTATIVA (experimento controlado):
 *   modo COMPLETO   = pipeline A→E integral (comportamento anterior, preservado como comparação);
 *   modo ADAPTATIVO = nível 0 (cadastro, 0 buscas) → nível 1 (dirigida: presença + identidade
 *                     + tecnologia) → nível 2 (SÓ quando há lacuna de identidade/grupo/escala/
 *                     tecnologia/período, com MOTIVO registrado por consulta).
 *   Dedupe semântico de consultas e páginas entre etapas; métricas por pacote. Economia
 *   NÃO é anunciada sem experimento comparável (contrato).
 */
import type { ResearchPacketInput } from "./ai";
import { fetchNewsRss, extractPorteSignals, prioritizeNews, type NewsItem } from "./news";
import { recordTelemetry } from "@/lib/telemetry";
import { plural } from "@/lib/linguagem";
import type { CnpjSocio } from "../enrich/sources";

const RESOLVE_SERVICE_URL = process.env.RESOLVE_SERVICE_URL ?? "http://127.0.0.1:3030";

/* ------------------------------ Ponte para o resolve-service ------------------------------ */

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

async function callService(path: string, body: Record<string, unknown>, timeoutMs = 35_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

/**
 * Busca pública com rastreio de COTA (P0-06): recusa por limite (429/QUOTA) NÃO é
 * "busca sem resultados" — é pesquisa incompleta. O contador viaja no pacote e a nota
 * explícita impede a síntese de concluir ausência de fonte sob cota esgotada.
 * G5 (auditoria v0.6.1): só conta recusa FINAL — a tentativa que deu 429 e foi
 * recuperada pelo retry de 15s NÃO soma (a busca foi executada; contar as duas
 * tentativas inflaria/duplicaria o número de buscas recusadas).
 */
interface QuotaStats {
  recusadasCota: number;
}
async function webSearch(query: string, num = 5, stats?: QuotaStats): Promise<SearchItem[]> {
  // 429 do gateway (janela de minutos): espera 15s e tenta UMA vez — busca engolida
  // em silêncio deixaria o packet raso (paginas 0 / buscas 0) sem explicação.
  const t0 = Date.now();
  for (let i = 0; i < 2; i++) {
    try {
      const res = await callService("/web-search", { query, num });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: SearchItem[]; error?: string; code?: string; upstream_status?: number };
      // v0.10.4: origem da recusa — LIMITE LOCAL (janela do resolve-service, code QUOTA)
      // ≠ 429 EFETIVO DO PROVEDOR (upstream_status preservado) ≠ menção no texto (legado)
      const limiteLocal = json.code === "QUOTA";
      const quatroProvedor = typeof json.upstream_status === "number" ? json.upstream_status === 429 : null;
      const recusaCota = res.status === 429 || json.code === "QUOTA" || /cota|too many|rate.?limit|429/i.test(json.error ?? "");
      if (res.ok && json.ok) {
        const items = Array.isArray(json.items) ? json.items : [];
        recordTelemetry({
          tipo: "WEB_SEARCH",
          fonte: "z-ai-web_search (via resolve-service)",
          operacao: "busca_web",
          alvo: query,
          httpStatus: res.status,
          tentativas: i + 1,
          cacheHit: false,
          resultados: items.length,
          // "aproveitáveis" = itens com URL e título (insumo real para o pacote)
          aproveitaveis: items.filter((it) => (it.url ?? "").length > 0 && (it.name ?? it.snippet ?? "").length > 0).length,
          duracaoMs: Date.now() - t0,
          estadoFinal: items.length === 0 ? "parcial" : "sucesso",
          payload: { sem_resultados: items.length === 0 },
        });
        return items;
      }
      if (recusaCota && i === 0) {
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }
      if (recusaCota && stats) stats.recusadasCota++; // recusa FINAL: conta 1× (nunca por tentativa)
      recordTelemetry({
        tipo: "WEB_SEARCH",
        fonte: "z-ai-web_search (via resolve-service)",
        operacao: "busca_web",
        alvo: query,
        httpStatus: res.status,
        erro: recusaCota ? "recusa por cota (429/QUOTA)" : json.error ?? `serviço respondeu ${res.status}`,
        tentativas: i + 1,
        cacheHit: false,
        resultados: 0,
        duracaoMs: Date.now() - t0,
        // P0-06: recusa por cota é PESQUISA INCOMPLETA — estado distinto de "sem resultados"
        estadoFinal: recusaCota ? "bloqueado" : "falha",
        // v0.10.4: origem da recusa registrada no payload — o diagnóstico classifica
        // limite_local / 429_provedor / menção-sem-status SEM adivinhar
        payload: {
          recusada_cota: recusaCota,
          origem_recusa: limiteLocal ? "limite_local" : quatroProvedor === true ? "429_provedor" : "indeterminada",
          upstream_status: json.upstream_status ?? null,
        },
      });
      return [];
    } catch (err) {
      recordTelemetry({
        tipo: "WEB_SEARCH",
        fonte: "z-ai-web_search (via resolve-service)",
        operacao: "busca_web",
        alvo: query,
        erro: err instanceof Error ? err.message : String(err),
        tentativas: i + 1,
        cacheHit: false,
        resultados: 0,
        duracaoMs: Date.now() - t0,
        estadoFinal: "falha",
      });
      return [];
    }
  }
  return [];
}

async function pageReader(url: string): Promise<PageReaderData | null> {
  const t0 = Date.now();
  try {
    const res = await callService("/page-reader", { url });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      recordTelemetry({
        tipo: "PAGE_READER",
        fonte: "z-ai-page_reader (via resolve-service)",
        operacao: "leitura_pagina",
        alvo: url,
        httpStatus: res.status,
        erro: json.error ?? `serviço respondeu ${res.status}`,
        tentativas: 1,
        cacheHit: false,
        resultados: 0,
        duracaoMs: Date.now() - t0,
        estadoFinal: json.code === "DNS_FAIL" ? "falha" : res.status === 429 ? "bloqueado" : "falha",
      });
      return null;
    }
    const json = (await res.json()) as { ok?: boolean; data?: PageReaderData | null };
    const data = json.data ?? null;
    recordTelemetry({
      tipo: "PAGE_READER",
      fonte: "z-ai-page_reader (via resolve-service)",
      operacao: "leitura_pagina",
      alvo: url,
      httpStatus: res.status,
      tentativas: 1,
      cacheHit: false,
      resultados: data ? 1 : 0,
      // aproveitável = texto útil suficiente (não apenas boilerplate)
      aproveitaveis: data && (data.html ?? "").length > 200 ? 1 : 0,
      duracaoMs: Date.now() - t0,
      estadoFinal: data ? "sucesso" : "falha",
      motivoDescarte: data ? null : "página sem conteúdo",
      payload: data ? { titulo: (data.title ?? "").slice(0, 200), htmlChars: (data.html ?? "").length } : null,
    });
    return data;
  } catch (err) {
    recordTelemetry({
      tipo: "PAGE_READER",
      fonte: "z-ai-page_reader (via resolve-service)",
      operacao: "leitura_pagina",
      alvo: url,
      erro: err instanceof Error ? err.message : String(err),
      tentativas: 1,
      cacheHit: false,
      resultados: 0,
      duracaoMs: Date.now() - t0,
      estadoFinal: "falha",
    });
    return null;
  }
}

/* ------------------------------ HTML → texto útil ------------------------------ */

/** Remove scripts/estilos/tags e colapsa espaço — texto legível para o pacote. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n· ")
    .replace(/<h([1-6])[^>]*>/gi, "\n\n## ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&atilde;/gi, "ã")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&circ;/gi, "^")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Extrai links da homepage (href) resolvidos contra o domínio — para escolher páginas-chave. */
function extractInternalLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || /^(mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const u = new URL(raw, base);
      if (u.hostname !== base.hostname) continue;
      u.hash = "";
      out.add(u.toString());
    } catch {
      /* link malformado — ignora */
    }
  }
  return [...out].slice(0, 80);
}

/** Páginas-chave por palavra-chave no path — o crawler não fica na homepage. */
const PAGE_TARGETS: { tipo: string; re: RegExp }[] = [
  { tipo: "sobre", re: /(sobre|quem-somos|quemsomos|empresa|historia|hist[oó]ria|institucional|a-empresa)/i },
  { tipo: "produtos", re: /(produto|solu[cç][oõ]es|servi[cç]os|portfolio|linhas|cat[aá]logo|marca)/i },
  { tipo: "contato", re: /(contato|fale-conosco|atendimento|onde-estamos|unidades|filiais|rede)/i },
  { tipo: "blog", re: /(blog|not[ií]cias|novidades|imprensa|eventos|informativo)/i },
];

function pickKeyPages(links: string[]): { url: string; tipo: string }[] {
  const picked: { url: string; tipo: string }[] = [];
  const used = new Set<string>();
  for (const target of PAGE_TARGETS) {
    const hit = links.find(
      (l) => !used.has(l) && l.replace(/\/$/, "").split("/").length <= 5 && target.re.test(l)
    );
    if (hit && picked.length < 4) {
      picked.push({ url: hit, tipo: target.tipo });
      used.add(hit);
    }
  }
  return picked;
}

/** Detecta sinais de presença digital operacional no HTML (portais, e-commerce, área do cliente). */
function detectDigitalSignals(html: string): string[] {
  const signals: string[] = [];
  const text = html.toLowerCase();
  if (/portal|area do cliente|[áa]rea do cliente|login|meu painel|autoatendimento/.test(text)) {
    signals.push("presença de portal/área do cliente no site");
  }
  if (/loja virtual|e-?commerce|carrinho|comprar online/.test(text)) {
    signals.push("indício de canal de vendas online");
  }
  if (/vagas|trabalhe conosco|carreiras/.test(text)) {
    signals.push("página de carreiras/vagas no site");
  }
  return signals;
}

/* ------------------------------ Domínio ------------------------------ */

const DIRECTORY_HOSTS =
  /(linkedin\.com|facebook\.com|instagram\.com|youtube\.com|twitter\.com|x\.com|tiktok\.com|wa\.me|whatsapp\.com|gov\.br|\.gov\b|wikipedia\.org|mercadolivre\.com|aliexpress\.com|reclameaqui\.com\.br|indeed\.com|glassdoor\.com|cnpj\.com\.br|casadosdados\.com\.br|consultacnpj\.com|empresaqui\.com\.br|cnpjbiz\.com|localcnpj\.com|empresascnpj\.com|brazilcnpj\.com|cnpj\.site|infocnpj\.com|cnj\.com\.br|updatestar\.com|softonic\.|sourceforge\.net|cnet\.com|download\.com|filehorse|fileplanet|softpedia|majorgeeks|zoom\.com\.br|apontador\.com\.br|guiamais\.com\.br|solutudo\.com\.br|nearin\.com|infobel\.com|econodata\.com\.br|encontre-cnpj|consultasocio|hcnpj\.com|cnpj\.biz|netsonda|amelhorplaca|empresabr\.com|portal-empresas)/i;
// v0.9.0: lista estendida com agregadores de SOFTWARE (caso Brasil Digital: domínio
// de updatestar.com não é site oficial) e listas telefônicas/diretórios comerciais.

export function hostFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0] ?? "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return null;
  return t.toLowerCase();
}

function cleanName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/\s+(ltda|limitada|s\/a|sociedade an[oô]nima|eireli|me|mei|epp|\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}).*$/i, "")
    .replace(/[^\p{L}\p{N}\s&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Nome fantasia confiável para BUSCA? Descritores legados do cadastro
 * (ex.: "PETROBRAS - EDISE" — caso real da matriz Petrobras) poluem todas
 * as queries e derrubam o packet para 0 resultados. Regras de rejeição:
 * contém " - ", muito curto, ou tokens ⊆ razão social (não agrega).
 */
function usableFantasia(tradeName: string | null, legalName: string | null): string | null {
  const t = cleanName(tradeName);
  if (!t || t.length < 4) return null;
  if (/[-–—]/.test(t)) return null;
  const lt = new Set((legalName ?? "").toUpperCase().normalize("NFD").replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((x) => x.length > 1));
  const tt = t.toUpperCase().split(/\s+/).filter((x) => x.length > 1);
  if (tt.length > 0 && tt.every((tok) => lt.has(tok))) return null;
  return t;
}

/** Nome oficial para BUSCAS: fantasia válida, senão razão social limpa. */
function searchNameFor(tradeName: string | null | undefined, legalName: string | null | undefined): string {
  return usableFantasia(tradeName ?? null, legalName ?? null) ?? cleanName(legalName);
}

/** Prefixos genéricos do cadastro — NÃO identificam marca (não viram busca por variante). */
const GENERIC_PREFIXES = [
  "LTD", "LIMITAD", "SA", "SOCIEDAD", "ME", "MEI", "EPP", "EIREL", "COMERCIO", "INDUSTRI", "SERVIC",
  "AGRICOL", "AGROPECUARI", "AGROPASTORIL", "AGROINDUSTRI", "SEMENT", "EMPRES", "DISTRIBUT",
  "TRANSPORTE", "TRANSPORT", "CONSTRU", "MADEIR", "FUNDAC", "CENTRO", "EDUCACION", "ESCOL",
  "COOPER", "GRUPO", "PARTICIP", "INSTITUTO", "ASSOCIAC", "REPRESENT",
];
function isGenerico(t: string): boolean {
  const n = normToken(t).toUpperCase();
  return GENERIC_PREFIXES.some((g) => n.startsWith(g));
}
function normToken(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Extrai token(s) de MARCA do nome jurídico/fantasia — palavras RARAS que identificam
 * a empresa (v0.9.0, golden Jotabasso: "SEMENTES JOTABASSO LTDA" → "Jotabasso";
 * "AGROPASTORIL JOTABASSO LTDA" → "Jotabasso"). A busca por variante de marca ajuda a
 * desambiguar entidades da mesma família SEM transferir evidência de uma para outra.
 */
export function brandTokens(legalName: string | null | undefined, tradeName: string | null | undefined): string[] {
  const raw = (legalName ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  const raras = raw.filter((t) => !isGenerico(t));
  const out = new Set<string>();
  const fantasia = usableFantasia(tradeName ?? null, legalName ?? null);
  if (fantasia) out.add(cleanName(fantasia));
  for (const r of raras.slice(0, 2)) out.add(r);
  // nunca devolver token que É o nome de busca inteiro (não agrega variante)
  const searchName = normToken(searchNameFor(tradeName ?? null, legalName ?? null)).toUpperCase();
  return [...out].filter((t) => t.length >= 3 && normToken(t).toUpperCase() !== searchName).slice(0, 2);
}

/** Tokens RAROS do nome/marca (sem acento, minúsculo) — filtro de relevância contra ruído
 *  de busca genérica (homepages de fornecedor, homônimos de outros países etc.). */
function tokensEmpresaRaros(name: string, marcas: string[]): string[] {
  const base = normToken(name)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !isGenerico(t));
  const extra = marcas.map((m) => normToken(m).toLowerCase()).filter((t) => t.length >= 3);
  return [...new Set([...base, ...extra])];
}

/** Resultado só é aproveitável se cita um token raro da empresa/marca em título ou snippet.
 *  Tokens curtos (<5) exigem fronteira de palavra: "lar" NÃO pode casar dentro de
 *  "particular" (ruído real do golden Lar — r/Reddit "in particular safe"). */
function resultadoRelevante(r: { titulo: string; snippet: string }, tokens: string[]): boolean {
  if (tokens.length === 0) return true; // sem tokens raros, não filtra (recall primeiro)
  const hay = normToken(`${r.titulo} ${r.snippet}`).toLowerCase();
  return tokens.some((t) => {
    if (t.length >= 5) return hay.includes(t);
    const re = new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`);
    return re.test(hay);
  });
}

/**
 * Descobre o domínio provável: pista do lote → e-mail público → busca web.
 * Cada descoberta é honesta: devolvemos o método junto (nota no pacote).
 */
async function discoverDomain(opts: {
  referenceValue: string | null;
  email: string | null;
  legalName: string | null;
  tradeName: string | null;
}, stats?: QuotaStats): Promise<{ dominio: string | null; metodo: string | null }> {
  const fromRef = hostFromUrl(opts.referenceValue ?? undefined);
  if (fromRef) return { dominio: fromRef, metodo: "pista do lote" };
  const emailHost = opts.email?.split("@")[1];
  if (emailHost && !/(gmail|hotmail|outlook|yahoo|bol|uol|terra|icloud)\./i.test(emailHost)) {
    const h = hostFromUrl(emailHost);
    if (h) return { dominio: h, metodo: "e-mail público do cadastro" };
  }
  const name = searchNameFor(opts.tradeName, opts.legalName);
  if (name.length >= 4) {
    const items = await webSearch(`"${name}" site oficial`, 6, stats);
    // P1-07 (auditoria): domínio do 1º resultado não-diretório NÃO é "site oficial" —
    // validar ao menos a correspondência de nome entre a empresa e o resultado.
    const tokens = name
      .toLowerCase()
      .replace(/[^a-z0-9à-ú\s]/gi, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    const hit = items.find((i) => {
      const u = i.url ?? "";
      const host = hostFromUrl(u.replace(/^https?:\/\//i, ""));
      return host && !DIRECTORY_HOSTS.test(host);
    });
    const host = hit ? hostFromUrl(hit.url ?? "") : null;
    if (host) {
      const haystack = `${hit?.name ?? ""} ${hit?.snippet ?? ""}`.toLowerCase();
      const nomeCompativel = tokens.some((t) => haystack.includes(t));
      return {
        dominio: host,
        metodo: nomeCompativel
          ? "busca pública — nome da empresa aparece no resultado (indício com nome compatível; confirmar propriedade do domínio)"
          : "busca pública (INDÍCIO FRACO — resultado sem correspondência de nome; NÃO declarar site oficial sem prova)",
      };
    }
  }
  return { dominio: null, metodo: null };
}

/* ------------------------------ Pacote ------------------------------ */

export interface ResearchPacket extends ResearchPacketInput {
  /** página inicial usada (ou tentativa) — para auditoria */
  homeTentada: string | null;
  /** sinais digitais determinísticos detectados no HTML do site */
  sinaisDigitais: string[];
  /** notícias da imprensa (Google News RSS) — mapeia a empresa POR NOME */
  noticias: NewsItem[];
  /** sinais de PORTE REAL extraídos de snippets/notícias (headcount, faturamento, frota, unidades) */
  sinaisPorte: string[];
  /** buscas de teia societária executadas (sócios como chave) */
  teiaBuscada: string[];
  /** quantas páginas lidas com sucesso / tentadas */
  paginasOk: number;
  paginasTentadas: number;
  /** consultas web executadas / planejadas */
  buscasOk: number;
  /** P0-06 (auditoria): buscas NÃO executadas por limite de cota — a ausência de
   * evidência sob cota esgotada NÃO é conclusiva; a síntese é proibida de fechar lacuna. */
  buscasRecusadasCota: number;
  geradoEm: string;
  /* ---- pipeline por evidências (auditoria adversarial Petrobras) ---- */
  /** estratégia de investigação escolhida pelo perfil da conta */
  estrategia: "LISTADA" | "DIGITAL" | "LOCAL";
  /** etapa A — identidade: fundação/criação vs. abertura cadastral, marca vs. grupo */
  sinaisIdentidade: string[];
  /** etapa C — tecnologias citadas em fontes públicas (trecho cru, estado da implantação fica com a síntese) */
  sinaisTecnologia: string[];
  /** etapa D — estrutura comercial/compras: portais de fornecedores, regras de aquisição, licitações */
  sinaisComerciais: string[];
  /** fontes acessadas mas rejeitadas do pacote — auditoria do que NÃO entrou e por quê */
  fontesRejeitadas: { url: string; motivo: string }[];
  /** instrumentação: tempo por etapa (ms), contagens — nada inventado */
  instrumentacao: {
    etapasMs: Record<string, number>;
    consultas: number;
    paginasLidas: number;
    fontesAcessadas: number;
    fontesRejeitadas: number;
    usouCache: boolean;
  };
  /* ---- v0.9.0: pesquisa adaptativa — rastreabilidade de CADA consulta ---- */
  /** modo de coleta: COMPLETO (pipeline A→E integral) ou ADAPTATIVO (níveis 0/1/2 por lacuna) */
  modoPesquisa: ModoPesquisa;
  /** log de TODAS as consultas: nível (0 cadastro / 1 dirigida / 2 por lacuna), motivo e resultado.
   *  O coletor sabe POR QUE buscou cada fato — e o que foi descartado por dedupe. */
  consultasLog: { nivel: number; motivo: string; query: string; resultados: number; descarte?: string }[];
  /** métricas do experimento adaptativo — comparação COMPLETO vs ADAPTATIVO */
  metricas: {
    buscasIniciadas: number;
    buscasAproveitaveis: number;
    paginasLidas: number;
    paginasUsadas: number;
    tempoMs: number;
    buscasRecusadasCota: number;
    consultasDedup: number;
  };
}

export type ModoPesquisa = "COMPLETO" | "ADAPTATIVO";

const TRECHO_MAX = 2800;

/**
 * Janela mais RELEVANTE do texto (não o topo — nav/menu poluem o começo).
 * Pontua janelas de TRECHO_MAX por sinais numéricos/comerciais (moeda, %,
 * headcount, barris, receita, fundação) — é onde vivem os fatos citáveis.
 */
const SINAL_FATO_RE = /(R\$\s?[\d.,]+|US\$\s?[\d.,]+|\d{1,3}(?:\.\d{3})+\s?(?:milhões|bilhões)?|\d+(?:,\d+)?%|empregad|funcionári|terceirizad|barris|investiment|receita|lucro|fundad|criad|constitu[íi]d|subsidi[áa]ria|grupo)/gi;
function trechoRelevante(text: string, max = TRECHO_MAX): string {
  if (text.length <= max) return text;
  let best = 0;
  let bestScore = -1;
  const step = 400;
  for (let i = 0; i + step < text.length && i < 60_000; i += step) {
    const score = (text.slice(i, i + max).match(SINAL_FATO_RE) ?? []).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return text.slice(best, best + max);
}

interface ReadPageResult {
  url: string;
  titulo: string;
  tipo: string;
  trecho: string;
  /** HTML bruto (clampado) para extração de links/sinais — evita ler a página 2x */
  html: string;
}

async function readPage(url: string, tipo: string, notas: string[]): Promise<ReadPageResult | null> {
  const data = await pageReader(url);
  if (!data || !data.html && !data.title) {
    notas.push(`página ${tipo} não pôde ser lida (${url})`);
    return null;
  }
  const html = data.html ?? "";
  const text = htmlToText(html);
  if (text.length < 120) {
    notas.push(`página ${tipo} sem conteúdo útil (${url})`);
    return null;
  }
  return {
    url,
    titulo: (data.title ?? "").slice(0, 120) || url,
    tipo,
    trecho: trechoRelevante(text),
    html: html.slice(0, 400_000),
  };
}

/** Ano corrente — queries de resultado/receita citam períodos explícitos. */
const YEAR = new Date().getFullYear();

/**
 * Sinais de IDENTIDADE (etapa A): fundação/criação e estrutura de grupo/marca
 * encontrados em fontes públicas — nunca confundidos com a data de abertura cadastral.
 */
const FUNDACAO_RE = /(?:fundad|criad|inaugur|constitu[íi]d)[ao]s?[^.]{0,60}?(1[89]\d{2}|20\d{2})/i;
const GRUPO_RE = /(?:faz parte do|integrante do|subsidi[áa]ria (?:de|do)|controlad[ao] (?:pela|pelo)|grupo (?:econ[ôo]mico )?)\s+([A-ZÀ-Ú][^.]{2,60})/;

function extractIdentitySignals(texts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of texts) {
    const text = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const f = FUNDACAO_RE.exec(text);
    if (f) {
      const key = `fund:${f[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(`fundação/criação em ${f[1]} — "${text.slice(Math.max(0, (f.index ?? 0) - 40), (f.index ?? 0) + 80).trim()}"`.slice(0, 200));
      }
    }
    const g = GRUPO_RE.exec(text);
    if (g && out.length < 8) {
      const key = `grupo:${g[1].toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(`vínculo de grupo citado: "${text.slice(Math.max(0, g.index), g.index + 100).trim()}"`.slice(0, 200));
      }
    }
  }
  return out.slice(0, 6);
}

/**
 * Monta o pacote de pesquisa de uma conta.
 * Pipeline por evidências (ordem obrigatória):
 *   A identidade → B dados empresariais (RI quando companhia aberta) →
 *   C tecnologias existentes → D estrutura comercial/compras → E notícias priorizadas.
 * Nunca lança: falhas viram notas honestas no pacote (a síntese julga o que tem).
 *
 * modo COMPLETO   — pipeline A→E integral (comparação do experimento adaptativo).
 * modo ADAPTATIVO — nível 0 cadastro (0 buscas) → nível 1 dirigida → nível 2 por lacuna,
 *                   com MOTIVO registrado por consulta e dedupe semântico entre etapas.
 */
export async function buildResearchPacket(opts: {
  normalizedCnpj: string;
  legalName: string | null;
  tradeName: string | null;
  municipality: string | null;
  uf: string | null;
  email: string | null;
  referenceValue: string | null;
  cnaeDescription: string | null;
  /** quadro societário da consulta oficial — alimenta teia e buscas por sócio */
  socios?: CnpjSocio[];
}, modo: ModoPesquisa = "COMPLETO"): Promise<ResearchPacket> {
  const t0 = Date.now();
  const etapasMs: Record<string, number> = {};
  const notas: string[] = [];
  const fontesRejeitadas: { url: string; motivo: string }[] = [];
  // P0-06: cota de busca medida por pacote — recusas viram "pesquisa incompleta", nunca ausência de fonte
  const quota: QuotaStats = { recusadasCota: 0 };
  // nome de busca: fantasia válida, senão razão social — fantasia legado tipo
  // "PETROBRAS - EDISE" poluiria TODAS as queries (caso da matriz Petrobras)
  const name = searchNameFor(opts.tradeName, opts.legalName);
  const cidade = opts.municipality ?? "";
  // v0.9.0: variantes de MARCA para desambiguar entidades da mesma família (golden Jotabasso)
  const marcas = brandTokens(opts.legalName, opts.tradeName);
  const consultasLog: ResearchPacket["consultasLog"] = [];
  const consultasFeitas = new Set<string>();
  let consultasDedup = 0;

  // 1) descobrir site oficial (mesma lógica nos dois modos — no máx. 1 busca)
  const tDom = Date.now();
  const { dominio, metodo } = await discoverDomain(
    {
      referenceValue: opts.referenceValue,
      email: opts.email,
      legalName: opts.legalName,
      tradeName: opts.tradeName,
    },
    quota
  );
  if (dominio && metodo) notas.push(`site oficial: ${dominio} (encontrado via ${metodo})`);
  if (!dominio) notas.push("nenhum site oficial localizado pela pista, e-mail público ou busca");
  etapasMs.dominioMs = Date.now() - tDom;

  // 2) crawler curto do site oficial (home + páginas-chave) — cada página lida UMA vez
  const tCrawl = Date.now();
  const paginas: ResearchPacketInput["siteOficial"]["paginas"] = [];
  const sinais: string[] = [];
  let paginasOk = 0;
  let paginasTentadas = 0;
  let links: string[] = [];
  const urlsLidas = new Set<string>(); // v0.9.0: dedupe EXATO de páginas entre etapas
  const homeTentada = dominio ? `https://${dominio}` : null;
  if (homeTentada) {
    paginasTentadas++;
    urlsLidas.add(homeTentada);
    const home = await readPage(homeTentada, "home", notas);
    if (home) {
      paginasOk++;
      paginas.push({ url: home.url, titulo: home.titulo, tipo: home.tipo, trecho: home.trecho });
      sinais.push(...detectDigitalSignals(home.html));
      links = extractInternalLinks(home.html, homeTentada);
    }
    for (const p of pickKeyPages(links)) {
      if (paginasTentadas >= 5) break;
      if (urlsLidas.has(p.url)) continue;
      urlsLidas.add(p.url);
      paginasTentadas++;
      const page = await readPage(p.url, p.tipo, notas);
      if (page) {
        paginasOk++;
        paginas.push({ url: page.url, titulo: page.titulo, tipo: page.tipo, trecho: page.trecho });
        sinais.push(...detectDigitalSignals(page.html));
      }
    }
  }
  if (dominio && paginasOk === 0) notas.push("site oficial identificado mas nenhuma página respondeu à leitura");
  etapasMs.siteOficialMs = Date.now() - tCrawl;

  // buscas públicas com OBJETIVO declarado — cada etapa registra para que serviu
  const buscas: ResearchPacket["buscas"] = [];

  async function runSearch(query: string, objetivo: string, num = 5) {
    // estatística POR chamada: permite distinguir "recusada por cota" de "sem resultados"
    // (auditoria v0.6.1: recusa não pode ser anotada como ausência de evidência)
    const destaChamada: QuotaStats = { recusadasCota: 0 };
    const items = await webSearch(query, num, destaChamada);
    quota.recusadasCota += destaChamada.recusadasCota;
    // auditoria de rejeição: fontes conhecidas como agregador/publisher não entram no pacote
    for (const i of items.slice(0, 8)) {
      const host = hostFromUrl(i.url ?? "");
      if (host && DIRECTORY_HOSTS.test(host)) {
        fontesRejeitadas.push({ url: i.url ?? host, motivo: `agregador/diretório de terceiros (${host}) — trecho não sustenta fato sobre a empresa` });
      }
    }
    const resultados = items
      .filter((i) => i.url && !DIRECTORY_HOSTS.test(hostFromUrl(i.url ?? "") ?? ""))
      .slice(0, 5)
      .map((i) => ({
        titulo: (i.name ?? i.url ?? "").slice(0, 140),
        url: (i.url ?? "").slice(0, 300),
        snippet: (i.snippet ?? "").replace(/\s+/g, " ").slice(0, 320),
      }));
    buscas.push({ query, objetivo, resultados });
    if (destaChamada.recusadasCota > 0) {
      notas.push(`busca recusada por limite de cota: "${query}" — reexecute a pesquisa quando a cota restaurar`);
    } else if (resultados.length === 0) {
      notas.push(`busca sem resultados: "${query}"`);
    }
    return resultados;
  }

  /** Chave semântica da consulta: minúsculas, sem acentos/aspas/parênteses, espaço colapsado. */
  function normQueryKey(q: string): string {
    return q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  }

  /**
   * Executa a busca com rastreabilidade ADAPTATIVA: nível (0 cadastro / 1 dirigida /
   * 2 por lacuna) + MOTIVO. Consulta semanticamente equivalente a uma anterior é
   * DEDUPLICADA — não repete chamada nem gera custo (contrato v0.9.0).
   */
  async function runSearchNivel(query: string, motivo: string, nivel: number, num = 5) {
    const key = normQueryKey(query);
    if (consultasFeitas.has(key)) {
      consultasDedup++;
      consultasLog.push({ nivel, motivo, query, resultados: 0, descarte: "consulta semanticamente equivalente já executada — dedupe entre etapas" });
      notas.push(`consulta deduplicada (equivalente já executada): "${query}"`);
      return [];
    }
    consultasFeitas.add(key);
    const resultados = await runSearch(query, motivo, num);
    consultasLog.push({ nivel, motivo, query, resultados: resultados.length });
    return resultados;
  }

  /**
   * Lê as páginas mais promissoras de uma busca — snippet não sustenta número;
   * o fato citável (receita com período, headcount, plano de investimentos)
   * vive NO CONTEÚDO da fonte. Cap global de páginas, 1 leitura por host e
   * dedupe EXATO de URL entre etapas (v0.9.0).
   */
  async function lerResultadosChave(
    resultados: { titulo: string; url: string; snippet: string }[],
    objetivo: string,
    max = 2
  ): Promise<number> {
    let lidas = 0;
    for (const r of resultados) {
      if (lidas >= max || paginas.length >= 8) break;
      const host = hostFromUrl(r.url);
      if (!host || DIRECTORY_HOSTS.test(host)) continue;
      if (paginas.some((p) => hostFromUrl(p.url) === host)) continue;
      if (urlsLidas.has(r.url)) continue;
      urlsLidas.add(r.url);
      const page = await readPage(r.url, `${objetivo} — ${r.titulo.slice(0, 60)}`, notas);
      paginasTentadas++;
      if (page) {
        paginas.push({ url: page.url, titulo: page.titulo || r.titulo, tipo: page.tipo, trecho: page.trecho });
        paginasOk++;
        lidas++;
      }
    }
    return lidas;
  }

  const sinaisIdentidade: string[] = [];
  const sinaisTecnologia: string[] = [];
  const sinaisComerciais: string[] = [];
  const teiaBuscada: string[] = [];
  let estrategia: ResearchPacket["estrategia"] = dominio ? "DIGITAL" : "LOCAL";
  // companhia aberta: "S.A." em QUALQUER posição da razão social ("PETROLEO BRASILEIRO S A PETROBRAS"),
  // não só no fim — o caso Petrobras quebrou o teste anterior
  const legalSobrenomeSA = /\bS\s?\.?\s?A\b/i.test((opts.legalName ?? "").replace(/\./g, ". "));

  /* ---------------------------------------------- */
  /* ETAPA A — IDENTIDADE (entidade, fundação, grupo) */
  /* ---------------------------------------------- */
  async function etapaIdentidade(comGrupo: boolean): Promise<void> {
    const tA = Date.now();
    const identidadeTextos: string[] = [];
    if (name.length >= 4) {
      const a1 = await runSearchNivel(`"${name}" (fundação OR história OR "criada em" OR constituída OR "nossa história")`, "identidade: fundação/criação da empresa (diferente da abertura cadastral)", comGrupo ? 2 : 1, 5);
      identidadeTextos.push(...a1.map((r) => `${r.titulo}. ${r.snippet}`));
      if (comGrupo) {
        const a2 = await runSearchNivel(`"${name}" (grupo OR controlada OR subsidiária OR marca)`, "identidade: grupo econômico/marca vs. pessoa jurídica", comGrupo ? 2 : 1, 5);
        identidadeTextos.push(...a2.map((r) => `${r.titulo}. ${r.snippet}`));
      }
      sinaisIdentidade.push(...extractIdentitySignals(identidadeTextos));
      if (sinaisIdentidade.length > 0) notas.push(`etapa A: ${plural(sinaisIdentidade.length, "sinal", "sinais")} de identidade (fundação/grupo) em fontes públicas`);
      // fundação/história vive NO CONTEÚDO (ex.: Petrobras criada em 1953, abertura cadastral 1966)
      await lerResultadosChave(a1, "etapa A — fundação/história", 2);
    }
    etapasMs.identidadeMs = Date.now() - tA;
  }

  /* ---------------------------------------------------- */
  /* ETAPA B — DADOS EMPRESARIAIS (companhia aberta → RI)  */
  /* ---------------------------------------------------- */
  async function etapaListada(): Promise<void> {
    const tB = Date.now();
    if (name.length < 4) return;
    const riResults = await runSearchNivel(`"${name}" "relações com investidores"`, "dados empresariais: detectar companhia aberta (área de RI)", 2, 6);
    // host de RI: prefixo ri./investidor., plataformas (mziq/mzweb/q4cdn/apigrau), CVM/B3 —
    // e "investidor" como PREFIXO do label (investidorpetrobras.com.br é label único)
    const RI_PLATFORM = /mziq|mzweb|q4cdn|rad\.cvm|b3\.com\.br|api\.mziq/;
    const riHost = riResults
      .map((r) => hostFromUrl(r.url))
      .find((h) => h && (RI_PLATFORM.test(h) || /^(ri|investidor)\./.test(h) || /^investidor[^.]*\./.test(h) || /(^|\.)(ri|investidor)(-|\.)/.test(h)));
    if (riHost || legalSobrenomeSA) {
      estrategia = "LISTADA";
      notas.push(
        `etapa B: companhia aberta detectada${riHost ? ` (área de RI em ${riHost})` : legalSobrenomeSA ? " (razão social S.A. — busca direta de relatórios)" : ""} — busca de receita, empregados e investimentos com período`
      );
      if (riHost) {
        if (!urlsLidas.has(`https://${riHost}`)) {
          urlsLidas.add(`https://${riHost}`);
          const riPage = await readPage(`https://${riHost}`, "relações com investidores", notas);
          if (riPage) {
            paginas.push({ url: riPage.url, titulo: riPage.titulo, tipo: riPage.tipo, trecho: riPage.trecho });
            paginasOk++;
            paginasTentadas++;
          }
        }
      }
      const recResults = await runSearchNivel(`"${name}" receita líquida resultado ${YEAR}`, `receita/lucro com período (${YEAR}) — lacuna de escala comprovada`, 2, 6);
      const empResults = await runSearchNivel(`"${name}" (empregados próprios OR funcionários próprios OR terceirizados)`, "headcount próprio vs. terceirizado — lacuna de escala", 2, 6);
      const invResults = await runSearchNivel(`"${name}" plano de investimentos ${YEAR}-${YEAR + 4}`, "plano de investimentos com horizonte — mudanças relevantes com período", 2, 6);
      // LER AS FONTES: os números oficiais (receita, headcount, plano) estão nas páginas,
      // não nos snippets — relatório/RI/agência com conteúdo vira matéria-prima citável
      if (riHost) await lerResultadosChave(riResults, "etapa B — relações com investidores", 2);
      await lerResultadosChave(recResults, "etapa B — receita e resultado", 2);
      await lerResultadosChave(invResults, "etapa B — plano de investimentos", 2);
      await lerResultadosChave(empResults, "etapa B — empregados", 1);
    }
    if (estrategia !== "LISTADA" && modo === "COMPLETO") notas.push("etapa B: sem indício de companhia aberta — estratégia focada em presença digital e cadastro");
    etapasMs.dadosEmpresariaisMs = Date.now() - tB;
  }

  /* ------------------------------------------- */
  /* ETAPA C — TECNOLOGIAS EXISTENTES (estado real) */
  /* ------------------------------------------- */
  async function coletarTecnologia(nivel: number, profundidade: "basica" | "completa"): Promise<void> {
    const tC = Date.now();
    if (name.length < 4) return;
    // filtro de relevância (v0.9.0): resultado sem token raro da empresa/marca é RUÍDO
    // de busca genérica (homepages de fornecedor, homônimos) — rejeitado com motivo.
    const tokensRel = tokensEmpresaRaros(name, marcas);
    const soRelevantes = (rs: { titulo: string; url: string; snippet: string }[]) => {
      const rel = rs.filter((r) => resultadoRelevante(r, tokensRel));
      for (const r of rs) {
        if (!rel.includes(r)) fontesRejeitadas.push({ url: r.url, motivo: "resultado sem correspondência com o nome/marca da empresa (ruído de busca genérica)" });
      }
      return rel;
    };
    // v0.9.0 (golden Lar): Senior entra na lista de fornecedores da 1ª varredura —
    // vaga citando Senior é evidência de tecnologia CITADA (vaga ≠ produção).
    const c1 = soRelevantes(await runSearchNivel(`${name} (SAP OR Oracle OR Totvs OR "Microsoft Dynamics" OR Salesforce OR Senior OR ERP)`, nivel === 2 ? "tecnologia: lacuna — nenhuma menção pública coletada ainda" : "tecnologia: fornecedores/funções citados em fontes públicas", nivel, 6));
    const techTextos: string[] = [...c1.map((r) => `${r.titulo}. ${r.snippet}`)];
    let c2: { titulo: string; url: string; snippet: string }[] = [];
    let c3: { titulo: string; url: string; snippet: string }[] = [];
    let c4: { titulo: string; url: string; snippet: string }[] = [];
    if (profundidade === "completa") {
      c2 = soRelevantes(await runSearchNivel(`${name} ("implantação" OR "implantado" OR "em implantação" OR licitação OR contrato) sistema`, "tecnologia: estado da implantação (operando vs. anunciado/contratado)", nivel, 6));
      // documentação do FORNECEDOR é a fonte primária do estado da tecnologia
      // (ex.: S/4HANA da Petrobras — caso documentado pela própria SAP desde 2022)
      c3 = soRelevantes(await runSearchNivel(`(${name}) (site:sap.com OR site:news.sap.com OR site:sapbrasil.com.br)`, "tecnologia: documentação do fornecedor (estado oficial da implantação)", nivel, 5));
    }
    // Fase 2.2 — fontes tecnológicas novas: VAGAS (sinal de atividade técnica, vaga ≠ produção)
    c4 = soRelevantes(await runSearchNivel(`${name} (vagas OR carreira OR desenvolvedor OR tecnologia)`, "tecnologia: vagas/carreiras — tecnologia CITADA em contratação (sinal, NÃO produção)", nivel, 5));
    // v0.9.0 (golden Lar): vagas sob a MARCA/curto nome citando fornecedor — a vaga
    // de dev "Sistemas Senior" não usa a razão social completa; busca pela marca + cidade.
    if (marcas.length > 0) {
      for (const marca of marcas) {
        const cBrand = soRelevantes(await runSearchNivel(`${marca} ${cidade} vagas (Sistemas OR Senior OR ERP OR SAP OR Totvs OR Oracle)`.replace(/\s+/g, " ").trim(), `tecnologia: vagas sob a marca "${marca}" citando fornecedor de software (vaga ≠ produção)`, nivel, 5));
        techTextos.push(...cBrand.map((r) => `${r.titulo}. ${r.snippet}`));
      }
    }
    // Fase 2.2 — caso de sucesso publicado por fornecedor/integrador (fonte primária do estado)
    const c5 = soRelevantes(await runSearchNivel(`${name} ("caso de sucesso" OR cliente OR case) (SAP OR TOTVS OR Senior OR Oracle OR ERP)`, "tecnologia: caso de sucesso/cliente publicado por fornecedor ou integrador", nivel, 5));
    // v0.9.0 (golden Lar): quando NADA de tecnologia apareceu, uma última busca DIRIGIDA
    // de vaga citando fornecedor — anúncios de vaga usam frase curta ("Sistemas Senior"),
    // não a razão social completa. vaga citando Senior = tecnologia CITADA (≠ produção).
    if (techTextos.length === 0) {
      const cVaga = soRelevantes(await runSearchNivel(`${name} (vaga OR vagas OR oportunidade) ("Senior" OR Totvs OR SAP OR ERP OR sistema)`, "lacuna: nenhuma tecnologia citada — busca dirigida de vaga mencionando fornecedor de software", nivel, 5));
      techTextos.push(...cVaga.map((r) => `${r.titulo}. ${r.snippet}`));
    }
    techTextos.push(...[...c2, ...c3, ...c4, ...c5].map((r) => `${r.titulo}. ${r.snippet}`));
    const seenTech = new Set<string>();
    for (const t of techTextos) {
      const clean = t.replace(/\s+/g, " ").trim();
      if (clean.length < 40) continue;
      const key = clean.slice(0, 70).toLowerCase();
      if (seenTech.has(key)) continue;
      seenTech.add(key);
      sinaisTecnologia.push(clean.slice(0, 260));
      if (sinaisTecnologia.length >= 6) break;
    }
    if (sinaisTecnologia.length > 0) notas.push(`etapa C: ${plural(sinaisTecnologia.length, "menção pública", "menções públicas")} de tecnologia — validar estado da implantação na síntese`);
    else notas.push("etapa C: nenhuma tecnologia citada em fontes públicas — lacuna honesta");
    // estado da implantação (operando vs. anunciado) vive na matéria, não no snippet
    if (profundidade === "completa") await lerResultadosChave(c3, "etapa C — documentação do fornecedor", 2);
    await lerResultadosChave(c1, "etapa C — tecnologia citada", 1);
    await lerResultadosChave(c4, "etapa C — vagas/carreiras (sinal de tecnologia)", 1);
    etapasMs.tecnologiasMs = Date.now() - tC;
  }

  /** Busca por variante de MARCA (v0.9.0 — golden Jotabasso): desambigua entidades
   *  da mesma família. A evidência encontrada fica ATRIBUÍDA à entidade exata citada
   *  na fonte — a síntese é proibida de transferir fato entre homônimas. */
  async function buscarVarianteMarca(nivel: number): Promise<void> {
    if (name.length < 4) return;
    const tokensRelMarca = tokensEmpresaRaros(name, marcas);
    for (const marca of marcas) {
      const antes = buscas.length;
      const resultados = await runSearchNivel(`"${marca}" (SAP OR ERP OR sistema OR Senior OR Totvs OR Oracle OR implantação)`, `variante de marca "${marca}" — desambiguar entidades com nome jurídico parecido antes de atribuir tecnologia`, nivel, 6);
      if (buscas.length > antes) {
        notas.push(`busca por variante de marca executada: "${marca}" — cada evidência deve citar a ENTIDADE EXATA (razão social) da fonte; NÃO transfira fatos entre entidades homônimas ou parcialmente homônimas`);
        // LER as páginas relevantes (o fato de ERP/tecnologia vive no conteúdo, não no snippet;
        // golden Jotabasso: a página de notícia cita "Sementes Jotabasso" — entidade DISTINTA).
        const relevantes = resultados.filter((r) => resultadoRelevante(r, tokensRelMarca));
        await lerResultadosChave(relevantes, `variante de marca "${marca}" — desambiguação de entidades`, 2);
      }
    }
  }

  /* ------------------------------------------------ */
  /* ETAPA D — ESTRUTURA COMERCIAL E COMPRAS           */
  /* ------------------------------------------------ */
  async function etapaComercial(): Promise<void> {
    const tD = Date.now();
    if (name.length < 4) return;
    const tokensRelCom = tokensEmpresaRaros(name, marcas);
    const d1 = (await runSearchNivel(`${name} ("cadastro de fornecedores" OR "portal do fornecedor" OR "canal de fornecedores" OR compras OR licitação)`, "estrutura comercial: regras de aquisição e portais de fornecedor", 2, 6)).filter((r) => {
      const rel = resultadoRelevante(r, tokensRelCom);
      if (!rel) fontesRejeitadas.push({ url: r.url, motivo: "resultado sem correspondência com o nome/marca da empresa (ruído de busca genérica)" });
      return rel;
    });
    const seenCom = new Set<string>();
    for (const r of d1) {
      const clean = `${r.titulo}. ${r.snippet}`.replace(/\s+/g, " ").trim();
      if (clean.length < 40) continue;
      const key = clean.slice(0, 70).toLowerCase();
      if (seenCom.has(key)) continue;
      seenCom.add(key);
      sinaisComerciais.push(clean.slice(0, 260));
    }
    // portal de fornecedor descoberto → ler a página (fonte primária do processo comercial)
    const portalUrl = d1.map((r) => r.url).find((u) => /fornecedor|compras|supplier|licita/i.test(hostFromUrl(u) ?? "") || /fornecedor|compras/i.test(u));
    if (portalUrl && !urlsLidas.has(portalUrl)) {
      urlsLidas.add(portalUrl);
      const portal = await readPage(portalUrl, "portal comercial/fornecedores", notas);
      if (portal) {
        paginas.push({ url: portal.url, titulo: portal.titulo, tipo: portal.tipo, trecho: portal.trecho });
        paginasOk++;
        paginasTentadas++;
      }
    }
    if (sinaisComerciais.length > 0) notas.push(`etapa D: ${plural(sinaisComerciais.length, "sinal", "sinais")} de estrutura comercial/compras`);
    else notas.push("etapa D: nenhum portal/regra de compras pública encontrada — lacuna honesta");
    etapasMs.comercialMs = Date.now() - tD;
  }

  /* ---------------------------------------------------------------- */
  /* ETAPA E — NOTÍCIAS (Google News RSS) mapeadas POR NOME na imprensa */
  /* ---------------------------------------------------------------- */
  const noticias: NewsItem[] = [];
  async function etapaNoticias(): Promise<void> {
    if (name.length < 4) {
      notas.push("sem nome pesquisável — busca de notícias por nome não executada");
      return;
    }
    const newsQuery = cidade ? `"${name}" OR "${name} ${cidade}"` : `"${name}"`;
    const items = await fetchNewsRss(newsQuery, 12);
    if (items.length === 0) notas.push(`nenhuma notícia encontrada no Google News para "${name}"`);
    else notas.push(`${plural(items.length, "notícia do Google News coletada", "notícias do Google News coletadas")} por nome da empresa (dedupe + priorização por relevância a seguir)`);
    noticias.push(...items);
  }

  // PORTE REAL — o cadastro oficial só tem capital social declarado; a imprensa
  //    e a busca pública revelam headcount, faturamento, frota e unidades.
  const sinaisPorte: string[] = [];
  async function coletarPorte(nivel: number, comFaturamento: boolean): Promise<void> {
    if (name.length < 4) return;
    // v0.9.1: fonte (título do resultado) entra NO sinal — atribuição de entidade
    // visível no dossiê e no prompt (golden case: variante de marca ≠ PJ analisada)
    const porteSnippets: { fonte?: string; texto: string }[] = [];
    const porteQueries: { query: string; objetivo: string }[] = [
      { query: `${name} (funcionários OR colaboradores OR empregados OR vagas) ${YEAR}`, objetivo: "porte real — pessoas (headcount, período citado)" },
    ];
    if (comFaturamento) {
      porteQueries.push({ query: `${name} (faturamento OR receita OR "milhões" OR frota OR unidades OR fábrica)`, objetivo: "porte real — escala (receita, frota, unidades)" });
    }
    const tokensRelPorte = tokensEmpresaRaros(name, marcas);
    for (const q of porteQueries) {
      const resultados = (await runSearchNivel(q.query, q.objetivo, nivel)).filter((r) => {
        const rel = resultadoRelevante(r, tokensRelPorte);
        if (!rel) fontesRejeitadas.push({ url: r.url, motivo: "resultado sem correspondência com o nome/marca da empresa (ruído de busca genérica)" });
        return rel;
      });
      porteSnippets.push(...resultados.map((r) => ({ fonte: r.titulo || undefined, texto: r.snippet ?? "" })));
    }
    porteSnippets.push(...noticias.map((n) => ({ fonte: n.fonte || undefined, texto: `${n.titulo}${n.fonte ? ` (${n.fonte})` : ""}` })));
    const sinais = extractPorteSignals(porteSnippets, 6);
    sinaisPorte.push(...sinais);
    if (sinais.length > 0) notas.push(`${plural(sinais.length, "sinal de porte real detectado", "sinais de porte real detectados")} em fontes públicas`);
  }

  /* ================================================================== */
  /* MODOS DE COLETA                                                     */
  /* ================================================================== */
  if (modo === "ADAPTATIVO") {
    /* ---------------- NÍVEL 0 — CADASTRO (zero buscas) ---------------- */
    consultasLog.push({
      nivel: 0,
      motivo: "cadastro oficial estruturado: CNPJ, matriz/filial, situação, localização, CNAE, sócios (QSA) — identidade jurídica SEM custo de busca",
      query: "(cadastro oficial)",
      resultados: 1,
    });
    etapasMs.cadastroMs = 0;

    /* ---------------- NÍVEL 1 — INVESTIGAÇÃO DIRIGIDA ---------------- */
    // (a) presença digital: domínio + crawler já executados acima (busca de domínio quando não veio de pista)
    // (b) notícias RSS (não consome web_search)
    const tN1 = Date.now();
    await etapaNoticias();
    // (c) identidade: fundação/história — SEM a2 de grupo no nível 1 (vira lacuna se nada aparecer)
    await etapaIdentidade(false);
    // (d) tecnologia: 1ª varredura de fornecedores + vagas (baseline dirigido)
    await coletarTecnologia(1, "basica");
    etapasMs.nivel1Ms = Date.now() - tN1;

    /* ---------------- NÍVEL 2 — APROFUNDAMENTO POR LACUNA ---------------- */
    const tN2 = Date.now();
    const lacunas: string[] = [];
    // lacuna: GRUPO/MARCA — nenhum sinal de grupo apareceu no nível 1
    if (sinaisIdentidade.filter((s) => /grupo/i.test(s)).length === 0 && name.length >= 4) {
      lacunas.push("grupo/marca");
      const a2 = await runSearchNivel(`"${name}" (grupo OR controlada OR subsidiária OR marca)`, "lacuna: nenhum sinal de grupo/marca no nível 1 — investigar vínculo societário declarado em fonte pública", 2, 5);
      const novos = extractIdentitySignals(a2.map((r) => `${r.titulo}. ${r.snippet}`));
      for (const s of novos) if (!sinaisIdentidade.includes(s)) sinaisIdentidade.push(s);
    }
    // lacuna: PRESENÇA LOCAL — sem site oficial e sem domínio da pista
    if (!dominio && name.length >= 4) {
      lacunas.push("presença local");
      if (cidade) await runSearchNivel(`"${name}" ${cidade}`, "lacuna: sem site oficial — confirmar atividade e presença local", 2, 5);
      else await runSearchNivel(`"${name}"`, "lacuna: sem site oficial — confirmar atividade e presença digital", 2, 5);
    }
    // lacuna: TECNOLOGIA — nenhuma menção coletada no nível 1
    if (sinaisTecnologia.length === 0 && name.length >= 4) {
      lacunas.push("tecnologia");
      await coletarTecnologia(2, "completa"); // implantação + docs do fornecedor + vagas
    }
    // variante de marca SEMPRE no nível 2 (quando há marca derivável) — desambiguação
    // de entidades homônimas/parcialmente homônimas é lacuna de identidade, não só de tecnologia
    if (name.length >= 4 && marcas.length > 0) {
      lacunas.push("variante de marca");
      await buscarVarianteMarca(2);
    }
    // lacuna: ESCALA — nenhum sinal de porte; faturamento SÓ quando há indício de S.A./RI
    if (sinaisPorte.length === 0 && name.length >= 4) {
      lacunas.push("escala");
      await coletarPorte(2, legalSobrenomeSA);
    }
    // período: companhia aberta (S.A. na razão social) → dados de RI com período
    if (legalSobrenomeSA && name.length >= 4) {
      lacunas.push("período (companhia aberta)");
      await etapaListada();
    }
    if (lacunas.length > 0) notas.push(`modo adaptativo — nível 2 executado por lacuna: ${lacunas.join(", ")}`);
    else notas.push("modo adaptativo — nível 2 NÃO executado: nível 1 esclareceu identidade, presença, tecnologia e porte");
    // honestidade: teia por busca pública NÃO roda no adaptativo (QSA estruturado já está no pacote)
    if ((opts.socios ?? []).length > 0) notas.push("modo adaptativo: teia por busca pública não executada — o QSA estruturado do cadastro está no pacote; participação societária exige prova adicional");
    else notas.push("QSA ausente na consulta oficial — teia societária não executada");
    etapasMs.nivel2Ms = Date.now() - tN2;
  } else {
    /* ------------- MODO COMPLETO — pipeline A→E integral ------------- */
    // ETAPA A (com grupo) + presença local
    await etapaIdentidade(true);
    if (name.length >= 4 && cidade) await runSearchNivel(`"${name}" ${cidade}`, "atividade e presença local", 1);
    else if (name.length >= 4) await runSearchNivel(`"${name}"`, "atividade e presença digital", 1);
    // ETAPA B — companhia aberta
    await etapaListada();
    // ETAPA C — tecnologias (v0.9.0: c1 agora inclui Senior; variante de marca sempre que há marca)
    await coletarTecnologia(1, "completa");
    if (marcas.length > 0) await buscarVarianteMarca(2);
    // ETAPA D — estrutura comercial
    await etapaComercial();
    // ETAPA E — notícias + porte (faturamento sempre, como antes)
    await etapaNoticias();
    await coletarPorte(1, true);
    // TEIA SOCIETÁRIA — sócios como chave de busca: outras empresas do mesmo grupo
    // P1-06 (auditoria): coincidência nominal NÃO prova participação — proveniência explícita.
    const tE = Date.now();
    const socios = (opts.socios ?? []).slice(0, 3);
    for (const s of socios) {
      const socioNome = (s.nome ?? "").replace(/\s+/g, " ").trim();
      if (socioNome.length < 5 || /^[^a-zA-Zà-úÀ-Ú]+$/.test(socioNome)) continue;
      const query = `"${socioNome}" ${cidade ? cidade : ""} empresa CNPJ`.replace(/\s+/g, " ").trim();
      teiaBuscada.push(query);
      await runSearchNivel(query, `teia societária — participações do sócio ${socioNome}`, 2, 4);
    }
    if (socios.length === 0) notas.push("QSA ausente na consulta oficial — teia por nome de sócio não executada");
    if ((opts.socios ?? []).length > 3) notas.push(`teia societária limitada aos 3 primeiros sócios do QSA público (${(opts.socios ?? []).length} listados)`);
    if (socios.length > 0) notas.push("teia por nome de sócio = COINCIDÊNCIA NOMINAL em busca pública — NÃO prova participação societária; confirmar no QSA da empresa encontrada e separar matriz/filiais de participações acionárias");
    etapasMs.teiaMs = Date.now() - tE;
  }

  // P0-06: recusas por cota viram PESQUISA INCOMPLETA explícita — nunca ausência de fonte
  if (quota.recusadasCota > 0) {
    notas.push(`PESQUISA INCOMPLETA: ${plural(quota.recusadasCota, "busca não executada", "buscas não executadas")} por limite de cota de busca — ausência de evidência NÃO é conclusiva nesta conta`);
  }

  const noticiasFinais = await prioritizeNews(noticias, 10);
  if (noticias.length > noticiasFinais.length) notas.push(`notícias deduplicadas: ${noticias.length} coletadas → ${noticiasFinais.length} eventos distintos`);

  const consultas = buscas.length;
  notas.push(`modo de coleta: ${modo} — ${plural(consultas, "busca", "buscas")}, ${plural(consultasDedup, "consulta deduplicada", "consultas deduplicadas")}, ${plural(paginasOk, "página lida", "páginas lidas")}`);
  return {
    siteOficial: {
      dominio,
      paginas,
      erro: dominio && paginasOk === 0 ? "site identificado, leitura indisponível" : null,
    },
    buscas,
    notas,
    homeTentada,
    sinaisDigitais: [...new Set(sinais)],
    noticias: noticiasFinais,
    sinaisPorte,
    teiaBuscada,
    paginasOk,
    paginasTentadas,
    buscasOk: buscas.filter((b) => b.resultados.length > 0).length,
    buscasRecusadasCota: quota.recusadasCota,
    geradoEm: new Date().toISOString(),
    estrategia,
    sinaisIdentidade,
    sinaisTecnologia,
    sinaisComerciais,
    fontesRejeitadas: fontesRejeitadas.slice(0, 20),
    instrumentacao: {
      etapasMs,
      consultas,
      paginasLidas: paginasOk,
      fontesAcessadas: paginasOk + buscas.filter((b) => b.resultados.length > 0).length,
      fontesRejeitadas: fontesRejeitadas.length,
      usouCache: false,
    },
    modoPesquisa: modo,
    consultasLog,
    metricas: {
      buscasIniciadas: consultas,
      buscasAproveitaveis: buscas.filter((b) => b.resultados.length > 0).length,
      paginasLidas: paginasOk,
      paginasUsadas: paginas.length,
      tempoMs: Date.now() - t0,
      buscasRecusadasCota: quota.recusadasCota,
      consultasDedup,
    },
  };
}
/** Reduz o pacote para o formato enviado ao modelo (ResearchPacketInput). */
export function toModelInput(p: ResearchPacket): ResearchPacketInput {
  return {
    siteOficial: p.siteOficial,
    buscas: p.buscas,
    notas: p.notas.concat(
      [`estratégia de investigação: ${p.estrategia} (LISTADA = com área de RI; DIGITAL = site oficial; LOCAL = cadastro + fontes setoriais)`],
      p.sinaisDigitais.length ? [`sinais digitais detectados no site: ${p.sinaisDigitais.join("; ")}`] : [],
      p.sinaisPorte.length ? [`sinais de porte real detectados em fontes públicas: ${p.sinaisPorte.join(" | ")}`] : [],
      p.sinaisIdentidade.length ? [`sinais de identidade (fundação/grupo): ${p.sinaisIdentidade.join(" | ")}`] : [],
      p.sinaisTecnologia.length ? [`menções públicas de tecnologia (validar ESTADO da implantação): ${p.sinaisTecnologia.join(" | ")}`] : [],
      p.sinaisComerciais.length ? [`estrutura comercial/compras observada: ${p.sinaisComerciais.join(" | ")}`] : [],
      p.fontesRejeitadas.length ? [`fontes coletadas e rejeitadas (não use): ${p.fontesRejeitadas.slice(0, 8).map((f) => `${f.url} — ${f.motivo}`).join("; ")}`] : []
    ),
    noticias: p.noticias.map((n) => ({ titulo: n.titulo, fonte: n.fonte, data: n.data, link: n.link })),
  };
}
