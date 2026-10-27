/**
 * Suíte v0.10.15 — EXPORTAÇÕES COMERCIAIS E RECONCILIAÇÃO (despacho Bruno Forge).
 *
 * Camadas:
 *   A. CAMADA PURA — telefoneUtil/eMailUtil/dataCadastro/capitalSocialNumero com valores
 *      esperados INDEPENDENTES da função de contagem (válido, ausente, incompleto,
 *      inválido, incomum legítimo, sequência de zeros, fórmula).
 *   B. RECONCILIAÇÃO E2E — lote sintético de 24 entradas (18 compatíveis × 6 em revisão,
 *      mesmo cenário do lote observado): indicadores da API, Excel, CSV (result/
 *      result_confirmed/result_review) e PDF fecham PELO MESMO CONJUNTO de linhas
 *      (identidade por rowNumber, não só totais).
 *   C. SELEÇÃO ACIMA DE 200 — lote com 250 linhas; seleção completa chega inteira.
 *   D. ESCALA — 100 e 1.000 linhas via HTTP; 5.000 in-process respeitando a VM.
 *   E. QUALIDADE EXCEL — zeros à esquerda, texto (nunca fórmula), truncamento COM aviso,
 *      datas tipadas, capital social numérico, abas condicionais (nada fictício).
 *   F. CONTATOS — telefone inválido não vira contato em lugar nenhum; cru preservado na
 *      evidência; incomum legítimo (0800, sem DDD) não é descartado.
 *   G. PDF — ficha sem IA, ficha divergente, ficha com leitura IA, lote com revisões,
 *      limite de 300 com falha clara orientando o Excel.
 *   H. LIMPEZA — lotes sintéticos apagados por ID (operador intacto).
 *
 * Uso: bun scripts/test-v01015-exportacoes.ts   (dev server em :3000 para as camadas HTTP)
 */
import { db } from "../src/lib/db";
import { telefoneUtil, eMailUtil } from "../src/lib/contato";
import { capitalSocialNumero, dataCadastro, construirDatasetExportacao } from "../src/lib/export/dataset";
import { gerarExcelLote } from "../src/lib/export/excel";
import ExcelJS from "exceljs";
import { inflateSync } from "node:zlib";

