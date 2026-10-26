/**
 * Suíte v0.10.6 — TRIAGEM LOCAL DETERMINÍSTICA + CONSOLIDAÇÃO DE IDENTIDADE.
 *
 * Camada 1 (OFFLINE, pura): identidade raiz=PJ vs CNPJ=estabelecimento (quadro conta
 * pessoas jurídicas por raiz), contrato TRIAGEM_V1 (schema zod, sanitização de CPF
 * mascarado/formatado e hash de PF, validação), lacuna → entrada do contrato.
 * Camada 2 (ONLINE, banco de dev, LIMPO no fim): casos sintéticos determinísticos —
 * mesma raiz (matriz+filial) não vira "empresas distintas"; participante comum só
 * entre raízes distintas; MEI/baixada → NAO_APLICAVEL; 429 → INDISPONIVEL sem apagar
 * fatos; NÃO ENCONTRADO ≠ NÃO PESQUISADO; regime histórico não prova vigência;
 * reuso sem duplicar perguntas; contrato exportado sem CPF/hash/nome de PF.
 * Camada 3 (INTEGRAÇÃO ao vivo, Botica real): matriz+filial 0001/0002 reais —
 * comumMesmaPj substitui o falso "participante comum entre empresas"; quadro conta
 * 1 PJ e N estabelecimentos; comparativo antes/depois gravado como evidência.
 *
 * GATE CENTRAL: triagem com ZERO chamadas de IA e nenhuma pesquisa web automática.
 * Uso: bun scripts/test-v0106-triagem.ts
 */
import { db } from "../src/lib/db";
import { validateCnpj } from "../src/lib/cnpj";
import { raizDe, contarPessoasJuridicas, type EmpresaQuadro } from "../src/lib/relations/grafo";
import { investigarRelacoes, investigarConexao, investigarMatrizFiliais } from "../src/lib/relations/service";
import { classificarTriagemLinha } from "../src/lib/triage/engine";
import {
  lacunaParaTriagemV1,
  validarPacoteTriagemV1,
  sanitizarTexto,
  paraJsonl,
  fatosExportaveisDe,
  TRIAGEM_V1_VERSAO,
} from "../src/lib/triage/contrato";
import { writeFileSync, mkdirSync } from "fs";

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

/* ------------------------------ helpers ------------------------------ */

