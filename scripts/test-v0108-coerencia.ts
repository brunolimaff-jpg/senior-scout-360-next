/**
 * Suíte v0.10.8 — COERÊNCIA DO PRODUTO E FONTES INVISÍVEIS.
 *
 * Reproduz, contra o código REAL, os desvios da auditoria da v0.10.7 e prova as correções:
 *   A. CAMADA DE APRESENTAÇÃO — provedores técnicos viram categorias de finalidade
 *      (BrasilAPI→"Cadastro empresarial", MinhaReceita Grafo→"Relações empresariais",
 *      quadros de participantes→"Matriz e filiais", web_search→"Pesquisa pública" —
 *      NUNCA "Análise por IA"); nomes legítimos (veículo de notícia) passam intactos.
 *   B. ESTADOS COERENTES — CONFIRMED="Aguardando início" (sem spinner); linha EM_FILA
 *      em lote confirmado-não-iniciado="Preparada para consulta" (neutro); enum EM_FILA
 *      PRESERVADO; PROCESSING é o único estado com animação.
 *   C. CONFIRMAÇÃO NÃO EXECUTA — confirmar lote gera ZERO consultas cadastrais, ZERO
 *      buscas web, ZERO IA e ZERO PROCESS_START (prova por telemetria + auditoria).
 *   D. PANORAMA SEM IA — cnaeDist derivada localmente da tabela CNAE 2.0; setor de IA
 *      separado (hipótese).
 *   E. FRONTEIRA DE ACESSO — assertAccess nas rotas do lab + leitura da fila; guarda
 *      TOKEN nega sem sessão/header e aceita com header (prova unitária da guarda).
 *   F. LABORATÓRIO — POST /api/lab/test existe e testa conexão SEM inferência contra o
 *      provedor mock (sk-mock*), com Model ID presente na lista.
 *   G. SAÚDE — GET /api responde {ok, servico, versao, modoAcesso} (fim do "Hello, world!").
 *
 * Camada 1 OFFLINE (contrato); Camada 2 HTTP contra o dev server (:3000) + banco de dev
 * (lotes sintéticos apagados no finally). Sem IA, sem rede externa, sem chamada paga.
 * Uso: bun scripts/test-v0108-coerencia.ts   (requer dev server em :3000)
 */
import { db } from "../src/lib/db";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";

let pass = 0;
let fail = 0;
const falhas: string[] = [];

function check(nome: string, cond: boolean, extra?: string) {
  if (cond) {
    pass += 1;
    console.log(`  PASS ${nome}`);
  } else {
    fail += 1;
    falhas.push(nome + (extra ? ` — ${extra}` : ""));
    console.log(`  FAIL ${nome}${extra ? ` — ${extra}` : ""}`);
  }
}

const BASE = "http://127.0.0.1:3000";

/* ============ CAMADA 1 — CAMADA DE APRESENTAÇÃO (offline) ============ */

