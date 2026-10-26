/**
 * planner.ts — PLANEJADOR DE CONSULTAS (P4, v0.10.9) — determinístico, ZERO IA, ZERO HTTP.
 *
 * Consolida as lacunas COMPLEMENTAR_API da triagem (TRIAGEM_V1) em um plano
 * ORDENADO de consultas candidatas com custo conhecido ANTES de executar.
 *
 * Regras do despacho (PROPOSTA-P4):
 *  - NENHUMA consulta acontece aqui: gerar o plano é só LEITURA do estado local
 *    (linhas, triagem, caches, telemetria) — zero rede externa, zero IA, zero busca.
 *  - Só lacuna COMPLEMENTAR_API vira item (fonte estruturada aplicável ainda não
 *    esgotada). VALIDACAO_HUMANA/PESQUISA_DOCUMENTAL/INDISPONIVEL NUNCA viram
 *    consulta — aparecem por transparência em fora_do_escopo_api.
 *  - A unidade é a lacuna: 1 item = 1 pergunta de 1 entidade (cnpj + pergunta_id).
 *    Perguntas por RAIZ (estabelecimentos/relações) são deduplicadas por raiz —
 *    matriz + filiais do mesmo CNPJ básico = UMA pessoa jurídica, UM item.
 *  - Custo CONTADO, nunca estimado a dedo: descoberta = 1 consulta; confirmações =
   *  pendências contadas do cache local (teto de 20/rodada do executor); revalidação
   *  = até 4 (nota explícita).
 *  - Ordenação determinística: (1) sem bloqueio antes dos bloqueados; (2) menor
 *    custo; (3) agrupado por fonte (respeita backoff); (4) linha; (5) pergunta.
 *  - Bloqueio ativo = evento MAIS RECENTE da fonte do comando (para o alvo) é
 *    falha (429/timeout/indisponibilidade) — o item vai para o fim com o
 *    bloqueio declarado; executá-lo primeiro seria martelar a fonte.
 *  - Aprovação chama EXATAMENTE os comandos existentes da ficha — nenhum
 *    executor novo; após cada comando, o plano é regenerado (a triagem recalcula).
 */
import { db, revisaoFatos } from "@/lib/db";
import { emVooUnico } from "@/lib/single-flight";
import { classificarTriagemLinha } from "@/lib/triage/engine";
import { parDeFonte } from "@/lib/fontes-apresentacao";
import { plural } from "@/lib/linguagem";
import {
  PLANO_CONSULTAS_VERSAO,
  validarPlano,
  sanitizarPlano,
  type PlanoConsultasV1,
  type PlanoItem,
  type PlanoForaEscopo,
} from "./contrato";

/** Teto de confirmações e de quadros por rodada — MESMOS tetos do executor existente (service.ts). */
const TETO_CONFIRMACOES = 20;
const TETO_PARTICIPANTES = 10;

const FONTE_TEC_GRAFO_QUADROS = "MinhaReceita Grafo — quadros de participantes";
const FONTE_TEC_GRAFO = "MinhaReceita Grafo";
const FONTE_TEC_CADASTRO = "cadastro (BrasilAPI, ReceitaWS, OpenCNPJ, MinhaReceita)";

const RE_CPF_PARTICIPANTE = /^PF:/; // marcador interno de tipo no relacoesJson

function parseJsonSeguro<T>(texto: string | null | undefined): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

/** Último evento dos tipos informados (para os alvos) é FALHA? → bloqueio ativo. */
async function bloqueioAtivo(alvos: string[], tipos: string[]): Promise<{ fonte: string; tipo: string; data: string | null } | null> {
  if (alvos.length === 0) return null;
  const evs = await db.telemetryEvent.findMany({
    where: { tipo: { in: tipos }, alvo: { in: alvos } },
    orderBy: { startedAt: "desc" },
    take: 1,
  });
  const ev = evs[0];
  if (!ev || ev.estadoFinal !== "falha") return null;
  const payload = parseJsonSeguro<{ tipo?: string }>(ev.payloadJson);
  return { fonte: ev.fonte ?? "fonte externa", tipo: payload?.tipo ?? ev.erro ?? "FONTE_INDISPONIVEL", data: ev.startedAt.toISOString() };
}

