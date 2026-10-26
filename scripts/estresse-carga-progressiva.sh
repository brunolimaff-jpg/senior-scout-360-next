#!/usr/bin/env bash
# =============================================================================
# estresse-carga-progressiva.sh — progressão GATED de carga sintética (v0.10.10).
#
# Missão da auditoria (item 2): cargas de 100, 1.000 e 5.000 entradas, com
# progressão superior SOMENTE se os resultados anteriores forem seguros.
# "Seguro" = probe-import-5k.ts saiu com exit 0 (quantidades, estados e
# invariantes conferidos — nunca "PASS por terminar").
#
# Cada degrau grava /tmp/probe-import-<n>-resultado.json; este orquestrador
# consolida tudo em qa/estresse-v0.10.10/carga-progressiva.json.
# ZERO chamadas externas (banco temporário por degrau, fontes simuladas).
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="qa/estresse-v0.10.10"
mkdir -p "$OUT_DIR"
PASSOS=(100 1000 5000)
DECLARADO="{}"
SAIR=0

for N in "${PASSOS[@]}"; do
  echo ""
  echo "═══════════ DEGRAU ${N} ═══════════"
  if bun scripts/probe-import-5k.ts "$N"; then
    echo "▸ degrau ${N}: SEGURO (exit 0)"
    RESULT=$(cat "/tmp/probe-import-${N}-resultado.json")
    DECLARADO=$(echo "$DECLARADO" | jq -c --argjson n "$N" --argjson r "$RESULT" '.[$n|tostring] = $r')
  else
    COD=$?
    echo "▸ degrau ${N}: FALHOU (exit ${COD}) — PROGRESSÃO INTERROMPIDA (degraus superiores NÃO executados)"
    DECLARADO=$(echo "$DECLARADO" | jq -c --argjson n "$N" --argjson cod "$COD" '.[$n|tostring] = {falhou: true, exit_code: $cod}')
    SAIR=1
    break
  fi
done

FINAL=$(jq -n --argjson degraus "$DECLARADO" --argjson sair "$SAIR" '{
  missao: "carga progressiva 100/1000/5000 (auditoria v0.10.9, item 2)",
  contrato: "progressão gated — degrau superior só executa com degrau anterior exit 0",
  zero_chamadas_externas: true,
  fontes: "somente simuladas/sintéticas (banco temporário por degrau)",
  progressao_interrompida: ($sair == 1),
  degraus: $degraus
}')
echo "$FINAL" | jq . > "$OUT_DIR/carga-progressiva.json"
echo ""
echo "✔ consolidado em ${OUT_DIR}/carga-progressiva.json"
exit "$SAIR"
