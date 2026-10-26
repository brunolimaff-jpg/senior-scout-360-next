# PLANO V0.6 — Scout 360 · Correção de inteligência, jornada e segurança

> Fonte: auditoria externa do ZIP v0.5.0 (veredito FAIL comercial, base técnica aproveitável)
> + feedback de UI do header compacto + ideias de ingestão (pdfcn).
> Regra: **corrigir o projeto existente — nunca reconstruir.** Ponytail: causa raiz,
> menor conjunto de alterações suficiente, validação real antes de declarar PASS.

---

## Fase 0 — Feito nesta rodada (header/UI)

- [x] Header v2: 56px → 48px rolado, marca **sempre visível** (não desaparece no scroll),
      "Como funciona" sempre presente como pílula de vidro, hairline inferior constante
      + sombra que acorda ao rolar, barra de progresso só aparece quando há leitura.
- [x] Hero com respiro: badge com mb-6, pt-10/pt-16, lead mt-4.
- [x] Luz espectral no vidro do header (transform-only, reduced-motion respeitado).

---

## Fase 1 — P0 · VERACIDADE DOS DADOS (o comercial não pode ser induzido a erro)

### 1.1 Faturamento inventado — `lib/enrich/faturamento.ts`
- **Causa**: porte `DEMAIS`/ME/EPP, Lucro Real/Presumido e "não optante do Simples"
  viravam faixa afirmada (ex.: "Acima de R$ 4,8 mi"). O próprio código reconhece que a
  Receita não publica faturamento por CNPJ — e depois transforma classificação cadastral
  em receita.
- **Correção**: eliminar toda inferência. Nova regra: **sem receita identificada e
  documentada → o campo NÃO APARECE** na apresentação comercial (nem "não encontrado").
  Receita só entra com valor publicado + período + escopo + fonte + natureza do dado.
- **Consumidores a limpar**: sínteses IA (fast/deep), painel Panorama, ficha do dossiê,
  exports (colunas `faturamento_faixa`/`faturamento_base` removidas dos CSVs comerciais).
- **Golden case**: Lar Cooperativa e Jotabasso **não** podem exibir faixa derivada de porte.

### 1.2 Regime tributário — `lib/enrich/sources.ts:180–194`
- Preservar Lucro Real como **informação fiscal**, mas com fonte, exercício/ano de
  referência, distinção histórico vs. vigente, e agregador nunca tratado como confirmação
  oficial. Proibido inferir porte/faturamento do regime.

### 1.3 Score comercial 0–100 — `lib/score.ts` + UI + exports
- **Remover da experiência**: badge N/100, ordenação por nota, bandas, círculo de
  prioridade, colunas `score_prioridade`/`score_banda` nos CSVs. **Não criar score equivalente.**
- **Substituição**: resumo executivo da conta (texto seco, sem moldura/indicador de IA)
  no topo do dossiê — quem é, como opera, tecnologia identificada, pontos a aprofundar.
  Tudo só com evidência.

### 1.4 Perguntas da primeira conversa — `lib/enrich/ai.ts:216, 258–280`
- Remover a obrigação de gerar perguntas/scripts de abordagem (fast e deep).
- "Próximo movimento" genérico sai da jornada.

### 1.5 Pessoas — "Quem provavelmente decide" → "Administração e representantes registrados"
- QSA não comprova quem compra tecnologia. Separar sócios, administradores, dirigentes,
  responsáveis de TI e compradores **com fontes específicas** por papel.

### 1.6 Fundação ≠ abertura cadastral
- Já tratado no deep (regra 2 endurecida); replicar para o fast e para o dossiê estático.

## Fase 2 — P0 · INVESTIGAÇÃO DE TECNOLOGIA (o teste mais discriminante)

### 2.1 Corrigir o empacotamento — `lib/enrich/ai.ts:538–568` + `research.ts`
- **Causa**: só as 5 primeiras buscas entram na síntese e o pacote é cortado em 18k chars —
  o coletor acha o fornecedor e a síntese não recebe a evidência.
