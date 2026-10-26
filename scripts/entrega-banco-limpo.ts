/**
 * entrega-banco-limpo.ts — REGRA PERMANENTE DE ENTREGA (contrato do operador, v0.10.4;
 * INVENTÁRIO INTEGRAL v0.10.7 — auditoria independente da v0.10.6).
 *
 * "Toda entrega para teste do Bruno deve terminar com o banco de desenvolvimento limpo."
 * A limpeza acontece NO FECHAMENTO DA ENTREGA (não a cada inicialização; SEM cron).
 *
 * v0.10.7 (auditoria): a v0.10.6 limpava apenas 6 tabelas e deixava FORA da rotina
 * os 3 caches societários persistentes (RelacaoSocietariaCache, QuadroParticipanteCache,
 * EstabelecimentoRootCache) — um PASS podia conviver com resíduo societário de testes
 * anteriores. Agora o inventário, o backup, a limpeza transacional e a verificação
 * final cobrem as NOVE tabelas; PASS exige as NOVE zeradas, inclusive com banco já vazio.
 *
 * Fluxo obrigatório implementado (1 comando):
 *   1. Conferir que NÃO há workers ou lotes em execução (PROCESSING, lease ativo,
 *      linhas EM_FILA/CONSULTANDO, IA GERANDO, pesquisa GERANDO) → aborta se houver.
 *   2. Inventário COMPLETO do banco impresso antes de qualquer mudança — a checagem
 *      "dados exclusivamente de dev/teste" é HUMANA: se algo no inventário não for
 *      de teste, NÃO confirme (o script aborta sem --confirmar). NOVE tabelas
 *      (v0.10.7): dados + telemetria + lab + cache cadastral + os 3 caches societários.
 *   3. Confirmar que a limpeza atinge SOMENTE o banco de desenvolvimento da VM
 *      (valida que DATABASE_URL aponta para db/custom.db dentro deste projeto).
 *   4. Backup CONSISTENTE e VERIFICADO:
 *      · VACUUM INTO (snapshot consistente do SQLite, inclui WAL pendente);
 *      · PRAGMA integrity_check no backup → precisa ser "ok";
 *      · contadores das 6 tabelas do backup conferidos contra o inventário;
 *      · TESTE DE RECUPERAÇÃO: cópia scratch do backup é aberta e lida antes de
 *        apagar qualquer registro — recuperação provada, não presumida;
 *      · SHA-256 do backup registrado na evidência.
 *      · LIMPEZA SEM BACKUP VÁLIDO É IMPOSSÍVEL (o --sem-backup foi REMOVIDO).
 *   5. JANELA PROTEGIDA (v0.10.4 — auditoria v0.10.3): a proteção contra novas
 *      escritas cobre TODA a operação — não só a transação de exclusão:
 *      · BEGIN IMMEDIATE bloqueia escritas de outros processos DURANTE a limpeza;
 *      · dentro da transação, os NOVE contadores são RELIDOS e conferidos contra o
 *        inventário do passo 2 — QUALQUER escrita na janela backup→limpeza diverge
 *        → ROLLBACK + BLOCKED (o backup já existe; NADA foi apagado);
 *      · re-checagem de trabalho em curso dentro da transação;
 *      · exclusões em UMA transação; leitura zerada antes do COMMIT — falha
 *        intermediária = ROLLBACK = banco intacto.
 *      Depois: uploads imp_* + VACUUM.
 *   6. Preservar: schema Prisma, migrations, código, configurações e fixtures de QA
 *      (o script não toca em nenhum outro arquivo).
 *   7. Confirmação POR LEITURA: as NOVE tabelas zeradas + /api/stats + arquivos de
 *      upload — cada validação com PASS/FAIL explícito.
 *      RESULTADO FINAL AGREGADO (v0.10.4): PASS somente se TODAS as validações
 *      obrigatórias passarem; qualquer FAIL → "RESULTADO: FAIL" + exit 1;
 *      verificação obrigatória impossível → "RESULTADO: BLOCKED" + exit 1.
 *      NUNCA mensagem de sucesso com validação falhando (defeito v0.10.3 corrigido).
 *   8. EVIDÊNCIA: qa/limpeza-banco-entrega.json registra os NOVE contadores
 *      antes/depois, o SHA-256/integridade do backup e o resultado de cada validação
 *      — sem nenhum conteúdo sensível. O ZIP sanitizado é gerado DEPOIS
 *      (scripts/build-zip.sh) — banco e segredos NUNCA entram.
 *
 * Modo SANDBOX (apenas teste — NUNCA toca o banco de dev):
 *   bun scripts/entrega-banco-limpo.ts --confirmar --banco-teste db/custom-teste-x.db
 *   · alvo restrito a db/custom-teste-*.db DENTRO deste projeto (regex validada);
 *   · /api/stats é OMITIDO (veria o banco real) → não bloqueia o PASS do sandbox;
 *   · uploads de teste ficam em upload-teste/ (nunca na pasta real);
 *   · evidência vai para qa/limpeza-banco-entrega-teste.json;
 *   · variáveis de INJEÇÃO DE FALHA (testes do fechamento) só são honradas aqui:
 *       ENTREGA_FALHA_TRANSACAO=1  → lança no meio da transação (prova o ROLLBACK);
 *       ENTREGA_FALHA_VALIDACAO=1  → insere 1 linha de telemetria após o COMMIT
 *                                    (prova o FAIL de validação com exit 1);
 *       ENTREGA_TESTE_ESPERA_MS=N  → pausa após o backup (janela p/ escrita
 *                                    concorrente do teste; marcador db/.entrega-teste-backup-ok);
 *       ENTREGA_STATS_URL=<url>    → sobrescreve a URL do /api/stats (padrão :3000).
 *
 * Uso:
 *   bun scripts/entrega-banco-limpo.ts              # só inventário + checagens (nada muda)
 *   bun scripts/entrega-banco-limpo.ts --confirmar  # backup verificado + limpeza transacional + evidência
 */
