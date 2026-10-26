# SCOUT 360 — SPEC DE CONTINUAÇÃO (Entrega 5 → Encerramento)
### Documento de retomada — use este spec em um chat novo para continuar o trabalho

> **Como retomar:** leia este arquivo inteiro + `worklog.md` (seções finais) antes de escrever código.
> O trabalho está COMMITADO localmente (branch atual, commits `e97834f` → `689e01a`).
> Versão atual: **0.10.22** (package.json). A Entrega 5 em andamento será **0.10.23**.

---

## 0. MISSÃO E CONTEXTO (resumo de uma tela)

SCOUT 360 é uma estação de trabalho de inteligência comercial (Next.js 16 + App Router +
TypeScript + Tailwind 4 + shadcn/ui + Prisma/SQLite). O operador sobe uma planilha de pistas
(CNPJ ou nome), o motor resolve identidade com vínculo auditável (ENTITY_BINDING), enriquece
por fontes públicas, e entrega ficha por empresa + exportações (CSV/Excel/PDF duplo nível).

Série atual "estação de trabalho comercial" (6 entregas acordadas):

| Entrega | Escopo | Estado |
|---|---|---|
| Fase Zero | governança, plural natural, mobile 390px, PDF sem título órfão | ✅ v0.10.18 |
| 1 | (dossiê/linguagem — base anterior) | ✅ v0.10.17 |
| 2 | Navegação redimensionável Lista/Dividido/Foco (react-resizable-panels **v3**) | ✅ v0.10.19 |
| 3 | Tabela personalizável + filtros rápidos + grandes lotes (10k probe OK) | ✅ v0.10.20 |
| — | Navegação interna da ficha por seções | ✅ v0.10.21 |
| 4 | PDF executivo + completo do mesmo motor (`nivel=executivo\|completo`) | ✅ v0.10.22 |
| **5** | **Inteligência: mapa de relações (SVG leve), leitura de relações, próximo movimento, testes adversariais de identidade** | 🔨 **EM ANDAMENTO — ver §2/§3** |
| 6 | Comparar empresas (opcional) — SÓ se gates da 5 passarem | ⏳ §5 |
| Encerramento | ZIP + SHA-256 + manifesto + verificação de recuperação + upload | ⏳ §6 |

---

## 1. LINHAS VERMELHAS (contratos invioláveis — o novo chat PRECISA respeitar)

1. **Não reconstruir o app.** Reusar a arquitetura existente. Nada de reescrever motor, exportações ou mesa.
2. **`react-resizable-panels` travado na v3** (3.0.3 instalada). PROIBIDO atualizar para v4.
3. **Sem TanStack Table** na mesa — decisão sancionada pelo contrato (não adotar biblioteca só para adotar).
4. **Linguagem:** zero plural entre parênteses ("lote(s)", "empresa(s)") — usar `plural()` de `@/lib/linguagem`. Zero nome de provedor e zero código HTTP em texto de interface/PDF. Teste estático `test-v01018-fase-zero.ts` guarda isso.
5. **"Grupo econômico" só existe para NEGAR a conclusão** — sobreposição de quadro NÃO caracteriza grupo (`AVISO_GRUPO_ECONOMICO` em `src/lib/inteligencia.ts`). Nunca inferir decisores: papel de administração é registro, não leitura de poder (`AVISO_ADMINISTRACAO`).
6. **PDF:** sem IA, sem consulta automática. Só fatos já persistidos.
7. **Evidência citável ou nada** — leitura nova só apresenta o que tem fonte persistida; "não sabemos" explícito vale mais que inferência.
8. **Export = UI** — o que se exporta é exatamente o que se vê (garantia formal do produto).
9. **Zero chamadas de IA nesta rodada** — a Entrega 5 é determinística (cache local + cálculo).
10. **Paleta institucional esmeralda** `#086B6B` / `#00968C` / `#33466C` / `#B8860B`; proibido indigo/roxo.
11. **Dev server porta 3000** (`bun run dev` em background); NUNCA `bun run build`; lint com `bun run lint`.
12. **Nenhuma consulta pública real em massa**; provas visuais com dados sintéticos via API/db.
13. **Evidências** em `evidencias/round-v0.10.23/`; **worklog** `/home/z/my-project/worklog.md` (append com template `---/Task ID/Agent/Task/Work Log/Stage Summary`).

---

## 2. INVENTÁRIO DO WIP DA ENTREGA 5 (já commitado em `689e01a` — NÃO reescrever)

