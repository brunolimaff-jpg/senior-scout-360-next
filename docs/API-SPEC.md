# SCOUT 360 — API Spec
### 30 rotas Next.js (App Router) · todas JSON, auditoria no motor · atualizado em v0.10.12

> Contratos de entrada/saída das rotas. Toda a lógica pesada vive em `lib/enrich/engine.ts`
> (o engine é determinístico e auditado — as rotas são porta fina).

## Convenções gerais (v0.10.8)

1. **Erros**: JSON `{ error: string }` com status HTTP adequado (400 entrada inválida, 404 lote/linha inexistente, 409 lock/conflito, 500 interno). Mensagens de erro da jornada comercial NÃO expõem provedores, endpoints nem códigos HTTP — o detalhe técnico fica em telemetria/auditoria.
2. **Fronteira de acesso (G9)** — com o modo TOKEN ativo (`SCOUT_EXPORT_TOKEN` ou `SCOUT_AUTH_REQUIRED=1`), TODAS as rotas de leitura e escrita de dados exigem sessão httpOnly válida ou header `x-export-token`/`Bearer`: lotes, linhas, exports, triagem, telemetria, worker, **comparações do laboratório (GET/POST), credencial experimental (GET/POST/DELETE) e leitura do estado da fila de pesquisa**. O modo OPEN só existe fora de produção; em produção, sem `SCOUT_EXPORT_TOKEN` as rotas de dados respondem 503 `AUTH_MISCONFIG` (fail-closed, visível em `GET /api/auth/session` e `GET /api`). **v0.10.11 (piloto)**: as rotas do laboratório (`/api/lab/*`, incluindo o mock) têm gate server-side adicional (`labEnabled()`): fechadas no modo TOKEN por padrão (abrem só com `SCOUT_LAB_ENABLED=1`) e desligáveis em qualquer modo com `SCOUT_LAB_ENABLED=0`; o painel do laboratório também saiu da jornada comercial.
3. **Confirmação NÃO inicia processamento** — `POST /api/imports/:id/confirm` apenas valida o mapeamento e materializa as linhas (estado do lote `CONFIRMED` = "Aguardando início"). Nenhuma consulta cadastral, busca web ou chamada de IA acontece sem `POST /api/imports/:id/process` (ou `POST /api/worker/tick` que retoma SOMENTE trabalhos previamente iniciados). Prova: telemetria da janela entre confirm e process deve ter ZERO eventos de COLETA_CADASTRO/WEB_SEARCH/IA_CHAT/PROCESS_START.
4. **Estados** — lote: `PREVIEW → CONFIRMED → PROCESSING → DONE/PARTIAL/FAILED` (CONFIRMED não consulta); linha: `PENDENTE/EM_FILA/CONSULTANDO → ENRIQUECIDO | NAO_ENCONTRADO | RATE_LIMITED/TIMEOUT/ERRO_REDE/ERRO_SERVIDOR` (retryable: `RATE_LIMITED, TIMEOUT, ERRO_REDE, ERRO_SERVIDOR, NAO_ENCONTRADO`).
5. **Auditoria**: cada rota que muda estado grava `AuditEvent` via `recordAudit()` — nada acontece sem rastro.
6. **Camada de apresentação** — a interface comercial oculta provedores/APIs/endpoints/modelos (categorias de finalidade em `src/lib/fontes-apresentacao.ts`); as APIs continuam retornando os nomes técnicos de proveniência (`source`, `fontes.*`, telemetria), que a área expansível de fontes da ficha da empresa (seção 7) e as exportações técnicas exibem sob demanda (v0.10.13: a navegação Dossiê/Dados/Evidências virou ficha única). Proveniência não foi removida dos contratos.
7. **Encoding/CSV**: parser tolerante (`,`/`;`, BOM, aspas) — a detecção é reportada no preview, não assumida.
8. **Rate limit de IA**: global em memória (`lib/ratelimit.ts`), cache inter-lotes; regeneração manual (`__aiManualRegen`) ignora cache.

---

## Raiz

| Rota | Método | Função |
|------|--------|--------|
| `/api` | GET | **v0.10.8**: verificação de saúde e versão → `{ ok, servico, versao, modoAcesso }` (sem segredos) |
| `/api/stats` | GET | Métricas agregadas (lotes, linhas, taxa de resolução) |
| `/api/auth/session` | GET/POST | Estado do modo de acesso / emissão da sessão httpOnly após validação do token |

