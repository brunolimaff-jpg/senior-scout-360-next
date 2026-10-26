/**
 * Utilidades determinísticas de CNPJ — sem IA, sem heurísticas genéticas.
 * Regra de ouro: CNPJ é SEMPRE string. Zeros à esquerda são preservados.
 *
 * CNPJ ALFANUMÉRICO (IN RFB 2229/2024 — novo padrão emitido a partir de 2026):
 * - 14 caracteres: 12 ALFANUMÉRICOS (raiz 8 + ordem 4 — letras E números em
 *   QUALQUER uma das 12 primeiras posições, inclusive a raiz) + 2 dígitos (DV).
 * - Exemplos oficiais da Receita: 00.000.000/E08G-12 (1º emitido, 31/07/2026,
 *   filial BB) e 12.ABC.345/01DE-35 (exemplo de formato da RFB — letras na raiz).
 * - DV: mesmo mod-11, mas letras entram como número pela tabela oficial
 *   A=17, B=18, ..., Z=42 (dígito vale ele mesmo). Verificado contra AMBOS os
 *   exemplos oficiais da RFB: base 00000000E08G → DV 12 e base 12ABC34501DE → DV 35.
 * - CNPJs numéricos antigos continuam válidos SEM alteração de comportamento
 *   (dígito vale ele mesmo na tabela, então o cálculo é idêntico ao anterior).
 */

/** Remove pontuação preservando dígitos e letras (maiúsculas) — zeros à esquerda intactos. */
export function normalizeCnpj(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Formata 14 caracteres como 00.000.000/0000-00 (também 00.000.000/E08G-12). */
export function formatCnpj(digits: string): string {
  const d = normalizeCnpj(digits);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

/** Tabela oficial da RFB: dígito vale ele mesmo; A=17 ... Z=42. */
const ALPHA_OFFSET = 17;

function charValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // "0".."9"
  return ALPHA_OFFSET + (code - 65); // "A".."Z" → 17..42
}

function mod11(chars: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += charValue(chars[i]) * weights[i];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Calcula os dois dígitos verificadores (mod-11, pesos 5..2 e 9..2; letras pela tabela RFB). */
export function calcDvs(base12: string): string {
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = mod11(base12, w1);
  const rest13 = base12 + String(dv1);
  const dv2 = mod11(rest13, w2);
  return `${dv1}${dv2}`;
}

/**
 * Constrói o CNPJ completo (14 caracteres, com DV calculado) a partir da raiz
 * (8 ALFANUMÉRICOS — a RFB permite letras nas 12 primeiras posições, inclusive a
 * raiz) e da ordem do estabelecimento (4 caracteres, ex.: "0001", "01DE" ou "E08G").
 * NUNCA implica matriz — o identificador oficial da Receita é quem confirma o tipo depois.
 */
export function cnpjFromRoot(root8: string, order4: string): string | null {
  const r = normalizeCnpj(root8);
  const o = normalizeCnpj(order4);
  if (r.length !== 8 || o.length !== 4) return null;
  const base12 = r + o;
  return base12 + calcDvs(base12);
}

/** true quando alguma das 12 primeiras posições (raiz ou ordem) contém letra —
 *  formato alfanumérico (2026). Exemplos: 00000000E08G12 e 12ABC34501DE35. */
export function isCnpjAlfanumerico(normalized: string): boolean {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(normalized)) return false;
  return /[A-Z]/.test(normalized.slice(0, 12));
}

export type CnpjValidation =
  | { valid: true; normalized: string; alfanumerico: boolean }
  | { valid: false; normalized: string; reason: string };

/** Validação completa: estrutura (12 alfanuméricos + 2 dígitos de DV) + DV.
 *  v0.10.1: a RFB permite LETRAS nas 12 primeiras posições — inclusive na raiz
 *  (exemplo oficial 12.ABC.345/01DE-35). A validação anterior exigia raiz numérica
 *  e rejeitava indevidamente o novo padrão. */
export function validateCnpj(raw: string): CnpjValidation {
  const normalized = normalizeCnpj(raw ?? "");
  if (normalized.length === 0) {
    return { valid: false, normalized, reason: "CNPJ vazio" };
  }
  if (normalized.length !== 14) {
    return {
      valid: false,
      normalized,
      reason: `CNPJ deve ter 14 caracteres (encontrados ${normalized.length})`,
    };
  }
  if (!/[0-9]{2}$/.test(normalized)) {
    return { valid: false, normalized, reason: "Dígitos verificadores devem ser numéricos" };
  }
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(normalized)) {
    return { valid: false, normalized, reason: "CNPJ aceita letras (A–Z) e números nas 12 primeiras posições e 2 dígitos finais" };
  }
  if (/^(\d)\1{13}$/.test(normalized)) {
    return { valid: false, normalized, reason: "CNPJ com todos os dígitos repetidos" };
  }
  const base12 = normalized.slice(0, 12);
  const expected = calcDvs(base12);
  const actual = normalized.slice(12, 14);
  if (expected !== actual) {
    return {
      valid: false,
      normalized,
      reason: `Dígito verificador inválido (esperado ${expected}, encontrado ${actual})`,
    };
  }
  return { valid: true, normalized, alfanumerico: isCnpjAlfanumerico(normalized) };
}
