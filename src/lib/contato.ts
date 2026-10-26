/**
 * contato.ts — REGRA ÚNICA DE CONTATO UTILIZÁVEL (v0.10.15).
 *
 * Fonte única da regra de telefone/e-mail utilizável, consumida por:
 * - Interface (ficha: ContactSection, cópia CRM, dossiê);
 * - Exportações (Excel, PDF, CSV via dataset de exportação).
 *
 * O valor CRU do cadastro nunca é descartado da auditoria/CSV técnico —
 * a regra define o que PODE ser apresentado como contato acionável.
 * Determinística, sem IA, sem rede.
 */

/**
 * telefoneUtil: telefone UTILIZÁVEL para contato.
 * O cadastro público às vezes traz valores fictícios (ex.: 000000000000).
 * Regra determinística: precisa ter dígitos suficientes para discar (8 a 13),
 * nunca todos iguais e não pode ser sequência inválida reconhecível (ex. zeros
 * à esquerda com resto vazio). Números legítimos incomuns (sem DDD, com
 * dígito 9 na frente, ramal separado por traço) continuam valendo — o corte
 * é por validade de DISCAGEM, não por formato comum.
 */
export function telefoneUtil(t: string | null | undefined): string {
  const raw = (t ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 13) return "";
  if (/^(\d)\1+$/.test(digits)) return ""; // todos iguais: 000000000000, 11111111...
  return raw;
}

/**
 * eMailUtil: e-mail acionável — precisa ter formato mínimo local@domínio.tld.
 * Serve para exportação/apresentação; NÃO classifica o e-mail como contato de
 * decisor (isso é papel do QSA/administração, com nome e qualificação).
 */
export function eMailUtil(t: string | null | undefined): string {
  const raw = (t ?? "").trim();
  if (!raw) return "";
  // formato mínimo: um @, local não vazio, domínio com ponto e sem espaços
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) return "";
  return raw;
}

/**
 * Qualificações do QSA que indicam quem participa da decisão
 * (determinístico, sem IA). O QSA registra a ADMINISTRAÇÃO registrada —
 * nunca prova quem compra tecnologia.
 */
export const DECISOR_QUAL_RE = /administr|diretor|president|gerente|titular|procurador|s[óo]cio/i;
