# SCOUT 360 — Spec de Inteligência Comercial
### Enriquecimento · evidências · exportações

> ⚠️ **NOTA DE VERSÃO (v0.9.0)** — este spec descreve o motor de inteligência ATUAL.
> Novidades v0.9.0: pesquisa ADAPTATIVA (níveis 0/1/2 com motivo por consulta), busca
> por variante de marca com desambiguação de entidades, filtro de relevância anti-ruído,
> e cobertura factual por dimensão (sem score). O pipeline COMPLETO (A→E) segue
> disponível como comparação do experimento adaptativo.
>
> **Histórico (v0.6.2)**: as seções de **Score de prioridade 0–100** e — as seções de **Score de prioridade 0–100** e
> **Faturamento por faixa legal** abaixo descrevem módulos **REMOVIDOS** do produto
> (`src/lib/score.ts` e `src/lib/enrich/faturamento.ts` não existem mais).
> A prioridade atual é a LEITURA Scout 360 por evidência (dossiê com fonte, URL e
> período) — **sem score numérico e sem estimativa de receita**. Mantemos as seções
> abaixo apenas como registro histórico do design; não descrevem o código atual.
> Código-fonte atual: `src/lib/enrich/*`, rotas de export.
> Contrato central: **evidência citável ou nada — nunca caixa-preta.**

---

## 1. Score de Prioridade Comercial (0–100, determinístico)

**Filosofia:** score é TRIAGEM, não verdade. Ordena a fila do executivo por potencial
observável em dados públicos; nunca substitui a leitura do dossiê. Mesmos dados →
mesmo score. Cada ponto é rastreável a um fator com rótulo e detalhe ("por quê").

### 1.1 Os 10 fatores (somam no máximo 100)

| # | Fator | Máx | Pontuação |
|---|-------|-----|-----------|
| 1 | **Situação cadastral** | 10 | ATIVA 10 · SUSPENSA 4 · demais 0 |
| 2 | **Tempo de mercado** | 12 | ≥15a 12 · ≥8a 10 · ≥3a 7 · ≥1a 4 · <1a 0 |
| 3 | **Capital social declarado** | 12 | ≥R$10M 12 · ≥R$1M 10 · ≥R$100k 7 · >0 3 · n/d 0 |
| 4 | **Porte no cadastro** | 8 | DEMAIS/GRANDE 8 · MÉDIO 6 · MEI/MICRO/EPP 3 |
| 5 | **Teia societária (QSA)** | 10 | 4 pts por sócio PJ (máx 7) + 3 se ≥2 sócios (2 se 1) |
| 6 | **Presença digital** | 12 | domínio 6 · e-mail 2 · telefone 2 · sinais no site 2 cada (máx 4) |
| 7 | **Porte real (sinais citáveis)** | 12 | ≥3 sinais 12 · 2 sinais 8 · 1 sinal 5 · nenhum 0 |
| 8 | **Presença na imprensa** | 10 | ≥4 notícias/18m 10 · ≥2 7 · 1 4 · só antigas 2 |
| 9 | **Aderência ao portfólio** | 8 | ≥3 hipóteses 8 · 2 6 · 1 4 · n/d 0 |
| 10 | **Evidências confirmadas** | 6 | ≥4 CONFIRMADO 6 · ≥2 4 · 1 2 |

### 1.2 Bandas e cores (emerald institucional — nunca roxo)

| Banda | Range | Rótulo | Cor |
|-------|-------|--------|-----|
| ALTA | ≥75 | Prioridade alta | `#00726B` |
| MEDIA_ALTA | 55–74 | Prioridade média-alta | `#00968C` |
| MEDIA | 35–54 | Prioridade média | `#B08300` |
| BAIXA | <35 | Prioridade baixa | `#8C8C8C` |

### 1.3 Onde o score aparece (uma fórmula, cinco superfícies)

