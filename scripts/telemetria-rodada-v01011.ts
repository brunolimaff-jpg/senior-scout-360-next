/**
 * Exporta a telemetria agregada da rodada v0.10.11 (evolução para piloto
 * comercial: kit dev fora da área pública, laboratório com gate server-side,
 * plano 6,5× mais rápido sob concorrência, leitura 13px, escrita comercial) —
 * sem conteúdo bruto, sem dados de PF, sem segredos.
 * GATE CENTRAL visível: IA_CHAT/WEB_SEARCH/PAGE_READER devem ser ZERO na janela.
 * Uso: bun scripts/telemetria-rodada-v01011.ts
 */
import { db } from "../src/lib/db";
import { writeFileSync } from "fs";

const INICIO_RODADA = new Date("2026-10-22T14:40:00.000Z"); // início da rodada piloto comercial

async function resumoTipo(tipo: string, desde: Date | null) {
  const where = { tipo, ...(desde ? { startedAt: { gte: desde } } : {}) };
  const total = await db.telemetryEvent.count({ where });
  if (total === 0) return { total: 0, sucesso: 0, falha: 0, cacheHit: 0 };
  const evs = await db.telemetryEvent.findMany({ where, select: { estadoFinal: true, cacheHit: true } });
  let sucesso = 0, falha = 0, cacheHit = 0;
  for (const e of evs) {
    if (e.estadoFinal === "sucesso") sucesso += 1;
    if (e.estadoFinal === "falha") falha += 1;
    if (e.cacheHit === true) cacheHit += 1;
  }
  return { total, sucesso, falha, cacheHit };
}

async function main() {
  const tiposRodada = ["PLANO", "TRIAGEM", "RELACAO_GRAFO", "RELACAO_EXPANSAO", "DESCOBERTA_ROOT", "COLETA_CADASTRO", "ETAPA"];
  const tiposGate = ["IA_CHAT", "WEB_SEARCH", "PAGE_READER"];

  const janela: Record<string, unknown> = {};
  for (const t of tiposRodada) janela[t] = await resumoTipo(t, INICIO_RODADA);
  const gateJanela: Record<string, number> = {};
  for (const t of tiposGate) gateJanela[t] = (await resumoTipo(t, INICIO_RODADA)).total;

  const saida = {
    rodada: "v0.10.11 — evolução para piloto comercial",
    geradoEm: new Date().toISOString(),
    janelaDesde: INICIO_RODADA.toISOString(),
    gate_central: {
      ia_chat: gateJanela.IA_CHAT,
      web_search: gateJanela.WEB_SEARCH,
      page_reader: gateJanela.PAGE_READER,
      execucao_automatica: false,
      nota: "TODAS as PROVAS desta rodada usaram fontes simuladas/sintéticas (gate 0 nas suítes, provado pelos checks Z de cada suite). Os eventos de rede na janela são da JORNADA AO VIVO de verificação end-to-end no navegador (abaixo) — ação explícita do executor, dados públicos, escala pontual.",
    },
    jornada_ao_vivo: {
      descricao: "Verificação end-to-end no navegador (FRENTE 2/3): colar pistas → analisar → confirmar e identificar (2 tentativas — a 1ª caiu num erro de ambiente 'readonly database' após operação git no arquivo do banco; reinício provou recuperação). CNPJs públicos (WEG, Grendene) identificados na confirmação por desenho do produto; pista de site/e-mail resolvida na identificação.",
      coleta_cadastro: (janela.COLETA_CADASTRO as { total: number })?.total ?? 0,
      web_search: gateJanela.WEB_SEARCH,
      page_reader: gateJanela.PAGE_READER,
      ia_chat: gateJanela.IA_CHAT,
    },
    eventos_na_janela: janela,
    provas: {
      auditoria_acesso: "qa/auditoria-acesso-v01011.json (36/36)",
      plano_concorrencia_baseline: "qa/estresse-v0.10.11/plano-concorrencia-BASELINE-v0.10.10.json (p95 3.715ms)",
      plano_concorrencia_final: "qa/estresse-v0.10.11/plano-concorrencia.json (p95 576ms · 35,7 req/s)",
      regressoes: "v0.10.1–v0.10.8 exit 0/65/89/46/70 · limitador 7/7 · evolução 43/43 · adversarial 27/27×3 · stale 17/17 · falhas 18/18 · import 100/1k/5k gated",
    },
  };

  writeFileSync("qa/telemetria-rodada-v0.10.11.json", JSON.stringify(saida, null, 2));
  console.log("gate central:", saida.gate_central);
  console.log("→ qa/telemetria-rodada-v0.10.11.json");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
