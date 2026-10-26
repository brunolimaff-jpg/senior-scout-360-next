#!/usr/bin/env bash
# =============================================================================
# build-zip.sh — gera o kit canônico para AUDITORIA em dist/ (PRIVADO).
#
# G7 (segurança): o kit é SANITIZADO — código + docs + scripts.
#   NÃO inclui banco com dados reais (db/*.db) nem evidências brutas
#   (evidencias/, tool-results/). Modo completo só local (--full,
#   escrito em /tmp).
#
# v0.10.11 — FECHAMENTO DA EXPOSIÇÃO (auditoria do piloto comercial):
#   o kit NÃO sai mais em public/ — pasta servida estaticamente pelo Next.js.
#   Saída: dist/Senior-Scout-360-kit-dev.zip (fora do servidor web).
#   Na inicialização, qualquer ZIP legado em public/ é REMOVIDO.
#   O pacote segue disponível ao operador para auditoria fora da interface.
#
# EXCEÇÃO autorizada (pedido do usuário, 2026-10-20): evidencias-uso/ — mídia
#   CURADA de uso real (screenshots + vídeos + MANIFESTO.md) vai no kit dev
#   para torná-lo autocontido p/ avaliação externa. Continua FORA: db, tokens,
#   uploads, tool-results, evidencias/ brutas.
#
# Uso:  bash scripts/build-zip.sh [--full] [versão]     # padrão: v0.6.2-dev
# Saída (padrão): dist/Senior-Scout-360-kit-dev.zip     (única; remove as antigas)
# ==============================================================================
set -euo pipefail

MODE="dev"
if [ "${1:-}" = "--full" ]; then MODE="full"; shift; fi
VERSION="${1:-v0.6.2-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$MODE" = "full" ]; then
  KIT="/tmp/kit-${VERSION}-full"
  ZIP_NAME="Senior-Scout-360-${VERSION}-COMPLETO-LOCAL.zip"
  OUT="/tmp/${ZIP_NAME}"
else
  KIT="/tmp/kit-${VERSION}-dev"
  ZIP_NAME="Senior-Scout-360-kit-dev.zip"
  OUT="${ROOT}/dist/${ZIP_NAME}"
fi

cd "$ROOT"

# v0.10.11 — encerramento da exposição histórica: nenhum ZIP pode restar em public/
# (pasta servida estaticamente). Remove na entrada E garante que builds futuros
# nunca voltem a criar o arquivo ali.
echo "▸ Removendo ZIPs legados de public/ (fora da área pública desde v0.10.11)…"
find "$ROOT/public" -maxdepth 1 -name 'Senior-Scout-360-*.zip' -delete
mkdir -p "$(dirname "$OUT")"

echo "▸ Limpando stage anterior…"
rm -rf "$KIT"
mkdir -p "$KIT"

# -----------------------------------------------------------------------------
# 1) Código-fonte e configs (o que NÃO regenera)
# -----------------------------------------------------------------------------
echo "▸ Copiando código-fonte e configs…"
mkdir -p "$KIT/src" "$KIT/prisma" "$KIT/db" "$KIT/public" "$KIT/docs" \
         "$KIT/scripts" "$KIT/recovery" "$KIT/tests" "$KIT/mini-services"

cp -R src/. "$KIT/src/"
cp -R prisma/. "$KIT/prisma/"
cp -R docs/. "$KIT/docs/"
cp -R scripts/. "$KIT/scripts/"
cp -R recovery/. "$KIT/recovery/" 2>/dev/null || true
cp -R tests/. "$KIT/tests/" 2>/dev/null || true

for f in LEIA-ME.md README.md package.json bun.lock tsconfig.json next.config.ts \
         tailwind.config.ts postcss.config.mjs components.json eslint.config.mjs \
         next-env.d.ts Caddyfile .env.example; do
  [ -f "$f" ] && cp "$f" "$KIT/"
done

# Schema e seeds SIM; dados reais NÃO (G7) — sem *.db / journal / wal / shm
# e SEM SEGREDOS (.scout-token etc.) — o token do modo TOKEN nunca entra no kit
find db -type f ! -name '*.db' ! -name '*-journal' ! -name '*-wal' ! -name '*-shm' \
  ! -name '.*' ! -name '*.token' -exec cp --parents {} "$KIT/" \; 2>/dev/null || true

