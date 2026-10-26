/**
 * test-v01017-finalizacao.ts — REFINAMENTO FINAL DE UX E PDF (v0.10.17).
 *
 * Parte A (pura, sem rede e sem banco):
 *  A1 PDF v3 (dossiê executivo) — abertura, 3 seções numeradas, bloco de fonte
 *     discreto, anexos; sem provedor técnico; sem parágrafo defensivo; sem
 *     frase proibida pelo contrato de linguagem;
 *  A2 paginação — empresa mínima fecha em 1 página (o bloco de fonte NUNCA vira
 *     página órfã); empresa extensa não perde conteúdo e a última página tem
 *     conteúdo real (nunca "só observações");
 *  A3 casos de composição — B identidade divergente (caixa na abertura, sem
 *     afirmação comercial conclusiva) e C conteúdo extenso (nome longo, muitas
 *     relações, contatos e IA) com todas as páginas reabertas e conferidas;
 *  A4 contrato de linguagem na interface — varredura dos arquivos da UI contra
 *     as frases proibidas do contrato (exemplos do despacho);
 *  A5 linguagem — estados de lacuna viram próximo passo.
 *
 * Parte B (HTTP contra o dev server :3000):
 *  B1 lote sintético → pdf_empresa e resumo do lote reais, reabertos e
 *     conferidos (modelo v3 no rodapé, reconciliação preservada);
 *  B2 dois downloads consecutivos — conteúdo factual idêntico, sem nova consulta.
 *
 * Rodar: bun scripts/test-v01017-finalizacao.ts  (dev server no 3000)
 */
