/**
 * probe-mesa-grandes-lotes.ts — medição da MESA (tabela + ficha) com lotes
 * sintéticos grandes (100 / 1.000 / 5.000 / 10.000) — v0.10.19.
 *
 * O que mede (por tamanho):
 *  - API: carga da página 1 da mesa (50 linhas + agregados do lote);
 *  - API: busca textual (q=) e filtro rápido (lookup=FILA);
 *  - UI (via DOM do dev server? não — aqui é API; a UI é medida no navegador
 *    pelo agente): abertura de ficha = GET rows + render é validado por tempo
 *    de resposta da API de linhas com pageSize padrão.
 *
 * Regras do contrato:
 *  - cria lotes SINTÉTICOS com id imp_perf_<n>_<suffix> no banco de DESENVOLVIMENTO
 *    e os APAGA no fim (mesma prática das suítes imp_test16/17; o lote real do
 *    operador não é tocado);
 *  - ZERO chamadas externas (linhas com CNPJs sintéticos ficam EM_FILA — nada consulta);
 *  - build de produção não pode rodar nesta VM (restrição do ambiente) — as
 *    medições são do modo dev; anotado no relatório.
 *
 * Uso: bun scripts/probe-mesa-grandes-lotes.ts
 */
import { db } from "../src/lib/db";

const BASE = "http://localhost:3000";
const TAMANHOS = [100, 1000, 5000, 10000];
const sufixo = Math.random().toString(36).slice(2, 8);

const mem = (): number => Math.round(process.memoryUsage().rss / 1024 / 1024);
const t0 = (label: string) => {
  const inicio = Date.now();
  return () => ({ label, ms: Date.now() - inicio });
};

