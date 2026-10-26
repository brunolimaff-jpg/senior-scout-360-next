# HANDOFF AO PLANEJADOR — SCOUT 360 — EXPORT DA VM Z.AI (26/10/2026)

Pacote organizado localmente por ZCode a partir do export TAR da VM Z.ai.
SHA-256 do TAR original (`workspace-b49434b5-ea95-4b93-848b-3b26067c402a (1).tar`):
`f046785bcca0b71de1ea33d0cecb1c44df2b1e304c09c653604f718eff4c643d`

## 1. Estado verificado do repositório

- **HEAD: `43f42cd`** (acima do trabalho só commits de artefato da plataforma). Commits finais de código/trabalho: `44fa334` (integração LOTES+MESA) e `0367ca2` (worklog LOTES-MESA-1).
- Cadeia completa: `fda2934` → `6a03e75` → `781d1f7` → `967e435` → `c493781` (v0.11.1 DELTA auditoria) → `d4d1adc` → `f52d606` → `dd4978f` → `76da643` → `62025fa` (v0.11.2 UX-MESA) → `8f26480` → `a8f27dd` (fundação LOTES+MESA) → `44fa334` → `0367ca2` → `43f42cd`.
- `git fsck`: OK — todos os objetos presentes.
- O export da plataforma materializou apenas 352 arquivos de trabalho; os demais foram recompostos **byte a byte do próprio `.git`** (conteúdo do commit verificado). Árvore atual: sem modificações de conteúdo.
- Estado declarado pelo executor na VM: **PRONTO PARA AUDITORIA DO PLANEJADOR** (validação navegador 21/21).

## 2. O que o Planejador deve ler primeiro

1. `worklog.md` — entradas **UX-MESA** (v0.11.2) e **LOTES-MESA-1** (v0.11.3) no fim do arquivo: escopo, provas, ressalvas e estado final.
2. `LEIA-ME.md` — visão do produto e contexto geral.
3. `docs/` — API-SPEC, DESIGN-SPEC, CHANGELOG, etc.
4. Código principal desta rodada:
   - `src/components/cnpj/batch-detail-card.tsx` — Mesa (Lista/Dividido/Foco), Lotes, lista compacta por container query
   - `src/components/cnpj/acompanhamento-painel.tsx` — novo: faixa de acompanhamento por etapas + intro/estado vazio da Mesa
   - `src/components/cnpj/pessoa-dossie-sheet.tsx` — dossiê da pessoa (escopos declarados, busca por raiz)
   - `src/app/api/imports/[id]/route.ts` — contadores canônicos `pesquisaProfunda` + filtro `dossie_pronto`
   - `src/lib/export/pdf.ts` — PDF v4 (preservada por contrato)

## 3. Validações executadas na VM (relatadas pelo executor Z.ai; não revalidadas neste ambiente)

- Navegador com asserções duras: **24/24 (v0.11.2)** e **21/21 (v0.11.3)**; mobile 390 px sem overflow; console 0 erros; jornada real Empresa → Pessoa → Relacionada → Retorno.
- Regressões: v0101 ALL · v0103 50/50 · v01012 40/40 · v01015 71/71 · v01024 8/8 · PDF v4 39/39 · Pessoas 37/37 · lint 0 · tsc src/ 0.
- Ressalvas conhecidas (dívida documentada, pré-existente): v01016 (13 falhas) e v01022 (1 falha) — expectativas do documento V3 sobre o gerador V4; nenhum código de PDF alterado nas rodadas recentes.
- Contrato de contadores provado por API: lote de 11 identificadas com 3 pesquisas profundas prontas exibe "3 de 11" — nunca 11 prontas.

## 4. Lacunas deste export (esperadas, não são defeito)

- `skills/` (1070 arquivos): material próprio da VM Z.ai, não incluído no export da plataforma. **Não faz parte do produto Scout.** O Git os mostra como deletados por isso; recompor com `git restore skills/` se algum dia fizer falta.
- `qa/`, `upload/`, `db/*.db`: gitignored por design (evidências de runtime, insumos de lote e banco do operador nunca versionados). Os pacotes de evidência sanitizados citados no worklog ficaram na VM — hashes declarados:
  - pacote reauditoria v0111 (42 arquivos): `54b71865ea68bd4535dba6e2a826f18b72133d22809e2c7fb39a32ae5e53fbee`
  - pacote-ux-mesa-v0112 (43 arquivos): `6e3e47a31b596c08f811dcc9a11bc8c867f828fadf2417a29a92ae5032d25351`
- `node_modules/` e `.next/`: ausentes — instalar para rodar (seção 6).

## 5. Sanitização

- Nenhum banco do operador, nenhum token ou credencial. `.env` contém apenas `DATABASE_URL` local (SQLite).
- Dados do lote real de 11 empresas do operador **não** estão neste export.

## 6. Como rodar localmente

- Requisitos: Bun (ou Node 20+).
- Passos: `bun install` → `bunx prisma generate` → `bun run dev` (porta 3000).
- O banco `db/custom.db` é criado vazio no primeiro uso (schema em `prisma/`); modo OPEN, sem login, conforme decisão vigente de Bruno para a fase de desenvolvimento.

## 7. AVISO DE DIREÇÃO — infraestrutura Cloudflare (Bruno, 26/10/2026)

Os projetos do Bruno estão migrando para **Cloudflare**, com o objetivo de **economizar RAM** (a VM Z.ai é temporária e limitada). Ainda **não há política/arquitetura firme** — direção preliminar. O Planejador deve considerar nas próximas fases:

- Compatibilidade do Next.js com Cloudflare (ex.: `@opennextjs/cloudflare` / Pages + Workers) e o que quebra no runtime workerd.
- Persistência: hoje Prisma + SQLite local → avaliar **Cloudflare D1** ou Turso.
- Uploads, geração de PDF e fila de pesquisa profunda → repensar para serverless (R2, Queues, Workflows).
- Nenhuma migração foi executada — esta seção é aviso para planejamento, **não autorização de deploy**.

## 8. O que não fazer com este pacote

- Nenhum commit novo sobre o estado auditado sem ciência do Planejador (a cadeia de commits/hashes do trabalho está declarada no worklog).
- Não versionar dados do operador (regra do `.gitignore`, lição v0.10.x).