| Arquivo | Conteúdo | Estado |
|---|---|---|
| `src/lib/inteligencia.ts` (512 linhas) | **Biblioteca nova.** Tipos `TipoRelacao` (6: `SOCIO_PESSOA_FISICA`, `SOCIO_PESSOA_JURIDICA`, `ADMINISTRADOR`, `ESTABELECIMENTO_MESMA_PJ`, `EMPRESA_COM_PARTICIPANTE_COMPARTILHADO`, `RELACAO_NAO_CONFIRMADA`); `lerRelacoes(view): LeituraRelacoes` (grupos + resumo + total, teto 6 nomes/grupo); `AVISO_GRUPO_ECONOMICO`, `AVISO_ADMINISTRACAO`, `qualificaAdministracao()`; grafo: `NoGrafo`/`ArestaGrafoTipo` (`participacao`,`quadro`,`mesma-empresa`,`compartilhado`), tetos `GRAFO_TETO_PARTICIPANTES=8`, `GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE=2`, `construirGrafoRelacoes(view, quadros)`, `grafoTemValor(g)` (false se só estrela raiz→participantes = decoração, não renderiza); `montarProximoMovimento(r, triagem): ProximoMovimento` com 4 seções `sabemos/validar/naoEncontramos/investigar` (determinístico, zero rede, zero IA) | ✅ escrito |
| `src/components/cnpj/grafo-relacoes.tsx` (268 linhas) | `GrafoRelacoesCard({ view, quadros })` — SVG determinístico (sem lib de grafos, sem medição de texto), níveis 0/1/2, legenda, proveniência (`grafo-proveniencia`), role="img" + aria-label + `<title>`, testIds `grafo-relacoes-toggle` / `grafo-relacoes` / `grafo-relacoes-svg`; retorna `null` quando `grafoTemValor=false` | ✅ escrito |
| `src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/quadros/route.ts` | **GET** — LEITURA PURA do cache (zero rede/IA/consulta): devolve `{ ok, quadros: Record<string,QuadroView>, avisos }` de participantes JÁ expandidos por comando e ainda válidos. Criar ligação nova continua sendo o POST `/expansao` ("Investigar conexão") | ✅ escrito |
| `src/lib/relations/service.ts` (+63 linhas) | `quadrosEmCacheDaLinha(batchId, rowNumber)` — filtra `validoAte > agora`, cache ilegível não vira erro, aviso honesto quando há conexões ainda não expandidas | ✅ escrito |
| `scripts/tmp-ver-quadros.ts` | script temporário de inspeção — apagar no fim da rodada | 🧹 limpar |

**O QUE FALTA:** a ficha ainda NÃO usa nada disso (`GrafoRelacoesCard` não é referenciado em
`batch-detail-card.tsx`; `lerRelacoes` e `montarProximoMovimento` não têm consumidor de UI;
nenhum teste novo; sem bump de versão).

---

## 3. PASSOS RESTANTES DA ENTREGA 5 (executar nesta ordem)

### 3.1 Ligar o mapa de relações na ficha (`batch-detail-card.tsx`)
Ponto de encaixe: componente **`RelacoesSocietariasPanel`** (começa ~linha 2913; já mantém em
estado `view: RelacoesView | null` e `quadros: Record<string, QuadroView>`; hoje `quadros` só
preenche via POST `/expansao`).

1. **Hidratar quadros do cache sem disparar consulta:** quando a ficha de relações abrir/`view`
   existir pela primeira vez, fazer `GET /api/imports/{batchId}/rows/{rowNumber}/relacoes-societarias/quadros`
   e `setQuadros` com a resposta (merge, nunca sobrescrever estado de expansão feita nesta sessão).
   Falha silenciosa → mapa simplesmente não mostra nível 2 (leitura pura, zero erro na cara).
2. **Renderizar** `<GrafoRelacoesCard view={view} quadros={quadros} />` dentro do painel de
   relações, DEPOIS da lista de participantes e ANTES das notas de rodapé. O componente já é
   auto-anulável (experimento controlado): se só existe a estrela raiz→participantes, nada aparece.
3. Após "Investigar conexão" retornar, `quadros` já é atualizado pelo código existente → o mapa
   se redesenha sozinho. Não duplicar chamadas.
4. **Não** colocar o mapa em Sheet/telas estreitas diferente — o SVG já tem overflow-x com
   `min-w-[640px]`; conferir 390px sem scroll horizontal da PÁGINA (o container rola).

### 3.2 Leitura de relações (os tipos de relação)
No mesmo `RelacoesSocietariasPanel`, quando `view` existe: usar `lerRelacoes(view)` para
renderizar um bloco **"O que os quadros públicos dizem"** ACIMA da lista técnica:
- Um parágrafo-resumo (`leitura.resumo`) + grupos como lista (`rotulo` em negrito, `descricao`
  discreta embaixo, nomes em chips/texto corrido respeitando `TETO_NOMES_GRUPO` e o total real).