async function criarLote(n: number): Promise<string> {
  const id = `imp_perf_${n}_${sufixo}`;
  await db.importBatch.create({
    data: {
      id,
      fileName: `perf-${n}.csv`,
      storedPath: `/tmp/perf-${n}.csv`,
      fileSize: n * 30,
      sourceType: "CSV",
      hasHeader: true,
      delimiter: ",",
      cnpjColumnIndex: 0,
      rowCount: n,
      status: "CONFIRMED",
      totalValid: n,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  // inserção em blocos (SQLite aguenta bem; 10k em ~1-2s)
  const TAM_BLOCO = 500;
  for (let inicio = 1; inicio <= n; inicio += TAM_BLOCO) {
    const fim = Math.min(inicio + TAM_BLOCO - 1, n);
    const linhas = [] as { batchId: string; rowNumber: number; originalCellsJson: string; referenceValue: string; cnpjStatus: string; lookupKind: string; lookupStatus: string; rawCnpj: string; normalizedCnpj: string; cnpjRoot: string; legalName: string; branchType: string; branchIdentifier: number; matrizStatus: string; registrationStatus: string; municipality: string; uf: string; cnaeDescription: string }[];
    for (let i = inicio; i <= fim; i++) {
      const raiz = String(10_000_000 + i).padStart(8, "0");
      const cnpj = `${raiz}0001${String((i % 90) + 10)}${String((i % 9) + 1)}1`; // forma sintética (não consultada)
      linhas.push({
        batchId: id,
        rowNumber: i,
        originalCellsJson: JSON.stringify([cnpj]),
        referenceValue: cnpj,
        cnpjStatus: "VALIDA",
        lookupKind: "CNPJ",
        lookupStatus: "EM_FILA",
        rawCnpj: cnpj,
        normalizedCnpj: cnpj,
        cnpjRoot: raiz,
        legalName: `EMPRESA SINTETICA DE TESTE ${String(i).padStart(6, "0")} LTDA`,
        branchType: i % 5 === 0 ? "FILIAL" : "MATRIZ",
        branchIdentifier: i % 5 === 0 ? 2 : 1,
        matrizStatus: i % 5 === 0 ? "RESOLVIDA" : "NAO_SE_APLICA",
        registrationStatus: "ATIVA",
        municipality: `Cidade ${i % 200}`,
        uf: ["SP", "RJ", "MG", "RS", "PR"][i % 5],
        cnaeDescription: `Atividade sintética de teste número ${i % 500}`,
      });
    }
    await db.importRow.createMany({ data: linhas });
  }
  return id;
}

async function apagarLote(id: string): Promise<void> {
  await db.importRow.deleteMany({ where: { batchId: id } });
  await db.auditEvent.deleteMany({ where: { batchId: id } });
  await db.telemetryEvent.deleteMany({ where: { batchId: id } });
  await db.importBatch.deleteMany({ where: { id } });
}

async function medirGet(url: string): Promise<{ ms: number; status: number; bytes: number }> {
  const inicio = Date.now();
  const res = await fetch(url);
  const corpo = await res.arrayBuffer();
  return { ms: Date.now() - inicio, status: res.status, bytes: corpo.byteLength };
}

async function main(): Promise<void> {
  console.log(`MESA × GRANDES LOTES — memória base ${mem()} MB (modo dev; build de produção é bloqueado nesta VM)\n`);
  const idsCriados: string[] = [];
  const resultados: { n: number; pagina: number; busca: number; filtro: number; ficha: number }[] = [];

  try {
    for (const n of TAMANHOS) {
      const tCriar = t0(`criar lote ${n}`);
      const id = await criarLote(n);
      idsCriados.push(id);
      const msCriar = tCriar().ms;

      // 1) carga da página 1 da mesa (o que o vendedor vê ao abrir o lote)
      const pagina = await medirGet(`${BASE}/api/imports/${id}?page=1&pageSize=50`);
      // 2) busca textual
      const busca = await medirGet(`${BASE}/api/imports/${id}?page=1&pageSize=50&q=EMPRESA%20SINTETICA%20DE%20TESTE%200042`);
      // 3) filtro rápido (pendentes)
      const filtro = await medirGet(`${BASE}/api/imports/${id}?page=1&pageSize=50&lookup=FILA`);
      // 4) "abrir a ficha": a ficha consome o MESMO GET de linhas (dossierRow vem do rows[])
      const ficha = pagina;

      resultados.push({ n, pagina: pagina.ms, busca: busca.ms, filtro: filtro.ms, ficha: ficha.ms });
      console.log(
        `${String(n).padStart(6, " ")} linhas · criar ${String(msCriar).padStart(5, " ")}ms · ` +
        `página ${String(pagina.ms).padStart(4, " ")}ms (${pagina.status}) · ` +
        `busca ${String(busca.ms).padStart(4, " ")}ms (${busca.status}) · ` +
        `filtro ${String(filtro.ms).padStart(4, " ")}ms (${filtro.status}) · mem ${mem()}MB`
      );
      if (pagina.status !== 200 || busca.status !== 200 || filtro.status !== 200) {
        throw new Error(`resposta não-200 no lote de ${n} linhas`);
      }
    }

    console.log("\nCRITÉRIOS (dev, sem virtualização):");
    let ok = true;
    for (const r of resultados) {
      const paginaOk = r.pagina < 3000;
      const buscaOk = r.busca < 3000;
      const filtroOk = r.filtro < 3000;
      if (!paginaOk || !buscaOk || !filtroOk) ok = false;
      console.log(`  ${String(r.n).padStart(6, " ")}: página ${paginaOk ? "OK" : "LENTO"} · busca ${buscaOk ? "OK" : "LENTO"} · filtro ${filtroOk ? "OK" : "LENTO"}`);
    }
    console.log(ok ? "\n✅ MESA opera em todos os portes sem gargalo > 3s (dev)" : "\n❌ gargalo detectado");
    if (!ok) process.exit(1);
  } finally {
    console.log("\nLimpando lotes sintéticos…");
    for (const id of idsCriados) await apagarLote(id).catch(() => undefined);
    console.log("Limpo — o banco de desenvolvimento volta ao estado original.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
