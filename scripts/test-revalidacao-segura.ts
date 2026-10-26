/**
 * Teste de regressão v0.10.1 — REVALIDAÇÃO SEGURA (despacho do auditor, item 2).
 *
 * Cenário: linha ENRIQUECIDO com ficha válida; o operador clica "Revalidar";
 * as fontes NÃO conhecem o CNPJ (exemplo de FORMATO da RFB 12.ABC.345/01DE-35 —
 * válido no validador, inexistente no cadastro real) → a cadeia termina em
 * NAO_ENCONTRADO. GARANTIA A PROVAR:
 *   1. revalidarLinha devolve ok=false (motivo revalidacao_falhou) — NUNCA sucesso;
 *   2. a linha permanece ENRIQUECIDO com a ficha ANTERIOR intacta
 *      (mesma razão social, mesmo collectedAt, sem lookupError destrutivo);
 *   3. a auditoria registra REVALIDACAO_FALHOU com data, motivo e
 *      ficha_anterior_preservada=true.
 *
 * Cria lote/linha de fixture no banco local (SQLite), executa com REDE REAL
 * (até 4 consultas públicas gratuitas — o CNPJ de teste é rejeitado por todas),
 * verifica os 3 pontos e LIMPA a fixture (auditoria do lote é apagada junto).
 *
 * Uso: bun scripts/test-revalidacao-segura.ts
 */
import { db } from "../src/lib/db";
import { revalidarLinha } from "../src/lib/enrich/engine";
import { formatCnpj } from "../src/lib/cnpj";

const CNPJ = "12ABC34501DE35"; // 12.ABC.345/01DE-35 — exemplo oficial de FORMATO da RFB

let falhas = 0;
function ok(cond: boolean, rotulo: string, detalhe = "") {
  if (cond) console.log(`  PASS ${rotulo}`);
  else {
    falhas++;
    console.log(`  FAIL ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function main() {
  console.log("== Revalidação segura — cenário de falha em todas as fontes ==");
  const batchId = `imp_reval_test_${Date.now()}`;
  const fichaOriginal = {
    lookupStatus: "ENRIQUECIDO" as const,
    lookupError: null,
    source: "BrasilAPI",
    legalName: "EMPRESA FANTASMA TESTE LTDA (ficha anterior)",
    tradeName: "FANTASMA",
    registrationStatus: "ATIVA",
    branchType: "MATRIZ",
    municipality: "BRASILIA",
    uf: "DF",
    cnaeDescription: "Atividade de teste",
    rawJson: JSON.stringify({ _fonte: "BrasilAPI", _fixtura: true }),
    collectedAt: new Date("2026-01-01T12:00:00Z"),
    queriedAt: new Date("2026-01-01T12:00:00Z"),
  };

  try {
    // fixture: lote CONFIRMADO + linha ENRIQUECIDO com CNPJ de formato válido, mas
    // que as fontes públicas rejeitam (404) — força o caminho de falha da revalidação
    const batch = await db.importBatch.create({
      data: {
        id: batchId,
        fileName: "fixture-revalidacao-segura.csv",
        storedPath: "upload/fixture-revalidacao-segura.csv",
        fileSize: 64,
        rowCount: 1,
        status: "CONFIRMED",
        totalValid: 1,
        totalReference: 0,
        totalPending: 0,
        totalEnriched: 1,
        aiEnabled: false,
        confirmedAt: new Date(),
      },
    });
    void batch;
    const row = await db.importRow.create({
      data: {
        batchId,
        rowNumber: 1,
        lookupKind: "CNPJ",
        rawCnpj: formatCnpj(CNPJ),
        normalizedCnpj: CNPJ,
        cnpjStatus: "VALIDO",
        ...fichaOriginal,
        queriedAt: new Date("2026-01-02T12:00:00Z"), // queriedAt ≠ collectedAt (ficha real)
      },
    });
    void row;
    const antes = await db.importRow.findFirst({ where: { batchId, rowNumber: 1 } });
    ok(antes?.lookupStatus === "ENRIQUECIDO", "fixture: linha ENRIQUECIDO criada");
    ok(antes?.legalName === fichaOriginal.legalName, "fixture: ficha anterior presente", antes?.legalName ?? "");

    console.log("  (executando revalidação — as fontes vão responder 404 para o CNPJ de formato)");
    const r = await revalidarLinha(batchId, 1);

    ok(r.ok === false, "1. revalidarLinha devolve ok=false (não há sucesso sobre fracasso)", JSON.stringify({ ok: r.ok, motivo: r.motivo }));
    ok(r.motivo === "revalidacao_falhou", "1b. motivo = revalidacao_falhou", r.motivo ?? "");
    ok(typeof r.detalhe === "string" && r.detalhe.length > 0, "1c. detalhe com motivo para a UI", r.detalhe ?? "");

    const depois = await db.importRow.findFirst({ where: { batchId, rowNumber: 1 } });
    ok(depois?.lookupStatus === "ENRIQUECIDO", "2. linha continua ENRIQUECIDO (status restaurado)", depois?.lookupStatus ?? "");
    ok(depois?.legalName === fichaOriginal.legalName, "2b. ficha anterior intacta (razão social)", depois?.legalName ?? "");
    ok(depois?.source === fichaOriginal.source, "2c. fonte original preservada", depois?.source ?? "");
    ok(depois?.lookupError === null, "2d. sem lookupError destrutivo", depois?.lookupError ?? "");
    ok(
      depois?.collectedAt?.toISOString() === fichaOriginal.collectedAt.toISOString(),
      "2e. coleta original preservada",
      depois?.collectedAt?.toISOString() ?? ""
    );

    const eventos = await db.auditEvent.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
    const falhou = eventos.find((e) => e.event === "REVALIDACAO_FALHOU");
    ok(!!falhou, "3. auditoria registra REVALIDACAO_FALHOU", eventos.map((e) => e.event).join(","));
    const det = JSON.parse((falhou?.detail ?? "{}") as string) as Record<string, unknown>;
    ok(det.ficha_anterior_preservada === true, "3b. auditoria diz ficha_anterior_preservada=true", JSON.stringify(det));
    ok(!!det.motivo, "3c. auditoria registra o motivo", JSON.stringify(det.motivo));
    ok(!!falhou?.createdAt, "3d. auditoria registra a DATA da falha (createdAt)", falhou?.createdAt?.toISOString() ?? "");

    console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
    process.exitCode = falhas === 0 ? 0 : 1;
  } finally {
    // limpeza: fixture sai do banco (a auditoria acompanha o lote)
    await db.importRow.deleteMany({ where: { batchId } }).catch(() => {});
    await db.auditEvent.deleteMany({ where: { batchId } }).catch(() => {});
    await db.importBatch.deleteMany({ where: { id: batchId } }).catch(() => {});
    await db.$disconnect();
  }
}

main();
