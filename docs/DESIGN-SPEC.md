# SCOUT 360 — Design Spec Completa
### "Aurora Glass" · UI humanizada anti-slop + motor de pesquisa de dados

> **Documento de referência para portar/montar esta UI em outro ambiente.**
> Versão 1.0 · Projeto: Scout 360 — Enriquecimento de contas (CNPJ)
> Este documento é autocontido: tokens, regras, componentes, motion e a especificação do motor de inteligência. Nada aqui depende de "ver o código" — mas cada decisão aponta para onde implementar.

---

## 0. Diagnóstico de origem (o que motivou esta spec)

Problemas concretos reportados em revisão real da UI:

| # | Problema | Causa raiz | Correção definida nesta spec |
|---|----------|-----------|------------------------------|
| 1 | "Esse roxo no badge IA" | Token `--roxo: #844EC3` herdado do DS vazando em halos/badges de IA; aurora tinha blob roxo | **Roxo eliminado do produto** (§2.1): identidade IA agora é esmeralda profundo `#086B6B` + neon `#12F7D1`. Zero violeta em qualquer camada |
| 2 | "Dossiê pequeno" | `DialogContent max-w-2xl` (672px) para um documento de 11 seções | Dossiê em `max-w-3xl` (768px) desktop / tela cheia mobile (§4.4) |
| 3 | "Logo cortada" | PNG intrínseco 816×266 renderizado com width/height derivados errados (`next/image` inferindo aspect-ratio) | Declarar `width={816} height={266}` + `h-8 w-auto` — a imagem nunca é recortada, só escalada (§4.2) |
| 4 | "Texto demais" | Síntese de IA despejada como parágrafos longos em todas as seções | Regra anti-slop de conteúdo: **fato visual primeiro, frase curta depois, prosa como exceção** (§5) |
| 5 | "Botões copiar não funcionam" | `navigator.clipboard` só existe em contexto seguro (HTTPS); preview roda HTTP | `copyText()` com fallback `execCommand` — nunca feedback falso (§4.7) |
| 6 | "O QUE AINDA NÃO SABEMOS não deveria saber tão pouco" | Lacunas do dossiê (porte real, operação) ficavam sem tentativa de resolução | **Gap-chasing**: cada lacuna dispara busca específica (notícias, site, diretórios) antes de virar "não sabemos" (§6.4) |

**Princípio reitor:** *humanizar não é enfeitar — é respeitar a leitura humana.* Menos texto, mais estrutura visual, cada elemento dizendo por que existe.

---

## 1. Princípios de design (anti-slop, validados por pesquisa)

Pesquisa de referência: NN/g Glassmorphism (2024), AxessLab "Glass meets Accessibility" (2025), Clay Global (2025), UXPilot (2025), guias anti "AI slop" (avoid-ai-design, 925studios, Unpromptable), C-Sharpcorner/UserPilot micro-interactions (2025), Outcrowd B2B recognition (2026).

### 1.1 As 7 regras anti-slop

1. **Sem cor "padrão de IA".** Nada de violeta/índigo-gradiente, nada de `purple-500 → blue-500`. A paleta é a marca real (esmeralda Senior) + neutros quentes + um único acento funcional laranja para conversão. Roxo é **proibido em qualquer componente** (era o vazamento do badge "IA").
2. **Vidro só onde importa.** Glassmorphism não é "dar blur em tudo": NN/g — vidro em superfícies que flutuam sobre conteúdo (header sticky, modais, banners-chave). Tabelas e formulários densos ficam **opacos** para legibilidade.
3. **Texto opaco, sempre.** Todo texto vive em fundo com opacidade ≥ 74% e contraste AA (4.5:1) no pior cenário do fundo aurora. Texto nunca é translúcido, nunca sobre vidro sem tinta.
4. **Tipografia com identidade.** Public Sans (não Inter, não Roboto). Escala do DS fixa (`ds-display 36 → ds-caption 12`). Títulos com peso 700–800, corpo com line-height ≥ 1.45.
5. **Motion com física, não com linha do tempo.** Springs (stiffness 260 / damping 28), não easings sintéticos longos. Nada além de 400ms em feedback de UI. Toda animação comunica estado (§3).
6. **Um momento assinatura, não dez.** O fundo aurora em deriva é O momento. O resto é disciplinado.
7. **Humanizar = estrutura visual + voz humana.** Prosa longa é sinal de preguiça. Converter texto em: chips, listas-ícone, cartões fato→consequência, timeline. Quando tiver que existir texto, frases curtas e voz direta (§5).

