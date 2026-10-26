/**
 * auditoria-acesso-v01011.ts — FRENTE 4 do despacho "Evolução para Piloto Comercial".
 *
 * Auditoria de acesso e isolamento ENTRE SESSÕES, com evidência em JSON:
 *
 *  A. Modo REAL de autenticação da VM (HTTP /api/auth/session + /api).
 *  B. Estrutura: existe identidade individual? (schema Prisma) — e TODAS as rotas
 *     de dados têm guarda server-side? (varredura de código, não ocultação visual).
 *  C. Modo TOKEN em processo: anônimo é NEGADO nas rotas representativas (leitura,
 *     escrita, export, plano, lab); header correto é ACEITO; cookie inválido NEGADO.
 *  D. Duas sessões independentes com o MESMO token compartilhado: ambas acessam o
 *     MESMO lote — prova de que o modelo atual NÃO isola usuários (workspace único).
 *  E. Laboratório: gate server-side (OPEN abre; TOKEN fecha por padrão; "0" fecha
 *     sempre; TOKEN+flag passa no gate e ainda assim exige autorização).
 *  F. Arquivos públicos: nada de segredos/código distribuível/db em public/.
 *  G. Veredito estruturado: isolamento multiusuário NÃO COMPROVADO → liberação
 *     corporativa BLOQUEADA enquanto não houver camada de identidade.
 *
 * Regra da casa: exit 1 em qualquer divergência — PASS só com evidência.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";

const BASE = process.env.SCOUT_BASE ?? "http://127.0.0.1:3000";
const ROOT = join(import.meta.dir, "..");
const QA_DIR = join(ROOT, "qa");

let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(desc: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS ${desc}`);
  } else {
    fail++;
    falhas.push(desc);
    console.log(`  FAIL ${desc}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 200)}` : ""}`);
  }
}

async function jfetch(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  let json: any = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, json };
}

/* ============================ A — MODO REAL DA VM ============================ */

console.log("\n[A] Modo REAL de autenticação da VM (HTTP)");
{
  const sess = await jfetch("/api/auth/session");
  check("GET /api/auth/session responde 200", sess.status === 200, sess.status);
  const modo = sess.json?.authMode;
  check("modo visível e explícito (OPEN | TOKEN)", modo === "OPEN" || modo === "TOKEN", modo);
  console.log(`    → modo efetivo da VM: ${modo}${modo === "OPEN" ? " (ambiente de desenvolvimento — todas as rotas de dados abertas, decisão documentada)" : " (modo TOKEN — fechado sem sessão)"}`);

  const root = await jfetch("/api");
  check("GET /api expõe só saúde/versão/modo (sem segredos)", root.status === 200 && root.json?.servico === "Scout 360" && !("token" in (root.json ?? {})));
}

/* ===================== B — ESTRUTURA: IDENTIDADE E GUARDAS ===================== */

console.log("\n[B] Estrutura: identidade individual e guardas server-side");
{
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  const modelos = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
  check("NENHUM modelo de usuário/identidade no banco (User/Account/Session/Profile)",
    !modelos.some((m) => /user|account|session|profile|member/i.test(m)), modelos);
  console.log(`    → modelos: ${modelos.join(", ")}`);

  // varredura de TODAS as rotas de API — toda rota de dados precisa chamar a guarda
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) out.push(...walk(p));
      else if (e === "route.ts") out.push(p);
    }
    return out;
  }
  const rotas = walk(join(ROOT, "src/app/api"));
  const isenta = (r: string) =>
    r.endsWith("src/app/api/route.ts") || // saúde/versão (sem segredo)
    r.endsWith(`api${join.sep}auth${join.sep}session${join.sep}route.ts`) || // estado de sessão (sem segredo)
    r.replace(/\\/g, "/").endsWith("api/auth/session/route.ts");
  const semGuarda: string[] = [];
  for (const r of rotas) {
    const src = readFileSync(r, "utf8");
    if (isenta(r)) continue;
    if (!/assertAccess|assertExportAllowed|assertMutationAllowed|labEnabled/.test(src)) semGuarda.push(r);
  }
  check("TODAS as rotas de dados chamam a guarda server-side (assertAccess/lab gate)", semGuarda.length === 0, semGuarda);
  console.log(`    → rotas verificadas: ${rotas.length} (isentas por design: saúde e estado de sessão)`);
}

/* ==================== C — MODO TOKEN EM PROCESSO (guarda real) ==================== */

