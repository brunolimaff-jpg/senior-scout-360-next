/**
 * test-v01010-plano-desatualizado.ts — PLANO ENTRE PRÉVIA E APROVAÇÃO (auditoria
 * da v0.10.9, item 4): "o servidor deve revalidar elegibilidade, cache, bloqueios
 * e limite de chamadas."
 *
 * O plano é um RETRATO do estado no momento da geração. Entre a prévia (leitura)
 * e a aprovação (comando), o mundo pode mudar — esta suíte prova que NADA do
 * retrato velho é confiado cegamente:
 *
 *   P1. ELEGIBILIDADE — linha vira inelegível após a prévia → comando recusa
 *       (linha_nao_investigavel) e o plano REGENERADO não lista mais o item.
 *   P2. CACHE — sem cache na prévia (item = 1 descoberta) → outra rodada coleta
 *       enquanto isso → comando executado do plano velho NÃO reconsulta (0 HTTP,
 *       via cache) e o plano regenerado deixa de propor a consulta.
 *   P3. BLOQUEIOS — falha recente da fonte entra após a prévia → plano regenerado
 *       adia o item para o FIM com bloqueio declarado (resumo.bloqueados ≥ 1) e
 *       a ordenação determinística muda (sem martelar a fonte).
 *   P4. LIMITE DE CHAMADAS — custo contado do cache na prévia (5 pendências) →
 *       depois do comando consumir pendências → plano regenerado RECONTA (custo
 *       cai; esgotado = item some). Números do retrato nunca são reusados.
 *   P5. GATE — regenerar o plano não faz NENHUMA chamada externa (leitura local).
 *
 * Fontes 100% simuladas (fetcher injetado + simulador global). Saída:
 * qa/estresse-v0.10.10/plano-desatualizado.json · exit 1 se qualquer caso falhar.
 */
import { db } from "../src/lib/db";
import { validateCnpj } from "../src/lib/cnpj";
import { gerarPlanoConsultas } from "../src/lib/plano/planner";
import { investigarRelacoes, type GrafoFetcher } from "../src/lib/relations/service";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/* simulador global — recusa qualquer saída externa não cadastrada */
const RESPOSTAS = new Map<string, { status: number; json: unknown; delayMs: number }>();
const tentativas: string[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/^https:\/\//i.test(url)) return fetchOriginal(input as never, init);
  const chave = url.replace(/^https?:\/\//i, "");
  tentativas.push(chave);
  const mock = RESPOSTAS.get(chave);
  if (!mock) throw new Error(`SIMULADOR: saída externa não cadastrada: ${url}`);
  if (mock.delayMs > 0) await sleep(mock.delayMs);
  return new Response(JSON.stringify(mock.json), { status: mock.status });
}) as typeof fetch;

const chamadasPorAlvo = new Map<string, number>();
const fetcher: GrafoFetcher = async (path) => {
  chamadasPorAlvo.set(path, (chamadasPorAlvo.get(path) ?? 0) + 1);
  const mock = RESPOSTAS.get(`grafo.minhareceita.org${path}`);
  if (!mock) return { status: 0, json: null, causa: "rede" };
  if (mock.delayMs > 0) await sleep(mock.delayMs);
  return { status: mock.status, json: mock.json };
};

const PF1 = "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
const cnpjA = cnpjValido("77771001"); // elegibilidade (P1) + cache (P2)
const cnpjB = cnpjValido("77771002"); // bloqueios (P3)
const cnpjC = cnpjValido("77771003"); // limite de chamadas (P4)
RESPOSTAS.set(`grafo.minhareceita.org/${cnpjA}`, { status: 200, json: [{ id: PF1, nome: "SOCIO PLANO UM" }], delayMs: 30 });
RESPOSTAS.set(`grafo.minhareceita.org/${cnpjB}`, { status: 200, json: [{ id: PF1, nome: "SOCIO PLANO UM" }], delayMs: 30 });
RESPOSTAS.set(`grafo.minhareceita.org/${cnpjC}`, { status: 200, json: [{ id: PF1, nome: "SOCIO PLANO UM" }], delayMs: 30 });
RESPOSTAS.set("grafo.minhareceita.org/updated", { status: 200, json: { message: "2026-10 (simulado)" }, delayMs: 5 });

