/**
 * Serviço de RELAÇÕES EMPRESARIAIS + MATRIZ/FILIAIS (v0.10.5 — frentes A e B).
 *
 * Regras do contrato do operador, aplicadas AQUI:
 * - Consulta somente para CNPJs selecionados pelo usuário (rota chamada por
 *   comando explícito na ficha). Sem crawler, sem lote, sem recursão automática.
 * - Expansão de grafo: UMA conexão por comando (1 hop). Nunca encadeada.
 * - Descoberta de estabelecimentos pela raiz: quadros societários de
 *   participantes PF com TETO de participantes e TETO de confirmações por
 *   rodada — cobertura PARCIAL, sempre rotulada como tal.
 * - Matriz e filial SEMPE pelo campo oficial identificador_matriz_filial,
 *   confirmado por consulta própria (nunca pela ordem "0001").
 * - Cache por CNPJ/raiz/participante + fonte, com validade (TTL 30 dias);
 *   reuso dentro do TTL não repete HTTP; falha NUNCA apaga fato válido
 *   (persistência só em consulta bem-sucedida).
 * - IA desligada: nenhuma chamada de modelo em nenhum caminho daqui.
 * - Nenhum CPF (nem mascarado) é persistido; respostas brutas de PF não são
 *   guardadas — só a normalização mínima com proveniência.
 */
import { db } from "@/lib/db";
import { validateCnpj, normalizeCnpj } from "@/lib/cnpj";
import { recordTelemetry } from "@/lib/telemetry";
import { emVooUnico } from "@/lib/single-flight";
import { lookupCnpjComCache } from "@/lib/enrich/cadastro-cache";
import { plural } from "@/lib/linguagem";
import type {
  QualificacaoCadastro,
  ParticipanteComumView,
  ParticipanteView,
  RelacoesView,
  QuadroView,
  EstabelecimentoView,
  MatrizFiliaisView,
} from "@/lib/types";
import {
  normalizarRelacoesGrafo,
  normalizarQuadroParticipante,
  filtrarMesmoRaiz,
  detectarParticipantesComuns,
  validarParticipanteId,
  classificarParticipantePorId,
  mapearErroGrafo,
  raizDe,
  contarPessoasJuridicas,
  type ErroGrafo,
  type ParticipanteGrafo,
  type EmpresaQuadro,
  QUADRO_TETO,
  QUADRO_TETO_EXIBICAO,
} from "./grafo";

export const FONTE_GRAFO = "MinhaReceita Grafo";
export const RELACAO_TTL_DIAS = 30;
/** Teto de quadros de participantes consultados por rodada de descoberta (FRENTE B). */
export const TETO_PARTICIPANTES = 10;
/** Teto de confirmações individuais por rodada (cada confirmação = consulta própria). */
export const TETO_CONFIRMACOES = 20;
/** Teto de exibição da lista de estabelecimentos na ficha. */
export const TETO_EXIBICAO_ESTABELECIMENTOS = 50;
/** Teto de empresas investigadas para detecção de participante comum no lote. */
const TETO_COMPARACAO_LOTE = 200;

/**
 * v0.10.24 (auditoria do checkpoint v0.10.23): os avisos da normalização do quadro
 * (unificação de registros repetidos da fonte, teto de armazenamento) são FATOS da
 * coleta — a leitura de cache NÃO pode devolvê-los vazios, senão um quadro unificado
 * volta a parecer resposta integral da fonte após reabrir a ficha.
 *
 * Prioridade: avisos persistidos na 1ª consulta (coluna avisosJson). Fallback
 * determinístico para linhas de cache ANTIGAS (coluna nula): rederiva o aviso de
 * teto a partir de truncado/totalEmpresas — os únicos avisos rederiváveis. O aviso
 * de unificação não é rederivável (as linhas brutas da fonte nunca são persistidas);
 * linhas antigas sem a coluna e sem truncamento ficam sem aviso — estado honesto,
 * nunca inventado. Nenhum dado pessoal envolvido: avisos são frases de proveniência.
 */
function avisosDeQuadroEmCache(truncado: boolean, totalEmpresas: number, avisosJson: string | null): string[] {
  if (avisosJson) {
    try {
      const parsed = JSON.parse(avisosJson) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((a): a is string => typeof a === "string");
    } catch {
      /* JSON ilegível → fallback determinístico abaixo (nada inventado) */
    }
  }
  return truncado
    ? [`Quadro com ${totalEmpresas} empresas — armazenamento limitado ao teto de ${QUADRO_TETO} (total real preservado).`]
    : [];
}

const TTL_MS = RELACAO_TTL_DIAS * 24 * 60 * 60 * 1000;

/** Fetcher injetável (testes substituem; produção usa fetch com timeout). */
export type GrafoFetcher = (path: string, timeoutMs: number) => Promise<{ status: number; json: unknown; causa?: "timeout" | "rede" }>;

