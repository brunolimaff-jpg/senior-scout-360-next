/**
 * test-homolog-exportacoes-estresse.ts — GATE 9 (HOMOLOG-D2) da homologação v0.11.0.
 *
 * Exportações sob estresse: 12 cenários × (CSV result · Excel · PDF), cada artefato
 * REABERTO e conferido (parse CSV, leitura ExcelJS, extração de texto por página dos
 * PDFs via scripts/lib/pdf-inspecao).
 *
 *   C1  Empresa com dados mínimos (só identidade)
 *   C2  Muitos representantes (32 sócios no quadro)
 *   C3  Muitas atividades secundárias (28 CNAEs)
 *   C4  Vários estabelecimentos (12 linhas da mesma raiz)
 *   C5  Relações extensas (12 participantes, quadros compartilhados entre empresas)
 *   C6  Nome empresarial muito longo (250+ chars com espaços)
 *   C7  Acentos/caracteres especiais + injeção de fórmula (= + - @, aspas, ;)
 *   C8  Ausência de telefone e e-mail (nenhum "undefined"/"null" pode vazar)
 *   C9  Identidade em revisão (REVIEW com divergência — exportação honesta)
 *   C10 Registro não encontrado (UNRESOLVED/NAO_ENCONTRADO — ausência honesta)
 *   C11 Seleção de empresas filtradas (rows= — só as selecionadas)
 *   C12 Lote grande (2000 linhas — volume, limites e tempo)
 *
 * REGRA DE OURO: globalThis.fetch é trocado por uma guarda que FALHA ALTO em qualquer
 * chamada HTTP durante as exportações — nenhuma exportação pode consultar IA ou rede.
 * RESOLVE_SERVICE_URL aponta para porta não roteável como cinto de segurança extra.
 *
 * Banco ISOLADO em /tmp (padrão test-v01024): fresh DB → DATABASE_URL → prisma db push
 * --skip-generate → imports dinâmicos DEPOIS do env. NUNCA toca db/custom.db.
 *
 * Rodar: bun scripts/test-homolog-exportacoes-estresse.ts
 * Evidências: qa/homolog-v0110/gate9/ (artefatos + relatorio.txt + relatorio.json)
 */
import { execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { Prisma } from "@prisma/client";
import type { LinhaPdf } from "./lib/pdf-inspecao";

/* ============ 0) AMBIENTE E GUARDAS — antes de qualquer import do app ============ */

const DB_ISOLADO = "/tmp/homolog-gate9-export.db";
const RAIZ = process.cwd();
const DIR_EVID = join(RAIZ, "qa", "homolog-v0110", "gate9");
const DIR_CASOS = join(DIR_EVID, "casos");
const DIR_CARGA = join(DIR_EVID, "carga2000");
const DIR_PNG = join(DIR_CASOS, "png");

// REGRA DE OURO: fetch global bloqueado com falha alta durante TODA a suíte.
const httpChamadas: string[] = [];
(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
  const url = typeof input === "string" ? input : ((input as { url?: string }).url ?? String(input));
  httpChamadas.push(url);
  throw new Error(`GOLDEN RULE VIOLADA — tentativa de HTTP durante exportação: ${url}`);
};

for (const f of [DB_ISOLADO, `${DB_ISOLADO}-journal`]) rmSync(f, { force: true });
execSync(`DATABASE_URL="file:${DB_ISOLADO}" bunx prisma db push --skip-generate`, { cwd: RAIZ, stdio: "pipe" });
process.env.DATABASE_URL = `file:${DB_ISOLADO}`;
delete process.env.SCOUT_EXPORT_TOKEN;
delete process.env.SCOUT_AUTH_REQUIRED;
process.env.RESOLVE_SERVICE_URL = "http://127.0.0.1:1"; // se alguém tentar, falha alto
process.env.SCOUT_LAB_ENABLED = "0";

/* ============ 1) IMPORTS DINÂMICOS (depois do env) ============ */

const routeMod = await import("../src/app/api/imports/[id]/export/route");
const GET = routeMod.GET;
const POST = routeMod.POST;
const { NextRequest } = await import("next/server");
const { db } = await import("../src/lib/db");
const { parseCsvFromBytes } = await import("../src/lib/csv");
const { formatCnpj } = await import("../src/lib/cnpj");
const { construirDatasetExportacao } = await import("../src/lib/export/dataset");
const { linhasPorPagina, numeroDePaginas } = await import("./lib/pdf-inspecao");
const exceljsMod = await import("exceljs");
const ExcelJS = (exceljsMod as unknown as { default?: typeof exceljsMod }).default ?? exceljsMod;

/* ============ 2) REGISTRO DE RESULTADOS ============ */

type Status = "PASS" | "FAIL" | "WARN";
interface Registro {
  cenario: string;
  tipo: string;
  categoria: string;
  check: string;
  status: Status;
  detalhe?: string;
}
interface Achado {
  id: string;
  titulo: string;
  severidade: "BUG" | "AVISO";
  arquivo: string;
  reproducao: string;
  evidencia: string;
}

const registros: Registro[] = [];
const achados: Achado[] = [];
const artefatos: string[] = [];
const tempos: Record<string, number> = {};
let pass = 0;
let fail = 0;
let warn = 0;

function check(cenario: string, tipo: string, categoria: string, nome: string, cond: boolean, detalhe = ""): void {
  const status: Status = cond ? "PASS" : "FAIL";
  if (cond) pass++;
  else fail++;
  registros.push({ cenario, tipo, categoria, check: nome, status, detalhe: detalhe || undefined });
  console.log(`  ${status}  [${cenario}/${tipo}] ${nome}${!cond && detalhe ? ` — ${detalhe}` : ""}`);
}
function aviso(cenario: string, tipo: string, categoria: string, nome: string, detalhe: string): void {
  warn++;
  registros.push({ cenario, tipo, categoria, check: nome, status: "WARN", detalhe });
  console.log(`  WARN [${cenario}/${tipo}] ${nome} — ${detalhe}`);
}
function achado(a: Achado): void {
  achados.push(a);
  console.log(`  >>> ACHADO ${a.severidade} ${a.id}: ${a.titulo}`);
}

const NOMES_CENARIOS: Record<string, string> = {
  C1: "Empresa com dados mínimos (só identidade)",
  C2: "Muitos representantes (32 sócios)",
  C3: "Muitas atividades secundárias (28 CNAEs)",
  C4: "Vários estabelecimentos (12, mesma raiz)",
  C5: "Relações extensas (12 participantes compartilhados)",
  C6: "Nome empresarial muito longo (250+ chars)",
  C7: "Acentos, caracteres especiais e injeção de fórmula",
  C8: "Ausência de telefone e e-mail",
  C9: "Identidade em revisão (REVIEW + divergência)",
  C10: "Registro não encontrado (UNRESOLVED/NAO_ENCONTRADO)",
  C11: "Seleção de empresas filtradas (rows=)",
  C12: "Lote grande (2000 linhas)",
  GOLDEN: "Regra de ouro — zero HTTP/IA na exportação",
  AUX: "Tipos auxiliares (summary/teia/ai/pending/audit/telemetria) e erros",
};

/* ============ 3) HELPERS DE CHAMADA E INSPEÇÃO ============ */

interface Resposta {
  status: number;
  buf: Buffer;
  json: Record<string, unknown> | null;
  nome: string;
  contentType: string;
}

async function chamarGet(id: string, qs: string): Promise<Resposta> {
  const url = `http://localhost:3000/api/imports/${id}/export${qs ? `?${qs}` : ""}`;
  const res = await GET(new NextRequest(url, { method: "GET" }), { params: Promise.resolve({ id }) });
  return await lerResposta(res);
}
async function chamarPost(id: string, corpo: Record<string, unknown>): Promise<Resposta> {
  const res = await POST(
    new NextRequest(`http://localhost:3000/api/imports/${id}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) }
  );
  return await lerResposta(res);
}
async function lerResposta(res: { status: number; arrayBuffer(): Promise<ArrayBuffer>; headers: { get(k: string): string | null } }): Promise<Resposta> {
  const buf = Buffer.from(await res.arrayBuffer());
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  } catch {
    /* binário */
  }
  const nome = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "";
  return { status: res.status, buf, json, nome, contentType: res.headers.get("content-type") ?? "" };
}

/* ---- CSV ---- */
interface CsvAberto {
  header: string[];
  dados: string[][];
  porLinha: Map<number, string[]>;
  encoding: string;
  delimiter: string;
  malformed: number;
}
function abrirCsv(buf: Buffer): CsvAberto {
  const parsed = parseCsvFromBytes(new Uint8Array(buf));
  const header = parsed.rows[0] ?? [];
  const dados = parsed.rows.slice(1);
  const porLinha = new Map<number, string[]>();
  for (const r of dados) porLinha.set(Number(r[0]), r);
  return { header, dados, porLinha, encoding: parsed.encoding, delimiter: parsed.delimiter, malformed: parsed.malformedQuotes };
}
function col(csv: CsvAberto, linha: number, nome: string): string {
  const i = csv.header.indexOf(nome);
  const r = csv.porLinha.get(linha);
  if (i < 0 || !r) return "\u0000col-ausente";
  return r[i] ?? "";
}
const VALORES_PROIBIDOS = new Set(["undefined", "null", "NaN", "[object Object]"]);

/* ---- Excel ---- */
function textoCelula(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const rt = (v as { richText?: { text: string }[] }).richText;
    if (Array.isArray(rt)) return rt.map((r) => r.text).join("");
    const result = (v as { result?: unknown }).result;
    if (result != null) return String(result);
    return "";
  }
  return String(v);
}
async function abrirExcel(buf: Buffer): Promise<InstanceType<typeof ExcelJS.Workbook>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}
function varrerTextoSuspeito(wb: InstanceType<typeof ExcelJS.Workbook>): string[] {
  const suspeitos: string[] = [];
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= ws.rowCount; r++) {
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
        const t = textoCelula(cell.value).trim();
        if (VALORES_PROIBIDOS.has(t)) suspeitos.push(`${ws.name}!${r},${c}="${t}"`);
      });
    }
  }
  return suspeitos;
}

/* ---- PDF (inspeção por página) ---- */
const TITULOS_SECAO = new Set([
  "VISÃO EMPRESARIAL",
  "PESSOAS E RELAÇÕES",
  "O QUE VALE INVESTIGAR",
  "RESULTADO GERAL",
  "DISTRIBUIÇÃO DAS CONTAS LOCALIZADAS",
  "EMPRESAS IDENTIFICADAS",
  "CASOS EM REVISÃO",
  "FALHAS E PENDÊNCIAS",
  "NOTAS DE LEITURA",
  "DOSSIÊ COMERCIAL DA EMPRESA",
]);
const RE_ANEXO_TITULO = /^ANEXO\s+[A-Z]\s+·\s+/;
function ehRodapeOuMarca(t: string): boolean {
  const s = t.trim();
  if (!s) return true;
  if (/^Página\s+\d+\s+de\s+\d+$/.test(s)) return true;
  if (s === "Scout 360 · Senior") return true;
  if (s.startsWith("Documento gerado em")) return true;
  if (s === "SCOUT 360") return true;
  if (s.includes("Senior") && s.includes("intelig")) return true;
  return false;
}
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
interface AnalisePdf {
  paginas: number;
  texto: string;
  problemas: string[];
}
function analisarPdf(buf: Buffer): AnalisePdf {
  const linhas = linhasPorPagina(buf);
  const paginas = numeroDePaginas(buf);
  const problemas: string[] = [];
  const porPagina = new Map<number, LinhaPdf[]>();
  for (const l of linhas) {
    const arr = porPagina.get(l.pagina) ?? [];
    arr.push(l);
    porPagina.set(l.pagina, arr);
  }
  const conteudoDa = (p: number): LinhaPdf[] =>
    (porPagina.get(p) ?? []).filter((l) => !ehRodapeOuMarca(l.texto) && l.texto.trim().length > 2);
  for (let p = 1; p <= paginas; p++) {
    const daPag = (porPagina.get(p) ?? []).filter((l) => !ehRodapeOuMarca(l.texto));
    const conteudo = conteudoDa(p);
    // títulos órfãos: título como ÚLTIMO item da página com conteúdo na seguinte
    for (let i = 0; i < conteudo.length; i++) {
      const t = conteudo[i].texto.trim();
      if (!TITULOS_SECAO.has(t) && !RE_ANEXO_TITULO.test(t)) continue;
      const abaixo = conteudo.slice(i + 1).filter((x) => x.y < conteudo[i].y);
      if (abaixo.length === 0 && p < paginas && conteudoDa(p + 1).length > 0) {
        problemas.push(`p${p}: título órfão "${t.slice(0, 60)}"`);
      }
    }
    // páginas praticamente vazias (>90% em branco)
    if (p < paginas && conteudo.length <= 1) problemas.push(`p${p}: praticamente vazia (${conteudo.length} linha(s) de conteúdo)`);
    if (p === paginas && conteudo.length === 0) problemas.push(`p${p} (final): vazia`);
    // rodapé cobrindo conteúdo: linha de conteúdo no plano do rodapé (régua em y=42; textos do rodapé em y=30/20)
    for (const l of daPag) {
      if (l.y <= 42) problemas.push(`p${p}: conteúdo em y=${l.y} invade o rodapé ("${l.texto.slice(0, 40)}")`);
    }
  }
  const texto = norm(linhas.map((l) => l.texto).join(" "));
  return { paginas, texto, problemas };
}
function ocorrencias(texto: string, frase: string): number {
  const f = norm(frase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (norm(texto).match(new RegExp(f, "g")) ?? []).length;
}

/* ---- artefatos ---- */
function salvar(dir: string, nome: string, buf: Buffer): void {
  const caminho = join(dir, nome);
  writeFileSync(caminho, buf);
  artefatos.push(caminho.replace(`${RAIZ}/`, ""));
}

/* ============ 4) CNPJ com DV (cópia provada do seed-qa-homolog) ============ */

function cnpjComDv(base12: string): string {
  const calc = (digits: string[]): number => {
    const pesos = digits.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < digits.length; i++) soma += Number(digits[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12.split(""));
  const d2 = calc([...base12.split(""), String(d1)]);
  return `${base12}${d1}${d2}`;
}

/* ============ 5) FIXTURES — LOTE DE CASOS (C1–C10) ============ */

type RowDraft = Prisma.ImportRowUncheckedCreateInput;
const AGORA = new Date("2026-02-15T09:00:00Z");
const VALIDO_ATE = new Date("2027-02-15T09:00:00Z");

const NOME_LONGO =
  "EMPRESA DE NOME EMPRESARIAL EXTREMAMENTE EXTENSO PARA O TESTE DE ESTRESSE DE EXPORTAÇÃO COM QUEBRA DE LINHA, PALAVRAS ACENTUADAS ÇÃÉÕ E SEGMENTOS DE ATUAÇÃO DIVERSIFICADOS EM INDÚSTRIA, COMÉRCIO, DISTRIBUIÇÃO E SERVIÇOS ASSOCIADOS AOS SETORES AGROINDUSTRIAL, AUTOMOTIVO, FERROVIÁRIO E AEROESPACIAL DO BRASIL LTDA";
const RAZAO_ACENTOS = "DISTRIBUIDORA SÃO CRISTÓVÃO DE AÇÚCAR E ÁLCOOL S.A.";
const RAZAO_ASPAS = 'COMERCIAL "TRIÂNGULO"; IRMÃOS & FILHOS LTDA';

const EXTRA_PADRAO = {
  telefone: "(65) 3222-1122",
  telefone2: "",
  email: "contato@empresa.com.br",
  endereco: "Rua das Acácias, 100",
  capitalSocial: "1.234.567,89",
  naturezaJuridica: "Sociedade Empresária Limitada",
  porte: "DEMAIS",
  simples: "Optante",
  mei: "Não",
};
const BASE_ENRIQUECIDA = {
  lookupKind: "CNPJ",
  cnpjStatus: "VALIDA",
  lookupStatus: "ENRIQUECIDO",
  identityStage: "CORRESPONDENTE",
  registrationStatus: "ATIVA",
  statusDate: "2019-11-05",
  branchType: "MATRIZ",
  branchIdentifier: 1,
  matrizStatus: "RESOLVIDA",
  source: "BrasilAPI",
  queriedAt: AGORA,
  collectedAt: AGORA,
  openingDate: "2010-04-22",
  cnaeCode: "6201-5/01",
  cnaeDescription: "Desenvolvimento de programas de computador sob encomenda",
  municipality: "CUIABA",
  uf: "MT",
  extraJson: JSON.stringify(EXTRA_PADRAO),
};
const cells = (a: string, b = "", c = "", d = ""): string => JSON.stringify([a, b, c, d]);

// raízes/cnpjs dos casos
const CNPJ_R1 = cnpjComDv("111111110001");
const CNPJ_R2 = cnpjComDv("222222220001");
const CNPJ_R3 = cnpjComDv("333333330001");
const CNPJ_R4 = cnpjComDv("121212120001");
const ROOT_REDE = "40404040";
const CNPJ_REDE_MATRIZ = cnpjComDv(`${ROOT_REDE}0001`);
const CNPJ_R17 = cnpjComDv("505050500001");
const CNPJ_R18 = cnpjComDv("606060600001");
const CNPJ_R19 = cnpjComDv("707070700001");
const CNPJ_R20 = cnpjComDv("808080800001");
const CNPJ_R21 = cnpjComDv("909090900001");
const CNPJ_R22 = cnpjComDv("919191910001");
const CNPJ_R24 = cnpjComDv("929292920001");
const CNPJ_R25 = cnpjComDv("939393930001");
const CNPJ_R26 = cnpjComDv("858585850001");

const sociosR3 = Array.from({ length: 32 }, (_, i) => ({
  nome: i < 8 ? `SOCIO ADMINISTRADOR ${String(i + 1).padStart(3, "0")}` : `SOCIO QUOTISTA ${String(i + 1).padStart(3, "0")}`,
  qual: i < 8 ? "Diretor" : "Sócio",
  entrada: "2015-03-10",
}));
const cnaesSecR4 = Array.from({ length: 28 }, (_, i) => `Atividade secundária registrada número ${i + 1}, fabricação e montagem de conjuntos`);

const relacoesR17 = [
  { participanteId: "pf-hash-001", tipo: "PF", nomePublico: "PARTICIPANTE COMPARTILHADO UM", qualificacao: "Sócio", empresaParticipada: "" },
  { participanteId: "pf-hash-002", tipo: "PF", nomePublico: "MARIA QUADRO AMPLA", qualificacao: "Sócio", empresaParticipada: "" },
  { participanteId: "pj-hash-003", tipo: "PJ", nomePublico: "PARTICIPAÇÕES BETA LTDA", qualificacao: "", empresaParticipada: "BETA HOLDING S.A.", cnpjParticipante: cnpjComDv("717171710001") },
  ...Array.from({ length: 9 }, (_, i) => ({
    participanteId: `pf-hash-1${String(i).padStart(2, "0")}`,
    tipo: i % 3 === 0 ? "PJ" : "PF",
    nomePublico: `INVESTIDOR SECUNDÁRIO ${String(i + 1).padStart(2, "0")}`,
    qualificacao: "Sócio",
    empresaParticipada: i % 3 === 0 ? `EMPRESA VINCULADA ${i + 1} LTDA` : "",
  })),
];
const relacoesR5 = [
  { participanteId: "pf-hash-002", tipo: "PF", nomePublico: "MARIA QUADRO AMPLA", qualificacao: "Sócio", empresaParticipada: "" },
  { participanteId: "pf-hash-020", tipo: "PF", nomePublico: "SÓCIO LOCAL DA MATRIZ", qualificacao: "Sócio", empresaParticipada: "" },
];
const quadroP2 = (["21212121", "23232323", "25252525"] as const).flatMap((root, idx) =>
  [1, 2, 3].map((b) => ({ cnpj: cnpjComDv(root + String(b).padStart(4, "0")), razaoSocial: `HOLDING QUADRO ${idx + 1} LTDA` }))
);
const quadroP3 = [1, 2].map((b) => ({ cnpj: cnpjComDv("27272727" + String(b).padStart(4, "0")), razaoSocial: "BETA PARTICIPAÇÕES FILIAL LTDA" }));

const rowsA: RowDraft[] = [
  // C1 — dados mínimos: só identidade (sem CNAE, sem contatos, sem sócios, sem relações)
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R1), rawCnpj: CNPJ_R1, normalizedCnpj: CNPJ_R1, cnpjRoot: "11111111", legalName: "MINIMA CADASTRO IDENTIDADE LTDA", cnaeCode: null, cnaeDescription: null, extraJson: null },
  // C8 — sem telefone e sem e-mail (campos vazios explícitos)
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R2), rawCnpj: CNPJ_R2, normalizedCnpj: CNPJ_R2, cnpjRoot: "22222222", legalName: "SEM CONTATO PUBLICO LTDA", extraJson: JSON.stringify({ telefone: "", telefone2: "", email: "", endereco: "", capitalSocial: "1.234.567,89", naturezaJuridica: "Sociedade Empresária Limitada", porte: "DEMAIS" }) },
  // C2 — 32 representantes no quadro
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R3), rawCnpj: CNPJ_R3, normalizedCnpj: CNPJ_R3, cnpjRoot: "33333333", legalName: "QUADRO AMPLIO SÓCIOS LTDA", sociosJson: JSON.stringify(sociosR3) },
  // C3 — 28 atividades secundárias
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R4), rawCnpj: CNPJ_R4, normalizedCnpj: CNPJ_R4, cnpjRoot: "12121212", legalName: "MULTIATIVIDADES SECUNDÁRIAS LTDA", extraJson: JSON.stringify({ ...EXTRA_PADRAO, cnaesSecundarios: cnaesSecR4 }) },
  // C4 — 12 estabelecimentos da mesma raiz (R5 matriz + R6..R16 filiais)
  ...Array.from({ length: 12 }, (_, i) => {
    const branch = String(i + 1).padStart(4, "0");
    const cnpj = cnpjComDv(ROOT_REDE + branch);
    const matriz = i === 0;
    return {
      ...BASE_ENRIQUECIDA,
      originalCellsJson: cells(cnpj),
      rawCnpj: cnpj,
      normalizedCnpj: cnpj,
      cnpjRoot: ROOT_REDE,
      legalName: "REDE ESTABELECIMENTOS FORTES LTDA",
      tradeName: matriz ? "Forte Unidade Matriz" : `Forte Filial ${i + 1}`,
      branchType: matriz ? "MATRIZ" : "FILIAL",
      branchIdentifier: matriz ? 1 : 2,
      headquartersCnpj: CNPJ_REDE_MATRIZ,
      matrizStatus: "RESOLVIDA",
      municipality: ["CUIABA", "VARZEA GRANDE", "RONDONOPOLIS"][i % 3],
      uf: "MT",
    };
  }),
  // C5 — relações extensas (cache de grafo com 12 participantes; 1 nome coincide com o QSA)
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R17), rawCnpj: CNPJ_R17, normalizedCnpj: CNPJ_R17, cnpjRoot: "50505050", legalName: "TECNOLOGIA RELACIONAMENTO CORPORATIVO LTDA", sociosJson: JSON.stringify([{ nome: "PARTICIPANTE COMPARTILHADO UM", qual: "Sócio-Administrador", entrada: "2010-01-01" }, { nome: "SOCIO FUNDATEUR", qual: "Sócio", entrada: "2005-06-15" }]) },
  // C6 — nome empresarial muito longo
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R18), rawCnpj: CNPJ_R18, normalizedCnpj: CNPJ_R18, cnpjRoot: "60606060", legalName: NOME_LONGO, tradeName: null },
  // C7a — acentos e caracteres especiais
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R19), rawCnpj: CNPJ_R19, normalizedCnpj: CNPJ_R19, cnpjRoot: "70707070", legalName: RAZAO_ACENTOS, tradeName: "Ébano & Ópera Café", municipality: "FEIRA DE SANTANA", uf: "BA", extraJson: JSON.stringify({ telefone: "(75) 3131-4002", telefone2: "(75) 3131-4003", email: "contato@cristovao.com.br", endereco: "Avenida das Éguas, 110, Feira de Santana/BA", capitalSocial: "9.500.000,00", naturezaJuridica: "Sociedade Anônima Aberta", porte: "GRANDE PORTE" }) },
  // C7b — injeção de fórmula (células e referência iniciadas por = + - @)
  {
    ...BASE_ENRIQUECIDA,
    lookupKind: "DOMAIN",
    originalCellsJson: JSON.stringify(["=SOMA(A1:A2)", "+3+4|cmd", "-2+3|calc", "@SUM(A1:A2)"]),
    referenceValue: '=HYPERLINK("http://mal.example","clique aqui")',
    cnpjStatus: "REFERENCIA",
    rawCnpj: "",
    normalizedCnpj: CNPJ_R20,
    resolvedCnpj: CNPJ_R20,
    reverseSource: "site_oficial+RDAP",
    cnpjRoot: "80808080",
    legalName: "=INJECAO DE FORMULA COMERCIAL LTDA",
  },
  // C7c — aspas e ponto-e-vírgula no valor (quoting CSV)
  { ...BASE_ENRIQUECIDA, originalCellsJson: JSON.stringify(['CLIENTE "ESPECIAL"; PENDENTE', "obs;com;ponto-e-virgula", "valor normal", ""]), rawCnpj: CNPJ_R21, normalizedCnpj: CNPJ_R21, cnpjRoot: "90909090", legalName: RAZAO_ASPAS },
  // C9 — identidade em revisão com divergência
  {
    ...BASE_ENRIQUECIDA,
    originalCellsJson: cells(CNPJ_R22, "alfaconstrutora.com.br"),
    rawCnpj: CNPJ_R22,
    normalizedCnpj: CNPJ_R22,
    cnpjRoot: "91919191",
    legalName: "ALFA CONSTRUTORA PREDIAL LTDA",
    identityStage: "LOCALIZADO",
    resolutionState: "REVIEW",
    resolutionConfidence: "MEDIA",
    identityDivergenciasJson: JSON.stringify([
      { tipo: "NOME", severidade: "ALTA", descricao: "A pista de nome 'Alfa Concreta' não aparece na razão social localizada." },
      { tipo: "LOCALIZACAO", severidade: "BAIXA", descricao: "UF da pista (SC) difere do cadastro (MT)." },
    ]),
    resolutionJson: JSON.stringify({ metodo: ["site_para_rdap"], notas: ["Dois candidatos com nome semelhante"] }),
  },
  // C10a — referência (domínio) sem CNPJ descoberto — UNRESOLVED
  { lookupKind: "DOMAIN", originalCellsJson: cells("desconhecida-llc.com.br"), referenceValue: "desconhecida-llc.com.br", cnpjStatus: "REFERENCIA", lookupStatus: "NAO_ENCONTRADO", lookupError: "Nenhum CNPJ descoberto para a referência informada", resolutionState: "UNRESOLVED", resolutionConfidence: "BAIXA" },
  // C10b — CNPJ válido não localizado nas fontes
  { lookupKind: "CNPJ", originalCellsJson: cells(CNPJ_R24), rawCnpj: CNPJ_R24, normalizedCnpj: CNPJ_R24, cnpjStatus: "VALIDA", lookupStatus: "NAO_ENCONTRADO", lookupError: "Não localizado nas fontes públicas" },
  // validada pelo operador (cobertura de "Validada por você")
  { ...BASE_ENRIQUECIDA, originalCellsJson: cells(CNPJ_R25), rawCnpj: CNPJ_R25, normalizedCnpj: CNPJ_R25, cnpjRoot: "93939393", legalName: "BETA VALIDADA PELO OPERADOR LTDA", identityStage: "VALIDADO", resolutionState: "CONFIRMED" },
  // leitura de IA (hipótese rotulada — anexo E do PDF e coluna IA do Excel/CSV)
  {
    ...BASE_ENRIQUECIDA,
    originalCellsJson: cells(CNPJ_R26),
    rawCnpj: CNPJ_R26,
    normalizedCnpj: CNPJ_R26,
    cnpjRoot: "85858585",
    legalName: "GAMMA LEITURA COMERCIAL LTDA",
    aiStatus: "OK",
    aiReading: "Leitura executiva de teste com hipótese comercial fundamentada em fatos públicos para a linha vinte e seis.",
    aiSector: "Tecnologia e software B2B",
    aiSize: "Pequeno porte aparente",
    aiProfile: "Empresa local, deduzido pela atuação regional",
    aiHypothesesJson: JSON.stringify(["Hipótese um: ampliação de linha exige integração, validar com o cliente", "Hipótese dois: processo manual sugere demanda por automação"]),
  },
];

/* ============ 6) FIXTURES — LOTE DE CARGA 2000 (C12) ============ */

function rowsCarga(): RowDraft[] {
  const out: RowDraft[] = [];
  const cabeca = (cnpj: string): string => JSON.stringify([cnpj, "prospect regional"]);
  for (let i = 1; i <= 1780; i++) {
    const cnpj = cnpjComDv(("60" + String(i).padStart(6, "0")) + "0001");
    out.push({ lookupKind: "CNPJ", originalCellsJson: cabeca(cnpj), rawCnpj: cnpj, normalizedCnpj: cnpj, cnpjStatus: "VALIDA", lookupStatus: "PENDENTE" });
  }
  for (let i = 1781; i <= 1960; i++) {
    const cnpj = cnpjComDv(("61" + String(i - 1780).padStart(6, "0")) + "0001");
    const comSocios = i % 5 === 0;
    out.push({
      ...BASE_ENRIQUECIDA,
      originalCellsJson: cabeca(cnpj),
      rawCnpj: cnpj,
      normalizedCnpj: cnpj,
      cnpjRoot: "61" + String(i - 1780).padStart(6, "0"),
      legalName: `CARGA DOIS MIL EMPRESA ${i} LTDA`,
      sociosJson: comSocios ? JSON.stringify([{ nome: `SOCIO DA CARGA ${i}`, qual: "Sócio", entrada: "2018-05-01" }]) : null,
      extraJson: JSON.stringify({ telefone: "(65) 3200-0000", telefone2: "", email: `carga${i}@empresa.com.br`, endereco: "", capitalSocial: "100.000,00", naturezaJuridica: "Sociedade Empresária Limitada" }),
    });
  }
  for (let i = 1961; i <= 1980; i++) {
    const cnpj = cnpjComDv(("62" + String(i - 1960).padStart(6, "0")) + "0001");
    out.push({
      ...BASE_ENRIQUECIDA,
      originalCellsJson: cabeca(cnpj),
      rawCnpj: cnpj,
      normalizedCnpj: cnpj,
      cnpjRoot: "62" + String(i - 1960).padStart(6, "0"),
      legalName: `CARGA REVISÃO ${i} LTDA`,
      identityStage: "LOCALIZADO",
      resolutionState: "REVIEW",
      identityDivergenciasJson: JSON.stringify([{ tipo: "DOMINIO", severidade: "BAIXA", descricao: "O domínio da pista não aparece no cadastro localizado." }]),
    });
  }
  for (let i = 1981; i <= 1990; i++) {
    const cnpj = cnpjComDv(("63" + String(i - 1980).padStart(6, "0")) + "0001");
    out.push({ lookupKind: "CNPJ", originalCellsJson: cabeca(cnpj), rawCnpj: cnpj, normalizedCnpj: cnpj, cnpjStatus: "VALIDA", lookupStatus: "NAO_ENCONTRADO", lookupError: "Não localizado nas fontes públicas" });
  }
  for (let i = 1991; i <= 2000; i++) {
    const cnpj = cnpjComDv(("64" + String(i - 1990).padStart(6, "0")) + "0001");
    out.push({ lookupKind: "CNPJ", originalCellsJson: cabeca(cnpj), rawCnpj: cnpj, normalizedCnpj: cnpj, cnpjStatus: "VALIDA", lookupStatus: "RATE_LIMITED", lookupError: "Fonte pública temporariamente limitada (HTTP 429)" });
  }
  return out;
}

/* ============ 7) EXECUÇÃO ============ */

async function main(): Promise<void> {
  mkdirSync(DIR_CASOS, { recursive: true });
  mkdirSync(DIR_CARGA, { recursive: true });
  mkdirSync(DIR_PNG, { recursive: true });
  console.log("== GATE 9 (HOMOLOG-D2) — Exportações sob estresse ==");
  console.log(`   banco isolado: ${DB_ISOLADO}\n`);

  if (NOME_LONGO.length < 250) throw new Error(`nome longo tem ${NOME_LONGO.length} chars — fixture inválida`);
  console.log(`   fixture C6: nome longo com ${NOME_LONGO.length} caracteres`);

  /* ---------- seed lote de casos ---------- */
  const loteCasos = await db.importBatch.create({
    data: {
      fileName: "QA-gate9-casos.csv",
      storedPath: "",
      fileSize: 2048,
      sourceType: "CSV",
      delimiter: ";",
      encoding: "UTF-8",
      hasHeader: true,
      headerJson: JSON.stringify(["pista_a", "pista_b", "pista_c", "pista_d"]),
      rowCount: rowsA.length,
      status: "DONE",
      totalValid: 24,
      totalReference: 2,
      totalResolved: 1,
      totalEnriched: 24,
      aiEnabled: true,
      aiTotal: 24,
      aiDone: 1,
      totalConfirmed: 1,
      totalReview: 1,
      totalUnresolved: 1,
      totalLocalizado: 1,
      totalValidado: 1,
      confirmedAt: AGORA,
      processingAt: AGORA,
      finishedAt: AGORA,
    },
  });
  await db.importRow.createMany({ data: rowsA.map((r, i) => ({ ...r, batchId: loteCasos.id, rowNumber: i + 1 })) });
  await db.relacaoSocietariaCache.createMany({
    data: [
      { cnpj: CNPJ_R17, fonte: "MinhaReceita Grafo", coletadoEm: AGORA, atualizadoEm: AGORA, validoAte: VALIDO_ATE, relacoesJson: JSON.stringify(relacoesR17), totalParticipantes: relacoesR17.length },
      { cnpj: CNPJ_REDE_MATRIZ, fonte: "MinhaReceita Grafo", coletadoEm: AGORA, atualizadoEm: AGORA, validoAte: VALIDO_ATE, relacoesJson: JSON.stringify(relacoesR5), totalParticipantes: relacoesR5.length },
    ],
  });
  await db.quadroParticipanteCache.createMany({
    data: [
      { participanteId: "pf-hash-002", tipoParticipante: "PF", rotulo: "MARIA QUADRO AMPLA", fonte: "MinhaReceita Grafo", coletadoEm: AGORA, validoAte: VALIDO_ATE, empresasJson: JSON.stringify(quadroP2), totalEmpresas: quadroP2.length, truncado: false },
      { participanteId: "pj-hash-003", tipoParticipante: "PJ", rotulo: "PARTICIPAÇÕES BETA LTDA", fonte: "MinhaReceita Grafo", coletadoEm: AGORA, validoAte: VALIDO_ATE, empresasJson: JSON.stringify(quadroP3), totalEmpresas: quadroP3.length, truncado: false },
    ],
  });
  console.log(`\n[seed] lote de casos criado: ${loteCasos.id} (${rowsA.length} linhas + caches de relações)`);

  /* ---------- seed lote de carga 2000 ---------- */
  const tSeed = Date.now();
  const loteCarga = await db.importBatch.create({
    data: {
      fileName: "QA-gate9-carga-2000.csv",
      storedPath: "",
      fileSize: 90000,
      sourceType: "CSV",
      delimiter: ";",
      encoding: "UTF-8",
      hasHeader: true,
      headerJson: JSON.stringify(["cnpj", "observacao"]),
      rowCount: 2000,
      status: "DONE",
      totalValid: 2000,
      totalEnriched: 200,
      totalPending: 1780,
      totalReview: 20,
      totalLocalizado: 20,
      confirmedAt: AGORA,
      processingAt: AGORA,
      finishedAt: AGORA,
    },
  });
  const dadosCarga = rowsCarga();
  for (let i = 0; i < dadosCarga.length; i += 500) {
    await db.importRow.createMany({ data: dadosCarga.slice(i, i + 500).map((r, j) => ({ ...r, batchId: loteCarga.id, rowNumber: i + j + 1 })) });
  }
  tempos.seedCarga2000 = Date.now() - tSeed;
  console.log(`[seed] lote de carga criado: ${loteCarga.id} (2000 linhas, ${tempos.seedCarga2000} ms)`);

  /* ================================================================
   * EXPORTAÇÕES DO LOTE DE CASOS — CSV result (todas)
   * ================================================================ */
  console.log("\n--- CSV type=result (lote de casos) ---");
  let t0 = Date.now();
  const csvRes = await chamarGet(loteCasos.id, "type=result");
  tempos.csvCasos = Date.now() - t0;
  check("AUX", "CSV", "colunas", "CSV result: 200 + text/csv + filename resultado-", csvRes.status === 200 && csvRes.contentType.startsWith("text/csv") && csvRes.nome.startsWith("resultado-"), `status=${csvRes.status}`);
  salvar(DIR_CASOS, "resultado-todas.csv", csvRes.buf);

  const csvA = abrirCsv(csvRes.buf);
  check("C1", "CSV", "identidade", "CSV: 26 linhas de dados (todas as entradas preservadas)", csvA.dados.length === 26, `${csvA.dados.length}`);
  check("C1", "CSV", "colunas", "CSV: BOM UTF-8 + delimitador ; detectado", csvRes.buf[0] === 0xef && csvRes.buf[1] === 0xbb && csvRes.buf[2] === 0xbf && csvA.encoding === "UTF-8-BOM" && csvA.delimiter === ";", `encoding=${csvA.encoding} delim=${csvA.delimiter}`);
  check("C1", "CSV", "colunas", "CSV: 55 colunas (linha + 4 originais + 50 derivadas) em TODAS as linhas", csvA.dados.every((r) => r.length === 55) && csvA.header.length === 55, `header=${csvA.header.length}`);
  check("C1", "CSV", "colunas", "CSV: cabeçalhos-chave presentes (razao_social, cnpj_normalizado, contato_email, erro, ia_leitura_executiva)", ["razao_social", "cnpj_normalizado", "contato_email", "contato_telefone", "erro", "ia_leitura_executiva"].every((h) => csvA.header.includes(h)));
  check("C1", "CSV", "acentos", "CSV: acentos intactos após reabertura (SÃO CRISTÓVÃO / AÇÚCAR / ÁLCOOL)", col(csvA, 19, "razao_social") === RAZAO_ACENTOS, col(csvA, 19, "razao_social").slice(0, 40));
  const celulasSuspeitas: string[] = [];
  for (const r of csvA.dados) for (const c of r) if (VALORES_PROIBIDOS.has(c.trim())) celulasSuspeitas.push(c);
  check("C8", "CSV", "identidade", "CSV: nenhuma célula 'undefined'/'null'/'NaN' em todo o arquivo", celulasSuspeitas.length === 0, celulasSuspeitas.slice(0, 3).join(" | "));
  check("C8", "CSV", "identidade", "CSV: linha sem contato exporta contato_email/telefone/telefone_2 VAZIOS (não 'null')", col(csvA, 2, "contato_email") === "" && col(csvA, 2, "contato_telefone") === "" && col(csvA, 2, "contato_telefone_2") === "");
  check("C1", "CSV", "identidade", "CSV: empresa mínima sem CNAE exporta cnae_codigo/cnae_descricao vazios", col(csvA, 1, "cnae_codigo") === "" && col(csvA, 1, "cnae_descricao") === "");
  check("C1", "CSV", "identidade", "CSV: razão social da empresa mínima correta (linha certa, dado certo)", col(csvA, 1, "razao_social") === "MINIMA CADASTRO IDENTIDADE LTDA");

  // C2 — 32 sócios
  check("C2", "CSV", "identidade", "CSV: qtd_socios = 32 para o quadro amplo", col(csvA, 3, "qtd_socios") === "32", col(csvA, 3, "qtd_socios"));
  const sociosCsv = col(csvA, 3, "socios_qsa");
  const sociosCsvCompletos = sociosCsv.includes("SOCIO ADMINISTRADOR 001") && sociosCsv.includes("SOCIO QUOTISTA 032");
  check("C2", "CSV", "identidade", "CSV: socios_qsa lista o quadro COMPLETO (32 de 32)", sociosCsvCompletos, `socios_qsa contém ${sociosCsv.split(" | ").length} sócios (corte em 12 no route.ts:92)`);
  if (!sociosCsvCompletos) {
    achado({
      id: "F3",
      titulo: "CSV result trama socios_qsa em silêncio no 13º sócio (qtd_socios diz 32, célula lista 12)",
      severidade: "BUG",
      arquivo: "src/app/api/imports/[id]/export/route.ts:92",
      reproducao: "Lote com linha ENRIQUECIDA e 32 sócios em sociosJson → GET /export?type=result → coluna socios_qsa contém só os 12 primeiros (slice(0, 12)); coluna qtd_socios reporta 32. A exportação teia (type=teia) lista os 32 — o corte existe só no CSV de resultado e não é anunciado em lugar nenhum.",
      evidencia: "qa/homolog-v0110/gate9/casos/resultado-todas.csv (linha 3) vs qa/homolog-v0110/gate9/casos/teia-societaria.csv",
    });
  }

  // C3 — 28 CNAEs secundários
  const temColunaCnaesSec = csvA.header.some((h) => /secundar/i.test(h));
  check("C3", "CSV", "colunas", "CSV: NENHUMA coluna carrega os CNAEs secundários", !temColunaCnaesSec);
  aviso("C3", "CSV", "colunas", "CSV/Excel não transportam os 28 CNAEs secundários (só o PDF completo tem o Anexo A)", "o dado existe em extraJson.cnaesSecundarios e não aparece em nenhuma coluna do CSV result nem do Excel — o analista que só consome planilha não vê a diversidade de atividades");

  // C4 — 12 estabelecimentos da mesma raiz
  const raizesOk = Array.from({ length: 12 }, (_, i) => col(csvA, 5 + i, "cnpj_raiz") === ROOT_REDE).every(Boolean);
  const cnpjMatrizFilial = col(csvA, 6, "cnpj_matriz");
  check("C4", "CSV", "identidade", "CSV: 12 estabelecimentos com a MESMA raiz (contagem por pessoa jurídica)", raizesOk);
  check("C4", "CSV", "identidade", "CSV: filial (linha 6) referencia a matriz formatada; matriz (linha 5) não referencia a si", cnpjMatrizFilial === formatCnpj(CNPJ_REDE_MATRIZ) && col(csvA, 5, "cnpj_matriz") === "" && col(csvA, 5, "tipo_matriz_filial") === "MATRIZ" && col(csvA, 6, "tipo_matriz_filial") === "FILIAL", `linha6=${cnpjMatrizFilial}`);
  check("C4", "CSV", "colunas", "CSV: CNPJs normalizados com 14 dígitos (zeros preservados como texto)", Array.from({ length: 12 }, (_, i) => col(csvA, 5 + i, "cnpj_normalizado")).every((c) => /^\d{14}$/.test(c)));

  // C5 — relações extensas
  check("C5", "CSV", "identidade", "CSV: linha 17 (relações) exporta a própria razão social correta", col(csvA, 17, "razao_social") === "TECNOLOGIA RELACIONAMENTO CORPORATIVO LTDA");

  // C6 — nome longo
  check("C6", "CSV", "identidade", "CSV: nome de 300+ chars íntegro (sem corte)", col(csvA, 18, "razao_social") === NOME_LONGO, `len=${col(csvA, 18, "razao_social").length}`);

  // C7 — injeção de fórmula
  check("C7", "CSV", "formulas", "CSV: '=SOMA(A1:A2)' escapado com apóstrofo", col(csvA, 20, "pista_a") === "'=SOMA(A1:A2)", col(csvA, 20, "pista_a"));
  check("C7", "CSV", "formulas", "CSV: '+3+4|cmd' escapado", col(csvA, 20, "pista_b") === "'+3+4|cmd", col(csvA, 20, "pista_b"));
  check("C7", "CSV", "formulas", "CSV: '-2+3|calc' escapado", col(csvA, 20, "pista_c") === "'-2+3|calc", col(csvA, 20, "pista_c"));
  check("C7", "CSV", "formulas", "CSV: '@SUM(A1:A2)' escapado", col(csvA, 20, "pista_d") === "'@SUM(A1:A2)", col(csvA, 20, "pista_d"));
  check("C7", "CSV", "formulas", "CSV: referência '=HYPERLINK(...)' escapada", col(csvA, 20, "referencia").startsWith("'=HYPERLINK"), col(csvA, 20, "referencia").slice(0, 30));
  check("C7", "CSV", "formulas", "CSV: razão social iniciada por '=' escapada", col(csvA, 20, "razao_social") === "'=INJECAO DE FORMULA COMERCIAL LTDA", col(csvA, 20, "razao_social"));
  check("C7", "CSV", "acentos", "CSV: aspas e ponto-e-vírgula fazem round-trip exato (quoting correto)", col(csvA, 21, "razao_social") === RAZAO_ASPAS && col(csvA, 21, "pista_a") === 'CLIENTE "ESPECIAL"; PENDENTE', col(csvA, 21, "razao_social"));
  check("C7", "CSV", "colunas", "CSV: zero linhas malformadas (aspas balanceadas)", csvA.malformed === 0, `malformed=${csvA.malformed}`);
  check("C7", "CSV", "colunas", "CSV: cnpj_encontrado da busca reversa formatado xx.xxx.xxx/xxxx-xx", /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(col(csvA, 20, "cnpj_encontrado")), col(csvA, 20, "cnpj_encontrado"));

  // C9 — revisão honesta
  check("C9", "CSV", "honestidade", "CSV: revisão exportada com estado REVIEW + etapa LOCALIZADO + confiança", col(csvA, 22, "estado_resolucao") === "REVIEW" && col(csvA, 22, "etapa_identidade") === "LOCALIZADO" && col(csvA, 22, "confianca_evidencia") === "MEDIA");
  check("C9", "CSV", "honestidade", "CSV: divergências descritas (NOME:ALTA e LOCALIZACAO:BAIXA com texto)", col(csvA, 22, "divergencias_identidade").includes("NOME:ALTA") && col(csvA, 22, "divergencias_identidade").includes("não aparece na razão social"));
  check("C9", "CSV", "honestidade", "CSV: razão social da revisão presente (dado localizado, pendência explícita)", col(csvA, 22, "razao_social") === "ALFA CONSTRUTORA PREDIAL LTDA");

  // C10 — não encontrado honesto
  check("C10", "CSV", "honestidade", "CSV: referência UNRESOLVED sem CNPJ nem razão social (nada inventado)", col(csvA, 23, "razao_social") === "" && col(csvA, 23, "cnpj_normalizado") === "" && col(csvA, 23, "estado_resolucao") === "UNRESOLVED");
  check("C10", "CSV", "honestidade", "CSV: motivo da falha presente no erro (linha 23 e 24)", col(csvA, 23, "erro") === "Nenhum CNPJ descoberto para a referência informada" && col(csvA, 24, "erro") === "Não localizado nas fontes públicas");
  check("C10", "CSV", "honestidade", "CSV: CNPJ não encontrado mantém cnpj_valido=SIM (entrada válida, fonte sem resposta)", col(csvA, 24, "cnpj_valido") === "SIM" && col(csvA, 24, "razao_social") === "");

  // C26 (aux) — IA como hipótese
  check("AUX", "CSV", "colunas", "CSV: leitura IA transportada em colunas ia_* (status OK + leitura)", col(csvA, 26, "ia_status") === "OK" && col(csvA, 26, "ia_leitura_executiva").includes("Leitura executiva"));

  /* ---------- CSV result_review / result_confirmed ---------- */
  const csvRev = await chamarGet(loteCasos.id, "type=result_review");
  salvar(DIR_CASOS, "revisoes.csv", csvRev.buf);
  const revAberto = abrirCsv(csvRev.buf);
  check("C9", "CSV(revisões)", "honestidade", "CSV result_review: exatamente a linha 22 (revisão da união da interface)", csvRev.status === 200 && revAberto.dados.length === 1 && Number(revAberto.dados[0][0]) === 22, `${revAberto.dados.length} linhas`);
  const csvConf = await chamarGet(loteCasos.id, "type=result_confirmed");
  salvar(DIR_CASOS, "confirmadas.csv", csvConf.buf);
  const confAberto = abrirCsv(csvConf.buf);
  const confLinhas = confAberto.dados.map((r) => Number(r[0]));
  check("C9", "CSV(confirmadas)", "honestidade", "CSV result_confirmed: 23 linhas (exclui revisão e não encontradas)", confAberto.dados.length === 23 && !confLinhas.includes(22) && !confLinhas.includes(23) && !confLinhas.includes(24), `${confAberto.dados.length} linhas`);

  /* ================================================================
   * EXCEL — lote de casos (escopo TODAS)
   * ================================================================ */
  console.log("\n--- Excel type=excel (lote de casos) ---");
  t0 = Date.now();
  const exRes = await chamarGet(loteCasos.id, "type=excel&scope=TODAS");
  tempos.excelCasos = Date.now() - t0;
  check("AUX", "Excel", "colunas", "Excel: 200 + MIME xlsx + nome scout360-completo-", exRes.status === 200 && exRes.contentType.includes("spreadsheetml") && exRes.nome.startsWith("scout360-completo-"), `status=${exRes.status}`);
  salvar(DIR_CASOS, "excel-todas.xlsx", exRes.buf);
  const wbA = await abrirExcel(exRes.buf);
  check("C1", "Excel", "colunas", "Excel: 6 abas na ordem esperada (Resumo→Lacunas)", JSON.stringify(wbA.worksheets.map((w) => w.name)) === JSON.stringify(["Resumo", "Empresas", "Revisões", "Representantes e relações", "Evidências", "Lacunas e consultas"]), JSON.stringify(wbA.worksheets.map((w) => w.name)));
  const empA = wbA.getWorksheet("Empresas")!;
  const CABECALHO_ESPERADO = ["Linha", "Chave estável", "CNPJ", "Razão social", "Nome fantasia", "Matriz ou filial", "CNPJ da matriz", "Município", "UF", "Situação cadastral", "Data da situação", "Atividade (CNAE)", "Porte", "Capital social (R$)", "Telefones válidos", "E-mail público", "Status da identidade", "Validada por você", "Divergências", "Leitura comercial (IA)", "Fonte", "Data da consulta", "Pista original"];
  check("C1", "Excel", "colunas", "Excel: cabeçalho da aba Empresas completo (23 colunas)", JSON.stringify(empA.getRow(1).values.slice(1)) === JSON.stringify(CABECALHO_ESPERADO));
  check("C1", "Excel", "identidade", "Excel: 26 empresas na aba Empresas", empA.rowCount - 1 === 26, `${empA.rowCount - 1}`);
  const resumoA = wbA.getWorksheet("Resumo")!;
  const valoresResumo = new Map<string, string | number>();
  for (let r = 1; r <= resumoA.rowCount; r++) {
    const k = resumoA.getRow(r).getCell(1).value;
    if (typeof k === "string") valoresResumo.set(k, resumoA.getRow(r).getCell(2).value as string | number);
  }
  check("C1", "Excel", "identidade", "Excel Resumo: entradas 26 · localizadas 13 raízes · compatíveis 12", valoresResumo.get("Entradas recebidas") === 26 && valoresResumo.get("Empresas localizadas (raízes distintas)") === 13 && valoresResumo.get("Pessoas jurídicas compatíveis com as pistas") === 12, `${valoresResumo.get("Empresas localizadas (raízes distintas)")}/${valoresResumo.get("Pessoas jurídicas compatíveis com as pistas")}`);
  check("C4", "Excel", "identidade", "Excel Resumo: 12 estabelecimentos contam 1 raiz (13 raízes no total, não 24)", valoresResumo.get("Empresas localizadas (raízes distintas)") === 13);
  check("C9", "Excel", "honestidade", "Excel Resumo: 1 linha em revisão humana", valoresResumo.get("Linhas aguardando revisão humana") === 1);
  check("C10", "Excel", "honestidade", "Excel Resumo: 2 não localizadas · 2 falhas", valoresResumo.get("Entradas não localizadas") === 2 && valoresResumo.get("Entradas com falha de consulta") === 2);

  // linha do Excel = rowNumber + 1
  const linhaEx = (n: number) => empA.getRow(n + 1);
  check("C1", "Excel", "identidade", "Excel: empresa mínima com razão correta e CNAE VAZIO (nada inventado)", textoCelula(linhaEx(1).getCell(4).value) === "MINIMA CADASTRO IDENTIDADE LTDA" && textoCelula(linhaEx(1).getCell(12).value) === "");
  check("C8", "Excel", "identidade", "Excel: linha sem contato — Telefones/E-mail vazios (não 'null')", textoCelula(linhaEx(2).getCell(15).value) === "" && textoCelula(linhaEx(2).getCell(16).value) === "");
  const dataSit = linhaEx(2).getCell(11).value;
  check("C2", "Excel", "colunas", "Excel: Data da situação tipada como Date (dd/mm/yyyy)", dataSit instanceof Date, typeof dataSit);
  const capCel = linhaEx(2).getCell(14);
  check("C2", "Excel", "colunas", "Excel: capital social numérico com formato R$", typeof capCel.value === "number" && capCel.value === 1234567.89 && (capCel.numFmt ?? "").includes("R$"), `${String(capCel.value)} fmt=${capCel.numFmt}`);
  const dataCons = linhaEx(2).getCell(22).value;
  check("AUX", "Excel", "colunas", "Excel: Data da consulta tipada como Date", dataCons instanceof Date);

  // C2 — representantes
  const repA = wbA.getWorksheet("Representantes e relações")!;
  const repsLinha3 = Array.from({ length: repA.rowCount - 1 }, (_, i) => repA.getRow(i + 2)).filter((r) => Number(r.getCell(1).value) === 3);
  check("C2", "Excel", "identidade", "Excel: 32 representantes da linha 3 na aba Representantes (quadro completo)", repsLinha3.length === 32, `${repsLinha3.length}`);
  check("C2", "Excel", "identidade", "Excel: 47 vínculos no total (32 + 13 da linha 17 + 2 da linha 5)", repA.rowCount - 1 === 47, `${repA.rowCount - 1}`);

  // C5 — relações
  const repsLinha17 = Array.from({ length: repA.rowCount - 1 }, (_, i) => repA.getRow(i + 2)).filter((r) => Number(r.getCell(1).value) === 17);
  const pcuLinha17 = repsLinha17.filter((r) => textoCelula(r.getCell(4).value) === "PARTICIPANTE COMPARTILHADO UM");
  check("C5", "Excel", "identidade", "Excel: 13 vínculos na linha 17 (2 QSA + 11 de grafo — 1 deduplicado)", repsLinha17.length === 13, `${repsLinha17.length}`);
  check("C5", "Excel", "identidade", "Excel: participante do QSA que também está no grafo NÃO duplica (dedupe)", pcuLinha17.length === 1, `${pcuLinha17.length}`);
  const temParticipacao = repsLinha17.some((r) => textoCelula(r.getCell(6).value).includes("Participação registrada") && textoCelula(r.getCell(6).value).includes("BETA HOLDING S.A."));
  check("C5", "Excel", "identidade", "Excel: vínculo de grafo com empresa participada nomeada", temParticipacao);

  // C6 — nome longo
  check("C6", "Excel", "identidade", "Excel: nome de 300+ chars íntegro na célula (sem truncamento)", textoCelula(linhaEx(18).getCell(4).value) === NOME_LONGO, `len=${textoCelula(linhaEx(18).getCell(4).value).length}`);

  // C7 — acentos e fórmula
  check("C7", "Excel", "acentos", "Excel: acentos intactos (razão com Ç/Ã/É/Õ idêntica à fonte)", textoCelula(linhaEx(19).getCell(4).value) === RAZAO_ACENTOS, textoCelula(linhaEx(19).getCell(4).value).slice(0, 30));
  check("C7", "Excel", "acentos", "Excel: município e nome fantasia acentuados", textoCelula(linhaEx(19).getCell(8).value) === "FEIRA DE SANTANA" && textoCelula(linhaEx(19).getCell(5).value) === "Ébano & Ópera Café");
  const tel19 = textoCelula(linhaEx(19).getCell(15).value);
  check("C7", "Excel", "acentos", "Excel: dois telefones válidos separados por ·", tel19 === "(75) 3131-4002 · (75) 3131-4003", tel19);
  const celRazao20 = linhaEx(20).getCell(4);
  const celPista20 = linhaEx(20).getCell(23);
  const ehRichText = (v: unknown): boolean => Array.isArray((v as { richText?: unknown[] }).richText);
  check("C7", "Excel", "formulas", "Excel: razão '=...' entra como richText (NUNCA fórmula)", ehRichText(celRazao20.value) && textoCelula(celRazao20.value).startsWith("=INJECAO") && celRazao20.type !== ExcelJS.ValueType.Formula);
  check("C7", "Excel", "formulas", "Excel: pista original '=SOMA(...)' entra como richText (não interpretada)", ehRichText(celPista20.value) && textoCelula(celPista20.value).startsWith("=SOMA") && celPista20.type !== ExcelJS.ValueType.Formula);
  const evA = wbA.getWorksheet("Evidências")!;
  let evInjecao = false;
  for (let r = 2; r <= evA.rowCount; r++) {
    if (Number(evA.getRow(r).getCell(1).value) === 20 && textoCelula(evA.getRow(r).getCell(4).value).startsWith("=INJECAO")) evInjecao = true;
  }
  check("C7", "Excel", "formulas", "Excel: valor '=...' na aba Evidências também é texto (richText), não fórmula", evInjecao);
  const celAspas21 = linhaEx(21).getCell(4);
  check("C7", "Excel", "acentos", "Excel: aspas/ponto-e-vírgula preservados literalmente", textoCelula(celAspas21.value) === RAZAO_ASPAS, textoCelula(celAspas21.value));

  // C9 — revisões
  const revA = wbA.getWorksheet("Revisões")!;
  const revLinhas = Array.from({ length: revA.rowCount - 1 }, (_, i) => Number(revA.getRow(i + 2).getCell(1).value));
  check("C9", "Excel", "honestidade", "Excel: aba Revisões contém EXATAMENTE a linha 22", revLinhas.length === 1 && revLinhas[0] === 22, JSON.stringify(revLinhas));
  const motivoRev = textoCelula(revA.getRow(2).getCell(6).value);
  check("C9", "Excel", "honestidade", "Excel: motivo da divergência com tipo e severidade (NOME (ALTA))", motivoRev.includes("NOME (ALTA)") && motivoRev.includes("não aparece na razão social"), motivoRev.slice(0, 50));

  // C10 — não encontrado (honestidade) — F2
  const statusId24 = textoCelula(linhaEx(24).getCell(17).value);
  check("C10", "Excel", "honestidade", "Excel: linha NÃO ENCONTRADA sem rótulo de status (CNPJ mostrado ≠ enriquecido)", statusId24 === "", `Status da identidade="${statusId24}"`);
  if (statusId24 !== "") {
    achado({
      id: "F2",
      titulo: 'Excel rotula linha NAO_ENCONTRADO como "ENRIQUECIDO" na coluna Status da identidade',
      severidade: "BUG",
      arquivo: "src/lib/export/excel.ts:213",
      reproducao: "Lote com linha { cnpjStatus: VALIDA, lookupStatus: NAO_ENCONTRADO, normalizedCnpj: <cnpj> } → GET /export?type=excel → aba Empresas, coluna 17 (Status da identidade) mostra \"ENRIQUECIDO\" para esta linha (fallback `l.cnpjFormatado ? \"ENRIQUECIDO\" : \"\"` dispara para qualquer linha com CNPJ formatado, mesmo sem ficha). Razão social fica vazia, mas o rótulo contradiz o estado real da linha.",
      evidencia: "qa/homolog-v0110/gate9/casos/excel-todas.xlsx — aba Empresas linha 25 (linha 24 do lote)",
    });
  }
  check("C10", "Excel", "honestidade", "Excel: linhas 23/24 sem razão social e sem CNPJ inventado (23 sem CNPJ; 24 só o CNPJ consultado)", textoCelula(linhaEx(23).getCell(3).value) === "" && textoCelula(linhaEx(23).getCell(4).value) === "" && textoCelula(linhaEx(24).getCell(4).value) === "");

  // validação e coerência com o dataset (ficha)
  check("AUX", "Excel", "identidade", "Excel: identidade validada pelo operador marcada SIM", textoCelula(linhaEx(25).getCell(18).value) === "SIM");
  check("C4", "Excel", "colunas", "Excel: CNPJ como TEXTO (numFmt @) preservando formato", linhaEx(5).getCell(3).numFmt === "@" && textoCelula(linhaEx(5).getCell(3).value) === formatCnpj(CNPJ_REDE_MATRIZ));
  const suspeitosExcel = varrerTextoSuspeito(wbA);
  check("C8", "Excel", "identidade", "Excel: nenhuma célula 'undefined'/'null'/'NaN' em nenhuma aba", suspeitosExcel.length === 0, suspeitosExcel.slice(0, 3).join(" | "));

  const dsA = await construirDatasetExportacao(loteCasos.id, "TODAS", undefined);
  if (dsA.ok) {
    const l19 = dsA.dataset.linhas.find((l) => l.rowNumber === 19)!;
    const l3 = dsA.dataset.linhas.find((l) => l.rowNumber === 3)!;
    const l17 = dsA.dataset.linhas.find((l) => l.rowNumber === 17)!;
    check("AUX", "Excel", "identidade", "Excel coerente com o dataset da ficha (razão/telefones/e-mail da linha 19)", textoCelula(linhaEx(19).getCell(4).value) === l19.razaoSocial && textoCelula(linhaEx(19).getCell(15).value) === l19.telefones.join(" · ") && textoCelula(linhaEx(19).getCell(16).value) === l19.email);
    check("C2", "Excel", "identidade", "Dataset: 32 representantes na linha 3 (mesma contagem da aba)", l3.representantes.length === 32);
    check("C5", "Excel", "identidade", "Dataset: 12 participantes de relações na linha 17; 1 compartilhado com a matriz (linha 5)", l17.relacoesConsultadas?.participantes.length === 12 && dsA.dataset.linhas.find((l) => l.rowNumber === 5)!.relacoesConsultadas?.participantes.length === 2);
  } else {
    check("AUX", "Excel", "identidade", "Dataset do lote de casos constrói OK", false, dsA.mensagem);
  }

  /* ================================================================
   * PDF DO LOTE — casos (escopo TODAS)
   * ================================================================ */
  console.log("\n--- PDF type=pdf_lote (lote de casos) ---");
  t0 = Date.now();
  const pdfLoteRes = await chamarGet(loteCasos.id, "type=pdf_lote&scope=TODAS");
  tempos.pdfLoteCasos = Date.now() - t0;
  salvar(DIR_CASOS, "pdf-lote-todas.pdf", pdfLoteRes.buf);
  const pdfLote = analisarPdf(pdfLoteRes.buf);
  check("AUX", "PDF(lote)", "colunas", "PDF lote: 200 + application/pdf + nome resumo-", pdfLoteRes.status === 200 && pdfLoteRes.contentType === "application/pdf" && pdfLoteRes.nome.startsWith("resumo-"));
  check("C1", "PDF(lote)", "pdf-layout", `PDF lote: ${pdfLote.paginas} páginas sem título órfão/página vazia/rodapé cobrindo`, pdfLote.problemas.length === 0, pdfLote.problemas.slice(0, 3).join(" | "));
  check("C1", "PDF(lote)", "identidade", "PDF lote: contagens oficiais (13 empresas distintas · 12 compatíveis · 1 linha em revisão)", pdfLote.texto.includes("13 empresas distintas") && pdfLote.texto.includes("12 empresas") && pdfLote.texto.includes("1 linha") && pdfLote.texto.includes("2 entradas"));
  check("C4", "PDF(lote)", "identidade", "PDF lote: raiz única para os 12 estabelecimentos (nota de contagem presente)", pdfLote.texto.includes("matriz e filiais da mesma raiz somam uma"));
  check("C6", "PDF(lote)", "identidade", "PDF lote: nome longo completo (quebra de linha sem cortar texto)", pdfLote.texto.includes(norm(NOME_LONGO)));
  check("C7", "PDF(lote)", "acentos", "PDF lote: acentos preservados (SÃO CRISTÓVÃO · AÇÚCAR · ÁLCOOL)", pdfLote.texto.includes("SÃO CRISTÓVÃO") && pdfLote.texto.includes("AÇÚCAR") && pdfLote.texto.includes("ÁLCOOL"));
  check("C9", "PDF(lote)", "honestidade", "PDF lote: seção de revisão com a empresa e a divergência descritas", pdfLote.texto.includes("CASOS EM REVISÃO") && pdfLote.texto.includes("ALFA CONSTRUTORA PREDIAL LTDA") && pdfLote.texto.includes("não aparece na razão social"));
  check("C9", "PDF(lote)", "honestidade", "PDF lote: seção de revisão explica que o registro não foi confirmado", pdfLote.texto.includes("O registro localizado ainda não foi confirmado"));
  check("C10", "PDF(lote)", "honestidade", "PDF lote: falhas listadas com motivo (linhas 23 e 24)", pdfLote.texto.includes("Linha 23") && pdfLote.texto.includes("Nenhum CNPJ descoberto") && pdfLote.texto.includes("Linha 24") && pdfLote.texto.includes("Não localizado nas fontes públicas"));
  const fmtR24 = formatCnpj(CNPJ_R24);
  const r24EmIdentificadas = pdfLote.texto.includes(fmtR24);
  check("C10", "PDF(lote)", "honestidade", "PDF lote: empresa NÃO ENCONTRADA ausente da lista de identificadas", !r24EmIdentificadas, `o CNPJ ${fmtR24} da linha não encontrada aparece na seção EMPRESAS IDENTIFICADAS`);
  if (r24EmIdentificadas) {
    achado({
      id: "F1",
      titulo: 'PDF do lote lista empresa NÃO ENCONTRADA na seção "Empresas identificadas"',
      severidade: "BUG",
      arquivo: "src/lib/export/pdf.ts:788",
      reproducao: "Lote com linha { cnpjStatus: VALIDA, normalizedCnpj: X, lookupStatus: NAO_ENCONTRADO } → GET /export?type=pdf_lote → seção EMPRESAS IDENTIFICADAS traz um bullet '— CNPJ <X formatado>' para esta linha. O filtro é `!l.emRevisao && l.cnpjFormatado`, mas cnpjFormatado é preenchido com o CNPJ PESQUISADO (dataset.ts:400-405 usa effRow.normalizedCnpj mesmo sem ficha) — a linha entra como se fosse empresa identificada (sem nome, só o CNPJ consultado).",
      evidencia: "qa/homolog-v0110/gate9/casos/pdf-lote-todas.pdf — seção EMPRESAS IDENTIFICADAS contém '92.929.292/0001-XX' (linha 24, NAO_ENCONTRADO)",
    });
  }
  const notasDisclaimers = ocorrencias(pdfLote.texto, "Os números deste relatório vêm da mesma contagem");
  check("AUX", "PDF(lote)", "pdf-layout", "PDF lote: nota de leitura UMA vez no documento (não por seção)", notasDisclaimers === 1, `${notasDisclaimers}`);

  /* ================================================================
   * PDF DA EMPRESA — casos por linha
   * ================================================================ */
  console.log("\n--- PDF type=pdf_empresa (casos por linha) ---");
  const casosPdf: { row: number; nivel?: "executivo"; arquivo: string; cenario: string }[] = [
    { row: 1, arquivo: "pdf-empresa-r01-minima.pdf", cenario: "C1" },
    { row: 3, arquivo: "pdf-empresa-r03-quadro-32.pdf", cenario: "C2" },
    { row: 3, nivel: "executivo", arquivo: "pdf-empresa-r03-quadro-32-executivo.pdf", cenario: "C2" },
    { row: 4, arquivo: "pdf-empresa-r04-cnaes-28.pdf", cenario: "C3" },
    { row: 17, arquivo: "pdf-empresa-r17-relacoes.pdf", cenario: "C5" },
    { row: 18, arquivo: "pdf-empresa-r18-nome-longo.pdf", cenario: "C6" },
    { row: 19, arquivo: "pdf-empresa-r19-acentos.pdf", cenario: "C7" },
    { row: 20, arquivo: "pdf-empresa-r20-injecao.pdf", cenario: "C7" },
    { row: 22, arquivo: "pdf-empresa-r22-revisao.pdf", cenario: "C9" },
    { row: 23, arquivo: "pdf-empresa-r23-ref-unresolved.pdf", cenario: "C10" },
    { row: 24, arquivo: "pdf-empresa-r24-nao-encontrado.pdf", cenario: "C10" },
    { row: 26, arquivo: "pdf-empresa-r26-leitura-ia.pdf", cenario: "AUX" },
  ];
  const analises = new Map<number, AnalisePdf>();
  const nomesPorLinha = new Map<number, string>();
  t0 = Date.now();
  for (const caso of casosPdf) {
    const qs = `type=pdf_empresa&row=${caso.row}${caso.nivel ? `&nivel=${caso.nivel}` : ""}`;
    const r = await chamarGet(loteCasos.id, qs);
    check(caso.cenario, "PDF(empresa)", "colunas", `PDF empresa linha ${caso.row}${caso.nivel ? ` (${caso.nivel})` : ""}: 200 + PDF`, r.status === 200 && r.contentType === "application/pdf", `status=${r.status}`);
    salvar(DIR_CASOS, caso.arquivo, r.buf);
    nomesPorLinha.set(caso.row, r.nome);
    const a = analisarPdf(r.buf);
    if (!caso.nivel) analises.set(caso.row, a);
    const rotulo = caso.nivel ? `${caso.row}-exec` : String(caso.row);
    check(caso.cenario, "PDF(empresa)", "pdf-layout", `PDF empresa linha ${rotulo}: ${a.paginas} página(s) sem órfão/vazia/rodapé invadido`, a.problemas.length === 0, a.problemas.slice(0, 2).join(" | "));
    const d = ocorrencias(a.texto, "Este documento não reconsultou fontes");
    check(caso.cenario, "PDF(empresa)", "pdf-layout", `PDF empresa linha ${rotulo}: ressalva de não-reconsulta UMA vez (não por seção)`, d === 1, `${d} ocorrências`);
    check(caso.cenario, "PDF(empresa)", "identidade", `PDF empresa linha ${rotulo}: sem 'undefined'/'null'/'NaN' no texto`, !/(^|\s)(undefined|null|NaN)(\s|$|,|\.)/.test(a.texto));
    if (caso.nivel === "executivo") analises.set(-caso.row, a);
  }
  tempos.pdfEmpresaCasos = Date.now() - t0;

  const txt = (n: number): string => analises.get(n)?.texto ?? "";

  // C1 — mínima
  check("C1", "PDF(empresa)", "identidade", "PDF mínima: identidade da própria empresa (razão + CNPJ)", txt(1).includes("MINIMA CADASTRO IDENTIDADE LTDA") && txt(1).includes(formatCnpj(CNPJ_R1)));
  check("C1", "PDF(empresa)", "identidade", "PDF mínima: sem seção de atividade (dado não existente não é inventado)", !txt(1).includes("Atividade cadastrada") && !txt(1).includes("NATUREZA JURÍDICA"));
  check("C1", "PDF(empresa)", "honestidade", "PDF mínima: contatos declaram 'Não informado.' (ausência explícita)", txt(1).includes("Não informado."));
  check("C1", "PDF(empresa)", "pdf-layout", "PDF mínima: dossiê estruturado mesmo com quase nada (abertura + fontes)", txt(1).includes("DOSSIÊ COMERCIAL DA EMPRESA") && txt(1).includes("Fonte principal:"));

  // C2 — quadro amplo
  check("C2", "PDF(empresa)", "identidade", "PDF completo: anexo de representantes lista os 32 sócios (sem corte)", txt(3).includes("SOCIO QUOTISTA 032"));
  const exe3An = analises.get(-3)!;
  check("C2", "PDF(empresa)", "identidade", "PDF executivo: 3 representantes na página + 'Os outros 29 estão no PDF completo'", exe3An.texto.includes("Os outros 29") && exe3An.texto.includes("PDF completo"));
  check("C2", "PDF(empresa)", "pdf-layout", "PDF executivo: SEM anexos e 1–2 páginas", !exe3An.texto.includes("ANEXO") && exe3An.paginas <= 2, `${exe3An.paginas} páginas`);

  // C3 — 28 CNAEs
  check("C3", "PDF(empresa)", "identidade", "PDF completo: 'Mais 28 atividades registradas' + as 28 listadas no anexo", txt(4).includes("Mais 28 atividades registradas") && txt(4).includes(cnaesSecR4[27]));

  // C5 — relações extensas
  check("C5", "PDF(empresa)", "identidade", "PDF: 4 participantes na visão + 'Os outros 8' no anexo de relações", txt(17).includes("Os outros 8 participantes"));
  check("C5", "PDF(empresa)", "identidade", "PDF: quadro do participante reconciliado (3 empresas × 9 estabelecimentos)", txt(17).includes("3 empresas") && txt(17).includes("9 estabelecimentos"));
  check("C5", "PDF(empresa)", "identidade", "PDF: grupos por raiz com '3 estabelecimentos desta empresa'", txt(17).includes("3 estabelecimentos desta empresa"));
  check("C5", "PDF(empresa)", "identidade", "PDF: participante compartilhado aparece no bloco de relações", txt(17).includes("PARTICIPANTE COMPARTILHADO UM"));

  // C6 — nome longo
  check("C6", "PDF(empresa)", "identidade", "PDF: nome de 300+ chars completo no título (texto extraído sem corte)", txt(18).includes(norm(NOME_LONGO)), `len extraída=${txt(18).length}`);
  check("C6", "PDF(empresa)", "identidade", "PDF: nome do arquivo sanitizado com a linha (ficha-...-linha-18)", (nomesPorLinha.get(18) ?? "").startsWith("ficha-") && (nomesPorLinha.get(18) ?? "").includes("linha-18"), nomesPorLinha.get(18) ?? "");

  // C7 — acentos / injeção
  check("C7", "PDF(empresa)", "acentos", "PDF: acentos da própria empresa (SÃO CRISTÓVÃO/AÇÚCAR/ÁLCOOL/Ébano)", txt(19).includes("SÃO CRISTÓVÃO") && txt(19).includes("AÇÚCAR") && txt(19).includes("ÁLCOOL") && txt(19).includes("Ébano & Ópera Café"));
  check("C7", "PDF(empresa)", "identidade", "PDF: dados da empresa CERTA (CNPJ próprio; CNPJ da vizinha ausente)", txt(19).includes(formatCnpj(CNPJ_R19)) && !txt(19).includes(formatCnpj(CNPJ_R18)));
  check("C6", "PDF(empresa)", "identidade", "PDF nome longo: dados da empresa certa (CNPJ próprio; CNPJ da acentuada ausente)", txt(18).includes(formatCnpj(CNPJ_R18)) && !txt(18).includes(formatCnpj(CNPJ_R19)));
  check("C7", "PDF(empresa)", "formulas", "PDF: título iniciado por '=' desenhado como texto inerte e COMPLETO", txt(20).includes("=INJECAO DE FORMULA COMERCIAL LTDA"));
  aviso("C7", "PDF(empresa)", "formulas", "pista/referência maliciosas não entram no pdf_empresa quando há CNPJ", `a pista original (=SOMA/+cmd/-calc/@SUM) e a referência =HYPERLINK só aparecem no pdf_empresa quando a linha NÃO tem CNPJ (pdf.ts:513 desenha 'Pista original' apenas nesse caso); na linha 20 o PDF mostra o CNPJ resolvido. Inofensivo (texto de PDF é inerte), mas o leitor do dossiê não vê a pista de origem.`);

  // C9 — revisão
  check("C9", "PDF(empresa)", "honestidade", "PDF: aviso 'Identidade em revisão' na abertura", txt(22).includes("Identidade em revisão"));
  check("C9", "PDF(empresa)", "honestidade", "PDF: divergência descrita no aviso (não aparece na razão social)", txt(22).includes("não aparece na razão social"));
  check("C9", "PDF(empresa)", "honestidade", "PDF: confirmação explícita como decisão do operador", txt(22).includes("A confirmação é sua decisão"));

  // C10 — não encontrado
  check("C10", "PDF(empresa)", "honestidade", "PDF referência UNRESOLVED: pista original exibida, sem CNPJ/razão inventados", txt(23).includes("Pista original: desconhecida-llc.com.br") && !txt(23).includes("RAZÃO SOCIAL"));
  check("C10", "PDF(empresa)", "honestidade", "PDF CNPJ não encontrado: nenhum dado cadastral inventado (sem razão/situação)", !txt(24).includes("MINIMA") && !txt(24).includes("Situação cadastral:"));
  aviso("C10", "PDF(empresa)", "honestidade", "PDF de não encontrado não declara a falha da consulta", `o dossiê da linha 24 mostra o CNPJ consultado como título, mas l.erro ("Não localizado nas fontes públicas") nunca é desenhado — o leitor não fica sabendo que a fonte não retornou. 'Atualizado em ' também sai com data vazia (dataColeta/dataConsulta nulos).`);

  // C26 — IA rotulada
  check("AUX", "PDF(empresa)", "honestidade", "PDF: leitura IA rotulada como hipótese, separada dos fatos", txt(26).includes("LEITURA EXECUTIVA (IA)") && txt(26).includes("Trate como hipótese"));
  check("AUX", "PDF(empresa)", "honestidade", "PDF: hipóteses listadas como itens a validar", txt(26).includes("Hipótese um"));

  /* ================================================================
   * C11 — SELEÇÃO DE EMPRESAS (rows=)
   * ================================================================ */
  console.log("\n--- C11: seleção rows=3,18,19 ---");
  const selCsv = await chamarGet(loteCasos.id, "type=result_selected&rows=3,18,19");
  salvar(DIR_CASOS, "selecionadas.csv", selCsv.buf);
  const selAberto = abrirCsv(selCsv.buf);
  const selLinhas = selAberto.dados.map((r) => Number(r[0]));
  check("C11", "CSV(seleção)", "selecao", "CSV selecionadas: EXATAMENTE as linhas 3, 18 e 19 (nenhuma a mais)", selCsv.status === 200 && selLinhas.length === 3 && [3, 18, 19].every((n) => selLinhas.includes(n)), JSON.stringify(selLinhas));
  check("C11", "CSV(seleção)", "selecao", "CSV selecionadas: nome do arquivo 'selecionadas-'", selCsv.nome.startsWith("selecionadas-"));

  const selEx = await chamarGet(loteCasos.id, "type=excel&scope=SELECIONADAS&rows=3,18,19");
  salvar(DIR_CASOS, "excel-selecionadas.xlsx", selEx.buf);
  const wbSel = await abrirExcel(selEx.buf);
  const empSel = wbSel.getWorksheet("Empresas")!;
  const selLinhasExcel = Array.from({ length: empSel.rowCount - 1 }, (_, i) => Number(empSel.getRow(i + 2).getCell(1).value));
  check("C11", "Excel(seleção)", "selecao", "Excel SELECIONADAS: 3 empresas (3, 18, 19) e nenhuma aba Revisões", selLinhasExcel.length === 3 && [3, 18, 19].every((n) => selLinhasExcel.includes(n)) && !wbSel.getWorksheet("Revisões"), JSON.stringify(selLinhasExcel));
  const repSel = wbSel.getWorksheet("Representantes e relações");
  const repSelCount = repSel ? repSel.rowCount - 1 : 0;
  check("C11", "Excel(seleção)", "selecao", "Excel SELECIONADAS: representantes só da linha 3 (32 vínculos)", repSelCount === 32, `${repSelCount}`);
  check("C11", "Excel(seleção)", "selecao", "Excel SELECIONADAS: nome do arquivo com sufixo 'selecionadas'", selEx.nome.includes("selecionadas"));

  const selPdf = await chamarGet(loteCasos.id, "type=pdf_lote&scope=SELECIONADAS&rows=3,18,19");
  salvar(DIR_CASOS, "pdf-lote-selecionadas.pdf", selPdf.buf);
  const selPdfAn = analisarPdf(selPdf.buf);
  check("C11", "PDF(lote-seleção)", "selecao", "PDF lote SELECIONADAS: cobre 3 entradas e declara o total do lote (26)", selPdfAn.texto.includes("3 entradas") && selPdfAn.texto.includes("o lote completo tem 26"));
  check("C11", "PDF(lote-seleção)", "selecao", "PDF lote SELECIONADAS: as 3 empresas da seleção presentes, as outras ausentes", selPdfAn.texto.includes("QUADRO AMPLIO") && selPdfAn.texto.includes(norm(NOME_LONGO)) && selPdfAn.texto.includes("SÃO CRISTÓVÃO") && !selPdfAn.texto.includes("ALFA CONSTRUTORA"));
  check("C11", "PDF(lote-seleção)", "pdf-layout", "PDF lote SELECIONADAS: layout íntegro (sem órfãos/vazias/rodapé)", selPdfAn.problemas.length === 0, selPdfAn.problemas.slice(0, 2).join(" | "));
  if (selPdfAn.problemas.some((p) => p.includes("órfão"))) {
    achado({
      id: "F4",
      titulo: "Título de seção órfão no pé da página (Notas de leitura) — bullets() faz flushTitulo ANTES de garantir o grupo inteiro",
      severidade: "BUG",
      arquivo: "src/lib/export/pdf.ts:302-310 (bullets)",
      reproducao: "GET /api/imports/{lote}/export?type=pdf_lote&scope=SELECIONADAS&rows=3,18,19 com o lote de casos (26 linhas): a seção 'Notas de leitura' cai no pé da página 1 (título + número '4' como ÚLTIMO conteúdo) e os 4 bullets vão todos para a página 2. Mecanismo: secao() deixa o título PENDENTE; bullets() chama flushTitulo(primeiro item ≈58pt) — cabe — desenha o título; SÓ DEPOIS garante(altura do grupo inteiro ≈66pt) quebra a página, abandonando o título. O fix v0.10.18 protegeu título+primeira fatia, mas não título+grupo pequeno (≤6 itens) que fica junto.",
      evidencia: "qa/homolog-v0110/gate9/casos/pdf-lote-selecionadas.pdf (p1 termina em 'NOTAS DE LEITURA'; p2 abre com os 4 bullets) + png/pdf-lote-selecionadas-1.png",
    });
  }

  // POST = mesmo contrato do GET (paridade de seleção)
  const selPost = await chamarPost(loteCasos.id, { type: "result_selected", rows: [3, 18, 19] });
  check("C11", "CSV(seleção)", "selecao", "POST com seleção no corpo devolve byte-a-byte o mesmo CSV do GET", selPost.status === 200 && selPost.buf.equals(selCsv.buf));

  // guardas de seleção
  const semSel = await chamarGet(loteCasos.id, "type=result_selected");
  check("C11", "CSV(seleção)", "selecao", "Seleção vazia recusa com NO_SELECTION (422)", semSel.status === 422 && (semSel.json as { error?: { code?: string } })?.error?.code === "NO_SELECTION", `status=${semSel.status}`);
  const selInexistente = await chamarGet(loteCasos.id, "type=result_selected&rows=999,998");
  check("C11", "CSV(seleção)", "selecao", "Seleção de linhas inexistentes recusa (422, nunca exporta vazio)", selInexistente.status === 422, `status=${selInexistente.status}`);
  const selAcima = await chamarPost(loteCasos.id, { type: "result_selected", rows: Array.from({ length: 5001 }, (_, i) => i + 1) });
  const jAcima = selAcima.json as { error?: { code?: string; message?: string } } | null;
  check("C11", "CSV(seleção)", "selecao", "Seleção acima de 5000 recusa ANTES com SELECAO_ACIMA_DO_LIMITE (413)", selAcima.status === 413 && jAcima?.error?.code === "SELECAO_ACIMA_DO_LIMITE" && /limite seguro/.test(jAcima?.error?.message ?? ""), `status=${selAcima.status}`);

  /* ================================================================
   * TIPOS AUXILIARES (summary, teia, ai, pending, audit, telemetria)
   * ================================================================ */
  console.log("\n--- Tipos auxiliares ---");
  const sumRes = await chamarGet(loteCasos.id, "type=summary");
  salvar(DIR_CASOS, "summary.json", sumRes.buf);
  const sum = sumRes.json as Record<string, never> | null;
  const cont = ((sum as unknown as { contagens?: Record<string, number> })?.contagens ?? {});
  const resId = ((sum as unknown as { resolucao_identidade?: { pessoas_juridicas?: { localizadas?: number; identificadas?: number }; revisao?: { linhas?: number } } })?.resolucao_identidade ?? {});
  check("AUX", "summary", "identidade", "summary.json: contagens coerentes (26 linhas · 24 enriquecidos · 13 raízes · 1 revisão)", sumRes.status === 200 && cont.linhas === 26 && cont.enriquecidos === 24 && resId.pessoas_juridicas?.localizadas === 13 && resId.revisao?.linhas === 1, JSON.stringify(cont));
  check("AUX", "summary", "colunas", "summary.json: nota de encoding documenta o escape anti-injeção CSV", JSON.stringify(sum).includes("são prefixados com '"));

  const teiaRes = await chamarGet(loteCasos.id, "type=teia");
  salvar(DIR_CASOS, "teia-societaria.csv", teiaRes.buf);
  const teia = abrirCsv(teiaRes.buf);
  check("C2", "CSV(teia)", "identidade", "teia: UMA LINHA POR SÓCIO — 34 vínculos (32 da linha 3 + 2 da linha 17), sem corte", teiaRes.status === 200 && teia.dados.length === 34, `${teia.dados.length}`);
  const teiaTexto = teiaRes.buf.toString("utf8");
  check("C2", "CSV(teia)", "identidade", "teia: sócio nº 32 presente (completo, contrasta com o corte do CSV result)", teiaTexto.includes("SOCIO QUOTISTA 032"));

  const aiRes = await chamarGet(loteCasos.id, "type=ai");
  salvar(DIR_CASOS, "inteligencia.csv", aiRes.buf);
  const ai = abrirCsv(aiRes.buf);
  check("AUX", "CSV(ia)", "colunas", "CSV ia: 1 linha com leitura executiva", aiRes.status === 200 && ai.dados.length === 1, `${ai.dados.length} linha(s)`);
  const aiTemHipoteses = aiRes.buf.toString("utf8").includes("Hipótese um");
  check("AUX", "CSV(ia)", "honestidade", "CSV ia: hipóteses a validar presentes (coluna hipoteses_a_validar)", aiTemHipoteses, "coluna vazia mesmo com aiHypothesesJson populado (route.ts:502 usa safeArray, que filtra strings)");
  if (!aiTemHipoteses) {
    achado({
      id: "F5",
      titulo: "CSV type=ai perde TODAS as hipóteses comerciais — safeArray filtra arrays de strings",
      severidade: "BUG",
      arquivo: "src/app/api/imports/[id]/export/route.ts:502",
      reproducao: "Lote com linha ENRIQUECIDA, aiStatus=OK, aiReading e aiHypothesesJson=[\"Hipótese um...\",\"Hipótese dois...\"] (o formato REAL que o engine grava: engine.ts:1586 faz JSON.stringify(res.hypotheses) com hypotheses: string[] — ai.ts:467) → GET /export?type=ai → a coluna hipoteses_a_validar sai SEMPRE vazia. A guarda é `safeArray(e.aiHypothesesJson).length > 0 ? safeHypotheses(...)` — mas safeArray (route.ts:675) só aceita elementos OBJETO (filter typeof s === 'object'), então para array de strings devolve [] e o ramo nunca executa. safeHypotheses parsearia o array de strings corretamente — nunca é chamado. Perda silenciosa: as hipóteses existem no banco, aparecem no PDF (anexo E via dataset) e somem da planilha de inteligência.",
      evidencia: "qa/homolog-v0110/gate9/casos/inteligencia.csv (linha 26: colunas 11–16 vazias) vs qa/homolog-v0110/gate9/casos/pdf-empresa-r26-leitura-ia.pdf (anexo com 'Hipótese um')",
    });
  }

  const pendRes = await chamarGet(loteCasos.id, "type=pending");
  salvar(DIR_CASOS, "pendentes.csv", pendRes.buf);
  const pend = abrirCsv(pendRes.buf);
  check("C10", "CSV(pendentes)", "honestidade", "pending: 2 pendências (23 e 24) com motivo, sem dados inventados", pendRes.status === 200 && pend.dados.length === 2 && pendRes.buf.toString("utf8").includes("Não localizado nas fontes públicas"));

  const auditRes = await chamarGet(loteCasos.id, "type=audit");
  salvar(DIR_CASOS, "audit.jsonl", auditRes.buf);
  const auditLinhas = auditRes.buf.toString("utf8").split("\n").filter((l) => l.trim());
  let auditOk = auditLinhas.length >= 5;
  const auditParse = auditLinhas.every((l) => {
    try {
      JSON.parse(l);
      return true;
    } catch {
      return false;
    }
  });
  auditOk = auditOk && auditParse && auditRes.buf.toString("utf8").includes('"EXPORT"');
  check("AUX", "audit", "colunas", "audit.jsonl: eventos EXPORT registrados e cada linha é JSON válido", auditOk, `${auditLinhas.length} eventos`);

  const telRes = await chamarGet(loteCasos.id, "type=telemetria");
  check("AUX", "telemetria", "colunas", "telemetria: 200 com corpo vazio aceitável (lote sem telemetria)", telRes.status === 200);

  const badType = await chamarGet(loteCasos.id, "type=inexistente");
  check("AUX", "erros", "colunas", "type inválido recusa com BAD_TYPE (422)", badType.status === 422 && (badType.json as { error?: { code?: string } })?.error?.code === "BAD_TYPE");
  const badRow = await chamarGet(loteCasos.id, "type=pdf_empresa");
  check("AUX", "erros", "colunas", "pdf_empresa sem &row recusa com BAD_ROW (422)", badRow.status === 422 && (badRow.json as { error?: { code?: string } })?.error?.code === "BAD_ROW");
  const row404 = await chamarGet(loteCasos.id, "type=pdf_empresa&row=999");
  check("AUX", "erros", "colunas", "pdf_empresa de linha inexistente recusa NOT_FOUND (404)", row404.status === 404);

  /* ---------- regra de ouro após o lote de casos ---------- */
  check("GOLDEN", "todas", "sem-rede", "ZERO chamadas HTTP durante TODAS as exportações do lote de casos (fetch guardado)", httpChamadas.length === 0, httpChamadas.slice(0, 3).join(" | "));

  /* ================================================================
   * C12 — LOTE DE CARGA 2000
   * ================================================================ */
  console.log("\n--- C12: lote de carga 2000 ---");
  t0 = Date.now();
  const csv2k = await chamarGet(loteCarga.id, "type=result");
  tempos.csvCarga2000 = Date.now() - t0;
  salvar(DIR_CARGA, "resultado-todas.csv", csv2k.buf);
  const csv2kAb = abrirCsv(csv2k.buf);
  const ids2k = new Set(csv2kAb.dados.map((r) => Number(r[0])));
  check("C12", "CSV", "volume", `CSV 2000: 2000 linhas de dados (${tempos.csvCarga2000} ms, ${(csv2k.buf.length / 1024).toFixed(0)} KB)`, csv2k.status === 200 && csv2kAb.dados.length === 2000 && ids2k.size === 2000 && ids2k.has(1) && ids2k.has(2000), `${csv2kAb.dados.length} linhas`);
  check("C12", "CSV", "volume", "CSV 2000: todas as linhas com 53 colunas (2 originais + 50 derivadas)", csv2kAb.dados.every((r) => r.length === 53));
  check("C12", "CSV", "identidade", "CSV 2000: linha 1 PENDENTE · linha 1781 ENRIQUECIDO · linha 1961 LOCALIZADO · linha 2000 RATE_LIMITED", col(csv2kAb, 1, "status_enriquecimento") === "PENDENTE" && col(csv2kAb, 1781, "status_enriquecimento") === "ENRIQUECIDO" && col(csv2kAb, 1961, "etapa_identidade") === "LOCALIZADO" && col(csv2kAb, 2000, "erro").includes("429"));
  check("C12", "CSV", "honestidade", "CSV 2000: não encontradas com erro e sem razão social", col(csv2kAb, 1985, "razao_social") === "" && col(csv2kAb, 1985, "erro") === "Não localizado nas fontes públicas");

  t0 = Date.now();
  const rev2k = await chamarGet(loteCarga.id, "type=result_review");
  salvar(DIR_CARGA, "revisoes.csv", rev2k.buf);
  const rev2kAb = abrirCsv(rev2k.buf);
  check("C12", "CSV(revisões)", "honestidade", "CSV result_review: exatamente as 20 linhas em revisão (1961–1980)", rev2k.status === 200 && rev2kAb.dados.length === 20 && rev2kAb.dados.every((r) => Number(r[0]) >= 1961 && Number(r[0]) <= 1980), `${rev2kAb.dados.length} linhas (${Date.now() - t0} ms)`);

  t0 = Date.now();
  const ex2k = await chamarGet(loteCarga.id, "type=excel&scope=TODAS");
  tempos.excelCarga2000 = Date.now() - t0;
  salvar(DIR_CARGA, "excel-todas.xlsx", ex2k.buf);
  const wb2k = await abrirExcel(ex2k.buf);
  const emp2k = wb2k.getWorksheet("Empresas")!;
  check("C12", "Excel", "volume", `Excel 2000: 2000 empresas na aba (${tempos.excelCarga2000} ms, ${(ex2k.buf.length / 1024).toFixed(0)} KB)`, ex2k.status === 200 && emp2k.rowCount - 1 === 2000, `${emp2k.rowCount - 1}`);
  check("C12", "Excel", "colunas", "Excel 2000: cabeçalho completo nas 23 colunas", JSON.stringify(emp2k.getRow(1).values.slice(1)) === JSON.stringify(CABECALHO_ESPERADO));
  const resumo2k = wb2k.getWorksheet("Resumo")!;
  const val2k = new Map<string, string | number>();
  for (let r = 1; r <= resumo2k.rowCount; r++) {
    const k = resumo2k.getRow(r).getCell(1).value;
    if (typeof k === "string") val2k.set(k, resumo2k.getRow(r).getCell(2).value as string | number);
  }
  check("C12", "Excel", "volume", "Excel 2000 Resumo: 2000 entradas · 200 raízes · 180 compatíveis · 20 revisão · 20 falhas", val2k.get("Entradas recebidas") === 2000 && val2k.get("Empresas localizadas (raízes distintas)") === 200 && val2k.get("Pessoas jurídicas compatíveis com as pistas") === 180 && val2k.get("Linhas aguardando revisão humana") === 20 && val2k.get("Entradas com falha de consulta") === 20, `${val2k.get("Empresas localizadas (raízes distintas)")}/${val2k.get("Linhas aguardando revisão humana")}`);
  check("C12", "Excel", "volume", "Excel 2000: tempo de geração dentro do teto da VM (< 120 s)", tempos.excelCarga2000 < 120000, `${tempos.excelCarga2000} ms`);

  const pdf2kErro = await chamarGet(loteCarga.id, "type=pdf_lote&scope=TODAS");
  const j2k = pdf2kErro.json as { error?: { code?: string; message?: string } } | null;
  salvar(DIR_CARGA, "pdf-lote-todas-recusa-413.json", pdf2kErro.buf);
  check("C12", "PDF(lote)", "volume", "PDF lote com 2000 entradas: recusa ANTES com PDF_LIMITE orientando Excel (413)", pdf2kErro.status === 413 && j2k?.error?.code === "PDF_LIMITE" && /Excel/.test(j2k?.error?.message ?? ""), `status=${pdf2kErro.status}`);

  t0 = Date.now();
  const pdf2kRev = await chamarGet(loteCarga.id, "type=pdf_lote&scope=EM_REVISAO");
  tempos.pdfLoteRevisao2000 = Date.now() - t0;
  salvar(DIR_CARGA, "pdf-lote-em-revisao.pdf", pdf2kRev.buf);
  const pdf2kRevAn = analisarPdf(pdf2kRev.buf);
  check("C12", "PDF(lote)", "volume", `PDF lote EM_REVISAO: 200 dentro do limite (${tempos.pdfLoteRevisao2000} ms)`, pdf2kRev.status === 200 && pdf2kRevAn.paginas >= 1);
  check("C12", "PDF(lote)", "honestidade", "PDF lote EM_REVISAO: 20 linhas de revisão + cobertura declarada (20 de 2000)", pdf2kRevAn.texto.includes("20 linhas") && pdf2kRevAn.texto.includes("20 entradas") && pdf2kRevAn.texto.includes("o lote completo tem 2000"));
  check("C12", "PDF(lote)", "honestidade", "PDF lote EM_REVISAO: primeiros e últimos casos presentes (Linha 1961 e 1980)", pdf2kRevAn.texto.includes("Linha 1961") && pdf2kRevAn.texto.includes("Linha 1980"));
  check("C12", "PDF(lote)", "pdf-layout", "PDF lote EM_REVISAO: sem órfãos/vazias/rodapé invadido no volume", pdf2kRevAn.problemas.length === 0, pdf2kRevAn.problemas.slice(0, 3).join(" | "));

  /* ---------- regra de ouro final ---------- */
  check("GOLDEN", "todas", "sem-rede", "ZERO chamadas HTTP na suíte inteira (lote de casos + carga 2000 + auxiliares)", httpChamadas.length === 0, `${httpChamadas.length} tentativa(s): ${httpChamadas.slice(0, 3).join(" | ")}`);

  /* ================================================================
   * RENDERIZAÇÃO VISUAL (pdftoppm) — todas as páginas dos PDFs de casos
   * ================================================================ */
  try {
    const arquivosPdf = artefatos.filter((a) => a.endsWith(".pdf")).map((a) => join(RAIZ, a));
    for (const f of arquivosPdf) {
      const base = f.split("/").pop()!.replace(/\.pdf$/, "");
      execSync(`pdftoppm -png -r 60 "${f}" "${join(DIR_PNG, base)}"`, { timeout: 60000, stdio: "pipe" });
    }
    console.log(`\n[render] pdftoppm: ${arquivosPdf.length} PDFs renderizados em qa/homolog-v0110/gate9/casos/png/`);
  } catch (e) {
    console.log(`[render] pdftoppm indisponível (não fatal): ${String(e).slice(0, 80)}`);
  }

  /* ================================================================
   * RELATÓRIOS
   * ================================================================ */
  const CATEGORIAS = ["identidade", "colunas", "formulas", "acentos", "pdf-layout", "honestidade", "selecao", "volume", "sem-rede"];
  interface Celula {
    cenario: string;
    tipo: string;
    categorias: { cat: string; status: Status }[];
  }
  const celulas = new Map<string, Celula>();
  for (const r of registros) {
    const key = `${r.cenario}::${r.tipo}`;
    const c = celulas.get(key) ?? { cenario: r.cenario, tipo: r.tipo, categorias: [] };
    const existente = c.categorias.find((x) => x.cat === r.categoria);
    const pior = (a?: Status, b?: Status): Status => (a === "FAIL" || b === "FAIL" ? "FAIL" : a === "WARN" || b === "WARN" ? "WARN" : "PASS");
    if (existente) existente.status = pior(existente.status, r.status);
    else c.categorias.push({ cat: r.categoria, status: r.status });
    celulas.set(key, c);
  }

  const linhasRelatorio: string[] = [];
  linhasRelatorio.push("=".repeat(100));
  linhasRelatorio.push("GATE 9 (HOMOLOG-D2) — EXPORTAÇÕES SOB ESTRESSE — Scout 360 v0.11.0");
  linhasRelatorio.push(`Gerado em ${new Date().toISOString()} · banco isolado ${DB_ISOLADO} · rede: fetch global bloqueado (0 chamadas: ${httpChamadas.length})`);
  linhasRelatorio.push("Reexecução: bun scripts/test-homolog-exportacoes-estresse.ts");
  linhasRelatorio.push("=".repeat(100));
  linhasRelatorio.push("");
  linhasRelatorio.push("MATRIZ CENÁRIO × TIPO DE EXPORTAÇÃO (pior status por categoria)");
  linhasRelatorio.push("-".repeat(100));
  for (const [key, c] of celulas) {
    const cats = CATEGORIAS.filter((cat) => c.categorias.some((x) => x.cat === cat)).map((cat) => {
      const st = c.categorias.find((x) => x.cat === cat)!.status;
      return `${cat}:${st}`;
    });
    linhasRelatorio.push(`${(NOMES_CENARIOS[c.cenario] ?? c.cenario).padEnd(46)} | ${(c.tipo + " ").slice(0, 18).padEnd(18)} | ${cats.join(" · ")}`);
  }
  linhasRelatorio.push("");
  linhasRelatorio.push(`RESULTADO: ${pass} PASS · ${fail} FAIL · ${warn} WARN`);
  linhasRelatorio.push("");
  linhasRelatorio.push("ACHADOS (bugs com reprodução exata — NÃO corrigidos neste gate)");
  linhasRelatorio.push("-".repeat(100));
  if (achados.length === 0) linhasRelatorio.push("(nenhum)");
  for (const a of achados) {
    linhasRelatorio.push(`[${a.severidade}] ${a.id} — ${a.titulo}`);
    linhasRelatorio.push(`  arquivo: ${a.arquivo}`);
    linhasRelatorio.push(`  reprodução: ${a.reproducao}`);
    linhasRelatorio.push(`  evidência: ${a.evidencia}`);
    linhasRelatorio.push("");
  }
  linhasRelatorio.push("TEMPOS");
  linhasRelatorio.push("-".repeat(100));
  for (const [k, v] of Object.entries(tempos)) linhasRelatorio.push(`  ${k}: ${v} ms`);
  linhasRelatorio.push("");
  linhasRelatorio.push(`ARTEFATOS (${artefatos.length})`);
  linhasRelatorio.push("-".repeat(100));
  for (const a of artefatos) linhasRelatorio.push(`  ${a}`);
  writeFileSync(join(DIR_EVID, "relatorio.txt"), linhasRelatorio.join("\n") + "\n");

  writeFileSync(
    join(DIR_EVID, "relatorio.json"),
    JSON.stringify(
      {
        task: "HOMOLOG-D2 Gate 9 — Exportações sob estresse",
        geradoEm: new Date().toISOString(),
        banco: DB_ISOLADO,
        lotes: { casos: loteCasos.id, carga2000: loteCarga.id },
        reexecucao: "bun scripts/test-homolog-exportacoes-estresse.ts",
        goldenRule: { chamadasHttp: httpChamadas.length, urls: httpChamadas },
        resumo: { pass, fail, warn },
        tempos,
        achados,
        matriz: [...celulas.values()],
        checks: registros,
        artefatos,
      },
      null,
      2
    )
  );

  console.log(`\n${"=".repeat(64)}`);
  console.log(`RESULTADO: ${pass} PASS · ${fail} FAIL · ${warn} WARN`);
  console.log(`Achados: ${achados.length} (${achados.filter((a) => a.severidade === "BUG").length} bugs)`);
  if (fail > 0) {
    console.log("FALHAS:");
    for (const r of registros.filter((x) => x.status === "FAIL")) console.log(`  - [${r.cenario}/${r.tipo}] ${r.check}${r.detalhe ? ` — ${r.detalhe}` : ""}`);
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("ERRO FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.$disconnect();
    } catch {
      /* banco isolado — nada a fazer */
    }
  });