let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${nome}`);
  } else {
    fail++;
    falhas.push(nome + (extra ? ` — ${extra}` : ""));
    console.log(`  FAIL ${nome}${extra ? ` — ${extra}` : ""}`);
  }
}

const BASE = "http://localhost:3000";
const lotesSinteticos: string[] = [];

// limpeza preventiva: execuções interrompidas podem deixar órfãos
await db.auditEvent.deleteMany({ where: { batchId: { startsWith: "imp_test15_" } } });
await db.telemetryEvent.deleteMany({ where: { batchId: { startsWith: "imp_test15_" } } });
await db.importRow.deleteMany({ where: { batchId: { startsWith: "imp_test15_" } } });
await db.importBatch.deleteMany({ where: { id: { startsWith: "imp_test15_" } } });

/* ============================== A. CAMADA PURA ============================== */

console.log("\nA. CAMADA PURA — regras de contato e tipagem (valores independentes)");
check("telefoneUtil: válido com DDD", telefoneUtil("(11) 98765-4321") === "(11) 98765-4321");
check("telefoneUtil: sem DDD legítimo (8 dígitos)", telefoneUtil("2181-7877") === "2181-7877");
check("telefoneUtil: 0800 incomum legítimo", telefoneUtil("0800 123 4567") === "0800 123 4567");
check("telefoneUtil: sequência de zeros (000000000000)", telefoneUtil("000000000000") === "");
check("telefoneUtil: todos iguais (11111111)", telefoneUtil("11111111") === "");
check("telefoneUtil: incompleto (12345)", telefoneUtil("12345") === "");
check("telefoneUtil: ausente", telefoneUtil("") === "" && telefoneUtil(null) === "" && telefoneUtil(undefined) === "");
check("telefoneUtil: longo demais (14 dígitos)", telefoneUtil("12345678901234") === "");
check("eMailUtil: válido", eMailUtil("FINANCEIRO@EMPRESA.NET.BR") === "FINANCEIRO@EMPRESA.NET.BR");
check("eMailUtil: inválido sem domínio", eMailUtil("financeiro@") === "");
check("eMailUtil: ausente", eMailUtil(" ") === "");
check("capitalSocial: '1.638.221.300,00' → número", capitalSocialNumero("1.638.221.300,00") === 1638221300);
check("capitalSocial: '4700000' → número", capitalSocialNumero("4700000") === 4700000);
check("capitalSocial: texto não numérico → null", capitalSocialNumero("não informado") === null);
const dIso = dataCadastro("2011-11-11");
check("dataCadastro: ISO → Date (11/11/2011)", dIso !== null && dIso.getFullYear() === 2011 && dIso.getMonth() === 10 && dIso.getDate() === 11);
const dBr = dataCadastro("22/10/1980");
check("dataCadastro: BR → Date (22/10/1980)", dBr !== null && dBr.getFullYear() === 1980);
check("dataCadastro: vazio → null", dataCadastro("") === null && dataCadastro("em andamento") === null);

/* ====================== HELPERS DE LOTE SINTÉTICO =========================== */

interface Fixtura {
  rowNumber: number;
  entrada: string;
  cnpj: string; // 14 dígitos
  razao: string;
  stage: "CORRESPONDENTE" | "LOCALIZADO" | "VALIDADO";
  telefoneCru?: string;
  email?: string;
  socios?: { nome: string; qual: string; entrada: string }[];
  capital?: string;
  uf?: string;
  situacao?: string;
  iaLeitura?: string;
  extra?: Record<string, unknown>;
}

function cnpj14(base: string): string {
  const b = base.padStart(8, "0");
  // DV calculado de verdade? Não é necessário para o banco (sem consulta real aqui).
  return `${b}0001${base.slice(-2).padStart(2, "0")}`;
}

async function criarLoteSintetico(nome: string, fixturas: Fixtura[], counters?: Partial<Record<string, number>>): Promise<string> {
  const id = `imp_test15_${Math.random().toString(36).slice(2, 8)}`;
  await db.importBatch.create({
    data: {
      id,
      fileName: nome,
      status: "DONE",
      sourceType: "CSV",
      storedPath: "", // lote sintético de teste — sem arquivo armazenado
      fileSize: 0,
      rowCount: fixturas.length,
      totalValid: fixturas.length,
      totalEnriched: fixturas.length,
      totalPending: 0,
      confirmedAt: new Date(),
      processingAt: new Date(),
      finishedAt: new Date(),
      ...counters,
    },
  });
  lotesSinteticos.push(id);
  for (const f of fixturas) {
    await db.importRow.create({
      data: {
        batchId: id,
        rowNumber: f.rowNumber,
        originalCellsJson: JSON.stringify([f.entrada]),
        lookupKind: "CNPJ",
        rawCnpj: f.cnpj,
        normalizedCnpj: f.cnpj,
        cnpjStatus: "VALIDA",
        lookupStatus: "ENRIQUECIDO",
        cnpjRoot: f.cnpj.slice(0, 8),
        identityStage: f.stage,
        identityDivergenciasJson:
          f.stage === "LOCALIZADO"
            ? JSON.stringify([{ tipo: "DOMINIO", severidade: "BAIXA", descricao: `O domínio da pista não aparece no cadastro de ${f.razao}.` }])
            : JSON.stringify([]),
        legalName: f.razao,
        tradeName: f.razao.split(" ")[0],
        registrationStatus: f.situacao ?? "ATIVA",
        statusDate: "2020-01-01",
        branchType: "MATRIZ",
        branchIdentifier: 1,
        matrizStatus: "RESOLVIDA",
        municipality: "SÃO PAULO",
        uf: f.uf ?? "SP",
        cnaeCode: "6204000",
        cnaeDescription: "Consultoria em tecnologia da informação",
        source: "BrasilAPI",
        queriedAt: new Date(),
        collectedAt: new Date(),
        extraJson: JSON.stringify({
          telefone: f.telefoneCru ?? "",
          telefone2: "",
          email: f.email ?? "",
          endereco: "AVENIDA TESTE 1000",
          capitalSocial: f.capital ?? "",
          naturezaJuridica: "Sociedade Empresária Limitada",
          porte: "DEMAIS",
          ...(f.extra ?? {}),
        }),
        sociosJson: f.socios ? JSON.stringify(f.socios) : null,
        aiStatus: f.iaLeitura ? "OK" : null,
        aiReading: f.iaLeitura ?? null,
      },
    });
  }
  return id;
}

async function limparLotes(): Promise<void> {
  for (const id of lotesSinteticos) {
    await db.auditEvent.deleteMany({ where: { batchId: id } });
    await db.telemetryEvent.deleteMany({ where: { batchId: id } });
    await db.importRow.deleteMany({ where: { batchId: id } });
    await db.importBatch.deleteMany({ where: { id } });
  }
}

/** Extrai texto de um PDF gerado com pdf-lib (streams FlateDecode → strings hex <..> Tj). */
function extrairTextoPdf(buf: Buffer): string {
  const partes: string[] = [];
  let i = 0;
  while (true) {
    const ini = buf.indexOf("stream", i);
    if (ini < 0) break;
    const fim = buf.indexOf("endstream", ini);
    if (fim < 0) break;
    let dados = buf.subarray(ini + 6, fim);
    while (dados.length > 0 && (dados[0] === 13 || dados[0] === 10 || dados[0] === 32)) dados = dados.subarray(1);
    try {
      partes.push(inflateSync(dados).toString("latin1"));
    } catch {
      partes.push(dados.toString("latin1"));
    }
    i = fim + 9;
  }
  const textos: string[] = [];
  for (const conteudo of partes) {
    // pdf-lib escreve texto como strings HEXADECIMAIS: <53434F...> Tj (WinAnsi)
    for (const m of conteudo.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const hex = m[1];
      let s = "";
      for (let j = 0; j + 1 < hex.length; j += 2) {
        s += String.fromCharCode(Number.parseInt(hex.slice(j, j + 2), 16));
      }
      textos.push(s);
    }
    // fallback: strings literais (...) Tj quando existirem
    for (const m of conteudo.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      textos.push(m[1].replace(/\\([()\\])/g, "$1"));
    }
  }
  return textos.join("\n");
}

async function lerExcelDe(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

async function httpExport(id: string, qs: string): Promise<{ status: number; body: Buffer; json: Record<string, unknown> | null; nome: string }> {
  const res = await fetch(`${BASE}/api/imports/${id}/export?${qs}`);
  const body = Buffer.from(await res.arrayBuffer());
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    /* binário */
  }
  const nome = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "";
  return { status: res.status, body, json, nome };
}

/* ==================== B. RECONCILIAÇÃO (cenário 24 = 18 + 6) ================== */

console.log("\nB. RECONCILIAÇÃO — 24 entradas: 18 compatíveis × 6 em revisão (mesmo cenário do lote observado)");
const fixturas24: Fixtura[] = [];
for (let i = 1; i <= 24; i++) {
  const revisao = i > 18; // 18 compatíveis (1–18), 6 LOCALIZADO (19–24)
  fixturas24.push({
    rowNumber: i,
    entrada: `empresa-${i}.com.br`,
    cnpj: cnpj14(String(10000000 + i * 7)),
    razao: `EMPRESA TESTE ${i} LTDA`,
    stage: revisao ? "LOCALIZADO" : "CORRESPONDENTE",
    telefoneCru: i === 2 ? "000000000000" : i === 3 ? "0800 123 4567" : i === 4 ? "12345" : "(11) 98765-4321",
    email: i === 5 ? "email-invalido@" : `contato${i}@empresa.com.br`,
    socios: [{ nome: `SÓCIO ${i} A`, qual: "Sócio-Administrador", entrada: "2020-01-01" }],
    capital: i === 6 ? "1.234.567,89" : "4700000",
    iaLeitura: i === 7 ? "Hipótese de leitura comercial gerada por IA para a linha 7." : undefined,
  });
}
const id24 = await criarLoteSintetico("reconciliacao-24.csv", fixturas24, { totalReview: 6, totalLocalizado: 6 });

const esperadosRevisao = new Set([19, 20, 21, 22, 23, 24]);
{
  const det = (await (await fetch(`${BASE}/api/imports/${id24}`)).json()) as { batch: Record<string, number> };
  check("API: totalReview = 6", det.batch.totalReview === 6);
  check("API: totalPessoasJuridicas (compatíveis) = 18", det.batch.totalPessoasJuridicas === 18);
  check("API: totalPessoasJuridicasLocalizadas = 24", det.batch.totalPessoasJuridicasLocalizadas === 24);
  check("API: totalFalhasConsulta = 0", det.batch.totalFalhasConsulta === 0);

  // Excel completo
  const ex = await httpExport(id24, "type=excel&scope=TODAS");
  check("Excel: 200", ex.status === 200 && ex.nome.startsWith("scout360-completo-"));
  const wb = await lerExcelDe(ex.body);
  check("Excel: abas esperadas", JSON.stringify(wb.worksheets.map((w) => w.name)) === JSON.stringify(["Resumo", "Empresas", "Revisões", "Representantes e relações", "Evidências", "Lacunas e consultas"]));
  const emp = wb.getWorksheet("Empresas")!;
  check("Excel: Empresas = 24 linhas", emp.rowCount - 1 === 24);
  const rev = wb.getWorksheet("Revisões")!;
  check("Excel: Revisões = 6 linhas", rev.rowCount - 1 === 6);
  const linhasRev = new Set<number>();
  for (let r = 2; r <= rev.rowCount; r++) linhasRev.add(Number(rev.getRow(r).getCell(1).value));
  check("Excel: Revisões = MESMAS 6 linhas da tabela (19–24)", [...esperadosRevisao].every((n) => linhasRev.has(n)) && linhasRev.size === 6);
  const resumo = wb.getWorksheet("Resumo")!;
  const valoresResumo = new Map<string, string | number>();
  for (let r = 1; r <= resumo.rowCount; r++) {
    const k = resumo.getRow(r).getCell(1).value;
    const v = resumo.getRow(r).getCell(2).value;
    if (typeof k === "string") valoresResumo.set(k, typeof v === "object" && v ? (v as { text?: string }).text ?? "" : (v as string | number) ?? "");
  }
  check("Excel Resumo: entradas recebidas 24", valoresResumo.get("Entradas recebidas") === 24);
  check("Excel Resumo: PJ localizadas 24", valoresResumo.get("Empresas localizadas (raízes distintas)") === 24);
  check("Excel Resumo: PJ compatíveis 18", valoresResumo.get("Pessoas jurídicas compatíveis com as pistas") === 18);
  check("Excel Resumo: revisão humana 6", valoresResumo.get("Linhas aguardando revisão humana") === 6);

  // Escopos
  const exSem = await lerExcelDe((await httpExport(id24, "type=excel&scope=SEM_REVISAO")).body);
  check("Excel SEM_REVISAO: 18 empresas, sem aba Revisões", exSem.getWorksheet("Empresas")!.rowCount - 1 === 18 && !exSem.getWorksheet("Revisões"));
  const exRev = lerExcelDe((await httpExport(id24, "type=excel&scope=EM_REVISAO")).body);
  const wbRev = await exRev;
  check("Excel EM_REVISAO: 6 empresas", wbRev.getWorksheet("Empresas")!.rowCount - 1 === 6);

  // CSVs
  const csvConf = await httpExport(id24, "type=result_confirmed");
  check("CSV confirmadas (sem revisão): 18 linhas", csvConf.status === 200 && csvConf.body.toString("utf8").split(/\r?\n/).filter((l) => l.trim()).length === 19);
  const csvRev = await httpExport(id24, "type=result_review");
  const linhasCsvRev = csvRev.body.toString("utf8").split(/\r?\n/).filter((l) => l.trim()).slice(1);
  check("CSV result_review: 6 linhas com as MESMAS rowNumbers", linhasCsvRev.length === 6 && linhasCsvRev.every((l) => esperadosRevisao.has(Number(l.split(";")[0]))));
  const csvTodas = await httpExport(id24, "type=result");
  check("CSV resultado completo: 24 linhas", csvTodas.body.toString("utf8").split(/\r?\n/).filter((l) => l.trim()).length === 25);
}

/* ==================== C. SELEÇÃO ACIMA DE 200 NÃO CORTA ==================== */

console.log("\nC. SELEÇÃO ACIMA DE 200 — completa dentro do limite seguro");
{
  const fix250: Fixtura[] = Array.from({ length: 250 }, (_, i) => ({
    rowNumber: i + 1,
    entrada: `c${i + 1}.com.br`,
    cnpj: cnpj14(String(20000000 + i * 3)),
    razao: `EMPRESA SELECAO ${i + 1} LTDA`,
    stage: "CORRESPONDENTE" as const,
  }));
  const id250 = await criarLoteSintetico("selecao-250.csv", fix250);
  const rows = Array.from({ length: 250 }, (_, i) => i + 1);
  // POST com corpo (a URL de 250 linhas não cabe com segurança) — o mesmo caminho do diálogo
  const res = await fetch(`${BASE}/api/imports/${id250}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "result_selected", rows }),
  });
  const texto = Buffer.from(await res.arrayBuffer()).toString("utf8");
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim()).length;
  check("Seleção de 250 via POST: 200", res.status === 200);
  check("Seleção de 250: 250 linhas de dados (não corta em 200)", linhas === 251);
  // Excel com escopo SELECIONADAS
  const resEx = await fetch(`${BASE}/api/imports/${id250}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "excel", scope: "SELECIONADAS", rows }),
  });
  const wbEx = await lerExcelDe(Buffer.from(await resEx.arrayBuffer()));
  check("Excel SELECIONADAS: 250 empresas", wbEx.getWorksheet("Empresas")!.rowCount - 1 === 250);
  // acima do limite seguro: recusa ANTES com explicação
  const resLim = await fetch(`${BASE}/api/imports/${id250}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "result_selected", rows: Array.from({ length: 5001 }, (_, i) => i + 1) }),
  });
  const jLim = (await resLim.json()) as { error?: { code?: string; message?: string } };
  check("Seleção acima de 5000: recusa com explicação (nunca trunca)", resLim.status === 413 && jLim.error?.code === "SELECAO_ACIMA_DO_LIMITE" && /limite seguro/.test(jLim.error?.message ?? ""));
}

