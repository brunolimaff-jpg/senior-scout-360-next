/**
 * export/pdf.ts — PDF COMERCIAL (v0.10.17): DOSSIÊ EXECUTIVO da empresa + resumo do lote.
 *
 * Motor de leiaute próprio sobre pdf-lib (sem rede, sem IA, sem reconsulta):
 * - A4, margens fixas, quebra de texto por palavra com fallback por caractere.
 * - Paginação com rodapé "Página X de Y" e proteção contra página órfã e
 *   seção quebrada (título nunca fica sozinho no pé da página).
 * - Identidade visual Scout 360 + Senior (azul #0B2545, verde #00968C).
 * - MODELO ficha-comercial v3 (dossiê executivo):
 *     Abertura (marca + identidade da empresa + data discreta) →
 *     1 Visão empresarial (atividade cadastrada, cadastrais, contatos) →
 *     2 Pessoas e relações (representantes + relações EFETIVAMENTE consultadas,
 *       com distinção empresa × estabelecimento) →
 *     3 O que vale investigar (até 4 prioridades com a próxima ação) →
 *     Fonte e atualização (bloco discreto, categoria + data; detalhe técnico
 *       de provedor NÃO entra no PDF — fica na planilha de evidências) →
 *     Anexos opcionais (A atividades, B representantes, C relações em detalhe,
 *       D o que falta, E leitura de IA como hipótese).
 * - Ressalva perto do dado só quando muda a interpretação comercial (ex.:
 *   divergência de identidade em caixa na abertura). O resto vira proveniência
 *   organizada ao final, sem parágrafo defensivo.
 * - Nenhum cartão ou texto cortado: tudo quebra; página nova quando não cabe.
 * - Provedores (BrasilAPI, MinhaReceita, ReceitaWS...) ficam FORA do documento
 *   comercial; a proveniência técnica completa segue na exportação de evidências.
 * - Conteúdo de IA aparece SEMPRE rotulado como hipótese, separado dos fatos.
 * - Lote muito grande: falha CLARAMENTE orientando o Excel (nunca documento incompleto).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatCnpj } from "@/lib/cnpj";
import { categoriaDeFonte } from "@/lib/fontes-apresentacao";
import { appVersion } from "@/lib/version";
import { ESTADO_LACUNA_COMERCIAL, regimeTributarioLegivel, tipoParticipanteLegivel, plural } from "@/lib/linguagem";
import type { DatasetExport, LinhaExport } from "./dataset";
import { dataCadastro } from "./dataset";

const AZUL = rgb(0x0b / 255, 0x25 / 255, 0x45 / 255);
const TEAL = rgb(0x00 / 255, 0x96 / 255, 0x8c / 255);
const TEAL_ESCURO = rgb(0x08 / 255, 0x6b / 255, 0x6b / 255);
const CINZA = rgb(0x55 / 255, 0x5f / 255, 0x6d / 255);
const CINZA_CLARO = rgb(0xe8 / 255, 0xec / 255, 0xf0 / 255);
const ATENCAO = rgb(0x8a / 255, 0x6d / 255, 0x00 / 255);

const A4 = { w: 595.28, h: 841.89 };
const MARGEM = 54;
const LARGURA_UTIL = A4.w - MARGEM * 2;

/** Limite seguro do PDF de lote — acima disso orienta o Excel (nunca PDF incompleto). */
export const LIMITE_PDF_LOTE = 300;

export class PdfLimiteError extends Error {
  codigo = "PDF_LIMITE";
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PdfLimiteError";
  }
}

/** Caracteres fora do WinAnsi (fontes padrão) quebram a codificação — transliteração segura. */
const TRANSLIT: Record<string, string> = {
  "—": "-", "–": "-", "·": "·", "•": "-", "…": "...", "’": "'", "‘": "'", "“": '"', "”": '"',
  "™": "TM", "€": "R$", "→": "->", "✓": "OK", "×": "x", "‑": "-", " ": " ",
};
function win(texto: string): string {
  let out = "";
  for (const ch of texto ?? "") {
    const code = ch.codePointAt(0) ?? 0;
    if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (code === 10 || code === 9) out += " ";
    else if (code < 256) out += ch;
    else if (code >= 0x2000 && code <= 0x206f) out += " "; // pontuação exótica
    else out += ""; // emoji e fora do WinAnsi: removido (nunca quebra o arquivo)
  }
  return out;
}

interface OpTexto {
  fonte?: "normal" | "bold";
  tamanho?: number;
  cor?: ReturnType<typeof rgb>;
  recuo?: number;
  espacoAntes?: number;
  espacoDepois?: number;
  largura?: number;
}

/** Motor de leiaute: páginas A4, quebra garantida, rodapé com paginação. */
class PdfDoc {
  private doc!: PDFDocument;
  private fontN!: PDFFont;
  private fontB!: PDFFont;
  private page!: PDFPage;
  private y = 0;
  private paginas: PDFPage[] = [];
  private contadorSecao = 0;
  private contadorAnexo = 0;
  /** Título registrado e ainda não desenhado — viaja com o primeiro conteúdo
   *  (v0.10.18: o título só sai junto com a primeira fatia do bloco seguinte,
   *  nunca órfão no pé da página). */
  private tituloPendente: { desenhar: () => void } | null = null;

  static async criar(titulo: string, subtitulo: string): Promise<PdfDoc> {
    const d = new PdfDoc();
    d.doc = await PDFDocument.create();
    d.doc.setTitle(win(`Scout 360 — ${titulo}`));
    d.doc.setAuthor("Scout 360 (Senior)");
    d.doc.setSubject(win(subtitulo));
    d.fontN = await d.doc.embedFont(StandardFonts.Helvetica);
    d.fontB = await d.doc.embedFont(StandardFonts.HelveticaBold);
    d.novaPagina(true);
    return d;
  }

  private novaPagina(cap = false): void {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.paginas.push(this.page);
    this.y = A4.h - MARGEM;
    if (cap) this.cabecalho();
  }

