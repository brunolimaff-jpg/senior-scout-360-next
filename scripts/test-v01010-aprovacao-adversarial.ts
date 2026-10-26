/**
 * test-v01010-aprovacao-adversarial.ts — PROVA CONTRA EXECUÇÃO EXTERNA DUPLICADA
 * (auditoria da v0.10.9, item 3): "teste aprovação simultânea e repetida da mesma
 * consulta, inclusive com duas sessões independentes. Prove que não ocorrem
 * execuções externas duplicadas indevidas."
 *
 * Falha provada na v0.10.9: dois comandos para o MESMO alvo liam a cache em miss
 * e CADA UM disparava a própria chamada externa (check-then-act no nível da fonte).
 * Correção v0.10.10: voo único por alvo (src/lib/single-flight.ts) — a reserva da
 * consulta é atômica com a decisão de consultar.
 *
 * CASOS:
 *   A. aprovação SIMULTÂNEA da mesma consulta (8 comandos, mesmo tick) → UMA chamada.
 *   B. aprovação REPETIDA após a primeira (cache válida) → ZERO chamadas novas.
 *   C. DUAS SESSÕES INDEPENDENTES (cookies de sessão distintos, rota real) → UMA chamada.
 *   D. matriz/filiais concorrente (6 comandos) → cada alvo da fonte consultado UMA vez.
 *   E. revalidação de cadastro concorrente (8 comandos, forceFresh) → cadeia executada UMA vez.
 *   F. falha compartilhada (429 simulado): 5 comandos → UMA chamada, todos recebem
 *      o erro, telemetria honesta (1 consulta + 4 coalescido); retry após falha
 *      faz consulta NOVA (sem cache negativa).
 *   G. quadro de participante concorrente (6 comandos) → UMA chamada por participante.
 *
 * PROVA ESTRUTURAL: globalThis.fetch é substituído por um simulador que CONTA
 * cada tentativa de saída e RECUSA hosts externos não cadastrados — nenhuma
 * chamada real sai da VM (fontes 100% simuladas, exigência da missão).
 *
 * Métricas: latência p50/p95 por onda de comandos, chamadas por alvo,
 * duplicações (= comandos − chamadas), telemetria via consulta/coalescido.
 * Saída: qa/estresse-v0.10.10/aprovacao-adversarial.json · exit 1 se qualquer caso falhar.
 */
import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { db } from "../src/lib/db";
import { aguardarTelemetria } from "../src/lib/telemetry";
import { validateCnpj } from "../src/lib/cnpj";
import { investigarRelacoes, investigarConexao, investigarMatrizFiliais, type GrafoFetcher } from "../src/lib/relations/service";
import { lookupCnpjComCache } from "../src/lib/enrich/cadastro-cache";
import { POST as relacoesPOST } from "../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/route";

