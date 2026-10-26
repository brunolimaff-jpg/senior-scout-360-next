/**
 * test-v01018-fase-zero.ts — GATE DA FASE ZERO (contrato BRUNO FORGE).
 *
 * Provas de comportamento, não só contagem de testes:
 *  A. plural() — singular e plural corretos em português natural.
 *  B. Varredura estática — NENHUMA pluralização improvisada (s)/(ões)/(is)/(eis)
 *     em string de usuário do src/ (o contrato bane "4 lote(s)", "24 entrada(s)",
 *     "pessoa(s) jurídica(s)", "linha(s) processada(s)").
 *  C. Paginação do PDF — invariante em varredura de 160 combinações de conteúdo:
 *     nenhum título de seção/anexo órfão e nenhuma página final quase vazia.
 *     (Na v0.10.17 o código antigo gerava 31 títulos órfãos nesta mesma varredura.)
 *  D. Título viaja com o primeiro conteúdo — prova direta nos casos Brasil
 *     Digital e Yorozu (réplica densa): cada título tem conteúdo abaixo dele
 *     na MESMA página efetiva.
 *  E. Semântica do PDF preservada — anexos, reconciliação e provedor fora do corpo.
 *  F. Governança — registro de exposição externa existe e declara a proibição.
 *
 * Rodar: bun scripts/test-v01018-fase-zero.ts   (sem rede, sem banco)
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { gerarPdfEmpresa, type LacunaPdf } from "../src/lib/export/pdf";
import type { DatasetExport, LinhaExport, ResumoLoteExport } from "../src/lib/export/dataset";
import { plural, tipoParticipanteLegivel, regimeTributarioLegivel } from "../src/lib/linguagem";
import { linhasPorPagina, numeroDePaginas } from "./lib/pdf-inspecao";
import { varrerOrfaos } from "./verificar-orfaos-varredura";

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

/* ==================== A. plural() ==================== */
console.log("\nA. PLURAL — contagem em português natural");
{
  check("1 lote", plural(1, "lote", "lotes") === "1 lote");
  check("4 lotes", plural(4, "lote", "lotes") === "4 lotes");
  check("1 entrada", plural(1, "entrada", "entradas") === "1 entrada");
  check("24 entradas", plural(24, "entrada", "entradas") === "24 entradas");
  check("1 pessoa jurídica", plural(1, "pessoa jurídica", "pessoas jurídicas") === "1 pessoa jurídica");
  check("6 pessoas jurídicas", plural(6, "pessoa jurídica", "pessoas jurídicas") === "6 pessoas jurídicas");
  check("1 linha processada", plural(1, "linha processada", "linhas processadas") === "1 linha processada");
  check("24 linhas processadas", plural(24, "linha processada", "linhas processadas") === "24 linhas processadas");
  check("plural default com s", plural(2, "empresa") === "2 empresas");
  check("tipoParticipanteLegivel segue intacto", tipoParticipanteLegivel("PJ") === "pessoa jurídica");
  check("regimeTributarioLegivel segue intacto", regimeTributarioLegivel("LUCRO PRESUMIDO")?.valor === "LUCRO PRESUMIDO");
}

