import { describe, expect, test } from "bun:test";
import { dossiePronto, deveAutoAbrirFicha } from "../../src/lib/dossie-mesa";

/** G7 (P0) — comportamento da Mesa com zero dossiês: nenhuma ficha vazia automática. */

const pronto = {
  lookupStatus: "ENRIQUECIDO",
  researchStatus: "OK",
  aiStatus: "OK",
  resolutionState: "CONFIRMED",
  identityStage: "CORRESPONDENTE",
};

const falha = {
  lookupStatus: "NAO_ENCONTRADO",
  researchStatus: null,
  aiStatus: null,
  resolutionState: "UNRESOLVED",
  identityStage: null,
};

const baseArgs = {
  canExport: true,
  active: false,
  totalNaLista: 1,
  selecaoManual: false,
  dossierRowNumber: null,
  autoAbertoLote: null,
  loteId: "lote-1",
};

describe("dossiePronto", () => {
  test("aceita cadastro coletado + pesquisa + síntese + identidade sem bloqueio", () => {
    expect(dossiePronto(pronto)).toBe(true);
  });

  test("recusa conta não identificada (Cenário A do contrato)", () => {
    expect(dossiePronto(falha)).toBe(false);
  });

  test("recusa identidade em revisão ou apenas localizada", () => {
    expect(dossiePronto({ ...pronto, resolutionState: "REVIEW" })).toBe(false);
    expect(dossiePronto({ ...pronto, identityStage: "LOCALIZADO" })).toBe(false);
  });

  test("recusa pesquisa/síntese incompletas", () => {
    expect(dossiePronto({ ...pronto, researchStatus: null })).toBe(false);
    expect(dossiePronto({ ...pronto, researchStatus: "GERANDO" })).toBe(false);
    expect(dossiePronto({ ...pronto, aiStatus: "FALHOU" })).toBe(false);
  });
});

describe("deveAutoAbrirFicha", () => {
  test("abre com resultado único JÁ PRONTO", () => {
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [pronto] })).toBe(true);
  });

  test("NÃO abre com resultado único que falhou (ficha vazia proibida)", () => {
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [falha] })).toBe(false);
  });

  test("NÃO abre quando a lista tem mais de uma linha", () => {
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [pronto, pronto], totalNaLista: 2 })).toBe(false);
  });

  test("NÃO sobrescreve seleção manual, ficha aberta ou lote já auto-aberto", () => {
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [pronto], selecaoManual: true })).toBe(false);
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [pronto], dossierRowNumber: 7 })).toBe(false);
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [pronto], autoAbertoLote: "lote-1" })).toBe(false);
  });

  test("NÃO abre sem permissão de exportação (lote em processamento/preview)", () => {
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [pronto], canExport: false })).toBe(false);
    expect(deveAutoAbrirFicha({ ...baseArgs, rows: [pronto], active: true })).toBe(false);
  });
});
