# SCOUT 360 — Galeria de Evidências de QA
### Screenshots e dados coletados via agent-browser durante o desenvolvimento

> Pasta `evidencias/` do kit. Cada arquivo documenta um estado verificado do produto.
> Formato dos dados: `qa-consolidada.jsonl` (leituras linha a linha) e
> `qa-consolidado.csv` (mesma base em CSV).

---

## Screenshots (verificação visual E2E)

| Arquivo | O que prova |
|---------|-------------|
| `e2e-desktop.png` | Fluxo completo desktop: estado inicial (3 cards em stagger), header/logo corretos |
| `e2e-mobile.png` | Mesmo fluxo em viewport mobile — responsividade real, não reduzida |
| `e2e-footer.png` | Footer sticky: cola no fundo em página curta, é empurrado em página longa |
| `qa-overview-light.png` | Panorama do lote em tema claro — distribuições e KPIs |
| `qa-overview-dark.png` | Panorama em tema escuro — contraste dos vidros (3 camadas) |
| `qa-dark.png` / `qa-dark-top.png` / `qa-dark-full.png` | Varredura dark mode completa (topo/meio/fim) |
| `qa-mobile-overview.png` | Panorama mobile |
| `qa-mobile-detail.png` | Detalhe de linha + dossiê em mobile (tela cheia) |
| `qa-round3.png` / `qa-round3-detail.png` | Rodada 3: banner de resultados + prioridade na lista |
| `qa-round4.csv` | Saída CSV da rodada 4 (export) |

## Dados

| Arquivo | Conteúdo |
|---------|----------|
| `qa-consolidada.jsonl` | Uma leitura por linha: identidade, situação, fontes, IA, score |
| `qa-consolidado.csv` | Mesma base em CSV (abre em Excel/Sheets) |

---

## Cenários cobertos (resumo dos testes manuais E2E)

1. **Fluxo feliz** — colar pista → prévia → confirmar → processar → DONE → dossiê.
2. **Caso BAIXADA** (CNPJ 00.701.164/0001-46 Polato) — alerta material no banner, dossiê destaca situação, filtro nunca herda "Revisar identificação" vazio (auto-reset testado).
3. **Menu Exportar** — 7 formatos acessíveis (Planilha completa / Confirmadas / Selecionadas / Leituras / Teia / Resumo .json / Auditoria .jsonl).
4. **Score de prioridade** — EVERMAT 70/MEDIA_ALTA igual em: badge da lista, dossiê e 3 CSVs (fórmula única UI/export).
5. **Ordenação por score** — header "Empresa" clica none→desc→asc; não-enriquecidas sempre no fim; asc = inverso exato de desc.
6. **Dark mode + mobile** — varredura completa em 3 larguras; vidro e aurora mantêm contraste.
7. **Footer sticky** — sem gap flutuante; empurra corretamente com conteúdo longo.
8. **Copiar** — botões de cópia funcionam em HTTP (fallback `execCommand`), com feedback real.

> Reprodutibilidade: cada cenário usa lote real importado pela UI (sem mocks de
> banco) — os mesmos CNPJs citados no `CHANGELOG.md` reproduzem os estados acima.
