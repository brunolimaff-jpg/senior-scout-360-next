/**
 * Medição de EFICIÊNCIA REAL da cadeia de complementação (v0.10.1 — despacho do auditor).
 *
 * Pergunta a responder COM NÚMERO (não com claim):
 *   "Lacunas que nenhuma fonte consegue preencher estão causando consultas repetidas
 *    desnecessárias?" — comparar CHAMADAS e CAMPOS ÚTEIS antes/depois do portão de
 *    capacidade. Sem economia mensurável → dizer sem rodeio.
 *
 * Método (3 fases, 20 chamadas HTTP no total — todas públicas/gratuitas, cortesia 300ms):
 *   FASE A (sondagem de esquema, 4 chamadas): 1 CNPJ rico (Petrobras) em cada fonte da
 *     cadeia; registra QUAIS chaves relevantes existem na resposta crua — prova de
 *     esquema para o mapa de capacidades (distingue "fonte não tem o campo" de
 *     "a empresa não tem o dado").
 *   FASE B (coleta por mapeador, 16 chamadas): 4 CNPJs × 4 fontes da cadeia; guarda o
 *     CnpjLookupData de cada resposta.
 *   FASE C (simulação OFFLINE, 0 chamada): sobre os dados coletados, executa
 *     exatamente as duas estratégias:
 *       ANTES  = v0.10.0 — caminha a cadeia enquanto houver lacuna (gapsOf), consulta
 *                todas as fontes seguintes, mesmo as que não podem preencher nada;
 *       DEPOIS = v0.10.1 — mesma caminhada COM portão de capacidade (CAMPOS_POR_FONTE):
 *                para quando ninguém na cauda pode preencher, e pula fonte que não
 *                trata nenhuma lacuna atual.
 *     Compara: chamadas HTTP que cada estratégia FARIA, complementações, campos úteis
 *     preenchidos (UNIÃO — deve ser idêntica; perda = BUG do portão) e lacunas finais.
 *
 * Uso: bun scripts/medir-eficiencia-cadeia.ts
 * Saída: qa/eficiencia-cadeia-v0.10.1.json + .md
 */
import { mkdirSync, writeFileSync } from "fs";
import {
  lookupBrasilApi,
  lookupOpenCnpj,
  lookupReceitaWs,
  lookupMinhaReceita,
  gapsOf,
  fillGaps,
  isSourceCoolingDown,
  CAMPOS_POR_FONTE,
  type CnpjLookupResult,
  type CnpjLookupData,
} from "../src/lib/enrich/sources";

const CORTESIA_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ALVOS: { rotulo: string; cnpj: string; expectativa: string }[] = [
  { rotulo: "Companhia aberta (matriz)", cnpj: "33000167000101", expectativa: "Petrobras — sem simples/mei; regime registrado" },
  { rotulo: "Banco público (matriz)", cnpj: "00000000000191", expectativa: "Banco do Brasil S.A. — raiz com zeros" },
  { rotulo: "Filial de banco (ordem 0002)", cnpj: "00360305000295", expectativa: "agência da CAIXA — QSA vazio na filial" },
  { rotulo: "CNPJ alfanumérico (exemplo RFB)", cnpj: "00000000E08G12", expectativa: "00.000.000/E08G-12 — 1º alfanumérico emitido" },
];

const CHAIN = [
  { fonte: "BrasilAPI", fn: lookupBrasilApi },
  { fonte: "OpenCNPJ", fn: lookupOpenCnpj },
  { fonte: "ReceitaWS", fn: lookupReceitaWs },
  { fonte: "MinhaReceita", fn: lookupMinhaReceita },
];

/** Chaves que os mapeadores leem nas respostas cruas — base da prova de esquema. */
const CHAVES_RELEVANTES = [
  "razao_social", "nome_fantasia", "data_situacao", "situacao_cadastral",
  "email", "ddd_telefone_1", "ddd_telefone", "ddd_telefone_2", "telefone1", "telefone",
  "capital_social", "natureza_juridica", "descricao_porte", "porte",
  "opcao_simples", "opcao_pelo_simples", "simples",
  "opcao_mei", "opcao_pelo_mei", "mei",
  "regime_tributario", "codigo_municipio_ibge", "codigo_ibge_municipio",
  "cnaes_secundarios", "atividades_secundarias", "qsa", "QSA",
];

