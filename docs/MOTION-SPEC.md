# SCOUT 360 — Motion Spec Completa
### Sistema de movimento "Aurora Physics" · mola, nunca tween seco

> **Complemento da DESIGN-SPEC.md (§3)** — este documento cataloga CADA animação do produto:
> primitivas Framer Motion, keyframes CSS, transições de estado, tempos, easing e as regras
> de acessibilidade. Copie daqui para portar o movimento para outro ambiente.
> Versão 1.0 · alinhada ao código em `src/components/motion/primitives.tsx` e `src/app/globals.css`.

---

## 0. Filosofia do movimento (3 leis)

| Lei | Regra | Consequência prática |
|-----|-------|----------------------|
| **1. Física, não duração** | Entradas/saídas usam mola (`type: "spring"`) — o elemento tem peso e inércia | Nenhum `ease-in-out` de 300ms disfarçado; o movimento termina quando a energia acaba, não quando o cronômetro manda |
| **2. Blur é profundidade** | Elementos que ENTRAM na tela vêm do blur (`filter: blur(6px) → 0`), como foco de câmera | Sensação de camada de vidro ganhando nitidez — coerente com o tema "Aurora Glass" |
| **3. Movimento é um presente, não uma obrigação** | `prefers-reduced-motion` desliga TUDO (CSS e Framer) | Quem pediu menos movimento vê o produto instantâneo, sem perder informação |

---

## 1. Tokens de movimento (fonte da verdade)

Implementados em `src/components/motion/primitives.tsx` — importe, nunca redeclare:

```ts
// Mola padrão: entradas, hovers, reveals (90% dos casos)
export const SPRING = { type: "spring", stiffness: 260, damping: 28, mass: 0.9 };

// Mola suave: elementos grandes, painéis, transições contemplativas
export const SPRING_SUAVE = { type: "spring", stiffness: 120, damping: 20 };

// Curva de saída para casos onde mola não se aplica (clip-paths, CSS puro)
export const EASE_OUT = [0.22, 1, 0.36, 1];
```

**Como escolher:**

| Situação | Token | Por quê |
|----------|-------|---------|
| Card entra na viewport | `SPRING` | Chegada viva, sem pular |
| Hover de card (levita) | `SPRING` | Resposta imediata, peso real |
| Número contando (KPI) | `useSpring` custom `{ stiffness: 90, damping: 24, mass: 0.8 }` | Contagem digna, ~1s, nunca frenética |
| Dropdown/popover fora do Radix | `SPRING` + scale 0.96 | Snappy com overshoot sutil |
| Fundo aurora | CSS `ease-in-out` 46–72s | É clima, não interação — mola não faz sentido em 60s |

---

## 2. Catálogo de primitivas (`components/motion/primitives.tsx`)

### 2.1 `MotionRoot` — wrapper global (obrigatório no topo da árvore)

```tsx
<MotionConfig reducedMotion="user">{children}</MotionConfig>
```
Um único componente na raiz (`page.tsx`) faz TODAS as animações Framer do app
respeitarem `prefers-reduced-motion`. Sem ele, cada primitiva precisaria de check manual.

### 2.2 `FadeUp` — entrada padrão de qualquer bloco

```tsx
initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
transition={{ ...SPRING, delay }}
```
- Distância 18px: suficiente para "chegou de baixo", pouco para distrair.
- Blur 6px → 0: a "câmera foca" o elemento (Lei 2).
- `delay` em segundos — use em passos de um fluxo (0, 0.08, 0.16…).

### 2.3 `SectionReveal` — seções longas que revelam ao rolar (uma vez)

```tsx
initial={{ opacity: 0, y: 26, filter: "blur(8px)" }}
whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
viewport={{ once: true, margin: "-60px" }}
```
- `once: true`: nunca re-anima — rolar de volta NÃO re-dispara (evita pages "pisantes").
- `margin: "-60px"`: dispara 60px antes de aparecer de fato — o usuário vê o início do movimento, não o meio.

### 2.4 `Stagger` + `StaggerItem` — lista em cascata

```tsx
const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(5px)" },
  show:  { opacity: 1, y: 0, filter: "blur(0px)", transition: SPRING },
};
```
- **0.06s entre itens**: em uma coluna de 3 cards, o terceiro começa a 0.16s — cascata percebida, espera não.
- Usado nos 3 cards de entrada do estado inicial (`page.tsx`).
- Para listas longas (>8 itens), troque Stagger por render direto — cascata longa vira fila.