### 1.2 Teste do "dono do negócio" (o gostômetro)

Antes de qualquer decisão visual: "o dono de uma agroindústria em Mato Grosso leria isso sem esforço, num celular, no sol?"
- Se precisa de jargão → reescreve.
- Se precisa de rolagem infinita para achar uma resposta → estrutura errada.
- Se parece template genérico de startup → não tem identidade → volta ao passo 1.

---

## 2. Design tokens (fonte da verdade)

### 2.1 Cor

```css
/* ===== Paleta oficial (base: Senior DS) ===== */
--verde-institucional: #00968C;  /* primária: ações, links, foco */
--verde-medio:         #00AF9B;  /* gradientes, hover-up */
--verde-claro:         #2AC4AA;  /* detalhes, dots */
--verde-escuro:        #086B6B;  /* TEXTO de ação sobre claro (AA) */
--esmeralda:           #0B9E8E;  /* transição de aurora */
--verde-neon:          #12F7D1;  /* SÓ em glow/aviso/progresso — nunca texto */
--laranja:             #EF8833;  /* CTA de conversão (único!) */
--amarelo:             #FFC511;  /* atenção/revisão */
--azul-escuro:         #33466C;  /* TEXTO PRINCIPAL */
--cinza-600:           #77736E;  /* texto secundário */
--cinza-300:           #D4D4D4;  /* bordas */
--cinza-100:           #F2F2F2;  /* superfície neutra */
--erro:                #8C2F39;  /* situacional destrutivo (fundo #FDECEC) */
--roxo:                ❌ ELIMINADO — identidade IA = #086B6B + #12F7D1
```

**Semântica de status** (mesma linguagem em chip, badge e borda):

| Estado | Fundo | Texto | Uso |
|---|---|---|---|
| Confirmado/FORTE | `#00968C1A` | `#086B6B` | vínculo forte, matriz confirmada |
| Moderado | `#FFC51126` | `#8a6d00` | binding moderado, revisão |
| Fraco/neutro | `#F2F2F2` | `#77736E` | menção de terceiros |
| Inválido | `#FDECEC` | `#8C2F39` | descartado, erro |
| IA | gradiente esmeralda + dot `#00968C` | `#086B6B` | qualquer coisa "feita por IA" |

### 2.2 Vidro (3 camadas + chip)

```css
--glass-blur: 18px;          /* 12px no mobile (backdrop-filter é caro) */
--glass-blur-bar: 22px;      /* 14px no mobile */

.glass        /* base: bg linear 74%→58% branco, blur 18, borda rgba(255,255,255,.7) */
.glass-strong /* header/dialog: 88%→76% branco, blur 22 */
.glass-verde  /* banner de resultado: branco→mint→esmeralda 50%, glow #12F7D1 12% */
.glass-chip   /* chips/tags: blur 10, borda branca 80% */
.glass-reflex /* linha de brilho 1px no topo (::before) */
```

**Regras de contraste do vidro** (pesquisa NN/g + AxessLab):
- Texto principal (`#33466C`) sobre `.glass` = ok; sobre `.glass-verde` = ok (fundo ≥ 66% opaco).
- `.glass-chip` nunca recebe texto menor que 12px/500.
- Painéis Radix (select/popover/dropdown) herdam vidro via `[data-radix-popper-content-wrapper] > *`.

### 2.3 Fundo aurora (assinatura visual)

```css
.aurora-field  /* fixed inset-0 z--1: base linear #F5FAF9→#EAF5F2→#F0F7F5
                 + 2 radiais fixas (neon topo-direita 20%, verde base inferior-esquerda 14%) */
.aurora-blob-1/2/3  /* 680–780px, blur 64px, verdes;
                       drift 46–64s ease-in-out alternate, transform-only (GPU) */
.aurora-grain       /* feTurbulence 3.5% overlay — mata o banding dos degradês */
```

