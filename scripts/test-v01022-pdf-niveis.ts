/**
 * test-v01022-pdf-niveis.ts — Entrega 4: PDF executivo e PDF completo a partir
 * dos MESMOS dados (mesmo motor, dois cortes).
 *
 * Provas:
 *  1. Executivo: NENHUM anexo no arquivo (sem "ANEXO"), referências apontam
 *     para "PDF completo" (nunca um anexo que não está no arquivo), mantém
 *     abertura, seções 1–3, perguntas e bloco de fontes.
 *  2. Completo: anexos presentes, reconciliação preservada (empresas ×
 *     estabelecimentos), provedor fora do corpo.
 *  3. Invariante de paginação nos DOIS níveis (varredura reutilizada).
 *  4. Factual idêntico entre os níveis: mesmo CNPJ, mesma razão social, mesma
 *     atividade, mesmo bloco de fontes.
 *  5. Renderização visual de todas as páginas (pdftoppm) — arquivos gerados
 *     para conferência em evidencias/.
 *
 * Rodar: bun scripts/test-v01022-pdf-niveis.ts   (sem rede, sem banco)
 */
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
// v0.11.1 (Gate 3): gerarPdfEmpresa agora é o modelo v4 — este teste continua
// validando o MOTOR v3 (legado preservado para comparação).
import { gerarPdfEmpresaV3 as gerarPdfEmpresa, type LacunaPdf } from "../src/lib/export/pdf";
import type { DatasetExport, LinhaExport, ResumoLoteExport } from "../src/lib/export/dataset";
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
    id: "lote-teste-000", arquivo: "lote-demo.csv", status: "DONE", origem: "arquivo CSV",
    criadoEm: new Date("2026-02-10T12:00:00Z"), finalizadoEm: new Date("2026-02-10T12:30:00Z"),
    entradasRecebidas: 1, linhasProcessadas: 1, aguardandoExecucao: 0, pjsLocalizadas: 1,
    pjsIdentificadas: 1, emRevisao: 0, validadas: 1, naoIdentificadas: 0, falhas: 0,
    situacaoDist: [{ key: "ATIVA", count: 1 }], ufDist: [{ key: "SP", count: 1 }],
    cnaeDist: [{ key: "J — Informação e comunicação", count: 1 }],
  };
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

const DS: DatasetExport = { lote: resumoFake(), linhas: [], totalLinhasLote: 1, escopo: "TODAS" };

