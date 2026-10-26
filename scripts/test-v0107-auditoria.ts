/**
 * Suíte v0.10.7 — AUDITORIA INDEPENDENTE: correção dos desvios da v0.10.6.
 *
 * Reproduz, contra o algoritmo REAL, os casos adversariais do auditor e prova as correções:
 *   1. INDÍCIO NÃO É RESOLUÇÃO — "Vaga aberta: contratar contador interno" →
 *      VALIDACAO_HUMANA (nunca RESOLVIDO); "Vaga de SAP em consultoria parceira" →
 *      PESQUISA_DOCUMENTAL; o sinal fica como FATO com proveniência e a lacuna ABERTA.
 *   2. FILIAL BAIXADA ≠ PJ ENCERRADA — perguntas da PESSOA_JURIDICA não caem em
 *      NAO_APLICAVEL quando só uma filial está baixada e a raiz não está provada morta;
 *      matriz baixada mantém NAO_APLICAVEL (regressão); raiz provada morta (cache com
 *      cobertura esgotada e todas as confirmadas encerradas) → NAO_APLICAVEL dirigido.
 *   3. PRIVACIDADE DA EXPORTAÇÃO — sinais (texto livre) exportam SÓ síntese
 *      determinística; pipeline adversarial (nomes, CPF, hash, e-mail, telefone) no
 *      caminho legado; fatos estruturados (razão social) preservados.
 *   4. EVIDÊNCIAS POR PERGUNTA — cada entrada TRIAGEM_V1 referencia a SUA pergunta.
 *   5. GATE CENTRAL — zero chamada de IA e zero busca web nas triagens (telemetria).
 *
 * Camada 1 OFFLINE (contrato); Camada 2 em banco de dev (limpo no fim); sem rede,
 * sem IA, sem chamada paga. Uso: bun scripts/test-v0107-auditoria.ts
 */
import { db } from "../src/lib/db";
import { validateCnpj } from "../src/lib/cnpj";
import { raizDe } from "../src/lib/relations/grafo";
import { classificarTriagemLinha } from "../src/lib/triage/engine";
import {
  prepararFatoParaExport,
  fatosExportaveisDe,
  lacunaParaTriagemV1,
  validarPacoteTriagemV1,
  TRIAGEM_V1_VERSAO,
} from "../src/lib/triage/contrato";
import type { FatoTriagemView, LacunaTriagemView } from "../src/lib/types";

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
  const base = `${raiz}${ordem}`;
  return base + dvCnpj(base);
}

function valido(c: string): string {
  const v = validateCnpj(c);
  if (!v.valid) throw new Error(`CNPJ sintético inválido no teste: ${c}`);
  return v.normalized;
}

const NOME_AUDIT = "Responsavel Maria Silva";
const CPF_AUDIT = "529.982.247-25"; // DV válido — deve ser suprimido

function lacunaDe(fatos: FatoTriagemView[], estado: LacunaTriagemView["estado"], perguntaId = "contabilidade_interna"): LacunaTriagemView {
  return {
    perguntaId,
    pergunta: "Possui contabilidade interna (estrutura própria de contabilidade/fiscal)?",
    estado,
    motivo: "teste",
    entidade: "PESSOA_JURIDICA",
    fatos,
    falta: null,
    proximaVerificacao: null,
    utilidade: "teste",
  };
}

/* ======================= CAMADA 1 — PRIVACIDADE DA EXPORTAÇÃO ======================= */