## Importação

| Rota | Método | Função |
|------|--------|--------|
| `/api/imports` | POST | Upload de arquivo (multipart) → cria lote, parse, detecção de coluna CNPJ, grava arquivo em `upload/` |
| `/api/imports` | GET | Lista de lotes (para o histórico) |
| `/api/imports/text` | POST | Lote a partir de texto colado (CNPJs/nomes por linha) → preview |

## Ciclo de vida do lote

| Rota | Método | Função |
|------|--------|--------|
| `/api/imports/{id}` | GET | Estado completo do lote (BatchDetail: contadores, linhas/RowView, eventos de auditoria). **v0.10.7**: `totalPessoasJuridicas` (raízes distintas com coleta concluída) e `totalMatrizesDistintas` (headquartersCnpj distintos com matrizStatus RESOLVIDA). **v0.10.8**: `cnaeDist[]` — setor cadastral (seção CNAE 2.0) derivado LOCALMENTE do código coletado, sem IA |
| `/api/imports/{id}` | DELETE | Apaga lote (e arquivo associado) |
| `/api/imports/{id}/confirm` | POST | **NÃO inicia processamento** (convenção 3): valida mapeamento e materializa as linhas; body: `{ cnpjColumnIndex?, hasHeader?, aiEnabled? }` (opt-in de IA default false) |
| `/api/imports/{id}/process` | POST | Inicia/enfileira processamento do lote — o único caminho que dá início às consultas (tick do worker dá passos) |
| `/api/imports/{id}/ai-summary` | POST | Gera/regenera a síntese IA do lote |

## Linha (rowNumber é 1-based, referencia a linha do lote)

| Rota | Método | Função |
|------|--------|--------|
| `/api/imports/{id}/rows/{rowNumber}/decide` | POST | Decisão humana de identificação (elege/descarta candidato). v0.10.12: `{action:"VALIDAR_REGISTRO"}` valida o registro localizado divergente (VALIDA + `identityStage:"LOCALIZADO"` → VALIDADO, divergências preservadas); `{cnpj}` corrige o CNPJ da linha divergente (o antigo sai das células, auditoria preserva o original); `{action:"CLUE"}` também aceita linha VALIDA divergente |
| `/api/imports/{id}/rows/{rowNumber}/retry` | POST | Reprocessa linha com falha (só estados retryable) |
| `/api/imports/{id}/rows/{rowNumber}/retry-ai` | POST | Regenera a leitura IA da linha (FALHOU/IGNORADO ou OK=regenerar novo) |
| `/api/imports/{id}/rows/{rowNumber}/deep-research` | POST | Dispara pesquisa profunda da linha (lock anti-duplicação); body opcional `{ modo: "COMPLETO" \| "ADAPTATIVO" }` |
| `/api/imports/{id}/rows/{rowNumber}/revalidate` | POST | Revalida a FICHA CADASTRAL da linha (ENRIQUECIDO) — força consulta real às fontes (ignora TTL); falha HTTP/timeout/429 responde **502** com motivo e a ficha anterior é RESTAURADA intacta (`REVALIDACAO_FALHOU` + `ficha_anterior_preservada=true`) |
| `/api/imports/{id}/rows/{rowNumber}/triagem` | GET | **v0.10.6**: triagem local determinística das lacunas da linha — exclusivamente fatos já coletados; ZERO IA, ZERO busca web; estados `RESOLVIDO \| COMPLEMENTAR_API \| PESQUISA_DOCUMENTAL \| VALIDACAO_HUMANA \| INDISPONIVEL \| NAO_APLICAVEL` |
| `/api/imports/{id}/rows/{rowNumber}/relacoes-societarias` | POST | **v0.10.5**: relações diretas do quadro público sob comando explícito (sem IA, sem recursão) |
| `/api/imports/{id}/rows/{rowNumber}/relacoes-societarias/quadros` | GET | **v0.10.23**: LEITURA PURA do cache local — devolve `{ ok, quadros: Record<participanteId, QuadroView>, avisos }` dos quadros JÁ expandidos por comando e ainda válidos (`validoAte > agora`); ZERO rede, ZERO IA, ZERO consulta externa; alimenta o mapa de relações (criar ligação nova segue sendo o POST `/expansao`) |
| `/api/imports/{id}/rows/{rowNumber}/relacoes-societarias/expansao` | POST | Expansão de UMA conexão (1 hop, sob comando) |
| `/api/imports/{id}/rows/{rowNumber}/matriz-filiais` | POST | **v0.10.5**: estabelecimentos da MESMA raiz — descoberta por quadros + confirmação individual pelo campo oficial matriz/filial |
| `/api/imports/{id}/research-batch` | POST | **Mesa de Contas**: fila de pesquisa profunda das contas SELECIONADAS — `{ acao: "iniciar" (com rowNumbers) \| "parar" \| "retomar", modo? }`; só contas `ENRIQUECIDO` (o servidor rejeita inelegíveis); durável em `researchQueueJson`; 429/cota pausa com motivo |
| `/api/imports/{id}/research-batch` | GET | Estado atual da fila (nulo se nunca usada). **v0.10.8**: protegida por `assertAccess` (mesma fronteira do modo TOKEN) |
| `/api/imports/{id}/retry-ai-all` | POST | Reenfileira TODAS as leituras IA falhadas/fora do teto do lote |