- **Proibido:** blob roxo (o antigo `rgba(132,78,195,.10)` saiu). Aurora é monocromática esmeralda.
- `prefers-reduced-motion: reduce` → blobs param, toda animação vira 0.01ms.
- O fundo nunca compete com o conteúdo: blobs ficam nos cantos (topo-esq., topo-dir., base).

### 2.4 Tipografia (Public Sans, única família)

| Token | Tamanho/lh | Peso | Uso |
|---|---|---|---|
| `ds-display` | 36/42 | 700 | H1 hero |
| `ds-headline` | 24/28 | 700 | título de card principal |
| `ds-title` | 22/28 | 700 | título de seção |
| `ds-title-md` | 16/25 | 700 | subtítulo, nome de empresa |
| `ds-lead` | 16/24 | 400 | parágrafo de entrada |
| `ds-body` | 14/20 | 400 | corpo |
| `ds-caption` | 12/16 | 500 | metadados, rodapés |

### 2.5 Formas, sombra, raio

```css
--radius: 14px;                 /* base generosa (linguagem de vidro) */
chips/avatares: rounded-full;
botões: 11–12px; inputs: 10px;
--glass-shadow: 0 2px 6px rgba(8,107,107,.05), 0 14px 40px rgba(8,107,107,.09),
                0 1px 0 rgba(255,255,255,.85) inset;   /* luz vindo de cima */
--glow-verde:   0 8px 24px rgba(0,150,140,.35), 0 2px 8px rgba(0,150,140,.25);
```

---

## 3. Motion system ("fora da curva", com física)

Biblioteca: **Framer Motion** com `MotionConfig reducedMotion="user"` (respeita o SO).

### 3.1 Tokens de movimento

```ts
const SPRING = { stiffness: 260, damping: 28 };   // entrada/hover de cards
const SPRING_SOFT = { stiffness: 180, damping: 24 }; // números que contam
// feedback de UI: 200–400ms (pesquisa C-Sharpcorner/UserPilot 2025)
// stagger: 60ms entre irmãos (cascata de entrada)
```

### 3.2 Primitivas (implementadas em `components/motion/primitives.tsx`)

| Primitiva | O que faz | Onde usar |
|---|---|---|
| `FadeUp` | entra subindo 12px + fade | qualquer bloco |
| `SectionReveal` | `whileInView` uma vez | seções longas (dossiê) |
| `Stagger/StaggerItem` | cascata 60ms | hero, listas de chips |
| `SpringCard` | hover −3px / tap 0.99 | cards clicáveis |
| `AnimatedNumber` | contador com mola, formatado pt-BR | métricas (cobertura %, contagens) |
| `ScaleIn` | pop 0.94→1 com mola | modais, toasts |
| `AuroraBackground` | 4 blobs + grain, z −1 | fundo global |

### 3.3 Regras de ouro

1. **Motion comunica, nunca decora.** Progresso tem shimmer; sucesso tem check que "assenta"; revisão tem pulse âmbar.
2. **Entrada de página:** hero em cascata (chip → título → lead). Cards de conteúdo: `SectionReveal` 1x.
3. **Hover:** `translateY(-2px)` + sombra sobe (300ms cubic-bezier(0.22,1,0.36,1)). Linha de tabela: fundo `#00968C08` + barra lateral inset.
4. **Estados de espera:** spinner só em <1s; >1s usar barra com shimmer; >10s usar texto narrado ("lendo o site oficial…", "sintetizando dossiê…").
5. **Proibido:** parallax em conteúdo, rotação 3D, bounce exagerado, animação > 400ms em feedback.

---

## 4. Layout e componentes

### 4.1 Estrutura da página

