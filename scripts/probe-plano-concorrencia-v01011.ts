/**
 * probe-plano-concorrencia-v01011.ts — FRENTE 5 (despacho piloto comercial).
 *
 * Investiga e mede o gargalo registrado na v0.10.10: rota do planejador com
 * p95 ≈ 6,5s sob 20 requisições concorrentes (degradação ~12× vs solo).
 *
 * Metodologia (idêntica à v0.10.10 para comparabilidade antes/depois):
 *  - lote SINTÉTICO semeado direto no banco (sem consulta externa — o plano é
 *    leitura local por construção: gate ia:0/busca:0);
 *  - 1 medição solo (frio) + 3 ondas × 20 GET /api/imports/:id/plano;
 *  - p50/p95 por onda, vazão, igualdade de resposta, zero 5xx;
 *  - PROVA DE INVALIDAÇÃO: mutação de fato (linha ign.) → plano regenerado
 *    reflete a mudança (cache nunca devolve retrato velho);
 *  - limpeza total do lote ao final. exit 1 em qualquer divergência.
 *
 * Saída: qa/estresse-v0.10.11/plano-concorrencia.json
 */
const BASE = "http://localhost:3000";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(desc: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS ${desc}`); }
  else { fail++; falhas.push(desc); console.log(`  FAIL ${desc}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 160)}` : ""}`); }
}

