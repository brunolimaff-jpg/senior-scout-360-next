# 06 — Propostas de otimização (classificadas por impacto × esforço)

> **ESTE DOCUMENTO É UM DIAGNÓSTICO. NADA AQUI É AUTORIZAÇÃO DE EXECUÇÃO.**
> A missão termina com a entrega do diagnóstico; implementação depende de nova instrução.

Regra de honestidade: nenhum percentual de economia é afirmado — cada proposta indica o **mecanismo** e **como medir** o delta (AuditEvent/eventos por lote).

## Faixa P0 — corrigir antes de qualquer escala

| # | proposta | mecanismo de economia | esforço | como medir |
|---|---|---|---|---|
| 1 | **Fix key-mismatch de tokens** (`ai.ts:86-100`: ler `prompt/completion/total`) | nenhuma direta — RESTAURA a telemetria que permite medir todo o resto (custo por conta, por etapa, cache hit em tokens) | baixo (3 linhas + 1 teste manual) | 1 chamada real de chat após fix → `usage` não-nulo em `AI_OK` |
| 2 | **CSV multicoluna**: mapear colunas de nome/domínio/e-mail quando CNPJ vazio e rotear ao pipeline de pistas que JÁ EXISTE (`lookupKind`, `confirmTextBatch`, resolver) | recupera contas hoje descartadas (4/5 no experimento E1); evita re-importação manual e retrabalho | médio (UI de mapeamento + roteamento no `confirmBatch`) | E1 reexecutado → 5/5 identificadas; AuditEvent `RESOLVE_*` por pista |
| 3 | **IA rápida OFF por default** (`page.tsx:92` + `route.ts:23` → false) com escolha explícita por lote | evita gasto antes da decisão de seleção; teto 100 e cache entre lotes continuam valendo | baixo | eventos `AI_START` por lote antes/depois |
| 4 | **UI dos descartados**: estado "Descartada — sem CNPJ" + renderizar pista original | elimina espera falsa (QA 18/19) e chamadas de suporte | baixo | inspeção E1 |

## Faixa P1 — reduzir buscas sem cegueira

| # | proposta | mecanismo | esforço | como medir |
|---|---|---|---|---|
| 5 | **LISTADA só com RI corroborado** (`research.ts:592`: exigir `riHost`; S.A. sem RI vira DIGITAL) | pula +3 buscas + ≤7 leituras por S.A. fechada | baixo | `estrategia` por pacote antes/depois; nº de leituras RI |
| 6 | **INDÍCIO FRACO não vira dominio de coleta** (`research.ts:278-284`): registrar pista e não ler | evita leitura de site alheio | baixo | leituras com método "INDÍCIO FRACO" = 0 |
| 7 | **Promover extras do Minha Receita** (regime histórico, codigo_ibge, 2º telefone) no coletor da cadeia | mesma chamada, mais dado estruturado — menos busca depois | baixo-médio | campos preenchidos por linha |
| 8 | **Promote de cache por identidade já existe — estender**: dedupe cross-lote por `cnpjRoot`/domínio antes de enfileirar linha | menos cadeias duplicadas em lotes grandes | médio | LOOKUP_CACHE/AI_CACHE rate por lote |
| 9 | **Etapa de porte/notícias condicionada**: quando pacote digital/local já responde porte e notícias=0 em 1ª janela, pular 2ª rodada | corta 2 buscas/conta nos casos pobres | médio | buscas por pacote (hoje 13–15) |

## Faixa P2 — seletividade e fontes (só depois de P0/P1)

| # | proposta | mecanismo | esforço | como medir |
|---|---|---|---|---|
| 10 | **Fila de pesquisa profunda em lote** com orçamento explícito (N contas × teto de buscas), progresso e retomada — já previsto no handoff | previsibilidade de cota; nada de "15 buscas × 24 cliques" | alto | pacotes/rodada; `buscasRecusadasCota` = 0 |
| 11 | **Teia completa** (QSA > 30 e > 3 sócios) sob demanda por botão | correção de cobertura; custo por clique, não no bulk | médio-alto | QSA integral por caso; pendência herdada |
| 12 | **kitana.opencnpj.com como 5ª fonte** — só com A/B medido (acerto, QSA, latência, 429, termos) | redundância adicional quando BrasilAPI/OpenCNPJ caem | médio | cadeia com fonte nova em shadow mode |
| 13 | **CVM DFP** p/ LISTADA corroborada e **PNCP paginado** p/ setor público — camada 4 seletiva | dado estruturado oficial > busca | médio | campos de receita/contratos com fonte+período |

## Sequência recomendada (se autorizado um dia)

1 → 3 → 4 (dias; desbloqueiam medição eparam o sangramento) → 2 (maior ganho de produto) → 5/6 (menos busca) → 9/8 → 10/11 → 12/13.

## O que NÃO propor agora (para não inflar custo)

- Subir RPMs locais sem medição de limite real (gateway em 429 provou que o teto não é nosso).
- Redis/fila externa/graph DB — SQLite + leases atuais atendem a escala determinística medida.
- Importação massiva RFB na VM (6,5 GB livres; base nacional é ordens de magnitude maior).