## Exportação

| Rota | Método | Função |
|------|--------|--------|
| `/api/imports/{id}/export` | GET | `?type=` → `result` (default) \| `result_confirmed` \| `result_selected` (`&rows=1,2,3`) \| `result_review` (v0.10.15, CSV aditivo das linhas em revisão — união REVIEW ∨ LOCALIZADO coletado) \| `pending` \| `ai` \| `teia` \| `summary` (.json) \| `audit` (.jsonl) \| **`excel`** (v0.10.15, `&scope=TODAS\|SEM_REVISAO\|EM_REVISAO\|SELECIONADAS&rows=…` → .xlsx com 6 abas: Resumo/Empresas/Revisões/Representantes e relações/Evidências/Lacunas e consultas; abas sem dados não existem) \| **`pdf_lote`** (v0.10.15, `&scope=…` → PDF compacto; acima de 300 linhas no escopo → 413 `PDF_LIMITE` orientando o Excel) \| **`pdf_empresa`** (`&row=N` → PDF da ficha, sem IA/reconsulta; v0.10.17: modelo `ficha-comercial v3` — dossiê executivo: abertura com marca/identidade + divergência em caixa, 1 Visão empresarial, 2 Pessoas e relações, 3 O que vale investigar, bloco "Fonte e atualização" discreto ao final (categoria + data; provedor técnico NÃO entra no PDF — vive na planilha de evidências), anexos A–E; paginação sem página órfã; nome de arquivo `ficha-<empresa>-linha-N.pdf`) — CSV com colunas derivadas; **sem** `score_prioridade`/`score_banda` (score comercial removido na v0.6.x) · v0.10.12: colunas `etapa_identidade` e `divergencias_identidade`; `result_confirmed` EXCLUI `LOCALIZADO` · v0.10.15: seleção SEM corte silencioso — completa até 5.000; acima disso 413 `SELECAO_ACIMA_DO_LIMITE`; `summary` expõe `estagio_identidade`, `pessoas_juridicas` (localizadas × identificadas por raiz) e `revisao` (união da interface) |
| `/api/imports/{id}/export` | POST | **v0.10.15** — MESMO contrato do GET com corpo `{ type, scope?, rows?, row? }` (seleções grandes não cabem na URL); delega ao GET — zero divergência |
| `/api/imports/{id}/triagem` | GET | **TRIAGEM_V1** — `?formato=json\|jsonl`; uma entrada por pergunta/lacuna de cada entidade; validado por esquema; sanitizado (sem CPF/hash de PF; sinais levam SÓ síntese determinística — texto livre nunca sai da VM); evidências/fontes/bloqueios POR PERGUNTA |
| `/api/imports/{id}/plano` | GET | **v0.10.9 PLANO_CONSULTAS_V1** — planejador de consultas (P4): sem `formato`, devolve o plano para a UI (leitura pura — zero IA, zero HTTP externo, nada executa); `?formato=json\|jsonl` EXPORTA o artefato versionado por ação explícita (guarda de acesso + auditoria `plano_export` + telemetria `PLANO`); itens = lacunas `COMPLEMENTAR_API` com custo contado do cache local, `comando_executor` apontando para os comandos existentes, bloqueios declarados e `fora_do_escopo_api` por transparência; gate gravado no artefato (`ia:0, busca_web:0, execucao_automatica:false`); validado por esquema — falha → 500 honesto, nada publicado |
| `/api/imports/export-all` | GET | CSV consolidado de todos os lotes |