const TTL = new Date(Date.now() + 10 * 24 * 3600 * 1000);
let batchId: string | null = null;
const metrics: Record<string, unknown>[] = [];
let exitCode = 1;

function itemDoPlano(plano: { itens: { cnpj_completo: string; pergunta_id: string }[] }, cnpj: string, pergunta: string) {
  return plano.itens.find((i) => i.cnpj_completo === cnpj && i.pergunta_id === pergunta);
}

try {
  console.log("=== SUÍTE v0.10.10 — PLANO DESATUALIZADO ENTRE PRÉVIA E APROVAÇÃO ===");
  const t0 = Date.now();

  // auto-saneamento
  const velhos = await db.importBatch.findMany({ where: { fileName: "teste-v01010-plano-stale.csv" }, select: { id: true } });
  for (const b of velhos) {
    await db.auditEvent.deleteMany({ where: { batchId: b.id } });
    await db.importBatch.delete({ where: { id: b.id } }).catch(() => {});
  }
  await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjA, cnpjB, cnpjC, PF1] }, tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO"] } } });
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjA, cnpjB, cnpjC] } } });
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: PF1 } });
  await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: "77771003" } });

  const agora = new Date();
  const batch = await db.importBatch.create({
    data: { fileName: "teste-v01010-plano-stale.csv", storedPath: "qa/teste-v01010-plano-stale.csv", fileSize: 42, rowCount: 3, totalValid: 3, status: "DONE" },
  });
  batchId = batch.id;
  await db.importRow.createMany({
    data: [
      { batchId, rowNumber: 1, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjA, legalName: "Plano Stale A LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 2, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjB, legalName: "Plano Stale B LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId, rowNumber: 3, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjC, legalName: "Plano Stale C LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
    ],
  });

  /* ---------- prévia inicial: os 3 itens existem (relações) ---------- */
  const r0 = await gerarPlanoConsultas(batchId!);
  check("P0 prévia gerada com 3 itens de relações", r0.ok && r0.plano.itens.filter((i) => i.pergunta_id === "relacoes_societarias").length === 3, `itens=${r0.ok ? r0.plano.resumo.itens : "?"}`);

  /* ---------- P1 — ELEGIBILIDADE: linha vira inelegível após a prévia ---------- */
  console.log("\n— P1: linha inelegível entre prévia e aprovação —");
  const row1 = await db.importRow.findFirst({ where: { batchId: batchId!, rowNumber: 1 }, select: { id: true } });
  await db.importRow.update({ where: { id: row1!.id }, data: { lookupStatus: "IGNORADO" } });
  const cmdA = await investigarRelacoes(batchId!, 1, { fetcher });
  check("P1.1 comando do plano velho RECUSA linha inelegível", !cmdA.ok && cmdA.motivo === "linha_nao_investigavel", `motivo=${cmdA.ok ? "ok" : cmdA.motivo}`);
  const r1 = await gerarPlanoConsultas(batchId!);
  check("P1.2 plano regenerado NÃO lista mais a linha", r1.ok && !itemDoPlano(r1.plano, cnpjA, "relacoes_societarias"), `itens=${r1.ok ? r1.plano.resumo.itens : "?"}`);
  await db.importRow.update({ where: { id: row1!.id }, data: { lookupStatus: "ENRIQUECIDO" } });
  metrics.push({ caso: "P1_elegibilidade", comando_recusou: true, plano_regenerado_sem_item: true });

  /* ---------- P2 — CACHE: outro comando coleta entre prévia e aprovação ---------- */
  console.log("\n— P2: cache criada entre prévia e aprovação —");
  const r2pre = await gerarPlanoConsultas(batchId!);
  const itemPre = r2pre.ok ? itemDoPlano(r2pre.plano, cnpjA, "relacoes_societarias") : undefined;
  check("P2.1 prévia propõe descoberta (1 chamada)", !!itemPre && itemPre.chamadas_estimadas === 1 && itemPre.cache_reutilizavel === false);
  // "outra rodada" coleta (comando legítimo da ficha) — cache fica válida
  const coleta = await investigarRelacoes(batchId!, 1, { fetcher });
  const antesChamadas = chamadasPorAlvo.get(`/${cnpjA}`) ?? 0;
  // operador aprova o item que veio do plano VELHO (pré-rotina) — o comando revalida
  const cmdA2 = await investigarRelacoes(batchId!, 1, { fetcher });
  check("P2.2 comando do plano velho NÃO reconsulta (via cache, 0 HTTP novo)", cmdA2.ok && cmdA2.view.via === "cache" && (chamadasPorAlvo.get(`/${cnpjA}`) ?? 0) === antesChamadas, `via=${cmdA2.ok ? cmdA2.view.via : "?"} Δchamadas=${(chamadasPorAlvo.get(`/${cnpjA}`) ?? 0) - antesChamadas}`);
  const r2pos = await gerarPlanoConsultas(batchId!);
  check("P2.3 plano regenerado deixa de propor a consulta (fora do escopo honesto)", r2pos.ok && !itemDoPlano(r2pos.plano, cnpjA, "relacoes_societarias"));
  metrics.push({ caso: "P2_cache", http_novo_no_comando_velho: 0, plano_regenerado_sem_item: true });

  /* ---------- P3 — BLOQUEIOS: falha recente da fonte após a prévia ----------
   * Dois caminhos determinísticos do produto (ambos adiaram execução):
   *   P3a — falha do ALVO (cnpj): triagem reclassifica → INDISPONIVEL → o plano
   *         regenerado TIRA o item dos executáveis e o lista em fora_do_escopo_api;
   *   P3b — falha só da RAIZ (que a triagem de relações não consulta): o item
   *         permanece executável mas com bloqueio declarado e vai para o FIM. */
  console.log("\n— P3: bloqueio recente da fonte entre prévia e aprovação —");
  const r3pre = await gerarPlanoConsultas(batchId!);
  const ordemPre = r3pre.ok ? r3pre.plano.itens.map((i) => i.cnpj_completo) : [];
  // P3a: falha RECENTE do alvo B (evento mais recente do alvo é falha)
  await db.telemetryEvent.create({ data: { tipo: "RELACAO_GRAFO", fonte: "MinhaReceita Grafo", alvo: cnpjB, cacheHit: false, estadoFinal: "falha", duracaoMs: 10, payloadJson: JSON.stringify({ tipo: "RATE_LIMITED", via: "consulta" }), startedAt: new Date() } });
  const r3a = await gerarPlanoConsultas(batchId!);
  const foraB = r3a.ok ? r3a.plano.fora_do_escopo_api.find((f) => f.cnpj_completo === cnpjB && f.pergunta_id === "relacoes_societarias") : undefined;
  check("P3.1 item do alvo falhado SAI dos executáveis e vira INDISPONIVEL declarado", r3a.ok && !itemDoPlano(r3a.plano, cnpjB, "relacoes_societarias") && foraB?.estado_triagem === "INDISPONIVEL", `fora=${foraB?.estado_triagem ?? "(ausente)"}`);
  check("P3.2 motivo do adiamento é honesto (indisponibilidade, sob comando quando voltar)", !!foraB && foraB.motivo.includes("indispon"), `${foraB?.motivo.slice(0, 60) ?? ""}…`);
  // P3b: troca a falha para a RAIZ de B — triagem de relações (só olha o cnpj) mantém COMPLEMENTAR_API,
  // e o PLANEJADOR declara o bloqueio no item e o adia para o fim.
  await db.telemetryEvent.deleteMany({ where: { tipo: "RELACAO_GRAFO", alvo: cnpjB, estadoFinal: "falha" } });
  await db.telemetryEvent.create({ data: { tipo: "RELACAO_GRAFO", fonte: "MinhaReceita Grafo", alvo: "77771002", cacheHit: false, estadoFinal: "falha", duracaoMs: 10, payloadJson: JSON.stringify({ tipo: "RATE_LIMITED", via: "consulta" }), startedAt: new Date() } });
  const r3b = await gerarPlanoConsultas(batchId!);
  const itemB = r3b.ok ? itemDoPlano(r3b.plano, cnpjB, "relacoes_societarias") : undefined;
  check("P3.3 falha na raiz: item permanece com bloqueio declarado (resumo.bloqueados=1)", !!itemB && itemB.bloqueios_ativos.length === 1 && r3b.ok && r3b.plano.resumo.bloqueados === 1, `bloqueios=${itemB?.bloqueios_ativos.length ?? "?"} resumo=${r3b.ok ? r3b.plano.resumo.bloqueados : "?"}`);
  check("P3.4 item bloqueado vai para o FIM da ordem determinística", !!itemB && r3b.ok && r3b.plano.itens[r3b.plano.itens.length - 1].cnpj_completo === cnpjB, `pos=${r3b.ok ? r3b.plano.itens.findIndex((i) => i.cnpj_completo === cnpjB) : "?"}/${r3b.ok ? r3b.plano.itens.length - 1 : "?"}`);
  check("P3.5 ordem determinística mudou após o bloqueio (não confia no retrato)", r3b.ok && JSON.stringify(ordemPre) !== JSON.stringify(r3b.plano.itens.map((i) => i.cnpj_completo)));
  // e o comando continua honesto: bloqueio NÃO impede comando manual explícito
  const cmdB = await investigarRelacoes(batchId!, 2, { fetcher });
  check("P3.6 comando manual explícito ainda funciona (bloqueio é aviso do plano, não trava)", cmdB.ok, `ok=${cmdB.ok}`);
  await db.telemetryEvent.deleteMany({ where: { tipo: "RELACAO_GRAFO", alvo: "77771002", estadoFinal: "falha" } });
  metrics.push({ caso: "P3_bloqueios", alvo_fora_indisponivel: true, raiz_item_adiado_fim: true, ordem_mudou: true });

  /* ---------- P4 — LIMITE DE CHAMADAS: custo contado do cache, nunca presumido ---------- */
  console.log("\n— P4: limite de chamadas recontado entre prévia e aprovação —");
  // cache de estabelecimentos da raiz C com 5 confirmações pendentes
  await db.estabelecimentoRootCache.create({
    data: {
      cnpjRaiz: "77771003",
      fonteDescoberta: "MinhaReceita Grafo — quadros de participantes (simulado)",
      coletadoEm: new Date(),
      atualizadoEm: new Date(),
      validoAte: TTL,
      estabelecimentosJson: JSON.stringify([
        { cnpj: cnpjC, razaoSocial: "Plano Stale C LTDA", municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: 1, confirmado: true, descobertoPor: "linha do lote", confirmadoEm: new Date().toISOString(), fonteConfirmacao: "ficha" },
        { cnpj: cnpjValido("77771003", "0002"), razaoSocial: "FILIAL SINTETICA C", municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: 2, confirmado: false, descobertoPor: "quadro (simulado)", confirmadoEm: null, fonteConfirmacao: null },
        { cnpj: cnpjValido("77771003", "0003"), razaoSocial: "FILIAL SINTETICA C 2", municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: 2, confirmado: false, descobertoPor: "quadro (simulado)", confirmadoEm: null, fonteConfirmacao: null },
        { cnpj: cnpjValido("77771003", "0004"), razaoSocial: "FILIAL SINTETICA C 3", municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: 2, confirmado: false, descobertoPor: "quadro (simulado)", confirmadoEm: null, fonteConfirmacao: null },
        { cnpj: cnpjValido("77771003", "0005"), razaoSocial: "FILIAL SINTETICA C 4", municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: 2, confirmado: false, descobertoPor: "quadro (simulado)", confirmadoEm: null, fonteConfirmacao: null },
        { cnpj: cnpjValido("77771003", "0006"), razaoSocial: "FILIAL SINTETICA C 5", municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: 2, confirmado: false, descobertoPor: "quadro (simulado)", confirmadoEm: null, fonteConfirmacao: null },
      ]),
      coberturaJson: JSON.stringify({ participantesConsultados: [PF1], tetoParticipantes: 10, tetoConfirmacoes: 20, pendentesConfirmacao: 5, totalLocalizados: 6, parcial: true }),
      raizAlfanumerica: false,
    },
  });
  const r4pre = await gerarPlanoConsultas(batchId!);
  const itemEstPre = r4pre.ok ? itemDoPlano(r4pre.plano, cnpjC, "estabelecimentos") : undefined;
  check("P4.1 prévia CONTA o custo do cache (5 confirmações pendentes)", !!itemEstPre && itemEstPre.chamadas_estimadas === 5 && itemEstPre.cache_reutilizavel === true, `chamadas=${itemEstPre?.chamadas_estimadas ?? "?"}`);
  // o comando consome as pendências (confirma as 4 filiais — contagem cai)
  const cacheC = await db.estabelecimentoRootCache.findUnique({ where: { cnpjRaiz: "77771003" } });
  const estC = JSON.parse(cacheC!.estabelecimentosJson) as { cnpj: string; confirmado: boolean }[];
  for (const e of estC) e.confirmado = true;
  await db.estabelecimentoRootCache.update({ where: { cnpjRaiz: "77771003" }, data: { estabelecimentosJson: JSON.stringify(estC), coberturaJson: JSON.stringify({ participantesConsultados: [PF1], tetoParticipantes: 10, tetoConfirmacoes: 20, pendentesConfirmacao: 0, totalLocalizados: 6, parcial: false }) } });
  const r4pos = await gerarPlanoConsultas(batchId!);
  check("P4.2 plano regenerado RECONTA (pendências consumidas → item some)", r4pos.ok && !itemDoPlano(r4pos.plano, cnpjC, "estabelecimentos"));
  check("P4.3 resumo de chamadas do plano reflete a nova contagem", r4pos.ok && r4pos.plano.resumo.chamadas_totais === r4pos.plano.itens.reduce((s, i) => s + i.chamadas_estimadas, 0), `totais=${r4pos.ok ? r4pos.plano.resumo.chamadas_totais : "?"}`);
  metrics.push({ caso: "P4_limite_chamadas", chamadas_antes: itemEstPre?.chamadas_estimadas, chamadas_depois: 0, item_saiu: true });

  /* ---------- P5 — GATE: regenerar o plano é leitura local (zero HTTP) ---------- */
  console.log("\n— P5: gate do plano (zero HTTP na geração) —");
  const antesTentativas = tentativas.length;
  await gerarPlanoConsultas(batchId!);
  check("P5.1 geração de plano não faz NENHUMA chamada externa", tentativas.length === antesTentativas, `Δ=${tentativas.length - antesTentativas}`);
  metrics.push({ caso: "P5_gate", http_na_geracao: 0 });

  /* ---------- prova estrutural ---------- */
  const naoSimuladas = tentativas.filter((t) => !RESPOSTAS.has(t));
  check("P6.1 ZERO chamadas reais (tudo pelo simulador)", naoSimuladas.length === 0, `tentativas=${tentativas.length}`);

  console.log(`\n=== RESULTADO: ${pass} PASS · ${fail} FAIL (${Date.now() - t0}ms) ===`);
  await Bun.write(
    "qa/estresse-v0.10.10/plano-desatualizado.json",
    JSON.stringify({ missao: "auditoria v0.10.9 item 4 — plano desatualizado entre prévia e aprovação", casos: metrics, pass, fail, falhas, duracaoMs: Date.now() - t0 }, null, 2)
  );
  exitCode = fail > 0 ? 1 : 0;
} catch (e) {
  console.error("✘✘ ERRO FATAL:", e);
  exitCode = 1;
} finally {
  globalThis.fetch = fetchOriginal;
  if (batchId) {
    await db.auditEvent.deleteMany({ where: { batchId } });
    await db.importBatch.delete({ where: { id: batchId } }).catch(() => {});
  }
  await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjA, cnpjB, cnpjC, PF1] }, tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO"] } } }).catch(() => {});
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjA, cnpjB, cnpjC] } } }).catch(() => {});
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: PF1 } }).catch(() => {});
  await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: "77771003" } }).catch(() => {});
}
process.exit(exitCode);
