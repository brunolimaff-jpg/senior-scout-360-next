# Scout 360 — Exploração de maior retorno (E6, v0.9.0)

> Contrato da rodada intensiva: "investigue sem implementar automaticamente… Para cada
> oportunidade, devolva: problema resolvido, reuso do código existente, custo operacional,
> risco factual, menor teste e benefício esperado."
> Nenhuma das oportunidades abaixo foi implementada nesta rodada.

---

## 1. Cache de fontes e fatos por empresa (URL, data, versão)

- **Problema resolvido:** hoje o reuso é por LINHA (pacote salvo <24 h + completeza) e por
  CNPJ (leitura de IA entre lotes). Páginas e buscas de empresas repetidas em lotes
  diferentes voltam a custar cota.
- **Reuso do código existente:** `ImportRow.researchJson` já é o portador do pacote;
  `packetFresco()` (engine) já define a política de frescor; `DIRECTORY_HOSTS` e
  `resultadoRelevante` (research.ts) já classificam reuso/rejeição. Um modelo
  `SourceCache { url, host, sha256Conteudo, coletadoEm, versaoColetor }` em Prisma/SQLite
  encaixa sem novo serviço.
- **Custo operacional:** 1 tabela + 1 lookup por leitura de página/busca (SQLite local,
  ~ms); invalidação por data (ex.: 7 dias) e por `appVersao` do coletor.
- **Risco factual:** página cacheada desatualizada ("mudanças relevantes" perdem período
  novo). Mitigação: cache só para LEITURAS de conteúdo estático (site oficial), nunca para
  notícias (RSS já é fresco por natureza); registrar `coletadoEm` no pacote para a síntese
  citar a data da coleta.
- **Menor teste:** importar a MESMA empresa em 2 lotes; 2ª pesquisa profunda deve ler 0
  páginas externas (cache hit auditável em `AuditEvent` + telemetria `cacheHit:true`).
- **Benefício esperado:** elimina o maior custo repetido do coletor (5 leituras/conta);
  relevantes para re-pesquisa de famílias de CNPJ (matriz/filiais).

## 2. Busca textual local sobre evidências já salvas (SQLite)

- **Problema resolvido:** perguntas do tipo "quais contas do lote citam Senior?" exigem
  abrir dossiê por dossiê.
- **Reuso:** SQLite FTS5 sobre `aiDossierJson` + `researchJson` (OU colunas derivadas
  `aiReading`, `tecnologia_observada`), exposto como filtro da mesa de contas
  (`?q=` já existe para nome/CNPJ — estender para conteúdo).
- **Custo:** índice FTS local, rebuild incremental por linha salva (trigger no update).
- **Risco factual:** match textual NÃO é prova — resultado deve exibir o trecho citado com
  a fonte, nunca um contador de "aderência".
- **Menor teste:** rodar 2 golden cases com fontes distintas e buscar "Senior" na mesa.
- **Benefício:** operação de lote real (5 mil contas) fica navegável sem IA.

## 3. Comparação entre empresas de um mesmo lote

- **Problema resolvido:** priorização humana ("quem investigar primeiro?") hoje é manual.
- **Reuso:** dados já salvos por linha (porte, setor, tecnologia, cobertura E4). Uma view
  "panorama comparativo" por seleção (as MESMAS checkboxes da Mesa) — 0 custo de IA.
- **Custo:** só frontend + 1 agregação; nenhuma chamada externa.
- **Risco factual:** comparação vira ranking implícito se exibir "score". Mitigação:
  exibir FATOS lado a lado (tabela), nunca pontuação; sem conclusões geradas.
- **Menor teste:** selecionar 3 contas com dossiê → ver tabela de fatos por dimensão E4.
- **Benefício:** usa o que já foi pago (cota) para gerar decisão de investigação.

## 4. Diferenças entre duas pesquisas da mesma conta (diff temporal)

- **Problema resolvido:** "o que mudou desde a última pesquisa?" é pergunta natural da
  operação; hoje a re-pesquisa SUBSTITUI o pacote anterior.
- **Reuso:** `AuditEvent` já registra `DEEP_RESEARCH_PACKET` por execução. Guardar o
  pacote anterior como `researchAnteriorJson` (ou tabela `ResearchRun` 1:N) e diffar:
  sinais novos/sumidos, notícias novas, domínio alterado.
- **Custo:** 1 campo/tabela + diff de JSON no servidor; exibição no dossiê (bloco
  "mudou desde a última coleta").
- **Risco factual:** diff textual gera ruído ("mesma notícia, ordem diferente").
  Mitigação: diff por URL/título normalizado, não por texto.
- **Menor teste:** re-pesquisar a Lar com cota restaurada e listar deltas.
- **Benefício:** transforma re-pesquisa em rastreio de mudança (valor direto ao LDR).

