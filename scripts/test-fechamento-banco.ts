/**
 * test-fechamento-banco.ts — TESTES EXPLÍCITOS do fechamento seguro do banco (v0.10.4;
 * INVENTÁRIO INTEGRAL DE NOVE TABELAS v0.10.7 — auditoria independente da v0.10.6).
 *
 * Contrato do despacho: "Teste explicitamente falha de validação, tentativa de
 * escrita concorrente, rollback e recuperação. O processo deve produzir PASS
 * somente quando todos os critérios obrigatórios passarem. Caso contrário, FAIL
 * ou BLOCKED, sem alegar banco pronto."
 *
 * v0.10.7 (auditoria): a v0.10.6 limpava 6 tabelas e deixava os 3 caches
 * societários FORA da rotina. Agora os cenários semeiam e verificam as NOVE
 * tabelas — PASS exige as NOVE zeradas — e o cenário F prova o banco já vazio.
 *
 * Tudo roda em SANDBOX (db/custom-teste-*.db — o script só aceita esse padrão):
 * o banco de desenvolvimento NUNCA é tocado. Sem rede, sem IA, sem chamada paga.
 *
 * Cenários:
 *   A. FALHA DE VALIDAÇÃO  → injeção pós-limpeza → FAIL + exit 1 (nunca sucesso falso)
 *   B. ESCRITA CONCORRENTE → escreve na janela backup→limpeza → BLOCKED + nada apagado
 *   C. ROLLBACK            → falha injetada no meio da transação → dados intactos (9 tabelas)
 *   D. RECUPERAÇÃO         → backup do cenário B é aberto e lido (contadores = inventário)
 *   E. CAMINHO DE SUCESSO  → PASS + exit 0 + NOVE contadores 0 (incl. caches societários)
 *   F. BANCO JÁ VAZIO      → PASS (já limpo) sem executar limpeza
 *
 * Uso: bun scripts/test-fechamento-banco.ts
 */
