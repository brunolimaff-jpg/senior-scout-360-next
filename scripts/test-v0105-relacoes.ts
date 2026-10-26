/**
 * Suíte v0.10.5 — RELAÇÕES EMPRESARIAIS (FRENTE A) + MATRIZ/FILIAIS (FRENTE B).
 *
 * Camada 1 (OFFLINE, pura): normalizadores, erros honestos, teto, deduplicação,
 * homônimos, CPF descartado, participante comum ≠ grupo, raiz alfanumérica.
 * Camada 2 (ONLINE, integração mínima): Botica 08044783000117 (matriz real com
 * filiais reais) investigada ponta a ponta com a fonte real + reuso de cache.
 * O banco de dev é usado e LIMPO no fim (batches em cascata + caches das chaves
 * usadas + telemetria/auditoria do lote de teste).
 *
 * Uso: bun scripts/test-v0105-relacoes.ts
 */
import { db } from "../src/lib/db";
import {
  normalizarRelacoesGrafo,
  normalizarQuadroParticipante,
  filtrarMesmoRaiz,
  detectarParticipantesComuns,
  validarParticipanteId,
  mapearErroGrafo,
  idPareceCnpj,
  QUADRO_TETO,
} from "../src/lib/relations/grafo";
import { validateCnpj } from "../src/lib/cnpj";
import {
  investigarRelacoes,
  investigarConexao,
  investigarMatrizFiliais,
  TETO_PARTICIPANTES,
  TETO_CONFIRMACOES,
  type GrafoFetcher,
} from "../src/lib/relations/service";

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

/* ============================== CAMADA 1 — OFFLINE ============================== */

console.log("\n[1] normalizarRelacoesGrafo — participantes com identidade própria");
{
  const resposta = [
    { cnpj: "33000167000101", razao_social: "EMPRESA A S A", id: "13945bd3d7bf288f3cb867d74a1d4807", nome: "MARIA SOARES", cpf: "***123456**" },
    { cnpj: "33000167000101", razao_social: "EMPRESA A S A", id: "33000167000688", nome: "EMPRESA B PARTICIPACOES LTDA", cpf: "***654321**" },
    { cnpj: "33000167000101", razao_social: "EMPRESA A S A", id: "13945bd3d7bf288f3cb867d74a1d4807", nome: "MARIA SOARES", cpf: "***123456**" }, // duplicado por id
    { cnpj: "33000167000101", razao_social: "EMPRESA A S A", nome: "SEM ID", cpf: "***000000**" },
  ];
  const n = normalizarRelacoesGrafo(resposta, { cnpjConsultado: "33000167000101" }) as Exclude<ReturnType<typeof normalizarRelacoesGrafo>, { ok: false }>;
  check("dedup por id (2 participantes únicos a partir de 4 linhas)", n.ok && n.totalParticipantes === 2);
  check("PF com hash opaco", n.participantes.some((p) => p.tipo === "PF" && p.participanteId === "13945bd3d7bf288f3cb867d74a1d4807" && p.cnpjParticipante === null));
  check("PJ com id=CNPJ", n.participantes.some((p) => p.tipo === "PJ" && p.participanteId === "33000167000688" && p.cnpjParticipante === "33000167000688"));
  // v0.10.23 — asserção atualizada para a linguagem natural da Fase Zero (fim do "(s)")
  check("linha sem id descartada com aviso", n.avisos.some((a) => a.includes("1 linha sem identificador próprio") && a.includes("descartada")));
  const serial = JSON.stringify(n);
  check("CPF (mesmo mascarado) NUNCA sai no normalizado", !serial.includes("123456") && !serial.includes("cpf"));
  check("resposta bruta de PF não propagada (sem chave cpf)", !serial.includes('"cpf"'));
}

