# progress — Scout 360

## 2026-11-03 — G8.4 implementado e enviado
- CAS da fila (string JSON exata) com dono, heartbeat de 30 s, releitura entre contas e parada ao perder posse; módulo puro `src/lib/enrich/research-queue-state.ts`; 8 testes unitários novos.
- Smoke pela API real (12 PASS) achou e confirmou correção da dupla contagem de `puladas`.
- Gates: tsc, lint, 17 unitários, build limpo, `test:postgres`, race test, suítes curadas (PDF v4 falha só por `pdftoppm` ausente, igual no base).
- Enviado: `b6030a8` no PR #3 (Draft); corpo do PR reescrito. Sessão: Vault `Sessões/2026-11/2026-11-03T17-27-10-scout-360-g8-4-claim-fila.md`. Decisão: `Projetos/Scout-360/Decisões/2026-11-03-claim-distribuido-da-fila.md`.

## 2026-11-03 — G8.4 medido, commit local
- Retomada do handoff de 29/10. Gates locais reexecutados: tsc 0, lint 0, unit 9/9, build OK, `test:postgres` PASS.
- Novo `test-research-queue-race.mjs`: dois executores leem o mesmo `researchQueueJson`, ambos gravam (duplicação entre instâncias); CAS na string lida elege 1; JSON obsoleto perde. Role de app local sem DDL; RLS false em PG puro.
- Commit `12535db` só com `experiments/g8-postgres/`; não enviado. Recibo: `G8-recibo-L6-20261103.md` (OneDrive do projeto). `src/lib/enrich/engine.ts` intacto.

## 2026-10-29 — fechamento G8
- R1 `a208684` e laboratório G8 `a9fdc54` publicados em branches distintas; PRs #1 e #3 Draft. Testes posteriores de fusos e bloqueio estão locais, sem commit.
- PostgreSQL 17 local, Prisma/replay, lint, tipos, 9 unitários e build passaram no escopo documentado. Backup/restore SQLite e arquivo presente passaram; fixture sintética histórica ausente.
- Supabase saudável; nenhuma migration real autorizada. Actions desativado. Sessão: Vault `Sessões/2026-10/2026-10-29T10-01-16-scout-360-g8-supabase-handoff.md`.

## 2026-10-26 — G7 consolidada
- P0 Mesa: auto-abertura exige dossiê pronto; PDF só com conteúdo coletado; unit 9/9.
- P1: 6 suítes curadas versionadas + CI GitHub Actions ativo e verde (runs 40387612627/40387612875).
- P2: bundle Worker vinext 19 MiB (1,1 MiB gzip) vs limite 64 MiB; bloqueios de arquitetura listados.
- G7-P: matriz de provedores publicada (`RELATORIO-G7P-PROVEDORES.md`), sem chamadas pagas.
- Local encerrado ("mata local"). Sessão: Vault `2026-10-26T16-21-12-scout-360-g7-consolidacao.md`.

## 2026-10-26 — Auditoria de UI (somente diagnóstico)
- Pedido do Planejador (comentário PR #1 6426666550): auditoria crítica sem implementar.
- Parecer: `qa/g7/AUDITORIA-UI-20261026.md` (12 achados: busca truncada 50px, 598px de
  cabeçalhos, rótulo "prontas para análise" × `dossiesProntos`, microcontroles, alinhamento,
  contraste cinza-400 2,94:1, rótulos múltiplos, link em button, logo, flash do histórico).
- Causa do "PR sem capturas": `/qa/` gitignorada (`.gitignore:57`); MDs force-add.
- Zero código alterado. Sessão: Vault `2026-10-26T17-55-00-scout-360-auditoria-ui-fechamento.md`.
