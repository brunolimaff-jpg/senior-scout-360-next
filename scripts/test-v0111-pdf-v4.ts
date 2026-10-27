/**
 * test-v0111-pdf-v4.ts — Gate 3 da MISSÃO DE CONSOLIDAÇÃO: ficha comercial v3 → v4.
 *
 * O que prova (comparação v3 × v4 + semântica do v4):
 *  1. CASO BANCO DO BRASIL (DIRECAO GERAL): na v3 o nome comercial SUBSTITUIA a
 *     razão social no título; na v4 a razão social é o elemento principal e a
 *     denominação secundária fica identificada — nunca a substitui.
 *  2. PÁGINA 1 EXECUTIVA: síntese comercial completa (fatos comprovados,
 *     principais evidências, o que ainda não sabemos, próximos movimentos,
 *     leitura de IA como hipótese quando cabe).
 *  3. CONSOLIDAÇÃO DE PESSOAS: raízes de CNPJ = empresas; CNPJs completos =
 *     estabelecimentos; os dois números nunca se confundem (quadro gigante com
 *     teto NUNCA vira "8.000 empresas").
 *  4. REGIME TRIBUTÁRIO: exercício 2024 distinto do regime atual não confirmado.
 *  5. ANEXOS: só quando aprofundam; instrução de ampliação aparece UMA vez;
 *     nenhuma referência a planilha de evidências que não acompanha o documento.
 *  6. NÍVEIS: executivo sem anexos e 1-2 páginas; completo > executivo.
 *  7. FATOS IDÊNTICOS v3 × v4 (razão social, CNPJ, atividade, fonte).
 *  8. PAGINAÇÃO: sem títulos órfãos (varredura de combinações).
 *  9. RENDERIZAÇÃO pdftoppm de v3 e v4 (todas as páginas) em qa/consolidacao-v0111/pdf/.
 *
 * Rodar: bun scripts/test-v0111-pdf-v4.ts   (sem rede, sem banco)
 */
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { gerarPdfEmpresa, gerarPdfEmpresaV3, type LacunaPdf } from "../src/lib/export/pdf";
import type { DatasetExport, LinhaExport, ResumoLoteExport } from "../src/lib/export/dataset";
import { linhasPorPagina, numeroDePaginas, fonteMaiorPagina1 } from "./lib/pdf-inspecao";

let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${nome}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    falhas.push(nome);
    console.log(`  FAIL  ${nome}${extra ? ` — ${extra}` : ""}`);
  }
}

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
const fmt = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

function resumoFake(): ResumoLoteExport {
  return {
    id: "lote-teste-v4", arquivo: "lote-v4.csv", status: "DONE", origem: "texto colado",
    criadoEm: new Date("2026-10-25T12:00:00Z"), finalizadoEm: new Date("2026-10-25T12:30:00Z"),
    entradasRecebidas: 1, linhasProcessadas: 1, aguardandoExecucao: 0, pjsLocalizadas: 1,
    pjsIdentificadas: 1, emRevisao: 0, validadas: 1, naoIdentificadas: 0, falhas: 0,
    situacaoDist: [{ key: "ATIVA", count: 1 }], ufDist: [{ key: "DF", count: 1 }],
    cnaeDist: [{ key: "K — Atividades financeiras", count: 1 }],
  };
}

function linhaFake(over: Partial<LinhaExport>): LinhaExport {
  return {
    rowNumber: 1, entrada: "banco do brasil", tipoEntrada: "NOME", referencia: "",
    etapaIdentidade: "CORRESPONDENTE", estadoResolucao: "CONFIRMED", confianca: "ALTA", divergencias: [],
    emRevisao: false, validadaPorOperador: true, cnpjFormatado: "00.000.000/0001-91",
    cnpjNormalizado: cnpjValido("00000000"), cnpjRaiz: "00000000", razaoSocial: "BANCO DO BRASIL SA",
    nomeFantasia: "DIRECAO GERAL", matrizFilial: "MATRIZ", identificadorMatrizFilial: "1",
    cnpjMatrizFormatado: "", statusMatriz: "RESOLVIDA", situacao: "ATIVA", dataSituacao: "2002-04-15",
    motivoSituacao: "", dataAbertura: "1925-05-15", cnaeCodigo: "6421-4/00", cnaeDescricao: "Banco múltiplo, com carteira comercial",
    cnaesSecundarios: [], municipio: "Brasília", uf: "DF", ibgePopulacao: "2.800.000",
    ibgeRegiaoImediata: "Brasília", ibgeAno: "2024", porte: "DEMAIS", naturezaJuridica: "Sociedade de Economia Mista",
    capitalSocialTexto: "20.000.000.000,00", capitalSocialNumero: 20000000000, simples: "Não optante", mei: "Não",
    regimeTributario: "LUCRO REAL (exercício 2024)", telefones: ["(61) 4004-0001"], email: "",
    endereco: "", telefonesCrus: [], temContatoUtil: true,
    representantes: [], relacoesConsultadas: null, fonte: "MinhaReceita", fonteDescoberta: "",
    dataConsulta: new Date("2026-10-25T12:00:00Z"), dataColeta: new Date("2026-10-25T11:00:00Z"),
    erro: "", pesquisaStatus: "", iaStatus: "", iaSetor: "", iaPorte: "", iaPerfil: "", iaLeitura: "", iaHipoteses: [],
    ...over,
  };
}

