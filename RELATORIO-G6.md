# RELATÓRIO G6 — LOCAL · GITHUB · CLOUDFLARE

Missão do Planejador: **LOCAL FIRST → GITHUB → CLOUDFLARE** (26/10/2026).
Executado por ZCode no ambiente local de Bruno. Evidências abaixo; itens não
verificados estão marcados como tal.

## LOCAL — VALIDADO

- **Ambiente**: Windows (build 10.0.26300), diretório `C:\Users\bruno.ferreira\dev\scout360-next`.
  Runtime **Bun 1.4.4** (instalado nativamente; resolve-service exige Bun —
  `Bun.serve`/`Bun.spawn`), Node 24.22.0 disponível.
- **Base**: commit de origem da VM `43f42cd` (v0.11.3), importado via `git archive`
  e reconciliado: `package.json` atualizado de `0.11.1` → `0.11.3`.
- **Comandos validados**:
  - `bun install` → 905 pacotes
  - `bunx prisma generate`
  - `bunx prisma db push` (banco novo `db/custom.db`, 147 KB; sem data-loss — banco não existia)
  - `bunx next dev -p 3000` → **Ready em 3,5 s**
  - `bun mini-services/resolve-service/index.ts` → **ouvindo em 127.0.0.1:3030**
- **Serviços ativos**: Next :3000 (PID ativo), resolve-service :3030.
- **Funcionalidades verificadas por API/HTTP**:
  - Home `GET /` → 200, HTML com a estação (Lotes/Mesa)
  - `GET /api/imports` → `{"ok":true,"batches":[]}` (banco vazio inicial)
  - Upload sintético `POST /api/imports` (CSV 1 linha, CNPJ 99.000.010/0001-99) →
    lote `imp_mvpk7397_v7jr7r` criado em PREVIEW, headers e coluna detectados
  - **Persistência após reinício**: processo do Next encerrado e reiniciado; o lote
    continuou acessível em `GET /api/imports` (SQLite local íntegro)
- **Limitação de IA (honesta)**: o `z-ai-web-dev-sdk`/resolve-service depended de
  condições da VM Z.ai. O serviço sobe e responde, mas **as funções de IA/pesquisa
  profunda NÃO foram validadas localmente** (sem credencial/configuração do provedor
  fora da VM). O restante do produto (importação, banco, telas, PDF/Excel) não depende
  disso para operar. Nada foi falsificado para simular IA funcionando.

## GITHUB — VERIFICADO

- **Repositório privado**: `brunolimaff-jpg/senior-scout-360-next`
  (o repo `senior-scout-360` existente — Vite — **não foi tocado**).
- **Branch**: `main`. **SHA inicial**: `b9ce47c37bb1878657e041a378595ccd7c424bcb`
  (commit do relatório vem depois, sobre este).
- **Sanitização do primeiro push** (evidências):
  - 209 arquivos versionados; varredura remota confirmou **0** ocorrências de
    `scripts/`, `tests/`, `.env`, `*.db`, `tool-results/`, `skills/`.
  - Removidos do snapshot: `.env` real, histórico Git da VM (fica só local, em
    `C:\Users\bruno.ferreira\dev\scout360-vm-archive`), `tool-results/`, `skills/`
    (material da plataforma Z.ai), `evidencias/` (pacotes QA), `.zscripts/`,
    `recovery/`, `Caddyfile`, `download/`.
  - `scripts/` e `tests/` (77 harnesses de QA + 3 scripts de runtime da VM) **não
    entram no primeiro push** — são "arquivos de diagnóstico" conforme o contrato G2.
    Continuam disponíveis no disco local e foram usados nas regressões abaixo.
  - `.env.example` seguro (sem valores reais) permanece no repo.
  - README registra origem do snapshot, SHA da VM e hash SHA-256 do TAR.
- **Como reproduzir após clone**: instruções no README (bun install → db push →
  dev; resolve-service na 3030).

## CLOUDFLARE — BLOQUEIO TÉCNICO COMPROVADO (sem deploy)

