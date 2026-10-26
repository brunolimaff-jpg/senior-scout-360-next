# SCOUT 360 — Catálogo de Componentes
### Inventário completo · props, estados e responsabilidade de cada peça

> Referência para portar/reaproveitar os componentes. Stack: Next.js 16 (App Router),
> TypeScript, Tailwind CSS 4, shadcn/ui (New York), Framer Motion, Lucide.
> Tokens visuais em `DESIGN-SPEC.md` · movimento em `MOTION-SPEC.md`.

---

## 1. Mapa geral

```
src/
├── app/
│   ├── page.tsx                    # Orquestrador do produto (estados → telas)
│   ├── layout.tsx                  # Fonte Public Sans + toaster + tema
│   ├── globals.css                 # Tokens, aurora, keyframes, superfícies de vidro
│   └── api/…                       # 17 rotas (ver API-SPEC.md)
├── components/
│   ├── cnpj/
│   │   ├── page-level cards (4)    # Fluxo de entrada
│   │   ├── batch-detail-card.tsx   # O produto: 3.200+ linhas, 50 sub-componentes
│   │   └── senior.tsx              # Design system interno (badges/chips/fmt)
│   ├── motion/primitives.tsx       # 8 primitivas de movimento
│   └── ui/                         # 48 componentes shadcn
├── hooks/                          # use-toast, use-mobile
└── lib/
    ├── score.ts                    # Prioridade comercial 0–100 (ver INTEL-SPEC.md)
    ├── cnpj.ts / csv.ts / extract.ts / clipboard.ts / ratelimit.ts
    ├── resolve/                    # Identidade (binding de entidade)
    ├── enrich/                     # Motor de enriquecimento (7 módulos)
    └── types.ts                    # Contratos de view compartilhados
```

---

## 2. Cards de fluxo de entrada (`components/cnpj/`)

### `upload-card.tsx` → `UploadCard`
- **Responsabilidade:** dropzone de CSV/XLSX com drag & drop real.
- **Props:** callbacks de arquivo/seleção + estado de arraste.
- **Estados:** idle (ícone flutuando — `float`), dragover (borda cônica girando — `border-girando`), carregando (shimmer).
- **Detalhes:** detecção de coluna CNPJ acontece no backend; aqui só entrada honesta de arquivo.

### `preview-card.tsx` → `PreviewCard`
- **Responsabilidade:** prévia do parse (delimitador detectado, encoding, amostra de linhas, coluna CNPJ marcada).
- **Props:** `ParseInfo` + ações confirmar/voltar.
- **Detalhe:** mostra COMO a coluna CNPJ foi achada (`detectedBy`: cabeçalho ou conteúdo) — transparência de máquina.

### `batch-detail-card.tsx` → `BatchDetailCard` (o produto)
- **Responsabilidade:** tela inteira de resultado — filtro, panorama, progresso, tabela, expansão de linha, dossiê, exportações.
- **Props principais:** `detail: BatchDetail`, `filter`, callbacks `onFilterChange`, `onRetry`, `onDecide`, `onRetryAi`, `onDeepResearch`…
- **Filtro:** nunca herda valor vazio — quando a seleção não tem linhas, reseta para "Todas as situações" (anti-tela-vazia).

### `history-card.tsx` → `HistoryCard`
- **Responsabilidade:** lista de lotes anteriores com status e link para reabrir.

### `senior.tsx` → design system interno (todos exportados)

| Export | Uso |
|--------|-----|
| `RESOLUTION_STATE`, `BATCH_STATE`, `CONFIDENCE`, `KIND`, `LOOKUP_STATE`, `AI_STATE` | Rótulos pt-BR dos enums de máquina |
| `sourceLabel(s)` | Nome legível da fonte ("CNPJ.ws", "RDAP", …) |
| `registrationLabel(s)` / `eventLabel(e)` | Situação cadastral e evento em texto humano |
| `Tone` / `Situation` / `rowSituation(r)` | Deriva o tom da linha (confirmado/revisao/nao/processando/erro/neutro) a partir dos dados |
| `TONE_ICON`, `SituationBadge` | Ícone + pílula colorida de situação |
| `BatchStateBadge` | Estado do lote (fila/processando/pronto/erro) |
| `TrustChip` | Confiança da identificação (alta/média) |
| `FoundTypeChip` | Matriz vs filial (`isHeadquarters`) |
| `OpMetric` | KPI numérico com tons verde/atenção/neutro |
| `SectionTitle`, `TechDisclosure`, `DefRow`, `RowAction` | Estrutura de seções + botão técnico colapsável |
| `formatBR(iso)`, `formatBRL(v)` | Datas e moeda pt-BR |

---

## 3. `batch-detail-card.tsx` — sub-componentes internos (inventário)

### Camada de linha (tabela)
| Componente | Papel |
|------------|-------|
| `CompanyAvatar` | Iniciais com tom derivado determinístico do nome (`avatarTone`) |
| `IdentityFlow` | Sequência pista → candidato eleito → evidência (a "linha de vida" da identificação) |
| `BindingChip` | Chip do binding de entidade (tipo + evidência) |
| `DiscardedList` | Candidatos descartados com motivo — nada some sem rastro |
| `ReviewPanel` | Revisão humana: elege/descarta candidatos |
| `CandidateRow` | Uma linha de candidato com confiança e fonte |
| `WhyPanel` | "Por que esta conta?" — fatores do score com pontos |
| `UnresolvedPanel` | Linhas sem identidade: por quê + próximo passo |
| `PublicDataPanel` | Dados públicos do CNPJ (situação, porte, capital, CNAE) |
| `SociosPanel` / `SocioChips` | QSA com qualificação sócio/administrador |
| `RegistrationAlertBadge` | Alerta material (BAIXADA/SUSPENSA/INAPTA) |
| `RowTrustChip` / `RowExpansion` | Confiança + expansão da linha |
| `PriorityListBadge` | N/100 em emerald com tooltip dos 2 maiores fatores |
| `scoreInputOf(r)` | Adapta `RowDetail` → `ScoreRowInput` |