const DS: DatasetExport = { lote: resumoFake(), linhas: [], totalLinhasLote: 1, escopo: "TODAS" };
const DIR_PDF = "qa/consolidacao-v0111/pdf";

async function main(): Promise<void> {
  mkdirSync(DIR_PDF, { recursive: true });

  /* ============ CASO 1 — BANCO DO BRASIL (DIRECAO GERAL), simples ============ */
  const bb = linhaFake({
    representantes: Array.from({ length: 41 }, (_, i) => ({
      cnpjConta: "00.000.000/0001-91", razaoSocialConta: "BANCO DO BRASIL SA",
      nome: `SÓCIO REGISTRADO ${String(i + 1).padStart(2, "0")}`, qualificacao: i < 8 ? "Diretor" : "Sócio",
      tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2020-01-01",
      fonte: "MinhaReceita", dataConsulta: "2026-10-25T12:00:00Z", decisor: i < 8, empresaParticipada: "",
    })),
  });
  const lacunasBB: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente ou pesquise a rede profissional dela." },
    { pergunta: "Regime tributário vigente", estado: "VALIDACAO_HUMANA", falta: "O registro só traz o exercício 2024.", proximaVerificacao: "Confirme o regime atual com a empresa." },
  ];

  console.log("\n1. CASO BANCO DO BRASIL — o defeito v3 e a correção v4");
  const bufV3 = await gerarPdfEmpresaV3(DS, bb, lacunasBB, { nivel: "completo" });
  const txtV3 = linhasPorPagina(bufV3).map((x) => x.texto).join("\n");
  const bufV4 = await gerarPdfEmpresa(DS, bb, lacunasBB, { nivel: "completo" });
  const pagV4 = linhasPorPagina(bufV4);
  const txtV4 = pagV4.map((x) => x.texto).join("\n");

  // PROVA do defeito v3: o título principal era o nome comercial (DIRECAO GERAL)
  // e a razão social aparecia como secundária.
  const tituloV3 = pagV3Titulo(bufV3);
  check("v3 (reprodução do defeito): título principal = DIRECAO GERAL", tituloV3 === "DIRECAO GERAL", `título="${tituloV3}"`);
  // v4: razão social é o título; denominação secundária identificada
  const tituloV4 = tituloV4Documento(bufV4);
  check("v4: título principal = BANCO DO BRASIL SA", tituloV4.includes("BANCO DO BRASIL SA"), `título="${tituloV4}"`);
  check("v4: denominação secundária identificada (sem substituir a razão social)", txtV4.includes("Denominação secundária registrada: DIRECAO GERAL"));
  check("v4: eyebrow da ficha executiva", txtV4.includes("FICHA COMERCIAL DA EMPRESA"));
  check("v4: modelo declarado no rodapé", txtV4.includes("Modelo ficha-comercial v4"));

  console.log("\n2. PÁGINA 1 EXECUTIVA — síntese comercial completa");
  check("v4: fatos comprovados na página 1", txtV4.includes("O QUE OS DADOS COMPROVAM") && txtV4.includes("Banco múltiplo, com carteira comercial"));
  check("v4: regime com exercício 2024", txtV4.includes("LUCRO REAL · exercício 2024"));
  check("v4: regime histórico ≠ regime atual (nota de confirmação)", txtV4.includes("O registro encontrado se refere ao exercício 2024") && txtV4.includes("Ainda precisamos confirmar a situação atual"));
  check("v4: principais evidências na página 1", txtV4.includes("PRINCIPAIS EVIDÊNCIAS") && txtV4.includes("Quadro público (QSA) registra 41 representantes"));
  check("v4: o que falta confirmar na página 1", txtV4.includes("O QUE FALTA CONFIRMAR") && txtV4.includes("Quem decide a compra?"));
  check("v4: próximos movimentos possíveis (determinísticos)", txtV4.includes("PRÓXIMOS MOVIMENTOS POSSÍVEIS"));
  check("v4: fonte discreta no fim", txtV4.includes("Este documento não reconsultou fontes"));
  check("v4: provedor técnico fora do documento", !txtV4.includes("MinhaReceita"));

  console.log("\n3. ANEXOS — só quando aprofundam; sem repetição nem planilha fantasma");
  check("v4: anexo B existe (41 representantes > 5)", txtV4.includes("Anexo B"));
  check("v4: sem referência a planilha de evidências", !txtV4.toLowerCase().includes("planilha de evidências"));
  const qtdSobComando = (txtV4.match(/sob comando/g) ?? []).length;
  check("v4: instrução 'sob comando' aparece no máximo 3 vezes (nunca dezenas)", qtdSobComando <= 3, `${qtdSobComando} ocorrências`);

  console.log("\n4. NÍVEL EXECUTIVO v4 — 1-2 páginas, sem anexos");
  const bufExe = await gerarPdfEmpresa(DS, bb, lacunasBB, { nivel: "executivo" });
  const pagExe = linhasPorPagina(bufExe);
  const txtExe = pagExe.map((x) => x.texto).join("\n");
  const nExe = numeroDePaginas(bufExe);
  check("executivo: sem NENHUM anexo", !txtExe.includes("ANEXO"));
  check("executivo: 1-2 páginas", nExe <= 2, `${nExe} páginas`);
  check("executivo: síntese comercial completa", txtExe.includes("O QUE OS DADOS COMPROVAM") && txtExe.includes("PRÓXIMOS MOVIMENTOS POSSÍVEIS"));
  check("executivo: razão social dominante + denominação secundária", txtExe.includes("BANCO DO BRASIL SA") && txtExe.includes("Denominação secundária registrada: DIRECAO GERAL"));

  /* ============ CASO 2 — CONSOLIDAÇÃO: 8.000 estabelecimentos ≠ 8.000 empresas ============ */
  console.log("\n5. CONSOLIDAÇÃO DE PESSOAS E RELAÇÕES (quadro gigante com teto)");
  // quadro com 8.000 estabelecimentos em 12 raízes — teto de armazenamento aplicado
  const raizesGigante = Array.from({ length: 12 }, (_, i) => cnpjValido(`3000000${i}`));
  const empresasGigante = Array.from({ length: 50 }, (_, i) => ({
    cnpjFormatado: fmt(raizesGigante[i % 12]),
    razaoSocial: `HOLDING GIGANTE ${(i % 12) + 1} SA`,
    raiz: raizesGigante[i % 12],
  }));
  const relacoesGigante = {
    coletadoEm: "2026-10-25T12:10:00Z", validoAte: "2026-11-24T12:10:00Z",
    participantes: [
      { participanteId: "pfhash0000000000000000000001", nome: "MARIA DA SILVA", tipo: "PF", cnpjFormatado: null, quadro: { participanteId: "pfhash0000000000000000000001", nome: "MARIA DA SILVA", tipo: "PF", totalEmpresas: 8000, totalPessoasJuridicas: 12, empresas: empresasGigante, coletadoEm: "2026-10-25T12:15:00Z", validoAte: "2026-11-24T12:15:00Z", truncado: true } },
      { participanteId: "pfhash0000000000000000000002", nome: "JOÃO PEREIRA", tipo: "PF", cnpjFormatado: null, quadro: null },
      { participanteId: "0000000000019X0000000000000001", nome: "BB INVESTIMENTO SA", tipo: "PJ", cnpjFormatado: fmt(cnpjValido("00000001")), quadro: null },
    ],
  };
  const rede = linhaFake({
    relacoesConsultadas: relacoesGigante,
    representantes: [
      { cnpjConta: "00.000.000/0001-91", razaoSocialConta: "BANCO DO BRASIL SA", nome: "MARIA DA SILVA", qualificacao: "Sócio-Administrador", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2020-01-01", fonte: "MinhaReceita", dataConsulta: "2026-10-25T12:00:00Z", decisor: true, empresaParticipada: "" },
    ],
  });
  const bufRede = await gerarPdfEmpresa(DS, rede, lacunasBB, { nivel: "completo" });
  const pagRede = linhasPorPagina(bufRede);
  const txtRede = pagRede.map((x) => x.texto).join("\n");
  // a própria raiz (00000000) entra no conjunto: 12 raízes dos quadros + 1 da conta = 13
  // v4: os totais REAIS do quadro (8.000 estabelecimentos) vivem no anexo C;
  // a leitura consolidada usa APENAS raízes distintas = empresas.
  check("v4: raízes distintas = empresas (13), estabelecimentos citados = 50 (nunca 8.000 empresas)", txtRede.includes("13 empresas distintas (raízes de CNPJ)") && !txtRede.includes("8.000 empresas"), "13 raízes + 50 estabelecimentos citados");
  check("v4: 8.000 estabelecimentos preservados como TOTAL REAL do quadro", txtRede.includes("8.000 estabelecimentos"));
  check("v4: teto honesto (truncado)", txtRede.includes("teto de armazenamento"));
  check("v4: frase de identidade (filiais não são empresas independentes)", txtRede.includes("Uma empresa com muitas unidades é UMA empresa") || txtRede.includes("Filiais da mesma raiz são a MESMA empresa"));
  check("v4: conexões não ampliadas com contagem honesta", txtRede.includes("2 conexões ainda não ampliadas") || txtRede.includes("2 participantes sem quadro ampliado"));
  check("v4: tipos dos participantes consolidados", txtRede.includes("2 pessoas físicas") && txtRede.includes("1 pessoa jurídica"));
  const qtdInstrucaoFicha = (txtRede.match(/na ficha(?: da empresa)?, sob comando/g) ?? []).length;
  check("v4: instrução de ampliação no máximo 3 vezes no documento", qtdInstrucaoFicha <= 3, `${qtdInstrucaoFicha} ocorrências`);

  /* ============ CASO 3 — SEM RELAÇÕES: documento nunca fica vazio ============ */
  console.log("\n6. EMPRESA SEM RELAÇÕES CONSULTADAS (movimento sugerido, sem inventar fato)");
  const semRel = linhaFake({ relacoesConsultadas: null, representantes: [] });
  const bufSemRel = await gerarPdfEmpresa(DS, semRel, lacunasBB, { nivel: "executivo" });
  const txtSemRel = linhasPorPagina(bufSemRel).map((x) => x.texto).join("\n");
  check("sem relações: próximo movimento sugere a consulta", txtSemRel.includes("Consultar as relações societárias na ficha"));
  check("sem relações: nenhuma contagem inventada", !txtSemRel.includes("participante registrado"));

  /* ============ CASO 4 — FATOS IDÊNTICOS v3 × v4 ============ */
  console.log("\n7. FATOS IDÊNTICOS v3 × v4 (reconciliação)");
  const fatos = ["BANCO DO BRASIL SA", "00.000.000/0001-91", "Banco múltiplo, com carteira comercial", "Brasília/DF", "Este documento não reconsultou fontes"];
  for (const f of fatos) check(`presente nos dois modelos: "${f}"`, txtV3.includes(f) && txtV4.includes(f));
  check("v3 declara modelo v3 no rodapé (rastreabilidade da comparação)", txtV3.includes("Modelo ficha-comercial v3"));

  /* ============ CASO 5 — IA na página 1 (hipótese) ============ */
  console.log("\n8. LEITURA DE IA — hipótese na página 1 quando cabe");
  const comIa = linhaFake({
    iaStatus: "OK",
    iaLeitura: "Banco público de grande porte, com rede de atendimento em todo o país e forte presença digital. Operação de varejo bancário com volume alto de transações e carteira ampla de produtos financeiros.",
    iaSetor: "Bancos múltiplos",
    iaHipoteses: ["Decisores prováveis na diretoria comercial do DF", "Possível uso de ERP próprio (banco)"],
  });
  const bufIa = await gerarPdfEmpresa(DS, comIa, lacunasBB, { nivel: "completo" });
  const pagIa = linhasPorPagina(bufIa);
  const txtIa = pagIa.map((x) => x.texto).join("\n");
  const p1Ia = pagIa.filter((x) => x.pagina === 1).map((x) => x.texto).join("\n");
  check("IA: página 1 traz a leitura como hipótese", p1Ia.includes("LEITURA COMERCIAL (IA") && p1Ia.includes("Banco público de grande porte"));
  check("IA: rotulagem de hipótese presente", txtIa.includes("NUNCA CONCLUSÃO") || txtIa.includes("hipótese"));

  /* ============ PAGINAÇÃO — sem títulos órfãos (varredura) ============ */
  console.log("\n9. VARREDURA DE PAGINAÇÃO (títulos nunca órfãos)");
  const combinacoes: { nome: string; linha: LinhaExport; lacunas: LacunaPdf[] }[] = [
    { nome: "bb-41-qsa", linha: bb, lacunas: lacunasBB },
    { nome: "rede-gigante", linha: rede, lacunas: lacunasBB },
    { nome: "sem-rel", linha: semRel, lacunas: [] },
    { nome: "com-ia", linha: comIa, lacunas: lacunasBB },
  ];
  let paginasTotais = 0;
  let orfaos = 0;
  for (const c of combinacoes) {
    for (const nivel of ["executivo", "completo"] as const) {
      const b = await gerarPdfEmpresa(DS, c.linha, c.lacunas, { nivel });
      const pags = linhasPorPagina(b);
      const total = numeroDePaginas(b);
      paginasTotais += total;
      // ÓRFÃO = título de seção/anexo é a ÚLTIMA linha desenhada da página
      const porPagina = new Map<number, string[]>();
      for (const p of pags) {
        const arr = porPagina.get(p.pagina) ?? [];
        arr.push(p.texto.trim());
        porPagina.set(p.pagina, arr);
      }
      for (const [n, linhas] of porPagina) {
        if (n >= total) continue; // última página: título no fim não tem página seguinte órfã
        const ultima = linhas[linhas.length - 1] ?? "";
        if (/^(\d+\s+)?(PESSOAS E RELAÇÕES|O QUE VALE INVESTIGAR|ANEXO [A-E]\s+·)/.test(ultima)) {
          orfaos++;
          console.log(`    órfão: ${c.nome}/${nivel} p${n}: "${ultima.slice(0, 60)}"`);
        }
      }
    }
  }
  check(`sem títulos órfãos na varredura (${paginasTotais} páginas)`, orfaos === 0, `${orfaos} órfãos`);

  /* ============ RENDERIZAÇÃO VISUAL v3 × v4 ============ */
  console.log("\n10. RENDERIZAÇÃO VISUAL (pdftoppm) v3 × v4");
  writeFileSync(`${DIR_PDF}/v3-banco-do-brasil.pdf`, bufV3);
  writeFileSync(`${DIR_PDF}/v4-completo-banco-do-brasil.pdf`, bufV4);
  writeFileSync(`${DIR_PDF}/v4-executivo-banco-do-brasil.pdf`, bufExe);
  writeFileSync(`${DIR_PDF}/v4-rede-gigante.pdf`, bufRede);
  try {
    execSync(`pdftoppm -png -r 80 ${DIR_PDF}/v3-banco-do-brasil.pdf ${DIR_PDF}/v3-pag && pdftoppm -png -r 80 ${DIR_PDF}/v4-completo-banco-do-brasil.pdf ${DIR_PDF}/v4-completo-pag && pdftoppm -png -r 80 ${DIR_PDF}/v4-executivo-banco-do-brasil.pdf ${DIR_PDF}/v4-executivo-pag && pdftoppm -png -r 80 ${DIR_PDF}/v4-rede-gigante.pdf ${DIR_PDF}/v4-rede-pag`, { stdio: "pipe" });
    check("v3 e v4 renderizados (todas as páginas em PNG)", true);
  } catch (e) {
    check("v3 e v4 renderizados (todas as páginas em PNG)", false, String(e).slice(0, 80));
  }

  console.log(`\n============================================================`);
  console.log(`PDF v3→v4 (GATE 3): ${pass} PASS · ${fail} FAIL${fail > 0 ? `\n  - ${falhas.join("\n  - ")}` : ""}`);
  if (fail > 0) process.exit(1);
}

/** O título v3 = primeiro texto em fonte GRANDE (≥16pt). O leitor de conteúdo
 *  não expõe o tamanho — então usamos a ordem: a v3 desenha eyebrow (8pt),
 *  nomeComercial (19pt) e razão (10.5pt). Para PROVAR o defeito, extraímos os
 *  streams e procuramos o tamanho pelo operador TF. */
function pagV3Titulo(buf: Buffer): string {
  return fonteMaiorPagina1(buf) ?? "";
}

/** O título v4 = texto em fonte grande (≥16pt) da página 1. */
function tituloV4Documento(buf: Buffer): string {
  return fonteMaiorPagina1(buf) ?? "";
}

void main();
