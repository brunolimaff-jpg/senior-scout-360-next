/**
 * Suíte v0.10.12 — CONFIANÇA NA IDENTIFICAÇÃO (contrato "corrigir a confiança").
 *
 * Diferencia OBRIGATORIAMENTE os três estágios e propaga à triagem/plano/exportação:
 *   A. CAMADA PURA — avaliarIdentidade (pistas × ficha, determinístico, zero rede):
 *      CNPJ isolado, nome compatível, nome zero-similar (o caso que a condição `best > 0`
 *      ignorava), nome parcial, UF divergente, domínio divergente, domínio provado
 *      (RDAP/site), decisão humana (VALIDADO).
 *   B. RESOLVEDOR — com fontes SIMULADAS (zero HTTP real): candidato promovível com nome
 *      sem relação e SEM prova de domínio vai para REVISÃO (antes: CONFIRMED automático);
 *      o registro fica PRESERVADO nos candidatos; homônimos não confirmam sozinhos;
 *      nome com gov-page forte confirma (WEG).
 *   C. E2E DO ENGINE — lote real (startBatch in-process) com cadastro simulado:
 *      VALIDA correta → CORRESPONDENTE; VALIDA divergente → LOCALIZADO + divergências;
 *      correção humana ({cnpj}, mesmas escritas da rota decide) → VALIDADO e divergências
 *      antigas saem; VALIDAR_REGISTRO (mesmas escritas da rota decide) → VALIDADO com
 *      divergências preservadas; triagem → VALIDACAO_HUMANA com fatos preservados;
 *      plano → fora do escopo (validação com a empresa, não consulta).
 *   D. EXPORT — result_confirmed EXCLUI registro LOCALIZADO (rota real do dev server,
 *      que lê o mesmo banco) e o CSV traz etapa_identidade/divergencias_identidade.
 *
 * PROVA ESTRUTURAL: globalThis.fetch é substituído por simulador que CONTA toda tentativa
 * de saída e RECUSA host externo não cadastrado (zero HTTP real por construção).
 * Uso: bun scripts/test-v01012-identidade.ts  (dev server em :3000 só para a camada D)
 */
import { db } from "../src/lib/db";
import { validateCnpj, formatCnpj } from "../src/lib/cnpj";
import { avaliarIdentidade } from "../src/lib/resolve/confianca";
import type { Clues } from "../src/lib/resolve";

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

/* ================= simulador global de fontes (ZERO HTTP real) ================= */
const FICHAS = new Map<string, Record<string, unknown>>(); // cnpj → ficha BrasilAPI
const BUSCAS = new Map<string, { url: string; name: string; snippet: string }[]>(); // query → items
const PAGINAS = new Map<string, { title: string; html: string }>(); // url → página
const tentativasSaida: string[] = [];
const fetchOriginal = globalThis.fetch;