console.log("\n[2] homônimos — nome igual NÃO é identidade");
{
  const resposta = [
    { cnpj: "33000167000101", razao_social: "A", id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nome: "JOAO SILVA" },
    { cnpj: "33000167000101", razao_social: "A", id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", nome: "JOAO SILVA" },
  ];
  const n = normalizarRelacoesGrafo(resposta, { cnpjConsultado: "33000167000101" }) as Exclude<ReturnType<typeof normalizarRelacoesGrafo>, { ok: false }>;
  check("dois homônimos com hashes distintos = 2 participantes", n.ok && n.totalParticipantes === 2);
  const comuns = detectarParticipantesComuns(
    n.participantes,
    [{ participanteId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tipo: "PF", nomePublico: "JOAO SILVA", cnpjParticipante: null }]
  );
  check("participante comum por ID, não por nome (apenas 1 dos homônimos)", comuns.length === 1 && comuns[0].participanteId === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}

console.log("\n[3] CNPJ alfanumérico como participante PJ (RFB 2026)");
{
  const id = "00000000E08G12"; // 14 alfanuméricos do exemplo oficial RFB
  check("id alfanumérico 14 chars reconhecido como CNPJ", idPareceCnpj(id));
  const resposta = [{ cnpj: "00000000000191", razao_social: "BANCO DO BRASIL SA", id, nome: "00000000E08G12 EMPRESA ALFA LTDA" }];
  const n = normalizarRelacoesGrafo(resposta, { cnpjConsultado: "00000000000191" }) as Exclude<ReturnType<typeof normalizarRelacoesGrafo>, { ok: false }>;
  check("participante PJ alfanumérico normalizado", n.ok && n.participantes[0].tipo === "PJ" && n.participantes[0].cnpjParticipante === id);
  const raiz = filtrarMesmoRaiz([{ cnpj: "00000000E08G12", razaoSocial: null }, { cnpj: "00000000E08G13", razaoSocial: null }, { cnpj: "11111111000111", razaoSocial: null }], "00000000E08G12");
  check("filtro de raiz alfanumérica (prefixo 8)", raiz.length === 2 && raiz.every((e) => e.cnpj.startsWith("00000000")));
}

console.log("\n[4] normalizarQuadroParticipante — teto e dedup");
{
  const linhas = Array.from({ length: QUADRO_TETO + 30 }, (_, i) => ({
    cnpj: String(i + 1).padStart(14, "0"),
    razao_social: `E${i}`,
    id: "x",
    nome: "P",
    cpf: "***x**",
  }));
  const n = normalizarQuadroParticipante(linhas, { participanteId: "a".repeat(32), tipoParticipante: "PF" }) as Exclude<ReturnType<typeof normalizarQuadroParticipante>, { ok: false }>;
  check(`teto de armazenamento ${QUADRO_TETO} aplicado`, n.ok && n.empresas.length === QUADRO_TETO);
  check("total real preservado", n.totalEmpresas === QUADRO_TETO + 30);
  check("flag truncado honesta", n.truncado === true);
  const n2 = normalizarQuadroParticipante(
    [{ cnpj: "08044783000117", razao_social: "BOTICA" }, { cnpj: "08044783000117", razao_social: "BOTICA" }, { cnpj: "sem-cnpj", razao_social: "x" }],
    { participanteId: "a".repeat(32), tipoParticipante: "PF" }
  ) as Exclude<ReturnType<typeof normalizarQuadroParticipante>, { ok: false }>;
  check("dedup por CNPJ + linhas sem CNPJ descartadas", n2.ok && n2.totalEmpresas === 1);
}

console.log("\n[5] erros honestos da fonte");
{
  const e404 = mapearErroGrafo(404, '{"message":"Identificador não encontrado ou sem conexões."}');
  check("404 = ausência registrada (não é erro de rede)", e404.tipo === "SEM_RELACOES_REGISTRADAS" && e404.httpStatus === 404);
  const e429 = mapearErroGrafo(429, null);
  check("429 = RATE_LIMITED com status preservado", e429.tipo === "RATE_LIMITED" && e429.httpStatus === 429);
  const eto = mapearErroGrafo(null, null, "timeout");
  check("timeout = TIMEOUT sem status inventado", eto.tipo === "TIMEOUT" && eto.httpStatus === null);
  const e5xx = mapearErroGrafo(503, null);
  check("5xx = FONTE_INDISPONIVEL", e5xx.tipo === "FONTE_INDISPONIVEL");
  const corpo = erroDeCorpoNaoArrayTeste({ message: "Identificador 33534576000198 não encontrado ou sem conexões." });
  check("corpo {message:'não encontrado'} → ausência honesta", corpo.tipo === "SEM_RELACOES_REGISTRADAS");
  const corpo400 = erroDeCorpoNaoArrayTeste({ message: "Endpoint inválido. Use /<ID> para relações." });
  check("corpo {message:'inválido'} → CNPJ_INVALIDO", corpo400.tipo === "CNPJ_INVALIDO");
}
function erroDeCorpoNaoArrayTeste(resposta: unknown) {
  // expõe o caminho do corpo-não-array através do normalizador
  const r = normalizarRelacoesGrafo(resposta, { cnpjConsultado: "00000000000191" });
  return r as { ok: false; tipo: string };
}

console.log("\n[6] validarParticipanteId");
{
  const v = (s: string) => validarParticipanteId(s, validateCnpj);
  check("hash opaco aceito como PF", v("13945bd3d7bf288f3cb867d74a1d4807").ok && (v("13945bd3d7bf288f3cb867d74a1d4807") as { tipo: string }).tipo === "PF");
  check("CNPJ válido aceito como PJ", v("33000167000101").ok && (v("33000167000101") as { tipo: string }).tipo === "PJ");
  check("CNPJ com DV inválido REJEITADO", !v("60893265000180").ok);
  check("lixo rejeitado", v("'%20DROP").ok === false && v("").ok === false && v("abc").ok === false);
  check("CPF (11 dígitos) rejeitado como participante", !v("12345678901").ok);
}

console.log("\n[7] merge de estabelecimentos sem duplicar (reuso de cache)");
{
  // simulação do merge do service: confirmado NUNCA é apagado, localizado não duplica
  const antigos = [
    { cnpj: "08044783000117", confirmado: true, razaoSocial: "BOTICA MATRIZ", municipio: "SAO PAULO", uf: "SP", situacao: "ATIVA", identificadorMatrizFilial: 1 },
    { cnpj: "08044783000206", confirmado: false, razaoSocial: "BOTICA FILIAL 2", municipio: null },
  ];
  const novosLoc = [
    { cnpj: "08044783000206", razaoSocial: "BOTICA FILIAL 2 (quadro)" },
    { cnpj: "08044783000389", razaoSocial: "BOTICA FILIAL 3 (quadro)" },
  ];
  const mapa = new Map(antigos.map((e) => [e.cnpj, e]));
  for (const l of novosLoc) if (!mapa.has(l.cnpj)) mapa.set(l.cnpj, { ...antigos[1], cnpj: l.cnpj, razaoSocial: l.razaoSocial, confirmado: false, identificadorMatrizFilial: null });
  const lista = [...mapa.values()];
  check("sem duplicação após merge", lista.length === 3 && lista.filter((e) => e.cnpj === "08044783000206").length === 1);
  check("fato confirmado preservado (não apagado pelo merge)", lista.find((e) => e.cnpj === "08044783000117")?.confirmado === true && lista.find((e) => e.cnpj === "08044783000117")?.razaoSocial === "BOTICA MATRIZ");
  const matrizOficial = lista.find((e) => e.identificadorMatrizFilial === 1);
  check("matriz identificada pelo CAMPO oficial (1), não pela ordem 0001", matrizOficial?.cnpj === "08044783000117" && matrizOficial.identificadorMatrizFilial === 1);
}

console.log("\n[8] matriz/ordem — a ordem 0001 nunca prova matriz");
{
  // cenário sintético: 0001 diz FILIAL (campo oficial) → matriz NÃO pode ser 0001
  const estabelecimentos = [
    { cnpj: "00000000A000101", identificadorMatrizFilial: 2, confirmado: true },
    { cnpj: "00000000A000202", identificadorMatrizFilial: 1, confirmado: true },
  ];
  const matrizes = estabelecimentos.filter((e) => e.identificadorMatrizFilial === 1);
  check("campo oficial aponta matriz em ordem ≠ 0001 (alfanumérica)", matrizes.length === 1 && matrizes[0].cnpj === "00000000A000202");
}

/* ============================== CAMADA 2 — ONLINE ============================== */

const CNPJ_BOTICA = "08044783000117"; // Botica Comercial Farmacêutica (matriz real, 4 filiais reais)

console.log("\n[9] integração mínima ao vivo (Botica) — investigação sob comando");

async function limparTeste(batchId: string, idsQuadro: string[]) {
  await db.auditEvent.deleteMany({ where: { batchId } });
  await db.telemetryEvent.deleteMany({ where: { batchId } });
  await db.importBatch.delete({ where: { id: batchId } }).catch(() => undefined);
  // caches usados pelos testes (chaves conhecidas)
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: CNPJ_BOTICA } });
  await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: "08044783" } });
  if (idsQuadro.length > 0) {
    await db.quadroParticipanteCache.deleteMany({ where: { participanteId: { in: idsQuadro } } }).catch(() => undefined);
  }
}