  /** Cabeçalho de marca — só na primeira página. */
  private cabecalho(): void {
    const p = this.page;
    p.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: TEAL });
    p.drawText("SCOUT 360", { x: MARGEM, y: this.y - 14, size: 16, font: this.fontB, color: AZUL });
    const w = this.fontB.widthOfTextAtSize("SCOUT 360", 16);
    p.drawText("  ·  Senior — inteligência comercial", { x: MARGEM + w, y: this.y - 14, size: 10, font: this.fontN, color: CINZA });
    this.y -= 30;
    p.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4.w - MARGEM, y: this.y }, thickness: 0.8, color: CINZA_CLARO });
    this.y -= 16;
  }

  private garante(alturaNecessaria: number): void {
    if (this.y - alturaNecessaria < MARGEM + 40) this.novaPagina();
  }

  /**
   * v0.10.18 — FIX DE TÍTULO ÓRFÃO. Desenha o título pendente ANTES do
   * primeiro conteúdo, garantindo que título + primeira fatia do bloco caibam
   * JUNTOS. Se não couberem, quebra de página ANTES de desenhar: o título
   * viaja para o topo da página nova acompanhando o conteúdo. Sem este
   * mecanismo, o bloco seguinte quebrava sozinho e deixava o título sozinho
   * no pé da página (defeito comprovado nos anexos C dos casos Brasil Digital
   * e Yorozu da v0.10.17).
   */
  private flushTitulo(alturaPrimeiraFatia = 0): void {
    if (!this.tituloPendente) return;
    const desenhar = this.tituloPendente.desenhar;
    this.tituloPendente = null;
    const necessario = 36 + 8 + Math.min(Math.max(alturaPrimeiraFatia, 0), 210);
    if (this.y - necessario < MARGEM + 40) this.novaPagina();
    desenhar();
  }

  /**
   * v0.10.17 — reserva pública de altura ANTES de um bloco composto (anexo +
   * primeiro conteúdo). Garante que um bloco pequeno nunca se parta deixando
   * só o título (ou uma linha solta) no pé de uma página.
   */
  reserva(altura: number): void {
    this.garante(altura);
  }

  /** Filete horizontal discreto. */
  divisor(cor = CINZA_CLARO, espacoAntes = 10, espacoDepois = 8): void {
    this.garante(espacoAntes + 2);
    this.y -= espacoAntes;
    this.page.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4.w - MARGEM, y: this.y }, thickness: 0.8, color: cor });
    this.y -= espacoDepois;
  }

  /** Texto com quebra de palavra (fallback por caractere para URLs longos). */
  texto(t: string, op: OpTexto = {}): void {
    const fonte = op.fonte === "bold" ? this.fontB : this.fontN;
    const tamanho = op.tamanho ?? 10;
    const cor = op.cor ?? rgb(0.13, 0.16, 0.2);
    const recuo = op.recuo ?? 0;
    const largura = (op.largura ?? LARGURA_UTIL) - recuo;
    // v0.10.18: título pendente desenha junto com as duas primeiras linhas
    this.flushTitulo(2 * tamanho * 1.42);
    if (op.espacoAntes) this.y -= op.espacoAntes;
    for (const linhaBruta of win(t).split("\n")) {
      for (const linha of this.quebrar(linhaBruta, fonte, tamanho, largura)) {
        this.garante(tamanho + 4);
        this.page.drawText(linha, { x: MARGEM + recuo, y: this.y - tamanho, size: tamanho, font: fonte, color: cor });
        this.y -= tamanho * 1.42;
      }
    }
    if (op.espacoDepois) this.y -= op.espacoDepois;
  }

  private quebrar(t: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
    if (!t) return [""];
    if (fonte.widthOfTextAtSize(t, tamanho) <= largura) return [t];
    const palavras = t.split(/\s+/);
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual) linhas.push(atual);
      if (fonte.widthOfTextAtSize(p, tamanho) <= largura) {
        atual = p;
        continue;
      }
      // palavra maior que a linha: corta por caractere (URL, identificador)
      let pedaco = "";
      for (const ch of p) {
        if (fonte.widthOfTextAtSize(pedaco + ch, tamanho) > largura) {
          linhas.push(pedaco);
          pedaco = ch;
        } else pedaco += ch;
      }
      atual = pedaco;
    }
    if (atual) linhas.push(atual);
    return linhas.length > 0 ? linhas : [""];
  }

  /** Título de seção numerado com filete teal. v0.10.18: o título fica
   *  PENDENTE até o primeiro conteúdo seguinte — ele desenha junto com esse
   *  conteúdo (mesma página) ou viaja para o topo da página nova. Nunca fica
   *  órfão no pé da página. */
  secao(titulo: string): void {
    this.flushTitulo(0); // dois títulos seguidos: o anterior sai aqui
    const numero = ++this.contadorSecao;
    this.tituloPendente = {
      desenhar: () => {
        this.y -= 10;
        const s = 12;
        const raio = 9;
        this.page.drawCircle({ x: MARGEM + raio, y: this.y - s / 2 - 2, size: raio, color: TEAL });
        const nLabel = String(numero);
        const wN = this.fontB.widthOfTextAtSize(nLabel, 9);
        this.page.drawText(nLabel, { x: MARGEM + raio - wN / 2, y: this.y - s / 2 - 5, size: 9, font: this.fontB, color: rgb(1, 1, 1) });
        this.page.drawText(win(titulo).toUpperCase(), { x: MARGEM + raio * 2 + 6, y: this.y - s, size: s, font: this.fontB, color: AZUL });
        this.y -= s + 8;
        this.page.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4.w - MARGEM, y: this.y }, thickness: 0.6, color: CINZA_CLARO });
        this.y -= 6;
      },
    };
  }

  /** Título de ANEXO (detalhamento que o vendedor abre quando precisa);
   *  numeração por letra, MESMA tipografia da seção. v0.10.18: título
   *  PENDENTE que viaja com o primeiro conteúdo — nunca órfão. */
  anexo(titulo: string): void {
    this.flushTitulo(0);
    const letra = String.fromCharCode(65 + (this.contadorAnexo++ % 26));
    this.tituloPendente = {
      desenhar: () => {
        this.y -= 10;
        const s = 12;
        const raio = 9;
        this.page.drawCircle({ x: MARGEM + raio, y: this.y - s / 2 - 2, size: raio, color: TEAL_ESCURO });
        const wL = this.fontB.widthOfTextAtSize(letra, 9);
        this.page.drawText(letra, { x: MARGEM + raio - wL / 2, y: this.y - s / 2 - 5, size: 9, font: this.fontB, color: rgb(1, 1, 1) });
        this.page.drawText(win(`Anexo ${letra} · ${titulo}`).toUpperCase(), { x: MARGEM + raio * 2 + 6, y: this.y - s, size: s, font: this.fontB, color: AZUL });
        this.y -= s + 8;
        this.page.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4.w - MARGEM, y: this.y }, thickness: 0.6, color: CINZA_CLARO });
        this.y -= 6;
      },
    };
  }

  /** Subtítulo dentro de seção/anexo (menor, teal escuro). v0.10.17: reserva
   *  subtítulo + duas linhas de conteúdo — um subtítulo nunca fica órfão no pé. */
  subtitulo(t: string): void {
    this.flushTitulo(52);
    this.garante(52);
    this.texto(t, { fonte: "bold", tamanho: 9.5, cor: TEAL_ESCURO, espacoAntes: 4 });
    this.y -= 2;
  }

  /** Estimativa pública da altura de um par rótulo/valor (para reservar grupos
   *  que devem ficar inteiros — v0.10.18). */
  alturaPar(valor: string, recuo = 8): number {
    const linhasValor = this.quebrar(win(valor), this.fontN, 10, LARGURA_UTIL - recuo - 4 - 8).length;
    return 18 + Math.min(linhasValor, 2) * 14.2;
  }

  /** v0.11.1 (PDF v4): espaço vertical restante na página atual (pt) — a página
   *  executiva usa isto para decidir se um bloco (ex.: leitura de IA) cabe
   *  inteiro na página 1 ou via para o anexo, SEM quebrar a página no meio. */
  espacoRestante(): number {
    return this.y - (MARGEM + 40);
  }

  /** Par rótulo/valor — rótulo em negrito na frente, valor quebrando embaixo.
   *  v0.10.18: rótulo e a primeira fatia do valor ficam JUNTOS (um rótulo
   *  nunca fica no pé da página com o valor sozinho na página seguinte). */
  par(rotulo: string, valor: string, recuo = 8): void {
    if (!valor) return;
    const alturaJuntos = this.alturaPar(valor, recuo);
    this.flushTitulo(alturaJuntos);
    this.garante(alturaJuntos);
    this.texto(rotulo, { fonte: "bold", tamanho: 9, cor: CINZA, recuo });
    this.texto(valor, { tamanho: 10, recuo: recuo + 4 });
  }

  /** Linha compacta "rótulo: valor" na mesma linha. */
  inline(rotulo: string, valor: string, recuo = 8): void {
    if (!valor) return;
    this.texto(`${rotulo}: ${valor}`, { tamanho: 10, recuo });
  }

  bullets(itens: string[], recuo = 12): void {
    // v0.11.0 (Gate 9/F4 — título órfão): grupos pequenos reservam TÍTULO+GRUPO
    // ANTES de liberar o título pendente. Antes o título era liberado com a altura
    // do primeiro item e, quando o grupo inteiro saltava de página no garante(),
    // o título ficava sozinho no pé da página anterior ("NOTAS DE LEITURA" órfã).
    const linhasPrimeiro = this.quebrar(win(itens[0] ?? ""), this.fontN, 10, LARGURA_UTIL - recuo - 8).length;
    if (itens.length <= 6) {
      const altura = itens.reduce((acc, item) => acc + this.quebrar(win(item), this.fontN, 10, LARGURA_UTIL - recuo - 8).length, 0) * 14.5;
      this.garante(altura + 8 + 36); // grupo + espaço + altura do título
      this.flushTitulo(Math.min(altura, 210));
    } else {
      // grupos longos podem fluir entre páginas: o título viaja com o primeiro item
      this.flushTitulo(linhasPrimeiro * 14.5);
    }
    for (const item of itens) {
      const linhas = this.quebrar(win(item), this.fontN, 10, LARGURA_UTIL - recuo - 8);
      linhas.forEach((l, i) => {
        this.garante(16);
        this.page.drawText(i === 0 ? "-" : " ", { x: MARGEM + recuo, y: this.y - 10, size: 10, font: this.fontN, color: TEAL_ESCURO });
        this.page.drawText(l, { x: MARGEM + recuo + 10, y: this.y - 10, size: 10, font: this.fontN, color: rgb(0.13, 0.16, 0.2) });
        this.y -= 14.5;
      });
    }
  }

  /** Caixa de aviso (divergência, revisão) — fundo amarelo suave. */
  aviso(titulo: string, texto: string): void {
    const linhas = this.quebrar(win(texto), this.fontN, 9.5, LARGURA_UTIL - 24);
    const altura = linhas.length * 13.5 + 30;
    this.flushTitulo(altura + 8);
    this.garante(altura + 8);
    this.y -= 6;
    const topo = this.y;
    this.page.drawRectangle({ x: MARGEM, y: topo - altura, width: LARGURA_UTIL, height: altura, color: rgb(1, 0.97, 0.88), borderColor: rgb(1, 0.77, 0.07), borderWidth: 0.8 });
    this.page.drawText(win(titulo), { x: MARGEM + 10, y: topo - 16, size: 9.5, font: this.fontB, color: ATENCAO });
    let yy = topo - 32;
    for (const l of linhas) {
      this.page.drawText(l, { x: MARGEM + 10, y: yy, size: 9.5, font: this.fontN, color: rgb(0.25, 0.22, 0.08) });
      yy -= 13.5;
    }
    this.y = topo - altura - 6;
  }

  /** Bloco de leitura de IA — fundo teal claro, rótulo explícito de hipótese. */
  blocoIA(rotulo: string, texto: string): void {
    const linhas = this.quebrar(win(texto), this.fontN, 9.5, LARGURA_UTIL - 24);
    const altura = linhas.length * 13.5 + 28;
    this.flushTitulo(altura + 8);
    this.garante(altura + 8);
    this.y -= 6;
    const topo = this.y;
    this.page.drawRectangle({ x: MARGEM, y: topo - altura, width: LARGURA_UTIL, height: altura, color: rgb(0.94, 0.99, 0.98), borderColor: TEAL, borderWidth: 0.8 });
    this.page.drawText(win(rotulo), { x: MARGEM + 10, y: topo - 15, size: 9, font: this.fontB, color: TEAL_ESCURO });
    let yy = topo - 30;
    for (const l of linhas) {
      this.page.drawText(l, { x: MARGEM + 10, y: yy, size: 9.5, font: this.fontN, color: rgb(0.1, 0.25, 0.24) });
      yy -= 13.5;
    }
    this.y = topo - altura - 6;
  }

  /** Tabela simples de duas colunas (sem cortes — valor quebra). */
  tabelaLinhas(linhas: { a: string; b: string }[], largA = 150): void {
    // v0.10.18: título pendente viaja com a primeira linha da tabela
    this.flushTitulo(linhas.length > 0 ? 22 : 16);
    for (const l of linhas) {
      this.garante(16);
      const y0 = this.y;
      this.texto(l.a, { fonte: "bold", tamanho: 9.5, cor: CINZA, largura: largA - 8 });
      const yA = this.y;
      this.y = y0;
      this.texto(l.b, { tamanho: 9.5, recuo: largA });
      this.y = Math.min(this.y, yA) - 4;
    }
  }

  /**
   * v0.10.17 — FONTE E ATUALIZAÇÃO: bloco discreto que ENCERRA o conteúdo.
   * Desenhado SEM quebra de página: cabe na reserva inferior da última página
   * (o motor reserva 40pt acima da margem). Assim o bloco nunca vira uma
   * página final órfã com só observações.
   */
  blocoFontes(linhas: string[]): void {
    const validas = linhas.filter(Boolean);
    if (validas.length === 0) return;
    this.y -= 8;
    this.page.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4.w - MARGEM, y: this.y }, thickness: 0.6, color: CINZA_CLARO });
    this.y -= 12;
    for (const l of validas) {
      const linhasQuebradas = this.quebrar(win(l), this.fontN, 8.5, LARGURA_UTIL);
      for (const lq of linhasQuebradas) {
        this.page.drawText(lq, { x: MARGEM, y: this.y - 8.5, size: 8.5, font: this.fontN, color: CINZA });
        this.y -= 11.5;
      }
    }
  }

  /** Rodapés com paginação — chamar UMA vez no fim. */
  private rodapes(geradoEm: Date, notaProveniencia: string): void {
    const total = this.paginas.length;
    this.paginas.forEach((p, i) => {
      const yR = MARGEM - 24;
      p.drawLine({ start: { x: MARGEM, y: yR + 12 }, end: { x: A4.w - MARGEM, y: yR + 12 }, thickness: 0.6, color: CINZA_CLARO });
      p.drawText("Scout 360 · Senior", { x: MARGEM, y: yR, size: 8, font: this.fontB, color: CINZA });
      const pag = `Página ${i + 1} de ${total}`;
      const wP = this.fontN.widthOfTextAtSize(pag, 8);
      p.drawText(pag, { x: A4.w - MARGEM - wP, y: yR, size: 8, font: this.fontN, color: CINZA });
      const nota = win(`Documento gerado em ${geradoEm.toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })} · ${notaProveniencia}`);
      p.drawText(nota.slice(0, 150), { x: MARGEM, y: yR - 10, size: 7, font: this.fontN, color: CINZA });
    });
  }

  async finalizar(notaProveniencia: string): Promise<Buffer> {
    this.flushTitulo(0); // v0.10.18: título pendente nunca se perde no fim do documento
    const geradoEm = new Date();
    this.rodapes(geradoEm, notaProveniencia);
    const bytes = await this.doc.save();
    return Buffer.from(bytes);
  }
}

