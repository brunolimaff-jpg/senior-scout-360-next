/**
 * export/excel.ts — EXPORTAÇÃO EXCEL (.xlsx) COMERCIAL (v0.10.15).
 *
 * Formato principal da exportação. Estrutura:
 *   Aba 1 Resumo — lote, coleta, contagens oficiais (mesma regra da interface), notas curtas.
 *   Aba 2 Empresas — uma linha por entrada, chave estável (linha + CNPJ raiz).
 *   Aba 3 Revisões — somente as que exigem conferência, com próxima ação recomendada.
 *   Aba 4 Representantes e relações — uma linha por vínculo registrado (QSA + grafo em cache).
 *   Aba 5 Evidências — fontes, URLs quando existentes, datas, propriedades comprovadas.
 *   Aba 6 Lacunas e consultas — TRIAGEM_V1 + PLANO_CONSULTAS_V1 (candidata ≠ executada).
 *
 * Abas sem dados NÃO são geradas (nada fictício preenchendo vazio).
 *
 * Qualidade obrigatória:
 * - Cabeçalho legível com congelamento e autofiltro nas abas de dados.
 * - Larguras proporcionais e quebra de texto onde necessário.
 * - CNPJ/telefone/identificadores como TEXTO (numFmt @) — zeros preservados.
 * - Datas como Date e capital social como número com formato R$ quando parseáveis.
 * - Nenhuma fórmula originada de conteúdo: string iniciada por = + - @ entra como
 *   richText (nunca vira fórmula) e nunca é interpretada.
 * - Nada é cortado em silêncio: QSA completo, divergências completas; textos além do
 *   teto físico do Excel (32.767) são truncados COM aviso explícito na célula.
 * - Respeita o escopo escolhido (todas / sem revisão / em revisão / selecionadas).
 */
import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";
import { formatCnpj } from "@/lib/cnpj";
import { categoriaDeFonte } from "@/lib/fontes-apresentacao";
import { plural } from "@/lib/linguagem";
import type { DatasetExport, LinhaExport } from "./dataset";
import { dataCadastro } from "./dataset";
import { ESCOPO_LABEL } from "./escopo";

const TETO_CELULA = 32767;

/** Corta texto acima do teto físico do Excel — SEMPRE com aviso explícito. */
function celulaTexto(valor: string | null | undefined): string {
  const s = (valor ?? "").toString();
  if (s.length <= TETO_CELULA - 120) return s;
  return `${s.slice(0, TETO_CELULA - 120)}… [TEXTO TRUNCADO para caber no Excel (32.767 caracteres); conteúdo completo nos formatos JSON e CSV do lote]`;
}

type ValorCelula = string | number | Date | null | { richText: { text: string }[] };

/**
 * Guarda anti-fórmula (v0.10.15): exceljs transforma string iniciada por "=" em fórmula
 * AO ESCREVER. Todo texto da linha que começa com = + - @ tab ou CR entra como richText
 * (string pura) — Excel nunca interpreta conteúdo como código.
 */
function linhaSegura(valores: (string | number | Date | null)[]): ValorCelula[] {
  return valores.map((v) => {
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return { richText: [{ text: v }] };
    return v;
  });
}

const CABECALHO_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0B2545" }, // azul Senior
};
const CABECALHO_FONT = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };

/** Cabeçalho legível + congelamento + autofiltro + larguras + formatos por coluna. */
function prepararAbaDados(
  ws: Worksheet,
  colunas: { titulo: string; largura: number; quebra?: boolean }[],
  numFmtPorColuna?: Record<number, string>
): void {
  const header = ws.getRow(1);
  header.values = colunas.map((c) => c.titulo);
  header.height = 22;
  header.eachCell((cell) => {
    cell.fill = CABECALHO_FILL;
    cell.font = CABECALHO_FONT;
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
    cell.border = { bottom: { style: "thin", color: { argb: "FF086B6B" } } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  colunas.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.largura;
    if (c.quebra) ws.getColumn(i + 1).alignment = { wrapText: true, vertical: "top" };
    const fmt = numFmtPorColuna?.[i + 1];
    if (fmt) ws.getColumn(i + 1).numFmt = fmt;
  });
}

function tituloAba(ws: Worksheet, titulo: string, nota: string): void {
  const r = ws.addRow([titulo, nota]);
  r.font = { bold: true, size: 12, color: { argb: "FF0B2545" } };
}

function dataBR(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleString("pt-BR", { timeZone: "America/Cuiaba" });
}

/* ============================== Aba 1: Resumo ============================== */

function abaResumo(wb: ExcelJS.Workbook, ds: DatasetExport): void {
  const ws = wb.addWorksheet("Resumo", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 72;
  const lote = ds.lote;

  tituloAba(ws, `Scout 360 — Resumo do lote`, "Senior — inteligência comercial");
  ws.addRow([]);
  ws.addRow(["Lote", lote.arquivo]);
  ws.addRow(["Identificação do lote", lote.id]);
  ws.addRow(["Origem", lote.origem]);
  ws.addRow(["Data da coleta", lote.finalizadoEm ? dataBR(lote.finalizadoEm) : "Coleta em andamento"]);
  ws.addRow(["Gerado em", dataBR(new Date())]);
  ws.addRow(["Escopo exportado", ESCOPO_LABEL[ds.escopo]]);
  ws.addRow(["Linhas neste arquivo", plural(ds.linhas.length, "entrada", "entradas") + (ds.linhas.length !== ds.totalLinhasLote ? ` (de ${ds.totalLinhasLote} do lote)` : "")]);
  ws.addRow([]);

  ws.addRow(["CONTAGENS DO LOTE", ""]).font = { bold: true, color: { argb: "FF0B2545" } };
  ws.addRow(["Entradas recebidas", lote.entradasRecebidas]);
  ws.addRow(["Linhas processadas", lote.linhasProcessadas]);
  ws.addRow(["Consultas na fila", lote.aguardandoExecucao]);
  ws.addRow(["Empresas localizadas (raízes distintas)", lote.pjsLocalizadas]);
  ws.addRow(["Pessoas jurídicas compatíveis com as pistas", lote.pjsIdentificadas]);
  ws.addRow(["Linhas aguardando revisão humana", lote.emRevisao]);
  ws.addRow(["Identidades validadas pelo operador", lote.validadas]);
  ws.addRow(["Entradas não localizadas", lote.naoIdentificadas]);
  ws.addRow(["Entradas com falha de consulta", lote.falhas]);
  ws.addRow([]);
  ws.addRow([
    "Nota de contagem",
    "Pessoas jurídicas contam RAÍSES distintas (matriz e filiais da mesma raiz são UMA empresa). Linhas contam entradas do arquivo. CNPJ localizado não é confirmação humana: revisão permanece explícita.",
  ]);
  ws.addRow([]);

  ws.addRow(["SITUAÇÃO CADASTRAL", ""]).font = { bold: true, color: { argb: "FF0B2545" } };
  if (lote.situacaoDist.length === 0) ws.addRow(["Sem informação coletada", ""]);
  for (const s of lote.situacaoDist) ws.addRow([s.key, s.count]);
  ws.addRow([]);
  ws.addRow(["LOCALIZAÇÃO (UF)", ""]).font = { bold: true, color: { argb: "FF0B2545" } };
  if (lote.ufDist.length === 0) ws.addRow(["Sem informação coletada", ""]);
  for (const s of lote.ufDist) ws.addRow([s.key, s.count]);
  ws.addRow([]);
  ws.addRow(["OBSERVAÇÕES METODOLÓGICAS", ""]).font = { bold: true, color: { argb: "FF0B2545" } };
  const notas = [
    "Dados coletados em fontes públicas oficiais no momento indicado; nada foi reconsultado nesta exportação.",
    "Leitura comercial marcada como IA é hipótese a validar — nunca fato comprovado.",
    "Telefones e e-mails listados passaram por validação de utilização; valores inválidos do cadastro ficam na evidência técnica.",
    "Relações societárias comprovam vínculos registrados, não grupo econômico.",
  ];
  for (const n of notas) {
    const r = ws.addRow([n, ""]);
    ws.mergeCells(`A${r.number}:B${r.number}`);
    r.getCell(1).alignment = { wrapText: true, vertical: "top" };
  }
  ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
}

/* ============================ Aba 2: Empresas ============================= */

const COL_EMPRESAS = [
  { titulo: "Linha", largura: 7 },
  { titulo: "Chave estável", largura: 26 },
  { titulo: "CNPJ", largura: 20 },
  { titulo: "Razão social", largura: 42, quebra: true },
  { titulo: "Nome fantasia", largura: 26, quebra: true },
  { titulo: "Matriz ou filial", largura: 14 },
  { titulo: "CNPJ da matriz", largura: 20 },
  { titulo: "Município", largura: 20 },
  { titulo: "UF", largura: 6 },
  { titulo: "Situação cadastral", largura: 16 },
  { titulo: "Data da situação", largura: 14 },
  { titulo: "Atividade (CNAE)", largura: 42, quebra: true },
  { titulo: "Porte", largura: 18 },
  { titulo: "Capital social (R$)", largura: 18 },
  { titulo: "Telefones válidos", largura: 22 },
  { titulo: "E-mail público", largura: 28 },
  { titulo: "Status da identidade", largura: 18 },
  { titulo: "Validada por você", largura: 14 },
  { titulo: "Divergências", largura: 48, quebra: true },
  { titulo: "Leitura comercial (IA)", largura: 60, quebra: true },
  { titulo: "Fonte", largura: 20 },
  { titulo: "Data da consulta", largura: 20 },
  { titulo: "Pista original", largura: 34, quebra: true },
];

function chaveEstavel(l: LinhaExport): string {
  const raiz = l.cnpjRaiz || l.cnpjNormalizado || `ref-${l.referencia || l.rowNumber}`;
  return `L${l.rowNumber}/${raiz}`;
}

function abaEmpresas(wb: ExcelJS.Workbook, ds: DatasetExport): void {
  const ws = wb.addWorksheet("Empresas");
  // CNPJ/chave/telefone como TEXTO (numFmt @) — zeros à esquerda preservados
  prepararAbaDados(ws, COL_EMPRESAS, { 2: "@", 3: "@", 7: "@", 15: "@" });
  for (const l of ds.linhas) {
    const row = ws.addRow(linhaSegura([
      l.rowNumber,
      chaveEstavel(l),
      l.cnpjFormatado || "",
      celulaTexto(l.razaoSocial),
      celulaTexto(l.nomeFantasia),
      l.matrizFilial,
      l.cnpjMatrizFormatado,
      l.municipio,
      l.uf,
      l.situacao,
      null, // data da situação — tipada abaixo
      celulaTexto(l.cnaeDescricao),
      l.porte,
      null, // capital social — tipado abaixo
      l.telefones.join(" · "),
      l.email,
      // v0.11.0 (Gate 9/F2): ENRIQUECIDO exige FICHA coletada (razão social ou
      // fantasia) — o cnpjFormatado sozinho não prova nada (linhas NAO_ENCONTRADO
      // carregam o CNPJ PESQUISADO e apareciam rotuladas como enriquecidas, com a
      // razão social vazia). Sem ficha não há estágio de identidade: rótulo vazio.
      l.etapaIdentidade || (l.cnpjFormatado && (l.razaoSocial || l.nomeFantasia) ? "ENRIQUECIDO" : ""),
      l.validadaPorOperador ? "SIM" : "",
      celulaTexto(l.divergencias.map((d) => `${d.tipo} (${d.severidade}): ${d.descricao}`).join("\n")),
      l.iaLeitura ? celulaTexto(`(IA — hipótese) ${l.iaLeitura}`) : "",
      categoriaDeFonte(l.fonte),
      null, // data da consulta — tipada abaixo
      celulaTexto(l.entrada),
    ]));
    // tipagem honesta: datas parseáveis viram Date; capital social vira número R$
    const dataSit = dataCadastro(l.dataSituacao);
    if (dataSit) {
      row.getCell(11).value = dataSit;
      row.getCell(11).numFmt = "dd/mm/yyyy";
    } else if (l.dataSituacao) {
      row.getCell(11).value = celulaTexto(l.dataSituacao);
      row.getCell(11).numFmt = "@";
    }
    if (l.capitalSocialNumero != null) {
      row.getCell(14).value = l.capitalSocialNumero;
      row.getCell(14).numFmt = '"R$" #,##0.00';
    } else if (l.capitalSocialTexto) {
      row.getCell(14).value = celulaTexto(l.capitalSocialTexto);
      row.getCell(14).numFmt = "@";
    }
    const dataCons = l.dataConsulta;
    if (dataCons) {
      row.getCell(22).value = dataCons;
      row.getCell(22).numFmt = "dd/mm/yyyy hh:mm";
    }
    row.alignment = { vertical: "top", wrapText: false };
  }
}

/* ============================ Aba 3: Revisões ============================= */

/** Próxima ação recomendada pela MESMA lógica da tabela (senior.tsx). */
function proximaAcaoRevisao(l: LinhaExport): string {
  if (l.estadoResolucao === "REVIEW") return "Abrir a ficha e escolher o candidato correto (ou corrigir o CNPJ).";
  if (l.etapaIdentidade === "LOCALIZADO" && l.divergencias.length > 0)
    return "Conferir as divergências na ficha e validar se é esta empresa (É esta empresa) ou corrigir.";
  if (l.etapaIdentidade === "LOCALIZADO") return "Conferir o cadastro encontrado e validar a identidade na ficha.";
  return "Revisar a identidade na ficha.";
}

function abaRevisoes(wb: ExcelJS.Workbook, ds: DatasetExport): void {
  const emRevisao = ds.linhas.filter((l) => l.emRevisao);
  if (emRevisao.length === 0) return; // sem revisões: aba não existe (nada fictício)
  const ws = wb.addWorksheet("Revisões");
  prepararAbaDados(ws, [
    { titulo: "Linha", largura: 7 },
    { titulo: "Empresa", largura: 42, quebra: true },
    { titulo: "CNPJ localizado", largura: 20 },
    { titulo: "Pista original", largura: 34, quebra: true },
    { titulo: "Cadastro encontrado", largura: 48, quebra: true },
    { titulo: "Motivo da divergência", largura: 52, quebra: true },
    { titulo: "Situação atual", largura: 18 },
    { titulo: "Próxima ação recomendada", largura: 52, quebra: true },
  ], { 3: "@" });
  for (const l of emRevisao) {
    const cadastro = [
      l.razaoSocial,
      l.nomeFantasia && l.nomeFantasia !== l.razaoSocial ? `(${l.nomeFantasia})` : "",
      l.municipio || l.uf ? `${l.municipio ?? ""}${l.uf ? `/${l.uf}` : ""}` : "",
    ].filter(Boolean).join(" · ");
    ws.addRow(linhaSegura([
      l.rowNumber,
      celulaTexto(l.razaoSocial || l.nomeFantasia || l.entrada),
      l.cnpjFormatado,
      celulaTexto(l.entrada),
      celulaTexto(cadastro),
      celulaTexto(l.divergencias.map((d) => `${d.tipo} (${d.severidade}): ${d.descricao}`).join("\n") || l.motivoSituacao || "Divergência entre a pista e o registro localizado."),
      l.situacao,
      proximaAcaoRevisao(l),
    ]));
  }
}

/* ================== Aba 4: Representantes e relações ====================== */

function abaRepresentantes(wb: ExcelJS.Workbook, ds: DatasetExport): void {
  const ws = wb.addWorksheet("Representantes e relações");
  prepararAbaDados(ws, [
    { titulo: "Linha da empresa", largura: 14 },
    { titulo: "Empresa (CNPJ)", largura: 20 },
    { titulo: "Razão social", largura: 42, quebra: true },
    { titulo: "Nome do vínculo", largura: 42, quebra: true },
    { titulo: "Qualificação", largura: 32, quebra: true },
    { titulo: "Tipo de vínculo", largura: 46, quebra: true },
    { titulo: "Tipo do participante", largura: 24 },
    { titulo: "Data de entrada", largura: 14 },
    { titulo: "Fonte", largura: 22 },
    { titulo: "Data da consulta", largura: 20 },
  ]);
  let total = 0;
  for (const l of ds.linhas) {
    for (const rep of l.representantes) {
      total++;
      const dataEntrada = dataCadastro(rep.dataEntrada);
      const tipoVinculo = rep.empresaParticipada
        ? `${rep.tipoVinculo} — participa de ${rep.empresaParticipada}`
        : rep.tipoVinculo;
      // v0.10.16: classificação do participante em palavras — mesma leitura da interface
      const tipoLegivel =
        rep.tipoParticipante === "PF"
          ? "Pessoa física"
          : rep.tipoParticipante === "PJ"
            ? "Pessoa jurídica"
            : rep.tipoParticipante === "INDETERMINADO"
              ? "Não confirmado pela fonte"
              : "";
      const row = ws.addRow(linhaSegura([
        l.rowNumber,
        rep.cnpjConta,
        celulaTexto(rep.razaoSocialConta),
        celulaTexto(rep.nome),
        celulaTexto(rep.qualificacao),
        tipoVinculo,
        tipoLegivel,
        null,
        rep.fonte,
        rep.dataConsulta ? new Date(rep.dataConsulta) : "",
      ]));
      if (dataEntrada) {
        row.getCell(8).value = dataEntrada;
        row.getCell(8).numFmt = "dd/mm/yyyy";
      } else if (rep.dataEntrada) {
        row.getCell(8).value = celulaTexto(rep.dataEntrada);
        row.getCell(8).numFmt = "@";
      }
      if (rep.dataConsulta) {
        row.getCell(10).numFmt = "dd/mm/yyyy hh:mm";
      } else {
        row.getCell(10).value = "";
      }
    }
  }
  if (total === 0) {
    // vínculos registrados é a PROMESSA da aba — sem nenhum, a aba não existe
    // (exceljs: remover pelo ID interno, 1-based — o getter worksheets é 0-based)
    const wsRep = wb.getWorksheet("Representantes e relações");
    if (wsRep) wb.removeWorksheet(wsRep.id);
  }
}

/* ============================ Aba 5: Evidências =========================== */

interface EvidenciaLinha {
  linha: number;
  empresa: string;
  propriedade: string;
  valor: string;
  fonte: string;
  url: string;
  data: string;
  observacao: string;
}

function evidenciasDaLinha(l: LinhaExport): EvidenciaLinha[] {
  const ev: EvidenciaLinha[] = [];
  const empresa = l.razaoSocial || l.cnpjFormatado || l.entrada;
  const dataCons = l.dataConsulta ? dataBR(l.dataConsulta) : "";
  const push = (propriedade: string, valor: string, fonte: string, url: string, data: string, obs = "") => {
    if (!valor && !url) return;
    ev.push({ linha: l.rowNumber, empresa, propriedade, valor, fonte, url, data, observacao: obs });
  };
  push("Razão social", l.razaoSocial, l.fonte, "", dataCons, "Cadastro público");
  push("Situação cadastral", l.situacao, l.fonte, "", dataCons, l.dataSituacao ? `Data da situação: ${l.dataSituacao}` : "");
  push("Atividade (CNAE)", l.cnaeCodigo ? `${l.cnaeCodigo} ${l.cnaeDescricao}` : "", l.fonte, "", dataCons);
  push("Localização", [l.municipio, l.uf].filter(Boolean).join("/"), l.fonte, "", dataCons);
  push("Telefone do cadastro (cru)", l.telefonesCrus.join(" · "), l.fonte, "", dataCons, l.telefones.length === 0 ? "Valor NÃO utilizável como contato (regra de validação)" : "");
  push("E-mail do cadastro", l.email, l.fonte, "", dataCons);
  if (l.fonteDescoberta) push("CNPJ descoberto por", l.cnpjFormatado, l.fonteDescoberta, "", dataCons, "Busca reversa");
  push("Divergência de identidade", l.divergencias.map((d) => `${d.tipo} (${d.severidade}): ${d.descricao}`).join(" | "), l.fonte, "", dataCons, "Pista × cadastro");
  return ev;
}

function abaEvidencias(wb: ExcelJS.Workbook, ds: DatasetExport): void {
  const ws = wb.addWorksheet("Evidências");
  prepararAbaDados(ws, [
    { titulo: "Linha", largura: 7 },
    { titulo: "Empresa", largura: 40, quebra: true },
    { titulo: "Propriedade comprovada", largura: 28, quebra: true },
    { titulo: "Valor registrado", largura: 48, quebra: true },
    { titulo: "Fonte", largura: 24 },
    { titulo: "URL", largura: 48, quebra: true },
    { titulo: "Data", largura: 20 },
    { titulo: "Observação", largura: 44, quebra: true },
  ]);
  let total = 0;
  for (const l of ds.linhas) {
    for (const e of evidenciasDaLinha(l)) {
      total++;
      const row = ws.addRow(linhaSegura([e.linha, celulaTexto(e.empresa), e.propriedade, celulaTexto(e.valor), e.fonte, e.url, e.data, celulaTexto(e.observacao)]));
      row.alignment = { vertical: "top" };
    }
  }
  if (total === 0) {
    const wsEv = wb.getWorksheet("Evidências");
    if (wsEv) wb.removeWorksheet(wsEv.id);
  }
}

/* ======================= Aba 6: Lacunas e consultas ======================= */

interface LacunaAba {
  linha: number;
  empresa: string;
  origem: string;
  perguntaOuItem: string;
  estado: string;
  detalhe: string;
}

/**
 * Reutiliza TRIAGEM_V1 e PLANO_CONSULTAS_V1 (mesmos motores da interface —
 * nada de segundo motor). Uma consulta candidata do plano entra marcada como
 * CANDIDATA — nunca como executada.
 */
async function coletarLacunas(batchId: string, linhas: LinhaExport[]): Promise<LacunaAba[]> {
  const out: LacunaAba[] = [];
  const { gerarPlanoConsultas } = await import("@/lib/plano/planner");
  const plano = await gerarPlanoConsultas(batchId);
  if (plano.ok) {
    for (const item of plano.plano.itens) {
      out.push({
        linha: item.linha,
        empresa: item.cnpj_completo,
        origem: "PLANO_CONSULTAS_V1",
        perguntaOuItem: item.pergunta,
        estado: `CANDIDATA — não executada (fonte: ${item.fonte_candidata})`,
        detalhe: `${item.comando_executor} · resolve: ${item.o_que_resolve} · não resolve: ${item.o_que_nao_resolve}`,
      });
    }
    for (const fora of plano.plano.fora_do_escopo_api) {
      out.push({
        linha: fora.linha,
        empresa: fora.cnpj_completo ?? fora.cnpj_raiz ?? "",
        origem: "PLANO_CONSULTAS_V1",
        perguntaOuItem: fora.pergunta_id,
        estado: `FORA DO ESCOPO (${fora.estado_triagem}) — listado por transparência`,
        detalhe: fora.motivo,
      });
    }
  }
  const { classificarTriagemLinha } = await import("@/lib/triage/engine");
  for (const l of linhas) {
    const tri = await classificarTriagemLinha(batchId, l.rowNumber);
    if (!tri.ok) continue; // linha sumiu entre a listagem e o cálculo — nada inventado
    for (const lac of tri.lacunas) {
      out.push({
        linha: l.rowNumber,
        empresa: l.razaoSocial || l.cnpjFormatado || l.entrada,
        origem: "TRIAGEM_V1",
        perguntaOuItem: lac.pergunta,
        estado: lac.estado,
        detalhe: lac.motivo,
      });
    }
  }
  return out;
}

async function abaLacunas(wb: ExcelJS.Workbook, ds: DatasetExport, batchId: string): Promise<void> {
  const lacunas = await coletarLacunas(batchId, ds.linhas);
  if (lacunas.length === 0) return; // sem TRIAGEM/PLANO: aba não existe
  const ws = wb.addWorksheet("Lacunas e consultas");
  prepararAbaDados(ws, [
    { titulo: "Linha", largura: 7 },
    { titulo: "Empresa", largura: 40, quebra: true },
    { titulo: "Origem", largura: 22 },
    { titulo: "Pergunta ou consulta", largura: 54, quebra: true },
    { titulo: "Estado", largura: 34, quebra: true },
    { titulo: "Detalhe", largura: 54, quebra: true },
  ]);
  for (const lac of lacunas) {
    ws.addRow(linhaSegura([lac.linha || "", celulaTexto(lac.empresa), lac.origem, celulaTexto(lac.perguntaOuItem), lac.estado, celulaTexto(lac.detalhe)]));
  }
}

/* ============================== Ponto de entrada ========================== */

/**
 * Gera o .xlsx do lote no escopo do dataset e devolve o Buffer.
 * Reutiliza os motores TRIAGEM_V1/PLANO_CONSULTAS_V1 — sem segunda derivação.
 */
export async function gerarExcelLote(ds: DatasetExport, batchId: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Scout 360 (Senior)";
  wb.created = new Date();

  abaResumo(wb, ds);
  abaEmpresas(wb, ds);
  abaRevisoes(wb, ds);
  abaRepresentantes(wb, ds);
  abaEvidencias(wb, ds);
  await abaLacunas(wb, ds, batchId);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Nome de arquivo do Excel (escopo no nome). */
export function nomeArquivoExcel(base: string, shortId: string, escopo: string): string {
  const sufixo = escopo === "TODAS" ? "completo" : escopo === "SEM_REVISAO" ? "sem-revisao" : escopo === "EM_REVISAO" ? "revisoes" : "selecionadas";
  return `scout360-${sufixo}-${base}-${shortId}.xlsx`;
}

/** util reexport: CNPJ formatado preservando zeros (usado nos testes). */
export { formatCnpj };
