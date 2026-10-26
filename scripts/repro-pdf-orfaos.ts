/**
 * repro-pdf-orfaos.ts — REPRODUÇÃO do defeito: títulos de seção/anexo isolados
 * no pé da página (sem o primeiro bloco de conteúdo junto).
 *
 * Cenários:
 *  - Brasil Digital (Caso A): 17 atividades secundárias, 2 representantes,
 *    relações consultadas com quadro (5 empresas × 18 estabelecimentos), 2 lacunas.
 *  - Yorozu (réplica sintética densa): nome longo, muitas relações, muitas
 *    lacunas e leitura de IA — conteúdo extenso que empurra títulos para o pé.
 *
 * Uso: bun scripts/repro-pdf-orfaos.ts  (sem rede, sem banco)
 */
import { writeFileSync } from "fs";
import { gerarPdfEmpresa, type LacunaPdf } from "../src/lib/export/pdf";
import type { DatasetExport, LinhaExport, ResumoLoteExport } from "../src/lib/export/dataset";
import { linhasPorPagina, numeroDePaginas } from "./lib/pdf-inspecao";

const cnpjValido = (base: string): string => {
  const base12 = `${base}0001`;
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
  return `${base12}${d1}${d2}`;
};

function resumoFake(): ResumoLoteExport {
  return {
    id: "lote-teste-000",
    arquivo: "lote-demo.csv",
    status: "DONE",
    origem: "arquivo CSV",
    criadoEm: new Date("2026-02-10T12:00:00Z"),
    finalizadoEm: new Date("2026-02-10T12:30:00Z"),
    entradasRecebidas: 2,
    linhasProcessadas: 2,
    aguardandoExecucao: 0,
    pjsLocalizadas: 2,
    pjsIdentificadas: 2,
    emRevisao: 0,
    validadas: 2,
    naoIdentificadas: 0,
    falhas: 0,
    situacaoDist: [{ key: "ATIVA", count: 2 }],
    ufDist: [{ key: "SP", count: 2 }],
    cnaeDist: [{ key: "J — Informação e comunicação", count: 2 }],
  };
}
function datasetFake(linhas: LinhaExport[]): DatasetExport {
  return { lote: resumoFake(), linhas, totalLinhasLote: linhas.length, escopo: "TODAS" };
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

/* ---------------- Caso A — Brasil Digital (fixture v0.10.16/17) ---------------- */
function casoBrasilDigital(): { linha: LinhaExport; lacunas: LacunaPdf[] } {
  const cnaes = Array.from({ length: 17 }, (_, i) => `Outra atividade registrada número ${i + 1} do cadastro`);
  const empresas18 = [
    ...Array.from({ length: 4 }, (_, i) => ({ cnpjFormatado: cnpjValido(`2000000${i}`).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"), razaoSocial: `HOLDING PARCEIRA ${i + 1} LTDA`, raiz: `2000000${i}` })),
    { cnpjFormatado: cnpjValido("20000009").replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"), razaoSocial: "HOLDING PARCEIRA 5 LTDA", raiz: "20000009" },
  ].flatMap((e) => Array.from({ length: e.raiz === "20000009" ? 2 : 4 }, (_, k) => ({ ...e, cnpjFormatado: e.cnpjFormatado.replace(/\/0001-/, `/000${k + 1}-`) })));
  const linha = linhaFake({
    cnaesSecundarios: cnaes,
    regimeTributario: "LUCRO REAL (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)",
    telefoneCrus: ["000000000000"],
    telefones: ["(11) 4002-8922"],
    email: "contato@brddigital.com.br",
    endereco: "Av. Paulista, 1000 — São Paulo/SP",
    representantes: [
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "MARIA DA SILVA", qualificacao: "Sócio-Administrador", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2020-01-01", fonte: "BrasilAPI", dataConsulta: "2026-02-10T12:00:00Z", decisor: true, empresaParticipada: "" },
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "BRD DIGITAL PARTICIPAÇÕES LTDA", qualificacao: "", tipoVinculo: "Participação registrada (fonte pública)", tipoParticipante: "INDETERMINADO", dataEntrada: "", fonte: "MinhaReceita Grafo", dataConsulta: "2026-02-10T12:10:00Z", decisor: false, empresaParticipada: "" },
    ],
    relacoesConsultadas: {
      coletadoEm: "2026-02-10T12:10:00Z",
      validoAte: "2026-03-12T12:10:00Z",
      participantes: [
        { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", cnpjFormatado: null, quadro: { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", totalEmpresas: empresas18.length, totalPessoasJuridicas: 5, empresas: empresas18, coletadoEm: "2026-02-10T12:15:00Z", validoAte: "2026-03-12T12:15:00Z", truncado: false } },
        { participanteId: "0000000000019X", nome: "BRD DIGITAL PARTICIPAÇÕES LTDA", tipo: "INDETERMINADO", cnpjFormatado: null, quadro: null },
      ],
    },
  });
  const lacunas: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente ou pesquise a rede profissional dela." },
    { pergunta: "Há outras empresas ligadas aos sócios?", estado: "COMPLEMENTAR_API", falta: "Quadros restantes dos participantes.", proximaVerificacao: "Amplie as conexões na ficha." },
  ];
  return { linha, lacunas };
}

/* --------------- Caso Yorozu — réplica sintética densa --------------- */
function casoYorozu(): { linha: LinhaExport; lacunas: LacunaPdf[] } {
  const nomeLongo = "YOROZU SOCIEDADE POR AÇÕES DO BRASIL IMPORTADORA E DISTRIBUIDORA DE PEÇAS INDUSTRIAIS DE ALTA PRECISÃO S.A.";
  const cnaes = Array.from({ length: 9 }, (_, i) => `Atividade secundária industrial de teste número ${i + 1} com descrição extensa para forçar quebra de linha no documento final`);
  const rel = {
    coletadoEm: "2026-02-11T09:00:00Z",
    validoAte: "2026-03-13T09:00:00Z",
    participantes: Array.from({ length: 3 }, (_, i) => ({
      participanteId: i === 0 ? "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" : cnpjValido(`3000000${i}`),
      nome: i === 0 ? "KENJI TANAKA" : `FORNECEDORA INDUSTRIAL PARCEIRA ${i} DO BRASIL LTDA`,
      tipo: i === 0 ? "PF" : "PJ",
      cnpjFormatado: i === 0 ? null : cnpjValido(`3000000${i}`).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"),
      quadro: i === 0 ? {
        participanteId: "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "KENJI TANAKA", tipo: "PF",
        totalEmpresas: 7, totalPessoasJuridicas: 3,
        empresas: Array.from({ length: 7 }, (_, k) => ({ cnpjFormatado: cnpjValido(`4000000${k}`).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"), razaoSocial: `COMERCIAL TANAKA PARTICIPAÇÕES E EMPREENDIMENTOS ${k + 1} LTDA`, raiz: `4000000${k}` })),
        coletadoEm: "2026-02-11T09:10:00Z", validoAte: "2026-03-13T09:10:00Z", truncado: false,
      } : null,
    })),
  };
  const linha = linhaFake({
    rowNumber: 2,
    entrada: "yorozu.com.br",
    razaoSocial: nomeLongo,
    nomeFantasia: "Yorozu do Brasil",
    cnpjRaiz: "55667788",
    cnpjNormalizado: cnpjValido("55667788"),
    cnpjFormatado: cnpjValido("55667788").replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"),
    cnaesSecundarios: cnaes,
    representantes: [
      { cnpjConta: "55.667.788/0001-00", razaoSocialConta: nomeLongo, nome: "KENJI TANAKA", qualificacao: "Diretor Presidente", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2018-06-01", fonte: "BrasilAPI", dataConsulta: "2026-02-11T09:00:00Z", decisor: true, empresaParticipada: "" },
      { cnpjConta: "55.667.788/0001-00", razaoSocialConta: nomeLongo, nome: "ANA LÚCIA FERREIRA", qualificacao: "Diretora Comercial", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2019-02-01", fonte: "BrasilAPI", dataConsulta: "2026-02-11T09:00:00Z", decisor: false, empresaParticipada: "" },
      { cnpjConta: "55.667.788/0001-00", razaoSocialConta: nomeLongo, nome: "CARLOS EDUARDO MENDONÇA ROCHA BARROS ALBUQUERQUE FILHO", qualificacao: "Conselheiro de Administração", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2021-08-01", fonte: "BrasilAPI", dataConsulta: "2026-02-11T09:00:00Z", decisor: false, empresaParticipada: "" },
    ],
    relacoesConsultadas: rel,
    iaStatus: "OK",
    iaSetor: "Indústria e distribuição de autopeças",
    iaPorte: "Grande porte (declarado)",
    iaLeitura: "A empresa atua como importadora e distribuidora de peças industriais. O cadastro registra atividade de comércio atacadista. A leitura abaixo é hipótese construída a partir do nome, do cadastro e das publicações coletadas, e precisa de confirmação do cliente para qualquer decisão. " + "O texto continua com detalhes de contexto setorial para ocupar espaço suficiente e forçar quebras de página. ".repeat(6),
    iaHipoteses: [
      "Compra por reposição de estoque com janela mensal (hipótese a validar com o cliente).",
      "Decisão dividida entre diretoria técnica e comercial (hipótese).",
      "Existe filial no interior que concentra o estoque (hipótese).",
    ],
  });
  const lacunas: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato direto de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente ou pesquise a rede profissional dos representantes." },
    { pergunta: "A operação de importação está na matriz ou na filial?", estado: "COMPLEMENTAR_API", falta: "Consultar estabelecimentos da raiz.", proximaVerificacao: "Peça a consulta de matriz e filiais na ficha." },
    { pergunta: "Há outras empresas ligadas aos sócios?", estado: "COMPLEMENTAR_API", falta: "Quadros restantes dos participantes.", proximaVerificacao: "Amplie as conexões na ficha." },
    { pergunta: "Qual é o volume aproximado de compras?", estado: "VALIDACAO_HUMANA", falta: "Qualquer estimativa pública de faturamento.", proximaVerificacao: "Confirme essa informação com a empresa." },
    { pergunta: "A empresa compra direto de fábricas ou de distribuidores?", estado: "PESQUISA_DOCUMENTAL", falta: "Fontes públicas de relação comercial.", proximaVerificacao: "Pesquise em sites e publicações do setor." },
  ];
  return { linha, lacunas };
}

/* ---------------- deteção de títulos órfãos ---------------- */
const RE_ANEXO = /^ANEXO\s+([A-Z])\s+·\s+/i;
const RE_SECAO = /^(VISÃO EMPRESARIAL|PESSOAS E RELAÇÕES|O QUE VALE INVESTIGAR|RESULTADO GERAL|DISTRIBUIÇÃO DAS CONTAS LOCALIZADAS|EMPRESAS IDENTIFICADAS|CASOS EM REVISÃO|FALHAS E PENDÊNCIAS|NOTAS DE LEITURA)$/i;
// conteúdo real = linha que não é rodapé, não é marca, não é paginação
function ehConteudo(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  if (/^Página\s+\d+\s+de\s+\d+/.test(s)) return false;
  if (s === "Scout 360 · Senior") return false;
  if (s.startsWith("Documento gerado em")) return false;
  if (s === "SCOUT 360" || s.includes("Senior — inteligência comercial")) return false;
  return true;
}

function diagnosticar(nome: string, buf: Buffer): { orfaos: string[]; paginas: number } {
  const linhas = linhasPorPagina(buf);
  const total = numeroDePaginas(buf);
  const orfaos: string[] = [];
  for (let p = 1; p <= total; p++) {
    const daPagina = linhas.filter((l) => l.pagina === p);
    for (let i = 0; i < daPagina.length; i++) {
      const l = daPagina[i];
      const eAnexo = RE_ANEXO.test(l.texto.trim());
      const eSecao = RE_SECAO.test(l.texto.trim());
      if (!eAnexo && !eSecao) continue;
      // conteúdo depois do título, mesma página, acima do rodapé (y > 60)
      const conteudoDepois = daPagina.slice(i + 1).filter((x) => x.y > 60 && ehConteudo(x.texto) && x.y < l.y);
      if (conteudoDepois.length === 0) {
        orfaos.push(`p${p}: "${l.texto.trim()}"`);
      }
    }
  }
  console.log(`\n=== ${nome} — ${total} página(s) ===`);
  for (let p = 1; p <= total; p++) {
    const n = linhas.filter((l) => l.pagina === p && l.y > 60 && ehConteudo(l.texto)).length;
    console.log(`  p${p}: ${n} linha(s) de conteúdo`);
  }
  if (orfaos.length > 0) {
    console.log(`  ❌ TÍTULOS ÓRFÃOS (${orfaos.length}):`);
    for (const o of orfaos) console.log(`     ${o}`);
  } else {
    console.log("  ✅ nenhum título órfão");
  }
  return { orfaos, paginas: total };
}

async function main(): Promise<void> {
  const { linha: linhaA, lacunas: lacunasA } = casoBrasilDigital();
  const bufA = await gerarPdfEmpresa(datasetFake([linhaA]), linhaA, lacunasA);
  writeFileSync("/tmp/repro-brasil-digital.pdf", bufA);
  const dA = diagnosticar("CASO A — Brasil Digital", bufA);

  const { linha: linhaY, lacunas: lacunasY } = casoYorozu();
  const bufY = await gerarPdfEmpresa(datasetFake([linhaY]), linhaY, lacunasY);
  writeFileSync("/tmp/repro-yorozu.pdf", bufY);
  const dY = diagnosticar("CASO Y — Yorozu (réplica densa)", bufY);

  const total = dA.orfaos.length + dY.orfaos.length;
  console.log(`\n${total === 0 ? "✅ SEM ÓRFÃOS (defeito não reproduzido)" : `❌ DEFETO REPRODUZIDO: ${total} título(s) órfão(s)`}`);
  process.exit(total === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
