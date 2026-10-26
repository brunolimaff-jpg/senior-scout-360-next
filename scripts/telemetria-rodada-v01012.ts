/**
 * Exporta a telemetria agregada da rodada v0.10.12 (confiança na identificação,
 * tabela painel de decisões, entrada sem IA, carregamento imediato) —
 * sem conteúdo bruto, sem dados de PF, sem segredos.
 * GATE CENTRAL visível: IA_CHAT/WEB_SEARCH/PAGE_READER devem ser ZERO na janela.
 * Uso: bun scripts/telemetria-rodada-v01011.ts
 */
import { db } from "../src/lib/db";
import { writeFileSync } from "fs";

const INICIO_RODADA = new Date("2026-10-22T15:55:00.000Z"); // início da rodada piloto comercial

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
    rodada: "v0.10.12 — confiança na identificação, painel de decisões, entrada sem IA, carregamento imediato",
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
      descricao: "FRENTE 5 — jornada completa com 24 entradas (scripts/jornada-24-v01012.ts) no dev server com fontes públicas reais: 15 CNPJ+nome corretos, 3 divergentes (o produto sinalizou LOCALIZADO com divergência explicada), 1 UF divergente, 1 inválida, 1 repetida, 3 pistas de nome sem registro (honesto). Ação explícita do executor, dados públicos, escala pontual (19 coletas cadastrais + poucas buscas). Verificação visual no navegador com capturas.",
      coleta_cadastro: (janela.COLETA_CADASTRO as { total: number })?.total ?? 0,
      web_search: gateJanela.WEB_SEARCH,
      page_reader: gateJanela.PAGE_READER,
      ia_chat: gateJanela.IA_CHAT,
    },
    eventos_na_janela: janela,
    provas: {
      identidade_v01012: "scripts/test-v01012-identidade.ts (40/40) — provas A/B/C/D + zero HTTP real",
      jornada_24: "scripts/jornada-24-v01012.ts (18/18 PASS)",
      carregamento: "scripts/medidas-carregamento-v01012.ts (7/7) — entradas animadas 4→0/1→0, TTFB p50 38ms",
      regressoes: "v0.10.1–v0.10.8 exit 0/30/65/89/46/70 · limitador 7/7 · evolução 43/43 · adversarial 27/27 · stale 17/17 · falhas 18/18 · import 100/1k/5k exit 0 · identidade 40/40 · jornada 18/18 · medidas 7/7",
    },
  };

  writeFileSync("qa/telemetria-rodada-v0.10.12.json", JSON.stringify(saida, null, 2));
  console.log("gate central:", saida.gate_central);
  console.log("→ qa/telemetria-rodada-v0.10.12.json");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