1. **Badge na lista** (`PriorityListBadge`): N/100 em emerald + tooltip dos 2 maiores fatores; lista ordenável por score.
2. **Painel do dossiê** (`PriorityPanel`): os 10 fatores com `pontos/max` e o detalhe ("por quê") de cada um.
3. **CSV de resultado**: colunas `score_prioridade` + `score_banda`.
4. **Planilha de inteligência IA**: mesmas colunas após `perfil_classificacao_ia`.
5. **Consolidado de lotes**: idem, com o score calculado 1× por linha.

**Garantia de consistência:** a UI usa `computePriorityScore(RowView)` e os exports usam
`computePriorityScoreFromRaw(linha Prisma)` — adaptador server-side que reconstrói a
mesma entrada a partir dos JSONs persistidos (`extraJson`, `sociosJson`, `researchJson`,
`aiDossierJson`). O executivo exporta exatamente o que vê. Zero divergência.

**Regra de honestidade no fator 7:** porte real conta SOMENTE com sinal citável do
research packet (headcount/receita/frota/unidades). Capital social nunca vira porte real.

---

## 2. Faturamento — faixa pública honesta (`enrich/faturamento.ts`)

A Receita Federal **não publica faturamento por CNPJ**. O produto mapeia FAIXAS
com base legal — e recusa chutar quando não há base:

| Condição (em ordem de avaliação) | Faixa devolvida | Base citada |
|----------------------------------|-----------------|-------------|
| `MEI = Sim` | Até R$ 81 mil/ano | Teto legal do MEI (Receita Federal) |
| `Simples = Sim` + porte ME | Até R$ 360 mil/ano | Microempresa optante do Simples (LC 123/2006) |
| `Simples = Sim` + porte EPP | R$ 360 mil a R$ 4,8 mi/ano | EPP no Simples Nacional (LC 123/2006) |
| `Simples = Sim` (sem porte refinado) | Até R$ 4,8 mi/ano | Teto legal do Simples Nacional (LC 123/2006) |
| Porte **DEMAIS** no cadastro | Acima de R$ 4,8 mi/ano | Porte da Receita = classificação POR RECEITA BRUTA (+ regime tributário quando há) |
| Fora do Simples + regime conhecido | Acima de R$ 4,8 mi/ano | Regime Presumido/Real — não optante do Simples |
| nada do acima | **null** (sem faixa) | Honestidade > chute |

**Cada faixa carrega a `base`** (de onde veio) — exibida no dossiê e exportada nas
colunas `faturamento_faixa` + `faturamento_base`. Capital social NUNCA vira faturamento.

---

## 3.0 ENTITY_BINDING — vínculo entre evidência e entidade (`resolve/binding.ts`)

**Regra central: validar que um CNPJ EXISTE não valida que ele corresponde à empresa buscada.**
Antes de promover qualquer CNPJ a candidato, o resolvedor responde: *"o que nesta fonte prova
que ESTE CNPJ representa a entidade procurada?"* Se a resposta for apenas "o termo apareceu
nessa página", o vínculo não existe → REJECT.

### 3.0.1 binding_type (11 tipos) e força

| Tipo | Força | Gera candidato sozinho? |
|------|-------|--------------------------|
| `OFFICIAL_SITE` | 🟢 FORTE | Sim — site oficial da pista publica razão social/CNPJ |
| `LEGAL_DISCLOSURE` | 🟢 FORTE | Sim — divulgação legal própria com nome + CNPJ |
| `DOMAIN_REGISTRANT` | 🟢 FORTE | Sim — registrante do domínio (registro.br) |
| `GOVERNMENT_RECORD` | 🟢 FORTE | Sim — base oficial registra nome+local que correspondem à pista |
| `SAME_PHONE` | 🟡 MODERADA | Não sozinho — telefone do registro coincide |
| `SAME_EMAIL_DOMAIN` | 🟡 MODERADA | Não sozinho — domínio de e-mail coincide |
| `SAME_ADDRESS` | 🟡 MODERADA | Não sozinho — endereço coincide |
| `BUSINESS_DIRECTORY` | 🟡 MODERADA | Não sozinho — diretório associa nome ao CNPJ |
| `THIRD_PARTY_MENTION` | 🟠 FRACA | Nunca sozinho — menção de terceiros é pista |
| `PAGE_OWNER_ONLY` | 🔴 INVÁLIDA | **Sempre descartar** — CNPJ é do dono/publisher da página |
| `UNRELATED` | 🔴 INVÁLIDA | **Sempre descartar** — nenhuma relação com a pista |

