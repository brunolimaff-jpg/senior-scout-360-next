/**
 * pdf-inspecao.ts — leitor de conteúdo dos PDFs gerados pelo motor Scout 360
 * (pdf-lib). Extrai, POR PÁGINA, cada operação de texto com a posição Y da
 * linha de base, para provar em qual página cada título e cada bloco caíram.
 *
 * Técnica: cada página do motor tem UM content stream próprio; o rodapé do
 * motor desenha "Página N de M" dentro do mesmo stream, o que permite rotular
 * a página sem parsear a xref. Os textos saem como `(texto) Tj` ou `<hex> Tj`
 * precedidos de `x y Td` (pdf-lib usa Td com deslocamento relativo a BT).
 */
import { inflateSync } from "zlib";

export interface LinhaPdf {
  pagina: number;
  y: number;
  texto: string;
}

interface OperacaoBruta {
  y: number;
  texto: string;
}

function decodificarHex(hex: string): string {
  let s = "";
  for (let j = 0; j + 1 < hex.length; j += 2) s += String.fromCharCode(Number.parseInt(hex.slice(j, j + 2), 16));
  return s;
}

function descompactarStreams(buf: Buffer): string[] {
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
  return partes;
}

/** Operações de texto de um stream com a Y vigente (Td/Tm rastreados). */
function operacoesDoStream(stream: string): OperacaoBruta[] {
  const ops: OperacaoBruta[] = [];
  // blocos BT..ET com rastreio de y: `1 0 0 1 x y Tm` ou `x y Td`
  const reBloco = /BT([\s\S]*?)ET/g;
  for (const m of stream.matchAll(reBloco)) {
    const bloco = m[1];
    let y = 0;
    let textoAcumulado = "";
    for (const linha of bloco.split(/\r?\n/)) {
      const tdm = /([-\d.]+)\s+([-\d.]+)\s+T[dDm]/g;
      let last: RegExpExecArray | null;
      while ((last = tdm.exec(linha))) y = Number(last[2]);
      const tj = /\(((?:\\.|[^\\()])*)\)\s*Tj/.exec(linha) ?? /<([0-9A-Fa-f]+)>\s*Tj/.exec(linha);
      if (tj) {
        const s = tj[0].startsWith("(") ? tj[1].replace(/\\([()\\])/g, "$1") : decodificarHex(tj[1]);
        if (s.trim()) textoAcumulado += (textoAcumulado ? "\n" : "") + s;
      }
    }
    if (textoAcumulado) ops.push({ y: Math.round(y * 10) / 10, texto: textoAcumulado });
  }
  return ops;
}

/** Extrai todas as linhas de texto com (pagina, y) — páginas rotuladas pelo rodapé do motor. */
export function linhasPorPagina(buf: Buffer): LinhaPdf[] {
  const saida: LinhaPdf[] = [];
  for (const stream of descompactarStreams(buf)) {
    const ops = operacoesDoStream(stream);
    if (ops.length === 0) continue; // streams de fonte/anotação não têm texto
    // o rodapé "Página N de M" é desenhado no MESMO stream do conteúdo da página
    const marcador = ops.find((o) => /Página\s+\d+\s+de\s+\d+/.test(o.texto));
    const pagina = marcador ? Number(/Página\s+(\d+)\s+de\s+\d+/.exec(marcador.texto)?.[1] ?? 1) : 1;
    for (const op of ops) {
      for (const linha of op.texto.split("\n")) {
        saida.push({ pagina, y: op.y, texto: linha });
      }
    }
  }
  return saida.sort((a, b) => a.pagina - b.pagina || b.y - a.y);
}

/** Todas as páginas presentes (rotuladas pelo rodapé). */
export function numeroDePaginas(buf: Buffer): number {
  let maior = 0;
  for (const l of linhasPorPagina(buf)) if (l.pagina > maior) maior = l.pagina;
  return maior;
}

/**
 * v0.11.1 (Gate 3): texto da MAIOR FONTE da página 1 — prova qual nome é o
 * título principal do documento (v3 desenhava o nome comercial maior; a v4
 * desenha a razão social maior). Rastreia o operador `Tf` dentro de cada
 * bloco BT..ET e devolve o texto associado ao maior tamanho.
 */
export function fonteMaiorPagina1(buf: Buffer): string | null {
  let melhor: { tamanho: number; texto: string } | null = null;
  for (const stream of descompactarStreams(buf)) {
    const ops = operacoesDoStream(stream);
    if (ops.length === 0) continue;
    const marcador = ops.find((o) => /Página\s+\d+\s+de\s+\d+/.test(o.texto));
    const pagina = marcador ? Number(/Página\s+(\d+)\s+de\s+\d+/.exec(marcador.texto)?.[1] ?? 1) : 1;
    if (pagina !== 1) continue;
    // re-varre o stream rastreando Tf para cada Tj
    const reBloco = /BT([\s\S]*?)ET/g;
    for (const m of stream.matchAll(reBloco)) {
      const bloco = m[1];
      let tamanhoAtual = 0;
      let textoDoBloco = "";
      for (const linha of bloco.split(/\r?\n/)) {
        const tf = /(\d+(?:\.\d+)?)\s+Tf/.exec(linha);
        if (tf) tamanhoAtual = Number(tf[1]);
        const tj = /\(((?:\\.|[^\\()])*)\)\s*Tj/.exec(linha) ?? /<([0-9A-Fa-f]+)>\s*Tj/.exec(linha);
        if (tj) {
          const s = tj[0].startsWith("(") ? tj[1].replace(/\\([()\\])/g, "$1") : decodificarHex(tj[1]);
          if (s.trim()) textoDoBloco += s;
        }
      }
      if (textoDoBloco.trim() && tamanhoAtual > (melhor?.tamanho ?? 0)) {
        melhor = { tamanho: tamanhoAtual, texto: textoDoBloco.trim() };
      }
    }
  }
  return melhor?.texto ?? null;
}