async function main(): Promise<void> {
  /* fixture densa — Brasil Digital com 17 atividades + relações com quadro */
  const cnaes = Array.from({ length: 17 }, (_, i) => `Outra atividade registrada número ${i + 1} do cadastro`);
  const empresas18 = Array.from({ length: 18 }, (_, i) => ({
    cnpjFormatado: cnpjValido(`2000000${i % 10}`).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5").replace(/\/0001-/, `/000${(i % 4) + 1}-`),
    razaoSocial: `HOLDING PARCEIRA ${(i % 5) + 1} LTDA`,
    raiz: `2000000${i % 10}`,
  }));
  const linha = linhaFake({
    cnaesSecundarios: cnaes,
    relacoesConsultadas: {
      coletadoEm: "2026-02-10T12:10:00Z", validoAte: "2026-03-12T12:10:00Z",
      participantes: [
        { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", cnpjFormatado: null, quadro: { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", totalEmpresas: 18, totalPessoasJuridicas: 5, empresas: empresas18, coletadoEm: "2026-02-10T12:15:00Z", validoAte: "2026-03-12T12:15:00Z", truncado: false } },
        { participanteId: "0000000000019X", nome: "BRD DIGITAL PARTICIPAÇÕES LTDA", tipo: "INDETERMINADO", cnpjFormatado: null, quadro: null },
      ],
    },
  });
  DS.linhas = [linha];
  const lacunas: LacunaPdf[] = [
    { pergunta: "Quem decide a compra?", estado: "VALIDACAO_HUMANA", falta: "Contato de quem participa da decisão.", proximaVerificacao: "Pergunte ao cliente ou pesquise a rede profissional dela." },
    { pergunta: "Há outras empresas ligadas aos sócios?", estado: "COMPLEMENTAR_API", falta: "Quadros restantes dos participantes.", proximaVerificacao: "Amplie as conexões na ficha." },
    { pergunta: "Qual é o volume aproximado de compras?", estado: "VALIDACAO_HUMANA", falta: "Estimativa de faturamento.", proximaVerificacao: "Confirme essa informação com a empresa." },
  ];

  console.log("\n1. PDF EXECUTIVO — seções comerciais, SEM anexos");
  const bufExe = await gerarPdfEmpresa(DS, linha, lacunas, { nivel: "executivo" });
  const linhasExe = linhasPorPagina(bufExe);
  const textoExe = linhasExe.map((l) => l.texto).join("\n");
  const pagExe = numeroDePaginas(bufExe);
  check("executivo: sem NENHUM anexo", !textoExe.includes("ANEXO"), `${pagExe} páginas`);
  check("executivo: referência de detalhe aponta para o PDF completo", textoExe.includes("PDF completo") && !/Anexo\s+[A-E]/.test(textoExe));
  check("executivo: abertura completa", textoExe.includes("DOSSIÊ COMERCIAL DA EMPRESA") && textoExe.includes("BRASIL DIGITAL TELECOM LTDA") && textoExe.includes("12.345.678/0001-95"));
  check("executivo: atividade + regime com exercício", textoExe.includes("Atividade cadastrada") && textoExe.includes("exercício 2024"));
  check("executivo: representantes registrados", textoExe.includes("Representantes registrados") && textoExe.includes("MARIA DA SILVA"));
  check("executivo: relações com empresa × estabelecimento", textoExe.includes("5 empresas") && textoExe.includes("18 estabelecimentos"));
  check("executivo: até 4 perguntas com ação", textoExe.includes("Quem decide a compra?") && textoExe.includes("Confirme essa informação com a empresa."));
  check("executivo: bloco de fontes discreto", textoExe.includes("Este documento não reconsultou fontes"));
  check("executivo: 1–2 páginas", pagExe <= 2, `${pagExe} páginas`);
  check("executivo: provedor fora do corpo", !textoExe.includes("BrasilAPI"));

  console.log("\n2. PDF COMPLETO — dossiê com anexos (mesmos dados)");
  const bufCom = await gerarPdfEmpresa(DS, linha, lacunas, { nivel: "completo" });
  const linhasCom = linhasPorPagina(bufCom);
  const textoCom = linhasCom.map((l) => l.texto).join("\n");
  const pagCom = numeroDePaginas(bufCom);
  check("completo: anexos presentes (A atividades, C relações)", textoCom.includes("ANEXO A") && textoCom.includes("ANEXO C"));
  check("completo: 17 atividades listadas no anexo A", textoCom.includes("Outra atividade registrada número 17"));
  check("completo: quadro reconciliado (5 empresas × 18 estabelecimentos)", textoCom.includes("5 empresas") && textoCom.includes("18 estabelecimentos"));
  check("completo: mais páginas que o executivo (detalhamento preservado)", pagCom > pagExe, `completo=${pagCom} · executivo=${pagExe}`);

  console.log("\n3. FATOS IDÊNTICOS entre os níveis (reconciliação)");
  const fatos = ["BRASIL DIGITAL TELECOM LTDA", "12.345.678/0001-95", "Telecomunicações por fio", "São Paulo/SP", "Este documento não reconsultou fontes"];
  for (const f of fatos) check(`presente nos dois: "${f}"`, textoExe.includes(f) && textoCom.includes(f));

  console.log("\n4. INVARIANTE DE PAGINAÇÃO nos dois níveis");
  const r = await varrerOrfaos();
  console.log(`        (${r.combinacoes} combinações, ${r.paginasTotal} páginas)`);
  check("sem títulos órfãos em toda a varredura", r.orfaos.length === 0, r.orfaos.slice(0, 2).join(" | "));
  check("sem páginas finais quase vazias", r.paginasQuaseVazias.length === 0, r.paginasQuaseVazias.slice(0, 2).join(" | "));

  console.log("\n5. RENDERIZAÇÃO VISUAL (pdftoppm) para conferência");
  try {
    const dir = "evidencias/round-v0.10.22";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/executivo-brasil-digital.pdf`, bufExe);
    writeFileSync(`${dir}/completo-brasil-digital.pdf`, bufCom);
    execSync(`pdftoppm -png -r 70 ${dir}/executivo-brasil-digital.pdf ${dir}/executivo-pag && pdftoppm -png -r 70 ${dir}/completo-brasil-digital.pdf ${dir}/completo-pag`, { timeout: 60000 });
    const renderizados = execSync(`ls ${dir} | grep -c "pag"`, { encoding: "utf8" }).trim();
    check(`todas as páginas renderizadas (${renderizados} PNG)`, Number(renderizados) >= pagExe + pagCom);
  } catch (e) {
    check("renderização pdftoppm disponível", false, String(e).slice(0, 80));
  }

  console.log(`\n${"=".repeat(60)}\nPDF NÍVEIS: ${pass} PASS · ${fail} FAIL`);
  if (fail > 0) {
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
