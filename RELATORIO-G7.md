# RELATÓRIO G7 — CONSOLIDAÇÃO LOCAL E EVOLUÇÃO DO PRODUTO

Missão do Planejador (26/10/2026). Branch de trabalho: `g7/consolidacao-local`
(Draft PR #1). A `main` permanece em `ede6518` — sem merge.

## 1. HEAD

- Inicial: `ede6518` (local = remoto).
- Final da branch: `d76ccb2` (commits `0f1f460` P0 + `d76ccb2` P1).
- Estado: árvore limpa; serviços locais encerrados ao final ("mata local").

## 2. Problema encontrado e causa sustentada

Cenário do Planejador (captura 26/10): conta fictícia não identificada com
processamento concluído, 0 dossiês prontos, lista com a conta em falha, ficha
quase vazia aberta e ação de exportação da ficha.

**Causa**: a auto-abertura da ficha na Mesa exigia apenas "resultado único"
(`rows.length === 1`), sem verificar se a linha era um dossiê pronto. Conta com
falha de identificação (Cenário A) satisfazia a condição e abria a ficha vazia.
Em paralelo, o botão "Baixar ficha em PDF" era renderizado para qualquer linha,
inclusive sem conteúdo coletado.

## 3. Correções realizadas

- `src/lib/dossie-mesa.ts` (novo, regra pura): `dossiePronto()` e
  `deveAutoAbrirFicha()` — a ficha só abre sozinha quando o resultado único é
  dossiê PRONTO (cadastro + pesquisa + síntese + identidade sem bloqueio).
- `batch-detail-card.tsx`: a guarda de auto-abertura usa a regra; a ação de PDF
  do dossiê só renderiza para `lookupStatus === "ENRIQUECIDO"`; sem conteúdo, a
  ficha mostra "PDF do dossiê indisponível — identidade não concluída (ajuste em
  Lotes)" com `data-testid` próprio.
- Estado vazio da Mesa (`MesaEmptyState`) continua independente do filtro ativo:
  com 0 dossiês, o chip canônico diz "0 dossiês prontos" e o filtro "Todas" não
  redefine a área (a lista de falhas segue acessível, mas sem ficha automática e
  sem ação de dossiê).

## 4. Evidências Lotes → Mesa (dados sintéticos, via API real)

- **Cenário A** (lote `imp_mvpk7397`, CNPJ fictício `99.000.010/0001-99`):
  linha `lookupStatus=NAO_ENCONTRADO`, `resolutionState=UNRESOLVED`; contadores
  `pesquisaProfunda = {solicitadas:0, dossiesProntos:0, identificadasElegiveis:0}`.
  A conta permanece em Lotes; nada abre na Mesa.
- **Cenário B** (lote sintético `cmvpmp85e…`, 11 linhas, 3 com dossiê pronto):
  `pesquisaProfunda = {solicitadas:3, concluidas:3, dossiesProntos:3,
  identificadasElegiveis:11}` e o filtro `?pesquisa=dossie_pronto` retorna
  EXATAMENTE as linhas 1,2,3 — "3 de 11", nunca "11 prontas".
- **Persistência**: Next reiniciado; lote e linhas permaneceram no SQLite.
- **Testes unitários** (`tests/unit/dossie-mesa.test.ts`): 9/9 PASS, incluindo
  "não abre com resultado único que falhou" e "não sobrescreve seleção manual".
- Validação visual em navegador: **NÃO VERIFICADA** nesta sessão (sem ferramenta
  de browser local). Não se declara PASS visual; a regra está coberta por teste
  unitário e por typecheck/lint/build.

## 5. SDK de IA — resultado real da investigação

Classificação: **A (configuração ausente) + B (dependência da VM Z.ai)**;
**C descartado** (o código degrada corretamente); **D é decisão pendente**.

- Prova 1: `ZAI.create()` local → erro exato
  `Configuration file not found or invalid. Please create .z-ai-config…`.
  Não existe `.z-ai-config` no projeto, no home nem em `/etc` — e ele não vinha
  no TAR (credenciais nunca são exportadas).
- Prova 2: `GET :3030/health` → `{ok:true, uptime_s:4198}` (serviço saudável);
  `POST /web-search` → HTTP 500 com a mensagem honesta acima. Nenhuma consulta
  externa disparada; nenhum crash; produto segue operacional.
- Conclusão: a IA/pesquisa profunda depende de um provedor compatível com o SDK
  (`baseUrl` + `apiKey` no `.z-ai-config`). O SDK aceita qualquer endpoint
  compatível — **não exige mudança de código**, apenas configuração. Escolher o
  provedor (e possível custo) é decisão de Bruno/Planejador.

## 6. Testes, logs e capturas

- `bun test tests/unit`: 9/9.
- `tsc --noEmit -p tsconfig.src-check.json` (escopo `src/`): 0 erros.
- `eslint .`: 0 erros.
- `next build`: OK (ver `build-g7.log`).
- Regressões da rodada anterior seguem válidas (v0101 ALL · v0103 50/50 ·
  v01012 40/40 · v01015 71/71 · v01024 8/8 · Pessoas 37/37 · PDF v4 38/39 por
  `pdftoppm` ausente no Windows). Nenhuma suíte toca o componente alterado; a
  superfície nova tem teste próprio.
