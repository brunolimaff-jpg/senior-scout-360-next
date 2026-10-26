/**
 * Parser/serializador CSV determinístico.
 * - Detecta encoding: UTF-8 BOM, UTF-8 válido, fallback Latin-1 (ISO-8859-1).
 * - Detecta delimitador (; , \t |) contando ocorrências na linha de cabeçalho
 *   FORA de aspas.
 * - Suporta campos entre aspas com vírgula/ponto-e-vírgula/quebra de linha dentro.
 * - Guard anti CSV-injection na serialização (valores iniciados por = + - @ TAB CR).
 */

export type Delimiter = ";" | "," | "\t" | "|";

export interface ParseResult {
  text: string;
  encoding: "UTF-8-BOM" | "UTF-8" | "Latin-1";
  delimiter: Delimiter;
  rows: string[][];
  malformedQuotes: number;
}

const DELIMITER_CANDIDATES: Delimiter[] = [";", ",", "\t", "|"];

/** Decodifica bytes para texto com detecção simples e honesta de encoding. */
export function decodeWithEncoding(buf: Uint8Array): { text: string; encoding: ParseResult["encoding"] } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buf.slice(3)), encoding: "UTF-8-BOM" };
  }
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  // DetectaU+FFFD (substituição) => provavelmente Latin-1
  if (decoded.includes("\uFFFD")) {
    const latin = new TextDecoder("iso-8859-1").decode(buf);
    return { text: latin, encoding: "Latin-1" };
  }
  // Heurística leve: UTF-8 válido sem BOM
  return { text: decoded, encoding: "UTF-8" };
}

/** Conta ocorrências de um char fora de aspas em uma linha. */
function countOutsideQuotes(line: string, ch: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') i++; // aspas escapadas
      else inQuotes = !inQuotes;
    } else if (!inQuotes && c === ch) count++;
  }
  return count;
}

export function detectDelimiter(text: string): { delimiter: Delimiter; counts: Record<string, number> } {
  // considera as primeiras linhas não vazias
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 5);
  const counts: Record<string, number> = {};
  let best: Delimiter = ";";
  let bestScore = -1;
  for (const d of DELIMITER_CANDIDATES) {
    let total = 0;
    for (const l of lines) total += countOutsideQuotes(l, d);
    counts[d === "\t" ? "\\t" : d] = total;
    // delimitador deve aparecer igualmente em todas as linhas candidatas (>0)
    const perLine = lines.map((l) => countOutsideQuotes(l, d));
    const consistent = perLine.every((n) => n === perLine[0] && n > 0);
    const score = consistent ? total * 10 + (perLine[0] ?? 0) : total;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return { delimiter: best, counts };
}

/** Faz split de uma linha respeitando aspas duplas. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Faz parse completo do texto CSV. Linhas totalmente vazias são ignoradas. */
export function parseCsv(text: string, delimiter?: Delimiter): Omit<ParseResult, "encoding"> {
  const det = delimiter ? { delimiter } : detectDelimiter(text);
  let malformedQuotes = 0;
  const rows: string[][] = [];
  const rawLines = text.split(/\r?\n/);
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    i++;
    if (line.trim() === "") continue;
    const opensWithQuote = line.trimStart().startsWith('"');
    const quoteCount = (line.match(/"/g) ?? []).length;
    let full = line;
    // campo com quebra de linha dentro de aspas: consome próximas linhas
    while (opensWithQuote && quoteCount % 2 !== 0 && i < rawLines.length) {
      full += "\n" + rawLines[i];
      i++;
    }
    if (opensWithQuote && quoteCount % 2 !== 0) malformedQuotes++;
    rows.push(splitLine(full, det.delimiter));
  }
  return { text, delimiter: det.delimiter, rows, malformedQuotes };
}

/** Parse + encoding a partir de bytes. */
export function parseCsvFromBytes(buf: Uint8Array, delimiter?: Delimiter): ParseResult {
  const { text, encoding } = decodeWithEncoding(buf);
  const parsed = parseCsv(text, delimiter);
  return { ...parsed, encoding };
}

/** Guard anti CSV-injection. */
export function sanitizeCsvValue(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  s = s.replace(/\r?\n/g, " ").trim();
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'` + s;
  }
  return s;
}

/** Serializa linhas para CSV com delimitador. */
export function toCsv(rows: (string | number | null | undefined)[][], delimiter: Delimiter = ";"): string {
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = sanitizeCsvValue(v);
          if (s.includes(delimiter) || s.includes('"')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(delimiter)
    )
    .join("\r\n");
}

/** Sanitiza nome de arquivo para uso em nomes de export. */
export function sanitizeFileBase(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w\-. ]+/g, "_").slice(0, 60).trim();
  return base.length > 0 ? base : "lote";
}