/* ============================ D. ESCALA (100/1.000/5.000) =========================== */

console.log("\nD. ESCALA — 100, 1.000 (HTTP) e 5.000 (in-process) dentro dos limites da VM");
{
  for (const n of [100, 1000]) {
    const fix: Fixtura[] = Array.from({ length: n }, (_, i) => ({
      rowNumber: i + 1,
      entrada: `escala-${i + 1}.com.br`,
      cnpj: cnpj14(String(30000000 + i)),
      razao: `ESCALA ${i + 1} LTDA`,
      stage: "CORRESPONDENTE" as const,
    }));
    const id = await criarLoteSintetico(`escala-${n}.csv`, fix);
    const t0 = Date.now();
    const ex = await httpExport(id, "type=excel&scope=TODAS");
    const wb = await lerExcelDe(ex.body);
    check(`Excel ${n} linhas: ${n} empresas (${Date.now() - t0}ms)`, ex.status === 200 && wb.getWorksheet("Empresas")!.rowCount - 1 === n);
  }
  // 5.000 in-process (mesmos módulos da rota — respeita a VM)
  const fix5000: Fixtura[] = Array.from({ length: 5000 }, (_, i) => ({
    rowNumber: i + 1,
    entrada: `escala-5k-${i + 1}.com.br`,
    cnpj: cnpj14(String(40000000 + i)),
    razao: `ESCALA 5000 ${i + 1} LTDA`,
    stage: "CORRESPONDENTE" as const,
  }));
  const id5k = await criarLoteSintetico("escala-5000.csv", fix5000);
  const t5 = Date.now();
  const ds = await construirDatasetExportacao(id5k, "TODAS", undefined);
  check("Dataset 5.000: ok", ds.ok);
  if (ds.ok) {
    const buf = await gerarExcelLote(ds.dataset, id5k);
    const wb = await lerExcelDe(buf);
    check(`Excel 5.000 linhas: ${wb.getWorksheet("Empresas")!.rowCount - 1} empresas (${Date.now() - t5}ms)`, wb.getWorksheet("Empresas")!.rowCount - 1 === 5000);
  }
}

