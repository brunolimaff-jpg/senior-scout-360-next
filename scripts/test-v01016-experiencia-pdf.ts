/**
 * test-v01016-experiencia-pdf.ts — CORRECT_DELTA v0.10.16 (experiência comercial).
 *
 * Parte A (PURa, sem rede e sem banco):
 *  A1 classificador de participante — hash=PF, CNPJ com DV=PJ, inválido=INDETERMINADO
 *     (nome empresarial NUNCA vira PF por eliminação — caso BRD DIGITAL);
 *  A2 normalizarRelacoesGrafo — aviso de indeterminados + tipos preservados;
 *  A3 validarParticipanteId — expansão só com hash ou CNPJ válido;
 *  A4 regimeTributarioLegivel + ESTADO_LACUNA_COMERCIAL (candidata ≠ executada);
 *  A5 PDF empresa — página 1 (atividade resumida, contatos, regime humano), anexos
 *     A–F, reconciliação do quadro expandido (5 empresas × 18 estabelecimentos),
 *     limite honesto sem quadro, lacunas Pergunta→O que falta→Como verificar,
 *     provedor só na nota técnica, modelo do documento no rodapé;
 *  A6 PDF empresa sem relações — anexo C declara a limitação sem inventar;
 *  A7 PDF lote — modelo do documento;
 *  A8 contrato de linguagem no prompt de IA (CNAE declarado, notícia de setor, homônimos).
 *
 * Parte B (HTTP contra o dev server :3000):
 *  B1 lote sintético com relações + quadro expandidos PERSISTIDOS → pdf_empresa
 *     traz o MESMO estado da ficha (reconciliação real tela×PDF);
 *  B2 dois downloads consecutivos — conteúdo factual idêntico (só o horário muda)
 *     e nenhuma consulta nova (telemetria RELACAO_GRAFO não cresce);
 *  B3 nome de arquivo legível (ficha-<empresa>-linha-N.pdf).
 *
 * Rodar: bun scripts/test-v01016-experiencia-pdf.ts  (dev server no 3000)
 */
import { inflateSync } from "zlib";
import { db } from "../src/lib/db";
import { gerarPdfEmpresa, gerarPdfLote, type LacunaPdf } from "../src/lib/export/pdf";
import type { DatasetExport, LinhaExport, ResumoLoteExport } from "../src/lib/export/dataset";
import { classificarParticipantePorId, normalizarRelacoesGrafo, validarParticipanteId, raizDe } from "../src/lib/relations/grafo";
import { regimeTributarioLegivel, ESTADO_LACUNA_COMERCIAL, tipoParticipanteLegivel } from "../src/lib/linguagem";
import { validateCnpj } from "../src/lib/cnpj";
import { EVIDENCE_RULES } from "../src/lib/enrich/ai";

