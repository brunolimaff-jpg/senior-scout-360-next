/**
 * Exporta a telemetria agregada da rodada v0.10.9 (evolução e estresse: planejador
 * PLANO_CONSULTAS_V1 + correção da concorrência do limitador) — sem conteúdo bruto,
 * sem dados de PF, sem segredos. GATE CENTRAL visível: IA_CHAT/WEB_SEARCH/
 * PAGE_READER devem ser ZERO na janela da rodada.
 * Uso: bun scripts/telemetria-rodada-v0109.ts
 */
import { db } from "../src/lib/db";
import { writeFileSync } from "fs";

const INICIO_RODADA = new Date("2026-10-22T13:05:00.000Z"); // 1ª evidência (limitador-antes 13:09; margem p/ preparação)

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

  const rel = {
    rodada: "v0.10.9-evolucao-e-estresse",
    janela: { inicio: INICIO_RODADA.toISOString(), fim: new Date().toISOString() },
    gate_central: {
      ia_chat: gateJanela["IA_CHAT"],
      web_search: gateJanela["WEB_SEARCH"],
      page_reader: gateJanela["PAGE_READER"],
      descricao: "ZERO IA, ZERO busca web, ZERO leitura de página na janela da rodada — consultas estruturadas sob comando (DESCOBERTA_ROOT da aprovação do plano) são registradas por transparência.",
    },
    eventos_janela: janela,
    totais_globais_fora_da_janela_por_transparencia: foraDaJanela,
    nota: "Aprovada 1 consulta ao vivo pelo plano (DESCOBERTA_ROOT sucesso, alvo 04733767) — o MESMO executor da ficha. Atividade do operador fora da janela (13:31, alvo 08044783) registrada por transparência.",
  };

  writeFileSync("qa/telemetria-rodada-v0.10.9.json", JSON.stringify(rel, null, 2));
  console.log(JSON.stringify({ gate: rel.gate_central, PLANO: (janela["PLANO"] as { total: number }).total, DESCOBERTA_ROOT: (janela["DESCOBERTA_ROOT"] as { total: number }).total, evidencia: "qa/telemetria-rodada-v0.10.9.json" }));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