- **Correção**: reservar cota por dimensão (identidade, operação, escala, **tecnologia**,
  mudanças) independentemente da ordem das buscas; sinais tecnológicos e notícias de
  mudança nunca descartados por truncamento. Não é "aumentar token": é orçamento por
  dimensão + priorização por relevância comercial.

### 2.2 Ampliar fontes tecnológicas
- Casos publicados pelos fornecedores (SAP newsroom, delaware, integradores), notícias da
  empresa, vagas corporativas/páginas de carreira, contratos e processos públicos,
  documentação institucional, portais de clientes/fornecedores/candidatos.
- Busca por **marca, grupo e domínio** além do nome jurídico (`searchNameFor` já existe —
  estender para variantes de marca).
- Prompt fast: parar de incentivar "sem tecnologia" genérico — instruir citação do que o
  pacote trouxer e lacuna honesta quando não trouxer.

### 2.3 Classificação de estado (não confundir vaga com produção)
- `Em uso confirmado` · `Implantação anunciada` · `Mencionada em vaga` · `Indício não
  confirmado` · `Nenhuma evidência após pesquisa`.
- Sinal Senior (vaga de dev Senior/ERP) → **conta de Base/expansão**, não New Name.

### 2.4 Golden cases obrigatórios
- **Jotabasso**: SAP S/4HANA implantado 2020 + atualização S/4HANA 2023 / RISE with SAP
  (delaware, 2026). Se sair "sem evidência de ERP" → FAIL.
- **Lar Cooperativa**: vaga "Desenvolvedor — Sistemas Senior" (nov/2025, LinkedIn) como
  sinal de atividade técnica associada ao produto; estado atual não declarado sem prova.
- **Petrobras** (regressão): manter as conquistas do audit-round-5 (escopo de entidade,
  períodos, dedupe) — nada do que vem agora pode reverter isso.

## Fase 3 — P0 · SEGURANÇA DOS ARTEFATOS (G7)

- `build-zip.sh` **sanitizado por padrão**: sem `db/custom.db` (dados reais dos lotes),
  sem `evidencias/` com dados de empresas; kit = código + docs + scripts. Modo completo
  (`--full`) fica para uso autorizado local, nunca servido pelo preview.
- `db/custom.db` com dados de clientes/sandbox **navegando fora do preview** → limpeza
  dos lotes reais ou banco novo no fim do ciclo.
- `/api/imports/export-all` (e rotas de export): documentar exposição e adicionar guarda
  mínima (token de ambiente `SCOUT_EXPORT_TOKEN` opcional; se definido, exige header).
- O botão "Baixar projeto (.zip)" permanece — apontando para o kit **sanitizado**.

## Fase 4 — P1 · DOSSIÊ REESTRUTURADO (jornada única, sem repetição)

Nova ordem (seções sem conteúdo relevante **não são geradas**):
1. Resumo da empresa (3–5 frases informativas, sem generalidade) — substitui o score
2. O que faz e como opera (produção, serviços, unidades, cadeia de valor)
3. Escala comprovada (funcionários, receita documentada, capacidade, unidades — com período)
4. Estrutura e pessoas (matriz, grupo, QSA como administração registrada)
5. Tecnologia e sistemas identificados (fornecedor, função, estado, fonte, data)
6. Mudanças relevantes (notícias/investimentos que alteram a leitura comercial)
7. Possível relação com Senior ou concorrentes (processo observado → tecnologia existente
   → lacuna → **"Aderência ainda não comprovada"** quando não houver evidência)
8. O que falta investigar (só lacunas que mudariam a decisão)

Remover: perguntas de abordagem, repetição de hipóteses entre seções, população do
município como escala, CNAEs secundários como descrição do negócio.
Cadastro/logs/fontes ficam na camada secundária (aba Dados/Evidências).

## Fase 5 — P1 · REVISÃO HUMANA SEM BECO SEM SAÍDA — `decide/route.ts:50–70`