const BASE = "http://localhost:3000";
let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${nome}`);
  } else {
    fail++;
    falhas.push(nome);
    console.log(`  FAIL  ${nome}${extra ? ` — ${extra}` : ""}`);
  }
}

/* ---------------- util: CNPJ válido com DV ---------------- */
function digitosCnpj(base12: string): string {
  let calc = 0;
  let pos = 5;
  for (let i = 0; i < 12; i++) {
    calc += Number(base12[i]) * pos--;
    if (pos < 2) pos = 9;
  }
  const d1 = calc % 11 < 2 ? 0 : 11 - (calc % 11);
  calc = 0;
  pos = 6;
  for (let i = 0; i < 13; i++) {
    const d = i < 12 ? Number(base12[i]) : d1;
    calc += d * pos--;
    if (pos < 2) pos = 9;
  }
  const d2 = calc % 11 < 2 ? 0 : 11 - (calc % 11);
  return `${d1}${d2}`;
}
function cnpjValido(base8: string, ordem = "0001"): string {
  const base12 = `${base8}${ordem}`;
  return `${base12}${digitosCnpj(base12)}`;
}

/* ============ A. PARTE PURA ============ */

console.log("\nA1. CLASSIFICADOR — semântica da fonte + identificador adequado (caso BRD DIGITAL)");
{
  // hash opaco de 32 hex = PF (contrato da fonte)
  check("hash opaco → PF", classificarParticipantePorId("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", validateCnpj) === "PF");
  // CNPJ com DV válido = PJ
  check("CNPJ com DV válido → PJ", classificarParticipantePorId(cnpjValido("12345678"), validateCnpj) === "PJ");
  // 14 caracteres com DV ERRADO → NÃO é PF, NÃO é PJ
  const dvErrado = `${cnpjValido("12345678").slice(0, 13)}${cnpjValido("12345678")[13] === "0" ? "1" : "0"}`;
  check("CNPJ com DV errado → INDETERMINADO", classificarParticipantePorId(dvErrado, validateCnpj) === "INDETERMINADO");
  // string arbitrária → INDETERMINADO (nunca PF residual)
  check("identificador arbitrário → INDETERMINADO", classificarParticipantePorId("BRD-DIGITAL-123", validateCnpj) === "INDETERMINADO");
  check("identificador vazio → INDETERMINADO", classificarParticipantePorId("", validateCnpj) === "INDETERMINADO");
  check("tipoParticipanteLegivel: PJ", tipoParticipanteLegivel("PJ") === "pessoa jurídica");
  check("tipoParticipanteLegivel: INDETERMINADO", tipoParticipanteLegivel("INDETERMINADO") === "tipo não confirmado pela fonte");
}

console.log("\nA2. NORMALIZAÇÃO — participante PJ com identificador inválido fica NÃO CONFIRMADO (vínculo preservado)");
{
  const resposta = [
    { id: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA" },
    { id: cnpjValido("45997418"), nome: "SOCIEDADE ANÔNIMA DEMO" },
    // o caso observado na interface: nome empresarial + identificador que a fonte não reconhece
    { id: "0000000000019X", nome: "BRD DIGITAL PARTICIPAÇÕES LTDA" },
  ];
  const n = normalizarRelacoesGrafo(resposta, { cnpjConsultado: cnpjValido("33000167"), validarCnpj: validateCnpj }) as Exclude<ReturnType<typeof normalizarRelacoesGrafo>, { ok: false }>;
  check("3 participantes normalizados (nada descartado)", n.totalParticipantes === 3);
  const brd = n.participantes.find((p) => p.nomePublico.includes("BRD DIGITAL"));
  check("BRD DIGITAL NÃO é PF", !!brd && brd.tipo !== "PF");
  check("BRD DIGITAL fica INDETERMINADO com o vínculo preservado", !!brd && brd.tipo === "INDETERMINADO" && brd.participanteId === "0000000000019X");
  check("BRD DIGITAL sem cnpjParticipante", !!brd && brd.cnpjParticipante === null);
  check("PF de hash continua PF", n.participantes.find((p) => p.nomePublico === "MARIA DA SILVA")?.tipo === "PF");
  // v0.10.18: pluralização natural no aviso (contrato de linguagem — fim do "(s)")
  check("aviso honesto de não confirmados", n.avisos.some((a) => a.includes("1 participante com identificador que a fonte não permitiu confirmar")));
}

console.log("\nA3. GUARDA DE EXPANSÃO — identificador inválido não abre conexão");
{
  check("hash passa", validarParticipanteId("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", validateCnpj).ok === true);
  check("CNPJ válido passa", validarParticipanteId(cnpjValido("45997418"), validateCnpj).ok === true);
  check("BRD (id inválido) é REJEITADO", validarParticipanteId("0000000000019X", validateCnpj).ok === false);
  check("string arbitrária é rejeitada", validarParticipanteId("BRD-DIGITAL-123", validateCnpj).ok === false);
}

console.log("\nA4. LINGUAGEM — regime tributário e estados de lacuna em frases comerciais");
{
  const cru = "LUCRO REAL (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)";
  const reg = regimeTributarioLegivel(cru);
  check("regime legível: forma + exercício", !!reg && reg.valor === "LUCRO REAL · exercício 2024");
  check("regime legível: nota separa registro de operação vigente", !!reg && reg.nota.includes("O regime atual ainda precisa ser confirmado"));
  check("regime vazio → null", regimeTributarioLegivel("") === null);
  const simples = regimeTributarioLegivel("LUCRO PRESUMIDO");
  check("regime sem exercício mantém a forma", !!simples && simples.valor === "LUCRO PRESUMIDO");
  // v0.10.17: estados de lacuna viram PRÓXIMO PASSO (o estado interno não vira frase)
  check("candidata vira ação concreta", ESTADO_LACUNA_COMERCIAL.COMPLEMENTAR_API === "Peça a consulta complementar na ficha desta empresa.");
  check("validação humana vira ação concreta", ESTADO_LACUNA_COMERCIAL.VALIDACAO_HUMANA === "Confirme essa informação com a empresa.");
}

/* --------- fixture de PDF --------- */
function resumoFake(): ResumoLoteExport {
  return {
    id: "lote-teste-000",
    arquivo: "lote-demo.csv",
    status: "DONE",
    origem: "arquivo CSV",
    criadoEm: new Date("2026-02-10T12:00:00Z"),
    finalizadoEm: new Date("2026-02-10T12:30:00Z"),
    entradasRecebidas: 3,
    linhasProcessadas: 3,
    aguardandoExecucao: 0,
    pjsLocalizadas: 3,
    pjsIdentificadas: 2,
    emRevisao: 1,
    validadas: 1,
    naoIdentificadas: 0,
    falhas: 0,
    situacaoDist: [{ key: "ATIVA", count: 3 }],
    ufDist: [{ key: "SP", count: 3 }],
    cnaeDist: [{ key: "J — Informação e comunicação", count: 3 }],
  };
}
function linhaFake(over: Partial<LinhaExport>): LinhaExport {
  const base: LinhaExport = {
    rowNumber: 1,
    entrada: "brddigital.com.br",
    tipoEntrada: "REFERENCIA",
    referencia: "brddigital.com.br",
    etapaIdentidade: "CORRESPONDENTE",
    estadoResolucao: "CONFIRMED",
    confianca: "ALTA",
    divergencias: [],
    emRevisao: false,
    validadaPorOperador: true,
    cnpjFormatado: "12.345.678/0001-95",
    cnpjNormalizado: cnpjValido("12345678"),
    cnpjRaiz: "12345678",
    razaoSocial: "BRASIL DIGITAL TELECOM LTDA",
    nomeFantasia: "Brasil Digital Telecom",
    matrizFilial: "MATRIZ",
    identificadorMatrizFilial: "1",
    cnpjMatrizFormatado: "",
    statusMatriz: "RESOLVIDA",
    situacao: "ATIVA",
    dataSituacao: "2020-05-01",
    motivoSituacao: "",
    dataAbertura: "2015-03-10",
    cnaeCodigo: "6120-1/99",
    cnaeDescricao: "Telecomunicações por fio",
    cnaesSecundarios: [],
    municipio: "São Paulo",
    uf: "SP",
    ibgePopulacao: "11.000.000",
    ibgeRegiaoImediata: "São Paulo",
    ibgeAno: "2024",
    porte: "DEMAIS",
    naturezaJuridica: "Sociedade Empresária Limitada",
    capitalSocialTexto: "4.700.000,00",
    capitalSocialNumero: 4700000,
    simples: "Não optante",
    mei: "Não",
    regimeTributario: "",
    telefones: [],
    email: "",
    endereco: "",
    telefonesCrus: [],
    temContatoUtil: false,
    representantes: [],
    relacoesConsultadas: null,
    fonte: "BrasilAPI",
    fonteDescoberta: "",
    dataConsulta: new Date("2026-02-10T12:00:00Z"),
    dataColeta: new Date("2026-02-01T09:00:00Z"),
    erro: "",
    pesquisaStatus: "",
    iaStatus: "",
    iaSetor: "",
    iaPorte: "",
    iaPerfil: "",
    iaLeitura: "",
    iaHipoteses: [],
  };
  return { ...base, ...over };
}
function datasetFake(linhas: LinhaExport[]): DatasetExport {
  return { lote: resumoFake(), linhas, totalLinhasLote: linhas.length, escopo: "TODAS" };
}

/** Extrai texto de um PDF gerado com pdf-lib (mesma técnica da suíte v0.10.15). */
function extrairTextoPdf(buf: Buffer): string {
  const partes: string[] = [];
  let i = 0;
  while (true) {
    const ini = buf.indexOf("stream", i);
    if (ini < 0) break;
    const fim = buf.indexOf("endstream", ini);
    if (fim < 0) break;
    let dados = buf.subarray(ini + 6, fim);
    while (dados.length > 0 && (dados[0] === 13 || dados[0] === 10 || dados[0] === 32)) dados = dados.subarray(1);
    try {
      partes.push(inflateSync(dados).toString("latin1"));
    } catch {
      partes.push(dados.toString("latin1"));
    }
    i = fim + 9;
  }
  const textos: string[] = [];
  for (const conteudo of partes) {
    for (const m of conteudo.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const hex = m[1];
      let s = "";
      for (let j = 0; j + 1 < hex.length; j += 2) s += String.fromCharCode(Number.parseInt(hex.slice(j, j + 2), 16));
      textos.push(s);
    }
    for (const m of conteudo.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      textos.push(m[1].replace(/\\([()\\])/g, "$1"));
    }
  }
  return textos.join("\n");
}

console.log("\nA5. PDF DA EMPRESA — página 1 do vendedor + anexos + reconciliação");
{
  const cnaes = Array.from({ length: 17 }, (_, i) => `Outra atividade registrada número ${i + 1} do cadastro`);
  const quadroEmpresas = [
    ...Array.from({ length: 4 }, (_, i) => ({ cnpjFormatado: `${cnpjValido(`2000000${i}`)}`.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"), razaoSocial: `HOLDING PARCEIRA ${i + 1} LTDA`, raiz: `2000000${i}` })),
    { cnpjFormatado: `${cnpjValido("20000009")}`.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"), razaoSocial: "HOLDING PARCEIRA 5 LTDA", raiz: "20000009" },
  ];
  // 5 empresas (raízes) e 18 estabelecimentos: 4 raízes com 4 + 1 raiz com 2 = 18
  const empresas18 = [
    ...quadroEmpresas.slice(0, 4).flatMap((e) => Array.from({ length: 4 }, (_, k) => ({ ...e, cnpjFormatado: e.cnpjFormatado.replace(/(\d{2})\.(\d{3})\.(\d{3})\/0001/, `$1.$2.$3/000${k + 1}`) }))),
    ...Array.from({ length: 2 }, (_, k) => ({ ...quadroEmpresas[4], cnpjFormatado: quadroEmpresas[4].cnpjFormatado.replace(/(\d{2})\.(\d{3})\.(\d{3})\/0001/, `$1.$2.$3/000${k + 1}`) })),
  ];
  const raizesSet = new Set(empresas18.map((e) => e.raiz));
  check("fixture: 5 raízes distintas / 18 estabelecimentos", raizesSet.size === 5 && empresas18.length === 18);

  const linha = linhaFake({
    cnaesSecundarios: cnaes,
    regimeTributario: "LUCRO REAL (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)",
    telefoneCrus: ["000000000000"],
    representantes: [
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "MARIA DA SILVA", qualificacao: "Sócio-Administrador", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2020-01-01", fonte: "BrasilAPI", dataConsulta: "2026-02-10T12:00:00Z", decisor: true, empresaParticipada: "" },
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "BRD DIGITAL PARTICIPAÇÕES LTDA", qualificacao: "", tipoVinculo: "Participação registrada (fonte pública)", tipoParticipante: "INDETERMINADO", dataEntrada: "", fonte: "MinhaReceita Grafo", dataConsulta: "2026-02-10T12:10:00Z", decisor: false, empresaParticipada: "" },
    ],
    relacoesConsultadas: {
      coletadoEm: "2026-02-10T12:10:00Z",
      validoAte: "2026-03-12T12:10:00Z",
      participantes: [
        {
          participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
          nome: "MARIA DA SILVA",
          tipo: "PF",
          cnpjFormatado: null,
          quadro: {
            participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
            nome: "MARIA DA SILVA",
            tipo: "PF",
            totalEmpresas: 18,
            totalPessoasJuridicas: 5,
            empresas: empresas18,
            coletadoEm: "2026-02-10T12:15:00Z",
            validoAte: "2026-03-12T12:15:00Z",
            truncado: false,
          },
        },
        {
          participanteId: "0000000000019X",
          nome: "BRD DIGITAL PARTICIPAÇÕES LTDA",
          tipo: "INDETERMINADO",
          cnpjFormatado: null,
          quadro: null,
        },
      ],
    },
  });
  const lacunas: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente ou pesquise LinkedIn." },
    { pergunta: "Há outras empresas ligadas aos sócios?", estado: "COMPLEMENTAR_API", falta: "Quadros restantes dos participantes.", proximaVerificacao: "Expanda as conexões na ficha." },
  ];
  const buf = await gerarPdfEmpresa(datasetFake([linha]), linha, lacunas);
  const t = extrairTextoPdf(buf);
  const tn = t.toUpperCase();
  const tf = t.replace(/\s+/g, " "); // frases longas quebram linha no PDF


  // página 1 — prioridades do vendedor (modelo v3)
  check("atividade principal na página 1", tn.includes("ATIVIDADE CADASTRADA"));
  check("17 CNAEs NÃO viram parágrafo gigante na abertura", tn.includes("MAIS 17 ATIVIDADES REGISTRADAS. A LISTA COMPLETA ESTÁ NO ANEXO A."));
  check("anexo A lista cada CNAE em linha própria", (t.match(/Outra atividade registrada número \d+/g) ?? []).length === 17);
  check("contatos: 'Não informado' quando não há contato utilizável", tf.includes("Não informado."));
  check("regime em linguagem humana com exercício ao lado do dado", t.includes("LUCRO REAL · exercício 2024"));
  check("sem parágrafo defensivo do regime no PDF", !t.includes("O regime atual ainda precisa ser confirmado"));
  check("representante do QSA aparece na visão principal com a qualificação", tf.includes("MARIA DA SILVA - Sócio-Administrador"));
  check("o que vale investigar traz a pergunta e a próxima ação", tn.includes("QUEM DECIDE A COMPRA?") && tf.includes("Pergunte ao cliente ou pesquise LinkedIn."));
  check("sem contagem por estado na visão principal", !tf.includes("resposta(s) pendente(s)"));

  // anexos (letras POSICIONAIS — a fonte sempre existe; IA ausente na fixture)
  for (const a of ["ANEXO A", "ANEXO B", "ANEXO C", "ANEXO D"]) check(`título de ${a} presente`, tn.includes(a));
  check("bloco de fonte e atualização presente (categoria, sem provedor)", tf.includes("Fonte principal: Cadastro empresarial"));
  check("anexo D cobre as 2 lacunas em detalhe", tn.includes("ANEXO D · O QUE FALTA DESCOBRIR"));

  // reconciliação
  check("quadro expandido reconciliado: 5 empresas e 18 estabelecimentos", tf.includes("encontramos 5 empresas e 18 estabelecimentos registrados nesta consulta"));
  check("empresas distintas com seus estabelecimentos (sem soma)", tf.includes("HOLDING PARCEIRA 1 LTDA: 4 estabelecimentos desta empresa"));
  check("vínculo sem quadro: disponibilidade declarada sem inventar", tf.includes("Os estabelecimentos deste vínculo podem ser listados na ficha da empresa."));
  check("participante INDETERMINADO é dito como não confirmado", tf.includes("BRD DIGITAL PARTICIPAÇÕES LTDA - tipo não confirmado pela fonte"));

  // lacunas em 3 campos claros
  check("lacuna: rótulo 'O que falta'", t.includes("O que falta") && t.includes("Contato de quem participa da decisão."));
  check("lacuna: rótulo 'Como verificar'", t.includes("Como verificar"));

  if (process.env.DEBUG_PDF) {
    console.log("---- TRECHOS RELEVANTES ----");
    for (const l of t.split("\n")) {
      if (/representante|Anexo [A-F]|confirmado pela fonte|Anexo\.$/.test(l)) console.log(JSON.stringify(l));
    }
  }
  // provedor FORA do documento comercial por inteiro — o registro técnico fica na
  // planilha de evidências (v0.10.17: a última página nunca é 'só observações')
  const ocorrenciasBrasilApi = tn.split("BRASILAPI").length - 1;
  check("provedor NÃO aparece no PDF (nenhuma ocorrência)", ocorrenciasBrasilApi === 0);
  check("sem nota técnica de auditoria no documento comercial", !tn.includes("REGISTRO TÉCNICO"));
  check("modelo do documento no rodapé", t.includes("Modelo ficha-comercial v3") && t.includes("Scout 360"));
  check("sem 'grafo' no corpo comercial (jargão)", !tn.includes("GRAFO PÚBLICO"));
}

console.log("\nA6. PDF SEM RELAÇÕES CONSULTADAS — disponibilidade declarada (nada inventado)");
{
  const linha = linhaFake({ representantes: [], relacoesConsultadas: null });
  const buf = await gerarPdfEmpresa(datasetFake([linha]), linha, []);
  const t = extrairTextoPdf(buf);
  const tn = t.toUpperCase();
  check("seção de pessoas e relações traz a matriz", tn.includes("MATRIZ E FILIAIS") && t.includes("esta unidade é a matriz"));
  check("disponibilidade declarada: relações consultáveis na ficha", t.includes("As relações societárias podem ser consultadas na ficha da empresa, sempre sob comando."));
  check("nada de contagem inventada", !tn.includes("ENCONTRAMOS 0 EMPRESAS"));
}

console.log("\nA7. PDF DO LOTE — modelo do documento identificável");
{
  const buf = await gerarPdfLote(datasetFake([linhaFake({})]));
  const t = extrairTextoPdf(buf);
  check("rodapé com modelo resumo-lote v3", t.includes("Modelo resumo-lote v3"));
  check("lote em linguagem comercial (sem 'aguardando execução')", !t.includes("aguardando execução") && t.includes("Consultas na fila"));
}

console.log("\nA8. CONTRATO DE LINGUAGEM NA LEITURA COMERCIAL (IA)");
{
  check("CNAE = atividade declarada", EVIDENCE_RULES.includes("CNAE é ATIVIDADE DECLARADA"));
  check("notícia de setor ≠ mudança da empresa", EVIDENCE_RULES.includes("NOTÍCIA DE SETOR NÃO É MUDANÇA DA EMPRESA"));
  check("homônimos/nomes semelhantes exigem prova do vínculo", EVIDENCE_RULES.includes("HOMÔNIMOS E NOMES SEMELHANTES"));
  check("4 camadas separadas (confirmado/indicado/não encontrado/vale perguntar)", EVIDENCE_RULES.includes("o que VALE PERGUNTAR"));
  check("sem recomendação genérica de produto Senior", EVIDENCE_RULES.includes("recomendação genérica de produto Senior"));
  check("raiz de CNPJ consistente com a regra da interface", raizDe("12345678000195") === "12345678");
}

/* ============ B. PARTE HTTP (dev server) ============ */

console.log("\nB. RECONCILIAÇÃO REAL tela × PDF (lote sintético com caches persistidos — sem consulta pública)");
const lotes: string[] = [];
async function limparLotes() {
  for (const id of lotes) {
    await db.auditEvent.deleteMany({ where: { batchId: id } });
    await db.telemetryEvent.deleteMany({ where: { batchId: id } });
    await db.importRow.deleteMany({ where: { batchId: id } });
    await db.importBatch.deleteMany({ where: { id } });
  }
  // caches da suíte (identidade fixa do teste)
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" } });
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: cnpjValido("12345678") } });
}
// prevenção de órfãos: remove resíduos anteriores desta suíte
await limparLotes().catch(() => undefined);

try {
  // seed DIRETO no banco (mesma técnica da suíte v0.10.15): zero consulta pública
  const cnpjConta = cnpjValido("12345678");
  const batch = await db.importBatch.create({
    data: {
      id: `imp_test16_${Math.random().toString(36).slice(2, 8)}`,
      fileName: "experiencia-v01016.csv",
      sourceType: "CSV",
      storedPath: "", // lote sintético de teste — sem arquivo armazenado
      fileSize: 0,
      rowCount: 1,
      totalValid: 1,
      totalEnriched: 1,
      totalPending: 0,
      confirmedAt: new Date(),
      processingAt: new Date(),
      finishedAt: new Date(),
      headerJson: JSON.stringify(["empresa"]),
      status: "DONE",
    },
  });
  lotes.push(batch.id);
  await db.importRow.create({
    data: {
      batchId: batch.id,
      rowNumber: 1,
      originalCellsJson: JSON.stringify(["brddigital.com.br"]),
      referenceValue: "brddigital.com.br",
      cnpjStatus: "REFERENCIA",
      lookupKind: "REFERENCIA",
      lookupStatus: "ENRIQUECIDO",
      identityStage: "CORRESPONDENTE",
      resolutionState: "CONFIRMED",
      resolvedCnpj: cnpjConta,
      normalizedCnpj: cnpjConta,
      cnpjRoot: "12345678",
      legalName: "BRASIL DIGITAL TELECOM LTDA",
      tradeName: "Brasil Digital Telecom",
      branchType: "MATRIZ",
      branchIdentifier: 1,
      matrizStatus: "RESOLVIDA",
      registrationStatus: "ATIVA",
      municipality: "São Paulo",
      uf: "SP",
      cnaeCode: "6120-1/99",
      cnaeDescription: "Telecomunicações por fio",
      source: "BrasilAPI",
      queriedAt: new Date(),
      collectedAt: new Date(),
      extraJson: JSON.stringify({ endereco: "AVENIDA PAULISTA 1000", capitalSocial: "4.700.000,00", porte: "DEMAIS" }),
      sociosJson: JSON.stringify([{ nome: "MARIA DA SILVA", qual: "Sócio-Administrador", entrada: "2020-01-01" }]),
    },
  });

  const linha1 = { rowNumber: 1, normalizedCnpj: cnpjConta };
  {
    const hashPf = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    await db.relacaoSocietariaCache.upsert({
      where: { cnpj: cnpjConta },
      create: {
        cnpj: cnpjConta,
        fonte: "MinhaReceita Grafo",
        baseDados: "2026-01",
        coletadoEm: new Date(),
        atualizadoEm: new Date(),
        validoAte: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        relacoesJson: JSON.stringify([
          { participanteId: hashPf, tipo: "PF", nomePublico: "MARIA DA SILVA DEMO", cnpjParticipante: null, razaoSocialPj: null },
          // caso REAL observado na interface: cache legado classificou empresa como PF
          // por eliminação (id de 8 dígitos sem formato CNPJ/hash) — v0.10.16 corrige à leitura
          { participanteId: "35444812", tipo: "PF", nomePublico: "BRD DIGITAL PARTICIPACOES LTDA", cnpjParticipante: null, razaoSocialPj: null },
        ]),
        totalParticipantes: 2,
      },
      update: {},
    });

    // B0 — correção à leitura: cache legado com PF residual volta INDETERMINADO e é gravado corrigido
    const relRes = await fetch(`${BASE}/api/imports/${batch.id}/rows/1/relacoes-societarias`, { method: "POST" });
    const relJson = (await relRes.json()) as { ok?: boolean; relacoes?: { participantes: { participanteId: string; tipo: string }[] } };
    check("relações 200 (cache válido, zero consulta pública)", relRes.status === 200 && relJson.ok === true);
    const brdView = relJson.relacoes?.participantes.find((p) => p.participanteId === "35444812");
    check("B0: BRD DIGITAL de cache legado volta INDETERMINADO (não PF)", brdView?.tipo === "INDETERMINADO", JSON.stringify(brdView));
    const cachePos = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: cnpjConta } });
    const brdCache = JSON.parse(cachePos?.relacoesJson ?? "[]").find((p: { participanteId: string }) => p.participanteId === "35444812");
    check("B0: write-back corrige o cache persistido (PF → INDETERMINADO)", brdCache?.tipo === "INDETERMINADO");
    // quadro expandido: 2 empresas (raízes) e 3 estabelecimentos — os mesmos fatos da tela
    const outra1 = cnpjValido("31111111");
    const outra2 = cnpjValido("32222222");
    await db.quadroParticipanteCache.upsert({
      where: { participanteId: hashPf },
      create: {
        participanteId: hashPf,
        tipoParticipante: "PF",
        rotulo: "MARIA DA SILVA DEMO",
        fonte: "MinhaReceita Grafo",
        baseDados: null,
        coletadoEm: new Date(),
        validoAte: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        empresasJson: JSON.stringify([
          { cnpj: outra1, razaoSocial: "EMPRESA A DEMO LTDA" },
          { cnpj: outra1.slice(0, 8) + "0002" + outra1.slice(12), razaoSocial: "EMPRESA A DEMO LTDA" },
          { cnpj: outra2, razaoSocial: "EMPRESA B DEMO LTDA" },
        ]),
        totalEmpresas: 3,
        truncado: false,
      },
      update: {},
    });

    // B1 — o PDF da ficha traz o MESMO estado que a tela mostra
    const p1 = await fetch(`${BASE}/api/imports/${batch.id}/export?type=pdf_empresa&row=1`);
    check("pdf_empresa 200", p1.status === 200);
    const nome = /filename="([^"]+)"/.exec(p1.headers.get("content-disposition") ?? "")?.[1] ?? "";
    check("B3: nome de arquivo legível", /^ficha-.+-linha-1\.pdf$/.test(nome) && !nome.includes(batch.id.slice(-6)), nome);
    const buf1 = Buffer.from(await p1.arrayBuffer());
    const t1 = extrairTextoPdf(buf1);
    const tf1 = t1.replace(/\s+/g, " ");
    check("anexo C reconcilia: participante da tela no PDF", t1.includes("MARIA DA SILVA DEMO") && t1.includes("pessoa física"));
    check("quadro expandido no PDF: 2 empresas e 3 estabelecimentos", tf1.includes("encontramos 2 empresas e 3 estabelecimentos registrados nesta consulta"));
    check("empresas distintas listadas com estabelecimentos (sem soma)", tf1.includes("EMPRESA A DEMO LTDA: 2 estabelecimentos desta empresa"));

    // B2 — dois downloads consecutivos: mesmo conteúdo factual, sem nova consulta
    const telemetriaAntes = await db.telemetryEvent.count({ where: { batchId: batch.id, tipo: "RELACAO_GRAFO" } });
    const p2 = await fetch(`${BASE}/api/imports/${batch.id}/export?type=pdf_empresa&row=1`);
    const buf2 = Buffer.from(await p2.arrayBuffer());
    const t2 = extrairTextoPdf(buf2);
    const telemetriaDepois = await db.telemetryEvent.count({ where: { batchId: batch.id, tipo: "RELACAO_GRAFO" } });
    check("telemetria não cresce (sem reconsulta no download)", telemetriaDepois === telemetriaAntes);
    // factual: remove o que muda por natureza (horário de geração)
    const fatos = (s: string) =>
      s
        .replace(/Documento gerado em .*/g, "")
        .replace(/Modelo (ficha-comercial|resumo-lote) v3[^·]*·/g, "Modelo $1 v3 ·")
        .replace(/(Coletado em|Consulta da linha em):? .*/g, "")
        .replace(/Fonte principal: .*?\./g, "Fonte principal: FONTE.")
        .replace(/consulta de \d{2}\/\d{2}\/\d{4}/g, "")
        .replace(/Relações consultadas \(\d{2}\/\d{2}\/\d{4}\)/g, "Relações consultadas (DATA)")
        .replace(/Consulta de \d{2}\/\d{2}\/\d{4}: encontramos/g, "Consulta de DATA: encontramos");
    check("B2: conteúdo factual idêntico em dois downloads", fatos(t1) === fatos(t2));
    check("rodapé com modelo do documento", t1.includes("Modelo ficha-comercial v3"));
  }
} finally {
  await limparLotes();
}

console.log(`\n=== RESULTADO v0.10.16: ${pass} PASS · ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Falhas:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