/* ==================== E. QUALIDADE EXCEL (zeros, fórmula, truncamento, datas) ==================== */

console.log("\nE. QUALIDADE EXCEL — zeros, fórmulas, truncamento, datas e caracteres");
{
  const fixQ: Fixtura[] = [
    { rowNumber: 1, entrada: "zeros.com.br", cnpj: cnpj14("348003"), razao: "LEADING ZEROS LTDA", stage: "CORRESPONDENTE", telefoneCru: "0800 555 0199", capital: "1.234.567,89" },
    { rowNumber: 2, entrada: "formula.com.br", cnpj: cnpj14("11111111"), razao: "=SOMA(A1:A2)+cmd", stage: "CORRESPONDENTE" },
    { rowNumber: 3, entrada: "longa.com.br", cnpj: cnpj14("22222222"), razao: "X".repeat(40000), stage: "CORRESPONDENTE" },
    { rowNumber: 4, entrada: "acentos.com.br", cnpj: cnpj14("33333333"), razao: "AÇÕES & IMÃOS — “PREMIUM” LTDA", stage: "CORRESPONDENTE" },
    { rowNumber: 5, entrada: "sem-dados.com.br", cnpj: cnpj14("44444444"), razao: "CADASTRO INCOMPLETO LTDA", stage: "CORRESPONDENTE" },
  ];
  const idQ = await criarLoteSintetico("qualidade.csv", fixQ);
  const wb = await lerExcelDe((await httpExport(idQ, "type=excel&scope=TODAS")).body);
  const emp = wb.getWorksheet("Empresas")!;
  // zeros à esquerda preservados como texto
  const cnpjCell = emp.getRow(2).getCell(3);
  check("CNPJ com zeros preservado como TEXTO", typeof cnpjCell.value === "string" && /^00\./.test(cnpjCell.value as string) && cnpjCell.numFmt === "@");
  // fórmula nunca interpretada
  const fCell = emp.getRow(3).getCell(4);
  const fv = fCell.value as { richText?: { text: string }[] } | string;
  check("String '=...' entra como richText (NUNCA fórmula)", typeof fv === "object" && Array.isArray((fv as { richText?: unknown[] }).richText) && (fv as { richText: { text: string }[] }).richText[0].text.startsWith("=") && fCell.type !== ExcelJS.ValueType.Formula);
  // truncamento com aviso explícito
  const lCell = emp.getRow(4).getCell(4).value as { richText?: { text: string }[] } | string;
  const lTexto = typeof lCell === "object" && "richText" in (lCell as object) ? (lCell as { richText: { text: string }[] }).richText.map((r) => r.text).join("") : (lCell as string);
  check("Nome de 40k chars: truncado COM aviso explícito", lTexto.includes("[TEXTO TRUNCADO") && lTexto.length < 32767);
  // caracteres especiais intactos
  const aCell = emp.getRow(5).getCell(4).value;
  check("Acentos e caracteres especiais intactos", aCell === "AÇÕES & IMÃOS — “PREMIUM” LTDA");
  // datas tipadas
  const dCell = emp.getRow(2).getCell(11);
  check("Data da situação tipada como Date", dCell.value instanceof Date);
  // capital social numérico com formato R$ (linha 1 do lote → linha 2 do Excel)
  const capCell = emp.getRow(2).getCell(14);
  check("Capital social como número com formato R$", typeof capCell.value === "number" && capCell.value === 1234567.89 && capCell.numFmt.includes("R$"));
  // 0800 preservado (linha 1 do lote → linha 2)
  const telRow1 = emp.getRow(2).getCell(15).value;
  check("0800 (incomum legítimo) preservado como contato", telRow1 === "0800 555 0199");
  // cadastro incompleto: células vazias, nada inventado (linha 5 do lote → linha 6)
  const incTel = emp.getRow(6).getCell(15).value;
  const incEmail = emp.getRow(6).getCell(16).value;
  check("Cadastro incompleto: células vazias (nada inventado)", !incTel && !incEmail);
}

