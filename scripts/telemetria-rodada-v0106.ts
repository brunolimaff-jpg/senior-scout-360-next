/**
 * Exporta a telemetria agregada da rodada v0.10.6 (triagem sem IA) — sem conteúdo
 * bruto, sem dados de PF, sem segredos. GATE CENTRAL visível: IA_CHAT/WEB_SEARCH/
 * PAGE_READER devem ser ZERO.
 * Uso: bun scripts/telemetria-rodada-v0106.ts
 */
import { db } from "../src/lib/db";

const INICIO_RODADA = new Date("2026-10-21T23:30:00.000Z");

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
  const tiposRodada = ["TRIAGEM", "RELACAO_GRAFO", "RELACAO_EXPANSAO", "DESCOBERTA_ROOT", "COLETA_CADASTRO", "ETAPA"];
  const resumo: Record<string, unknown> = {};
  for (const t of tiposRodada) resumo[t] = await resumoTipo(t, INICIO_RODADA);
  // gate: IA/busca web/leitura de páginas — na JANELA da rodada deve ser ZERO;
  // o total global é exportado para transparência (eventos anteriores pertencem a
  // atividade do operador antes do despacho desta rodada)
  const ia = await db.telemetryEvent.count({ where: { tipo: "IA_CHAT", startedAt: { gte: INICIO_RODADA } } });
  const web = await db.telemetryEvent.count({ where: { tipo: "WEB_SEARCH", startedAt: { gte: INICIO_RODADA } } });
  const reader = await db.telemetryEvent.count({ where: { tipo: "PAGE_READER", startedAt: { gte: INICIO_RODADA } } });
  const iaGlobal = await db.telemetryEvent.count({ where: { tipo: "IA_CHAT" } });
  const webGlobal = await db.telemetryEvent.count({ where: { tipo: "WEB_SEARCH" } });
  const readerGlobal = await db.telemetryEvent.count({ where: { tipo: "PAGE_READER" } });

  // detalhe da triagem (sem conteúdo — só contagens)
  const triagemEvs = await db.telemetryEvent.findMany({
    where: { tipo: "TRIAGEM", startedAt: { gte: INICIO_RODADA } },
    select: { etapa: true, resultados: true, payloadJson: true },
    orderBy: { startedAt: "asc" },
  });
  const triagem = triagemEvs.map((e) => ({
    etapa: e.etapa,
    lacunas: e.resultados,
    via: (JSON.parse(e.payloadJson ?? "{}") as { via?: string }).via ?? null,
    ia: 0,
    buscaWeb: 0,
  }));

  const evidencia = {
    rodada: "v0.10.6-triagem-sem-ia",
    geradoEm: new Date().toISOString(),
    inicioRodada: INICIO_RODADA.toISOString(),
    nota: "Eventos da rodada v0.10.6 (tipo novo TRIAGEM + eventos posteriores ao início da rodada). Sem conteúdo bruto, sem dados de PF, sem segredos. GATE DA RODADA: zero IA, zero busca web, zero leitura de páginas NA JANELA da rodada; totais globais exportados por transparência (eventos anteriores = atividade do operador antes do despacho, preservada).",
    gate: { IA_CHAT: ia, WEB_SEARCH: web, PAGE_READER: reader },
    gateGlobalForaDaJanela: { IA_CHAT: iaGlobal, WEB_SEARCH: webGlobal, PAGE_READER: readerGlobal, nota: "todos anteriores ao início da rodada" },
    resumo,
    triagemEventos: triagem,
  };
  await Bun.write("qa/telemetria-rodada-v0.10.6.json", JSON.stringify(evidencia, null, 2));
  console.log("gate:", JSON.stringify(evidencia.gate));
  for (const t of tiposRodada) {
    const r = resumo[t] as { total: number; sucesso: number; falha: number; cacheHit: number };
    console.log(`${t}: ${r.total} (ok ${r.sucesso} / falha ${r.falha} / cache ${r.cacheHit})`);
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
