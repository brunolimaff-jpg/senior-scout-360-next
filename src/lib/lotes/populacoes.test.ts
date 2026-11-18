/**
 * v0.11.4 — populações de lote sem banco: mini-avaliador de predicados no estilo
 * Prisma, com a semântica REAL que causou os bugs: o `not` NÃO casa com NULL.
 * Se este avaliador "consertar" o `not` para incluir nulos, os testes passariam
 * sem provar nada — por isso a regra é explícita em aplicaCampo().
 */
// @ts-ignore — `bun:test` é fornecido pelo runtime; os tipos vêm de bun-types, que
// não está no `types` do tsconfig (dívida conhecida do repo), então o tsc do app
// acusaria módulo ausente só por causa deste arquivo.
import { describe, expect, test } from "bun:test";
import { CONFIRMADA_WHERE, DOSSIE_PRONTO_WHERE, mergeWhere, whereResolucao } from "./populacoes";

type Linha = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Avalia UMA condição de campo (igualdade, null, not, in, notIn, equals, contains). */
function aplicaCampo(valor: unknown, cond: unknown): boolean {
  if (cond === null) return valor === null;
  if (Array.isArray(cond)) return cond.some((c) => aplicaCampo(valor, c));
  if (typeof cond === "object") {
    const c = cond as Record<string, unknown>;
    if ("not" in c) {
      // Prisma: `not` filtra fora as linhas NULL, mesmo quando o alvo não é null.
      if (c.not === null) return valor !== null;
      return valor !== null && !aplicaCampo(valor, c.not);
    }
    if ("in" in c) return (c.in as unknown[]).some((v) => v === valor);
    if ("notIn" in c) return !(c.notIn as unknown[]).some((v) => v === valor);
    if ("equals" in c) return aplicaCampo(valor, c.equals);
    if ("contains" in c) return typeof valor === "string" && valor.includes(String(c.contains));
    throw new Error(`condição não suportada: ${JSON.stringify(cond)}`);
  }
  return valor === cond;
}

/** Avalia um where completo (AND/OR/NOT + igualdade por campo) contra uma linha. */
function aplica(where: Where, linha: Linha): boolean {
  for (const [chave, cond] of Object.entries(where)) {
    if (chave === "AND") {
      const itens = Array.isArray(cond) ? cond : [cond];
      if (!itens.every((i) => aplica(i as Where, linha))) return false;
    } else if (chave === "OR") {
      const itens = Array.isArray(cond) ? cond : [cond];
      if (!itens.some((i) => aplica(i as Where, linha))) return false;
    } else if (chave === "NOT") {
      const itens = Array.isArray(cond) ? cond : [cond];
      if (itens.some((i) => aplica(i as Where, linha))) return false;
    } else if (!aplicaCampo(linha[chave], cond)) {
      return false;
    }
  }
  return true;
}

// Fixtures: cada uma representa um estado real de linha do lote.
const diretoCnpj: Linha = { lookupStatus: "ENRIQUECIDO", identityStage: null, resolutionState: null, cnpjStatus: "VALIDA", cnpjRoot: "12345678" };
const localizadoDivergente: Linha = { lookupStatus: "ENRIQUECIDO", identityStage: "LOCALIZADO", resolutionState: null, cnpjRoot: "87654321" };
const reviewPendente: Linha = { lookupStatus: "PENDENTE", identityStage: null, resolutionState: "REVIEW", cnpjRoot: "11111111" };
const reviewEnriquecida: Linha = { lookupStatus: "ENRIQUECIDO", identityStage: null, resolutionState: "REVIEW", cnpjRoot: "22222222" };
const confirmada: Linha = { lookupStatus: "ENRIQUECIDO", identityStage: "VALIDADO", resolutionState: "CONFIRMED", cnpjRoot: "33333333" };
const unresolvada: Linha = { lookupStatus: "NAO_ENCONTRADO", identityStage: null, resolutionState: "UNRESOLVED", cnpjRoot: null };

describe("whereResolucao — filtros rápidos da tabela", () => {
  test("CONFIRMED inclui CNPJ direto (identityStage/resolutionState NULL) e confirmada", () => {
    const wr = whereResolucao("CONFIRMED")!;
    expect(wr).not.toBeNull();
    expect(aplica(wr, diretoCnpj)).toBe(true);
    expect(aplica(wr, confirmada)).toBe(true);
  });

  test("CONFIRMED exclui LOCALIZADO divergente e linhas em revisão", () => {
    const wr = whereResolucao("CONFIRMED")!;
    expect(aplica(wr, localizadoDivergente)).toBe(false);
    expect(aplica(wr, reviewPendente)).toBe(false);
    expect(aplica(wr, reviewEnriquecida)).toBe(false);
  });

  test("UNRESOLVED inclui a linha não encontrada (guarda v0.11.0 preservada)", () => {
    const wr = whereResolucao("UNRESOLVED")!;
    expect(aplica(wr, unresolvada)).toBe(true);
    // regressão: a guarda não pode transformar UNRESOLVED em "tudo que não é LOCALIZADO"
    expect(aplica(wr, diretoCnpj)).toBe(false);
    expect(aplica(wr, localizadoDivergente)).toBe(false);
  });

  test("REVIEW segue a união do contador (REVIEW ∨ LOCALIZADO enriquecido)", () => {
    const wr = whereResolucao("REVIEW")!;
    expect(aplica(wr, reviewPendente)).toBe(true);
    expect(aplica(wr, reviewEnriquecida)).toBe(true);
    expect(aplica(wr, localizadoDivergente)).toBe(true);
    expect(aplica(wr, diretoCnpj)).toBe(false);
  });

  test("filtro desconhecido devolve null", () => {
    expect(whereResolucao("ALL")).toBeNull();
  });
});