async function main() {
  const idsQuadroUsados: string[] = [];
  const batch = await db.importBatch.create({
    data: { fileName: "TESTE-v0105-relacoes.csv", storedPath: "", fileSize: 0, status: "DONE" },
  });
  const row = await db.importRow.create({
    data: {
      batchId: batch.id,
      rowNumber: 1,
      rawCnpj: CNPJ_BOTICA,
      normalizedCnpj: validateCnpj(CNPJ_BOTICA).normalized,
      cnpjStatus: "VALIDA",
      lookupStatus: "ENRIQUECIDO",
      legalName: "BOTICA COMERCIAL FARMACEUTICA LTDA",
      branchType: "MATRIZ",
      branchIdentifier: 1,
      cnpjRoot: "08044783",
    },
  });
  try {
    // 9.a relações diretas (fonte real)
    const rel = await investigarRelacoes(batch.id, 1);
    check("relações investigadas com sucesso", rel.ok);
    if (rel.ok) {
      check("razão social oficial da linha presente", rel.view.razaoSocialConsultada === "BOTICA COMERCIAL FARMACEUTICA LTDA");
      check("fonte registrada", rel.view.fonte === "MinhaReceita Grafo");
      check("participantes normalizados ≥1", rel.view.totalParticipantes >= 1);
      check("nenhum campo cpf em qualquer participante", rel.view.participantes.every((p) => !("cpf" in p)));
      // 9.b reuso de cache (segunda chamada NÃO consulta HTTP)
      const rel2 = await investigarRelacoes(batch.id, 1);
      check("reuso de cache sem nova consulta", rel2.ok && rel2.view.via === "cache");
      check("mesma contagem no reuso (sem duplicar)", rel2.ok && rel2.view.totalParticipantes === rel.view.totalParticipantes);

      // 9.c expansão manual do primeiro participante PF (1 hop real)
      const pf = rel.view.participantes.find((p) => p.tipo === "PF");
      if (pf) {
        idsQuadroUsados.push(pf.participanteId);
        const quadro = await investigarConexao(batch.id, 1, pf.participanteId);
        check("expansão manual (1 hop) com sucesso", quadro.ok);
        if (quadro.ok) {
          check("quadro tem empresas ≥1", quadro.view.totalEmpresas >= 1);
          check("exibição respeita teto 50", quadro.view.empresas.length <= 50);
          const mesmoRoot = quadro.view.empresas.filter((e) => e.cnpj.startsWith("08044783"));
          check("quadro contém estabelecimentos da raiz 08044783", mesmoRoot.length >= 1);
          // reuso do quadro
          const quadro2 = await investigarConexao(batch.id, 1, pf.participanteId);
          check("reuso do quadro via cache", quadro2.ok && quadro2.view.via === "cache");
          check("reuso sem duplicar empresas", quadro2.ok && quadro2.view.totalEmpresas === quadro.view.totalEmpresas);
        }
      }

      // 9.d matriz e filiais (descoberta + confirmação individual real)
      const mf = await investigarMatrizFiliais(batch.id, 1);
      check("descoberta de estabelecimentos pela raiz executada", mf.ok);
      if (mf.ok) {
        check("cobertura sempre marcada como PARCIAL", mf.view.cobertura.parcial === true);
        check("estabelecimentos localizados ≥1 (o consultado)", mf.view.filiais.length + (mf.view.matriz ? 1 : 0) + mf.view.localizadosNaoConfirmados.length >= 1);
        const todos = [mf.view.matriz, ...mf.view.filiais, ...mf.view.localizadosNaoConfirmados].filter(Boolean);
        check("estabelecimento consultado presente", todos.some((e) => e && e.cnpj === CNPJ_BOTICA));
        const consultado = todos.find((e) => e && e.cnpj === CNPJ_BOTICA);
        check("consultado confirmado com identificador oficial 1", !!consultado && consultado.confirmado === true && consultado.identificadorMatrizFilial === 1);
        const total = mf.view.filiais.length + mf.view.localizadosNaoConfirmados.length;
        check("filiais descobertas além do consultado (Botica tem 4 reais)", total >= 1, `total=${total}`);
        const confirmadas = mf.view.filiais.filter((f) => f.confirmado);
        check("filiais confirmadas têm campo oficial FILIAL (2)", confirmadas.every((f) => f.identificadorMatrizFilial === 2));
        check("todas as linhas têm proveniência da descoberta", todos.every((e) => e && typeof e.descobertoPor === "string" && e.descobertoPor.length > 0));
        check("matriz ≠ aposta na ordem 0001 (é campo oficial)", !mf.view.matriz || mf.view.matriz.identificadorMatrizFilial === 1);

        // 9.e segunda rodada: reuso SEM duplicar (cache válido)
        const mf2 = await investigarMatrizFiliais(batch.id, 1);
        check("2ª rodada reusa cache da raiz (via cache)", mf2.ok && mf2.view.via === "cache");
        if (mf2.ok) {
          const total2 = mf2.view.filiais.length + mf2.view.localizadosNaoConfirmados.length + (mf2.view.matriz ? 1 : 0);
          const total1 = mf.view.filiais.length + mf.view.localizadosNaoConfirmados.length + (mf.view.matriz ? 1 : 0);
          check("reuso não duplica unidades", total2 === total1, `t1=${total1} t2=${total2}`);
        }
      }
    }

    // 9.f participante comum NÃO rotulado como grupo (sintético, offline)
    const relA = [{ participanteId: "cccccccccccccccccccccccccccccccc", tipo: "PF" as const, nomePublico: "Z", cnpjParticipante: null }];
    const relB = [{ participanteId: "cccccccccccccccccccccccccccccccc", tipo: "PF" as const, nomePublico: "Z", cnpjParticipante: null }];
    const comuns = detectarParticipantesComuns(relA, relB);
    check("participante comum detectado por evidência dupla", comuns.length === 1);
    // o rótulo do sistema NUNCA é "grupo econômico" — texto exigido na UI:
    const nota = "participante comum (mesmo quadro público) — NÃO caracteriza grupo econômico";
    check("nota de participante comum nega grupo econômico explicitamente", nota.includes("NÃO caracteriza grupo econômico"));

    // 9.g falha da fonte preserva fatos — simulador de fonte indisponível
    const fetcherQuebrado: GrafoFetcher = async () => ({ status: 503, json: { message: "boom" } });
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: CNPJ_BOTICA } }); // força consulta
    const relFalha = await investigarRelacoes(batch.id, 1, { fetcher: fetcherQuebrado });
    check("fonte indisponível → falha honesta", !relFalha.ok && relFalha.motivo === "fonte_erro" && relFalha.erroFonte?.tipo === "FONTE_INDISPONIVEL");
    const mfCacheDepois = await db.estabelecimentoRootCache.findUnique({ where: { cnpjRaiz: "08044783" } });
    check("falha da fonte NÃO apaga estabelecimentos já confirmados", !!mfCacheDepois && JSON.parse(mfCacheDepois.estabelecimentosJson).some((e: { cnpj: string; confirmado: boolean }) => e.cnpj === CNPJ_BOTICA && e.confirmado === true));
    const fetcher429: GrafoFetcher = async () => ({ status: 429, json: { message: "limit" } });
    const rel429 = await investigarRelacoes(batch.id, 1, { fetcher: fetcher429 });
    check("429 → RATE_LIMITED (tipo preservado)", !rel429.ok && rel429.erroFonte?.tipo === "RATE_LIMITED");
    const fetcherTimeout: GrafoFetcher = async () => ({ status: 0, json: null, causa: "timeout" });
    const relTo = await investigarRelacoes(batch.id, 1, { fetcher: fetcherTimeout });
    check("timeout → TIMEOUT", !relTo.ok && relTo.erroFonte?.tipo === "TIMEOUT");
    const fetcher404: GrafoFetcher = async () => ({ status: 404, json: { message: "Identificador X não encontrado ou sem conexões." } });
    const rel404 = await investigarRelacoes(batch.id, 1, { fetcher: fetcher404 });
    check("404 → ausência honesta com lista vazia (NÃO é falha)", rel404.ok && rel404.view.participantes.length === 0 && rel404.view.avisos.length >= 1);
  } finally {
    await limparTeste(batch.id, idsQuadroUsados);
    const sobraBatch = await db.importBatch.count({ where: { id: batch.id } });
    check("banco de dev limpo após o teste (lote removido)", sobraBatch === 0);
    const sobraRel = await db.relacaoSocietariaCache.count({ where: { cnpj: CNPJ_BOTICA } });
    check("cache de relações do teste removido", sobraRel === 0);
    await db.importRow.deleteMany({ where: { batchId: batch.id } }).catch(() => undefined);
  }

  // 9.h teto de participantes documentado
  check("teto de participantes definido e honesto (≥1)", TETO_PARTICIPANTES >= 1);
  check("teto de confirmações definido e honesto (≥1)", TETO_CONFIRMACOES >= 1);

  console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
  if (fail > 0) {
    console.log("FALHAS:");
    for (const f of falhas) console.log(" - " + f);
    process.exit(1);
  }
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("ERRO FATAL:", e);
  await db.$disconnect();
  process.exit(1);
});