```
┌─ senior-cover-strip (5px, degradê oficial + sheen 7s)
├─ header glass-strong sticky (h-16): logo + divisor + produto | "Como funciona" (popover glass)
├─ main max-w-[1140px]:
│   ├─ hero: chip de vidro com ping esmeralda → H1 degradê → lead (cascata)
│   ├─ card upload (dominante)
│   ├─ preview / lote ativo / histórico
└─ footer glass-strong mt-auto (STICKY via min-h-screen flex flex-col)
```

**Footer regra inegociável:** `root = min-h-screen flex flex-col`, footer com `mt-auto` + `pb-[max(16px,env(safe-area-inset-bottom))]`. Página curta → footer colado embaixo; página longa → empurrado naturalmente.

### 4.2 Header e logo (fix do "logo cortada")

```tsx
<Image
  src="/senior-logo-verde.png"
  alt="Senior"
  width={816} height={266}     /* dimensões INTRÍNSECAS reais — obrigatório */
  priority
  className="h-8 w-auto sm:h-9" /* só altura; largura deriva correta */
/>
```
- **Nunca** declarar width/height menores que o intrínseco (o `next/image` gera aspect-ratio errado e desenha achatado/cortado).
- Chips de logo do portfólio (ERP/HCM/TMS…): PNGs 186×186 quadrados → `width={186} height={186} className="h-6 w-auto object-contain"` dentro de container `h-9 w-12` — a largura auto evita o bug do chip.

### 4.3 Cards de entrada (upload/colar)

- Tabs "Enviar planilha / Colar pistas" com `TabsTrigger` ativo branco sobre trilho `#F2F2F2`.
- Dropzone: borda tracejada `#B8CFCB`; no drag → **borda cônica girando** (`border-girando`, conic-gradient esmeralda→neon, `@property --ang`) + glow `0 0 40px rgba(18,247,209,.25)` + ícone flutuando (`float 3.4s`).
- Detecção ao vivo (sem IA, determinística): chips contando CNPJs válidos/inválidos, domínios, e-mails, sites, nomes — `LiveChip` colorido por semântica (§2.1), preview das linhas em mono-scroll de 96px.
- Toggle "Leitura inteligente" em glass-chip com halo esmeralda — **sem roxo**; switch `data-[state=checked]:bg-[#00968C]`.

### 4.4 Dossiê (o produto dentro do produto) — correções de tamanho e densidade

**Tamanho (fix "pequeno"):**
```tsx
<DialogContent className="glass-strong max-h-[90vh] w-full max-w-3xl xl:max-w-4xl
                          overflow-y-auto rounded-[16px] ...">
  /* mobile: inset-x-2 (tela cheia útil); desktop: 768–896px */
```

**Densidade — o dossiê é um RELATÓRIO VISUAL, não um ensaio:**

1. **Cabeçalho colado (sticky header dentro do diálogo):** avatar-tipográfico esmeralda, razão social `ds-title`, linha de metadados em chips (CNPJ · cidade/UF · situação · Matriz/Filial).
2. **Trilho numerado vertical** (11 seções) com linha condutora — cada seção = título-CAPS pequeno + conteúdo visual:
   - `QUEM É` → 1 frase (máx. 2 linhas) + perfil em itálico curto.
   - `O QUE FAZ` → **chips de CNAE** (cada CNAE vira chip, não lista).
   - `COMO OPERA` → bullets-ícone (✓), máx. 4, máx. 12 palavras cada.
   - `ESCALA` → cartões-fato com número animado (capital social formatado pt-BR, porte oficial, nº de CNAEs, fundação).
   - `PESSOAS` → chips de sócios com qualificação + "desde ano" (teia §6.3).
   - `TECNOLOGIA`, `MUDANÇAS` → bullet curto ou "sem evidência pública" honesto.
   - `O QUE ISSO PODE SIGNIFICAR` → **cartões FATO → CONSEQ. → VALIDAR** (3 linhas, seta visual entre elas).
   - `POSSÍVEL ADERÊNCIA` → card com logo do produto + processo + hipótese; rodapé "hipótese até validação — nunca promessa".
   - `O QUE AINDA NÃO SABEMOS` → cada item com **status de tentativa**: se o gap-chasing (§6.4) achou algo, mostra o achado + fonte; se não, mostra o que FOI buscado e não achou ("buscamos em notícias e no site — nada público").
   - `PERGUNTAS PARA A CONVERSA` → lista numerada (máx. 4).
   - `PRÓXIMO MOVIMENTO` → banner esmeralda de vidro.
