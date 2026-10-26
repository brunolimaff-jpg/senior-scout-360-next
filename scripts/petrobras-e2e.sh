#!/bin/bash
# E2E Petrobras — fase $1: retry-ai | deep | fetch
BASE=http://localhost:3000/api/imports/imp_mvgt60cs_uymob4
ROW=1
PHASE=${1:-retry-ai}

get_row_field() { # $1=jq path em aiSummary… usamos /api/imports/{id} e grep simples
  curl -s "$BASE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
row=[r for r in d.get('rows',[]) if r.get('rowNumber')==$ROW][0]
print(json.dumps({'aiStatus':row.get('aiStatus'),'researchStatus':row.get('researchStatus'),'aiError':(row.get('aiError') or '')[:200],'researchError':(row.get('researchError') or '')[:200]}))
"
}

case "$PHASE" in
  retry-ai)
    echo "== POST retry-ai:"
    curl -s -X POST "$BASE/rows/$ROW/retry-ai" | head -c 300; echo
    for i in $(seq 1 55); do
      sleep 10
      S=$(get_row_field)
      AI=$(echo "$S" | python3 -c "import json,sys;print(json.load(sys.stdin)['aiStatus'])")
      echo "[$((i*10))s] aiStatus=$AI"
      case "$AI" in
        OK|FALHOU|IGNORADO) echo "$S"; exit 0;;
      esac
    done
    echo "TIMEOUT aguardando IA"; exit 1
    ;;
  deep)
    echo "== POST deep-research:"
    curl -s -X POST "$BASE/rows/$ROW/deep-research" | head -c 300; echo
    for i in $(seq 1 55); do
      sleep 10
      S=$(get_row_field)
      RS=$(echo "$S" | python3 -c "import json,sys;print(json.load(sys.stdin)['researchStatus'])")
      echo "[$((i*10))s] researchStatus=$RS"
      case "$RS" in
        OK|FALHOU) echo "$S"; exit 0;;
      esac
    done
    echo "TIMEOUT aguardando pesquisa profunda"; exit 1
    ;;
  fetch)
    mkdir -p /tmp/petrobras
    curl -s "$BASE" > /tmp/petrobras/batch.json
    python3 - <<'PY'
import json
d=json.load(open('/tmp/petrobras/batch.json'))
row=[r for r in d.get('rows',[]) if r.get('rowNumber')==1][0]
json.dump(row, open('/tmp/petrobras/row.json','w'), ensure_ascii=False)
dj=row.get('aiDossier') or {}
rj=row.get('research') or {}
print("== row capturada ==")
print("aiStatus:", row.get('aiStatus'), "| researchStatus:", row.get('researchStatus'))
print("modelo solicitado:", row.get('aiModelRequested'), "| modelo efetivo:", row.get('aiModel'))
print("tokens (uso real):", json.dumps((dj.get('instrumentacao') or {}).get('tokens') or dj.get('tokens') or rj.get('tokens') or None, ensure_ascii=False))
print("etapasMs:", json.dumps((rj.get('instrumentacao') or {}).get('etapasMs') or (rj.get('etapasMs') or None), ensure_ascii=False))
print("fontes acessadas:", len(rj.get('fontes') or []), "| rejeitadas:", len(rj.get('fontesRejeitadas') or []))
print("consultas:", json.dumps(rj.get('consultas') or [], ensure_ascii=False)[:400])
print("usouCache:", rj.get('usouCache'))
print("seções do dossiê:", list(dj.keys()))
print("len leitura:", len(dj.get('leitura') or ''))
PY
    ;;
  *) echo "fase inválida"; exit 1;;
esac