### 3.0.2 Hosts publisher (o bug do golden case)

`classifyHost()` classificou categorias de host em que **todo CNPJ encontrado pertence ao
publicador**: MARKETPLACE (mercadolivre, amazon, shopee…), SOCIAL (facebook, linkedin…),
CLASSIFIEDS (olx, mfrural, catho…), NEWS (g1, uol, câmaras .leg.br via sufixo gov/leg…),
DIRECTORY (casadosdados, cnpj.biz…). Caso de teste obrigatório: query `"sementes carolina"`
→ Mercado Livre / MF Rural / Câmara dos Deputados / LinkedIn **todos descartados como
PAGE_OWNER_ONLY**; empresa sem vínculo → UNRELATED. Resultado honesto: **UNRESOLVED**
(melhor não resolver do que resolver errado).

### 3.0.3 Gate mínimo para candidato

- **1 evidência FORTE**, OU
- **2 evidências MODERADAS independentes** (tipo distinto OU fonte distinta, dedupe por tipo+fonte).
- Cada evidência persiste: `source_url, source_owner, mentioned_entity, candidate_legal_name, candidate_cnpj, binding_type, binding_evidence, date`.

### 3.0.4 BrasilAPI não prova vínculo

BrasilAPI/Receita confirmam existência, razão social, situação, endereço, matriz/filial —
**nunca** que o CNPJ corresponde à pista. Por isso a UI separa:
- **"Por que este candidato corresponde à pista"** → chips de binding (tipo + evidência);
- **"Dados jurídicos confirmados"** → validam o registro, rotulados como *"validam o
  registro, não o vínculo com a pista"* — nunca aparecem como sinal de match
  (`identitySinais()` filtra "situação cadastral confirmada" dos sinais de identidade).

---

## 3. Motor de enriquecimento (`enrich/`)

### 3.1 Pipeline (estados da linha)
```
PISTA → RESOLVIDO/REVISAR/NAO_ENCONTRADO → ENFILEIRADO → ENRIQUECIDO
                                              ↓
                                  (opt-in IA) LENDO_IA → IA_OK / IA_FALHOU / IA_IGNORADO
```

### 3.2 Módulos e fontes
| Módulo | O que entrega |
|--------|---------------|
| `sources.ts` | Consulta CNPJ pública (CNPJ.ws/compatíveis + RDAP .br): razão social, situação, **contato (e-mail, telefone, telefone 2)**, **QSA completo com qualificação**, capital social, porte, MEI/Simples/regime, CNAE, matriz/filial |
| `resolve/` | Binding de entidade: pista (CNPJ ou nome) → candidato único com nível de evidência; descarta com motivo gravado |
| `ibge.ts` | Contexto municipal: população + região imediata do município (colunas `municipio_populacao`, `regiao_imediata`) |
| `research.ts` | Packet de pesquisa: domínio/site oficial, sinais digitais, **sinais de porte real**, prepara entradas p/ IA |
| `news.ts` | Google News RSS por nome + gap-chasing (busca ativa até preencher janelas de tempo) |
| `ai.ts` | Leitura de conta (perfil, teia, operação, tecnologia, aderência, próximo movimento) + síntese do lote. Rate limit global + cache entre lotes; regeneração manual nunca devolve cache |
| `engine.ts` | Orquestração: concorrência 3, retry até 3× (RATE_LIMITED/TIMEOUT/ERRO_REDE/ERRO_SERVIDOR/NAO_ENCONTRADO são retryable), locks em memória, sweep de linhas travadas (30s), teto de IA por lote (`AI_MAX_PER_BATCH`), auditoria de cada evento |