console.log("\n[1] contrato TRIAGEM_V1 — sinais exportam SÓ síntese (texto livre fica na VM)");
{
  const sinalComSintese: FatoTriagemView = {
    fato: "Vaga aberta: contratar contador interno",
    fonte: "página de vagas",
    data: "2026-10-22T00:00:00.000Z",
    origem: "sinal",
    sintese: 'Indício público de contabilidade própria detectado em pesquisa documental (termo: "contador") — texto integral preservado apenas na ficha interna (privacidade); não comprova estrutura interna atual.',
  };
  const exp = prepararFatoParaExport(sinalComSintese);
  check("sinal com síntese exporta a SÍNTESE", !!exp && exp.fato.includes("Indício público de contabilidade própria"));
  check("texto livre bruto NÃO sai no fato exportado", !!exp && !exp.fato.includes("contratar contador interno"));

  const sinalErp: FatoTriagemView = {
    fato: "Vaga de SAP em consultoria parceira",
    fonte: "portal de vagas",
    data: "2026-10-22T00:00:00.000Z",
    origem: "sinal",
    sintese: 'Indício público de sistema de gestão detectado em pesquisa documental (termo: "SAP") — texto integral preservado apenas na ficha interna (privacidade); menção não comprova implantação ou uso em produção.',
  };
  const expErp = prepararFatoParaExport(sinalErp);
  check("sinal de ERP exporta síntese sem o texto bruto da vaga", !!expErp && expErp.fato.includes("sistema de gestão") && !expErp.fato.includes("consultoria parceira"));
  check("fonte e data da coleta seguem na síntese", expErp?.fonte === "portal de vagas" && expErp?.data === "2026-10-22T00:00:00.000Z");
}

console.log("\n[2] pipeline adversarial legado (sinal SEM síntese — defesa em profundidade)");
{
  const texto = `Vaga aberta: ${NOME_AUDIT} (contato ${CPF_AUDIT}, maria.silva@exemplo.com, tel (21) 98765-4321, id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)`;
  const exp = prepararFatoParaExport({ fato: texto, fonte: "fonte livre", data: null });
  const s = exp?.fato ?? "";
  check("nome de PF do audit NÃO exporta", !s.includes("Maria") && !s.includes("Silva"), s);
  check("CPF com DV válido é suprimido", s.includes("[suprimido]") && !s.includes(CPF_AUDIT));
  check("e-mail é suprimido", s.includes("[e-mail suprimido]") && !s.includes("maria.silva@"));
  check("telefone é suprimido", s.includes("[telefone suprimido]") && !s.includes("98765-4321"));
  check("hash opaco de PF é suprimido", !s.includes("aaaaaaaa"));

  const exp2 = prepararFatoParaExport({ fato: "Entrevista com Fernando Alves sobre ERP TOTVS", fonte: null, data: null });
  check("prenome em texto livre é suprimido (sem marcador de papel)", !!exp2 && !exp2.fato.includes("Fernando"), exp2?.fato);
  check("termo técnico/empresa não é confundido com pessoa", !!exp2 && exp2.fato.includes("ERP TOTVS"));

  const exp3 = prepararFatoParaExport({ fato: "Atuação em São Paulo e em Santa Maria (RS)", fonte: null, data: null });
  check("topônimos NÃO são redigidos (São Paulo, Santa Maria)", !!exp3 && exp3.fato.includes("São Paulo") && exp3.fato.includes("Santa Maria"), exp3?.fato);

  const exp4 = prepararFatoParaExport({ fato: "contato direto com joão no dp da filial", fonte: null, data: null });
  check("prenome minúsculo isolado é suprimido", !!exp4 && !/jo[ãa]o/i.test(exp4.fato.replace(" João", "JOAO")), exp4?.fato);

  const exp5 = prepararFatoParaExport({ fato: "Razão social: SUPERMERCADOS JOÃO SARMENTO LTDA", fonte: "registro oficial", data: null, origem: "estrutura" });
  check("fato ESTRUTURADO preserva razão social (identidade jurídica)", !!exp5 && exp5.fato === "Razão social: SUPERMERCADOS JOÃO SARMENTO LTDA", exp5?.fato);

  const soNome = prepararFatoParaExport({ fato: "Maria Silva", fonte: null, data: null });
  check("fato que é só nome vira síntese sem identificação", !!soNome && !soNome.fato.includes("Maria") && soNome.fato.length > 0, soNome?.fato);
}