- Sempre exibir `AVISO_GRUPO_ECONOMICO` quando o grupo `EMPRESA_COM_PARTICIPANTE_COMPARTILHADO`
  vier populado, e `AVISO_ADMINISTRACAO` quando vier `ADMINISTRADOR` (frases prontas na lib —
  não parafrasear).
- Grupo vazio → não renderiza o grupo (sem seções vazias).
- `data-testid="relacoes-leitura"` no bloco.

### 3.3 Próximo movimento (leitura comercial estruturada)
`montarProximoMovimento(r, triagem)` já devolve 4 seções com títulos/descrições/itens e `nota`.

1. Renderizar como seção da ficha — sugerido: bloco dentro de **"O que falta descobrir"**
   (seção `n: 5` da navegação interna, ~linha 3501 em `batch-detail-card.tsx`) OU seção própria
   logo após a triagem; escolher UMA e manter a barra de chips coerente (se virar seção própria,
   atualizar a lista de seções e os testes que contam seções).
2. A ficha já carrega a triagem para a seção de triagem — reutilizar o mesmo valor; se a triagem
   ainda não existir, chamar com `null` (a lib lida com isso).
3. Seções sem itens → não renderizar. Itens são frases prontas da lib; sem reescrita.
4. `data-testid="proximo-movimento"`; cada seção com `data-testid={`movimento-${id}`}`.
5. Nota de rodapé (`nota`) renderizada discreta — a leitura é determinística e não consulta nada.

### 3.4 Os 8 testes adversariais de identidade → `scripts/test-v01023-inteligencia.ts`
Suíte nova (mesmo padrão das demais: bun + asserts, dados sintéticos, apaga o que cria).
Cada item precisa de PASS explícito com prova (valor esperado vs obtido):

| # | Caso adversarial | Esperado |
|---|---|---|
| 1 | **Homônimo em município distinto** — pista resolve para registro de outra cidade com razão social idêntica | Leitura/mapa nunca apresentam participantes como se fosse a empresa pretendida; identidade fica em `LOCALIZADO` com divergência ALTA na seção `validar` do Próximo Movimento |
| 2 | **CNPJ de dono de página** — tentar enfiar como participante um CNPJ `PAGE_OWNER_ONLY` | Barreda pelo binding existente; nenhum nó de grafo nasce de menção de terceiros (grafo usa só quadros públicos persistidos) |
| 3 | **Mesma PJ, estabelecimentos distintos** — participante presente no quadro de matriz E filial da mesma raiz | UMA aresta `mesma-empresa` + contorno tracejado "também na mesma empresa"; NUNCA empresa distinta; nunca "grupo" |
| 4 | **Participante compartilhado entre duas linhas do lote** | Grupo `EMPRESA_COM_PARTICIPANTE_COMPARTILHADO` + `AVISO_GRUPO_ECONOMICO` exibido; texto não diz "controla/pertence ao grupo" |
| 5 | **Tipo de participante não confirmado** — fonte entrega vínculo sem identificador de tipo | Vai para `RELACAO_NAO_CONFIRMADA` com descrição honesta; NUNCA renderizado como "Sócio PF/PJ" |
| 6 | **Cache expirado** — quadro com `validoAte` no passado | `quadrosEmCacheDaLinha` NÃO devolve; grafo fica sem nível 2; painel aponta o comando "Investigar conexão" |
| 7 | **Tetos do grafo** — participante em 3+ empresas e/ou 9+ participantes | Mapa corta nos tetos `GRAFO_TETO_*` declarados; contagens reais seguem na lista; nenhuma empresa inventada |
| 8 | **Export = UI intocado** — leituras novas são só leitura | CSV/Excel/auditoria byte-idênticos antes/depois (comparar export de um lote sintético pré/pós-wiring); PDF desta rodada NÃO ganha as leituras novas (sem IA, sem consulta; entrar no PDF seria outra decisão de contrato) |

### 3.5 Fechamento da Entrega 5
- `bun run lint` limpo.
- Regressões verdes (ordem): `test-v01016-experiencia-pdf` 71/71 · `test-v01017-finalizacao` 150/150 · `test-v01018-fase-zero` 29/29 · `test-v01022-pdf-niveis` 22/22 · nova `test-v01023-inteligencia` 8/8+.
- Provas visuais `evidencias/round-v0.10.23/`: ficha com mapa (desktop 1440 + 390px), leitura de relações, próximo movimento, caso com mapa anulado (sem valor), captura do estado sem nível 2.
- Bump **0.10.23** no `package.json` + `docs/CHANGELOG.md` (entrada nova no topo) + `LEIA-ME.md` se contagem de versão aparecer lá + `docs/API-SPEC.md` (documentar o GET `/relacoes-societarias/quadros`).
- Apagar `scripts/tmp-ver-quadros.ts`.
- Commit local com mensagem descritiva (padrão das anteriores).
- **Gate da Entrega 5:** tudo acima verde. Só então decidir a Entrega 6.