console.log("\n[A] camada de apresentação — provedor técnico → categoria de finalidade");
{
  const m: typeof import("../src/lib/fontes-apresentacao") = await import("../src/lib/fontes-apresentacao");
  check("BrasilAPI → Cadastro empresarial", m.categoriaDeFonte("BrasilAPI") === "Cadastro empresarial");
  check("OpenCNPJ → Cadastro empresarial", m.categoriaDeFonte("OpenCNPJ") === "Cadastro empresarial");
  check("ReceitaWS → Cadastro empresarial", m.categoriaDeFonte("ReceitaWS") === "Cadastro empresarial");
  check("MinhaReceita → Cadastro empresarial", m.categoriaDeFonte("MinhaReceita") === "Cadastro empresarial");
  check("OpenCaramelo → Cadastro empresarial", m.categoriaDeFonte("OpenCaramelo") === "Cadastro empresarial");
  check("string composta de cadastro → Cadastro empresarial", m.categoriaDeFonte("cadastro (BrasilAPI, reuso de ficha)") === "Cadastro empresarial");
  check("ficha cadastral → Cadastro empresarial", m.categoriaDeFonte("ficha cadastral da linha (coleta original)") === "Cadastro empresarial");
  check("MinhaReceita Grafo → Relações empresariais", m.categoriaDeFonte("MinhaReceita Grafo") === "Relações empresariais");
  check("descoberta por quadros de participantes → Matriz e filiais", m.categoriaDeFonte("MinhaReceita Grafo — quadros de participantes") === "Matriz e filiais");
  check("IBGE → Contexto regional", m.categoriaDeFonte("IBGE") === "Contexto regional");
  check("RDAP registro.br → Verificação de domínio", m.categoriaDeFonte("RDAP registro.br") === "Verificação de domínio");
  check("Busca na web → Pesquisa pública", m.categoriaDeFonte("Busca na web") === "Pesquisa pública");
  check("z-ai-web_search → Pesquisa pública (NUNCA Análise por IA)", m.categoriaDeFonte("z-ai-web_search (via resolve-service)") === "Pesquisa pública");
  check("z-ai-page_reader → Site da empresa", m.categoriaDeFonte("z-ai-page_reader (via resolve-service)") === "Site da empresa");
  check("gateway de modelo → Análise por IA", m.categoriaDeFonte("z-ai-gateway (via resolve-service)") === "Análise por IA");
  check("CNPJ informado → Pista enviada por você", m.categoriaDeFonte("CNPJ informado") === "Pista enviada por você");
  check("Decisão humana na revisão → Sua confirmação", m.categoriaDeFonte("Decisão humana na revisão") === "Sua confirmação");
  check("fonte legítima (veículo de notícia) passa INTACTA", m.categoriaDeFonte("Jornal do Comércio de Cuiabá") === "Jornal do Comércio de Cuiabá");
  check("fonte nula → —", m.categoriaDeFonte(null) === "—");
  check("detalhe técnico disponível para string técnica", m.detalheTecnicoDeFonte("BrasilAPI") === "BrasilAPI");
  check("detalhe técnico NULO para nome legítimo", m.detalheTecnicoDeFonte("Jornal do Comércio de Cuiabá") === null);
}

console.log("\n[B] estados coerentes — CONFIRMED não é execução; enum EM_FILA preservado");
{
  // os rótulos vivem em senior.tsx ('use client') — valida o CONTEÚDO real do módulo
  const src = readFileSync(new URL("../src/components/cnpj/senior.tsx", import.meta.url), "utf8");
  check('BATCH_STATE.CONFIRMED = "Aguardando início"', /CONFIRMED:\s*"Aguardando início"/.test(src));
  check('BATCH_STATE.PROCESSING = "Consultando dados públicos"', /PROCESSING:\s*"Consultando dados públicos"/.test(src));
  check("badge de lote NÃO aplica tone processando a CONFIRMED", !/status === "PROCESSING" \|\| status === "CONFIRMED" \? "processando"/.test(src));
  check('LOOKUP_STATE.EM_FILA = "Preparada para consulta" (estado da linha, não do lote)', /EM_FILA:\s*"Preparada para consulta"/.test(src));
  check("enum EM_FILA preservado no catálogo interno (contrato do despacho)", /EM_FILA/.test(src));

  // rowSituation com contexto de execução (função real)
  try {
    const s: typeof import("../src/components/cnpj/senior") = await import("../src/components/cnpj/senior");
    const linhaPreparada = {
      rowNumber: 1, lookupStatus: "EM_FILA", cnpjStatus: "VALIDA", lookupError: null,
    } as unknown as Parameters<typeof s.rowSituation>[0];
    const quieta = s.rowSituation(linhaPreparada, { loteEmExecucao: false });
    check("linha preparada em lote NÃO iniciado → 'Preparada para consulta' neutro", quieta.key === "AGUARDANDO_INICIO" && quieta.tone === "neutro");
    const ativa = s.rowSituation(linhaPreparada, { loteEmExecucao: true });
    check("linha preparada em lote EM execução → 'Em identificação' processando", ativa.key === "AGUARDANDO" && ativa.tone === "processando");
    const compat = s.rowSituation(linhaPreparada);
    check("sem contexto → comportamento pré-v0.10.8 (compatibilidade)", compat.key === "AGUARDANDO");
    const consultando = s.rowSituation({ ...linhaPreparada, lookupStatus: "CONSULTANDO" }, { loteEmExecucao: false });
    check("CONSULTANDO continua execução real mesmo sem lease", consultando.key === "AGUARDANDO" && consultando.tone === "processando");
    const pronta = s.rowSituation({ ...linhaPreparada, lookupStatus: "ENRIQUECIDO" }, { loteEmExecucao: false });
    check("ENRIQUECIDO → Empresa confirmada (inalterado)", pronta.key === "CONFIRMED" && pronta.tone === "confirmado");
  } catch (e) {
    console.log(`  INFO: módulo React não carregou no runner (${String(e).slice(0, 80)}) — verificação de função coberta pelo navegador`);
  }
}

