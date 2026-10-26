# 04 — Fontes públicas: comparação medida (1 chamada por fonte, 2026-10-20, CNPJ público Petrobras 33.000.167/0001-01)

| fonte | endpoint sondado | status | latência | payload | shape relevante | papel no Scout | cautela |
|---|---|---|---|---|---|---|---|
| BrasilAPI | `brasilapi.com.br/api/cnpj/v1/{cnpj}` | 200 | **69 ms** | 6,5 KB | `razao_social`, `qsa` (8), regime, código IBGE | 1ª da cadeia — mais rápida | relatos públicos de 429 em 2026 (issue #835); não martelar |
| OpenCNPJ (fallback atual) | `api.opencnpj.org/{cnpj}` | 200 | 850 ms | 5,3 KB | `razao_social`, **`QSA` maiúsculo** (tratado em `sources.ts:149`) | 2ª da cadeia | limites não declarados pelo endpoint |
| OpenCNPJ/OpenCaramelo (OUTRO provedor) | `kitana.opencnpj.com/cnpj/{cnpj}` | 200 | 1035 ms | 3,0 KB | `data.razaoSocial`, `data.socios` (camelCase) | candidata a 5ª fonte | divulga 300 req/min/IP; **não substituir sem A/B** |
| Minha Receita | `minhareceita.org/{cnpj}` | 200 | 410 ms | 6,9 KB | formato BrasilAPI + `regime_tributario` (9 entradas), `codigo_municipio_ibge`, 2 telefones | 4ª da cadeia — extras úteis ao dossiê | espelho dos dados abertos |
| ReceitaWS | `receitaws.com.br/v1/cnpj/{cnpj}` | 200 | 440 ms | 2,7 KB | snake_case | 3ª da cadeia | 1ª chamada pode ter tido cache/sorte; sem repetição (cortesia) |
| IBGE localidades | `servicodados.ibge.gov.br/api/v1/localidades/municipios/{id}` | 200 | 1343 ms | 418 B | — | contexto municipal | — |
| IBGE população | `.../agregados/6579/periodos/-1/variaveis/9324?localidades=N6[id]` | 200 | 1408 ms | 249 B | — | população (contexto, NÃO porte da empresa) | — |
| Google News RSS | `news.google.com/rss/search?q="Petrobras"` | 200 | 575 ms | 165 KB | 102 `<item>` | etapa E (notícias) | não consome RPM do SDK |
| CVM DFP | `dados.cvm.gov.br/.../dfp_cia_aberta_2025.zip` (HEAD) | 200 | 1058 ms | — | ZIP anual | receita oficial de LISTADA confirmada | arquivo pesado; baixar seletivamente |
| PNCP | `pncp.gov.br/api/consulta/v1/contratos?dataInicial=20260101&dataFinal=20260131&pagina=1` | 200 (422 com `YYYY-MM-DD`) | 5201 ms | 849 KB | JSON `data[]` | contratos públicos (tecnologia comprada) | payload pesado — **paginar**; não generalizar p/ privado |

Amostras aparadas: `qa/fontes-samples/` (brasilapi, kitana, pncp).

## Síntese operacional (para a estratégia de custo mínimo)

1. **Camada 0 determinística já tem base sólida**: cadeia BrasilAPI→OpenCNPJ→ReceitaWS→MinhaReceita cobriu 100% do lote 24 na 1ª fonte — custo cadastro ≈ 1s/conta.
2. **Diferencial do Minha Receita**: `regime_tributario` histórico + `codigo_municipio_ibge` + 2º telefone — campo que a cadeia atual descarta nas 3 primeiras fontes; vale considerar promote/merge no coletor (proposta, não execução).
3. **CVM/PNCP são seletivos**: só para LISTADA corroborada (CVM) e organizações públicas (PNCP) — entram na camada 4, nunca no bulk.
4. **IBGE/RSS são baratos e ilimitados na prática** — nada a otimizar ali hoje.
5. **Nenhum número de limite dessas fontes foi afirmado sem fonte**: os únicos limites MEASURED nesta missão são os 200/422/429 observados nas sondas.

## Regra fiscal mantida

Regime tributário, porte cadastral, capital social e CNAE **não** fornecem receita real — nunca inventar faturamento a partir deles (contrato de evidências do Scout).