import { inflateSync } from "zlib";
import { readFileSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { db } from "../src/lib/db";
import { gerarPdfEmpresa, gerarPdfLote, type LacunaPdf } from "../src/lib/export/pdf";
import type { DatasetExport, LinhaExport, ResumoLoteExport } from "../src/lib/export/dataset";
import { ESTADO_LACUNA_COMERCIAL } from "../src/lib/linguagem";

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
function fmt(cnpj: string): string {
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

/* --------- fixture --------- */
function resumoFake(): ResumoLoteExport {
  return {
    id: "lote-teste-017",
    arquivo: "lote-demo-v17.csv",
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

/** Extrai texto de um PDF gerado com pdf-lib, PÁGINA POR PÁGINA (ordem dos streams). */
function extrairPaginasPdf(buf: Buffer): string[] {
  const paginas: string[] = [];
  let i = 0;
  while (true) {
    const ini = buf.indexOf("stream", i);
    if (ini < 0) break;
    const fim = buf.indexOf("endstream", ini);
    if (fim < 0) break;
    let dados = buf.subarray(ini + 6, fim);
    while (dados.length > 0 && (dados[0] === 13 || dados[0] === 10 || dados[0] === 32)) dados = dados.subarray(1);
    let conteudo = "";
    try {
      conteudo = inflateSync(dados).toString("latin1");
    } catch {
      conteudo = dados.toString("latin1");
    }
    const textos: string[] = [];
    for (const m of conteudo.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const hex = m[1];
      let s = "";
      for (let j = 0; j + 1 < hex.length; j += 2) s += String.fromCharCode(Number.parseInt(hex.slice(j, j + 2), 16));
      textos.push(s);
    }
    for (const m of conteudo.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      textos.push(m[1].replace(/\\([()\\])/g, "$1"));
    }
    paginas.push(textos.join("\n"));
    i = fim + 9;
  }
  return paginas;
}
function extrairTextoPdf(buf: Buffer): string {
  return extrairPaginasPdf(buf).join("\n");
}
/** Conta páginas reais do PDF reabrindo o arquivo com pdf-lib. */
async function contarPaginas(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buf);
  return doc.getPageCount();
}
/** Texto da página sem o rodapé (rodapé = 3 linhas finais de marca/paginação/nota). */
function semRodape(pagina: string): string {
  return pagina
    .split("\n")
    .filter((l) => !/^(Scout 360 · Senior|Página \d+ de \d+)$/.test(l.trim()) && !l.startsWith("Documento gerado em") && !l.includes("Modelo ficha-comercial") && !l.includes("Modelo resumo-lote"))
    .join("\n")
    .trim();
}

/** Frases PROIBIDAS na superfície comercial (exemplos explícitos do despacho). */
const FRASES_PROIBIDAS = [
  "processada(s)",
  "aguardando execução",
  "com moderação",
  "não sobrecarregá",
  "ainda não foi feita",
  "depende da sua validação",
  "não prova quem decide",
  "não comprova quem compra",
  "pode ser diferente da atividade",
  "resposta(s) pendente(s)",
  "Registro técnico",
  "não é conclusivo",
];

function assertSemFrasesProibidas(label: string, texto: string) {
  const baixo = texto.toLowerCase();
  for (const frase of FRASES_PROIBIDAS) {
    check(`${label}: sem "${frase}"`, !baixo.includes(frase.toLowerCase()));
  }
}

/* ============ A. PARTE PURA ============ */

console.log("\nA1. PDF v3 — DOSSIÊ EXECUTIVO: abertura, seções, fonte discreta, sem provedor");
{
  const cnaes = Array.from({ length: 17 }, (_, i) => `Outra atividade registrada número ${i + 1} do cadastro`);
  const linha = linhaFake({
    cnaesSecundarios: cnaes,
    regimeTributario: "LUCRO REAL (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)",
    telefoneCrus: ["000000000000"],
    representantes: [
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "MARIA DA SILVA", qualificacao: "Sócio-Administrador", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2020-01-01", fonte: "BrasilAPI", dataConsulta: "2026-02-10T12:00:00Z", decisor: true, empresaParticipada: "" },
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "JOÃO PEREIRA", qualificacao: "Sócio", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2021-06-01", fonte: "BrasilAPI", dataConsulta: "2026-02-10T12:00:00Z", decisor: false, empresaParticipada: "" },
    ],
  });
  const lacunas: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente ou pesquise LinkedIn." },
    { pergunta: "Há outras empresas ligadas aos sócios?", estado: "COMPLEMENTAR_API", falta: "Quadros restantes dos participantes.", proximaVerificacao: "Expanda as conexões na ficha." },
  ];
  const buf = await gerarPdfEmpresa(datasetFake([linha]), linha, lacunas);
  const paginas = extrairPaginasPdf(buf);
  const t = paginas.join("\n");
  const tn = t.toUpperCase();
  const tf = t.replace(/\s+/g, " ");

  // abertura
  check("abertura com o rótulo do documento", tn.includes("DOSSIÊ COMERCIAL DA EMPRESA"));
  check("nome comercial como título principal", t.includes("Brasil Digital Telecom"));
  check("razão social presente", t.includes("BRASIL DIGITAL TELECOM LTDA"));
  check("CNPJ + localização na abertura", tf.includes("CNPJ 12.345.678/0001-95 · MATRIZ · São Paulo/SP"));
  check("situação cadastral na abertura", tf.includes("Situação cadastral: ATIVA desde 01/05/2020"));
  check("data da atualização discreta", tf.includes("Atualizado em"));
  check("pista original NÃO vira linha técnica solta na abertura", !tf.includes("Pista original:"));

  // seções do modelo v3
  check("seção 1 Visão empresarial", tn.includes("VISÃO EMPRESARIAL"));
  check("seção 2 Pessoas e relações", tn.includes("PESSOAS E RELAÇÕES"));
  check("seção 3 O que vale investigar", tn.includes("O QUE VALE INVESTIGAR"));
  check("atividade cadastrada como subtítulo (sem ressalva defensiva)", tn.includes("ATIVIDADE CADASTRADA") && !tf.includes("a operação real pode ser diferente"));
  check("regime com o ano ao lado do dado", t.includes("LUCRO REAL · exercício 2024"));
  check("representantes registrados com qualificação", tf.includes("MARIA DA SILVA - Sócio-Administrador"));
  check("bloco de fonte discreto no fim do conteúdo", tf.includes("Fonte principal: Cadastro empresarial"));
  check("bloco de fonte diz que nada foi reconsultado", tf.includes("Este documento não reconsultou fontes."));

  // anexos
  check("anexo A atividades secundárias", tn.includes("ANEXO A · ATIVIDADES SECUNDÁRIAS REGISTRADAS"));
  check("anexo B representantes completos", tn.includes("ANEXO B"));
  check("anexo de lacunas com Pergunta → O que falta → Como verificar", t.includes("O que falta") && t.includes("Como verificar"));
  check("Como verificar traz a ação concreta (sem repetir o estado)", tf.includes("Pergunte ao cliente ou pesquise LinkedIn.") && !tf.includes("Confirme essa informação com a empresa. Pergunte"));

  assertSemFrasesProibidas("PDF v3", t);
  const ocorrenciasBrasilApi = tn.split("BRASILAPI").length - 1;
  check("provedor técnico ausente do documento comercial", ocorrenciasBrasilApi === 0);
}

console.log("\nA2. PAGINAÇÃO — sem página órfã, sem seção quebrada com título sozinho");
{
  // empresa MÍNIMA: tudo (inclusive o bloco de fonte) cabe em 1 página
  const minima = linhaFake({ representantes: [], relacoesConsultadas: null });
  const bufMin = await gerarPdfEmpresa(datasetFake([minima]), minima, []);
  check("empresa mínima fecha em 1 página (bloco de fonte nunca vira página órfã)", (await contarPaginas(bufMin)) === 1, `páginas=${await contarPaginas(bufMin)}`);
  const paginasMin = extrairPaginasPdf(bufMin);
  check("bloco de fonte na MESMA página do conteúdo", paginasMin[0].includes("Fonte principal: Cadastro empresarial"));

  // empresa EXTENSA (caso C): nome longo, 6 relações com quadro, 3 representantes,
  // contatos e leitura de IA — a última página NÃO pode conter só observações
  const nomeLongo = "SOCIEDADE DE TELECOMUNICAÇÕES E PARTICIPAÇÕES EMPRESARIAIS DO INTERIOR PAULISTA COM ATUAÇÃO REGIONAL EM REDES FIBRA ÓPTICA LTDA";
  const participantes = Array.from({ length: 6 }, (_, i) => ({
    participanteId: cnpjValido(`3100000${i}`),
    nome: `PARCEIRA DE NEGÓCIOS REGISTRADA NUMERO ${i + 1} DA REGIÃO METROPOLITANA LTDA`,
    tipo: "PJ",
    cnpjFormatado: fmt(cnpjValido(`3100000${i}`)),
    quadro: {
      participanteId: cnpjValido(`3100000${i}`),
      nome: `PARCEIRA ${i + 1}`,
      tipo: "PJ",
      totalEmpresas: 3,
      totalPessoasJuridicas: 2,
      empresas: [
        { cnpjFormatado: fmt(cnpjValido(`3200000${i}`)), razaoSocial: `HOLDING ASSOCIADA ${i + 1} A LTDA`, raiz: `3200000${i}` },
        { cnpjFormatado: fmt(cnpjValido(`3200000${i}`, "0002")), razaoSocial: `HOLDING ASSOCIADA ${i + 1} A LTDA`, raiz: `3200000${i}` },
        { cnpjFormatado: fmt(cnpjValido(`3300000${i}`)), razaoSocial: `HOLDING ASSOCIADA ${i + 1} B LTDA`, raiz: `3300000${i}` },
      ],
      coletadoEm: "2026-02-10T12:15:00Z",
      validoAte: "2026-03-12T12:15:00Z",
      truncado: false,
    },
  }));
  const extensa = linhaFake({
    razaoSocial: nomeLongo,
    nomeFantasia: "",
    endereco: "AVENIDA DAS NAÇÕES UNIDAS, 12.995 — CONJUNTO 4.501 — BROOKLIN NOVO — SÃO PAULO — CEP 04578-000 — ATENDIMENTO EM HORÁRIO COMERCIAL DE SEGUNDA A SEXTA",
    email: "contato.comercial@sociedade-telecom-participacoes-interior-paulista.com.br",
    telefones: ["(11) 4002-8922", "(11) 3456-7890", "0800 555 0177"],
    representantes: Array.from({ length: 4 }, (_, i) => ({
      cnpjConta: "12.345.678/0001-95",
      razaoSocialConta: nomeLongo,
      nome: `SOCIO ADMINISTRADOR NUMERO ${i + 1} COM NOME COMPLETO EXTENSO`,
      qualificacao: "Sócio-Administrador",
      tipoVinculo: "Sócio/administração (quadro público)",
      tipoParticipante: "",
      dataEntrada: "2019-01-01",
      fonte: "BrasilAPI",
      dataConsulta: "2026-02-10T12:00:00Z",
      decisor: i === 0,
      empresaParticipada: "",
    })),
    relacoesConsultadas: { coletadoEm: "2026-02-10T12:10:00Z", validoAte: "2026-03-12T12:10:00Z", participantes },
    iaStatus: "OK",
    iaSetor: "Telecomunicações",
    iaPorte: "Média empresa",
    iaLeitura: "A empresa opera em telecomunicações com foco regional. A leitura abaixo é hipótese construída a partir de registros públicos e busca pública; confirme com a empresa antes de usar em decisão. Sinais de operação regional aparecem no domínio e nas relações registradas.",
    iaHipoteses: ["Sinal de operação regional em redes próprias (a confirmar com a empresa).", "Nome longo sugere grupo com participação de famílias (a confirmar)."],
  });
  const lacunasExtensas: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente." },
    { pergunta: "A operação é regional ou nacional?", estado: "PESQUISA_DOCUMENTAL", falta: "Sinais públicos de cobertura.", proximaVerificacao: "Pesquise no site oficial." },
    { pergunta: "Há outras empresas ligadas aos sócios?", estado: "COMPLEMENTAR_API", falta: "Quadros restantes.", proximaVerificacao: "Expanda as conexões na ficha." },
    { pergunta: "O grupo tem outras marcas?", estado: "COMPLEMENTAR_API", falta: "Relações indiretas.", proximaVerificacao: "Amplie os vínculos dos participantes." },
  ];
  const bufExt = await gerarPdfEmpresa(datasetFake([extensa]), extensa, lacunasExtensas);
  const totalExt = await contarPaginas(bufExt);
  // streams com texto real = páginas de conteúdo (streams de objetos pdf-lib saem vazios)
  const paginasConteudo = extrairPaginasPdf(bufExt).filter((p) => p.trim().length > 0);
  check("empresa extensa tem mais de 1 página", totalExt > 1, `páginas=${totalExt}`);
  const ultima = semRodape(paginasConteudo[paginasConteudo.length - 1] ?? "");
  check("última página tem conteúdo real (nunca só observações)", ultima.length > 220, `última página: ${ultima.length} chars`);
  check("nenhuma página vazia no documento", paginasConteudo.length === totalExt, `streams úteis=${paginasConteudo.length} · páginas=${totalExt}`);
  const tExt = extrairTextoPdf(bufExt);
  const tExtFlat = tExt.replace(/\s+/g, " ");
  // nada se perde: sentinelas do início, meio e fim do conteúdo
  check("sentinela da abertura presente", tExtFlat.includes(nomeLongo));
  check("sentinela das relações presente (6 participantes, visão + anexo)", [1, 2, 3, 4, 5, 6].every((n) => tExtFlat.includes(`PARCEIRA DE NEGÓCIOS REGISTRADA NUMERO ${n} `)));
  check("sentinela da IA presente (hipóteses preservadas)", tExtFlat.includes("Nome longo sugere grupo com participação de famílias (a confirmar)."));
  check("sentinela do endereço completo presente", tExtFlat.includes("CEP 04578-000"));
  assertSemFrasesProibidas("PDF extenso", tExt);
}

console.log("\nA3. CASO B — IDENTIDADE DIVERGENTE: caixa na abertura, sem conclusão comercial");
{
  const divergente = linhaFake({
    etapaIdentidade: "LOCALIZADO",
    emRevisao: true,
    estadoResolucao: "CONFIRMED",
    divergencias: [{ tipo: "NOME", severidade: "ALTA", descricao: "A pista citava 'Brasil Digital Telecom' e o registro responde 'TELECOM PARALELO SOLUÇÕES LTDA'." }],
    razaoSocial: "TELECOM PARALELO SOLUÇÕES LTDA",
    nomeFantasia: "",
  });
  const buf = await gerarPdfEmpresa(datasetFake([divergente]), divergente, []);
  const t = extrairTextoPdf(buf);
  const tf = t.replace(/\s+/g, " ");
  const paginasDiv = await contarPaginas(buf);
  check("caixa de identidade em revisão na abertura", tf.includes("Identidade em revisão"));
  check("divergência descrita na caixa", tf.includes("TELECOM PARALELO SOLUÇÕES LTDA") && tf.includes("A confirmação é sua decisão na ficha."));
  check("sem afirmação comercial conclusiva sobre identidade pendente", !tf.includes("empresa identificada") && !tf.includes("identidade confirmada"));
  check("documento curto segue íntegro", paginasDiv === 1, `páginas=${paginasDiv}`);
  if (process.env.DEBUG_PDF && paginasDiv > 1) {
    extrairPaginasPdf(buf).forEach((p, i) => console.log(`--- página ${i + 1} ---\n${p.slice(0, 1200)}`));
  }
}

console.log("\nA4. CONTRATO DE LINGUAGEM NA INTERFACE — varredura dos arquivos da UI");
{
  const arquivos = [
    "src/components/cnpj/batch-detail-card.tsx",
    "src/components/cnpj/app-header.tsx",
    "src/app/page.tsx",
    "src/components/cnpj/preview-card.tsx",
    "src/components/cnpj/upload-card.tsx",
    "src/components/cnpj/history-card.tsx",
  ];
  const proibidasUi = [
    "processada(s)",
    "aguardando execução",
    "com moderação",
    "não sobrecarreg",
    "ainda não foi feita",
    "depende da sua validação",
    "não comprova quem compra",
    "Falta comprovar",
    "Próxima verificação possível",
    "BrasilAPI",
    "MinhaReceita",
    "ReceitaWS",
  ];
  for (const arquivo of arquivos) {
    let conteudo = "";
    try {
      conteudo = readFileSync(`${process.cwd()}/${arquivo}`, "utf8");
    } catch {
      continue;
    }
    // ignora comentários de código (regras internas podem citar o estado antigo)
    const semComentarios = conteudo
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ")
      .replace(/^\s*\*.*$/gm, " ");
    const baixo = semComentarios.toLowerCase();
    for (const frase of proibidasUi) {
      check(`${arquivo}: sem "${frase}" na superfície`, !baixo.includes(frase.toLowerCase()));
    }
  }
  const ui = readFileSync(`${process.cwd()}/src/components/cnpj/batch-detail-card.tsx`, "utf8");
  const semComentarios = ui.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/^\s*\*.*$/gm, " ");
  check("hint de progresso em 'N de M consultas concluídas'", semComentarios.includes("consultas concluídas"));
  check("rótulo do hint fala em EMPRESAS localizadas (raízes, não CNPJs)", /"empresa", "empresas"\)\} localizadas no total/.test(semComentarios));
  check("fila de pesquisa: 'contas concluídas'", semComentarios.includes("contas concluídas"));
  check("triagem com 'Como verificar:'", semComentarios.includes("Como verificar:"));
  const header = readFileSync(`${process.cwd()}/src/components/cnpj/app-header.tsx`, "utf8");
  check("popover 'Como funciona' sem defesa de moderação", header.includes("A leitura com IA gera hipóteses."));
}