3. **Notícias por nome** fora do trilho: cards com fonte, data relativa ("há 3 meses"), link — Google News RSS (§6.4).
4. **Evidências** (fonte/URL/status) em accordion técnico — camada secundária, expande e **toda URL é clicável e copiável**.
5. **Rastro da consulta** (auditoria de IA): modelo solicitado/efetivo/fallback, nº de páginas rastreadas — chip técnico discreto.

**Regra de cópia:** todo bloco de leitura tem "copiar" que produz **markdown limpo** (títulos, bullets, links) — colável em e-mail/CRM. O dossiê é visual na tela e textual na cópia.

### 4.5 Tabela de resultados

- Header sticky glass; zebra `white/40`; hover com barra inset esmeralda.
- Coluna Confiança = chip semântico (§2.1); coluna Scout = estado narrado ("pesquisando a conta…", "sintetizando dossiê…") com pulse suave.
- Métricas do lote em vidro com `AnimatedNumber` (contagens e % contam na tela).
- Banner DONE: `glass-verde` + halo neon, CTA primário "Visualizar resultados" (verde) + "Exportar ▾" secundário.
- Expansão inline da linha (chevron) mostra identidade + candidatos + descartes auditados.

### 4.6 Painéis Radix e toasts

- Selects/popovers/dropdowns: vidro global via `[data-radix-popper-content-wrapper] > *` (blur 22, borda branca 85%, radius 14, sombra de vidro).
- Toast: `glass-strong`; variante destructive sólida vermelha DS (erro é o único lugar com cor chapada).

### 4.7 Cópia (fix "não funciona de verdade")

```ts
// src/lib/clipboard.ts
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* segue */ }
  try { // fallback HTTP/legado: textarea escondida + execCommand
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove(); return ok;
  } catch { return false; }
}
```
- **Feedback só quando copiou de verdade** (boolean → estado "✓ Copiado" 2s + toast). Nunca toast de sucesso sem certeza.
- Aplicado a: link do dossiê (deep link `?lote=…&empresa=N`), leitura completa (markdown), CNPJs, linha da tabela.

### 4.8 Acessibilidade (inegociável)

- Foco visível esmeralda global (`:focus-visible outline 2px #00968C offset 2`).
- Seleção de texto esmeralda (`::selection`).
- `aria-live="polite"` na detecção ao vivo; `role="status"` nos estados de espera; `aria-label` em todo botão-ícone.
- Contraste AA validado no pior fundo (texto nunca menor que 12px em vidro).
- `prefers-reduced-motion` desliga aurora/shimmer/floats.
- Touch targets ≥ 44px no mobile; área de scroll com `overscroll-contain`.

---

## 5. Voz e conteúdo (a camada "humana")

### 5.1 Regras

1. **Frase curta.** Se passou de 25 palavras, virou dois períodos.
2. **Fato antes de adjetivo.** "Capital social de R$ 223,8 milhões" > "empresa robusta".
3. **Honestidade como design.** "Não encontramos" é um estado visual limpo com o que foi buscado — nunca um sumiço.
4. **Hipótese marcada como hipótese.** Todo palpite vem com o ícone `?` e o rodapé "validar com quem conhece o processo".
5. **Sem emoji, sem grito, sem "🚀✨".** O carinho está no espaçamento, não em enfeite.
6. **Números em pt-BR:** `R$ 223.832.551,00` → exibir `R$ 223,8 mi`; datas relativas ("há 2 meses"); contagens com `AnimatedNumber`.

### 5.2 A conversão prosa → visual (o anti "texto demais")

