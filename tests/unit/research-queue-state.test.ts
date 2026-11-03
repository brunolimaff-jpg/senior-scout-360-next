import { describe, expect, test } from "bun:test";
import {
  mayClaimQueue,
  parseQueueState,
  serializeQueue,
  type ResearchQueueState,
} from "../../src/lib/enrich/research-queue-state";

/** G8.4 — regra de posse da fila de pesquisa. O CAS no banco garante exclusividade;
 *  aqui só a decisão pura: quem pode assumir a fila. */

const STALE = 3 * 60_000;
const NOW = Date.parse("2026-11-03T12:00:00.000Z");

const fila = (over: Partial<ResearchQueueState> = {}): ResearchQueueState => ({
  rowNumbers: [1, 2, 3],
  estado: "RODANDO",
  modoPesquisa: "COMPLETO",
  posicao: 0,
  motivoPausa: null,
  solicitadoEm: "2026-11-03T11:00:00.000Z",
  heartbeat: new Date(NOW).toISOString(),
  concluidas: 0,
  puladas: 0,
  falhas: 0,
  ...over,
});

describe("mayClaimQueue", () => {
  test("fila sem dono pode ser assumida", () => {
    expect(mayClaimQueue(fila({ dono: null }), "q_a", NOW, STALE)).toBe(true);
    const semCampo = fila();
    delete semCampo.dono;
    expect(mayClaimQueue(semCampo, "q_a", NOW, STALE)).toBe(true);
  });

  test("o próprio dono pode continuar", () => {
    expect(mayClaimQueue(fila({ dono: "q_a" }), "q_a", NOW, STALE)).toBe(true);
  });

  test("dono vivo com heartbeat recente NÃO é tomado", () => {
    expect(mayClaimQueue(fila({ dono: "q_a" }), "q_b", NOW, STALE)).toBe(false);
  });

  test("dono com heartbeat velho é assumível (executor morreu)", () => {
    const velha = fila({ dono: "q_a", heartbeat: new Date(NOW - STALE - 1).toISOString() });
    expect(mayClaimQueue(velha, "q_b", NOW, STALE)).toBe(true);
  });

  test("fila parada ou concluída nunca é assumida por execução", () => {
    expect(mayClaimQueue(fila({ estado: "PARADA" }), "q_a", NOW, STALE)).toBe(false);
    expect(mayClaimQueue(fila({ estado: "PAUSADA" }), "q_a", NOW, STALE)).toBe(false);
    expect(mayClaimQueue(fila({ estado: "CONCLUIDA" }), "q_a", NOW, STALE)).toBe(false);
  });
});

describe("parseQueueState / serializeQueue", () => {
  test("JSON inválido ou incompleto vira null, sem lançar", () => {
    expect(parseQueueState(null)).toBeNull();
    expect(parseQueueState("não é json")).toBeNull();
    expect(parseQueueState(JSON.stringify({ estado: "RODANDO" }))).toBeNull();
    expect(parseQueueState(JSON.stringify({ rowNumbers: [1] }))).toBeNull();
  });

  test("round-trip preserva o estado e o dono", () => {
    const original = fila({ dono: "q_a", posicao: 2 });
    expect(parseQueueState(serializeQueue(original))).toEqual(original);
  });

  test("serialização é determinística — o CAS compara a string exata", () => {
    expect(serializeQueue(fila())).toBe(serializeQueue(fila()));
  });
});
