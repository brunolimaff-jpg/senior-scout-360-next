# Auditoria crítica de UI/produto — Scout 360 (resposta ao pedido do PR #1)

- **Data:** 2026-10-26 · **Executor:** ZCode (GLM-5.3-Flash) · **Modo:** somente diagnóstico, **nenhum código alterado, nenhum commit/push** (conforme gate do comentário do PR).
- **Contexto:** branch `g7/consolidacao-local`, HEAD local `5024c20` (igual ao inspecionado pelo Planejador). App local `http://127.0.0.1:3000` (dev), dados sintéticos existentes (`cenario-b-sintetico.csv` 11 entradas/3 dossiês; `lote-teste-local.csv` 1 pista não identificada). Nenhum dado criado ou alterado.
- **Ambiente de captura:** navegador integrado fixo em **1280×720** (ÚNICA largura medida). 1366/1440/painel lateral estreito: **NÃO VERIFICADO**. Mobile fora do escopo desta rodada.

## Resumo em uma frase

A jornada funciona e o contrato de estados (Lotes × Mesa × dossiê) está correto; os maiores custos reais de uso hoje são **busca truncada a ~50px no modo Dividido**, **~598px de cabeçalhos antes da primeira linha da Mesa**, e **linguagem que mistura "identificadas" com "prontas para análise"**.

## Achados priorizados