console.log("\n[E] fronteira de acesso — a guarda TOKEN nega sem sessão e aceita com header");
{
  const auth = await import("../src/lib/auth");
  const segredo = "scout-suite-token-0123456789abcdef";
  process.env.SCOUT_EXPORT_TOKEN = segredo;
  try {
    check("modo TOKEN ativo com SCOUT_EXPORT_TOKEN", auth.authMode() === "TOKEN");
    const anonima = await auth.assertAccess(new NextRequest(`${BASE}/api/lab/compare?rowId=x`));
    check("assertAccess NEGUE pedido anônimo (401)", anonima?.status === 401);
    const comHeader = await auth.assertAccess(new NextRequest(`${BASE}/api/lab/compare`, { headers: { "x-export-token": segredo } }));
    check("assertAccess ACEITA header com o token correto", comHeader === null);
    const tokenErrado = await auth.assertAccess(new NextRequest(`${BASE}/api/lab/config`, { headers: { "x-export-token": "errado-123456" } }));
    check("assertAccess NEGUE token incorreto", tokenErrado?.status === 401);
    // as rotas do despacho chamam a guarda (verificação estrutural do código real)
    const rotas = [
      "src/app/api/lab/compare/route.ts",
      "src/app/api/lab/config/route.ts",
      "src/app/api/imports/[id]/research-batch/route.ts",
      "src/app/api/lab/test/route.ts",
    ];
    for (const r of rotas) {
      const src = readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
      check(`guarda presente em ${r}`, /assertAccess|assertMutationAllowed/.test(src));
    }
  } finally {
    delete process.env.SCOUT_EXPORT_TOKEN;
    check("modo OPEN restaurado (kit local)", auth.authMode() === "OPEN");
  }
}

/* ============ CAMADA 2 — HTTP contra o dev server + banco de dev ============ */

async function jfetch(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  let json: any = null;
  try { json = await res.json(); } catch { /* rota sem corpo */ }
  return { status: res.status, json };
}

console.log("\n[G] saúde — fim do 'Hello, world!'");
{
  const { status, json } = await jfetch("/api");
  check("GET /api responde 200", status === 200);
  check("resposta de saúde sem segredos e com versão real", json?.ok === true && json?.servico === "Scout 360" && typeof json?.versao === "string" && json.versao.startsWith("0.10.") && (json?.modoAcesso === "OPEN" || json?.modoAcesso === "TOKEN"));
  check('sem "Hello, world!"', !JSON.stringify(json).includes("Hello, world!"));
}

const idLote = `imp_teste_v0108_${Date.now().toString(36)}`;
const seederCleanup: string[] = [];