### 2.5 `SpringCard` — card que levita no hover

```tsx
whileHover={interactive ? { y: -3 } : undefined}
whileTap={interactive ? { scale: 0.99 } : undefined}
transition={SPRING}
```
- `-3px`: levitação sem "pulo"; `scale 0.99` no tap dá resposta de toque.
- `interactive={false}` desliga em cards puramente informativos (dossiê aberto etc.).

### 2.6 `AnimatedNumber` — KPI que conta com mola

```tsx
const mv = useMotionValue(0);
const spring = useSpring(mv, { stiffness: 90, damping: 24, mass: 0.8 });
const text = useTransform(spring, (v) => `${Math.round(v).toLocaleString("pt-BR")}${suffix}`);
```
- Conta de 0 → valor quando entra na viewport (`useInView once`), formato pt-BR.
- `tabular-nums` evita "dança" de dígitos de largura variável.
- Opcionalmente observe `useReducedMotion()` para setar direto o valor final.

### 2.7 `ScaleIn` — dropdowns/popovers fora do Radix

```tsx
initial={{ opacity: 0, scale: 0.96, y: -4 }}
animate={{ opacity: 1, scale: 1, y: 0 }}
transition={SPRING}
```
Origem visual: nasce "de cima" (`y:-4`) — coerente com menus que caem do gatilho.

### 2.8 `AuroraBackground` — assinatura visual (4 blobs + grão)

```tsx
<div className="aurora-field" aria-hidden="true">
  <div className="aurora-blob aurora-blob-1" /> {/* esmeralda 0.175, 680px, top-left */}
  <div className="aurora-blob aurora-blob-2" /> {/* neon 0.13, 780px, top-right */}
  <div className="aurora-blob aurora-blob-3" /> {/* teal 0.10, 620px, bottom-center */}
  <div className="aurora-blob aurora-blob-4" /> {/* mint 0.05, 460px, bottom-right */}
  <div className="aurora-grain" />              {/* SVG noise overlay 0.5, anti-banding */}
</div>
```
Detalhe técnico: cada blob usa `radial-gradient` com `filter: blur(64px)` e
`will-change: transform` + `translate3d(0,0,0)` (promove a camada GPU — sem jank).

---

## 3. Catálogo de keyframes CSS (`globals.css`)

### 3.1 `aurora-drift-1/2/3` — deriva do campo de luz (46–72s)

| Blob | Duração | Direção | Amplitude |
|------|---------|---------|-----------|
| blob-1 | 46s `alternate` | ↘ diagonal | 90px, 60px + scale 1.12 |
| blob-2 | 58s `alternate` | ↙ com rotate 8° | -110px, 90px + scale 1.15 |
| blob-3 | 64s `alternate` | ↖ sutil | -60px, -90px + scale 1.1 |
| blob-4 | 72s `alternate-reverse` | reusa drift-2 em contra-fase | — |

**Por que durações dessincronizadas:** números primos entre si (46/58/64/72) fazem o
padrão nunca repetir exatamente — o fundo parece vivo para sempre, sem loop visível.

### 3.2 `border-girando` — dropzone em drag (borda cônica girando)

```css
.border-girando::before {
  background: conic-gradient(from var(--ang, 0deg), #00968C, #12F7D1, #2AC4AA, #00968C);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;               /* só a borda, 2px */
  animation: girar-borda 1.4s linear infinite;
}
@property --ang { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
@keyframes girar-borda { to { --ang: 360deg; } }
```
- Truque `@property --ang`: anima um ângulo CUSTOM PROPERTY — impossível sem ela,
  é o que faz o conic-gradient girar de verdade (suportado em Chromium/Edge/modernos;
  fallback: borda estática verde, aceitável).
- Ativa somente quando `dragover` — é feedback de estado, não decoração.

### 3.3 `shimmer-2s` — brilho na barra de progresso

```css
.shimmer::after {
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.65) 50%, transparent);
  animation: shimmer-2s 1.6s infinite;
}
```
Percorre a barra a cada 1.6s — "trabalho fluindo" sem porcentagem falsa.

### 3.4 `float` — ícone da dropzone flutuando