console.log("\nA5. LINGUAGEM — estados de lacuna viram próximo passo");
{
  check("COMPLEMENTAR_API → ação", ESTADO_LACUNA_COMERCIAL.COMPLEMENTAR_API === "Peça a consulta complementar na ficha desta empresa.");
  check("VALIDACAO_HUMANA → ação", ESTADO_LACUNA_COMERCIAL.VALIDACAO_HUMANA === "Confirme essa informação com a empresa.");
  check("PESQUISA_DOCUMENTAL → ação", ESTADO_LACUNA_COMERCIAL.PESQUISA_DOCUMENTAL === "Pesquise em sites e publicações do setor.");
  check("RESOLVIDO → estado positivo curto", ESTADO_LACUNA_COMERCIAL.RESOLVIDO === "Já respondida pelos dados coletados.");

  // fallback no PDF: lacuna SEM proximaVerificacao usa a frase do estado em "Como verificar"
  const semAcao = linhaFake({ representantes: [] });
  const bufFall = await gerarPdfEmpresa(datasetFake([semAcao]), semAcao, [
    { pergunta: "A empresa opera hoje?", estado: "VALIDACAO_HUMANA", falta: "Confirmação da operação atual.", proximaVerificacao: null },
  ]);
  const tfAll = extrairTextoPdf(bufFall).replace(/\s+/g, " ");
  check("Como verificar usa a frase do estado quando não há ação registrada", tfAll.includes("Confirme essa informação com a empresa."));
}

