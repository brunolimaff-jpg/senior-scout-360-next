/**
 * export/escopo.ts — ESCOPOS DE EXPORTAÇÃO (v0.10.15).
 *
 * Uma decisão simples de escopo compartilhada por Excel, PDF e CSV:
 * - TODAS: todas as entradas do lote (inclui as em revisão, marcadas como tal).
 * - SEM_REVISAO: somente entradas sem pendência de identidade.
 * - EM_REVISAO: somente as que exigem conferência humana.
 * - SELECIONADAS: as linhas marcadas na prévia (limitadas a LIMITE_SELECAO).
 *
 * Os rótulos são os da interface; o servidor é a guarda final de cada escopo.
 */
export type EscopoExportacao = "TODAS" | "SEM_REVISAO" | "EM_REVISAO" | "SELECIONADAS";

export const ESCOPO_LABEL: Record<EscopoExportacao, string> = {
  TODAS: "Todas as empresas",
  SEM_REVISAO: "Somente sem revisão pendente",
  EM_REVISAO: "Somente as que exigem revisão",
  SELECIONADAS: "Empresas selecionadas",
};

/** Valida o parâmetro de escopo vindo da URL. */
export function escopoDe(param: string | null): EscopoExportacao {
  if (param === "SEM_REVISAO" || param === "EM_REVISAO" || param === "SELECIONADAS") return param;
  return "TODAS";
}
