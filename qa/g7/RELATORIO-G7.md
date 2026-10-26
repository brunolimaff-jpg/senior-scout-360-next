# RELATÓRIO G7 — CONSOLIDAÇÃO LOCAL E EVOLUÇÃO DO PRODUTO

Missão do Planejador (26/10/2026), executada por ZCode no ambiente local de Bruno.
Escopo: P0 Lotes × Mesa, P0 operação local da IA, P1 UI, P1 GitHub, P2 Cloudflare.
Estado: **PRONTO PARA AUDITORIA G7** (aceite visual e decisões materiais pendentes do Bruno).

## 1. HEAD inicial e final

- **Inicial (verificado antes de escrever)**: branch `g7/consolidacao-local` em `d76ccb2`;
  `origin/main` em `ede6518`; árvore só com `.github/` (depois confirmado já versionado em `d76ccb2`);
  serviços Next :3000 e resolve-service :3030 ativos; sem escritor concorrente (fila de pesquisa vazia nos lotes).
- **Final**: branch `g7/consolidacao-local` em `2fac255` (push `95bdfb5..2fac255`).
  Draft PR **#1** atualizado. `main` intocada (sem merge).
- Commits da G7: `0f1f460` (Mesa sem ficha automática), `d76ccb2` (testes versionados + workflow CI),
  `2fac255` (contadores + suítes multiplataforma).

## 2. Problema encontrado e causa sustentada

1. **Mesa abria ficha de conta não identificada** (captura de 26/10): a auto-abertura usava
   "resultado único" sem exigir dossiê pronto. Causa confirmada no código e corrigida na regra pura
   `src/lib/dossie-mesa.ts` (exige cadastro ENRIQUECIDO + pesquisa OK + síntese OK + identidade sem bloqueio).
2. **Contadores inflados (novo achado desta rodada)**: o botão **Identificadas** exibia **14** em um lote de
   **11** linhas (`totalConfirmed + totalDirectCnpj` somava conjuntos sobrepostos; o filtro aplicado devolve 3).
   O título do resumo exibia **"11 contas prontas para análise"** com apenas **3** dossiês
   (`totalEnriched - review` contava consulta executada, inclusive "não encontrada").
   Causa: duas fontes diferentes para "identificada/analisável" e ausência de contrato único com o filtro.
3. **IE local não estava comprovada** (G6): cadeia pesquisa→síntese nunca exercitada fora da VM.

## 3. Correções realizadas

- `src/lib/dossie-mesa.ts` + guarda no `batch-detail-card.tsx`: auto-abertura só com dossiê pronto;
  ação de PDF só com conteúdo coletado; motivo e "Reabrir candidatos"/"Tentar novamente" visíveis.
- **Contadores** (`batch-detail-card.tsx`, `acompanhamento-painel.tsx`):
  Identificadas = `totalConfirmed` (população do próprio filtro CONFIRMED);
  "prontas para análise" = `totalConfirmed`; faixa Acompanhamento idem.
  Resultado medido no lote sintético: 14 → **3** e 11 → **3** (Dossiês 3 de 11).
- **Copy da Mesa vazia**: frase corrigida (gramática) e orientação a Lotes quando não há conta identificada.
- **Suítes v01024 e v0111-pessoas**: `tmpdir()` + `process.execPath` (sem `/tmp` fixo nem `bunx` no PATH)
  — rodam no Windows e no CI Linux sem mascarar diferença de ambiente.

## 4. Evidências da jornada Lotes → Mesa

Lote `lote-teste-local.csv` (Cenário A — 1 pista não identificada):
- Lotes: Entradas 1 · Identificadas 0 · Dossiês 0 de 0 · linha "Não encontrada" com "Tentar novamente".
- Mesa: estado vazio "Nenhum dossiê pronto neste lote" + CTAs ("Acompanhar em Lotes", "Ver todas");
  **nenhuma ficha aberta automaticamente**; clique manual abre a ficha com
  "Não conseguimos identificar esta empresa", "Nenhum candidato…", "Reabrir candidatos" e
  **"PDF do dossiê indisponível — identidade não concluída (ajuste em Lotes)"**.
- Capturas: `qa/g7/cenario-a-mesa-vazia.png`, `qa/g7/cenario-a-ficha-nao-identificada.png`.

Lote `cenario-b-sintetico.csv` (Cenário B — 11 entradas, 3 concluídas, 8 pendentes):
- ACOMPANHAMENTO: Entradas 11 · Identificadas **3** · Revisão 0 · Pesquisa 3 prontos · **Dossiês 3 de 11**.
- Mesa: tabs Todas 11 · Dossiês 3 · Identificadas 3 · Revisar 0 · Falhas 0; lista com 3 "Análise" e
  8 "Não encontrada"; ficha de 99.000.001/0001-99 com "Baixar ficha em PDF" e abas
  Identidade / Fatos / Contatos e sócios / Estrutura e relações / O que falta confirmar /
  O que investigar agora / Fontes e histórico; modo **Expandido** ("Reduzir", "Voltar à lista").

## 5. Resultado real da investigação do SDK de IA

**Categoria A — ambiente/configuração (comprovada); sem indício de C (código).**

- O `z-ai-web-dev-sdk` não usa env: `create()` lê `.z-ai-config` (JSON com `baseUrl` + `apiKey`) em
  `cwd`, `~` ou `/etc`; sem o arquivo lança erro. Os três caminhos estão vazios neste ambiente
  e o archive da VM não trouxe o arquivo (credencial ficou na VM).