| Antes (prosa) | Depois (visual) |
|---|---|
| "A empresa atua no comércio atacadista de sementes e também cultiva milho, soja e algodão…" | Chips: ` 🌾 atacado de sementes` ` 🌽 cultivo de milho` ` 🫘 cultivo de soja` |
| "O capital social declarado é de R$ 223.832.551,00 o que sugere…" | Cartão: **R$ 223,8 mi** · capital social + linha de consequência |
| "Foram encontradas notícias sobre uma operação de CRA em 2025…" | Card de notícia: fonte, "há 4 meses", título linkado |
| "Não há evidência do porte real além do capital social." | Item com trilha: `buscado: notícias + site · achado: CRA de R$ X (fonte)` ou `sem registro público` |

**Orçamento de texto por seção do dossiê:** máx. 2 linhas de prosa; o resto é chip, bullet-ícone ou cartão. Prosa longa só no texto de cópia (markdown), nunca na tela.

---

## 6. Motor de dados — o que a UI tem o direito de mostrar

> Esta é a metade "inteligência" da spec: como o produto passa a **resolver** o que hoje é lacuna. Técnicas abaixo foram **validadas com testes reais** (Google News RSS e OpenCNPJ responderam com dados de verdade — exemplos citados).

### 6.1 Fontes (o estoque completo)

| Fonte | O que dá | Custo/limite | Status no projeto |
|---|---|---|---|
| **BrasilAPI** `api/cnpj/v1` | cadastro oficial, situação | grátis, sem token | ✅ em uso (validação de registro) |
| **OpenCNPJ** `api.opencnpj.org/{cnpj}` | cadastro + **QSA completo** + `porte_empresa` + `capital_social` + CNAEs + e-mail + telefones + Simples/MEI | grátis, sem token | ✅ em uso — **QSA subaproveitado** |
| **ReceitaWS** | fallback cadastro | 3/min | ✅ fallback |
| **Google News RSS** `news.google.com/rss/search?q="NOME"&hl=pt-BR&gl=BR&ceid=BR:pt-419` | **notícias por nome, por CNPJ, por sócio** — com fonte e data | grátis, XML | 🔶 parcial (buscas genéricas) → **dedicar feed** |
| **web_search (SDK)** | site oficial, diretórios, menções | 10/min (rate-limited) | ✅ em uso |
| **page_reader (SDK)** | ler home/sobre/produtos/contato | 10/min | ✅ em uso |
| Diretórios públicos (cnpj.biz, econodata, serasa-experian free) | filiais, grupo, CNPJs por nome | via web_search/page_reader | 🔶 só como BINDING |

### 6.2 Resolução de identidade (regras consolidadas)

1. **Vínculo ≠ registro.** BrasilAPI valida que o CNPJ existe; só BINDING prova que é a empresa da pista. Gate: 1 evidência FORTE **ou** 2 MODERADAS independentes.
2. **Publisher nunca é candidato** (marketplace/social/classificados/notícia têm CNPJ do *host*, não da entidade mencionada).
3. **Ordem de força:** DOMAIN_REGISTRANT confirmado = MUITO_FORTE → OFFICIAL_SITE/LEGAL_DISCLOSURE = FORTE → GOVERNMENT_RECORD (nome+UF) = FORTE → SAME_PHONE/EMAIL/DIRECTORY = MODERADA → coocorrência = FRACA (só revisão humana).
4. **UNRESOLVED honesto > candidato contaminado.** Descartes ficam auditáveis ("7 CNPJ/fonte descartados por falta de vínculo").

### 6.3 Teia societária — de lista para GRAFO (novo)

Hoje o QSA é exibido como lista de nomes. A técnica validada transforma cada sócio-PJ em **nó navegável**:

```
Empresa-alvo (ATTO AGRICOLA LTDA, CNPJ 09.509.017/0001-43)
 └─ QSA (OpenCNPJ) → sócio PJ "ATTO PARTICIPACOES S.A." cnpj_cpf_socio="10472205" (raiz, 8 dígitos)
      └─ CNPJ da holding = raiz + "0001" + DV mod-11  → 10.472.205/0001-23  ✅ EXISTE
           └─ consulta OpenCNPJ da holding → capital R$ 261.785.745,00, Matriz, Ativa
                └─ QSA da holding → avós (outra camada do grafo, profundidade máx. 2)
```