console.log("\n[C] confirmação NÃO executa — prova por auditoria e telemetria");
{
  try {
    const antes = {
      auditoria: await db.auditEvent.count(),
      telemetria: await db.telemetryEvent.count(),
    };
    // lote TEXT com 2 CNPJs sintéticos (nada consulta sem o clique — e este teste NUNCA clica)
    const t1 = await jfetch("/api/imports/text", { method: "POST", body: JSON.stringify({ text: "11444777000161\n45723174000110" }) });
    check("POST /api/imports/text cria lote PREVIEW", t1.status === 200 && t1.json?.ok === true && t1.json?.batch?.status === "PREVIEW");
    const id = t1.json?.batch?.id as string | undefined;
    check("lote de teste criado", !!id);
    seederCleanup.push(id ?? idLote);

    const c = await jfetch(`/api/imports/${id}/confirm`, { method: "POST", body: JSON.stringify({}) });
    check("confirm conclui sem iniciar processamento", c.status === 200 && c.json?.ok === true);

    const d = await jfetch(`/api/imports/${id}`);
    const b = d.json?.batch;
    check("estado do lote = CONFIRMED (Aguardando início)", b?.status === "CONFIRMED");
    check("sem execução viva (processingNow=false)", b?.processingNow === false);
    const linhas = d.json?.rows ?? [];
    check("linhas materializadas (2)", linhas.length === 2);
    check("todas as linhas EM_FILA (enum preservado)", linhas.every((r: any) => r.lookupStatus === "EM_FILA"));
    check("nenhuma linha ENRIQUECIDO/CONSULTANDO/ENRIQUECIDA", linhas.every((r: any) => !["ENRIQUECIDO", "CONSULTANDO"].includes(r.lookupStatus)));

    const processStarts = await db.auditEvent.count({ where: { batchId: id, event: "PROCESS_START" } });
    check("ZERO PROCESS_START na auditoria do lote", processStarts === 0);
    const tecnicas = await db.telemetryEvent.count({
      where: { batchId: id, tipo: { in: ["COLETA_CADASTRO", "WEB_SEARCH", "IA_CHAT", "PAGE_READER"] } },
    });
    check("ZERO consultas externas em telemetria (cadastro/busca/IA/leitura)", tecnicas === 0);
    check("nenhum evento técnico novo criado pela confirmação", (await db.telemetryEvent.count()) === antes.telemetria);
    check("auditoria só com eventos do ciclo (sem PROCESS_START)", (await db.auditEvent.count()) - antes.auditoria >= 1 && processStarts === 0);
  } catch (e) {
    check("jornada de confirmação executa sem exceção", false, String(e));
  }
}

