/**
 * ibge.ts — CONTEXTO MUNICIPAL via API pública do IBGE (sem chave, sem custo).
 *
 * Enriquecimento além do CNPJ: a cidade onde a conta opera vira dado do mapeamento
 * (população estimada, região imediata/intermediária, mesorregião) — um CNPJ em
 * Rondonópolis (268 mil hab.) e um em Brasília contam histórias comerciais distintas.
 *
 * Fontes:
 *   - /api/v1/localidades/municipios/{id}  → nome, microrregião/mesorregião, região imediata
 *   - /api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[{id}]
 *       → população residente estimada (série mais recente)
 *
 * Regras: NUNCA lança; cache em memória por processo (mesmo município não refetch);
 * timeout curto — falha de IBGE nunca atrasa o enriquecimento do CNPJ.
 * Compat: fallback resolve o ID pela UF+nome quando a fonte não trouxe código IBGE.
 */
import type { IbgeContext } from "./sources";

const TIMEOUT_MS = 8_000; // lista de municípios por UF pode chegar a ~300KB — tempo real medido: 3,3s
const AGREGADOS_POP = "https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324";

interface Cache {
  /** id IBGE → contexto completo (inclui população) */
  ctx: Map<string, IbgeContext | null>;
  /** "UF" → lista de {id, nome} para fallback por nome */
  uf: Map<string, { id: string; nome: string }[]>;
}
const g = globalThis as unknown as { __scoutIbgeCache?: Cache };
g.__scoutIbgeCache ??= { ctx: new Map(), uf: new Map() };
const cache = g.__scoutIbgeCache;

async function getJson(url: string): Promise<Record<string, unknown> | unknown[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "Senior-Scout-360/1.0 (mapeamento municipal)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown> | unknown[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickStr(obj: Record<string, unknown> | undefined | null, path: string[]): string {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur === null || cur === undefined ? "" : String(cur).trim();
}

/** População residente estimada (agregado 6579 / variável 9324 — série mais recente). */
async function populacaoDe(ibgeId: string): Promise<{ populacao: string; ano: string }> {
  const json = await getJson(`${AGREGADOS_POP}?localidades=N6%5B${ibgeId}%5D`);
  if (!Array.isArray(json)) return { populacao: "", ano: "" };
  try {
    const first = json[0] as Record<string, unknown>;
    const resultados = first?.resultados as Record<string, unknown>[] | undefined;
    const series = resultados?.[0]?.series as Record<string, unknown>[] | undefined;
    const s = series?.[0]?.serie as Record<string, string> | undefined;
    if (!s) return { populacao: "", ano: "" };
    // série {"2026":"268202", ...} — pega o ano mais recente com valor
    const anos = Object.keys(s)
      .filter((k) => /^\d{4}$/.test(k))
      .sort((a, b) => Number(b) - Number(a));
    for (const ano of anos) {
      const raw = s[ano];
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        return { populacao: new Intl.NumberFormat("pt-BR").format(n), ano };
      }
    }
  } catch {
    /* tolerante */
  }
  return { populacao: "", ano: "" };
}

/** Contexto completo do município pelo ID IBGE (cacheado; null quando falha). */
async function contextoPorId(ibgeId: string): Promise<IbgeContext | null> {
  if (cache.ctx.has(ibgeId)) return cache.ctx.get(ibgeId) ?? null;
  const j = (await getJson(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${ibgeId}`)) as
    | Record<string, unknown>
    | null;
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    cache.ctx.set(ibgeId, null);
    return null;
  }
  const pop = await populacaoDe(ibgeId);
  const ctx: IbgeContext = {
    populacao: pop.populacao,
    anoPopulacao: pop.ano,
    regiaoImediata: pickStr(j, ["regiao-imediata", "nome"]),
    regiaoIntermediaria: pickStr(j, ["regiao-imediata", "regiao-intermediaria", "nome"]),
    mesorregiao: pickStr(j, ["microrregiao", "mesorregiao", "nome"]),
    microrregiao: pickStr(j, ["microrregiao", "nome"]),
    regiao: pickStr(j, ["microrregiao", "mesorregiao", "UF", "regiao", "nome"]),
  };
  cache.ctx.set(ibgeId, ctx);
  return ctx;
}

/** Normaliza para comparação de nomes (sem acento, minúsculo). */
function normNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Fallback: resolve o ID IBGE por UF + nome do município (lista de UF cacheada). */
async function idPorNome(uf: string, municipio: string): Promise<string | null> {
  const ufSigla = uf.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(ufSigla) || !municipio) return null;
  let lista = cache.uf.get(ufSigla);
  if (!lista) {
    const j = (await getJson(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${ufSigla}/municipios`)) as
      | unknown[]
      | null;
    if (!Array.isArray(j)) return null;
    lista = (j as Record<string, unknown>[])
      .map((m) => ({ id: String(m.id ?? ""), nome: String(m.nome ?? "") }))
      .filter((m) => m.id && m.nome);
    cache.uf.set(ufSigla, lista);
  }
  const alvo = normNome(municipio);
  const hit =
    lista.find((m) => normNome(m.nome) === alvo) ??
    lista.find((m) => normNome(m.nome).startsWith(alvo));
  return hit?.id ?? null;
}

/**
 * Enriquece o contexto municipal da conta. Ordem: ID da fonte (BrasilAPI/MinhaReceita)
 * → UF+nome. Nunca lança e nunca demora mais que ~2 chamadas HTTP curtas.
 */
export async function contextoMunicipal(
  codigoIbgeFonte: string,
  uf: string,
  municipio: string
): Promise<IbgeContext | null> {
  try {
    if (codigoIbgeFonte && /^\d{5,7}$/.test(codigoIbgeFonte)) {
      return await contextoPorId(codigoIbgeFonte);
    }
    const id = await idPorNome(uf, municipio);
    if (id) return await contextoPorId(id);
  } catch {
    /* honestidade > exceção */
  }
  return null;
}
