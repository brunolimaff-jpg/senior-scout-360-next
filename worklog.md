# Worklog — Scout 360 (Mesa de Investigação)

---
Task ID: 1 (Entrega A — Recuperação)
Agent: Z.ai / GLM (executor único)
Task: Recuperar estado real da VM e restaurar o kit v0.10.24 verificado

Work Log:
- Verificado /home/z/my-project: template limpo (só "Initial commit"), SEM vestígios do Scout 360, sem worklog, sem /tmp/my-project, sem estado posterior recuperável.
- Conclusão: VM foi perdida/recriada. Aplicado protocolo do contrato (seção 15): restaurar a partir do último pacote verificado.
- Download tmpfiles.org (link direto resolvido do HTML intermediário): senior-scout-360-kit-dev9.zip, 66.573.530 bytes.
- SHA-256 conferido: 3aff30cdf4f1ab7a7b92db584a238f947ce9b751e40ec200b56ba32ddfe1ba48 — IDÊNTICO ao pacote verificado do contrato. package.json interna: 0.10.24.
- ZIP sanitizado (sem .git, sem db/custom.db, sem .gitignore, sem .env) — restauração preservou o .git da VM.
- Template anterior salvo em /tmp/template-backup (disponível se necessário).
- Kit aplicado verbatim sobre /home/z/my-project; .gitignore reconstruído com padrões ancorados (/test, /prompt) — lição v0.10.23.
- bun install (90 pacotes), prisma generate, db push — banco NOVO (dados do operador não existem mais; reimportáveis).
- Checkpoint git: commit b370283 "v0.10.24: restauração do kit verificado".
- Dev server Next:3000 OK (GET / 200). resolve-service :3030 OK (supervisor dev:resiliente).

Stage Summary:
- Estado inicial da retomada: v0.10.24 restaurada e compilando, commit b370283.
- Banco vazio: 0 lotes — importação de lote sintético será necessária para validação visual.
- Nenhuma alteração funcional foi feita ainda: ponto zero do contrato de UX é exatamente a v0.10.24.

---
Task ID: 2 (Entregas B–F — contrato de UX "Uma jornada, uma mesa de trabalho")
Agent: Z.ai / GLM (executor único)
Task: Executar o contrato de UX sobre a v0.10.24 restaurada (Estação, Lista/Divisão, Ficha, Investigação, Qualidade)

Work Log:
- Entrega B (page.tsx): dois estados — Entrada (hero+upload+histórico) × Mesa (hero fora, main max-w-1720, topbar operacional com "Nova entrada" recolhível e menu "Lotes").
- Entrega C (use-scout-ui.ts + batch-detail-card.tsx): useLarguraConteiner (ResizeObserver, limiar 980px) governa a divisória; defaults 32/68; autoSaveId v2 (prefs antigas 45/55 ignoradas sem apagar o resto); cabeçalho compacto da lista (busca + situação + menu Ajustes com visão/colunas/pesquisa); tabela com UMA rolagem; barra "MESA DE INVESTIGAÇÃO" em volta da estação; auditoria movida para o nível do lote; mesa subiu para logo após métricas/estado (panorama/plano/leitura/telemetria abaixo).
- Entrega D: ficha px-6/py-5, space-y-9, FichaTile p-4; container queries (@container + @min-[480px]) em CompanyFicha/Contatos/Notícias; rolagem de seções CONTIDA no corpo (rolarSecaoFicha — a página não se move mais).
- Entrega E: seção 6 = "Investigar esta empresa" (sabemos → falta → consultas → resultado); PlanoConsultasPanel AGRUPADO por tipo com resumo (consultas/empresas/chamadas/grupos), aviso comum 1× por grupo, aprovação individual preservada, fora-do-alcance expansível por tema.
- Seed sintético isolado (scripts/seed-qa-mesa-sintetico.ts): 8 linhas, raiz 99.000.100 com DV válido, ZERO consulta externa; corrigido bug de DV no próprio seed (2 iterações).
- Validação visual (agent-browser, qa/mesa-v0110/): entrada 1920; mesa 1920 (topo na primeira dobra); dividido 32/68; ficha resumo/investigar; rolagem contida; Foco; A→B (2 de 8) sem mistura; plano agrupado (2 grupos + 3 temas); Lista; 1024/900 → modo único; mobile 390 (Sheet confortável); export dialog; arraste da divisória com 0 chamadas API; varredura 1440→800→1440 com empresa preservada; rodapé empurrado naturalmente.
- Correções durante a validação: mesa-barra saiu do painel da lista para envolver a estação; scrollIntoView das seções virou scroll contido; Sheet ganhou título/descrição sr-only (a11y).
- Regressões: test-v0101 (PASS), v01012 (40/40), v01015 (71/71), v01023 (54/54), v01024-lab (8/8) — banco isolado, sem tocar nos dados do operador.
- Lint limpo; tsc limpo na UI; package.json → 0.11.0; CHANGELOG.md atualizado.

