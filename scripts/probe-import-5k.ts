/**
 * probe-import-5k.ts — Sonda de carga de importação com ASSERTS (v0.10.10).
 *
 * Correção da falha apontada pela auditoria da v0.10.9: a versão anterior
 * calculava esperados mas NUNCA comparava — terminava `exit(0)` mesmo com
 * divergência ("teste PASS só porque o script terminou sem erro"). Agora:
 *
 *   1. QUALQUER divergência de quantidade, estado ou invariante → lista de
 *      divergências impressa e `exit(1)`. PASS exige zero divergência.
 *   2. Tamanho parametrizado (100 / 1.000 / 5.000) para carga PROGRESSIVA:
 *      a progressão é dada pelo orquestrador — cada degrau só roda depois do
 *      anterior ter saído 0 (scripts/estresse-carga-progressiva.sh).
 *   3. Invariantes provados, não presumidos:
 *        - linhas gravadas == linhas do CSV (nada perdido, nada inventado);
 *        - VALIDA == 60% (CNPJ sintéticos únicos, DV correto), REFERENCIA == 40%
 *          (20% só nome, 10% só site, 10% só e-mail) — SEM ambiguidade de dedupe
 *          (gerador determinístico por raiz sequencial, raízes todas distintas);
 *        - INVALIDA == 0, SEM_CNPJ == 0, DUPLICADA == 0;
 *        - todo VALIDA com CNPJ normalizado de 14 dígitos e DV válido;
 *        - toda REFERENCIA com pista (referenceValue) registrada;
 *        - lookupStatus: VALIDA/REFERENCIA → EM_FILA; nenhum IGNORADO indevido;
 *        - ZERO eventos de fonte externa na telemetria do banco temporário
 *          (a camada determinística não faz HTTP por construção — agora é provado);
 *        - lote termina PREVIEW não confirmado por engano / rowCount coerente.
 *
 * Executa contra um SQLite TEMPORÁRIO (/tmp/scout-probe-<n>.db) e NÃO faz NENHUMA
 * chamada externa. Nada disso entra no banco real de desenvolvimento.
 *
 * Uso:
 *   bun scripts/probe-import-5k.ts 100 | 1000 | 5000      (obrigatório)
 *   scripts/estresse-carga-progressiva.sh                  (orquestra a progressão)
 */

const TAMANHO = Number(process.argv[2] ?? "0");
if (![100, 1000, 5000].includes(TAMANHO)) {
  console.error("ERRO: informe o tamanho do degrau — bun scripts/probe-import-5k.ts 100|1000|5000");
  process.exit(2);
}

process.env.DATABASE_URL = `file:/tmp/scout-probe-${TAMANHO}.db`;

const T0 = Date.now();
const mem = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
const since = (t: number) => Date.now() - t;