---

## 4. DECISÃO SOBRE O MAPA (experimento controlado — como reportar)
O contrato manda: se o mapa for só decoração, ele não existe. O critério JÁ está no código
(`grafoTemValor = existe aresta != participacao`). No relatório final, registrar honestamente:
- Em quantos casos reais/sintéticos o mapa apareceu;
- Se apareceu 0 vezes na base real → registrar "experimento não validado por falta de dados" e
  NÃO forçar aparição (não fabricar dados para justificar o gráfico).

---

## 5. ENTREGA 6 — Comparar empresas (OPCIONAL, só com gate verde)
Escopo: selecionar 2+ empresas da mesa → leitura comparativa lado a lado (identidade, porte,
relações, lacunas). Regras: determinística, sem IA, sem consulta nova (só dados já persistidos),
com os mesmos avisos de grupo econômico. Se o gate da 5 não passar OU o tempo estourar,
registrar "não executada — critério" e pular direto para o encerramento (§6). A Entrega 6 NUNCA
bloqueia o checkpoint final.

---

## 6. CHECKPOINT FINAL (obrigatório, independente da Entrega 6)
1. `bash scripts/build-zip.sh` → ZIP canônico em `dist/Senior-Scout-360-kit-dev.zip`
   (script já existente; sanitização dura: sem `db/`, sem segredos, sem `worklog.md`).
2. `sha256sum` do ZIP → registrar no relatório.
3. `unzip -t` OK + verificação de recuperação: `scripts/probe-reinicio-recuperacao.sh`
   (restart do dev server + banco volta coerente).
4. **MANIFESTO do kit** (atualizar o que o build-zip já embute / `evidencias-uso/MANIFESTO.md`):
   versão, SHA-256, conteúdo, instruções de retomada.
5. **UPLOAD AUTORIZADO PELO OPERADOR** (instrução explícita desta rodada): após validação
   local, subir o ZIP em `tmpfiles.org` e registrar a URL no relatório (padrão das rodadas
   anteriores; ver `qa/governanca-exposicao-externa.md` — conteúdo é código + dados sintéticos,
   sem segredo). Se o upload falhar, registrar a falha e entregar o ZIP local.
6. **Relatório final PASS/FAIL** por item: Fase Zero, E1–E4, E5 (mapa/leitura/movimento/8 testes),
   E6 (ou "não executada"), checkpoint (ZIP/SHA/manifesto/recuperação/upload), linhas vermelhas
   (§1) verificadas uma a uma.

---

## 7. COMANDOS ÚTEIS (o novo chat vai precisar)
```bash
bun run dev            # servidor :3000 em background (já pode estar rodando — checar dev.log)
bun run lint           # obrigatório antes de commit
bun run db:push        # só se mexer em prisma/schema.prisma (esta rodada NÃO mexe)
npx tsx scripts/test-v01016-experiencia-pdf.ts   # (padrão das suítes: npx tsx scripts/test-*.ts)
tail -50 dev.log       # checar erros após cada passo
git add -A && git commit -m "v0.10.23: ..."   # commits locais; sem push/deploy
```
Suítes que DEVEM continuar verdes: v0101 · v0102 · v0103 · v0104 · v0105-relacoes · v0106-triagem ·
v0107-auditoria · v0108-coerencia · v0109 · v01010 · v01012 · v01015 · **v01016 · v01017 ·
v01018 · v01022** (mínimo indeclinável: as 4 últimas).

---

## 8. MAPA RÁPIDO DO CÓDIGO (âncoras)
- Ficha/dossiê + mesa + navegação: `src/components/cnpj/batch-detail-card.tsx` (5527 linhas;
  `RelacoesSocietariasPanel` ~2913; lista de seções ~3501)
- Visual prefs (modos/tabela): `src/hooks/use-scout-ui.ts`
- Relações: `src/lib/relations/service.ts` (investigarRelacoes, quadrosEmCacheDaLinha,
  investigarConexao, investigarMatrizFiliais) · `src/lib/relations/grafo.ts`
- Inteligência nova: `src/lib/inteligencia.ts`
- Triagem: `src/lib/triage/engine.ts` · Resolução/binding: `src/lib/resolve/binding.ts`
- Exportações: `src/lib/export/pdf.ts` (motor duplo nível), `excel.ts`, rota
  `src/app/api/imports/[id]/export/route.ts` (aceita `&nivel=executivo`)
- Linguagem: `src/lib/linguagem.ts` (`plural()`)
- Tipos: `src/lib/types.ts` (RelacoesView, QuadroView, EmpresaQuadro, TriagemLinhaView)
- UI kit: `src/components/ui/*` (shadcn completo) · primitivas senior: `senior.tsx`
  (TechDisclosure, formatBR etc.)