- Prova direta: `POST :3030/scout-chat` → HTTP 500
  `"Configuration file not found or invalid. Please create .z-ai-config in your project, home directory, or /etc."`;
  a sonda `scripts/probe-vm-capacity.ts` falha com a MESMA mensagem.
- Comportamento do produto (sem simulação): a leitura enfileira e a conta fica `aiStatus=FALHOU` com
  mensagem ao operador ("A IA não conseguiu gerar a leitura desta conta agora. Você pode tentar novamente em instantes.")
  e botão "Tentar de novo". Telemetria téc田野 mantém a causa. **Nada foi falsificado.**
- O encanamento Next → resolve-service → SDK está correto (rate limit, retries de rede, normalização de
  tokens, status upstream preservado). O que falta é credencial/config do provedor.
- **Decisão material pendente**: (a) obter a credencial Z.ai e criar `.z-ai-config` (menor delta, sem
  trocar provedor); ou (b) escolher outro provedor (exige decisão e adaptação). Nada foi alterado.

## 6. Testes, logs e capturas

| Verificação | Resultado |
|---|---|
| `tsc -p tsconfig.src-check.json` | **0 erros** |
| `eslint` (src + scripts alterados) | **0 erros** |
| `bun test tests/unit` | **9/9 PASS** |
| `test-v0103-regressoes` | **50/50 PASS** |
| `test-v0111-pessoas-reversa` (após fix Windows) | **37/37 PASS** |
| `test-v01024-lab-route` (após fix Windows) | **8/8 PASS** |
| `test-v0111-pdf-v4` | **38/39** — única falha: `pdftoppm` (poppler) ausente no Windows; CI instala |
| `test-v01012` / `test-v01015` | executadas no CI (exigem app + banco de CI); último run verde |
| Persistência (Cenário D) | Next parado e religado; lotes `cmvpmp85e…` (11/3) e `imp_mvpk7397…` (1/0) intactos |
| Viewports 1366/520/390 | **520/390 NÃO VERIFICADO** localmente (IAB fixo em 1280×720); G6 registra 390 sem overflow na VM |

## 7. Branch, Draft PR e verificações no GitHub

- Branch `g7/consolidacao-local` publicada; **Draft PR #1** em
  https://github.com/brunolimaff-jpg/senior-scout-360-next/pull/1.
- CI `.github/workflows/ci.yml` **ativo**: job Qualidade (bun, prisma generate, tsc src, lint, unit, build)
  **PASS**; job Regressão (poppler, banco de CI, app :3000, 6 suítes) em execução no push `2fac255`;
  runs anteriores (mesmo conteúdo + correções) **success**. GitGuardian PASS.
- Sem merge na `main`; sem deploy.

## 8. Parecer atualizado de compatibilidade com Cloudflare (P2)

Premissa corrigida: o limite atual de Workers é **64 MiB não comprimidos** (desde 04/09/2026);
não usar 3 MB/10 MB e não comparar `.next/standalone` (123 MB) com o pacote final do Worker.

- **Next.js + vinext**: o app **compila** com vinext 1.3.1 + @cloudflare/vite-plugin no probe isolado
  (`scout360-vinext-probe`, `vite build` em ~3 s). O passo standalone do probe falha com
  "No build output found… Run vite build first" porque o layout gerado não é `dist/client` + `dist/server`
  esperado — é ajuste de configuração do probe, não erro de compilação do app.
- **Bundle Worker**: não medido nesta rodada (o probe não gerou o pacote). Com 64 MiB, o tamanho deixa de ser
  o bloqueio principal; o bloqueio passa a ser estrutural.
- **Incompatibilidades estruturais que permanecem** (independentes do limite):
  - Prisma + SQLite em arquivo (`file:`) — Workers não têm FS persistente: exigiria D1/DB externo;
  - uploads em disco (`fs`) — exigiria R2;
  - fila de pesquisa profunda longeva no processo Next (lease/heartbeat, minutos) — exigiria Queues/Workflows;
  - **resolve-service (Bun :3030) como processo de longa vida** — não roda em Worker; exigiria Containers
    (plano pago) ou refatoração do SDK para uma API externa;
  - PDF/Excel (pdf-lib/exceljs) sob limites de CPU/tempo do plano;
  - Containers têm armazenamento efêmero por padrão.
- **Menor arquitetura funcional** (para decisão do Bruno): UI/rotas no Worker (vinext) + D1 + R2 +
  Queues para a fila + resolve-service movido para Container/serviço externo. Alternativa: Container único
  com Bun + SQLite + fs preservando o desenho atual (plano pago). **Nenhum deploy, migração, D1/R2 ou
  contratação foi executado.**

## 9. Decisões materiais pendentes

1. **IA**: obter credencial Z.ai e criar `.z-ai-config` (menor delta) × escolher outro provedor (material).
   Sem credencial, a cadeia pesquisa/síntese permanece desligada com erro honesto — o resto do produto opera.
2. **Cloudflare**: Containers (pago, preserva Stack) × reestruturação D1/R2/Queues/Container do resolve-service.
3. **Scripts/testes**: manter a seleção curada versionada (6 suítes) — os demais 71 harnesses seguem fora do Git.
4. **Aceite visual** da Mesa/Lotes/Expandido (capturas em `qa/g7/`) — decisão do Bruno.
