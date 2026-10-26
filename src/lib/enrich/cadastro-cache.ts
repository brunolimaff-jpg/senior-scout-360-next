/**
 * Ficha cadastral reutilizável por CNPJ (v0.10.0 P1 — desenho do operador).
 * Substitui o reuso "entre lotes" via ImportRow (que não tinha validade e
 * sobrescrevia queriedAt sem nova consulta).
 *
 * Regras:
 * - UMA linha por CNPJ na tabela CadastroCache, com fonte primária, data da
 *   coleta ORIGINAL (coletadoEm — nunca sobrescrita por reuso) e validade (TTL).
 * - Cache só vale DENTRO do TTL (30 dias). Expirou → nova consulta (revalidação)
 *   e a ficha é substituída com nova coletadoEm (é uma NOVA coleta, honesto).
 * - Cada campo mantém proveniência (fonte + coletadoEm) em provenienciaJson.
 * - IBGE não entra no cache: é rederivado localmente (grátis, determinístico).
 * - A decisão é determinística; toda consulta/reuso registra auditoria + telemetria.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { emVooUnico } from "@/lib/single-flight";
import {
  enrichCnpj,
  type CnpjLookupData,
  type CnpjLookupResult,
  type CnpjLookupSuccess,
  type FonteComplementacao,
} from "@/lib/enrich/sources";

/** Validade da ficha cadastral (dias). Depois disso, a próxima consulta REVALIDA. */
export const CADASTRO_TTL_DIAS = 30;
const CADASTRO_TTL_MS = CADASTRO_TTL_DIAS * 24 * 60 * 60 * 1000;

/** Proveniência de fontes/campos de uma linha (persistida em ImportRow.fontesJson). */
export interface FontesProveniencia {
  primaria: { fonte: string; coletadoEm: string };
  complementacoes: { fonte: string; campos: string[]; coletadoEm: string }[];
  /** presente quando os dados vieram da ficha cadastral (reuso dentro do TTL) */
  cache: { consultaOriginal: string; validoAte: string; reaproveitadoEm: string } | null;
}

export interface LookupComCache {
  resultado: CnpjLookupSuccess | null;
  attempts: CnpjLookupResult[];
  via: "cache" | "consulta";
  cacheMeta: { consultaOriginal: string; validoAte: string } | null;
  complementacoes: FonteComplementacao[];
  /** v0.10.1: fontes puladas pelo portão de capacidade (sem HTTP) na coleta real;
   *  vazio no reuso de cache (nenhuma fonte foi consultada) */
  fontesPuladasCapacidade: string[];
  /** true quando havia ficha mas ela estava fora do TTL (nova consulta = revalidação) */
  revalidou?: boolean;
}

