/**
 * verificar-orfaos-varredura.ts — invariante de paginação do PDF em varredura
 * de variações de conteúdo.
 *
 * O invariante: NENHUM título de seção/anexo pode ficar sem conteúdo abaixo
 * dele na mesma página (título órfão), e a última página não pode ser quase
 * vazia. A varredura varia o número de atividades secundárias, lacunas e
 * participantes — cada combinação muda os pontos de quebra de página, cobrindo
 * as posições onde a v0.10.17 deixava títulos órfãos (provado nos anexos C
 * dos casos Brasil Digital e Yorozu reais).
 *
 * Uso: bun scripts/verificar-orfaos-varredura.ts
 */
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
    entradasRecebidas: 1,
    linhasProcessadas: 1,
    aguardandoExecucao: 0,
    pjsLocalizadas: 1,
    pjsIdentificadas: 1,
    emRevisao: 0,
    validadas: 1,
    naoIdentificadas: 0,
    falhas: 0,
    situacaoDist: [{ key: "ATIVA", count: 1 }],
    ufDist: [{ key: "SP", count: 1 }],
    cnaeDist: [{ key: "J — Informação e comunicação", count: 1 }],
  };
}

function linhaBase(over: Partial<LinhaExport>): LinhaExport {
  return {
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
    regimeTributario: "LUCRO REAL (exercício 2024)",
    telefones: ["(11) 4002-8922"],
    email: "contato@brddigital.com.br",
    endereco: "Av. Paulista, 1000 — São Paulo/SP",
    telefonesCrus: ["000000000000"],
    temContatoUtil: true,
    representantes: [
      { cnpjConta: "12.345.678/0001-95", razaoSocialConta: "BRASIL DIGITAL TELECOM LTDA", nome: "MARIA DA SILVA", qualificacao: "Sócio-Administrador", tipoVinculo: "Sócio/administração (quadro público)", tipoParticipante: "", dataEntrada: "2020-01-01", fonte: "BrasilAPI", dataConsulta: "2026-02-10T12:00:00Z", decisor: true, empresaParticipada: "" },
    ],
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
    ...over,
  };
}

const RE_ANEXO = /^ANEXO\s+([A-Z])\s+·\s+/i;
function ehConteudo(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  if (/^Página\s+\d+\s+de\s+\d+/.test(s)) return false;
  if (s === "Scout 360 · Senior") return false;
  if (s.startsWith("Documento gerado em")) return false;
  if (s === "SCOUT 360" || s.includes("Senior — inteligência comercial")) return false;
  return true;
}

export interface ResultadoSweep {
  combinacoes: number;
  paginasTotal: number;
  orfaos: string[];
  paginasQuaseVazias: string[];
}

/** Roda a varredura e devolve violações (vazio = invariante satisfeito). */
export async function varrerOrfaos(): Promise<ResultadoSweep> {
  const orfaos: string[] = [];
  const paginasQuaseVazias: string[] = [];
  let combinacoes = 0;
  let paginasTotal = 0;

  // varre: nº de atividades secundárias × nº de lacunas × nº de participantes no quadro
  for (const nCnaes of [0, 5, 11, 14, 16, 17, 20, 24]) {
    for (const nLacunas of [0, 2, 4, 6]) {
      for (const nQuadro of [0, 3, 6, 9, 12]) {
        const cnaes = Array.from({ length: nCnaes }, (_, i) => `Outra atividade registrada número ${i + 1} do cadastro`);
        const empresasQuadro = Array.from({ length: nQuadro }, (_, i) => ({
          cnpjFormatado: cnpjValido(`2000000${i % 10}`).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5").replace(/\/0001-/, `/000${(i % 4) + 1}-`),
          razaoSocial: `HOLDING PARCEIRA ${(i % 9) + 1} LTDA`,
          raiz: `2000000${i % 10}`,
        }));
        const lacunas: LacunaPdf[] = Array.from({ length: nLacunas }, (_, i) => ({
          pergunta: `Pergunta comercial de investigação número ${i + 1} sobre a operação desta empresa`,
          estado: i % 2 === 0 ? "VALIDACAO_HUMANA" : "COMPLEMENTAR_API",
          falta: `Informação que falta de número ${i + 1}.`,
          proximaVerificacao: "Confirme essa informação com a empresa.",
        }));
        const linha = linhaBase({
          cnaesSecundarios: cnaes,
          relacoesConsultadas: nQuadro > 0 ? {
            coletadoEm: "2026-02-10T12:10:00Z",
            validoAte: "2026-03-12T12:10:00Z",
            participantes: [
              { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", cnpjFormatado: null, quadro: { participanteId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", nome: "MARIA DA SILVA", tipo: "PF", totalEmpresas: empresasQuadro.length, totalPessoasJuridicas: Math.max(1, Math.ceil(empresasQuadro.length / 4)), empresas: empresasQuadro, coletadoEm: "2026-02-10T12:15:00Z", validoAte: "2026-03-12T12:15:00Z", truncado: false } },
            ],
          } : null,
        });
        const ds: DatasetExport = { lote: resumoFake(), linhas: [linha], totalLinhasLote: 1, escopo: "TODAS" };
        const buf = await gerarPdfEmpresa(ds, linha, lacunas);
        combinacoes += 1;
        const linhasPdf = linhasPorPagina(buf);
        const total = numeroDePaginas(buf);
        paginasTotal += total;
        const porPag: Record<number, typeof linhasPdf> = {};
        for (const l of linhasPdf) (porPag[l.pagina] ??= []).push(l);
        for (let p = 1; p <= total; p++) {
          const da = (porPag[p] ?? []).filter((l) => l.y > 60 && ehConteudo(l.texto));
          for (let i = 0; i < da.length; i++) {
            const l = da[i];
            const tituloAnexo = RE_ANEXO.test(l.texto.trim());
            if (!tituloAnexo) continue;
            const abaixo = da.slice(i + 1).filter((x) => x.y < l.y);
            if (abaixo.length === 0) orfaos.push(`cnaes=${nCnaes} lacunas=${nLacunas} quadro=${nQuadro} p${p}: "${l.texto.trim()}"`);
          }
          // última página não pode ser quase vazia (menos de 4 linhas de conteúdo)
          if (p === total && da.length > 0 && da.length < 4) {
            paginasQuaseVazias.push(`cnaes=${nCnaes} lacunas=${nLacunas} quadro=${nQuadro}: última página p${p} tem ${da.length} linha(s)`);
          }
        }
      }
    }
  }
  return { combinacoes, paginasTotal, orfaos, paginasQuaseVazias };
}

if (import.meta.main) {
  const r = await varrerOrfaos();
  console.log(`Combinações: ${r.combinacoes} · páginas geradas: ${r.paginasTotal}`);
  console.log(`Títulos órfãos: ${r.orfaos.length}`);
  for (const o of r.orfaos.slice(0, 10)) console.log("  ❌", o);
  console.log(`Últimas páginas quase vazias: ${r.paginasQuaseVazias.length}`);
  for (const q of r.paginasQuaseVazias.slice(0, 10)) console.log("  ❌", q);
  const ok = r.orfaos.length === 0 && r.paginasQuaseVazias.length === 0;
  console.log(ok ? "✅ INVARIANTE SÓLIDO em toda a varredura" : "❌ INVARIANTE VIOLADO");
  process.exit(ok ? 0 : 1);
}