console.log("\n[3] pacote TRIAGEM_V1 — evidências POR PERGUNTA e schema");
{
  const lacunaContab = lacunaDe([sinalFatoContab()], "VALIDACAO_HUMANA", "contabilidade_interna");
  const lacunaTech = lacunaDe(
    [{ fato: "Vaga de SAP em consultoria parceira", fonte: "portal de vagas", data: "2026-10-22T00:00:00.000Z", origem: "sinal", sintese: "Indício público de sistema de gestão (termo: \"SAP\") — texto integral preservado na ficha interna." }],
    "PESQUISA_DOCUMENTAL",
    "tecnologia_erp"
  );
  const ctxBase = { cnpjCompleto: "08044783000117", cnpjRaiz: "08044783", dataReferencia: "2026-10-22T00:00:00.000Z" };
  const entradaContab = lacunaParaTriagemV1(lacunaContab, {
    ...ctxBase,
    fontesConsultadas: ["página de vagas"],
    evidencias: [{ tipo: "triagem:contabilidade_interna", referencia: "linha 1 — 1 fato(s) exportável(is)", data: "2026-10-22T00:00:00.000Z" }],
    bloqueios: [],
  });
  const entradaTech = lacunaParaTriagemV1(lacunaTech, {
    ...ctxBase,
    fontesConsultadas: ["portal de vagas"],
    evidencias: [{ tipo: "triagem:tecnologia_erp", referencia: "linha 1 — 1 fato(s) exportável(is)", data: "2026-10-22T00:00:00.000Z" }],
    bloqueios: [],
  });
  const valid = validarPacoteTriagemV1([entradaContab, entradaTech]);
  check("pacote com as duas entradas passa no schema", valid.ok);
  check("evidencia da entrada de contabilidade referencia SÓ a própria pergunta", valid.ok && entradaContab.evidencias_referenciadas.every((e) => e.tipo === "triagem:contabilidade_interna"));
  check("evidencia da entrada de tecnologia referencia SÓ a própria pergunta", valid.ok && entradaTech.evidencias_referenciadas.every((e) => e.tipo === "triagem:tecnologia_erp"));
  check("fatos de origem sinal no pacote contêm síntese, não texto bruto", valid.ok && !JSON.stringify(valid.entradas).includes("contratar contador interno"));
  check("fontes_consultadas da entrada são as da própria pergunta", valid.ok && JSON.stringify(entradaContab.fontes_consultadas) === JSON.stringify(["página de vagas"]) && JSON.stringify(entradaTech.fontes_consultadas) === JSON.stringify(["portal de vagas"]));
  check("versão do contrato presente", entradaContab.versao_contrato === TRIAGEM_V1_VERSAO);
}

function sinalFatoContab(): FatoTriagemView {
  return {
    fato: "Vaga aberta: contratar contador interno",
    fonte: "página de vagas",
    data: "2026-10-22T00:00:00.000Z",
    origem: "sinal",
    sintese: 'Indício público de contabilidade própria detectado em pesquisa documental (termo: "contador") — texto integral preservado apenas na ficha interna (privacidade); não comprova estrutura interna atual.',
  };
}

/* ======================= CAMADA 2 — MOTOR EM BANCO (dev) ======================= */