- Capturas de tela desta rodada: indisponíveis (sem browser automation).

## 7. GitHub — branch, Draft PR e verificações

- Repositório: `brunolimaff-jpg/senior-scout-360-next` (privado).
- Branch: `g7/consolidacao-local` @ `d76ccb2`; `main` intocada.
- **Draft PR #1**: https://github.com/brunolimaff-jpg/senior-scout-360-next/pull/1
- Testes essenciais versionados (6 suítes curadas + helpers + unitários) e
  `tests/README.md` com dependências (Bun, poppler, banco).
- **Pendência de CI**: `.github/workflows/ci.yml` está pronto no disco local,
  mas o push foi recusado porque o token OAuth do `gh` não tem o escopo
  `workflow` (`refusing to allow an OAuth App to create or update workflow`).
  Ativação: `gh auth refresh -s workflow` → `git add .github && git commit -m
  "CI" && git push`. Também não há chave SSH registrada na conta (o push usa
  HTTPS + credencial do gh).

## 8. Cloudflare — parecer atualizado

**Correção do G6**: o limite atual dos Workers é **64 MiB não comprimidos**
(desde 04/09/2026) — os limites 3/10 MB estão obsoletos. Comparar
`.next/standalone` diretamente com o pacote Worker também era impróprio.

Teste isolado (`vinext` 1.3.1, cópia em `dev/scout360-vinext-probe`, sem tocar a
aplicação principal):

- `vinext check`: imports Next **3/3 suportados**; config `headers` e `output`
  OK; libs **9/10** — **`next-auth` incompatível** ("relies on Next.js API route
  internals; migrar para better-auth"); **`__dirname`/`__filename` incompatíveis**
  (corrigível: `import.meta.dirname`); Prisma suportado **apenas com driver
  adapters** (D1, Hyperdrive) ou Accelerate; App Router e 34 rotas OK.
- `vinext init` + build: o Vite gerou o bundle Worker em
  `.cloudflare/output/v0/workers/default/bundle` — **19 MiB não comprimidos,
  1,1 MiB gzip**. O passo final do CLI (`emitStandaloneOutput`) falha no Windows
  com "No build output found in dist" (defeito de empacotamento do 1.3.1, não do
  app). **Conclusão: tamanho NÃO é o bloqueio.**

Bloqueios reais (arquitetura, não bundle):

| Ponto | Exigência no Workers |
|---|---|
| Prisma + SQLite em arquivo | D1/Hyperdrive/Accelerate + adapters (reestruturação da persistência) |
| Uploads em `fs` | R2 (troca da camada de arquivos) |
| `runBatch` com lease (loop longo) | Queues/Workflows (reestruturação do processamento) |
| resolve-service (Bun, :3030, long-lived) | runtime separado (Containers pagos) ou refatoração |
| next-auth | migração para better-auth |
| PDF/Excel pesados | limites de CPU (plano pago; validar tamanho real) |

**Menor arquitetura funcional por caminho**:

1. **Workers + vinext + D1 + R2 + Queues** — funcional e dentro do limite de
   tamanho; custo baixo (Workers Paid US$ 5/mês + D1/R2/Queues por uso); porém
   exige reestruturar persistência, uploads, fila e auth (semanas, decisão
   material).
2. **Cloudflare Containers** — roda o app quase como está (Bun + SQLite + fs),
   mas **armazenamento efêmero por padrão** (exige estratégia externa para o
   banco) e plano pago (não autorizado nesta rodada).
3. **Hoje, menor custo funcional**: manter local/VPS com disco persistente e
   usar a Cloudflare apenas como DNS/CDN — satisfaz "economizar RAM" sem
   reestruturar o Scout; migração para Workers fica como fase com decisão.

Nenhum deploy, migração, D1/R2 ou contrato de Containers foi executado.

## 9. Decisões materiais pendentes

1. **Cloudflare**: Workers reestruturado (D1/R2/Queues, semanas) × Containers
   (pago, storage efêmero) × local/VPS com disco (imediato).
2. **Provedor de IA** para o Scout fora da VM (`.z-ai-config` com endpoint
   compatível; pode ter custo).
3. **Escopo OAuth `workflow`** para ativar o CI (ação de Bruno no `gh auth
   refresh`, um comando).

## O que NÃO funcionou (registro honesto)

- `vinext build` no Windows: falha final "No build output found in dist"
  (bundle Worker gerado em `.cloudflare/output`, CLI 1.3.1 não empacota).
- `git push` com `.github/workflows/ci.yml`: recusado por escopo OAuth ausente.
- `tsc --noEmit` global: acusa erros pré-existentes apenas em `scripts/`
  (harness local) — por isso o typecheck versionado é escopado em `src/`.
