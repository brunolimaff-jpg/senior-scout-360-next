/**
 * test-v0109-evolucao.ts — SUÍTE v0.10.9 (evolução P4 + limitador já provado em test-v0109-limitador).
 *
 * Contrato do planejador PLANO_CONSULTAS_V1 — casos do despacho PROPOSTA-P4 §5:
 *   1. Plano contém SÓ lacunas COMPLEMENTAR_API (VALIDACAO_HUMANA/PESQUISA_DOCUMENTAL/
 *      INDISPONIVEL/RESOLVIDO/NAO_APLICAVEL nunca geram item de consulta).
 *   2. Cache válido → item com chamadas CONTADAS do cache local e cache_reutilizavel=true;
 *      quadro já consultado → expansão NÃO vira item em lote (fora_do_escopo_api honesto).
 *   3. Bloqueio (falha mais recente da fonte) → item adiado para o FIM com bloqueio declarado.
 *   4. NADA executa sem aprovação: gerar o plano não cria nenhum evento de executor —
 *      telemetria da janela: PLANO (leitura local) sobe, IA_CHAT/WEB_SEARCH/PAGE_READER/consultas = 0.
 *   5. Exportação PLANO_CONSULTAS_V1 validada por esquema (JSON e JSONL), guarda TOKEN
 *      nega sem credencial e aceita com header — e SEM dados de PF (nome/hash nunca saem).
 *   6. Dedupe por RAIZ: matriz + filial da mesma PJ = UM item (a unidade é a PJ/lacuna).
 *
 * Dados 100% SINTÉTICOS (CNPJs válidos gerados por DV, sem consulta externa) e
 * banco limpo no finally. Gate central: zero IA, zero busca web, zero HTTP externo.
 */
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { validateCnpj } from "../src/lib/cnpj";
import { gerarPlanoConsultas } from "../src/lib/plano/planner";
import { validarPlano, planoParaJsonl, PLANO_CONSULTAS_VERSAO } from "../src/lib/plano/contrato";
import { GET as planoGET } from "../src/app/api/imports/[id]/plano/route";
import { existsSync } from "fs";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CNPJ numérico válido (DV correto) a partir de uma raiz sintética. */
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
  if (!validateCnpj(cnpj).valid) throw new Error(`CNPJ sintético inválido gerado: ${cnpj}`);
  return cnpj;
}

async function contagemPorTipo(): Promise<Map<string, number>> {
  const evs = await db.telemetryEvent.groupBy({ by: ["tipo"], _count: { tipo: true } });
  return new Map(evs.map((e) => [e.tipo, e._count.tipo]));
}