/* ============================ F. CONTATOS (inválido não vira contato) ============================ */

console.log("\nF. CONTATOS — fictício bloqueado, cru preservado na evidência");
{
  const ds = await construirDatasetExportacao(id24, "TODAS", undefined);
  check("Dataset 24: ok", ds.ok);
  if (ds.ok) {
    const linha2 = ds.dataset.linhas.find((l) => l.rowNumber === 2)!;
    check("Telefone 000000000000: NÃO é contato utilizável", linha2.telefones.length === 0);
    check("E-mail válido da mesma linha segue utilizável (não descartado junto)", linha2.email === "contato2@empresa.com.br");
    check("Telefone cru 000000000000 PRESERVADO na evidência técnica", linha2.telefonesCrus.includes("000000000000"));
    const linha3 = ds.dataset.linhas.find((l) => l.rowNumber === 3)!;
    check("0800 legítimo vira contato", linha3.telefones.includes("0800 123 4567"));
    const linha4 = ds.dataset.linhas.find((l) => l.rowNumber === 4)!;
    check("Telefone incompleto (12345) não vira contato", linha4.telefones.length === 0);
    const linha5 = ds.dataset.linhas.find((l) => l.rowNumber === 5)!;
    check("E-mail inválido não vira contato", linha5.email === "");
    const wb = await lerExcelDe((await httpExport(id24, "type=excel&scope=TODAS")).body);
    const ev = wb.getWorksheet("Evidências")!;
    let achouCru = false;
    for (let r = 2; r <= ev.rowCount; r++) {
      const prop = String(ev.getRow(r).getCell(3).value ?? "");
      const val = String(ev.getRow(r).getCell(4).value ?? "");
      if (prop.startsWith("Telefone do cadastro") && val.includes("000000000000")) achouCru = true;
    }
    check("Evidências do Excel preserva o cru com marca de NÃO utilizável", achouCru);
    const emp = wb.getWorksheet("Empresas")!;
    const telEmp2 = String(emp.getRow(3).getCell(15).value ?? "");
    check("Empresas não lista 000000000000 como telefone válido", !telEmp2.includes("000000000000"));
  }
}

