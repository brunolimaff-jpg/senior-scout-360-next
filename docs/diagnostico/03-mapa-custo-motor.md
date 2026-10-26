# 03 — Mapa de custos do motor atual (achados com file:line, validados estática e/ou empiricamente)

Ordem por impacto. "Validação" = como cada achado foi confirmado nesta missão.

## P0-A · CSV descarta pistas não-CNPJ (produto)

- **Onde**: `engine.ts:288-370` (`confirmBatch`) — `:328` lê SOMENTE `row[cnpjColumnIndex]`; `:331-334` vazio → `SEM_CNPJ`/inválida; `:367` → `lookupStatus=IGNORADO`.
- **Impacto**: planilha mista real perde contas com nome/domínio/e-mail. Experimento: **4/5 linhas descartadas** (`qa/resultado-importacao-mista.md`).
- **Agravantes**: a home promete "Não precisa ter CNPJ" (o caminho "Colar pistas" cumpre — `confirmTextBatch` — mas o CSV não); schema JÁ tem `lookupKind CNPJ|DOMAIN|EMAIL|URL` + pipeline de resolução por pista — falta mapear colunas no caminho CSV.
- **Novo QA**: linhas descartadas aparecem como **"Aguardando"** com pista vazia na tabela (screenshots 18/19) — estado falso + dado do usuário não exibido.

## P0-B · Telemetria de tokens morta (economia)

- **Onde**: `resolve-service/index.ts:169-175` devolve `tokens:{prompt,completion,total}`; `ai.ts:86,98-100` lê `tokens.{prompt_tokens,completion_tokens,total_tokens}`.
- **Impacto**: `dossier.tokens` sempre `null`; persistência em auditoria (`engine.ts:1323-1325`) grava nulos. Medido: **56 eventos AI_OK, 0 com tokens**. Sem isto, nenhum relatório de custo por conta é possível.

## P0-C · IA rápida ON por default + teto 100 (economia)

- **Onde**: `page.tsx:92` `useState(true)`; rota confirm `route.ts:23` default `true` (server-side também); `engine.ts:25` `AI_MAX_PER_BATCH=100`; `ai.ts:129-133` RPM 10, concorrência 2.
- **Impacto**: lote novo gasta leituras antes de qualquer decisão de seleção. Mitigação já existente: cache entre lotes (16/18 leituras do lote 24 vieram de cache — `AI_CACHE` 52 eventos) e teto por consumo real (`queueAiFor`).

## P0-D · Pesquisa profunda = 13–15 buscas + 6–8 leituras POR CONTA (execução)

- **Onde/Quanto**: etapas A(2+2) + presença(1) + B(1; +3 buscas e ≤7 leituras se LISTADA) + C(5+≤4) + D(1+≤1) + porte(2) + teia(≤3) + domínio(≤1) — `research.ts:555-733`; **pacotes reais persistidos**: 15 buscas/8 páginas (LISTADA e DIGITAL).
- **Cota local**: 10/min por serviço com espera de até 24s/slot (`resolve-service:15,24`) → um pacote cheio leva ≥2 min só de fila de cota; 24 contas em lote profundo ≈ 340+ chamadas.

## P1-E · `S.A.` na razão social ⇒ modo LISTADA (economia)

- **Onde**: `research.ts:583` regex `\bS\s?\.?\s?A\b` sobre a razão social; `:592` `riHost || legalSobrenomeSA` → LISTADA → +3 buscas + ≤7 leituras (`:605-613`).
- **Impacto**: S.A. **fechadas** (a maioria do parque brasileiro) pagam o pipeline de companhia aberta sem necessidade. Correção proposta: LISTADA apenas com host de RI corroborado.

## P1-F · Domínio "INDÍCIO FRACO" ainda é adotado para coleta (dados)

- **Onde**: `research.ts:269-284` — sem correspondência de nome, devolve `dominio: host` com método de aviso; o coletor depois lê a página do domínio.
- **Impacto**: leitura de site alheio (homônimos/SEO) — custo + ruído.

## P1-G · Fallback OpenCNPJ funciona, mas há um 2º provedor homônimo (fontes)

- **Onde**: `sources.ts:343` usa `https://api.opencnpj.org/{cnpj}` — probe: 200, 850ms, `razao_social` + `QSA` maiúsculo (já tratado em `:149`). O "OpenCNPJ/OpenCaramelo" documentado publicamente é OUTRO (`kitana.opencnpj.com/cnpj/{cnpj}`, `data.*` camelCase — 200, 1035ms).
- **Cautela**: trocar de provedor por promessa de limite (300 req/min divulgados) sem A/B é proibido pela regra da missão. Manter como 5ª fonte em avaliação.

## P1-H · Teia/QSA truncados (dados)

- **Onde**: `sources.ts:156` cap 30 sócios; `research.ts:722` pesquisa só os **3 primeiros** sócios; nota honesta em `:731`.
- **Impacto**: teia incompleta para grupos com QSA grande (pendência herdada do handoff).

## P1-I · Caches: o que já economiza × o que evapora (continuidade)

- **Já economiza (em DB, sobrevive a restart)**: cache de leitura IA entre lotes (`engine.ts:925-957`), LOOKUP_CACHE (72), MATRIZ_CACHE (51), RESOLVE_CACHE (14), DEEP_RESEARCH_CACHE (3) — reaproveitamento de pacote <24h exige `buscasRecusadasCota===0` (`engine.ts:1173`).
- **Evapora no restart do processo**: IBGE (`ibge.ts:28-30`) e limiters em `globalThis`. Custo de recarga: baixo (IBGE ~1,3s/município) — prioridade menor.

## P1-J · Estados falsos na UI (QA novo desta missão)

- Linhas `IGNORADO` (SEM_CNPJ) exibem **"Aguardando"** e pista vazia — usuário espera para sempre e não vê o que digitou (screenshots 18/19).

## Redundâncias avaliadas (sem defeito novo além dos listados)

- Cadeia cadastral para na 1ª fonte OK (`sources.ts:455-464`) — no lote 24, 0 chamadas desperdiçadas (100% BrasilAPI).
- Buscas do pacote têm objetivos distintos por etapa (identidade/RI/tech/comercial/porte/teia) — a redundância real está em P1-E/P1-F, não em duplicidade de queries.