# -----------------------------------------------------------------------------
# 2) mini-services SEM node_modules (regenerável)
# -----------------------------------------------------------------------------
echo "▸ Copiando mini-services (sem node_modules)…"
for svc in mini-services/*/; do
  name="$(basename "$svc")"
  mkdir -p "$KIT/mini-services/$name"
  (cd "$svc" && tar cf - --exclude=node_modules --exclude='*.db' .) \
    | (cd "$KIT/mini-services/$name" && tar xf -)
done

# -----------------------------------------------------------------------------
# 3) public/ SEM os próprios zips (o zip não se contém)
# -----------------------------------------------------------------------------
echo "▸ Copiando public/ (sem zips)…"
(cd public && tar cf - --exclude='*.zip' .) | (cd "$KIT/public" && tar xf -)

# -----------------------------------------------------------------------------
# 4) Evidências de QA — SOMENTE no modo full (local, autorizado)
# -----------------------------------------------------------------------------
if [ "$MODE" = "full" ]; then
  echo "▸ [full] Empacotando evidências de QA…"
  mkdir -p "$KIT/evidencias"
  [ -d evidencias-uso ] && cp -R evidencias-uso "$KIT/evidencias-uso"
  cp download/*.png download/*.jsonl download/*.csv download/README.md "$KIT/evidencias/" 2>/dev/null || true
  cp tool-results/*.png "$KIT/evidencias/" 2>/dev/null || true
  ls "$KIT/evidencias" | wc -l | xargs echo "  evidências incluídas:"
  # banco com dados reais — apenas no modo full/local
  for f in db/*.db; do [ -f "$f" ] && cp "$f" "$KIT/db/"; done 2>/dev/null || true
else
  echo "▸ [dev] Kit sanitizado: sem banco e sem evidências brutas (G7)."
  # Mídia curada de uso real (autocontida p/ avaliação) — autorizada pelo usuário
  if [ -d evidencias-uso ]; then
    mkdir -p "$KIT/evidencias-uso"
    cp -R evidencias-uso/. "$KIT/evidencias-uso/"
    ls "$KIT/evidencias-uso" | wc -l | xargs echo "  evidencias-uso incluídas:"
  fi
  # Lote A (v0.7.0): telemetria e mídia de teste SANITIZADAS (sintéticos + CNPJ público
  # Petrobras; zero dados corporativos reais) — exigência do contrato do Lote A
  if [ -d evidencias/lote-a ]; then
    mkdir -p "$KIT/evidencias-lote-a"
    cp -R evidencias/lote-a/. "$KIT/evidencias-lote-a/"
    ls "$KIT/evidencias-lote-a" | wc -l | xargs echo "  evidencias-lote-a incluídas:"
  fi
  if [ -f qa/import-5k-loteA.json ]; then
    mkdir -p "$KIT/qa/telemetria-loteA"
    cp qa/import-5k-loteA.json "$KIT/qa/" 2>/dev/null || true
    cp -R qa/telemetria-loteA/. "$KIT/qa/telemetria-loteA/" 2>/dev/null || true
  fi
  # Lote B (v0.8.0): mídia do laboratório de modelos externos (screenshots + vídeo do
  # fluxo com PROVEDOR MOCK local — nenhuma chave real, nenhum dado corporativo)
  if [ -d evidencias/lote-b ]; then
    mkdir -p "$KIT/evidencias-lote-b"
    cp -R evidencias/lote-b/. "$KIT/evidencias-lote-b/"
    ls "$KIT/evidencias-lote-b" | wc -l | xargs echo "  evidencias-lote-b incluídas:"
  fi
  if [ -d qa/lote-b ]; then
    mkdir -p "$KIT/qa/lote-b"
    cp -R qa/lote-b/. "$KIT/qa/lote-b/"
    ls "$KIT/qa/lote-b" | wc -l | xargs echo "  qa/lote-b incluídas:"
  fi
  # v0.10.0: comparativo de provedores (P2) + evidências visuais da ficha cadastral
  if [ -f qa/comparativo-provedores-v0.10.0.json ]; then
    cp qa/comparativo-provedores-v0.10.0.json qa/comparativo-provedores-v0.10.0.md "$KIT/qa/" 2>/dev/null || true
    echo "  comparativo de provedores incluído (qa/)"
  fi
  if [ -d evidencias/round-v0.10.0 ]; then
    mkdir -p "$KIT/evidencias-v0.10.0"
    cp -R evidencias/round-v0.10.0/. "$KIT/evidencias-v0.10.0/"
    ls "$KIT/evidencias-v0.10.0" | wc -l | xargs echo "  evidencias-v0.10.0 incluídas:"
  fi
  # v0.10.1: medição de eficiência da cadeia (auditoria) + evidências visuais das correções
  if [ -f qa/eficiencia-cadeia-v0.10.1.json ]; then
    cp qa/eficiencia-cadeia-v0.10.1.json qa/eficiencia-cadeia-v0.10.1.md "$KIT/qa/" 2>/dev/null || true
    echo "  medição de eficiência v0.10.1 incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.1 ]; then
    mkdir -p "$KIT/evidencias-v0.10.1"
    cp -R evidencias/round-v0.10.1/. "$KIT/evidencias-v0.10.1/"
    ls "$KIT/evidencias-v0.10.1" | wc -l | xargs echo "  evidencias-v0.10.1 incluídas:"
  fi
  # v0.10.2: diagnóstico controlado 429 + evidências visuais (temporalidade/caso Botica)
  if [ -f qa/diagnostico-429-v0.10.2.json ]; then
    cp qa/diagnostico-429-v0.10.2.json qa/diagnostico-429-v0.10.2.md "$KIT/qa/" 2>/dev/null || true
    echo "  diagnóstico 429 v0.10.2 incluído (qa/)"
  fi
  if [ -d evidencias/round-v0.10.2 ]; then
    mkdir -p "$KIT/evidencias-v0.10.2"
    cp -R evidencias/round-v0.10.2/. "$KIT/evidencias-v0.10.2/"
    ls "$KIT/evidencias-v0.10.2" | wc -l | xargs echo "  evidencias-v0.10.2 incluídas:"
  fi
  # v0.10.3: guarda de temporalidade (regressões), diagnóstico 429 v2 (métricas separadas),
  # evidência da limpeza de fechamento (contadores/backup) + evidências visuais da rodada
  if [ -f qa/guarda-temporalidade-v0.10.3.json ]; then
    cp qa/guarda-temporalidade-v0.10.3.json "$KIT/qa/" 2>/dev/null || true
    echo "  regressões de temporalidade v0.10.3 incluídas (qa/)"
  fi
  if [ -f qa/diagnostico-429-v0.10.3.json ]; then
    cp qa/diagnostico-429-v0.10.3.json qa/diagnostico-429-v0.10.3.md "$KIT/qa/" 2>/dev/null || true
    echo "  diagnóstico 429 v0.10.3 incluído (qa/)"
  fi
  if [ -f qa/limpeza-banco-entrega.json ]; then
    cp qa/limpeza-banco-entrega.json "$KIT/qa/" 2>/dev/null || true
    echo "  evidência da limpeza de fechamento incluída (qa/limpeza-banco-entrega.json)"
  fi
  if [ -f qa/telemetria-rodada-v0.10.3.json ]; then
    cp qa/telemetria-rodada-v0.10.3.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria agregada da rodada incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.3 ]; then
    mkdir -p "$KIT/evidencias-v0.10.3"
    cp -R evidencias/round-v0.10.3/. "$KIT/evidencias-v0.10.3/"
    ls "$KIT/evidencias-v0.10.3" | wc -l | xargs echo "  evidencias-v0.10.3 incluídas:"
  fi
  # v0.10.4: guarda de temporalidade (semântica de ano/cláusula), fechamento de banco
  # (testes explícitos), 429 em seis categorias, cruzamento CVM provado + amostras de
  # fontes + evidências visuais da rodada
  if [ -f qa/guarda-temporalidade-v0.10.4.json ]; then
    cp qa/guarda-temporalidade-v0.10.4.json "$KIT/qa/" 2>/dev/null || true
    echo "  regressões v0.10.4 incluídas (qa/guarda-temporalidade-v0.10.4.json)"
  fi
  if [ -f qa/diagnostico-429-v0.10.4.json ]; then
    cp qa/diagnostico-429-v0.10.4.json qa/diagnostico-429-v0.10.4.md "$KIT/qa/" 2>/dev/null || true
    echo "  diagnóstico 429 v0.10.4 (seis categorias) incluído (qa/)"
  fi
  if [ -f qa/limpeza-banco-entrega-teste.json ]; then
    cp qa/limpeza-banco-entrega-teste.json "$KIT/qa/" 2>/dev/null || true
    echo "  evidência dos testes de fechamento em sandbox incluída (qa/)"
  fi
  if [ -f qa/cruzamento-cvm-v0.10.4.json ]; then
    cp qa/cruzamento-cvm-v0.10.4.json "$KIT/qa/" 2>/dev/null || true
    echo "  prova de cruzamento CVM incluída (qa/)"
  fi
  if [ -f qa/fontes-samples/ANS-operadoras-NOT-verificado-2026-10-21.md ]; then
    mkdir -p "$KIT/qa/fontes-samples"
    cp qa/fontes-samples/ANS-operadoras-NOT-verificado-2026-10-21.md "$KIT/qa/fontes-samples/" 2>/dev/null || true
    cp qa/fontes-samples/cvm-cad-cia-aberta-amostra.csv "$KIT/qa/fontes-samples/" 2>/dev/null || true
    echo "  amostras de fontes (CVM cabeçalho real + ANS não confirmada) incluídas"
  fi
  if [ -f qa/telemetria-rodada-v0.10.4.json ]; then
    cp qa/telemetria-rodada-v0.10.4.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria agregada da rodada incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.4 ]; then
    mkdir -p "$KIT/evidencias-v0.10.4"
    cp -R evidencias/round-v0.10.4/. "$KIT/evidencias-v0.10.4/"
    ls "$KIT/evidencias-v0.10.4" | wc -l | xargs echo "  evidencias-v0.10.4 incluídas:"
  fi
  # v0.10.5: provas A1/B1 (grafo + fontes por raiz), telemetria da rodada e evidências visuais
  # (amostras de fontes contêm APENAS estruturas e contagens — nenhum dado de PF)
  if [ -f qa/fontes-samples/round-v0.10.5/probe-grafo-A1.json ]; then
    mkdir -p "$KIT/qa/fontes-samples/round-v0.10.5"
    cp qa/fontes-samples/round-v0.10.5/probe-grafo-A1.json "$KIT/qa/fontes-samples/round-v0.10.5/" 2>/dev/null || true
    cp qa/fontes-samples/round-v0.10.5/probe-fontes-B1.json "$KIT/qa/fontes-samples/round-v0.10.5/" 2>/dev/null || true
    echo "  provas A1/B1 da rodada v0.10.5 incluídas (qa/fontes-samples/round-v0.10.5/)"
  fi
  if [ -f qa/telemetria-rodada-v0.10.5.json ]; then
    cp qa/telemetria-rodada-v0.10.5.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria agregada da rodada incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.5 ]; then
    mkdir -p "$KIT/evidencias-v0.10.5"
    cp -R evidencias/round-v0.10.5/. "$KIT/evidencias-v0.10.5/"
    ls "$KIT/evidencias-v0.10.5" | wc -l | xargs echo "  evidencias-v0.10.5 incluídas:"
  fi
  # v0.10.6: triagem sem IA — comparativo antes/depois, exemplos SINTÉTICOS rótulados
  # do contrato TRIAGEM_V1 (com aviso_massa_teste), telemetria da rodada e evidências
  if [ -f qa/fontes-samples/round-v0.10.6/comparativo-antes-depois.json ]; then
    mkdir -p "$KIT/qa/fontes-samples/round-v0.10.6"
    cp qa/fontes-samples/round-v0.10.6/comparativo-antes-depois.json "$KIT/qa/fontes-samples/round-v0.10.6/" 2>/dev/null || true
    cp qa/fontes-samples/round-v0.10.6/exemplo-triagem-v1-SINTETICO.json "$KIT/qa/fontes-samples/round-v0.10.6/" 2>/dev/null || true
    cp qa/fontes-samples/round-v0.10.6/exemplo-triagem-v1-SINTETICO.jsonl "$KIT/qa/fontes-samples/round-v0.10.6/" 2>/dev/null || true
    cp qa/fontes-samples/round-v0.10.6/LEIA-ME.md "$KIT/qa/fontes-samples/round-v0.10.6/" 2>/dev/null || true
    echo "  comparativo antes/depois + exemplos TRIAGEM_V1 RÓTULADOS (SINTETICO) da rodada v0.10.6 incluídos"
  fi
  if [ -f qa/telemetria-rodada-v0.10.6.json ]; then
    cp qa/telemetria-rodada-v0.10.6.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria agregada da rodada v0.10.6 incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.6 ]; then
    mkdir -p "$KIT/evidencias-v0.10.6"
    cp -R evidencias/round-v0.10.6/. "$KIT/evidencias-v0.10.6/"
    ls "$KIT/evidencias-v0.10.6" | wc -l | xargs echo "  evidencias-v0.10.6 incluídas:"
  fi
  # v0.10.7: auditoria da v0.10.6 — exemplo AO VIVO do contrato (dados públicos da
  # consulta real, sem PF), telemetria da rodada, proposta P4 (documento) e evidências
  if [ -f qa/fontes-samples/round-v0.10.7/exemplo-triagem-v1-ao-vivo-botica.json ]; then
    mkdir -p "$KIT/qa/fontes-samples/round-v0.10.7"
    cp qa/fontes-samples/round-v0.10.7/exemplo-triagem-v1-ao-vivo-botica.json "$KIT/qa/fontes-samples/round-v0.10.7/" 2>/dev/null || true
    cp qa/fontes-samples/round-v0.10.7/exemplo-triagem-v1-ao-vivo-botica.jsonl "$KIT/qa/fontes-samples/round-v0.10.7/" 2>/dev/null || true
    echo "  exemplo AO VIVO do contrato TRIAGEM_V1 (v0.10.7, sem dados de PF) incluído"
  fi
  if [ -f qa/telemetria-rodada-v0.10.7.json ]; then
    cp qa/telemetria-rodada-v0.10.7.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria agregada da rodada v0.10.7 incluída (qa/)"
  fi
  if [ -f docs/PROPOSTA-P4-PLANEJADOR-CONSULTAS.md ]; then
    cp docs/PROPOSTA-P4-PLANEJADOR-CONSULTAS.md "$KIT/docs/" 2>/dev/null || true
    echo "  proposta P4 (planejador de consultas — só documento) incluída (docs/)"
  fi
  if [ -d evidencias/round-v0.10.7 ]; then
    mkdir -p "$KIT/evidencias-v0.10.7"
    cp -R evidencias/round-v0.10.7/. "$KIT/evidencias-v0.10.7/"
    ls "$KIT/evidencias-v0.10.7" | wc -l | xargs echo "  evidencias-v0.10.7 incluídas:"
  fi
  # v0.10.8: coerência do produto e fontes invisíveis — jornada capturada antes/depois
  # (confirmado-aguardando-início, pesquisa inelegível, processando, panorama CNAE,
  # triagem com linguagem comercial, evidências com proveniência, laboratório mock),
  # telemetria da rodada e exportação TRIAGEM_V1 da jornada (dados públicos, sem PF)
  if [ -f qa/telemetria-rodada-v0.10.8.json ]; then
    cp qa/telemetria-rodada-v0.10.8.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria agregada da rodada v0.10.8 incluída (qa/)"
  fi
  if [ -f qa/triagem-v0108-jornada.json ]; then
    cp qa/triagem-v0108-jornada.json "$KIT/qa/" 2>/dev/null || true
    echo "  export TRIAGEM_V1 da jornada v0.10.8 incluído (qa/)"
  fi
  if [ -d evidencias/round-v0.10.8 ]; then
    mkdir -p "$KIT/evidencias-v0.10.8"
    cp -R evidencias/round-v0.10.8/. "$KIT/evidencias-v0.10.8/"
    ls "$KIT/evidencias-v0.10.8" | wc -l | xargs echo "  evidencias-v0.10.8 incluídas:"
  fi
  # v0.10.9 (evolução e estresse): provas do limitador antes/depois + plano ao vivo +
  # telemetria da rodada + evidências visuais (plano, diálogo de aprovação, mobile)
  if [ -f qa/limitador-antes.json ]; then
    cp qa/limitador-antes.json qa/limitador-depois.json "$KIT/qa/" 2>/dev/null || true
    echo "  provas do limitador (antes/depois) incluídas (qa/)"
  fi
  if [ -f qa/plano-v1-jornada-ao-vivo.json ]; then
    cp qa/plano-v1-jornada-ao-vivo.json "$KIT/qa/" 2>/dev/null || true
    echo "  PLANO_CONSULTAS_V1 da jornada incluído (qa/)"
  fi
  if [ -f qa/telemetria-rodada-v0.10.9.json ]; then
    cp qa/telemetria-rodada-v0.10.9.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria da rodada v0.10.9 incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.9 ]; then
    mkdir -p "$KIT/evidencias-v0.10.9"
    cp -R evidencias/round-v0.10.9/. "$KIT/evidencias-v0.10.9/"
    ls "$KIT/evidencias-v0.10.9" | wc -l | xargs echo "  evidencias-v0.10.9 incluídas:"
  fi
  # v0.10.10 (CORRECT_DELTA + estresse real): provas do voo único anti-duplicação,
  # plano desatualizado, cargas progressivas gated, falhas de fonte, reinício real,
  # métricas consolidadas e telemetria da rodada — todas com fontes SIMULADAS
  if [ -d qa/estresse-v0.10.10 ]; then
    mkdir -p "$KIT/qa/estresse-v0.10.10"
    cp qa/estresse-v0.10.10/*.json "$KIT/qa/estresse-v0.10.10/" 2>/dev/null || true
    echo "  provas de estresse v0.10.10 incluídas (qa/estresse-v0.10.10/)"
  fi
  if [ -f qa/telemetria-rodada-v0.10.10.json ]; then
    cp qa/telemetria-rodada-v0.10.10.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria da rodada v0.10.10 incluída (qa/)"
  fi
  # v0.10.11 (piloto comercial): auditoria de acesso entre sessões, sonda do planejador
  # antes/depois (baseline v0.10.10 + final), telemetria da rodada e capturas da jornada
  if [ -f qa/auditoria-acesso-v01011.json ]; then
    cp qa/auditoria-acesso-v01011.json "$KIT/qa/" 2>/dev/null || true
    echo "  auditoria de acesso v0.10.11 incluída (qa/)"
  fi
  if [ -d qa/estresse-v0.10.11 ]; then
    mkdir -p "$KIT/qa/estresse-v0.10.11"
    cp qa/estresse-v0.10.11/*.json "$KIT/qa/estresse-v0.10.11/" 2>/dev/null || true
    echo "  provas do planejador v0.10.11 incluídas (qa/estresse-v0.10.11/)"
  fi
  if [ -f qa/telemetria-rodada-v0.10.11.json ]; then
    cp qa/telemetria-rodada-v0.10.11.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria da rodada v0.10.11 incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.11 ]; then
    mkdir -p "$KIT/evidencias-v0.10.11"
    cp -R evidencias/round-v0.10.11/. "$KIT/evidencias-v0.10.11/" 2>/dev/null || true
    ls "$KIT/evidencias-v0.10.11" | wc -l | xargs echo "  evidências visuais v0.10.11 incluídas:"
  fi
  # v0.10.12 — confiança na identificação: provas, telemetria e capturas
  if [ -f qa/telemetria-rodada-v0.10.12.json ]; then
    cp qa/telemetria-rodada-v0.10.12.json "$KIT/qa/" 2>/dev/null || true
    echo "  telemetria da rodada v0.10.12 incluída (qa/)"
  fi
  if [ -f qa/limpeza-banco-entrega.json ]; then
    cp qa/limpeza-banco-entrega.json "$KIT/qa/" 2>/dev/null || true
    echo "  evidência de limpeza do banco incluída (qa/)"
  fi
  if [ -d evidencias/round-v0.10.12 ]; then
    mkdir -p "$KIT/evidencias-v0.10.12"
    cp -R evidencias/round-v0.10.12/. "$KIT/evidencias-v0.10.12/" 2>/dev/null || true
    ls "$KIT/evidencias-v0.10.12" | wc -l | xargs echo "  evidências visuais v0.10.12 incluídas:"
  fi
  # v0.10.13: ficha única da empresa — antes/depois (3 abas → 7 seções), revisão humana,
  # falha+recuperação, desktop/notebook/celular
  if [ -d evidencias/round-v0.10.13 ]; then
    mkdir -p "$KIT/evidencias-v0.10.13"
    cp -R evidencias/round-v0.10.13/. "$KIT/evidencias-v0.10.13/" 2>/dev/null || true
    ls "$KIT/evidencias-v0.10.13" | wc -l | xargs echo "  evidências visuais v0.10.13 incluídas:"
  fi
  # v0.10.15: exportações comerciais — diálogo de exportação (escopo × formato), PDF da
  # ficha, métricas reconciliadas com hints explícitos, desktop + mobile 390
  if [ -d evidencias/round-v0.10.15 ]; then
    mkdir -p "$KIT/evidencias-v0.10.15"
    cp -R evidencias/round-v0.10.15/. "$KIT/evidencias-v0.10.15/" 2>/dev/null || true
    ls "$KIT/evidencias-v0.10.15" | wc -l | xargs echo "  evidências visuais v0.10.15 incluídas:"
  fi
  # v0.10.16: experiência comercial — home antes de iniciar, ficha leve (export dedicado),
  # correção PF/PJ ao vivo (BRD "TIPO NÃO CONFIRMADO"), PDF página 1 + anexos, mobile/notebook
  if [ -d evidencias/round-v0.10.16 ]; then
    mkdir -p "$KIT/evidencias-v0.10.16"
    cp -R evidencias/round-v0.10.16/. "$KIT/evidencias-v0.10.16/" 2>/dev/null || true
    ls "$KIT/evidencias-v0.10.16" | wc -l | xargs echo "  evidências visuais v0.10.16 incluídas:"
  fi
  # v0.10.17: refinamento final — home 1440/1024/390 sem encobrimento, "antes de iniciar",
  # ficha (representantes/triagem), PDFs v3 dos casos A/B/lote renderizados e diálogo de exportação
  if [ -d evidencias/round-v0.10.17 ]; then
    mkdir -p "$KIT/evidencias-v0.10.17"
    cp -R evidencias/round-v0.10.17/. "$KIT/evidencias-v0.10.17/" 2>/dev/null || true
    ls "$KIT/evidencias-v0.10.17" | wc -l | xargs echo "  evidências visuais v0.10.17 incluídas:"
  fi
fi

# -----------------------------------------------------------------------------
# 5) Zip nível 9 + verificação de integridade
# -----------------------------------------------------------------------------
echo "▸ Compactando (nível 9)…"
rm -f "$OUT"
( cd "$KIT" && zip -9 -r -q "$OUT" . )
rm -rf "$KIT"

if [ "$MODE" = "dev" ]; then
  echo "▸ Removendo zips antigos de dist/ (retenção única)…"
  find "$ROOT/dist" -maxdepth 1 -name 'Senior-Scout-360-*.zip' ! -name "$ZIP_NAME" -delete
fi

echo "▸ Testando integridade…"
unzip -t "$OUT" > /dev/null && echo "  unzip -t: OK"

# -----------------------------------------------------------------------------
# 5b) VERIFICAÇÃO DURA DE SANITIZAÇÃO — o build FALHA se vazar qualquer segredo
# -----------------------------------------------------------------------------
LEAKS=$(unzip -l "$OUT" | grep -Ei '(^|[[:space:]])db/\.|\.scout-token|\.env$|\.env\.|custom\.db|[^a-z]token[^a-z]|worklog\.md' | grep -v '\.env\.example' || true)
if [ -n "$LEAKS" ]; then
  echo "✔✔ VAZAMENTO DETECTADO — ZIP INVÁLIDO, removendo:"
  echo "$LEAKS"
  rm -f "$OUT"
  exit 1
fi
echo "  sanitização: OK (0 db, 0 segredo, 0 worklog)"

FILES=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "✔ ZIP pronto: ${OUT}"
echo "  arquivos: ${FILES} · tamanho: ${SIZE}"
if [ "$MODE" = "dev" ]; then
  echo "  AUDITORIA (v0.10.11): pacote FORA da área pública — em dist/ (não é servido pelo app)."
fi