**Detalhes de implementação validados:**
- `cnpj_cpf_socio` para PJ = raiz de 8 dígitos (RFB). Matriz = `raiz + "0001" + DV`.
- **DV mod-11 com pesos que dão wrap:** `5,4,3,2,9,8,7,6,5,4,3,2` (DV1) e `6,5,4,3,2,9,8,7,6,5,4,3,2` (DV2). O projeto já tem isso pronto (`calcDvs`/`cnpjFromRoot` em `src/lib/cnpj.ts`) — **usar, não reescrever** (um protótipo sem wrap devolveu DV errado: raiz 10472205 → DV correto 23, não 52/83).
- Nem toda raiz tem matriz 0001: se a consulta falhar, tentar `0002…` (limitado a 3 ordens) e cair para web_search `"NOME DO SÓCIO" CNPJ` (diretórios acham: ex. jusbrasil → `10.472.205/0001-23`), sempre como **candidato com binding BUSINESS_DIRECTORY**, nunca como fato.
- Sócio-PF: CPF vem mascarado (`***770159**`) por LGPD → o nome do representante legal e o vínculo "Sócio-administrador desde {ano}" entram no dossiê; busca por nome de PF **não** é feita (privacidade).
- **Loop de segurança:** profundidade máx. 2 níveis; cache por CNPJ; rate-limit do OpenCNPJ respeitado (1 req/CNPJ, dedupe).

**Export/visual:** grafo de 3 colunas (avós → sócios → alvo → filiais se houver) com chips-nó clicáveis (abrem CNPJ no dossiê); CSV "Teia societária" passa a exportar **arestas** (`origem, destino, tipo_vínculo, desde`).

### 6.4 Google News RSS dedicado + gap-chasing (o fim do "não sabemos" preguiçoso)

**Feed dedicado por conta** (na pesquisa profunda, nível 2):
```
GET https://news.google.com/rss/search?q="{razao_social}"&hl=pt-BR&gl=BR&ceid=BR:pt-419
GET https://news.google.com/rss/search?q="{nome_fantasia}"&hl=pt-BR&gl=BR&ceid=BR:pt-419  (se diferente)
+ variante q="{nome}" after:{data-entrada-sociedade}  para notícias recentes
```
Validado: `%22ATTO+Agr%C3%ADcola%22` → 10 itens com título, fonte (VBSO Advogados, Canal Rural…), `pubDate`, link.
- **Encoding UTF-8 real** (`%C3%AD`), aspas para nome exato; UA de browser; parse XML (`<item><title|link|pubDate|source>`).
- Dedupe por link; filtro por relevância (título contém raiz do nome ou fantasia); máx. 4 por dossiê; guardados com data relativa.

**Gap-chasing** — cada item de `O QUE AINDA NÃO SABEMOS` vira **busca dirigida antes de ser admitido como lacuna**:

| Lacuna típica | Busca dirigida | Sinal que resolve |
|---|---|---|
| Porte real | news `"NOME" (CRA OR CCB OR debênture OR financiamento OR BNDES OR investimento)` | operações de crédito/securitização (ex.: CRA Atto — VBSO) |
| Porte real (2) | site oficial: páginas "sobre/unidades/frota/equipe" (já no research packet) | "X unidades", "mais de N colaboradores" |
| Porte oficial | `porte_empresa` (OpenCNPJ) + `opcao_simples/mei` | DEMais/ME/EPP + optante |
| Operação/escala | news `"NOME" (expansão OR nova unidade OR contratação)`; vagas (web_search `site:... vagas`) | expansão, nº de vagas |
| Tecnologia | site oficial/blog/jobs ("ERP", "sistema", tags de vagas) | stack declarada |
| Sociedade/mudanças | news + `data_entrada_sociedade` do QSA + `data_situacao_cadastral` | reestruturação datada |

**Regra do dossiê:** um "não sabemos" só aparece se o gap-chasing rodou e falhou — e aí exibe **o que foi buscado** ("buscamos em notícias, no site oficial e em operações de crédito — nada público"). Isso transforma a seção de fraqueza em prova de trabalho.

### 6.5 Porte real — tabela de evidência (o caso "capital social não basta")