console.log("\n[C] Modo TOKEN em processo — guarda nega anônimo, aceita token correto");
{
  const auth = await import("../src/lib/auth");
  const segredo = "scout-auditoria-acesso-0123456789ab";
  process.env.SCOUT_EXPORT_TOKEN = segredo;
  try {
    check("authMode() === TOKEN com SCOUT_EXPORT_TOKEN", auth.authMode() === "TOKEN");

    const rotasProva: Array<[string, string, RequestInit?]> = [
      ["leitura", "/api/imports"],
      ["escrita", "/api/imports/text", { method: "POST", body: JSON.stringify({ text: "x" }) }],
      ["export", "/api/imports/export-all"],
      ["plano", "/api/imports/00000000-0000-0000-0000-000000000000/plano"],
    ];
    for (const [tipo, rota, init] of rotasProva) {
      const negado = await auth.assertAccess(new NextRequest(`${BASE}${rota}`, init as RequestInit));
      check(`anônimo NEGADO (${tipo}) — 401`, negado?.status === 401, negado?.status);
    }

    const comHeader = await auth.assertAccess(new NextRequest(`${BASE}/api/imports`, { headers: { "x-export-token": segredo } }));
    check("header x-export-token correto ACEITO", comHeader === null);

    const headerErrado = await auth.assertAccess(new NextRequest(`${BASE}/api/imports`, { headers: { "x-export-token": "errado-0000000000000000" } }));
    check("header com token ERRADO NEGADO", headerErrado?.status === 401);

    // duas sessões INDEPENDENTES via cookie assinado — mesmo token compartilhado
    // (pausa entre emissões: o cookie assina um timestamp em ms)
    const cookieA = (await auth.tryIssueSession(segredo))!;
    await new Promise((r) => setTimeout(r, 5));
    const cookieB = (await auth.tryIssueSession(segredo))!;
    check("sessão A emitida (cookie httpOnly assinado)", !!cookieA && cookieA.startsWith("scout_session="));
    check("sessão B emitida (independente da A)", !!cookieB && cookieB !== cookieA);

    const cookieInvalido = "scout_session=999.firma-invalida";
    const negadoCookie = await auth.assertAccess(new NextRequest(`${BASE}/api/imports`, { headers: { cookie: cookieInvalido } }));
    check("cookie FORJADO/inválido NEGADO", negadoCookie?.status === 401);

    const aceitoA = await auth.assertAccess(new NextRequest(`${BASE}/api/imports`, { headers: { cookie: cookieA.split(";")[0]! } }));
    const aceitoB = await auth.assertAccess(new NextRequest(`${BASE}/api/imports`, { headers: { cookie: cookieB.split(";")[0]! } }));
    check("sessão A ACEITA", aceitoA === null);
    check("sessão B ACEITA (mesmo token compartilhado — workspace único POR DESIGN)", aceitoB === null);
  } finally {
    delete process.env.SCOUT_EXPORT_TOKEN;
  }
  check("modo OPEN restaurado", auth.authMode() === "OPEN");
}

/* ============== D — DUAS SESSÕES CONTRA A VM REAL (workspace único) ============== */

console.log("\n[D] Duas sessões contra a VM real — prova do workspace compartilhado");
let loteId: string | null = null;
{
  // cliente 1 cria lote sintético (sem processamento — zero consulta externa)
  const c1 = await jfetch("/api/imports/text", { method: "POST", body: JSON.stringify({ text: "Auditoria A — Petrobras 33.000.167/0001-01\nAuditoria B — sem cnpj, só nome sintético" }) });
  check("sessão 1 cria lote sintético (200)", c1.status === 200 && !!c1.json?.batch?.id, c1.status);
  loteId = c1.json?.batch?.id ?? null;

  if (loteId) {
    // cliente 2 — SEM nenhum cookie vindo do cliente 1 — lê o mesmo lote
    // (contrato real: GET /api/imports/:id devolve { ok, batch })
    const c2 = await jfetch(`/api/imports/${loteId}`);
    check("sessão 2 (sem cookie da 1) LÊ o lote da sessão 1 → workspace único por design", c2.status === 200 && c2.json?.batch?.id === loteId, c2.status);

    // e a lista de lotes também é compartilhada
    const lista = await jfetch("/api/imports");
    const ids = (lista.json?.batches ?? lista.json?.items ?? []).map((b: any) => b.id);
    check("lista de lotes é COMUM às duas sessões (sem isolamento individual)", Array.isArray(ids) && ids.includes(loteId));
  } else {
    check("lote sintético criado para o teste D", false, c1.json);
  }
}

/* ==================== E — LABORATÓRIO: GATE SERVER-SIDE ==================== */