interface LinhaBase {
  rowNumber: number;
  normalizedCnpj: string | null;
}

export type PlanoResultado =
  | { ok: true; plano: PlanoConsultasV1 }
  | { ok: false; motivo: "lote_nao_encontrado" | "lote_preview" | "sem_linhas" | "schema_invalido"; erros?: string[] };

/**
 * v0.10.11 — REUSO SEGURO DE RESULTADO (despacho piloto: "reutilização segura de
 * resultados e redução de processamento redundante").
 *
 * Gargalo medido (sonda v0.10.11, lote 30 linhas): geração ≈ 0,4s solo → p95 3,7s
 * sob 20 concorrentes (degradação ~9×) — a geração inteira era refeita a CADA
 * pedido, com ~9 consultas de triagem POR LINHA, todas sequenciais.
 *
 * Correção em duas camadas (fatos e regras de acesso preservados):
 *  1. FINGERPRINT dos fatos — revisão global (contador O(1) que sobe a cada
 *     escrita nas tabelas lidas pelo plano, ver db.ts) + agregações baratas
 *     (max/count por tabela — cobre escritas de OUTRO processo no mesmo SQLite).
 *     Qualquer mudança de fato muda o fingerprint → plano regenerado do zero.
 *  2. VOO ÚNICO por lote (emVooUnico) — pedidos concorrentes do MESMO lote
 *     compartilham UMA geração (o pico de concorrência deixa de multiplicar
 *     processamento redundante). Sem cache negativa: falha não é memorizada.
 *  Cinto de segurança: TTL de 60s — nenhum retrato vive mais que isso mesmo
 *  sem escrita (ex.: banco trocado por fora do processo).
 */
interface MemoGlobal {
  __scoutPlanoMemo?: Map<string, { fp: string; ts: number; plano: PlanoConsultasV1 }>;
}
const gMemo = globalThis as unknown as MemoGlobal;
gMemo.__scoutPlanoMemo ??= new Map();
const PLANO_MEMO = gMemo.__scoutPlanoMemo;
const PLANO_MEMO_TTL_MS = 60_000;
const PLANO_MEMO_MAX = 32; // teto de memória: 32 lotes recentes (planos são pequenos)

/** Fingerprint barato e EXATO o suficiente: qualquer mudança em fato relevante muda a assinatura.
 *  UMA única consulta raw (12 valores num passe) — o caminho de cache-hit custa 1 round-trip. */
interface FpRow {
  row_count: number | bigint; row_max: unknown;
  tel_count: number | bigint; tel_max: unknown;
  rel_count: number | bigint; rel_max: unknown;
  quad_count: number | bigint; quad_max: unknown;
  est_count: number | bigint; est_max: unknown;
  cad_count: number | bigint; cad_max: unknown;
}
/** MAX(data) em raw SQLite volta string/número/Date — normaliza para ms. */
function emMs(v: unknown): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}
function emInt(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : 0;
}
async function fingerprintPlano(batchId: string): Promise<string> {
  const [r] = await db.$queryRaw<FpRow[]>`
    SELECT
      (SELECT COUNT(*) FROM ImportRow WHERE batchId = ${batchId}) AS row_count,
      (SELECT MAX(updatedAt) FROM ImportRow WHERE batchId = ${batchId}) AS row_max,
      (SELECT COUNT(*) FROM TelemetryEvent) AS tel_count,
      (SELECT MAX(startedAt) FROM TelemetryEvent) AS tel_max,
      (SELECT COUNT(*) FROM RelacaoSocietariaCache) AS rel_count,
      (SELECT MAX(atualizadoEm) FROM RelacaoSocietariaCache) AS rel_max,
      (SELECT COUNT(*) FROM QuadroParticipanteCache) AS quad_count,
      (SELECT MAX(coletadoEm) FROM QuadroParticipanteCache) AS quad_max,
      (SELECT COUNT(*) FROM EstabelecimentoRootCache) AS est_count,
      (SELECT MAX(atualizadoEm) FROM EstabelecimentoRootCache) AS est_max,
      (SELECT COUNT(*) FROM CadastroCache) AS cad_count,
      (SELECT MAX(atualizadoEm) FROM CadastroCache) AS cad_max`;
  return [
    revisaoFatos(),
    emInt(r.row_count), emMs(r.row_max),
    emInt(r.tel_count), emMs(r.tel_max),
    emInt(r.rel_count), emMs(r.rel_max),
    emInt(r.quad_count), emMs(r.quad_max),
    emInt(r.est_count), emMs(r.est_max),
    emInt(r.cad_count), emMs(r.cad_max),
  ].join("|");
}