/* ============ B. PARTE HTTP (dev server) ============ */

console.log("\nB. PDF REAL reaberto e conferido (lote sintético — zero consulta pública)");
const lotes: string[] = [];
async function limparLotes() {
  for (const id of lotes) {
    await db.auditEvent.deleteMany({ where: { batchId: id } });
    await db.telemetryEvent.deleteMany({ where: { batchId: id } });
    await db.importRow.deleteMany({ where: { batchId: id } });
    await db.importBatch.deleteMany({ where: { id } });
  }
  await db.quadroParticipanteCache.deleteMany({ where: { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" } });
  await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: cnpjValido("12345678") } });
}
await limparLotes().catch(() => undefined);

try {
  const cnpjConta = cnpjValido("12345678");
  const batch = await db.importBatch.create({
    data: {
      id: `imp_test17_${Math.random().toString(36).slice(2, 8)}`,
      fileName: "finalizacao-v01017.csv",
      sourceType: "CSV",
      storedPath: "",
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

  const hashPf = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const outra1 = cnpjValido("31111111");
  const outra2 = cnpjValido("32222222");
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
      ]),
      totalParticipantes: 1,
    },
    update: {},
  });
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

  const p1 = await fetch(`${BASE}/api/imports/${batch.id}/export?type=pdf_empresa&row=1`);
  check("pdf_empresa 200", p1.status === 200);
  const buf1 = Buffer.from(await p1.arrayBuffer());
  const t1 = extrairTextoPdf(buf1);
  const tf1 = t1.replace(/\s+/g, " ");
  check("PDF real em modelo v3", t1.includes("Modelo ficha-comercial v3"));
  check("abertura no PDF real (nome comercial + dossiê)", tf1.includes("DOSSIÊ COMERCIAL DA EMPRESA".replace("Ê", "Ê")) && t1.includes("Brasil Digital Telecom"));
  check("relações consultadas na visão principal", tf1.includes("MARIA DA SILVA DEMO - pessoa física"));
  check("quadro expandido reconciliado (2 empresas, 3 estabelecimentos)", tf1.includes("encontramos 2 empresas e 3 estabelecimentos registrados nesta consulta"));
  check("bloco de fonte com categoria (sem provedor)", tf1.includes("Fonte principal: Cadastro empresarial") && !t1.includes("BrasilAPI"));
  const telemetriaAntes = await db.telemetryEvent.count({ where: { batchId: batch.id, tipo: "RELACAO_GRAFO" } });

  const p2 = await fetch(`${BASE}/api/imports/${batch.id}/export?type=pdf_empresa&row=1`);
  const buf2 = Buffer.from(await p2.arrayBuffer());
  const t2 = extrairTextoPdf(buf2);
  const telemetriaDepois = await db.telemetryEvent.count({ where: { batchId: batch.id, tipo: "RELACAO_GRAFO" } });
  check("B2: telemetria não cresce (download não reconsulta)", telemetriaDepois === telemetriaAntes);
  const fatos = (s: string) =>
    s
      .replace(/Documento gerado em .*/g, "")
      .replace(/Modelo (ficha-comercial|resumo-lote) v3[^·]*·/g, "Modelo $1 v3 ·")
      .replace(/Fonte principal: .*?\./g, "Fonte principal: FONTE.")
      .replace(/Relações consultadas \(\d{2}\/\d{2}\/\d{4}\)/g, "Relações consultadas (DATA)")
      .replace(/Consulta de \d{2}\/\d{2}\/\d{4}: encontramos/g, "Consulta de DATA: encontramos")
      .replace(/Atualizado em .*/g, "");
  check("B2: conteúdo factual idêntico em dois downloads", fatos(t1) === fatos(t2));

  // resumo do lote real
  const pl = await fetch(`${BASE}/api/imports/${batch.id}/export?type=pdf_lote&scope=TODAS`);
  check("pdf do lote 200", pl.status === 200);
  const tl = extrairTextoPdf(Buffer.from(await pl.arrayBuffer()));
  check("resumo do lote em modelo v3", tl.includes("Modelo resumo-lote v3"));
  check("resumo do lote sem frase proibida", !tl.toLowerCase().includes("aguardando execução"));
} finally {
  await limparLotes();
}

console.log(`\n=== RESULTADO v0.10.17: ${pass} PASS · ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Falhas:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