/* ---------------- simulador global de fontes (ZERO HTTP real) ---------------- */
const RESPOSTAS_GRAFO = new Map<string, { status: number; json: unknown; delayMs: number }>();
const tentativasSaida: { url: string; chave: string }[] = [];
const fetchOriginal = globalThis.fetch;
const chaveDe = (url: string) => url.replace(/^https?:\/\//i, ""); // host+path (grafo e cadastro não colidem)
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const externo = /^https?:\/\//i.test(url) && !url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1");
  if (!externo) return fetchOriginal(input as never, init); // interno (gateway/testes) passa
  const chave = chaveDe(url);
  tentativasSaida.push({ url, chave });
  const mock = RESPOSTAS_GRAFO.get(chave);
  if (!mock) {
    throw new Error(`SIMULADOR: chamada externa NÃO cadastrada — bloqueada (prova de zero HTTP real): ${url}`);
  }
  if (mock.delayMs > 0) await new Promise((r) => setTimeout(r, mock.delayMs));
  return new Response(JSON.stringify(mock.json), { status: mock.status, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- contadores do fetcher injetado (por alvo) ---------------- */
const chamadasPorAlvo = new Map<string, number>();
function novoFetcher(): GrafoFetcher {
  return async (path, _timeoutMs) => {
    chamadasPorAlvo.set(path, (chamadasPorAlvo.get(path) ?? 0) + 1);
    const mock = RESPOSTAS_GRAFO.get(`grafo.minhareceita.org${path}`);
    if (!mock) return { status: 0, json: null, causa: "rede" };
    if (mock.delayMs > 0) await sleep(mock.delayMs);
    return { status: mock.status, json: mock.json };
  };
}
const fetcher = novoFetcher();

/* ---------------- helpers ---------------- */
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
const nChamadas = (path: string) => chamadasPorAlvo.get(path) ?? 0;
function pXX(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
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

/* ---------------- CNPJs sintéticos (nunca consultados fora da VM) ---------------- */
const cnpjR = cnpjValido("88881001"); // relações (caso A/B)
const cnpjM = cnpjValido("88881002"); // matriz/filiais (caso D)
const cnpjV = cnpjValido("88881003"); // cadastro/revalidar (caso E)
const cnpjS = cnpjValido("88881004"); // duas sessões pela rota (caso C)
const cnpjF = cnpjValido("88881005"); // falha compartilhada 429 (caso F)
const PF1 = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"; // hash 32-hex (formato real da fonte)
const PF2 = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";

/* ---------------- seeds da fonte simulada (formato real: array de linhas) ---------------- */
const relacoesJson = [
  { id: PF1, nome: "SOCIO SINTETICO UM" },
  { id: PF2, nome: "SOCIO SINTETICO DOIS" },
];
RESPOSTAS_GRAFO.set(`grafo.minhareceita.org/${cnpjR}`, { status: 200, json: relacoesJson, delayMs: 60 });
RESPOSTAS_GRAFO.set(`grafo.minhareceita.org/${cnpjS}`, { status: 200, json: relacoesJson, delayMs: 60 });
RESPOSTAS_GRAFO.set(`grafo.minhareceita.org/${cnpjF}`, { status: 429, json: { message: "rate limit simulado" }, delayMs: 40 });
RESPOSTAS_GRAFO.set(`grafo.minhareceita.org/${cnpjM}`, { status: 200, json: relacoesJson, delayMs: 50 });
RESPOSTAS_GRAFO.set(`grafo.minhareceita.org/${PF1}`, { status: 200, json: [{ cnpj: cnpjR, razao_social: "EMPRESA VIA QUADRO UM LTDA" }], delayMs: 30 });
RESPOSTAS_GRAFO.set(`grafo.minhareceita.org/${PF2}`, { status: 200, json: [{ cnpj: cnpjM, razao_social: "EMPRESA VIA QUADRO DOIS LTDA" }], delayMs: 30 });
RESPOSTAS_GRAFO.set("grafo.minhareceita.org/updated", { status: 200, json: { message: "2026-10 (simulado)" }, delayMs: 10 });
// cadastro (BrasilAPI — primeira fonte da cadeia) devolve ficha completa → cadeia termina em 1 HTTP
const fichaBrasilAPI = {
  cnpj: cnpjV,
  razao_social: "EMPRESA SINTETICA CADASTRO LTDA",
  nome_fantasia: "",
  descricao_situacao_cadastral: "ATIVA",
  data_situacao_cadastral: "2020-01-01",
  descricao_tipo_de_logradouro: "AVENIDA",
  logradouro: "SINTETICA",
  numero: "1",
  bairro: "CENTRO",
  municipio: "SAO PAULO",
  uf: "SP",
  cep: "00000000",
  cnae_fiscal_descricao: "Atividades sinteticas",
  cnae_fiscal: 1,
  ddd_telefone_1: "",
  data_inicio_atividade: "2020-01-01",
  capital_social: "1000.00",
  descricao_porte: "DEMAIS",
  opcao_pelo_simples: false,
  qsa: [],
};
RESPOSTAS_GRAFO.set(`brasilapi.com.br/api/cnpj/v1/${cnpjV}`, { status: 200, json: fichaBrasilAPI, delayMs: 40 });
// fontes de CAUDA da cadeia (só seriam chamadas se a primária falhasse — registradas para o simulador)
RESPOSTAS_GRAFO.set(`api.opencnpj.org/${cnpjV}`, { status: 200, json: fichaBrasilAPI, delayMs: 40 });
RESPOSTAS_GRAFO.set(`receitaws.com.br/v1/cnpj/${cnpjV}`, { status: 200, json: fichaBrasilAPI, delayMs: 40 });
RESPOSTAS_GRAFO.set(`minhareceita.org/${cnpjV}`, { status: 200, json: fichaBrasilAPI, delayMs: 40 });

/* ---------------- sessões independentes (modo TOKEN com segredo do teste) ---------------- */
process.env.SCOUT_EXPORT_TOKEN = "token-teste-adversarial-v01010";
const SEGREDO = process.env.SCOUT_EXPORT_TOKEN;
function cookieDeSessao(offsetMs: number): string {
  const ts = (Date.now() + offsetMs).toString(36);
  const sig = createHmac("sha256", SEGREDO).update(ts).digest("hex");
  return `scout_session=${ts}.${sig}`;
}
const SESSAO_A = cookieDeSessao(0);
const SESSAO_B = cookieDeSessao(-60_000); // sessão mais antiga — cookies distintos, ambos válidos
function reqDeSessao(batchId: string, row: number, cookie: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/imports/${batchId}/rows/${row}/relacoes-societarias`, {
    method: "POST",
    headers: { cookie },
  });
}

/* ---------------- telemetria ---------------- */
async function eventosRelacao(cnpj: string): Promise<{ via: string; estado: string; n: number }> {
  // v0.10.11: telemetria é fire-and-forget — assente as escritas pendentes antes
  // de ler, senão a asserção corre contra a gravação (corrida de contagem).
  await aguardarTelemetria();
  const evs = await db.telemetryEvent.findMany({
    where: { tipo: "RELACAO_GRAFO", alvo: cnpj },
    orderBy: { startedAt: "asc" },
  });
  const porVia = new Map<string, { estado: string; n: number }>();
  for (const e of evs) {
    const payload = (() => {
      try { return JSON.parse(e.payloadJson ?? "{}") as { via?: string }; } catch { return {}; }
    })();
    const via = payload.via ?? "(sem via)";
    const atual = porVia.get(via) ?? { estado: e.estadoFinal, n: 0 };
    atual.n += 1;
    porVia.set(via, atual);
  }
  const out = { via: "", estado: "", n: 0 };
  for (const [via, v] of porVia) {
    if (!out.via) { out.via = via; out.estado = v.estado; out.n = v.n; }
    else { out.via += `+${via}`; out.n += v.n; }
  }
  return out;
}

interface OndaResultado {
  ok: boolean[];
  latenciasMs: number[];
}
async function onda<T>(n: number, tarefa: (i: number) => Promise<T>): Promise<OndaResultado & { resultados: (T | null)[]; erros: unknown[] }> {
  const lat: number[] = [];
  const resultados: (T | null)[] = [];
  const erros: unknown[] = [];
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const ini = Date.now();
      try {
        resultados[i] = await tarefa(i);
      } catch (e) {
        erros[i] = e;
        resultados[i] = null;
      }
      lat[i] = Date.now() - ini;
    })
  );
  return { ok: resultados.every((r) => r !== null), latenciasMs: lat, resultados, erros };
}

/* ---------------- suíte ---------------- */
let batchId: string | null = null;
const metrics: Record<string, unknown>[] = [];
let exitCode = 1;
try {
  console.log("=== SUÍTE v0.10.10 — APROVAÇÃO ADVERSARIAL (sem execução externa duplicada) ===");
  const t0 = Date.now();

  // auto-saneamento de resíduos desta suíte
  const velhos = await db.importBatch.findMany({ where: { fileName: "teste-v01010-adversarial.csv" }, select: { id: true } });
  for (const b of velhos) {
    await db.auditEvent.deleteMany({ where: { batchId: b.id } });
    await db.importBatch.delete({ where: { id: b.id } }).catch(() => {});
  }
  await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjR, cnpjM, cnpjV, cnpjS, cnpjF, PF1, PF2] }, tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO", "COLETA_CADASTRO"] } } });
  await db.telemetryEvent.deleteMany({ where: { alvo: { contains: cnpjV }, tipo: "COLETA_CADASTRO" } });
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjR, cnpjM, cnpjS, cnpjF] } } });
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: { in: [PF1, PF2] } } });
  await db.cadastroCache.deleteMany({ where: { cnpj: { in: [cnpjV] } } });
  await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: { in: ["88881002"] } } });

  const agora = new Date();
  const batch = await db.importBatch.create({
    data: {
      fileName: "teste-v01010-adversarial.csv",
      storedPath: "qa/teste-v01010-adversarial.csv",
      fileSize: 42,
      rowCount: 5,
      totalValid: 5,
      status: "DONE",
    },
  });
  batchId = batch.id;
  await db.importRow.createMany({
    data: [
      { batchId, rowNumber: 1, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjR, legalName: "Adversarial R LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 2, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjM, legalName: "Adversarial M LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 3, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjV, legalName: "Adversarial V LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 4, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjS, legalName: "Adversarial S LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 5, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjF, legalName: "Adversarial F LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
    ],
  });

  /* -------- CASO A — aprovação SIMULTÂNEA da mesma consulta (8 comandos) -------- */
  console.log("\n— CASO A: 8 comandos simultâneos, mesma consulta (mesmo tick) —");
  const ondaA = await onda(8, () => investigarRelacoes(batchId!, 1, { fetcher }));
  const aLat = ondaA.latenciasMs;
  check("A.1 todos os 8 comandos bem-sucedidos", ondaA.ok, `erros=${ondaA.erros.length}`);
  check("A.2 UMA única chamada externa para o alvo", nChamadas(`/${cnpjR}`) === 1, `chamadas=${nChamadas(`/${cnpjR}`)}`);
  const totais = new Set((ondaA.resultados as { ok: true; view: { totalParticipantes: number } }[]).map((r) => r!.view.totalParticipantes));
  check("A.3 resultado idêntico para todos", totais.size === 1, `totalParticipantes=${[...totais].join(",")}`);
  const telA = await eventosRelacao(cnpjR);
  check("A.4 telemetria honesta (1 consulta + 7 coalescido)", telA.via.includes("consulta") && telA.via.includes("coalescido") && telA.n === 8, `via=${telA.via} n=${telA.n}`);
  metrics.push({ caso: "A_simultanea_8_comandos", comandos: 8, chamadas_externas: nChamadas(`/${cnpjR}`), duplicacoes: 8 - nChamadas(`/${cnpjR}`), latencia_p50_ms: pXX(aLat, 50), latencia_p95_ms: pXX(aLat, 95) });

  /* -------- CASO B — aprovação REPETIDA após a primeira (cache válida) -------- */
  console.log("\n— CASO B: 2 comandos repetidos após a onda (cache válida) —");
  const antesB = nChamadas(`/${cnpjR}`);
  const rB1 = await investigarRelacoes(batchId!, 1, { fetcher });
  const rB2 = await investigarRelacoes(batchId!, 1, { fetcher });
  check("B.1 repetição NÃO faz chamada nova", nChamadas(`/${cnpjR}`) === antesB, `antes=${antesB} depois=${nChamadas(`/${cnpjR}`)}`);
  check("B.2 resultado servido pela cache", rB1.ok && rB2.ok && rB1.view.via === "cache" && rB2.view.via === "cache", `via=${rB1.ok ? rB1.view.via : "?"}/${rB2.ok ? rB2.view.via : "?"}`);
  metrics.push({ caso: "B_repetida_cache", comandos: 2, chamadas_externas: nChamadas(`/${cnpjR}`) - antesB });

  /* -------- CASO C — DUAS SESSÕES INDEPENDENTES pela rota real -------- */
  console.log("\n— CASO C: duas sessões independentes (cookies distintos) aprovando juntos —");
  // limpa cache do alvo S para começar em miss — a rota vai coalescer pela chave do alvo
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: cnpjS } });
  const reqA = reqDeSessao(batchId!, 4, SESSAO_A);
  const reqB = reqDeSessao(batchId!, 4, SESSAO_B);
  const ondaC = await onda(2, async (i) => await relacoesPOST(i === 0 ? reqA : reqB, { params: Promise.resolve({ id: batchId!, rowNumber: "4" }) }));
  const [respA, respB] = ondaC.resultados as Awaited<ReturnType<typeof relacoesPOST>>[];
  check("C.1 sessão A autorizada e OK", respA!.status === 200, `status=${respA!.status}`);
  check("C.2 sessão B (cookie diferente) autorizada e OK", respB!.status === 200, `status=${respB!.status}`);
  const chamadasS = tentativasSaida.filter((t) => t.url.includes("grafo.minhareceita.org") && t.chave.endsWith(`/${cnpjS}`)).length;
  check("C.3 UMA única chamada externa mesmo com 2 sessões", chamadasS === 1, `chamadas=${chamadasS}`);
  const corpoA = (await respA!.json()) as { relacoes?: { totalParticipantes?: number } };
  const corpoB = (await respB!.json()) as { relacoes?: { totalParticipantes?: number } };
  check("C.4 resposta idêntica nas duas sessões", corpoA.relacoes?.totalParticipantes === 2 && corpoA.relacoes?.totalParticipantes === corpoB.relacoes?.totalParticipantes, `A=${corpoA.relacoes?.totalParticipantes} B=${corpoB.relacoes?.totalParticipantes}`);
  metrics.push({ caso: "C_duas_sessoes_rota", sessoes: 2, chamadas_externas: chamadasS, duplicacoes: 1 });

  /* -------- CASO D — matriz/filiais concorrente (6 comandos) -------- */
  console.log("\n— CASO D: 6 comandos simultâneos de estabelecimentos da raiz —");
  const antesD = new Map(chamadasPorAlvo);
  const ondaD = await onda(6, () => investigarMatrizFiliais(batchId!, 2, { fetcher }));
  check("D.1 todos bem-sucedidos", ondaD.ok, `erros=${ondaD.erros.length}`);
  const dRelacoes = nChamadas(`/${cnpjM}`) - (antesD.get(`/${cnpjM}`) ?? 0);
  const dPf1 = nChamadas(`/${PF1}`) - (antesD.get(`/${PF1}`) ?? 0);
  const dPf2 = nChamadas(`/${PF2}`) - (antesD.get(`/${PF2}`) ?? 0);
  check("D.2 descoberta da PJ consultada UMA vez", dRelacoes === 1, `chamadas=${dRelacoes}`);
  check("D.3 quadro do participante 1 consultado UMA vez", dPf1 === 1, `chamadas=${dPf1}`);
  check("D.4 quadro do participante 2 consultado UMA vez", dPf2 === 1, `chamadas=${dPf2}`);
  check("D.5 ZERO tentativa de saída não cadastrada", tentativasSaida.every((t) => RESPOSTAS_GRAFO.has(t.chave)), `tentativas=${tentativasSaida.length}`);
  metrics.push({ caso: "D_matriz_filiais_6_comandos", comandos: 6, chamadas: { relacoes: dRelacoes, quadro_pf1: dPf1, quadro_pf2: dPf2 }, latencia_p50_ms: pXX(ondaD.latenciasMs, 50), latencia_p95_ms: pXX(ondaD.latenciasMs, 95) });

  /* -------- CASO E — revalidação de cadastro concorrente (8 comandos, forceFresh) --------
   * Prova honesta de não-duplicação: 8 comandos concorrentes custam O MESMO que
   * UM comando isolado (uma cadeia completa = primária + complementações).  */
  console.log("\n— CASO E: 8 revalidações de cadastro simultâneas (cadeia simulada BrasilAPI) —");
  await db.cadastroCache.deleteMany({ where: { cnpj: cnpjV } });
  const baselineAntes = await db.telemetryEvent.count({ where: { tipo: "COLETA_CADASTRO", alvo: { contains: cnpjV } } });
  await lookupCnpjComCache(cnpjV, { forceFresh: true }); // 1 comando isolado — custo BASELINE
  const baseline = (await db.telemetryEvent.count({ where: { tipo: "COLETA_CADASTRO", alvo: { contains: cnpjV } } })) - baselineAntes;
  await db.cadastroCache.deleteMany({ where: { cnpj: cnpjV } });
  const eventosCadastroAntes = await db.telemetryEvent.count({ where: { tipo: "COLETA_CADASTRO", alvo: { contains: cnpjV } } });
  const ondaE = await onda(8, () => lookupCnpjComCache(cnpjV, { forceFresh: true }));
  const comFicha = (ondaE.resultados as { resultado: unknown }[]).filter((r) => r!.resultado !== null).length;
  check("E.1 todos os 8 comandos com ficha", comFicha === 8, `comFicha=${comFicha} erros=${ondaE.erros.length}`);
  const eventosCadastroDepois = await db.telemetryEvent.count({ where: { tipo: "COLETA_CADASTRO", alvo: { contains: cnpjV } } });
  const eventosOnda = eventosCadastroDepois - eventosCadastroAntes;
  check("E.2 8 comandos custam o MESMO que 1 isolado (cadeia executada UMA vez)", eventosOnda === baseline, `onda=${eventosOnda} baseline(1 comando)=${baseline}`);
  const fontesSet = new Set((ondaE.resultados as { resultado: { source: string } | null }[]).map((r) => r!.resultado?.source));
  check("E.3 mesma fonte primária para todos", fontesSet.size === 1 && fontesSet.has("BrasilAPI"), `fontes=${[...fontesSet].join(",")}`);
  metrics.push({ caso: "E_cadastro_8_forceFresh", comandos: 8, eventos_onda: eventosOnda, baseline_1_comando: baseline, latencia_p50_ms: pXX(ondaE.latenciasMs, 50), latencia_p95_ms: pXX(ondaE.latenciasMs, 95) });

  /* -------- CASO F — falha compartilhada (429 simulado) + retry honesto -------- */
  console.log("\n— CASO F: 5 comandos com fonte em 429 → UMA chamada, todos falham; retry = chamada nova —");
  const ondaF = await onda(5, () => investigarRelacoes(batchId!, 5, { fetcher }));
  const fOk = (ondaF.resultados as { ok: boolean; motivo?: string }[]).map((r) => r!.ok);
  const fMotivos = new Set((ondaF.resultados as { motivo?: string }[]).map((r) => r!.motivo));
  check("F.1 todos os 5 recebem a mesma falha", fOk.every((o) => !o) && fMotivos.size === 1 && fMotivos.has("fonte_erro"), `motivos=${[...fMotivos].join(",")}`);
  check("F.2 UMA única chamada mesmo com fonte falhando", nChamadas(`/${cnpjF}`) === 1, `chamadas=${nChamadas(`/${cnpjF}`)}`);
  const telF = await eventosRelacao(cnpjF);
  check("F.3 falha registrada honestamente (consulta+coalescido, estado=falha)", telF.n === 5 && telF.estado === "falha", `via=${telF.via} estado=${telF.estado} n=${telF.n}`);
  const antesRetry = nChamadas(`/${cnpjF}`);
  const retryF = await investigarRelacoes(batchId!, 5, { fetcher });
  check("F.4 retry após falha faz consulta NOVA (sem cache negativa)", !retryF.ok && nChamadas(`/${cnpjF}`) === antesRetry + 1, `Δ=${nChamadas(`/${cnpjF}`) - antesRetry}`);
  metrics.push({ caso: "F_falha_429_compartilhada", comandos: 5, chamadas_externas: 1, duplicacoes: 4, retry_chamada_nova: true });

  /* -------- CASO G — quadro de participante concorrente (6 comandos) -------- */
  console.log("\n— CASO G: 6 expansões simultâneas do mesmo quadro de participante —");
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: PF1 } }); // começa em miss (caso D populou a cache)
  const antesG = nChamadas(`/${PF1}`);
  const ondaG = await onda(6, () => investigarConexao(batchId!, 1, PF1, { fetcher }));
  check("G.1 todos bem-sucedidos", ondaG.ok, `erros=${ondaG.erros.length}`);
  check("G.2 UMA chamada pelo quadro", nChamadas(`/${PF1}`) - antesG === 1, `Δ=${nChamadas(`/${PF1}`) - antesG}`);
  const gVias = new Set((ondaG.resultados as { view: { via: string } }[]).map((r) => r!.view.via));
  check("G.3 resultado servido como consulta (não cache)", gVias.has("consulta"), `vias=${[...gVias].join(",")}`);
  metrics.push({ caso: "G_quadro_participante_6", comandos: 6, chamadas_externas: nChamadas(`/${PF1}`) - antesG, latencia_p50_ms: pXX(ondaG.latenciasMs, 50), latencia_p95_ms: pXX(ondaG.latenciasMs, 95) });

  /* -------- PROVA ESTRUTURAL — nenhuma saída externa não simulada -------- */
  console.log("\n— PROVA ESTRUTURAL —");
  const naoSimuladas = tentativasSaida.filter((t) => !RESPOSTAS_GRAFO.has(t.chave));
  check("Z.1 ZERO chamadas reais (todas as saídas externas passaram pelo simulador)", naoSimuladas.length === 0, `tentativas=${tentativasSaida.length} não simuladas=${naoSimuladas.length}`);
  check("Z.2 voos não vazam após conclusão (sem chave pendurada)", (await import("../src/lib/single-flight")).voosEmCurso().length === 0);

  console.log(`\n=== RESULTADO: ${pass} PASS · ${fail} FAIL (${Date.now() - t0}ms) ===`);
  await Bun.write(
    "qa/estresse-v0.10.10/aprovacao-adversarial.json",
    JSON.stringify({ missao: "auditoria v0.10.9 item 3 — aprovação simultânea/repetida e duas sessões", correcao: "voo único por alvo (src/lib/single-flight.ts)", fontes: "100% simuladas (fetch global interceptado)", casos: metrics, pass, fail, falhas, duracaoMs: Date.now() - t0 }, null, 2)
  );
  exitCode = fail > 0 ? 1 : 0;
} catch (e) {
  console.error("✘✘ ERRO FATAL:", e);
  exitCode = 1;
} finally {
  globalThis.fetch = fetchOriginal;
  delete process.env.SCOUT_EXPORT_TOKEN;
  if (batchId) {
    await db.auditEvent.deleteMany({ where: { batchId } });
    await db.importBatch.delete({ where: { id: batchId } }).catch(() => {});
  }
  await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjR, cnpjM, cnpjV, cnpjS, cnpjF, PF1, PF2] }, tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO", "COLETA_CADASTRO"] } } }).catch(() => {});
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjR, cnpjM, cnpjS, cnpjF] } } }).catch(() => {});
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: { in: [PF1, PF2] } } }).catch(() => {});
  await db.cadastroCache.deleteMany({ where: { cnpj: cnpjV } }).catch(() => {});
  await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: "88881002" } }).catch(() => {});
}
process.exit(exitCode);