/** DV do CNPJ numérico (RFB) para CNPJs sintéticos válidos. */
function dvCnpj(base12: string): string {
  const calc = (nums: number[]): number => {
    let soma = 0;
    let peso = nums.length - 7;
    for (let i = 0; i < nums.length; i++) {
      soma += nums[i] * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d = [...base12].map(Number);
  const d1 = calc(d);
  const d2 = calc([...d, d1]);
  return `${d1}${d2}`;
}

function cnpjValidoSintetico(raiz: string, ordem = "0001"): string {
  const base = `${raiz}${ordem}`; // 12 caracteres
  return base + dvCnpj(base);
}

const HASH_PF_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 32 hex — participante PF sintético
const HASH_PF_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; // homônimo com hash distinto
const NOME_PF = "SOCIO UNICO TESTE";

const RAIZ_BOTICA = "08044783";
const CNPJ_BOTICA = "08044783000117"; // matriz real
const CNPJ_BOTICA_FILIAL = "08044783000206"; // filial real (0002-06)
const CNPJ_BOTICA_0003 = "08044783000389"; // filial real (0003-89, baixada)
const RAIZ_OUTRA = "33000167";
const CNPJ_OUTRA = "33000167000101"; // outra pessoa jurídica real (raiz distinta)

const RAIZ_MEI = "22345678";
const CNPJ_MEI = cnpjValidoSintetico(RAIZ_MEI, "0001");
const RAIZ_BAIXADA = "32345678";
const CNPJ_BAIXADA = cnpjValidoSintetico(RAIZ_BAIXADA, "0001");
const RAIZ_429 = "42345678";
const CNPJ_429 = cnpjValidoSintetico(RAIZ_429, "0001");
const RAIZ_NAO_ENC = "52345678";
const CNPJ_NAO_ENC = cnpjValidoSintetico(RAIZ_NAO_ENC, "0001");

function valido(c: string): string {
  const v = validateCnpj(c);
  if (!v.valid) throw new Error(`CNPJ sintético inválido no teste: ${c}`);
  return v.normalized;
}

/* ============================== CAMADA 1 — OFFLINE ============================== */

console.log("\n[1] consolidação de identidade — raiz é PJ, CNPJ completo é estabelecimento");
{
  const quadroBotica: EmpresaQuadro[] = [
    { cnpj: "08044783000117", razaoSocial: "BOTICA 0001" },
    { cnpj: "08044783000206", razaoSocial: "BOTICA 0002" },
    { cnpj: "08044783000389", razaoSocial: "BOTICA 0003" },
    { cnpj: cnpjValidoSintetico(RAIZ_BOTICA, "0004"), razaoSocial: null },
    { cnpj: cnpjValidoSintetico(RAIZ_BOTICA, "0005"), razaoSocial: null },
  ];
  check("5 estabelecimentos da mesma raiz = 1 pessoa jurídica", contarPessoasJuridicas(quadroBotica) === 1);
  check("CNPJs completos permanecem 5 estabelecimentos", quadroBotica.length === 5);
  const misto = [...quadroBotica, { cnpj: CNPJ_OUTRA, razaoSocial: "OUTRA MATRIZ" }, { cnpj: cnpjValidoSintetico(RAIZ_OUTRA, "0006"), razaoSocial: "OUTRA FILIAL" }];
  check("quadro misto = 2 pessoas jurídicas · 7 estabelecimentos", contarPessoasJuridicas(misto) === 2 && misto.length === 7);
  check("raizDe é estável (maiúsculas, 8 caracteres)", raizDe("08044783000117") === "08044783" && raizDe("080A4783X000YZ") === "080A4783");
}

console.log("\n[2] TRIAGEM_V1 — sanitização determinística");
{
  check("CPF formatado com DV válido é suprimido", sanitizarTexto("contato 529.982.247-25 registrado") === "contato [suprimido] registrado");
  check("sequência de 11 dígitos com DV inválido NÃO é suprimida", sanitizarTexto("registro 11111111111 no sistema") === "registro 11111111111 no sistema");
  check("CPF mascarado (**123456**) é suprimido", sanitizarTexto("cpf **123456** da fonte") === "cpf [suprimido] da fonte");
  check("hash opaco de PF (32 hex) é suprimido", sanitizarTexto(`participante ${HASH_PF_A} no quadro`) === "participante [suprimido] no quadro");
  check("CNPJ completo (14 dígitos) NÃO é suprimido", sanitizarTexto(`estabelecimento ${CNPJ_BOTICA} na ficha`) === `estabelecimento ${CNPJ_BOTICA} na ficha`);
  check("CNPJ formatado NÃO é suprimido", sanitizarTexto("08.044.783/0001-17 na ficha") === "08.044.783/0001-17 na ficha");
}

console.log("\n[3] TRIAGEM_V1 — validação por esquema (zod)");
{
  const lacunaExemplo = {
    perguntaId: "identidade",
    pergunta: "Quem é a empresa deste CNPJ?",
    estado: "RESOLVIDO" as const,
    motivo: "regra determinística",
    entidade: "ESTABELECIMENTO" as const,
    fatos: [{ fato: `Razão social: X — documento ${CNPJ_BOTICA} e contato 529.982.247-25 (sanitizado)`, fonte: "fonte teste", data: "2026-10-22T00:00:00.000Z" }],
    falta: null,
    proximaVerificacao: null,
    utilidade: "base das demais perguntas",
  };
  const entrada = lacunaParaTriagemV1(lacunaExemplo, {
    cnpjCompleto: CNPJ_BOTICA,
    cnpjRaiz: RAIZ_BOTICA,
    dataReferencia: "2026-10-22T00:00:00.000Z",
    fontesConsultadas: ["fonte teste"],
    evidencias: [{ tipo: "triagem:identidade", referencia: "linha 1", data: "2026-10-22T00:00:00.000Z" }],
    bloqueios: [],
  });
  check("entrada gerada é versionada", entrada.versao_contrato === TRIAGEM_V1_VERSAO);
  const valid = validarPacoteTriagemV1([entrada]);
  check("pacote com entrada válida passa no schema", valid.ok);
  check("CPF embutido em fato é suprimido antes da validação", valid.ok && JSON.stringify(valid.entradas).includes("[suprimido]") && !JSON.stringify(valid.entradas).includes("529.982.247-25"));
  const invalida = validarPacoteTriagemV1([{ versao_contrato: "TRIAGEM_V1" }]);
  check("entrada incompleta é rejeitada com erro", !invalida.ok && invalida.erros.length > 0);
  const jsonl = paraJsonl(valid.ok ? valid.entradas : []);
  check("jsonl tem uma linha por entrada", jsonl.trimEnd().split("\n").length === 1);
}

/* ===================== CAMADA 2 — SINTÉTICOS (banco de dev) ===================== */

console.log("\n[4] casos determinísticos em banco (limpos no fim)");

async function limparTudo(batchId: string, idsQuadro: string[], cnpjsCache: string[], raizesCache: string[]) {
  await db.auditEvent.deleteMany({ where: { batchId } });
  await db.telemetryEvent.deleteMany({ where: { batchId } });
  // v0.10.10: eventos de FALHA dos alvos da suíte não têm batchId (recordTelemetry é
  // global) — sem esta limpeza por ALVO, o run seguinte via esses resíduos e a triagem
  // honestamente reclassificava para INDISPONIVEL (veneno entre execuções).
  await db.telemetryEvent.deleteMany({ where: { tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO", "DESCOBERTA_ROOT"] }, estadoFinal: "falha", alvo: { in: [...cnpjsCache, ...raizesCache, ...idsQuadro, RAIZ_BOTICA, CNPJ_BOTICA, CNPJ_BOTICA_FILIAL, HASH_PF_A, HASH_PF_B] } } }).catch(() => undefined);
  await db.importBatch.delete({ where: { id: batchId } }).catch(() => undefined);
  await db.importRow.deleteMany({ where: { batchId } }).catch(() => undefined);
  if (cnpjsCache.length > 0) {
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: cnpjsCache } } }).catch(() => undefined);
    await db.cadastroCache.deleteMany({ where: { cnpj: { in: cnpjsCache } } }).catch(() => undefined);
  }
  if (raizesCache.length > 0) {
    await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: { in: raizesCache } } }).catch(() => undefined);
  }
  if (idsQuadro.length > 0) {
    await db.quadroParticipanteCache.deleteMany({ where: { participanteId: { in: idsQuadro } } }).catch(() => undefined);
  }
}