async function fetchJsonCru(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "Scout360-Eficiencia/1.0 (deterministico; uso interno)" },
      cache: "no-store",
    });
    if (!res.ok) return { _erro: `HTTP ${res.status}` };
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return { _erro: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function dataResumo(d: CnpjLookupData) {
  return {
    legalName: d.legalName,
    tradeName: d.tradeName,
    statusDate: d.statusDate,
    email: d.extra.email,
    telefone: d.extra.telefone,
    telefone2: d.extra.telefone2,
    capitalSocial: d.extra.capitalSocial,
    naturezaJuridica: d.extra.naturezaJuridica,
    porte: d.extra.porte,
    simples: d.extra.simples,
    mei: d.extra.mei,
    regimeTributario: d.extra.regimeTributario,
    endereco: d.extra.endereco,
    qsa: d.socios.length,
    qsaTruncados: d.extra.qsaTruncados ?? false,
    cnaesSecundarios: d.extra.cnaesSecundarios.length,
    cnaesTruncados: d.extra.cnaesTruncados ?? false,
    codigoMunicipioIbge: d.extra.codigoMunicipioIbge,
  };
}

/* -------- FASE C: as duas estratégias sobre os MESMOS dados coletados -------- */

type Coleta = (CnpjLookupResult & { fonte: string })[];

function simular(coleta: Coleta, modo: "antes" | "depois") {
  const indices = new Map(CHAIN.map((c, i) => [c.fonte, i]));
  const chamadas: { fonte: string; ok: boolean; pulada: boolean; motivo: string }[] = [];
  const complementacoes: { fonte: string; campos: string[] }[] = [];

  // etapa 1: primária (idêntica nos dois modos — falhas também são chamadas HTTP)
  let primaria: Extract<CnpjLookupResult, { ok: true }> | null = null;
  let indicePrimaria = -1;
  for (const r of coleta) {
    const i = indices.get(r.fonte) ?? 99;
    if (i <= indicePrimaria) continue;
    if (r.ok) {
      primaria = r;
      indicePrimaria = i;
      chamadas.push({ fonte: r.fonte, ok: true, pulada: false, motivo: "fonte primária (identidade)" });
      break;
    }
    chamadas.push({ fonte: r.fonte, ok: false, pulada: !!r.pulada, motivo: `falha na etapa 1: ${(r as { message?: string }).message ?? "?"}` });
  }
  if (!primaria) return { primaria: null, chamadas, complementacoes, camposFinais: null, gapsFinais: [] };

  // etapa 2: complementação (USA fillGaps REAL de sources.ts — fonte única de verdade)
  let atual = primaria.data;
  let gaps = gapsOf(atual);
  for (let i = indicePrimaria + 1; i < CHAIN.length; i++) {
    const fonte = CHAIN[i].fonte;
    const r = coleta.find((c) => c.fonte === fonte);
    if (gaps.length === 0) break;
    if (modo === "depois") {
      const cauda = CHAIN.slice(i).map((c) => c.fonte);
      const preenchiveis = new Set(cauda.flatMap((f) => CAMPOS_POR_FONTE[f] ? [...CAMPOS_POR_FONTE[f]] : gaps));
      const acionaveis = gaps.filter((g) => preenchiveis.has(g));
      if (acionaveis.length === 0) {
        chamadas.push({ fonte, ok: false, pulada: true, motivo: "portão: nenhuma lacuna restante é preenchível pela cauda" });
        break;
      }
      const cap = CAMPOS_POR_FONTE[fonte];
      const trataveis = cap ? gaps.filter((g) => cap.has(g)) : gaps;
      if (trataveis.length === 0) {
        chamadas.push({ fonte, ok: false, pulada: true, motivo: "portão: fonte não trata nenhuma lacuna atual" });
        continue;
      }
    }
    if (!r) {
      chamadas.push({ fonte, ok: false, pulada: true, motivo: "sem coleta registrada (fonte falhou/429 na fase B)" });
      continue;
    }
    if ((r as { pulada?: boolean }).pulada) {
      // fonte em backoff na fase B — NÃO é chamada HTTP (honestidade da contagem)
      chamadas.push({ fonte, ok: false, pulada: true, motivo: "pulada (backoff na fase B — sem requisição)" });
      continue;
    }
    chamadas.push({ fonte, ok: r.ok, pulada: false, motivo: r.ok ? "consultada (lacunas: " + gaps.slice(0, 4).join(", ") + ")" : `falha: ${(r as { message?: string }).message ?? "?"}` });
    if (!r.ok) continue;
    const { merged, campos } = fillGaps(atual, r.data);
    if (campos.length > 0) {
      atual = merged;
      complementacoes.push({ fonte, campos });
      gaps = gapsOf(atual);
    }
  }
  return { primaria: primaria.source, chamadas, complementacoes, camposFinais: dataResumo(atual), gapsFinais: gaps };
}

function camposUteis(resumo: ReturnType<typeof dataResumo> | null): string[] {
  if (!resumo) return [];
  const out: string[] = [];
  if (resumo.tradeName) out.push("nomeFantasia");
  if (resumo.email) out.push("email");
  if (resumo.telefone) out.push("telefone");
  if (resumo.telefone2) out.push("telefone2");
  if (resumo.capitalSocial) out.push("capitalSocial");
  if (resumo.naturezaJuridica) out.push("naturezaJuridica");
  if (resumo.porte) out.push("porte");
  if (resumo.simples) out.push("simples");
  if (resumo.mei) out.push("mei");
  if (resumo.regimeTributario) out.push("regimeTributario");
  if (resumo.endereco) out.push("endereco");
  if (resumo.qsa > 0) out.push("qsa");
  if (resumo.cnaesSecundarios > 0) out.push("cnaesSecundarios");
  if (resumo.codigoMunicipioIbge) out.push("codigoMunicipioIbge");
  if (resumo.statusDate) out.push("dataSituacao");
  return out.sort();
}

async function main() {
  const inicio = new Date().toISOString();
  console.log(`== Medição de eficiência da cadeia — início ${inicio} ==`);
  mkdirSync("qa", { recursive: true });

  /* -------- FASE A: sondagem de esquema (1 CNPJ × 4 fontes, resposta CRUA) -------- */
  console.log("\n-- FASE A: sondagem de esquema (Petrobras em cada fonte) --");
  const sondagem: Record<string, Record<string, string>> = {};
  const URLS: Record<string, string> = {
    BrasilAPI: `https://brasilapi.com.br/api/cnpj/v1/33000167000101`,
    OpenCNPJ: `https://api.opencnpj.org/33000167000101`,
    ReceitaWS: `https://receitaws.com.br/v1/cnpj/33000167000101`,
    MinhaReceita: `https://minhareceita.org/33000167000101`,
  };
  for (const [fonte, url] of Object.entries(URLS)) {
    if (isSourceCoolingDown(fonte)) {
      sondagem[fonte] = { _pulada: "fonte em backoff" };
      continue;
    }
    const j = await fetchJsonCru(url);
    const chaves: Record<string, string> = {};
    for (const k of CHAVES_RELEVANTES) {
      if (k in j) chaves[k] = j[k] === null ? "null" : Array.isArray(j[k]) ? `array(${(j[k] as unknown[]).length})` : typeof j[k];
    }
    if ("_erro" in j) chaves._erro = String(j._erro);
    sondagem[fonte] = chaves;
    console.log(`  ${fonte}: ${Object.keys(chaves).length} chaves relevantes${chaves._erro ? ` (${chaves._erro})` : ""}`);
    await sleep(CORTESIA_MS);
  }

  /* -------- FASE B: coleta por mapeador (4 CNPJs × 4 fontes) -------- */
  console.log("\n-- FASE B: coleta por mapeador (4 CNPJs × 4 fontes da cadeia) --");
  const coletas: Record<string, Record<string, { ok: boolean; data?: CnpjLookupData; erro?: string; pulada?: boolean }>> = {};
  let chamadasFaseB = 0;
  for (const alvo of ALVOS) {
    coletas[alvo.cnpj] = {};
    for (const { fonte, fn } of CHAIN) {
      if (isSourceCoolingDown(fonte)) {
        coletas[alvo.cnpj][fonte] = { ok: false, pulada: true, erro: "fonte em backoff por 429 recente" };
        console.log(`  ${alvo.cnpj} × ${fonte}: PULADA (backoff)`);
        continue;
      }
      const t0 = Date.now();
      const r = await fn(alvo.cnpj);
      chamadasFaseB++;
      await sleep(CORTESIA_MS);
      if (r.ok) {
        coletas[alvo.cnpj][fonte] = { ok: true, data: r.data };
        console.log(`  ${alvo.cnpj} × ${fonte}: OK ${Date.now() - t0}ms — lacunas ${gapsOf(r.data).length}`);
      } else {
        coletas[alvo.cnpj][fonte] = { ok: false, erro: r.message, pulada: r.pulada };
        console.log(`  ${alvo.cnpj} × ${fonte}: FALHA ${r.errorType}`);
      }
    }
  }

  /* -------- FASE C: simulação offline das duas estratégias -------- */
  console.log("\n-- FASE C: simulação ANTES (v0.10.0) vs DEPOIS (v0.10.1, portão) --");
  let divergencia = false;
  const execucoes = ALVOS.map((alvo) => {
    const coleta: Coleta = CHAIN.map(({ fonte }) => ({ fonte, ...(coletas[alvo.cnpj][fonte] as object) })) as Coleta;
    const antes = simular(coleta, "antes");
    const depois = simular(coleta, "depois");
    const chamadasAntes = antes.chamadas.filter((c) => !c.pulada).length;
    const chamadasDepois = depois.chamadas.filter((c) => !c.pulada).length;
    const cuAntes = camposUteis(antes.camposFinais ? { ...antes.camposFinais } : null);
    const cuDepois = camposUteis(depois.camposFinais ? { ...depois.camposFinais } : null);
    const perdeuCampo = JSON.stringify(cuAntes) !== JSON.stringify(cuDepois);
    if (perdeuCampo) divergencia = true;
    console.log(`  ${alvo.cnpj}: chamadas ANTES=${chamadasAntes} DEPOIS=${chamadasDepois} | campos úteis ${cuAntes.length}→${cuDepois.length}${perdeuCampo ? " ⚠ DIVERGÊNCIA" : ""}`);
    return {
      alvo: alvo.rotulo,
      cnpj: alvo.cnpj,
      expectativa: alvo.expectativa,
      antes: { chamadasHttp: chamadasAntes, passos: antes.chamadas, complementacoes: antes.complementacoes, gapsFinais: antes.gapsFinais, camposUteis: cuAntes },
      depois: { chamadasHttp: chamadasDepois, passos: depois.chamadas, complementacoes: depois.complementacoes, gapsFinais: depois.gapsFinais, camposUteis: cuDepois, fontesPuladasPortao: depois.chamadas.filter((c) => c.pulada && c.motivo.startsWith("portão")).map((c) => c.fonte) },
      perdeuCampo,
    };
  });

  const totAntes = execucoes.reduce((s, e) => s + e.antes.chamadasHttp, 0);
  const totDepois = execucoes.reduce((s, e) => s + e.depois.chamadasHttp, 0);
  const camposAntes = execucoes.reduce((s, e) => s + e.antes.camposUteis.length, 0);
  const camposDepois = execucoes.reduce((s, e) => s + e.depois.camposUteis.length, 0);
  const veredito = divergencia
    ? "FALHA — o portão perdeu campo em algum CNPJ (corrigir antes de adotar)"
    : totDepois < totAntes
      ? `ECONOMIA REAL — ${totAntes - totDepois} chamada(s) HTTP evitada(s) na amostra (${totAntes}→${totDepois}) com os MESMOS campos úteis (${camposDepois})`
      : totDepois === totAntes
        ? `SEM ECONOMIA NA AMOSTRA — mesmas ${totAntes} chamadas e mesmos campos (${camposAntes}); o portão permanece como proteção (evita caminhadas injustificadas) SEM claim de economia`
        : "REGRESSÃO — mais chamadas no modo DEPOIS (não deveria acontecer)";

  console.log(`\n== RESULTADO ==\n${veredito}\n`);

  const saida = {
    geradoEm: inicio,
    nota: "Medição v0.10.1 (auditoria): lacunas não-preenchíveis geravam caminhada completa? Fases A (sondagem de esquema) + B (coleta real 4×4) + C (simulação offline fiel das duas estratégias). Zero IA, zero custo, chamadas públicas com cortesia de 300ms.",
    faseA_sondagemEsquema: sondagem,
    mapaCapacidades: Object.fromEntries(Object.entries(CAMPOS_POR_FONTE).map(([k, v]) => [k, [...v].sort()])),
    faseB_chamadasHttp: chamadasFaseB,
    execucoes,
    totais: { chamadasAntes: totAntes, chamadasDepois: totDepois, camposUteisAntes: camposAntes, camposUteisDepois: camposDepois, divergencia },
    veredito,
  };
  writeFileSync("qa/eficiencia-cadeia-v0.10.1.json", JSON.stringify(saida, null, 2));

  const md = [
    "# Eficiência real da cadeia — v0.10.1 (auditoria)",
    "",
    `Gerado em: ${inicio}`,
    "",
    "**Pergunta:** lacunas que nenhuma fonte consegue preencher causam consultas repetidas desnecessárias?",
    "",
    `**Veredito medido:** ${veredito}`,
    "",
    "| CNPJ | Chamadas ANTES | Chamadas DEPOIS | Campos úteis ANTES | Campos úteis DEPOIS | Pulos do portão |",
    "|---|---|---|---|---|---|",
    ...execucoes.map((e) => `| ${e.cnpj} | ${e.antes.chamadasHttp} | ${e.depois.chamadasHttp} | ${e.antes.camposUteis.length} | ${e.depois.camposUteis.length} | ${e.depois.fontesPuladasPortao.join(", ") || "—"} |`),
    "",
    `**Total:** ${totAntes} → ${totDepois} chamadas; campos úteis ${camposAntes} → ${camposDepois} (perda é BUG — divergência: ${divergencia ? "SIM" : "não"}).`,
    "",
    "Fase A (sondagem de esquema) e mapa de capacidades completos no JSON. Fase B: " + chamadasFaseB + " chamadas reais. Fase C: simulação offline fiel (mesmos dados, duas estratégias) — zero chamada extra.",
  ].join("\n");
  writeFileSync("qa/eficiencia-cadeia-v0.10.1.md", md);
  console.log("Escrito: qa/eficiencia-cadeia-v0.10.1.json + .md");
}

main();