Análise por componente, com evidência local:

| Componente | Situação no app atual | Compatibilidade Workers |
|---|---|---|
| Renderização/rotas Next.js 16 | App Router + rotas dinâmicas | Parcial — caminho oficial existe (`vinext` 1.3.1 publicado no npm; Cloudflare recomenda) |
| Prisma + SQLite em arquivo | `DATABASE_URL=file:...` | **Incompatível** — Workers não têm FS persistente; exigiria D1 (adapter + migrações) ou DB externo = decisão material |
| Uploads em disco | upload/ gravado via `fs` (6 arquivos em src/ usam fs) | **Incompatível** — exigiria R2 = decisão material |
| Fila/pesquisa profunda | `runBatch`: loop longo no processo Next com lease+heartbeat (minutos) | **Incompatível** — modelo request-scoped; exigiria Queues/Workflows = reestruturação |
| resolve-service (Bun :3030) | Processo separado de longa vida | Não roda em Worker; exigiria Containers (**plano pago — não autorizado**) ou refatoração |
| PDF/Excel (pdf-lib/exceljs) | Geração em rotas | Risco de CPU/tempo; depende dos limites do plano |
| Tamanho do bundle | `.next/standalone` = **123 MB** | Limite Workers: 3 MB (free) / 10 MB comprimido (pago) — inviável sem separação radical |

**Veredito**: a execução completa **não é viável em Workers sem mudança estrutural**
(persistência, uploads, fila e serviço auxiliar). Conforme o contrato G3, **não foi
feito deploy** e **não se declara hospedagem concluída**. Alternativas menores, para
decisão de Bruno/Planejador:

1. **Cloudflare Containers** — roda a aplicação quase como servidor tradicional
   (Bun+SQLite+fs). Exige plano pago (não autorizado nesta missão).
2. **Reestruturação serverless** — D1 + R2 + Queues/Workflows + resolve-service
   redesenhado; é a alternativa "oficial", mas é decisão material de arquitetura.
3. **Demonstração parcial** — apenas a UI com dados sintéticos, backend fictício,
   explicitamente rotulada. Não recomendada pelo próprio contrato (evitar fachada).

## QUALIDADE — testes executados localmente

| Suíte | Resultado |
|---|---|
| `test-v0101-regressoes` | **TODOS PASSARAM** |
| `test-v0103-regressoes` | **50/50** |
| `test-v01012-identidade` | **40/40** |
| `test-v01015-exportacoes` | **71/71** |
| `test-v01024-lab-route` | **8/8** |
| `test-v0111-pessoas-reversa` | **37/37** |
| `test-v0111-pdf-v4` | **38/39** — única falha: renderização PNG página a página via `pdftoppm` (poppler ausente no Windows; ferramenta, não código) |
| `eslint .` | **0 erros** |
| `tsc --noEmit` (escopo `src/`) | **0 erros** (build usa `ignoreBuildErrors: true`; tipos verificados separadamente, como exigido) |
| `next build` | **OK** (compilou em 49 s; standalone 123 MB) |

Falhas remanescentes conhecidas (dívida pré-existente, não tocadas nesta rodada):
`test-v01016` (expectativas V3 sobre gerador V4) e `test-v01022` (página final quase
vazia) — documentadas no worklog desde a consolidação anterior.

**Não verificado**: validação visual em navegador desta instância local (sem
ferramenta de browser nesta sessão) — a UI foi validada na VM (21/21) sobre o mesmo
commit; aqui foi verificada por HTTP/API.

## Riscos e decisões materiais pendentes

1. IA/pesquisa profunda local depende de configuração do provedor Z.ai — definir
   se o Scout terá provedor próprio (decisão de produto).
2. Caminho Cloudflare exige decisão: Containers (pago) × reestruturação D1/R2/Queues.
3. `scripts/`/`tests/` ficaram fora do primeiro push; se o Planejador quiser as
   regressões versionadas, enviar em branch própria sanitizada (mock keys já são
   fictícias; padrões de exec/SSRF são inerentes aos harnesses).