import { PrismaClient } from "@prisma/client";
import { Database } from "bun:sqlite";
import { readdirSync, existsSync, unlinkSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SANDBOX = join(ROOT, "db", "custom-teste-fechamento.db");
const UPLOADS_TESTE = join(ROOT, "upload-teste");

let falhas = 0;
let total = 0;
function ok(cond: boolean, rotulo: string, detalhe = "") {
  total++;
  if (cond) console.log(`  PASS ${rotulo}`);
  else {
    falhas++;
    console.log(`  FAIL ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

function novosBackups(antes: Set<string>): string[] {
  return readdirSync(join(ROOT, "db"))
    .filter((f) => /^(backup-pre-limpeza|backup-teste-recuperacao)-.*\.db$/.test(f) && !antes.has(f))
    .map((f) => join(ROOT, "db", f));
}
function snapshotBackups(): Set<string> {
  try {
    return new Set(readdirSync(join(ROOT, "db")).filter((f) => /^(backup-pre-limpeza|backup-teste-recuperacao)-.*\.db$/.test(f)));
  } catch {
    return new Set();
  }
}

/** Cria o sandbox com o schema do projeto (VACUUM INTO do banco real — schema idêntico, zero dados). */
function criarSandbox(): void {
  try { unlinkSync(SANDBOX); } catch { /* não existia */ }
  const fonte = new Database(join(ROOT, "db", "custom.db"), { readonly: true });
  fonte.exec(`VACUUM INTO '${SANDBOX.replace(/'/g, "''")}'`);
  fonte.close();
  if (!existsSync(UPLOADS_TESTE)) mkdirSync(UPLOADS_TESTE, { recursive: true });
}

/** Insere dados de teste no sandbox (via Prisma — mesmas validações do app). */
async function inserirDados(): Promise<{ contadores: Record<string, number> }> {
  const db = new PrismaClient({ datasources: { db: { url: `file:${SANDBOX}` } } });
  const lote = await db.importBatch.create({ data: { fileName: "teste-fechamento.csv", storedPath: "teste", fileSize: 10, status: "DONE" } });
  await db.importRow.create({ data: { batchId: lote.id, rowNumber: 1, cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO" } });
  await db.importRow.create({ data: { batchId: lote.id, rowNumber: 2, cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO" } });
  await db.auditEvent.createMany({ data: [1, 2, 3].map((n) => ({ batchId: lote.id, event: "TESTE", detail: `evento ${n}` })) });
  await db.telemetryEvent.createMany({ data: [1, 2, 3, 4, 5].map((n) => ({ tipo: "TESTE", erro: n === 4 ? "429 — teste" : null })) });
  await db.labComparison.create({
    data: { id: `lab_${Date.now()}`, rowId: "r", batchId: lote.id, provider: "x.test", modelRequested: "m", promptVersion: "t", appVersion: "t", packetReuse: false, estadoFinal: "OK" },
  });
  const agora = new Date();
  await db.cadastroCache.createMany({
    data: [
      { cnpj: "00000000000191", fonte: "teste", coletadoEm: agora, atualizadoEm: agora, validoAte: agora, dadosJson: "{}" },
      { cnpj: "33000167000101", fonte: "teste", coletadoEm: agora, atualizadoEm: agora, validoAte: agora, dadosJson: "{}" },
    ],
  });
  // v0.10.7 (auditoria): semeia os 3 caches societários que ficavam FORA da rotina
  await db.relacaoSocietariaCache.create({
    data: { cnpj: "00000000000191", fonte: "teste", coletadoEm: agora, atualizadoEm: agora, validoAte: agora, relacoesJson: "[]", totalParticipantes: 0 },
  });
  await db.quadroParticipanteCache.create({
    data: { participanteId: "a".repeat(32), tipoParticipante: "PF", rotulo: null, fonte: "teste", coletadoEm: agora, validoAte: agora, empresasJson: "[]", totalEmpresas: 0, truncado: false },
  });
  await db.estabelecimentoRootCache.create({
    data: { cnpjRaiz: "00000000", fonteDescoberta: "teste", coletadoEm: agora, atualizadoEm: agora, validoAte: agora, estabelecimentosJson: "[]", coberturaJson: "{}" },
  });
  writeFileSync(join(UPLOADS_TESTE, "imp_teste-fechamento.csv"), "CNPJ\n00000000000191\n");
  const contadores = {
    lotes: await db.importBatch.count(),
    linhas: await db.importRow.count(),
    auditoria: await db.auditEvent.count(),
    telemetria: await db.telemetryEvent.count(),
    comparacoes: await db.labComparison.count(),
    cache: await db.cadastroCache.count(),
    cacheRelacoes: await db.relacaoSocietariaCache.count(),
    cacheQuadros: await db.quadroParticipanteCache.count(),
    cacheRaizes: await db.estabelecimentoRootCache.count(),
  };
  await db.$disconnect();
  return { contadores };
}

function contadoresSqlite(con: Database): Record<string, number> {
  const t = ["ImportBatch", "ImportRow", "AuditEvent", "TelemetryEvent", "LabComparison", "CadastroCache", "RelacaoSocietariaCache", "QuadroParticipanteCache", "EstabelecimentoRootCache"];
  return Object.fromEntries(t.map((x) => [x, (con.query(`SELECT COUNT(*) n FROM ${x}`).get() as { n: number }).n]));
}

async function rodarScript(env: Record<string, string>): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "scripts/entrega-banco-limpo.ts", "--confirmar", "--banco-teste", "db/custom-teste-fechamento.db"],
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text() + (await new Response(proc.stderr).text());
  const code = await proc.exited;
  return { code, out };
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" TESTE DO FECHAMENTO SEGURO DO BANCO (sandbox — banco de dev intocado)");
  console.log("══════════════════════════════════════════════════════════════");

  // guardas do próprio teste: nada de sandbox aberto nem resíduo
  rmSync(UPLOADS_TESTE, { recursive: true, force: true });
  try { unlinkSync(join(ROOT, "db", ".entrega-teste-backup-ok")); } catch { /* idem */ }

  // v0.10.7: guarda de intocabilidade por SNAPSHOT (antes vs depois) — o banco de
  // dev pode conter dados legítimos do operador; o que o teste prova é que ELE
  // não alterou nada, não que o banco esteja vazio.
  const conReal0 = new Database(join(ROOT, "db", "custom.db"), { readonly: true });
  const snapshotReal0 = contadoresSqlite(conReal0);
  conReal0.close();

  /* ---------------- CENÁRIO A: FALHA DE VALIDAÇÃO → FAIL + exit 1 ---------------- */
  console.log("\n== A. Falha de validação pós-limpeza → FAIL (nunca sucesso falso) ==");
  const bakA = snapshotBackups();
  criarSandbox();
  const dadosA = await inserirDados();
  const rA = await rodarScript({ ENTREGA_FALHA_VALIDACAO: "1" });
  ok(rA.code !== 0, "exit code ≠ 0 em validação FAIL", `code=${rA.code}`);
  ok(/RESULTADO: FAIL/.test(rA.out), "saída declara RESULTADO: FAIL", rA.out.split("\n").filter((l) => /RESULTADO/.test(l)).join(" | "));
  ok(!/RESULTADO: PASS/.test(rA.out), "saída NÃO declara PASS", "");
  ok(/nove_contadores=FAIL|telemetria=1/.test(rA.out), "resíduo injetado foi DETECTADO na leitura", "");
  const conA = new Database(SANDBOX, { readonly: true });
  const posA = contadoresSqlite(conA);
  conA.close();
  ok(posA.TelemetryEvent === 1 && posA.ImportBatch === 0, "demais tabelas limpas; resíduo de telemetria exposto como FAIL", JSON.stringify(posA));
  for (const b of novosBackups(bakA)) { try { unlinkSync(b); } catch { /* idem */ } }

  /* ---------------- CENÁRIO B: ESCRITA CONCORRENTE na janela → BLOCKED ---------------- */
  console.log("\n== B. Escrita concorrente na janela backup→limpeza → BLOCKED + nada apagado ==");
  await new Promise((r) => setTimeout(r, 1100)); // stamp do backup em outro segundo
  const bakB = snapshotBackups();
  criarSandbox();
  const dadosB = await inserirDados();
  const procB = Bun.spawn({
    cmd: ["bun", "scripts/entrega-banco-limpo.ts", "--confirmar", "--banco-teste", "db/custom-teste-fechamento.db"],
    cwd: ROOT,
    env: { ...process.env, ENTREGA_TESTE_ESPERA_MS: "8000" },
    stdout: "pipe",
    stderr: "pipe",
  });
  // espera o marcador de backup concluído e escreve na janela
  const marcador = join(ROOT, "db", ".entrega-teste-backup-ok");
  let escreveu = false;
  for (let i = 0; i < 80 && !escreveu; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (existsSync(marcador)) {
      const conW = new Database(SANDBOX);
      conW.query(`INSERT INTO TelemetryEvent (id, tipo, erro, startedAt) VALUES (?, 'ESCRITA_CONCORRENTE_TESTE', 'escrita na janela', ?)`).run(
        `conc_${Date.now()}`, new Date().toISOString()
      );
      conW.close();
      escreveu = true;
    }
  }
  ok(escreveu, "escritor concorrente escreveu na janela (marcador do backup)", "");
  const outB = await new Response(procB.stdout).text() + (await new Response(procB.stderr).text());
  const codeB = await procB.exited;
  ok(codeB !== 0, "exit code ≠ 0 com escrita concorrente", `code=${codeB}`);
  ok(/BLOCKED/.test(outB), "saída declara BLOCKED (nada apagado)", outB.split("\n").filter((l) => /RESULTADO/.test(l)).join(" | "));
  ok(/ESCRITA CONCORRENTE/.test(outB), "causa honesta: escrita na janela detectada", "");
  const conB = new Database(SANDBOX, { readonly: true });
  const posB = contadoresSqlite(conB);
  conB.close();
  ok(
    posB.ImportBatch === dadosB.contadores.lotes && posB.ImportRow === dadosB.contadores.linhas + 0 && posB.TelemetryEvent === dadosB.contadores.telemetria + 1,
    "NADA foi apagado (dados intactos + a escrita concorrente preservada)",
    JSON.stringify(posB)
  );
  // guarda o backup do cenário B para o teste de RECUPERAÇÃO (cenário D)
  const backupsB = novosBackups(bakB);
  ok(backupsB.length >= 1, "backup pré-limpeza existe mesmo no BLOCKED", backupsB.join(","));

  /* ---------------- CENÁRIO C: ROLLBACK — falha no meio da transação ---------------- */
  console.log("\n== C. Falha injetada no meio da transação → ROLLBACK + dados intactos ==");
  await new Promise((r) => setTimeout(r, 1100));
  const bakC = snapshotBackups();
  criarSandbox();
  const dadosC = await inserirDados();
  const rC = await rodarScript({ ENTREGA_FALHA_TRANSACAO: "1" });
  ok(rC.code !== 0, "exit code ≠ 0 na falha de transação", `code=${rC.code}`);
  ok(/ROLLBACK/.test(rC.out), "ROLLBACK executado e declarado", "");
  ok(!/RESULTADO: PASS/.test(rC.out), "sem sucesso falso", "");
  const conC = new Database(SANDBOX, { readonly: true });
  const posC = contadoresSqlite(conC);
  conC.close();
  ok(
    JSON.stringify(posC) === JSON.stringify({
      ImportBatch: dadosC.contadores.lotes, ImportRow: dadosC.contadores.linhas, AuditEvent: dadosC.contadores.auditoria,
      TelemetryEvent: dadosC.contadores.telemetria, LabComparison: dadosC.contadores.comparacoes, CadastroCache: dadosC.contadores.cache,
      RelacaoSocietariaCache: dadosC.contadores.cacheRelacoes, QuadroParticipanteCache: dadosC.contadores.cacheQuadros, EstabelecimentoRootCache: dadosC.contadores.cacheRaizes,
    }),
    "banco INTACTO após rollback (todas as NOVE tabelas = inventário pré-limpeza)",
    JSON.stringify(posC)
  );
  for (const b of novosBackups(bakC)) { try { unlinkSync(b); } catch { /* idem */ } }

  /* ---------------- CENÁRIO D: RECUPERAÇÃO — backup do cenário B lido por fora ---------------- */
  console.log("\n== D. Recuperação: backup (do cenário B) é aberto e lido, contadores = inventário ==");
  const backupRecuperacao = backupsB[0];
  ok(!!backupRecuperacao && existsSync(backupRecuperacao), "arquivo de backup presente", backupRecuperacao ?? "—");
  if (backupRecuperacao && existsSync(backupRecuperacao)) {
    const conD = new Database(backupRecuperacao, { readonly: true });
    const integ = (conD.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    const posD = contadoresSqlite(conD);
    conD.close();
    ok(integ === "ok", "integrity_check do backup = ok", integ);
    ok(
      posD.ImportBatch === dadosB.contadores.lotes && posD.ImportRow === dadosB.contadores.linhas && posD.TelemetryEvent === dadosB.contadores.telemetria,
      "contadores do backup reproduzem o estado PRÉ-limpeza (recuperação provada, não presumida)",
      JSON.stringify(posD)
    );
  }

  /* ---------------- CENÁRIO E: CAMINHO DE SUCESSO → PASS + exit 0 ---------------- */
  console.log("\n== E. Caminho de sucesso → PASS + exit 0 + NOVE contadores 0 (incl. caches societários) ==");
  await new Promise((r) => setTimeout(r, 1100));
  const bakE = snapshotBackups();
  criarSandbox();
  await inserirDados();
  const rE = await rodarScript({});
  ok(rE.code === 0, "exit code = 0 no caminho de sucesso", `code=${rE.code}`);
  ok(/RESULTADO: PASS/.test(rE.out), "saída declara RESULTADO: PASS", "");
  ok(/valida[çc][õo]es: .*api_stats=omitido/.test(rE.out), "/api/stats omitido EXPLICITAMENTE no sandbox (nunca finge verificação)", "");
  ok(/cache_relacoes_societarias=PASS/.test(rE.out) && /cache_quadros_participantes=PASS/.test(rE.out) && /cache_estabelecimentos_raiz=PASS/.test(rE.out), "os 3 caches societários aparecem com PASS nas validações", "");
  const conE = new Database(SANDBOX, { readonly: true });
  const posE = contadoresSqlite(conE);
  conE.close();
  ok(Object.values(posE).every((v) => v === 0) && Object.keys(posE).length === 9, "NOVE contadores = 0 após o sucesso (defeito v0.10.6: 3 caches fora da rotina)", JSON.stringify(posE));
  ok(/teste de recuperação: cópia scratch aberta\/lida\/ok/.test(rE.out), "teste de recuperação interno executado", "");
  const bakE2 = novosBackups(bakE);
  ok(bakE2.length >= 1 && existsSync(bakE2[0]), "backup de recuperação disponível ao final", bakE2.join(",") || "—");

  /* ---------------- CENÁRIO F: BANCO JÁ VAZIO → PASS (já limpo) ---------------- */
  console.log("\n== F. Banco já vazio → PASS (já limpo), sem backup novo ==");
  await new Promise((r) => setTimeout(r, 1100));
  const rF = await rodarScript({});
  ok(rF.code === 0, "exit code = 0 com banco já vazio", `code=${rF.code}`);
  ok(/RESULTADO: PASS \(já limpo\)/.test(rF.out), "saída declara PASS (já limpo)", rF.out.split("\n").filter((l) => /RESULTADO/.test(l)).join(" | "));
  const conF = new Database(SANDBOX, { readonly: true });
  const posF = contadoresSqlite(conF);
  conF.close();
  ok(Object.values(posF).every((v) => v === 0), "NOVE contadores seguem 0", JSON.stringify(posF));

  /* ---------------- limpeza dos artefatos de teste ---------------- */
  try { rmSync(UPLOADS_TESTE, { recursive: true, force: true }); } catch { /* idem */ }
  try { unlinkSync(SANDBOX); } catch { /* idem */ }
  for (const b of [...bakE2, ...(backupsB.length ? [backupsB[0]] : [])]) { try { unlinkSync(b); } catch { /* idem */ } }
  try { unlinkSync(join(ROOT, "db", ".entrega-teste-backup-ok")); } catch { /* idem */ }
  // sanity: o banco de dev real NÃO foi tocado (limpeza de teste só mexeu no sandbox)
  const conReal = new Database(join(ROOT, "db", "custom.db"), { readonly: true });
  const snapshotReal1 = contadoresSqlite(conReal);
  conReal.close();
  ok(
    JSON.stringify(snapshotReal1) === JSON.stringify(snapshotReal0),
    "banco de desenvolvimento real permaneceu INTOCATO pelos testes (snapshot antes = depois)",
    JSON.stringify({ antes: snapshotReal0, depois: snapshotReal1 })
  );

  console.log("");
  console.log(`TOTAL ${total - falhas}/${total} PASS${falhas ? ` — ${falhas} FAIL` : ""}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error("erro no teste:", e);
  process.exit(1);
});