/* ==================== B. varredura estática de (s) ==================== */
console.log("\nB. CONTRATO DE LINGUAGEM — sem pluralização improvisada em string de usuário");
{
  // varredura pura (sem processo externo): lê todos os .ts/.tsx de src/
  const caminhos: string[] = [];
  const visitar = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) visitar(caminho);
      else if (/\.(ts|tsx)$/.test(entrada.name)) caminhos.push(caminho);
    }
  };
  visitar("src");
  const padrao = /[a-zçãéáóê]\((s|ões|is|eis|ns)\)/;
  const proibidos = ["lote(s)", "entrada(s)", "pessoa(s)", "linha(s)", "conta(s)", "consulta(s)", "empresa(s)"];
  const ilegais: string[] = [];
  const noCorpo: string[] = [];
  for (const caminho of caminhos) {
    const bruto = readFileSync(caminho, "utf8");
    // 1) remove comentários de bloco (inclui JSX {/* */}) e de linha
    const semComentarios = bruto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // 2) extrai APENAS o conteúdo de strings (o que chega ao usuário)
    const strings: string[] = [];
    for (const m of semComentarios.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g)) {
      strings.push(m[0].slice(1, -1));
    }
    for (const s of strings) {
      if (!padrao.test(s)) continue;
      // padrões legítimos dentro de string: código gerado dinamicamente ou
      // trechos que não são pluralização (ex.: documentação de regex)
      if (/\(s\)\s*=>/.test(s)) continue;
      // extrator ingênuo engole código quando há apóstrofo solto — candidatos
      // com tokens de código não são frases de usuário
      if (/=>|if\s*\(|return\s|;\s*\}|Object\.|\.test\(|\.filter\(|\.replace\(|\+\s*s\s*[;,)]/.test(s)) continue;
      ilegais.push(`${caminho}: “${s.replace(/\s+/g, " ").slice(0, 90)}”`);
      if (proibidos.some((p) => s.includes(p))) noCorpo.push(caminho);
    }
  }
  check(`nenhuma (s) improvisada em string de usuário (${caminhos.length} arquivos lidos)`, ilegais.length === 0, ilegais.slice(0, 5).join(" | "));
  check("exemplos do contrato eliminados do código", noCorpo.length === 0, noCorpo.slice(0, 5).join(" | "));
}

/* ==================== C. invariante de paginação em varredura ==================== */
console.log("\nC. PAGINAÇÃO DO PDF — invariante em varredura (160 combinações)");
{
  const r = await varrerOrfaos();
  console.log(`        (${r.combinacoes} combinações, ${r.paginasTotal} páginas geradas)`);
  check("nenhum título de seção/anexo órfão", r.orfaos.length === 0, r.orfaos.slice(0, 3).join(" | "));
  check("nenhuma página final quase vazia", r.paginasQuaseVazias.length === 0, r.paginasQuaseVazias.slice(0, 3).join(" | "));
}

/* ==================== fixtures dos casos ==================== */
function cnpjValido(base: string): string {
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
}
function resumoFake(): ResumoLoteExport {
  return {
    id: "lote-teste-000", arquivo: "lote-demo.csv", status: "DONE", origem: "arquivo CSV",
    criadoEm: new Date("2026-02-10T12:00:00Z"), finalizadoEm: new Date("2026-02-10T12:30:00Z"),
    entradasRecebidas: 2, linhasProcessadas: 2, aguardandoExecucao: 0, pjsLocalizadas: 2,
    pjsIdentificadas: 2, emRevisao: 0, validadas: 2, naoIdentificadas: 0, falhas: 0,
    situacaoDist: [{ key: "ATIVA", count: 2 }], ufDist: [{ key: "SP", count: 2 }],
    cnaeDist: [{ key: "J — Informação e comunicação", count: 2 }],
  };
}
function datasetFake(linhas: LinhaExport[]): DatasetExport {
  return { lote: resumoFake(), linhas, totalLinhasLote: linhas.length, escopo: "TODAS" };
}
function linhaFake(over: Partial<LinhaExport>): LinhaExport {
  return {
    rowNumber: 1, entrada: "brddigital.com.br", tipoEntrada: "REFERENCIA", referencia: "brddigital.com.br",
    etapaIdentidade: "CORRESPONDENTE", estadoResolucao: "CONFIRMED", confianca: "ALTA", divergencias: [],
    emRevisao: false, validadaPorOperador: true, cnpjFormatado: "12.345.678/0001-95",
    cnpjNormalizado: cnpjValido("12345678"), cnpjRaiz: "12345678", razaoSocial: "BRASIL DIGITAL TELECOM LTDA",
    nomeFantasia: "Brasil Digital Telecom", matrizFilial: "MATRIZ", identificadorMatrizFilial: "1",
    cnpjMatrizFormatado: "", statusMatriz: "RESOLVIDA", situacao: "ATIVA", dataSituacao: "2020-05-01",
    motivoSituacao: "", dataAbertura: "2015-03-10", cnaeCodigo: "6120-1/99", cnaeDescricao: "Telecomunicações por fio",
    cnaesSecundarios: [], municipio: "São Paulo", uf: "SP", ibgePopulacao: "11.000.000",
    ibgeRegiaoImediata: "São Paulo", ibgeAno: "2024", porte: "DEMAIS", naturezaJuridica: "Sociedade Empresária Limitada",
    capitalSocialTexto: "4.700.000,00", capitalSocialNumero: 4700000, simples: "Não optante", mei: "Não",
    regimeTributario: "LUCRO REAL (exercício 2024)", telefones: ["(11) 4002-8922"], email: "contato@brddigital.com.br",
    endereco: "Av. Paulista, 1000 — São Paulo/SP", telefonesCrus: ["000000000000"], temContatoUtil: true,
    representantes: [
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "MARIA DA SILVA", qualificacao: "Sócio-Administrador", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2020-01-01", fonte: "BrasilAPI", dataConsulta: "2026-02-10T12:00:00Z", decisor: true, empresaParticipada: "" },
    ],
    relacoesConsultadas: null, fonte: "BrasilAPI", fonteDescoberta: "",
    dataConsulta: new Date("2026-02-10T12:00:00Z"), dataColeta: new Date("2026-02-01T09:00:00Z"),
    erro: "", pesquisaStatus: "", iaStatus: "", iaSetor: "", iaPorte: "", iaPerfil: "", iaLeitura: "", iaHipoteses: [],
    ...over,
  };
}

