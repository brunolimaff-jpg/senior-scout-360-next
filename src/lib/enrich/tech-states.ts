/**
 * tech-states.ts — ESTADOS DE ADOÇÃO DE TECNOLOGIA (Fase 2.3 do plano v0.6).
 *
 * Contrato: vaga ≠ produção. Uma tecnologia só é "Em uso confirmado" com fonte
 * que comprove operação vigente (site oficial, contrato, documentação do
 * fornecedor, notícia de implantação concluída). Cada citação no dossiê carrega
 * UM destes rótulos + fonte + data — a classificação é do modelo, o rótulo é
 * canônico daqui (fast e deep usam o mesmo vocabulário).
 */

export const TECH_STATES = [
  "Em uso confirmado",
  "Implantação anunciada",
  "Tecnologia mencionada em vaga",
  "Indício não confirmado",
  "Nenhuma evidência encontrada após pesquisa",
] as const;

export type TechState = (typeof TECH_STATES)[number];

/** Regra de negócio por estado — usada nos prompts e no title/aria da UI. */
export const TECH_STATE_HINT: Record<TechState, string> = {
  "Em uso confirmado": "fonte comprova operação vigente (fornecedor, contrato, site oficial, notícia de operação)",
  "Implantação anunciada": "projeto/contrato público, mas NÃO comprova sistema em operação",
  "Tecnologia mencionada em vaga": "sinal de atividade técnica associada ao produto — vaga NÃO comprova produção",
  "Indício não confirmado": "menção de terceiro/busca sem confirmação direta",
  "Nenhuma evidência encontrada após pesquisa": "lacuna honesta após o pacote de pesquisa",
};

/** Fragmento canônico para os prompts de IA (mesma lista para fast e deep). */
export function techStatesPromptFragment(): string {
  return TECH_STATES.map((s) => `"${s}" (${TECH_STATE_HINT[s]})`).join("; ");
}