const RAIZ_VAGA = "62345678";
const CNPJ_VAGA = cnpjValidoSintetico(RAIZ_VAGA, "0001"); // matriz ATIVA com vaga de contador
const RAIZ_SAP = "65345678";
const CNPJ_SAP = cnpjValidoSintetico(RAIZ_SAP, "0001"); // matriz ATIVA com vaga de SAP em parceira
const RAIZ_FILIAL = "68345678";
const CNPJ_FILIAL_MATRIZ = cnpjValidoSintetico(RAIZ_FILIAL, "0001"); // matriz ATIVA
const CNPJ_FILIAL_BAIXADA = cnpjValidoSintetico(RAIZ_FILIAL, "0002"); // filial BAIXADA
const RAIZ_MATRIZ_BAIXADA = "71345678";
const CNPJ_MATRIZ_BAIXADA = cnpjValidoSintetico(RAIZ_MATRIZ_BAIXADA, "0001"); // matriz BAIXADA
const RAIZ_MORTA = "74345678";
const CNPJ_MORTA_MATRIZ = cnpjValidoSintetico(RAIZ_MORTA, "0001"); // matriz BAIXADA (cache)
const CNPJ_MORTA_FILIAL = cnpjValidoSintetico(RAIZ_MORTA, "0002"); // filial BAIXADA (linha testada)
const RAIZ_VIVA = "77345678";
const CNPJ_VIVA_MATRIZ = cnpjValidoSintetico(RAIZ_VIVA, "0001"); // matriz ATIVA (cache)
const CNPJ_VIVA_FILIAL = cnpjValidoSintetico(RAIZ_VIVA, "0002"); // filial BAIXADA (linha testada)

const CnpjsCache = [
  CNPJ_VAGA, CNPJ_SAP, CNPJ_FILIAL_MATRIZ, CNPJ_FILIAL_BAIXADA,
  CNPJ_MATRIZ_BAIXADA, CNPJ_MORTA_MATRIZ, CNPJ_MORTA_FILIAL, CNPJ_VIVA_MATRIZ, CNPJ_VIVA_FILIAL,
];
const RaizesCache = [RAIZ_FILIAL, RAIZ_MORTA, RAIZ_VIVA];

