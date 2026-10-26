# Senior Scout 360 — Plataforma de Inteligência CNPJ

Aplicação Next.js 16 (App Router) para importação de planilhas de CNPJs, enriquecimento
automático (BrasilAPI → OpenCNPJ → ReceitaWS), resolução de identidade digital (site oficial,
evidências com ENTITY_BINDING) e exportação de dossiês.

## Requisitos

- [Bun](https://bun.sh) 1.x (ou Node.js 20+ com npm/yarn — comandos análogos)
- Sem banco externo: SQLite local via Prisma (arquivo `db/custom.db`)

## Instalação rápida

```bash
# 1. Instalar dependências
bun install

# 2. Aplicar o schema no banco (se for usar o db/custom.db incluído, pode pular)
bun run db:push

# 3. Rodar em desenvolvimento (porta 3000)
bun run dev
```

Abra `http://localhost:3000`.

> O banco `db/custom.db` não vem no repositório (dados do operador nunca são versionados).
> Ele é criado vazio no primeiro uso — rode `bun run db:push` para aplicar o schema.

## Serviço auxiliar (resolver)

O resolvedor de identidade roda como mini-serviço independente (porta 3030):

```bash
cd mini-services/resolve-service
bun install
bun run dev
```

## Estrutura principal

```
src/app/                  → App Router (página única + rotas de API)
src/app/api/imports/      → upload, processamento, confirmação, retry, deep-research, export
src/components/cnpj/      → componentes do fluxo (upload, preview, batch, histórico)
src/lib/enrich/           → motor de enriquecimento (sources, engine, ai, news, research)
src/lib/resolve/          → resolvedor de identidade + ENTITY_BINDING
src/lib/cnpj.ts           → normalização/DV mod-11 de CNPJ
prisma/schema.prisma      → modelo de dados (imports, rows, evidências)
mini-services/            → resolve-service (porta 3030)
docs/DESIGN-SPEC.md       → especificação de design (glassmorphism + esmeralda)
```

## Configuração de ambiente (opcional)

As chaves de IA usam o SDK local (`z-ai-web-dev-sdk`) e não exigem configuração.
Para trocar modelos/provedores, veja `src/lib/enrich/ai.ts`.

## Scripts

- `bun run dev` — servidor de desenvolvimento (porta 3000)
- `bun run lint` — ESLint
- `bun run db:push` — aplica o schema Prisma no SQLite

## Origem deste snapshot

Código exportado da VM de desenvolvimento Z.ai em 26/10/2026 e sanitizado para o
primeiro envio ao GitHub.

- Commit de origem na VM: `43f42cdfdc50ac90dbd4d077267ee574dfb80217` (main, v0.11.3)
- TAR original exportado pela plataforma (SHA-256):
  `f046785bcca0b71de1ea33d0cecb1c44df2b1e304c09c653604f718eff4c643d`
- O histórico Git original da VM fica preservado apenas localmente (referência de
  auditoria); este repositório inicia uma linha limpa a partir do estado auditado.
- Removidos neste snapshot: `.env` real, `tool-results/`, `skills/` (material da
  plataforma Z.ai), `evidencias/` (pacotes QA), `.zscripts/` e `recovery/` (infra
  da VM), `Caddyfile`. Detalhes em `HANDOFF-PLANEJADOR.md`.
- Estado funcional: v0.11.3 — Lotes + Mesa de Investigação, validação navegador 21/21
  na VM (ver `worklog.md`, entradas UX-MESA e LOTES-MESA-1).
