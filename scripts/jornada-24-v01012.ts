/**
 * JORNADA 24 ENTRADAS — v0.10.12 (contrato "testar a jornada completa com 24 entradas").
 *
 * Caminho 100% REAL (dev server :3000 + fontes públicas): colar texto → confirmar →
 * iniciar → aguardar → concluir pendências → ASSERT da confiança de identidade →
 * filtros → export → plano. Escala pontual (19 consultas cadastrais + poucas buscas
 * para as pistas de nome), sem IA, sem carga massiva — mesmo padrão da verificação
 * ao vivo da v0.10.11.
 *
 * Matriz (24 linhas):
 *   15 CNPJ+nome CORRETOS (empresas públicas conhecidas)  → CORRESPONDENTE
 *    1 CNPJ ISOLADO (WEG, só o número)                    → CORRESPONDENTE (identificação direta)
 *    3 CNPJ + NOME DIVERGENTE (sem relação)               → LOCALIZADO + divergência NOME ALTA
 *    1 CNPJ + UF DIVERGENTE                               → LOCALIZADO (localização)
 *    1 CNPJ INVÁLIDO (DV errado)                          → Entrada inválida
 *    1 DUPLICADA (repete a linha 1)                       → Entrada repetida
 *    3 PISTAS DE NOME sem registro encontrado             → Não encontrada (honesto, sem candidato falso)
 *
 * Uso: bun scripts/jornada-24-v01012.ts   (requer dev server em :3000)
 */
import { validateCnpj } from "../src/lib/cnpj";

/** CNPJ completo a partir da RAIZ (8 dígitos) + ordem 0001, com DV calculado —
 *  a raiz identifica a pessoa jurídica; a jornada PROVA o pareamento raiz×nome
 *  quando o registro oficial confere (CORRESPONDENTE). */
function cnpjDaRaiz(raiz8: string): string {
  const base = raiz8.replace(/\D/g, "").padStart(8, "0") + "0001";
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
  return base + String(d1) + String(d2);
}