describe("CONFIRMADA_WHERE — população do escopo sem revisão", () => {
  test("inclui CNPJ direto e confirmada", () => {
    expect(aplica(CONFIRMADA_WHERE, diretoCnpj)).toBe(true);
    expect(aplica(CONFIRMADA_WHERE, confirmada)).toBe(true);
  });

  test("exclui revisão pendente (o caso que zerava o diálogo) e LOCALIZADO", () => {
    expect(aplica(CONFIRMADA_WHERE, reviewPendente)).toBe(false);
    expect(aplica(CONFIRMADA_WHERE, reviewEnriquecida)).toBe(false);
    expect(aplica(CONFIRMADA_WHERE, localizadoDivergente)).toBe(false);
  });

  test("continua funcional espalhado com o batchId (o espalhamento não perde AND)", () => {
    const where: Where = { batchId: "b1", ...CONFIRMADA_WHERE };
    expect((where.AND as unknown[]).length).toBe(2);
    expect(aplica(where, { ...diretoCnpj, batchId: "b1" })).toBe(true);
    expect(aplica(where, { ...diretoCnpj, batchId: "b2" })).toBe(false);
  });
});

describe("mergeWhere — filtros se compõem, nunca se sobrescrevem", () => {
  test("busca q vira item do AND e preserva o filtro de resolução", () => {
    const base = mergeWhere({ batchId: "b1" }, whereResolucao("CONFIRMED")!);
    const comBusca = mergeWhere(base, { OR: [{ legalName: { contains: "Alfa" } }] });

    expect(comBusca.OR).toBeUndefined(); // nada de OR sobrescrevendo o filtro
    expect((comBusca.AND as unknown[]).length).toBe(3); // 2 do filtro + 1 da busca

    expect(aplica(comBusca, { ...diretoCnpj, batchId: "b1", legalName: "Alfa Ltda" })).toBe(true);
    // fora do filtro de resolução continua fora, mesmo casando a busca
    expect(aplica(comBusca, { ...localizadoDivergente, batchId: "b1", legalName: "Alfa Ltda" })).toBe(false);
    // dentro do filtro, mas sem casar a busca, também não entra
    expect(aplica(comBusca, { ...diretoCnpj, batchId: "b1", legalName: "Beta S.A." })).toBe(false);
  });

  test("DOSSIE_PRONTO_WHERE concatena AND em vez de sobrescrever", () => {
    const base = mergeWhere({ batchId: "b1" }, whereResolucao("CONFIRMED")!);
    const antes = (base.AND as unknown[]).length;
    const comDossie = mergeWhere(base, DOSSIE_PRONTO_WHERE);

    expect((comDossie.AND as unknown[]).length).toBe(antes + 2);
    expect(comDossie.researchStatus).toBe("OK");
    expect(comDossie.aiStatus).toBe("OK");

    const dossiePronto = { ...diretoCnpj, batchId: "b1", researchStatus: "OK", aiStatus: "OK" };
    expect(aplica(comDossie, dossiePronto)).toBe(true);
    // sem o AND concatenado, bastaria "não é LOCALIZADO" para entrar na Mesa
    expect(aplica(comDossie, { ...diretoCnpj, batchId: "b1", researchStatus: null, aiStatus: null })).toBe(false);
  });

  test("OR pré-existente no base também sobrevive (dobrado no AND)", () => {
    const base: Where = { batchId: "b1", OR: [{ legalName: { contains: "Alfa" } }] };
    mergeWhere(base, { OR: [{ tradeName: { contains: "Alfa" } }] });
    expect(base.OR).toBeUndefined();
    expect((base.AND as unknown[]).length).toBe(2);
    // cada grupo OR é um CONJUNTO no AND: a linha precisa casar os dois (filtro E busca)
    expect(aplica(base, { batchId: "b1", legalName: "Alfa Ltda", tradeName: "Alfa Comércio" })).toBe(true);
    expect(aplica(base, { batchId: "b1", legalName: "Alfa Ltda" })).toBe(false);
    expect(aplica(base, { batchId: "b1", tradeName: "Alfa Comércio" })).toBe(false);
  });

  test("não mutila as constantes partilhadas (AND do DOSSIE fica no lugar)", () => {
    const base = mergeWhere({ batchId: "b1" }, DOSSIE_PRONTO_WHERE);
    expect((DOSSIE_PRONTO_WHERE.AND as unknown[]).length).toBe(2);
    expect((base.AND as unknown[]).length).toBe(2);
    expect(base.AND).not.toBe(DOSSIE_PRONTO_WHERE.AND);
  });
});
