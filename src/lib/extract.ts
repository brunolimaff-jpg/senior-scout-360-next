/**
 * Extração determinística de CNPJs e referências (domínio / e-mail / site) a partir
 * de texto NÃO estruturado colado pelo usuário. Sem IA: apenas regras de padrão,
 * mesmas funções no servidor (parse oficial) e no cliente (detecção ao vivo).
 *
 * Regras:
 * - Cada linha não vazia é tokenizada (delimitadores aceitos: tab ; | , e espaço).
 * - Cada token é classificado: CNPJ (com DV) | EMAIL | URL | DOMAIN | TEXT.
 * - A linha herda o primeiro CNPJ encontrado; sem CNPJ, herda a primeira referência.
 * - Linha só com nome de empresa (sem CNPJ/domínio/e-mail) vira pista NAME — a camada
 *   de resolução de identidade gera candidatos e a Receita confirma. Nunca descartada.
 * - Linhas sem nenhum reconhecível são INVALIDA (com motivo), nunca descartadas em silêncio.
 */
import { normalizeCnpj, validateCnpj } from "@/lib/cnpj";

export type InputKind = "CNPJ" | "DOMAIN" | "EMAIL" | "URL" | "TEXT";
export type LineKind = "HEADER" | "CNPJ" | "DOMAIN" | "EMAIL" | "URL" | "NAME" | "INVALID";

export interface TextStats {
  total: number; // linhas de dados (exclui cabeçalho)
  header: number;
  cnpjValido: number;
  cnpjInvalido: number;
  dominio: number;
  email: number;
  url: number;
  nome: number; // linhas só com nome de empresa (pista para resolução de identidade)
  invalido: number;
}

export interface ParsedLine {
  rowNumber: number; // 1-based entre linhas de dados (após cabeçalho)
  rawLine: string;
  cells: string[]; // tokens originais
  kind: LineKind;
  lookupKind: "CNPJ" | "DOMAIN" | "EMAIL" | "URL" | "NAME";
  rawCnpj: string;
  normalizedCnpj: string;
  cnpjValid: boolean;
  invalidReason: string | null;
  /** domínio canônico usado para dedupe e busca reversa (e-mail → domínio após @) */
  referenceDomain: string | null;
  /** referência original exibível (e-mail completo, domínio, site ou NOME da empresa) */
  referenceValue: string | null;
}

/* --------------------------- padrões de token --------------------------- */

/** CNPJ numérico OU alfanumérico (IN RFB 2229/2024): letras A–Z em QUALQUER uma
 *  das 12 primeiras posições — inclusive a raiz (ex. oficial 12.ABC.345/01DE-35).
 *  A validação de DV no validateCnpj descarta falso positivo — classificar não confirma. */
const CNPJ_TOKEN_RE = /^[0-9A-Za-z]{2}[.\-\s]?[0-9A-Za-z]{3}[.\-\s]?[0-9A-Za-z]{3}[/\-\s]?[0-9A-Za-z]{4}-?\d{2}$/;
const EMAIL_TOKEN_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const URL_TOKEN_RE = /^(?:https?:\/\/|www\.)\S+$/i;
const DOMAIN_TOKEN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const HEADER_KEYWORD_RE =
  /^(c\.?n\.?p\.?j|dom[ií]nio|domain|e-?mail|site|url|website|home ?page|p[áa]gina|nome|raz[aã]o ?social|nome ?fantasia|empresa|contato)$/i;
const SEPARATOR_LINE_RE = /^[\s\-=_*•·—–]+$/;

export interface ClassifiedToken {
  raw: string;
  kind: InputKind;
  /** para EMAIL: domínio após @; para URL: hostname; para DOMAIN: ele mesmo */
  domain?: string;
  email?: string;
}

