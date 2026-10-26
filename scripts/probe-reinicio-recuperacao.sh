#!/usr/bin/env bash
# =============================================================================
# probe-reinicio-recuperacao.sh — REINÍCIO REAL DO PROCESSO + RECUPERAÇÃO
# (auditoria da v0.10.9, item 5: "falhas 429, 503, timeout, REINÍCIO e
# recuperação sem perder evidências ou corromper o banco").
#
# Protocolo:
#   1. MARCADOR: cria um lote-sentinela no banco real + snapshot de contagens.
#   2. REINÍCIO: mata o servidor Next (portão 3000) — queda real do processo.
#   3. RECUPERAÇÃO: sobe de novo (scripts/boot-dev.sh) e mede o tempo até o
#      primeiro 200 de /api/stats.
#   4. PROVA: contagens idênticas, lote-sentinela legível, integridade SQLite
#      (PRAGMA integrity_check) e evidências da rodada presentes no disco.
# Saída: qa/estresse-v0.10.10/reinicio-recuperacao.json (exit 1 se algo divergir).
# =============================================================================
set -uo pipefail
cd /home/z/my-project
OUT_DIR="qa/estresse-v0.10.10"
mkdir -p "$OUT_DIR"
T_KILL=""; T_UP=""

echo "▸ 1) Marcador + snapshot de contagens (banco real)"
bun -e '
import { db } from "./src/lib/db";
const marcador = `reinicio_probe_${Date.now().toString(36)}`;
await db.importBatch.create({ data: { id: marcador, fileName: "probe-reinicio-sentinel.csv", storedPath: "qa/probe-reinicio-sentinel.csv", fileSize: 10, rowCount: 1, status: "PREVIEW" } });
const snap = {
  marcador,
  batches: await db.importBatch.count(),
  rows: await db.importRow.count(),
  telemetry: await db.telemetryEvent.count(),
};
await Bun.write("/tmp/reinicio-antes.json", JSON.stringify(snap));
console.log("snapshot_antes=" + JSON.stringify(snap));
await db.$disconnect();
' || { echo "✘ falhou ao criar marcador"; exit 1; }

echo "▸ 2) Reinício real — matando o processo do servidor (portão 3000)"
T_KILL=$(date +%s%3N)
PID_NEXT=$(ss -ltnp 2>/dev/null | grep ":3000" | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2)
PID_BUNRUN=$(ps aux | grep "bun run dev" | grep -v grep | awk '{print $2}' | head -1)
[ -n "$PID_BUNRUN" ] && kill "$PID_BUNRUN" 2>/dev/null
[ -n "$PID_NEXT" ] && kill "$PID_NEXT" 2>/dev/null
# espera a porta cair (queda confirmada)
for i in $(seq 1 20); do
  if ! curl -s -o /dev/null --max-time 1 http://localhost:3000/api/stats; then break; fi
  sleep 0.5
done
if curl -s -o /dev/null --max-time 1 http://localhost:3000/api/stats; then
  echo "✘ servidor NÃO caiu — reinício não provado"; exit 1
fi
echo "  servidor caiu (pid ${PID_NEXT:-?}) — porta 3000 inacessível"

echo "▸ 3) Recuperação — subindo novamente e medindo o tempo até o primeiro 200"
bash scripts/boot-dev.sh > /tmp/boot-reinicio.log 2>&1 || true
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 http://localhost:3000/api/stats; then break; fi
  sleep 1
done
if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/api/stats; then
  echo "✘ servidor não recuperou em 60s"; exit 1
fi
T_UP=$(date +%s%3N)
TEMPO_REC=$((T_UP - T_KILL))
echo "  recuperou em ${TEMPO_REC}ms"

echo "▸ 4) Prova — contagens, lote-sentinela, integridade SQLite e evidências"
bun -e '
import { Database } from "bun:sqlite";
import { db } from "./src/lib/db";
const antes = await Bun.file("/tmp/reinicio-antes.json").json();
const depois = {
  batches: await db.importBatch.count(),
  rows: await db.importRow.count(),
  telemetry: await db.telemetryEvent.count(),
};
const marcador = await db.importBatch.findUnique({ where: { id: antes.marcador }, select: { id: true, fileName: true } });
const sqlite = new Database("db/custom.db", { readonly: true });
const integridade = sqlite.query("PRAGMA integrity_check").get();
sqlite.close();
const resultado = {
  marcador_persistiu: !!marcador,
  contagens_antes: antes,
  contagens_depois: depois,
  contagens_identicas: antes.batches === depois.batches && antes.rows === depois.rows && antes.telemetry === depois.telemetry,
  integridade_sqlite: (integridade as { integrity_check?: string })?.integrity_check ?? "desconhecida",
};
await Bun.write("/tmp/reinicio-prova.json", JSON.stringify(resultado));
console.log("prova=" + JSON.stringify(resultado));
await db.$disconnect();
' || { echo "✘ falhou na prova pós-reinício"; exit 1; }

EVID=$(ls "$OUT_DIR"/*.json 2>/dev/null | wc -l)
# remove o lote-sentinela (fechamento limpo) e grava o relatório
bun -e '
import { db } from "./src/lib/db";
const antes = await Bun.file("/tmp/reinicio-antes.json").json();
await db.importBatch.delete({ where: { id: antes.marcador } }).catch(() => {});
await db.$disconnect();
'
jq -n --arg tempo "$TEMPO_REC" --slurpfile prova /tmp/reinicio-prova.json '{
  missao: "auditoria v0.10.9 item 5 — reinício real do processo e recuperação",
  processo_morto_e_recuperado: true,
  tempo_recuperacao_ms: ($tempo | tonumber),
  evidencias_da_rodada_no_disco: '"$EVID"',
  prova: $prova[0]
}' > "$OUT_DIR/reinicio-recuperacao.json"
cat "$OUT_DIR/reinicio-recuperacao.json"
# validação final dura
PROVA_OK=$(jq -r '.prova.marcador_persistiu and .prova.contagens_identicas and (.prova.integridade_sqlite == "ok")' "$OUT_DIR/reinicio-recuperacao.json")
if [ "$PROVA_OK" != "true" ]; then echo "✘✘ PROVA DE REINÍCIO FALHOU"; exit 1; fi
echo "✔ REINÍCIO + RECUPERAÇÃO PROVADOS (marcador intacto, contagens idênticas, sqlite ok)"