## 5. Fontes estruturadas (CVM, PNCP) quando aplicáveis

- **Problema resolvido:** companhias abertas e fornecedores públicos têm fontes
  primárias estruturadas que a busca genérica mistura com ruído.
- **Reuso:** etapa B (RI/LISTADA) já detecta o perfil; `qa/fontes-samples/` já tem
  amostras PNCP/BrasilAPI coletadas em rodadas anteriores; o gateway tem web_search —
  mas CVM/PNCP têm APIs públicas abertas (sem chave).
- **Custo:** 1 cliente HTTP por fonte + mapeamento para `sinaisComerciais`/`sinaisPorte`
  com URL e período. Chamadas só quando `estrategia === "LISTADA"` ou CNAE indicar
  licitação (gap-driven — combina com o modo ADAPTATIVO).
- **Risco factual:** baixo (fonte primária oficial), mas exige vínculo CNPJ→participante
  correto (mesmo problema de identidade do resolver).
- **Menor teste:** Petrobras (LISTADA) → busca CVM de fato relevante com período.
- **Benefício:** evidência CONFIRMADO com período oficial em vez de notícia de terceiro.

## 6. Expansão da teia societária com prova de participação

- **Problema resolvido:** teia por busca de sócio é coincidência nominal (P1-06 já
  documenta); o contrato quer prova de participação, não coincidência.
- **Reuso:** `sociosJson` (QSA oficial) + `resolve/index.ts` (binding) — a expansão
  correta consulta o QSA DA EMPRESA ENCONTRADA (cascata de CNPJ), não busca web.
- **Custo:** +1 consulta de cadastro por empresa-alvo descoberta (fontes públicas
  BrasilAPI/OpenCNPJ já usadas — cota de IA/busca ZERO).
- **Risco factual:** baixo SE a expansão exigir QSA (prova) e rotular "participação"
  vs "mesmo sócio em outra PJ" explicitamente.
- **Menor teste:** Jotabasso → QSA da Agropastoril → sócio comum em Sementes? → teia
  com provas.
- **Benefício:** grupo econômico com prova documental — diferencial factual direto.

## 7. Exportação de dossiê executivo com referências

- **Problema resolvido:** o dossiê da UI não tem versão portátil para enviar a terceiros.
- **Reuso:** rotas de export já existem (result/ai/summary); o dossiê profundo tem
  `evidencias[]` com fonte+URL+período — o formato "dossiê executivo" é montagem de
  dados que JÁ existem (1 rota nova `?type=dossie&rows=`).
- **Custo:** rota + template (HTML imprimível ou MD); 0 IA, 0 busca.
- **Risco factual:** o export DEVE manter status das evidências e lacunas (nao_sabemos)
  — exportar só o "bonito" seria desonesto.
- **Menor teste:** exportar a Lar e conferir que evidências NAO_COMPROVADO aparecem.
- **Benefício:** o produto final chega às mãos de quem decide.

## 8. Extração de informações de PDFs públicos

- **Problema resolvido:** fatos citáveis (relatórios, editais, apresentações) vivem em
  PDFs que o page_reader ignora.
- **Reuso:** o gateway tem `page_reader`; PDFs exigem parser (pdf-parse) no
  resolve-service (bun). Custo: 1 dependência no mini-service + regra de seleção
  (só PDF de domínio já validado como fonte da conta).
- **Custo operacional:** leitura maior que HTML (timeout); aplicar aos casos
  gap-driven (etapa B LISTADA, licitações).
- **Risco factual:** médio — PDF pode ser antigo; exigir data/período no trecho extraído
  (a regra EVIDENCE_RULES já reprova número sem período).
- **Menor teste:** RI da Petrobras (relatório PDF) → trecho de receita com período.
- **Benefício:** cobre a lacuna de "escala comprovada" que buscas não sustentam.

---

## Priorização sugerida (retorno/custo, sem implementar agora)

1. **Cache de fontes (1)** — maior economia direta de cota, risco baixo.
2. **Diff temporal (4)** — transforma re-pesquisa em valor; reusa auditoria existente.
3. **Exportação executiva (7)** — entrega o produto final; 0 cota.
4. **Comparação entre empresas (3)** — 0 cota, usa checkboxes da Mesa.
5. **Teia com prova (6)** — diferencial factual, 0 cota de busca.
6. **FTS local (2)** — útil quando os lotes crescerem (5 mil).
7. **CVM/PNCP (5)** — só quando a carteira tiver LISTADAS reais.
8. **PDFs (8)** — dependência nova; por último.

Nenhuma destas oportunidades exige mudança de arquitetura, novo serviço, ou quebra do
contrato de um único escritor / sem cron / sem Redis.
