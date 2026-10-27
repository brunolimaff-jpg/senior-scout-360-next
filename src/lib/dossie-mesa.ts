import type { RowDetail } from "./types";

/**
 * G7 (consolidação Lotes × Mesa) — regras puras da Mesa de Investigação.
 *
 * Dossiê PRONTO: cadastro coletado (ENRIQUECIDO), pesquisa solicitada concluída
 * (researchStatus OK), síntese pronta (aiStatus OK) e identidade SEM bloqueio.
 * Mesma definição usada pelo servidor (filtro `dossie_pronto`) e pela ação da
 * linha ("Ler dossiê"). A UI usa apenas para rótulos/guarda de abertura; a
 * população canônica continua vindo do servidor (pesquisaProfunda.dossiesProntos).
 */
type CamposDossie = Pick<
  RowDetail,
  "lookupStatus" | "researchStatus" | "aiStatus" | "resolutionState" | "identityStage"
>;

export function dossiePronto(r: CamposDossie): boolean {
  return (
    r.lookupStatus === "ENRIQUECIDO" &&
    r.researchStatus === "OK" &&
    r.aiStatus === "OK" &&
    r.resolutionState !== "REVIEW" &&
    r.identityStage !== "LOCALIZADO"
  );
}

/**
 * Auto-abertura da ficha na Mesa: SOMENTE quando o resultado único é um dossiê
 * pronto. Conta não identificada/em revisão NÃO abre ficha automaticamente —
 * ela permanece em Lotes com o motivo e a próxima ação (G7/P0).
 */
export function deveAutoAbrirFicha(args: {
  canExport: boolean;
  active: boolean;
  rows: CamposDossie[];
  totalNaLista: number | null | undefined;
  selecaoManual: boolean;
  dossierRowNumber: number | null;
  autoAbertoLote: string | null;
  loteId: string;
}): boolean {
  return (
    args.canExport &&
    !args.active &&
    args.rows.length === 1 &&
    (args.totalNaLista == null || args.totalNaLista === 1) &&
    !args.selecaoManual &&
    args.dossierRowNumber == null &&
    args.autoAbertoLote !== args.loteId &&
    dossiePronto(args.rows[0])
  );
}
