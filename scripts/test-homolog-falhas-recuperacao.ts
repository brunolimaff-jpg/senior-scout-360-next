/**
 * test-homolog-falhas-recuperacao.ts — HOMOLOG-D3 (Gate 10):
 * FALHAS E RECUPERAÇÃO — 12 cenários do contrato de homologação v0.11.0.
 *
 * Este arquivo cobre os cenários 1–8, 10 e 11 (nível script, banco ISOLADO,
 * fontes 100% simuladas — zero HTTP real, zero IA) + pré-prova in-process do
 * cenário 9 (claim atômico do sweep). O cenário 9 REAL (reinício do dev server
 * com lote zumbi no banco vivo) e o 12 (preferências de UI) rodam no script-irmão
 * scripts/gate10-live-restart.ts, que MERGEIA o resultado nos mesmos arquivos de
 * evidência (qa/homolog-v0110/gate10/relatorio.{txt,json}).
 *
 * Padrões reutilizados (provados em gates anteriores):
 *  - banco isolado /tmp + DATABASE_URL ANTES dos imports dinâmicos (test-v01024);
 *  - globalThis.fetch substituído por simulador que CONTA toda saída e BLOQUEIA
 *    host não cadastrado (test-v01010-falhas-fonte + gate4);
 *  - handlers de rota chamados diretamente com NextRequest in-process (gate4).
 *
 * Cenários (contrato Gate 10):
 *   1. HTTP 429 da fonte        → estado/mensagem/retry/sem duplicação
 *   2. HTTP 500 da fonte        → idem
 *   3. Timeout                  → idem
 *   4. Conexão interrompida     → idem
 *   5. Fonte com dado incompleto (ficha parcial / sem razão social)
 *   6. JSON inesperado (lixo / forma errada)
 *   7. Resposta atrasada (timeout REAL de 8s + resposta tardia descartada pelo
 *      AbortController; snapshot-restore da revalidação — resposta tardia não
 *      sobrescreve estado mais novo)
 *   8. Comando duplicado (duplo clique) — single-flight em 3 níveis
 *   9. (pré-prova in-process) claim atômico do sweep + linha zumbi CONSULTANDO
 *  10. Lote interrompido retomado por "Concluir pendências" (só pendentes;
 *      sem retrabalho; auditoria íntegra)
 *  11. Exportação falha no meio → JSON de erro, nada parcial servido
 *
 * CORREÇÃO APLICADA NESTE GATE: G10-2 (mensagem de pulo por backoff citava sempre
 * '429' — agora cita a causa real: 429 | erro <status> | timeout). Verificado pelos
 * checks de regressão dos cenários 1–3. G10-1 (parse falho → ERRO_REDE em vez de
 * INVALID_RESPONSE) permanece documentado como pendente (mudança de mapeamento de
 * estado é material).
 *
 * Uso: bun scripts/test-homolog-falhas-recuperacao.ts
 * Saída: qa/homolog-v0110/gate10/relatorio.txt + relatorio.json
 */
import { execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/* ================= 0) banco isolado (padrão test-v01024) ================= */
const DB_ISOLADO = "/tmp/homolog-gate10-falhas.db";
const DB_JOURNAL = "/tmp/homolog-gate10-falhas.db-journal";
for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
execSync(`DATABASE_URL="file:${DB_ISOLADO}" bunx prisma db push --skip-generate`, {
  cwd: process.cwd(),
  stdio: "pipe",
});
process.env.DATABASE_URL = `file:${DB_ISOLADO}`;
delete process.env.SCOUT_EXPORT_TOKEN;
delete process.env.SCOUT_AUTH_REQUIRED; // modo OPEN: handlers de rota chamados direto

const EVID_DIR = join(process.cwd(), "qa", "homolog-v0110", "gate10");
mkdirSync(EVID_DIR, { recursive: true });

/* ================= simulador global de fontes (ZERO HTTP real) ================= */
/** Comportamento de uma fonte: "ficha" | status | excecao | lixo | atrasada */
type Humor =
  | { tipo: "ficha"; ficha: Record<string, unknown> }
  | { tipo: "status"; status: number }
  | { tipo: "excecao"; name: string; message: string }
  | { tipo: "lixo"; body: string }
  | { tipo: "atrasada"; ficha: Record<string, unknown>; delayMs: number };
/** Regras por CNPJ — PRIMEIRA regra que casa com a fonte vence (fonte undefined = todas). */
const HUMOR = new Map<string, { fonte?: string; humor: Humor }[]>();
function addHumor(cnpj: string, regra: { fonte?: string; humor: Humor }): void {
  const lista = HUMOR.get(cnpj) ?? [];
  // regra específica de fonte tem precedência sobre a genérica
  if (regra.fonte) lista.unshift(regra);
  else lista.push(regra);
  HUMOR.set(cnpj, lista);
}
function setHumorUnico(cnpj: string, humor: Humor): void {
  HUMOR.set(cnpj, [{ humor }]);
}

const tentativasExternas: string[] = []; // toda saída externa registrada
const respostasTardias = { entregues: 0, consumidas: 0 }; // cenário 7: resposta atrasada
const fetchOriginal = globalThis.fetch;

const RE_CNPJ_URL =
  /(?:brasilapi\.com\.br\/api\/cnpj\/v1|api\.opencnpj\.org|receitaws\.com\.br\/v\d+\/cnpj|minhareceita\.org)\/([0-9]{14})/;

function humorDe(url: string, cnpj: string): Humor | null {
  const fonte = url.includes("brasilapi") ? "BrasilAPI" : url.includes("opencnpj") ? "OpenCNPJ" : url.includes("receitaws") ? "ReceitaWS" : "MinhaReceita";
  const regras = HUMOR.get(cnpj);
  if (!regras) return null;
  const especifica = regras.find((r) => r.fonte === fonte);
  if (especifica) return especifica.humor;
  const generica = regras.find((r) => !r.fonte);
  return generica ? generica.humor : null;
}

/* grafo de relações (cenário 8): respostas por path + contador de tentativas */
const GRAFO: Record<string, unknown> = {};
const GRAFO_TENTATIVAS: string[] = [];
const GRAFO_DELAY_MS = 120;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/^https?:\/\//i.test(url) || url.includes("127.0.0.1") || url.includes("localhost")) {
    return fetchOriginal(input as never, init);
  }
  tentativasExternas.push(url);

  if (url.startsWith("https://grafo.minhareceita.org/")) {
    const path = url.replace("https://grafo.minhareceita.org", "").split("?")[0];
    GRAFO_TENTATIVAS.push(path);
    if (GRAFO[path] !== undefined) {
      await new Promise((r) => setTimeout(r, GRAFO_DELAY_MS)); // janela de concorrência real
      return new Response(JSON.stringify(GRAFO[path]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "não encontrado (simulado)" }), { status: 404 });
  }
  if (url.includes("servicodados.ibge.gov.br/")) {
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const m = url.match(RE_CNPJ_URL);
  if (m) {
    const humor = humorDe(url, m[1]);
    if (!humor) return new Response(JSON.stringify({ message: "not found (simulado)" }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (humor.tipo === "status") {
      return new Response(JSON.stringify({ message: `falha simulada (${humor.status})` }), { status: humor.status, headers: { "Content-Type": "application/json" } });
    }
    if (humor.tipo === "excecao") {
      const e = new Error(humor.message);
      (e as { name?: string }).name = humor.name;
      throw e;
    }
    if (humor.tipo === "lixo") {
      return new Response(humor.body, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (humor.tipo === "atrasada") {
      // Resposta TARDE (após o teto de 8s do motor). Honra o AbortSignal como o fetch
      // real: quem escuta o sinal rejeita na hora; o "pacote tardio" AINDA chega ao
      // transporte às delayMs (contador entregues) — mas ninguém mais o consome.
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise<Response>((resolve, reject) => {
        setTimeout(() => {
          respostasTardias.entregues += 1;
          const res = new Response(JSON.stringify(humor.ficha), { status: 200, headers: { "Content-Type": "application/json" } });
          const jsonOrig = res.json.bind(res);
          res.json = async () => {
            respostasTardias.consumidas += 1;
            return jsonOrig();
          };
          resolve(res);
        }, humor.delayMs);
        if (signal) {
          if (signal.aborted) {
            const e = new Error("The operation was aborted due to timeout");
            (e as { name?: string }).name = "AbortError";
            reject(e);
          } else {
            signal.addEventListener(
              "abort",
              () => {
                const e = new Error("The operation was aborted due to timeout");
                (e as { name?: string }).name = "AbortError";
                reject(e);
              },
              { once: true }
            );
          }
        }
      });
    }
    return new Response(JSON.stringify(humor.ficha), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`SIMULADOR: saída externa NÃO cadastrada — bloqueada (prova de zero HTTP real): ${url}`);
}) as typeof fetch;

/* ================= imports dinâmicos (APÓS o env do banco isolado) ================= */
const { db } = await import("../src/lib/db");
const { validateCnpj, formatCnpj } = await import("../src/lib/cnpj");
const { startBatch, confirmTextBatch, sweepStalled } = await import("../src/lib/enrich/engine");
const { lookupCnpjComCache } = await import("../src/lib/enrich/cadastro-cache");
const { emVooUnico } = await import("../src/lib/single-flight");
const { aguardarTelemetria } = await import("../src/lib/telemetry");
const { POST: retryPOST } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/retry/route");
const { POST: revalidatePOST } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/revalidate/route");
const { POST: processPOST } = await import("../src/app/api/imports/[id]/process/route");
const { POST: relacoesPOST } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/route");
const { GET: exportGET } = await import("../src/app/api/imports/[id]/export/route");
const { NextRequest } = await import("next/server");
type NextReq = InstanceType<typeof NextRequest>;

/* ================= CNPJs sintéticos (DV válido por construção) ================= */
function cnpjValido(raiz8: string, ordem = "0001"): string {
  const base = raiz8 + ordem;
  const calc = (d: number[]) => {
    let soma = 0;
    let peso = d.length - 7;
    for (const dig of d) {
      soma += dig * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base.split("").map(Number));
  const d2 = calc((base + String(d1)).split("").map(Number));
  const cnpj = base + String(d1) + String(d2);
  if (!validateCnpj(cnpj).valid) throw new Error(`CNPJ sintético inválido: ${cnpj}`);
  return cnpj;
}

/** Ficha completa no formato BrasilAPI (sem lacunas — fecha a cadeia na primária). */
function fichaBrasilAPI(cnpj: string, razao: string): Record<string, unknown> {
  return {
    cnpj,
    razao_social: razao,
    nome_fantasia: "Fantasia Sintetica",
    descricao_situacao_cadastral: "ATIVA",
    data_situacao: "2020-01-01",
    identificador_matriz_filial: 1,
    descricao_identificador_matriz_filial: "MATRIZ",
    descricao_tipo_de_logradouro: "RUA",
    logradouro: "DAS ACACIAS",
    numero: "100",
    bairro: "CENTRO",
    municipio: "SAO PAULO",
    uf: "SP",
    cnae_fiscal: 6204000,
    cnae_fiscal_descricao: "Desenvolvimento de software",
    cnaes_secundarios: [{ codigo: 6209100, descricao: "Atividade secundaria sintetica" }],
    ddd_telefone_1: "11 3044 4000",
    data_inicio_atividade: "1995-05-05",
    capital_social: "100000.00",
    descricao_porte: "DEMAIS",
    natureza_juridica: "Sociedade sintetica",
    opcao_pelo_simples: false,
    opcao_pelo_mei: false,
    email: "contato@sintetica.com.br",
    regime_tributario: [{ ano: 2023, forma_de_tributacao: "LUCRO REAL" }],
    qsa: [{ nome_socio: "SOCIO SINTETICO", qualificacao_socio: "Socio-Administrador" }],
    codigo_municipio_ibge: "3550308",
  };
}

/* CNPJs do gate (raiz 88.881.0xx — inexistente na Receita; só o simulador responde) */
const C1 = cnpjValido("88881001"); // 1 — 429
const C2 = cnpjValido("88881002"); // 2 — 500
const C3 = cnpjValido("88881003"); // 3 — timeout (exceção nomeada)
const C4 = cnpjValido("88881004"); // 4 — conexão interrompida
const C5A = cnpjValido("88881005"); // 5a — 200 sem razao_social
const C5B = cnpjValido("88881006"); // 5b — ficha parcial + complementação
const C6A = cnpjValido("88881007"); // 6a — lixo (não-JSON)
const C6B = cnpjValido("88881008"); // 6b — JSON forma errada
const C7 = cnpjValido("88881009"); // 7a — resposta atrasada (timeout real 8s)
const C7R = cnpjValido("88881019"); // 7b — revalidação com fonte falhando (snapshot)
const C8A = cnpjValido("88881010"); // 8b — single-flight cadastro
const C8C = cnpjValido("88881011"); // 8c — single-flight rota de relações
const C10_OK = cnpjValido("88881012"); // 10 — linha DONE (não pode retrabalhar)
const C10_F1 = cnpjValido("88881013"); // 10 — linha FAILED (RATE_LIMITED rc=1)
const C10_P1 = cnpjValido("88881014"); // 10 — linha PENDING
const C9PRE = cnpjValido("88881015"); // 9-pre — linha zumbi do sweep
const C11_OK = cnpjValido("88881016"); // 11 — lote saudável para exportar
const C_SAUDAVEL = cnpjValido("88881017"); // controle dos lotes 1–4

/* ================= infra de relatório ================= */
interface Veredito {
  cenario: number;
  titulo: string;
  feito: string;
  esperado: string;
  veredito: "PASS" | "FAIL";
  notas: string;
  checks: { nome: string; ok: boolean; detalhe: string }[];
}
const resultados: Veredito[] = [];
const achados: { id: string; severidade: string; descricao: string; repro: string }[] = [];
const correcoes: { id: string; severidade: string; descricao: string; correcao: string; prova: string }[] = [];
const metricas: Record<string, unknown>[] = [];
const todosChecks: { nome: string; ok: boolean; detalhe: string }[] = [];
const falhas: string[] = [];

function check(nome: string, cond: boolean, detalhe = ""): boolean {
  todosChecks.push({ nome, ok: cond, detalhe });
  console.log(`    ${cond ? "PASS" : "FAIL"}  ${nome}${!cond && detalhe ? ` — ${detalhe}` : ""}`);
  return cond;
}

function registrar(v: Omit<Veredito, "veredito">): void {
  const veredito: "PASS" | "FAIL" = v.checks.every((c) => c.ok) ? "PASS" : "FAIL";
  for (const c of v.checks) {
    todosChecks.push(c);
    console.log(`    ${c.ok ? "PASS" : "FAIL"}  ${c.nome}${!c.ok && c.detalhe ? ` — ${c.detalhe}` : ""}`);
  }
  resultados.push({ ...v, veredito });
  if (veredito === "FAIL") falhas.push(`C${v.cenario}: ${v.titulo}`);
  console.log(`  [C${v.cenario}] ${v.titulo} → ${veredito}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function novoLoteTexto(nomeArquivo: string, linhas: string[]): Promise<string> {
  const storedPath = `/tmp/gate10-${nomeArquivo}.txt`;
  writeFileSync(storedPath, linhas.join("\n") + "\n", "utf8");
  const batch = await db.importBatch.create({
    data: { fileName: `QA-gate10-${nomeArquivo}.txt`, sourceType: "TEXT", storedPath, fileSize: 64, hasHeader: false, headerJson: JSON.stringify(["entrada"]) },
  });
  const ok = await confirmTextBatch(batch.id, false);
  if (!ok.ok) throw new Error(`confirmTextBatch falhou: ${ok.error}`);
  return batch.id;
}

async function esperarLote(batchId: string, timeoutMs = 120_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } });
    const ativos = await db.importRow.count({ where: { batchId, lookupStatus: { in: ["PENDENTE", "EM_FILA", "CONSULTANDO"] } } });
    if (ativos === 0 && batch && ["DONE", "PARTIAL", "FAILED"].includes(batch.status)) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando lote ${batchId} (status=${batch?.status}, ativos=${ativos})`);
    await sleep(200);
  }
}

type Row = NonNullable<Awaited<ReturnType<typeof db.importRow.findFirst>>>;
async function linhaDe(batchId: string, rowNumber: number): Promise<Row> {
  const row = await db.importRow.findFirst({ where: { batchId, rowNumber } });
  if (!row) throw new Error(`linha ${rowNumber} não encontrada no lote ${batchId}`);
  return row;
}

function limparBackoffFontes(): void {
  const g = globalThis as unknown as { __cnpjSourceBackoff?: Map<string, number> };
  g.__cnpjSourceBackoff?.clear();
}

function req(url: string, method: "POST" | "GET", body?: unknown): NextReq {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function telemetriaDe(cnpj: string, tipo = "COLETA_CADASTRO") {
  return db.telemetryEvent.findMany({ where: { tipo, alvo: { contains: cnpj } }, orderBy: { id: "asc" } });
}

async function auditorias(batchId: string) {
  return db.auditEvent.findMany({ where: { batchId }, orderBy: { id: "asc" }, select: { event: true, detail: true, rowNumber: true } });
}

/* Fábrica dos cenários 1–4 (falha de transporte/status em TODAS as fontes).
 *
 * Semântica observada do motor (contrato honesto do runBatch): falhas transitórias
 * são RETENTADAS automaticamente até MAX_RETRIES=3 DENTRO do mesmo run (o loop
 * re-seleciona a linha enquanto retryCount<3). Backoff por fonte (429→30s,
 * 5xx→10s, timeout→15s; erro de rede NÃO marca backoff) faz as rodadas seguintes
 * "pularem" as fontes sem HTTP — a última tentativa vira RATE_LIMITED "pulada".
 * Erro de rede não marca backoff → todas as rodadas consultam de verdade.
 */
const ALVO_STATUS: Record<number, string> = { 1: "RATE_LIMITED", 2: "RATE_LIMITED", 3: "RATE_LIMITED", 4: "ERRO_REDE" };
const TEL_EVENTOS: Record<number, number> = { 1: 4, 2: 4, 3: 4, 4: 12 };
/** G10-2 (corrigido neste gate): causa que a mensagem de "pulada por backoff" DEVE citar, por cenário. */
const MOTIVO_BACKOFF: Record<number, string> = { 1: "429", 2: "erro 500", 3: "timeout" };
const NOTAS: Record<number, string> = {
  1: "429 marca backoff de 30s POR FONTE (noteBackoff em sources.ts) — rodadas 2–3 pulam as fontes SEM HTTP (última tentativa = pulada RATE_LIMITED); telemetria da rodada 1 registra 4 bloqueados com httpStatus=429. O motor retenta até MAX_RETRIES=3 dentro do mesmo run antes de deixar a linha falhada.",
  2: "5xx marca backoff de 10s por fonte — a telemetria da rodada 1 registra os 500 de verdade (httpStatus=500, estadoFinal=falha) e as rodadas 2–3 pulam sem HTTP; o estado final da linha degrada para RATE_LIMITED (todas as fontes em cooldown — semântica de backoff). G10-2 CORRIGIDO neste gate: a mensagem do pulo agora cita a causa real ('erro 500'), não '429'.",
  3: "Timeout marca backoff de 15s por fonte — telemetria da rodada 1 registra 'Timeout após 8s' em cada fonte; rodadas 2–3 pulam sem HTTP; estado final degrada para RATE_LIMITED (semântica de backoff). G10-2 CORRIGIDO: mensagem do pulo cita 'timeout'.",
  4: "Erro de rede NÃO marca backoff (fetchJson só faz noteBackoff em 429/5xx/timeout) — as 3 rodadas consultam as 4 fontes DE VERDADE (12 tentativas telemetradas) e o estado final é o erro real ERRO_REDE com a mensagem da exceção de conexão.",
};

async function cenarioFalha(num: number, titulo: string, cnpjAlvo: string, humor: Humor): Promise<void> {
  const feito = `Lote TEXT com 2 linhas: linha 1 = alvo ${formatCnpj(cnpjAlvo)} (TODAS as fontes falham: ${humor.tipo}), linha 2 = controle pré-concluída (ENRIQUECIDO por update direto — dado concluído que não pode ser tocado); startBatch; leitura de linha/auditoria/telemetria; retry pela rota; recuperação com fonte saudável.`;
  const esperado = `Alvo termina ${ALVO_STATUS[num]} após 3 rodadas automáticas (MAX_RETRIES=3 — ${TEL_EVENTOS[num] / 4} com HTTP real, o resto pula por backoff) com lookupError compreensível (fonte + causa), retryCount=3, 3× LOOKUP_FAIL na auditoria (uma por rodada), ${TEL_EVENTOS[num]} tentativas telemetradas (telemetria preserva o tipo REAL da 1ª rodada); controle ENRIQUECIDO intacto (ficha, datas e estado preservados); rota de retry aceita (EM_FILA, retryCount=0, auditoria ROW_RETRY); pós-recuperação o alvo fica ENRIQUECIDO e o controle segue intocado.`;
  console.log(`\n  [C${num}] ${titulo}`);
  const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
  limparBackoffFontes();
  HUMOR.delete(cnpjAlvo);
  setHumorUnico(cnpjAlvo, humor);
  const batchId = await novoLoteTexto(`c${num}`, [formatCnpj(cnpjAlvo), formatCnpj(C_SAUDAVEL)]);
  // controle: dado JÁ CONCLUÍDO antes da falha (update direto — nunca entra no RETRYABLE do runBatch)
  const agoraCtl = new Date();
  const ctlSeed = await linhaDe(batchId, 2);
  await db.importRow.update({
    where: { id: ctlSeed.id },
    data: { lookupStatus: "ENRIQUECIDO", lookupError: null, legalName: "CONTROLE CONCLUIDO ANTES LTDA", source: "BrasilAPI", queriedAt: agoraCtl, collectedAt: agoraCtl, retryCount: 0, extraJson: JSON.stringify({ email: "antes@controle.com" }) },
  });
  await startBatch(batchId);
  await esperarLote(batchId);
  await aguardarTelemetria();

  const alvo = await linhaDe(batchId, 1);
  const controle = await linhaDe(batchId, 2);
  const audits1 = await auditorias(batchId);

  checks.push({ nome: `alvo no estado de erro final correto (${ALVO_STATUS[num]})`, ok: alvo.lookupStatus === ALVO_STATUS[num], detalhe: `lookupStatus=${alvo.lookupStatus} (esperado ${ALVO_STATUS[num]})` });
  checks.push({ nome: "mensagem de erro presente e compreensível (fonte + causa)", ok: /: /.test(alvo.lookupError ?? "") && (alvo.lookupError ?? "").length > 8, detalhe: `lookupError="${alvo.lookupError}"` });
  checks.push({ nome: "retryCount=3 (teto MAX_RETRIES do run — sem martelada infinita)", ok: alvo.retryCount === 3, detalhe: `retryCount=${alvo.retryCount}` });
  checks.push({ nome: "fonte da última tentativa registrada na linha", ok: !!alvo.source, detalhe: `source=${alvo.source}` });
  checks.push({ nome: "3× LOOKUP_FAIL na auditoria (uma por rodada automática)", ok: audits1.filter((a) => a.event === "LOOKUP_FAIL" && a.rowNumber === 1).length === 3, detalhe: `${audits1.filter((a) => a.event === "LOOKUP_FAIL" && a.rowNumber === 1).length} eventos` });
  const telAlvo = await telemetriaDe(cnpjAlvo);
  checks.push({ nome: `telemetria: ${TEL_EVENTOS[num]} tentativas reais de fonte (rodadas que consultaram de verdade)`, ok: telAlvo.length === TEL_EVENTOS[num], detalhe: `${telAlvo.length} eventos (${telAlvo.map((t) => `${t.fonte}:${t.estadoFinal}`).join(",")})` });
  const tel1aRodada = telAlvo.slice(0, 4);
  if (num === 1) {
    checks.push({ nome: "telemetria da 1ª rodada preserva o 429 real (estadoFinal=bloqueado, httpStatus=429)", ok: tel1aRodada.length === 4 && tel1aRodada.every((t) => t.estadoFinal === "bloqueado" && t.httpStatus === 429), detalhe: tel1aRodada.map((t) => `${t.fonte}:${t.estadoFinal}:${t.httpStatus}`).join(",") });
  }
  if (num === 2) {
    checks.push({ nome: "telemetria da 1ª rodada preserva o 500 real (estadoFinal=falha, httpStatus=500)", ok: tel1aRodada.length === 4 && tel1aRodada.every((t) => t.estadoFinal === "falha" && t.httpStatus === 500), detalhe: tel1aRodada.map((t) => `${t.fonte}:${t.estadoFinal}:${t.httpStatus}`).join(",") });
  }
  if (num === 3) {
    checks.push({ nome: "telemetria da 1ª rodada preserva o timeout real ('Timeout após 8s')", ok: tel1aRodada.length === 4 && tel1aRodada.every((t) => (t.erro ?? "").includes("Timeout após 8s")), detalhe: tel1aRodada.map((t) => String(t.erro)).join(" | ") });
  }
  if (num === 4) {
    checks.push({ nome: "telemetria preserva a causa real de rede em TODAS as rodadas (12 eventos com 'conexão interrompida')", ok: telAlvo.length === 12 && telAlvo.every((t) => (t.erro ?? "").includes("conexão interrompida")), detalhe: `${telAlvo.filter((t) => (t.erro ?? "").includes("conexão interrompida")).length}/12` });
  }
  if (MOTIVO_BACKOFF[num]) {
    // regressão do fix G10-2: a mensagem do pulo cita a causa REAL do backoff
    checks.push({ nome: `mensagem do pulo por backoff cita a causa REAL (${MOTIVO_BACKOFF[num]}), não sempre '429' [fix G10-2]`, ok: (alvo.lookupError ?? "").includes(`backoff por ${MOTIVO_BACKOFF[num]} recente`), detalhe: `lookupError="${alvo.lookupError}"` });
  }
  checks.push({ nome: "controle ENRIQUECIDO preservado (dado concluído intacto através da falha)", ok: controle.lookupStatus === "ENRIQUECIDO" && controle.legalName === "CONTROLE CONCLUIDO ANTES LTDA" && controle.queriedAt?.getTime() === agoraCtl.getTime(), detalhe: `status=${controle.lookupStatus} razao=${controle.legalName} queriedAt_igual=${controle.queriedAt?.getTime() === agoraCtl.getTime()}` });

  // retry disponível
  const rr = await retryPOST(req(`http://localhost:3000/api/imports/${batchId}/rows/1/retry`, "POST"), { params: Promise.resolve({ id: batchId, rowNumber: "1" }) });
  const rrBody = (await rr.json()) as { ok?: boolean; queued?: boolean };
  const posRetry = await linhaDe(batchId, 1);
  const audits2 = await auditorias(batchId);
  checks.push({ nome: "rota de retry aceita o estado (200, EM_FILA, retryCount=0, audit ROW_RETRY)", ok: rr.status === 200 && rrBody.queued === true && posRetry.lookupStatus === "EM_FILA" && posRetry.retryCount === 0 && audits2.some((a) => a.event === "ROW_RETRY"), detalhe: `http=${rr.status} status=${posRetry.lookupStatus} rc=${posRetry.retryCount}` });

  // recuperação: fonte volta ao normal → retry resolve
  limparBackoffFontes();
  HUMOR.delete(cnpjAlvo);
  setHumorUnico(cnpjAlvo, { tipo: "ficha", ficha: fichaBrasilAPI(cnpjAlvo, `ALVO C${num} RECUPERADO LTDA`) });
  await startBatch(batchId);
  await esperarLote(batchId);
  const recuperada = await linhaDe(batchId, 1);
  const controle2 = await linhaDe(batchId, 2);
  checks.push({ nome: "pós-recuperação: alvo ENRIQUECIDO com ficha da fonte", ok: recuperada.lookupStatus === "ENRIQUECIDO" && recuperada.legalName === `ALVO C${num} RECUPERADO LTDA`, detalhe: `status=${recuperada.lookupStatus} razao=${recuperada.legalName}` });
  checks.push({ nome: "controle NÃO reprocessado na recuperação (ficha e datas intactas)", ok: controle2.queriedAt?.getTime() === agoraCtl.getTime() && controle2.legalName === "CONTROLE CONCLUIDO ANTES LTDA", detalhe: `queriedAt ${controle.queriedAt?.toISOString()} → ${controle2.queriedAt?.toISOString()}` });

  registrar({ cenario: num, titulo, feito, esperado, notas: NOTAS[num], checks });
  metricas.push({
    cenario: num,
    batchId,
    cnpj: formatCnpj(cnpjAlvo),
    lookupStatus: alvo.lookupStatus,
    lookupError: alvo.lookupError,
    retryCount: alvo.retryCount,
    tentativas_telemetria: telAlvo.map((t) => `${t.fonte}:${t.estadoFinal}:${t.httpStatus ?? "-"}`),
    recuperado_para: recuperada.lookupStatus,
  });
}

/* =================================================================== */
/* EXECUÇÃO                                                            */
/* =================================================================== */
let exitCode = 0;
const t0 = Date.now();
try {
  console.log("=== HOMOLOG-D3 Gate 10 — Falhas e recuperação (cenários 1–8, 10, 11 + pré-9; banco isolado, fontes simuladas) ===\n");

  /* ---------- Cenário 1: HTTP 429 ---------- */
  await cenarioFalha(1, "HTTP 429 de todas as fontes → RATE_LIMITED honesto + retry", C1, { tipo: "status", status: 429 });

  /* ---------- Cenário 2: HTTP 500 ---------- */
  await cenarioFalha(2, "HTTP 500 de todas as fontes → falha honesta (500 real na telemetria + backoff por fonte) + retry", C2, { tipo: "status", status: 500 });

  /* ---------- Cenário 3: Timeout (exceção nomeada) ---------- */
  await cenarioFalha(3, "Timeout de fonte → falha honesta (Timeout após 8s real na telemetria + backoff por fonte) + retry", C3, { tipo: "excecao", name: "TimeoutError", message: "simulado: estourou o timeout" });

  /* ---------- Cenário 4: conexão interrompida ---------- */
  await cenarioFalha(4, "Conexão interrompida (fetch rejeita) → ERRO_REDE honesto + retry", C4, { tipo: "excecao", name: "TypeError", message: "simulado: conexão interrompida (ECONNRESET)" });

  /* ---------- Cenário 5: fonte com dados incompletos ---------- */
  {
    const feito = "Duas provas: (5a) BrasilAPI responde 200 SEM razao_social e OpenCNPJ traz a ficha completa; (5b) BrasilAPI traz ficha PARCIAL (sem fantasia/e-mail/QSA) e OpenCNPJ complementa as lacunas.";
    const esperado =
      "5a: resposta 200 semanticamente inútil vira INVALID_RESPONSE — a cadeia cai para a fonte seguinte e a linha fica ENRIQUECIDO pela fonte válida (nunca ficha quebrada). " +
      "5b: linha ENRIQUECIDO pela primária COM complementação registrada (fontesJson.complementacoes com fonte+campos; sócios vindos da complementação); sem martelada (BrasilAPI e OpenCNPJ 1× cada; cauda não consultada sem lacuna preenchível).";
    const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
    console.log("\n  [C5] Fonte com dados incompletos");

    // 5a — 200 sem razao_social na primária; OpenCNPJ salva; cauda 404
    limparBackoffFontes();
    HUMOR.delete(C5A);
    addHumor(C5A, { fonte: "BrasilAPI", humor: { tipo: "ficha", ficha: { cnpj: C5A, descricao_situacao_cadastral: "ATIVA", municipio: "SAO PAULO", uf: "SP" } } });
    addHumor(C5A, { fonte: "OpenCNPJ", humor: { tipo: "ficha", ficha: fichaBrasilAPI(C5A, "CINCO A COMPLETA LTDA") } });
    addHumor(C5A, { humor: { tipo: "status", status: 404 } });
    const b5a = await novoLoteTexto("c5a", [formatCnpj(C5A)]);
    await startBatch(b5a);
    await esperarLote(b5a);
    const r5a = await linhaDe(b5a, 1);
    checks.push({ nome: "5a: 200 sem razao_social NÃO vira ficha quebrada — fallback para fonte seguinte", ok: r5a.lookupStatus === "ENRIQUECIDO" && r5a.legalName === "CINCO A COMPLETA LTDA", detalhe: `status=${r5a.lookupStatus} razao=${r5a.legalName} fonte=${r5a.source}` });
    checks.push({ nome: "5a: fonte vencedora registrada (OpenCNPJ, não a primária capenga)", ok: r5a.source === "OpenCNPJ", detalhe: `source=${r5a.source}` });

    // 5b — ficha parcial + complementação seletiva (gaps fecham no OpenCNPJ; cauda não é consultada)
    limparBackoffFontes();
    HUMOR.delete(C5B);
    const parcial: Record<string, unknown> = { ...fichaBrasilAPI(C5B, "CINCO B PARCIAL LTDA"), nome_fantasia: "", email: "" };
    delete parcial.qsa;
    const complementadora: Record<string, unknown> = {
      ...fichaBrasilAPI(C5B, "CINCO B PARCIAL LTDA"),
      nome_fantasia: "Fantasia da Complemento",
      email: "complemento@opencnpj.org",
      qsa: [{ nome_socio: "SOCIO DA COMPLEMENTACAO", qualificacao_socio: "Socio" }],
    };
    addHumor(C5B, { fonte: "BrasilAPI", humor: { tipo: "ficha", ficha: parcial } });
    addHumor(C5B, { fonte: "OpenCNPJ", humor: { tipo: "ficha", ficha: complementadora } });
    addHumor(C5B, { humor: { tipo: "status", status: 404 } });
    const b5b = await novoLoteTexto("c5b", [formatCnpj(C5B)]);
    await startBatch(b5b);
    await esperarLote(b5b);
    await aguardarTelemetria();
    const r5b = await linhaDe(b5b, 1);
    const extra5b = r5b.extraJson ? (JSON.parse(r5b.extraJson) as Record<string, unknown>) : {};
    const fontes5b = r5b.fontesJson ? (JSON.parse(r5b.fontesJson) as { primaria: { fonte: string }; complementacoes: { fonte: string; campos: string[] }[] }) : null;
    const socios5b = r5b.sociosJson ? (JSON.parse(r5b.sociosJson) as { nome: string }[]) : [];
    checks.push({ nome: "5b: linha ENRIQUECIDO pela primária (identidade estável)", ok: r5b.lookupStatus === "ENRIQUECIDO" && r5b.source === "BrasilAPI" && r5b.legalName === "CINCO B PARCIAL LTDA", detalhe: `status=${r5b.lookupStatus} fonte=${r5b.source}` });
    checks.push({ nome: "5b: e-mail preenchido pela complementação (OpenCNPJ)", ok: extra5b.email === "complemento@opencnpj.org", detalhe: `email=${String(extra5b.email)}` });
    checks.push({ nome: "5b: QSA preenchido pela complementação", ok: socios5b.length === 1 && socios5b[0].nome === "SOCIO DA COMPLEMENTACAO", detalhe: `socios=${JSON.stringify(socios5b)}` });
    checks.push({ nome: "5b: proveniência registrada (fontesJson.complementacoes com fonte+campos)", ok: !!fontes5b && fontes5b.primaria.fonte === "BrasilAPI" && fontes5b.complementacoes.length === 1 && fontes5b.complementacoes[0].fonte === "OpenCNPJ" && fontes5b.complementacoes[0].campos.includes("email"), detalhe: `fontesJson=${r5b.fontesJson?.slice(0, 200)}` });
    const audit5b = await auditorias(b5b);
    const lookupOk5b = audit5b.find((a) => a.event === "LOOKUP_OK");
    checks.push({ nome: "5b: auditoria LOOKUP_OK declara complementado_por", ok: !!lookupOk5b && JSON.stringify(lookupOk5b.detail ?? "").includes("OpenCNPJ"), detalhe: `payload=${String(lookupOk5b?.detail).slice(0, 160)}` });
    const tentativas5b = tentativasExternas.filter((u) => u.includes(C5B));
    checks.push({ nome: "5b: sem martelada — 2 consultas (BrasilAPI + OpenCNPJ), cauda não consultada", ok: tentativas5b.length === 2, detalhe: `tentativas=${tentativas5b.length} (${tentativas5b.map((u) => u.replace(/^https:\/\//, "").split("/")[0]).join(",")})` });

    registrar({ cenario: 5, titulo: "Fonte com dados incompletos — ficha parcial e resposta semanticamente inválida", feito, esperado, notas: "5a é a prova do INVALID_RESPONSE ('Resposta sem razao_social') — HTTP 200 não é sinônimo de ficha. 5b é a complementação seletiva v0.10.0/v0.10.1: só campos vazios, identidade nunca sobrescrita, proveniência por campo.", checks });
    metricas.push({ cenario: 5, batch_5a: b5a, fonte_5a: r5a.source, batch_5b: b5b, complementacoes_5b: fontes5b?.complementacoes, consultas_5b: tentativas5b.length });
  }

  /* ---------- Cenário 6: JSON inesperado ---------- */
  {
    const feito = "Duas provas: (6a) todas as fontes respondem 200 com corpo NÃO-JSON (HTML de manutenção), com recuperação em seguida; (6b) todas respondem 200 com JSON de forma errada (sem razao_social).";
    const esperado =
      "6a: parse falha em cada fonte → linha termina ERRO_REDE com a mensagem do parser, nenhuma ficha inventada, 4 tentativas telemetradas, retry disponível e recuperação funciona quando a fonte volta. " +
      "6b: JSON válido semanticamente inútil → INVALID_RESPONSE por fonte, linha termina ERRO_SERVIDOR com 'Resposta sem razao_social'.";
    const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
    console.log("\n  [C6] JSON inesperado da fonte");

    limparBackoffFontes();
    HUMOR.delete(C6A);
    setHumorUnico(C6A, { tipo: "lixo", body: "<html><body>manutencao programada</body></html>" });
    const b6a = await novoLoteTexto("c6a", [formatCnpj(C6A)]);
    await startBatch(b6a);
    await esperarLote(b6a);
    await aguardarTelemetria();
    const r6a = await linhaDe(b6a, 1);
    checks.push({ nome: "6a: linha em estado de erro honesto (ERRO_REDE), não ficha corrompida", ok: r6a.lookupStatus === "ERRO_REDE", detalhe: `status=${r6a.lookupStatus}` });
    checks.push({ nome: "6a: mensagem registra a causa do parse", ok: /json|JSON|token|Unexpected|inesperado/i.test(r6a.lookupError ?? ""), detalhe: `lookupError="${r6a.lookupError}"` });
    checks.push({ nome: "6a: nenhuma ficha gravada (sem dado inventado)", ok: !r6a.legalName && !r6a.rawJson, detalhe: `legalName=${r6a.legalName} rawJson=${r6a.rawJson ? "presente" : "null"}` });
    const tel6a = await telemetriaDe(C6A);
    checks.push({ nome: "6a: 12 tentativas telemetradas (3 rodadas × 4 fontes — parse falho não marca backoff) com estadoFinal=falha", ok: tel6a.length === 12 && tel6a.every((t) => t.estadoFinal === "falha"), detalhe: `${tel6a.length} eventos; estados=${tel6a.map((t) => t.estadoFinal).join(",")}` });
    limparBackoffFontes();
    HUMOR.delete(C6A);
    setHumorUnico(C6A, { tipo: "ficha", ficha: fichaBrasilAPI(C6A, "SEIS A RECUPERADO LTDA") });
    const rr6a = await retryPOST(req(`http://localhost:3000/api/imports/${b6a}/rows/1/retry`, "POST"), { params: Promise.resolve({ id: b6a, rowNumber: "1" }) });
    await esperarLote(b6a);
    const r6aRec = await linhaDe(b6a, 1);
    checks.push({ nome: "6a: retry aceito e recuperação funciona (fonte volta ao JSON válido)", ok: rr6a.status === 200 && r6aRec.lookupStatus === "ENRIQUECIDO" && r6aRec.legalName === "SEIS A RECUPERADO LTDA", detalhe: `retry_http=${rr6a.status} status=${r6aRec.lookupStatus} razao=${r6aRec.legalName}` });

    limparBackoffFontes();
    HUMOR.delete(C6B);
    setHumorUnico(C6B, { tipo: "ficha", ficha: { resultado: [], aviso: "objeto sem razao_social" } });
    const b6b = await novoLoteTexto("c6b", [formatCnpj(C6B)]);
    await startBatch(b6b);
    await esperarLote(b6b);
    const r6b = await linhaDe(b6b, 1);
    checks.push({ nome: "6b: JSON de forma errada → ERRO_SERVIDOR com 'Resposta sem razao_social'", ok: r6b.lookupStatus === "ERRO_SERVIDOR" && /razao_social/i.test(r6b.lookupError ?? ""), detalhe: `status=${r6b.lookupStatus} lookupError="${r6b.lookupError}"` });

    registrar({ cenario: 6, titulo: "JSON inesperado — corpo não-JSON e JSON semanticamente inútil", feito, esperado, notas: "ACHADO G10-1 (baixo, PENDENTE): parse falho é classificado como ERRO_REDE (o catch de res.json() em fetchJson cai no bucket de falha de rede) e a mensagem é o erro bruto do parser — honesto, mas INVALID_RESPONSE seria mais preciso. Documentado, não corrigido (mudança de mapeamento de estado é material — afeta semântica de retry).", checks });
    metricas.push({ cenario: 6, batch_6a: b6a, status_6a: r6a.lookupStatus, lookupError_6a: r6a.lookupError, recuperado_6a: r6aRec.lookupStatus, status_6b: r6b.lookupStatus, lookupError_6b: r6b.lookupError });
    correcoes.push({
      id: "G10-2",
      severidade: "BAIXO",
      descricao:
        "Mensagem de pulo por backoff sempre mencionava 429: quando TODAS as fontes falham com 500 (ou timeout), o backoff de 10s/15s fazia as rodadas seguintes pularem as fontes e a última tentativa virava 'pulada: fonte em backoff por 429 recente' mesmo quando o backoff veio de 5xx/timeout. Estado final (RATE_LIMITED), retry e telemetria estavam corretos; apenas o texto era impreciso.",
      correcao:
        "src/lib/enrich/sources.ts: o mapa __cnpjSourceBackoff agora guarda {until, motivo} (429 | erro <status> | timeout) e as duas mensagens de 'pulada' citam motivoBackoff(fonte) — a causa REAL do cooldown. Semântica de estado/durações/errorType inalterada.",
      prova:
        "Cenários 2 e 3 deste script (regressão): todas as fontes 500 → lookupError final 'MinhaReceita: pulada: fonte em backoff por erro 500 recente'; todas em timeout → '... por timeout recente'; cenário 1 (429 real) segue '... por 429 recente'.",
    });
    achados.push({
      id: "G10-1",
      severidade: "BAIXO",
      descricao: "Fonte que responde 200 com corpo não-JSON é classificada como NETWORK_ERROR/ERRO_REDE (sources.ts fetchJson: o catch de res.json() cai no mesmo bucket da falha de rede) e a mensagem é o erro bruto do parser (ex.: 'Unexpected token < in JSON...'). Estado, retry e recuperação estão corretos; apenas classificação/legibilidade ficam abaixo do ideal (INVALID_RESPONSE seria mais preciso).",
      repro: "bun scripts/test-homolog-falhas-recuperacao.ts — cenário 6a: todas as fontes 200 com '<html>manutencao</html>' → linha ERRO_REDE com lookupError de parser.",
    });
  }

  /* ---------- Cenário 7: resposta atrasada ---------- */
  {
    const feito =
      "7a: TODAS as fontes demoram 9s (teto do motor é 8s) e honram o AbortSignal como o fetch real — o 'pacote' tardio ainda chega ao transporte às 9s, depois de a linha já ter seguido (3 rodadas automáticas × 4 fontes). " +
      "7b: linha ENRIQUECIDO com ficha válida; revalidação com TODAS as fontes em 500 — o write de fracasso da revalidação é REVERTIDO pelo snapshot (ficha anterior restaurada).";
    const esperado =
      "7a: linha vira TIMEOUT em ~8s por fonte (~96s com as 3 rodadas); os 12 pacotes tardios são ENTREGUES pelo transporte e NUNCA consumidos (json() não chamado) — o estado final permanece TIMEOUT, sem ficha tardia sobrescrevendo nada; retry disponível. " +
      "7b: rota responde 502 REVALIDACAO_FALHOU com detalhe, a linha VOLTA a ENRIQUECIDO com a ficha ANTERIOR byte-a-byte e a auditoria REVALIDACAO_FALHOU registra ficha_anterior_preservada.";
    const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
    console.log("\n  [C7] Resposta atrasada — resposta tardia não sobrescreve estado mais novo");

    limparBackoffFontes();
    respostasTardias.entregues = 0;
    respostasTardias.consumidas = 0;
    HUMOR.delete(C7);
    setHumorUnico(C7, { tipo: "atrasada", ficha: fichaBrasilAPI(C7, "TARDIA NUNCA DEVE APARECER LTDA"), delayMs: 9000 });
    const b7 = await novoLoteTexto("c7", [formatCnpj(C7)]);
    const t7 = Date.now();
    await startBatch(b7);
    await esperarLote(b7, 180_000);
    const duracao = Date.now() - t7;
    await aguardarTelemetria();
    await sleep(3000); // espera os 4 pacotes tardios chegarem ao transporte
    const r7 = await linhaDe(b7, 1);
    checks.push({ nome: "7a: linha TIMEOUT (abort aos 8s POR FONTE, 3 rodadas — não esperou os 9s de nenhuma)", ok: r7.lookupStatus === "TIMEOUT" && duracao >= 88_000 && duracao < 115_000, detalhe: `status=${r7.lookupStatus} duracao_lote=${duracao}ms` });
    checks.push({ nome: "7a: pacotes tardios ENTREGUES pelo transporte (12) e DESCARTADOS (json() nunca chamado)", ok: respostasTardias.entregues === 12 && respostasTardias.consumidas === 0, detalhe: `entregues=${respostasTardias.entregues} consumidas=${respostasTardias.consumidas}` });
    checks.push({ nome: "7a: ficha tardia NÃO aplicada (sem razão social; mensagem de timeout preservada)", ok: !r7.legalName && /Timeout após 8s/.test(r7.lookupError ?? ""), detalhe: `legalName=${r7.legalName} lookupError="${r7.lookupError}"` });
    const r7depois = await linhaDe(b7, 1);
    checks.push({ nome: "7a: estado ESTÁVEL após a chegada tardia (nada foi sobrescrito)", ok: r7depois.lookupStatus === "TIMEOUT" && !r7depois.legalName, detalhe: `status=${r7depois.lookupStatus}` });
    const rr7 = await retryPOST(req(`http://localhost:3000/api/imports/${b7}/rows/1/retry`, "POST"), { params: Promise.resolve({ id: b7, rowNumber: "1" }) });
    checks.push({ nome: "7a: retry disponível para a linha que sofreu timeout", ok: rr7.status === 200, detalhe: `http=${rr7.status}` });

    // 7b — snapshot-restore da revalidação
    limparBackoffFontes();
    HUMOR.delete(C7R);
    setHumorUnico(C7R, { tipo: "ficha", ficha: fichaBrasilAPI(C7R, "SETE B FICHA VALIDA LTDA") });
    const b7b = await novoLoteTexto("c7b", [formatCnpj(C7R)]);
    await startBatch(b7b);
    await esperarLote(b7b);
    const antes = await linhaDe(b7b, 1);
    limparBackoffFontes();
    HUMOR.delete(C7R);
    setHumorUnico(C7R, { tipo: "status", status: 500 });
    const rv = await revalidatePOST(req(`http://localhost:3000/api/imports/${b7b}/rows/1/revalidate`, "POST"), { params: Promise.resolve({ id: b7b, rowNumber: "1" }) });
    const rvBody = (await rv.json()) as { ok?: boolean; error?: { code?: string; message?: string } };
    const depois = await linhaDe(b7b, 1);
    checks.push({ nome: "7b: revalidação sob falha responde 502 REVALIDACAO_FALHOU com mensagem que preserva a ficha", ok: rv.status === 502 && rvBody.error?.code === "REVALIDACAO_FALHOU" && /preservada/i.test(rvBody.error?.message ?? ""), detalhe: `http=${rv.status} code=${rvBody.error?.code} msg="${rvBody.error?.message}"` });
    checks.push({ nome: "7b: linha VOLTOU a ENRIQUECIDO (write de fracasso revertido pelo snapshot)", ok: depois.lookupStatus === "ENRIQUECIDO" && depois.lookupError === null, detalhe: `status=${depois.lookupStatus} lookupError=${depois.lookupError}` });
    checks.push({ nome: "7b: ficha anterior preservada byte-a-byte (razão, rawJson, coletadoEm)", ok: depois.legalName === antes.legalName && depois.rawJson === antes.rawJson && depois.collectedAt?.getTime() === antes.collectedAt?.getTime(), detalhe: `razao=${depois.legalName} rawJson_igual=${depois.rawJson === antes.rawJson} collectedAt_igual=${depois.collectedAt?.getTime() === antes.collectedAt?.getTime()}` });
    const audit7b = await auditorias(b7b);
    const revFail = audit7b.find((a) => a.event === "REVALIDACAO_FALHOU");
    checks.push({ nome: "7b: auditoria REVALIDACAO_FALHOU com ficha_anterior_preservada", ok: !!revFail && JSON.stringify(revFail.detail ?? "").includes("ficha_anterior_preservada"), detalhe: `payload=${String(revFail?.detail).slice(0, 160)}` });

    registrar({
      cenario: 7,
      titulo: "Resposta atrasada — guarda contra sobrescrita de estado mais novo",
      feito,
      esperado,
      notas:
        "O motor não mantém contador de geração por linha para HTTP: a proteção é COMPOSicional — (1) AbortController descarta a resposta tardia no transporte (fetchJson, TIMEOUT_MS=8s por fonte); (2) revalidarLinha tira SNAPSHOT antes e RESTAURA se a tentativa fracassar (v0.10.1 'ENDURECIDA'); (3) voo único evita comando concorrente duplicado; (4) lease/locks impedem dois workers na mesma linha. Cada linha tem runId próprio de telemetria (runWithTelemetry) — correlaciona, não serializa.",
      checks,
    });
    metricas.push({ cenario: 7, batch_7a: b7, duracao_lote_ms: duracao, pacotes_tardios: respostasTardias.entregues, consumidos: respostasTardias.consumidas, status_final_7a: r7.lookupStatus, batch_7b: b7b, revalidacao_http: rv.status, ficha_preservada: depois.legalName === antes.legalName });
  }

  /* ---------- Cenário 8: comando duplicado (duplo clique) ---------- */
  {
    const feito =
      "Três provas de voo único (src/lib/single-flight.ts): (8a) unitário — dois emVooUnico concorrentes; (8b) integração — dois lookupCnpjComCache concorrentes para o MESMO CNPJ sem cache; (8c) rota — dois POST /relacoes-societarias concorrentes para a MESMA linha.";
    const esperado =
      "8a: tarefa executada 1×, ambos recebem o MESMO valor, exatamente 1 líder; chave liberada ao final (comando sequencial seguinte executa de novo). " +
      "8b: cadeia de fontes executada 1× (1 fetch ao BrasilAPI), ficha cadastral gravada 1×, telemetria de coleta 1×. " +
      "8c: 1 fetch ao grafo para o alvo (+1 /updated compartilhado), ambas as respostas 200 ok, telemetria via=consulta E via=coalescido, cache de relações 1×.";
    const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
    console.log("\n  [C8] Comando duplicado — single-flight em 3 níveis");

    let execucoes = 0;
    const tarefa = async () => {
      execucoes++;
      await sleep(150);
      return { valor: "resultado-unico" };
    };
    const [a1, a2] = await Promise.all([emVooUnico("gate10:unit", tarefa), emVooUnico("gate10:unit", tarefa)]);
    checks.push({ nome: "8a: tarefa executada EXATAMENTE 1× sob dois chamadores concorrentes", ok: execucoes === 1, detalhe: `execucoes=${execucoes}` });
    checks.push({ nome: "8a: ambos recebem o mesmo valor; exatamente 1 líder e 1 seguidor", ok: a1.valor.valor === a2.valor.valor && a1.valor.valor === "resultado-unico" && a1.lider !== a2.lider, detalhe: `valor=${JSON.stringify(a1.valor)}/${JSON.stringify(a2.valor)} lider1=${a1.lider} lider2=${a2.lider}` });
    const a3 = await emVooUnico("gate10:unit", tarefa);
    checks.push({ nome: "8a: chave liberada ao final (comando SEQUENCIAL seguinte executa de novo — sem cache negativa)", ok: execucoes === 2 && a3.lider, detalhe: `execucoes=${execucoes} lider3=${a3.lider}` });

    limparBackoffFontes();
    HUMOR.delete(C8A);
    addHumor(C8A, { fonte: "BrasilAPI", humor: { tipo: "ficha", ficha: fichaBrasilAPI(C8A, "OITO B VOO UNICO LTDA") } });
    addHumor(C8A, { humor: { tipo: "status", status: 404 } });
    const [l1, l2] = await Promise.all([lookupCnpjComCache(C8A), lookupCnpjComCache(C8A)]);
    await aguardarTelemetria();
    const fetchesC8 = tentativasExternas.filter((u) => u.includes(C8A));
    const cacheC8 = await db.cadastroCache.count({ where: { cnpj: C8A } });
    const telC8 = await telemetriaDe(C8A);
    checks.push({ nome: "8b: dois lookups concorrentes → 1 ÚNICA saída para a fonte primária", ok: fetchesC8.length === 1, detalhe: `fetches=${fetchesC8.length}` });
    checks.push({ nome: "8b: ambos os chamadores receberam a MESMA ficha", ok: l1.resultado?.data.legalName === "OITO B VOO UNICO LTDA" && l2.resultado?.data.legalName === l1.resultado?.data.legalName, detalhe: `l1=${l1.resultado?.data.legalName} l2=${l2.resultado?.data.legalName}` });
    checks.push({ nome: "8b: ficha cadastral gravada 1×", ok: cacheC8 === 1, detalhe: `cadastroCache=${cacheC8}` });
    checks.push({ nome: "8b: telemetria de coleta gravada 1× (seguidor não duplica)", ok: telC8.filter((t) => t.estadoFinal === "sucesso").length === 1, detalhe: `eventos_sucesso=${telC8.filter((t) => t.estadoFinal === "sucesso").length}` });

    limparBackoffFontes();
    HUMOR.delete(C8C);
    setHumorUnico(C8C, { tipo: "ficha", ficha: fichaBrasilAPI(C8C, "OITO C RELACIONADA LTDA") });
    const PF_PART = "e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"; // hash 32-hex → PF (classificação por identificador)
    GRAFO[`/${C8C}`] = [{ id: PF_PART, nome: "SOCIO COMUM SIMULADO" }];
    GRAFO["/updated"] = { max_updated: "2026-10-23" };
    const b8c = await novoLoteTexto("c8c", [formatCnpj(C8C)]);
    await startBatch(b8c);
    await esperarLote(b8c);
    GRAFO_TENTATIVAS.length = 0;
    const ctx = { params: Promise.resolve({ id: b8c, rowNumber: "1" }) };
    const [res1, res2] = await Promise.all([
      relacoesPOST(req(`http://localhost:3000/api/imports/${b8c}/rows/1/relacoes-societarias`, "POST"), ctx),
      relacoesPOST(req(`http://localhost:3000/api/imports/${b8c}/rows/1/relacoes-societarias`, "POST"), ctx),
    ]);
    await aguardarTelemetria();
    const j1 = (await res1.json()) as { ok?: boolean; relacoes?: { via?: string; totalParticipantes?: number } };
    const j2 = (await res2.json()) as { ok?: boolean; relacoes?: { via?: string; totalParticipantes?: number } };
    const alvoFetches = GRAFO_TENTATIVAS.filter((p) => p === `/${C8C}`);
    const updatedFetches = GRAFO_TENTATIVAS.filter((p) => p === "/updated");
    const telRel = await db.telemetryEvent.findMany({ where: { tipo: "RELACAO_GRAFO", alvo: C8C } });
    const vias = telRel.map((t) => (t.payloadJson ? (JSON.parse(t.payloadJson) as { via?: string }).via : "?"));
    const cacheRel = await db.relacaoSocietariaCache.count({ where: { cnpj: C8C } });
    checks.push({ nome: "8c: duplo clique → EXATAMENTE 1 consulta ao grafo para o alvo", ok: alvoFetches.length === 1, detalhe: `fetches_alvo=${alvoFetches.length}` });
    checks.push({ nome: "8c: /updated compartilhado entre as duas requisições (1 fetch)", ok: updatedFetches.length === 1, detalhe: `fetches_updated=${updatedFetches.length}` });
    checks.push({ nome: "8c: AMBAS as respostas 200 ok com o mesmo resultado", ok: res1.status === 200 && res2.status === 200 && j1.ok === true && j2.ok === true && j1.relacoes?.totalParticipantes === j2.relacoes?.totalParticipantes, detalhe: `http=${res1.status}/${res2.status} participantes=${j1.relacoes?.totalParticipantes}/${j2.relacoes?.totalParticipantes}` });
    checks.push({ nome: "8c: telemetria distingue líder (via=consulta) de seguidor (via=coalescido)", ok: vias.sort().join(",") === "coalescido,consulta", detalhe: `vias=${vias.join(",")}` });
    checks.push({ nome: "8c: cache de relações gravada 1×", ok: cacheRel === 1, detalhe: `relacaoCache=${cacheRel}` });

    registrar({ cenario: 8, titulo: "Comando duplicado (duplo clique) — voo único por chave", feito, esperado, notas: "A reserva do voo é atômica com a decisão (registro no mesmo tick — zero janela de corrida em JS single-thread). Sem cache negativa: após falha, o comando seguinte executa de novo (honesto).", checks });
    metricas.push({ cenario: 8, unit_execucoes: execucoes, fetches_cadastro: fetchesC8.length, fetches_grafo_alvo: alvoFetches.length, vias_telemetria: vias, caches: { cadastro: cacheC8, relacoes: cacheRel } });
  }

  /* ---------- Cenário 10: lote interrompido → "Concluir pendências" ---------- */
  {
    const feito =
      "Lote com 3 linhas simulando pós-crash (por update direto no banco, como na missão): linha 1 ENRIQUECIDO (dado concluído, SEM cache cadastral), linha 2 RATE_LIMITED com retryCount=1 (falha reprocessável), linha 3 PENDENTE; lote PARTIAL. Comando 'Concluir pendências' (POST /process) disparado DUAS vezes concorrentes (duplo clique).";
    const esperado =
      "Retomada processa SOMENTE as linhas 2 e 3 — a linha concluída NÃO é reconsultada (0 fetch para o CNPJ dela; queriedAt/collectedAt intocados; nenhum evento novo na auditoria dela); do comando duplo, exatamente 1 started + 1 already_running; auditoria íntegra (1× PROCESS_START da retomada, 2× LOOKUP_OK novos, 1× PROCESS_END); lote termina DONE com totalEnriched=3.";
    const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
    console.log("\n  [C10] Lote interrompido — Concluir pendências retoma só o que falta");

    limparBackoffFontes();
    HUMOR.delete(C10_OK); // SEM regra para o CNPJ concluído: qualquer reconsulta viraria 404 visível
    HUMOR.delete(C10_F1);
    setHumorUnico(C10_F1, { tipo: "ficha", ficha: fichaBrasilAPI(C10_F1, "DEZ FALHA RETOMADA LTDA") });
    HUMOR.delete(C10_P1);
    setHumorUnico(C10_P1, { tipo: "ficha", ficha: fichaBrasilAPI(C10_P1, "DEZ PENDENTE RETOMADA LTDA") });
    const b10 = await novoLoteTexto("c10", [formatCnpj(C10_OK), formatCnpj(C10_F1), formatCnpj(C10_P1)]);

    // estado pós-crash por update direto (missão: "via direct DB update with prisma in a script")
    const agora10 = new Date();
    const l1seed = await linhaDe(b10, 1);
    await db.importRow.update({
      where: { id: l1seed.id },
      data: {
        lookupStatus: "ENRIQUECIDO", lookupError: null, legalName: "DEZ CONCLUIDA ANTES LTDA", source: "BrasilAPI",
        normalizedCnpj: C10_OK, queriedAt: agora10, collectedAt: agora10, retryCount: 0,
        extraJson: JSON.stringify({ email: "antes@concluida.com" }),
      },
    });
    const l2seed = await linhaDe(b10, 2);
    await db.importRow.update({ where: { id: l2seed.id }, data: { lookupStatus: "RATE_LIMITED", lookupError: "BrasilAPI: 429 — limite de requisições; fonte em backoff", retryCount: 1, source: "BrasilAPI", normalizedCnpj: C10_F1 } });
    await db.importBatch.update({ where: { id: b10 }, data: { status: "PARTIAL", finishedAt: null } });
    const concluidaAntes = await linhaDe(b10, 1);
    const fetchesAntes = tentativasExternas.filter((u) => u.includes(C10_OK)).length;

    const ctx10 = { params: Promise.resolve({ id: b10 }) };
    const [p1, p2] = await Promise.all([
      processPOST(req(`http://localhost:3000/api/imports/${b10}/process`, "POST"), ctx10),
      processPOST(req(`http://localhost:3000/api/imports/${b10}/process`, "POST"), ctx10),
    ]);
    const j1 = (await p1.json()) as { started?: boolean; reason?: string | null };
    const j2 = (await p2.json()) as { started?: boolean; reason?: string | null };
    checks.push({ nome: "duplo comando concorrente: exatamente 1 started + 1 already_running (idempotente)", ok: [j1.started, j2.started].filter(Boolean).length === 1 && [j1.reason, j2.reason].includes("already_running"), detalhe: `r1=${JSON.stringify(j1)} r2=${JSON.stringify(j2)}` });
    await esperarLote(b10);
    await aguardarTelemetria();

    const l1d = await linhaDe(b10, 1);
    const l2d = await linhaDe(b10, 2);
    const l3d = await linhaDe(b10, 3);
    const lote10 = await db.importBatch.findUnique({ where: { id: b10 } });
    const fetchesDepois = tentativasExternas.filter((u) => u.includes(C10_OK)).length;
    const audits10 = await auditorias(b10);
    const conta = (type: string, rowNumber?: number) => audits10.filter((a) => a.event === type && (rowNumber === undefined || a.rowNumber === rowNumber)).length;
    checks.push({ nome: "linha concluída NÃO retrabalhada (0 novas consultas; ficha e coleta intactas)", ok: fetchesDepois === fetchesAntes && l1d.queriedAt?.getTime() === concluidaAntes.queriedAt?.getTime() && l1d.legalName === "DEZ CONCLUIDA ANTES LTDA", detalhe: `fetches ${fetchesAntes}→${fetchesDepois}; queriedAt ${concluidaAntes.queriedAt?.toISOString()} → ${l1d.queriedAt?.toISOString()}` });
    checks.push({ nome: "falha reprocessável retomada e resolvida (RATE_LIMITED → ENRIQUECIDO)", ok: l2d.lookupStatus === "ENRIQUECIDO" && l2d.legalName === "DEZ FALHA RETOMADA LTDA", detalhe: `status=${l2d.lookupStatus} razao=${l2d.legalName}` });
    checks.push({ nome: "pendente retomado e resolvido (PENDENTE → ENRIQUECIDO)", ok: l3d.lookupStatus === "ENRIQUECIDO" && l3d.legalName === "DEZ PENDENTE RETOMADA LTDA", detalhe: `status=${l3d.lookupStatus} razao=${l3d.legalName}` });
    checks.push({ nome: "lote termina DONE com contadores coerentes (3 enriquecidas)", ok: lote10?.status === "DONE" && lote10.totalEnriched === 3, detalhe: `status=${lote10?.status} totalEnriched=${lote10?.totalEnriched}` });
    checks.push({ nome: "auditoria íntegra: 1× PROCESS_START e 1× PROCESS_END da RETOMADA (nenhum duplicado)", ok: conta("PROCESS_START") === 1 && conta("PROCESS_END") === 1, detalhe: `PROCESS_START=${conta("PROCESS_START")} PROCESS_END=${conta("PROCESS_END")}` });
    checks.push({ nome: "auditoria da retomada: 2× LOOKUP_OK novos (linhas 2 e 3), ZERO para a linha concluída", ok: conta("LOOKUP_OK") === 2 && conta("LOOKUP_OK", 1) === 0 && conta("LOOKUP_OK", 2) === 1 && conta("LOOKUP_OK", 3) === 1, detalhe: `LOOKUP_OK total=${conta("LOOKUP_OK")} l1=${conta("LOOKUP_OK", 1)} l2=${conta("LOOKUP_OK", 2)} l3=${conta("LOOKUP_OK", 3)}` });
    checks.push({ nome: "auditoria da retomada: 2× LOOKUP_START (linhas 2 e 3), ZERO para a linha concluída", ok: conta("LOOKUP_START", 1) === 0 && conta("LOOKUP_START") === 2, detalhe: `LOOKUP_START=${conta("LOOKUP_START")} l1=${conta("LOOKUP_START", 1)}` });

    registrar({ cenario: 10, titulo: "Lote interrompido — Concluir pendências retoma só o que falta", feito, esperado, notas: "O botão 'Concluir pendências' chama POST /process → startBatch → runBatch seleciona APENAS lookupStatus ∈ RETRYABLE com retryCount<3 (a linha ENRIQUECIDO nunca entra). O duplo clique concorrente é absorvido pelo claim de lease + lock em memória (1 started, 1 already_running).", checks });
    metricas.push({ cenario: 10, batchId: b10, status_final: lote10?.status, totalEnriched: lote10?.totalEnriched, fetches_linha_concluida: `${fetchesAntes}→${fetchesDepois}` });
  }

  /* ---------- Cenário 11: falha na exportação no meio ---------- */
  {
    const feito =
      "Exportações com dados que quebram a geração: (11a) headerJson corrompido (lança na 1ª linha de processamento); (11b) originalCellsJson corrompido (lança no MEIO da montagem, por linha); (11c) recusa de volume (pdf_lote com 320 linhas > limite 300); (11d) lote inexistente; contraste saudável; conferência do diretório download/.";
    const esperado =
      "Todo erro de exportação é JSON com ok:false + error.code + error.message (nunca 200 com corpo parcial); NUNCA há content-disposition attachment em resposta de erro; o corpo de erro não contém mágica de arquivo (BOM CSV/PK zip/%PDF); nenhum arquivo parcial persistido em download/.";
    const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
    console.log("\n  [C11] Falha na exportação no meio — nada parcial/corrompido servido");

    // lote saudável de contraste
    limparBackoffFontes();
    HUMOR.delete(C11_OK);
    setHumorUnico(C11_OK, { tipo: "ficha", ficha: fichaBrasilAPI(C11_OK, "ONZE SAUDAVEL LTDA") });
    const b11 = await novoLoteTexto("c11", [formatCnpj(C11_OK)]);
    await startBatch(b11);
    await esperarLote(b11);

    // 11d — lote inexistente
    const r11d = await exportGET(req(`http://localhost:3000/api/imports/inexistente-gate10/export?type=result`, "GET"), { params: Promise.resolve({ id: "inexistente-gate10" }) });
    const j11d = (await r11d.json()) as { ok?: boolean; error?: { code?: string; message?: string } };
    checks.push({ nome: "11d: lote inexistente → 404 JSON com code+message", ok: r11d.status === 404 && j11d.ok === false && j11d.error?.code === "NOT_FOUND" && !!j11d.error?.message, detalhe: `http=${r11d.status} code=${j11d.error?.code}` });
    checks.push({ nome: "11d: resposta de erro SEM content-disposition (não é download)", ok: !r11d.headers.get("content-disposition"), detalhe: `content-disposition=${r11d.headers.get("content-disposition")}` });

    // 11a — headerJson corrompido (quebra ANTES de montar corpo)
    const b11a = await novoLoteTexto("c11a", [formatCnpj(C11_OK)]);
    await startBatch(b11a);
    await esperarLote(b11a);
    await db.importBatch.update({ where: { id: b11a }, data: { headerJson: "{corrompido" } });
    const r11a = await exportGET(req(`http://localhost:3000/api/imports/${b11a}/export?type=result`, "GET"), { params: Promise.resolve({ id: b11a }) });
    const txt11a = await r11a.text();
    const j11a = (() => { try { return JSON.parse(txt11a) as { ok?: boolean; error?: { code?: string; message?: string } }; } catch { return null; } })();
    checks.push({ nome: "11a: header corrompido → 500 JSON {ok:false, error.code=INTERNAL, error.message}", ok: r11a.status === 500 && j11a?.ok === false && j11a?.error?.code === "INTERNAL" && !!j11a?.error?.message, detalhe: `http=${r11a.status} corpo=${txt11a.slice(0, 140)}` });
    checks.push({ nome: "11a: sem attachment, sem BOM CSV, sem mágica zip/PDF no corpo do erro", ok: !r11a.headers.get("content-disposition") && !txt11a.startsWith("﻿") && !txt11a.startsWith("PK") && !txt11a.startsWith("%PDF"), detalhe: `cd=${r11a.headers.get("content-disposition")} inicio=${JSON.stringify(txt11a.slice(0, 12))}` });
    const ct11a = r11a.headers.get("content-type") ?? "";
    checks.push({ nome: "11a: content-type application/json", ok: ct11a.includes("application/json"), detalhe: `content-type=${ct11a}` });

    // 11b — célula original corrompida (quebra no MEIO da montagem, por linha)
    const b11b = await novoLoteTexto("c11b", [formatCnpj(C11_OK)]);
    await startBatch(b11b);
    await esperarLote(b11b);
    const lb11b = await linhaDe(b11b, 1);
    await db.importRow.update({ where: { id: lb11b.id }, data: { originalCellsJson: "{nao-e-array" } });
    const r11b = await exportGET(req(`http://localhost:3000/api/imports/${b11b}/export?type=result`, "GET"), { params: Promise.resolve({ id: b11b }) });
    const txt11b = await r11b.text();
    const j11b = (() => { try { return JSON.parse(txt11b) as { ok?: boolean; error?: { code?: string } }; } catch { return null; } })();
    checks.push({ nome: "11b: célula corrompida → 500 JSON (fail500) sem corpo parcial", ok: r11b.status === 500 && j11b?.ok === false && j11b?.error?.code === "INTERNAL", detalhe: `http=${r11b.status} code=${j11b?.error?.code}` });

    // 11c — recusa de volume ANTES de gerar (pdf_lote acima do limite 300)
    const linhas320 = Array.from({ length: 320 }, (_, i) => formatCnpj(cnpjValido(`88882${String(i).padStart(3, "0")}`)));
    const c11c = await novoLoteTexto("c11c", linhas320);
    await db.importBatch.update({ where: { id: c11c }, data: { status: "DONE" } });
    const r11c = await exportGET(req(`http://localhost:3000/api/imports/${c11c}/export?type=pdf_lote`, "GET"), { params: Promise.resolve({ id: c11c }) });
    const j11c = (await r11c.json()) as { ok?: boolean; error?: { code?: string; message?: string; orientacao?: string } };
    checks.push({ nome: "11c: PDF acima do limite → 413 com code+message+orientação (recusa ANTES, nunca doc incompleto)", ok: r11c.status === 413 && j11c.ok === false && j11c.error?.code === "PDF_LIMITE" && /Excel/.test(j11c.error?.orientacao ?? ""), detalhe: `http=${r11c.status} code=${j11c.error?.code} orientacao=${j11c.error?.orientacao}` });
    checks.push({ nome: "11c: recusa é JSON (nenhum byte de PDF servido)", ok: (r11c.headers.get("content-type") ?? "").includes("application/json") && !r11c.headers.get("content-disposition"), detalhe: `content-type=${r11c.headers.get("content-type")}` });

    // contraste: exportação saudável do lote saudável
    const r11ok = await exportGET(req(`http://localhost:3000/api/imports/${b11}/export?type=result`, "GET"), { params: Promise.resolve({ id: b11 }) });
    checks.push({ nome: "contraste: exportação saudável segue 200 com attachment (CSV completo)", ok: r11ok.status === 200 && !!r11ok.headers.get("content-disposition"), detalhe: `http=${r11ok.status} cd=${r11ok.headers.get("content-disposition")?.slice(0, 40)}` });

    // nenhum arquivo parcial em disco (exportação é buffer em memória)
    const downloadDir = join(process.cwd(), "download");
    const arquivosDownload = execSync(`ls -1 "${downloadDir}" 2>/dev/null | grep -v '^README.md$' | wc -l`).toString().trim();
    checks.push({ nome: "nenhum arquivo parcial deixado em download/ (só o README pré-existente)", ok: arquivosDownload === "0", detalhe: `arquivos=${arquivosDownload}` });

    registrar({ cenario: 11, titulo: "Falha na exportação no meio — erros são JSON, nada parcial servido", feito, esperado, notas: "A exportação monta o arquivo INTEIRO em memória antes de responder (new NextResponse(new Uint8Array(buf))) — não existe stream que possa ser cortado no meio; toda exceção cai no fail500 → JSON com code/message. A recusa de volume (PDF_LIMITE) acontece ANTES de gerar. Observação: exportações FALHADAS não geram evento de auditoria EXPORT (só as bem-sucedidas) — lacuna de rastreio registrada como nota, não como bug bloqueante.", checks });
    metricas.push({ cenario: 11, http: { inexistente: r11d.status, header_corrompido: r11a.status, celula_corrompida: r11b.status, pdf_limite: r11c.status, saudavel: r11ok.status }, arquivos_download: arquivosDownload });
  }

  /* ---------- Cenário 9 (pré-prova in-process): claim atômico do sweep ---------- */
  {
    const checks: { nome: string; ok: boolean; detalhe: string }[] = [];
    console.log("\n  [C9-pre] Claim atômico do sweep (in-process) — 2 sweeps concorrentes, 1 retomada");
    limparBackoffFontes();
    HUMOR.delete(C9PRE);
    setHumorUnico(C9PRE, { tipo: "ficha", ficha: fichaBrasilAPI(C9PRE, "NOVE PRE SWEEP LTDA") });
    const b9pre = await novoLoteTexto("c9pre", [formatCnpj(C9PRE)]);
    await startBatch(b9pre);
    await esperarLote(b9pre);
    // estado zumbi: lote PROCESSING com lease EXPIRADO e linha CONSULTANDO sem executor
    await db.importBatch.update({ where: { id: b9pre }, data: { status: "PROCESSING", leaseOwner: "zombie-gate10", leaseExpiresAt: new Date(Date.now() - 120_000), finishedAt: null } });
    const linha9 = await linhaDe(b9pre, 1);
    await db.importRow.update({ where: { id: linha9.id }, data: { lookupStatus: "CONSULTANDO" } });
    const [s1, s2] = await Promise.all([sweepStalled(), sweepStalled()]);
    const retomadas = s1.resumed.length + s2.resumed.length;
    checks.push({ nome: "dois sweeps concorrentes → exatamente UMA retomada (claim atômico do lease)", ok: retomadas === 1, detalhe: `retomadas=${retomadas} (s1=${s1.resumed.length}, s2=${s2.resumed.length})` });
    await esperarLote(b9pre);
    const l9 = await linhaDe(b9pre, 1);
    const b9 = await db.importBatch.findUnique({ where: { id: b9pre } });
    checks.push({ nome: "linha zumbi (CONSULTANDO sem executor) reprocessada → estado coerente", ok: l9.lookupStatus === "ENRIQUECIDO" && b9?.status !== "PROCESSING", detalhe: `linha=${l9.lookupStatus} lote=${b9?.status}` });
    const audit9 = await auditorias(b9pre);
    checks.push({ nome: "auditoria registra RECOVERY_RESUME da retomada", ok: audit9.some((a) => a.event === "RECOVERY_RESUME"), detalhe: `tipos=${audit9.map((a) => a.event).join(",")}` });
    registrar({ cenario: 9, titulo: "Sweep de recuperação — claim atômico e linha zumbi (PRÉ-PROVA in-process; prova REAL com restart do dev server no script live)", feito: "Lote PROCESSING com lease EXPIRADO (leaseOwner=zombie) e linha CONSULTANDO sem executor; dois sweepStalled() concorrentes; leitura de linha/lote/auditoria.", esperado: "Exatamente 1 retomada entre os dois sweeps (claim atômico via updateMany condicional); linha zumbi reprocessada para estado coerente; auditoria RECOVERY_RESUME.", notas: "A prova REAL (restart do processo dev com o lote zumbi no banco vivo) está em scripts/gate10-live-restart.ts e é mergeada neste relatório.", checks });
    metricas.push({ cenario: 9, fase: "in-process", retomadas, status_final_lote: b9?.status, linha_final: l9.lookupStatus });
  }

  /* ---------- prova estrutural ---------- */
  const externas = tentativasExternas.filter((u) => !/^https:\/\/(brasilapi\.com\.br|api\.opencnpj\.org|receitaws\.com\.br|minhareceita\.org|grafo\.minhareceita\.org|servicodados\.ibge\.gov\.br)\//.test(u));
  check("PROVA ESTRUTURAL: ZERO chamadas HTTP reais (toda saída atendida pelo simulador)", externas.length === 0, `suspeitas=${externas.join(" | ")}`);

  /* ---------- consolidação ---------- */
  const duracaoTotal = Date.now() - t0;
  const passTotal = todosChecks.filter((c) => c.ok).length;
  const failTotal = todosChecks.filter((c) => !c.ok).length;
  console.log(`\n=== RESULTADO SCRIPT ISOLADO: ${passTotal} PASS · ${failTotal} FAIL (${duracaoTotal}ms) ===`);

  const relatorio = {
    missao: "HOMOLOG-D3 — Gate 10: testes de falha e recuperação (12 cenários do contrato v0.11.0)",
    parte: "script isolado (cenários 1–8, 10, 11 + pré-9 in-process)",
    banco: DB_ISOLADO,
    zero_http_real: externas.length === 0,
    saidas_simuladas: tentativasExternas.length,
    duracaoMs: duracaoTotal,
    pass: passTotal,
    fail: failTotal,
    falhas,
    correcoes,
    achados,
    metricas,
    cenarios: resultados,
    cenarios_ao_vivo: "cenário 9 (restart real do dev server) e 12 (prefs UI) — executados por scripts/gate10-live-restart.ts e mergeados neste arquivo",
  };
  await Bun.write(join(EVID_DIR, "relatorio.json"), JSON.stringify(relatorio, null, 2));

  const linhas: string[] = [];
  linhas.push("=== GATE 10 — FALHAS E RECUPERAÇÃO (HOMOLOG-D3) — PARTE 1: script isolado (cenários 1–8, 10, 11 + pré-9) ===");
  linhas.push(`Executado em: ${new Date().toISOString()}`);
  linhas.push(`Banco isolado: ${DB_ISOLADO} (db/custom.db intocado por esta parte; banco /tmp removido ao final)`);
  linhas.push(`Zero HTTP real: ${externas.length === 0 ? "SIM (toda saída atendida pelo simulador)" : `NÃO — ${externas.join(" | ")}`} — ${tentativasExternas.length} saídas simuladas`);
  linhas.push("");
  for (const r of resultados) {
    linhas.push(`C${r.cenario} · ${r.titulo}`);
    linhas.push(`  FEITO: ${r.feito}`);
    linhas.push(`  ESPERADO: ${r.esperado}`);
    linhas.push(`  VEREDITO: ${r.veredito}`);
    for (const c of r.checks) linhas.push(`    [${c.ok ? "PASS" : "FAIL"}] ${c.nome}${c.ok ? (c.detalhe ? ` — ${c.detalhe}` : "") : ` — ${c.detalhe}`}`);
    linhas.push(`  NOTAS: ${r.notas}`);
    linhas.push("");
  }
  if (correcoes.length > 0) {
    linhas.push("CORREÇÕES APLICADAS NESTE GATE (bugs pequenos e prováveis — fix + teste de regressão):");
    for (const c of correcoes) linhas.push(`  ${c.id} [${c.severidade}] ${c.descricao}\n    CORREÇÃO: ${c.correcao}\n    PROVA: ${c.prova}`);
    linhas.push("");
  }
  if (achados.length > 0) {
    linhas.push("ACHADOS DOCUMENTADOS (não corrigidos — mudança material, fica como pendente):");
    for (const a of achados) linhas.push(`  ${a.id} [${a.severidade}] ${a.descricao}\n    REPRO: ${a.repro}`);
    linhas.push("");
  }
  linhas.push(`TOTAL (parte script): ${passTotal} PASS · ${failTotal} FAIL em ${duracaoTotal}ms`);
  await Bun.write(join(EVID_DIR, "relatorio.txt"), linhas.join("\n") + "\n");

  exitCode = failTotal > 0 ? 1 : 0;
} catch (e) {
  console.error("✘✘ ERRO FATAL:", e);
  exitCode = 1;
} finally {
  globalThis.fetch = fetchOriginal;
  for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
}
process.exit(exitCode);