- Tela "Confirmar identidade" separada do dossiê resolvido.
- Mostrar **Pista recebida** → **O que conseguimos comprovar** → por que cada candidato
  apareceu (nome, local, fonte, situação cadastral, divergências) — nunca afirmar
  "vínculo comprovado" por nome semelhante. Alerta de situação cadastral ANTES da decisão.
- `Nenhuma destas é a empresa` abre o caminho: **adicionar outra pista** (site/domínio/
  CNPJ/telefone/cidade) → reprocessar **na mesma linha**, preservando histórico;
  informar CNPJ correto; manter como não identificada; voltar aos candidatos.
- Remover "Copiar link" (e seu estado) do dossiê — `batch-detail-card.tsx:2535–2546`.

## Fase 6 — P1 · LAYOUT E LEGIBILIDADE — `batch-detail-card.tsx:849–855`

- Ficha extensa fora da linha da tabela: expansão vira painel apropriado (drawer/sheet
  em ≥1024px; página/modal completo abaixo disso); uma coluna quando não há espaço.
- Zero sobreposição de texto/badge/botão; zero rolagem aninhada; header do painel e
  fechar acessíveis; fundo neutro priorizando conteúdo (reduzir gradiente decorativo).
- Testes 390 / 768 / 1024 / 1440 px, incluindo com painel lateral aberto.

## Fase 7 — V0.6.x · INGESTÃO DE PDF (inspiração shadcn-labs/pdfcn)

- **Upload de PDF na entrada** (contratos, listas de contas, folders): extrair texto
  (pdf-parse/unpdf no server) e detectar CNPJs/pistas como já se faz com CSV/colagem.
- Depois: **parser de relatórios oficiais** (o que destravaria os 4 números da Petrobras
  que vivem em PDF: R$ 497,5 bi, 129.961 terceiros, US$ 109 bi, S/4HANA/Ariba).
- UI: dropzone aceita `.pdf` com o mesmo tratamento de prévia/confirmação.

---

## GATES DE ACEITE

| Gate | Critério |
|------|----------|
| G1 Lar | Cooperativa agroindustrial reconhecida; sem faturamento inferido; sinal Senior (vaga) capturado; nada de transporte de produtos perigosos inventado |
| G2 Jotabasso | SAP S/4HANA 2020 + RISE 2026 por fontes diretas; sem sugestão de troca de ERP presumida |
| G3 Madeireira | Candidatos explicados; "Nenhuma destas" permite nova pista na mesma linha; nenhuma escolha irreversível |
| G4 Interface | Sem score, sem copiar link, sem perguntas comerciais, sem sobreposição/transbordo |
| G5 Dados | Sem faturamento sem evidência; regime com fonte+período; QSA ≠ decisor comprovado |
| G6 Regressão | CNPJ/domínio/nome, matriz, fila, histórico, exports e rastreabilidade continuam de pé |
| G7 Segurança | Nenhum download público de banco/dados consolidados sem autorização |
| G8 Execução | Relatório com arquivos alterados + evidências + PASS/FAIL honestos; lint/build verdes não são PASS |

## ORDEM DE EXECUÇÃO (rodadas do cron)

1. **R1** Fase 1.1–1.3 (faturamento + regime + remoção do score) → rebuild exports
2. **R2** Fase 2 (empacotamento por dimensão + fontes tecnológicas + classificação) → golden cases Jotabasso/Lar
3. **R3** Fase 3 (sanitização do kit + guarda nas exportações) — *parcialmente antecipada para esta rodada*
4. **R4** Fase 4–5 (dossiê 8 seções + revisão sem beco) 
5. **R5** Fase 6 (layout responsivo) + regressão completa G1–G8
6. **R6** Fase 7 (PDF na entrada; parser de relatórios em seguida)

Estado desta rodada: Fase 0 concluída e verificada (screenshots `tool-results/hdr2-*.png`);
Fase 3 parcial (kit sanitizado); Fases 1–2 e 4–7 pendentes para as próximas rodadas.