/* ==================== D. título viaja com o primeiro conteúdo ==================== */
const RE_TITULO = /^(ANEXO\s+[A-Z]\s+·\s+|VISÃO EMPRESARIAL$|PESSOAS E RELAÇÕES$|O QUE VALE INVESTIGAR$)/i;
function ehConteudo(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  if (/^Página\s+\d+\s+de\s+\d+/.test(s)) return false;
  if (s === "Scout 360 · Senior") return false;
  if (s.startsWith("Documento gerado em")) return false;
  if (s === "SCOUT 360" || s.includes("Senior — inteligência comercial")) return false;
  return true;
}
function titulosComContagem(linhas: ReturnType<typeof linhasPorPagina>): { titulo: string; pagina: number; abaixo: number }[] {
  const out: { titulo: string; pagina: number; abaixo: number }[] = [];
  for (let p = 1; p <= numeroDePaginas(linhas ? new Buffer("") : new Buffer("")); p++) void p; // noop (paginação por linhas)
  return out;
}

console.log("\nD. TÍTULOS VIAJAM COM O PRIMEIRO CONTEÚDO — Brasil Digital e Yorozu (réplica)");
{
  // CASO A — Brasil Digital
  const cnaes = Array.from({ length: 17 }, (_, i) => `Outra atividade registrada número ${i + 1} do cadastro`);
  const empresas18 = Array.from({ length: 18 }, (_, i) => ({
    cnpjFormatado: cnpjValido(`2000000${i % 10}`).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5").replace(/\/0001-/, `/000${(i % 4) + 1}-`),
    razaoSocial: `HOLDING PARCEIRA ${(i % 5) + 1} LTDA`,
    raiz: `2000000${i % 10}`,
  }));
  const linhaA = linhaFake({
    cnaesSecundarios: cnaes,
    relacoesConsultadas: {
      coletadoEm: "2026-02-10T12:10:00Z", validoAte: "2026-03-12T12:10:00Z",
      participantes: [
        { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", cnpjFormatado: null, quadro: { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", totalEmpresas: 18, totalPessoasJuridicas: 5, empresas: empresas18, coletadoEm: "2026-02-10T12:15:00Z", validoAte: "2026-03-12T12:15:00Z", truncado: false } },
        { participanteId: "0000000000019X", nome: "BRD DIGITAL PARTICIPAÇÕES LTDA", tipo: "INDETERMINADO", cnpjFormatado: null, quadro: null },
      ],
    },
  });
  const lacunasA: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente ou pesquise a rede profissional dela." },
    { pergunta: "Há outras empresas ligadas aos sócios?", estado: "COMPLEMENTAR_API", falta: "Quadros restantes dos participantes.", proximaVerificacao: "Amplie as conexões na ficha." },
  ];
  const bufA = await gerarPdfEmpresa(datasetFake([linhaA]), linhaA, lacunasA);
  const linhasA = linhasPorPagina(bufA);
  const totalA = numeroDePaginas(bufA);
  let titulosA = 0;
  let titulosOrfaosA = 0;
  for (let p = 1; p <= totalA; p++) {
    const da = linhasA.filter((l) => l.pagina === p && l.y > 60 && ehConteudo(l.texto));
    for (let i = 0; i < da.length; i++) {
      if (!RE_TITULO.test(da[i].texto.trim())) continue;
      titulosA += 1;
      const abaixo = da.slice(i + 1).filter((x) => x.y < da[i].y);
      if (abaixo.length === 0) titulosOrfaosA += 1;
    }
  }
  console.log(`        Brasil Digital: ${totalA} página(s), ${titulosA} título(s)`);
  check("Brasil Digital: todo título tem conteúdo na mesma página", titulosA >= 3 && titulosOrfaosA === 0, `títulos=${titulosA} órfãos=${titulosOrfaosA}`);
  check("Brasil Digital: anexo C (relações em detalhe) presente no documento", linhasA.some((l) => l.texto.includes("ANEXO C")));

  // CASO Y — Yorozu (réplica densa: nome longo + IA + 5 lacunas + 3 representantes)
  const nomeLongo = "YOROZU SOCIEDADE POR AÇÕES DO BRASIL IMPORTADORA E DISTRIBUIDORA DE PEÇAS INDUSTRIAIS S.A.";
  const linhaY = linhaFake({
    rowNumber: 2, entrada: "yorozu.com.br", razaoSocial: nomeLongo, nomeFantasia: "Yorozu do Brasil",
    cnpjNormalizado: cnpjValido("55667788"), cnpjFormatado: cnpjValido("55667788").replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"),
    cnpjRaiz: "55667788",
    cnaesSecundarios: Array.from({ length: 9 }, (_, i) => `Atividade secundária industrial de teste número ${i + 1} com descrição extensa para forçar quebra`),
    representantes: [
      { cnpjConta: "55.667.788/0001-00", razaoSocialConta: nomeLongo, nome: "KENJI TANAKA", qualificacao: "Diretor Presidente", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2018-06-01", fonte: "BrasilAPI", dataConsulta: "2026-02-11T09:00:00Z", decisor: true, empresaParticipada: "" },
      { cnpjConta: "55.667.788/0001-00", razaoSocialConta: nomeLongo, nome: "ANA LÚCIA FERREIRA", qualificacao: "Diretora Comercial", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2019-02-01", fonte: "BrasilAPI", dataConsulta: "2026-02-11T09:00:00Z", decisor: false, empresaParticipada: "" },
      { cnpjConta: "55.667.788/0001-00", razaoSocialConta: nomeLongo, nome: "CARLOS EDUARDO MENDONÇA ROCHA BARROS ALBUQUERQUE FILHO", qualificacao: "Conselheiro", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2021-08-01", fonte: "BrasilAPI", dataConsulta: "2026-02-11T09:00:00Z", decisor: false, empresaParticipada: "" },
    ],
    relacoesConsultadas: {
      coletadoEm: "2026-02-11T09:00:00Z", validoAte: "2026-03-13T09:00:00Z",
      participantes: [
        { participanteId: "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "KENJI TANAKA", tipo: "PF", cnpjFormatado: null, quadro: { participanteId: "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "KENJI TANAKA", tipo: "PF", totalEmpresas: 7, totalPessoasJuridicas: 3, empresas: Array.from({ length: 7 }, (_, k) => ({ cnpjFormatado: cnpjValido(`4000000${k}`).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"), razaoSocial: `COMERCIAL TANAKA PARTICIPAÇÕES ${k + 1} LTDA`, raiz: `4000000${k}` })), coletadoEm: "2026-02-11T09:10:00Z", validoAte: "2026-03-13T09:10:00Z", truncado: false } },
      ],
    },
    iaStatus: "OK", iaSetor: "Indústria e distribuição de autopeças", iaPorte: "Grande porte (declarado)",
    iaLeitura: "Hipótese de leitura comercial com texto extenso para forçar o bloco de IA a quebrar página. " + "Contexto setorial adicional para ocupar espaço suficiente no documento final gerado. ".repeat(8),
    iaHipoteses: ["Compra por reposição de estoque com janela mensal (hipótese a validar).", "Decisão dividida entre diretoria técnica e comercial (hipótese)."],
  });
  const lacunasY: LacunaPdf[] = [0, 1, 2, 3, 4].map((i) => ({
    pergunta: `Pergunta comercial de investigação número ${i + 1} sobre a operação desta empresa`,
    estado: i % 2 === 0 ? "VALIDACAO_HUMANA" : "COMPLEMENTAR_API",
    falta: `Informação que falta de número ${i + 1}.`,
    proximaVerificacao: "Confirme essa informação com a empresa.",
  }));
  const bufY = await gerarPdfEmpresa(datasetFake([linhaY]), linhaY, lacunasY);
  const linhasY = linhasPorPagina(bufY);
  const totalY = numeroDePaginas(bufY);
  let titulosY = 0;
  let titulosOrfaosY = 0;
  for (let p = 1; p <= totalY; p++) {
    const da = linhasY.filter((l) => l.pagina === p && l.y > 60 && ehConteudo(l.texto));
    for (let i = 0; i < da.length; i++) {
      if (!RE_TITULO.test(da[i].texto.trim())) continue;
      titulosY += 1;
      const abaixo = da.slice(i + 1).filter((x) => x.y < da[i].y);
      if (abaixo.length === 0) titulosOrfaosY += 1;
    }
  }
  console.log(`        Yorozu (réplica): ${totalY} página(s), ${titulosY} título(s)`);
  check("Yorozu: todo título tem conteúdo na mesma página", titulosY >= 3 && titulosOrfaosY === 0, `títulos=${titulosY} órfãos=${titulosOrfaosY}`);
  check("Yorozu: lacuna inteira nunca separa pergunta de Como verificar", (() => {
    // assinatura do Anexo D: pergunta seguida de "O que falta" e "Como verificar"
    // NA MESMA PÁGINA (a seção 3 usa pergunta + ação, sem esses rótulos)
    const perguntas = lacunasY.map((l) => l.pergunta.toUpperCase());
    for (let p = 1; p <= totalY; p++) {
      const da = linhasY.filter((l) => l.pagina === p && ehConteudo(l.texto));
      for (const q of perguntas) {
        const idx = da.findIndex((l) => l.texto.trim().toUpperCase() === q);
        if (idx < 0) continue;
        const depois = da.slice(idx).map((l) => l.texto.trim());
        const temFalta = depois.includes("O que falta");
        const temVerificar = depois.includes("Como verificar");
        if (temFalta && !temVerificar) return false;
      }
    }
    return true;
  })());
}

/* ==================== E. semântica do PDF preservada ==================== */
console.log("\nE. SEMÂNTICA DO PDF — anexos, reconciliação, provedor fora do corpo");
{
  const linha = linhaFake({ cnaesSecundarios: ["Atividade secundária de teste 1", "Atividade secundária de teste 2"] });
  const lacunas: LacunaPdf[] = [{ pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de decisão.", proximaVerificacao: "Pergunte ao cliente." }];
  const buf = await gerarPdfEmpresa(datasetFake([linha]), linha, lacunas);
  const texto = linhasPorPagina(buf).map((l) => l.texto).join("\n");
  check("abertura com marca e razão social", texto.includes("DOSSIÊ COMERCIAL DA EMPRESA") && texto.includes("BRASIL DIGITAL TELECOM LTDA"));
  check("atividade cadastrada com exercício do regime", texto.includes("Atividade cadastrada") && texto.includes("exercício 2024"));
  check("representantes registrados", texto.includes("Representantes registrados"));
  check("lacuna vira ação concreta da próxima verificação", texto.includes("Pergunte ao cliente."));
  check("provedor técnico não aparece no corpo", !texto.includes("BrasilAPI"));
  check("bloco de fontes discreto no fim", texto.includes("Este documento não reconsultou fontes"));
}

/* ==================== F. governança ==================== */
console.log("\nF. GOVERNANÇA — registro de exposição externa");
{
  const caminho = "qa/governanca-exposicao-externa.md";
  check("registro existe", existsSync(caminho));
  if (existsSync(caminho)) {
    const conteudo = readFileSync(caminho, "utf8");
    check("declara a proibição de novos uploads", conteudo.includes("Proibido novo upload externo"));
    check("inventário de links presente", conteudo.includes("tmpfiles.org/dl/"));
    check("não declara exclusão não comprovada", conteudo.includes("Não temos como certificar a exclusão"));
  }
}

/* ==================== resumo ==================== */
console.log(`\n${"=".repeat(64)}\nFASE ZERO: ${pass} PASS · ${fail} FAIL`);
if (fail > 0) {
  console.log("Falhas:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