const BASE = "http://127.0.0.1:3000";

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
async function jfetch(path: string, method = "GET", body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/* ---------------- matriz das 24 entradas ---------------- */
const CORRETAS: [string, string][] = [
  ["00000000", "BANCO DO BRASIL SA"],
  ["33000167", "PETROBRAS"],
  ["84429695", "WEG"], // CNPJ isolado na prática (token de 3 letras não é nome)
  ["89850341", "GRENDENE SA"],
  ["07526557", "AMBEV SA"],
  ["02558157", "TELEFONICA BRASIL SA"],
  ["16670085", "LOCALIZA RENT A COMPANY SA"],
  ["88611835", "MARCOPOLO SA"],
  ["89086144", "RANDONCORP SA"],
  ["60840055", "FLEURY SA"],
  ["61585865", "RAIADROGASIL SA"],
  ["60872504", "ITAU UNIBANCO SA"],
  ["01838723", "BRF SA"],
  ["33611500", "GERDAU SA"],
  ["92754738", "LOJAS RENNER SA"],
].map(([raiz, nome]) => [cnpjDaRaiz(raiz), nome] as [string, string]);
const DIVERGENTES: [string, string][] = [
  ["03853896", "AUTO PECAS JASMINE LTDA"], // Marfrig
  ["60746948", "TRANSPORTES CERRADO LTDA"], // Bradesco
  ["45997418", "PADARIA ESTRELA DO NORTE LTDA"], // Coca Cola Indústrias
].map(([raiz, nome]) => [cnpjDaRaiz(raiz), nome] as [string, string]);
const linhas: string[] = [
  ...CORRETAS.map(([c, n]) => `${c} ${n}`),
  ...DIVERGENTES.map(([c, n]) => `${c} ${n}`),
  `${cnpjDaRaiz("33000121")} AP`, // UF divergente (registro em RJ; pista declara AP)
  "12.345.678/0001-00",    // DV errado → inválida
  `${CORRETAS[0][0]} ${CORRETAS[0][1]}`, // duplicada da linha 1
  "ZXYWV QQQ EMPRESA INEXISTENTE LTDA",  // referência sem registro
  "Sementes Carolina",                    // golden: sem candidato falso
  "Madeireira São José",                  // golden: NAO_ENCONTRADO honesto
];
if (linhas.length !== 24) throw new Error(`matriz deve ter 24 linhas, tem ${linhas.length}`);
for (const [c] of CORRETAS) if (!validateCnpj(c).valid) throw new Error(`CNPJ da matriz com DV inválido: ${c}`);

console.log(`Jornada com ${linhas.length} entradas (15 corretas, 3 divergentes, 1 UF divergente, 1 inválida, 1 duplicada, 3 referências).`);

/* ---------------- execução ---------------- */
const t0 = Date.now();
const up = await jfetch("/api/imports/text", "POST", { text: linhas.join("\n") });
check("upload do lote", up.status === 200 && !!up.json?.batch?.id, JSON.stringify(up.json).slice(0, 120));
const batchId: string | undefined = up.json?.batch?.id;
if (!batchId) process.exit(1);

const cf = await jfetch(`/api/imports/${batchId}/confirm`, "POST", { cnpjColumnIndex: 0, hasHeader: false });
check("confirm (IA desligada por padrão — o payload NÃO contém mais a chave)", cf.status === 200 && cf.json?.aiEnabled === false, JSON.stringify(cf.json).slice(0, 120));

const pr = await jfetch(`/api/imports/${batchId}/process`, "POST", {});
check("iniciar processamento", pr.status === 200 || pr.status === 409, JSON.stringify(pr.json).slice(0, 120));

async function aguardarLote(timeoutMs: number): Promise<any[]> {
  const t = Date.now();
  for (;;) {
    const d = await jfetch(`/api/imports/${batchId}?pageSize=200`);
    const rows: any[] = d.json?.rows ?? [];
    const ativos = rows.filter((r) => ["PENDENTE", "EM_FILA", "CONSULTANDO"].includes(r.lookupStatus)).length;
    if (ativos === 0 || Date.now() - t > timeoutMs) return rows;
    await new Promise((r) => setTimeout(r, 2500));
  }
}

let rows = await aguardarLote(420_000);
// recuperação: concluir pendências (padrão do produto para falhas transitórias)
const ativasAntes = rows.filter((r) => ["RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"].includes(r.lookupStatus)).length;
if (ativasAntes > 0) {
  console.log(`  [recuperação] ${ativasAntes} linha(s) com falha transitória — "Concluir pendências"`);
  await jfetch(`/api/imports/${batchId}/process`, "POST", {});
  rows = await aguardarLote(240_000);
}

const porLinha = new Map<number, any>();
for (const r of rows) porLinha.set(r.rowNumber, r);
const statusLote = (await jfetch(`/api/imports/${batchId}?pageSize=200`)).json?.batch?.status;

console.log(`\n[1] resultados por entrada (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
{
  let corretas = 0, divergentesOk = 0;
  CORRETAS.forEach((_, i) => {
    const r = porLinha.get(i + 1);
    const ok = r?.lookupStatus === "ENRIQUECIDO" && r?.identityStage === "CORRESPONDENTE";
    if (ok) corretas++;
    else console.log(`    linha ${i + 1} (${CORRETAS[i][1]}): status=${r?.lookupStatus} stage=${r?.identityStage} erro=${(r?.lookupError ?? "").slice(0, 60)}`);
  });
  check("15 entradas corretas → Identificada (CORRESPONDENTE)", corretas === 15, `${corretas}/15`);
  DIVERGENTES.forEach(([_, n], i) => {
    const r = porLinha.get(16 + i);
    const divs = r?.identityDivergencias ?? [];
    const ok = r?.lookupStatus === "ENRIQUECIDO" && r?.identityStage === "LOCALIZADO" && divs.some((d: any) => d.tipo === "NOME" && d.severidade === "ALTA");
    if (ok) divergentesOk++;
    else console.log(`    linha ${16 + i} (${n}): status=${r?.lookupStatus} stage=${r?.identityStage} divs=${JSON.stringify(divs).slice(0, 80)}`);
  });
  check("3 divergentes → Revisar (LOCALIZADO com NOME ALTA, ficha preservada)", divergentesOk === 3, `${divergentesOk}/3`);

  const uf = porLinha.get(19);
  const ufOk = uf?.identityStage === "LOCALIZADO" || (uf?.identityDivergencias ?? []).some((d: any) => d.tipo === "LOCALIZACAO");
  check("entrada com UF divergente → divergência registrada", ufOk, `stage=${uf?.identityStage} divs=${JSON.stringify(uf?.identityDivergencias ?? []).slice(0, 80)}`);

  const inv = porLinha.get(20);
  check("CNPJ inválido → Entrada inválida (nada processado)", inv?.cnpjStatus === "INVALIDA" && inv?.lookupStatus !== "ENRIQUECIDO", `status=${inv?.cnpjStatus}/${inv?.lookupStatus}`);
  const dup = porLinha.get(21);
  check("repetida → Entrada repetida (sem segunda consulta)", dup?.cnpjStatus === "DUPLICADA", `status=${dup?.cnpjStatus}`);

  let honestas = 0;
  for (let i = 22; i <= 24; i++) {
    const r = porLinha.get(i);
    const ok = r && r.lookupStatus === "NAO_ENCONTRADO" && r.resolutionState !== "CONFIRMED" && (r.resolvedCnpj ?? "") === "";
    if (ok) honestas++;
    else console.log(`    linha ${i}: status=${r?.lookupStatus} state=${r?.resolutionState} cnpj=${r?.resolvedCnpj}`);
  }
  check("3 pistas sem registro → Não encontrada HONESTA (sem candidato falso)", honestas === 3, `${honestas}/3`);
}

console.log("\n[2] confiança propagada — filtros, export, plano");
{
  // filtro "Revisar" inclui as 4 divergentes (3 NOME + 1 UF)
  const rev = await jfetch(`/api/imports/${batchId}?pageSize=200&resolucao=REVIEW`);
  const revRows: any[] = rev.json?.rows ?? [];
  check('filtro "Revisar" traz as 4 divergentes', revRows.filter((r) => r.identityStage === "LOCALIZADO").length === 4, `${revRows.length} linhas`);

  const conf = await jfetch(`/api/imports/${batchId}?pageSize=200&resolucao=CONFIRMED`);
  const confRows: any[] = conf.json?.rows ?? [];
  check('filtro "Identificadas" EXCLUI divergentes', confRows.every((r) => r.identityStage !== "LOCALIZADO") && confRows.length === 15, `${confRows.length} linhas`);

  // contadores do lote
  const b = (await jfetch(`/api/imports/${batchId}?pageSize=200`)).json?.batch;
  check("contadores: totalLocalizado=4 e totalValidado=0", b?.totalLocalizado === 4 && b?.totalValidado === 0, `loc=${b?.totalLocalizado} val=${b?.totalValidado}`);

  // export result_confirmed: só as 15 corretas
  const exp = await fetch(`${BASE}/api/imports/${batchId}/export?type=result_confirmed`);
  const csv = await exp.text();
  const linhasCsv = csv.split("\n").filter((l) => l.trim().length > 0);
  // 15 corretas + 1 linha duplicada (carrega a MESMA ficha da original — comportamento
  // do produto: a duplicada representa a mesma conta confirmada). As 4 divergentes
  // (LOCALIZADO) ficam FORA.
  check("export confirmadas = 15 corretas + 1 duplicada (LOCALIZADO fica fora)", linhasCsv.length === 17, `${linhasCsv.length - 1} linhas de dados`);
  check("CSV traz etapa_identidade e divergências", csv.includes("etapa_identidade") && csv.includes("CORRESPONDENTE"), "");

  // plano: divergentes em VALIDACAO_HUMANA (fora do escopo)
  const plano = await jfetch(`/api/imports/${batchId}/plano`);
  const fora: any[] = plano.json?.plano?.fora_do_escopo_api ?? [];
  const divFora = fora.filter((f) => f.estado_triagem === "VALIDACAO_HUMANA");
  check("plano: divergentes ficam fora do escopo (validação humana, não consulta)", divFora.length >= 4, `fora=${fora.length} humana=${divFora.length}`);
  check("plano: nenhuma proposta de consulta para 'identidade'", !(plano.json?.plano?.itens ?? []).some((i: any) => i.pergunta_id === "identidade"), "");
}

console.log("\n[3] auditoria da jornada");
{
  const auditAll = await fetch(`${BASE}/api/imports/${batchId}/export?type=audit`);
  const auditText = await auditAll.text();
  const eventos: any[] = auditText.split("\n").filter((l) => l.trim().length > 0).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const identificadas = eventos.filter((e) => (e.evento ?? e.event) === "IDENTIDADE_AVALIADA");
  check("auditoria registra a avaliação de identidade por linha processada", identificadas.length >= 19, `eventos=${identificadas.length}`);
  const audit = await jfetch(`/api/imports/${batchId}`);
  const lote = audit.json?.batch;
  check(`lote terminou ${statusLote}`, statusLote === "DONE" || statusLote === "PARTIAL", `status=${statusLote}`);
}

console.log(`\n=== JORNADA 24: ${pass} PASS · ${fail} FAIL (${((Date.now() - t0) / 1000).toFixed(0)}s) ===`);
if (falhas.length > 0) {
  console.log("Falhas:");
  for (const f of falhas) console.log("  -", f);
  console.log(`\nLote de evidência preservado para inspeção: ${batchId} (arquive pela UI ou DELETE /api/imports/${batchId})`);
  process.exit(1);
} else {
  // limpeza: a jornada NÃO fica no banco de entrega (o fechamento limpa o banco; remover aqui é idempotente)
  await jfetch(`/api/imports/${batchId}`, "DELETE").catch(() => {});
  console.log(`\nLote de jornada removido (${batchId}).`);
}
if (fail > 0) process.exit(1);