| Sinal | Fonte | Força |
|---|---|---|
| `porte_empresa` + Simples/MEI | OpenCNPJ | OFICIAL (fraco p/ realidade) |
| `capital_social` | OpenCNPJ | declarado (não é porte) |
| Operações de crédito/CRA/CCB/Deb | **News RSS** | FORTE (exige recebíveis/escala) |
| "mais de N colaboradores/unidades/frota" no site | page_reader | FORTE |
| Vagas abertas (qtde) | web_search | MODERADA |
| Prêmios/certificações/case público | page_reader/news | MODERADA |

Síntese no dossiê: "Escala: capital R$ 223,8 mi (declarado) · porte oficial DEMais · **operação de CRA de 2025 indica recebíveis relevantes** (VBSO Advogados, há 4 meses)".

---

## 7. Arquitetura de implementação (para portar)

```
src/
├─ app/globals.css            ← §2 tokens + aurora + vidro + tipografia DS
├─ components/motion/primitives.tsx ← §3 (Framer Motion)
├─ components/cnpj/
│   ├─ senior.tsx             ← primitivas DS + microcopy centralizada
│   ├─ upload-card.tsx        ← §4.3
│   ├─ batch-detail-card.tsx  ← §4.4/4.5 (dossiê, tabela, copiar §4.7)
│   └─ preview/history-card   ← superfícies de vidro
├─ lib/
│   ├─ cnpj.ts                ← normalize/format/validate/cnpjFromRoot (§6.3)
│   ├─ clipboard.ts           ← §4.7
│   ├─ resolve/               ← §6.2 (binding.ts + index.ts)
│   └─ enrich/                ← §6 (research.ts packet, ai.ts evidências, engine.ts)
└─ mini-services/resolve-service ← ponte web_search/page_reader/LLM (bun, porta própria)
```

**Fases sugeridas de port:**
1. **F1 — Tokens e shell** (§2, §4.1–4.3): aurora, vidro, header/logo, footer sticky.
2. **F2 — Motion** (§3): primitivas + hero em cascata + AnimatedNumber.
3. **F3 — Dossiê visual** (§4.4, §5): trilho numerado, chips, cartões, diálogo 3xl/4xl, copiar §4.7.
4. **F4 — Teia + News** (§6.3–6.4): QSA→grafo, Google News RSS dedicado, gap-chasing.
5. **F5 — Acessibilidade e QA** (§4.8): contraste, reduced-motion, E2E nos fluxos (upload → processar → dossiê → copiar → exportar).

**Checklist de aceite (cada fase):**
- [ ] Zero violeta/índigo em qualquer superfície.
- [ ] Texto contraste AA sobre o pior fundo de vidro.
- [ ] Nenhum diálogo < 768px em desktop.
- [ ] Nenhum bloco de prosa > 2 linhas na tela (cópia pode).
- [ ] Copiar dá feedback real (boolean), funciona em HTTP e HTTPS.
- [ ] Logo renderiza sem recorte em h-8 e h-9.
- [ ] Footer gruda embaixo em página curta e é empurrado em página longa.
- [ ] `prefers-reduced-motion` mata toda animação.
- [ ] Cada "não sabemos" lista o que foi buscado.
- [ ] Teia exporta arestas e abre CNPJ de holding clicável.

---

## 8. Apêndice — microcopy de referência (tom)

| Situação | Texto |
|---|---|
| Estado vazio de leitura | "Ainda não lemos esta conta. Uma leitura leva cerca de um minuto." |
| Pesquisa profunda em andamento | "Lendo o site oficial e fontes públicas — o dossiê sai daqui a pouco." |
| Descartes de candidato | "{N} CNPJ/fonte descartados por falta de vínculo com a pista." |
| Gap resolvido | "Escala estimada por evidência pública: {achado} — {fonte}." |
| Gap honesto | "Buscamos em {fontes}. Nada público sobre isso." |
| Copiar OK | "Link copiado — abre direto no dossiê desta conta." |
| Aviso permanente | "Consultas em fontes públicas oficiais · a leitura com IA gera hipóteses para validar — nunca conclusões." |