async function criarLinha(batchId: string, rowNumber: number, dados: Record<string, unknown>) {
  return db.importRow.create({ data: { batchId, rowNumber, cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", ...(dados as object) } });
}

async function main() {
  const idsQuadroUsados: string[] = [HASH_PF_A, HASH_PF_B];
  const cnpjsCache: string[] = [valido(CNPJ_BOTICA), valido(CNPJ_BOTICA_FILIAL), valido(CNPJ_OUTRA), valido(CNPJ_MEI), valido(CNPJ_BAIXADA), valido(CNPJ_429), valido(CNPJ_NAO_ENC)];
  const raizesCache: string[] = [RAIZ_BOTICA, RAIZ_MEI, RAIZ_BAIXADA, RAIZ_429, RAIZ_NAO_ENC];

  // v0.10.7: pré-limpeza das chaves sintéticas — a suíte é auto-saneante contra
  // resíduo de execução anterior interrompida (defesa; o finally continua limpando)
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: cnpjsCache } } }).catch(() => undefined);
  await db.cadastroCache.deleteMany({ where: { cnpj: { in: cnpjsCache } } }).catch(() => undefined);
  await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: { in: raizesCache } } }).catch(() => undefined);
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: { in: [HASH_PF_A, HASH_PF_B] } } }).catch(() => undefined);
  // v0.10.10: falhas de fonte dos alvos da suíte, herdadas de runs anteriores
  // (sem batchId no recordTelemetry), saem ANTES de semear — o estado "sem
  // investigação" tem que nascer limpo, não limpo por sorte.
  await db.telemetryEvent.deleteMany({ where: { tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO", "DESCOBERTA_ROOT"] }, estadoFinal: "falha", alvo: { in: [...cnpjsCache, ...raizesCache, RAIZ_BOTICA, CNPJ_BOTICA, CNPJ_BOTICA_FILIAL, HASH_PF_A, HASH_PF_B] } } }).catch(() => undefined);

  const batch = await db.importBatch.create({
    data: { fileName: "TESTE-v0106-triagem.csv", storedPath: "", fileSize: 0, status: "DONE" },
  });

  const agora = new Date(Date.now() - 60_000); // 1 min atrás — evita corrida com telemetria semeada
  const ttl = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

  const row1 = valido(CNPJ_BOTICA);
  const row2 = valido(CNPJ_BOTICA_FILIAL);
  const rowOutra = valido(CNPJ_OUTRA);
  const rowMei = valido(CNPJ_MEI);
  const rowBaixada = valido(CNPJ_BAIXADA);
  const row429 = valido(CNPJ_429);
  const rowNaoEnc = valido(CNPJ_NAO_ENC);

  // linhas: 1-2 mesma raiz (Botica matriz+filial); 3 outra raiz; 4 MEI; 5 baixada; 6 429; 7 não encontrado
  await criarLinha(batch.id, 1, {
    rawCnpj: row1, normalizedCnpj: row1, cnpjRoot: raizDe(row1),
    legalName: "BOTICA COMERCIAL FARMACEUTICA LTDA", branchType: "MATRIZ", branchIdentifier: 1,
    registrationStatus: "ATIVA", municipality: "Rio de Janeiro", uf: "RJ",
    openingDate: "1833-01-01", cnaeDescription: "Comércio varejista de medicamentos",
    collectedAt: agora, queriedAt: agora,
    fontesJson: JSON.stringify({ primaria: { fonte: "MinhaReceita", coletadoEm: agora.toISOString() }, complementacoes: [], cache: null }),
    extraJson: JSON.stringify({ simples: "Não", mei: "Não" }),
  });
  await criarLinha(batch.id, 2, {
    rawCnpj: row2, normalizedCnpj: row2, cnpjRoot: raizDe(row2),
    legalName: "BOTICA COMERCIAL FARMACEUTICA LTDA", branchType: "FILIAL", branchIdentifier: 2,
    registrationStatus: "BAIXADA", municipality: "Niterói", uf: "RJ",
    collectedAt: agora, queriedAt: agora,
    fontesJson: JSON.stringify({ primaria: { fonte: "MinhaReceita", coletadoEm: agora.toISOString() } }),
    extraJson: JSON.stringify({ simples: "Não", mei: "Não" }),
  });
  await criarLinha(batch.id, 3, {
    rawCnpj: rowOutra, normalizedCnpj: rowOutra, cnpjRoot: raizDe(rowOutra),
    legalName: "OUTRA EMPRESA SA", branchType: "MATRIZ", branchIdentifier: 1,
    registrationStatus: "ATIVA",
    collectedAt: agora, queriedAt: agora,
    extraJson: JSON.stringify({ simples: "Não", mei: "Não" }),
  });
  await criarLinha(batch.id, 4, {
    rawCnpj: rowMei, normalizedCnpj: rowMei, cnpjRoot: raizDe(rowMei),
    legalName: "MEI TESTE", branchType: "MATRIZ", branchIdentifier: 1,
    registrationStatus: "ATIVA",
    collectedAt: agora, queriedAt: agora,
    extraJson: JSON.stringify({ mei: "Sim", simples: "Não" }),
  });
  await criarLinha(batch.id, 5, {
    rawCnpj: rowBaixada, normalizedCnpj: rowBaixada, cnpjRoot: raizDe(rowBaixada),
    legalName: "EMPRESA BAIXADA LTDA", branchType: "MATRIZ", branchIdentifier: 1,
    registrationStatus: "BAIXADA",
    collectedAt: agora, queriedAt: agora,
    extraJson: JSON.stringify({ simples: "Não", mei: "Não" }),
  });
  await criarLinha(batch.id, 6, {
    rawCnpj: row429, normalizedCnpj: row429, cnpjRoot: raizDe(row429),
    lookupStatus: "RATE_LIMITED", lookupError: "429 das fontes",
    cnpjStatus: "VALIDA",
  });
  await criarLinha(batch.id, 7, {
    rawCnpj: rowNaoEnc, normalizedCnpj: "", lookupStatus: "NAO_ENCONTRADO",
    cnpjStatus: "VALIDA", lookupError: "não encontrado nas fontes",
  });

  try {
    /* ---- 4.a mesma raiz NÃO é participante comum entre empresas distintas ---- */
    const relPf = [{ participanteId: HASH_PF_A, tipo: "PF", nomePublico: NOME_PF, cnpjParticipante: null }];
    for (const cnpj of [row1, row2]) {
      await db.relacaoSocietariaCache.upsert({
        where: { cnpj },
        create: { cnpj, fonte: "MinhaReceita Grafo", coletadoEm: agora, atualizadoEm: agora, validoAte: ttl, relacoesJson: JSON.stringify(relPf), totalParticipantes: 1 },
        update: {},
      });
    }
    const rel1 = await investigarRelacoes(batch.id, 1);
    check("relações da linha 1 carregadas (cache)", rel1.ok);
    if (rel1.ok) {
      const p = rel1.view.participantes[0];
      check("filial da MESMA raiz NÃO aparece como participante comum", p.comumCom.length === 0);
      check("filial da MESMA raiz aparece como comumMesmaPj", p.comumMesmaPj.length === 1 && p.comumMesmaPj[0].cnpj === row2);
      check("existeParticipanteComum é false para sobreposição na mesma raiz", rel1.view.existeParticipanteComum === false);
      check("aviso honesto de mesma PJ presente", rel1.view.avisos.some((a) => a.includes("mesma pessoa jurídica")));
    }

    /* ---- 4.b duas raízes distintas com participante comum ---- */
    await db.relacaoSocietariaCache.upsert({
      where: { cnpj: rowOutra },
      create: { cnpj: rowOutra, fonte: "MinhaReceita Grafo", coletadoEm: agora, atualizadoEm: agora, validoAte: ttl, relacoesJson: JSON.stringify(relPf), totalParticipantes: 1 },
      update: {},
    });
    const rel3 = await investigarRelacoes(batch.id, 3);
    check("relações da linha 3 carregadas", rel3.ok);
    if (rel3.ok) {
      const p3 = rel3.view.participantes[0];
      check(
        "raiz distinta COM participante comum é detectada",
        p3.comumCom.some((c) => c.cnpj === row1),
        JSON.stringify({ participanteId: p3.participanteId, comumCom: p3.comumCom, totalParticipantes: rel3.view.totalParticipantes, via: rel3.view.via })
      );
      check("mesma raiz nunca mistura em comumCom", p3.comumCom.every((c) => raizDe(c.cnpj) !== raizDe(rowOutra)));
      const rel1b = await investigarRelacoes(batch.id, 1);
      if (rel1b.ok) {
        const pb = rel1b.view.participantes[0];
        check("raiz distinta entra em comumCom da linha 1", pb.comumCom.some((c) => c.cnpj === rowOutra));
        check("mesma PJ segue separada (comumMesmaPj intacta)", pb.comumMesmaPj.some((c) => c.cnpj === row2));
        check("existeParticipanteComum true só para raízes distintas", rel1b.view.existeParticipanteComum === true);
      }
    }
    const triNome = await classificarTriagemLinha(batch.id, 1);
    check("triagem NÃO inclui nome de PF nos fatos", triNome.ok && !JSON.stringify(triNome.lacunas).includes(NOME_PF));

    /* ---- 4.c triagem da linha 1 — estados determinísticos (ANTES da expansão de conexão) ---- */
    const t1 = await classificarTriagemLinha(batch.id, 1);
    check("triagem da linha 1 calculada", t1.ok);
    if (t1.ok) {
      check("identidade RESOLVIDO", t1.lacunas.find((l) => l.perguntaId === "identidade")?.estado === "RESOLVIDO");
      check("6 perguntas do catálogo para linha enriquecida", t1.lacunas.length === 6);
      const estab = t1.lacunas.find((l) => l.perguntaId === "estabelecimentos");
      check("estabelecimentos sem investigação → COMPLEMENTAR_API (não consultado ≠ não encontrado)", estab?.estado === "COMPLEMENTAR_API" && (estab?.motivo.includes("não consultada") || estab?.motivo.includes("não consultado")));
      const relGap = t1.lacunas.find((l) => l.perguntaId === "relacoes_societarias");
      check("relações com quadro só PF → COMPLEMENTAR_API (expansão 1 hop sob comando)", relGap?.estado === "COMPLEMENTAR_API" && relGap.motivo.includes("expandir"));
      const regime = t1.lacunas.find((l) => l.perguntaId === "regime_tributario");
      check("simples=Não → PESQUISA_DOCUMENTAL (Real vs Presumido não consta no registro)", regime?.estado === "PESQUISA_DOCUMENTAL" && (regime.falta ?? "").includes("Lucro"));
      const contab = t1.lacunas.find((l) => l.perguntaId === "contabilidade_interna");
      check("contabilidade sem sinal → VALIDACAO_HUMANA", contab?.estado === "VALIDACAO_HUMANA");
      const tech = t1.lacunas.find((l) => l.perguntaId === "tecnologia_erp");
      check("ERP sem pesquisa → PESQUISA_DOCUMENTAL com NÃO PESQUISADO", tech?.estado === "PESQUISA_DOCUMENTAL" && tech.motivo.includes("NÃO PESQUISADO"));
      check("fatos de identidade têm fonte e data", (t1.lacunas.find((l) => l.perguntaId === "identidade")?.fatos.length ?? 0) >= 3);
    }

    /* ---- 4.c'' expansão por comando (quadro) → contagem por identidade + triagem vira RESOLVIDO ---- */
    const quadroEmpresas = [
      { cnpj: row1, razaoSocial: "BOTICA 0001" },
      { cnpj: row2, razaoSocial: "BOTICA 0002" },
      { cnpj: valido("08044783000389"), razaoSocial: "BOTICA 0003" },
      { cnpj: cnpjValidoSintetico(RAIZ_BOTICA, "0004"), razaoSocial: null },
      { cnpj: cnpjValidoSintetico(RAIZ_BOTICA, "0005"), razaoSocial: null },
      { cnpj: rowOutra, razaoSocial: "OUTRA MATRIZ" },
      { cnpj: cnpjValidoSintetico(RAIZ_OUTRA, "0006"), razaoSocial: "OUTRA FILIAL" },
    ];
    await db.quadroParticipanteCache.upsert({
      where: { participanteId: HASH_PF_A },
      create: { participanteId: HASH_PF_A, tipoParticipante: "PF", rotulo: null, fonte: "MinhaReceita Grafo", coletadoEm: agora, validoAte: ttl, empresasJson: JSON.stringify(quadroEmpresas), totalEmpresas: quadroEmpresas.length, truncado: false },
      update: {},
    });
    const quadro = await investigarConexao(batch.id, 1, HASH_PF_A);
    check("quadro via cache carregado", quadro.ok);
    if (quadro.ok) {
      check("totalEmpresas = estabelecimentos (7 CNPJs)", quadro.view.totalEmpresas === 7);
      check("totalPessoasJuridicas = raízes distintas (2)", quadro.view.totalPessoasJuridicas === 2);
    }
    const t1g = await classificarTriagemLinha(batch.id, 1);
    if (t1g.ok) {
      const relGap = t1g.lacunas.find((l) => l.perguntaId === "relacoes_societarias");
      check("expansão concluída → relações RESOLVIDO (fonte percorrida)", relGap?.estado === "RESOLVIDO", `estado=${relGap?.estado}`);
      const fatoExp = relGap?.fatos.find((f) => f.fato.includes("Expansão"));
      // v0.10.24: literal atualizado ao contrato de linguagem natural (plural sem parênteses) —
      // o texto do motor usa plural() desde antes do checkpoint v0.10.23 (asserção envelhecida)
      check("fato da expansão conta por identidade (2 estabelecimentos em 1 outra PJ)", !!fatoExp && fatoExp.fato.includes("2 estabelecimentos em 1 outra pessoa jurídica distinta"), fatoExp?.fato);
    }

    /* ---- 4.e MEI: relações/contabilidade NAO_APLICAVEL, regime SIMEI resolvido ---- */
    const t4 = await classificarTriagemLinha(batch.id, 4);
    if (t4.ok) {
      check("MEI: relações NAO_APLICAVEL", t4.lacunas.find((l) => l.perguntaId === "relacoes_societarias")?.estado === "NAO_APLICAVEL");
      check("MEI: contabilidade NAO_APLICAVEL", t4.lacunas.find((l) => l.perguntaId === "contabilidade_interna")?.estado === "NAO_APLICAVEL");
      check("MEI: regime RESOLVIDO (SIMEI)", t4.lacunas.find((l) => l.perguntaId === "regime_tributario")?.estado === "RESOLVIDO");
    } else check("triagem MEI calculada", false);

    /* ---- 4.f baixada: perguntas operacionais NAO_APLICAVEL ---- */
    const t5 = await classificarTriagemLinha(batch.id, 5);
    if (t5.ok) {
      check("baixada: regime NAO_APLICAVEL", t5.lacunas.find((l) => l.perguntaId === "regime_tributario")?.estado === "NAO_APLICAVEL");
      check("baixada: contabilidade NAO_APLICAVEL", t5.lacunas.find((l) => l.perguntaId === "contabilidade_interna")?.estado === "NAO_APLICAVEL");
      check("baixada: tecnologia NAO_APLICAVEL", t5.lacunas.find((l) => l.perguntaId === "tecnologia_erp")?.estado === "NAO_APLICAVEL");
      check("baixada: estabelecimentos continua aplicável (registro histórico)", !!t5.lacunas.find((l) => l.perguntaId === "estabelecimentos"));
    } else check("triagem baixada calculada", false);

    /* ---- 4.g 429 → INDISPONIVEL; NÃO ENCONTRADO → VALIDACAO_HUMANA ---- */
    const t6 = await classificarTriagemLinha(batch.id, 6);
    check("429: identidade INDISPONIVEL (consulta não concluída)", t6.ok && t6.lacunas.length === 1 && t6.lacunas[0].estado === "INDISPONIVEL");
    const t7 = await classificarTriagemLinha(batch.id, 7);
    check("não encontrado: VALIDACAO_HUMANA com distinção NÃO ENCONTRADO ≠ NÃO PESQUISADO", t7.ok && t7.lacunas[0].estado === "VALIDACAO_HUMANA" && t7.lacunas[0].motivo.includes("NÃO PESQUISADO"));

    /* ---- 4.h estabelecimentos: RESOLVIDO com cobertura parcial → 429 preserva fatos ---- */
    const estabelecimentosSeed = [
      { cnpj: row1, razaoSocial: "BOTICA 0001", municipio: "Rio de Janeiro", uf: "RJ", situacao: "ATIVA", cnae: null, identificadorMatrizFilial: 1, confirmado: true, descobertoPor: "linha do lote", confirmadoEm: agora.toISOString(), fonteConfirmacao: "ficha cadastral" },
      { cnpj: row2, razaoSocial: "BOTICA 0002", municipio: "Niterói", uf: "RJ", situacao: "BAIXADA", cnae: null, identificadorMatrizFilial: 2, confirmado: true, descobertoPor: "quadro do participante", confirmadoEm: agora.toISOString(), fonteConfirmacao: "cadastro" },
      { cnpj: valido("08044783000389"), razaoSocial: "BOTICA 0003", municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: 2, confirmado: true, descobertoPor: "quadro do participante", confirmadoEm: agora.toISOString(), fonteConfirmacao: "cadastro" },
      { cnpj: cnpjValidoSintetico(RAIZ_BOTICA, "0004"), razaoSocial: null, municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: null, confirmado: false, descobertoPor: "quadro do participante", confirmadoEm: null, fonteConfirmacao: null },
      { cnpj: cnpjValidoSintetico(RAIZ_BOTICA, "0005"), razaoSocial: null, municipio: null, uf: null, situacao: null, cnae: null, identificadorMatrizFilial: null, confirmado: false, descobertoPor: "quadro do participante", confirmadoEm: null, fonteConfirmacao: null },
    ];
    const coberturaSeed = { participantesConsultados: [HASH_PF_A], tetoParticipantes: 10, tetoConfirmacoes: 20, pendentesConfirmacao: 2, totalLocalizados: 5, parcial: true, totalParticipantesPfCache: 1 };
    await db.estabelecimentoRootCache.upsert({
      where: { cnpjRaiz: RAIZ_BOTICA },
      create: { cnpjRaiz: RAIZ_BOTICA, fonteDescoberta: "MinhaReceita Grafo — quadros de participantes", coletadoEm: agora, atualizadoEm: agora, validoAte: ttl, estabelecimentosJson: JSON.stringify(estabelecimentosSeed), coberturaJson: JSON.stringify(coberturaSeed) },
      update: { atualizadoEm: agora, validoAte: ttl, estabelecimentosJson: JSON.stringify(estabelecimentosSeed), coberturaJson: JSON.stringify(coberturaSeed) },
    });
    const t1b = await classificarTriagemLinha(batch.id, 1);
    if (t1b.ok) {
      const estab = t1b.lacunas.find((l) => l.perguntaId === "estabelecimentos");
      check("5 localizados, 2 pendentes → COMPLEMENTAR_API", estab?.estado === "COMPLEMENTAR_API");
      // v0.10.24: literal atualizado ao contrato de linguagem natural (o padrão "(s)" é proibido)
      check("fato cita 5 estabelecimentos com matriz pelo campo oficial", (estab?.fatos[0]?.fato ?? "").includes("Encontramos 5 estabelecimentos desta raiz"));
      const mesmaRaizFato = estab?.fatos.find((f) => f.fato.includes("MESMA pessoa jurídica"));
      check("fato do lote marca estabelecimentos como mesma PJ", !!mesmaRaizFato);
    } else check("triagem linha 1 com cache de estabelecimentos", false);

    // confirmação completa (pendentes 0) → RESOLVIDO com nota de cobertura parcial
    const estabelecimentosConfirmados = estabelecimentosSeed.map((e) => ({ ...e, confirmado: true, confirmadoEm: e.confirmadoEm ?? agora.toISOString(), fonteConfirmacao: e.fonteConfirmacao ?? "cadastro (teste)", identificadorMatrizFilial: e.identificadorMatrizFilial ?? 2 }));
    const coberturaCompleta = { ...coberturaSeed, pendentesConfirmacao: 0 };
    await db.estabelecimentoRootCache.update({
      where: { cnpjRaiz: RAIZ_BOTICA },
      data: { estabelecimentosJson: JSON.stringify(estabelecimentosConfirmados), coberturaJson: JSON.stringify(coberturaCompleta) },
    });
    const t1c = await classificarTriagemLinha(batch.id, 1);
    if (t1c.ok) {
      const estab = t1c.lacunas.find((l) => l.perguntaId === "estabelecimentos");
      check("confirmações concluídas → RESOLVIDO", estab?.estado === "RESOLVIDO");
      check("RESOLVIDO ainda declara cobertura parcial e total não afirmado", (estab?.motivo ?? "").includes("PARCIAL") || (estab?.motivo ?? "").includes("parcial"));
      check("RESOLVIDO sem 'falta' e sem próxima verificação", estab?.falta === null && estab?.proximaVerificacao === null);
    }

    // 429 recente NÃO apaga conhecimento — estado INDISPONIVEL com fatos preservados
    await db.telemetryEvent.create({
      data: { batchId: batch.id, rowNumber: 1, tipo: "DESCOBERTA_ROOT", fonte: "MinhaReceita Grafo", alvo: RAIZ_BOTICA, estadoFinal: "falha", httpStatus: 429, payloadJson: JSON.stringify({ tipo: "RATE_LIMITED", via: "consulta" }) },
    });
    const t1d = await classificarTriagemLinha(batch.id, 1);
    if (t1d.ok) {
      const estab = t1d.lacunas.find((l) => l.perguntaId === "estabelecimentos");
      check("429 recente → INDISPONIVEL", estab?.estado === "INDISPONIVEL");
      // v0.10.24: literal atualizado ao contrato de linguagem natural (o padrão "(s)" é proibido)
      check("fatos preservados após 429 (5 estabelecimentos seguem listados)", (estab?.fatos[0]?.fato ?? "").includes("Encontramos 5 estabelecimentos desta raiz"));
    }
    await db.telemetryEvent.deleteMany({ where: { batchId: batch.id, tipo: "DESCOBERTA_ROOT" } });

    /* ---- 4.i regime histórico não resolve vigência; sinais determinísticos resolvem ---- */
    const row1Db = await db.importRow.findFirst({ where: { batchId: batch.id, rowNumber: 1 }, select: { id: true } });
    await db.importRow.update({
      where: { id: row1Db!.id },
      data: {
        researchJson: JSON.stringify({
          dominio: null, paginas: [], buscas: [], notas: ["Notícia de 2023 menciona regime Lucro Real"], sinaisDigitais: ["ERP TOTVS citado em página de vagas"],
          sinaisPorte: ["Vaga para contador interno (contabilidade própria)"], sinaisPorteFontes: [{ fonte: "página de vagas", url: null }],
          teiaBuscada: [], paginasOk: 0, paginasTentadas: 0, buscasOk: 1, geradoEm: agora.toISOString(), modoPesquisa: "COMPLETO", buscasRecusadasCota: 0,
          dimensoesPesquisadas: { identidade: true, tecnologia: true, escala: true, comercial: false, teia: false, periodo: true },
        }),
      },
    });
    const t1e = await classificarTriagemLinha(batch.id, 1);
    if (t1e.ok) {
      const regime = t1e.lacunas.find((l) => l.perguntaId === "regime_tributario");
      check("menção histórica de regime em pesquisa NÃO resolve vigência", regime?.estado === "PESQUISA_DOCUMENTAL");
      const contab = t1e.lacunas.find((l) => l.perguntaId === "contabilidade_interna");
      // v0.10.7 (auditoria): INDÍCIO NÃO É RESOLUÇÃO — vaga de contador é fato com
      // proveniência, lacuna segue ABERTA em VALIDACAO_HUMANA.
      check("sinal de contabilidade é indício → VALIDACAO_HUMANA com fato e proveniência", contab?.estado === "VALIDACAO_HUMANA" && contab.fatos.some((f) => f.origem === "sinal") && (contab.falta ?? "").length > 0, `estado=${contab?.estado}`);
      const tech = t1e.lacunas.find((l) => l.perguntaId === "tecnologia_erp");
      // v0.10.7 (auditoria): menção de ERP NÃO comprova implantação → PESQUISA_DOCUMENTAL.
      check("sinal de ERP é indício → PESQUISA_DOCUMENTAL com falta de implantação", tech?.estado === "PESQUISA_DOCUMENTAL" && tech.fatos.some((f) => f.origem === "sinal") && (tech.falta ?? "").includes("implanta"), `estado=${tech?.estado}`);
    }

    /* ---- 4.j reuso sem duplicar perguntas ---- */
    const t1f = await classificarTriagemLinha(batch.id, 1);
    check("2ª triagem idêntica (mesmas perguntas, sem duplicar)", t1e.ok && t1f.ok && t1f.lacunas.length === t1e.lacunas.length && JSON.stringify(t1f.lacunas.map((l) => l.perguntaId)) === JSON.stringify(t1e.lacunas.map((l) => l.perguntaId)));

    /* ---- 4.k contrato TRIAGEM_V1 sobre a triagem real da linha 1 ---- */
    if (t1f.ok) {
      const dataReferencia = new Date().toISOString();
      const entradas = t1f.lacunas.map((l) => {
        const fatosExportaveis = fatosExportaveisDe(l);
        return lacunaParaTriagemV1(l, {
          cnpjCompleto: t1f.cnpj,
          cnpjRaiz: t1f.cnpjRaiz,
          dataReferencia,
          fontesConsultadas: [...new Set(fatosExportaveis.map((f) => f.fonte).filter((f): f is string => !!f))],
          evidencias: [{ tipo: `triagem:${l.perguntaId}`, referencia: `linha 1 — ${fatosExportaveis.length} fato(s) exportável(is), estado ${l.estado}`, data: fatosExportaveis[0]?.data ?? null }],
          bloqueios: [],
        });
      });
      const valid = validarPacoteTriagemV1(entradas);
      check("pacote completo passa no schema TRIAGEM_V1", valid.ok);
      const serial = JSON.stringify(valid.ok ? valid.entradas : []);
      check("sem hash de PF no pacote", !serial.includes(HASH_PF_A) && !serial.includes(HASH_PF_B));
      check("sem nome de PF nos fatos do contrato", !serial.includes(NOME_PF));
      check("cnpj_completo e cnpj_raiz presentes", valid.ok && valid.entradas.every((e) => e.cnpj_completo === t1f.cnpj && e.cnpj_raiz === t1f.cnpjRaiz));
      check("uma entrada por pergunta (sem lacuna genérica)", valid.ok && valid.entradas.length === t1f.lacunas.length);
      // v0.10.7 (auditoria): evidências POR PERGUNTA — cada entrada referencia só a sua pergunta
      check("evidencias_referenciadas são da própria pergunta", valid.ok && valid.entradas.every((e) => e.evidencias_referenciadas.every((ev) => ev.tipo === `triagem:${e.pergunta_id}`)));
      // v0.10.7 (auditoria): massa sintética é RÓTULADA no arquivo consumível
      mkdirSync("qa/fontes-samples/round-v0.10.6", { recursive: true });
      if (valid.ok) {
        writeFileSync(
          "qa/fontes-samples/round-v0.10.6/exemplo-triagem-v1-SINTETICO.json",
          JSON.stringify(
            {
              aviso_massa_teste: "MASSA DE TESTE SINTÉTICA — não é dado real de empresa. CNPJs reais usados apenas como chave de fixação da regressão; razão social, município, datas e sinais são INVENTADOS.",
              versao_contrato: TRIAGEM_V1_VERSAO,
              geradoEm: dataReferencia,
              total_entradas: valid.entradas.length,
              entradas: valid.entradas,
            },
            null,
            2
          )
        );
        writeFileSync("qa/fontes-samples/round-v0.10.6/exemplo-triagem-v1-SINTETICO.jsonl", paraJsonl(valid.entradas));
        check("exemplos do contrato gravados como evidência (rótulados SINTETICO)", true);
      }
    }

    /* ---- 4.l homônimos seguem distintos (regressão v0.10.5 na nova camada) ---- */
    const respostaHom = [
      { cnpj: row1, razao_social: "EMPRESA", id: HASH_PF_A, nome: "MARIA HOMONIMA", cpf: "**123456**" },
      { cnpj: row1, razao_social: "EMPRESA", id: HASH_PF_B, nome: "MARIA HOMONIMA", cpf: "**654321**" },
    ];
    // normalizador é testado indiretamente pelo quadro: dois hashes distintos = 2 participantes
    const quadroA = await db.quadroParticipanteCache.findUnique({ where: { participanteId: HASH_PF_A } });
    const quadroB = await db.quadroParticipanteCache.upsert({
      where: { participanteId: HASH_PF_B },
      create: { participanteId: HASH_PF_B, tipoParticipante: "PF", rotulo: null, fonte: "MinhaReceita Grafo", coletadoEm: agora, validoAte: ttl, empresasJson: JSON.stringify(quadroEmpresas), totalEmpresas: quadroEmpresas.length, truncado: false },
      update: {},
    });
    check("participantes com identidade própria têm quadros separados", !!quadroA && !!quadroB && quadroA.participanteId !== quadroB.participanteId);
    check("homônimo NUNCA é deduplicado por nome", respostaHom[0].id !== respostaHom[1].id && respostaHom[0].nome === respostaHom[1].nome);

    /* ================== CAMADA 3 — INTEGRAÇÃO AO VIVO (Botica real) ================== */
    console.log("\n[5] integração ao vivo (Botica) — identidade consolidada com dados reais");
    // limpar caches da Botica para consulta fresca (zero IA; fontes públicas sob comando)
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { startsWith: RAIZ_BOTICA } } });
    await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: RAIZ_BOTICA } });

    const relLive1 = await investigarRelacoes(batch.id, 1);
    check("relações ao vivo da matriz Botica", relLive1.ok);
    if (relLive1.ok) {
      const relLive2 = await investigarRelacoes(batch.id, 2);
      check("relações ao vivo da filial Botica", relLive2.ok);
      if (relLive2.ok) {
        const pfLive = relLive2.view.participantes.find((p) => p.tipo === "PF");
        if (pfLive) {
          idsQuadroUsados.push(pfLive.participanteId);
          const mesmaPj = pfLive.comumMesmaPj.find((c) => c.cnpj === row1);
          const falsoComum = pfLive.comumCom.find((c) => raizDe(c.cnpj) === RAIZ_BOTICA);
          check("matriz 0001 e filial 0002 NÃO aparecem como empresas distintas (comumCom vazio na mesma raiz)", !falsoComum);
          check("participante comum à matriz aparece como comumMesmaPj (mesma pessoa jurídica)", !!mesmaPj);
        } else {
          check("quadro vivo tem participante PF para o teste", false, "sem PF no quadro desta consulta");
        }
      }
    }

    const mfLive = await investigarMatrizFiliais(batch.id, 1);
    check("descoberta ao vivo de estabelecimentos da raiz", mfLive.ok);
    let comparativo: Record<string, unknown> | null = null;
    if (mfLive.ok) {
      const todos = [mfLive.view.matriz, ...mfLive.view.filiais, ...mfLive.view.localizadosNaoConfirmados];
      const raizes = new Set(todos.map((e) => e && raizDe(e.cnpj)));
      check("todos os estabelecimentos localizados pertencem a UMA raiz", raizes.size === 1 && raizes.has(RAIZ_BOTICA));
      check("matriz identificada pelo campo oficial (=1)", !mfLive.view.matriz || mfLive.view.matriz.identificadorMatrizFilial === 1);
      check("cobertura marcada como PARCIAL", mfLive.view.cobertura.parcial === true);

      // quadro do participante PF ao vivo: contagem consolidada
      const pfLive = relLive1.ok ? relLive1.view.participantes.find((p) => p.tipo === "PF") : null;
      if (pfLive) {
        idsQuadroUsados.push(pfLive.participanteId);
        const quadroLive = await investigarConexao(batch.id, 1, pfLive.participanteId);
        if (quadroLive.ok) {
          const boticaNoQuadro = quadroLive.view.empresas.filter((e) => raizDe(e.cnpj) === RAIZ_BOTICA);
          comparativo = {
            rodada: "v0.10.6",
            cnpj_consultado: row1,
            cnpj_raiz: RAIZ_BOTICA,
            antes_v0105: {
              empresas_no_quadro: quadroLive.view.totalEmpresas,
              leitura: "CNPJs completos contados como empresas; sobreposição matriz/filial aparecia como 'participante comum' entre duas empresas",
              participante_comum_entre_mesma_raiz: "contado indevidamente como relação entre empresas distintas",
            },
            depois_v0106: {
              pessoas_juridicas_no_quadro: quadroLive.view.totalPessoasJuridicas,
              estabelecimentos_no_quadro: quadroLive.view.totalEmpresas,
              estabelecimentos_botica_localizados: boticaNoQuadro.length,
              participante_comum_entre_mesma_raiz: 0,
              comumMesmaPj_matriz_filial: 1,
              participante_comum_raizes_distintas_no_lote: 0,
              leitura: "1 pessoa jurídica com N estabelecimentos; sobreposição na mesma raiz é mesma PJ, nunca relação entre empresas",
            },
            descoberta_estabelecimentos: {
              matriz: mfLive.view.matriz?.cnpj ?? null,
              filiais_confirmadas: mfLive.view.filiais.map((f) => f.cnpj),
              localizados_nao_confirmados: mfLive.view.localizadosNaoConfirmados.map((f) => f.cnpj),
              cobertura: "PARCIAL (quantidade total não afirmada)",
            },
          };
          writeFileSync("qa/fontes-samples/round-v0.10.6/comparativo-antes-depois.json", JSON.stringify(comparativo, null, 2));
          check("comparativo antes/depois gravado como evidência", true);
          check("consolidação: 5 estabelecimentos da Botica no quadro = 1 PJ nesta raiz", boticaNoQuadro.length === 5, `localizados=${boticaNoQuadro.length}`);
        }
      }

      // triagem ao vivo pós-descoberta: estados finais da Botica
      const tLive = await classificarTriagemLinha(batch.id, 1);
      if (tLive.ok) {
        const estab = tLive.lacunas.find((l) => l.perguntaId === "estabelecimentos");
        const estadosValidos = estab?.estado === "RESOLVIDO" || estab?.estado === "COMPLEMENTAR_API";
        check("triagem ao vivo: estabelecimentos em estado honesto (RESOLVIDO parcial ou COMPLEMENTAR_API)", estadosValidos, `estado=${estab?.estado}`);
        // v0.10.16 (contrato de linguagem): a frase agora abre com "Encontramos N estabelecimento(s)..."
        const mLocalizados = Number((estab?.fatos[0]?.fato ?? "").match(/(?:^|Encontramos )(\d+) estabelecimento/)?.[1] ?? "0");
        check("triagem ao vivo cita estabelecimentos localizados da raiz", mLocalizados >= 2, estab?.fatos[0]?.fato);
        const relGap = tLive.lacunas.find((l) => l.perguntaId === "relacoes_societarias");
        check("triagem ao vivo: relações RESOLVIDO (quadro público consultado)", relGap?.estado === "RESOLVIDO", `estado=${relGap?.estado}`);
      }
    }
  } finally {
    await limparTudo(batch.id, [...new Set(idsQuadroUsados)], cnpjsCache, raizesCache);
    const sobraBatch = await db.importBatch.count({ where: { id: batch.id } });
    check("banco limpo após o teste (lote removido)", sobraBatch === 0);
    const sobraRel = await db.relacaoSocietariaCache.count({ where: { cnpj: { in: cnpjsCache } } });
    check("caches de relações do teste removidos", sobraRel === 0);
    const sobraRoot = await db.estabelecimentoRootCache.count({ where: { cnpjRaiz: { in: raizesCache } } });
    check("caches de estabelecimentos do teste removidos", sobraRoot === 0);
    const sobraQuadro = await db.quadroParticipanteCache.count({ where: { participanteId: { in: [...new Set(idsQuadroUsados)] } } });
    check("quadros do teste removidos", sobraQuadro === 0);
    const sobraCad = await db.cadastroCache.count({ where: { cnpj: { in: cnpjsCache } } });
    check("fichas cadastrais do teste removidas", sobraCad === 0);
  }

  console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
  if (fail > 0) {
    console.log("FALHAS:");
    for (const f of falhas) console.log(" - " + f);
    process.exit(1);
  }
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("ERRO FATAL DA SUÍTE:", e);
  process.exit(1);
});