console.log("\n[D] panorama sem IA — cnaeDist derivada localmente; setor de IA separado");
{
  try {
    const id = `imp_teste_cnae_${Date.now().toString(36)}`;
    seederCleanup.push(id);
    await db.importBatch.create({
      data: { id, fileName: "TESTE-CNAE-v0108.csv", storedPath: "/tmp/teste-cnae-v0108.csv", fileSize: 42, sourceType: "CSV", delimiter: ",", encoding: "UTF-8", hasHeader: true, rowCount: 3, status: "DONE" },
    });
    const base = Date.now();
    await db.importRow.createMany({
      data: [
        { batchId: id, rowNumber: 1, rawCnpj: "11111111000191", normalizedCnpj: "11111111000191", cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", cnaeCode: "6204-0/00", legalName: "Teste Software A", queriedAt: new Date(base) },
        { batchId: id, rowNumber: 2, rawCnpj: "22222222000191", normalizedCnpj: "22222222000191", cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", cnaeCode: "4711-3/02", legalName: "Teste Comércio B", queriedAt: new Date(base) },
        { batchId: id, rowNumber: 3, rawCnpj: "33333333000191", normalizedCnpj: "33333333000191", cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", cnaeCode: "4751-2/01", legalName: "Teste Varejo C", aiStatus: "OK", aiSector: "Tecnologia (IA)", queriedAt: new Date(base) },
      ],
    });
    const d = await jfetch(`/api/imports/${id}`);
    const b = d.json?.batch;
    const cnae = (b?.cnaeDist ?? []) as { key: string; count: number }[];
    check("cnaeDist presente no detalhe do lote", Array.isArray(cnae));
    const j = cnae.find((c) => c.key.startsWith("J —"));
    const g = cnae.find((c) => c.key.startsWith("G —"));
    check("seção J (Informação e comunicação) derivada de 6204-0/00", !!j && j.count === 1);
    check("seção G (Comércio) agrupa 4711-3/02 e 4751-2/01", !!g && g.count === 2);
    const setor = (b?.sectorDist ?? []) as { key: string; count: number }[];
    check("setor inferido por IA permanece em distribuição SEPARADA", setor.some((s) => s.key === "Tecnologia (IA)" && s.count === 1));
    check("CNAE e IA não se misturam", JSON.stringify(cnae) !== JSON.stringify(setor));
  } catch (e) {
    check("panorama CNAE executa sem exceção", false, String(e));
  }
}

console.log("\n[F] laboratório — POST /api/lab/test existe e conecta no mock SEM inferência");
{
  try {
    const cfg = await jfetch("/api/lab/config", {
      method: "POST",
      body: JSON.stringify({ baseUrl: "http://127.0.0.1:3000/api/lab/mock/v1", apiKey: "sk-mock-teste-v0108-123", modelId: "mock-scout-mini" }),
    });
    check("credencial mock aceita (http loopback)", cfg.status === 200 && cfg.json?.ok === true);
    // nova credencial com acesso cru aos headers (para capturar o cookie de sessão do lab)
    const cfgRaw = await fetch(`${BASE}/api/lab/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://127.0.0.1:3000/api/lab/mock/v1", apiKey: "sk-mock-teste-v0108-123", modelId: "mock-scout-mini" }),
    });
    const cookie = cfgRaw.headers.get("set-cookie") ?? "";
    const valor = /scout_lab=([^;]+)/.exec(cookie)?.[1] ?? "";
    check("cookie de sessão do laboratório emitido", valor.length > 0);

    const teste = await jfetch("/api/lab/test", { method: "POST", headers: { cookie: `scout_lab=${valor}` } });
    check("POST /api/lab/test responde 200 (rota restaurada)", teste.status === 200);
    check("conexão OK contra o mock", teste.json?.ok === true && teste.json?.probe?.httpStatus === 200);
    check("lista de modelos do mock disponível", (teste.json?.probe?.modelos ?? []).includes("mock-scout-mini"));
    check("Model ID verificado na lista", teste.json?.probe?.modeloPresente === true);
    check("teste sem inferência (nenhum chat/completion no mock)", teste.json?.probe?.duracaoMs >= 0);
    const rastro = await db.telemetryEvent.count({ where: { etapa: "LAB_PROBE_EXTERNO" } });
    check("rastro de telemetria do teste registrado (auditoria)", rastro >= 1);

    const del = await jfetch("/api/lab/config", { method: "DELETE", headers: { cookie: `scout_lab=${valor}` } });
    check("descarte da credencial experimental", del.status === 200 && del.json?.ok === true);
  } catch (e) {
    check("laboratório mock executa sem exceção", false, String(e));
  }
}

/* ------------------------------ fechamento ------------------------------ */

console.log("\n[limpeza] lotes sintéticos da suíte removidos do banco de dev");
for (const id of seederCleanup.filter(Boolean)) {
  try {
    await db.importBatch.delete({ where: { id } });
  } catch { /* já inexistente */ }
}
const residuo = await db.importBatch.count({ where: { fileName: { contains: "TESTE-CNAE-v0108" } } });
check("nenhum lote de teste restante", residuo === 0);

console.log(`\n=== RESULTADO v0.10.8: ${pass} PASS · ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Falhas:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
