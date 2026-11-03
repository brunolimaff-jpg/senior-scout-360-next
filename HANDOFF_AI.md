# HANDOFF_AI — Scout 360

## Estado atual — 03/11/2026

- G8.4 **implementado**: `writeQueue` (update cego) substituído por CAS na string JSON exata, com dono, heartbeat de 30 s, releitura entre contas e parada ao perder a posse. Módulo puro novo `src/lib/enrich/research-queue-state.ts`. Corrigida a dupla contagem de `puladas`.
- Gates verdes: tsc, lint, 17 unitários, build limpo, `test:postgres`, race test e smoke pela API real (12 PASS). Suítes curadas: 40/40, 71/71, 8/8, 37/37, 50/50; PDF v4 falha só por `pdftoppm` ausente, igual no commit base.
- Recibo L6: `C:\Users\bruno.ferreira\OneDrive - Senior Sistemas SA\Documentos\Projetos\Scout 360 - Enriquecimento de Contas\G8-recibo-L6-20261103.md`.
- NAO VERIFICADO: duas instâncias Next reais disputando a mesma fila em produção; `runBatch` completo; cancelamento externo; grants/RLS no Supabase; deploy.

## Estado anterior — 29/10/2026

- Narrativa curada: `C:\Users\bruno.ferreira\OneDrive - Senior Sistemas SA\Documentos\Bruno Vault\Sessões\2026-10\2026-10-29T10-01-16-scout-360-g8-supabase-handoff.md`.
- Repo `C:\Users\bruno.ferreira\dev\scout360-next`; branch `g8/postgresql-lab`, HEAD `a9fdc54d4cffa7873327aff3b2b5d1915c6d7c5b`.
- R1 `g7/consolidacao-local` / `a208684`: Draft PR https://github.com/brunolimaff-jpg/senior-scout-360-next/pull/1. G8: Draft PR https://github.com/brunolimaff-jpg/senior-scout-360-next/pull/3. Ambos abertos e sem merge.
- Issue: https://github.com/brunolimaff-jpg/senior-scout-360-next/issues/2. Checks históricos verdes; GitHub Actions `CI` **disabled_manually** por decisão de Bruno. Não reativar sem autorização.
- Supabase `scout-360`: saudável em São Paulo na CLI; destino do mesmo Scout. Zero migrations e tabelas `public` na última leitura anterior; NAO VALIDADO novamente em 29/10. SQLite segue operacional local; sem deploy comprovado.
- Antes do fechamento: modificados sem commit `experiments/g8-postgres/README.md`, `experiments/g8-postgres/test-postgres-real.mjs` e `next-env.d.ts` (gerado pelo build). Preservar; este handoff e `.agents/memory/` também foram atualizados.

## Validação e limites

- PostgreSQL 17 local: migration/replay, Prisma, FK, datas, JSON, rollback, consulta SQL, cascata e lease passaram. Alterações locais posteriores ao HEAD testam fusos e bloqueio observado. Lint, TypeScript, 9 unitários e build local passaram; clone limpo passou após gerar Prisma Client principal. Recibo: `C:\Users\bruno.ferreira\OneDrive - Senior Sistemas SA\Documentos\Projetos\Scout 360 - Enriquecimento de Contas\G8-recibo-validacao-local.md`.
- SQLite e arquivo presente restaurados em cópia isolada; fixture histórica `cenario-b-sintetico.csv` ausente. Backups e manifesto privados em `db/`, ignorados; não adicionar ao Git. Recuperação integral NAO VALIDADA.
- NAO VALIDADO: runBatch e fila completos, cancelamento de chamadas, concorrência integral, grants/RLS reais, compatibilidade PostgreSQL completa e deploy.
- 03/11: gates locais reexecutados no working tree (tsc 0, lint 0, unit 9/9, build OK, `test:postgres` PASS). Grants locais: role de app lê/escreve e é barrada em DDL; RLS é `false` em PostgreSQL puro (no Supabase é hospedagem). Filas/cancelamento externos seguem não verificados.

## Próximos passos e travas

- G8.4 implementado e enviado no PR #3. O que resta para fechar o item: exercitar DUAS instâncias Next reais sobre o mesmo banco e conferir que só uma executa cada conta. O CAS e a sequência do engine estão provados no banco, não em dois processos vivos.
- Próximo: retorno ao Planejador com o recibo L6 e o diff do PR #3.
- Ler issue G8 e retorno do Planejador; revisar e validar diff local, preservando testes e `next-env.d.ts`. Commit/push só quando Bruno solicitar; PRs permanecem Draft.
- Continuar segurança e arquitetura com validação local, sem Actions. Antes de migration remota, dados reais, permissões, contratação, merge ou deploy: autorização específica.
- OPEN é desenvolvimento local, não autorização para expor dados reais. Provedor de IA permanece em aberto. Não delegar a modelos de fronteira sem permissão explícita de Bruno.