interface CacheDados {
  data: CnpjLookupData;
  rawJson: string;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function ttlAte(de: Date): Date {
  return new Date(de.getTime() + CADASTRO_TTL_MS);
}

/** Monta o mapa campo → fonte a partir da primária + complementações.
 *  v0.10.1: guarda TAMBÉM a LISTA de complementações (_lista) — ao reutilizar a
 *  ficha, a proveniência "Complementado por" é restaurada em vez de renascer vazia. */
function buildProveniencia(
  primaria: { source: string; queriedAt: string },
  complementacoes: FonteComplementacao[]
): Record<string, { fonte: string; coletadoEm: string } | FonteComplementacao[]> {
  const map: Record<string, { fonte: string; coletadoEm: string } | FonteComplementacao[]> = {};
  // campos de IDENTIDADE e o que a primária trouxe por padrão
  for (const c of [
    "legalName", "tradeName", "registrationStatus", "statusDate", "situationReason",
    "branchType", "branchIdentifier", "openingDate", "cnaeCode", "cnaeDescription",
    "municipality", "uf", "capitalSocial", "naturezaJuridica", "porte", "simples",
    "mei", "email", "telefone", "telefone2", "regimeTributario", "endereco",
    "cnaesSecundarios", "codigoMunicipioIbge", "socios",
  ]) {
    map[c] = { fonte: primaria.source, coletadoEm: primaria.queriedAt };
  }
  // complementações SOBRESCREVEM apenas os campos que de fato preencheram
  for (const comp of complementacoes) {
    for (const campo of comp.campos) {
      const key = campo === "qsa" ? "socios" : campo;
      map[key] = { fonte: comp.source, coletadoEm: comp.coletadoEm };
    }
  }
  if (complementacoes.length > 0) {
    map._lista = complementacoes.map((c) => ({ source: c.source, campos: [...c.campos], coletadoEm: c.coletadoEm }));
  }
  return map;
}

/** Restaura a lista de complementações persistida no provenienciaJson (_lista).
 *  Fichas antigas (v0.10.0) não têm _lista — devolvem [] honesto (dado intacto,
 *  proveniência por campo continua lá). */
function complementacoesDeCache(provenienciaJson: string | null): FonteComplementacao[] {
  if (!provenienciaJson) return [];
  try {
    const p = JSON.parse(provenienciaJson) as { _lista?: unknown };
    if (!Array.isArray(p?._lista)) return [];
    return (p._lista as FonteComplementacao[])
      .filter((c) => c && typeof c.source === "string" && Array.isArray(c.campos))
      .map((c) => ({ source: c.source, campos: c.campos, coletadoEm: String(c.coletadoEm ?? "") }));
  } catch {
    return [];
  }
}

/**
 * Consulta um CNPJ com ficha cadastral:
 * 1. ficha DENTRO do TTL (e sem forceFresh) → reuso honesto (via "cache");
 * 2. sem ficha, fora do TTL ou forceFresh → cadeia de fontes; sucesso → upsert da ficha.
 */
export async function lookupCnpjComCache(
  cnpj: string,
  opts: { forceFresh?: boolean; complementar?: boolean } = {}
): Promise<LookupComCache> {
  const agora = new Date();

  if (!opts.forceFresh) {
    const cache = await db.cadastroCache.findUnique({ where: { cnpj } });
    if (cache && cache.validoAte > agora) {
      try {
        const parsed = JSON.parse(cache.dadosJson) as CacheDados;
        if (parsed?.data?.legalName) {
          return {
            resultado: {
              ok: true,
              source: cache.fonte,
              data: parsed.data,
              rawJson: parsed.rawJson ?? "",
              queriedAt: cache.coletadoEm.toISOString(),
            },
            attempts: [],
            via: "cache",
            cacheMeta: {
              consultaOriginal: cache.coletadoEm.toISOString(),
              validoAte: cache.validoAte.toISOString(),
            },
            // v0.10.1: complementações da coleta ORIGINAL restauradas — o reuso
            // continua mostrando QUE fonte preencheu QUE campo (proveniência íntegra).
            complementacoes: complementacoesDeCache(cache.provenienciaJson),
            fontesPuladasCapacidade: [],
          };
        }
      } catch {
        /* ficha corrompida → segue para consulta real */
      }
    }
  }

  // v0.10.10: a COLETA roda sob voo único por CNPJ — revalidações/confirmações
  // concorrentes do MESMO cadastro compartilham UMA cadeia de fontes (a reserva da
  // coleta é atômica com a decisão de coletar). A telemetria da cadeia é gravada
  // UMA vez (pelo líder, dentro de enrichCnpj) — seguidores não a duplicam.
  const { valor: outcome } = await emVooUnico(`cadastro:${cnpj}`, () => enrichCnpj(cnpj, { complementar: opts.complementar !== false }));
  const result = outcome.result;
  if (result?.ok) {
    const coletadoEm = new Date(result.queriedAt);
    const anterior = await db.cadastroCache.findUnique({ where: { cnpj }, select: { coletadoEm: true, revalidacoes: true, provenienciaJson: true } });
    const dados: CacheDados = {
      data: { ...result.data, extra: { ...result.data.extra, ibge: null } },
      rawJson: result.rawJson,
    };
    const proveniencia = buildProveniencia({ source: result.source, queriedAt: result.queriedAt }, outcome.complementacoes);
    try {
      await db.cadastroCache.upsert({
        where: { cnpj },
        create: {
          cnpj,
          fonte: result.source,
          coletadoEm,
          atualizadoEm: agora,
          validoAte: ttlAte(coletadoEm),
          dadosJson: JSON.stringify(dados),
          provenienciaJson: JSON.stringify(proveniencia),
          complementacoes: outcome.complementacoes.length,
          revalidacoes: 0,
        },
        update: {
          fonte: result.source,
          coletadoEm,
          atualizadoEm: agora,
          validoAte: ttlAte(coletadoEm),
          dadosJson: JSON.stringify(dados),
          provenienciaJson: JSON.stringify(proveniencia),
          complementacoes: outcome.complementacoes.length,
          revalidacoes: (anterior?.revalidacoes ?? 0) + (anterior ? 1 : 0),
        },
      });
    } catch {
      /* falha de cache NUNCA derruba a consulta real */
    }
    return {
      resultado: result,
      attempts: outcome.attempts,
      via: "consulta",
      cacheMeta: null,
      complementacoes: outcome.complementacoes,
      fontesPuladasCapacidade: outcome.fontesPuladasCapacidade,
      revalidou: !!anterior,
    };
  }
  return { resultado: null, attempts: outcome.attempts, via: "consulta", cacheMeta: null, complementacoes: [], fontesPuladasCapacidade: outcome.fontesPuladasCapacidade };
}

/** Persiste o resultado da etapa de matriz na ficha (reuso entre filiais sem nova consulta). */
export async function updateMatrizCache(
  cnpj: string,
  matriz: { headquartersCnpj: string | null; foundIsHeadquarters: boolean | null; matrizStatus: string | null; branchIdentifier: number | null }
): Promise<void> {
  try {
    await db.cadastroCache.updateMany({
      where: { cnpj },
      data: { matrizJson: JSON.stringify(matriz) },
    });
  } catch {
    /* tolerante — matriz segue funcionando sem cache */
  }
}

export function cacheSha(cnpj: string): string {
  return sha256Hex(cnpj);
}