import { PrismaClient } from "@prisma/client";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readdirSync, statSync, copyFileSync, unlinkSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CONFIRMAR = process.argv.includes("--confirmar");
const SEM_BACKUP = process.argv.includes("--sem-backup"); // aceito apenas para ABORTAR com mensagem clara

// ---- modo sandbox (teste) ----
const BANCO_TESTE_ARG = (() => {
  const i = process.argv.indexOf("--banco-teste");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const INJ_TRANSACAO = process.env.ENTREGA_FALHA_TRANSACAO === "1";
const INJ_VALIDACAO = process.env.ENTREGA_FALHA_VALIDACAO === "1";
const ESPERA_MS = Number(process.env.ENTREGA_TESTE_ESPERA_MS ?? 0) || 0;
const STATS_URL = process.env.ENTREGA_STATS_URL ?? "http://127.0.0.1:3000/api/stats";

let db: PrismaClient;
let dbPath = "";
let uploadsDir = "";
let sandbox = false;

if (BANCO_TESTE_ARG) {
  // SANDBOX: alvo RESTRITO — nome fixo custom-teste-*.db dentro de db/ deste projeto.
  const alvo = resolve(ROOT, BANCO_TESTE_ARG);
  const dentro = alvo.startsWith(join(ROOT, "db") + "/");
  const nomeOk = /^custom-teste-[a-z0-9-]+\.db$/.test(alvo.split("/").pop() ?? "");
  if (!dentro || !nomeOk) {
    console.error(`✖ --banco-teste aceita APENAS db/custom-teste-<nome>.db dentro deste projeto (recebeu: ${BANCO_TESTE_ARG})`);
    process.exit(1);
  }
  sandbox = true;
  dbPath = alvo;
  db = new PrismaClient({ datasources: { db: { url: `file:${alvo}` } } });
  uploadsDir = join(ROOT, "upload-teste");
} else {
  db = new PrismaClient();
  uploadsDir = join(ROOT, "upload");
}

const TABELAS = [
  ["ImportBatch", "lotes"],
  ["ImportRow", "linhas"],
  ["AuditEvent", "auditoria"],
  ["TelemetryEvent", "telemetria"],
  ["LabComparison", "comparações (lab)"],
  ["CadastroCache", "cache cadastral"],
  // v0.10.7 (auditoria v0.10.6): caches societários persistentes entravam FORA da rotina
  ["RelacaoSocietariaCache", "cache relações societárias"],
  ["QuadroParticipanteCache", "cache quadros de participantes"],
  ["EstabelecimentoRootCache", "cache estabelecimentos da raiz"],
] as const;

/** Problemas (→ FAIL) e avisos; o RESULTADO final é agregado no fim (nunca
 *  sucesso com validação falhando — defeito v0.10.3 corrigido). */
const problemas: string[] = [];
const avisos: string[] = [];

function abortar(motivo: string): never {
  console.error(`\n✖✖ ${sandbox ? "TESTE" : "LIMPEZA"} INTERROMPIDO — impedimento: ${motivo}`);
  console.error("  Nenhum dado foi apagado. Resolva o impedimento e reexecute.");
  process.exit(1);
}

interface Contadores {
  [k: string]: number;
}

/** Contadores das NOVE tabelas — via Prisma (leitura) ou bun:sqlite (backup/scratch).
 *  As CHAVES são os mesmos rótulos de TABELAS (nunca divergem do inventário). */
async function contadoresPrisma(): Promise<Contadores> {
  const [lotes, linhas, auditoria, telemetria, comparacoes, cache, relSoc, quadros, estabRoot] = await Promise.all([
    db.importBatch.count(),
    db.importRow.count(),
    db.auditEvent.count(),
    db.telemetryEvent.count(),
    db.labComparison.count(),
    db.cadastroCache.count(),
    db.relacaoSocietariaCache.count(),
    db.quadroParticipanteCache.count(),
    db.estabelecimentoRootCache.count(),
  ]);
  return {
    lotes,
    linhas,
    auditoria,
    telemetria,
    "comparações (lab)": comparacoes,
    "cache cadastral": cache,
    "cache relações societárias": relSoc,
    "cache quadros de participantes": quadros,
    "cache estabelecimentos da raiz": estabRoot,
  };
}

function contadoresSqlite(con: Database): Contadores {
  const out: Contadores = {};
  for (const [tabela, rotulo] of TABELAS) {
    out[rotulo] = (con.query(`SELECT COUNT(*) AS n FROM "${tabela}"`).get() as { n: number }).n;
  }
  return out;
}

async function main() {
  if (SEM_BACKUP) {
    abortar("--sem-backup não é aceito: o contrato proíbe limpeza sem backup válido e verificado.");
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log(` ENTREGA COM BANCO LIMPO — regra permanente do Scout 360 (v0.10.4)${sandbox ? " — MODO SANDBOX (teste)" : ""}`);
  console.log("══════════════════════════════════════════════════════════════");

  // ---------- Passo 3 (antes de tudo): alvo validado ----------
  if (sandbox) {
    if (!existsSync(dbPath)) abortar(`banco de teste não encontrado em ${dbPath}`);
    console.log(`\n[3] Alvo SANDBOX validado: ${dbPath} (cópia de teste — banco de dev NÃO é tocado)`);
  } else {
    const url = process.env.DATABASE_URL ?? "";
    const m = url.match(/^file:(.+)$/);
    if (!m) abortar(`DATABASE_URL não é SQLite file: (${url.replace(/=.*/, "=***)")})`);
    dbPath = resolve(ROOT, m![1].replace(/^\.\//, ""));
    const esperado = join(ROOT, "db", "custom.db");
    if (dbPath !== esperado) {
      abortar(`DATABASE_URL aponta para '${dbPath}', que NÃO é o banco de desenvolvimento '${esperado}'. A limpeza só pode atingir o banco de dev da VM.`);
    }
    if (!existsSync(dbPath)) abortar(`banco não encontrado em ${dbPath}`);
    console.log(`\n[3] Alvo validado: ${dbPath} (banco de desenvolvimento deste projeto)`);
  }

  // ---------- Passo 1: nenhum worker ou lote em execução ----------
  const agora = new Date();
  const ativoOuLease = {
    OR: [{ status: "PROCESSING" }, { leaseOwner: { not: null }, leaseExpiresAt: { gt: agora } }],
  };
  const [processando, leaseAtivo, linhasFilaAtivas, iaGerando, pesquisaGerando, filaMesa] = await Promise.all([
    db.importBatch.count({ where: { status: "PROCESSING" } }),
    db.importBatch.count({ where: { leaseOwner: { not: null }, leaseExpiresAt: { gt: agora } } }),
    db.importRow.count({ where: { lookupStatus: { in: ["EM_FILA", "CONSULTANDO"] }, batch: ativoOuLease } }),
    db.importRow.count({ where: { aiStatus: "GERANDO", batch: ativoOuLease } }),
    db.importRow.count({ where: { researchStatus: "GERANDO", batch: ativoOuLease } }),
    db.importBatch.count({ where: { researchQueueJson: { contains: '"RODANDO"' } } }),
  ]);
  if (processando || leaseAtivo || linhasFilaAtivas || iaGerando || pesquisaGerando || filaMesa) {
    abortar(
      `há trabalho em curso: PROCESSING=${processando}, lease_ativo=${leaseAtivo}, linhas_em_voo=${linhasFilaAtivas}, IA_gerando=${iaGerando}, pesquisa_gerando=${pesquisaGerando}, fila_mesa_rodando=${filaMesa}. Finalize/espere os lotes antes de fechar a entrega.`
    );
  }
  console.log("[1] Nenhum worker ou lote em execução ✓");

  // ---------- Passo 2: inventário completo (a decisão "é só dev?" é humana) ----------
  const antes = await contadoresPrisma();
  const lotesPorStatus = await db.importBatch.groupBy({ by: ["status"], _count: { _all: true } });
  const primeira = await db.importBatch.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const ultima = await db.importBatch.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  let uploads = 0;
  try {
    uploads = readdirSync(uploadsDir).filter((f) => f.startsWith("imp_")).length;
  } catch { /* pasta inexistente */ }
  console.log("\n[2] INVENTÁRIO do banco:");
  for (const [_, rotulo] of TABELAS) console.log(`    ${rotulo.padEnd(20)}: ${antes[rotulo]}`);
  console.log(`    uploads de lotes.....: ${uploads} arquivos (${sandbox ? "upload-teste/" : "upload/"})`);
  console.log(`    período dos lotes....: ${primeira?.createdAt?.toISOString() ?? "—"} → ${ultima?.createdAt?.toISOString() ?? "—"}`);
  if (!sandbox) {
    console.log("\n    ⚠ Se ALGUM item acima NÃO for exclusivamente de desenvolvimento/teste,");
    console.log("      NÃO confirme: interrompa aqui e informe o impedimento (contrato).");
  }

  const jaLimpo = Object.values(antes).every((v) => v === 0) && uploads === 0;

  if (!CONFIRMAR) {
    console.log("\n▸ Modo leitura: nada foi alterado. Para executar a limpeza NO FECHAMENTO DA ENTREGA:");
    console.log("  bun scripts/entrega-banco-limpo.ts --confirmar");
    await escreverEvidencia({ antes, depois: antes, jaLimpo, uploads, backup: null, validacoes: null, resultado: "leitura", modo: "leitura" });
    await finalizar();
    return;
  }

  if (jaLimpo) {
    console.log("\n✔ Banco JÁ está limpo — nada a fazer (passos 4–7 satisfeitos por leitura).");
    console.log("  RESULTADO: PASS (já limpo)");
    await escreverEvidencia({ antes, depois: antes, jaLimpo, uploads, backup: null, validacoes: null, resultado: "PASS", modo: "ja_limpo" });
    await finalizar();
    return;
  }

  // ---------- Passo 4: backup CONSISTENTE + VERIFICADO ----------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = join(ROOT, "db", `backup-pre-limpeza-${stamp}.db`);
  let backupInfo: { caminho: string; bytes: number; sha256: string; integridade: string; contadores: Contadores; testeRecuperacao: string } | null = null;

  console.log(`\n[4] Backup consistente (VACUUM INTO — snapshot SQLite inclui WAL pendente):`);
  // remove resíduo de tentativa anterior com o mesmo stamp (VACUUM INTO exige arquivo inexistente)
  try { unlinkSync(backupPath); } catch { /* não existia */ }
  const principal = new Database(dbPath);
  principal.exec("PRAGMA busy_timeout = 5000");
  const caminhoSql = backupPath.replace(/'/g, "''");
  principal.exec(`VACUUM INTO '${caminhoSql}'`);
  const bytesBackup = statSync(backupPath).size;
  if (bytesBackup <= 0) abortar("backup criado vazio — limpeza abortada, banco intacto");

  // integridade do backup + contadores do backup conferidos contra o inventário
  const conBackup = new Database(backupPath, { readonly: true });
  const integridade = (conBackup.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  if (integridade !== "ok") abortar(`backup FALHOU no integrity_check ('${integridade}') — limpeza abortada, banco intacto`);
  const contBackup = contadoresSqlite(conBackup);
  for (const [_, rotulo] of TABELAS) {
    if (contBackup[rotulo] !== antes[rotulo]) {
      abortar(`backup inconsistente: ${rotulo} no backup=${contBackup[rotulo]} ≠ inventário=${antes[rotulo]} — limpeza abortada, banco intacto`);
    }
  }
  conBackup.close();

  // TESTE DE RECUPERAÇÃO: cópia scratch é aberta e lida ANTES de apagar qualquer registro
  const scratchPath = join(ROOT, "db", `backup-teste-recuperacao-${stamp}.db`);
  copyFileSync(backupPath, scratchPath);
  const conScratch = new Database(scratchPath, { readonly: true });
  const integridadeScratch = (conScratch.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const contScratch = contadoresSqlite(conScratch);
  conScratch.close();
  unlinkSync(scratchPath);
  if (integridadeScratch !== "ok" || JSON.stringify(contScratch) !== JSON.stringify(contBackup)) {
    abortar("TESTE DE RECUPERAÇÃO falhou (scratch não reproduz o backup) — limpeza abortada, banco intacto");
  }
  const shaBackup = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
  backupInfo = {
    caminho: `db/backup-pre-limpeza-${stamp}.db`,
    bytes: bytesBackup,
    sha256: shaBackup,
    integridade: "ok",
    contadores: contBackup,
    testeRecuperacao: `cópia scratch aberta e lida com integrity_check=ok e contadores idênticos (${Math.round(bytesBackup / 1024)} KB)`,
  };
  console.log(`    backup: db/backup-pre-limpeza-${stamp}.db (${Math.round(bytesBackup / 1024)} KB)`);
  console.log(`    integrity_check: ok · contadores do backup = inventário ✓`);
  console.log(`    teste de recuperação: cópia scratch aberta/lida/ok e removida ✓ (FORA do ZIP)`);
  console.log(`    sha256: ${shaBackup.slice(0, 16)}…`);

  // ---------- janela de TESTE: pausa após o backup (escrita concorrente) ----------
  if (sandbox && ESPERA_MS > 0) {
    const marcador = join(ROOT, "db", ".entrega-teste-backup-ok");
    writeFileSync(marcador, new Date().toISOString());
    console.log(`\n[janela de teste] aguardando ${ESPERA_MS}ms após o backup (marcador: db/.entrega-teste-backup-ok)…`);
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    try { unlinkSync(marcador); } catch { /* idem */ }
  }

  // ---------- Passo 5: limpeza TRANSACIONAL ÚNICA + JANELA PROTEGIDA ----------
  console.log("\n[5] Limpeza transacional (BEGIN IMMEDIATE — novas escritas de outros processos BLOQUEADAS):");
  principal.exec("BEGIN IMMEDIATE");
  try {
    // v0.10.4: DENTRO da transação, releia os SEIS contadores e confira contra o
    // inventário — escrita na janela backup→limpeza DIVERGE → ROLLBACK + BLOCKED
    const contAgora = contadoresSqlite(principal);
    for (const [_, rotulo] of TABELAS) {
      if (contAgora[rotulo] !== antes[rotulo]) {
        throw new Error(
          `ESCRITA CONCORRENTE na janela backup→limpeza: ${rotulo} agora=${contAgora[rotulo]} ≠ inventário=${antes[rotulo]} — rollback (nada será apagado)`
        );
      }
    }

    // re-checagem DENTRO da transação: nenhum lote PROCESSING nem linhas em voo
    const emCurso = (
      principal.query(`SELECT
        (SELECT COUNT(*) FROM ImportBatch WHERE status='PROCESSING') +
        (SELECT COUNT(*) FROM ImportBatch WHERE leaseOwner IS NOT NULL AND leaseExpiresAt > ?) +
        (SELECT COUNT(*) FROM ImportRow r JOIN ImportBatch b ON r.batchId=b.id
           WHERE r.lookupStatus IN ('EM_FILA','CONSULTANDO') AND (b.status='PROCESSING' OR (b.leaseOwner IS NOT NULL AND b.leaseExpiresAt > ?))) +
        (SELECT COUNT(*) FROM ImportRow r JOIN ImportBatch b ON r.batchId=b.id
           WHERE r.aiStatus='GERANDO' AND (b.status='PROCESSING' OR (b.leaseOwner IS NOT NULL AND b.leaseExpiresAt > ?))) +
        (SELECT COUNT(*) FROM ImportRow r JOIN ImportBatch b ON r.batchId=b.id
           WHERE r.researchStatus='GERANDO' AND (b.status='PROCESSING' OR (b.leaseOwner IS NOT NULL AND b.leaseExpiresAt > ?))) +
        (SELECT COUNT(*) FROM ImportBatch WHERE researchQueueJson LIKE '%"RODANDO"%')
        AS n`).get(agora.toISOString(), agora.toISOString(), agora.toISOString(), agora.toISOString()) as { n: number }
    ).n;
    if (emCurso > 0) throw new Error(`trabalho em curso detectado DENTRO da transação (${emCurso}) — rollback`);

    for (const [tabela] of TABELAS) {
      principal.query(`DELETE FROM "${tabela}"`).run();
      if (INJ_TRANSACAO && tabela === "AuditEvent") {
        throw new Error("falha INJETADA no meio da transação (ENTREGA_FALHA_TRANSACAO=1) — prova do ROLLBACK");
      }
    }
    // confirmação DENTRO da transação (antes do commit): tudo tem que estar zerado
    const posTx = contadoresSqlite(principal);
    for (const [_, rotulo] of TABELAS) {
      if (posTx[rotulo] !== 0) throw new Error(`${rotulo} não zerou dentro da transação (${posTx[rotulo]}) — rollback`);
    }
    principal.exec("COMMIT");
    console.log("    contadores conferidos no lock ✓ · exclusões + confirmação zerada DENTRO da transação → COMMIT ✓");
  } catch (e) {
    principal.exec("ROLLBACK");
    console.error(`    ROLLBACK executado — banco permaneceu como estava.`);
    const msg = e instanceof Error ? e.message : String(e);
    if (/ESCRITA CONCORRENTE/.test(msg)) {
      console.error(`\n◐ RESULTADO: BLOCKED — nova escrita durante a janela backup→limpeza. NADA foi apagado;`);
      console.error(`  causa: ${msg}`);
      console.error("  o backup pré-limpeza continua válido. Resolva o escritor e reexecute.");
      await escreverEvidencia({ antes, depois: null, jaLimpo: false, uploads, backup: backupInfo, validacoes: null, resultado: "BLOCKED", modo: "bloqueado_escrita_concorrente", detalhe: msg });
      await finalizar();
      process.exit(1);
    }
    abortar(`falha na limpeza transacional: ${msg}`);
  }

  let removidosUploads = 0;
  try {
    for (const f of readdirSync(uploadsDir)) {
      if (f.startsWith("imp_")) { unlinkSync(join(uploadsDir, f)); removidosUploads++; }
    }
  } catch { /* pasta inexistente */ }
  try { principal.exec("VACUUM"); } catch { /* VACUUM é otimização, não contrato */ }
  principal.close();
  console.log(`    uploads imp_*........: -${removidosUploads} arquivos`);
  console.log(`    (contadores removidos por tabela: ${TABELAS.map(([t, r]) => `${r}:-${antes[r]}`).join(", ")})`);

  // ---------- Passo 7: confirmação POR LEITURA + validações ----------
  if (sandbox && INJ_VALIDACAO) {
    // INJEÇÃO DE FALHA (só sandbox): 1 linha de telemetria "aparece" após a limpeza
    const inj = new Database(dbPath);
    inj.query(
      `INSERT INTO TelemetryEvent (id, tipo, erro, startedAt) VALUES (?, 'INJECAO_TESTE', 'resíduo simulado (ENTREGA_FALHA_VALIDACAO=1)', ?)`
    ).run(`inj_${Date.now()}`, new Date().toISOString());
    inj.close();
    console.log("\n[falha injetada] 1 linha de telemetria inserida após o COMMIT (prova do FAIL de validação)");
  }

  const depois = await contadoresPrisma();
  const zerado = Object.values(depois).every((v) => v === 0);
  console.log("\n[7] Verificação POR LEITURA (nove contadores):");
  console.log(`    ${TABELAS.map(([_, r]) => `${r}=${depois[r]}`).join(" · ")}`);
  if (!zerado) {
    problemas.push(`leitura pós-limpeza encontrou resíduos: ${TABELAS.map(([_, r]) => `${r}=${depois[r]}`).filter((_, i) => depois[TABELAS[i][1]] !== 0).join(", ")}`);
  }

  // cache cadastral, comparações, uploads e /api/stats — validação item a item
  let uploadsPos = 0;
  try {
    uploadsPos = readdirSync(uploadsDir).filter((f) => f.startsWith("imp_")).length;
  } catch { /* pasta inexistente */ }
  const validacoes: Record<string, string> = {
    nove_contadores: zerado ? "PASS (todos 0)" : "FAIL",
    cache_cadastral: depois["cache cadastral"] === 0 ? "PASS (0 CNPJs)" : "FAIL",
    cache_relacoes_societarias: depois["cache relações societárias"] === 0 ? "PASS (0 relações)" : "FAIL",
    cache_quadros_participantes: depois["cache quadros de participantes"] === 0 ? "PASS (0 quadros)" : "FAIL",
    cache_estabelecimentos_raiz: depois["cache estabelecimentos da raiz"] === 0 ? "PASS (0 raízes)" : "FAIL",
    comparacoes_lab: depois["comparações (lab)"] === 0 ? "PASS (0 comparações)" : "FAIL",
    uploads_imp: uploadsPos === 0 ? "PASS (0 arquivos)" : `FAIL (${uploadsPos} restantes)`,
    api_stats: sandbox ? "omitido (modo sandbox — veria o banco de dev real)" : "NAO_VERIFICADO (servidor não respondeu)",
  };
  if (!sandbox) {
    try {
      const res = await fetch(STATS_URL, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const j = (await res.json()) as { stats?: { batches?: { total?: number }; rows?: { total?: number } } };
        const bt = j.stats?.batches?.total ?? -1;
        const rt = j.stats?.rows?.total ?? -1;
        validacoes.api_stats = bt === 0 && rt === 0 ? `PASS (batches.total=0 rows.total=0)` : `FAIL (batches.total=${bt} rows.total=${rt})`;
        console.log(`    /api/stats ao vivo   : batches.total=${bt} rows.total=${rt}`);
        if (bt !== 0 || rt !== 0) problemas.push(`/api/stats do app ao vivo não reflete zero (batches=${bt}, rows=${rt})`);
      } else {
        validacoes.api_stats = `NAO_VERIFICADO (HTTP ${res.status})`;
      }
    } catch {
      // servidor fora do ar: verificação OBRIGATÓRIA impossível → BLOCKED (nunca sucesso silencioso)
    }
  }
  console.log(`    validações: ${Object.entries(validacoes).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

  // ---------- RESULTADO FINAL AGREGADO (v0.10.4) ----------
  const algumFail = Object.values(validacoes).some((v) => v.startsWith("FAIL"));
  const algumNaoVerificado = Object.values(validacoes).some((v) => v.startsWith("NAO_VERIFICADO"));
  let resultado: "PASS" | "FAIL" | "BLOCKED";
  if (algumFail || problemas.length > 0) resultado = "FAIL";
  else if (algumNaoVerificado) resultado = "BLOCKED";
  else resultado = "PASS";

  if (resultado === "PASS") {
    console.log("\n✔ BANCO LIMPO — schema Prisma, migrations, código, configurações e fixtures de QA PRESERVADOS.");
    console.log(`  Recuperação disponível: ${backupInfo?.caminho} (sha256 ${backupInfo?.sha256.slice(0, 16)}…).`);
    console.log("  Próximo passo do fechamento: bash scripts/build-zip.sh (ZIP sanitizado SEM banco e SEM segredos).");
    console.log("\n  RESULTADO: PASS");
  } else if (resultado === "FAIL") {
    console.error(`\n✖ RESULTADO: FAIL — o banco NÃO pode ser declarado limpo.`);
    for (const p of problemas) console.error(`  · ${p}`);
    console.error(`  Executando em sandbox? ${sandbox ? "sim (cópia de teste)" : "não"}. Backup de recuperação: ${backupInfo?.caminho ?? "—"}.`);
  } else {
    console.error(`\n◐ RESULTADO: BLOCKED — limpeza executada, mas a verificação obrigatória não pôde ser concluída:`);
    for (const [k, v] of Object.entries(validacoes)) if (v.startsWith("NAO_VERIFICADO")) console.error(`  · ${k}=${v}`);
    console.error(`  O banco lê ZERO em todas as tabelas; sem a verificação do app ao vivo o resultado não é PASS.`);
  }

  await escreverEvidencia({ antes, depois, jaLimpo, uploads, backup: backupInfo, validacoes, resultado, modo: sandbox ? "sandbox_confirmada" : "confirmada" });
  await finalizar();
  if (resultado !== "PASS") process.exit(1);
}

/** Evidência sem conteúdo sensível: só contadores, hash e validações (contrato). */
async function escreverEvidencia(ev: {
  antes: Contadores; depois: Contadores | null; jaLimpo: boolean; uploads: number;
  backup: { caminho: string; bytes: number; sha256: string; integridade: string; contadores: Contadores; testeRecuperacao: string } | null;
  validacoes: Record<string, string> | null; resultado: string; modo: string; detalhe?: string;
}): Promise<void> {
  const out = join(ROOT, sandbox ? "qa/limpeza-banco-entrega-teste.json" : "qa/limpeza-banco-entrega.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        geradoEm: new Date().toISOString(),
        regra: "entrega com banco de desenvolvimento limpo (permanente, contrato do operador)",
        modo: ev.modo,
        resultado: ev.resultado,
        banco_alvo: sandbox ? `${BANCO_TESTE_ARG} (SANDBOX — cópia de teste)` : "db/custom.db (banco de desenvolvimento da VM — validado antes da limpeza)",
        contadores_antes: ev.antes,
        contadores_depois: ev.depois ?? null,
        uploads_removidos: ev.modo.endsWith("confirmada") ? ev.uploads : undefined,
        backup: ev.backup
          ? {
              caminho: ev.backup.caminho,
              bytes: ev.backup.bytes,
              sha256: ev.backup.sha256,
              integrity_check: ev.backup.integridade,
              contadores_no_backup: ev.backup.contadores,
              teste_recuperacao: ev.backup.testeRecuperacao,
              fora_do_zip: true,
            }
          : null,
        limpeza_transacional: ev.modo.endsWith("confirmada"),
        janela_protegida: "drift check dos NOVE contadores DENTRO de BEGIN IMMEDIATE (escrita na janela backup→limpeza → ROLLBACK + BLOCKED) + exclusões em 1 transação",
        validacoes_pos_limpeza: ev.validacoes,
        problemas: problemas.length ? problemas : undefined,
        detalhe: ev.detalhe,
        sem_conteudo_sensivel: "esta evidência contém APENAS contadores, hashes e resultados de validação",
      },
      null,
      2
    ) + "\n"
  );
  console.log(`\n▸ Evidência de contadores/validação: ${sandbox ? "qa/limpeza-banco-entrega-teste.json" : "qa/limpeza-banco-entrega.json"}`);
}

async function finalizar() {
  await db.$disconnect();
}

if (import.meta.main) {
  main()
    .catch((e) => {
      console.error("erro no script:", e);
      process.exit(1);
    })
    .finally(() => db?.$disconnect());
}