const pXX = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// CNPJs sintéticos com DV válido (raiz 77772000+ — reservados para provas)
function cnpjValido(raiz: string, filial = "0001"): string {
  const base = `${raiz}${filial}`;
  const calc = (d: number[]): number => {
    let soma = 0;
    let peso = d.length - 7;
    for (const dig of d) {
      soma += dig * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const digitos = base.split("").map(Number);
  const d1 = calc(digitos);
  const d2 = calc([...digitos, d1]);
  return `${base}${d1}${d2}`;
}

const N_ROWS = 30;
const MARCA = "teste-v01011-plano-concorrencia.csv";
let batchId: string | null = null;

try {
  console.log("=== SONDA v0.10.11 — PLANEJADOR SOB CONCORRÊNCIA (antes/depois) ===");

  /* ---------- saneamento + semente ---------- */
  const velhos = await db.importBatch.findMany({ where: { fileName: MARCA }, select: { id: true } });
  for (const b of velhos) {
    await db.auditEvent.deleteMany({ where: { batchId: b.id } });
    await db.importBatch.delete({ where: { id: b.id } }).catch(() => {});
  }
  await db.telemetryEvent.deleteMany({ where: { alvo: { startsWith: "77772" }, tipo: { in: ["RELACAO_GRAFO", "DESCOBERTA_ROOT", "COLETA_CADASTRO"] } } });
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { startsWith: "77772" } } });
  await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: { startsWith: "77772" } } });

  const agora = new Date();
  const batch = await db.importBatch.create({
    data: { fileName: MARCA, storedPath: `qa/${MARCA}`, fileSize: 64, rowCount: N_ROWS, totalValid: N_ROWS, status: "DONE" },
  });
  batchId = batch.id;
  await db.importRow.createMany({
    data: Array.from({ length: N_ROWS }, (_, i) => ({
      batchId: batch.id,
      rowNumber: i + 1,
      lookupKind: "CNPJ",
      lookupStatus: "ENRIQUECIDO",
      normalizedCnpj: cnpjValido(`777720${String(i).padStart(2, "0")}`),
      legalName: `Sonda Concorrência ${i + 1} LTDA`,
      registrationStatus: "ATIVA",
      branchType: "MATRIZ",
      originalCellsJson: "[]",
      collectedAt: agora,
      queriedAt: agora,
    })),
  });
  console.log(`Lote semeado: ${batch.id} (${N_ROWS} linhas ENRIQUECIDO, sem caches — lacunas de relações)`);

  /* ---------- 1) medição SOLO (frio) ---------- */
  let soloMs = 0;
  {
    const ini = Date.now();
    const res = await fetch(`${BASE}/api/imports/${batchId}/plano`);
    const corpo = await res.json() as { ok?: boolean; plano?: { resumo?: { itens?: number } } };
    soloMs = Date.now() - ini;
    check("solo 200", res.status === 200, res.status);
    check(`solo gera plano completo (${2 * N_ROWS} itens: relações + estabelecimentos por raiz)`, corpo.plano?.resumo?.itens === 2 * N_ROWS, corpo.plano?.resumo?.itens);
    console.log(`  solo (frio): ${soloMs}ms`);
  }

  /* ---------- 2) ondas concorrentes 20 × 3 ---------- */
  const ONDAS = 3, POR_ONDA = 20;
  const porOnda: { p50: number; p95: number; ms: number }[] = [];
  let falhas5xx = 0;
  const itensVistos = new Set<number>();
  const totalLat: number[] = [];
  for (let o = 0; o < ONDAS; o++) {
    const lat: number[] = [];
    const ini = Date.now();
    const resultados = await Promise.all(Array.from({ length: POR_ONDA }, async () => {
      const i = Date.now();
      try {
        const res = await fetch(`${BASE}/api/imports/${batchId}/plano`);
        const corpo = await res.json() as { plano?: { resumo?: { itens?: number } } };
        lat.push(Date.now() - i);
        if (res.status !== 200) { falhas5xx++; return false; }
        itensVistos.add(corpo.plano?.resumo?.itens ?? -1);
        return true;
      } catch { falhas5xx++; return false; }
    }));
    const ms = Date.now() - ini;
    totalLat.push(...lat);
    porOnda.push({ p50: pXX(lat, 50), p95: pXX(lat, 95), ms });
    console.log(`  onda ${o + 1}: p50 ${porOnda[o].p50}ms · p95 ${porOnda[o].p95}ms · onda ${ms}ms · ok=${resultados.filter(Boolean).length}/${POR_ONDA}`);
  }
  const vazao = (ONDAS * POR_ONDA) / (totalLat.length ? 1 : 1) * 0 + (ONDAS * POR_ONDA) / (porOnda.reduce((s, o) => s + o.ms, 0) / 1000);
  check("zero 5xx nas ondas", falhas5xx === 0, falhas5xx);
  check("resposta idêntica para todos os pedidos (itens consistentes)", itensVistos.size === 1 && itensVistos.has(2 * N_ROWS), [...itensVistos]);
  const p95max = Math.max(...porOnda.map((o) => o.p95));
  console.log(`  p95 máx entre ondas: ${p95max}ms · vazão média: ${vazao.toFixed(1)} req/s · degradação vs solo: ${(p95max / Math.max(1, soloMs)).toFixed(1)}×`);

  /* ---------- 3) PROVA DE INVALIDAÇÃO — fato muda, plano reflete ---------- */
  {
    const row = await db.importRow.findFirst({ where: { batchId: batchId!, rowNumber: 1 }, select: { id: true } });
    await db.importRow.update({ where: { id: row!.id }, data: { lookupStatus: "IGNORADO" } });
    const res = await fetch(`${BASE}/api/imports/${batchId}/plano`);
    const corpo = await res.json() as { plano?: { resumo?: { itens?: number } } };
    check("após mutação, plano NÃO é retrato velho (invalidação correta)", res.status === 200 && corpo.plano?.resumo?.itens === 2 * (N_ROWS - 1), corpo.plano?.resumo?.itens);
    await db.importRow.update({ where: { id: row!.id }, data: { lookupStatus: "ENRIQUECIDO" } });
    const res2 = await fetch(`${BASE}/api/imports/${batchId}/plano`);
    const corpo2 = await res2.json() as { plano?: { resumo?: { itens?: number } } };
    check("revertida a mutação, plano volta a listar todas", res2.status === 200 && corpo2.plano?.resumo?.itens === 2 * N_ROWS, corpo2.plano?.resumo?.itens);
  }

  /* ---------- 4) gate: zero chamada externa na rota ---------- */
  {
    const telemetriaAntes = await db.telemetryEvent.count({ where: { batchId: batchId! } });
    await fetch(`${BASE}/api/imports/${batchId}/plano`);
    const telemetriaDepois = await db.telemetryEvent.count({ where: { batchId: batchId! } });
    check("gerar plano = zero evento de fonte externa (leitura local)", telemetriaDepois === telemetriaAntes, `${telemetriaAntes}→${telemetriaDepois}`);
  }

  /* ---------- resultado ---------- */
  const resultado = {
    rodada: "v0.10.11 — investigação do gargalo do planejador",
    data: new Date().toISOString(),
    lote: batchId,
    linhas: N_ROWS,
    solo_ms: soloMs,
    ondas: porOnda,
    p95_max_ms: p95max,
    degradacao_vs_solo: Number((p95max / Math.max(1, soloMs)).toFixed(2)),
    vazao_req_s: Number(vazao.toFixed(2)),
    falhas_5xx: falhas5xx,
    checks: { pass, fail },
    falhas,
  };
  const { mkdirSync, writeFileSync } = await import("fs");
  mkdirSync("qa/estresse-v0.10.11", { recursive: true });
  writeFileSync("qa/estresse-v0.10.11/plano-concorrencia.json", JSON.stringify(resultado, null, 2));
  console.log(`\nSONDA: ${pass} PASS · ${fail} FAIL → qa/estresse-v0.10.11/plano-concorrencia.json`);
  if (fail > 0) process.exit(1);
} finally {
  /* ---------- limpeza ---------- */
  if (batchId) {
    await db.auditEvent.deleteMany({ where: { batchId } });
    await db.importRow.deleteMany({ where: { batchId } });
    await db.importBatch.delete({ where: { id: batchId } }).catch(() => {});
  }
  await db.$disconnect();
}