### Camada de dossiê (o produto dentro do produto)
| Componente | Papel |
|------------|-------|
| `CompanyDossier` | Documento de 11 seções em Dialog `max-w-3xl` (tela cheia no mobile) |
| `CompanyFicha` / `FichaTile` | Ficha de identidade em tiles (CNPJ, matriz, abertura, porte) |
| `ContactSection` / `ContactRow` / `fichaContatoTexto` | **Telefone, e-mail e canais com copiar-um-clique** (texto pronto p/ CRM) |
| `DecisoresSection` / `decisoresOf(r)` | **Decisores**: sócios/administradores do QSA ranqueados por qualificação |
| `NewsSection` / `NewsCard` | Notícias Google News com data relativa |
| `PorteSignals` | Sinais citáveis de porte real (headcount/receita/frota/unidades) |
| `AiBlock` | Leitura IA: síntese, hipóteses, evidências, próximo movimento |
| `HypothesisCard` / `EvidenceChipRow` / `MiniChip` | Hipóteses com status FATO/CONSEQUÊNCIA/VALIDAR e evidências CONFIRMADO/INDÍCIO/NÃO ENCONTRADO |
| `DeepSection` / `DeepResearchBar` | Pesquisa profunda: progresso por etapa + gatilho |
| `PriorityPanel` | Score detalhado: 10 fatores com pontos/max/detalhe |
| `NoAiState` | Estado sem IA: mostra o que existe + como gerar |

### Camada de lote (painéis)
| Componente | Papel |
|------------|-------|
| `ProgressPanel` | Progresso do processamento (barra com shimmer) |
| `ResultsReadyPanel` | Banner de pronto: CTA "Visualizar resultados" + "Exportar ▾" + alertas materiais |
| `PanoramaPanel` | Panorama do lote: distribuições por situação/porte/faixa de faturamento (`DistBar`) |
| `SummaryPanel` | Síntese IA do lote |
| `AuditPanel` | Trilha de auditoria (eventos com timestamp) |
| `ExportMenu` | Dropdown com todas as exportações (CSV/JSON/JSONL — ver INTEL-SPEC.md §5) |
| `DistBar` | Barra de distribuição segmentada reutilizável |

---

## 4. Primitivas de movimento (`components/motion/`)

`MotionRoot` · `FadeUp` · `SectionReveal` · `Stagger`/`StaggerItem` · `SpringCard` · `AnimatedNumber` · `ScaleIn` · `AuroraBackground` — **specs completas em `MOTION-SPEC.md` §2.**

---

## 5. Camada de dados (`lib/`)

| Módulo | Responsabilidade |
|--------|------------------|
| `score.ts` | Score de prioridade determinístico 0–100 + adaptador server-side (`computePriorityScoreFromRaw`) — mesma fórmula na UI e nos CSVs |
| `cnpj.ts` | Validação/format/normalize de CNPJ (dígitos verificadores) |
| `csv.ts` | Parser CSV tolerante (delimitador `,`/`;`, encoding, aspas) |
| `extract.ts` | Extração de pistas de texto livre (CNPJ/nome) + `referenceKey` anti-duplicidade |
| `clipboard.ts` | `copyText()` com fallback `execCommand` — copiar funciona em HTTP (contexto inseguro) |
| `ratelimit.ts` | Rate limiter global em memória (janelas) para IA |
| `resolve/` | `extractClues`, `resolveIdentity`, `resolveMatriz` — binding de entidade com níveis de evidência |
| `enrich/sources.ts` | Adaptadores de fontes públicas (CNPJ.ws, RDAP, IBGE…) → CnpjLookupResult com telefone/e-mail/QSA/porte |
| `enrich/faturamento.ts` | Faixa de faturamento pública e honesta (LC 123/2006) — nunca chute |
| `enrich/ibge.ts` | Contexto municipal (população/PIB per capita do município) |
| `enrich/research.ts` | Packet de pesquisa: site oficial, sinais digitais, sinais de porte, notícias |
| `enrich/news.ts` | Google News RSS por nome com gap-chasing |
| `enrich/ai.ts` | Leitura IA de conta + síntese de lote (rate limit + cache inter-lotes, auditado) |
| `enrich/engine.ts` | Orquestrador: upload → preview → confirm → tick → IA → deep research (concorrência 3, retries, locks, sweep de stalls) |
| `types.ts` | Contratos de view (RowView, BatchDetail, NewsItemView…) compartilhados UI↔API |

---

## 6. Mini serviço (`mini-services/resolve-service/`)

Serviço Bun independente (porta própria) para resolução pesada de identidade,
comunicado via gateway (`?XTransformPort=`) — mantém o tick da Next.js API leve.

---

## 7. Convenções transversais

1. **Toda lista longa tem teto com scroll** (`max-h-96 overflow-y-auto`) + scrollbar custom.
2. **Toda cópia de texto usa `copyText()`** (funciona em HTTP) com feedback real de sucesso/erro.
3. **Todo badge/estado tem rótulo pt-BR** de `senior.tsx` — enums de máquina nunca vazam para a UI.
4. **Dados técnicos em `TechDisclosure`** — o executivo vê o que importa; o técnico expande o resto.
5. **Fonte citada em todo fato** — componente mostra de onde o dado veio (`sourceLabel`).
6. **Alvos de toque ≥ 44px** e `testId` em elementos-chave para QA automatizado.