```css
@keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
```
Idle convidativo no ícone de upload (6px é o teto — flutuar não é pular).

### 3.5 `pulse-suave` — pulso em badges "processando"

```css
.pulse-suave { animation: pulse-glow 2.2s ease-in-out infinite; }
@keyframes pulse-glow {
  0%,100% { box-shadow: 0 0 0 0 rgba(0,150,140,.28); }
  50%     { box-shadow: 0 0 0 6px rgba(0,150,140,0); }
}
```
Onda de 6px que expande e some — radar de "algo acontecendo aqui".

### 3.6 `cover-sheen` — brilho na faixa do dossiê

```css
.senior-cover-strip::after {
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.55) 50%, transparent);
  background-size: 220% 100%;
  animation: cover-sheen 7s ease-in-out infinite;
}
@keyframes cover-sheen { 0%,100% { background-position: 130% 0; } 50% { background-position: -30% 0; } }
```
Reflexo lento (7s) atravessando a faixa esmeralda do cabeçalho do dossiê — luxo discreto.

---

## 4. Transições de micro-interação (Tailwind/CSS)

Inventário dos `transition-*` e `group-hover` do `batch-detail-card.tsx` e cards de entrada:

| Elemento | Transição | Duração/easing | Gatilho |
|----------|-----------|----------------|---------|
| Linha da tabela (hover) | `bg` | 150ms default | `hover:bg-accent/50` |
| Botão copiar (aparece na linha) | `opacity` | 150ms | `group-hover:opacity-100` |
| Chips de filtro | `colors + shadow` | 200ms | `hover:` / estado ativo |
| Ícones de ação (dossiê) | `scale + color` | 150ms | `hover:scale-105` |
| Tabs do dossiê | `colors` | 200ms | troca de aba |
| Tooltip (Radix) | Radix interno | 100ms in / 50ms out | focus/hover |
| Dialog/Sheet (dossiê) | Radix + data-state | 200ms in / 150ms out | open/close |
| Scrollbar custom | `thumb` color | 150ms | hover |
| Link de página (histórico) | `underline offset` | 150ms | hover |

**Regra dos 3 tempos:** 150ms (micro: hover, fade de ícone) · 200ms (estado: chips, tabs) ·
molas para movimento de entrada/saída. Nada entre 300–500ms exceto Radix — se precisa de
mais de 250ms, não é micro-interação, é primitiva de movimento (use mola).

---

## 5. Acessibilidade — contrato de movimento reduzido (dupla camada)

### Camada 1 — CSS (`globals.css`)
```css
@media (prefers-reduced-motion: reduce) {
  .aurora-blob { animation: none !important; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
 Mata TODOS os keyframes CSS (aurora, shimmer, pulse, sheen, border girando).

### Camada 2 — Framer Motion (`MotionRoot`)
`MotionConfig reducedMotion="user"` transforma animações em troca instantânea de estado.

### O que NUNCA é animado (mesmo com movimento liberado)
- Texto de alerta material (BAIXADA/suspensa) — informação crítica entra dura.
- Badge de prioridade N/100 — dado comercial não pode "piscar".
- Resultados de exportação/download.

---

## 6. Regras de ouro (resumo executável)

1. **Mola ou nada** — entradas/interações sempre `SPRING`/`SPRING_SUAVE`; tween seco só em loop de clima (aurora).
2. **Blur ao entrar** — todo reveal usa `filter: blur(n) → 0` junto com opacity/y.
3. **`once: true` em viewports** — nada re-anima ao rolar de volta.
4. **Cascata ≤ 0.06s/item** e só em listas curtas.
5. **Tempos de micro-interação: 150/200ms** — nada de 300ms+ em hover/focus.
6. **Keyframes de clima em segundos-longos e dessincronizados** (46/58/64/72s).
7. **Reduced motion em DUAS camadas** (CSS global + MotionConfig) — testar com `System Settings > Motion`.
8. **GPU em tudo que se move** — `will-change: transform` + `translate3d` nos blobs; animar só `transform/opacity/filter` (nunca `top/left/width/height`).
9. **Estado crítico não anima** — alertas e dados comerciais entram já prontos.
10. **Uma assinatura por tela** — aurora no fundo é a única animação "sempre ligada"; todo o resto é resposta a gesto ou estado.