function plausivel(fp: string, entrada: { fp: string; ts: number }): boolean {
  return entrada.fp === fp && Date.now() - entrada.ts < PLANO_MEMO_TTL_MS;
}

export async function gerarPlanoConsultas(batchId: string): Promise<PlanoResultado> {
  const fp = await fingerprintPlano(batchId);
  const hit = PLANO_MEMO.get(batchId);
  if (hit && plausivel(fp, hit)) return { ok: true, plano: hit.plano };

  const voo = await emVooUnico(`plano:${batchId}`, async (): Promise<PlanoResultado> => {
    // dentro do voo: outro voo pode ter preenchido o memo entre o miss e aqui
    const fp2 = await fingerprintPlano(batchId);
    const hit2 = PLANO_MEMO.get(batchId);
    if (hit2 && plausivel(fp2, hit2)) return { ok: true, plano: hit2.plano };
    const gerado = await gerarPlanoConsultasSemCache(batchId);
    if (gerado.ok) {
      if (PLANO_MEMO.size >= PLANO_MEMO_MAX) {
        const maisVelha = [...PLANO_MEMO.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (maisVelha) PLANO_MEMO.delete(maisVelha[0]);
      }
      PLANO_MEMO.set(batchId, { fp: fp2, ts: Date.now(), plano: gerado.plano });
    }
    // falha (lote_preview/sem_linhas/schema_invalido) NÃO é memorizada — sem cache negativa
    return gerado;
  });
  return voo.valor;
}

async function gerarPlanoConsultasSemCache(batchId: string): Promise<PlanoResultado> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, motivo: "lote_nao_encontrado" };
  if (batch.status === "PREVIEW") return { ok: false, motivo: "lote_preview" };

  const rows = await db.importRow.findMany({
    where: { batchId, lookupStatus: "ENRIQUECIDO" },
    select: { rowNumber: true, normalizedCnpj: true },
    orderBy: { rowNumber: "asc" },
  });
  if (rows.length === 0) return { ok: false, motivo: "sem_linhas" };

  const agora = new Date();
  const itens: PlanoItem[] = [];
  const fora: PlanoForaEscopo[] = [];
  /** dedupe: 1 item por (PERGUNTA, raiz) — matriz + filiais da mesma PJ = UMA lacuna
   *  de UMA pessoa jurídica (a unidade do plano é a lacuna, não a linha). */
  const chavesComItem = new Set<string>();

  const oQueResolve: Record<string, { resolve: string; naoResolve: string }> = {
    investigar_relacoes_societarias: {
      resolve: "Consultar o quadro público de participantes desta pessoa jurídica (1 consulta, sob comando).",
      naoResolve:
        "Não prova grupo econômico — participante comum não é rotulado como grupo; expandir UMA conexão é 1 comando por participante, na ficha.",
    },
    investigar_estabelecimentos_raiz: {
      resolve: "Localizar e confirmar estabelecimentos da raiz (matriz e filiais), com cobertura parcial declarada.",
      naoResolve: "Não comprova operação atual — a cobertura da fonte é parcial por desenho; confirmação é individual pelo registro oficial.",
    },
    revalidar_ficha: {
      resolve: "Reconfirmar o cadastro desta empresa nas fontes públicas (ficha anterior preservada em caso de falha).",
      naoResolve: "Não descobre dados além do cadastro público; não substitui validação humana nem pesquisa documental.",
    },
  };

  for (const row of rows as LinhaBase[]) {
    const tri = await classificarTriagemLinha(batchId, row.rowNumber);
    if (!tri.ok || !tri.cnpj) continue; // linha sumiu / sem CNPJ — nada inventado
    const cnpj = tri.cnpj;
    const raiz = tri.cnpjRaiz ?? cnpj.slice(0, 8);

    for (const lacuna of tri.lacunas) {
      if (lacuna.estado !== "COMPLEMENTAR_API") {
        // transparência: nunca viram consulta — só os estados com lacuna real são listados
        if (lacuna.estado === "VALIDACAO_HUMANA" || lacuna.estado === "PESQUISA_DOCUMENTAL" || lacuna.estado === "INDISPONIVEL") {
          fora.push({
            cnpj_completo: cnpj,
            cnpj_raiz: raiz,
            linha: row.rowNumber,
            pergunta_id: lacuna.perguntaId,
            estado_triagem: lacuna.estado,
            motivo:
              lacuna.estado === "INDISPONIVEL"
                ? "Consulta temporariamente indisponível — nada executa sozinho; tente novamente mais tarde sob comando."
                : "Esta pergunta NÃO é resolvida por fonte estruturada — exige " +
                  (lacuna.estado === "VALIDACAO_HUMANA" ? "validação com a empresa." : "pesquisa em documentos, sob demanda."),
          });
        }
        continue; // RESOLVIDO / NAO_APLICAVEL: nada falta, nada é listado
      }

      if (lacuna.perguntaId === "estabelecimentos") {
        const chaveDedupe = `estabelecimentos:${raiz}`;
        if (chavesComItem.has(chaveDedupe)) continue; // mesma PJ já tem item (matriz+filiais = 1 PJ)
        const cache = await db.estabelecimentoRootCache.findUnique({ where: { cnpjRaiz: raiz } });
        const valido = !!cache && cache.validoAte > agora;
        const cob = parseJsonSeguro<{ pendentesConfirmacao?: number; totalParticipantesPfCache?: number; participantesConsultados?: string[] }>(cache?.coberturaJson);
        const pendentes = Math.max(0, cob?.pendentesConfirmacao ?? 0);
        // v0.10.9 (ao vivo, lote real): pendentes=0 NÃO significa esgotado — a cobertura
        // também conta QUADROS de participantes PF ainda não consultados (teto 10/rodada).
        const totalPfCache = Math.max(0, cob?.totalParticipantesPfCache ?? cob?.participantesConsultados?.length ?? 0);
        const quadrosConsultados = cob?.participantesConsultados?.length ?? 0;
        const quadrosRestantes = Math.max(0, totalPfCache - quadrosConsultados);
        if (valido && pendentes === 0 && quadrosRestantes === 0) {
          // cobertura realmente esgotada — estado defensivo; triagem recomputa no próximo acesso
          continue;
        }
        const chamadas = valido ? Math.min(pendentes, TETO_CONFIRMACOES) + Math.min(quadrosRestantes, TETO_PARTICIPANTES) : 1;
        const bloqueio = await bloqueioAtivo([cnpj, raiz], ["RELACAO_GRAFO", "DESCOBERTA_ROOT"]);
        chavesComItem.add(chaveDedupe);
        itens.push({
          cnpj_completo: cnpj,
          cnpj_raiz: raiz,
          linha: row.rowNumber,
          pergunta_id: lacuna.perguntaId,
          pergunta: lacuna.pergunta,
          estado_triagem_origem: "COMPLEMENTAR_API",
          fonte_candidata: parDeFonte(FONTE_TEC_GRAFO_QUADROS).categoria,
          fonte_tecnica: FONTE_TEC_GRAFO_QUADROS,
          chamadas_estimadas: chamadas,
          chamadas_nota: valido
            ? [
                pendentes > 0 ? `${plural(pendentes, "confirmação pendente", "confirmações pendentes")} contadas do cache local (teto de ${TETO_CONFIRMACOES} por rodada)` : null,
                quadrosRestantes > 0 ? `${plural(quadrosRestantes, "quadro", "quadros")} de participantes ainda não consultados (teto de ${TETO_PARTICIPANTES} por rodada)` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "reuso do cache local — nada a consultar"
            : "1 consulta de descoberta pela fonte pública; confirmações contadas na próxima geração deste plano.",
          cache_reutilizavel: valido,
          bloqueios_ativos: bloqueio ? [bloqueio] : [],
          comando_executor: "investigar_estabelecimentos_raiz",
          o_que_resolve: oQueResolve.investigar_estabelecimentos_raiz.resolve,
          o_que_nao_resolve: oQueResolve.investigar_estabelecimentos_raiz.naoResolve,
        });
        continue;
      }

      if (lacuna.perguntaId === "relacoes_societarias") {
        const chaveDedupe = `relacoes_societarias:${raiz}`;
        if (chavesComItem.has(chaveDedupe)) continue;
        const cache = await db.relacaoSocietariaCache.findUnique({ where: { cnpj } });
        const valido = !!cache && cache.validoAte > agora;
        if (valido) {
          // quadro já consultado: expansão de conexões é 1 comando POR participante
          const relacoes = parseJsonSeguro<{ participanteId: string; tipo: string }[]>(cache.relacoesJson) ?? [];
          const pfIds = relacoes.filter((r) => r.tipo === "PF" || RE_CPF_PARTICIPANTE.test(r.participanteId)).map((r) => r.participanteId);
          const comQuadroValido = pfIds.length
            ? await db.quadroParticipanteCache.count({ where: { participanteId: { in: pfIds }, validoAte: { gt: agora } } })
            : 0;
          const pendentes = pfIds.length - comQuadroValido;
          fora.push({
            cnpj_completo: cnpj,
            cnpj_raiz: raiz,
            linha: row.rowNumber,
            pergunta_id: lacuna.perguntaId,
            estado_triagem: "COMPLEMENTAR_API",
            motivo:
              "Quadro público já consultado (reuso dentro da validade). Expandir conexões é 1 comando POR participante, na ficha" +
              (pendentes > 0 ? ` — ${plural(pendentes, "conexão", "conexões")} ainda sem quadro consultado.` : ".") +
              " O plano não executa expansão em lote.",
          });
          chavesComItem.add(chaveDedupe);
          continue;
        }
        const bloqueio = await bloqueioAtivo([cnpj, raiz], ["RELACAO_GRAFO"]);
        chavesComItem.add(chaveDedupe);
        itens.push({
          cnpj_completo: cnpj,
          cnpj_raiz: raiz,
          linha: row.rowNumber,
          pergunta_id: lacuna.perguntaId,
          pergunta: lacuna.pergunta,
          estado_triagem_origem: "COMPLEMENTAR_API",
          fonte_candidata: parDeFonte(FONTE_TEC_GRAFO).categoria,
          fonte_tecnica: FONTE_TEC_GRAFO,
          chamadas_estimadas: 1,
          chamadas_nota: null,
          cache_reutilizavel: false,
          bloqueios_ativos: bloqueio ? [bloqueio] : [],
          comando_executor: "investigar_relacoes_societarias",
          o_que_resolve: oQueResolve.investigar_relacoes_societarias.resolve,
          o_que_nao_resolve: oQueResolve.investigar_relacoes_societarias.naoResolve,
        });
        continue;
      }

      if (lacuna.perguntaId === "identidade") {
        // defensivo: linha ENRIQUECIDO tem identidade RESOLVIDO — se um dia cair aqui,
        // o comando honesto é a revalidação da ficha (comando existente)
        const bloqueio = await bloqueioAtivo([cnpj], ["COLETA_CADASTRO"]);
        itens.push({
          cnpj_completo: cnpj,
          cnpj_raiz: raiz,
          linha: row.rowNumber,
          pergunta_id: lacuna.perguntaId,
          pergunta: lacuna.pergunta,
          estado_triagem_origem: "COMPLEMENTAR_API",
          fonte_candidata: parDeFonte(FONTE_TEC_CADASTRO).categoria,
          fonte_tecnica: FONTE_TEC_CADASTRO,
          chamadas_estimadas: 4,
          chamadas_nota: "até 4 consultas cadastrais (documentação da revalidação).",
          cache_reutilizavel: false,
          bloqueios_ativos: bloqueio ? [bloqueio] : [],
          comando_executor: "revalidar_ficha",
          o_que_resolve: oQueResolve.revalidar_ficha.resolve,
          o_que_nao_resolve: oQueResolve.revalidar_ficha.naoResolve,
        });
        continue;
      }

      // regime_tributario / contabilidade_interna / tecnologia_erp nunca são
      // COMPLEMENTAR_API no motor atual; se um dia caírem aqui, NADA é inventado:
      fora.push({
        cnpj_completo: cnpj,
        cnpj_raiz: raiz,
        linha: row.rowNumber,
        pergunta_id: lacuna.perguntaId,
        estado_triagem: "COMPLEMENTAR_API",
        motivo: "Sem comando de executor único mapeado para esta pergunta — tratada na ficha, em documentos ou com a empresa.",
      });
    }
  }

  // ordenação determinística: sem bloqueio → menor custo → fonte → linha → pergunta
  itens.sort((a, b) => {
    const ba = a.bloqueios_ativos.length > 0 ? 1 : 0;
    const bb = b.bloqueios_ativos.length > 0 ? 1 : 0;
    if (ba !== bb) return ba - bb;
    if (a.chamadas_estimadas !== b.chamadas_estimadas) return a.chamadas_estimadas - b.chamadas_estimadas;
    if (a.fonte_candidata !== b.fonte_candidata) return a.fonte_candidata.localeCompare(b.fonte_candidata, "pt-BR");
    if (a.linha !== b.linha) return a.linha - b.linha;
    return a.pergunta_id.localeCompare(b.pergunta_id, "pt-BR");
  });

  const porFonteMap = new Map<string, { fonte: string; itens: number; chamadas: number }>();
  for (const i of itens) {
    const atual = porFonteMap.get(i.fonte_candidata) ?? { fonte: i.fonte_candidata, itens: 0, chamadas: 0 };
    atual.itens += 1;
    atual.chamadas += i.chamadas_estimadas;
    porFonteMap.set(i.fonte_candidata, atual);
  }

  const esboço: PlanoConsultasV1 = {
    versao_contrato: PLANO_CONSULTAS_VERSAO,
    geradoEm: new Date().toISOString(),
    lote: { id: batch.id, arquivo: batch.fileName ?? null },
    resumo: {
      itens: itens.length,
      chamadas_totais: itens.reduce((s, i) => s + i.chamadas_estimadas, 0),
      por_fonte: [...porFonteMap.values()].sort((a, b) => a.fonte.localeCompare(b.fonte, "pt-BR")),
      fora_do_escopo: fora.length,
      bloqueados: itens.filter((i) => i.bloqueios_ativos.length > 0).length,
    },
    itens,
    fora_do_escopo_api: fora,
    gate: { ia: 0, busca_web: 0, execucao_automatica: false },
  };

  const validacao = validarPlano(esboço);
  if (!validacao.ok) {
    return { ok: false, motivo: "schema_invalido", erros: validacao.erros };
  }
  return { ok: true, plano: sanitizarPlano(validacao.plano) };
}
