/**
 * test-v01024-lab-route.ts — GATE do desvio 1 do parecer do checkpoint v0.10.23.
 *
 * Prova comportamental da rota POST /api/lab/test ("Testar conexão") restaurada,
 * nos estados exigidos pelo despacho — habilitado E desabilitado — SEM INFERÊNCIA
 * (a rota só faz GET {base}/models; nenhum chat/completion é chamado aqui):
 *
 *   L1  SCOUT_LAB_ENABLED=0 ................ 404 LAB_INDISPONIVEL (área fechada)
 *   L2  modo TOKEN sem flag ................ labEnabled() === false (gate server-side)
 *   L3  OPEN sem credencial ................ 400 LAB_NAO_CONFIGURADO (forma vazia do probe)
 *   L4  OPEN + provedor MOCK em loopback ... 200 ok:true, modeloPresente=true (zero rede externa)
 *   L5  provedor recusa (401) .............. 200 ok:false CONEXAO_FALHOU; a chave NUNCA
 *                                            aparece no corpo nem na mensagem
 *   L6  2xx sem lista utilizável ........... ok:true, modelos=[], modeloPresente=null (indeciso, honesto)
 *   L7  redactKey .......................... chave substituída por *** (defesa em profundidade)
 *   L8  telemetria ......................... LAB_PROBE_EXTERNO gravado com inferencia:false,
 *                                            tokens:0 — em BANCO ISOLADO (/tmp)
 *
 * Banco ISOLADO criado pelo próprio script (push do schema em /tmp) — nenhum dado
 * do operador é lido ou escrito. Zero IA. Única rede: 127.0.0.1 (mock local).
 *
 * Rodar: bun scripts/test-v01024-lab-route.ts
 */
import { execSync } from "child_process";
import { rmSync } from "fs";

const DB_ISOLADO = "/tmp/lab-test-v01024.db";
const DB_JOURNAL = "/tmp/lab-test-v01024.db-journal";

// 0) banco isolado: schema novo em arquivo limpo (fora do banco do operador)
for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
execSync(`DATABASE_URL="file:${DB_ISOLADO}" bunx prisma db push --skip-generate`, { cwd: process.cwd(), stdio: "pipe" });

// env ANTES dos imports dinâmicos: o cliente Prisma resolve a URL no momento da criação
process.env.DATABASE_URL = `file:${DB_ISOLADO}`;
delete process.env.SCOUT_EXPORT_TOKEN;
delete process.env.SCOUT_AUTH_REQUIRED;

const { POST } = await import("../src/app/api/lab/test/route");
const { NextRequest } = await import("next/server");
type NextReq = InstanceType<typeof NextRequest>;
const { LAB_COOKIE, setLabConfig, redactKey, labEnabled } = await import("../src/lib/lab/vault");
const { db } = await import("../src/lib/db");

let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${nome}`);
  } else {
    fail++;
    falhas.push(nome);
    console.log(`  FAIL  ${nome}${extra ? ` — ${extra}` : ""}`);
  }
}

function reqComCookie(cookieValue?: string): NextReq {
  const headers: Record<string, string> = {};
  if (cookieValue) headers.cookie = `${LAB_COOKIE}=${cookieValue}`;
  return new NextRequest("http://localhost:3000/api/lab/test", { method: "POST", headers });
}

/** Provedor mock em loopback — porta efêmera, nenhuma rede externa.
 *  (acesso ao runtime Bun via globalThis: o tsconfig do kit não instala @types/bun) */
interface MockServidor {
  port: number;
  stop: (force?: boolean) => void;
}
function mockProvider(status: number, corpo: unknown): { url: string; parar: () => void } {
  const runtime = globalThis as unknown as { Bun?: { serve: (o: { port?: number; hostname?: string; fetch: (req: Request) => Response }) => MockServidor } };
  if (!runtime.Bun) throw new Error("runtime Bun ausente — a suíte roda com bun");
  const servidor = runtime.Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      status === 200
        ? Response.json(corpo as Record<string, unknown>)
        : new Response(JSON.stringify(corpo ?? null), { status }),
  });
  return { url: `http://127.0.0.1:${servidor.port}`, parar: () => servidor.stop(true) };
}