console.log("\n[E] Laboratório — gate server-side (não ocultação visual)");
{
  const lab = await import("../src/lib/lab/vault");
  const auth = await import("../src/lib/auth");

  // 1) modo OPEN atual da VM: laboratório habilitado (ambiente de desenvolvimento)
  check("OPEN → labEnabled() === true (dev/kit local)", lab.labEnabled() === true);

  // 2) modo TOKEN: FECHADO por padrão
  process.env.SCOUT_EXPORT_TOKEN = "scout-auditoria-acesso-0123456789ab";
  check("TOKEN sem flag → labEnabled() === false (corporativo fecha por padrão)", lab.labEnabled() === false);
  // 3) modo TOKEN + flag explícita: abre (decisão do operador)
  process.env.SCOUT_LAB_ENABLED = "1";
  check("TOKEN + SCOUT_LAB_ENABLED=1 → aberto por decisão explícita", lab.labEnabled() === true);
  // 4) "0" desliga SEMPRE
  process.env.SCOUT_LAB_ENABLED = "0";
  check("SCOUT_LAB_ENABLED=0 → FECHADO em qualquer modo", lab.labEnabled() === false);
  delete process.env.SCOUT_LAB_ENABLED;
  delete process.env.SCOUT_EXPORT_TOKEN;

  // 5) UI: o painel do laboratório NÃO está mais na página principal
  const page = readFileSync(join(ROOT, "src/app/page.tsx"), "utf8");
  check("jornada comercial: LabPanel REMOVIDO da página principal", !/LabPanel/.test(page));

  // 6) rotas do lab têm o gate ANTES da guarda (estrutura do código real;
  //    comparação pela CHAMADA assertAccess( — a linha de import não conta)
  for (const r of [
    "src/app/api/lab/config/route.ts",
    "src/app/api/lab/test/route.ts",
    "src/app/api/lab/compare/route.ts",
    "src/app/api/lab/mock/v1/[[...path]]/route.ts",
  ]) {
    const src = readFileSync(join(ROOT, r), "utf8");
    const gateIdx = src.indexOf("labEnabled()");
    const guardIdx = src.indexOf("assertAccess(");
    check(`gate presente em ${r.split("/").slice(-3).join("/")}`, gateIdx > -1);
    if (guardIdx > -1) check(`gate ANTES da guarda em ${r.split("/").slice(-3).join("/")}`, gateIdx > -1 && gateIdx < guardIdx);
  }
}

/* ==================== F — ARQUIVOS PÚBLICOS SEM SEGREDO ==================== */

console.log("\n[F] Área pública sem segredos, banco ou código distribuível");
{
  function walk(dir: string, base: string): string[] {
    const out: string[] = [];
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
      const p = join(dir, e);
      const rel = join(base, e);
      const s = statSync(p);
      if (s.isDirectory()) out.push(...walk(p, rel));
      else out.push(rel);
    }
    return out;
  }
  const publicos = walk(join(ROOT, "public"), "public");
  const proibidos = publicos.filter((f) =>
    /\.(db|sqlite|sql|env|pem|key|zip)$|scout-token|worklog|\.ts$|\.tsx$/.test(f.replace(/\\/g, "/"))
  );
  check(`public/ só com ativos de interface (${publicos.length} arquivos) — 0 db/segredo/zip/código`, proibidos.length === 0, proibidos);

  // e o ZIP legado não é mais servido (a URL antiga morreu)
  const zipUrl = await fetch(`${BASE}/Senior-Scout-360-kit-dev.zip`);
  check("URL antiga do kit dev NÃO serve mais o pacote (404)", zipUrl.status === 404, zipUrl.status);
  await zipUrl.body?.cancel().catch(() => {});
}

/* ==================== G — LIMPEZA E VEREDITO ==================== */

console.log("\n[G] Limpeza do lote de auditoria e veredito");
{
  if (loteId) {
    const del = await jfetch(`/api/imports/${loteId}`, { method: "DELETE" });
    check("lote sintético arquivado (limpeza)", del.status === 200, del.status);
  }
}

const veredito = {
  modoReal: "OPEN no preview (documentado) — TOKEN é o modo corporativo",
  identidadeIndividual: "AUSENTE — token compartilhado, workspace único (sem User no schema)",
  isolamentoEntreUsuarios: "NÃO COMPROVADO — duas sessões com o mesmo token compartilham tudo, por design",
  labDaJornadaComercial: "REMOVIDO da UI + gate server-side (TOKEN fecha por padrão; SCOUT_LAB_ENABLED controla)",
  guardasServerSide: "TODAS as rotas de dados com assertAccess (varredura estrutural)",
  areaPublica: "0 segredos / 0 banco / 0 zip / 0 código-fonte em public/",
  recomendacao: "BLOQUEADO para liberação corporativa multiusuário até haver camada de identidade individual; piloto restrito a workspace único controlado (TOKEN), com dados sintéticos ou públicos permitidos",
  bloqueiosExplicitos: [
    "sem identidade individual → não há 'meus lotes' nem atribuição por pessoa",
    "sem separação de permissões → qualquer sessão válida lê/escreve/arquiva TUDO",
    "sem auditoria por usuário → eventos registrados sem 'quem'",
    "lab exige SCOUT_LAB_ENABLED=1 explícito em modo TOKEN (padrão: fechado)",
  ],
};

writeFileSync(join(QA_DIR, "auditoria-acesso-v01011.json"), JSON.stringify({
  rodada: "v0.10.11 — evolução para piloto comercial",
  data: new Date().toISOString(),
  base: BASE,
  checks: { pass, fail },
  falhas,
  veredito,
}, null, 2));

console.log(`\n${"=".repeat(64)}`);
console.log(`AUDITORIA DE ACESSO: ${pass} PASS · ${fail} FAIL`);
if (fail > 0) {
  console.log("FALHAS:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("VEREDITO GRAVADO: qa/auditoria-acesso-v01011.json");