Stage Summary:
- Commits: b370283 (restauração v0.10.24) → 33bd4ab (Entregas B–E) → <commit final F>.
- Produto: Mesa de Investigação única com lista 32/68 adaptável ao contêiner real, ficha com respiro, jornada de investigação na ficha, plano compacto agrupado — critério de Bruno atendido no navegador.
- Banco local contém APENAS o lote sintético QA (arquivável); nenhum dado do operador existia nesta VM nova.
- Evidências visuais: qa/mesa-v0110/*.png (25 capturas).

---
Task ID: HOMOLOG-A (Gate 1 — Checkpoint A)
Agent: Z.ai / GLM (executor único)
Task: Missão v0.11.0 homologação intensiva — inspeção do estado real + proteção anti-indexação

Work Log:
- Estado confirmado: commit 2fcf209 (auto-checkpoint da plataforma, só .gitignore), árvore limpa, v0.11.0, sem escritor concorrente. Next:3000 + resolve-service:3030 ativos. Banco do operador: NÃO existe nesta VM (só lote QA sintético de 8 linhas, id cmvl44jxx0000r61te54p868c).
- DIVIDA CONFIRMADA (item 0 do contrato): ignoreBuildErrors: true em next.config.ts; db:push --accept-data-loss em package.json; layout.tsx sem noindex (antes do fix). ZIP v0.11.0 em public/ (servido p/ download do Planejador; sanitizado; agora com X-Robots-Tag).
- Gate 1 implementado: metadata robots (noindex/nofollow/noarchive/nocache + googleBot) em layout.tsx; header X-Robots-Tag: noindex, nofollow, noarchive para /(.*) em next.config.ts; robots.txt reescrito (ANTES permitia Googlebot/Bingbot/Twitterbot/facebookexternalhit com Allow: / — ativamente perigoso; AGORA User-agent: * Disallow: /).
- Provas curl (qa/homolog-v0110/gate1/provas-curl.txt): / (200+header+meta), 404 (header), /api, /api/imports (header), exports REAIS type=result/excel/pdf_lote (200 + header + content-disposition), robots.txt (header+conteúdo), logo.svg, ZIP. Zero canonical/sitemap no HTML.
- Auditoria de privacidade (separada do Gate 1): 28/31 rotas API têm assertAccess; 3 abertas por design (/api health sem segredos, lab/mock com gate labEnabled(), auth/session que nunca devolve segredo). Modo atual OPEN (kit local, visível na UI) — mecanismo TOKEN completo via SCOUT_EXPORT_TOKEN/SCOUT_AUTH_REQUIRED.
- Dev server reiniciado p/ carregar next.config.ts (mudança exige restart). Backup do banco pre-homolog em qa/homolog-v0110/backup-banco-pre-homolog.db (restaurado ao final da rodada).
- Commit local: <ver git log> "v0.11.0 Gate 1: proteção anti-indexação total".

Stage Summary:
- Gate 1: PASS (provado por curl em todas as classes de resposta). Checkpoint A criado.
- Estratégia QA: suítes scriptadas em bancos ISOLADOS /tmp (padrão test-v01024); navegador contra :3000 cujo banco contém APENAS dados sintéticos QA-*; backup pre-homolog preservado p/ restauração final.
- Próximo: Wave 1 paralela = Gate 2 (seeds 8/100/1k/5k) + Gate 4 (identidade adversarial) + Gate 12a (tsc completo).

---
Task ID: HOMOLOG-E2a (Gate 12a — Verificação TypeScript completa + integridade do banco)
Agent: Z.ai / GLM (executor único — RESEARCH/AUDIT, sem fixes, sem commits, sem comandos destrutivos)
Task: tsc --noEmit completo com classificação total dos erros + auditoria schema↔DB somente-leitura + mapa de portabilidade + procedimentos seguros de remediação das dívidas (ignoreBuildErrors, db:push --accept-data-loss)

Work Log:
- Typecheck completo: `bunx tsc --noEmit` → exit 2, **96 erros em 30 arquivos** (saída integral em qa/homolog-v0110/gate12/tsc-full.txt). Classificação (tsc-classificacao.md): A=0, B=23, C=73. Por área: src/app 2 (B), src/lib 0, src/components 0, src/hooks 0, scripts/ 89 (21 B), mini-services 3 (C), skills/ vendadas 2 (C).
- Produto praticamente limpo: os ÚNICOS 2 erros de src/ estão em src/app/api/imports/[id]/research-batch/route.ts:49-50 — `plural(r.enfileiradas)` com `enfileiradas?: number` (startResearchQueue em engine.ts:1816 retorna campos opcionais em vez de união discriminada). Hoje impossível de manifestar em runtime (caminho ok sempre popula), mas é o único contrato de tipo impreciso do app. auth.ts, export-guard e export/* com ZERO erros.
- 73 erros C são ambiente: tsc roda com tipos Node/DOM sobre código que executa sob Bun (Bun global ×16, top-level await ×26, bun:sqlite ×3, import.meta.dir ×5, redeclarações de escopo ×8) — bun-types JÁ está em devDependencies, só não está no `types` do tsconfig. 21 erros B em scripts/ são QA desatualizado (asserções boolean[]→check(boolean) sempre-truthy, campos inexistentes no plano, fixtures telefoneCrus→telefonesCrus, referenceDomain ausente, sondas com exit-code quebrado).
- Integridade schema↔DB: `bunx prisma validate` → VÁLIDO. Inspeção SOMENTE-LEITURA do SQLite real (bun:sqlite readonly, script inspect-db-schema.ts, saída db-schema.txt): 9/9 tabelas, colunas/tipos/defaults idênticos campo a campo, 14/14 índices nomeados + 9 autoindex de PK, 2/2 FKs — **DRIFT ZERO**. Banco contém só QA (1 lote, 8 linhas, 64 telemetrias). Estado: sem _prisma_migrations (fluxo db push puro, sem histórico versionado).
- Portabilidade mapeada (estado-tecnico.md §1): :3000 = next-server v16.1.3 pid 8126 (`bun run dev` → `next dev -p 3000 | tee dev.log`); :3030 = bun pid 1803 sob supervisor `dev:resiliente` (while-true bash, pid 1800/1802); boot idempotente = scripts/boot-dev.sh. z-ai-web-dev-sdk@0.0.18: ÚNICO consumidor de runtime é o resolve-service (import dinâmico linha 106-107); o Next fala com ele por HTTP (RESOLVE_SERVICE_URL, /scout-chat) — SDK no processo Next derruba o servidor (documentado em ai.ts:23). Modelos via env ZAI_DOSSIER_MODEL/ZAI_FAST_MODEL/ZAI_FALLBACK_MODEL.
- Achado adicional de portabilidade: .env usa DATABASE_URL ABSOLUTO (file:/home/z/my-project/db/custom.db) e o kit ZIP não carrega .env nem o LEIA-ME manda criá-lo — clone limpo falha em `bun run db:push` com "Environment variable not found". Recomendação documentada (criar .env relativo no setup) — decisão do Planner.
- Procedimentos seguros documentados (estado-tecnico.md §4, NADA executado): (4.1) remoção de ignoreBuildErrors em 5 passos — fix dos 2 erros de src/ + tsconfig.qa.json com bun-types para scripts/ + restrição do include do app + virar a flag + verificação (build proibido nesta sandbox: verificação de build é na máquina do Planner); (4.2) evolução do DB sem --accept-data-loss — backup datado em db/backup/, contagem antes/depois com sonda readonly, ensaio em CÓPIA via DATABASE_URL apontando para db/backup/ensaio-<ts>.db, só então db push real SEM flag (+ opção de baseline com prisma migrate); (4.3) drift = nenhum; (4.4) gap do .env.
- Artefatos do gate: qa/homolog-v0110/gate12/{tsc-full.txt, tsc-classificacao.md, db-schema.txt, prisma-validate.txt, inspect-db-schema.ts, estado-tecnico.md}. Efeito colateral padrão: tsconfig.tsbuildinfo (incremental, gitignored). Dev server e resolve-service NO AR durante toda a auditoria; nenhum restart, nenhum build, nenhuma escrita no banco.

Stage Summary:
- Gate 12a: tsc completo medido e 100% classificado (96 erros; 0 de severidade A; app entregue tem só 2 erros B num único arquivo de rota; lib/components/hooks/auth/export limpos) — a dívida ignoreBuildErrors é baixo-risco para virar, com procedimento de 5 passos pronto.
- Banco íntegro: schema.prisma ≡ db/custom.db (drift zero provado por inspeção readonly); risco real está no script db:push --accept-data-loss, com procedimento de ensaio-em-cópia documentado.
- Portabilidade: mapa completo de portas/processes/startups/paths/pontos-z-ai-sdk/prisma-generate; único gap novo = .env ausente do fluxo de clone (documentado).
- Pendências para o Planner: decidir (1) virada de ignoreBuildErrors pós-fix dos 2 erros de src/, (2) trocar db:push por versão sem flag (ou adotar migrations com baseline), (3) incluir criação de .env no LEIA-ME/.env.example do kit.

---
Task ID: HOMOLOG-B1 (Gate 2 — Ambiente QA + lotes sintéticos da homologação v0.11.0)
Agent: Z.ai / GLM (executor único — seeds no banco vivo :3000, zero rede externa)
Task: Criar lotes sintéticos reutilizáveis 100/1k/5k + lote "mesa completa" 100 com todas as situações, verificando por HTTP contra o dev server

Work Log:
- scripts/seed-qa-homolog.ts (novo, ~1.100 linhas, tsc limpo no isolado): DV do CNPJ copiado EXATAMENTE do seed-qa-mesa-sintetico.ts; PRNG mulberry32 com semente fixa (determinístico/reprodutível); createMany em blocos de 500; idempotente por fileName EXATO (match por prefixo casaria "QA-homolog-100" com "QA-homolog-1000.csv"); contadores calculados no seed com a MESMA lógica do recomputeCounters (conferidos iguais na 1ª leitura da API); validações internas abortam se algum normalizedCnpj não tiver 14 dígitos/DV, se sobrar situação vazia no lote 100 ou se os nomes longos não passarem de 150 chars.
- Lote 100 "mesa completa" (QA-homolog-100.csv, raízes 99.100.001+): 54 identificadas (49 CORRESPONDENTE + 4 VALIDADO + 1 por nome com CONFIRMED/HUMANA+resolvedCnpj) · 20 revisar (12 REVIEW com 2 candidatos cada + 8 LOCALIZADO com identityDivergenciasJson NOME/ALTA e LOCALIZACAO+DOMINIO/BAIXA, formato copiado de resolve/confianca.ts) · 10 não identificadas (UNRESOLVED/NAO_ENCONTRADO, 7 por CNPJ + 3 por nome) · 5 falhas (RATE_LIMITED×2, TIMEOUT, ERRO_REDE, ERRO_SERVIDOR com lookupError+retryCount) · 8 pendentes (6 PENDENTE + 2 EM_FILA) · 2 duplicadas (duplicateOf 1 e 3) · 1 inválida (DV errado). 4 pares matriz/filial (um com filial matrizStatus=NAO_LOCALIZADA → alerta), 2 nomes de 233/251 chars, 24 nomes com Ç/Ã/É/Õ, sufixos Ltda/S.A./EIRELI/ME/EPP, situação cadastral ATIVA70/BAIXADA2/SUSPENSA1/INAPTA1 (alertas 4/1/1). Fichas ricas no formato PROVADO do seed de 8 linhas + researchJson no formato que parseResearchView lê (siteOficial/buscas/noticias/sinaisPorte com fonte atribuída): 8 pesquisas OK + 2 dossiês profundos (aiDossierJson com evidências/aderência) + 30 leituras IA + 44 IGNORADO.
- Lotes de carga 1000/5000 (raízes 99.200.xxx/99.300.xxx): 90% pendente + 10% enriquecido (com leitura IA na metade), 2 pares matriz/filial cada — foco em lista/paginação/busca/filtro/ordenação/export; createdAt dos lotes espalhados nos últimos 30 dias (21/10, 11/10, 26/09).
- Execuções (wall-clock, incl. geração): 100 → 87 ms; 1000 → 182 ms; 5000 → 714 ms (bun 1.3.14, dev server rodando, gravação no db/custom.db vivo — padrão provado). Lote QA-mesa-sintetico-v0110.csv (8 linhas) PRESERVADO (verificado na lista final: 4 lotes).
- Verificação HTTP (qa/homolog-v0110/gate2/curl-*.txt): /api/imports 200 com 4 lotes e rowCounts 8/100/1000/5000; /api/imports/{100} 200 com métricas coerentes (enriched=74, review=20, falhasConsulta=15, alertas baixada=4/matriz=1/humana=1, ufDist/sectorDist/cnaeDist populados); ficha enriquecida (?q=AgroNorte, linha 10) devolve identidade + contatos + extra + sócios + fontes + IA + dossiê + pesquisa (domínio, 4 buscas, 2 notícias, sinais de porte com fonte); filtros da mesa todos não-vazios (REVIEW 20, CONFIRMED 54, FILA 8, FALHAS 15, com_dossie 8, ai=OK 30, DUPLICADA 2, INVALIDA 1, REFERENCIA 16); carga: page=2 e page=100 do 5000 (100 páginas), busca por dígitos 99300011 → 2, combinação lookup+resolucao → 500; export do 5000: result.csv 935 KB/1,1 s, pending.csv 216 KB/0,6 s, summary.json 2,2 KB/0,5 s, excel.xlsx 922 KB/22,0 s (todos 200 + content-disposition).
- ACHADO 1 (app, pré-existente, reproduzido com probe direto): o filtro "Não encontradas" (resolucao=UNRESOLVED) devolve 0 mesmo com 10 linhas UNRESOLVED — whereResolucao("UNRESOLVED") exige identityStage { not: "LOCALIZADO" } e o `not` do Prisma EXCLUI NULL, que é o estado de toda UNRESOLVED do pipeline (engine grava resolutionState sem identityStage; as vindas de "decide none" ficam LOCALIZADO e também caem fora). Métrica totalUnresolved mostra 10 × filtro vazio: inconsistência visível na mesa. Não corrigido (escopo do Gate 2 é seed; dado deixado honesto).
- ACHADO 2 (comportamento por design): researchStatus GERANDO não sobrevive à leitura — o sweepStalled() de cada GET converteu a linha 27 (researchAt ~2 dias) para FALHOU "Pesquisa interrompida por reinício do servidor"; lote 100 terminou com FALHOU=2/GERANDO=0. Para exercitar GERANDO visível, researchAt precisa ser < 120 s no momento do teste.
- Evidências: qa/homolog-v0110/gate2/{README.md (sumário+achados), seed-100/1000/5000.log (timings), curl-lista-lotes.txt, curl-lote100-resumo.txt, curl-ficha-linha-enriquecida.txt, curl-filtros-paginacao.txt, curl-export-5000.txt, distribuicao-situacoes.txt (groupBy direto no banco)}.

Stage Summary:
- Gate 2: PASS — 3 lotes sintéticos reutilizáveis no banco vivo (100/1000/5000, ids cmvl615690000r6cnyp81o90v / cmvl615bo0000r6cz34qk2whv / cmvl615kb0000r6dcr7gw89lk) + lote de 8 do Gate 1 preservado; re-execução: `bun scripts/seed-qa-homolog.ts 100|1000|5000|all` (idempotente, determinístico, <1 s cada).
- Mesa totalmente exercitável: todo filtro de situação/pesquisa/CNPJ/IA não-vazio no lote 100, ordenação com variância real (26 pares município/UF em 10 estados, 12 setores, 15 CNAEs, capitais 50k–18,5M, aberturas 1975–2023), matriz/filial 4 raízes, nomes longos/acentuados/sufixos.
- 2 achados de app entregues para a bateria: filtro UNRESOLVED sistematicamente vazio (Prisma `not` × NULL em identityStage) e GERANDO varrido para FALHOU em leitura.
- Próximo: Gate 3 (bateria de navegador sobre o lote 100) e Gate 5 (carga com os lotes 1000/5000 — export excel do 5000 em 22 s é o candidato a alvo de performance).

---
Task ID: HOMOLOG-B (Checkpoint B — Gates 2/4/12a + correções)
Agent: Z.ai / GLM (executor único)
Task: Homologação v0.11.0 — seeds QA, matriz adversarial de identidade, correções dos bugs reproduzidos

Work Log:
- Gate 2 (agente HOMOLOG-B1): scripts/seed-qa-homolog.ts — lotes sintéticos QA-homolog-100/1000/5000 (idempotentes, CNPJs com DV válido, distribuição realista de situações, pares matriz/filial, nomes longos/acentuados). Lote 8-linhas anterior preservado. Verificado via HTTP (4 lotes na lista, filtros não-vazios). BUG encontrado: filtro resolucao=UNRESOLVED devolvia 0 com 10 linhas UNRESOLVED.
- Gate 4 (agente HOMOLOG-B3, completado após interrupção): scripts/test-homolog-identidade-adversarial.ts — 17 casos + estrutural, expectativas definidas ANTES da observação, banco isolado /tmp, simulador de fontes (zero HTTP real). Resultado inicial: 17 PASS · 1 FAIL CRÍTICO (C6: aprovação falsa de identidade por contaminação de pistas + sondas de correção bloqueadas com 409).
- Gate 12a (agente HOMOLOG-E2a): tsc completo = 96 erros/30 arquivos — src/ tinha apenas 2 (ambos B, research-batch/route.ts); 73 são falsos positivos de ambiente Bun (bun-types não referenciado no tsconfig); 21 B em scripts/ são QA legado. Schema↔DB: SEM drift (9/9 tabelas, 14 índices, validação prisma OK). Mapa de portabilidade documentado (portas 3000/3030, boot-dev.sh, DATABASE_URL absoluta é risco, ZIP sem .env — gap documentado).
- CORREÇÃO 1 (C6 crítico, src/lib/resolve/index.ts): nomes colhidos no site (JSON-LD/título/og:site_name) e no RDAP (registrante) NÃO entram mais em clues.names — eram mutação por referência que contaminava a avaliação do motor (ficha comparada contra o nome colhido na própria candidata → similaridade 1 → confirmação silenciosa). Aviso "site se apresenta como X" agora compara TODAS as pistas do usuário. Contradição de nome só existe se o usuário forneceu nome.
- CORREÇÃO 2 (C6 beco sem saída, decide/route.ts): identidade CONFIRMADA automática (resolutionConfidence !== HUMANA) agora aceita NOT_FOUND, CLUE e correção de CNPJ (fora ou dentro dos candidatos), com cnpj_automatico_anterior na auditoria e reset completo para reprocesso. Decisão HUMANA permanece fechada (é lei).
- CORREÇÃO 3 (Gate 2, imports/[id]/route.ts): filtro UNRESOLVED inclui identityStage null (Prisma 'not' excluía NULL) — 0→10 linhas no QA-100.
- CORREÇÃO 4 (Gate 12, research-batch/route.ts): 2 erros tsc (plural(r.enfileiradas ?? 0)).
- REPROVAÇÃO: Gate 4 re-executado = 18 PASS · 0 FAIL (61.7s, zero HTTP real); v01012-identidade 40/40; v0101 PASS; v01015 71/71; v01023 54/54; lint limpo; tsc src/ = 0 erros; dev server saudável (nenhum lote de teste vazou — só os 4 QA).
- Commit: 4a4202b.

Stage Summary:
- Gates 2 e 4: PASS (após correções provadas por re-execução da suíte adversarial).
- Gate 12: parcial (auditoria completa; 2 erros de app corrigidos; procedimentos seguros de evolução documentados em qa/homolog-v0110/gate12/estado-tecnico.md; ignoreBuildErrors/--accept-data-loss permanecem como dívida registrada com procedimento de retirada).
- Estado do banco vivo: 4 lotes QA (8/100/1000/5000), zero dados de operador (não existem nesta VM).
- Próximo: Gate 3 (jornada no navegador) + Gates 8/9 (subagentes em bancos isolados).

---
Task ID: HOMOLOG-D1 (Gate 8 — Relações empresariais e grafo)
Agent: Z.ai / GLM (executor único — RESEARCH/TEST, sem fixes em src/, sem commits)
Task: Bateria de validação do subsistema de relações empresariais + grafo (10 casos do contrato de produto "o grafo é visualização de FATOS já sustentados" + 4 asserções transversais) em banco isolado com fontes simuladas

Work Log:
- scripts/test-homolog-relacoes-grafo.ts (novo, autocontido, tsc: 0 erros no arquivo): padrão test-v01024 (banco isolado /tmp/homolog-gate8-relacoes.db via prisma db push; DATABASE_URL ANTES dos imports dinâmicos) + padrão gate4 (globalThis.fetch substituído por simulador que atende grafo.minhareceita.org e a cadeia de cadastro BrasilAPI, CONTA toda saída externa e BLOQUEIA URL não cadastrada — prova por construção de zero HTTP real; zero IA; handlers de rota chamados diretamente: POST /relacoes-societarias, GET /quadros, POST /expansao, POST /matriz-filiais; grafo validado com construirGrafoRelacoes/grafoTemValor — as mesmas funções que a UI usa).
- 9 lotes sintéticos (raízes 71.000.001…79.600.060, CNPJs com DV válido via cnpjFromRoot) cobrindo os 10 casos: quadro simples 3 PF; PF/PJ/INDETERMINADO (incluindo o caso real BRD id 8 dígitos); 12 participantes; participante comum D×E (mesmo lote, raízes distintas); matriz+2 filiais com confirmação de cadastro simulada; ausência (404); caches vencidos e cache pré-v0.10.16 com classificação errada; quadro com unificação de registros; quadro de 60 empresas. Tabela ESPERADO redigida do contrato ANTES da observação.
- Resultado (3 execuções, determinístico, exit 1): 101 PASS / 2 FAIL — 10/10 casos contratuais PASS, transversal T1-T4 15/15 PASS; os 2 FAIL são as provas intencionais dos bugs (X1.1=G8-1, X2.2=G8-3).
- Contrato PROVADO: reabertura de relações via=cache com ZERO HTTP e coletadoEm original; classificação pela semântica do IDENTIFICADOR (hash=PF, CNPJ+DV=PJ, resto=INDETERMINADO — nome nunca decide, lição v0.10.16 intacta); expansão de INDETERMINADO recusada 422 sem HTTP; 12 participantes estáveis (sequência idêntica consulta→cache) com desenho limitado a 8 nós; participante comum visível em AMBAS as fichas com nota "NÃO caracteriza grupo econômico" e SEM aresta empresa↔empresa no grafo (compartilhado liga participante→empresa; única menção a "grupo" é a negação); matriz/filiais pelo campo OFICIAL (nunca ordem 0001), filiais amarradas à raiz (arestas mesma-empresa→raiz, nenhum nó de filial, nenhuma ligação filial↔filial), EstabelecimentoRootCache por raiz e 2ª rodada via=cache 0 HTTP sem duplicar; ausência honesta 200 com aviso e mapa INTENCIONALMENTE ausente (sinal de "nada útil": totalParticipantes=0 + quadros={} → grafoTemValor=false → GrafoRelacoesCard null); TTL 30d: vencido→revalidação com NOVA coleta, válido→reuso 0 HTTP; migração à leitura v0.10.16 regrava INDETERMINADO sem reconsulta; avisos de unificação do quadro preservados nas 3 vias (consulta, releitura de expansão, GET /quadros) + fallback de teto rederivado para linha antiga truncada (e nenhum aviso inventado sem truncamento).
- TRANSVERSAL: 13 leituras de cache com ZERO saída externa (13/13); 31 saídas simuladas totais, todas atendidas pelo simulador; nenhum CPF (nem mascarado) em nenhum corpo de resposta; participantes expõem apenas campos de vínculo (whitelist provada em 28 participantes de 7 lotes; qualificação só por reuso do cadastro, origem="cadastro"); "grupo" em rótulos de aresta só existe na negação explícita.
- BUGS documentados com reprodução exata (NÃO corrigidos — escopo do gate): G8-1 [MÉDIO] avisos de normalização de RELAÇÕES (linha sem id descartada / participante sem nome / indeterminado) somem na releitura de cache — investigarRelacoes persiste só participantes e RelacaoSocietariaCache não tem avisosJson (a correção v0.10.24 cobriu apenas QuadroParticipanteCache; viola o princípio declarado na própria v0.10.24); G8-3 [MÉDIO] empresasOcultas errado na releitura de cache da expansão — investigarConexao (service.ts caminho de cache) calcula com a lista CHEIA em vez da fatia exibida (quadro de 60: consulta=10 ocultas, releitura=0, GET /quadros=10 — duas leituras da MESMA linha divergem); G8-2 [BAIXO/comportamento] ausência (404) não é cacheada, mas a resposta anuncia validoAte de 30d sem persistência por trás (cada comando reconsulta; contrato de consulta sob comando respeitado, validade anunciada enganosa).
- Evidências: qa/homolog-v0110/gate8/relatorio.txt (matriz 10 casos | esperado×observado×PASS/FAIL, transversal, bugs com reprodução, detalhe por caso) e relatorio.json (estruturado). Banco /tmp removido ao final; dev server :3000 e resolve-service :3030 verificados saudáveis (200/200) depois da bateria; db/custom.db intocado; nenhum arquivo de src/ modificado; nenhum commit.

Stage Summary:
- Gate 8: casos contratuais 10/10 PASS e transversal 15/15 PASS, mas GATE REPROVADO no conjunto por 2 bugs MÉDIOS de procedência descobertos nas provas adjacentes (G8-1 e G8-3) + 1 achado BAIXO (G8-2) — todos com reprodução exata no relatório. Correção é decisão do Planner: G8-1 exige coluna avisosJson em RelacaoSocietariaCache (mudança de schema); G8-3 é um fix pontual no cálculo do caminho de cache de investigarConexao.
- Re-execução: bun scripts/test-homolog-relacoes-grafo.ts (exit 1 hoje pelas provas X1.1/X2.2; passa a 0 quando G8-1 e G8-3 forem corrigidos).
- Lição v0.10.16 confirmada em produção: participante comum não prova grupo econômico — nenhum lugar do subsistema (rotas, service, grafo) cria aresta/afirmação de grupo; o termo só existe para negar.

---
Task ID: HOMOLOG-D2 (Gate 9 — Exportações sob estresse)
Agent: Z.ai / GLM (executor único — RESEARCH/TEST, sem fixes em src/, sem commits)
Task: Bateria de estresse das exportações (CSV result/selected/review/confirmed/teia/ai/pending/summary/audit, Excel 6 abas, PDF empresa executivo+completo, PDF lote) — 12 cenários × 3 formatos, cada artefato REABERTO e conferido, com guarda de rede provando zero HTTP/IA

Work Log:
- scripts/test-homolog-exportacoes-estresse.ts (novo, ~1.250 linhas, autocontido): padrão test-v01024 (banco isolado /tmp/homolog-gate9-export.db: fresh DB → DATABASE_URL → prisma db push --skip-generate → imports dinâmicos DEPOIS do env; db/custom.db intocado) + REGRA DE OURO por construção: globalThis.fetch substituído por guarda que REGISTRA e lança erro alto em qualquer HTTP durante TODA a suíte (0 chamadas ao final — exports 100% do banco) + RESOLVE_SERVICE_URL apontado para porta não roteável como cinto extra. Handlers GET/POST da rota de exportação chamados diretamente (NextRequest in-process), reutilizando scripts/lib/pdf-inspecao (texto por página com Y) para provar layout por extração + pdftoppm para render visual.
- Lote de casos (26 linhas, raízes 11.111.111…93.939.393, CNPJs com DV válido): C1 mínima (só identidade) · C2 32 sócios · C3 28 CNAEs secundários · C4 12 estabelecimentos da mesma raiz (matriz+11 filiais) · C5 12 participantes de grafo (1 nome repetido no QSA → dedupe; quadros em cache: PF com 9 empresas/3 raízes e PJ com 2; participante compartilhado entre a linha 17 e a matriz da rede) · C6 razão de 312 chars · C7 acentos ÇÃÉÕ + aspas/ponto-e-vírgula + injeção de fórmula (= + - @ em células originais, referência e razão social) · C8 contatos vazios · C9 REVIEW/LOCALIZADO com 2 divergências · C10 referência UNRESOLVED + CNPJ NAO_ENCONTRADO · R25 VALIDADO e R26 leitura IA (anexo E). Lote de carga 2000 (1.780 PENDENTE + 180 CORRESPONDENTE + 20 LOCALIZADO em revisão + 10 NAO_ENCONTRADO + 10 RATE_LIMITED; createMany em blocos de 500, 149 ms).
- Verificação por reabertura: CSV parseado (BOM UTF-8 + delimitador + quoting round-trip de aspas/;ponto-e-vírgula + escape de = + - @ com apóstrofo); Excel relido com ExcelJS (abas, cabeçalhos, contagens, richText anti-fórmula, datas Date, capital número R$, numFmt @ no CNPJ); PDFs com TODAS as páginas extraídas (título órfão, página >90% vazia, conteúdo invadindo rodapé y≤42, ressalvas repetidas por seção, texto cortado, dados da empresa CERTA — nome longo/acentuada sem contaminação cruzada de CNPJ).
- RESULTADO: 191 PASS · 5 FAIL · 3 WARN (exit 1 — os FAIL são as provas dos bugs abaixo). REGRA DE OURO: 0 chamadas HTTP na suíte inteira. Volume: CSV 2000 = 118 ms/301 KB; Excel 2000 = 4,5 s/343 KB (aba Lacunas incluída — 2.000 triagens); pdf_lote 2000 = 413 PDF_LIMITE orientando Excel (recusa ANTES, nunca documento incompleto); pdf_lote EM_REVISAO (20 linhas) = 228 ms íntegro.
- 5 BUGS documentados com reprodução exata (NÃO corrigidos): F1 [pdf.ts:788] pdf_lote lista empresa NAO_ENCONTRADA na seção EMPRESAS IDENTIFICADAS (filtro !emRevisao && cnpjFormatado, mas dataset.ts:400-405 preenche cnpjFormatado com o CNPJ PESQUISADO mesmo sem ficha — bullet '- CNPJ 92.929.292/0001-60' sem nome); F2 [excel.ts:213] aba Empresas rotula a mesma linha NAO_ENCONTRADO como "ENRIQUECIDO" (fallback l.cnpjFormatado ? "ENRIQUECIDO" : ""); F3 [route.ts:92] CSV result corta socios_qsa em 12 sócios EM SILÊNCIO (qtd_socios diz 32; teia exporta os 32 — corte não anunciado); F4 [pdf.ts:302-310] título de seção órfão: bullets() faz flushTitulo(primeira fatia) ANTES do garante do grupo inteiro — 'NOTAS DE LEITURA' fica sozinha no pé da p1 do pdf_lote SELECIONADAS rows=3,18,19 com os 4 bullets na p2 (classe de defeito que a v0.10.18 dizia eliminada); F5 [route.ts:502] CSV type=ai perde TODAS as hipóteses — guarda safeArray(aiHypothesesJson) filtra arrays de strings (só aceita objetos), safeHypotheses nunca executa; engine grava string[] (engine.ts:1586/ai.ts:467), coluna hipoteses_a_validar sempre vazia (dado existe: aparece no anexo E do PDF).
- 3 AVISOS: CNAEs secundários ausentes de CSV result e Excel (só o PDF completo os lista — dado existe em extraJson e a planilha não transporta); pdf_empresa de não encontrado não declara a falha (l.erro nunca é desenhado; título vira o CNPJ consultado; 'Atualizado em ' com data vazia); pista original maliciosa não entra no pdf_empresa quando a linha tem CNPJ (inerte em PDF, mas o dossiê não mostra a origem).
- Confirmações fortes: anti-injeção CSV (todos os = + - @ escapados com ') e Excel (richText, type≠Formula) ÍNTEGROS; acentos ÇÃÉÕ intactos nos 3 formatos; nome de 312 chars completo em CSV/Excel/PDF (quebra por palavra, sem corte); contagem por RAIZ coerente em todos os formatos (12 estabelecimentos = 1 empresa; 13 raízes); revisão honesta em todos (aviso na abertura do PDF, aba Revisões no Excel, result_review exato, exclusão do result_confirmed); seleção por rows= EXATA nos 3 formatos + POST byte-a-byte idêntico + recusas NO_SELECTION/SELECAO_ACIMA_DO_LIMITE(413)/BAD_ROW/NOT_FOUND/BAD_TYPE corretas; dedupe participante QSA×grafo funcionando (13 vínculos, sem duplicar); executivo 1–2 páginas sem anexos apontando 'PDF completo'; IA rotulada como hipótese.
- Evidências: qa/homolog-v0110/gate9/{relatorio.txt (matriz cenário×tipo×categoria + bugs + tempos), relatorio.json (199 checks estruturados), casos/ (24 artefatos: 12 PDFs de empresa + 3 PDFs de lote + 2 Excel + 7 CSV/JSON + 34 PNGs de render), carga2000/ (5 artefatos)}. Dev server :3000 e resolve-service :3030 verificados saudáveis após a bateria; db/custom.db intocado (mtime anterior à execução); nenhum arquivo de src/ modificado; nenhum commit.

Stage Summary:
- Gate 9: REPROVADO no conjunto — 5 bugs reais encontrados (F1/F2 honestidade de "não encontrado" em PDF lote e Excel, F3 corte silencioso do QSA no CSV, F4 título órfão de paginação, F5 perda silenciosa das hipóteses no CSV de inteligência); o núcleo comercial (anti-injeção, acentos, integridade de nomes longos, contagem por raiz, seleção, revisão, volume e limites) passou integralmente, e a regra de ouro (zero HTTP/IA na exportação) está provada por guarda de fetch.
- Re-execução: bun scripts/test-homolog-exportacoes-estresse.ts (exit 1 hoje pelas provas F1–F5; passa a 0 quando os 5 bugs forem corrigidos).
- Prioridades sugeridas ao Planner: F5 e F3 são perda de dados em colunas que o comercial consome (fix pontual no route.ts); F4 é layout comercial (flushTitulo depois do garante em bullets()); F1/F2 são honestidade de estado (cnpjFormatado só deveria representar ficha coletada, ou o filtro deveria exigir razão social).

---
Task ID: HOMOLOG-E1 (Gate 11 — Testes de carga e desempenho)
Agent: Z.ai / GLM (executor único — medição de desempenho, zero fixes em src/, zero novas dependências, zero commits)
Task: Medir desempenho real (dev server :3000) sobre os lotes sintéticos 100/1000/5000 via HTTP (curl com time_total, concorrência=1, sem browser para não distorcer o agente paralelo na UI), documentando gargalos e memória — sem corrigir nada.

Work Log:
- Metodologia: 103 requisições HTTP sequenciais (pausa 0,3 s) contra os mesmos endpoints GET que a UI usa; 3 reps por leitura (mediana), exports 2×, import 1×; condições registradas por fase (uptime, free -m, RSS do next-server e do resolve-service). Zero chamadas externas/IA; db/custom.db só leitura + 1 lote temporário criado e apagado.
- LISTA/PAGINAÇÃO (GET /api/imports/{id}?page&pageSize=50): medianas 60–123 ms em TODAS as páginas dos lotes 100/1000/5000 (página 1, 2 e última) — plano com o volume; payload ~128 KB/página de 50.
- BUSCA (q=): CNPJ por dígitos e nome descobertos via API (ex.: "Serra Verde" = 2 hits; raízes 991/992/993): medianas 53–93 ms em 100/1000/5000 — LIKE contains segura 5000 linhas sem esforço.
- FILTROS: resolucao=CONFIRMED/REVIEW/UNRESOLVED e lookup=ENRIQUECIDO/FILA/FALHAS em 1000 e 5000: medianas 58–128 ms — também plano (resultado vazio custa o mesmo que cheio: custo fixo por request domina).
- FICHA: não há endpoint row-detail — a ficha renderiza no cliente das linhas do batch GET (medido: 49–80 ms via q=); análogo per-row GET /rows/{n}/triagem: 702 ms FRIO (compilação dev da rota) → 41–54 ms quente.
- NAVEGAÇÃO 10 fichas sequenciais (linhas 1→10, triagem per-row): soma HTTP 355 ms (16–60 ms/linha quente; wall 3,5 s inclui pausas de pacing) — aquecimento de cache visível e benigno.
- EXPORTS: CSV result@5000 = 636 ms/935 KB (confortável); **Excel@5000 = 12,8 s mediana (10,5–15,0 s; baseline anterior 22 s) + pico de ~+800 MB de RSS por chamada** — RAM livre caiu a 273 MB numa caixa de ~4 GB sem swap (pico RSS next-server 2,41 GB), GC devolveu a ~1,49 GB em ~1–2 min; pdf_lote@5000 recusa 413 correta em 881 ms; @100: pdf_lote 121 ms, pdf_empresa 72 ms, Excel 1,13 s.
- IMPORT 100 linhas: contrato do POST /api/imports/text verificado EM FONTE antes (cria PREVIEW, sem auto-processamento, sem rede) → POST 219 ms (parse+arquivo+insert+audit), polls +1 s/+3 s PREVIEW/processingNow=false, DELETE 16 ms com audit em cascata e arquivo de upload removido — DB voltou a exatamente 4 lotes. POST→DONE NÃO medido: exigiria confirm+process (chamadas externas, proibido); timestamps createdAt→finishedAt dos lotes sintéticos são SEMEADOS (deltas exatos +30 min/+1 h/+2 h) e foram documentados como não-medida.
- MEMÓRIA: next-server RSS 1,43 GB início → 2,41 GB pico (2× Excel 5000) → 1,49 GB final (+66 MB líquido = sem vazamento); resolve-service estável ~40 MB do início ao fim.
- ESTABILIDADE: 102×200 + 1×413 esperado, ZERO 5xx/timeouts; dev.log (últimas 50 linhas) sem stack trace nem [api] INTERNAL; dev server e resolve-service saudáveis ao final.
- Limitação declarada: tudo medido em `next dev` (sandbox proíbe next build) — overhead dev de 2–78 ms/request visível no dev.log; comparação de produção pendente na máquina do Planner (repetir pelo menos lista 5000, Excel 5000 e pico de RSS).
- Evidências: qa/homolog-v0110/gate11/{desempenho.md (relatório humano com veredito por categoria), medicoes.json (103 amostras + medianas + memória por fase), raw-samples.tsv, raw-memory.tsv, perf-import-payload.json}. Nenhum arquivo de src/ modificado; nenhum commit.

Stage Summary:
- Gate 11: leitura (lista/busca/filtro/ficha/navegação) CONFORTÁVEL até 5000 linhas em dev (medianas 53–128 ms, plano com o volume); import parse+insert confortável (219 ms/100 linhas); estabilidade perfeita (0 erros em 103 requisições).
- Gargalo nº 1 (único veredito DEGRADADO): export Excel de lote 5000 = 12,8 s + ~800 MB de RSS transitório por chamada (RAM livre 273 MB no pico, sem swap) — recomendação ao Planner: streaming/geração incremental ou limite explícito como o PDF já faz; gargalo nº 2: risco de memória em caixa pequena (dev-server parte de 1,43 GB); gargalo nº 3: custo fixo O(lote) por GET (recomputeCounters + ~17 agregações batch-wide — indolor ≤5000, cresce com volume).
- Pendência para produção: revalidar os números contra next build na máquina do Planner antes de fixar SLA (dev = teto pessimista para rotas, retrato parcial para Excel).

---
Task ID: HOMOLOG-D3 (Gate 10 — Testes de falha e recuperação)
Agent: Z.ai / GLM (executor único)
Task: Introduzir falhas CONTROLADAS (fontes, dados, servidor) e verificar recuperação coerente nos 12 cenários do contrato de homologação v0.11.0 — documentar tudo; corrigir apenas bugs pequenos e prováveis, pendências materiais ficam documentadas.

Work Log:
- Retomada de sessão interrompida: scripts/test-homolog-falhas-recuperacao.ts e scripts/gate10-live-restart.ts existiam com a parte isolada já executada (relatório só com PARTE 1), mas o cenário 9 REAL (restart do dev server) nunca foi verificado/mergeado e o cenário 12 não constava — a fase ao vivo foi refeita do zero nesta sessão, com 3 correções no script-irmão de teste (ver abaixo).
- PARTE 1 — scripts/test-homolog-falhas-recuperacao.ts (self-contained): banco ISOLADO /tmp/homolog-gate10-falhas.db (padrão test-v01024: DATABASE_URL antes dos imports dinâmicos, prisma db push, banco /tmp removido ao final — db/custom.db intocado); globalThis.fetch substituído por simulador que CONTA toda saída e BLOQUEIA host não cadastrado (prova estrutural de ZERO HTTP real: 84+ saídas simuladas); handlers de rota chamados in-process com NextRequest. 104 PASS · 0 FAIL em ~105 s.
- C1–C4 (429/500/timeout/conexão interrompida em TODAS as fontes): estado final honesto (RATE_LIMITED para 429/5xx/timeout por degradação de backoff; ERRO_REDE para rede), retryCount=3 (teto MAX_RETRIES do run — sem martelada), 3× LOOKUP_FAIL na auditoria (uma por rodada), telemetria preserva a causa REAL da 1ª rodada (httpStatus=429/500, "Timeout após 8s", 12× "conexão interrompida"), linha controle ENRIQUECIDO intocada através da falha (ficha+datas preservadas), rota de retry aceita (EM_FILA, rc=0, audit ROW_RETRY) e pós-recuperação a linha fica ENRIQUECIDO com o controle ainda intocado.
- C5 (dado incompleto): 200 SEM razao_social → INVALID_RESPONSE e fallback para a fonte seguinte (linha ENRIQUECIDO pela fonte válida, nunca ficha quebrada); ficha PARCIAL na primária → complementação seletiva (e-mail/QSA pela OpenCNPJ, identidade estável, proveniência em fontesJson.complementacoes + audit "complementado_por") sem martelada (2 consultas, cauda não consultada sem lacuna preenchível).
- C6 (JSON inesperado): corpo NÃO-JSON em todas as fontes → ERRO_REDE com mensagem do parser, ZERO ficha inventada (legalName/rawJson null), 12 tentativas telemetrizadas, retry+recuperação funcionam; JSON de forma errada → ERRO_SERVIDOR "Resposta sem razao_social".
- C7 (resposta atrasada): fontes a 9s honrando AbortSignal (teto do motor 8s/fonte) → linha TIMEOUT nas 3 rodadas (~96 s), 12 pacotes tardios ENTREGUES ao transporte e NUNCA consumidos (json() 0×) — estado estável, nada sobrescrito; revalidação com todas as fontes em 500 → 502 REVALIDACAO_FALHOU com ficha ANTERIOR restaurada byte-a-byte pelo snapshot (audit REVALIDACAO_FALHOU com ficha_anterior_preservada).
- C8 (comando duplicado): single-flight (src/lib/single-flight.ts) provado em 3 níveis — unitário (2 chamadores → 1 execução, 1 líder, chave liberada sem cache negativa), lookupCnpjComCache (1 fetch à primária, ficha 1×, telemetria 1×) e rota de relações duplo-clique (1 fetch ao grafo + 1 /updated compartilhado, ambas 200 ok, telemetria via=consulta E via=coalescido, cache 1×).
- C10 (lote interrompido): estado pós-crash por update direto (ENRIQUECIDO / RATE_LIMITED rc=1 / PENDENTE, lote PARTIAL) + "Concluir pendências" (POST /process) disparado DUAS vezes concorrente → 1 started + 1 already_running; retomada processa SÓ as linhas 2–3 (linha concluída: 0 fetch, queriedAt/collectedAt intactos, 0 eventos novos); lote DONE com totalEnriched=3 e auditoria íntegra (1× PROCESS_START/PROCESS_END da retomada).
- C11 (falha na exportação): headerJson corrompido, originalCellsJson corrompido (quebra no MEIO), pdf_lote acima do limite e lote inexistente → SEMPRE JSON {ok:false, error.code+message}, nunca content-disposition, sem mágica de arquivo no corpo, nenhum arquivo parcial em download/; contraste saudável 200 com attachment. Nota (não bloqueante): exportações FALHADAS não geram evento de auditoria EXPORT.
- C9 PRÉ-PROVA in-process: lote PROCESSING com lease EXPIRADO + linha CONSULTANDO zumbi; 2 sweeps concorrentes → EXATAMENTE 1 retomada (claim atômico via lease), linha reprocessada para estado coerente, audit RECOVERY_RESUME.
- C9 REAL (ao vivo, banco VIVO): scripts/gate10-live-restart.ts em fases — setup criou QA-gate10-restart.txt (5 linhas: CONSULTANDO zumbi, PENDENTE, EM_FILA, ENRIQUECIDO concluída, RATE_LIMITED rc=3; lease EXPIRADO, leaseOwner=zombie-worker-gate10); restart REAL autorizado (date > /tmp/gate10-restart-at.txt; pkill next dev/next-server; bun run dev; poll 200 em ~4 s); verificar (16 checks PASS) e limpar (DELETE pela rota oficial, banco de volta a EXATAMENTE os 5 lotes originais). Resultado: RECOVERY_RESUME com timestamp POSTERIOR ao pkill (executado pelo processo pós-restart, na primeira requisição autorizada), zero zumbi (nenhum PROCESSING/CONSULTANDO/PENDENTE/EM_FILA), linha concluída preservada byte-a-byte, linha no teto de retries NÃO retomada automaticamente (retry manual disponível — custo sob comando), contadores coerentes (totalEnriched=1, totalPending=1 = a linha no teto), telemetria 12 (3 CNPJs sintéticos inexistentes × 4 fontes públicas gratuitas — todas 404 honesto; zero IA, zero pago), 2º GET serve o lote recuperado.
- NOTA DE AMBIENTE (C9): o sandbox tem um monitor de UI que navega o app a cada ~30 s (POST /api/worker/tick na carga da página, confirmado no dev.log) — o zumbi é varrido pela primeira requisição pós-restart, às vezes antes do GET do script. Exigir zumbi intacto ao ler o banco seria testar o timing do monitor, não o produto: a prova de "recuperação sob demanda, não no boot" é estrutural (sweepStalled só é chamado por rotas API — GET /api/imports/[id] e POST /api/worker/tick; nenhum instrumentation/boot hook) + timing da auditoria (RECOVERY_RESUME > criação do zumbi E > pkill).
- C12 (preferências de UI através do restart): chaves scout360.ui.v1 e scout360.mesa.paineis.v2 idênticas pré/pós restart no código-fonte E no bundle compilado servido (chunk confirmado por HTTP 200 contendo as chaves); hidratação tolerante (lerPrefs try/catch → PADRAO — prefs antigas/corrompidas não quebram o app); estrutura PrefsUi estável com restaurarPadrao; localStorage é estado do NAVEGADOR (nenhuma rota de API lê/escreve essas chaves — imune ao restart por construção).
- CORREÇÃO G10-2 (pequena, provada — única mudança em src/): a mensagem de "pulada por backoff" citava sempre "429 recente" mesmo quando o cooldown veio de 5xx/timeout. Fix em src/lib/enrich/sources.ts: mapa __cnpjSourceBackoff agora guarda {until, motivo} e as duas mensagens de pulo citam motivoBackoff(fonte) — a causa REAL (429 | erro <status> | timeout). Semântica de estado, durações de cooldown e errorType inalteradas (só o texto ficou honesto). Regressão permanente nos cenários 1–3 do script (3 checks novos).
- ACHADO PENDENTE G10-1 (baixo, material — documentado, NÃO corrigido): fonte que responde 200 com corpo não-JSON é classificada como NETWORK_ERROR/ERRO_REDE (o catch de res.json() em fetchJson cai no mesmo bucket da falha de rede) e a mensagem é o erro bruto do parser; INVALID_RESPONSE/ERRO_SERVIDOR seria mais preciso, mas mudar o mapeamento de estado altera a semântica de retry — fica como pendência. REPRO: cenário 6a do script.
- Correções nos scripts DE TESTE durante o gate (não afetam produto): caminho do bundle em dev Turbopack (.next/dev/static/chunks — antes olhava .next/static/chunks que não existe em dev, cenário 12 falhava em falso); expectativa de totalPending no C9 (1 = linha no teto de retries aguardando comando humano, não 0); check de "zumbi intacto" redesenhado para prova estrutural+timing (premissa antiga era invalidada pelo monitor de UI do sandbox).
- Consultas externas reais no gate inteiro: apenas as 12 do cenário 9 live (CNPJs sintéticos inexistentes, 404 honesto nas 4 fontes públicas gratuitas). Zero IA, zero serviço pago, zero e-mail.
- Evidências: qa/homolog-v0110/gate10/relatorio.txt (matriz cenário|feito|esperado|observado|veredito com TODOS os checks, correções e achados) + relatorio.json (estruturado, merge das duas partes). Ambiente final: dev server :3000 RODANDO (GET / = 200), resolve-service :3030 intocado e respondendo, db/custom.db com EXATAMENTE os 5 lotes originais (zero QA-gate10-*), /tmp limpo dos artefatos do gate. Nenhum commit; única alteração em src/ é o fix G10-2 (+24/−12 em sources.ts).

Stage Summary:
- Gate 10: APROVADO — 125 PASS · 0 FAIL nos 12 cenários (+1 prova estrutural de zero HTTP real na parte isolada): 104 na parte isolada (cenários 1–8, 10, 11 + pré-9), 16 no cenário 9 ao vivo, 9 no cenário 12.
- Recuperação provada em camadas: (1) retry automático com teto (MAX_RETRIES=3) + backoff por fonte com mensagem honesta; (2) retry por linha sob comando (rota aceita estado de falha, rc=0, auditoria); (3) sweep de restart com claim atômico (lease) — zumbi recuperado coerentemente, dado concluído preservado, linha no teto aguarda humano; (4) voo único absorve duplo clique em todos os níveis. Invariantes de integridade: falha nunca apaga ficha válida, resposta tardia nunca sobrescreve estado mais novo (AbortController + snapshot-restore), exportação falha nunca serve arquivo parcial.
- 1 bug pequeno corrigido com regressão (G10-2 — mensagem de backoff cita a causa real: 429/erro <status>/timeout); 1 pendência documentada (G10-1 — parse falho classificado como ERRO_REDE em vez de INVALID_RESPONSE, mudança material de mapeamento); 1 lacuna de rastreio anotada (exportações falhas sem evento de auditoria EXPORT).
- Re-execução: bun scripts/test-homolog-falhas-recuperacao.ts (~105 s, isolado) e bun scripts/gate10-live-restart.ts setup|verificar|limpar com o restart autorizado entre setup e verificar (comando exato, incluindo a gravação do timestamp do pkill, é impresso pelo setup).

---
Task ID: HOMOLOG-F (Checkpoint F — entrega final da homologação v0.11.1)
Agent: Z.ai / GLM (executor único)
Task: Consolidação final — regressões, versão 0.11.1, ZIP sanitizado, relatório dos 13 gates

Work Log:
- Regressões finais verdes: v0101 · v01012 40/40 · v01015 71/71 · v01010 18/18 (afetada pela fix G10-2) · gate4 18/18 · gate10 125/125 · lint 0 · tsc src/ 0 erros · dev server saudável.
- Gate 7 (validação estrutural na UI pós-mudanças): seção "Investigar esta empresa" em linha enriquecida (sabemos com fonte/data → o que merece validação → consultas sob comando); plano de consultas com contrato "custo visível antes de aprovar, nada executa sozinho" (H7-01..03). Agrupamento/aprovação individual intocados nesta rodada (provados na v0.11.0).
- Gate 12b: .env.example criado + LEIA-ME atualizado ("cp .env.example .env" antes do install — fresh clone falhava no db:push).
- Gate 13 (Folder Z.ai): VERIFICADO PARCIALMENTE — mounts ossfs (/home/sync, upload/) graváveis, legíveis e íntegros na VM (SHA-256 estável na releitura); o "Folder 2GB" não é identificável como mount; acesso por outra conversa não é verificável de dentro desta conversa. VEREDITO: descartado como canal de checkpoint nesta rodada — ZIP+SHA-256 via preview continua sendo o canal.
- Versão: package.json 0.11.0 → 0.11.1; CHANGELOG.md com a rodada completa de homologação.
- build-zip.sh: .env.example entra no kit (allowlist explícita na verificação de vazamentos).
- ZIP sanitizado v0.11.1: dist/Senior-Scout-360-kit-dev.zip · 437 arquivos · 11 MB · SHA-256 419809628ea515d35f3e96874b058549e14f93800808dca090fd0ad7c72b4034 · copiado para public/ (download via Preview, header X-Robots-Tag presente) · verificação unzip -t OK · 0 segredos/bancos/worklog.
- Banco vivo: mantido com os 5 lotes sintéticos (8/100/1000/5000 + lote da jornada) — TODO sintético, nenhum dado de operador existe nesta VM; backup pre-homolog em qa/homolog-v0110/backup-banco-pre-homolog.db se o Planejador preferir reverter.
- Commits da rodada: 5a0eccc (Gate 1) → 4a4202b (Gates 2/4) → 6251edf (Gates 8/9) → fe6e948 (Gates 3/6) → 8e1feec (D–F) → build-zip → HEAD.

Stage Summary:
- MATRIZ 13 GATES: G1 PASS · G2 PASS · G3 PASS · G4 PASS (18/18) · G5 PASS · G6 PASS COM RESSALVAS (1366×768 = 4 linhas, limite físico documentado) · G7 PASS COM RESSALVAS (estrutural nesta rodada + profundo na v0.11.0) · G8 PASS (103/103; G8-2 pendente) · G9 PASS (196/196) · G10 PASS (125/125; G10-1 pendente) · G11 PASS COM RESSALVAS (Excel@5000 degradado: 12.8s + pico memória) · G12 PASS COM RESSALVAS (dívidas documentadas com procedimento) · G13 NOT VERIFIED (parcial: VM-side ok, cross-conversa impossível daqui).
- 13 correções de bugs provados por re-execução de suíte: contaminação de pistas (crítico), beco sem saído em CONFIRMADA automática, filtro UNRESOLVED, contadores Identificadas/Pendentes, F1-F5 exportações, G8-1/G8-3 relações, G10-2 backoff, .env/LEIA-ME.
- Pendências para o Planejador: G8-2 (ausência não cacheada), G10-1 (200 não-JSON → ERRO_REDE), ignoreBuildErrors/--accept-data-loss (procedimento pronto), Excel@5000 streaming/limite, densidade de linha opcional p/ 768px, Folder cross-session.

---
Task ID: CONSOL-0
Agent: Z.ai / GLM (executor único)
Task: MISSÃO DE CONSOLIDAÇÃO v0.11.1 — Gate 0 (reconciliação obrigatória)

Work Log:
- HEAD vivo = 18ddc971d6b9d59af6b8d30ebef21b48a74c3c25 — IDÊNTICO ao snapshot de referência. Versão 0.11.1. Árvore Git limpa (0 arquivos modificados). Único escritor.
- Dados persistentes: db/custom.db (831 KB, schema ≡ prisma — drift zero provado na homologação anterior). Contém APENAS lotes QA sintéticos (QA-mesa-sintetico 8 + QA-homolog 100/1000/5000). Dados do operador NÃO existem nesta VM; nenhum backup adicional recuperável (nenhuma restauração feita — nada a restaurar).
- ZIP anexo scout360_contexto_integracao_segura_20261025.zip: NÃO PRESENTE nesta VM (busca global sem resultado). Consequência: manifestos/patches v0.10.25/v0.10.28 indisponíveis como referência direta — comportamentos do Gate 4 serão implementados a partir da DESCRICÃO do contrato desta missão + modelo de relações já homologado na v0.11.1 (ParticipanteView/QuadroView/RelacaoSocietariaCache/QuadroParticipanteCache). Registrei como limitação (não bloqueia: os patches falharam em git apply --check e foram proibidos de qualquer forma).
- Segurança (sem imprimir conteúdo): .env RASTREADO pelo Git (git ls-files confirma; histórico desde Initial commit 05f6017) — contraria o .gitignore (linha 25). Conteúdo real: APENAS DATABASE_URL (50 bytes, SQLite local file:/home/z/my-project/db/custom.db). NENHUM padrão de credencial (sk-/token/secret/password) no .env. .env.example contém só placeholders COMENTADOS (# SCOUT_EXPORT_TOKEN=...). RISCO REAL DE SEGREDO: INEXISTENTE. Exposição residual: caminho do banco. Correção recomendada (DECISÃO DO PLANEJADOR, não executada): git rm --cached .env + passo de setup do .env no LEIA-ME (remover do tracking SEM o passo quebraria clone limpo — worklog HOMOLOG-E2a: db:push falha sem .env). Reescrita de histórico NÃO necessária (nenhum segredo no histórico).
- Dívidas operacionais registradas: ignoreBuildErrors: true (next.config.ts) e db:push --accept-data-loss (package.json db:push) — a tratar antes de qualquer publicação; procedimentos seguros já documentados em qa/homolog-v0110/gate12/estado-tecnico.md.
- Reconciliação de funcionalidades: CompanyDossier JÁ TEM SheetTitle+SheetDescription sr-only (linhas 4212-4215). PessoaDossieSheet NÃO EXISTE nesta árvore (será Gate 4). Carteira/recuperação (commit 45bd21b) NÃO existe aqui — não será declarada nem recriada incidentalmente.
- Separação: CORREÇÃO = erros tsc B em research-batch/route.ts (2, documentados em HOMOLOG-E2a) + defeitos que a auditoria de console revelar; ADAPTAÇÃO UX = Gate 2 (mesa/dossiês: hierarquia, blocos, largura do painel, linguagem); FUNCIONALIDADE NOVA = PDF v4 (Gate 3), investigação reversa de pessoas (Gate 4), estudo Observatório B2B (Gate 5, só estudo).
- Arquitetura do Gate 4 confirmada SEM mudança material: caches RelacaoSocietariaCache (por CNPJ) e QuadroParticipanteCache (por participanteId) são batch-agnósticos e já persistidos — agregação de pessoas do lote é leitura pura destes caches + linhas do lote. Zero nova consulta externa, zero schema change.

Stage Summary:
- Gate 0: PASS — identidade do código confirmada (HEAD=snapshot), dados íntegros (só QA), limites conhecidos, risco de segredo INEXISTENTE (.env só caminho local), ZIP de referência ausente registrado, dívidas catalogadas, separação correção/UX/nova funcionalidade definida.
- Próximo: Gate 1 (auditoria de console/acessibilidade no navegador + fix dos 2 erros tsc B + regressões direcionadas).

---
Task ID: CONSOL-0b (correção do Gate 0)
Agent: Z.ai / GLM (executor único)
Task: Correção do registro CONSOL-0 — estado REAL dos dados persistentes

Work Log:
- CORREÇÃO: o banco db/custom.db atual NÃO contém os lotes QA sintéticos da homologação anterior (8/100/1000/5000). O banco foi REESCRITO após o boot da VM (19:03): contém 2 lotes "Dados colados" criados HOJE pelo operador (19:05 e 19:19), cada um com 1 linha:
  - imp_mvo77ar5_buoc9m "banco do brasil" → BANCO DO BRASIL SA, CNPJ 00.000.000/0001-91, tradeName DIRECAO GERAL, ATIVA, AI OK, research OK, 41 sócios — é a MESMA empresa da análise de PDF da missão (v3 "DIRECAO GERAL" antes de "BANCO DO BRASIL SA").
  - imp_mvo7objb_cogv0d "caixa" → CAIXA ECONOMICA FEDERAL, CNPJ 00.360.305/0001-04, tradeName CEF MATRIZ, ATIVA, researchStatus GERANDO.
- Estes 2 lotes são DADOS DO OPERADOR: preservação integral (nenhuma deleção, nenhum db push). Lotes QA são RE-SEEDÁVEIS por script idempotente (scripts/seed-qa-homolog.ts, seed-qa-mesa-sintetico.ts) — nenhuma perda.
- Guarda de dados para o resto da missão: TODAS as suítes de teste continuam em bancos isolados /tmp; o banco :3000 do operador só recebe os re-seeds sintéticos aprovados (arquivos QA-*), nunca deleção.
- Sem backup dos lotes QA necessários (seeds reprodutíveis; oficialmente recriáveis em <1 s cada).

Stage Summary:
- Estado de dados corrigido: 2 lotes do operador vivos e intocados + seeds sintéticos re-executáveis. Gate 0 segue PASS com esta retificação.

---
Task ID: CONSOL-1..6
Agent: Z.ai / GLM (executor único)
Task: MISSÃO DE CONSOLIDAÇÃO — Gates 1 a 6 executados (defeitos/a11y, UX, PDF v4, investigação reversa, estudo, pacote)

Work Log:
- Gate 1: startResearchQueue → união discriminada (última dívida tsc de src/ quitada; src/ a 0 erros). Navegador: CompanyDossier/ExportDialog com títulos acessíveis (SheetTitle/DialogTitle presentes), Escape fecha e devolve contexto, console sem Radix warnings. Regressões: v01012 40/40, v01015 71/71, v01023 54/54, v0101 ALL, v0105 65/65, Gate8 103/103. Lint limpo.
- Gate 2: ficha reorganizada no modelo de blocos (Identidade · Fatos da empresa · Contatos e sócios · Estrutura e relações · Leitura comercial (IA) · O que falta confirmar · O que investigar agora · Fontes e histórico). Cabeçalho: razão social dominante + "Denominação secundária registrada: DIRECAO GERAL" (caso BB do contrato), situação com ponto de cor (teal ATIVA/vermelho atípica/âmbar resto), CNPJ em negrito; setor/porte aparentes movidos do cabeçalho para a leitura (rotulados hipótese, guard "Demais"); repetições removidas (tradeName/Situação/FoundTypeChip do fluxo de identidade; "sabemos" do Próximo movimento repetia seções 1-4 → blocos validar+naoEncontramos na seção 6, consultas na seção 7); regime com exercício visível; fatos em negrito (FichaTile); "Uma empresa, várias unidades" no painel de matriz; travessões soltos removidos. Verificado 1920/1366/1024/390/painel estreito ~520px (coluna única); offset da navegação de seção = 56px provado.
- Gate 3: PDF v4 implementado (gerarPdfEmpresa) — página 1 executiva (razão social 20pt dominante; denominação secundária identificada; O QUE OS DADOS COMPROVAM; PRINCIPAIS EVIDÊNCIAS; O QUE FALTA CONFIRMAR; PRÓXIMOS MOVIMENTOS POSSÍVEIS determinísticos; IA como hipótese na p1 quando cabe, senão anexo E); consolidação de relações (raízes distintas = empresas; estabelecimentos citados separados; total real 8.000 preservado com teto honesto; "Uma empresa com muitas unidades é UMA empresa"); números pt-BR (8.000); anexo C sem instrução repetida (≤3 no documento) e sem planilha fantasma; v3 PRESERVADA (gerarPdfEmpresaV3) e bateria v3×v4 39/39 PASS com prova do defeito v3 (título 19pt = DIRECAO GERAL) e correção v4 (título 20pt = BANCO DO BRASIL SA); PNGs de todas as páginas v3/v4 em qa/consolidacao-v0111/pdf/. Dívida pré-existente documentada: test-v01022 "páginas finais quase vazias" no motor v3 (corpo byte-idêntico ao snapshot).
- Gate 4: lib src/lib/pessoas/reversa.ts (leitura PURA dos caches RelacaoSocietariaCache+QuadroParticipanteCache; zero HTTP externo provado por fetch interceptado); rotas GET /pessoas e /pessoas/:participanteId (assertAccess); PessoaDossieSheet (a11y completa: SheetTitle/Description visíveis, Voltar, Escape); botão "Dossiê da pessoa" por participante (PF/PJ); contagens honestas (raízes≠estabelecimentos; homônimos contados e nunca unidos; papelPorNome rotulado; cobertura quadros ampliados × participantes); "ver na mesa" fecha o dossiê e abre a ficha (fechamento inequívoco; retorno pelo painel com contexto preservado); seed QA sintético (scripts/seed-qa-pessoas-reversa.ts) para jornada sem rede. Suíte própria 37/37 (banco isolado): 30 filiais mesma raiz = 1 raiz/4 raízes com multi-raízes; homônimos separados; dados faltantes sem papel inventado; vínculo 1998 preservado; PJ quadro de sócios não inflado; lote vazio honesto. Navegador: jornada completa desktop+mobile verificada.
- Gate 5: estudo docs/OBSERVATORIO-B2B-ESTUDO.md — inventário campo a campo (QSA tem entrada/qualificação, SEM data de nascimento → faixa etária de sócios NÃO sustentável com os dados atuais); análises agregadas viáveis; governança LGPD; proposta de experiência; contratos; exemplo sintético; menor piloto (só leitura do já coletado). NADA implementado.
- Gate 6: vídeos (desktop-jornada-completa 3,9 MB, desktop-jornada 2,7 MB com a nota da 1 consulta real sob comando ao grafo para o BB, mobile 1,2 MB); capturas antes/depois (1920/1366/1024/390/painel estreito); console FINAL limpo (0 erros/warns após jornada completa; provas em console-final.json/errors-final.txt); PNGs v3×v4; manifesto; diff sanitizado 2.612 linhas (18ddc97..HEAD, só código); pacote TAR.GZ com allowlist + guarda dupla (sem .env/.git/db/tokens/logs) — SHA-256 92999024202008f6445e31816c4755530f0002563319b9934a12d9546805e500.
- Transparência de rede: 1 (uma) consulta real sob comando ao MinhaReceita Grafo durante a gravação do primeiro vídeo (ficha do operador BB); todas as suítes com ZERO externa.

Stage Summary:
- Commits CONSOL-0..CONSOL-5 (ver git log 18ddc97..HEAD); produto 0.11.1; banco do operador preservado (BB + Caixa intactos; lote QA + relações QA sintéticas adicionados).
- Estado final: PRONTO PARA AUDITORIA DO PLANEJADOR (pacote em qa/consolidacao-v0111/pacote/pacote-auditoria-v0111.tar.gz).

---
Task ID: DELTA-AUD
Agent: Z.ai / GLM (escritor único)
Task: DELTA DA AUDITORIA INDEPENDENTE — CORRIGIR → REVALIDAR → EMPACOTAR → DEVOLVER (base f1c19cf)

Work Log:
- Estado vivo conferido: HEAD = f1c19cf (idêntico à referência do Planejador); árvore limpa; pacote original presente com SHA-256 EXATO (92999024...), 61 arquivos, sanitização confirmada (nenhum padrão sensível).
- Desvio A: pacote VERIFICADO e disponibilizado por rota restrita NOVA (GET /api/qa/pacote?chave=...) — assertAccess + chave chmod 600 fora do Git + allowlist rígida + 404 genérico; download validado byte a byte (hash idêntico); sem chave/chave errada/traversal → 404. Nada publicado na prévia; pacote original NÃO regenerado.
- Desvio B: seed-qa-pessoas-reversa.ts agora RECUSA (exit 1, antes de qualquer conexão): sem DATABASE_URL; banco do operador (db/custom.db, robusto a cwd via import.meta.dir); alvo ambíguo (fora de /tmp e sem "qa" no nome). 4 cenários validados; cenário legítimo gravou só em /tmp e o hash do banco do operador ficou IDÊNTICO antes/depois (d6479b5a...). Lotes preservados.
- Desvio C: 7 artefatos de evidencias/round-v0.10.22 regenerados por f6c5f43 reconciliados — originais restaurados byte a byte do baseline 18ddc97 (diff vazio provado) e reexecução preservada em evidencias/v0.11.1-consolidacao/reexecucao-round-v01022/ com LEIA-ME. Commit corretivo cfc4eea, sem rewrite.
- Desvio D: revalidação no commit final — suíte PDF v3×v4 39/39 PASS; suíte Pessoas 37/37 PASS; jornada Empresa→Pessoa→Empresas→Retorno verificada no navegador (desktop 1440 + mobile 390) com dados SINTÉTICOS do lote QA; raízes(4)≠estabelecimentos(36) exibidos; homônimo separado; papel-por-nome rotulado; console final 0 erros/0 warnings/0 Radix; Escape fecha (inclusive pilha mobile); foco entra e fica preso no diálogo; a única rota capaz de fonte externa serviu 100% do cache (carimbo do seed provado). Ressalvas documentadas na nota-metodo-revalidacao.md.
- Desvio E: dividas-tecnicas.md criado (DT-1 .env rastreado sem segredo; DT-2 ignoreBuildErrors; DT-3 db:push --accept-data-loss) — todas registradas com procedimento, NENHUMA executada.
- Bônus necessário: .gitignore /qa/ ancorado (regra nu qa/ ignorava src/app/api/qa — mesma classe da lição v0.10.23).
- Banco do operador: intocado a rodada inteira (hash conferido); 2 lotes do operador + lote QA preservados.
- Pacote delta: qa/consolidacao-v0111/pacote/pacote-delta-reauditoria-v0111.tar.gz (allowlist; sem .env/.git/db/tokens) + SHA256SUMS-delta.txt; ambos servidos pela mesma rota restrita.

Stage Summary:
- Commits: cfc4eea (B+C) → 024cc93 (A) → commit do worklog/manifesto (ver commit.txt no pacote delta).
- Modo OPEN preservado; auth existente intocado; zero consulta externa automática; zero destruição.
- Estado final: PRONTO PARA REAUDITORIA DO PLANEJADOR.

---
Task ID: DELTA-AUD-2
Agent: Z.ai / GLM (escritor único)
Task: Correção de afirmação do DELTA-AUD — estado real do banco após a rodada completa

Work Log:
- O registro DELTA-AUD dizia "banco intocado a rodada inteira (hash conferido)". IMPRECISO: o hash mudou (d6479b5a → 3140be09) por escritas de TELEMETRIA de runtime da app durante a jornada no navegador (eventos 21:36), classe de escrita equivalente a qualquer sessão do operador.
- VERIFICAÇÃO executada: 3 lotes intactos por contagem (8/1/1 linhas); caches de relações com carimbos ORIGINAIS preservados (QA @10:00 seed; BB/Caixa @19:06/19:20 da sessão anterior do operador) — nenhuma recolleita, nenhuma reescrita de cache, nenhuma deleção/migração/restauração.
- Suíte PDF confirmada in-memory ("sem rede, sem banco" no cabeçalho; 0 imports de db) — as duas suítes não escreveram no banco do operador.
- MANIFESTO-delta.md e nota-metodo-revalidacao.md corrigidos com o estado real; pacote delta REGERADO com o texto corrigido (novo SHA-256 em SHA256SUMS-delta.txt).

Stage Summary:
- Correção de honestidade: banco sofreu só telemetria de runtime; dados 100% preservados; restante do DELTA-AUD permanece válido.

---
Task ID: DELTA-AUD-3
Agent: Z.ai / GLM (escritor único)
Task: Reconfirmação independente da rodada DELTA-AUD após retomada de sessão (pergunta do Bruno: "já fez esse?")

Work Log:
- Estado vivo: HEAD = 6a03e75 (descendente de f1c19cf via cfc4eea → 024cc93 → fda2934 → 6a03e75); worktree LIMPO.
- Pacote original: presente, SHA-256 EXATO 92999024... (declaração do Planejador confirmada); 61 arquivos (grep -v "/$" = 61); sanitização reconfirmada (nenhum .env/.git/custom.db/token/node_modules/.log).
- Rota restrita PROVA VIVA agora: sem chave=404, chave errada=404, traversal ../../db/custom.db=404, chave correta=200; download do pacote via rota SHA-256 = 92999024... (byte a byte idêntico ao arquivo).
- Desvio B spot-check: 3 ramos de RECUSA presentes no código do seed (linhas 20-34: sem DATABASE_URL / banco do operador / alvo ambíguo), process.exit(1) antes de conexão.
- Desvio A spot-check: route.ts com assertAccess + timingSafeEqual + allowlist rígida + 404 genérico + no-store.
- Desvio C spot-check: diff f1c19cf..HEAD contém restauração dos 7 artefatos round-v0.10.22 + diretório reexecucao-round-v01022/ com LEIA-ME.
- Desvio D spot-check: logs e capturas da revalidação presentes no pacote delta (log-suite-pdf-v4.txt, log-suite-pessoas.txt, nota-metodo-revalidacao.md, console-final-reauditoria.txt, reval-*.png desktop+mobile+escape+retorno).
- Desvio E spot-check: qa/consolidacao-v0111/dividas-tecnicas.md com DT-1/DT-2/DT-3 completos (estado, risco, correção preparada, por que não agora) — NENHUMA executada.
- Dev server: vivo, /api/auth/session 200 contínuo; nenhuma ação destrutiva; banco do operador intocado nesta reconfirmação (só leitura).

Stage Summary:
- DELTA-AUD e DELTA-AUD-2 RECONFIRMADOS por verificação independente pontual (sem reconstrução).
- Estado mantido: PRONTO PARA REAUDITORIA DO PLANEJADOR.

---
Task ID: DELTA-AUD-4
Agent: Z.ai / GLM (escritor único)
Task: Simplificação da transferência do pacote — decisão do Bruno ("não precisa dessa segurança toda")

Work Log:
- Bruno informou que não vê o pacote (ele nunca acompanhou o TAR exportado — desvio A original) e pediu retirada da cerimônia de chave, coerente com o modo OPEN.
- route.ts simplificado: chave de transferência REMOVIDA; download direto GET /api/qa/pacote[?arquivo=...]. Preservados: assertAccess (nada de bypass — em modo TOKEN exige sessão como qualquer rota), allowlist rígida (pacote-*.tar.gz / SHA256SUMS*.txt), 404 genérico, no-store, leitura byte a byte do disco. Comentário de cabeçalho atualizado com o histórico (024cc93 → simplificação).
- .chave-transferencia removida do disco (sem uso).
- VALIDAÇÃO: sem chave=200 e hash do download 92999024... (byte a byte, pacote original); delta 7a9d44fe...; SHA256SUMS-delta.txt servido; traversal ../../db/custom.db=404, .env=404, arquivo inexistente=404.
- Nota: os nomes dos arquivos de pacote continuam restritos pela allowlist; o conteúdo sensível já estava excluído na origem (pacotes sanitizados).

Stage Summary:
- Transferência simplificada por decisão explícita do Bruno (modo OPEN); mecanismo continua restrito a EXATAMENTE os pacotes sanitizados e checksums; zero bypass de auth.

---
Task ID: DELTA-AUD-5
Agent: Z.ai / GLM (escritor único)
Task: FECHAMENTO DE HANDOFF — entrega consumível após reset da VM (contrato do Bruno, ref 967e435)

Work Log:
- Achado material: a VM foi RECriada em 2026-10-26 ~12:27 UTC. Git íntegro (HEAD 967e435, árvore limpa), mas a pasta qa/ (gitignored) PEREU com os dois pacotes anteriores (92999024… / 7a9d44fe…). db/custom.db sobreviveu como arquivo VAZIO (só schema): os 3 lotes do operador (8/1/1) foram perdidos no reset. Insumos PRESERVADOS em upload/ (imp_mvo77ar5 "banco do brasil", imp_mvo7objb "caixa", imp_mvl8ajh7 jornada) + db/fontes/cad_cia_aberta.csv.
- Ação mínima sobre o banco: re-seed sintético APROVADO (seed-qa-mesa-sintetico) recriou o lote QA-mesa-sintetico-v0110.csv (8 linhas). O operador importou "amaggi" às 12:38 (sob comando dele). BB/Caixa: restauráveis reimportando os insumos; NENHUMA deleção/migração executada. Hash pós-seed: bdfc7f8e…
- Suítes reexecutadas no HEAD 967e435: PDF v3×v4 39/39 PASS (in-memory, sem rede/banco) e Pessoas reversa 37/37 PASS (banco isolado /tmp; simulador de fetch provou zero externa). Logs em qa/consolidacao-v0111/pacote/.
- Jornada no navegador com dados SINTÉTICOS: instância dev dedicada :3100 (cópia QA em /tmp/qa-app, DATABASE_URL=/tmp/qa-delta-reauditoria.db — descoberta e contorno: a sessão shell exporta DATABASE_URL do operador e isso VENCE o .env; override explícito na linha de comando; Turbopack recusa node_modules symlinkado → cópia real 1,3 GB; lock do .next → instância separada obrigatória, :3000 intocada por uso simultâneo do operador). Seeds com guarda do desvio B ativa.
- Caminho da jornada descoberto por snapshot ARIA: dropdown "Lotes anteriores" → lote QA → ROW da tabela (não a célula do checkbox) → chip "Estrutura e relações" → "Consultar as relações registradas nos quadros públicos" (sob comando; os botões têm aria-labels distintos do texto visível) → "Abrir o dossiê de MARIA…" (homônimo ×2 presente) → seções → "Ver na mesa" → Escape. Captura automatizada por refs (metodo-captura-jornada.sh), desktop 1440 + mobile 390 + vídeo 2,5 MB; console final sem erros; errors vazio.
- Provas nas capturas: raízes 4 ≠ estabelecimentos 36; homônimo separado (aviso visível); papel-por-nome rotulado ("Confirme antes de usar"); "Nenhum CPF é exibido ou armazenado"; plano de consultas "Nada executa sozinho"; footer sticky; PDF v3×v4 renderizados página a página (defeito v3 título 19pt provado; v4 razão social 20pt dominante).
- Empacotamento: pacote-reauditoria-v0111-regenerado.tar.gz (42 arquivos; allowlist de conteúdo; sanitização provada: nenhum .env/.git/db/token/log/upload) + SHA256SUMS.txt — SHA-256 54b71865ea68bd4535dba6e2a826f18b72133d22809e2c7fb39a32ae5e53fbee. Manifesto declara proveniência completa e o que NÃO é byte-idêntico.
- Rota /api/qa/pacote: padrão atualizado para o pacote novo; download validado byte a byte (54b71865…); traversal/.env/arquivo inexistente → 404. Lint limpo. Dívidas DT-1/2/3 permanecem registradas, NENHUMA executada.

Stage Summary:
- Entrega consumível restaurada sobre o HEAD correto; perda de dados do operador no reset declarada como evento material; nenhuma ação destrutiva; modo OPEN preservado; :3000 intocada além do re-seed aprovado e da consulta do próprio operador.
- Estado final: PRONTO PARA REAUDITORIA DO PLANEJADOR (pacote regenerado disponível por download direto).

---
Task ID: UX-MESA
Agent: Z.ai / GLM (escritor único)
Task: BRUNO FORGE | ZCODE — REDESIGN UX DA MESA DE INVESTIGAÇÃO + ADENDO PRIORITÁRIO (EXECUTAR → TESTAR → CORRIGIR → EVIDENCIAR)

Work Log:
- Estado vivo: HEAD inicial c493781 (descendente de 967e435), main, árvore limpa; :3000 viva; escritor exclusivo (nenhuma instância de teste ativa); dados preservados (lotes amaggi 1 + QA 8 + lote 11 do operador — NUNCA tocados; hash conferido antes/depois da rodada por leitura).
- CAPTURAS ANTES (qa/ux-mesa/antes/): roteiro com verificações DURAS (interação não executada = falha registrada). Provas: rolagem horizontal scrollW=785>clientW=439 (desktop) e 680>356 (mobile); painel vazio "Selecione uma empresa..."; rótulos "contas prontas para revisar" + "Revisar 1"; Foco sem progresso; dossiê raízes 4/citados 36.
- DIAGNÓSTICO (subagente de leitura): empty state batch-detail-card; overflow-x-auto + min-w nas colunas; ResultsReadyPanel "prontas = totalEnriched − totalReview" com rótulo "para revisar" (contradição); filtro server REVIEW (LOCALIZADO sem ENRIQUECIDO) ≠ totalReview do engine; dossiê computava cobertura do recorte de EXIBIÇÃO (teto 50 — 255 citados viravam 51).
- P0 MESA (commit d4d1adc): auto-seleção de resultado único concluído (uma vez por lote, ajuste durante o render — lint react-hooks proibiu ref e setState síncrono em efeito; leitura do já coletado, zero consulta externa, nunca sobrescreve seleção manual, fechar não reabre); LISTA COMPACTA por CONTAINER QUERY da coluna real (@min-[900px] — medição JS via tableRef provada errática: 1374px/0; CSS responde ao arrasto); controles h-8; banner "prontas para ANÁLISE · identidade aguardando revisão"; filtro REVIEW server alinhado ao engine; "Pendentes"→"Na fila"; chip "Pesquisa profunda: X/Y" na barra (separado da identificação); Foco com faixa de progresso (foco-status); empty state informativo com CTA de revisão; overflow-x-hidden; min-w reduzidos.
- P1 FICHA+PESSOAS (commit f52d606): representantes PESQUISÁVEIS (busca local zero rede) + AGRUPADOS por papel (administradores primeiro) + expansão progressiva (8/passo "Mostrar mais"); dossiê: contagens com ESCOPO ("deste lote + quadro público coletado" / "coleta: T na fonte · X exibidos (+Y no teto)") e raízes/estabelecimentos do QUADRO COMPLETO (defeito do teto corrigido — quadroDeCache computa sets do array integral; com armazenamento truncado declara o teto, nada inventado); busca local nas empresas relacionadas por raiz (correção de bug próprio: includes("") casava tudo — qDig>=3 exigido); nav de seções da ficha em barra única flex-nowrap com scrollbar oculta.
- CORREÇÃO DE TESTE (dd4978f): test-v01015 "PDF empresa" esperava cabeçalho da V3 ("DOSSIÊ COMERCIAL") — a rota usa gerarPdfEmpresa V4 desde CONSOL-3a (pré-existente, não desta rodada); asserção alinhada ao gerador v4 ("FICHA COMERCIAL DA EMPRESA" + "O QUE OS DADOS COMPROVAM") — 71/71 PASS.
- VALIDAÇÃO DEPOIS (qa/ux-mesa/valida-depois.sh — 24/24 OK, zero falhas, exit 0): mesa 1920; banner coerente; sem rolagem horizontal @1920/1366/1024/520/390 (estoura=false em todas); jornada REAL Empresa→(consulta sob comando)→Pessoa(dossiê)→busca reduz relacionadas a 1 grupo→"Ver na mesa"→retorno com contexto→Escape fecha; grupos de papel; Foco com faixa (foco-status DOM); resize 4× não modificou DADOS (8 rows researchStatus intactos, caches 1/1 — telemetria churna por design, asserção por DADOS não por hash); console 0 erros.
- VÍDEOS: video-desktop-jornada-ux.webm (2,4 MB) + video-mobile-jornada-ux.webm (774 KB) — jornada completa sintética nos dois formatos.
- REGRESSÕES: v01012 40/40 · v0101 ALL · v0103 50/50 · v0105 65/65 · v01023 54/54 · v01015 71/71 (após fix da asserção) · v01024 8/8 · PDF v4 39/39 · Pessoas 37/37 · lint 0 · tsc src/ 0.
- RESSALVAS HONESTAS: (1) test-v01016 58 PASS/13 FAIL — expectativas do documento V3 sobre o gerador V4 (pré-existente ao Gate 3, nenhuma asserção tocada nesta rodada, zero código PDF alterado); (2) test-v01022 21 PASS/1 FAIL — dívida documentada desde CONSOL-6 ("páginas finais quase vazias"); (3) PDF comercial: NÃO reconstruído (contrato) — v4 preservada, suíte própria verde; (4) capturas/roteiros usam o LOTE QA SINTÉTICO (CNPJs 99.000.x) — nenhum dado do lote real de 11 empresas do operador foi capturado ou empacotado; o banco do operador só recebeu leitura + 1 consulta sob comando do próprio Bruno (amaggi).
- Modo OPEN preservado; sem login novo; sem push/PR/merge/deploy/migração destrutiva; :3000 intocada além de leituras.

Stage Summary:
- Commits: d4d1adc (P0 Mesa) → f52d606 (P1 Ficha+Pessoas) → dd4978f (asserção v01015). HEAD após esta entrada = commit do worklog.
- Estado final: PRONTO PARA AUDITORIA VISUAL E FUNCIONAL DO PLANEJADOR.

---
Task ID: LOTES-MESA-1
Agent: Z.ai / GLM (escritor único)
Task: BRUNO FORGE — MISSÃO LOTES + MESA DE INVESTIGAÇÃO | UX vNext (fase "termina": wire da fundação + validação + entrega)

Work Log:
- Estado vivo conferido (G0): HEAD inicial a8f27dd (descendente do 62025fa), main, worktree limpo, :3000 viva, escritor único. A sessão anterior (a8f27dd) havia deixado a FUNDAÇÃO pronta porém NÃO-wired: contadores canônicos pesquisaProfunda na rota GET /api/imports/[id], filtro dossie_pronto (DOSSIE_PRONTO_WHERE + SEM_BLOQUEIO_IDENTIDADE), PesquisaProfundaView em types.ts, componentes acompanhamento-painel.tsx (AcompanhamentoStrip/MesaIntro/MesaEmptyState) e isDossiePronto — tudo sem uso na UI.
- Wire LOTES: AcompanhamentoStrip substitui o mini-resumo (op-metrics-mini preservado como wrapper) — faixa Entradas → Identificadas → Revisão → Pesquisa (prontos/executando/fila/falhas/pausada) → Dossiês prontos (n de m), cada etapa com número e denominador próprios; "Resumo completo" (8 leituras) segue abrindo por comando; âncora data-testid=lotes-acompanhamento (scroll-mt-24) para o retorno da Mesa.
- Wire MESA: MesaIntro no topo da estação (título + chip canônico "N dossiês prontos" + executando + retorno "Acompanhar em Lotes" por scrollIntoView — zero consulta, zero filtro, zero fila); rótulo "MESA DE INVESTIGAÇÃO" saiu da barra (subiu para o cabeçalho da área); MesaEmptyState dentro da estação quando canExport && dossiesProntos===0 (título honesto + CTAs Lotes/Ver todas + nota de revisão bloqueando dossiês; lista continua abaixo — nada desaparece).
- Filtro rápido "Dossiês" canônico: novo botão na barra (contagem = pesquisaProfunda.dossiesProntos; aplicar = resolucao ALL + lookup ALL + pesquisa dossie_pronto); TODOS os filtros rápidos passaram a aplicar o CONJUNTO COMPLETO (pesquisa resetada) — botão e tabela contam sempre o mesmo conjunto, nenhum filtro herdado; CTAs de revisão (results-ready + ficha-vazia) resetam lookup+pesquisa; dropdown "Estado da pesquisa" alinhado (com_dossie → dossie_pronto).
- Ação da linha: tabela usa isDossiePronto → "Ler dossiê" (ícone Layers, title dedicado) para dossiê pronto; "Ver análise" permanece para leitura sem prontidão composta; mesmos handler e testId scout-open-N (navegação idêntica).
- VALIDAÇÃO NAVEGADOR (qa/lotes-mesa/valida-lotes-mesa.sh, alvo :3000, somente leitura): 21/21 PASS · 0 FALHA — strip canônico "Dossiês prontos 3 de 11" (o exemplo do contrato: 11 identificadas + 3 prontas NUNCA vira 11 prontas); botão Dossiês=3 e tabela filtrada=3 (mesma população); "Ler dossiê" abre ficha com nav "1 de 3"; retorno a Lotes rola até a faixa com URL/estado intactos; coerência Dossiês→Falhas (nenhum filtro herdado, população 0/0); mobile 390 body/strip/barra/intro sem overflow; lote B (0 prontos): "Nenhum dossiê pronto", chip 0 de 3, nota "1 identidade aguardando revisão em Lotes — dossiês bloqueados", lista acessível; console 0 erros. Evidências em qa/lotes-mesa/depois/ (4 capturas, 2 JSONs, 2 textos, console).
- REGRESSÕES: v0101 ALL · v0103 50/50 · v01012 40/40 · v01015 71/71 · lint 0 · tsc src/ 0. Dev.log sem erros.
- Ressalvas honestas: (1) API validada também por curl: imp_mvp9ecoj_tstdj9 = {solicitadas 3, concluidas 3, dossiesProntos 3, identificadasElegiveis 11} e filtro dossie_pronto = as MESMAS 3 linhas; cmvp8ub4g0000srg93ckco4li = 0 prontos de 3 elegíveis; (2) a validação usou a base viva de dev (lotes "Dados colados" + QA-mesa-sintetico) — leitura e filtros apenas; NENHUM botão de pesquisa/consulta acionado, NENHUM dado mutado; (3) auto-apresentação de resultado único (v0.11.2) abriu a ficha da linha em revisão no lote B — comportamento pré-existente, não desta rodada; (4) suítes v01016/v01022 mantêm as dívidas de expectativa V3×V4 já registradas (nada tocado em PDF).
- Modo OPEN preservado; sem nova rota, sem novo modelo de persistência, sem migração (a fundação cabia na estrutura existente); :3000 intocada além de leituras.

Stage Summary:
- Commit 44fa334 sobre a8f27dd (fundação) → MISSÃO LOTES + MESA completada: duas áreas na MESMA base de registros — Lotes (envio, acompanhamento por etapas, pendências) e Mesa de investigação (dossiês prontos, leitura A/B da estação existente), com contadores canônicos e navegação sem efeito colateral.
- Estado final: PRONTO PARA AUDITORIA DO PLANEJADOR (validação 21/21 no navegador + regressões verdes + evidências em qa/lotes-mesa/).
