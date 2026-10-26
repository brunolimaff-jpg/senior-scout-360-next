/**
 * news.ts — notícias públicas via Google News RSS (sem chave, sem dependência).
 *
 * Fonte: https://news.google.com/rss/search?q=<query>&hl=pt-BR&gl=BR&ceid=BR:pt-419
 * O RSS é público e estável; parse XML tolerante com regex (sem parser externo).
 * Contrato do motor: falha NUNCA lança — devolve lista vazia e o chamador anota
 * nota honesta no pacote de pesquisa.
 *
 * Para que serve (contrato Scout 360):
 *   - mapear a empresa POR NOME na imprensa (notícias, expansão, investimento);
 *   - sinais de PORTE REAL que o cadastro oficial não tem (funcionários,
 *     faturamento estimado, frota, unidades) — o que fecha lacunas do dossiê;
 *   - teia societária: buscar por NOMES DE SÓCIOS encontra outras empresas do grupo.
 */

export interface NewsItem {
  /** manchete limpa (sem sufixo " - Fonte") */
  titulo: string;
  /** nome do veículo (elemento <source>) */
  fonte: string;
  /** data de publicação (ISO, quando parseável) */
  data: string | null;
  /** link do artigo (redirect do Google News) */
  link: string;
}

const RSS_TIMEOUT_MS = 12_000;

/** Decodifica entidades básicas e CDATA de títulos do feed. */
function decodeXmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+[#0-9]*;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai o conteúdo do primeiro elemento <tag>...</tag> (tolerante a CDATA). */
function tagContent(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m ? decodeXmlText(m[1]) : "";
}

function parsePubDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Busca notícias no Google News RSS. `max` limita itens retornados (default 6).
 * Tenta fetch direto; em caso de falha de rede, tenta 1x via page_reader do
 * resolve-service (que já lida com DNS/timeouts). Nunca lança.
 */
export async function fetchNewsRss(query: string, max = 6): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const xml = await fetchXml(url);
  if (!xml) return [];
  return parseRss(xml, max);
}

/** Parse do XML do feed → itens limpos. Exportado para testes/reuso. */
export function parseRss(xml: string, max = 6): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    if (items.length >= max) break;
    const tituloRaw = tagContent(block, "title");
    if (!tituloRaw) continue;
    // manchete do Google News vem "Título - Fonte"; o elemento <source> repete a fonte
    const fonte = tagContent(block, "source");
    const titulo = fonte && tituloRaw.toLowerCase().endsWith(` - ${fonte.toLowerCase()}`)
      ? tituloRaw.slice(0, tituloRaw.length - fonte.length - 3).trim()
      : tituloRaw;
    const link = tagContent(block, "link");
    const data = parsePubDate(tagContent(block, "pubDate"));
    if (!titulo || !link) continue;
    items.push({
      titulo: titulo.slice(0, 220),
      fonte: fonte.slice(0, 80),
      data,
      link: link.slice(0, 500),
    });
  }
  return items;
}

async function fetchXml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Scout360Research/1.0)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return /<rss|<channel/i.test(text) ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------- */
/* Deduplicação, URL original e priorização por RELEVÂNCIA COMERCIAL     */
/* -------------------------------------------------------------------- */

/** Título normalizado para comparar eventos (sem pontuação/acentos/minúsculas). */
function normTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens de 5+ letras de um título (para similaridade entre coberturas do mesmo evento). */
function titleTokens(t: string): Set<string> {
  return new Set(normTitle(t).split(" ").filter((w) => w.length >= 5));
}

/**
 * Remove notícias repetidas sobre o MESMO evento:
 * - título normalizado idêntico OU
 * - ≥ 60% dos tokens do título menor presentes no maior (coberturas do mesmo fato).
 * Mantém a PRIMEIRA ocorrência (Google News já ordena por data).
 */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const out: NewsItem[] = [];
  for (const item of items) {
    const dup = out.some((o) => {
      if (normTitle(o.titulo) === normTitle(item.titulo)) return true;
      const A = titleTokens(o.titulo);
      const B = titleTokens(item.titulo);
      if (A.size === 0 || B.size === 0) return false;
      const [small, big] = A.size <= B.size ? [A, B] : [B, A];
      let hits = 0;
      for (const t of small) if (big.has(t)) hits++;
      return hits / small.size >= 0.6;
    });
    if (!dup) out.push(item);
  }
  return out;
}

