# 05 — Experimentos controlados (o que foi executado e o que cada resultado prova)

Pré-condição respeitada: NENHUM experimento disparou milhares de APIs externas; IA do gateway estava em 429 (documentado) — os experimentos foram desenhados para não depender dela.

## E1 · Importação mista sintética (5 linhas) — AO VIVO via API

- **Objetivo**: provar/desprovar o descarte de pistas não-CNPJ no caminho CSV.
- **Execução**: upload → preview (detectou coluna 0 "cabeçalho") → confirm `aiEnabled:false` → process → 1 worker tick extra.
- **Resultado**: 1 ENRIQUECIDO (Petrobras, BrasilAPI) + **4 SEM_CNPJ/IGNORADO** (nome+site+email ignorados). Custos: 1 cadeia cadastral, 0 IA.
- **Prova**: `qa/resultado-importacao-mista.md` + screenshots 18 (1440) e 19 (390).
- **Achados novos**: chip "Aguardando" em linha descartada; pista original não renderizada; contradição home×motor.

## E2 · Importação 5k sintética — OFFLINE (SQLite temporário)

- **Objetivo**: medir a camada determinística em escala sem tempestade externa.
- **Método**: `DATABASE_URL=file:/tmp/scout-probe-5k.db` (schema idêntico, db novo) + `parseStoredFile` + `confirmBatch` reais do engine; 0 chamadas externas; script `scripts/probe-import-5k.ts` reproduzível.
- **Resultado**: parse **15 ms**; confirm (validar+dedupe+gravar 5000 linhas) **375 ms**; RSS fim **113 MB**; classificação exata: 3000 VALIDA / 2000 SEM_CNPJ (composição 60/20/10/10).
- **Prova**: `qa/import-5k.json`.
- **Leitura**: o gargalo de 5k NÃO é importação; é enriquecimento (3000 cadeias × ~1s ≈ escalável com concorrência) e IA/pesquisa profunda (cotas). `next-server` já reside em ~1,25 GB — carga AO VIVO de 5k segue como teste próprio, com orçamento e monitoramento.

## E3 · A/B do lote real de 24 — a partir do histórico persistido (0 novas chamadas)

- **Braço cadastro (sem IA)**: 24/24 em 29 s (~1 s/linha), 100% BrasilAPI, 0 fallbacks.
- **Braço IA (histórico)**: 18 OK (16 por cache entre lotes → só **2 chamadas reais**) / 6 FALHOU (429); `glm-5.3-flash → glm-4-plus` remapeado com registro; **tokens 0/56 não-nulos** (P0-B).
- **Prova**: `qa/ab-lote24.md`.
- **Braço IA fresco**: bloqueado (gateway 429) — reexecutar com o plano de `qa/golden-cases.md`.

## E4 · Sonda do gateway z-ai — 4 capacidades × 2 janelas

- chat (default e flash), web_search, page_reader → **429 imediato (<35 ms)**, sem Retry-After.
- **Prova**: `qa/custo-e-capacidade.csv`; script `scripts/probe-vm-capacity.ts` (reexecutável quando a cota voltar).

## O que os experimentos NÃO provam

- Qualquer percentual de economia — a missão proíbe inventar; os mecanismos e como medi-los estão em `06-propostas-otimizacao.md`.
- Comportamento do worker sob 5k AO VIVO (lease, memória, recuperação) — teste próprio, pendente.
- Qualidade factual de dossiês (precisa cota) — permanece pendência herdada dos golden cases.