### 3.3 Decisores (QSA → executivo)
O QSA oficial vira material comercial:
- Cada sócio com **qualificação** (Sócio-Administrador, Presidente, Diretor…) ranqueado;
- Sócios PJ sinalizam **grupo/holding** (alimenta o fator teia do score);
- Exportados em `socios_qsa` + `qtd_socios` e exibidos na seção "Decisores" do dossiê.

### 3.4 Deep research (por linha, opt-in)
Crawl por etapa com progresso visível (`DeepResearchBar`), evidências classificadas
CONFIRMADO/INDÍCIO/NÃO_ENCONTRADO com fonte em cada chip. Uma pesquisa em andamento
por linha (lock anti-duplo-clique).

---

## 4. Auditoria

Todo evento relevante grava `AuditEvent` (lote, evento, detalhe JSON, linha):
upload, detecção de coluna, confirmação, início, por linha (descoberta, enriquecimento,
erro, IA agendada/ok/falha), decisão humana, deep research, síntese. Exposto na UI
(`AuditPanel`) e exportado (`.jsonl` da área técnica).

---

## 5. Exportações (o que o executivo leva)

### 5.1 CSV de resultado (`GET /api/imports/{id}/export?kind=resultado`)
Linhas originais preservadas + `DERIVED_HEADER` (52 colunas):
- **Resolução:** tipo_entrada, referencia, cnpj_encontrado, fonte_descoberta, estado_resolucao, confianca_evidencia, metodo_resolucao, notas_resolucao
- **Identidade:** cnpj_normalizado, cnpj_valido, status_linha/status_enriquecimento, razao_social, nome_fantasia, situacao_cadastral (+data/motivo), matriz/filial (+cnpj_raiz, cnpj_matriz, status_matriz), data_abertura
- **Local/CNAE:** cnae_codigo/descricao, municipio, uf
- **Contato (novo):** contato_email, contato_telefone, contato_telefone_2
- **Tamanho/mercado:** capital_social, natureza_juridica, **faturamento_faixa, faturamento_base**, municipio_populacao, regiao_imediata
- **Decisores:** socios_qsa, qtd_socios
- **Proveniência:** fonte, data_consulta, erro
- **IA:** ia_status, ia_setor, ia_porte, ia_perfil_classificacao, ia_leitura_executiva, ia_teia_societaria, ia_operacao, ia_tecnologia, ia_aderencia_portfolio, ia_proximo_movimento
- **Prioridade (novo):** score_prioridade, score_banda

### 5.2 Outros formatos (mesma rota, `kind=`)
- `confirmadas` / `selecionadas` — cortes comerciais com as mesmas colunas;
- `leituras` — planilha de inteligência (linha, cnpj, razao, setor_ia, porte_ia, perfil_classificacao_ia, score_prioridade, score_banda);
- `teia` — grafo societário (linha, cnpj_conta, razao_social, tipo_unidade, cnpj_matriz…);
- `resumo` (.json) + `auditoria` (.jsonl) — área técnica.

### 5.3 Consolidado (`GET /api/imports/export-all`)
Todos os lotes em um CSV: `lote_arquivo, id_lote, linha, cnpj_original, colunas_originais_json, …DERIVED_HEADER`
— colunas originais sem perda (JSON) + derivadas padronizadas, score por linha.

---

## 6. Regras de ouro da inteligência

1. **Determinismo antes de IA** — o que pode ser calculado, é calculado (score, faixas, QSA); IA só onde há leitura.
2. **Evidência citável ou não entra** — porte real, faturamento, identidade: sempre com fonte.
3. **Descarte com rastro** — candidato não eleito vira registro com motivo, nunca some.
4. **Honestidade visual** — "não sabemos" explícito vale mais que inferência disfarçada de fato.
5. **Export = UI** — garantia formal de igualdade entre o que se vê e o que se exporta.