/** Remove pontuação de borda que costuma vir colada ("CNPJ:", "(site)", "email;"). */
function stripEdgePunctuation(token: string): string {
  return token.replace(/^["'“”‘’([{<\s:;,]+/, "").replace(/["'“”‘’)\]}>:;,.\s]+$/, "");
}

/** Extrai o hostname de uma URL, removendo esquema, credenciais, porta, path e www. */
export function hostnameFromUrl(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  // credenciais user:pass@
  const at = s.indexOf("@");
  if (at >= 0 && s.indexOf("/") > at) s = s.slice(at + 1);
  else if (at >= 0 && !s.includes("/")) s = s.slice(at + 1);
  // corta em path/query/hash/porta
  s = s.split(/[/?#:]/)[0] ?? "";
  s = s.toLowerCase();
  return s.length > 0 && DOMAIN_TOKEN_RE.test(s) ? s : null;
}

/** Classifica um único token. Nunca lança. */
export function classifyToken(rawToken: string): ClassifiedToken {
  const raw = rawToken.trim();
  const t = stripEdgePunctuation(raw);
  if (t.length === 0) return { raw, kind: "TEXT" };

  // 1) e-mail (antes de domínio: contém @)
  if (EMAIL_TOKEN_RE.test(t)) {
    const domain = t.slice(t.lastIndexOf("@") + 1).toLowerCase();
    return { raw, kind: "EMAIL", email: t.toLowerCase(), domain };
  }
  // 2) URL explícita
  if (URL_TOKEN_RE.test(t)) {
    const host = hostnameFromUrl(t);
    if (host) return { raw, kind: "URL", domain: host };
  }
  // 3) CNPJ (formatado ou 14 dígitos crus)
  if (CNPJ_TOKEN_RE.test(t)) {
    return { raw, kind: "CNPJ" };
  }
  // 4) domínio solto (precisa de ponto + TLD alfabético)
  if (t.includes(".") && DOMAIN_TOKEN_RE.test(t)) {
    const d = t.toLowerCase().replace(/^www\./i, "");
    return { raw, kind: "DOMAIN", domain: d };
  }
  return { raw, kind: "TEXT" };
}

/** Escolhe o delimitador da linha e fatia os tokens. Ordem: tab ; | , espaço. */
function tokenizeLine(line: string): string[] {
  const delims = ["\t", ";", "|", ","];
  for (const d of delims) {
    if (line.includes(d)) {
      return line.split(d).map((p) => p.trim());
    }
  }
  return line.split(/\s+/).map((p) => p.trim()).filter((p) => p.length > 0);
}

function emptyStats(): TextStats {
  return { total: 0, header: 0, cnpjValido: 0, cnpjInvalido: 0, dominio: 0, email: 0, url: 0, nome: 0, invalido: 0 };
}

/**
 * Nome de empresa a partir dos tokens TEXT da linha (sem CNPJ/domínio/e-mail).
 * Regra conservadora: precisa de ≥4 letras e ao menos uma palavra com ≥3 letras.
 */
function companyNameFromTokens(tokens: string[]): string | null {
  const textTokens = tokens.map((t) => t.trim()).filter((t) => t.length > 0 && classifyToken(t).kind === "TEXT");
  if (textTokens.length === 0) return null;
  const candidate = textTokens.join(" ").replace(/\s+/g, " ").trim();
  const letters = candidate.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  if (letters.length < 4) return null;
  if (!candidate.split(/\s+/).some((w) => w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "").length >= 3)) return null;
  return candidate.slice(0, 120);
}

export interface ParseTextResult {
  lines: ParsedLine[];
  stats: TextStats;
  headerCells: string[] | null; // células da linha de cabeçalho detectada (se houver)
  detectedSeparator: string;
}

export interface ParseTextLimits {
  maxLines?: number;
  maxLineLength?: number;
}

/**
 * Parse completo do texto colado. Determinístico, sem exceções: linha problemática
 * vira INVALIDA com motivo. A primeira linha pode ser reconhecida como cabeçalho
 * (todos os tokens são texto e ao menos um é palavra-chave conhecida).
 */
export function parseTextLines(text: string, limits: ParseTextLimits = {}): ParseTextResult {
  const maxLines = limits.maxLines ?? 5000;
  const maxLineLength = limits.maxLineLength ?? 2000;

  const stats = emptyStats();
  const lines: ParsedLine[] = [];
  const rawLines = (text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);

  let headerCells: string[] | null = null;
  let headerChecked = false;
  let rowNumber = 0;
  let separator = "espaço";
  let separatorDecided = false;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (line.length === 0 || SEPARATOR_LINE_RE.test(line)) continue;

    // cabeçalho só pode ser a primeira linha útil
    if (!headerChecked) {
      headerChecked = true;
      const tokens = tokenizeLine(line);
      const kinds = tokens.map((t) => classifyToken(t));
      const isHeader =
        kinds.every((k) => k.kind === "TEXT") && kinds.some((k) => HEADER_KEYWORD_RE.test(k.raw.trim()));
      if (isHeader) {
        headerCells = tokens;
        stats.header = 1;
        continue;
      }
    }

    rowNumber++;
    if (rowNumber > maxLines) break; // limite tratado pela rota (resposta explícita)
    if (line.length > maxLineLength) {
      stats.total++;
      stats.invalido++;
      lines.push({
        rowNumber,
        rawLine: line.slice(0, 120) + "…",
        cells: [],
        kind: "INVALID",
        lookupKind: "CNPJ",
        rawCnpj: "",
        normalizedCnpj: "",
        cnpjValid: false,
        invalidReason: `Linha muito longa (${line.length} caracteres; máximo ${maxLineLength})`,
        referenceDomain: null,
        referenceValue: null,
      });
      continue;
    }

    const tokens = tokenizeLine(line);
    if (!separatorDecided && tokens.length > 1) {
      separator = line.includes("\t") ? "\\t" : line.includes(";") ? ";" : line.includes("|") ? "|" : line.includes(",") ? "," : "espaço";
      separatorDecided = true;
    }
    const classified = tokens.map((t) => classifyToken(t));

    // 1º CNPJ presente (válido ou não) comanda a linha
    const cnpjTok = classified.find((c) => c.kind === "CNPJ");
    // 1ª referência na ordem em que aparece
    const refTok = classified.find((c) => c.kind === "DOMAIN" || c.kind === "EMAIL" || c.kind === "URL");

    if (cnpjTok) {
      const v = validateCnpj(cnpjTok.raw);
      stats.total++;
      if (v.valid) {
        stats.cnpjValido++;
        lines.push({
          rowNumber, rawLine: line, cells: tokens, kind: "CNPJ", lookupKind: "CNPJ",
          rawCnpj: cnpjTok.raw, normalizedCnpj: v.normalized, cnpjValid: true,
          invalidReason: null, referenceDomain: null, referenceValue: null,
        });
      } else {
        stats.cnpjInvalido++;
        lines.push({
          rowNumber, rawLine: line, cells: tokens, kind: "INVALID", lookupKind: "CNPJ",
          rawCnpj: cnpjTok.raw, normalizedCnpj: v.normalized, cnpjValid: false,
          invalidReason: v.reason, referenceDomain: null, referenceValue: null,
        });
      }
      continue;
    }

    if (refTok && refTok.domain) {
      stats.total++;
      const kind = refTok.kind as "DOMAIN" | "EMAIL" | "URL";
      if (kind === "DOMAIN") stats.dominio++;
      else if (kind === "EMAIL") stats.email++;
      else stats.url++;
      const refValue = kind === "EMAIL" ? (refTok.email ?? refTok.domain) : refTok.domain;
      lines.push({
        rowNumber, rawLine: line, cells: tokens, kind, lookupKind: kind,
        rawCnpj: "", normalizedCnpj: "", cnpjValid: false,
        invalidReason: null, referenceDomain: refTok.domain, referenceValue: refValue,
      });
      continue;
    }

    // linha só com nome de empresa → pista NAME (resolução de identidade gera candidatos)
    const companyName = companyNameFromTokens(tokens);
    if (companyName) {
      stats.total++;
      stats.nome++;
      lines.push({
        rowNumber, rawLine: line, cells: tokens, kind: "NAME", lookupKind: "NAME",
        rawCnpj: "", normalizedCnpj: "", cnpjValid: false,
        invalidReason: null, referenceDomain: null, referenceValue: companyName,
      });
      continue;
    }

    stats.total++;
    stats.invalido++;
    const informative = tokens.filter((t) => t.length > 0).join(" ").slice(0, 80);
    lines.push({
      rowNumber, rawLine: line, cells: tokens, kind: "INVALID", lookupKind: "CNPJ",
      rawCnpj: "", normalizedCnpj: "", cnpjValid: false,
      invalidReason: informative
        ? `Nenhum CNPJ, domínio, e-mail, site ou nome de empresa reconhecido em "${informative}"`
        : "Nenhum CNPJ, domínio, e-mail, site ou nome de empresa reconhecido",
      referenceDomain: null,
      referenceValue: null,
    });
  }

  return { lines, stats, headerCells, detectedSeparator: separator };
}

/** Dedupe key de referência: sempre o domínio canônico, minúsculo. */
export function referenceKey(domain: string): string {
  return domain.toLowerCase().replace(/^www\./i, "");
}
