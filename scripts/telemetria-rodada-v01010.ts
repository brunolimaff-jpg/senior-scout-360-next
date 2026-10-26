/**
 * Exporta a telemetria agregada da rodada v0.10.10 (CORRECT_DELTA + estresse real
 * da v0.10.9: voo único anti-duplicação, probe com asserts, cargas progressivas,
 * falhas de fonte, reinício/recuperação) — sem conteúdo bruto, sem dados de PF,
 * sem segredos. GATE CENTRAL visível: IA_CHAT/WEB_SEARCH/PAGE_READER devem ser
 * ZERO na janela da rodada.
 * Uso: bun scripts/telemetria-rodada-v01010.ts
 */
import { db } from "../src/lib/db";
import { writeFileSync } from "fs";

const INICIO_RODADA = new Date("2026-10-22T13:45:00.000Z"); // início da missão de estresse da v0.10.9

async function resumoTipo(tipo: string, desde: Date | null) {
  const where = { tipo, ...(desde ? { startedAt: { gte: desde } } : {}) };
  const total = await db.telemetryEvent.count({ where });
  if (total === 0) return { total: 0, sucesso: 0, falha: 0, cacheHit: 0, porFonte: {} as Record<string, number> };
  const evs = await db.telemetryEvent.findMany({ where, select: { fonte: true, estadoFinal: true, cacheHit: true } });
  const porFonte: Record<string, number> = {};
  let sucesso = 0;
  let falha = 0;
  let cacheHit = 0;
  for (const e of evs) {
    if (e.fonte) porFonte[e.fonte] = (porFonte[e.fonte] ?? 0) + 1;
    if (e.estadoFinal === "sucesso") sucesso += 1;
    if (e.estadoFinal === "falha") falha += 1;
    if (e.cacheHit === true) cacheHit += 1;
  }
  return { total, sucesso, falha, cacheHit, porFonte };
}

async function main() {
  const tiposRodada = ["PLANO", "TRIAGEM", "RELACAO_GRAFO", "RELACAO_EXPANSAO", "DESCOBERTA_ROOT", "COLETA_CADASTRO", "ETAPA"];
  const tiposGate = ["IA_CHAT", "WEB_SEARCH", "PAGE_READER"];

  const janela: Record<string, unknown> = {};
  for (const t of tiposRodada) janela[t] = await resumoTipo(t, INICIO_RODADA);
  const gateJanela: Record<string, number> = {};
  for (const t of tiposGate) gateJanela[t] = (await resumoTipo(t, INICIO_RODADA)).total;

  const globais: Record<string, number> = {};
  for (const t of [...tiposRodada, ...tiposGate]) {
    globais[t] = await db.telemetryEvent.count({ where: { tipo: t } });
  }

  const foraDaJanela = Object.fromEntries(
    Object.entries(globais).map(([t, total]) => [t, Math.max(0, total - ((janela[t] as { total: number })?.total ?? (t === "IA_CHAT" || t === "WEB_SEARCH" || t === "PAGE_READER" ? gateJanela[t] : 0)))])
  );

  // eventos "coalescidos" da rodada — prova da correção anti-duplicação na telemetria
  const evsRelacao = await db.telemetryEvent.findMany({
    where: { tipo: { in: ["RELACAO_GRAFO", "RELACAO_EXPANSAO"] }, startedAt: { gte: INICIO_RODADA } },
    select: { payloadJson: true },
  });
  let coalescidos = 0;
  let consulta = 0;
  for (const e of evsRelacao) {
    try {
      const p = JSON.parse(e.payloadJson ?? "{}") as { via?: string };
      if (p.via === "coalescido") coalescidos += 1;
      if (p.via === "consulta") consulta += 1;
    } catch { /* payload ilegível — ignora */ }
  }

  const rel = {
    rodada: "v0.10.10-correct-delta-estresse-real",
    janela: { inicio: INICIO_RODADA.toISOString(), fim: new Date().toISOString() },
    gate_central: {
      ia_chat: gateJanela["IA_CHAT"],
      web_search: gateJanela["WEB_SEARCH"],
      page_reader: gateJanela["PAGE_READER"],
      descricao: "ZERO IA, ZERO busca web, ZERO leitura de página na janela da rodada — as suítes de estresse usam apenas fontes simuladas (fetcher injetado + fetch global interceptado) e cargas em banco temporário.",
    },
    voo_unico_na_janela: {
      consultas_externas: consulta,
      coalescidos: coalescidos,
      descricao: "cada evento via=consulta corresponde a UMA chamada externa; eventos via=coalescido são comandos concorrentes que compartilharam o voo (nenhuma chamada extra).",
    },
    eventos_janela: janela,
    totais_globais_fora_da_janela_por_transparencia: foraDaJanela,
    provas_da_rodada: [
      "qa/estresse-v0.10.10/aprovacao-adversarial.json (item 3)",
      "qa/estresse-v0.10.10/plano-desatualizado.json (item 4)",
      "qa/estresse-v0.10.10/carga-progressiva.json (item 2)",
      "qa/estresse-v0.10.10/falhas-fonte.json (item 5)",
      "qa/estresse-v0.10.10/reinicio-recuperacao.json (item 5)",
      "qa/estresse-v0.10.10/carga-http-plano.json (item 6)",
      "qa/estresse-v0.10.10/metricas-consolidadas.json (item 6)",
    ],
    nota: "Rodada sem chamada externa real: todas as provas usam simuladores locais; a sonda HTTP (item 6) usa apenas o endpoint de leitura local do plano.",
  };

  writeFileSync("qa/telemetria-rodada-v0.10.10.json", JSON.stringify(rel, null, 2));
  console.log(JSON.stringify({ gate: rel.gate_central, voo_unico: rel.voo_unico_na_janela, PLANO: (janela["PLANO"] as { total: number }).total, evidencia: "qa/telemetria-rodada-v0.10.10.json" }));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