async function main() {
  const batch = await db.importBatch.create({
    data: { fileName: "TESTE-v0107-auditoria.csv", storedPath: "", fileSize: 0, status: "DONE" },
  });
  const agora = new Date(Date.now() - 60_000);
  const ttl = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

  const linha = (n: number, cnpj: string, dados: Record<string, unknown>) =>
    db.importRow.create({
      data: {
        batchId: batch.id, rowNumber: n, cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO",
        rawCnpj: cnpj, normalizedCnpj: cnpj, cnpjRoot: raizDe(cnpj),
        collectedAt: agora, queriedAt: agora,
        extraJson: JSON.stringify({ simples: "Não", mei: "Não" }),
        fontesJson: JSON.stringify({ primaria: { fonte: "MinhaReceita", coletadoEm: agora.toISOString() } }),
        ...dados,
      },
    });

  await linha(1, CNPJ_VAGA, {
    legalName: "EMPRESA VAGA CONTADOR LTDA", branchType: "MATRIZ", branchIdentifier: 1, registrationStatus: "ATIVA",
    researchJson: JSON.stringify({
      dominio: null, paginas: [], buscas: [], notas: [], sinaisDigitais: [],
      sinaisPorte: ["Vaga aberta: contratar contador interno"], sinaisPorteFontes: [{ fonte: "página de vagas", url: null }],
      teiaBuscada: [], paginasOk: 0, paginasTentadas: 0, buscasOk: 0, geradoEm: agora.toISOString(), modoPesquisa: "COMPLETO", buscasRecusadasCota: 0,
      dimensoesPesquisadas: { identidade: true, tecnologia: false, escala: false, comercial: false, teia: false, periodo: false },
    }),
  });
  await linha(2, CNPJ_SAP, {
    legalName: "CONSULTORA COM VAGA SAP LTDA", branchType: "MATRIZ", branchIdentifier: 1, registrationStatus: "ATIVA",
    researchJson: JSON.stringify({
      dominio: null, paginas: [], buscas: [], notas: [], sinaisDigitais: [],
      sinaisPorte: ["Vaga de SAP em consultoria parceira"], sinaisPorteFontes: [{ fonte: "portal de vagas", url: null }],
      teiaBuscada: [], paginasOk: 0, paginasTentadas: 0, buscasOk: 0, geradoEm: agora.toISOString(), modoPesquisa: "COMPLETO", buscasRecusadasCota: 0,
      dimensoesPesquisadas: { identidade: true, tecnologia: true, escala: false, comercial: false, teia: false, periodo: false },
    }),
  });
  await linha(3, CNPJ_FILIAL_MATRIZ, { legalName: "REDE COM FILIAL BAIXADA LTDA", branchType: "MATRIZ", branchIdentifier: 1, registrationStatus: "ATIVA" });
  await linha(4, CNPJ_FILIAL_BAIXADA, { legalName: "REDE COM FILIAL BAIXADA LTDA", branchType: "FILIAL", branchIdentifier: 2, registrationStatus: "BAIXADA" });
  await linha(5, CNPJ_MATRIZ_BAIXADA, { legalName: "MATRIZ BAIXADA LTDA", branchType: "MATRIZ", branchIdentifier: 1, registrationStatus: "BAIXADA" });
  await linha(6, CNPJ_MORTA_FILIAL, { legalName: "RAIZ TOTALMENTE ENCERRADA LTDA", branchType: "FILIAL", branchIdentifier: 2, registrationStatus: "BAIXADA" });
  await linha(7, CNPJ_VIVA_FILIAL, { legalName: "RAIZ COM MATRIZ VIVA LTDA", branchType: "FILIAL", branchIdentifier: 2, registrationStatus: "BAIXADA" });

  // caches de estabelecimentos da raiz para os casos 6 e 7 (cobertura esgotada, confirmação individual)
  await db.estabelecimentoRootCache.create({
    data: {
      cnpjRaiz: RAIZ_MORTA, fonteDescoberta: "teste", coletadoEm: agora, atualizadoEm: agora, validoAte: ttl,
      estabelecimentosJson: JSON.stringify([
        { cnpj: CNPJ_MORTA_MATRIZ, razaoSocial: null, municipio: null, uf: null, situacao: "BAIXADA", cnae: null, identificadorMatrizFilial: 1, confirmado: true, descobertoPor: "quadro do participante", confirmadoEm: agora.toISOString(), fonteConfirmacao: "cadastro" },
        { cnpj: CNPJ_MORTA_FILIAL, razaoSocial: null, municipio: null, uf: null, situacao: "BAIXADA", cnae: null, identificadorMatrizFilial: 2, confirmado: true, descobertoPor: "quadro do participante", confirmadoEm: agora.toISOString(), fonteConfirmacao: "cadastro" },
      ]),
      coberturaJson: JSON.stringify({ participantesConsultados: ["x".repeat(32)], tetoParticipantes: 10, tetoConfirmacoes: 20, pendentesConfirmacao: 0, totalLocalizados: 2, parcial: false, totalParticipantesPfCache: 1 }),
    },
  });
  await db.estabelecimentoRootCache.create({
    data: {
      cnpjRaiz: RAIZ_VIVA, fonteDescoberta: "teste", coletadoEm: agora, atualizadoEm: agora, validoAte: ttl,
      estabelecimentosJson: JSON.stringify([
        { cnpj: CNPJ_VIVA_MATRIZ, razaoSocial: null, municipio: null, uf: null, situacao: "ATIVA", cnae: null, identificadorMatrizFilial: 1, confirmado: true, descobertoPor: "quadro do participante", confirmadoEm: agora.toISOString(), fonteConfirmacao: "cadastro" },
        { cnpj: CNPJ_VIVA_FILIAL, razaoSocial: null, municipio: null, uf: null, situacao: "BAIXADA", cnae: null, identificadorMatrizFilial: 2, confirmado: true, descobertoPor: "quadro do participante", confirmadoEm: agora.toISOString(), fonteConfirmacao: "cadastro" },
      ]),
      coberturaJson: JSON.stringify({ participantesConsultados: ["y".repeat(32)], tetoParticipantes: 10, tetoConfirmacoes: 20, pendentesConfirmacao: 0, totalLocalizados: 2, parcial: false, totalParticipantesPfCache: 1 }),
    },
  });

  // GATE: contagem de eventos de IA/busca ANTES das triagens
  const tiposGate = ["IA_CHAT", "WEB_SEARCH", "PAGE_READER"];
  const antesGate = await db.telemetryEvent.count({ where: { tipo: { in: tiposGate } } });

  try {
    console.log("\n[4] caso reproduzido 1 — vaga de contador interno é INDÍCIO, não resolução");
    const t1 = await classificarTriagemLinha(batch.id, 1);
    check("triagem da linha 1 calculada", t1.ok);
    if (t1.ok) {
      const contab = t1.lacunas.find((l) => l.perguntaId === "contabilidade_interna");
      check("contabilidade → VALIDACAO_HUMANA (nunca RESOLVIDO)", contab?.estado === "VALIDACAO_HUMANA", `estado=${contab?.estado}`);
      check("lacuna segue ABERTA (falta de confirmação registrada)", !!contab?.falta && contab.falta.includes("confirmar"));
      check("sinal preservado como FATO com proveniência (fonte e data)", contab?.fatos.some((f) => f.origem === "sinal" && f.fonte === "página de vagas") ?? false);
      check("fato de sinal carrega SÍNTESE determinística para exportação", contab?.fatos.some((f) => (f.sintese ?? "").includes('termo: "contador"')) ?? false);
      check("motivo registra que vaga não comprova operação", (contab?.motivo ?? "").includes("não comprova"));
    }

    console.log("\n[5] caso reproduzido 2 — SAP em consultoria parceira é INDÍCIO, não resolução");
    const t2 = await classificarTriagemLinha(batch.id, 2);
    check("triagem da linha 2 calculada", t2.ok);
    if (t2.ok) {
      const tech = t2.lacunas.find((l) => l.perguntaId === "tecnologia_erp");
      check("tecnologia → PESQUISA_DOCUMENTAL (nunca RESOLVIDO)", tech?.estado === "PESQUISA_DOCUMENTAL", `estado=${tech?.estado}`);
      check("falta exige comprovar IMPLANTAÇÃO/uso em produção", !!tech?.falta && tech.falta.includes("implanta"));
      check("sinal preservado como FATO (menção de terceiro não prova uso pela empresa)", tech?.fatos.some((f) => f.origem === "sinal" && f.fonte === "portal de vagas") ?? false);
      check("síntese cita o termo fechado (SAP)", tech?.fatos.some((f) => (f.sintese ?? "").includes('termo: "SAP"')) ?? false);
    }

    console.log("\n[6] filial BAIXADA com matriz ATIVA no lote — perguntas da PJ seguem ABERTAS");
    const t4 = await classificarTriagemLinha(batch.id, 4);
    check("triagem da filial baixada calculada", t4.ok);
    if (t4.ok) {
      const regime = t4.lacunas.find((l) => l.perguntaId === "regime_tributario");
      const contab = t4.lacunas.find((l) => l.perguntaId === "contabilidade_interna");
      const tech = t4.lacunas.find((l) => l.perguntaId === "tecnologia_erp");
      const notaPresente = (l: typeof regime) => (l?.fatos ?? []).some((f) => f.fato.includes("Situação deste estabelecimento (filial)"));
      check("regime da PJ NÃO é NAO_APLICAVEL por causa da filial", regime?.estado !== "NAO_APLICAVEL", `estado=${regime?.estado}`);
      check("contabilidade da PJ NÃO é NAO_APLICAVEL", contab?.estado !== "NAO_APLICAVEL", `estado=${contab?.estado}`);
      check("tecnologia da PJ NÃO é NAO_APLICAVEL", tech?.estado !== "NAO_APLICAVEL", `estado=${tech?.estado}`);
      check("nota explícita: estado do estabelecimento não comprova a raiz", notaPresente(regime) && notaPresente(contab) && notaPresente(tech));
      check("regime classificado pela evidência (não-optante → PESQUISA_DOCUMENTAL)", regime?.estado === "PESQUISA_DOCUMENTAL");
    }

    console.log("\n[7] matriz BAIXADA mantém NAO_APLICAVEL (regressão) e raiz provada morta encerra perguntas");
    const t5 = await classificarTriagemLinha(batch.id, 5);
    if (t5.ok) {
      check("matriz baixada: regime NAO_APLICAVEL", t5.lacunas.find((l) => l.perguntaId === "regime_tributario")?.estado === "NAO_APLICAVEL");
      check("matriz baixada: contabilidade NAO_APLICAVEL", t5.lacunas.find((l) => l.perguntaId === "contabilidade_interna")?.estado === "NAO_APLICAVEL");
    } else check("triagem matriz baixada calculada", false);
    const t6 = await classificarTriagemLinha(batch.id, 6);
    if (t6.ok) {
      const regime = t6.lacunas.find((l) => l.perguntaId === "regime_tributario");
      check("raiz com TODAS as unidades confirmadas encerradas → NAO_APLICAVEL dirigido", regime?.estado === "NAO_APLICAVEL" && (regime.motivo.includes("todas as unidades") || regime.motivo.includes("encerradas")), `estado=${regime?.estado} motivo=${regime?.motivo}`);
    } else check("triagem raiz provada morta calculada", false);
    const t7 = await classificarTriagemLinha(batch.id, 7);
    if (t7.ok) {
      const regime = t7.lacunas.find((l) => l.perguntaId === "regime_tributario");
      check("cache com matriz ATIVA confirmada → perguntas da PJ NÃO encerradas", regime?.estado !== "NAO_APLICAVEL", `estado=${regime?.estado}`);
      check("nota de filial presente (evidência pela raiz)", (regime?.fatos ?? []).some((f) => f.fato.includes("Situação deste estabelecimento (filial)")));
    } else check("triagem raiz com matriz viva calculada", false);

    console.log("\n[8] GATE CENTRAL — zero IA e zero busca web nas triagens");
    const depoisGate = await db.telemetryEvent.count({ where: { tipo: { in: tiposGate } } });
    check("nenhum evento de IA/busca web/página foi criado pelas triagens", antesGate === depoisGate, `${antesGate} → ${depoisGate}`);

    console.log("\n[9] reuso — 2ª chamada não duplica perguntas nem muda estados");
    const t4b = await classificarTriagemLinha(batch.id, 4);
    check("2ª triagem idêntica em perguntas e estados", t4.ok && t4b.ok && JSON.stringify(t4b.lacunas.map((l) => [l.perguntaId, l.estado])) === JSON.stringify(t4.lacunas.map((l) => [l.perguntaId, l.estado])));
  } finally {
    await db.telemetryEvent.deleteMany({ where: { batchId: batch.id } });
    await db.auditEvent.deleteMany({ where: { batchId: batch.id } });
    await db.importRow.deleteMany({ where: { batchId: batch.id } }).catch(() => undefined);
    await db.importBatch.delete({ where: { id: batch.id } }).catch(() => undefined);
    await db.estabelecimentoRootCache.deleteMany({ where: { cnpjRaiz: { in: RaizesCache } } }).catch(() => undefined);
    await db.cadastroCache.deleteMany({ where: { cnpj: { in: CnpjsCache } } }).catch(() => undefined);
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: { in: CnpjsCache } } }).catch(() => undefined);

    const sobraBatch = await db.importBatch.count({ where: { id: batch.id } });
    const sobraRaiz = await db.estabelecimentoRootCache.count({ where: { cnpjRaiz: { in: RaizesCache } } });
    const sobraCad = await db.cadastroCache.count({ where: { cnpj: { in: CnpjsCache } } });
    check("banco limpo após o teste (lote, caches e cadastros removidos)", sobraBatch === 0 && sobraRaiz === 0 && sobraCad === 0);
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
  await db.$disconnect();
  process.exit(1);
});