function dataBR(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleString("pt-BR", { timeZone: "America/Cuiaba" });
}

/** Data curta do cadastro (ISO ou BR) em dd/mm/aaaa — sem formato técnico exposto. */
function dataCurta(texto: string): string {
  const d = dataCadastro(texto);
  if (d) return d.toLocaleDateString("pt-BR");
  return texto;
}

/** Valor monetário com separadores pt-BR — nunca "R$ 4700000" cru. */
function brl(numero: number): string {
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

/** v0.11.1 (PDF v4): número inteiro com separadores pt-BR — "8.000 estabelecimentos"
 *  em vez de "8000" (interpretação errada de milhares é um risco apontado pelo
 *  Planejador nos quadros gigantes). */
function num(n: number): string {
  return n.toLocaleString("pt-BR");
}

// plural() agora vem de @/lib/linguagem (fonte única do contrato de linguagem)

/* ============================== PDF DA EMPRESA ============================ */

export interface LacunaPdf {
  pergunta: string;
  estado: string;
  falta: string | null;
  proximaVerificacao: string | null;
}

const ESTADO_LACUNA: Record<string, string> = ESTADO_LACUNA_COMERCIAL;

/**
 * PDF comercial da empresa — v0.10.17: DOSSIÊ EXECUTIVO (ficha-comercial v3).
 *
 * Composição (a página 1 prepara a conversa; o detalhe mora nos anexos):
 *   ABERTURA  marca Senior/Scout 360, nome comercial e razão social, CNPJ,
 *             localização e situação, data da atualização discreta; divergência
 *             material em caixa (ressalva que muda a interpretação).
 *   1 VISÃO EMPRESARIAL  atividade cadastrada (o ano do regime fica ao lado do
 *             dado), indicadores cadastrais essenciais, contatos públicos válidos.
 *   2 PESSOAS E RELAÇÕES  representantes registrados; relações EFETIVAMENTE
 *             consultadas, com empresa e estabelecimento sempre separados.
 *   3 O QUE VALE INVESTIGAR  até 4 prioridades com a próxima ação concreta.
 *   FONTE E ATUALIZAÇÃO  bloco discreto ao final (categoria + data; sem
 *             provedor técnico — esse registro fica na planilha de evidências).
 *   ANEXOS  A atividades secundárias · B representantes completos ·
 *             C relações em detalhe · D o que falta (Pergunta → O que falta →
 *             Como verificar) · E leitura comercial (IA, hipóteses).
 *
 * Paginação: 1–2 páginas comerciais quando o conteúdo permite; seção nunca
 * quebra deixando título órfão; o bloco de fontes nunca vira página final órfã.
 */
export interface OpcoesPdfEmpresa {
  /** v0.10.22 — executivo = seções comerciais + fontes, SEM anexos (1–2 páginas);
   *  completo = dossiê com anexos A–E (padrão). Mesmos dados, dois cortes. */
  nivel?: "executivo" | "completo";
}

/**
 * PDF COMERCIAL v3 (LEGADO, v0.10.17-v0.11.0) — mantido para COMPARAÇÃO v3 × v4
 * exigida pelo Gate 3 da missão de consolidação. Nenhum caminho de produção
 * consome esta função: a rota pdf_empresa usa `gerarPdfEmpresa` (v4).
 */
export async function gerarPdfEmpresaV3(ds: DatasetExport, linha: LinhaExport, lacunas: LacunaPdf[], opcoes: OpcoesPdfEmpresa = {}): Promise<Buffer> {
  const nivel = opcoes.nivel ?? "completo";
  const executivo = nivel === "executivo";
  const l = linha;
  const razao = l.razaoSocial || "";
  const nomeComercial = l.nomeFantasia || razao || l.cnpjFormatado || `Entrada ${l.rowNumber}`;
  const pdf = await PdfDoc.criar(`Dossiê da empresa — ${nomeComercial}`, "Dossiê comercial gerado a partir da coleta pública");
  const lote = ds.lote;
  const regime = regimeTributarioLegivel(l.regimeTributario);

  // PLANO DE ANEXOS: as letras são definidas ANTES de gerar para que as referências
  // da visão principal ("lista completa está no Anexo X") sempre apontem certo.
  const rel = l.relacoesConsultadas;
  const temQsa = l.representantes.some((r) => r.tipoVinculo.startsWith("Sócio"));
  const temBlocoRelacoes = !!(l.cnpjMatrizFormatado || l.statusMatriz || (rel && rel.participantes.length > 0));
  const lacunasAbertas = lacunas.filter((x) => x.estado !== "RESOLVIDO" && x.estado !== "NAO_APLICAVEL");
  const temIa = l.iaStatus === "OK" && !!(l.iaLeitura || l.iaSetor || l.iaHipoteses.length > 0);
  const planoAnexos: string[] = [];
  if (l.cnaesSecundarios.length > 0) planoAnexos.push("cnaes");
  if (temQsa) planoAnexos.push("qsa");
  if (rel && rel.participantes.length > 0) planoAnexos.push("relacoes");
  if (lacunasAbertas.length > 0) planoAnexos.push("lacunas");
  if (temIa) planoAnexos.push("ia");
  // v0.10.22: no executivo os anexos não existem — a referência aponta para o
  // PDF completo (nunca um “Anexo X” que não está no arquivo)
  const letraDe = (nome: string): string => {
    if (executivo) return "PDF completo";
    const idx = planoAnexos.indexOf(nome);
    return `Anexo ${String.fromCharCode(65 + (idx >= 0 ? idx : 0))}`;
  };

  /* ————— ABERTURA ————— */
  pdf.texto("DOSSIÊ COMERCIAL DA EMPRESA", { fonte: "bold", tamanho: 8, cor: TEAL_ESCURO });
  pdf.texto(nomeComercial, { fonte: "bold", tamanho: 19, cor: AZUL, espacoAntes: 4 });
  if (razao && razao !== nomeComercial) {
    pdf.texto(razao, { tamanho: 10.5, cor: CINZA, espacoAntes: 1 });
  }
  const linhaIdentidade = [
    l.cnpjFormatado ? `CNPJ ${l.cnpjFormatado}` : `Pista original: ${l.entrada}`,
    l.matrizFilial ?? "",
    [l.municipio, l.uf].filter(Boolean).join("/") || "",
  ].filter(Boolean).join(" · ");
  pdf.texto(linhaIdentidade, { tamanho: 10, espacoAntes: 6 });
  if (l.situacao) {
    pdf.texto(`Situação cadastral: ${l.situacao}${l.dataSituacao ? ` desde ${dataCurta(l.dataSituacao)}` : ""}`, { tamanho: 10 });
  }
  pdf.texto(`Atualizado em ${dataBR(l.dataColeta || l.dataConsulta)}`, { tamanho: 8.5, cor: CINZA, espacoAntes: 5 });

  // Ressalvas que MUDAM a interpretação comercial ficam na abertura, em caixa.
  const situacaoAtipica = ["BAIXADA", "SUSPENSA", "INAPTA", "NULA"].includes((l.situacao || "").toUpperCase());
  if (situacaoAtipica) {
    pdf.aviso("Situação cadastral atípica", `O registro está ${l.situacao}. Antes de usar os dados, verifique se esta é a empresa operacional que você procura.`);
  }
  if (l.emRevisao || l.divergencias.length > 0 || l.estadoResolucao === "REVIEW") {
    if (l.etapaIdentidade === "LOCALIZADO") {
      pdf.aviso(
        "Identidade em revisão",
        "O registro localizado nas fontes públicas ainda não foi confirmado como a empresa pretendida."
        + (l.divergencias.length > 0 ? ` Divergência: ${l.divergencias[0].descricao}` : "")
        + " A confirmação é sua decisão na ficha."
      );
    } else if (l.estadoResolucao === "REVIEW") {
      pdf.aviso(
        "Revisão pendente",
        "Existe mais de uma possibilidade para as pistas desta entrada. Confirme na ficha qual é a empresa correta."
      );
    } else if (l.divergencias.length > 0) {
      pdf.aviso("Divergência de identidade", l.divergencias.map((d) => d.descricao).join(" "));
    }
  }
  pdf.divisor();

  /* ————— 1 — VISÃO EMPRESARIAL ————— */
  pdf.secao("Visão empresarial");
  if (l.cnaeDescricao || l.cnaeCodigo) {
    pdf.subtitulo("Atividade cadastrada");
    pdf.texto(l.cnaeCodigo ? `${l.cnaeCodigo} ${l.cnaeDescricao}` : l.cnaeDescricao, { tamanho: 10 });
    if (l.cnaesSecundarios.length > 0) {
      pdf.texto(
        l.cnaesSecundarios.length === 1
          ? `Mais 1 atividade registrada. A lista completa está no ${letraDe("cnaes")}.`
          : `Mais ${l.cnaesSecundarios.length} atividades registradas. A lista completa está no ${letraDe("cnaes")}.`,
        { tamanho: 9, cor: CINZA, espacoAntes: 3 }
      );
    }
  }
  const cadastrais = [
    { a: "Natureza jurídica", b: l.naturezaJuridica },
    { a: "Porte declarado", b: l.porte },
    { a: "Capital social", b: l.capitalSocialNumero != null ? brl(l.capitalSocialNumero) : l.capitalSocialTexto },
    { a: "Abertura", b: dataCurta(l.dataAbertura) },
    { a: "Simples Nacional", b: l.simples },
    { a: "MEI", b: l.mei },
    { a: "Regime tributário", b: regime?.valor ?? "" },
    { a: "Contexto regional", b: [l.ibgeRegiaoImediata, l.ibgePopulacao ? `pop. ${l.ibgePopulacao}${l.ibgeAno ? ` (${l.ibgeAno})` : ""}` : ""].filter(Boolean).join(" · ") },
  ].filter((r) => r.b);
  if (cadastrais.length > 0) {
    pdf.subtitulo("Informações cadastrais essenciais");
    pdf.tabelaLinhas(cadastrais);
  }
  const temContatos = l.telefones.length > 0 || l.email || l.endereco;
  pdf.subtitulo("Contatos públicos");
  if (temContatos) {
    if (l.telefones.length > 0) pdf.inline("Telefones", l.telefones.join(" · "));
    if (l.email) pdf.inline("E-mail público", l.email);
    if (l.endereco) pdf.par("Endereço", l.endereco);
  } else {
    pdf.texto("Não informado.", { tamanho: 9.5, cor: CINZA });
  }

  /* ————— 2 — PESSOAS E RELAÇÕES ————— */
  const qsa = l.representantes.filter((r) => r.tipoVinculo.startsWith("Sócio"));
  if (qsa.length > 0 || temBlocoRelacoes) {
    pdf.secao("Pessoas e relações");
    if (qsa.length > 0) {
      pdf.subtitulo("Representantes registrados");
      pdf.bullets(
        qsa.slice(0, 3).map((r) => `${r.nome}${r.qualificacao ? ` — ${r.qualificacao}` : ""}${r.dataEntrada ? ` (desde ${dataCurta(r.dataEntrada)})` : ""}`)
      );
      if (qsa.length > 3) {
        pdf.texto(`Os outros ${qsa.length - 3} estão no ${letraDe("qsa")}.`, { tamanho: 9, cor: CINZA, recuo: 12 });
      }
    }
    if (l.cnpjMatrizFormatado || l.statusMatriz) {
      pdf.subtitulo("Matriz e filiais");
      if (l.cnpjMatrizFormatado) pdf.inline("Matriz", `${l.cnpjMatrizFormatado}${l.statusMatriz ? ` — ${l.statusMatriz}` : ""}`);
      else if (l.statusMatriz === "RESOLVIDA") pdf.inline("Matriz", "esta unidade é a matriz, confirmada pelo identificador oficial");
      else pdf.inline("Matriz", l.statusMatriz ?? "");
    }
    if (rel && rel.participantes.length > 0) {
      pdf.subtitulo(`Relações consultadas (${dataCurta(rel.coletadoEm)})`);
      for (const p of rel.participantes.slice(0, 4)) {
        pdf.bullets([`${p.nome}${p.cnpjFormatado ? ` (${p.cnpjFormatado})` : ""} — ${tipoParticipanteLegivel(p.tipo)}`]);
        if (p.quadro) {
          pdf.texto(
            `O quadro público deste participante registra ${p.quadro.totalPessoasJuridicas} ${p.quadro.totalPessoasJuridicas === 1 ? "empresa" : "empresas"} e ${p.quadro.totalEmpresas} ${p.quadro.totalEmpresas === 1 ? "estabelecimento" : "estabelecimentos"}. Detalhes no ${letraDe("relacoes")}.`,
            { tamanho: 9, cor: CINZA, recuo: 20, espacoAntes: 2 }
          );
        } else {
          pdf.texto(
            `Os estabelecimentos deste vínculo podem ser listados na ficha da empresa.`,
            { tamanho: 9, cor: CINZA, recuo: 20, espacoAntes: 2 }
          );
        }
      }
      if (rel.participantes.length > 4) {
        pdf.texto(`Os outros ${rel.participantes.length - 4} participantes estão no ${letraDe("relacoes")}.`, { tamanho: 9, cor: CINZA, recuo: 12 });
      }
    } else if (temBlocoRelacoes) {
      pdf.subtitulo("Relações societárias");
      pdf.texto("As relações societárias podem ser consultadas na ficha da empresa, sempre sob comando.", { tamanho: 9, cor: CINZA });
    }
  }

  /* ————— 3 — O QUE VALE INVESTIGAR ————— */
  if (lacunasAbertas.length > 0) {
    pdf.secao("O que vale investigar");
    for (const lac of lacunasAbertas.slice(0, 4)) {
      // v0.10.18: pergunta + ação ficam juntos (grupo pequeno nunca se parte)
      pdf.reserva(52 + 2 * 14.2 + 6);
      pdf.subtitulo(lac.pergunta);
      // Ação concreta: usa a próxima verificação quando existe; senão, a frase do estado.
      pdf.texto(lac.proximaVerificacao || ESTADO_LACUNA[lac.estado] || "", { tamanho: 9.5, recuo: 4 });
    }
    if (lacunasAbertas.length > 4) {
      pdf.texto(`As outras ${lacunasAbertas.length - 4} perguntas estão no ${letraDe("lacunas")}.`, { tamanho: 9, cor: CINZA, espacoAntes: 4 });
    }
  }

  /* ————— FONTE E ATUALIZAÇÃO (bloco discreto, encerra o conteúdo) ————— */
  const linhasFontes = [
    `Fonte principal: ${categoriaDeFonte(l.fonte)}${l.dataColeta ? `, coletado em ${dataBR(l.dataColeta)}` : ""}.`,
    l.fonteDescoberta ? `Descoberta do CNPJ: ${categoriaDeFonte(l.fonteDescoberta)}${l.dataConsulta ? `, consulta em ${dataBR(l.dataConsulta)}` : ""}.` : "",
    "Este documento não reconsultou fontes. Confirme as informações com a empresa antes das decisões.",
  ];
  pdf.blocoFontes(linhasFontes);

  const gerarAnexos = !executivo; // executivo: seções comerciais + fontes, sem anexos
  /* ===================== ANEXOS (detalhamento completo) ===================== */

  // ANEXO — atividades secundárias completas (UMA por linha — nunca parágrafo único)
  if (gerarAnexos && l.cnaesSecundarios.length > 0) {
    pdf.anexo("Atividades secundárias registradas");
    pdf.bullets(l.cnaesSecundarios);
  }

  // ANEXO — representantes registrados (quadro público, lista completa)
  if (gerarAnexos && qsa.length > 0) {
    pdf.anexo("Representantes registrados (quadro público)");
    pdf.bullets(qsa.map((r) => `${r.nome}${r.qualificacao ? ` — ${r.qualificacao}` : ""}${r.dataEntrada ? ` (desde ${dataCurta(r.dataEntrada)})` : ""}`));
  }

  // ANEXO — relações consultadas em detalhe (RECONCILIAÇÃO tela × PDF, preservada)
  // v0.10.17: quando não há relações consultadas, NÃO existe anexo repetindo a
  // seção 2 — a disponibilidade já está declarada na visão principal (nunca um
  // anexo espúrio criando página final órfã).
  if (gerarAnexos && rel && rel.participantes.length > 0) {
    pdf.anexo("Relações consultadas em detalhe");
    pdf.reserva(96); // título + primeiro participante + leitura do quadro ficam juntos
    for (const p of rel.participantes) {
      pdf.bullets([`${p.nome}${p.cnpjFormatado ? ` (${p.cnpjFormatado})` : ""} — ${tipoParticipanteLegivel(p.tipo)}`]);
      if (p.quadro) {
        const grupos = new Map<string, { razaoSocial: string; count: number }>();
        for (const e of p.quadro.empresas) {
          const g = grupos.get(e.raiz);
          if (g) g.count += 1;
          else grupos.set(e.raiz, { razaoSocial: e.razaoSocial, count: 1 });
        }
        pdf.texto(
          `Consulta de ${dataCurta(p.quadro.coletadoEm)}: encontramos ${p.quadro.totalPessoasJuridicas} ${p.quadro.totalPessoasJuridicas === 1 ? "empresa" : "empresas"} e ${p.quadro.totalEmpresas} ${p.quadro.totalEmpresas === 1 ? "estabelecimento" : "estabelecimentos"} registrados nesta consulta.`,
          { tamanho: 9, cor: CINZA, recuo: 20, espacoAntes: 2 }
        );
        // empresas distintas (raiz) com seus estabelecimentos — nunca soma empresa com estabelecimento
        for (const [, g] of grupos) {
          pdf.bullets(
            [`${g.razaoSocial}: ${g.count} ${g.count === 1 ? "estabelecimento" : "estabelecimentos"} desta empresa`],
            28
          );
        }
        if (p.quadro.truncado) {
          pdf.texto("O registro completo segue na planilha de evidências; a exibição respeitou um limite de segurança.", { tamanho: 8.5, cor: CINZA, recuo: 20 });
        }
      } else {
        pdf.texto("Os estabelecimentos deste vínculo podem ser listados na ficha da empresa, sob comando.", { tamanho: 9, cor: CINZA, recuo: 20, espacoAntes: 2 });
      }
    }
  }

  // ANEXO — lacunas detalhadas: Pergunta → O que falta → Como verificar (3 campos claros)
  if (gerarAnexos && lacunasAbertas.length > 0) {
    pdf.anexo("O que falta descobrir");
    for (const lac of lacunasAbertas) {
      // v0.10.18: uma lacuna INTEIRA (pergunta + o que falta + como verificar)
      // nunca se parte entre páginas — o grupo cabe sempre numa página.
      pdf.reserva(52 + pdf.alturaPar(lac.falta ?? "Não informado pela fonte.") + pdf.alturaPar(lac.proximaVerificacao || ESTADO_LACUNA[lac.estado] || ""));
      pdf.subtitulo(lac.pergunta);
      pdf.par("O que falta", lac.falta ?? "Não informado pela fonte.");
      // A ação concreta entra uma vez só: usa a próxima verificação quando existe;
      // senão, a frase do estado. Nunca as duas repetindo o mesmo pedido.
      pdf.par(
        "Como verificar",
        lac.proximaVerificacao || ESTADO_LACUNA[lac.estado] || ""
      );
    }
  }

  // ANEXO — leitura comercial (IA) — hipóteses, SEPARADAS dos fatos
  if (gerarAnexos && temIa) {
    pdf.anexo("Leitura comercial (IA — hipóteses)");
    pdf.texto(
      "O texto abaixo foi gerado por inteligência artificial a partir dos dados públicos coletados. Trate como hipótese de trabalho.",
      { tamanho: 8.5, cor: ATENCAO, espacoAntes: 2 }
    );
    if (l.iaSetor) pdf.inline("Setor aparente", l.iaSetor);
    if (l.iaPorte) pdf.inline("Porte aparente", l.iaPorte);
    if (l.iaLeitura) pdf.blocoIA("LEITURA EXECUTIVA (IA)", l.iaLeitura);
    if (l.iaHipoteses.length > 0) {
      pdf.par("Hipóteses a validar", "");
      pdf.bullets(l.iaHipoteses);
    }
  }

  return pdf.finalizar(
    `Modelo ficha-comercial v3 · Scout 360 ${appVersion()} · Lote ${lote.arquivo} · linha ${l.rowNumber}`
  );
}

/* ============================ PDF DA EMPRESA v4 =========================== */

/* Pré-requisitos do modelo v4 (missão de consolidação, Gate 3):
 *  PÁGINA 1 EXECUTIVA — a razão social é o elemento principal; a denominação
 *  secundária registrada (nome comercial) fica identificada SEM substituir a
 *  razão social; síntese comercial completa na primeira página: fatos
 *  comprovados, principais evidências, o que ainda não sabemos, próximos
 *  movimentos possíveis e a leitura de IA claramente rotulada como hipótese.
 *  CONSOLIDAÇÃO DE PESSOAS E RELAÇÕES — raízes de CNPJ distintas = empresas;
 *  CNPJs completos = estabelecimentos; os dois números nunca se somam nem se
 *  confundem (8 mil estabelecimentos NÃO são 8 mil empresas).
 *  SEPARAÇÃO SEMÂNTICA — comprovado (coletado com data), histórico (regime por
 *  exercício), hipótese (IA) e não pesquisado (consultas não feitas) ficam em
 *  blocos distintos.
 *  ANEXOS SÓ QUANDO APROFUNDAM — sem repetir a mesma instrução por participante;
 *  sem referenciar planilha que não acompanha o documento.
 */

/** Informação consolidada dos quadros ampliados — a MESMA regra da interface
 *  (raiz = empresa; CNPJ completo = estabelecimento). */
interface ConsolidacaoRelacoes {
  participantes: number;
  pf: number;
  pj: number;
  indeterminados: number;
  quadrosAmpliados: number;
  semQuadro: number;
  algumTruncado: boolean;
  /** raízes de CNPJ distintas = PESSOAS JURÍDICAS distintas (nunca estabelecimentos) */
  raizes: Map<string, { razaoSocial: string; estabelecimentos: Set<string>; participantes: Set<string> }>;
  totalRaizes: number;
  /** CNPJs completos distintos registrados nos quadros ampliados */
  totalEstabelecimentosQuadros: number;
  /** quadro de maior volume (para a leitura "milhares de estabelecimentos") */
  maiorQuadro: { nome: string; totalEmpresas: number; totalPessoasJuridicas: number } | null;
}

function consolidarRelacoes(l: LinhaExport): ConsolidacaoRelacoes | null {
  const rel = l.relacoesConsultadas;
  const participantes = rel?.participantes ?? [];
  if (participantes.length === 0 && !(l.cnpjMatrizFormatado || l.statusMatriz)) return null;
  const raizes = new Map<string, { razaoSocial: string; estabelecimentos: Set<string>; participantes: Set<string> }>();
  let quadrosAmpliados = 0;
  let algumTruncado = false;
  let maiorQuadro: ConsolidacaoRelacoes["maiorQuadro"] = null;
  const estabelecimentosDistintos = new Set<string>();
  for (const p of participantes) {
    if (!p.quadro) continue;
    quadrosAmpliados += 1;
    if (p.quadro.truncado) algumTruncado = true;
    if (!maiorQuadro || p.quadro.totalEmpresas > maiorQuadro.totalEmpresas) {
      maiorQuadro = { nome: p.nome, totalEmpresas: p.quadro.totalEmpresas, totalPessoasJuridicas: p.quadro.totalPessoasJuridicas };
    }
    for (const e of p.quadro.empresas) {
      const g = raizes.get(e.raiz) ?? { razaoSocial: e.razaoSocial ?? "", estabelecimentos: new Set<string>(), participantes: new Set<string>() };
      if (!g.razaoSocial && e.razaoSocial) g.razaoSocial = e.razaoSocial;
      g.estabelecimentos.add(e.cnpjFormatado);
      g.participantes.add(p.participanteId);
      raizes.set(e.raiz, g);
      estabelecimentosDistintos.add(e.cnpjFormatado);
    }
  }
  // a própria conta é uma raiz do conjunto (o contexto das relações)
  if (l.cnpjRaiz && !raizes.has(l.cnpjRaiz)) {
    raizes.set(l.cnpjRaiz, { razaoSocial: l.razaoSocial, estabelecimentos: new Set([l.cnpjFormatado].filter(Boolean)), participantes: new Set() });
  }
  return {
    participantes: participantes.length,
    pf: participantes.filter((p) => p.tipo === "PF").length,
    pj: participantes.filter((p) => p.tipo === "PJ").length,
    indeterminados: participantes.filter((p) => p.tipo === "INDETERMINADO").length,
    quadrosAmpliados,
    semQuadro: participantes.filter((p) => !p.quadro).length,
    algumTruncado,
    raizes,
    totalRaizes: raizes.size,
    totalEstabelecimentosQuadros: estabelecimentosDistintos.size,
    maiorQuadro,
  };
}

/** Próximos movimentos POSSÍVEIS — determinísticos (sem IA), cada um diz o
 *  comando real que existe na ficha. Nunca executa nada: orienta o leitor. */
function proximosMovimentos(l: LinhaExport, consolidacao: ConsolidacaoRelacoes | null): string[] {
  const movs: string[] = [];
  if (l.emRevisao || l.estadoResolucao === "REVIEW") {
    movs.push("Confirmar a identidade na ficha antes de usar os dados em conversa comercial.");
  }
  if (!l.relacoesConsultadas && l.cnpjFormatado) {
    movs.push("Consultar as relações societárias na ficha (sob comando) para revelar pessoas e empresas conectadas.");
  }
  if (consolidacao && consolidacao.semQuadro > 0) {
    movs.push(`Ampliar os quadros de ${plural(consolidacao.semQuadro, "conexão ainda não ampliada", "conexões ainda não ampliadas")} na ficha (sob comando).`);
  }
  if (l.matrizFilial.toUpperCase().startsWith("FILIAL") && l.statusMatriz !== "RESOLVIDA") {
    movs.push("Investigar os estabelecimentos da raiz na ficha para localizar a matriz oficial.");
  }
  if (l.iaStatus !== "OK") {
    movs.push("Gerar a leitura comercial (IA — hipótese) para sintetizar o que os dados públicos sugerem.");
  }
  if (!l.iaLeitura && l.pesquisaStatus === "") {
    movs.push("Pedir a pesquisa profunda do site oficial e fontes públicas para ampliar as evidências.");
  }
  if (movs.length === 0) {
    movs.push("Revalidar a consulta cadastral na ficha para atualizar os dados públicos (sob comando).");
  }
  return movs.slice(0, 3);
}

export async function gerarPdfEmpresa(ds: DatasetExport, linha: LinhaExport, lacunas: LacunaPdf[], opcoes: OpcoesPdfEmpresa = {}): Promise<Buffer> {
  const nivel = opcoes.nivel ?? "completo";
  const executivo = nivel === "executivo";
  const l = linha;
  const lote = ds.lote;
  const regime = regimeTributarioLegivel(l.regimeTributario);
  const consolidacao = consolidarRelacoes(l);
  const razao = l.razaoSocial || l.nomeFantasia || l.cnpjFormatado || `Pista: ${l.entrada}`;
  const pdf = await PdfDoc.criar(`Ficha comercial — ${razao}`, "Ficha comercial gerada a partir da coleta pública");

  const qsa = l.representantes.filter((r) => r.tipoVinculo.startsWith("Sócio"));
  const lacunasAbertas = lacunas.filter((x) => x.estado !== "RESOLVIDO" && x.estado !== "NAO_APLICAVEL");
  const temIa = l.iaStatus === "OK" && !!(l.iaLeitura || l.iaSetor || l.iaHipoteses.length > 0);
  const temPesquisa = l.pesquisaStatus === "OK";

  /* ————— PÁGINA 1 EXECUTIVA ————— */
  pdf.texto("FICHA COMERCIAL DA EMPRESA", { fonte: "bold", tamanho: 8, cor: TEAL_ESCURO });
  // A RAZÃO SOCIAL é o elemento principal (v4): a denominação secundária nunca a substitui.
  pdf.texto(razao, { fonte: "bold", tamanho: 20, cor: AZUL, espacoAntes: 4 });
  if (l.nomeFantasia && l.nomeFantasia !== l.razaoSocial && l.razaoSocial) {
    pdf.texto(`Denominação secundária registrada: ${l.nomeFantasia}`, { tamanho: 10, cor: CINZA, espacoAntes: 1 });
  }
  const linhaIdentidade = [
    l.cnpjFormatado ? `CNPJ ${l.cnpjFormatado}` : `Pista original: ${l.entrada}`,
    l.matrizFilial ?? "",
    [l.municipio, l.uf].filter(Boolean).join("/") || "",
  ].filter(Boolean).join(" · ");
  pdf.texto(linhaIdentidade, { tamanho: 10, espacoAntes: 6 });
  if (l.situacao) {
    pdf.texto(`Situação cadastral: ${l.situacao}${l.dataSituacao ? ` desde ${dataCurta(l.dataSituacao)}` : ""}`, { tamanho: 10, fonte: "bold" });
  }
  pdf.texto(`Atualizado em ${dataBR(l.dataColeta || l.dataConsulta)}`, { tamanho: 8.5, cor: CINZA, espacoAntes: 5 });

  // Ressalvas que MUDAM a interpretação comercial ficam na abertura, em caixa.
  const situacaoAtipica = ["BAIXADA", "SUSPENSA", "INAPTA", "NULA"].includes((l.situacao || "").toUpperCase());
  if (situacaoAtipica) {
    pdf.aviso("Situação cadastral atípica", `O registro está ${l.situacao}. Antes de usar os dados, verifique se esta é a empresa operacional que você procura.`);
  }
  if (l.emRevisao || l.divergencias.length > 0 || l.estadoResolucao === "REVIEW") {
    if (l.etapaIdentidade === "LOCALIZADO") {
      pdf.aviso(
        "Identidade em revisão",
        "O registro localizado nas fontes públicas ainda não foi confirmado como a empresa pretendida."
        + (l.divergencias.length > 0 ? ` Divergência: ${l.divergencias[0].descricao}` : "")
        + " A confirmação é sua decisão na ficha."
      );
    } else if (l.estadoResolucao === "REVIEW") {
      pdf.aviso(
        "Revisão pendente",
        "Existe mais de uma possibilidade para as pistas desta entrada. Confirme na ficha qual é a empresa correta."
      );
    } else if (l.divergencias.length > 0) {
      pdf.aviso("Divergência de identidade", l.divergencias.map((d) => d.descricao).join(" "));
    }
  }
  pdf.divisor();

  /* — SÍNTESE COMERCIAL: o que os dados comprovam (fatos com data) — */
  pdf.texto("O QUE OS DADOS COMPROVAM", { fonte: "bold", tamanho: 10.5, cor: AZUL, espacoAntes: 2 });
  if (l.cnaeDescricao) {
    pdf.inline("Atividade principal", `${l.cnaeDescricao}${l.cnaeCodigo ? ` (CNAE ${l.cnaeCodigo})` : ""}`);
  }
  const fatosEssenciais = [
    l.capitalSocialNumero != null ? `Capital social declarado: ${brl(l.capitalSocialNumero)}` : l.capitalSocialTexto ? `Capital social declarado: ${l.capitalSocialTexto}` : "",
    l.dataAbertura ? `Abertura: ${dataCurta(l.dataAbertura)}` : "",
    l.porte ? `Porte declarado: ${l.porte}` : "",
    l.simples ? `Simples Nacional: ${l.simples}` : "",
  ].filter(Boolean);
  if (fatosEssenciais.length > 0) pdf.texto(fatosEssenciais.join("  ·  "), { tamanho: 9.5, recuo: 4 });
  if (regime) {
    // v4: o regime HISTÓRICO fica distinto do regime ATUAL não confirmado.
    pdf.texto(`Regime tributário: ${regime.valor}`, { tamanho: 9.5, recuo: 4, espacoAntes: 2 });
    pdf.texto(regime.nota, { tamanho: 8.5, cor: CINZA, recuo: 16 });
  }
  const contatoPartes = [
    l.telefones.length > 0 ? `telefones ${l.telefones.join(" e ")}` : "",
    l.email ? `e-mail ${l.email}` : "",
    l.endereco ? `endereço ${l.endereco}` : "",
  ].filter(Boolean);
  pdf.texto(contatoPartes.length > 0 ? `Contatos públicos: ${contatoPartes.join(" · ")}` : "Contatos públicos: nenhum contato utilizável consta no registro coletado.", { tamanho: 9.5, recuo: 4, espacoAntes: 2 });

  /* — PRINCIPAIS EVIDÊNCIAS (comprovado, com data) — */
  const evidencias: string[] = [];
  if (qsa.length > 0) {
    evidencias.push(`Quadro público (QSA) registra ${plural(qsa.length, "representante", "representantes")}${qsa.length <= 2 ? `: ${qsa.map((r) => r.nome).join(" e ")}` : ""}.`);
  }
  if (l.cnpjMatrizFormatado || l.statusMatriz === "RESOLVIDA") {
    evidencias.push(l.cnpjMatrizFormatado ? `Matriz da empresa: ${l.cnpjMatrizFormatado}${l.statusMatriz ? ` (${l.statusMatriz})` : ""}.` : "Esta unidade é a matriz, confirmada pelo identificador oficial.");
  }
  if (consolidacao && consolidacao.participantes > 0) {
    const partesTipo = [consolidacao.pf > 0 ? `${plural(consolidacao.pf, "pessoa física", "pessoas físicas")}` : "", consolidacao.pj > 0 ? `${plural(consolidacao.pj, "pessoa jurídica", "pessoas jurídicas")}` : "", consolidacao.indeterminados > 0 ? `${plural(consolidacao.indeterminados, "participante", "participantes")} sem tipo confirmado` : ""].filter(Boolean);
    evidencias.push(`Relações societárias consultadas${l.relacoesConsultadas ? ` em ${dataCurta(l.relacoesConsultadas.coletadoEm)}` : ""}: ${plural(consolidacao.participantes, "participante", "participantes")} (${partesTipo.join(", ")}).`);
    if (consolidacao.quadrosAmpliados > 0) {
      evidencias.push(`Quadros ampliados conectam esta rede a ${plural(consolidacao.totalRaizes, "empresa distinta (raiz de CNPJ)", "empresas distintas (raízes de CNPJ)")} e ${plural(consolidacao.totalEstabelecimentosQuadros, "estabelecimento registrado", "estabelecimentos registrados")}. Filiais da mesma raiz são a MESMA empresa.`);
    } else {
      evidencias.push(`${plural(consolidacao.semQuadro, "conexão ainda não ampliada", "conexões ainda não ampliadas")}: os quadros individuais podem ser consultados na ficha, sob comando.`);
    }
  }
  if (temPesquisa) {
    evidencias.push(`Pesquisa do site oficial concluída (${dataCurta((l.dataColeta || l.dataConsulta || new Date()).toISOString())}): leitura e hipóteses disponíveis neste documento.`);
  }
  if (evidencias.length > 0) {
    pdf.texto("PRINCIPAIS EVIDÊNCIAS", { fonte: "bold", tamanho: 10.5, cor: AZUL, espacoAntes: 8 });
    pdf.bullets(evidencias.slice(0, 4));
  }

  /* — LEITURA COMERCIAL (IA — HIPÓTESE) na página 1 quando cabe — */
  let iaNaPagina1 = false;
  if (temIa && l.iaLeitura) {
    const linhasIa = pdf.alturaPar(l.iaLeitura, 0) / 14.2;
    const alturaIa = linhasIa * 13.5 + 34;
    if (pdf.espacoRestante() > alturaIa + 150) {
      pdf.blocoIA("LEITURA COMERCIAL (IA — HIPÓTESE, NUNCA CONCLUSÃO)", l.iaLeitura);
      iaNaPagina1 = true;
    }
  }

  /* — O QUE FALTA CONFIRMAR (não pesquisado / em aberto) — */
  if (lacunasAbertas.length > 0) {
    pdf.texto("O QUE FALTA CONFIRMAR", { fonte: "bold", tamanho: 10.5, cor: AZUL, espacoAntes: 8 });
    pdf.reserva(30 + 2 * 13.5);
    for (const lac of lacunasAbertas.slice(0, 3)) {
      pdf.texto(lac.pergunta, { fonte: "bold", tamanho: 9.5, recuo: 4, espacoAntes: 2 });
      pdf.texto(lac.falta ?? "Não informado pela fonte.", { tamanho: 9, cor: CINZA, recuo: 16 });
    }
    if (lacunasAbertas.length > 3) {
      pdf.texto(`Mais ${plural(lacunasAbertas.length - 3, "pergunta aberta", "perguntas abertas")} no detalhamento${executivo ? "" : " (Anexo D)"}.`, { tamanho: 8.5, cor: CINZA, recuo: 4, espacoAntes: 2 });
    }
  }

  /* — PRÓXIMOS MOVIMENTOS POSSÍVEIS (determinísticos, sem IA) — */
  const movimentos = proximosMovimentos(l, consolidacao);
  if (movimentos.length > 0) {
    pdf.texto("PRÓXIMOS MOVIMENTOS POSSÍVEIS", { fonte: "bold", tamanho: 10.5, cor: AZUL, espacoAntes: 8 });
    pdf.bullets(movimentos);
  }

  /* — FONTE E ATUALIZAÇÃO (bloco discreto; no executivo encerra o documento) — */
  pdf.blocoFontes([
    `Fonte principal: ${categoriaDeFonte(l.fonte)}${l.dataColeta ? `, coletado em ${dataBR(l.dataColeta)}` : ""}.`,
    l.fonteDescoberta ? `Descoberta do CNPJ: ${categoriaDeFonte(l.fonteDescoberta)}${l.dataConsulta ? `, consulta em ${dataBR(l.dataConsulta)}` : ""}.` : "",
    "Este documento não reconsultou fontes. Confirme as informações com a empresa antes das decisões.",
  ]);

  if (executivo) {
    return pdf.finalizar(
      `Modelo ficha-comercial v4 · Scout 360 ${appVersion()} · Lote ${lote.arquivo} · linha ${l.rowNumber}`
    );
  }

  /* ==================== v4 COMPLETO: DETALHAMENTO ==================== */

  /* — 1 PESSOAS E RELAÇÕES (consolidado; anexos só quando aprofundam) — */
  const temQsa = qsa.length > 0;
  if (temQsa || consolidacao) {
    pdf.secao("Pessoas e relações");
    if (temQsa) {
      pdf.subtitulo("Representantes registrados (quadro público)");
      pdf.bullets(
        qsa.slice(0, 5).map((r) => `${r.nome}${r.qualificacao ? `: ${r.qualificacao}` : ""}${r.dataEntrada ? ` (desde ${dataCurta(r.dataEntrada)})` : ""}`)
      );
      if (qsa.length > 5) {
        pdf.texto(`Os outros ${plural(qsa.length - 5, "representante", "representantes")} estão no Anexo B.`, { tamanho: 9, cor: CINZA, recuo: 12 });
      }
      pdf.texto("Os papéis vêm do quadro público; quem administra no registro não prova quem decide na prática.", { tamanho: 8.5, cor: CINZA, recuo: 4, espacoAntes: 2 });
    }
    if (consolidacao && consolidacao.participantes > 0) {
      pdf.subtitulo(`Relações societárias consultadas${l.relacoesConsultadas ? ` (coleta de ${dataCurta(l.relacoesConsultadas.coletadoEm)})` : ""}`);
      const partesTipo = [consolidacao.pf > 0 ? `${plural(consolidacao.pf, "pessoa física", "pessoas físicas")}` : "", consolidacao.pj > 0 ? `${plural(consolidacao.pj, "pessoa jurídica", "pessoas jurídicas")}` : "", consolidacao.indeterminados > 0 ? `${plural(consolidacao.indeterminados, "participante", "participantes")} sem tipo confirmado pela fonte` : ""].filter(Boolean);
      pdf.texto(`${plural(consolidacao.participantes, "participante registrado", "participantes registrados")}: ${partesTipo.join(", ")}.`, { tamanho: 9.5, recuo: 4 });
      if (consolidacao.quadrosAmpliados > 0) {
        pdf.texto(
          `Os quadros ampliados conectam esta rede a ${plural(consolidacao.totalRaizes, "empresa distinta (raiz de CNPJ)", "empresas distintas (raízes de CNPJ)")}. Juntos, eles citam ${plural(consolidacao.totalEstabelecimentosQuadros, "estabelecimento", "estabelecimentos")}. Uma empresa com muitas unidades é UMA empresa: as filiais não representam empresas independentes.`,
          { tamanho: 9.5, recuo: 4, espacoAntes: 2 }
        );
        // As raízes com mais vínculos (máx. 5) — leitura consolidada, não lista bruta
        const raizesOrdenadas = Array.from(consolidacao.raizes.entries())
          .filter(([raiz]) => raiz !== l.cnpjRaiz)
          .sort((a, b) => b[1].participantes.size - a[1].participantes.size || b[1].estabelecimentos.size - a[1].estabelecimentos.size)
          .slice(0, 5);
        if (raizesOrdenadas.length > 0) {
          pdf.subtitulo("Empresas que mais aparecem nos quadros");
          pdf.bullets(
            raizesOrdenadas.map(([raiz, g]) => `${g.razaoSocial || `Raiz ${raiz}`}: ${plural(g.participantes.size, "participante em comum", "participantes em comum")} · ${plural(g.estabelecimentos.size, "estabelecimento citado", "estabelecimentos citados")}`)
          );
        }
        if (consolidacao.algumTruncado) {
          pdf.texto("Alguns quadros foram armazenados com teto de segurança: os totais reais de estabelecimentos são maiores do que a lista exibida.", { tamanho: 8.5, cor: CINZA, recuo: 4, espacoAntes: 2 });
        }
        if (consolidacao.semQuadro > 0) {
          pdf.texto(`${plural(consolidacao.semQuadro, "conexão ainda não ampliada", "conexões ainda não ampliadas")} — o quadro individual pode ser consultado na ficha, sob comando.`, { tamanho: 8.5, cor: CINZA, recuo: 4 });
        }
      }
    } else if (l.cnpjMatrizFormatado || l.statusMatriz) {
      pdf.subtitulo("Matriz e filiais");
      if (l.cnpjMatrizFormatado) pdf.inline("Matriz", `${l.cnpjMatrizFormatado}${l.statusMatriz ? ` — ${l.statusMatriz}` : ""}`);
      else if (l.statusMatriz === "RESOLVIDA") pdf.inline("Matriz", "esta unidade é a matriz, confirmada pelo identificador oficial");
      else pdf.inline("Matriz", l.statusMatriz ?? "");
    }
  }

  /* — 2 O QUE VALE INVESTIGAR (até 4 prioridades com a próxima ação) — */
  if (lacunasAbertas.length > 0) {
    pdf.secao("O que vale investigar");
    for (const lac of lacunasAbertas.slice(0, 4)) {
      pdf.reserva(52 + 2 * 14.2 + 6);
      pdf.subtitulo(lac.pergunta);
      pdf.texto(lac.proximaVerificacao || ESTADO_LACUNA[lac.estado] || "", { tamanho: 9.5, recuo: 4 });
    }
  }

  /* ===================== ANEXOS (só quando aprofundam) ===================== */

  // ANEXO A — atividades secundárias completas (UMA por linha)
  if (l.cnaesSecundarios.length > 0) {
    pdf.anexo("Atividades secundárias registradas");
    pdf.bullets(l.cnaesSecundarios);
  }

  // ANEXO B — representantes completos (quando a visão mostra só os 5 primeiros)
  if (qsa.length > 5) {
    pdf.anexo("Representantes registrados (quadro público, lista completa)");
    pdf.bullets(qsa.map((r) => `${r.nome}${r.qualificacao ? `: ${r.qualificacao}` : ""}${r.dataEntrada ? ` (desde ${dataCurta(r.dataEntrada)})` : ""}`));
  }

  // ANEXO C — relações em detalhe: participante por linha + consolidação por raiz.
  // v4: a instrução de ampliação aparece UMA vez no fim (nunca dezenas de vezes).
  if (consolidacao && consolidacao.participantes > 0) {
    pdf.anexo("Relações consultadas em detalhe");
    pdf.reserva(96);
    for (const p of l.relacoesConsultadas?.participantes ?? []) {
      pdf.bullets([`${p.nome}${p.cnpjFormatado ? ` (${p.cnpjFormatado})` : ""} — ${tipoParticipanteLegivel(p.tipo)}`]);
      if (p.quadro) {
        const grupos = new Map<string, { razaoSocial: string; count: number }>();
        for (const e of p.quadro.empresas) {
          const g = grupos.get(e.raiz);
          if (g) g.count += 1;
          else grupos.set(e.raiz, { razaoSocial: e.razaoSocial, count: 1 });
        }
        pdf.texto(
          `Quadro de ${dataCurta(p.quadro.coletadoEm)}: ${plural(p.quadro.totalPessoasJuridicas, "empresa distinta", "empresas distintas").replace(/^\d+/, (m) => num(Number(m)))} · ${plural(p.quadro.totalEmpresas, "estabelecimento registrado", "estabelecimentos registrados").replace(/^\d+/, (m) => num(Number(m)))}${p.quadro.truncado ? " (teto de armazenamento aplicado; o total real é maior)" : ""}.`,
          { tamanho: 9, cor: CINZA, recuo: 20, espacoAntes: 2 }
        );
        for (const [, g] of grupos) {
          pdf.bullets([`${g.razaoSocial}: ${plural(g.count, "estabelecimento desta empresa", "estabelecimentos desta empresa")}`], 28);
        }
      }
    }
    if (consolidacao.semQuadro > 0) {
      pdf.texto(`${plural(consolidacao.semQuadro, "participante sem quadro ampliado", "participantes sem quadro ampliado")}: o quadro individual pode ser consultado na ficha da empresa, sob comando.`, { tamanho: 8.5, cor: CINZA, espacoAntes: 4 });
    }
  }

  // ANEXO D — lacunas detalhadas: Pergunta → O que falta → Como verificar
  if (lacunasAbertas.length > 0) {
    pdf.anexo("O que falta descobrir");
    for (const lac of lacunasAbertas) {
      pdf.reserva(52 + pdf.alturaPar(lac.falta ?? "Não informado pela fonte.") + pdf.alturaPar(lac.proximaVerificacao || ESTADO_LACUNA[lac.estado] || ""));
      pdf.subtitulo(lac.pergunta);
      pdf.par("O que falta", lac.falta ?? "Não informado pela fonte.");
      pdf.par("Como verificar", lac.proximaVerificacao || ESTADO_LACUNA[lac.estado] || "");
    }
  }

  // ANEXO E — leitura comercial (IA): o que não coube na página 1 + hipóteses
  if (temIa) {
    pdf.anexo("Leitura comercial (IA — hipóteses)");
    pdf.texto(
      "O texto abaixo foi gerado por inteligência artificial a partir dos dados públicos coletados. Trate como hipótese de trabalho.",
      { tamanho: 8.5, cor: ATENCAO, espacoAntes: 2 }
    );
    if (l.iaSetor) pdf.inline("Setor aparente", l.iaSetor);
    if (l.iaPorte) pdf.inline("Porte aparente", l.iaPorte);
    if (l.iaLeitura && !iaNaPagina1) pdf.blocoIA("LEITURA EXECUTIVA (IA)", l.iaLeitura);
    if (l.iaHipoteses.length > 0) {
      pdf.par("Hipóteses a validar", "");
      pdf.bullets(l.iaHipoteses);
    }
  }

  return pdf.finalizar(
    `Modelo ficha-comercial v4 · Scout 360 ${appVersion()} · Lote ${lote.arquivo} · linha ${l.rowNumber}`
  );
}

/* ============================ PDF DO LOTE ================================= */

/**
 * Relatório compacto do lote — resumo, distribuições, identificadas,
 * revisões, falhas e cobertura. NÃO é um conjunto de dossiês.
 */
export async function gerarPdfLote(ds: DatasetExport): Promise<Buffer> {
  if (ds.linhas.length > LIMITE_PDF_LOTE) {
    throw new PdfLimiteError(
      `O lote tem ${ds.linhas.length} entradas no escopo escolhido — o PDF compacto cobre até ${LIMITE_PDF_LOTE}. Use a exportação Excel, que comporta o volume completo.`
    );
  }
  const lote = ds.lote;
  const pdf = await PdfDoc.criar(`Resumo do lote — ${lote.arquivo}`, "Relatório compacto do lote");
  const escopoLabel = ds.escopo === "TODAS" ? "Todas as empresas" : ds.escopo === "SEM_REVISAO" ? "Somente sem revisão pendente" : ds.escopo === "EM_REVISAO" ? "Somente as que exigem revisão" : "Empresas selecionadas";

  pdf.secao("Resultado geral");
  pdf.tabelaLinhas([
    { a: "Lote", b: lote.arquivo },
    { a: "Identificação", b: lote.id },
    { a: "Origem", b: lote.origem },
    { a: "Coleta", b: lote.finalizadoEm ? dataBR(lote.finalizadoEm) : "em andamento" },
    { a: "Escopo deste relatório", b: escopoLabel },
    { a: "Entradas recebidas", b: String(lote.entradasRecebidas) },
    { a: "Linhas processadas", b: String(lote.linhasProcessadas) },
    { a: "Consultas na fila", b: String(lote.aguardandoExecucao) },
    { a: "Empresas localizadas", b: plural(lote.pjsLocalizadas, "empresa distinta", "empresas distintas") },
    { a: "Compatíveis com as pistas", b: plural(lote.pjsIdentificadas, "empresa", "empresas") },
    { a: "Aguardando revisão humana", b: plural(lote.emRevisao, "linha") },
    { a: "Validadas por você", b: plural(lote.validadas, "identidade") },
    { a: "Não localizadas", b: plural(lote.naoIdentificadas, "entrada") },
    { a: "Falhas de consulta", b: plural(lote.falhas, "entrada") },
  ]);
  if (ds.linhas.length !== ds.totalLinhasLote) {
    pdf.texto(`Este relatório cobre ${plural(ds.linhas.length, "entrada")} do escopo escolhido (o lote completo tem ${ds.totalLinhasLote}).`, { tamanho: 8.5, cor: CINZA, espacoAntes: 6 });
  }

  // distribuições sustentadas
  if (lote.situacaoDist.length > 0 || lote.ufDist.length > 0 || lote.cnaeDist.length > 0) {
    pdf.secao("Distribuição das contas localizadas");
    if (lote.situacaoDist.length > 0) pdf.par("Situação cadastral", lote.situacaoDist.map((s) => `${s.key}: ${s.count}`).join(" · "));
    if (lote.ufDist.length > 0) pdf.par("UF", lote.ufDist.map((s) => `${s.key}: ${s.count}`).join(" · "));
    if (lote.cnaeDist.length > 0) pdf.par("Atividade (CNAE principal)", lote.cnaeDist.slice(0, 6).map((s) => `${s.key}: ${s.count}`).join(" · "));
  }

  // empresas identificadas
  // v0.11.0 (Gate 9/F1): só é "identificada" a linha com FICHA coletada — o
  // cnpjFormatado sozinho não prova nada (linhas NAO_ENCONTRADO carregam o CNPJ
  // PESQUISADO e apareciam aqui como bullet sem nome, inflando a lista).
  const identificadas = ds.linhas.filter((l) => !l.emRevisao && l.cnpjFormatado && (l.razaoSocial || l.nomeFantasia));
  if (identificadas.length > 0) {
    pdf.secao("Empresas identificadas");
    for (const l of identificadas) {
      pdf.bullets([
        `${l.razaoSocial || l.nomeFantasia} — CNPJ ${l.cnpjFormatado}${l.municipio || l.uf ? ` · ${[l.municipio, l.uf].filter(Boolean).join("/")}` : ""}${l.situacao ? ` · ${l.situacao}` : ""}`,
      ]);
    }
  }

  // casos em revisão
  const revisoes = ds.linhas.filter((l) => l.emRevisao);
  if (revisoes.length > 0) {
    pdf.secao("Casos em revisão");
    pdf.texto("Confirme na ficha qual é a empresa certa. O registro localizado ainda não foi confirmado como a empresa pretendida.", { tamanho: 9, cor: ATENCAO, espacoAntes: 2 });
    for (const l of revisoes) {
      pdf.bullets([
        `Linha ${l.rowNumber} · ${l.razaoSocial || l.entrada} — ${l.divergencias[0]?.descricao ?? "divergência entre a pista e o registro localizado"}`,
      ]);
    }
  }

  // falhas e pendências
  const falhas = ds.linhas.filter((l) => l.erro);
  const aguardando = ds.linhas.filter((l) => l.cnpjFormatado === "" && !l.erro);
  if (falhas.length > 0 || lote.aguardandoExecucao > 0) {
    pdf.secao("Falhas e pendências");
    for (const l of falhas) {
      pdf.bullets([`Linha ${l.rowNumber} · ${l.entrada} — ${l.erro}`]);
    }
    if (lote.aguardandoExecucao > 0) {
      pdf.bullets([`${plural(lote.aguardandoExecucao, "consulta")} na fila, sem resultado por enquanto.`]);
    }
    if (falhas.length === 0 && aguardando.length === 0 && lote.aguardandoExecucao === 0) {
      pdf.texto("Nenhuma pendência neste escopo.", { tamanho: 9, cor: CINZA });
    }
  }

  pdf.secao("Notas de leitura");
  pdf.bullets([
    "Os números deste relatório vêm da mesma contagem da interface do lote.",
    "Cada empresa é contada uma vez: matriz e filiais da mesma raiz somam uma.",
    "CNPJ localizado ainda pode exigir a sua revisão.",
    "As leituras de IA na planilha são hipóteses, separadas dos fatos.",
  ]);

  return pdf.finalizar(`Modelo resumo-lote v3 · Scout 360 ${appVersion()} · Escopo: ${escopoLabel}`);
}

/** util: CNPJ formatado (usado na composição das seções). */
export { formatCnpj };