**Rótulos comerciais (v0.10.15):** o escopo antes chamado "contas confirmadas" apresenta-se como **"Somente sem revisão pendente"** — correspondência cadastral não é validação humana. O `type=result_confirmed` e o nome de arquivo `confirmadas-*.csv` seguem por compatibilidade de contrato. A teia societária existe e é exportável **sem IA** (vínculos cadastrais independem de IA). Excel e PDF usam a MESMA derivação de fatos da interface (`src/lib/export/dataset.ts` → `telefoneUtil`/`eMailUtil` de `@/lib/contato`): contato inválido nunca sai como utilizável (cru preservado só na evidência técnica), consulta candidata nunca aparece como executada e conteúdo de IA sempre vem rotulado como hipótese.

## Telemetria

| Rota | Método | Função |
|------|--------|--------|
| `/api/telemetry/summary` | GET | `?batchId=` resumo consolidado (buscas, leituras, IA, tokens, 429, cache, etapas); inclui `coleta.fontesCadastro[]` — consultas/OK/429/falhas/tempo médio POR FONTE (reuso de ficha não conta como consulta). A UI exibe as fontes por categoria; o contrato mantém o nome técnico (proveniência) |

## Worker

| Rota | Método | Função |
|------|--------|--------|
| `/api/worker/tick` | POST | Um passo do motor: retoma SOMENTE lotes previamente iniciados (lease durável — nunca dá início a lote `CONFIRMED`), processa até `MAX_CONCURRENCY=3` linhas, janelas de IA (`AI_WINDOW=2`), sweep de travadas > 30s |

> O frontend polla `GET /api/imports/{id}` e o tick é chamado pelo poller enquanto
> há execução real (`PROCESSING`, lease vivo, fila de pesquisa ou leitura IA em
> andamento). Lote `CONFIRMED` não avança sozinho — não há cron/serviço externo.

## Laboratório de modelos externos (Lote B / v0.9.0)

> **Exceção da camada de apresentação**: aqui a escolha explícita de um modelo
> exige identificar provedor e Model ID — nomes técnicos permanecem isolados
> nesta superfície experimental, fora da jornada comercial.

| Rota | Método | Função |
|------|--------|--------|
| `/api/lab/config` | GET/POST/DELETE | Credencial efêmera do provedor externo (Base URL + API key + Model ID) — só em memória, cookie httpOnly `scout_lab`, TTL 60 min, máx. 8 sessões; anti-SSRF (https fora do loopback; IP privado/`*.local`/`*.internal` recusados). **v0.10.8**: `assertAccess` nos três métodos |
| `/api/lab/test` | POST | Teste de conexão (GET `{base}/models`) — **zero inferência, zero tokens**, timeout 8s, sem retry, erro redigido; telemetria `ETAPA/LAB_PROBE_EXTERNO`. **v0.10.8: rota RECONCILIADA** — existia na v0.9.0 e faltava no ZIP v0.10.7 (a UI chamava e recebia 404) |
| `/api/lab/compare` | POST | Comparação MANUAL (`{rowId}` = autorização expressa): reconstrói o MESMO prompt do caminho nativo (mesmo `buildUserMessage`, mesmo `SYSTEM_PROMPT_DEEP`, mesma temperature 0.2) e envia ao provedor externo; resultado em `LabComparison` (nunca nos campos oficiais). **v0.10.8**: `assertAccess` |
| `/api/lab/compare` | GET | `?rowId=` histórico da conta (modelo, data, estado, tokens, veredito de equivalência reconciliado por hash). **v0.10.8**: `assertAccess` — histórico não é legível apenas conhecendo um rowId |
| `/api/lab/mock/v1/*` | GET/POST | Provedor MOCK local (só chaves `sk-mock*`) para validação sintética sem rede externa |

**Equivalência A/B (v0.9.0):** a resposta carrega `equivalencia: { estado: EQUIVALENTE | NAO_EQUIVALENTE | HISTORICA, motivo }`. EQUIVALENTE só quando hash das evidências + hash do prompt de sistema + versão do prompt + temperatura conferem com os hashes persistidos na síntese oficial (`ImportRow.dossierEvidenceSha/dossierSystemSha/...`). Dossiê oficial sem hash (pré-v0.9.0) ⇒ sempre HISTÓRICA.
