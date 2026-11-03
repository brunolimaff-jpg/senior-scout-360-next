/**
 * Contrato do estado da fila de pesquisa profunda (Mesa de Contas).
 *
 * Por que arquivo próprio: o claim distribuído (CAS) e o executor vivem no engine,
 * mas o formato do estado é contrato compartilhado com o teste de regressão do claim.
 * Puro: sem banco, sem runtime — só o formato, o parse e a regra de dono.
 */

export type ModoPesquisaFila = "COMPLETO" | "ADAPTATIVO";

export interface ResearchQueueState {
  rowNumbers: number[];
  estado: "RODANDO" | "PAUSADA" | "CONCLUIDA" | "PARADA";
  /** modo de coleta da pesquisa (COMPLETO = pipeline integral; ADAPTATIVO = níveis 0/1/2) */
  modoPesquisa: ModoPesquisaFila;
  /** índice da próxima conta a processar (durável — retomada começa daqui) */
  posicao: number;
  motivoPausa: string | null;
  solicitadoEm: string;
  heartbeat: string;
  concluidas: number;
  puladas: number;
  falhas: number;
  /**
   * Executor dono da fila (G8.4). Sem isto, dois processos sobre o mesmo banco
   * executam a MESMA conta: a gravação do estado não é exclusiva entre processos.
   * Opcional para não quebrar estados gravados antes do campo existir.
   */
  dono?: string | null;
}

/** Serialização canônica: o CAS compara a string exata, então todo escritor usa esta. */
export function serializeQueue(state: ResearchQueueState): string {
  return JSON.stringify(state);
}

/**
 * Parse tolerante do JSON gravado. Estado inválido vira null (a fila simplesmente
 * não existe) em vez de lançar no meio do executor.
 */
export function parseQueueState(json: string | null | undefined): ResearchQueueState | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<ResearchQueueState>;
    if (!v || !Array.isArray(v.rowNumbers) || typeof v.estado !== "string") return null;
    if (typeof v.posicao !== "number" || !Number.isFinite(v.posicao)) return null;
    return v as ResearchQueueState;
  } catch {
    return null;
  }
}

/**
 * Dono utilizado quando o estado ainda não tem o campo (fila iniciada antes do G8.4).
 * A fila sem dono pode ser assumida por qualquer executor; depois disso, só pelo dono
 * (ou por quem vir o heartbeat dele velho).
 */
export function queueOwner(state: Pick<ResearchQueueState, "dono">): string | null {
  return state.dono ?? null;
}

/**
 * Uma fila RODANDO pode ser assumida por outro executor quando:
 * - não tem dono, ou
 * - o dono é este executor (retomada no mesmo processo), ou
 * - o heartbeat do dono está velho (executor morreu — mesmo critério de retomada após restart).
 *
 * `posse` aqui é só a REGRA; a exclusividade entre processos vem do CAS no banco
 * (o updateMany condicional que grava a nova string). Regra pura é testável offline.
 */
export function mayClaimQueue(
  state: ResearchQueueState,
  executorId: string,
  nowMs: number,
  staleMs: number
): boolean {
  if (state.estado !== "RODANDO") return false;
  const dono = queueOwner(state);
  if (!dono || dono === executorId) return true;
  const hb = new Date(state.heartbeat).getTime();
  return !Number.isFinite(hb) || nowMs - hb >= staleMs;
}