| # | Prio | Achado | Classificação | Localização |
|---|------|--------|----------------|-------------|
| 1 | 🔴 P1 | Busca da lista truncada a ~50px no modo Dividido (1280) | CONFIRMADO EM RUNTIME | `batch-detail-card.tsx` ~5342–5363 |
| 2 | 🔴 P1 | ~598px (83% de 720) de cabeçalhos antes da 1ª linha da Mesa; lote/"Concluído" repetidos 3× | CONFIRMADO EM RUNTIME | `page.tsx` 708–734, `batch-detail-card.tsx` 5240–5330, 5960–6010 |
| 3 | 🔴 P1 | Título "N contas prontas para análise" usa `totalConfirmed`; população da Mesa é `dossiesProntos` — divergência possível (11 identificadas ≠ 3 dossiês) escondida pela coincidência 3=3 | EVIDÊNCIA DE CÓDIGO + HIPÓTESE (cenário divergente não reproduzido) | `batch-detail-card.tsx` 1473–1493; `acompanhamento-painel.tsx` 119–133 |
| 4 | 🟠 P2 | Microcontroles abaixo do padrão do próprio produto (24px/12px/11px; resumo 19px; checkbox 16px) | CONFIRMADO EM RUNTIME | `batch-detail-card.tsx` 5262–5328, 6001 |
| 5 | 🟠 P2 | Header/rodapé (1140px, conteúdo x=86) desalinhados da estação Mesa (1720px, conteúdo x=32): 54px de desvio nas bordas | CONFIRMADO EM RUNTIME | `app-header.tsx` 77; `page.tsx` 711; `page.tsx` 922 |
| 6 | 🟠 P2 | Cenário A: CTA primário verde "Visualizar resultados" leva a Mesa vazia; o caminho real (Lotes) é secundário | CONFIRMADO EM RUNTIME | `batch-detail-card.tsx` 1528–1533 |
| 7 | 🟠 P2 | Texto de apoio em `cinza-400` (#9C9C9C) = **2,94:1** — falha AA (29 usos só no card da Mesa) | CONFIRMADO EM RUNTIME (cálculo WCAG) | `globals.css` 71; `batch-detail-card.tsx` (29 ocorrências) |
| 8 | 🟠 P2 | Mesma ação com 5 nomes: "Análise" / "Ver análise" / "Ler dossiê" / "Abrir dossiê" / aria "Abrir dossiê de N" | EVIDÊNCIA DE CÓDIGO + RUNTIME | `batch-detail-card.tsx` 5593, 5623, 5836, 5840, 5889 |
| 9 | 🟠 P2 | Link de download dentro de `<button>` no histórico (HTML inválido) | CONFIRMADO EM RUNTIME (DOM/a11y tree); Tab **NÃO VERIFICADO** | `history-card.tsx` 57–87 |
| 10 | 🟠 P2 | Logo anima ao hover/tap mas não navega (cursor `auto`, sem handler) | CONFIRMADO EM CÓDIGO + RUNTIME | `app-header.tsx` 81–98 |
| 11 | ⚪ P3 | Histórico mostra "Nenhum lote anterior." no 1º paint antes de carregar (flash); erro de rede é silencioso | CONFIRMADO EM RUNTIME (local); duração em rede lenta NÃO VERIFICADO | `page.tsx` 86, 217–225; `history-card.tsx` 70 |
| 12 | ⚪ obs | Faixa de acompanhamento NÃO quebra em 1280 (1 linha, 45px) — contraria hipótese preliminar do Planejador neste viewport | CONFIRMADO EM RUNTIME; 1366/1440 NÃO VERIFICADO | `acompanhamento-painel.tsx` 43 |

## Evidências principais (medidas em 1280×720)

1. **Busca truncada** — no modo Dividido, a linha de cabeçalho da lista tem 264px de conteúdo: busca `flex-1 min-w-0` → **container 36px / input 50px**; select "Todas as situações" fixo **128px**; "Ajustes" **84px**. O placeholder "Buscar por empresa, CNPJ ou domínio…" não cabe. Captura: `qa/g7/auditoria/mesa-a-ficha-revisao.png` (canto inferior esquerdo) e `mesa-b-ficha.png` ("Buscar por er").
2. **Pilha vertical da estação (lote B):** topbar 95px (y78) → "Resultado deste lote" 34px (y193) → faixa 45px (y274) → resumo 66px (y363) → intro Mesa 29px (y429) → barra de filtros 38px (y479) → cabeçalho da lista 49px (y549) → **1ª linha em y≈598**. Nome do lote e "Concluído" aparecem 3× na mesma tela. Capturas: `mesa-b-topo.png`, `duplicacao-topo.png`, `mesa-b-foco.png` (modo Foco mantém as mesmas camadas).
3. **Semântica dos contadores:** título do resumo usa `prontas = totalConfirmed` (batch-detail-card.tsx:1477), a Mesa lista `dossiesProntos` e o botão "Identificadas" aplica `resolucao=CONFIRMED` — consistentes entre si hoje (3/3/3), mas o rótulo "prontas para análise" promete a população da Mesa (dossiês) com a contagem de identificadas. Com 11 identificadas e 3 dossiês o título diria "11 prontas" para 3 disponíveis. Fixação de G7 correta nos números; **o rótulo é que precisa de uma semântica única**.
4. **Contraste:** `--color-senior-cinza-400: #9C9C9C` sobre branco = 2,94:1 (AA exige 4,5:1; 3:1 para texto grande). Usos incluem dicas úteis ("clique na empresa para abrir a ficha ao lado", "Reprocessa a busca nesta mesma linha…"), não só traços decorativos. `cinza-600` = 6,66:1 e verde `#086B6B` = 6,31:1 — principais textos OK.
5. **Cenário A correto no contrato:** Mesa vazia com motivo e ação ("Nenhum dossiê pronto… pendências ficam em Lotes"), clique manual abre ficha de revisão (não auto), **"PDF do dossiê indisponível — identidade não concluída (ajuste em Lotes)"** no lugar do botão. Capturas: `mesa-a-vazia.png`, `mesa-a-ficha-revisao.png`.
6. **Logo:** `whileHover={{scale:1.04, rotate:-1.2}} whileTap` sem `button/a`/handler; runtime: `tabIndex -1`, cursor `auto`.
7. **Histórico:** `<button …>` contém `<a href="/api/imports/export-all…">` (DOM confirmado; link aparece na árvore de acessibilidade dentro do botão). `focus()` programático funciona; travessia por Tab não pôde ser medida no IAB (input sintético não move foco) — **NÃO VERIFICADO**.
8. **First paint do histórico:** DOM no `domcontentloaded` mostrava "Nenhum lote anterior." com 2 lotes na API; ~1,2s depois populou. Sem estado de carregamento e catch silencioso (`page.tsx:222`).

## O que está BOM (verificado, para não "consertar por gosto")

- Reduced-motion coberto: `MotionConfig reducedMotion="user"` + `@media (prefers-reduced-motion)` desliga aurora (`motion/primitives.tsx:30`, `globals.css:262`).
- Sem overflow horizontal em 1280 (`docW 1265 ≤ viewport`).
- Faixa de acompanhamento em 1 linha com denominador visível ("Dossiês prontos 3 de 11") — o denominador não ficou só no `title`.
- Contadores da G7 batem com os filtros aplicados (botão = tabela) em ambos os cenários.
- Estados vazios da Mesa e da ficha têm orientação de próxima ação (texto + CTA), e o bloqueio de PDF no cenário A é explicado.

## Rodada pequena proposta (sequência de menor risco → maior ganho)

| Rodada | Conteúdo | Critério de aceite observável |
|--------|----------|------------------------------|
| **R1 — visibilidade imediata** (1 componente + tokens) | Busca com largura mínima (ex.: `min-w-44`) e/ou `flex-wrap` na linha do cabeçalho; chips/modos da barra em h-7 (28px) e 13px; "Resumo completo" h-8; `cinza-400`→`cinza-500/600` em **texto** de apoio | Placeholder legível sem truncar; nenhum controle clicável <28px; contraste ≥4,5:1 nas dicas; screenshots antes/depois 1280 |
| **R2 — hierarquia da estação** | Com Mesa ativa, colapsar "Resultado deste lote" + resumo no topbar (strip permanece); header/rodapé seguem a mesma largura da estação quando `mesaAtiva` | 1ª linha/ficha visível acima de y≈420 em 720; nome do lote e "Concluído" ≤1× por tela; bordas esquerda/direita alinhadas |
| **R3 — semântica e linguagem** | Título do resumo: "N contas identificadas" (deixa "pronto" para dossiês) OU `dossiesProntos` no título — decidir 1 semântica; matriz única de rótulos por estado nos 2 layouts; fixture de teste unitário 11 identificadas/3 dossiês (sem tocar no banco do operador) | Teste com cenário divergente PASS; mesma ação com o mesmo nome por estado |
| **R4 — estrutural** | Chip de exportação fora do `<button>` do histórico (mesmo visual, flex row); logo: remover animação OU virar botão "Início" (decisão de produto — menor diff é remover) | HTML válido; sem expectativa falsa de clique |

Cada rodada: `npm run verify` + `build` + screenshots 1280. Viewports 1366/1440 e largura de janela lateral: **NÃO VERIFICADO** nesta auditoria (navegador fixo em 1280×720).

## Não verificado / limites

- Tab real no link aninhado, foco pós-clique em leitores de tela: NÃO VERIFICADO (IAB não executa travessia de Tab sintética).
- Duração do flash do histórico em rede lenta: NÃO VERIFICADO.
- Cenário divergente 11 identificadas × 3 dossiês em runtime: HIPÓTESE sustentada por código (criar lote novo alteraria dados — bloqueado nesta rodada).
- Exportar no cenário A (CSV com linha não identificada): não exercido (evitaria gerar arquivo/estado).

## Capturas

`qa/g7/auditoria/`: `entrada-hero.png`, `entrada-historico.png`, `mesa-b-topo.png`, `mesa-b-ficha.png`, `mesa-b-foco.png`, `mesa-a-vazia.png`, `mesa-a-ficha-revisao.png`, `duplicacao-topo.png`. Retorno do Planejador capturado em `qa/g7/planejador-retorno-20261026.png`.