/* ============================ G. PDF ============================ */

console.log("\nG. PDF — ficha sem IA, divergente, com IA, lote com revisões e limite");
{
  // ficha identificada sem IA (linha 1)
  const p1 = await httpExport(id24, "type=pdf_empresa&row=1");
  const t1 = extrairTextoPdf(p1.body);
  // v0.11.2: a rota pdf_empresa usa o GERADOR v4 (Gate 3, CONSOL-3a) — página 1
  // executiva com razão social dominante. O marcador de cabeçalho da v4 é
  // "FICHA COMERCIAL DA EMPRESA" (o "DOSSIÊ COMERCIAL" era o cabeçalho da v3,
  // preservada apenas como gerarPdfEmpresaV3 para comparação). A intenção do
  // check não muda: PDF gerado, com cabeçalho e fonte principal identificadas.
  check("PDF empresa (sem IA): 200 + seções", p1.status === 200 && t1.includes("FICHA COMERCIAL DA EMPRESA") && t1.includes("O QUE OS DADOS COMPROVAM") && t1.includes("Fonte principal:"));
  check("PDF empresa: sem leitura de IA (seção ausente, nada vazio)", !t1.includes("LEITURA COMERCIAL"));
  // ficha divergente (linha 19) — aviso de revisão presente
  const p19 = await httpExport(id24, "type=pdf_empresa&row=19");
  const t19 = extrairTextoPdf(p19.body);
  check("PDF empresa divergente: aviso de identidade em revisão", t19.includes("Identidade em revisão") || t19.includes("IDENTIDADE EM REVIS"));
  check("PDF empresa divergente: divergência descrita", t19.includes("não aparece no cadastro"));
  // ficha com leitura IA (linha 7)
  const p7 = await httpExport(id24, "type=pdf_empresa&row=7");
  const t7 = extrairTextoPdf(p7.body);
  check("PDF empresa com IA: leitura rotulada como hipótese", t7.includes("IA") && t7.includes("hip"));
  // PDF do lote: reconciliado
  const pl = await httpExport(id24, "type=pdf_lote&scope=TODAS");
  const tl = extrairTextoPdf(pl.body);
  check("PDF lote: 200", pl.status === 200);
  check("PDF lote: 24 empresas localizadas × 18 compatíveis × 6 em revisão", tl.includes("24 empresas distintas") && tl.includes("18 empresas") && tl.includes("6 linhas"));
  check("PDF lote: seção de revisões presente", tl.toUpperCase().includes("CASOS EM REVIS"));
  // limite do PDF de lote
  const fix400: Fixtura[] = Array.from({ length: 301 }, (_, i) => ({
    rowNumber: i + 1,
    entrada: `lim-${i + 1}.com.br`,
    cnpj: cnpj14(String(50000000 + i)),
    razao: `LIMITE PDF ${i + 1} LTDA`,
    stage: "CORRESPONDENTE" as const,
  }));
  const id400 = await criarLoteSintetico("limite-pdf.csv", fix400);
  const plim = await httpExport(id400, "type=pdf_lote&scope=TODAS");
  check("PDF lote acima de 300: falha CLARA orientando Excel", plim.status === 413 && (plim.json as { error?: { message?: string } })?.error?.message?.includes("Excel"));
  // PDF empresa em lote incompleto (linha sem razão social)
  await db.importRow.create({
    data: {
      batchId: id400,
      rowNumber: 302,
      originalCellsJson: JSON.stringify(["pista-solta"]),
      lookupKind: "CNPJ",
      rawCnpj: "",
      cnpjStatus: "INVALIDA",
      invalidReason: "CNPJ inválido na entrada",
      lookupStatus: "NAO_ENCONTRADO",
      lookupError: "Não localizado nas fontes públicas",
    },
  });
  const pInc = await httpExport(id400, "type=pdf_empresa&row=302");
  check("PDF de entrada não localizada: gera honestamente (sem cadastro)", pInc.status === 200 || pInc.status === 422);
}

/* ============================ H. LIMPEZA ============================ */

console.log("\nH. LIMPEZA — lotes sintéticos apagados");
await limparLotes();
const restantes = await db.importBatch.count({ where: { id: { startsWith: "imp_test15_" } } });
check("Nenhum lote sintético restante", restantes === 0);

/* ============================== RESULTADO ============================== */

console.log(`\n${"=".repeat(64)}`);
console.log(`RESULTADO: ${pass} PASS · ${fail} FAIL`);
if (fail > 0) {
  console.log("FALHAS:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
await db.$disconnect();
process.exit(0);