async function main() {
  console.log("=== SUÍTE v0.10.9 — PLANEJADOR DE CONSULTAS (PLANO_CONSULTAS_V1) ===");
  const t0 = Date.now();

  const RAIZ_A = "99990001";
  const RAIZ_B = "99990002";
  const cnpjA1 = cnpjValido(RAIZ_A, "0001");
  const cnpjA2 = cnpjValido(RAIZ_A, "0002");
  const cnpjB1 = cnpjValido(RAIZ_B, "0001");
  const agora = new Date();
  const valido10d = new Date(agora.getTime() + 10 * 24 * 3600 * 1000);

  // auto-saneamento: resíduo de execução anterior desta MESMA suíte é removido antes de semear
  {
    const velhos = await db.importBatch.findMany({ where: { fileName: "teste-v0109-sintetico.csv" }, select: { id: true } });
    for (const b of velhos) {
      await db.auditEvent.deleteMany({ where: { batchId: b.id } });
      await db.importBatch.delete({ where: { id: b.id } }).catch(() => {});
    }
    await db.telemetryEvent.deleteMany({ where: { tipo: "PLANO" } });
    await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjA1, cnpjA2, cnpjB1, RAIZ_A, RAIZ_B] }, tipo: { in: ["RELACAO_GRAFO", "COLETA_CADASTRO", "DESCOBERTA_ROOT"] } } });
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjA1, cnpjA2, cnpjB1] } } });
    await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: { in: [RAIZ_A, RAIZ_B] } } });
  }

  const batch = await db.importBatch.create({
    data: {
      fileName: "teste-v0109-sintetico.csv",
      storedPath: "qa/teste-v0109-sintetico.csv",
      fileSize: 42,
      rowCount: 3,
      totalValid: 3,
      status: "DONE",
    },
  });

  await db.importRow.createMany({
    data: [
      { batchId: batch.id, rowNumber: 1, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjA1, legalName: "Empresa Sintetica A LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId: batch.id, rowNumber: 2, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjA2, legalName: "Empresa Sintetica A LTDA", registrationStatus: "ATIVA", branchType: "FILIAL", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
      { batchId: batch.id, rowNumber: 3, lookupKind: "CNPJ", lookupStatus: "ENRIQUECIDO", normalizedCnpj: cnpjB1, legalName: "Empresa Sintetica B LTDA", registrationStatus: "ATIVA", branchType: "MATRIZ", originalCellsJson: "[]", collectedAt: agora, queriedAt: agora },
    ],
  });

  try {
    /* ---------- CASO 1: seleção determinística + dedupe por raiz ---------- */
    const r1 = await gerarPlanoConsultas(batch.id);
    check("1.a plano gerado", r1.ok);
    if (!r1.ok) throw new Error("plano inicial falhou — abortando");
    const plano1 = r1.plano;

    check("1.b versão do contrato", plano1.versao_contrato === PLANO_CONSULTAS_VERSAO);
    check("1.c SÓ itens COMPLEMENTAR_API", plano1.itens.every((i) => i.estado_triagem_origem === "COMPLEMENTAR_API"));
    check(
      "1.d perguntas não-estruturadas NUNCA viram item",
      plano1.itens.every((i) => !["regime_tributario", "contabilidade_interna", "tecnologia_erp", "identidade"].includes(i.pergunta_id))
    );
    check(
      "1.e fora_do_escopo só estados não-executáveis (transparência)",
      plano1.fora_do_escopo_api.every((f) => ["VALIDACAO_HUMANA", "PESQUISA_DOCUMENTAL", "INDISPONIVEL", "COMPLEMENTAR_API"].includes(f.estado_triagem))
    );
    const foraIds1 = new Set(plano1.fora_do_escopo_api.map((f) => f.pergunta_id));
    check(
      "1.f regime/contabilidade/tecnologia aparecem só como transparência (nunca item)",
      ["regime_tributario", "contabilidade_interna", "tecnologia_erp"].every((p) => !plano1.itens.some((i) => i.pergunta_id === p) && foraIds1.has(p))
    );
    check("1.g dedupe por raiz: 2 raízes × 2 perguntas = 4 itens", plano1.itens.length === 4, `itens=${plano1.itens.length}`);
    const estA1 = plano1.itens.find((i) => i.pergunta_id === "estabelecimentos" && i.cnpj_raiz === RAIZ_A);
    check("1.h item da raiz usa a MENOR linha (matriz)", !!estA1 && estA1.linha === 1);
    check(
      "1.i comandos pertencem ao executor EXISTENTE",
      plano1.itens.every((i) => ["investigar_relacoes_societarias", "investigar_estabelecimentos_raiz", "revalidar_ficha"].includes(i.comando_executor))
    );
    check(
      "1.j mapeamento comando → rota EXISTENTE no código",
      existsSync("src/app/api/imports/[id]/rows/[rowNumber]/matriz-filiais/route.ts") &&
        existsSync("src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/route.ts") &&
        existsSync("src/app/api/imports/[id]/rows/[rowNumber]/revalidate/route.ts")
    );
    const validacao1 = validarPlano(plano1);
    check("1.k validação por esquema PASS", validacao1.ok);
    check("1.l gate do contrato: zero IA/busca, execução automática = false", plano1.gate.ia === 0 && plano1.gate.busca_web === 0 && plano1.gate.execucao_automatica === false);
    check("1.m sem bloqueios no estado inicial", plano1.resumo.bloqueados === 0 && plano1.itens.every((i) => i.bloqueios_ativos.length === 0));

    /* ---------- CASO 2: cache válido conta pendências; quadro consultado não vira item ---------- */
    await db.estabelecimentoRootCache.create({
      data: {
        cnpjRaiz: RAIZ_A,
        fonteDescoberta: "MinhaReceita Grafo — quadros de participantes",
        coletadoEm: agora,
        atualizadoEm: agora,
        validoAte: valido10d,
        estabelecimentosJson: JSON.stringify([
          { cnpj: cnpjA1, razaoSocial: "Empresa Sintetica A LTDA", situacao: "ATIVA", confirmado: true },
          { cnpj: cnpjA2, razaoSocial: "Empresa Sintetica A LTDA", situacao: "ATIVA", confirmado: false },
        ]),
        coberturaJson: JSON.stringify({ pendentesConfirmacao: 1, totalLocalizados: 2, parcial: true, tetoParticipantes: 10, tetoConfirmacoes: 20, participantesConsultados: [] }),
      },
    });
    const hashPfSintetico = "0123456789abcdef0123456789abcdef";
    await db.relacaoSocietariaCache.create({
      data: {
        cnpj: cnpjA1,
        fonte: "MinhaReceita Grafo",
        coletadoEm: agora,
        atualizadoEm: agora,
        validoAte: valido10d,
        relacoesJson: JSON.stringify([{ participanteId: `PF:${hashPfSintetico}`, tipo: "PF", nomePublico: "Pessoa Sintetica Um", qualificacao: "Sócio-Administrador" }]),
        totalParticipantes: 1,
      },
    });
    const r2 = await gerarPlanoConsultas(batch.id);
    check("2.a plano regenerado com caches", r2.ok);
    if (r2.ok) {
      const estA = r2.plano.itens.find((i) => i.pergunta_id === "estabelecimentos" && i.cnpj_raiz === RAIZ_A);
      check("2.b confirmações CONTADAS do cache (1 pendente)", !!estA && estA.chamadas_estimadas === 1, estA ? `chamadas=${estA.chamadas_estimadas}` : "item ausente");
      check("2.c cache_reutilizavel=true com descoberta reaproveitada", !!estA && estA.cache_reutilizavel === true);
      check("2.d quadro já consultado NÃO vira item em lote", !r2.plano.itens.some((i) => i.pergunta_id === "relacoes_societarias" && i.cnpj_raiz === RAIZ_A));
      const foraRel = r2.plano.fora_do_escopo_api.find((f) => f.pergunta_id === "relacoes_societarias" && f.cnpj_raiz === RAIZ_A);
      check("2.e expansão aparece por transparência com contagem", !!foraRel && foraRel.motivo.includes("1 conexão(ões)"), foraRel ? "presente" : "ausente");
      // v0.10.9 (lote real ao vivo): pendentes=0 NÃO é esgotado — quadros de participantes restantes contam
      await db.estabelecimentoRootCache.update({
        where: { cnpjRaiz: RAIZ_A },
        data: {
          coberturaJson: JSON.stringify({ pendentesConfirmacao: 0, totalLocalizados: 2, parcial: true, tetoParticipantes: 10, tetoConfirmacoes: 20, participantesConsultados: ["a", "b"], totalParticipantesPfCache: 5 }),
        },
      });
      const r2b = await gerarPlanoConsultas(batch.id);
      if (r2b.ok) {
        const estA2 = r2b.plano.itens.find((i) => i.pergunta_id === "estabelecimentos" && i.cnpj_raiz === RAIZ_A);
        check("2.f quadros restantes CONTADOS do cache (5-2=3 → custo 3)", !!estA2 && estA2.chamadas_estimadas === 3, estA2 ? `chamadas=${estA2.chamadas_estimadas} · nota="${estA2.chamadas_nota}"` : "item ausente");
        check("2.g cobertura realmente esgotada (0 pendentes, 0 quadros) → sem item", (await (async () => {
          await db.estabelecimentoRootCache.update({ where: { cnpjRaiz: RAIZ_A }, data: { coberturaJson: JSON.stringify({ pendentesConfirmacao: 0, totalLocalizados: 2, parcial: true, participantesConsultados: ["a"], totalParticipantesPfCache: 1 }) } });
          const r2c = await gerarPlanoConsultas(batch.id);
          await db.estabelecimentoRootCache.update({ where: { cnpjRaiz: RAIZ_A }, data: { coberturaJson: JSON.stringify({ pendentesConfirmacao: 1, totalLocalizados: 2, parcial: true, tetoParticipantes: 10, tetoConfirmacoes: 20, participantesConsultados: [], }) } });
          return r2c.ok && !r2c.plano.itens.some((i) => i.pergunta_id === "estabelecimentos" && i.cnpj_raiz === RAIZ_A);
        })()));
      }
    }

    /* ---------- CASO 3: bloqueio recente adia o item para o FIM ----------
     * A falha fica no alvo da RAIZ: para estabelecimentos o motor vê [cnpj, raiz]
     * → INDISPONIVEL (vai para fora_do_escopo); para relações o motor vê só [cnpj]
     * → COMPLEMENTAR_API e o PLANEJADOR, mais conservador (vê [cnpj, raiz]),
     * ADIA o item com o bloqueio declarado — executar seria martelar a fonte. */
    const evBloqueio = await db.telemetryEvent.create({
      data: {
        tipo: "RELACAO_GRAFO",
        alvo: RAIZ_B,
        fonte: "MinhaReceita Grafo",
        estadoFinal: "falha",
        payloadJson: JSON.stringify({ tipo: "RATE_LIMITED" }),
        startedAt: new Date(),
        empresa: "Empresa Sintetica B LTDA",
      },
    });
    await sleep(5);
    const r3 = await gerarPlanoConsultas(batch.id);
    check("3.a plano regenerado com bloqueio", r3.ok);
    if (r3.ok) {
      const relB = r3.plano.itens.find((i) => i.pergunta_id === "relacoes_societarias" && i.cnpj_raiz === RAIZ_B);
      check("3.b bloqueio declarado no item (RATE_LIMITED)", !!relB && relB.bloqueios_ativos.length === 1 && relB.bloqueios_ativos[0].tipo === "RATE_LIMITED");
      const ultimo = r3.plano.itens[r3.plano.itens.length - 1];
      check(
        "3.c item bloqueado vai para o FIM do plano",
        !!relB && ultimo.bloqueios_ativos.length > 0 && ultimo.pergunta_id === "relacoes_societarias" && ultimo.cnpj_raiz === RAIZ_B,
        `último=${ultimo.pergunta_id}/${ultimo.cnpj_raiz}`
      );
      check("3.d resumo conta bloqueados", r3.plano.resumo.bloqueados === 1, `bloqueados=${r3.plano.resumo.bloqueados}`);
      const foraEstB = r3.plano.fora_do_escopo_api.find((f) => f.pergunta_id === "estabelecimentos" && f.cnpj_raiz === RAIZ_B);
      check("3.e estabelecimentos da raiz bloqueada = INDISPONIVEL (fora, sem ação)", !!foraEstB && foraEstB.estado_triagem === "INDISPONIVEL");
    }

    /* ---------- CASO 4: NADA executa sem aprovação (telemetria prova) ---------- */
    const antes = await contagemPorTipo();
    await gerarPlanoConsultas(batch.id);
    await gerarPlanoConsultas(batch.id);
    const depoisLib = await contagemPorTipo();
    const tiposExecutor = ["COLETA_CADASTRO", "RELACAO_GRAFO", "RELACAO_EXPANSAO", "DESCOBERTA_ROOT", "IA_CHAT", "WEB_SEARCH", "PAGE_READER"];
    check(
      "4.a gerar o plano NÃO executa consulta nenhuma (delta 0 em todos os executores)",
      tiposExecutor.every((t) => (depoisLib.get(t) ?? 0) === (antes.get(t) ?? 0))
    );

    // rota da UI (leitura) — modo OPEN
    const reqUi = new NextRequest(`http://localhost:3000/api/imports/${batch.id}/plano`);
    const resUi = await planoGET(reqUi, { params: Promise.resolve({ id: batch.id }) });
    const bodyUi = await resUi.json();
    check("4.b rota da UI responde com o plano", resUi.status === 200 && bodyUi.ok === true && bodyUi.plano?.versao_contrato === PLANO_CONSULTAS_VERSAO);

    // exportação JSONL — ação explícita
    const reqExp = new NextRequest(`http://localhost:3000/api/imports/${batch.id}/plano?formato=jsonl`);
    const resExp = await planoGET(reqExp, { params: Promise.resolve({ id: batch.id }) });
    const texto = await resExp.text();
    check("4.c exportação JSONL com Content-Disposition", resExp.status === 200 && (resExp.headers.get("Content-Disposition") ?? "").includes("plano-consultas-v1"));
    const linhas = texto.trim().split("\n").map((l) => JSON.parse(l));
    check("4.d JSONL: cabeçalho + itens + transparência", linhas[0].versao_contrato === PLANO_CONSULTAS_VERSAO && linhas.filter((l) => l.tipo === "item").length === (r3.ok ? r3.plano.itens.length : -1) && linhas.some((l) => l.tipo === "fora_do_escopo_api"));

    const depoisRotas = await (async () => {
      await sleep(300); // telemetria é fire-and-forget — espera o flush antes de comparar
      return contagemPorTipo();
    })();
    check(
      "4.e telemetria da janela: SÓ PLANO sobe; IA/busca/leitura/consultas = 0",
      (depoisRotas.get("PLANO") ?? 0) >= (antes.get("PLANO") ?? 0) + 2 &&
        tiposExecutor.every((t) => (depoisRotas.get(t) ?? 0) === (antes.get(t) ?? 0))
    );
    const auditPlano = await db.auditEvent.count({ where: { batchId: batch.id, event: "plano_export" } });
    check("4.f exportação auditada (plano_export)", auditPlano === 1);

    // guarda TOKEN — fronteira da rota nova
    const tokenTeste = "tk-v0109-teste-123456";
    process.env.SCOUT_EXPORT_TOKEN = tokenTeste;
    const reqNeg = new NextRequest(`http://localhost:3000/api/imports/${batch.id}/plano`);
    const resNeg = await planoGET(reqNeg, { params: Promise.resolve({ id: batch.id }) });
    check("4.g TOKEN sem credencial → 401", resNeg.status === 401);
    const reqOk = new NextRequest(`http://localhost:3000/api/imports/${batch.id}/plano`, { headers: { "x-export-token": tokenTeste } });
    const resOk = await planoGET(reqOk, { params: Promise.resolve({ id: batch.id }) });
    check("4.h TOKEN com header → 200", resOk.status === 200);
    delete process.env.SCOUT_EXPORT_TOKEN;

    /* ---------- CASO 5: esquema rejeita plano corrompido ---------- */
    if (r3.ok) {
      const corrompido = JSON.parse(JSON.stringify(r3.plano));
      corrompido.itens[0].estado_triagem_origem = "RESOLVIDO";
      check("5.a estado que não é COMPLEMENTAR_API não passa no esquema", !validarPlano(corrompido).ok);
      const semResumo = JSON.parse(JSON.stringify(r3.plano));
      delete (semResumo as Partial<typeof semResumo>).resumo;
      check("5.b plano sem resumo não passa no esquema", !validarPlano(semResumo).ok);
    }

    /* ---------- CASO 6: privacidade — nome/hash de PF nunca saem ---------- */
    const jsonl = planoParaJsonl(r3.ok ? r3.plano : plano1);
    check("6.a hash opaco de PF NÃO sai no plano", !/[a-f0-9]{32}/i.test(jsonl));
    check("6.b nome público de PF NÃO sai no plano", !jsonl.includes("Pessoa Sintetica") && !jsonl.includes("nomePublico"));
    check("6.c JSONL termina com newline (streaming)", jsonl.endsWith("\n"));

    /* ---------- CASO 7: resumo coerente ---------- */
    if (r3.ok) {
      const somaFontes = r3.plano.resumo.por_fonte.reduce((s, f) => s + f.chamadas, 0);
      check("7.a chamadas_totais = soma por fonte", r3.plano.resumo.chamadas_totais === somaFontes, `total=${r3.plano.resumo.chamadas_totais}`);
      check("7.b soma de itens por fonte = total de itens", r3.plano.resumo.por_fonte.reduce((s, f) => s + f.itens, 0) === r3.plano.itens.length);
      check(
        "7.c fonte_candidata vem da camada de apresentação (sem provedor técnico)",
        r3.plano.itens.every((i) => !/BrasilAPI|ReceitaWS|OpenCNPJ|MinhaReceita/.test(i.fonte_candidata))
      );
      check(
        "7.d fonte_tecnica preserva proveniência (mesmo regime do TRIAGEM_V1)",
        r3.plano.itens.every((i) => i.fonte_tecnica.length > 3)
      );
    }
  } finally {
    /* ---------- limpeza (banco limpo no fim — disciplina da rodada) ---------- */
    await db.auditEvent.deleteMany({ where: { batchId: batch.id } });
    const planoEventos = await db.telemetryEvent.findMany({ where: { tipo: "PLANO" }, select: { id: true } });
    await db.telemetryEvent.deleteMany({ where: { id: { in: planoEventos.map((e) => e.id) } } });
    await db.telemetryEvent.deleteMany({ where: { alvo: { in: [cnpjA1, cnpjA2, cnpjB1, RAIZ_A, RAIZ_B] }, tipo: { in: ["RELACAO_GRAFO", "COLETA_CADASTRO", "DESCOBERTA_ROOT"] } } });
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: [cnpjA1, cnpjA2, cnpjB1] } } });
    await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: { in: [RAIZ_A, RAIZ_B] } } });
    await db.importBatch.delete({ where: { id: batch.id } }).catch(() => {});
    const restante = await db.importRow.count({ where: { batchId: batch.id } });
    check("limpeza · banco sem resíduos da suíte", restante === 0);
  }

  console.log(`\nResumo: ${pass}/${pass + fail} PASS${fail > 0 ? ` — FALHAS: ${falhas.join(" | ")}` : ""} (total ${Math.round((Date.now() - t0) / 100) / 10}s)`);
  process.exit(fail > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error("ERRO NA SUÍTE:", e);
    process.exit(1);
  });