const fetchPadrao: GrafoFetcher = async (path, timeoutMs) => {
  try {
    const res = await fetch(`https://grafo.minhareceita.org${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e) {
    const isTimeout = (e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError";
    return { status: 0, json: null, causa: isTimeout ? "timeout" : "rede" };
  }
};

/* ------------------------------ views ------------------------------ */

export type ResultadoInvestigacao =
  | { ok: true; view: RelacoesView }
  | { ok: true; view: QuadroView }
  | { ok: true; view: MatrizFiliaisView }
  | { ok: false; motivo: string; detalhe?: string; erroFonte?: ErroGrafo };

const MOTIVOS_DE_ROTA: Record<string, number> = {
  lote_nao_encontrado: 404,
  linha_nao_encontrada: 404,
  linha_nao_investigavel: 409,
  participante_invalido: 422,
  fonte_erro: 502,
};

export function httpStatusDeResultado(r: ResultadoInvestigacao): number {
  if (r.ok) return 200;
  if (r.motivo === "fonte_erro" && r.erroFonte) {
    // 429 é repassado como 429 (upstream preservado — padrão v0.10.4)
    if (r.erroFonte.tipo === "RATE_LIMITED") return 429;
    if (r.erroFonte.tipo === "TIMEOUT") return 504;
    if (r.erroFonte.tipo === "SEM_RELACOES_REGISTRADAS") return 200; // ausência honesta ≠ erro
    return 502;
  }
  return MOTIVOS_DE_ROTA[r.motivo] ?? 500;
}

/* ------------------------------ helpers ------------------------------ */

function ttlAte(de: Date): Date {
  return new Date(de.getTime() + TTL_MS);
}

interface LinhaCtx {
  normalizedCnpj: string;
  legalName: string | null;
  branchType: string | null;
  branchIdentifier: number | null;
  headquartersCnpj: string | null;
  sociosJson: string | null;
}

async function carregarLinha(batchId: string, rowNumber: number): Promise<LinhaCtx | null> {
  const row = await db.importRow.findFirst({
    where: { batchId, rowNumber },
    select: {
      normalizedCnpj: true,
      lookupStatus: true,
      legalName: true,
      branchType: true,
      branchIdentifier: true,
      headquartersCnpj: true,
      sociosJson: true,
    },
  });
  if (!row) return null;
  if (row.lookupStatus !== "ENRIQUECIDO" || !row.normalizedCnpj) return null;
  const v = validateCnpj(row.normalizedCnpj);
  if (!v.valid) return null;
  return {
    normalizedCnpj: v.normalized,
    legalName: row.legalName,
    branchType: row.branchType,
    branchIdentifier: row.branchIdentifier,
    headquartersCnpj: row.headquartersCnpj,
    sociosJson: row.sociosJson,
  };
}

function qualificacaoDoCadastro(sociosJson: string | null, nomePublico: string): QualificacaoCadastro | null {
  if (!sociosJson) return null;
  try {
    const arr = JSON.parse(sociosJson) as { nome?: string; qual?: string; entrada?: string }[];
    if (!Array.isArray(arr)) return null;
    const alvo = nomePublico.trim().toUpperCase();
    const matches = arr.filter((s) => (s.nome ?? "").trim().toUpperCase() === alvo && alvo.length > 0);
    // homônimo dentro do próprio quadro → sem qualificação atribuída (nada inventado)
    if (matches.length !== 1 || !matches[0].qual) return null;
    return { qual: matches[0].qual, entrada: matches[0].entrada ?? "", origem: "cadastro" };
  } catch {
    return null;
  }
}

/** Busca base de dados (/updated) da fonte — best-effort, falha é ignorada.
 *  v0.10.10: sob voo único — comandos concorrentes compartilham a mesma leitura. */
async function baseDaFonte(fetcher: GrafoFetcher): Promise<string | null> {
  const { valor: r } = await emVooUnico("grafo:updated", () => fetcher("/updated", 5000));
  const msg = (r.json as { message?: unknown })?.message;
  return typeof msg === "string" ? msg : null;
}

function normalizeUpper(s: string): string {
  return s.trim().toUpperCase();
}

/* ------------------------------ FRENTE A ------------------------------ */

/** Investigação de relações societárias DIRETAS (1 requisição à fonte, ou cache). */
export async function investigarRelacoes(
  batchId: string,
  rowNumber: number,
  opts: { fetcher?: GrafoFetcher } = {}
): Promise<{ ok: true; view: RelacoesView } | { ok: false; motivo: string; detalhe?: string; erroFonte?: ErroGrafo }> {
  const fetcher = opts.fetcher ?? fetchPadrao;
  const linha = await carregarLinha(batchId, rowNumber);
  if (!linha) return { ok: false, motivo: "linha_nao_investigavel" };
  const cnpj = linha.normalizedCnpj;
  const t0 = Date.now();

  // 1) cache dentro do TTL
  const agora = new Date();
  const cache = await db.relacaoSocietariaCache.findUnique({ where: { cnpj } });
  if (cache && cache.validoAte > agora) {
    let relacoes = JSON.parse(cache.relacoesJson) as ParticipanteView[];
    // v0.10.16 — CORREÇÃO DE CLASSIFICAÇÃO RESIDUAL: caches gravados antes da regra
    // honesta rotularam como PF todo participante sem CNPJ (ex.: "BRD DIGITAL
    // PARTICIPACOES LTDA" com id de 8 dígitos). À leitura, reclassificamos pela
    // semântica da fonte e GRAVAMOS DE VOLTA (migração à leitura — zero reconsulta;
    // vínculo, fonte e datas de coleta preservados).
    const desalinhadas = relacoes.some((p) => classificarParticipantePorId(p.participanteId, validateCnpj) !== p.tipo);
    if (desalinhadas) {
      const corrigidas = relacoes.map((p) => {
        const tipo = classificarParticipantePorId(p.participanteId, validateCnpj);
        return { ...p, tipo, razaoSocialPj: tipo === "PJ" ? p.razaoSocialPj ?? p.nomePublico : null };
      });
      await db.relacaoSocietariaCache.update({ where: { cnpj }, data: { relacoesJson: JSON.stringify(corrigidas) } });
      relacoes = corrigidas;
    }
    const { participantes, existeParticipanteComum, avisos } = await enriquecerParticipantes(
      relacoes.map((p) => ({ participanteId: p.participanteId, tipo: p.tipo, nomePublico: p.nomePublico, cnpjParticipante: p.cnpjParticipante, razaoSocialPj: p.razaoSocialPj })),
      batchId,
      cnpj,
      linha.sociosJson
    );
    // v0.11.0 (Gate 8/G8-1): avisos de normalização da coleta ORIGINAL (persistidos
    // desde esta versão) voltam na releitura — antes o cache os descartava e a
    // segunda leitura dizia avisos:[] para os mesmos dados.
    const avisosColeta: string[] = (() => {
      if (!cache.avisosJson) return [];
      try {
        const arr = JSON.parse(cache.avisosJson);
        return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
      } catch {
        return [];
      }
    })();
    recordTelemetry({
      tipo: "RELACAO_GRAFO",
      fonte: cache.fonte,
      alvo: cnpj,
      cacheHit: true,
      resultados: cache.totalParticipantes,
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - t0,
      payload: { via: "cache", baseDados: cache.baseDados ?? null },
    });
    return {
      ok: true,
      view: {
        ok: true,
        cnpj,
        razaoSocialConsultada: linha.legalName,
        fonte: cache.fonte,
        baseDados: cache.baseDados,
        coletadoEm: cache.coletadoEm.toISOString(),
        validoAte: cache.validoAte.toISOString(),
        via: "cache",
        participantes,
        totalParticipantes: cache.totalParticipantes,
        existeParticipanteComum,
        avisos: [...avisosColeta, ...avisos],
      },
    };
  }

  // 2) consulta real — VOOR ÚNICO por alvo (v0.10.10): comandos concorrentes para
  // o MESMO CNPJ compartilham UMA chamada (a reserva da consulta é atômica com a
  // decisão de consultar — prova contra duplicação: qa/estresse-v0.10.10/).
  const { valor: resp, lider } = await emVooUnico(`grafo:relacoes:${cnpj}`, () => fetcher(`/${cnpj}`, 15000));
  const viaConsulta = lider ? "consulta" : "coalescido";
  if (resp.status !== 200) {
    const erro = mapearErroGrafo(resp.status === 0 ? null : resp.status, resp.json ? JSON.stringify(resp.json).slice(0, 200) : null, resp.causa);
    recordTelemetry({
      tipo: "RELACAO_GRAFO",
      fonte: FONTE_GRAFO,
      alvo: cnpj,
      httpStatus: erro.httpStatus,
      cacheHit: false,
      estadoFinal: erro.tipo === "SEM_RELACOES_REGISTRADAS" ? "sucesso" : "falha",
      duracaoMs: Date.now() - t0,
      payload: { tipo: erro.tipo, via: viaConsulta },
    });
    if (erro.tipo === "SEM_RELACOES_REGISTRADAS") {
      // ausência honesta — NÃO é falha: devolve lista vazia com aviso
      return {
        ok: true,
        view: {
          ok: true,
          cnpj,
          razaoSocialConsultada: linha.legalName,
          fonte: FONTE_GRAFO,
          baseDados: null,
          coletadoEm: new Date().toISOString(),
          validoAte: ttlAte(new Date()).toISOString(),
          via: "consulta",
          participantes: [],
          totalParticipantes: 0,
          existeParticipanteComum: false,
          avisos: ["Nenhuma relação societária pública registrada para este identificador na base consultada (ausência registrada, não é falha)."],
        },
      };
    }
    return { ok: false, motivo: "fonte_erro", erroFonte: erro };
  }
  const norm = normalizarRelacoesGrafo(resp.json, { cnpjConsultado: cnpj, validarCnpj: validateCnpj });
  if (!norm.ok) {
    recordTelemetry({ tipo: "RELACAO_GRAFO", fonte: FONTE_GRAFO, alvo: cnpj, httpStatus: resp.status, cacheHit: false, estadoFinal: "falha", duracaoMs: Date.now() - t0, payload: { tipo: norm.tipo, via: viaConsulta } });
    return { ok: false, motivo: "fonte_erro", erroFonte: norm };
  }

  const agora2 = new Date();
  const baseDados = await baseDaFonte(fetcher);
  const persist = {
    fonte: FONTE_GRAFO,
    baseDados,
    coletadoEm: agora2,
    atualizadoEm: agora2,
    validoAte: ttlAte(agora2),
    relacoesJson: JSON.stringify(
      norm.participantes.map((p) => ({
        participanteId: p.participanteId,
        tipo: p.tipo,
        nomePublico: p.nomePublico,
        cnpjParticipante: p.cnpjParticipante,
        razaoSocialPj: p.tipo === "PJ" ? p.nomePublico : null,
      }))
    ),
    totalParticipantes: norm.totalParticipantes,
    // v0.11.0 (Gate 8/G8-1): avisos de NORMALIZação persistidos junto à coleta —
    // mesma correção da v0.10.24 para o quadro: releitura de cache não pode apagar
    // o fato de que a fonte devolveu registros sem id/sem nome/unificados por CNPJ.
    // Caches antigos (coluna ausente/null) devolvem [] — nada é inventado.
    avisosJson: norm.avisos.length > 0 ? JSON.stringify(norm.avisos) : null,
  };
  await db.relacaoSocietariaCache.upsert({ where: { cnpj }, create: { cnpj, ...persist }, update: { ...persist } });

  const { participantes, existeParticipanteComum, avisos } = await enriquecerParticipantes(norm.participantes, batchId, cnpj, linha.sociosJson);
  recordTelemetry({
    tipo: "RELACAO_GRAFO",
    fonte: FONTE_GRAFO,
    alvo: cnpj,
    httpStatus: resp.status,
    cacheHit: false,
    resultados: norm.totalParticipantes,
    estadoFinal: "sucesso",
    duracaoMs: Date.now() - t0,
    payload: { via: viaConsulta, baseDados, avisos: norm.avisos },
  });
  await db.auditEvent.create({
    data: {
      batchId,
      rowNumber,
      event: "relacoes_societarias",
      detail: JSON.stringify({ cnpj, via: "consulta", totalParticipantes: norm.totalParticipantes, baseDados, fonte: FONTE_GRAFO }),
    },
  });

  return {
    ok: true,
    view: {
      ok: true,
      cnpj,
      razaoSocialConsultada: linha.legalName ?? norm.razaoSocialConsultada,
      fonte: FONTE_GRAFO,
      baseDados,
      coletadoEm: agora2.toISOString(),
      validoAte: ttlAte(agora2).toISOString(),
      via: "consulta",
      participantes,
      totalParticipantes: norm.totalParticipantes,
      existeParticipanteComum,
      avisos: [...norm.avisos, ...avisos],
    },
  };
}

/**
 * Anexa qualificação do cadastro (reuso) + participantes comuns do MESMO lote.
 * v0.10.6 — consolidação de identidade: participante comum SÓ conta entre
 * PESSOAS JURÍDICAS DISTINTAS (raízes diferentes). Sobreposição entre
 * estabelecimentos da MESMA raiz é a MESMA pessoa jurídica (matriz/filial) —
 * vai para `comumMesmaPj` e nunca é apresentada como relação entre empresas.
 */
async function enriquecerParticipantes(
  base: (ParticipanteGrafo & { razaoSocialPj?: string | null })[],
  batchId: string,
  cnpjProprio: string,
  sociosJson: string | null
): Promise<{ participantes: ParticipanteView[]; existeParticipanteComum: boolean; avisos: string[] }> {
  const avisos: string[] = [];
  const raizPropria = raizDe(cnpjProprio);

  // participante comum: outras linhas ENRIQUECIDAS do MESMO lote com relações em cache
  const outras = await db.importRow.findMany({
    where: { batchId, lookupStatus: "ENRIQUECIDO", normalizedCnpj: { not: cnpjProprio } },
    select: { normalizedCnpj: true, legalName: true },
    take: TETO_COMPARACAO_LOTE,
  });
  let comparadas = outras.length;
  if (outras.length >= TETO_COMPARACAO_LOTE) avisos.push(`Comparação de participantes limitada a ${TETO_COMPARACAO_LOTE} linhas do lote.`);
  const cnpjsOutras = outras.map((o) => o.normalizedCnpj);
  const cachesOutras = await db.relacaoSocietariaCache.findMany({ where: { cnpj: { in: cnpjsOutras } } });
  comparadas = cachesOutras.length;
  const mapaComum = new Map<string, ParticipanteComumView[]>();
  const mapaMesmaPj = new Map<string, { cnpj: string; nota: string }[]>();
  let sobreposicaoMesmaPj = 0;
  for (const co of cachesOutras) {
    // v0.10.6: estabelecimento da MESMA raiz = mesma pessoa jurídica — não é "outra empresa"
    const mesmoRaiz = raizDe(co.cnpj) === raizPropria;
    try {
      const rels = JSON.parse(co.relacoesJson) as ParticipanteView[];
      for (const p of rels) {
        if (mesmoRaiz) {
          const lista = mapaMesmaPj.get(p.participanteId) ?? [];
          if (!lista.some((x) => x.cnpj === co.cnpj)) {
            lista.push({
              cnpj: co.cnpj,
              nota: `também figura no quadro de ${co.cnpj} — estabelecimento da MESMA raiz (mesma pessoa jurídica); não é relação entre empresas distintas`,
            });
            sobreposicaoMesmaPj += 1;
          }
          mapaMesmaPj.set(p.participanteId, lista);
        } else {
          const lista = mapaComum.get(p.participanteId) ?? [];
          if (!lista.some((x) => x.cnpj === co.cnpj)) {
            lista.push({
              cnpj: co.cnpj,
              razaoSocial: p.razaoSocialPj ?? null,
              nota: "participante comum (mesmo quadro público) — NÃO caracteriza grupo econômico",
            });
          }
          mapaComum.set(p.participanteId, lista);
        }
      }
    } catch {
      /* cache de outra linha ilegível → ignorado sem inventar */
    }
  }
  if (sobreposicaoMesmaPj > 0) {
    avisos.push(
      `${plural(sobreposicaoMesmaPj, "sobreposição", "sobreposições")} de participante com estabelecimento da MESMA raiz ${sobreposicaoMesmaPj === 1 ? "foi classificada" : "foram classificadas"} como mesma pessoa jurídica — não são relações entre empresas distintas.`
    );
  }

  const participantes: ParticipanteView[] = base.map((p) => ({
    participanteId: p.participanteId,
    tipo: p.tipo,
    nomePublico: p.nomePublico,
    cnpjParticipante: p.cnpjParticipante,
    razaoSocialPj: p.razaoSocialPj ?? null,
    qualificacao: p.tipo === "PF" ? qualificacaoDoCadastro(sociosJson, p.nomePublico) : null,
    comumCom: mapaComum.get(p.participanteId) ?? [],
    comumMesmaPj: mapaMesmaPj.get(p.participanteId) ?? [],
  }));

  const totalComum = participantes.reduce((acc, p) => acc + p.comumCom.length, 0);
  return {
    participantes,
    existeParticipanteComum: totalComum > 0,
    avisos,
  };
}

/* ------------------------- expansão manual (1 hop) ------------------------- */

/**
 * v0.10.23 — LEITURA PURA DO CACHE (zero rede, zero IA): quadros de participantes
 * JÁ expandidos por comando e ainda válidos, para alimentar o mapa de relações.
 * Nunca consulta a fonte: o que não está no cache simplesmente não vem — criar
 * ligação nova é sempre o comando explícito (investigarConexao).
 */
export async function quadrosEmCacheDaLinha(
  batchId: string,
  rowNumber: number
): Promise<{ ok: true; quadros: Record<string, QuadroView>; avisos: string[] } | { ok: false; motivo: string }> {
  const linha = await carregarLinha(batchId, rowNumber);
  if (!linha) return { ok: false, motivo: "linha_nao_investigavel" };
  const cnpj = linha.normalizedCnpj;
  const agora = new Date();
  const rel = await db.relacaoSocietariaCache.findUnique({ where: { cnpj } });
  if (!rel) return { ok: true, quadros: {}, avisos: [] };
  let participantes: { participanteId: string; nomePublico: string }[] = [];
  try {
    participantes = (JSON.parse(rel.relacoesJson) as ParticipanteView[]).map((p) => ({ participanteId: p.participanteId, nomePublico: p.nomePublico }));
  } catch {
    return { ok: true, quadros: {}, avisos: [] };
  }
  const ids = [...new Set(participantes.map((p) => p.participanteId))].filter(Boolean);
  if (ids.length === 0) return { ok: true, quadros: {}, avisos: [] };
  const caches = await db.quadroParticipanteCache.findMany({ where: { participanteId: { in: ids }, validoAte: { gt: agora } } });
  const quadros: Record<string, QuadroView> = {};
  for (const c of caches) {
    let empresas: EmpresaQuadro[] = [];
    try {
      empresas = JSON.parse(c.empresasJson) as EmpresaQuadro[];
    } catch {
      continue; // cache ilegível não vira erro — leitura pura
    }
    const visiveis = empresas.slice(0, QUADRO_TETO_EXIBICAO);
    quadros[c.participanteId] = {
      ok: true,
      participanteId: c.participanteId,
      tipoParticipante: c.tipoParticipante as QuadroView["tipoParticipante"],
      rotulo: c.rotulo,
      leitura:
        c.tipoParticipante === "PF"
          ? "Encontramos as empresas em que este participante aparece no quadro societário público. A fonte pública cobre parte dos vínculos."
          : "Encontramos o quadro de sócios público deste participante (participação de pessoa jurídica).",
      totalEmpresas: c.totalEmpresas,
      totalPessoasJuridicas: contarPessoasJuridicas(empresas),
      truncado: c.truncado,
      empresas: visiveis,
      empresasOcultas: Math.max(0, c.totalEmpresas - visiveis.length),
      fonte: c.fonte,
      coletadoEm: c.coletadoEm.toISOString(),
      validoAte: c.validoAte.toISOString(),
      via: "cache",
      // v0.10.24: mesma preservação de avisos do caminho de expansão — a hidratação
      // do mapa não pode fazer o aviso de unificação desaparecer.
      avisos: avisosDeQuadroEmCache(c.truncado, c.totalEmpresas, c.avisosJson),
    };
  }
  const avisos: string[] = [];
  const faltando = ids.filter((id) => !quadros[id]);
  if (faltando.length > 0) {
    avisos.push(`${plural(faltando.length, "conexão", "conexões")} deste quadro ainda ${faltando.length === 1 ? "não foi expandida" : "não foram expandidas"} — o botão Investigar conexão cria a ligação.`);
  }
  return { ok: true, quadros, avisos };
}

/** Expansão manual de UMA conexão: quadro societário do participante. */
export async function investigarConexao(
  batchId: string,
  rowNumber: number,
  participanteId: string,
  opts: { fetcher?: GrafoFetcher } = {}
): Promise<{ ok: true; view: QuadroView } | { ok: false; motivo: string; detalhe?: string; erroFonte?: ErroGrafo }> {
  const fetcher = opts.fetcher ?? fetchPadrao;
  const linha = await carregarLinha(batchId, rowNumber);
  if (!linha) return { ok: false, motivo: "linha_nao_investigavel" };
  const valid = validarParticipanteId(participanteId, validateCnpj);
  if (!valid.ok) return { ok: false, motivo: "participante_invalido" };
  const tipo = valid.tipo;
  const t0 = Date.now();

  // cache
  const agora = new Date();
  const cache = await db.quadroParticipanteCache.findUnique({ where: { participanteId } });
  if (cache && cache.validoAte > agora) {
    const empresas = JSON.parse(cache.empresasJson) as EmpresaQuadro[];
    recordTelemetry({
      tipo: "RELACAO_EXPANSAO",
      fonte: cache.fonte,
      alvo: participanteId,
      cacheHit: true,
      resultados: cache.totalEmpresas,
      estadoFinal: "sucesso",
      duracaoMs: Date.now() - t0,
      payload: { via: "cache", tipoParticipante: cache.tipoParticipante },
    });
    return {
      ok: true,
      view: {
        ok: true,
        participanteId,
        tipoParticipante: cache.tipoParticipante as QuadroView["tipoParticipante"],
        rotulo: cache.rotulo,
        leitura:
          cache.tipoParticipante === "PF"
            ? "Encontramos as empresas em que este participante aparece no quadro societário público. A fonte pública cobre parte dos vínculos."
            : "Encontramos o quadro de sócios público deste participante (participação de pessoa jurídica).",
        totalEmpresas: cache.totalEmpresas,
        totalPessoasJuridicas: contarPessoasJuridicas(empresas),
        truncado: cache.truncado,
        empresas: empresas.slice(0, QUADRO_TETO_EXIBICAO),
        // v0.11.0 (Gate 8/G8-3): ocultas = total − EXIBIDAS (a lista completa tem
        // 60 mas só QUADRO_TETO_EXIBICAO vão na resposta — o caminho de consulta
        // já calculava certo; o de cache subtraía a lista cheia e dizia 0).
        empresasOcultas: Math.max(0, cache.totalEmpresas - Math.min(empresas.length, QUADRO_TETO_EXIBICAO)),
        fonte: cache.fonte,
        coletadoEm: cache.coletadoEm.toISOString(),
        validoAte: cache.validoAte.toISOString(),
        via: "cache",
        // v0.10.24: avisos da coleta original preservados (unificação/teto) — cache
        // não apaga o fato de que a fonte devolveu registros repetidos.
        avisos: avisosDeQuadroEmCache(cache.truncado, cache.totalEmpresas, cache.avisosJson),
      },
    };
  }

  // v0.10.10: voo único por participante — comandos concorrentes do MESMO quadro
  // compartilham UMA chamada; seguidor marca telemetria como "coalescido".
  const { valor: resp, lider: liderQuadro } = await emVooUnico(`grafo:quadro:${participanteId}`, () => fetcher(`/${participanteId}`, 15000));
  const viaQuadro = liderQuadro ? "consulta" : "coalescido";
  if (resp.status !== 200) {
    const erro = mapearErroGrafo(resp.status === 0 ? null : resp.status, resp.json ? JSON.stringify(resp.json).slice(0, 200) : null, resp.causa);
    recordTelemetry({
      tipo: "RELACAO_EXPANSAO",
      fonte: FONTE_GRAFO,
      alvo: participanteId,
      httpStatus: erro.httpStatus,
      cacheHit: false,
      estadoFinal: erro.tipo === "SEM_RELACOES_REGISTRADAS" ? "sucesso" : "falha",
      duracaoMs: Date.now() - t0,
      payload: { tipo: erro.tipo, via: viaQuadro },
    });
    if (erro.tipo === "SEM_RELACOES_REGISTRADAS") {
      return {
        ok: true,
        view: {
          ok: true,
          participanteId,
          tipoParticipante: tipo,
          rotulo: null,
          leitura: tipo === "PF" ? "Encontramos as empresas em que este participante aparece no quadro societário público. A fonte pública cobre parte dos vínculos." : "Encontramos o quadro de sócios público deste participante (participação de pessoa jurídica).",
          totalEmpresas: 0,
          totalPessoasJuridicas: 0,
          truncado: false,
          empresas: [],
          empresasOcultas: 0,
          fonte: FONTE_GRAFO,
          coletadoEm: new Date().toISOString(),
          validoAte: ttlAte(new Date()).toISOString(),
          via: "consulta",
          avisos: ["Nenhum quadro público registrado para este participante na base consultada (ausência registrada, não é falha)."],
        },
      };
    }
    return { ok: false, motivo: "fonte_erro", erroFonte: erro };
  }
  const norm = normalizarQuadroParticipante(resp.json, { participanteId, tipoParticipante: tipo });
  if (!norm.ok) {
    recordTelemetry({ tipo: "RELACAO_EXPANSAO", fonte: FONTE_GRAFO, alvo: participanteId, httpStatus: resp.status, cacheHit: false, estadoFinal: "falha", duracaoMs: Date.now() - t0, payload: { tipo: norm.tipo, via: viaQuadro } });
    return { ok: false, motivo: "fonte_erro", erroFonte: norm };
  }

  const agora2 = new Date();
  const persist = {
    participanteId,
    tipoParticipante: tipo,
    rotulo: null as string | null,
    fonte: FONTE_GRAFO,
    baseDados: null as string | null,
    coletadoEm: agora2,
    validoAte: ttlAte(agora2),
    empresasJson: JSON.stringify(norm.empresas),
    totalEmpresas: norm.totalEmpresas,
    truncado: norm.truncado,
    // v0.10.24 (auditoria): avisos da normalização persistidos JUNTO ao quadro —
    // a leitura de cache devolve o mesmo aviso da 1ª consulta (proveniência intacta).
    avisosJson: JSON.stringify(norm.avisos),
  };
  await db.quadroParticipanteCache.upsert({ where: { participanteId }, create: persist, update: { ...persist } });

  recordTelemetry({
    tipo: "RELACAO_EXPANSAO",
    fonte: FONTE_GRAFO,
    alvo: participanteId,
    httpStatus: resp.status,
    cacheHit: false,
    resultados: norm.totalEmpresas,
    estadoFinal: "sucesso",
    duracaoMs: Date.now() - t0,
    payload: { via: viaQuadro, tipoParticipante: tipo, truncado: norm.truncado },
  });
  await db.auditEvent.create({
    data: {
      batchId,
      rowNumber,
      event: "relacoes_expansao",
      detail: JSON.stringify({ participanteId, tipoParticipante: tipo, totalEmpresas: norm.totalEmpresas, truncado: norm.truncado, fonte: FONTE_GRAFO }),
    },
  });

  return {
    ok: true,
    view: {
      ok: true,
      participanteId,
      tipoParticipante: tipo,
      rotulo: null,
      leitura:
        tipo === "PF"
          ? "Encontramos as empresas em que este participante aparece no quadro societário público. A fonte pública cobre parte dos vínculos."
          : "Encontramos o quadro de sócios público deste participante (participação de pessoa jurídica).",
      totalEmpresas: norm.totalEmpresas,
      totalPessoasJuridicas: contarPessoasJuridicas(norm.empresas),
      truncado: norm.truncado,
      empresas: norm.empresas.slice(0, QUADRO_TETO_EXIBICAO),
      empresasOcultas: Math.max(0, norm.totalEmpresas - norm.empresas.slice(0, QUADRO_TETO_EXIBICAO).length),
      fonte: FONTE_GRAFO,
      coletadoEm: agora2.toISOString(),
      validoAte: ttlAte(agora2).toISOString(),
      via: "consulta",
      avisos: norm.avisos,
    },
  };
}

/* ------------------------------ FRENTE B ------------------------------ */

interface EstabelecimentoPersist {
  cnpj: string;
  razaoSocial: string | null;
  municipio: string | null;
  uf: string | null;
  situacao: string | null;
  cnae: string | null;
  identificadorMatrizFilial: number | null;
  confirmado: boolean;
  descobertoPor: string;
  confirmadoEm: string | null;
  fonteConfirmacao: string | null;
}

interface CoberturaPersist {
  participantesConsultados: string[];
  tetoParticipantes: number;
  tetoConfirmacoes: number;
  pendentesConfirmacao: number;
  totalLocalizados: number;
  parcial: true;
}

/** Descoberta de estabelecimentos pela raiz + confirmação individual (limitada por rodada). */
export async function investigarMatrizFiliais(
  batchId: string,
  rowNumber: number,
  opts: { fetcher?: GrafoFetcher } = {}
): Promise<{ ok: true; view: MatrizFiliaisView } | { ok: false; motivo: string; detalhe?: string; erroFonte?: ErroGrafo }> {
  const fetcher = opts.fetcher ?? fetchPadrao;
  const linha = await carregarLinha(batchId, rowNumber);
  if (!linha) return { ok: false, motivo: "linha_nao_investigavel" };
  const cnpj = linha.normalizedCnpj;
  const cnpjRaiz = cnpj.slice(0, 8).toUpperCase();
  const raizAlfanumerica = /[A-Z]/.test(cnpjRaiz);
  const t0 = Date.now();
  const avisos: string[] = [];

  const agora = new Date();
  const cacheAnterior = await db.estabelecimentoRootCache.findUnique({ where: { cnpjRaiz } });
  const cacheValido = cacheAnterior && cacheAnterior.validoAte > agora;
  const estabelecimentos: Map<string, EstabelecimentoPersist> = new Map();
  let participantesConsultados: string[] = [];
  let totalParticipantesPf = 0;
  let fonteDescoberta = FONTE_GRAFO + " — quadros de participantes";
  let coletadoEm = cacheAnterior?.coletadoEm ?? agora;
  let via: MatrizFiliaisView["via"] = "consulta";

  if (cacheValido && cacheAnterior) {
    // reuso dentro do TTL: nada de descoberta nova (HTTP zero)
    via = "cache";
    fonteDescoberta = cacheAnterior.fonteDescoberta;
    coletadoEm = cacheAnterior.coletadoEm;
    for (const e of JSON.parse(cacheAnterior.estabelecimentosJson) as EstabelecimentoPersist[]) estabelecimentos.set(e.cnpj, e);
    const cob = JSON.parse(cacheAnterior.coberturaJson) as CoberturaPersist & { totalParticipantesPfCache?: number };
    participantesConsultados = cob.participantesConsultados ?? [];
    totalParticipantesPf = cob.totalParticipantesPfCache ?? 0;
  } else {
    // descoberta: relações (cache ou 1 requisição) → quadros de participantes PF (teto)
    const relRes = await investigarRelacoes(batchId, rowNumber, { fetcher });
    if (!relRes.ok) return relRes;
    const pfIds = relRes.view.participantes.filter((p) => p.tipo === "PF").map((p) => p.participanteId);
    totalParticipantesPf = pfIds.length;
    const selecionados = pfIds.slice(0, TETO_PARTICIPANTES);
    if (pfIds.length > TETO_PARTICIPANTES) {
      avisos.push(`Descoberta parcial: ${pfIds.length} participantes PF no quadro — teto de ${TETO_PARTICIPANTES} quadros consultados nesta rodada.`);
    }
    const localizadas = new Map<string, EmpresaQuadro>();
    for (const id of selecionados) {
      const q = await investigarConexao(batchId, rowNumber, id, { fetcher });
      if (!q.ok) {
        if (q.erroFonte && (q.erroFonte.tipo === "RATE_LIMITED" || q.erroFonte.tipo === "TIMEOUT" || q.erroFonte.tipo === "FONTE_INDISPONIVEL")) {
          avisos.push("A pesquisa de quadros parou porque a fonte pública está indisponível agora. As informações anteriores continuam disponíveis.");
          break;
        }
        continue; // ausência de quadro (404) → participante sem quadro público, segue
      }
      if (!participantesConsultados.includes(id)) participantesConsultados.push(id);
      for (const e of filtrarMesmoRaiz(q.view.empresas, cnpjRaiz)) {
        if (!localizadas.has(e.cnpj)) localizadas.set(e.cnpj, e);
      }
    }
    // merge com cache anterior (fatos confirmados NUNCA são apagados)
    if (cacheAnterior) {
      for (const e of JSON.parse(cacheAnterior.estabelecimentosJson) as EstabelecimentoPersist[]) estabelecimentos.set(e.cnpj, e);
    }
    for (const l of localizadas.values()) {
      if (!estabelecimentos.has(l.cnpj)) {
        estabelecimentos.set(l.cnpj, {
          cnpj: l.cnpj,
          razaoSocial: l.razaoSocial,
          municipio: null,
          uf: null,
          situacao: null,
          cnae: null,
          identificadorMatrizFilial: null,
          confirmado: false,
          descobertoPor: `quadro societário do participante (fonte: ${FONTE_GRAFO})`,
          confirmadoEm: null,
          fonteConfirmacao: null,
        });
      }
    }
    // o próprio estabelecimento consultado entra com identidade oficial da linha (zero HTTP)
    if (!estabelecimentos.has(cnpj)) {
      estabelecimentos.set(cnpj, {
        cnpj,
        razaoSocial: linha.legalName,
        municipio: null,
        uf: null,
        situacao: null,
        cnae: null,
        identificadorMatrizFilial: linha.branchIdentifier,
        confirmado: false, // confirmado abaixo com os dados oficiais já presentes
        descobertoPor: "linha do lote (ficha cadastral)",
        confirmadoEm: null,
        fonteConfirmacao: null,
      });
    }
  }

  // confirmações individuais (teto por rodada; fatos antigos preservados)
  let confirmadosNaRodada = 0;
  const pendentes: string[] = [];
  const naoConf = [...estabelecimentos.values()].filter((e) => !e.confirmado);
  // prioridade: o próprio CNPJ (dados oficiais já na linha) → matriz do cadastro (já verificada) → demais
  const prioridade: EstabelecimentoPersist[] = [];
  const proprio = naoConf.find((e) => e.cnpj === cnpj);
  if (proprio) prioridade.push(proprio);
  if (linha.headquartersCnpj) {
    const hq = naoConf.find((e) => e.cnpj === linha.headquartersCnpj);
    if (hq) prioridade.push(hq);
  }
  for (const e of naoConf) if (!prioridade.includes(e)) prioridade.push(e);

  const verificado = prioridade.slice(0, TETO_CONFIRMACOES);
  for (const e of verificado) {
    if (e.cnpj === cnpj) {
      // identidade oficial já presente na ficha da linha — sem HTTP
      e.razaoSocial = linha.legalName ?? e.razaoSocial;
      e.identificadorMatrizFilial = linha.branchIdentifier ?? e.identificadorMatrizFilial;
      e.situacao = null; // preenchido abaixo se a ficha trouxer — nunca inventado
      e.confirmado = true;
      e.confirmadoEm = new Date().toISOString();
      e.fonteConfirmacao = "ficha cadastral da linha (coleta original)";
      confirmadosNaRodada += 1;
      continue;
    }
    const lk = await lookupCnpjComCache(e.cnpj);
    if (lk.resultado && lk.resultado.ok) {
      const d = lk.resultado.data;
      e.razaoSocial = d.legalName;
      e.municipio = d.municipality || null;
      e.uf = d.uf || null;
      e.situacao = d.registrationStatus || null;
      e.cnae = d.cnaeDescription || null;
      e.identificadorMatrizFilial = d.branchIdentifier;
      e.confirmado = true;
      e.confirmadoEm = new Date().toISOString();
      e.fonteConfirmacao = `cadastro (${lk.resultado.source}${lk.via === "cache" ? ", reuso de ficha" : ""})`;
      confirmadosNaRodada += 1;
    } else {
      pendentes.push(e.cnpj);
      // falha de confirmação NÃO apaga o fato (continua "localizado, não confirmado")
      const ultErro = lk.attempts && lk.attempts.length > 0 ? lk.attempts[lk.attempts.length - 1] : null;
      const tipoErro = ultErro && !ultErro.ok ? ultErro.errorType : "sem resultado";
      avisos.push(`Confirmação de ${e.cnpj} falhou (${tipoErro}) — estabelecimento permanece como localizado, não confirmado.`);
    }
  }
  const restantesNaoConfirmados = [...estabelecimentos.values()].filter((e) => !e.confirmado);
  const pendentesConfirmacao = restantesNaoConfirmados.length;
  if (pendentesConfirmacao > 0) {
    avisos.push(`${plural(pendentesConfirmacao, "estabelecimento localizado", "estabelecimentos localizados")} ainda sem confirmação individual (teto de ${TETO_CONFIRMACOES} confirmações por rodada).`);
  }

  // persistência (upsert — coletadoEm original preservado em atualizações)
  const agora3 = new Date();
  const estabelecimentosLista = [...estabelecimentos.values()];
  const cobertura: CoberturaPersist = {
    participantesConsultados,
    tetoParticipantes: TETO_PARTICIPANTES,
    tetoConfirmacoes: TETO_CONFIRMACOES,
    pendentesConfirmacao,
    totalLocalizados: estabelecimentosLista.length,
    parcial: true,
  };
  await db.estabelecimentoRootCache.upsert({
    where: { cnpjRaiz },
    create: {
      cnpjRaiz,
      raizAlfanumerica,
      fonteDescoberta,
      coletadoEm,
      atualizadoEm: agora3,
      validoAte: ttlAte(agora3),
      estabelecimentosJson: JSON.stringify(estabelecimentosLista),
      coberturaJson: JSON.stringify({ ...cobertura, totalParticipantesPfCache: totalParticipantesPf }),
    },
    update: {
      raizAlfanumerica,
      atualizadoEm: agora3,
      validoAte: ttlAte(agora3),
      estabelecimentosJson: JSON.stringify(estabelecimentosLista),
      coberturaJson: JSON.stringify({ ...cobertura, totalParticipantesPfCache: totalParticipantesPf }),
    },
  });

  recordTelemetry({
    tipo: "DESCOBERTA_ROOT",
    fonte: FONTE_GRAFO,
    alvo: cnpjRaiz,
    cacheHit: via === "cache",
    resultados: estabelecimentosLista.length,
    aproveitaveis: confirmadosNaRodada,
    estadoFinal: pendentesConfirmacao > 0 && confirmadosNaRodada === 0 ? "parcial" : "sucesso",
    duracaoMs: Date.now() - t0,
    payload: {
      via,
      tetoParticipantes: TETO_PARTICIPANTES,
      tetoConfirmacoes: TETO_CONFIRMACOES,
      pendentesConfirmacao,
      participantesConsultados: participantesConsultados.length,
      parcial: true,
    },
  });
  await db.auditEvent.create({
    data: {
      batchId,
      rowNumber,
      event: "matriz_filiais",
      detail: JSON.stringify({
        cnpjRaiz,
        via,
        totalLocalizados: estabelecimentosLista.length,
        confirmadosNaRodada,
        pendentesConfirmacao,
        participantesConsultados: participantesConsultados.length,
        fonte: fonteDescoberta,
      }),
    },
  });

  // visão: matriz pelo campo OFICIAL entre confirmados (nunca ordem 0001)
  const confirmados = estabelecimentosLista.filter((e) => e.confirmado);
  const matrizes = confirmados.filter((e) => e.identificadorMatrizFilial === 1);
  if (matrizes.length > 1) avisos.push(`${matrizes.length} estabelecimentos com campo oficial MATRIZ — evidência inconsistente registrada como está (nada deduzido).`);
  const toView = (e: EstabelecimentoPersist): EstabelecimentoView => ({
    cnpj: e.cnpj,
    razaoSocial: e.razaoSocial,
    municipio: e.municipio,
    uf: e.uf,
    situacao: e.situacao,
    cnae: e.cnae,
    identificadorMatrizFilial: e.identificadorMatrizFilial,
    confirmado: e.confirmado,
    descobertoPor: e.descobertoPor,
    confirmadoEm: e.confirmadoEm,
    fonteConfirmacao: e.fonteConfirmacao,
  });
  const matriz = matrizes.length > 0 ? toView(matrizes[0]) : null;
  const filiais = confirmados.filter((e) => e.identificadorMatrizFilial === 2 && e.cnpj !== cnpj).map(toView);
  const locNaoConf = restantesNaoConfirmados.filter((e) => e.cnpj !== cnpj).map(toView);

  return {
    ok: true,
    view: {
      ok: true,
      cnpjRaiz,
      raizAlfanumerica,
      fonteDescoberta,
      coletadoEm: new Date(coletadoEm).toISOString(),
      atualizadoEm: agora3.toISOString(),
      validoAte: ttlAte(agora3).toISOString(),
      via,
      consultado: { cnpj, branchType: linha.branchType, branchIdentifier: linha.branchIdentifier },
      matriz,
      filiais,
      localizadosNaoConfirmados: locNaoConf,
      cobertura: {
        parcial: true,
        participantesConsultados: participantesConsultados.length,
        totalParticipantesPf,
        tetoParticipantes: TETO_PARTICIPANTES,
        tetoConfirmacoes: TETO_CONFIRMACOES,
        confirmadosNaRodada,
        pendentesConfirmacao,
      },
      avisos,
    },
  };
}