/* banco TEMPORÁRIO começa vazio — aplica o schema ANTES de qualquer uso */
{
  const proc = Bun.spawnSync(["bunx", "prisma", "db", "push", "--accept-data-loss", "--skip-generate"], {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    console.error(`ERRO: falha ao aplicar schema no banco temporário (${process.env.DATABASE_URL}):`);
    console.error(new TextDecoder().decode(proc.stderr).slice(0, 800));
    process.exit(2);
  }
  console.log(`Schema aplicado no banco temporário: ${process.env.DATABASE_URL}`);
}

/* --------- gerador determinístico de CNPJs válidos, ÚNICOS (raiz sequencial) --------- */
function cnpjCheck(base: string): string {
  const calc = (digits: string, weights: number[]): number => {
    const sum = digits.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base + String(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base + d1 + d2;
}

/* --------- composição realista do lote sintético (mesmas proporções da v0.10.9) --------- */
const TOTAL = TAMANHO;
const N_VALIDOS = Math.floor(TOTAL * 0.6); // 60% com CNPJ
const N_NOME = Math.floor(TOTAL * 0.2); // 20% só nome
const N_SITE = Math.floor(TOTAL * 0.1); // 10% só site
const N_EMAIL = TOTAL - N_VALIDOS - N_NOME - N_SITE; // 10% só e-mail (resto exato)

const linhas: string[] = ["cnpj;nome;site;email"];
for (let i = 0; i < TOTAL; i++) {
  const nome = `EMPRESA SINTETICA ${String(i).padStart(6, "0")} LTDA`;
  if (i < N_VALIDOS) {
    // raiz sequencial ÚNICA → ZERO duplicatas por construção (dedupe não é ambíguo)
    const cnpj = cnpjCheck(String(i).padStart(8, "0") + "0001");
    linhas.push(`${cnpj};${nome};;contato@sintetica${i}.com.br`);
  } else if (i < N_VALIDOS + N_NOME) linhas.push(`;${nome};;`);
  else if (i < N_VALIDOS + N_NOME + N_SITE) linhas.push(`;${nome};sintetica${i}.com.br;`);
  else linhas.push(`;${nome};;contato@sintetica${i}.com.br`);
}
const csv = linhas.join("\n") + "\n";
const csvPath = `/tmp/probe-${TOTAL}.csv`;
await Bun.write(csvPath, csv);
console.log(`CSV sintético: ${TOTAL} linhas (${N_VALIDOS} CNPJ + ${N_NOME} nome + ${N_SITE} site + ${N_EMAIL} email), ${(csv.length / 1024).toFixed(0)} KB → ${csvPath} (rss ${mem()}MB)`);

/* --------- importa dinamicamente com env já definido --------- */
const { db } = await import("@/lib/db");
const { parseStoredFile, confirmBatch } = await import("@/lib/enrich/engine");
const { validateCnpj } = await import("@/lib/cnpj");

const batchId = `probe_${TOTAL}_${Date.now().toString(36)}`;
const tIns = Date.now();
await db.importBatch.create({
  data: { id: batchId, fileName: `probe-${TOTAL}.csv`, storedPath: csvPath, fileSize: csv.length, sourceType: "CSV", status: "PREVIEW", rowCount: TOTAL },
});
console.log(`ImportBatch PREVIEW criado: ${since(tIns)}ms (banco temporário: ${process.env.DATABASE_URL})`);

/* amostrador de pico de RSS durante as fases pesadas */
let rssPico = mem();
const amostrador = setInterval(() => {
  rssPico = Math.max(rssPico, mem());
}, 25);
const pararAmostrador = () => clearInterval(amostrador);

/* FASE 1 — parse */
let t = Date.now();
const parsed = await parseStoredFile(csvPath);
const parseMs = since(t);
console.log(`FASE parse: ${parseMs}ms | linhas=${parsed.rows.length - 1} | delimitador="${parsed.delimiter}" | encoding=${parsed.encoding} (rss ${mem()}MB)`);

/* FASE 2 — confirm (validação+dedupe+gravação) — SEM IA, SEM processo externo */
t = Date.now();
const outcome = await confirmBatch(batchId, 0, true, false);
const confirmMs = since(t);
console.log(`FASE confirm: ${confirmMs}ms | ok=${outcome.ok}${outcome.error ? ` | erro=${outcome.error}` : ""}`);

/* FASE 3 — contagens no temp db */
t = Date.now();
const byStatus = await db.importRow.groupBy({ by: ["cnpjStatus"], where: { batchId }, _count: { _all: true } });
const byLookup = await db.importRow.groupBy({ by: ["lookupStatus"], where: { batchId }, _count: { _all: true } });
const countsMs = since(t);
const total = await db.importRow.count({ where: { batchId } });
pararAmostrador();

const contagem = (arr: { cnpjStatus?: string; lookupStatus?: string; _count: { _all: number } }[], k: string) =>
  arr.find((s) => (s.cnpjStatus ?? s.lookupStatus) === k)?._count._all ?? 0;

const esperados = {
  total: TOTAL,
  VALIDA: N_VALIDOS,
  REFERENCIA: N_NOME + N_SITE + N_EMAIL,
  INVALIDA: 0,
  SEM_CNPJ: 0,
  DUPLICADA: 0,
  EM_FILA: N_VALIDOS + N_NOME + N_SITE + N_EMAIL,
  IGNORADO: 0,
};

/* --------- ASSERTS — divergência ANY ⇒ exit(1). Nunca mais "PASS por terminar". --------- */
const divergencias: string[] = [];
function exigir(nome: string, real: number | boolean, esperado: number | boolean): void {
  const ok = real === esperado;
  if (!ok) divergencias.push(`${nome}: real=${real} esperado=${esperado}`);
  console.log(`${ok ? "ASSERT OK" : "ASSERT FAIL"} · ${nome}: real=${real} esperado=${esperado}`);
}

exigir("confirm.ok", outcome.ok, true);
exigir("linhas_parseadas", parsed.rows.length - 1, TOTAL);
exigir("importRow.total", total, esperados.total);
exigir("cnpjStatus.VALIDA", contagem(byStatus as never, "VALIDA"), esperados.VALIDA);
exigir("cnpjStatus.REFERENCIA", contagem(byStatus as never, "REFERENCIA"), esperados.REFERENCIA);
exigir("cnpjStatus.INVALIDA", contagem(byStatus as never, "INVALIDA"), esperados.INVALIDA);
exigir("cnpjStatus.SEM_CNPJ", contagem(byStatus as never, "SEM_CNPJ"), esperados.SEM_CNPJ);
exigir("cnpjStatus.DUPLICADA", contagem(byStatus as never, "DUPLICADA"), esperados.DUPLICADA);
exigir("lookupStatus.EM_FILA", contagem(byLookup as never, "EM_FILA"), esperados.EM_FILA);
exigir("lookupStatus.IGNORADO", contagem(byLookup as never, "IGNORADO"), esperados.IGNORADO);
exigir("batch.rowCount", (await db.importBatch.findUnique({ where: { id: batchId } }))?.rowCount ?? -1, TOTAL);

/* invariante: todo VALIDA tem CNPJ 14 dígitos com DV válido */
const validas = await db.importRow.findMany({
  where: { batchId, cnpjStatus: "VALIDA" },
  select: { normalizedCnpj: true, rowNumber: true },
});
let cnpjInvalidos = 0;
for (const v of validas) {
  if (!v.normalizedCnpj || !validateCnpj(v.normalizedCnpj).valid) cnpjInvalidos++;
}
exigir("invariante.VALIDA.com_cnpj_dv_valido", cnpjInvalidos, 0);

/* invariante: toda REFERENCIA tem pista registrada */
const refsSemPista = await db.importRow.count({ where: { batchId, cnpjStatus: "REFERENCIA", referenceValue: null } });
exigir("invariante.REFERENCIA.com_pista", refsSemPista, 0);

/* invariante: ZERO eventos de fonte externa — a camada determinística não consulta nada */
const eventosExternos = await db.telemetryEvent.count({
  where: { tipo: { in: ["COLETA_CADASTRO", "RELACAO_GRAFO", "RELACAO_EXPANSAO", "WEB_SEARCH", "PAGE_READER", "IA_CHAT", "IA_RESUMO"] } },
});
exigir("invariante.zero_chamadas_externas", eventosExternos, 0);

/* invariante: confirmBatch confirma o lote (contrato real: PREVIEW→CONFIRMED) */
exigir("invariante.lote_status_CONFIRMED", (await db.importBatch.findUnique({ where: { id: batchId } }))?.status ?? "X", "CONFIRMED");

/* --------- métricas de carga --------- */
const vazaoTotal = Number((TOTAL / (since(T0) / 1000)).toFixed(1));
const vazaoConfirm = Number((TOTAL / (confirmMs / 1000)).toFixed(1));
const resumo = {
  degrau: TOTAL,
  ok_para_progressao: divergencias.length === 0,
  composicao: { cnpj: N_VALIDOS, nome: N_NOME, site: N_SITE, email: N_EMAIL },
  real_por_status: byStatus.map((s) => ({ status: s.cnpjStatus, n: s._count._all })),
  real_por_lookup: byLookup.map((s) => ({ status: s.lookupStatus, n: s._count._all })),
  tempos_ms: { parse: parseMs, confirm: confirmMs, counts: countsMs, total_setup: since(T0) },
  vazao_linhas_por_segundo: { confirm: vazaoConfirm, total: vazaoTotal },
  memoria_rss_mb: { pico: rssPico, fim: mem() },
  divergencias,
  externas: eventosExternos,
  batchId,
  banco_temporario: process.env.DATABASE_URL,
};
console.log(`=== RESUMO ${TOTAL} (camada determinística, ${eventosExternos} chamadas externas) ===`);
console.log(JSON.stringify(resumo, null, 2));
await Bun.write(`/tmp/probe-import-${TOTAL}-resultado.json`, JSON.stringify({ ...resumo, linhas_csv: TOTAL }, null, 2));

if (divergencias.length > 0) {
  console.error(`✘✘ PROBE ${TOTAL} FALHOU — ${divergencias.length} divergência(s). Exit code 1.`);
  process.exit(1);
}
console.log(`✔ PROBE ${TOTAL} PASS — quantidades, estados e invariantes conferidos (não é "PASS por terminar").`);
process.exit(0);
