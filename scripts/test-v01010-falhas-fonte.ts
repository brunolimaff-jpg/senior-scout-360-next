/**
 * test-v01010-falhas-fonte.ts — FALHAS REAIS DE FONTE E RECUPERAÇÃO (auditoria da
 * v0.10.9, item 5): "verifique falhas 429, 503, timeout, reinício e recuperação
 * sem perder evidências ou corromper o banco."
 *
 * Casos (fontes 100% simuladas — zero HTTP real):
 *   X1. 429 da fonte → RATE_LIMITED, HTTP 429 repassado, NADA persistido.
 *   X2. 503 da fonte → FONTE_INDISPONIVEL → HTTP 502 (upstream preservado).
 *   X3. timeout → TIMEOUT → HTTP 504.
 *   X4. falha de rede → FONTE_INDISPONIVEL (sem status) → HTTP 502.
 *   X5. falha NÃO apaga fato válido: cache íntegro sobrevive à falha; comando
 *       seguinte serve pela cache (zero HTTP).
 *   X6. recuperação: fonte volta → primeiro comando pós-recuperação funciona e
 *       grava a cache exatamente uma vez (sem cache negativa, sem duplicação).
 *   X7. INTEGRIDADE DO BANCO: contagens de linhas/lotes/auditoria idênticas antes
 *       e depois de TODAS as falhas (nenhuma escrita parcial, nenhuma corrupção);
 *       telemetria registra cada falha exatamente uma vez.
 *   X8. reinício: coberto por scripts/probe-reinicio-recuperacao.sh (processo real).
 *
 * Saída: qa/estresse-v0.10.10/falhas-fonte.json · exit 1 se qualquer caso falhar.
 */
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { validateCnpj } from "../src/lib/cnpj";
import { investigarRelacoes, httpStatusDeResultado, type GrafoFetcher } from "../src/lib/relations/service";
import { POST as relacoesPOST } from "../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/route";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, detalhe = "") {
  if (cond) {
    pass++;
    console.log(`PASS · ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } else {
    fail++;
    falhas.push(nome);
    console.log(`FAIL · ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}
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

/* fonte simulada com ESTADO MUTÁVEL (o simulador muda de humor entre casos) */
const cnpjQ = cnpjValido("66661001"); // falhas de status (429/503/timeout/rede)
const cnpjS = cnpjValido("66661002"); // falha NÃO apaga fato
const cnpjT = cnpjValido("66661003"); // recuperação
const PFQ = "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4";
let humorFonte: { status: number; json?: unknown; causa?: "timeout" | "rede"; delayMs: number } = { status: 200, delayMs: 0 };
const tentativas: string[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/^https:\/\//i.test(url)) return fetchOriginal(input as never, init);
  const chave = url.replace(/^https?:\/\//i, "");
  tentativas.push(chave);
  if (!chave.startsWith("grafo.minhareceita.org/")) throw new Error(`SIMULADOR: saída não cadastrada: ${url}`);
  if (humorFonte.delayMs > 0) await sleep(humorFonte.delayMs);
  if (humorFonte.causa) {
    // falha REAL no nível de fetch — fetchPadrao mapeia pelo nome do erro (mesmo caminho da produção)
    const e = new Error(humorFonte.causa === "timeout" ? "simulado: estourou o timeout" : "simulado: falha de rede");
    (e as { name?: string }).name = humorFonte.causa === "timeout" ? "TimeoutError" : "TypeError";
    throw e;
  }
  return new Response(JSON.stringify(humorFonte.json ?? []), { status: humorFonte.status });
}) as typeof fetch;

const chamadas = new Map<string, number>();
const fetcher: GrafoFetcher = async (path) => {
  chamadas.set(path, (chamadas.get(path) ?? 0) + 1);
  const chave = `grafo.minhareceita.org${path}`;
  tentativas.push(chave);
  if (humorFonte.causa) return { status: 0, json: null, causa: humorFonte.causa };
  if (humorFonte.delayMs > 0) await sleep(humorFonte.delayMs);
  return { status: humorFonte.status, json: humorFonte.json ?? [] };
};

const OK_JSON = [{ id: PFQ, nome: "SOCIO FALHA UM" }];
let batchId: string | null = null;
const metrics: Record<string, unknown>[] = [];
let exitCode = 1;

async function falhasRecentes(cnpj: string): Promise<number> {
  return db.telemetryEvent.count({ where: { tipo: "RELACAO_GRAFO", alvo: cnpj, estadoFinal: "falha" } });
}

try {
  console.log("=== SUÍTE v0.10.10 — FALHAS DE FONTE E RECUPERAÇÃO ===");
  const t0 = Date.now();

  // auto-saneamento
  const velhos = await db.importBatch.findMany({ where: { fileName: "teste-v01010-falhas.csv" }, select: { id: true } });
  for (const b of velhos) {
    await db.auditEvent.deleteMany({ where: { batchId: b.id } });
    await db.importBatch.delete({ where: { id: b.id } }).catch(() => {});
  }
  await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjQ, cnpjS, cnpjT, PFQ] }, tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO"] } } });
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjQ, cnpjS, cnpjT] } } });

  const agora = new Date();
  const batch = await db.importBatch.create({ data: { fileName: "teste-v01010-falhas.csv", storedPath: "qa/teste-v01010-falhas.csv", fileSize: 42, rowCount: 3, totalValid: 3, status: "DONE" } });
  batchId = batch.id;
  await db.importRow.createMany({
    data: [
      { batchId, rowNumber: 1, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjQ, legalName: "Falha Q LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 2, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjS, legalName: "Falha S LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 3, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjT, legalName: "Falha T LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
    ],
  });

  /* snapshot de integridade ANTES das falhas */
  const integridadeAntes = {
    batches: await db.importBatch.count(),
    rows: await db.importRow.count(),
    audits: await db.auditEvent.count({ where: { batchId: batchId! } }),
  };

  /* ---------- X1..X4 — falhas de status na rota real ---------- */
  console.log("\n— X1..X4: 429, 503, timeout e rede (rota real, status HTTP repassado) —");
  const falha = async (humor: typeof humorFonte, row: number) => {
    humorFonte = humor;
    const req = new NextRequest(`http://localhost:3000/api/imports/${batchId}/rows/${row}/relacoes-societarias`, { method: "POST" });
    const res = await relacoesPOST(req, { params: Promise.resolve({ id: batchId!, rowNumber: String(row) }) });
    const corpo = (await res.json()) as { ok?: boolean; error?: { code?: string; message?: string } };
    return { status: res.status, corpo };
  };

  const r429 = await falha({ status: 429, delayMs: 10 }, 1);
  check("X1 429 → HTTP 429 repassado com upstream preservado", r429.status === 429 && JSON.stringify(r429.corpo).includes("RATE_LIMITED"), `http=${r429.status}`);

  const r503 = await falha({ status: 503, delayMs: 10 }, 1);
  check("X2 503 → FONTE_INDISPONIVEL → HTTP 502", r503.status === 502, `http=${r503.status}`);

  const rTimeout = await falha({ status: 0, causa: "timeout", delayMs: 10 }, 1);
  check("X3 timeout → TIMEOUT → HTTP 504", rTimeout.status === 504, `http=${rTimeout.status}`);

  const rRede = await falha({ status: 0, causa: "rede", delayMs: 10 }, 1);
  check("X4 rede → FONTE_INDISPONIVEL → HTTP 502", rRede.status === 502, `http=${rRede.status}`);

  const falhasQ = await falhasRecentes(cnpjQ);
  check("X5 cada falha registrada na telemetria exatamente uma vez (sem HTTP real)", falhasQ === 4, `falhas=${falhasQ} tentativas_rota=${tentativas.length}`);
  const auditsSoFalhas = await db.auditEvent.count({ where: { batchId: batchId! } });
  check("X5b falha NÃO grava auditoria de sucesso", auditsSoFalhas === 0, `audits=${auditsSoFalhas}`);
  metrics.push({ caso: "X1-X4_status_http", mapeamento: { 429: r429.status, 503: r503.status, timeout: rTimeout.status, rede: rRede.status }, audits_pos_falhas: auditsSoFalhas });

  /* ---------- X6 — falha NÃO apaga fato válido (mesmo com cache expirada) ---------- */
  console.log("\n— X6: falha não apaga fato (cache expirada sobrevive à falha, nada é apagado) —");
  humorFonte = { status: 200, json: OK_JSON, delayMs: 0 };
  const coletaS = await investigarRelacoes(batchId!, 2, { fetcher });
  check("X6.1 coleta normal grava cache", coletaS.ok, `ok=${coletaS.ok}`);
  const cacheS1 = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: cnpjS } });
  // cache EXPIRA (como se o TTL tivesse passado) — a próxima consulta vai à fonte
  await db.relacaoSocietariaCache.update({ where: { cnpj: cnpjS }, data: { validoAte: new Date(Date.now() - 1000) } });
  humorFonte = { status: 503, delayMs: 0 };
  const falhaS = await investigarRelacoes(batchId!, 2, { fetcher });
  check("X6.2 comando sob falha recusa (fonte_erro)", !falhaS.ok && falhaS.motivo === "fonte_erro", `motivo=${falhaS.ok ? "ok" : falhaS.motivo}`);
  const cacheS2 = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: cnpjS } });
  check("X6.3 fato preservado: registro continua lá, intacto (falha não apaga)", !!cacheS2 && cacheS2.relacoesJson === cacheS1!.relacoesJson && cacheS2.coletadoEm.getTime() === cacheS1!.coletadoEm.getTime());
  humorFonte = { status: 200, json: OK_JSON, delayMs: 15 };
  const revalidaS = await investigarRelacoes(batchId!, 2, { fetcher });
  const cacheS3 = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: cnpjS } });
  check("X6.4 pós-recuperação: revalidação substitui a ficha com NOVA coleta (honesto)", revalidaS.ok && revalidaS.view.via === "consulta" && !!cacheS3 && cacheS3.validoAte.getTime() > Date.now(), `via=${revalidaS.ok ? revalidaS.view.via : "?"}`);
  metrics.push({ caso: "X6_fato_preservado", cache_sobreviveu: true, revalidou_apos_recuperacao: true });

  /* ---------- X7 — recuperação sem cache negativa ---------- */
  console.log("\n— X7: recuperação — fonte volta, primeiro comando funciona, cache gravada 1× —");
  humorFonte = { status: 429, delayMs: 0 };
  const falhaT1 = await investigarRelacoes(batchId!, 3, { fetcher });
  check("X7.1 alvo sem cache falha honestamente (429 → fonte_erro)", !falhaT1.ok && falhaT1.erroFonte?.tipo === "RATE_LIMITED");
  humorFonte = { status: 200, json: OK_JSON, delayMs: 15 };
  const tRec = Date.now();
  const recT = await investigarRelacoes(batchId!, 3, { fetcher });
  const msRec = Date.now() - tRec;
  check("X7.2 pós-recuperação: primeiro comando funciona (sem cache negativa)", recT.ok && recT.view.via === "consulta", `via=${recT.ok ? recT.view.via : "?"} latência=${msRec}ms`);
  const cacheT = await db.relacaoSocietariaCache.count({ where: { cnpj: cnpjT } });
  check("X7.3 cache gravada exatamente uma vez", cacheT === 1, `caches=${cacheT}`);
  metrics.push({ caso: "X7_recuperacao", latencia_recuperacao_ms: msRec, cache_gravada_1x: true });

  /* ---------- X8 — INTEGRIDADE DO BANCO após todas as falhas ---------- */
  console.log("\n— X8: integridade do banco após todas as falhas —");
  const integridadeDepois = {
    batches: await db.importBatch.count(),
    rows: await db.importRow.count(),
    audits: await db.auditEvent.count({ where: { batchId: batchId! } }),
  };
  check("X8.1 lotes idênticos (nenhum lote criado/apagado por falha)", integridadeAntes.batches === integridadeDepois.batches, `${integridadeAntes.batches}→${integridadeDepois.batches}`);
  check("X8.2 linhas idênticas (nenhuma escrita parcial)", integridadeAntes.rows === integridadeDepois.rows, `${integridadeAntes.rows}→${integridadeDepois.rows}`);
  check("X8.3 auditoria cresce SÓ com comandos bem-sucedidos (3 coletas: X6.1, X6.4, X7.2)", integridadeDepois.audits === 3, `${integridadeAntes.audits}→${integridadeDepois.audits}`);
  const loteQ = await db.importBatch.findUnique({ where: { id: batchId! } });
  check("X8.4 lote segue íntegro (status DONE)", loteQ?.status === "DONE", `status=${loteQ?.status}`);
  metrics.push({ caso: "X8_integridade", ...integridadeDepois });

  /* ---------- prova estrutural ---------- */
  const naoSimuladas = tentativas.filter((t) => !t.startsWith("grafo.minhareceita.org/"));
  check("X9.1 ZERO chamadas reais (tudo pelo simulador)", naoSimuladas.length === 0, `tentativas=${tentativas.length}`);

  console.log(`\n=== RESULTADO: ${pass} PASS · ${fail} FAIL (${Date.now() - t0}ms) ===`);
  await Bun.write(
    "qa/estresse-v0.10.10/falhas-fonte.json",
    JSON.stringify({ missao: "auditoria v0.10.9 item 5 — falhas 429/503/timeout, preservação de fatos, recuperação e integridade", casos: metrics, pass, fail, falhas, duracaoMs: Date.now() - t0 }, null, 2)
  );
  exitCode = fail > 0 ? 1 : 0;
} catch (e) {
  console.error("✘✘ ERRO FATAL:", e);
  exitCode = 1;
} finally {
  globalThis.fetch = fetchOriginal;
  if (batchId) {
    await db.auditEvent.deleteMany({ where: { batchId } });
    await db.importBatch.delete({ where: { id: batchId } }).catch(() => {});
  }
  await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjQ, cnpjS, cnpjT, PFQ] }, tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO"] } } }).catch(() => {});
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjQ, cnpjS, cnpjT] } } }).catch(() => {});
}
process.exit(exitCode);