async function main() {
  console.log("== test-v01024 — POST /api/lab/test (sem inferência) ==\n");

  // L1 — laboratório fechado por flag explícita
  process.env.SCOUT_LAB_ENABLED = "0";
  const r1 = await POST(reqComCookie());
  const j1 = await r1.json();
  check("L1 SCOUT_LAB_ENABLED=0 → 404 LAB_INDISPONIVEL", r1.status === 404 && j1?.error?.code === "LAB_INDISPONIVEL", `status=${r1.status} corpo=${JSON.stringify(j1)}`);

  // L2 — modo TOKEN sem flag: gate server-side fecha por padrão
  delete process.env.SCOUT_LAB_ENABLED;
  process.env.SCOUT_EXPORT_TOKEN = "segredo-audit-0001";
  const l2 = labEnabled();
  check("L2 modo TOKEN sem flag → labEnabled() === false", l2 === false);
  delete process.env.SCOUT_EXPORT_TOKEN;

  // L3 — OPEN sem credencial da sessão
  const r3 = await POST(reqComCookie());
  const j3 = await r3.json();
  check(
    "L3 OPEN sem credencial → 400 LAB_NAO_CONFIGURADO com probe vazio honesto",
    r3.status === 400 &&
      j3?.code === "LAB_NAO_CONFIGURADO" &&
      JSON.stringify(j3?.probe) === JSON.stringify({ modeloSolicitado: "", modelos: [], modeloPresente: null, duracaoMs: 0, httpStatus: null }),
    `status=${r3.status} corpo=${JSON.stringify(j3)}`
  );

  // L4 — OPEN + provedor mock em loopback: conexão OK, modelo presente
  const mockOk = mockProvider(200, { data: [{ id: "modelo-teste-mock" }] });
  const cfgOk = setLabConfig({ baseUrl: mockOk.url, apiKey: "chave-mock-1234567890", modelId: "modelo-teste-mock" });
  if (!cfgOk.ok) {
    check("L4 configuração do mock aceita (loopback http)", false, cfgOk.message);
  } else {
    const r4 = await POST(reqComCookie(cfgOk.cookieValue));
    const j4 = await r4.json();
    check(
      "L4 conexão com provedor mock → ok:true, modeloPresente=true",
      r4.status === 200 && j4?.ok === true && j4?.probe?.modeloPresente === true && j4?.probe?.modelos?.includes("modelo-teste-mock") === true && j4?.probe?.httpStatus === 200,
      `status=${r4.status} corpo=${JSON.stringify(j4)}`
    );

    // L5 — provedor recusa a credencial (401): falha é RESULTADO, chave nunca vaza
    const mock401 = mockProvider(401, { error: { message: "chave-mock-1234567890 inválida" } });
    const cfg401 = setLabConfig({ baseUrl: mock401.url, apiKey: "chave-mock-1234567890", modelId: "modelo-teste-mock" });
    if (!cfg401.ok) {
      check("L5 configuração do mock 401 aceita", false, cfg401.message);
    } else {
      const r5 = await POST(reqComCookie(cfg401.cookieValue));
      const texto = await r5.text();
      const j5 = JSON.parse(texto) as { ok?: boolean; code?: string; probe?: { httpStatus?: number | null } };
      check(
        "L5 provedor 401 → ok:false CONEXAO_FALHOU (status da rota 200) e chave NUNCA no corpo",
        r5.status === 200 && j5?.ok === false && j5?.code === "CONEXAO_FALHOU" && j5?.probe?.httpStatus === 401 && !texto.includes("chave-mock-1234567890"),
        `status=${r5.status} corpo=${texto.slice(0, 200)}`
      );
    }
    mock401.parar();

    // L6 — 2xx sem lista utilizável: indecisão honesta (modeloPresente null)
    const mockEstranho = mockProvider(200, { objeto: "estranho" });
    const cfgE = setLabConfig({ baseUrl: mockEstranho.url, apiKey: "chave-mock-1234567890", modelId: "modelo-teste-mock" });
    if (!cfgE.ok) {
      check("L6 configuração do mock estranho aceita", false, cfgE.message);
    } else {
      const r6 = await POST(reqComCookie(cfgE.cookieValue));
      const j6 = await r6.json();
      check(
        "L6 2xx sem lista → ok:true, modelos=[], modeloPresente=null",
        r6.status === 200 && j6?.ok === true && Array.isArray(j6?.probe?.modelos) && j6.probe.modelos.length === 0 && j6?.probe?.modeloPresente === null,
        `status=${r6.status} corpo=${JSON.stringify(j6)}`
      );
    }
    mockEstranho.parar();
  }
  mockOk.parar();

  // L7 — redactKey (defesa em profundidade)
  const redigido = redactKey("falha com chave-mock-1234567890 no meio do texto", "chave-mock-1234567890");
  check("L7 redactKey substitui a chave por ***", !redigido.includes("chave-mock-1234567890") && redigido.includes("***"), redigido);

  // L8 — telemetria honesta do teste (LAB_PROBE_EXTERNO, sem inferência) em banco isolado
  await new Promise((r) => setTimeout(r, 400)); // fire-and-forget
  const eventos = (await db.$queryRawUnsafe(
    `SELECT etapa, fonte, operacao, alvo, httpStatus, estadoFinal, payloadJson FROM TelemetryEvent WHERE etapa = 'LAB_PROBE_EXTERNO' ORDER BY id DESC LIMIT 3`
  )) as { etapa: string; fonte: string; operacao: string; alvo: string; httpStatus: number; estadoFinal: string; payloadJson: string }[];
  const okTelemetria =
    eventos.length >= 1 &&
    eventos.every((e) => e.operacao === "probe_models_sem_inferencia") &&
    eventos.some((e) => e.estadoFinal === "sucesso" && (e.payloadJson ?? "").includes('"inferencia":false') && (e.payloadJson ?? "").includes('"tokens":0')) &&
    eventos.some((e) => e.estadoFinal === "falha" && (e.payloadJson ?? "").includes('"inferencia":false'));
  check("L8 telemetria LAB_PROBE_EXTERNO: inferencia:false, tokens:0, sucesso e falha registrados", okTelemetria, JSON.stringify(eventos).slice(0, 240));

  console.log(`\n== resultado: ${pass} PASS / ${fail} FAIL ==`);
  if (falhas.length > 0) {
    console.log("Falhas:", falhas.join(" | "));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("ERRO FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.$disconnect();
    } catch {
      /* isolado — nada a fazer */
    }
    for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
  });