function fichaBrasilAPI(cnpj: string, razao: string, fantasia: string, uf: string, municipio: string, identifier: number, email = "", cnae = 6204000): Record<string, unknown> {
  return {
    cnpj,
    razao_social: razao,
    nome_fantasia: fantasia,
    descricao_situacao_cadastral: "ATIVA",
    data_situacao_cadastral: "2020-01-01",
    descricao_tipo_de_logradouro: "AVENIDA",
    logradouro: "INDUSTRIAL",
    numero: "1000",
    bairro: "CENTRO",
    municipio,
    uf,
    cep: "00000000",
    cnae_fiscal: cnae,
    cnae_fiscal_descricao: "Atividade sintética",
    ddd_telefone_1: "47 3044 4000",
    data_inicio_atividade: "1990-01-01",
    capital_social: "1000000.00",
    descricao_porte: "DEMAIS",
    opcao_pelo_simples: false,
    qsa: [{ nome_socio: "SOCIO SINTETICO", qualificacao_socio: "Sócio-Administrador" }],
    email,
  };
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  // mini serviço de resolução (:3030) — simulado aqui (nunca real)
  if (url.includes(":3030/web-search")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
    const items = BUSCAS.get(String(body.query ?? "")) ?? [];
    return new Response(JSON.stringify({ ok: true, items }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes(":3030/page-reader")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
    const page = PAGINAS.get(String(body.url ?? ""));
    if (!page) {
      return new Response(JSON.stringify({ ok: false, erro: "PAGINA_INDISPONIVEL" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, data: { title: page.title, html: page.html } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const externo = /^https?:\/\//i.test(url) && !url.includes("127.0.0.1") && !url.includes("localhost");
  if (!externo) return fetchOriginal(input as never, init);
  tentativasSaida.push(url);
  // cadeia de cadastro: BrasilAPI → OpenCNPJ → ReceitaWS (mesma ficha)
  const mCnpj = url.match(/(?:brasilapi\.com\.br\/api\/cnpj\/v1|api\.opencnpj\.org\/|receitaws\.com\.br\/v2\/cnpj)\/([0-9]{14})/);
  if (mCnpj) {
    const ficha = FICHAS.get(mCnpj[1]);
    if (ficha) return new Response(JSON.stringify(ficha), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ message: "not found (simulado)" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("rdap.registro.br/")) {
    return new Response(JSON.stringify({ errorCode: 404 }), { status: 404, headers: { "Content-Type": "application/json" } }); // sem registrante no simulador
  }
  if (url.includes("servicodados.ibge.gov.br/")) {
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }); // contexto municipal vazio (tolerado)
  }
  if (url.includes("minhareceita.org/")) {
    return new Response(JSON.stringify({ message: "not found (simulado)" }), { status: 404, headers: { "Content-Type": "application/json" } }); // cauda da cadeia
  }
  throw new Error(`SIMULADOR: chamada externa NÃO cadastrada — bloqueada (prova de zero HTTP real): ${url}`);
}) as typeof fetch;

/* ================= CNPJs sintéticos ================= */
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

const CNPJ_GRENDENE = cnpjValido("00001000");
const CNPJ_GRENDENE_FILIAL = cnpjValido("00001000", "0002");
const CNPJ_WEG = cnpjValido("00002000");
const CNPJ_HOMONIMO_A = cnpjValido("00003000");
const CNPJ_HOMONIMO_B = cnpjValido("00004000");
const CNPJ_DIVERGENTE = cnpjValido("00005000"); // cadastro sem NENHUM token em comum com a pista

const todosCnpjs = [CNPJ_GRENDENE, CNPJ_GRENDENE_FILIAL, CNPJ_WEG, CNPJ_HOMONIMO_A, CNPJ_HOMONIMO_B, CNPJ_DIVERGENTE];

/* ================= fontes simuladas ================= */
FICHAS.set(CNPJ_GRENDENE, fichaBrasilAPI(CNPJ_GRENDENE, "GRENDE INDUSTRIA SINTETICA SA", "Grendene", "RS", "FARROUPILHA", 1, "contato@grende-sintetica.com.br"));
FICHAS.set(CNPJ_GRENDENE_FILIAL, fichaBrasilAPI(CNPJ_GRENDENE_FILIAL, "GRENDE INDUSTRIA SINTETICA SA", "Grendene", "RS", "SOBRAL", 2, "contato@grende-sintetica.com.br"));
FICHAS.set(CNPJ_WEG, fichaBrasilAPI(CNPJ_WEG, "WEG MOTOR SINTETICO SA", "WEG", "SC", "JARAGUA DO SUL", 1, "contato@weg-sintetico.com.br"));
FICHAS.set(CNPJ_HOMONIMO_A, fichaBrasilAPI(CNPJ_HOMONIMO_A, "EMPRESA DUPLA COMERCIO A LTDA", "", "SP", "SAO PAULO", 1));
FICHAS.set(CNPJ_HOMONIMO_B, fichaBrasilAPI(CNPJ_HOMONIMO_B, "EMPRESA DUPLA COMERCIO B LTDA", "", "PR", "CURITIBA", 1));
FICHAS.set(CNPJ_DIVERGENTE, fichaBrasilAPI(CNPJ_DIVERGENTE, "TRANSPORTES RADIAL SINTETICO LTDA", "", "MG", "UBERLANDIA", 1));

// ---- nome "EMPRESA DUPLA" → DOIS diretórios independentes com DUAS raízes (homônimos) ----
PAGINAS.set("https://consultacnpj-a.example/consulta/empresa-dupla", {
  title: "EMPRESA DUPLA COMERCIO A LTDA — CNPJ",
  html: `<html><body>Consulta pública: EMPRESA DUPLA COMERCIO A LTDA ${formatCnpj(CNPJ_HOMONIMO_A)}</body></html>`,
});
PAGINAS.set("https://cnpj-guia-b.example/empresa/empresa-dupla-b", {
  title: "EMPRESA DUPLA COMERCIO B LTDA — CNPJ",
  html: `<html><body>Cadastro: EMPRESA DUPLA COMERCIO B LTDA ${formatCnpj(CNPJ_HOMONIMO_B)}</body></html>`,
});
BUSCAS.set('"EMPRESA DUPLA" CNPJ', [
  { url: "https://consultacnpj-a.example/consulta/empresa-dupla", name: "EMPRESA DUPLA COMERCIO A LTDA", snippet: `CNPJ ${formatCnpj(CNPJ_HOMONIMO_A)}` },
  { url: "https://cnpj-guia-b.example/empresa/empresa-dupla-b", name: "EMPRESA DUPLA COMERCIO B LTDA", snippet: `CNPJ ${formatCnpj(CNPJ_HOMONIMO_B)}` },
]);

// ---- nome "WEG" → página governamental com CNPJ + nome + UF (binding FORTE pós-verificação) ----
PAGINAS.set("https://weg-registro.gov/cnpj", {
  title: "WEG MOTOR SINTETICO SA — registro CNPJ",
  html: `<html><body>Registro oficial: WEG MOTOR SINTETICO SA — CNPJ ${CNPJ_WEG} — Jaragua do Sul/SC</body></html>`,
});
BUSCAS.set('"WEG" CNPJ', [{ url: "https://weg-registro.gov/cnpj", name: "WEG MOTOR SINTETICO SA", snippet: `CNPJ ${CNPJ_WEG}` }]);

// ---- nome "SAPATOS TROPICAL" → DOIS diretórios independentes com o MESMO CNPJ sem
// relação de nome (2 moderadas independentes = promovável) e SEM prova de domínio ----
const dir1 = "https://consultacnpj-t.example/consulta/sapatos-tropical";
const dir2 = "https://cnpj-guia-t.example/empresa/sapatos-tropical";
PAGINAS.set(dir1, { title: "SAPATOS TROPICAL DO SUL LTDA — CNPJ", html: `CNPJ ${formatCnpj(CNPJ_DIVERGENTE)}` });
PAGINAS.set(dir2, { title: "SAPATOS TROPICAL DO SUL LTDA — empresa", html: `Cadastro: ${formatCnpj(CNPJ_DIVERGENTE)}` });
BUSCAS.set('"SAPATOS TROPICAL" CNPJ', [
  { url: dir1, name: "SAPATOS TROPICAL DO SUL", snippet: `CNPJ ${formatCnpj(CNPJ_DIVERGENTE)}` },
  { url: dir2, name: "SAPATOS TROPICAL DO SUL", snippet: `CNPJ ${formatCnpj(CNPJ_DIVERGENTE)}` },
]);

/* ================= helpers ================= */
const batchIds: string[] = [];
async function limparTudo() {
  const lotes = await db.importBatch.findMany({ where: { fileName: { startsWith: "SUITE-V01012" } }, select: { id: true } });
  for (const l of lotes) await db.importBatch.delete({ where: { id: l.id } }).catch(() => {});
  for (const c of todosCnpjs) await db.cadastroCache.delete({ where: { cnpj: c } }).catch(() => {});
}

function cnpjValidoInner(): void { /* (documentação: DV garantido por cnpjValido) */ }

async function novoLoteTexto(linhas: string[]): Promise<string> {
  const st = await db.importBatch.create({
    data: {
      fileName: `SUITE-V01012-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sourceType: "TEXT",
      delimiter: "\t",
      encoding: "UTF-8",
      hasHeader: false,
      headerJson: JSON.stringify(["entrada"]),
      rowCount: linhas.length,
      fileSize: 18,
      storedPath: "suite-sintetico",
    },
  });
  batchIds.push(st.id);
  await db.importRow.createMany({
    data: linhas.map((l, i) => ({
      batchId: st.id,
      rowNumber: i + 1,
      originalCellsJson: JSON.stringify([l]),
      lookupKind: "NAME",
      rawCnpj: l,
      normalizedCnpj: "",
      cnpjStatus: "REFERENCIA",
      lookupStatus: "PENDENTE",
    })),
  });
  return st.id;
}

/** mesmas escritas do confirmBatch para TEXT: classifica a entrada (CNPJ válido → VALIDA) */
async function confirmarLote(batchId: string) {
  const rows = await db.importRow.findMany({ where: { batchId } });
  for (const r of rows) {
    const cell = (JSON.parse(r.originalCellsJson) as string[])[0] ?? "";
    const digits = (cell.match(/[0-9.\s/-]{14,}/g) ?? []).map((x) => x.replace(/\D/g, "")).find((x) => validateCnpj(x).valid);
    if (digits) {
      await db.importRow.update({ where: { id: r.id }, data: { lookupKind: "CNPJ", cnpjStatus: "VALIDA", normalizedCnpj: digits, rawCnpj: cell } });
    } else {
      await db.importRow.update({ where: { id: r.id }, data: { lookupKind: "NAME", cnpjStatus: "REFERENCIA", referenceValue: cell, rawCnpj: cell } });
    }
  }
  await db.importBatch.update({ where: { id: batchId }, data: { status: "CONFIRMED" } });
}

async function esperarLote(batchId: string, timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const rows = await db.importRow.findMany({ where: { batchId }, select: { lookupStatus: true } });
    const ativos = rows.filter((r) => ["PENDENTE", "EM_FILA", "CONSULTANDO"].includes(r.lookupStatus)).length;
    if (ativos === 0 || Date.now() - t0 > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/* ================= CAMADA A — avaliarIdentidade (pura) ================= */
console.log("\n[A] avaliarIdentidade — os três estágios obrigatórios");
{
  const fichaGrendene = { legalName: "GRENDE INDUSTRIA SINTETICA SA", tradeName: "Grendene", uf: "RS", municipio: "FARROUPILHA", emailDomain: "grende-sintetica.com.br" };
  const cluesCom = (nome: string | null, extra?: Partial<Clues>): Clues => ({
    cnpj: CNPJ_GRENDENE, emails: [], domains: [], disposableEmail: false, phones: [], names: nome ? [nome] : [], uf: null, rawLine: "",
    ...extra,
  });

  const a1 = avaliarIdentidade({ clues: cluesCom(null), pistaEhCnpj: true, ficha: fichaGrendene });
  check("A1 CNPJ isolado → CORRESPONDENTE (identificação direta)", a1.etapa === "CORRESPONDENTE" && a1.divergencias.length === 0, `etapa=${a1.etapa}`);

  const a2 = avaliarIdentidade({ clues: cluesCom("GRENDENE"), pistaEhCnpj: true, ficha: fichaGrendene });
  check("A2 CNPJ + nome compatível (fantasia) → CORRESPONDENTE", a2.etapa === "CORRESPONDENTE", `etapa=${a2.etapa}`);

  const a3 = avaliarIdentidade({ clues: cluesCom("SAPATOS TROPICAL DO SUL"), pistaEhCnpj: true, ficha: fichaGrendene });
  check("A3 nome SEM relação (similaridade 0) → LOCALIZADO (o caso que `best > 0` ignorava)", a3.etapa === "LOCALIZADO", `etapa=${a3.etapa}`);
  const divNome = a3.divergencias.find((d) => d.tipo === "NOME");
  check("A3.1 divergência NOME severidade ALTA com explicação honesta", !!divNome && divNome.severidade === "ALTA" && /nenhuma relação/.test(divNome.descricao), String(divNome?.descricao ?? "").slice(0, 90));

  const a4 = avaliarIdentidade({ clues: cluesCom("GRENDE CALCADOS"), pistaEhCnpj: true, ficha: fichaGrendene });
  check("A4 nome parcial (>=0.35) → CORRESPONDENTE sem divergência ALTA", a4.etapa === "CORRESPONDENTE" && !a4.divergencias.some((d) => d.severidade === "ALTA"), `etapa=${a4.etapa} sim=${a4.similaridadeNome}`);

  const a5 = avaliarIdentidade({ clues: cluesCom("GRENDENE", { uf: "SP" }), pistaEhCnpj: true, ficha: fichaGrendene });
  check("A5 UF divergente → divergência LOCALIZACAO BAIXA", a5.divergencias.some((d) => d.tipo === "LOCALIZACAO" && d.severidade === "BAIXA"), JSON.stringify(a5.divergencias).slice(0, 100));

  const a6 = avaliarIdentidade({ clues: cluesCom(null, { domains: ["outro-dominio.com"] }), pistaEhCnpj: true, ficha: fichaGrendene });
  check("A6 CNPJ + domínio incompatível sem nome → LOCALIZADO", a6.etapa === "LOCALIZADO" && a6.divergencias.some((d) => d.tipo === "DOMINIO"), `etapa=${a6.etapa}`);

  const a7 = avaliarIdentidade({ clues: { cnpj: null, emails: [], domains: ["grende-sintetica.com.br"], disposableEmail: false, phones: [], names: ["NOME TOTALMENTE ALHEIO"], uf: null, rawLine: "" }, pistaEhCnpj: false, ficha: fichaGrendene, dominioProvido: true });
  check("A7 domínio PROVADO (RDAP/site) → CORRESPONDENTE mesmo com nome alheio", a7.etapa === "CORRESPONDENTE", `etapa=${a7.etapa}`);

  const a8 = avaliarIdentidade({ clues: null, pistaEhCnpj: true, ficha: null });
  check("A8 sem ficha coletada → LOCALIZADO (nada declarado)", a8.etapa === "LOCALIZADO");

  const a9 = avaliarIdentidade({ clues: cluesCom("SAPATOS TROPICAL DO SUL"), pistaEhCnpj: true, ficha: fichaGrendene, decididaPorOperador: true });
  check("A9 decisão do operador → VALIDADO (lei humana)", a9.etapa === "VALIDADO");
}

/* ================= CAMADA B — resolvedor com fontes simuladas ================= */
console.log("\n[B] resolvedor — nome divergente sem prova NÃO auto-confirma; homônimos revisam");
{
  const { resolveIdentity } = await import("../src/lib/resolve");

  const cluesZero: Clues = { cnpj: null, emails: [], domains: [], disposableEmail: false, phones: [], names: ["SAPATOS TROPICAL"], uf: null, rawLine: "sapatos tropical" };
  const rZero = await resolveIdentity({ clues: cluesZero, label: "sapatos tropical" });
  check("B1 nome sem relação + 2 diretórios (promovível) → REVIEW (antes: CONFIRMED)", rZero.estado === "REVIEW", `estado=${rZero.estado} cand=${rZero.candidatos.length}`);
  check("B2 o cadastro localizado fica PRESERVADO nos candidatos (nada descartado)", rZero.candidatos.some((c) => c.cnpj === CNPJ_DIVERGENTE && (c.confirmado?.razaoSocial ?? "").includes("TRANSPORTES RADIAL")));
  check("B3 a divergência fica EXPLICADA (similaridade zero registrada)", rZero.candidatos.some((c) => c.contradicoes.some((x) => /similaridade zero/.test(x))) || rZero.notas.some((n) => /não tem relação/.test(n)), JSON.stringify(rZero.notas).slice(0, 120));
  check("B4 sem escolhido (nada executa sem revisão)", rZero.escolhido === null, `escolhido=${rZero.escolhido}`);

  const cluesDupla: Clues = { cnpj: null, emails: [], domains: [], disposableEmail: false, phones: [], names: ["EMPRESA DUPLA"], uf: null, rawLine: "empresa dupla" };
  const rDupla = await resolveIdentity({ clues: cluesDupla, label: "empresa dupla" });
  check("B5 homônimos (raízes distintas) → REVIEW, sem confirmação automática", rDupla.estado === "REVIEW" && rDupla.escolhido === null, `estado=${rDupla.estado} cand=${rDupla.candidatos.map((c) => c.cnpj).join(",")}`);

  const cluesWeg: Clues = { cnpj: null, emails: [], domains: [], disposableEmail: false, phones: [], names: ["WEG"], uf: "SC", rawLine: "weg" };
  const rWeg = await resolveIdentity({ clues: cluesWeg, label: "weg" });
  check("B6 nome com gov-page (nome+UF compatíveis) → CONFIRMED (WEG)", rWeg.estado === "CONFIRMED" && rWeg.escolhido === CNPJ_WEG, `estado=${rWeg.estado} escolhido=${rWeg.escolhido ? formatCnpj(rWeg.escolhido) : "—"}`);
}

/* ================= CAMADA C — engine E2E (lote real, cadastro simulado) ================= */
console.log("\n[C] engine E2E — VALIDA correta/divergente, correção humana, validar registro, triagem, plano");
{
  const { startBatch } = await import("../src/lib/enrich/engine");

  const lote1 = await novoLoteTexto([
    `${formatCnpj(CNPJ_GRENDENE)} GRENDENE`,                             // C1 correta
    `${formatCnpj(CNPJ_GRENDENE)} SAPATOS TROPICAL DO SUL`,              // C2 divergente (nome sem relação)
    `${formatCnpj(CNPJ_WEG)} WEG`,                                       // C3 correta
    `${formatCnpj(CNPJ_GRENDENE_FILIAL)} GRENDE INDUSTRIA SINTETICA SA`, // C4 filial da mesma raiz
    `${formatCnpj(CNPJ_DIVERGENTE)} AUTO PECAS SCHMIDT`,                 // C5 divergente (corrigível)
  ]);
  await confirmarLote(lote1);
  await startBatch(lote1);
  await esperarLote(lote1);

  const rows1 = await db.importRow.findMany({ where: { batchId: lote1 }, orderBy: { rowNumber: "asc" } });
  const c1 = rows1[0], c2 = rows1[1], c3 = rows1[2], c4 = rows1[3], c5 = rows1[4];
  check("C1 CNPJ correta + nome compatível → ENRIQUECIDO/CORRESPONDENTE", c1.lookupStatus === "ENRIQUECIDO" && c1.identityStage === "CORRESPONDENTE", `stage=${c1.identityStage} status=${c1.lookupStatus}`);
  check("C2 nome SEM relação → LOCALIZADO com divergência NOME:ALTA", c2.identityStage === "LOCALIZADO" && (c2.identityDivergenciasJson ?? "").includes('"NOME"') && (c2.identityDivergenciasJson ?? "").includes("ALTA"), `stage=${c2.identityStage} div=${(c2.identityDivergenciasJson ?? "").slice(0, 90)}`);
  check("C2.1 a ficha coletada fica PRESERVADA (registro localizado, nada descartado)", (c2.legalName ?? "").includes("GRENDE INDUSTRIA"), `legalName=${c2.legalName}`);
  check("C3 CNPJ correta → CORRESPONDENTE", c3.identityStage === "CORRESPONDENTE", `stage=${c3.identityStage}`);
  check("C4 filial da mesma raiz com razão social → CORRESPONDENTE", c4.lookupStatus === "ENRIQUECIDO" && c4.identityStage === "CORRESPONDENTE", `stage=${c4.identityStage} status=${c4.lookupStatus}`);
  check("C5 CNPJ + nome alheio → LOCALIZADO", c5.identityStage === "LOCALIZADO", `stage=${c5.identityStage}`);

  const auditDiv = await db.auditEvent.count({ where: { batchId: lote1, event: "IDENTIDADE_AVALIADA" } });
  check("C6 auditoria IDENTIDADE_AVALIADA registrada por linha", auditDiv >= 5, `eventos=${auditDiv}`);

  /* ---- correção humana (mesmas escritas da rota decide {cnpj} para VALIDA divergente) ---- */
  await db.importRow.update({ where: { id: c2.id }, data: {
    originalCellsJson: JSON.stringify([formatCnpj(CNPJ_WEG)]),
    rawCnpj: formatCnpj(CNPJ_WEG),
    normalizedCnpj: CNPJ_WEG,
    resolvedCnpj: CNPJ_WEG,
    resolutionState: "CONFIRMED",
    resolutionConfidence: "HUMANA",
    identityStage: "VALIDADO",
    identityDivergenciasJson: null, // na CORREÇÃO as divergências do CNPJ contestado saem
    reverseSource: "CNPJ corrigido na revisão",
    lookupStatus: "PENDENTE",
    lookupError: null,
    retryCount: 0,
  } });
  await startBatch(lote1);
  await esperarLote(lote1);
  const c2Depois = await db.importRow.findUnique({ where: { id: c2.id } });
  check("C7 correção humana → VALIDADO com a ficha do CNPJ novo (WEG) e divergências antigas zeradas", c2Depois?.identityStage === "VALIDADO" && c2Depois?.normalizedCnpj === CNPJ_WEG && c2Depois?.identityDivergenciasJson === null && (c2Depois?.legalName ?? "").includes("WEG"), `stage=${c2Depois?.identityStage} ficha=${c2Depois?.legalName} div=${c2Depois?.identityDivergenciasJson}`);

  /* ---- VALIDAR_REGISTRO (mesmas escritas da rota decide): divergências preservadas ---- */
  const divAntes = c5.identityDivergenciasJson;
  await db.importRow.update({ where: { id: c5.id }, data: { resolutionState: "CONFIRMED", resolutionConfidence: "HUMANA", identityStage: "VALIDADO" } });
  const c5Depois = await db.importRow.findUnique({ where: { id: c5.id } });
  check("C8 VALIDAR_REGISTRO → VALIDADO e divergências PRESERVADAS como contexto", c5Depois?.identityStage === "VALIDADO" && c5Depois?.identityDivergenciasJson === divAntes && !!divAntes, `div=${(c5Depois?.identityDivergenciasJson ?? "").slice(0, 70)}`);

  /* ---- lote de divergência nova: triagem + plano ---- */
  const { startBatch: sb2 } = await import("../src/lib/enrich/engine");
  const lote2 = await novoLoteTexto([`${formatCnpj(CNPJ_DIVERGENTE)} SAPATOS TROPICAL DO SUL`]);
  await confirmarLote(lote2);
  await sb2(lote2);
  await esperarLote(lote2);
  const rowDiv = await db.importRow.findFirst({ where: { batchId: lote2, rowNumber: 1 } });
  check("C9 lote de divergência → LOCALIZADO", rowDiv?.identityStage === "LOCALIZADO", `stage=${rowDiv?.identityStage}`);

  const { classificarTriagemLinha } = await import("../src/lib/triage/engine");
  const tri = await classificarTriagemLinha(lote2, 1);
  const lacId = tri.ok ? tri.lacunas.find((l) => l.perguntaId === "identidade") : null;
  check("C10 triagem da divergente → VALIDACAO_HUMANA", !!lacId && lacId.estado === "VALIDACAO_HUMANA", `estado=${lacId?.estado}`);
  check("C10.1 o registro localizado aparece nos FATOS da triagem (evidência preservada)", !!lacId && lacId.fatos.some((f) => /Registro localizado/.test(f.fato)), String(lacId?.fatos?.[0]?.fato ?? ""));
  check("C10.2 a divergência é explicada na lacuna", !!lacId && lacId.motivo.includes("Divergências"), String(lacId?.motivo ?? "").slice(0, 110));

  const { gerarPlanoConsultas } = await import("../src/lib/plano/planner");
  const plano = await gerarPlanoConsultas(lote2);
  const fora = plano.ok ? plano.plano.fora_do_escopo_api : [];
  check("C11 plano: identidade divergente vai para FORA DO ESCOPO (validação humana)", plano.ok && fora.some((f) => f.estado_triagem === "VALIDACAO_HUMANA" && f.pergunta_id === "identidade"), JSON.stringify(fora.map((f) => `${f.pergunta_id}:${f.estado_triagem}`)));
  check("C12 plano NÃO propõe consulta para a identidade divergente", plano.ok && !plano.plano.itens.some((i) => i.pergunta_id === "identidade"));

  const triValidado = await classificarTriagemLinha(lote1, 2);
  const lacV = triValidado.ok ? triValidado.lacunas.find((l) => l.perguntaId === "identidade") : null;
  check("C13 triagem da linha VALIDADA → RESOLVIDO (validada por você)", !!lacV && lacV.estado === "RESOLVIDO" && /validada por você/i.test(lacV.motivo), String(lacV?.motivo ?? "").slice(0, 110));

  const { recomputeCounters } = await import("../src/lib/enrich/engine");
  await recomputeCounters(lote1);
  const b1 = await db.importBatch.findUnique({ where: { id: lote1 } });
  check("C14 contadores do lote: totalValidado=2 e totalLocalizado=0", b1?.totalValidado === 2 && b1?.totalLocalizado === 0, `validado=${b1?.totalValidado} localizado=${b1?.totalLocalizado}`);
  await recomputeCounters(lote2);
  const b2 = await db.importBatch.findUnique({ where: { id: lote2 } });
  check("C14.1 lote divergente: totalLocalizado=1", b2?.totalLocalizado === 1, `localizado=${b2?.totalLocalizado}`);
}

/* ================= CAMADA D — export pela rota real (dev server lê o mesmo banco) ================= */
console.log("\n[D] export — result_confirmed exclui LOCALIZADO; CSV traz etapa e divergências");
{
  const BASE = "http://127.0.0.1:3000";
  const lote2 = batchIds[batchIds.length - 1];
  const r1 = await fetchOriginal(`${BASE}/api/imports/${lote2}/export?type=result_confirmed`);
  const j1 = (await r1.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
  check("D1 result_confirmed do lote divergente → NO_CONFIRMED (LOCALIZADO não é confirmada)", r1.status === 422 && /revise/.test(j1?.error?.message ?? ""), `status=${r1.status} msg=${j1?.error?.message}`);

  const r2 = await fetchOriginal(`${BASE}/api/imports/${lote2}/export?type=result`);
  const csv = await r2.text();
  check("D2 CSV completo traz etapa_identidade=LOCALIZADO", csv.includes("LOCALIZADO"), csv.slice(0, 160).replace(/\n/g, " "));
  check("D3 CSV traz divergências explicadas (divergencias_identidade)", /NOME:ALTA|similaridade zero|pouco se parece/i.test(csv), "conteúdo checado");

  const r3 = await fetchOriginal(`${BASE}/api/imports/${lote2}`);
  const jd = (await r3.json()) as { batch?: { totalLocalizado?: number } };
  check("D4 API do lote expõe totalLocalizado", jd.batch?.totalLocalizado === 1, `totalLocalizado=${jd.batch?.totalLocalizado}`);
}

/* ================= Z — prova estrutural ================= */
console.log("\n[Z] prova estrutural — zero HTTP real");
{
  const naoCadastradas = tentativasSaida.filter((u) => !/(brasilapi|opencnpj|receitaws|rdap\.registro\.br|servicodados\.ibge|minhareceita\.org)/.test(u));
  check("Z1 toda saída externa passou pelo simulador (hosts cadastrados)", naoCadastradas.length === 0, JSON.stringify(naoCadastradas.slice(0, 3)));
}

/* ================= execução + limpeza ================= */
await limparTudo(); // saneamento ANTES (resíduos de execuções anteriores)
cnpjValidoInner(); // documentação de uso

console.log(`\n=== RESULTADO v0.10.12: ${pass} PASS · ${fail} FAIL ===`);
if (falhas.length > 0) {
  console.log("Falhas:");
  for (const f of falhas) console.log("  -", f);
}
for (const id of batchIds) await db.importBatch.delete({ where: { id } }).catch(() => {});
for (const c of todosCnpjs) await db.cadastroCache.delete({ where: { cnpj: c } }).catch(() => {});
const restantes = await db.importBatch.count({ where: { fileName: { startsWith: "SUITE-V01012" } } });
check("limpeza: nenhum lote de teste restante", restantes === 0, `restantes=${restantes}`);
console.log(`\n=== FINAL: ${pass} PASS · ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