/**
 * Resolve a URL ORIGINAL de um link do Google News (redirect HTTP → artigo do veículo).
 * Sobe 1 redirect com timeout curto; falha devolve o link original (honesto).
 */
export async function resolveOriginalUrl(link: string): Promise<string> {
  if (!link || !/news\.google\.com/i.test(link)) return link;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(link, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Scout360Research/1.0)" },
      cache: "no-store",
    });
    const final = res.url ?? "";
    if (final && !/news\.google\.com/i.test(final)) return final;
    return link;
  } catch {
    return link;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Peso de RELEVÂNCIA COMERCIAL (não é recência): expansão, investimento,
 * contratações, mudança de sistemas, reorganização, projetos industriais/
 * logísticos, fornecedores e licitações valem mais que menção genérica.
 */
export function newsRelevance(titulo: string, snippet = ""): number {
  const t = `${titulo} ${snippet}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let score = 0;
  const STRONG = [
    /\bexpans[aã]o\b/, /\binvestiment/, /plano (de|para)/, /\bcontrata[cç]/, /vagas/,
    /\bERP\b/, /\bSAP\b/, /\bOracle\b/, /\bTotvs\b/, /sistema[s]?\b/, /tecnolog/,
    /reestrutur/, /fus[aã]o|aquisi[cç]/, /\blicita[cç]/, /fornecedor/, /contrato/,
    /\bf[áa]brica\b/, /unidade (industrial|de produ)/, /frota\b/, /novo produto/, /inaugur/,
    /planta\b/, /produ[cç][ãa]o\b/, /capacidade\b/, /parceria\b/, /digitaliza/,
  ];
  const SOFT = [/\bresultado\b/, /receita\b/, /lucro\b/, /dividend/, /balan[cç]o/, /relat[oó]rio\b/, /mercado\b/, /crise\b/, /greve\b/];
  for (const re of STRONG) if (re.test(t)) score += 3;
  for (const re of SOFT) if (re.test(t)) score += 1;
  return score;
}

/**
 * Pipeline de notícias do pacote: dedup por evento → prioridade por RELEVÂNCIA
 * (não por recência) → resolve URL original dos redirects do Google News (limitado).
 */
export async function prioritizeNews(items: NewsItem[], max = 10): Promise<NewsItem[]> {
  const unique = dedupeNews(items);
  const ranked = [...unique].sort((a, b) => newsRelevance(b.titulo) - newsRelevance(a.titulo));
  const chosen = ranked.slice(0, max);
  // resolve URLs originais em paralelo (com limite prático) — falha mantém o link do Google
  const resolved = await Promise.all(
    chosen.map(async (n) => ({ ...n, link: await resolveOriginalUrl(n.link) }))
  );
  return resolved;
}

/* -------------------------------------------------------------------- */
/* Sinais de porte real — extração determinística de trechos de fontes   */
/* -------------------------------------------------------------------- */

const PORTE_PATTERNS: RegExp[] = [
  /(\d{1,3}(?:[.\s]\d{3})+|\d{2,})\s*(?:funcion[áa]rios|colaboradores|empregados|funcionarios)/i,
  /(?:faturamento|receita|billamento|fatura[çc][ãa]o)\s*(?:anual|estimado|de|:)?\s*(?:de|:)?\s*(R\$\s?[\d.,]+\s?(?:milh|bilh)[õo]es?)/i,
  /(R\$\s?[\d.,]+\s?(?:milh|bilh)[õo]es?)\s*(?:de faturamento|de receita)/i,
  /(\d{1,4})\s*(?:unidades|filiais|lojas|plantas|f[áa]bricas|centros de distribui[çc][ãa]o)/i,
  /frota(?:\s+pr[óo]pria)?\s*(?:de|com|:)?\s*(\d{1,4})\s*(?:caminh[õo]es|ve[íi]culos|carretas)/i,
  /(?:mais de|cerca de|aproximadamente|ao todo|\+)\s*(\d{1,3}(?:[.\s]\d{3})+|\d{2,})\s*(?:funcion[áa]rios|colaboradores|empregados|pessoas)/i,
];

/** Entrada de texto bruto com fonte opcional — a fonte entra NO sinal (atribuição explícita). */
export interface PorteSignalInput {
  fonte?: string;
  texto: string;
}

/**
 * Recorta a frase do match respeitando FRONTEIRA DE FRASE e palavra — o recorte
 * antigo (±60/140 do match) cortava o título no meio ("…ra RISE with SAP e
 * atualiza"), destruindo a atribuição de entidade (ex.: "Sementes Jotabasso").
 */
function recorteComFrase(text: string, matchIdx: number): string {
  // início: fronteira de frase anterior ao match (". ", "! ", "? ", "· "), senão 120 chars atrás
  let start = Math.max(0, matchIdx - 120);
  const antes = text.slice(0, matchIdx);
  const marcadores = [". ", "! ", "? ", "· ", " — "];
  let fraseStart = -1;
  for (const mk of marcadores) {
    const i = antes.lastIndexOf(mk);
    if (i > fraseStart) fraseStart = i;
  }
  if (fraseStart >= 0 && matchIdx - fraseStart <= 220) {
    const mk = marcadores.find((mk) => antes.lastIndexOf(mk) === fraseStart) ?? ". ";
    start = Math.min(fraseStart + mk.length, matchIdx);
  }
  while (start > 0 && start < matchIdx && /\S/.test(text[start] ?? "") && /\S/.test(text[start - 1] ?? "")) start++;
  // fim: até 140 chars depois do match, completando a palavra (nunca cortar no meio)
  let end = Math.min(text.length, matchIdx + 140);
  while (end < text.length && /\S/.test(text[end] ?? "")) end++;
  return text.slice(start, end).trim();
}

/**
 * Extrai frases com sinais de porte (headcount, faturamento, frota, unidades)
 * de textos crus (snippet de busca, notícia, página). Deduplica por similaridade
 * simples e devolve no máximo `max` frases curtas — cada uma rastreável ao trecho.
 * v0.9.1: cada sinal carrega a FONTE à frente quando informada (título do
 * resultado/notícia) — o nome da entidade da fonte fica visível no dossiê
 * (golden case: "Sementes Jotabasso" ≠ PJ analisada "Agropastoril Jotabasso").
 */
export function extractPorteSignals(texts: (string | PorteSignalInput)[], max = 6): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of texts) {
    if (!rawEntry) continue;
    const entry: PorteSignalInput = typeof rawEntry === "string" ? { texto: rawEntry } : rawEntry;
    const text = entry.texto.replace(/\s+/g, " ").trim();
    if (!text) continue;
    for (const re of PORTE_PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      const cut = recorteComFrase(text, m.index ?? 0);
      const snippet = entry.fonte ? `${entry.fonte} — ${cut}` : cut;
      const key = snippet.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
      // dedup forte: mesma chave OU recorte que se sobrepõe a um já capturado
      // (padrões diferentes frequentemente casam com a mesma frase)
      const overlap = found.some((f) => {
        const a = f.toLowerCase();
        const b = snippet.toLowerCase();
        const shorter = Math.min(a.length, b.length);
        if (shorter < 20) return false;
        // janela deslizante simples: metade menor contida na maior?
        if (a.includes(b) || b.includes(a)) return true;
        let hits = 0;
        for (let i = 0; i + 8 <= b.length; i += 8) {
          if (a.includes(b.slice(i, i + 8))) hits++;
        }
        return hits / Math.max(1, Math.floor(b.length / 8)) > 0.6;
      });
      if (seen.has(key) || overlap) continue;
      seen.add(key);
      found.push(snippet.slice(0, 260));
      if (found.length >= max) return found;
    }
  }
  return found;
}
