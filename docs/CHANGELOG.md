# CHANGELOG — Scout 360

## v0.11.1 — "Homologação intensiva: 13 gates, 13 correções provadas, primeira dobra devolvida à mesa"

Rodada de homologação sobre a v0.11.0 (missão INVESTIGAR → TESTAR → REPRODUZIR →
CORRIGIR → REGREDIR → DOCUMENTAR). Nenhuma funcionalidade nova além de correções
de defeitos reproduzidos; nenhuma regra de negócio alterada para aprovar teste.

### Gate 1 — Proteção anti-indexação (total)
- `layout.tsx`: metadata robots noindex/nofollow/noarchive/nocache + googleBot.
- `next.config.ts`: header `X-Robots-Tag: noindex, nofollow, noarchive` em TODA
  resposta (páginas, APIs, exportações CSV/Excel/PDF reais, 404, estáticos, ZIP).
- `robots.txt`: `User-agent: * / Disallow: /` — ANTES permitia explicitamente
  Googlebot/Bingbot/Twitterbot/facebookexternalhit (inversão perigosa corrigida).
- Provado por curl em 11 classes de resposta (qa/homolog-v0110/gate1/).
- Auditoria de acesso: 28/31 rotas com assertAccess; 3 abertas por design.

### Correções críticas de identidade (Gate 4 — matriz adversarial 18/18)
- **Contaminação de pistas (C6, CRÍTICO)**: `resolveIdentity` empurrava nomes
  colhidos no site/RDAP da própria candidata para `clues.names` (mutação por
  referência compartilhada com o motor) — a avaliação de identidade comparava a
  ficha contra o nome colhido no site da própria empresa (similaridade 1) e
  aprovava par nome×CNPJ errado SEM divergência. Nomes de fonte são agora só
  evidência de descoberta; a avaliação usa exclusivamente pistas do usuário.
- **Beco sem saída (C6)**: identidade CONFIRMADA automaticamente agora pode ser
  reaberta/corrigida pelo operador (NOT_FOUND, nova pista, correção de CNPJ com
  auditoria do valor automático anterior) — decisão HUMANA continua fechada.

### Correções de coerência (Gates 2/3 — indicadores × população)
- Filtro "Não encontradas" devolvia 0 com 10 linhas UNRESOLVED (Prisma `not`
  exclui NULL): NULL participa do OR.
- Botão "Identificadas" contava linhas LOCALIZADO (em revisão) que o filtro
  excluía (62 vs 54); "Pendentes" contava falhas recuperáveis (13 vs 8). Novo
  `totalFila` e `totalDirectCnpj` corrigido — cada botão bate com sua tabela.

### Gate 6 — Primeira dobra devolvida à mesa de investigação
- Resumo do lote vira UMA LINHA no estado de investigação (cards completos
  abrem sob comando; recolhem ao trocar de lote).
- Banner de revisão separado extinto — CTA "Revisar agora" no painel de
  resultado compacto (título + avisos em chips + ações, ~64px).
- Filtros rápidos movidos para a BARRA DA MESA (largura total): antes quebravam
  em 2 linhas dentro da coluna de ~420px da lista.
- **Linhas visíveis com ficha aberta**: 1920×1080: 3-4 → **8** · 1440×900: →**6**
  · 1100×900: →**6** · 1366×768: 3 → 4 (limite físico documentado) · 1024: lista
  única. Zero overflow horizontal nas 7 larguras; VLM APROVADO no 1920.

### Correções de exportações (Gate 9 — 196/196)
- F1: pdf_lote listava NAO_ENCONTRADO como "identificada" (bullet sem nome).
- F2: Excel rotulava linha não encontrada como "ENRIQUECIDO".
- F3: CSV truncava socios_qsa em 12 em silêncio (qtd_socios dizia 32).
- F4: título órfão no PDF (flushTitulo antes do garante do grupo).
- F5: CSV inteligência perdia TODAS as hipóteses (guarda de tipo errada).

### Correções de relações (Gate 8 — 103/103)
- G8-1: avisos de normalização de relações agora persistidos (`avisosJson` em
  RelacaoSocietariaCache — evolução aditiva com backup+ensaio) e devolvidos na
  releitura de cache.
- G8-3: `empresasOcultas` do caminho de cache subtraía a lista cheia (dizia 0
  com 10 ocultas). G8-2 documentado como pendente.

### Gate 10 — Falha e recuperação (125/125)
- 12 cenários (429/500/timeout/rede/incompleto/lixo/atrasado/duplicado/restart
  real/lote interrompido/export falha/prefs) — todos PASS. Fix G10-2: mensagem
  de backoff cita a causa real (429|erro|timeout). G10-1 pendente (mapeamento
  de corpo 200 não-JSON).

### Dívidas técnicas (Gate 12)
- tsc completo: 96 erros classificados — src/ tinha 2 (corrigidos); 73 são
  falsos positivos Bun (bun-types não referenciado); 21 em scripts QA legado.
- `.env.example` criado + LEIA-ME atualizado (fresh clone falhava no db:push).
- ignoreBuildErrors/--accept-data-loss: permanecem, com procedimento de
  retirada documentado (qa/homolog-v0110/gate12/estado-tecnico.md).
- Gate 13 (Folder Z.ai): VERIFICADO PARCIALMENTE — mounts ossfs graváveis e
  íntegros na VM; o "Folder 2GB" não é identificável como mount; acesso
  cross-conversa não verificável daqui → NÃO adotado como canal de checkpoint.

### Regressões verdes nesta rodada
v0101 · v01012 (40/40) · v01015 (71/71) · v01023 (54/54) · v01022 (22/22) ·
v01016 (71/71) · v0105 (65/65) · v01010 (18/18) · gate4 (18/18) · gate8 (103/103)
· gate9 (196/196) · gate10 (125/125) · lint limpo · tsc src/ 0 erros.

## v0.11.0 — "Mesa de Investigação: uma jornada, uma estação — recuperação da v0.10.24 + contrato de UX"

Retomada após perda da VM. O kit v0.10.24 verificado (ZIP SHA-256
`3aff30cdf4f1ab7a7b92db584a238f947ce9b751e40ec200b56ba32ddfe1ba48`) foi
restaurado verbatim (commit b370283) e o contrato "RECONSTRUÇÃO DA
EXPERIÊNCIA — UMA JORNADA, UMA MESA DE TRABALHO" foi executado por cima,
sem reconstruir nada. ZERO consulta externa nova; ZERO execução automática.

### 1. ENTREGA B — ESTAÇÃO: entrada e operação separadas (page.tsx)
- Dois estados de navegação. **Estado 1 (entrada)**: sem lote aberto — hero,
  entrada de pistas e histórico como antes. **Estado 2 (Mesa de Investigação)**:
  com lote aberto o hero SAI, o contêiner ganha a largura disponível
  (`max-w-[1720px]`, margens 24–32px) e surge um cabeçalho operacional compacto
  (arquivo + estado + "Nova entrada" recolhível + histórico no menu "Lotes").
  O formulário de importação não domina mais a jornada operacional.
- Aceite provado no navegador: lote aberto mostra a estação, não uma landing
  page estendida.

### 2. ENTREGA C — LISTA E DIVISÃO: contêiner real, controles compactos
- `useLarguraConteiner` (ResizeObserver): a divisória responde à largura do
  CONTÊINER da mesa (limiar 980px), não da janela — com a barra lateral do
  ChatGPT aberta a mesa prioriza UM painel legível (ficha em Sheet com retorno
  claro) em vez de espremer dois. Prova: 1440 (dividido) → 800 (único, empresa
  preservada) → 1440 (dividido, empresa preservada).
- Distribuição inicial **32/68** (era 45/55). Chave de painéis v2
  (`scout360.mesa.paineis.v2`): preferências antigas de tamanho são ignoradas
  sem apagar modo/colunas/ordenação do operador.
- Lista: cabeçalho compacto (busca + situação + menu "Ajustes" com visão,
  colunas e estado da pesquisa), chips rápidos h-6, tabela com UMA rolagem
  (sem `max-h-70vh` aninhado), paginação como pé fixo. A auditoria saiu do
  painel da lista. Barra "MESA DE INVESTIGAÇÃO" com os modos Lista | Dividido
  | Foco envolvendo toda a estação.
- Arraste provado: 0 chamadas de API durante o arraste (hook de fetch no
  navegador), sem remontagem, sem perda de seleção/filtros/rolagem.

### 3. ENTREGA D — FICHA: respiro e colunas adaptativas
- Padding de leitura 24px+ (px-6/py-5), seções com mais espaço entre título e
  conteúdo, tiles com p-4 e mt-1.5, corpo `space-y-9`.
- `CompanyFicha`, Contatos e Notícias: colunas por **container query** — duas
  colunas só com largura de leitura (@min-[480px]); em painel estreito, uma
  coluna com respiro. O `grid grid-cols-2 gap-2` (8px) da v0.10.24 acabou.
- Navegação por seções: a rolagem fica CONTIDA no corpo da ficha
  (`rolarSecaoFicha`) — clicar numa seção NÃO move mais a página principal
  (defeito de rolagem concorrente corrigido).

### 4. ENTREGA E — INVESTIGAÇÃO: jornada única e plano agrupado
- Seção 6 virou "Investigar esta empresa" na ordem do contrato: **o que
  sabemos (Próximo movimento) → o que falta descobrir (lacunas) → consultas
  disponíveis (Triagem) → consulta completa (DeepResearchBar, sob comando) →
  resultado (Cobertura factual)**.
- **Plano de consultas AGRUPADO por tipo**: resumo compacto (consultas
  propostas · empresas envolvidas · chamadas totais · grupos por tipo); o
  mesmo aviso técnico e a mesma nota de custo aparecem UMA vez por grupo em
  vez de repetidos em 12 cartões; aprovação continua INDIVIDUAL (mesmo
  comando da ficha); perguntas fora do alcance em áreas expansíveis POR TEMA.
  Proveniência e a regra "participante comum não comprova grupo" preservadas.
- A estação (mesa) subiu para logo após as métricas/estado; panorama, plano,
  leitura do conjunto, telemetria e auditoria ficaram ABAIXO da mesa — nada
  empurra a estação para fora da primeira dobra.

### 5. QUALIDADE (Entrega F)
- Lint limpo; tsc limpo no código de UI (erros restantes são de scripts Bun
  fora do escopo do Next, pré-existentes).
- Regressões executadas e verdes: v0.10.1 (QSA/portão), v0.10.12 identidade
  (40/40), v0.10.15 exportações (71/71), v0.10.23 inteligência incl. C8-B
  (54/54), v0.10.24 rota do lab com banco isolado (8/8).
- Validação visual no navegador real: 1920×1080, 1440×900, 1366×768, 1024,
  ~900 e 390 (mobile) — entrada, mesa, lista, dividido padrão/arrastado,
  foco, identidade, resumo, revisão, investigar, plano compacto, troca A→B,
  exportação. Evidências em qa/mesa-v0110/.
- a11y: Sheet da ficha ganhou título/descrição sr-only (avisos do Radix
  silenciados na origem).
- Lote sintético isolado (`QA-mesa-sintetico-v0110.csv`, raiz 99.000.100,
  CNPJs de DV válido não alocados) criado por `scripts/seed-qa-mesa-
  sintetico.ts` — NENHUMA consulta externa disparada; arquivável a qualquer
  momento.

## v0.10.24 — "Correções do parecer do checkpoint: causa raiz do laboratório, identidade governa a ficha, avisos no cache e exportação provada"

Sobre a v0.10.23 (Entrega 5). Nada reconstruído. ZERO IA, ZERO consulta
automática nova: as consultas continuam exclusivamente sob comando.

### 1. ROTA DO LABORATÓRIO — causa raiz do sumiço (desvio 1 do parecer)
- **Causa raiz descoberta**: o `.gitignore` tinha o padrão nu `test` — ignorava
  QUALQUER pasta com esse nome na árvore. `src/app/api/lab/test/` nunca saiu do
  disco; saiu do GIT (e do pacote auditado) silenciosamente. O commit v0.10.23
  herdou o furo (o padrão sem barra ignora em qualquer profundidade).
- Padrões ancorados na raiz (`/test`, `/prompt`) e rota `POST /api/lab/test`
  devolvida ao controle de versão, byte-idêntica ao ZIP auditado da v0.10.22
  (SHA conferido por extração do pacote). Contrato intacto: gate server-side
  (`SCOUT_LAB_ENABLED`), 404 quando fechada, autenticação `assertAccess`, chave
  nunca ecoada, telemetria `LAB_PROBE_EXTERNO` com `inferencia:false` e
  `tokens:0` — SEM inferência no teste de conexão.
- Suíte nova `scripts/test-v01024-lab-route.ts` (8/8, banco isolado em /tmp e
  provedor mock em loopback): desabilitado → 404 LAB_INDISPONIVEL; modo TOKEN
  sem flag → fechado; OPEN sem credencial → 400 LAB_NAO_CONFIGURADO com probe
  vazio honesto; mock 200 → ok:true com modelo presente; mock 401 →
  CONEXAO_FALHOU com a chave NUNCA no corpo; 2xx sem lista → modeloPresente
  null (indecisão honesta); redactKey provada; telemetria de sucesso e falha
  gravada com inferencia:false.

### 2. FICHA — a identidade da empresa governa o estado (desvio 2 do parecer)
- **Defeito REPRODUZIDO no navegador** (além do risco apontado pela auditoria):
  a remontagem por `key` nos painéis da ficha deixava, ao navegar
  Anterior/Próxima, um nó órfão VISÍVEL com o painel "Próximo movimento" da
  empresa A dentro da ficha da empresa B (React reconcilia a key nova sem
  remover o nó antigo neste slot). Reproduzido com cache limpo e página nova.
- Correção uniforme nos 4 painéis (matriz/filiais, relações societárias,
  próximo movimento, triagem): **sem key de remontagem**; reset de estado na
  fase de render quando `batchId/rowNumber` muda (sem sequer um frame com dados
  da anterior) + guarda de identidade em toda resposta em voo (a resposta
  atrasada de A é descartada e o `finally` de A nunca apaga o loading de B).
- Provas no navegador (dados locais, zero consulta externa): A→B mostra 1
  painel só com dados de B e a ficha de B deixa de mencionar A por completo;
  B→A restaura só dados de A; salto rápido com resposta em voo não duplica nem
  mistura; modo dividido e modo foco idem; mobile 390 sem scroll horizontal e
  reabertura isolada.

### 3. AVISOS DE UNIFICAÇÃO PRESERVADOS NO CACHE (desvio 3 do parecer)
- `QuadroParticipanteCache.avisosJson` (coluna nullable, aditiva) guarda os
  avisos da normalização na coleta; a leitura de cache e a hidratação do mapa
  devolvem o MESMO aviso da 1ª consulta. Fallback determinístico para linhas
  antigas: rederiva o aviso de teto de `truncado/totalEmpresas`; o aviso de
  unificação não é rederivável e fica ausente — nada inventado.
- Migração com protocolo completo: backup consistente (VACUUM INTO, SHA
  registrado no worklog), ensaio do push em cópia isolada, contagens íntegras
  (9 lotes, 155 linhas) após a aplicação. Nenhum `--accept-data-loss` em
  momento algum. A coluna já havia sido aplicada pelo executor paralelo às
  04:28 UTC de 23/10; verificada de forma independente nesta rodada.

### 4. PROVA COMPORTAMENTAL DE EXPORTAÇÃO (desvio 4 do parecer) — C8-B
- `test-v01023-inteligencia.ts` ganhou o bloco C8-B (15 verificações): dataset
  comercial e Excel gerados DUAS vezes com dados sintéticos equivalentes,
  gravados em disco e REABERTOS (exceljs); fatos, vínculos, datas e estados
  comparados com literais escritos à mão; metadados variáveis de workbook
  ignorados (diferença legítima); **trap de fetch** prova zero consulta externa
  durante TODA a exportação; TRIAGEM_V1 reaberta do disco valida no schema do
  contrato. Suíte: 54/54 (39 anteriores + 15 novas).
- Literais envelhecidos do v0106 (padrão proibido "estabelecimento(s)") foram
  atualizados ao contrato de linguagem natural — mesma correção de classe
  aplicada ao v0105 na rodada anterior. v0106: 89/89.

### 5. GOVERNANÇA
- Incidente de escritores concorrentes na VM (23/10) registrado no worklog com
  prova por timestamps; Option A autorizada pelo Bruno; commits paralelos
  inspecionados e adotados após revisão de diffs; transferência de escrita
  documentada. Suítes desta rodada regeneraram artefatos de evidência das
  rodadas v0.10.6/v0.10.22 (efeito colateral de design das próprias suítes) —
  restaurados ao estado auditado do git antes do fechamento.

### 6. REGRESSÕES (todas verdes nesta rodada)
v0105 65/65 · v0106 89/89 · v0107 46/46 · v01012 40/40 · v01015 71/71 ·
v01016 71/71 · v01017 150/150 · v01018 29/29 · v01022 22/22 · v01023 54/54 ·
v01024 (laboratório) 8/8 · resolver-golden · revalidação segura · lint 0 ·
tsc --noEmit sem erros nos arquivos da rodada (dívida pré-existente em
examples/, mini-services/ e scripts/ auxiliares documentada para a
consolidação arquitetural autorizada).

## v0.10.23 — "Entrega 5 — Inteligência: o que os quadros públicos dizem, mapa leve e próximo movimento"

Sobre a v0.10.22 (PDF executivo/completo). Nada reconstruído, nenhuma
biblioteca nova, ZERO IA, ZERO consulta automática: tudo é leitura
determinística sobre dados JÁ persistidos nesta investigação.

### 1. FICHA — "O que os quadros públicos dizem" (leitura comercial das relações)
- Bloco novo no painel de relações societárias, ACIMA da lista técnica:
  frase-resumo + grupos por tipo (`lerRelacoes()`): sócios pessoas físicas,
  participações de pessoas jurídicas, papel de administração registrado,
  estabelecimentos da MESMA empresa, empresas com participante compartilhado
  e relações não confirmadas (teto de 6 nomes por grupo; contagem real segue).
- Ressalva material única e só quando o fato existe: administração registrada
  é fato do cadastro e NÃO indica quem decide (`AVISO_ADMINISTRACAO`).
  Participante comum segue com a negação dedicada de grupo econômico —
  "grupo econômico" só existe no produto para NEGAR a conclusão.

### 2. FICHA — Mapa leve das relações (experimento controlado, SVG determinístico)
- `GrafoRelacoesCard`: raiz → participantes → empresas de quadros JÁ expandidos
  por comando e empresas com participante compartilhado. Sem biblioteca de
  grafos, sem medição de texto, sem IA; acessível (role="img", aria-label,
  <title> por nó/aresta) e com legenda + proveniência de cada ligação de
  nível 2 ("vêm de 1 quadro já consultado…").
- Hidratação pelo NOVO GET `…/relacoes-societarias/quadros` (LEITURA PURA do
  cache; zero rede). Expansões feitas na sessão têm precedência — o cache
  nunca sobrescreve estado vivo.
- **Experimento controlado**: se o mapa não dissesse nada além da lista
  (só estrela raiz→participantes), ele NÃO existe — provado no navegador:
  linha com sócio único e sem quadro expandido não renderiza nem o toggle.
- Tetos declarados: 8 participantes × 2 empresas por participante; o que
  corta vira nó agregado honesto ("+1 outras") e a contagem real segue na lista.

### 3. FICHA — "Próximo movimento" (leitura comercial estruturada)
- Bloco novo na seção "O que falta descobrir" (`montarProximoMovimento()`):
  O que sabemos · O que merece validação · O que ainda não encontramos ·
  O que vale investigar agora — cada seção com teto de itens, sem repetir a
  triagem inteira, sem executar consulta nenhuma; nota de rodapé declarando
  a leitura como feita sobre dados já coletados.

### 4. Auditoria do normalizador (despacho do Planejador, item 3)
- `normalizarQuadroParticipante()` deduplica por CNPJ completo — correto para
  o contrato do quadro (lista ESTABELECIMENTOS distintos). A unificação de
  linhas repetidas da fonte agora fica VISÍVEL em aviso honesto (antes era
  silenciosa e podia parecer resposta integral). Provas N1–N4: 3 linhas do
  mesmo CNPJ → 1 estabelecimento + aviso; CNPJs distintos sem aviso; primeira
  razão social mantida (determinístico); nenhum campo de sócio (cpf/nome/id)
  vaza no quadro.

### 5. Testes adversariais de identidade (8 casos) — `scripts/test-v01023-inteligencia.ts`
- 39/39 PASS: homônimo em município distinto (divergência vira validação, nunca
  fato sabido); página de terceiro (grafo não inventa nó); mesma PJ em matriz e
  filial (aresta "mesma-empresa", nunca empresa distinta); participante
  compartilhado (negação de grupo econômico literal); tipo não confirmado (nunca
  PF/PJ por eliminação); cache expirado (quadro vencido não volta como ligação);
  tetos do grafo (corte declarado + agregado); export = UI (arquivos de
  exportação sem referência às leituras novas — contrato pdf_empresa intacto).

### 6. Evidências e regressões
- `evidencias/round-v0.10.23/`: leitura + mapa em desktop e 390px (sem scroll
  horizontal da página), próximo movimento, omissão do mapa provada; leitura da
  sessão de evidência 100% em cache (`cacheHit=true` — zero chamada externa).
- Regressões verdes: v0105 65/65 · v01016 71/71 · v01017 150/150 · fase-zero
  29/29 · pdf-níveis 22/22. Lint limpo. TypeScript limpo nos módulos alterados.
- Asserção da v0105 atualizada para a linguagem natural da Fase Zero (fim do "(s)").

## v0.10.17 — "Refinamento final: home sem encobrimento, dossiê executivo em PDF e contrato de tom de voz"

Refinamento sobre a v0.10.16 (classificação PF/PJ, reconciliação tela×PDF e
exportações preservadas). Não adiciona funcionalidade, não reconstrói o
frontend e não troca bibliotecas. Foco: leitura, organização e utilidade
comercial — o rigor permanece nos dados e nas evidências.

### 1. HOME — cabeçalho nunca encobra o título
- `scroll-mt-24` nos alvos de rolagem (tabela da prévia, seção do lote) e
  rolagem guiada ao abrir um lote: "Resultado deste lote", indicadores e ações
  nascem sempre ABAIXO do cabeçalho fixo (capturas em 1440/1024/390).
- Âncora `[data-ficha-secao]` agora existe de fato (o chip "Revisar
  identificação" voltava a rolar para um seletor morto).

### 2. HOME — resumo conforme a etapa e rótulos que dizem o que contam
- Antes de iniciar: mantidos os 2 indicadores + comando (v0.10.16).
- Durante/depois: hint de entradas virou "24 de 24 consultas concluídas"
  (fim do "24 linha(s) processada(s) · 0 aguardando execução"); fila de
  pesquisa virou "12 de 24 contas concluídas".
- **Rótulo × cálculo**: o hint das identificadas dizia "CNPJ localizado(s)"
  mas o número conta RAÍZES distintas — agora lê "24 empresas localizadas no
  total". PDF do lote e Excel alinhados ("Empresas localizadas (raízes
  distintas)", "Consultas na fila").

### 3. CONTRATO DE TOM DE VOZ APLICADO AO PRODUTO INTEIRO
- Exemplos do despacho aplicados literalmente: "Consultamos fontes públicas
  com moderação…" saiu (progresso e popover "Como funciona"); "Esta resposta
  depende da sua validação." → "Confirme essa informação com a empresa.";
  estados de lacuna viram PRÓXIMO PASSO (`ESTADO_LACUNA_COMERCIAL`: "Peça a
  consulta complementar na ficha desta empresa." etc.); ficha usa "O que
  falta:" / "Como verificar:" (igual ao PDF); "REPRESENTANTES REGISTRADOS"
  sem atribuir poder de compra; triagem sem parágrafos defensivos ("não é
  'não encontrado', é não consultado" saiu da leitura corrente; a distinção
  continua registrada onde muda interpretação); rodapé da home em voz direta.
- Motor de triagem: frases de falta/ação/motivo reescritas em voz ativa, sem
  códigos internos (estados de fonte saem das frases), sem promessa automática
  de consulta. Semântica e testes de estado preservados (89/89).

### 4. PDF — DOSSIÊ EXECUTIVO (modelo ficha-comercial v3)
- **Abertura** com marca Senior/Scout 360, nome comercial como título, razão
  social, CNPJ/localização/situação e "Atualizado em" discreto; divergência
  material em caixa na abertura (única ressalva junto ao dado).
- **Três seções numeradas**: 1 Visão empresarial (atividade cadastrada sem
  parágrafo defensivo; regime com o ano ao lado do dado; contatos) ·
  2 Pessoas e relações (representantes + relações EFETIVAMENTE consultadas,
  empresa × estabelecimento sempre separados) · 3 O que vale investigar
  (até 4 prioridades com a ação concreta, sem contagem por estado interno).
- **Fonte e atualização**: bloco discreto ao final do conteúdo (categoria +
  data) — a última página NUNCA mais é "só observações"; o registro técnico
  do provedor saiu do PDF por inteiro e vive na planilha de evidências e na
  telemetria.
- **Paginação blindada**: seções/anexos nunca quebram deixando título órfão
  (`garante` de título+conteúdo, `reserva()` para blocos compostos, subtítulos
  com reserva); empresa mínima fecha em 1 página (bloco de fonte não vira
  página órfã); anexo espúrio de matriz removido (seção 2 já cobre).
- Anexos preservam tudo: A atividades (uma por linha) · B representantes
  (datas em dd/mm/aaaa) · C relações em detalhe (reconciliação tela×PDF
  mantida) · D o que falta (Pergunta → O que falta → Como verificar) ·
  E leitura de IA como hipótese.
- pdf-lib mantido; lote PDF v3 com rótulos comerciais; "Como verificar" usa a
  ação concreta quando existe (nunca estado + ação repetindo o mesmo pedido).

### 5. SAÍDA TÉCNICA PRESERVADA
- Excel 6 abas, CSV técnicos, JSONL de auditoria, TRIAGEM/PLANO: intactos
  (71/71 na suíte de exportações); dataset único de exportação inalterado —
  interface e arquivos continuam classificando igual.

### 6. TESTES E PROVAS
- Suíte nova `scripts/test-v01017-finalizacao.ts` (150 checks): estrutura v3,
  paginação (mínima=1 página; extensa sem página órfã e sem perda de conteúdo
  — sentinelas do início/meio/fim), caso B divergente (caixa na abertura, sem
  conclusão comercial), varredura de frases proibidas na UI e nos PDFs,
  reconciliação real tela×PDF e idempotência de download.
- Regressões verdes: 17 suítes (v0.10.1→v0.10.17), 919 checks.
- Provas no navegador (evidencias/round-v0.10.17/): home 1440/1024/390 no
  topo/meio/fim sem encobrimento; "antes de iniciar" com 2 números (lote
  sintético confirmado, ZERO consultas, arquivado — banco voltou aos 5 lotes
  do operador); ficha com REPRESENTANTES REGISTRADOS e triagem "O que falta/
  Como verificar"; PDFs A/B/lote renderizados página a página (pdftoppm) e
  reabertos; console e dev.log sem erros.

## v0.10.16 — "Experiência comercial: linguagem do vendedor, ficha leve e PDF de dossiê"

CORRECT_DELTA sobre a v0.10.15 (exportações comerciais continuam valendo). A
aplicação funcionava tecnicamente, mas a experiência ainda era densa e a
comunicação não seguia o contrato de tom de voz. Esta rodada corrige a
ORGANIZAÇÃO da informação, a SEMÂNTICA dos dados e a QUALIDADE dos documentos —
sem trocar cores por trocar, sem reconstruir o frontend, sem nova arquitetura.

### 1. CLASSIFICAÇÃO PF/PJ PROVADA PELA FONTE (correção de semântica)
- **Bug real corrigido**: a interface exibia "SÓCIO (PF)" para BRD DIGITAL
  PARTICIPACOES LTDA (e UNIVERSUM PARTICIPACOES LTDA.) porque a regra residual
  classificava como PF todo participante sem CNPJ reconhecível (id "35444812").
- **Nova regra (`classificarParticipantePorId`)**: hash opaco da fonte = pessoa
  física; CNPJ com DV válido = pessoa jurídica; qualquer outra coisa =
  **INDETERMINADO** (nunca PF por eliminação, nunca PJ sem DV).
- **Vínculo e proveniência preservados**: o participante não confirmado continua
  listado, com explicação comercial e SEM botão de expansão; a falha de expansão
  (rota) volta com mensagem comercial ("Não foi possível ampliar este vínculo.
  Os dados já encontrados foram mantidos.") e `detalheTecnico` separado — sem
  sugerir nova tentativa de falha permanente.
- **Correção à leitura + migração**: `investigarRelacoes` reclassifica caches
  gravados pela regra antiga e grava de volta (zero reconsulta); script
  `scripts/migra-v01016-classificacao-participantes.ts` corrigiu os 2 caches
  existentes no banco (PF → INDETERMINADO), preservando fonte e datas.
- **Rótulos em palavras**: "SÓCIO PESSOA FÍSICA" · "PARTICIPAÇÃO PESSOA JURÍDICA"
  · "TIPO NÃO CONFIRMADO" — mesma leitura na interface, Excel (nova coluna "Tipo
  do participante") e PDF.

### 2. CONTRATO DE LINGUAGEM OBRIGATÓRIO (`src/lib/linguagem.ts`)
- Fonte única das frases derivadas compartilhadas (interface + PDF + exportações):
  regime tributário em linguagem humana ("LUCRO REAL · exercício 2024" + nota fixa
  "O regime atual ainda precisa ser confirmado."), estados de lacuna comerciais
  ("Esta consulta ainda não foi feita." — candidata ≠ executada) e tipo de
  participante legível.
- Reescritas aplicadas: "Fatos já obtidos foram preservados." → "As informações
  anteriores continuam disponíveis."; "Fonte parcial" → frases completas; "5
  pessoa(s) jurídica(s) · 18 estabelecimento(s) no quadro" → "Encontramos 5
  empresas e 18 estabelecimentos registrados nesta consulta"; "Quadros dos
  participantes PF ainda não totalmente expandidos" → "Ainda não verificamos
  todas as empresas ligadas a esses participantes."; mensagens de rota sem jargão.
- Travessões como separadores de pensamento removidos das mensagens críticas;
  provedores (BrasilAPI, MinhaReceita) permanecem apenas em área técnica.

### 3. HOME PROGRESSIVA (`batch-detail-card.tsx`)
- **Antes de iniciar**: só 2 indicadores (Entradas recebidas · Prontas para
  consulta + "Sem CNPJ utilizável" quando existir), painel "Aguardando início" e
  prévia rótulada "PRÉVIA DAS ENTRADAS" — nada de seis indicadores zerados,
  panorama, telemetria ou plano antes da primeira consulta.
- **Durante/depois**: indicadores completos com as 8 leituras nos hints (regras
  v0.10.14/15 preservadas); telemetria recolhida em "Detalhes técnicos do lote".

### 4. FICHA MAIS LEVE (mesma informação, menos aninhamento)
- Exportação em **local próprio**: "Baixar ficha em PDF" saiu dos selos de
  identidade e virou uma barra dedicada no cabeçalho (hairline + alinhado à
  direita, único comando de exportação na ficha).
- "Mais dados do registro público" (setor CNAE, natureza, MEI, outras atividades)
  virou bloco recolhível — a leitura essencial fica na frente.
- Quadro de participante SEM rolagem interna: 8 estabelecimentos + botão "Ver os
  outros N" (nada escondido atrás de scroll aninhado).
- Painel 640px em telas médias (600→640), mesma largura em 2xl.

### 5. PDF COMERCIAL REORGANIZADO (modelo `ficha-comercial v2`)
- **Página 1 com prioridade do vendedor**: 1 Identificação e situação (divergência
  em caixa na abertura) · 2 Atividade e contexto comprovado (CNAE principal +
  "Há 17 outras atividades registradas. A lista completa está no Anexo A.") ·
  3 Informações cadastrais essenciais · 4 Contatos públicos utilizáveis ·
  5 Divergências e confirmações pendentes · 6 Próximos passos de investigação.
- **Anexos com todo o detalhe** (letras POSICIONAIS com plano pré-computado — as
  referências da página 1 sempre apontam certo): A Atividades secundárias (uma
  por linha) · B Representantes · C Matriz, filiais e relações investigadas ·
  D O que falta descobrir (Pergunta → O que falta → Como verificar) · E Leitura
  comercial (IA, hipóteses) · F Fontes, datas e confiabilidade.
- **Lacunas em 3 campos claros** (nada de frase técnica longa) e **provedores fora
  do corpo comercial**: categoria da fonte no texto; identificador técnico só na
  nota "Registro técnico (auditoria)" do anexo de fontes.
- Rodapé com **modelo do documento identificável**: "Modelo ficha-comercial v2 ·
  Scout 360 <versão> · lote · linha" (resumo-lote v2 no PDF do lote).

### 6. RECONCILIAÇÃO RELAÇÕES TELA × PDF (`dataset.relacoesConsultadas`)
- O dataset de exportação agora lê o MESMO estado da ficha: relações diretas em
  cache + **quadros expandidos por comando** (`quadroParticipanteCache`) — os "5
  empresas e 18 estabelecimentos" vistos na tela entram no Anexo C do PDF, com
  EMPRESAS distintas (raiz) e estabelecimentos de cada uma (nunca somados).
- Expansão não consultada → o PDF **declara a limitação** ("A investigação deste
  vínculo ainda não foi feita...") em vez de inventar; sem quadro nenhum →
  "As relações societárias desta empresa ainda não foram investigadas."
- Zero rede, zero IA na exportação; dois downloads consecutivos produzem o mesmo
  conteúdo factual (prova na suíte).

### 7. EXPORTAÇÃO
- Nome de arquivo legível: `ficha-<razão-social>-linha-N.pdf` (antes: hash do lote).
- Diálogo de exportação, escopos e contratos CSV/JSON/telemetria preservados.

### 8. LEITURA COMERCIAL (IA) — regras no prompt (`src/lib/enrich/ai.ts`)
- Novas no contrato de evidências: CNAE é atividade DECLARADA (não comprova
  operação efetiva); notícia de setor não é mudança da empresa; homônimos/nomes
  semelhantes exigem prova do vínculo; separar confirmado · indicado · não
  encontrado · vale perguntar; sem recomendação genérica de produto Senior.

### 9. TESTES E PROVAS
- Suíte nova `scripts/test-v01016-experiencia-pdf.ts`: **69 PASS · 0 FAIL**
  (classificador com os 5 casos de identificador, normalização com o caso BRD,
  guarda de expansão, regime/lacunas em linguagem humana, PDF com 17 CNAEs +
  anexos + reconciliação 5×18, limite sem quadro, lote v2, prompt de IA; Parte B
  HTTP com cache legado corrigido à leitura, nome de arquivo legível, dois
  downloads factualmente idênticos e telemetria zerada — sem consulta pública).
- Regressões TODAS VERDES: identidade 40 · coerência 70 · triagem 89 ·
  adversarial 27 · falhas 18 · limitador 7 · evolução 43 · plano 17 · auditoria
  46 · exportações v0.10.15 71 · v0.10.1–04 (30+50+70) · alfanumérico · golden.
- eslint limpo · tsc src/ 0 erros · provas no navegador (12 capturas em
  `evidencias/round-v0.10.16/`): antes de iniciar, métricas reconciliadas
  24/18/6, ficha (cabeçalho + export dedicado), BRD "TIPO NÃO CONFIRMADO" ao
  vivo no dado real, quadro "Ver os outros", PDF páginas renderizadas, diálogo de
  exportação, mobile 390 e notebook 1150 sem overflow; console sem erros.

## v0.10.15 — "Exportações comerciais: Excel, PDF e uma exportação só"

Missão "inteligência confiável, exportações profissionais e refinamento comercial"
(sobre a v0.10.14 — a reconciliação dos indicadores e o bloqueio de telefone fictício
continuam valendo). Novo: formato principal Excel, PDF da empresa, PDF compacto do
lote e UMA experiência de exportação com duas decisões. Sem reconstruir a interface,
sem trocar arquitetura, sem consulta externa na exportação.

### 1. EXPORTAÇÃO EXCEL (.xlsx) — formato principal (`src/lib/export/excel.ts`)
- **Seis abas, só com dados reais** (aba sem conteúdo não é gerada — nada fictício):
  1. **Resumo** — lote, origem, data da coleta, as oito contagens oficiais
     (entradas recebidas, linhas processadas, aguardando execução, PJs localizadas,
     PJs compatíveis, revisão humana, validadas por você, não localizadas/falhas),
     situação cadastral, UF e observações metodológicas curtas.
  2. **Empresas** — uma linha por entrada com chave estável (`L{linha}/{raiz}`),
     CNPJ, razão social, fantasia, matriz/filial, localização, situação, atividade,
     porte, capital, CONTATOS VÁLIDOS, status da identidade, divergências e fonte/data.
  3. **Revisões** — somente as que exigem conferência, com pista original, cadastro
     encontrado, motivo da divergência e próxima ação recomendada (mesma lógica da tabela).
  4. **Representantes e relações** — uma linha por vínculo (QSA completo + participações
     de grafo público já em cache local), sem inferir grupo econômico.
  5. **Evidências** — propriedades comprovadas, fonte (com categoria comercial e o
     registro técnico preservado), datas e observação; o telefone cru não utilizável
     aparece aqui com a marca "NÃO utilizável como contato".
  6. **Lacunas e consultas** — TRIAGEM_V1 + PLANO_CONSULTAS_V1 pelos MESMOS motores da
     interface (não há segundo motor): consulta candidata entra como "CANDIDATA — não
     executada", nunca como executada.
- **Qualidade obrigatória**: linha de títulos congelada + autofiltro, larguras
  proporcionais, quebra de texto, CNPJ/chave/telefone como TEXTO (numFmt `@`, zeros à
  esquerda preservados), datas como Date (`dd/mm/yyyy`), capital social como número
  (`R$ #,##0.00`), nada cortado em silêncio (QSA completo; texto acima do teto físico
  de 32.767 é truncado COM aviso explícito na célula) e **nenhuma fórmula interpretada**
  (string iniciada por `= + - @` entra como richText — Excel não executa).
- **Escopos**: todas / sem revisão / em revisão / selecionadas — mesmos conjuntos da interface.
- **Reabertura programática**: o arquivo é relido com exceljs na suíte (`scripts/test-v01015-exportacoes.ts`) — abas, contagens, chaves, tipos e zeros conferidos.

### 2. PDF DA EMPRESA (`type=pdf_empresa&row=N`; `src/lib/export/pdf.ts`)
- Gerado a partir do estado autorizado da ficha — **sem IA, sem reconsulta, sem novos dados**.
- Seções numeradas que só existem quando há informação (nenhum painel vazio):
  identificação e situação · avisos de divergência (com caixa de destaque) · resumo
  cadastral · operação e atividade observáveis · contatos válidos e representantes
  ("Não informado" quando não há contato utilizável) · matriz, filiais e relações
  consultadas · leitura comercial de IA ROTULADA como hipótese em bloco separado ·
  o que falta descobrir (mesma triagem da ficha) · fontes, datas e confiabilidade.
- Identidade visual Scout 360 + Senior, A4, quebra de texto garantida (nunca corta),
  rodapé com "Página X de Y", data e proveniência; nomes técnicos de provedores só
  aparecem como "registro técnico" na seção de fontes (categoria comercial no corpo).
- Ação discreta na ficha: **"Baixar ficha em PDF"** (com feedback e tratamento de erro).

### 3. PDF DE RESUMO DO LOTE (`type=pdf_lote&scope=…`)
- Relatório compacto: resultado geral com as oito contagens, distribuições sustentadas
  pelos dados (situação, UF, setor CNAE pela MESMA classificação do panorama),
  empresas identificadas, casos em revisão com o motivo, falhas e pendências, notas de confiabilidade.
- **Limite seguro de 300 entradas**: acima disso falha CLARAMENTE (HTTP 413) orientando
  o Excel — nunca gera documento incompleto.

### 4. UMA EXPORTAÇÃO SÓ (diálogo com duas decisões)
- O botão "Exportar" abre UM diálogo: **"O que exportar"** (todas / sem revisão
  pendente / somente revisão / selecionadas — desabilitado com explicação quando vazio)
  × **"Em qual formato"** (Excel / PDF / CSV — formato indisponível para o escopo
  explica a restrição, ex.: PDF acima de 300 aponta o Excel).
- O arquivo informa o que será incluído antes de gerar ("incluindo as 6 em revisão…",
  "3 entradas ainda aguardam execução").
- **Formatos técnicos recolhidos** em "Opções técnicas e outros formatos": CSV completo,
  teia societária, Leituras Scout (com IA), pendências, resumo .json, auditoria .jsonl,
  TRIAGEM_V1 e PLANO_CONSULTAS_V1 — todos os contratos preservados.

### 5. CORREÇÕES DE CONTRATO
- **Teia societária sem IA**: a exportação deixa de estar escondida atrás do interruptor
  de IA — vínculos cadastrais existem sem IA (a interface agora diz "sem IA").
- **Seleção não trunca mais em 200**: o corte silencioso `.slice(0, 200)` acabou; a
  seleção completa é suportada até o limite seguro de 5.000 (via GET ou POST com corpo
  quando a lista é grande); acima disso a exportação RECUSA ANTES com explicação
  (`SELECAO_ACIMA_DO_LIMITE`, HTTP 413).
- **Nomenclatura honesta**: "Somente contas confirmadas" virou escopo **"Somente sem
  revisão pendente"** — correspondência cadastral não é validação humana (o `type`
  `result_confirmed` e o nome de arquivo seguem por compatibilidade).
- **POST no export**: mesma implementação do GET (delegação com query reconstruída) —
  zero divergência entre os dois caminhos.
- **Resumo técnico (.json) reconciliado**: expõe `estagio_identidade`, `pessoas_juridicas`
  (localizadas × identificadas por raiz) e `revisao` (união da interface) — o resumo
  técnico fecha com a tela e com o Excel.

### 6. RECONCILIAÇÃO ESTENDIDA (indicadores com as oito leituras)
- Hints dos indicadores explícitos: "24 linhas processada(s)", "24 CNPJs localizado(s)
  no total · 6 aguardando a sua revisão", "inclui N com falha de consulta"
  (`totalFalhasConsulta` novo na API de detalhe).
- Hint sem `truncate` — valores não são mais cortados na superfície de métricas.
- **UMA derivação de fatos para toda exportação comercial** (`src/lib/export/dataset.ts`):
  reutiliza `telefoneUtil`/`eMailUtil`/`DECISOR_QUAL_RE` de `@/lib/contato` (fonte única
  movida da interface), a união de revisão da v0.10.14, a classificação de setor CNAE do
  panorama e os motores TRIAGEM/PLANO — a interface e os arquivos classificam IGUAL.

### Testes e provas
- **Suíte nova `scripts/test-v01015-exportacoes.ts` — 71 PASS · 0 FAIL**: camada pura com
  valores independentes (telefones válido/ausente/incompleto/inválido/incomum, datas,
  capital); reconciliação 24 = 18+6 com MESMAS rowNumbers em tabela × Excel × CSV × PDF;
  seleção de 250 sem corte; 5001 recusados com explicação; escala 100/1.000 (HTTP) e
  5.000 (in-process, 12,5s); zeros à esquerda; fórmula bloqueada (richText); truncamento
  com aviso; acentos intactos; datas/capital tipados; PDF (sem IA, divergente, com IA,
  lote com revisões, limite 413); limpeza dos lotes sintéticos.
- **Regressões todas verdes**: identidade 40 · coerência 70 · triagem 89 · adversarial
  27 · falhas-fonte 18 · limitador 7 · evolução 43 · plano desatualizado 17 · auditoria 46.
- **Navegador (evidencias/round-v0.10.15/)**: indicadores 18/6 + hints; diálogo completo
  com escopos, formatos, nota de inclusão e área técnica (teia presente sem IA, Leituras
  Scout ausentes sem IA); "Baixar ficha em PDF" com requisição 200 real; exportação
  Excel confirmada pelo diálogo (200); mobile 390 sem overflow horizontal; console sem erros.
- eslint limpo · tsc `src/` sem erros.

### Integridade das exportações (cumpridos)
Sem reconsulta a APIs externas durante a exportação · sem IA automática · sem dados de
outros lotes · sem segredos/CPF (triagem segue sanitizada) · proteção anti-fórmula em
CSV e Excel · contatos inválidos não saem como utilizáveis (cru só na evidência) ·
vínculos entrada↔linha↔empresa↔evidência preservados · nada publicado em `public/` ·
contratos antigos intactos (CSV completo, sem revisão, selecionadas, pendências, ai,
teia, audit, telemetria, TRIAGEM_V1, PLANO_CONSULTAS_V1) · exportação repetida não
altera o estado comercial dos dados (só auditoria de EXPORT).

### Pendências honestas
- (1) A evolução da inteligência de investigação volta a ser o próximo capítulo (decisão
  do operador) — este ciclo foi de exportações e consistência.
- (2) O PDF compacto do lote cobre até 300 entradas por escopo (decisão de projeto
  documentada; o Excel cobre o volume completo).
- (3) Herdadas: autenticação individual = decisão do operador; lab fora da UI e fechado
  no servidor; descoberta limitada aos quadros de participantes PF.

## v0.10.14 — "Reconciliação dos indicadores, contato de verdade e ficha sem repetição"

Ciclo concentrado pedido na primeira conferência da v0.10.13 (PASS com ressalvas): três
provas — reconciliação resumo/tabela/exportação, qualidade do dado (telefone fictício e
repetições) e leitura comercial (textos curtos, valores sem corte, detalhes recolhidos).
Menor delta correto, sem publicação, sem push, sem merge.

### 1. RECONCILIAÇÃO (resumo, tabela e exportação contam o mesmo conjunto)
- **Divergência comprovada e corrigida**: a tabela marca "Revisar" por
  `identityStage=LOCALIZADO` (registro localizado divergente das pistas), mas
  `totalReview` contava apenas `resolutionState=REVIEW`. Com o lote real do operador
  (24 entradas: 18 CORRESPONDENTE + 6 LOCALIZADO, todas com resolutionState nulo), o
  resumo exibia 24 identificadas e zero para revisão enquanto a tabela mostrava 18+6.
- **`totalReview` agora é a união** que a tabela mostra (REVIEW decidível OU
  LOCALIZADO enriquecido) — `src/lib/enrich/engine.ts` (`recomputeCounters`); a
  recontagem automática (auto-cura no GET) corrige lotes existentes sem migração.
- **"Pessoas jurídicas identificadas" agora é 18** (raízes compatíveis — o mesmo
  conjunto "Identificada" da tabela) e o total de **24 CNPJs localizados** continua
  presente no hint do indicador, junto com as 6 aguardando revisão
  (`totalPessoasJuridicasLocalizadas` novo na API).
- **Faixa de resultado honesta**: "18 contas prontas para revisar · 6 aguardando
  confirmação" (antes dizia 24 prontas e 6 aguardando ao mesmo tempo).
- **Faixa de revisão e filtro voltaram a funcionar**: o banner "N empresa(s) aguardando
  a sua confirmação" reaparece e o filtro "Revisar" deixa de ser auto-redefinido para
  "Todas" (o efeito de guarda comparava com o totalReview antigo, que era zero).
- **Panorama do lote** descreve "contas localizadas" (não "identificadas") — as
  distribuições incluem registros em revisão.
- **Exportação conferida**: planilha completa traz as 24 com `etapa_identidade` e
  divergências; "Somente contas confirmadas" traz 18 (LOCALIZADO já era excluído na
  v0.10.12 — segue assim).

### 2. QUALIDADE DO DADO (telefone fictício e repetições)
- **`telefoneUtil()` (determinístico)**: telefone do cadastro só vira contato se tem
  dígitos suficientes para discar (8 a 13) e não é uma sequência repetida
  (`000000000000` não passa). O valor cru segue no CSV e na auditoria — a interface é
  que não oferece ligação nem cópia com número falso.
- **Aplicado em toda a jornada de contato**: cartões de contato (sem link `tel:` nem
  cópia), "Copiar ficha (CRM)" e "Copiar leitura" (dossiê). A seção 3 só nasce quando
  existe contato utilizável.
- **Cadastro sem repetição na seção 2**: `PublicDataPanel` virou "Registro público" e
  mostra só o complementar (Setor CNAE, Natureza, MEI, outras atividades); capital
  social, porte, Simples, telefone, e-mail e endereço deixaram de aparecer em dobro.
  Tiles de contagem ("Sócios no quadro", "Atividades secundárias") saíram — o quadro
  tem nome na seção 3 e as atividades, no Registro público.
- **Representantes uma única vez**: `SociosPanel` exibe apenas os OUTROS integrantes do
  quadro (a administração fica no bloco de representantes); quando o quadro inteiro é a
  administração, o painel nem aparece. Componente morto `SocioChips` (com o texto
  desatualizado "aba Dados") removido.

### 3. LEITURA COMERCIAL (menos texto, nada cortado)
- **Sem valores cortados**: cartões do resumo e campos de contato passam a quebrar linha
  e mostrar o valor inteiro (fim do `line-clamp-2`/`truncate` na ficha).
- **Legendas encurtadas** sem travessão: "Setor derivado do CNAE registrado (IBGE).",
  "Do quadro societário público. Mostra quem administra; não comprova quem compra
  tecnologia.", avisos de teto (CNAE/QSA) em uma linha.
- **Detalhes metodológicos seguem recolhidos** (seção 7, padrão fechado).

### Verificação
- Navegador (1440 e 390): métricas 18/6/hint 24; filtro "Revisar" mantém 6 linhas;
  ficha sem `000000000000`, sem link `tel:` falso, capital social 1×, administração 1×;
  cópia CRM interceptada sem telefone falso; celular sem overflow horizontal. Capturas
  em `evidencias/round-v0.10.14/`.
- Regressões: identidade v0.10.12 40/40 · coerência v0.10.8 70/70 · triagem v0.10.6
  89/89 · adversarial 27/27 · falhas-fonte 18/18 · limitador 7/7 · evolução 43/43 ·
  plano desatualizado 17/17 · auditoria v0.10.7 46/46 — 357 PASS, 0 FAIL. eslint e
  tsc (src/) limpos.

## v0.10.13 — "Ficha da empresa única: identidade primeiro, análise quando existir, fontes num clique"

Despacho "SCOUT 360 — CORREÇÃO DE UX DA FICHA DA EMPRESA" (Bruno Forge) sobre a v0.10.12.
Fim da fragmentação Dossiê/Dados/Evidências: abrir uma empresa agora permite entender o
cadastro, as lacunas e as evidências SEM alternar abas. Menor delta correto, sem
publicação, sem push, sem merge. Arquivo principal: `src/components/cnpj/batch-detail-card.tsx`.

### FICHA ÚNICA (7 seções numeradas, sem abas)
- **A navegação com três abas (Dossiê/Dados/Evidências) foi substituída por uma ficha
  única** organizada em seções: 1 Identidade, situação cadastral e divergências ·
  2 Resumo da empresa (dados públicos, sem IA obrigatória) · 3 Contatos e representantes ·
  4 Matriz, filiais e relações empresariais · 5 Análise comercial (quando existir) ·
  6 O que falta descobrir · 7 Fontes, datas e histórico (área expansível, recolhida).
- **A identidade em revisão aparece imediatamente** — a seção 1 é a primeira coisa do corpo
  da ficha, antes de qualquer conclusão comercial; o painel de divergência (LOCALIZADO),
  a revisão com candidatos (REVIEW), o "por que identificamos" (CONFIRMED) e o "não
  identificada" (UNRESOLVED) moram TODOS na seção 1, cada um renderizado UMA vez.
- **Duplicidades eliminadas**:
  - `IdentidadeDivergentePanel` era renderizado em DUAS abas simultâneas (Dados e
    Evidências) — provado no navegador antes/depois (mesmo testid em duas abas). Agora é
    único, na seção 1.
  - "Pesquisa profunda" aparecia 2× em componentes distintos (DeepResearchBar + NoAiState)
    e o botão experimental "Adaptativa" dividia a atenção — consolidado em UMA ação
    principal contextual (seção 6), com a alternativa honesta "Gerar leitura rápida" como
    comando secundário. Os modos internos (COMPLETO/ADAPTATIVO e leitura rápida) seguem
    preservados na rota/contrato — só o botão experimental saiu da experiência comercial.
  - `AccountSummaryBlock` (que repetia razão social, situação, município, CNAE e estrutura
    já presentes na seção 1/2) foi REMOVIDO — dados cadastrais renderizados uma única vez.
  - O "painel vazio" de ausência de IA (`NoAiState`, que dizia "veja as abas Dados e
    Evidências") não existe mais: sem análise, a seção 5 simplesmente NÃO nasce; os
    comandos de investigação vivem na seção 6 e os dados públicos nas seções 2/3.
  - Rodapé fixo removido: "Copiar leitura" e "Gerar de novo" agora ficam NO CABEÇALHO da
    seção 5, ao lado da leitura a que se referem (botões de cópia junto dos dados).
  - Os representantes do quadro oficial (QSA) ficam na seção 3; a seção 5 mostra apenas a
    administração citada em fontes públicas pela leitura — sem repetir o cadastro.
- **Layout**: painel lateral mais largo quando há espaço (600px em ≥1024px, 720px em
  ≥1280px, 800px em ≥1536px — era 560px fixo); tela completa no celular (390px sem
  overflow horizontal); cabeçalho compacto e fixo (título, CNPJ, local, situação, chips e
  alertas); UMA área de rolagem; cartões de informação em no máximo DUAS colunas
  (CompanyFicha perdeu o 3º coluna de `sm:`); seção de fontes/histórico recolhida por
  padrão; triagem e detalhes técnicos continuam recolhidos.
- **Falha e andamento dentro da ficha**: situação ERRO ganhou bloco próprio na seção 1
  ("A consulta não concluiu" + motivo humano + "Tentar novamente" — o MESMO comando da
  tabela, agora acessível de dentro do dossiê); situação em preparo ("Preparada para
  consulta") e em curso ("Consultando as fontes públicas") também aparecem na seção 1 —
  a ficha NUNCA fica vazia. O chip "Revisar identificação" do cabeçalho agora rola até a
  seção 1 (não há mais aba para trocar).
- **Rótulo da triagem**: "O que falta descobrir" (título da seção 6) não repete mais o
  título interno do painel — a triagem determinística passou a "Triagem dos dados públicos"
  (mesma função, mesmo testid `triagem-panel`/`btn-triagem`).

### PRESERVAÇÃO (nada removido)
- Identidade, revisão humana, proveniência (rastro + páginas + cache na seção 7), dados
  cadastrais, contatos, administração, teia societária, matriz/filiais, relações
  societárias, triagem, plano de consultas (rota/painel do lote intactos), exportação e
  pesquisa — todos presentes; comandos explícitos que acionam APIs/IA preservados
  (`btn-deep-research`, `ai-generate-quick-dialog`, `ai-copy`, `ai-regenerate`,
  `retry-row-*`, `revalidar-*`, `btn-relacoes`, `btn-matriz-filiais`, `btn-triagem`).
- Mapeamento de testids para automações: `dossier-dossie`/`dossier-dados`/
  `dossier-evidencias` → `ficha-secao-*` (identidade/resumo/contatos/relacoes/analise/
  lacunas/fontes); `dossier-tabs` + `dossier-tab-*` deixaram de existir (não há abas);
  `resumo-conta` (AccountSummaryBlock) removido com a duplicação; `btn-deep-research-adaptativa`
  removido (modo ADAPTATIVO segue aceito pela rota deep-research); `ai-none-dialog`
  removido (não há painel vazio). Demais testids preservados.

### VERIFICAÇÃO (navegador, evidencias/round-v0.10.13/)
- ANTES (01–08): três abas, painel de divergência duplicado em 2 abas (provado: mesmo
  `identidade-divergente-10` em Dados e Evidências), "Pesquisa profunda" 2× + "Adaptativa",
  cadastro escondido atrás de aba.
- DEPOIS (09–24): cadastro confirmado sem IA (ficha completa sem seção de análise — sem
  painel vazio); análise gerada por pesquisa profunda explícita (EYE PHARMA — seção 5 com
  leitura, cópia ao lado, subseções); divergente com revisão humana (FSFUTURO na seção 1;
  "É esta empresa" → VALIDADO com divergência PRESERVADA e chip "Confirmado por você");
  consulta em preparo sem ficha vazia; falha de consulta com recuperação real
  ("Tentar novamente" → ENRIQUECIDO de volta); desktop 1280 (painel 720px), notebook 1024
  (600px), celular 390 (tela cheia, sem overflow X); teclado/ARIA (gatilho de seção
  focável com `aria-expanded`, headings e listas semânticas); console sem erros.
- REGRESSÕES: identidade v0.10.12 40/40 · plano desatualizado 17/17 · aprovação
  adversarial 27/27 · falhas de fonte 18/18 · limitador de origem 7/7 · evolução v0.10.9
  43/43 — 152 PASS, 0 FAIL. eslint e tsc (src/) limpos.
- Lotes de teste criados para as provas foram apagados ao fim (banco ficou com o lote do
  operador intacto).

### ⚠️ PENDÊNCIA PRIORITÁRIA INDEPENDENTE (registrada, fora do escopo desta rodada)
- **Divergência entre os indicadores do lote e os seis registros em revisão** — no lote
  vivo `imp_mvjwqdla_qmz4h5` (24 entradas) os contadores expõem `totalDirectCnpj: 24` e
  `totalEnriched: 24` com `totalConfirmed: 0`, enquanto 6 linhas estão com estágio
  `LOCALIZADO` (em revisão) e 18 `CORRESPONDENTE`: os indicadores agregados do lote ainda
  não refletem o estágio de identidade por linha (ex.: "identificadas" conta CNPJ direto
  enriquecido, não identidade CORRESPONDENTE/VALIDADO). Correção própria (recontar os
  indicadores a partir de `identityStage` + `resolutionState`) ficou enfileirada como
  pendência PRIORITÁRIA e INDEPENDENTE desta entrega de UX — nada foi alterado nos
  indicadores nesta rodada para manter o menor delta.

---
## v0.10.12 — "Confiança na identificação: registro localizado ≠ correspondente ≠ validado por você; tabela como painel de decisões; entrada sem IA; carregamento imediato"

Despacho "SCOUT 360: próxima evolução após v0.10.11" (Bruno Forge). Cinco frentes, sem
rebuild, preservando A+B, cache, proveniência, controles de concorrência, triagem sem IA
e planejador de consultas. Baseline: v0.10.11 (SHA d10fd7f6…ea8010 conferido).

### FRENTE 1 — Correção da confiança na identificação
- **Três estágios obrigatórios** gravados por linha (`ImportRow.identityStage`):
  `LOCALIZADO` (registro cadastral localizado, vínculo com as pistas NÃO provado),
  `CORRESPONDENTE` (o cadastro corresponde às pistas fornecidas) e `VALIDADO`
  (identidade validada explicitamente pelo operador). Contadores do lote:
  `totalLocalizado`/`totalValidado`.
- **Novo módulo puro** `src/lib/resolve/confianca.ts` — `avaliarIdentidade()` compara as
  pistas da linha com a ficha coletada (zero rede, zero IA) e produz o estágio +
  divergências explicadas em pt-BR (`identityDivergenciasJson`). Executada em TODAS as
  linhas enriquecidas (caminho fresco, reuso de ficha e cache entre lotes).
- **Similaridade ZERO agora é registrada** — a condição anterior (`best > 0 && best < 0.35`)
  no `resolveIdentity` ignorava exatamente o caso mais grave (nome da pista sem NENHUMA
  relação com o cadastro). Corrigida; candidato promovível com nome sem relação e SEM prova
  de domínio (site do próprio domínio / RDAP) vai para REVISÃO com o registro PRESERVADO
  nos candidatos — antes virava CONFIRMED automático.
- **CNPJ válido com nome, domínio ou localização incompatível NÃO é mais "empresa
  pretendida confirmada"**: divergência de NOME com similaridade zero/pouca → LOCALIZADO;
  domínio da pista ausente no cadastro (sem prova de domínio) → LOCALIZADO; UF divergente
  sem nome que confirme → LOCALIZADO. O cadastro localizado NUNCA é descartado: divergência
  vira explicação e a revisão permanece possível.
- **Revisão possível para linhas de CNPJ direto** (rota decide, que antes devolvia
  NOT_DECIDABLE para qualquer VALIDA): novo `{action:"VALIDAR_REGISTRO"}` → VALIDADO com as
  divergências PRESERVADAS como contexto; `{cnpj: novo}` corrige o CNPJ (o antigo sai das
  células, a trilha de auditoria preserva o valor original, divergências antigas zeradas e
  reavaliadas no reprocesso); `{action:"CLUE"}` aceita nova pista em linha divergente.
  NOT_FOUND para VALIDA orienta explicitamente os dois caminhos (sem beco sem saída).
- **Painel de divergência na ficha** (`IdentidadeDivergentePanel`): lista as divergências
  com explicação, ação "É esta empresa" (validar) e correção por CNPJ/outra pista.
- **Propagação completa**: TRIAGEM_V1 (identidade LOCALIZADO → VALIDACAO_HUMANA com os
  fatos do registro localizado PRESERVADOS + divergências explicadas; VALIDADO → RESOLVIDO
  "validada por você") → PLANO_CONSULTAS_V1 (herda da triagem: identidade divergente vai
  para FORA DO ESCOPO como validação humana, nunca vira consulta) → dossiê → tabela →
  filtros ("Revisar" inclui LOCALIZADO; "Identificadas" exclui) → exportação (novas colunas
  `etapa_identidade` e `divergencias_identidade`; `result_confirmed` EXCLUI LOCALIZADO).
- **Auditoria**: evento `IDENTIDADE_AVALIADA` por linha (estágio, similaridade, divergências,
  resumo) + `IDENTIDADE_VALIDADA` na validação humana.
- **Bugs reais encontrados pela suíte e corrigidos**:
  1. Extração de CNPJ em prosa: `CNPJ 00002000000120` (sem formatação, após palavra com
     2+ letras) NÃO era extraído — o padrão ancorava dentro da palavra ("PJ 000020000001")
     e rejeitava por dígito adjacente. Corrigido com lookbehind de fronteira.
  2. Nomes concatenados × separados: pista "RAIADROGASIL" × cadastro "RAIA DROGASIL S/A"
     dava similaridade ZERO (falsa divergência). Nova correspondência por contenção do
     nome achatado (`nomeCorresponde`), aplicada no resolvedor e na avaliação.
  3. Nome composto: "AUTO PECAS JASMINE LTDA" virava tokens soltos (o texto da divergência
     citava só "AUTO"). O nome inteiro agora entra como candidato principal.
- **Regressão nomeada** (scripts/test-v01012-identidade.ts, 40/40): camada pura
  (CNPJ isolado, nome compatível, similaridade zero, nome parcial, UF divergente, domínio
  divergente, domínio provado, decisão humana) + resolvedor com fontes SIMULADAS
  (Grendene/WEG sintéticos, nomes divergentes, homônimos com raízes distintas, registro
  preservado) + E2E do engine (correção humana, validar registro, triagem, plano,
  contadores) + export pela rota real. Prova estrutural: zero HTTP real (fetch simulado
  recusa host não cadastrado).

### FRENTE 2 — Tabela principal como painel de decisões do vendedor
- **8 colunas → 5**: [seleção] Empresa · Identificação · Localização (some no mobile) ·
  Próxima ação. "CNPJ da matriz" saiu (filial/matriz entram na célula da empresa:
  "filial · matriz XX.XXX.XXX/0001-XX"; CNPJ localizado de pistas sem CNPJ idem) e
  "Confiança"/"Scout"/"Detalhes" foram absorvidos (confiança virou linha secundária da
  identificação; a ação explícita vive na última coluna).
- **Próxima ação por estado, sempre ícone + texto** (nunca só cor): Ver análise ·
  Pesquisando a conta · Sintetizando dossiê · Na fila de pesquisa · Leitura em preparo ·
  Revisar (divergente) · Tentar de novo (falha de leitura) · Tentar novamente (falha de
  consulta) · Abrir dossiê. Antes havia 3 gatilhos duplicados para a mesma tela.
- **Vocabulário do vendedor**: Identificada · Revisar · Consultando · Não encontrada ·
  Tentar novamente (estados de `rowSituation` reescritos em senior.tsx).
- **Filtros reduzidos**: saem os selects "Entrada" e "Resultado" (redundantes com a
  Situação; continuam aceitos por URL para automações). Pesquisa textual e filtros
  Situação/Pesquisa preservados. Filtro de situação atualizado (Revisar inclui divergentes;
  Identificadas agora inclui CNPJ direto enriquecido — gap pré-existente fechado).
- Cortes de texto tratados (divergência truncada com título completo; textos 13px), header
  sticky e colunas fixas preservados, sem overflow horizontal do documento no mobile 390
  (verificado no navegador).

### FRENTE 3 — Entrada simplificada e IA como ação contextual
- **A chave de IA saiu do formulário principal** (Switch "Leitura inteligente das contas"
  removido do upload-card). A IA continua DESLIGADA por padrão no servidor (confirm sem
  `aiEnabled` → false) e é acionada explicitamente na ficha ("Gerar leitura rápida") ou em
  ação contextual ("Gerar leituras que faltam"). Importar/confirmar NUNCA consome modelo.
- **"Como funciona" reescrito em três etapas simples**: 1. Envie as pistas que você tem ·
  2. Confira as empresas · 3. Investigue mais quando quiser.
- **Tom de voz (Bruno)**: varredura de travessão como separador de frases nos textos da
  interface (hero, "Como funciona", toasts, estados, painéis, dossiê, telemetria, gate de
  acesso; placeholders "—" de valor vazio preservados). Nomes de provedores seguem ZERO na
  experiência comercial (varredura automática); rastreabilidade técnica permanece em área
  própria (Evidências → Detalhes técnicos fechado por padrão; exportações técnicas).

### FRENTE 4 — Carregamento imediato (sem redesign)
- **Removidas as entradas animadas que atrasavam a leitura**: hero em cascata
  (Stagger/blur, 4 itens), header com entrada de cima (y:-26), títulos de seção com
  whileInView e timeline do dossiê com BlurFade — todos estáticos agora (medição
  estrutural antes × depois em scripts/medidas-carregamento-v01012.ts: 4→0, 1→0, 1→0, 1→0).
- **CSS morto podado** (~3,1 KB): border-beam, shiny-text, pulse-suave, glare-card,
  luz-varredura (span morto no header), aurora-drift-3.
- **Medições (dev local)**: abertura fria TTFB p50 38ms; estado inicial da tela p50 13ms.
  Título, entrada e resultado visíveis no primeiro paint; sem deslocamento de layout
  (transform/opacity eliminados na entrada).

### FRENTE 5 — Testes com rigor
- **Jornada completa com 24 entradas** (scripts/jornada-24-v01012.ts, 18/18 PASS, dev server
  real + fontes públicas, escala pontual): 15 CNPJ+nome corretos (raízes verificadas por
  consulta individual — o produto PEGOU erros de memória do executor e sinalizou
  LOCALIZADO/NAO_ENCONTRADO honesto), 3 divergentes (Marfrig/Bradesco/Coca-Cola com nomes
  alheios) → LOCALIZADO + NOME ALTA, 1 UF divergente → LOCALIZADO, 1 inválida, 1 repetida,
  3 pistas de nome sem registro → Não encontrada SEM candidato falso. Validado ainda:
  filtros (Revisar=4, Identificadas=15, divergentes fora), contadores, export
  result_confirmed (divergentes fora), plano (VALIDACAO_HUMANA fora do escopo), auditoria
  IDENTIDADE_AVALIADA por linha, recuperação "concluir pendências".
- **Lote sintético de 1.000 entradas** (probe com asserts duros, banco temporário): PASS
  com zero divergência, zero chamada externa (escada 100/1.000/5.000 re-executada: exit 0).
- **Regressões verdes**: v0.10.1 ✓ · v0.10.2 30/30 · v0.10.3 ✓ · v0.10.4 ✓ · revalidação
  segura ✓ · v0.10.5 65/65 · v0.10.6 89/89 · v0.10.7 46/46 · v0.10.8 70/70 · limitador 7/7
  · evolução v0.10.9 43/43 · adversarial 27/27 · plano stale 17/17 · falhas-fonte 18/18 ·
  identidade v0.10.12 40/40 · jornada 24 18/18 · medidas 7/7. eslint/tsc limpos.
- **Verificação no navegador** (evidencias/round-v0.10.12/): estados com ícone+texto na
  tabela, painel de divergência com "É esta empresa" → VALIDADO (HUMANA, divergências
  preservadas), mobile 390 sem overflow, rodapé colado/empurrado corretamente, console sem
  erro.

### Preservado (contrato)
A+B, cache de ficha/pesquisa, proveniência, limitador de chamadas, voo único, TRIAGEM_V1
sem IA, PLANO_CONSULTAS_V1 com aprovação explícita, telemetria, exportações sanitizadas.
Fora do escopo (mantido): login, token compartilhado como solução, multiusuário, Redis,
troca de banco, deploy, publicação, Jev, novas APIs setoriais.

## v0.10.11 — "Evolução para piloto comercial: kit dev fora da área pública, laboratório protegido no servidor, plano 6,5× mais rápido sob concorrência, leitura em 13px e escrita de LDR"

Despacho "SENIOR SCOUT 360 — EVOLUÇÃO PARA PILOTO COMERCIAL" (Bruno Forge): transformar o
Scout de aplicação de desenvolvimento em produto pronto para piloto interno — mantendo o
Z.ai como executor e PRESERVANDO todas as capacidades (CORRECT_DELTA, sem rebuild).

### FRENTE 1 — Kit dev removido da aplicação (auditoria do piloto)
- **Botão "Baixar kit dev (.zip)" REMOVIDO do rodapé** (`src/app/page.tsx`) — a experiência
  comercial não expõe mais download de código.
- **ZIP fora da área pública**: `scripts/build-zip.sh` agora grava o kit canônico em
  `dist/Senior-Scout-360-kit-dev.zip` (a pasta `public/` é servida estaticamente pelo Next).
  O script APAGA qualquer ZIP legado de `public/` na entrada — builds futuros não recriam a
  exposição. Prova: URL `/Senior-Scout-360-kit-dev.zip` → 404, inclusive após REINÍCIO do
  servidor (evidência: qa/auditoria-acesso-v01011.json seção F + navegador).
- O operador continua com o pacote sanitizado para auditoria (mesma sanitização G7; novo
  destino privado). Nada de código-fonte, evidências históricas ou mecanismos de recuperação
  foi apagado.

### FRENTE 4 — Preparação segura para o time
- **Laboratório experimental FORA da jornada comercial**: `LabPanel` removido da página
  principal (capacidade preservada em `src/components/cnpj/lab-panel.tsx`). Proteção no
  SERVIDOR, não só visual: novo gate `labEnabled()` (src/lib/lab/vault.ts) aplicado às 4
  rotas (`/api/lab/config|test|compare` + mock) — modo TOKEN fecha por padrão (abre só com
  `SCOUT_LAB_ENABLED=1`, decisão explícita do operador) e `SCOUT_LAB_ENABLED=0` desliga
  sempre (404 `LAB_INDISPONIVEL`).
- **Auditoria de acesso entre sessões com evidência** (scripts/auditoria-acesso-v01011.ts,
  36/36 → qa/auditoria-acesso-v01011.json): modo real da VM detectado; NENHUM modelo de
  identidade individual no banco (workspace único por design); TODAS as rotas de dados com
  guarda server-side (varredura estrutural); anônimo NEGADO (401) em leitura/escrita/export/
  plano no modo TOKEN; cookie forjado NEGADO; duas sessões com o mesmo token compartilham
  TUDO (prova de que NÃO há isolamento multiusuário); arquivos públicos sem segredo/banco/
  código; veredito: **BLOQUEADO para liberação corporativa multiusuário** até existir
  camada de identidade — bloqueios explícitos listados no artefato.

### FRENTE 5 — Gargalo do planejador investigado e corrigido (p95 6,5s → 0,58s)
- **Gargalo comprovado por sonda antes/depois** (scripts/probe-plano-concorrencia-v01011.ts,
  metodologia idêntica à v0.10.10 — lote sintético 30 linhas, 1 solo + 3 ondas × 20 GET):
  baseline v0.10.10 p95 3.715ms / 5,8 req/s / degradação 8,9× (cada pedido refazia a
  geração inteira: ~9 consultas de triagem POR LINHA, sequenciais).
- **Correção em duas camadas** (src/lib/plano/planner.ts), fatos e regras preservados:
  (1) **fingerprint dos fatos** — revisão global O(1) (contador que sobe a cada escrita nas
  tabelas lidas pelo plano, via extensão Prisma em src/lib/db.ts) + 1 consulta raw (12
  max/count num passe) que cobre escritas de OUTRO processo; qualquer mudança de fato
  invalida o plano — PROVA: mutação de linha → plano regenerado reflete (nunca retrato
  velho); (2) **voo único por lote** (emVooUnico) — 20 pedidos concorrentes compartilham
  UMA geração. TTL 60s como cinto; sem cache negativa.
- **Resultado**: p95 576ms / 35,7 req/s / degradação 1,1× (6,5× melhor; qa/estresse-
  v0.10.11/). Regressões do plano verdes: 17/17 (stale), 43/43 (evolução), 27/27 ×3
  (adversarial).
- **Telemetria não perde mais evidência em corrida** (src/lib/telemetry.ts): escritas
  fire-and-forget agora são rastreáveis (`aguardarTelemetria()`) e têm 1 re-tentativa —
  a suíte adversarial expôs contagem variável (n=1..3 de 5 esperados) em evento de falha
  compartilhada; agora 27/27 estável. Suíte atualizada para assentar telemetria antes de
  assertar (corrida de leitura, não de gravação).
- Log de query Prisma virou opt-in (`SCOUT_LOG_QUERIES=1`) — I/O síncrono por consulta
  fora do caminho padrão.

### FRENTE 2 — Design para operação diária (identidade Senior preservada)
- **Piso de legibilidade 13px**: `text-xs` do Tailwind sobe 12→13px no app inteiro
  (tokens `--text-xs`); `ds-caption` 12→13px; textos de 10/11/12px fixados nos componentes
  da jornada (94 ocorrências; batch-detail, preview, history, upload, header, auth, page).
- **Contraste AA**: `--cinza-600` escurecido #77736E → #5F5C57 (texto secundário legível
  em 13px sobre superfícies claras).
- **Menos brilho, mais leitura**: aurora ~45% menos intensa (2 blobs em movimento, eram 4);
  varredura de luz do header DESLIGADA; faixa de assinatura estática; sombras de vidro e
  glow-verde mais discretos; vidros mais OPACOS (glass 0.74/0.58 → 0.88/0.80; strong
  0.88/0.76 → 0.94/0.88) — legibilidade acima de efeito.
- **Consumo do lote nasce RECOLHIDO** (telemetry-panel.tsx): o painel técnico saiu do meio
  da jornada (era a 2ª coisa na tela) e virou uma linha "Consumo do lote — detalhe técnico";
  abre a um clique e SÓ BUSCA os números quando aberto (menos 1 request por visita).
- Antes/depois capturado em evidencias/round-v0.10.11/ (desktop + mobile 390).

### FRENTE 3 — Escrita na linguagem do time (LDR/vendedor)
- Hero: "Transforme CNPJ, domínio, e-mail ou nome em contas identificadas e prontas para
  análise" → **"Comece com o CNPJ, site ou nome da empresa. O Scout reúne informações de
  fontes públicas, mostra o que já está confirmado e aponta o que ainda precisa ser
  validado."** (direção do operador, aplicada sem cópia mecânica).
- "Como funciona": "confirmamos a identidade" → "indicamos a empresa mais provável — a
  confirmação final é sua, na revisão" (identificar ≠ confirmar); rodapé: "Consultas em
  fontes públicas oficiais" → "Informações reunidas de fontes públicas" (não implica
  integração governamental direta).

### Documentação reconciliada
- LEIA-ME: título v0.10.11; kit canônico agora em `dist/`. API-SPEC: gate do laboratório
  documentado; data da revisão. package.json → 0.10.11.

### Não autorizado (respeitado)
Sem push/merge/deploy público/distribuição ao time; sem SSO, perfis ou nova arquitetura de
identidade (decisão do operador); sem APIs setoriais novas; sem IA automática; sem consulta
externa em massa (provas com fontes simuladas/sintéticas); Jev fora da VM.

## v0.10.10 — "Correção de estresse: execução externa duplicada impossível (voo único por alvo), sonda com asserts duros, carga progressiva gated e limites reais provados"

Missão "CORRECT_DELTA + ESTRESSE REAL da v0.10.9" (auditoria independente do operador,
2026-10-22): a v0.10.9 foi reconhecida como evolução real (P4 + limitador), MAS a auditoria
apontou quatro lacunas — probe-import-5k "termina com sucesso sem conferir os resultados",
estresse em larga escala NÃO VERIFICADO, nenhuma prova de que aprovação concorrente/repetida
não produz execução externa duplicada, e plano desatualizado sem prova de revalidação.
Esta rodada fecha exatamente esses pontos, sem nova funcionalidade.

### 1. P0 — EXECUÇÃO EXTERNA DUPLICADA: falha provada e corrigida (voo único por alvo)
- **Falha provada na auditoria**: dois comandos de aprovação para o MESMO alvo (mesma
  sessão repetida ou duas sessões independentes) liam a cache em miss e CADA UM
  disparava a própria chamada externa — a persistência só acontecia DEPOIS da resposta
  (check-then-act no nível da fonte, mesma classe da falha de concorrência que o
  limitador teve na v0.10.9).
- **Correção** (`src/lib/single-flight.ts`, novo): `emVooUnico(chave, tarefa)` — a
  RESERVA DA CONSULTA É ATÔMICA COM A DECISÃO DE CONSULTAR (registro no mapa no mesmo
  tick da decisão, zero await entre get e set); chamadores concorrentes com a mesma
  chave compartilham UMA execução; a chave sai do mapa ao FINAL (sucesso OU falha —
  SEM cache negativa); sobrevive a HMR via globalThis.
- **Pontos de aplicação** (superfície mínima, contrato preservado):
  `investigarRelacoes` (grafo por CNPJ), `investigarConexao` (quadro por participante),
  `baseDaFonte` (/updated) e `lookupCnpjComCache` → `enrichCnpj` (cadeia de cadastro).
- **Telemetria honesta**: o seguidor marca `via:"coalescido"` — eventos `via:"consulta"`
  continuam correspondendo 1:1 a chamadas externas (nada inflado).
- **Prova adversarial** (`scripts/test-v01010-aprovacao-adversarial.ts`, 27/27 —
  `qa/estresse-v0.10.10/aprovacao-adversarial.json`): 8 comandos simultâneos = 1 chamada;
  repetição = 0 chamadas novas; DUAS SESSÕES INDEPENDENTES (cookies distintos, rota real)
  = 1 chamada com resposta idêntica; matriz/filiais e quadros = 1 por alvo; cadastro =
  8 comandos custam O MESMO que 1 comando isolado; falha 429 compartilhada = 1 chamada,
  todos recebem o erro, retry faz chamada NOVA (sem cache negativa). Prova estrutural:
  fetch global interceptado com RECUSA de host externo não cadastrado — zero HTTP real.

### 2. P1 — SONDA DE IMPORTAÇÃO COM ASSERTS DUROS (nunca mais "PASS por terminar")
- **Falha provada**: `probe-import-5k.ts` calculava esperados mas NUNCA comparava —
  `exit(0)` incondicional (auditoria: "FAIL no teste").
- **Correção** (`scripts/probe-import-5k.ts`): 15 asserts de quantidade, estado e
  invariante (linhas gravadas == CSV; VALIDA/REFERENCIA exatos com gerador de CNPJs
  ÚNICOS por raiz sequencial; INVALIDA/SEM_CNPJ/DUPLICADA = 0; toda VALIDA com DV
  válido; toda REFERENCIA com pista; ZERO eventos de fonte externa; contrato de status
  do lote) — QUALQUER divergência lista divergências e `exit(1)`. Tamanho parametrizado
  100/1000/5000 com banco temporário por degrau.

### 3. P1 — CARGA PROGRESSIVA GATED 100 → 1.000 → 5.000 (SEGURO em todos os degraus)
- `scripts/estresse-carga-progressiva.sh` — degrau superior SÓ executa com o anterior
  `exit 0` (`qa/estresse-v0.10.10/carga-progressiva.json`).
- Resultados: 100 → confirm 53ms (1.887 linhas/s, RSS 88MB) · 1.000 → 171ms (5.848/s,
  104MB) · 5.000 → 798ms (6.266/s, **pico de RSS 120MB**) — zero chamadas externas,
  zero divergência.

### 4. P1 — PLANO DESATUALIZADO ENTRE PRÉVIA E APROVAÇÃO: revalidação provada
- (`scripts/test-v01010-plano-desatualizado.ts`, 17/17 —
  `qa/estresse-v0.10.10/plano-desatualizado.json`) — o plano é um RETRATO; o servidor
  NÃO confia nele: ELEGIBILIDADE (linha inelegível → comando recusa 409 + plano
  regenerado tira o item), CACHE (cache criada entre prévia e aprovação → comando do
  plano velho NÃO reconsulta, 0 HTTP; regenerado deixa de propor), BLOQUEIOS (falha do
  alvo → item sai dos executáveis como INDISPONIVEL declarado; falha só da raiz → item
  permanece com `bloqueios_ativos` e vai para o FIM; comando manual explícito continua
  funcionando), LIMITE DE CHAMADAS (custo contado do cache; pendências consumidas →
  regenerado RECONTA e o item esgotado some), GATE (gerar plano = zero HTTP).

### 5. P1 — FALHAS DE FONTE E RECUPERAÇÃO (sem perder evidência, sem corromper banco)
- (`scripts/test-v01010-falhas-fonte.ts`, 18/18 —
  `qa/estresse-v0.10.10/falhas-fonte.json`): 429 → HTTP 429 repassado; 503 →
  FONTE_INDISPONIVEL → 502; timeout → 504; rede → 502; cada falha na telemetria
  EXATAMENTE uma vez e sem auditoria de sucesso; falha NÃO apaga fato (cache sobrevive
  intacta mesmo expirada); recuperação sem cache negativa (primeiro comando pós-falha
  funciona, cache gravada 1×); integridade do banco (lotes/linhas idênticos antes/depois).
- **Reinício REAL do processo** (`scripts/probe-reinicio-recuperacao.sh` —
  `qa/estresse-v0.10.10/reinicio-recuperacao.json`): servidor morto e recuperado em
  **12.788ms**; lote-sentinela persistiu; contagens idênticas; `PRAGMA integrity_check`
  = ok.

### 6. P2 — LIMITES REAIS REGISTRADOS (métricas consolidadas)
- (`qa/estresse-v0.10.10/metricas-consolidadas.json`): latência p50/p95 por onda de
  comandos coalescidos (A: p50 127ms/8 comandos; D: 274ms; E: 179ms; G: 47ms); rota
  completa do plano sob 20 concorrentes: **p50 6,2s / p95 6,5s, 0 falhas, resposta
  idêntica para todos, ~3,1 req/s** vs solo 0,4–0,6s (degradação ~12× documentada como
  LIMITE ENCONTRADO — correção candidata para rodada futura, sem regressão hoje);
  memória máxima 120MB; tempo de recuperação 12,8s; duplicações de execução externa: 0.
- Telemetria da rodada (`qa/telemetria-rodada-v0.10.10.json`): gate central ZERO
  (IA/busca web/leitura de página); todas as provas com fontes simuladas.

### 7. Qualidade — regressão de suíte tornada determinística
- `test-v0106-triagem` podia se envenenar entre execuções: eventos de FALHA de fonte dos
  alvos da suíte ficam SEM batchId (recordTelemetry é global) e escapavam da limpeza —
  o run seguinte via resíduo e a triagem (honestamente) reclassificava para
  INDISPONIVEL. Agora o saneamento inicial e o final limpam falhas POR ALVO (a suíte
  passou de 82+7 falhas intermitentes para 89/89 estáveis).

### Contrato da rodada
- Zero funcionalidade nova; zero executor novo; zero IA; zero busca web; zero HTTP real
  nas provas (simuladores com recusa de host não cadastrado); cargas em banco temporário;
  regressões completas reexecutadas (v0.10.1→v0.10.9 + 3 suítes novas: 365+ PASS, 0 FAIL);
  fechamento com backup verificado e NOVE tabelas zeradas (`qa/limpeza-banco-entrega.json`).

## v0.10.9 — "O Scout propõe o próximo passo e o limite vira reserva: planejador de consultas PLANO_CONSULTAS_V1 (nada executa sozinho) e limitador de chamadas com reserva atômica de vaga"

Despacho "missão intensiva de evolução e estresse" do operador (2026-10-22): implementar o
P4 (planejador de consultas por API a partir das lacunas TRIAGEM_V1 — proposta da v0.10.7)
e corrigir a falha de concorrência apontada no limitador de chamadas ("o controle verifica
o limite antes de esperar, mas não reserva a vaga de maneira segura para todas as
requisições concorrentes"). CORRECT_DELTA — nenhum executor novo, nenhuma execução
automática, Jev continua fora da VM.

### 1. P0 — LIMITADOR DE CHAMADAS: falha de concorrência reproduzida e corrigida
- **Falha provada em estresse** (`qa/limitador-antes.json`): `acquireServiceSlot`
  verificava `running < concurrency` ANTES de esperar e só reservava a vaga
  (`running++`) DEPOIS do await do teto de RPM — quem esperava RPM era invisível ao
  gate de concorrência e, na virada da janela, um bloco inteiro entrava junto:
  **3 chamadas simultâneas com `concurrency=2`** (caso A da suíte, janela real de 60s).
- **Correção** (`src/lib/ratelimit.ts`): todo chamador entra numa FILA FIFO no mesmo
  tick; um único `pump()` SÍNCRONO (zero await entre checagem e reserva) admite o
  cabeçalho da fila só quando CABEM ao mesmo tempo `running < concurrency` E
  `chamadas na janela < rpm`; admitir = reservar (`starts.push` + `running++`) no
  mesmo passo síncrono; quem não cabe PERMANECE na fila; UM timer por balde
  re-executa o mesmo pump na reabertura da janela (sem polling, sem rajada);
  release idempotente admite o próximo dentro das regras. Contrato externo
  preservado (`acquireServiceSlot(serviço) → release()`); `opts.windowMs` existe SÓ
  para testes determinísticos (produção continua 60s).
- **Estresse pós-correção** (`scripts/test-v0109-limitador.ts`, 7/7 —
  `qa/limitador-depois.json`): 40 concorrentes com concorrência ≤ 2 o tempo todo,
  RPM respeitado em TODA janela deslizante, FIFO estrito (ninguém fura a fila),
  release idempotente, 25/25 atendidos sem perda; o caso A (janela real) que
  reproduzia a falha agora PASSA (máx. 2 simultâneas).

### 2. P0 — PLANEJADOR DE CONSULTAS (P4): PLANO_CONSULTAS_V1 implementado
- `src/lib/plano/contrato.ts` — contrato versionado PLANO_CONSULTAS_V1 (zod): itens
  por LACUNA (1 pergunta × 1 entidade), `fonte_candidata` (categoria da camada de
  apresentação, v0.10.8) + `fonte_tecnica` (proveniência, mesmo regime do
  TRIAGEM_V1), custo CONTADO (`chamadas_estimadas`), `cache_reutilizavel`,
  `bloqueios_ativos`, `comando_executor` (SÓ os 3 comandos existentes),
  `fora_do_escopo_api` (transparência) e gate gravado no artefato
  (`ia:0, busca_web:0, execucao_automatica:false`). Sanitização herdada da triagem.
- `src/lib/plano/planner.ts` — gerador determinístico, ZERO IA e ZERO HTTP: só
  lacunas COMPLEMENTAR_API viram item; custo contado do cache local (confirmações
  pendentes + quadros de participantes restantes, tetos idênticos ao executor:
  20/10 por rodada); cobertura realmente esgotada não gera item; quadro já
  consultado NÃO vira item em lote (expansão é 1 comando POR participante na ficha
  — listado por transparência); bloqueio ativo = evento mais recente da fonte é
  falha → item adiado para o FIM com o bloqueio declarado; ordenação determinística
  (sem bloqueio → menor custo → fonte → linha → pergunta); dedupe por
  (pergunta, raiz) — matriz + filiais = UMA lacuna de UMA pessoa jurídica.
- `GET /api/imports/:id/plano` (rota 30) — leitura para a UI + exportação
  `?formato=json|jsonl` por ação explícita (guarda de acesso, auditoria
  `plano_export`, telemetria `PLANO`); falha de schema é erro honesto (nada
  publicado); fronteira TOKEN verificada (401 sem credencial / 200 com header).
- UI na ficha do LOTE — "Plano de consultas — proposto (nada executa sozinho)":
  resumo por fonte com custos, itens com custo/nota/bloqueio/"o que não resolve",
  aprovação por item com DIÁLOGO mostrando o custo ANTES de executar, regeneração
  automática após cada aprovação, export (.json/.jsonl) e lista "Fora do alcance de
  consulta por dados públicos". Aprovação chama o MESMO endpoint de comando da
  ficha (relações / estabelecimentos da raiz / revalidar) — nenhum executor novo.
  Export também no menu Exportar (grupo "PLANO — CONSULTAS CANDIDATAS (SEM IA)").

### 3. Provas da rodada
- **Suíte nova** `scripts/test-v0109-evolucao.ts` — **43/43** (duas execuções;
  auto-saneante): seleção determinística (só COMPLEMENTAR_API; regime/contabilidade/
  tecnologia/identidade NUNCA viram item), custo contado do cache (confirmações e
  quadros restantes), cobertura esgotada → sem item, expansão por transparência,
  bloqueio adiando para o fim, NADA executa sem aprovação (delta de telemetria ZERO
  em todos os executores), rotas UI/export/TOKEN, esquema rejeita plano corrompido,
  privacidade (hash de PF e nome público NUNCA saem), resumo coerente, banco limpo.
- **Limitador** — 7/7 (`qa/limitador-antes.json` prova a falha;
  `qa/limitador-depois.json` prova a correção).
- **Regressões verdes**: v0.10.8 70/70, v0.10.7 46/46, v0.10.6 89/89, fechamento
  29/29, v0.10.5 65/65, v0.10.4 70/70, v0.10.3 50/50, v0.10.2 30/30,
  v0.10.1/alfanumérico/revalidação PASS; `tsc src/` 0 erros; eslint limpo.
- **Verificação ao vivo (navegador, lote real do operador)**: painel na ficha do
  lote; plano regenerado 2× com telemetria dos executores INTACTA (252 → 252 —
  abrir o plano não executa nada); aprovação de 1 item com diálogo de custo →
  EXATAMENTE 1 consulta real pelo executor existente (DESCOBERTA_ROOT, sucesso,
  alvo 04733767) e plano regenerado; export JSON baixado com gate 0/0/false e sem
  dados de PF; mobile 390 sem overflow horizontal, console limpo. Desvio pego ao
  vivo e corrigido: `pendentes=0` não significa cobertura esgotada — quadros de
  participantes restantes contam no custo (item do lote real exibia a lacuna e o
  planejador a pulava).

### 4. Não-objetivos respeitados
Nenhuma API nova de fonte externa; nenhuma execução automática (nem "aquecimento");
nenhum estado novo no catálogo da triagem; sem score; Jev fora da VM; sem cron,
push, merge ou deploy público.

## v0.10.8 — "Coerência do produto e fontes invisíveis: o Scout fala sobre empresas e fatos — provedores, APIs, endpoints e códigos HTTP saem da experiência comercial (e a proveniência fica na aba Evidências)"

Despacho revisado do operador (2026-10-22): o Scout é um produto de inteligência
comercial, não um painel técnico de APIs. **Não reconstruir o produto** — menor
superfície necessária, sem novas funcionalidades de negócio. Baseline v0.10.7.

### 1. P0 — CAMADA DE APRESENTAÇÃO DAS FONTES (fontes invisíveis)
- Novo mecanismo ÚNICO `src/lib/fontes-apresentacao.ts`: mapeamento estático e
  determinístico de provedores técnicos → categorias de finalidade:
  BrasilAPI/OpenCNPJ/ReceitaWS/MinhaReceita/OpenCaramelo/ficha cadastral →
  **"Cadastro empresarial"**; quadros de participantes/estabelecimentos →
  **"Matriz e filiais"**; MinhaReceita Grafo → **"Relações empresariais"**; IBGE →
  **"Contexto regional"**; RDAP/Registro.br → **"Verificação de domínio"**;
  buscas públicas/páginas → **"Pesquisa pública"/"Site da empresa"**; modelos →
  **"Análise por IA"**. Rótulos descrevem a finalidade — NUNCA prometem fonte
  oficial direta nem dado confirmado.
- `sourceLabel()` (senior.tsx) agora usa a camada — todos os pontos da ficha,
  resultados, filtros, mensagens, indicadores, triagem e fluxos de investigação
  passam a exibir categorias. Nomes técnicos ficam internos.
- **Proveniência não desaparece**: aba Evidências mostra a categoria E a origem
  técnica sob demanda ("origem técnica: …", tooltip nos chips de complementação,
  "Detalhes técnicos" com provedor/modelo). Exportações técnicas/JSONL e
  telemetria seguem inalteradas (auditáveis). Exceção explícita: Laboratório de
  Modelos (escolha de provedor/Model ID exige identificação).
- Selo "Cadastro oficial" → **"Registro confirmado"** (tooltip diz: base pública
  do cadastro empresarial, sem prometer consulta direta à Receita).
- Erros de fonte sem HTTP na UI: "Fonte limitada (429)" → "Consulta com limite
  atingido"; mensagens da fonte de grafos sem "(429)"/"(HTTP NNN)" (o status
  estruturado segue em telemetria/auditoria).
- Telemetria do lote: "Recusas 429" → "Consultas com limite atingido"; tabela de
  fontes de cadastro exibe categorias (detalhe técnico no tooltip); linha de
  modelos vira "Análises por IA: N chamada(s)" (IDs ficam na exportação técnica).
- Triagem com a língua do vendedor: **"Já sabemos" / "Podemos consultar dados
  adicionais" / "Vale investigar em documentos" / "Precisa confirmar com a
  empresa" / "Consulta temporariamente indisponível"** — os estados internos do
  TRIAGEM_V1 e o contrato de exportação permanecem INTACTOS (sem novos estados,
  sem chamada externa automática).

### 2. P0 — ESTADOS DE PROCESSAMENTO CORRETOS (coerência estado × interface)
- `CONFIRMED` deixa de ser "Na fila" com spinner e painel de progresso:
  badge **"Aguardando início"** (neutro, sem animação) e painel dedicado
  **"N entradas preparadas. Nenhuma consulta iniciada. Clique em Iniciar agora
  para consultar as fontes públicas."** (`waiting-start`).
- `ProgressPanel` só existe em execução real (`PROCESSING` ou lease vivo);
  título "Consultando dados públicos".
- Estado do lote ≠ estado da linha: linhas preparadas (`EM_FILA`) em lote
  confirmado-não-iniciado exibem **"Preparada para consulta"** (neutro, sem
  spinner); com execução ativa voltam a "Em identificação"/"Consultando fontes".
  O enum `EM_FILA` NÃO foi alterado (contrato do despacho).
- Confirmação NÃO executa consultas (prova em teste + telemetria: zero
  COLETA_CADASTRO/WEB_SEARCH/IA_CHAT/PROCESS_START na janela).

### 3. P1 — AÇÕES ELEGÍVEIS (não deixar o operador iniciar o que não pode funcionar)
- "Pesquisar selecionadas" só habilita com conta(s) elegível(is) (cadastro
  concluído) e exibe "N prontas de M"; barra mostra "X aguardando coleta
  cadastral" quando nenhuma pronta; diálogo lista as que ficam fora da fila.
  O servidor continua validando cada rowNumber (a UI nunca é a guarda final).
- Fases separadas na interface: consultar cadastro (Iniciar agora) · investigar
  matriz/filiais e relações (comando por conta) · pesquisa profunda (seleção
  explícita) · leitura por IA (opt-in por conta/lote) — sem "processando"
  genérico misturando as fases.

### 4. P1 — FRONTEIRA DE ACESSO + REGRESSÃO DO LABORATÓRIO (auditoria)
- `assertAccess` aplicado a **GET/POST /api/lab/compare**, **GET/POST/DELETE
  /api/lab/config** e **GET /api/imports/:id/research-batch** (o modo TOKEN
  protege comparações, credencial experimental e estado da fila como protege
  lotes/exportações — resultado de pesquisa não é legível só conhecendo um
  rowId; POST research-batch já tinha `assertMutationAllowed`).
- **POST /api/lab/test RESTAURADA** (existia na v0.9.0, faltava no ZIP
  v0.10.7 — o botão "Testar conexão (sem inferência)" voltou a funcionar):
  GET {base}/models com a chave da sessão, timeout 8s, sem retry, zero
  inferência/zero tokens, erro redigido (chave nunca volta), telemetria
  ETAPA/LAB_PROBE_EXTERNO e acesso atrás da fronteira TOKEN.
- Preservado: modo OPEN apenas no Preview de desenvolvimento.

### 5. P2 — COERÊNCIA DE INDICADORES E PANORAMA SEM IA
- Métrica renomeada: "Contas identificadas" (%) → **"Cadastros concluídos" (%)
  — resolver identidade e concluir cadastro são etapas diferentes**; o lote
  mantém "Pessoas jurídicas identificadas"/"Matrizes distintas confirmadas"
  (v0.10.7) com hints por linha.
- Panorama do lote ganha **SETOR CADASTRAL (CNAE)** — distribuição derivada
  LOCALMENTE da tabela oficial CNAE 2.0 sobre o código já coletado (zero IA,
  zero rede, honesto sem código legível). O setor inferido pela IA continua
  existindo, mas como distribuição SEPARADA, rotulada "hipótese".
- `BatchDetail.cnaeDist` novo no contrato do detalhe do lote.

### 6. P2 — DOCUMENTAÇÃO E SAÚDE
- `GET /api` responde saúde real: `{ ok, servico, versao, modoAcesso }` (sem
  segredos) — o "Hello, world!" do scaffold foi removido.
- `docs/API-SPEC.md` reconciliada com o código: confirmar não inicia coleta
  (o início é explícito), triagem local sem IA, camada de apresentação com
  proveniência preservada, rotas reais de triagem/laboratório (incl.
  /api/lab/test restaurada), comportamento real do /api/worker/tick, contagem
  de rotas atualizada.

### 7. GATES E PRESERVAÇÃO
- Preservado integralmente: motor A+B (matriz/filiais/relações), TRIAGEM_V1
  JSON/JSONL, IA desligada por padrão, cache/proveniência/telemetria, CNPJ
  alfanumérico, preview sem tela de token, laboratório experimental, controle
  de rate limit, fechamento de NOVE tabelas.
- Jev permanece TOTALMENTE fora da VM. Nenhuma API nova de negócio (apenas a
  restauração do /api/lab/test documentado), sem cron, sem push, sem merge,
  sem deploy público, sem consumo pago.


## v0.10.7 — "Auditoria independente da v0.10.6: indício não é resolução, fechamento integral de NOVE tabelas, privacidade por construção na exportação TRIAGEM_V1 e indicadores que contam pessoas jurídicas de verdade"

Delta dirigido pela auditoria do operador ("CORRECT_DELTA — não reconstruir a
triagem"). A v0.10.6 avançou, mas o auditor reproduziu com o algoritmo real dois
falsos RESOLVIDO, provou que a rotina de banco limpo deixava 3 caches societários
fora do inventário e apontou vazamento de texto livre com nome de pessoa física
na exportação. Esta rodada corrige os desvios e preserva o restante (A+B, TRIAGEM_V1,
IA desligada por padrão, cache/proveniência/telemetria, CNPJ alfanumérico, preview
sem tela de token, laboratório). Gate mantido: **zero IA e zero busca web na triagem**.

### 1. BANCO — fechamento integral (defeito confirmado ao vivo)
- `scripts/entrega-banco-limpo.ts` cobre as **NOVE tabelas** persistentes: dados,
  telemetria, lab, cache cadastral **+ RelacaoSocietariaCache + QuadroParticipanteCache
  + EstabelecimentoRootCache** (os 3 caches que a v0.10.6 deixava fora — a auditoria
  estava certa: resíduos societários de 23:19 do dia anterior sobreviveram ao
  fechamento da v0.10.6 e foram encontrados vivos no banco durante esta rodada).
- Inventário, backup (VACUUM INTO + integrity_check + teste de recuperação), janela
  protegida (drift check DENTRO de BEGIN IMMEDIATE), limpeza transacional e
  verificação por leitura — tudo nas NOVE tabelas; PASS exige as NOVE zeradas,
  inclusive o cenário de banco já vazio (novo cenário F do teste).
- `scripts/test-fechamento-banco.ts` (29/29): semeia e verifica os 3 caches nos
  cenários A–F; guarda de intocabilidade do banco de dev por SNAPSHOT (antes=depois)
  em vez de exigir banco vazio (o dev pode ter dados legítimos do operador).

### 2. TRIAGEM — indício não é resolução (casos reproduzidos corrigidos)
- "Vaga aberta: contratar contador interno" → contabilidade **VALIDACAO_HUMANA**
  (era RESOLVIDO); "Vaga de SAP em consultoria parceira" → tecnologia
  **PESQUISA_DOCUMENTAL** (era RESOLVIDO). O sinal público permanece como FATO com
  proveniência (fonte + data), a lacuna segue ABERTA com o que falta comprovar
  (estrutura interna HOJE / implantação em produção) e a próxima verificação —
  sem novos estados no catálogo.
- **Filial BAIXADA/SUSPENSA/INAPTA ≠ pessoa jurídica encerrada**: perguntas da
  PESSOA_JURIDICA (regime, contabilidade, tecnologia) não caem mais em
  NAO_APLICAVEL pelo estado de uma filial — são classificadas pela evidência com
  nota explícita ("o estado de um estabelecimento não comprova a situação
  operacional das demais unidades da raiz"). NAO_APLICAVEL permanece para matriz
  baixada e para o caso dirigido em que a evidência conhecida da raiz PROVA todas
  as unidades encerradas (linhas do lote + cache válido com cobertura esgotada e
  todas as confirmadas encerradas — regra determinística `raizProvadaSemAtivos`,
  zero HTTP).

### 3. EXPORTAÇÃO TRIAGEM_V1 — privacidade por construção + rastreabilidade por pergunta
- **Sinais (texto livre) exportam SOMENTE síntese determinística** gerada pelo motor
  a partir de termo fechado do catálogo (ex.: `termo: "contador"`, `termo: "SAP"`) —
  o texto integral da vaga/notícia NUNCA sai da VM (o auditor provou que texto
  livre carregava "Responsavel Maria Silva"; a correção não é regex de nomes, é
  estrutura). Na ficha interna o texto completo segue disponível com fonte e data.
- Caminho legado/inesperado (fato sem síntese) ganhou pipeline adversarial em
  camadas: CPF/hash → e-mail → telefone → nome após marcador de papel → prenome
  isolado (lista fechada, com guarda de topônimos "São Paulo"/"Santa Maria") — e
  fato com indício de nome de PF residual **não exporta**.
- Fatos de estrutura (razão social, CNPJ, situação) seguem exportáveis — identidade
  jurídica não é dado pessoal.
- `evidencias_referenciadas`, `fontes_consultadas` e `bloqueios` passam a ser **POR
  PERGUNTA** (antes cada entrada carregava a relação completa das seis perguntas
  da linha).
- Exemplos de QA são rótulados: `exemplo-triagem-v1-SINTETICO.json/.jsonl` com
  `aviso_massa_teste` + LEIA-ME na pasta (CNPJs reais só como chave de fixação;
  atributos inventados nunca associados ao CNPJ real sem rótulo).

### 4. INDICADORES — pessoas jurídicas de verdade
- Novos contadores distintos no lote: `totalPessoasJuridicas` (raízes com coleta
  concluída) e `totalMatrizesDistintas` (uma matriz por raiz). O lote matriz+filial
  da mesma raiz agora exibe **1 pessoa jurídica identificada** e **1 matriz distinta
  confirmada** — os contadores por linha seguem visíveis como hint ("N linha(s) com
  coleta concluída"), sem alterar as métricas operacionais.

### 5. Testes e regressões
- Nova suíte `scripts/test-v0107-auditoria.ts` (46/46): os dois casos reproduzidos
  do auditor, filial baixada × matriz baixada × raiz provada morta × raiz viva em
  cache, privacidade adversarial (nomes/CPF/e-mail/telefone/hash/topônimos/razão
  social), evidências por pergunta, reuso idempotente e GATE de telemetria (zero
  eventos de IA/busca criados pelas triagens).
- `test-v0106-triagem.ts` atualizado para o comportamento corrigido (89/89, rodado
  2×) e auto-saneante (pré-limpeza das chaves sintéticas); exemplos gravados
  rótulados como massa sintética.
- Regressões verdes: v0.10.5 65/65 · v0.10.4 70/70 · v0.10.3 50/50 · v0.10.2 30/30 ·
  v0.10.1 ✓ · CNPJ alfanumérico ✓ · revalidação segura ✓ · fechamento 29/29.
- `tsc src/` 0 erros; eslint limpo.

### Preservado
Matriz/filiais e relações (A+B) · TRIAGEM_V1 JSON/JSONL · IA desligada por padrão ·
zero IA e zero busca web automática na triagem · cache, proveniência e telemetria ·
CNPJ alfanumérico · preview local sem tela de token · laboratório experimental.
Jev continua totalmente FORA da VM (nenhum SDK/cliente/endpoint/token; nada executa).

## v0.10.6 — "Triagem inteligente sem IA: consolidação de identidade por raiz, classificador determinístico de lacunas e contrato TRIAGEM_V1 para consumidor externo"

Delta dirigido pelo despacho do operador ("PRÓXIMA EVOLUÇÃO: TRIAGEM INTELIGENTE
SEM IA"). A v0.10.5 já coletava cadastro, relações societárias e estabelecimentos
sem IA; esta rodada organiza o conhecimento adquirido, identifica lacunas reais e
prepara um pacote estruturado para decisões futuras — SEM instalar, executar ou
integrar o consumidor externo (Jev fica FORA da VM; só um formato de saída neutro).
Gate central da rodada: **zero chamada de IA e nenhuma pesquisa web automática**
(telemetria da rodada: IA_CHAT 0, WEB_SEARCH 0, PAGE_READER 0 na janela).

### ETAPA 1 — Consolidação de identidade (a raiz é a pessoa jurídica)
- Defeito da v0.10.5 corrigido: a expansão societária contava CNPJs completos como
  "empresas" e a detecção de participante comum comparava CNPJs diferentes sem
  excluir os da mesma raiz — a captura da Botica (5 CNPJs, raiz 08.044.783) aparecia
  como 5 empresas e a matriz/filial compartilhando sócio aparecia como "participante
  comum" entre DUAS empresas independentes.
- Agora: `raizDe`/`contarPessoasJuridicas` (grafo.ts) — quadro societário exibe
  "X pessoa(s) jurídica(s) · Y estabelecimento(s)"; cada CNPJ da raiz consultada no
  quadro recebe a marca "mesma raiz — estabelecimento desta pessoa jurídica";
- `comumMesmaPj` (types/service/UI): sobreposição de participante com estabelecimento
  da MESMA raiz é classificada como MESMA pessoa jurídica (nota explícita "não é
  relação entre empresas distintas") e sai de `comumCom` — participante comum só
  existe entre RAÍZES distintas (e continua "NÃO caracteriza grupo econômico");
  `existeParticipanteComum` só conta raízes distintas; aviso honesto quantifica as
  sobreposições reclassificadas.
- Prova ao vivo (Botica 0001-17 + 0002-06 reais): filial deixa de listar a matriz
  como "participante comum" e passa a exibir "mesma pessoa jurídica"; quadro do
  sócio real: "1 pessoa(s) jurídica(s) · 5 estabelecimento(s) no quadro" com 5
  marcas de mesma raiz (qa/fontes-samples/round-v0.10.6/comparativo-antes-depois.json).

### ETAPA 2 — Motor de triagem local determinística (src/lib/triage/engine.ts)
- Classificador de LACUNAS (perguntas por entidade — nunca a empresa inteira, nunca
  score comercial) usando EXCLUSIVAMENTE fatos já coletados (ImportRow, caches de
  relações/estabelecimentos, pacote de pesquisa determinístico, telemetria, linhas
  do próprio lote). Nenhum HTTP externo, nenhum modelo.
- Catálogo fixo de 6 perguntas (identidade; estabelecimentos da raiz; outras pessoas
  jurídicas vinculadas; regime tributário vigente; contabilidade interna; ERP/sistema
  de gestão) — cada uma com regra determinística explícita para 6 estados:
  RESOLVIDO / COMPLEMENTAR_API / PESQUISA_DOCUMENTAL / VALIDACAO_HUMANA /
  INDISPONIVEL / NAO_APLICAVEL.
- Honestidade embutida: NÃO ENCONTRADO ≠ NÃO PESQUISADO (motivo registra a
  diferença); cobertura parcial de estabelecimentos nunca afirma total; mênção
  histórica de regime NÃO resolve vigência (registro declara não-optância e
  Real/Presumido não consta — PESQUISA_DOCUMENTAL); MEI → relações/contabilidade
  NAO_APLICAVEL + regime SIMEI RESOLVIDO; baixada/nula → perguntas operacionais
  NAO_APLICAVEL; 429/timeout recente → INDISPONIVEL com fatos anteriores preservados;
  expansões já executadas viram fato consolidado ("N conexões — M estabelecimentos
  em K outras PJs distintas pela raiz") e a fonte percorrida fecha em RESOLVIDO.
- Cada lacuna carrega: pergunta, entidade (PJ × estabelecimento), fatos com
  fonte+data da coleta, o que falta comprovar, próxima verificação possível e por
  que pode ser útil.

### ETAPA 3 — Visão "O que falta descobrir" na ficha
- Seção discreta (colapsada por padrão) na aba DADOS, depois das seções on-demand da
  v0.10.5; recalcula a cada abertura (cálculo 100% local).
- 5 grupos discretos na ordem do contrato: Resolvidos sem IA · Outra fonte
  estruturada pode resolver · Exigem pesquisa documental · Só uma conversa com a
  empresa confirma · Consultas bloqueadas por fonte ou limite (+ linha de não
  aplicáveis para transparência). NENHUM botão aciona IA/pesquisa; NENHUM texto
  recomenda acionar modelo.

### ETAPA 4 — Contrato TRIAGEM_V1 (consumidor externo futuro, FORA da VM)
- `src/lib/triage/contrato.ts`: esquema zod com os campos mínimos exigidos
  (versao_contrato, cnpj_completo, cnpj_raiz, tipo_entidade, pergunta, pergunta_id,
  estado_triagem, fatos_existentes, evidencias_referenciadas, lacuna,
  verificacao_sugerida, fontes_consultadas, data_referencia, bloqueios); unidade =
  UMA pergunta/lacuna de UMA entidade.
- Exportação por ação EXPLÍCITA (novo grupo no menu Exportar): JSON e JSONL via
  `GET /api/imports/:id/triagem?formato=json|jsonl` com guarda de exportação,
  auditoria (`triagem_export`) e telemetria (`TRIAGEM`).
- Sanitização dura ANTES da validação: CPF formatado (com DV), CPF mascarado
  ("**123456**") e hash opaco de PF (32 hex) → "[suprimido]"; nome público de PF
  nunca entra nos fatos gerados (só contagens); pacote rejeitado por schema = erro
  honesto 500, nada exportado corrompido. Nenhum SDK/cliente/endpoint/modelo/token
  do consumidor externo no código.

### ETAPA 5 — Testes (gate: zero IA, zero busca automática)
- `scripts/test-v0106-triagem.ts` — **88/88 PASS** em 3 camadas: (1) offline pura —
  consolidação de identidade, sanitização/validação do contrato; (2) casos
  determinísticos em banco — mesma raiz ≠ empresas distintas, duas raízes com
  participante comum, homônimos distintos, MEI/baixada → NAO_APLICAVEL, 429 →
  INDISPONIVEL preservando fatos, regime histórico ≠ vigente, reuso sem duplicar
  perguntas, contrato sem hash/nome de PF; (3) integração ao vivo Botica (matriz +
  filial reais) com comparativo antes/depois gravado como evidência.
- Regressões verdes: v0.10.5 65/65 · v0.10.4 70/70 · v0.10.3 50/50 · v0.10.2 30/30 ·
  CNPJ alfanumérico ✓. `tsc src/` 0 erros; eslint limpo.
- Verificação ao vivo (navegador, IA desligada): lote Botica 0001-17 + 0002-06 →
  triagem reflete exatamente a tabela do despacho (identidade RESOLVIDO;
  estabelecimentos RESOLVIDO com cobertura parcial declarada; relações RESOLVIDO
  após comando; regime PESQUISA_DOCUMENTAL; contabilidade VALIDACAO_HUMANA; ERP
  PESQUISA_DOCUMENTAL "não pesquisado"); export TRIAGEM_V1 baixa 12 entradas (2
  linhas) sem CPF/hash; mobile 390px sem overflow (painel 349px); console limpo;
  telemetria do lote exibe IA 0 · Buscas 0 (8 screenshots em evidencias/round-v0.10.6/).
- Incidente honesto: rota nova não carregou até RESTART do Next (módulo stale do
  Turbopack após criação de rotas — precedente v0.10.0/v0.10.5, sem mudança de código).

### Entrega
- Fechamento do banco exclusivo de desenvolvimento: inventário → backup VACUUM INTO
  verificado (integrity + recuperação + SHA-256) → limpeza transacional protegida →
  seis contadores 0 + /api/stats 0 (evidência qa/limpeza-banco-entrega.json).
  Inventário registrou também o lote "Pasta1.csv" (22 linhas) criado pelo operador
  na própria VM ANTES do despacho desta rodada (23:15, atividade com IA/buscas que
  permanece fora da janela da rodada) — preservado no backup, removido do banco de dev.
- ZIP sanitizado (scripts/build-zip.sh estendido: comparativo antes/depois, exemplos
  TRIAGEM_V1 .json/.jsonl, telemetria da rodada, evidências visuais v0.10.6) +
  SHA-256 registrado no worklog. Sem push, sem merge, sem deploy, sem cron.

## v0.10.5 — "Relações empresariais + matriz/filiais: MinhaReceita Grafo (FRENTE A) e estabelecimentos da mesma raiz (FRENTE B) — sem IA, sem inventar entidades, cobertura sempre honesta"

Delta dirigido pelo despacho do operador ("PRÓXIMO LOTE"): duas frentes aprovadas
(A — descoberta de relações societárias pelo MinhaReceita Grafo; B — descoberta de
matriz e filiais da mesma pessoa jurídica), executadas em fatias verificáveis
A1 → B1 → A2/B2. Zero IA, zero serviço pago, zero crawler, zero download nacional.

### A1 — Prova da API de grafos (PASS)
- Sonda limitada documentada (qa/fontes-samples/round-v0.10.5/probe-grafo-A1.json):
  `GET /updated` → base "2026-10"; `GET /<cnpj>` → QSA oficial POR ESTABELECIMENTO
  com contagem idêntica à API principal (BB 41/41, Caixa 39/39, SERPRO 7/7);
  PF = hash opaco (32 hex) + CPF já mascarado pela fonte; PJ participante = id
  CNPJ (doc da fonte; normalizador aceita dígito E alfanumérico);
  expansão manual de 1 hop provada (participante → 670 empresas);
  404 = "não encontrado OU sem conexões" (registro existente com QSA vazio confirmado
  — ausência honesta, não falha); 400 = DV inválido (a fonte valida DV; nós também).

### B1 — Menor fonte para enumerar estabelecimentos pela raiz (PASS, sem infra pesada)
- Avaliação documentada (qa/fontes-samples/round-v0.10.5/probe-fontes-B1.json):
  arquivos bulk da RFB → 404 anonimamente (portal ownCloud); BrasilAPI/OpenCNPJ/
  MinhaReceita → 400 para raiz de 8 dígitos (sem consulta por raiz); espelhos HF
  → REJEITADOS (terceiros, frescor/proveniência não garantidos); APIs pagas →
  DOCUMENTADAS e NÃO contratadas.
- Mecanismo provado em duas escalas: Botica (pequena) — quadro do sócio revela
  matriz 0001-17 + 4 filiais reais; Petrobras (grande) — 669 estabelecimentos do
  root 33000167 localizados (PARCIAL), confirmação individual pelo registro oficial
  (0001=MATRIZ/RJ, 0292=FILIAL/RJ, 0373=FILIAL Guamaré/RN). Nenhum download nacional;
  viabilidade da VM documentada (disco 7,4G livres).

### A2/B2 — Integração mínima na ficha (2 seções discretas, nada redesenhado)
- **Relações societárias (quadro público)**: botão "Investigar relações societárias"
  (comando explícito, 1 requisição); participantes com identidade própria (hash PF /
  CNPJ PJ); tipo exato do vínculo (PJ = participação societária direta; PF =
  qualificação REAPROVEITADA do cadastro existente quando o nome é único no quadro —
  "qualificação não especificada pela fonte" caso contrário); evidência pública
  (fonte + base + data + via); expansão manual de UMA conexão por vez (1 hop, sem
  recursão automática); teto de exibição 50 com total real preservado.
- **Participante comum ≠ grupo**: quando OUTRA linha do MESMO lote compartilha o
  mesmo participante (evidência dupla em cache), a ficha marca "Participante comum
  com <CNPJ> — NÃO caracteriza grupo econômico" + disclaimer geral. Nenhuma
  atribuição de grupo econômico em nenhum caminho.
- **Matriz e filiais (mesma raiz)**: botão "Investigar estabelecimentos da raiz";
  descoberta pelos quadros societários dos participantes PF (TETO 10 quadros/rodada)
  + confirmação INDIVIDUAL de cada estabelecimento pelo registro oficial
  (TETO 20 confirmações/rodada; reuso da ficha cadastral com TTL — sem HTTP repetido);
  matriz APENAS pelo campo oficial identificador_matriz_filial (nunca pela ordem 0001);
  estabelecimentos BAIXADOS/INAPTOS exibidos como estão (nada filtrado);
  cobertura SEMPRE rotulada PARCIAL ("A quantidade TOTAL de estabelecimentos da
  raiz não é afirmada"); falha de confirmação mantém o fato como "localizado,
  não confirmado" — nada é apagado.
- **Privacidade de PF**: nenhum CPF (nem o mascarado) é persistido ou exibido;
  respostas brutas de PF não são guardadas — só a normalização mínima; nomes iguais
  (homônimos) nunca tratados como mesma pessoa (identidade = hash da fonte).

### Controle e eficiência (contrato)
- Consulta somente por comando explícito em CNPJ selecionado; sem crawler, sem lote,
  sem expansão recursiva; cache por CNPJ/raiz/participante com TTL 30 dias e reuso
  sem duplicar (provado em testes e ao vivo via "reuso de cache"); 429/timeout/
  indisponibilidade mapeados com tipos honestos (429 repassado como 429 com upstream
  preservado — padrão v0.10.4); falha NUNCA apaga fato válido (persistência só em
  sucesso); IA desligada em todos os caminhos; nenhum serviço pago.

### Dados e rotas
- Prisma: RelacaoSocietariaCache / QuadroParticipanteCache / EstabelecimentoRootCache
  (JSON normalizado SEM PF bruto, validade, proveniência por linha).
- Rotas on-demand: POST /api/imports/:id/rows/:n/relacoes-societarias,
  .../relacoes-societarias/expansao (1 hop), .../matriz-filiais.
- Telemetria nova: RELACAO_GRAFO / RELACAO_EXPANSAO / DESCOBERTA_ROOT (contagens,
  cacheHit, duração, estado honesto); auditoria: relacoes_societarias /
  relacoes_expansao / matriz_filiais.

### Testes e verificação
- Suíte nova scripts/test-v0105-relacoes.ts: **65/65 PASS** (normalizadores puros +
  integração ao vivo com a fonte real: reuso sem duplicar, falha preserva fato,
  429/timeout/404 honestos, teto, homônimo/CPF, raiz alfanumérica, banco limpo ao fim).
- Regressões: v0.10.4 70/70, v0.10.3 50/50, v0.10.2 30/30, v0.10.1 ✓, CNPJ alfanumérico ✓.
- Verificação ao vivo (navegador, IA desligada): lote 2 linhas (Botica matriz +
  filial) — relações com qualificação do cadastro; expansão 1 hop com 5 empresas;
  matriz/filiais com MATRIZ + 4 filiais confirmadas (0002-06 e 0003-89 BAIXADAS
  exibidas como estão); participante comum marcado nas DUAS perspectivas (da matriz
  e da filial) sem rotular grupo; "reuso de cache" visível na interface; mobile 390px
  sem overflow horizontal; console limpo; telemetria da rodada: 20 eventos das frentes
  (IA 0, web_search 0, page_reader 0). Incidente honesto: Prisma Client velho em
  memória após db:push (erro findUnique em cache novo) → restart do Next resolveu
  (precedente já registrado na v0.10.0; sem mudança de código).

## v0.10.4 — "CORRECT_DELTA da auditoria v0.10.3 + P3-A: temporalidade corrigida no detalhe, fechamento de banco à prova de falso PASS, 429 em seis categorias e classificação multissetorial pelo CNAE"

Delta dirigido pelo despacho do operador após a auditoria independente da v0.10.3
(ZIP íntegro, SHA conferido, 13 arquivos novos/8 modificados, 1 falha reproduzida →
ETAPA 1 CORRECT_DELTA + ETAPA 2 P3-A + ETAPA 3 preparação da ativação por fonte).
Zero chamada paga; nenhuma sonda de rede nesta rodada (opt-in preservado).

### 1) TEMPORALIDADE FISCAL — as 3 falhas reproduzidas pela auditoria, corrigidas
- **Ano isolado NÃO é atribuição** (falha 1 e 2: "está no Lucro Presumido em 2026" e
  "Desde 2022, a empresa opera sob o Lucro Presumido atualmente" passavam sem correção —
  qualquer ano era tratado como sinal histórico). Regra nova: um ano não comprova o
  período a que o regime se refere; só atribui quem diz DE ONDE o dado vem (exercício,
  fonte agregada/agregadora, informação fiscal, "não confirmado"). Ano ≥ corrente nunca
  é histórico (defesa extra).
- **Fatos independentes preservados** (falha 3: "A empresa opera sob Lucro Presumido e
  possui duas unidades de produção" perdia as unidades). O texto agora é processado por
  CLÁUSULA (vírgula/;/"e"/"ou"/"mas"/"porém"/"enquanto"): só a cláusula fiscal é corrigida —
  por TRECHO quando o predicado que liga o sujeito ao regime é identificável (sujeito e
  fatos posteriores ficam byte a byte; cláusula seguinte sem sujeito recebe o sujeito da
  cláusula fiscal — heurística fechada documentada), ou por cláusula inteira (redação
  canônica v0.10.2/v0.10.3). Fragmento puramente temporal ("Desde 2022,") que só
  qualificava a afirmação corrigida é descartado — não sobra ano órfão.
- **Não cria afirmação nova**: negativa ("não está no X") cai na MESMA neutralização
  honesta ("não confirmado como vigente") — sem dupla negação, sem afirmar o contrário.
- **Regime vigente EFETIVAMENTE documentado fica intacto**: opção pelo Simples Nacional /
  MEI constante do cadastro (extra.simples/extra.mei = "Sim") sustenta a afirmação atual;
  Lucro Presumido/Real não têm vigência documentada nas fontes públicas (só exercício)
  e seguem a regra geral.
- PROMPT_VERSION → **2.3.0-v0104** (portão de reuso invalida dossiês anteriores).
- Testes: `scripts/test-v0104-regressoes.ts` — **70/70 PASS** (casos exatos do auditor +
  históricos corretos + negativa + documentado + compostos + gramática + idempotência +
  todos os campos do dossiê); compatibilidade: v0.10.3 50/50, v0.10.2 30/30,
  v0.10.1 13/13, CNPJ alfanumérico 34/34 (só asserts de versão atualizados por design).

### 2) FECHAMENTO SEGURO DO BANCO — PASS somente quando tudo passa (v0.10.3 tinha buraco)
- **Falso sucesso eliminado** (achado da auditoria: validação final com FAIL ainda
  terminava com mensagem de sucesso e exit 0). RESULTADO FINAL AGREGADO: **PASS** só
  quando TODAS as validações obrigatórias passam; qualquer FAIL → `RESULTADO: FAIL` +
  exit 1; verificação obrigatória impossível (ex.: /api/stats fora do ar) →
  `RESULTADO: BLOCKED` + exit 1 — nunca "banco pronto" sem prova.
- **Janela backup→limpeza protegida** (achado: a proteção contra novas escritas cobria
  só a transação de exclusão). Agora: DENTRO de `BEGIN IMMEDIATE`, os seis contadores
  são RELIDOS e conferidos contra o inventário do passo 2 — qualquer escrita na janela
  diverge → ROLLBACK + `RESULTADO: BLOCKED` com causa impressa (nada apagado, backup já
  existe). Re-checagem de trabalho em curso mantida dentro da transação.
- Backup VACUUM INTO + integrity_check + conferência de contadores + TESTE DE
  RECUPERAÇÃO (scratch) preservados da v0.10.3 — nada disso foi revertido.
- **Testes explícitos** (`scripts/test-fechamento-banco.ts`, **25/25 PASS**, tudo em
  sandbox `db/custom-teste-*.db` — o banco de dev nunca é tocado): (A) falha de
  validação → FAIL + exit 1, resíduo detectado; (B) escrita concorrente na janela →
  BLOCKED + nada apagado; (C) falha no meio da transação → ROLLBACK + banco intacto;
  (D) recuperação: backup aberto/lido com contadores = inventário; (E) caminho de
  sucesso → PASS + exit 0 + seis contadores 0 + backup válido.

### 3) TELEMETRIA 429 — seis categorias, sem estimativa inventada
- **classificarEvento429()** distingue: (1) **limite local** (janela do resolve-service —
  a chamada não chegou ao provedor); (2) **HTTP 429 efetivo do provedor** (status
  preservado); (3) **erro que apenas MENCIONA 429** (status upstream não preservado —
  eventos legados; o total real de recusas do gateway NÃO é inventado); (4) **timeout**;
  (5) **backoff aplicado** (fonte pulada/espera); (6) **operação não executada por cota**.
  Eventos de telemetria NUNCA são apresentados como número de requisições.
- **Status upstream preservado de agora em diante**: o resolve-service extrai o status
  do erro do SDK (err.status / "status: N" / 429+texto de limite) e devolve 429 com
  `upstream_status` no corpo (antes era 500 com o status perdido no texto); IA/busca
  registram `upstream_status` + `origem_recusa` na telemetria — eventos novos nascem
  classificáveis sem adivinhação.
- **Reclassificação honesta do histórico** (backup v0.10.2, sem rede): 290 eventos de
  telemetria → **7 HTTP 429 efetivos (ReceitaWS) + 283 menções sem status preservado**
  — confirma com evidência a ressalva do auditor ("sete não é o total comprovado de
  recusas do gateway"). Relatórios: qa/diagnostico-429-v0.10.4.{json,md}.

### 4) P3-A — CLASSIFICAÇÃO MULTISSETORIAL PELO CNAE (implementada; zero IA, zero chamada)
- `src/lib/enrich/segmentos.ts`: tabela oficial CNAE 2.0 (IBGE) seção↔divisão; deriva
  `setorPrimario` (seção + divisão + subclasse), `setoresSecundarios` (seções distintas
  dos secundários), `multissetorial` e avisos honestos — aplicada nos dois caminhos do
  enriquecimento (ficha em reuso e coleta fresca); telemetria `ETAPA/SEGMENTACAO`;
  auditoria `setor_cnae`/`multissetorial`; chip "Setor (CNAE)" nos dados públicos com a
  declaração "classificação cadastral do estabelecimento consultado — não é perfil de
  operação nem produto".
- Distinções do despacho: atividade principal ≠ secundárias; seção/divisão(2 dígitos)/
  subclasse(7); estabelecimento consultado ≠ empresa jurídica (matriz/filial têm CNAEs
  próprios); setor cadastral ≠ operação comprovada.
- Testes offline (70/70): industrial 2945→C · agroindustrial 1011+0111→C+A · financeira
  6422→K · prestadora de saúde 8610→Q · **operadora de plano de saúde 6550-2/00→K/65
  (NÃO Q/86 — corrige a proposta ANS)** · multissetorial 4 seções · divisão inexistente
  → aviso honesto · formatos (7 dígitos, formatado, código+descrição).

### 5) ETAPA 3 — ATIVAÇÃO POR FONTE: proposta corrigida + 1 cruzamento provado
- `docs/PROPOSTA-P3.md` revisada com as 4 correções do auditor: (1) **ANS**: operadoras =
  CNAE 6550-2/00 seção K/divisão 65; hospitais/clínicas = divisão 86 seção Q são
  prestadores; (2) **CVM**: categorias de registro **A e B** (a redação "categoria B3"
  estava errada); (3) **match por CNPJ completo** antes de atribuir fatos; (4) **CNAE =
  sinal de aplicabilidade, nunca prova única de vínculo regulatório**.
- **PROVA do cruzamento CVM** (scripts/cruzamento-cvm-prova.ts, 4/4 PASS): CSV oficial
  baixado 1× (1,5 MB, SHA-256 registrado), carga em banco SCRATCH (dev intocado),
  esquema REAL verificado na VM (`CNPJ_CIA;DENOM_SOCIAL;…;CATEG_REG;…`), cruzamento por
  CNPJ completo: Petrobras → CD_CVM 9512, **Categoria A**, registro 1977-07-20, ATIVO
  com proveniência (URL + SHA + cargaEm + linha CSV); Botica → vazio honesto.
- **ANS NÃO confirmada nesta rodada**: DNS não resolve na VM (registro honesto em
  qa/fontes-samples/ANS-operadoras-NOT-verificado-2026-10-21.md) — conector ANS segue
  BLOQUEADO até confirmação, como previsto. Nenhum conector implementado na cadeia.

## v0.10.3 — "CORRECT_DELTA da auditoria v0.10.2: limpeza transacional com backup provado, guarda de temporalidade GERAL em todo o dossiê e classificação honesta de 429"

Delta dirigido pelo despacho do operador após a auditoria independente da v0.10.2
("Correções implementadas / Validação com ressalvas — PASS COM RESSALVAS"). Não refaz
o lote nem amplia funcionalidades: três correções direcionadas, testes afetados e
regressões de compatibilidade. Zero chamada paga; zero sonda de rede nesta rodada
(a evidência de disponibilidade vigente é a sonda única do v0.10.2, 21/10/2026 17:11 UTC).

### 1) LIMPEZA DO BANCO — transacional, backup verificado, sem caminho sem backup
- **Exclusões em UMA transação** (achado da auditoria: a v0.10.2 apagava tabela a
  tabela sem transação — uma falha intermediária podia deixar o banco parcialmente
  limpo). Agora: `BEGIN IMMEDIATE` bloqueia novas escritas de outros processos
  durante a limpeza; re-checagem de trabalho em curso DENTRO da transação;
  exclusões; leitura de confirmação zerada ANTES do commit; qualquer falha =
  ROLLBACK = banco intacto.
- **Backup consistente e provado** (achado: cópia direta de arquivo SQLite não
  garante recuperação sob WAL/escrita ativa). Agora: `VACUUM INTO` (snapshot
  consistente, inclui WAL pendente) → `PRAGMA integrity_check` = "ok" → contadores
  das 6 tabelas do backup conferidos contra o inventário → **TESTE DE RECUPERAÇÃO**
  (cópia scratch aberta e lida com integridade e contadores idênticos ANTES de
  apagar qualquer registro) → SHA-256 do backup registrado na evidência.
- **`--sem-backup` REMOVIDO**: limpeza sem backup válido é IMPOSSÍVEL (o flag
  agora aborta com mensagem explícita).
- **Evidência dos seis contadores** (achado: o ZIP não incluía o registro dos
  contadores nem o teste de recuperação): `qa/limpeza-banco-entrega.json` registra
  antes/depois de lotes, linhas, auditoria, telemetria, comparações e cache
  cadastral + backup (caminho, bytes, sha256, integridade) + resultado de cada
  validação pós-limpeza — `/api/stats`, cache cadastral, comparações e uploads —
  sem nenhum conteúdo sensível. Executada nesta entrega: 1 lote / 2 linhas /
  13 auditoria / 21 telemetria / 0 comparações / 4 cache → 0 em tudo, 4 PASS.

### 2) TEMPORALIDADE FISCAL — regra GERAL por frase, em TODOS os campos do dossiê
- **Achados da auditoria (provados offline contra a guarda v0.10.2)**: frases como
  "A empresa está no Lucro Presumido atualmente" e "É optante do Lucro Presumido"
  PASSAVAM; uma variante produzia gramática quebrada ("Atualmente Uma fonte
  agregadora…"); a guarda era aplicada só à `sintese_executiva`.
- **Regra nova (sem lista curta de verbos)**: toda FRASE que cita um regime
  tributário é classificada — com atribuição histórica (exercício, fonte
  agregadora, informação fiscal, ano citado, "não foi confirmado") permanece
  INTACTA (o histórico correto fica); sem atribuição → reescrita POR INTEIRO
  ("Uma fonte agregadora registra X para o exercício de Y; o regime vigente não
  foi confirmado." — com dado de fonte; "O regime tributário (X) não foi
  confirmado como vigente." — sem dado). A reescrita por frase inteira elimina a
  gramática quebrada por construção. O dado de 2024 NUNCA é promovido a regime vigente.
- **PORTE por ocorrência** (achado: a v0.10.2 pulava o texto inteiro quando outra
  frase já dizia "porte cadastral"): cada menção a porte como fato vira "porte
  cadastral"; porte que CONTRADIZ o registro (`extra.porte`) é NEUTRALIZADO
  ("porte operacional real não confirmado") em vez de ser falsamente atribuído ao
  cadastro. A própria guarda não cria ressalva duplicada (se o texto já tem uma,
  a reescrita não embute outra).
- **TODOS os campos exibidos**: nova `aplicaGuardaTemporalidadeDossie()` cobre
  síntese, perfil, tese, entidade analisada, quem é, teia, operação, tecnologia,
  o que faz, escala, pessoas, mudanças, "o que ainda não sabemos", aderência
  (processo + hipótese), hipóteses detalhadas e strings de hipótese — com
  correções rotuladas POR CAMPO na telemetria `AI_GUARD`. Intactos por decisão
  documentada: segmento "VALIDAR" (instrução de conversa, não afirmação) e
  `evidencias[].claim` (citação verbatim — reescrever corromperia a prova).
- `PROMPT_VERSION` → `2.2.0-v0103` — o portão de reuso invalida dossiês gerados
  antes da guarda geral (campos além da síntese não eram protegidos).
- **Regressões**: suíte nova `scripts/test-v0103-regressoes.ts` — 50/50 PASS
  offline, incluindo os casos exatos do despacho (está no Lucro Presumido
  atualmente; optante do; duas frases de porte; histórico intacto; gramática;
  campos todos; VALIDAR/evidências intocados; idempotência). Suíte v0.10.2
  mantida 30/30 PASS (compatibilidade das frases já aprovadas).

### 3) DIAGNÓSTICO 429 — classificação honesta e métricas separadas
- **HTTP 200 com `ok:false` no corpo NÃO é mais sucesso**: nova classificação
  `resposta_200_corpo_nao_ok` (a v0.10.2 olhava só o status HTTP). Provado offline
  (8 casos determinísticos na suíte v0.10.3); as quatro sondas registradas do
  v0.10.2 não são invalidadas (corpos tinham conteúdo válido), o próximo teste é
  que fica mais rigoroso.
- **Três métricas distintas** (achado: as contagens do v0.10.2 eram de telemetria,
  não necessariamente falhas HTTP independentes): eventos de telemetria (linhas),
  tentativas HTTP (soma do campo `tentativas`) e ocorrências efetivas de HTTP 429
  (linhas com `httpStatus=429`) — nunca somadas. Reclassificação do histórico
  (sobre o backup pré-limpeza, somente leitura, sem nova chamada): **290 eventos
  de telemetria · 263 tentativas registradas · 7 ocorrências HTTP 429 efetivas**
  (todas ReceitaWS; os 429 de IA/busca constam no TEXTO do erro propagado pelo
  resolve-service — o status HTTP upstream não é registrado hoje; melhoria de
  telemetria anotada como pendência, não implementada neste delta).
- **Sondas de rede agora são OPT-IN (`--sonda`)** e NÃO foram executadas nesta
  rodada (contrato: sem sondagem agressiva, frugalidade de cota). Suporte a
  `--banco <arquivo>` para reclassificar backup em modo somente leitura.
- Relatórios: `qa/diagnostico-429-v0.10.3.{json,md}` (histórico v0.10.2 mantido intacto).

### 4) VERIFICAÇÃO AO VIVO E ENTREGA
- Caso Botica (08.04.4783/0001-17, regressão real do operador) re-executado ao
  vivo com IA DESLIGADA (zero chamada de IA): 2/2 ENRIQUECIDO, identidade
  CONFIRMADA, ficha cadastral com coleta original · válida até · reuso,
  "Complementado por", botão "Revalidar consulta", telemetria por fonte com
  coluna 429, desktop + mobile 390px sem overflow horizontal, console limpo.
  Evidências: `evidencias/round-v0.10.3/01–07`.
- Regressões de compatibilidade: CNPJ numérico+alfanumérico 34/34, offline
  v0.10.1 13/13, revalidação segura E2E 15/15, offline v0.10.2 30/30, offline
  v0.10.3 50/50. tsc `src/` 0 erros; eslint limpo.
- **Fechamento com banco limpo executado com o processo v0.10.3** (backup
  `db/backup-pre-limpeza-2026-10-21T19-26-39.db` 144 KB, integrity ok, teste de
  recuperação ok, SHA-256 na evidência; limpeza transacional COMMIT; seis
  contadores 0; 4 validações PASS; home ao vivo sem histórico).
- Docs: LEIA-ME garantias 9 e 10 endurecidas; API-SPEC inalterada (sem rota nova).

---

## v0.10.2 — "Retorno do Bruno: temporalidade fiscal no dossiê, reuso de dossiê com portão de versão, diagnóstico 429 controlado e REGRA PERMANENTE de entrega com banco limpo"

Rodada dirigida pelo despacho do operador após o kit v0.10.1 ("preservar o que já
funciona e fazer os ajustes abaixo, sem reconstruir o projeto"). Zero chamada paga;
testes com consultas públicas gratuitas e sondas únicas por canal.

### 1) REGRA PERMANENTE — ENTREGA COM BANCO LIMPO (novo fluxo de fechamento)
- **Contrato**: toda entrega para teste do operador termina com o banco de
  desenvolvimento limpo — sem registros antigos, duplicatas de lotes anteriores
  ou resultados reutilizados involuntariamente. A limpeza acontece NO FECHAMENTO
  da entrega (nunca a cada inicialização; **sem cron**).
- **Novo script** `scripts/entrega-banco-limpo.ts` implementa os 8 passos do
  contrato: (1) bloqueia se houver worker/lote em curso (PROCESSING, lease ativo,
  linhas em voo, IA/pesquisa GERANDO, fila da Mesa RODANDO); (2) inventário
  completo impresso ANTES de qualquer mudança — a decisão "só há dado de teste"
  é humana; se algo no inventário não for de teste, NÃO confirme; (3) valida que
  o alvo é SOMENTE o banco de dev deste projeto (DATABASE_URL → db/custom.db);
  (4) backup de recuperação FORA do ZIP (db/backup-pre-limpeza-*.db); (5) limpa
  lotes, linhas, auditoria, telemetria, comparações experimentais (LabComparison)
  e cache cadastral (CadastroCache) + arquivos de upload; (6) preserva schema,
  migrations, código, configurações e fixtures de QA; (7) confirma POR LEITURA
  que tudo zerou + `/api/stats` ao vivo em zero; (8) o ZIP sanitizado é gerado
  DEPOIS, sem banco e sem segredos (relatórios e evidências vão no kit).
- Modo leitura (sem `--confirmar`) só imprime inventário e checagens — nada muda.

### 2) TEMPORALIDADE FISCAL NO DOSSIÊ — o resumo nunca transforma exercício histórico em situação atual
- **Contradição relatada pelo operador**: a síntese dizia "Opera sob o regime de
  Lucro Presumido e é uma microempresa" enquanto o próprio relatório esclarecia
  "exercício 2024, informação fiscal de fonte agregada; não confirma operação
  vigente" — a temporalidade sumia na síntese.
- **Correção em 3 camadas, genérica (vale para QUALQUER empresa, sem caso específico)**:
  1. **Regra no prompt** (EVIDENCE_RULES, nos dois níveis rápido e profundo):
     TEMPORALIDADE E NATUREZA DOS DADOS — porte cadastral ≠ porte operacional real;
     regime de exercício anterior ≠ regime vigente (redação esperada ensinada
     literalmente: "Uma fonte agregadora apresenta X para o exercício de Y; o regime
     vigente não foi confirmado"); abertura cadastral ≠ fundação efetiva; capital
     social ≠ faturamento; sócio-administrador ≠ decisor comercial comprovado.
  2. **Avisos determinísticos no contexto** (`buildUserMessage`): `aviso_regime_tributario`
     (proíbe "opera sob" e ensina a redação), `aviso_porte` (exige "porte cadastral
     de X") e `aviso_capital_social` (não é faturamento) — entram e saem com o dado.
  3. **Guarda determinística pós-modelo** (`guardaTemporalidade` em ai.ts): se a
     síntese ainda afirmar regime vigente ("Opera sob o regime de Lucro Presumido",
     "Optante pelo Simples Nacional") a frase é REWRITA para a atribuição honesta
     com o exercício e ganha "O regime vigente não foi confirmado"; porte dito como
     fato operacional ("é uma microempresa", "possui estrutura de microempresa") vira
     "tem porte cadastral de X". Redação já correta NÃO é alterada. Intervenção
     auditada em telemetria (novo evento `AI_GUARD`).
- **PROVA offline**: `bun scripts/test-v0102-regressoes.ts` — **30/30 PASS**,
  incluindo a frase EXATA relatada pelo operador corrigida pela guarda.
- **PROVA ao vivo (Caso real do operador — BOTICA FARMÁCIA, Teresina/PI,
  08.044.783/0001-17)**: dossiê regenerado com o código novo exibe
  "Porte cadastral de microempresa." na síntese, sem "opera sob o regime";
  "O que ainda não sabemos" registra "Não há confirmação do regime tributário
  vigente, apenas de uma fonte agregadora para o exercício de 2024."
  (evidencias/round-v0.10.2/02 e 04).

### 3) REUSO DE DOSSIÊ ENTRE LOTES COM PORTÃO DE VERSÃO (mechanismo da "duplicação")
- **Reprodução honesta**: a duplicação exata do texto relatada NÃO se reproduziu
  como defeito de renderização (2 gerações ao vivo: a síntese aparece 1× no
  diálogo, 1× na página inteira; campos síntese/perfil/quem-e sem texto idêntico
  repetido). O que foi COMPROVADO ao vivo: o reuso de IA entre lotes copiou para
  o lote novo o dossiê de um lote anterior (`AI_CACHE lote_origem imp_mvic6y7k`)
  — o MESMO texto reaparecendo em lotes diferentes, o mecanismo estrutural que
  explica ver o texto duas vezes sem haver bug de interface.
- **Correção**: o reuso só acontece quando o dossiê em cache foi gerado pelo
  MESMO bloco de prompts (`dossierPromptVersion === PROMPT_VERSION`, agora
  `2.1.0-v0102`). Dossiê de prompt antigo (ou sem versão) NUNCA é reutilizado
  involuntariamente — regenera com as regras atuais (guarda de temporalidade
  aplicada na geração). PROVA ao vivo: após o portão, a regeneração produziu
  leitura nova (modelo efetivo sem marca "(cache)") em vez de copiar o texto antigo.

### 4) 429 — DIAGNÓSTICO CONTROLADO (sem declaração sem evidência, sem loop de retry)
- **Novo script** `scripts/diagnostico-429.ts`: Fase 1 lê a telemetria/auditoria
  do banco (histórico por fonte, horários, tentativas, backoff); Fase 2 executa
  UMA sonda por canal — ReceitaWS, BrasilAPI (controle), web_search e modelo de
  IA — SEM retry, classificando cota (429) ≠ ausência de registro (404) ≠ rede
  (timeout/DNS). Relatório: `qa/diagnostico-429-v0.10.2.{json,md}` com o
  checklist do operador respondido item a item.
- **Resultado (evidência, não claim)**: histórico no banco = 290 eventos
  429/cota — modelo de IA 124×, busca web 128× (backoff 15s + 1 repetição
  respeitado), ReceitaWS 7× (fonte pulada honestamente durante a espera),
  1 pausa de fila com motivo cota. **Sonda única na data da entrega: os 4
  canais responderam 200** (ReceitaWS 447ms, BrasilAPI 71ms, web_search OK,
  modelo glm-4-plus OK). Linhas RATE_LIMITED atuais: 0. Estado BLOCKED não
  está ativo; retomada manual permanece possível (contrato preservado).

### 5) CASO REAL DO OPERADOR COMO REGRESSÃO + regressões obrigatórias revalidadas
- BOTICA FARMACIA DE MANIPULACAO LTDA (08.044.783/0001-17, Teresina/PI): lote
  colado aceito, identidade CONFIRMADA, ENRIQUECIDO via BrasilAPI, ficha com
  validade + reuso com proveniência ("Ficha cadastral — coleta original ·
  válida até · reuso"), IA desligada por padrão (lote 1 sem IA não chamou
  modelo nenhum).
- Suítes de regressão executadas nesta rodada: CNPJ numérico + alfanumérico
  (34 PASS), regressões offline v0.10.1 (13 PASS), revalidação segura E2E
  com rede real (15 PASS), offline v0.10.2 (30 PASS).
- Verificação ao vivo (navegador): prévia aberta sem tela de token; laboratório
  de modelos sem chamada paga automática; telemetria e auditoria visíveis;
  console limpo; desktop e mobile 390px sem overflow horizontal
  (evidencias/round-v0.10.2/01–05).

## v0.10.1 — "Correções da auditoria independente: alfanumérico completo, revalidação segura, proveniência no reuso, eficiência medida"

Rodada dirigida pela auditoria do retorno v0.10.0 (veredito: PASS COM RESSALVAS em
P1/P2, FAIL no suporte completo ao CNPJ alfanumérico). Corrige SOMENTE os desvios
apontados, preservando as funcionalidades aprovadas. Zero chamada paga; testes com
consultas públicas gratuitas apenas.

### 1) CNPJ ALFANUMÉRICO COMPLETO — letras nas 12 PRIMEIRAS posições (inclusive a raiz)
- **Falha confirmada pela auditoria**: o validador v0.10.0 aceitava letras só nas 4
  posições da ordem, exigindo raiz numérica — mas a RFB (IN 2229/2024) permite letras
  e números nas 12 primeiras posições. O exemplo oficial `12.ABC.345/01DE-35` seria
  rejeitado indevidamente.
- **Corrigido em 4 camadas**: `validateCnpj` (estrutura `12 alfanuméricos + 2 dígitos`),
  `isCnpjAlfanumerico` (letra em qualquer posição da base), `cnpjFromRoot` (raiz
  aceita letras — usado na resolução de matriz) e os extratores (`extract.ts` token
  e `resolve/` prosa). Teste que considerava raiz com letra inválida REMOVIDO.
- **PROVA determinística**: a tabela RFB (A=17…Z=42) reproduz o DV oficial do exemplo
  com letras na raiz — `calcDvs("12ABC34501DE") === "35"` (12.ABC.345/**01DE-35**).
- **PROVA de ponta a ponta (navegador)**: lote com `12.ABC.345/01DE-35` classifica a
  linha como CNPJ VÁLIDO na prévia (v0.10.0 a rejeitava), processa pela cadeia e
  termina NAO_ENCONTRADO honesto (é exemplo de FORMATO, não empresa real) —
  evidências/round-v0.10.1/01 e 02.
- Sanity expandido: `bun scripts/test-cnpj-alfanumerico.ts` — **34 verificações PASS**
  (ambos os exemplos oficiais, minúsculas, DV errado rejeitado, numéricos legados
  intactos, classificação de importação sem regressão).

### 2) REVALIDAÇÃO SEGURA — falha temporária não destrói o último cadastro válido
- **Falha confirmada**: ao revalidar, se todas as fontes falhassem (HTTP/timeout/429),
  a linha virava RATE_LIMITED/erro E a rota respondia sucesso ("Ficha revalidada").
- Agora: a ficha anterior é **SNAPSHOTADA antes** da tentativa; terminando em status
  ≠ ENRIQUECIDO (ou exceção), o estado completo é **RESTAURADO**, a auditoria registra
  `REVALIDACAO_FALHOU` com **data, motivo e `ficha_anterior_preservada=true`**, e a
  função devolve `ok=false` → a rota responde **502** (nunca mais sucesso sobre
  fracasso) e a UI exibe o erro honesto.
- **Teste de regressão E2E**: `bun scripts/test-revalidacao-segura.ts` — 15 verificações
  PASS (fixture real, rede real, restauração completa, auditoria com data/motivo).

### 3) PROVENIÊNCIA NO REUSO — "Complementado por" deixa de renascer vazio
- **Falha confirmada**: a ficha guardava as complementações, mas ao REUTILIZAR o cache
  o campo de proveniência era reconstruído vazio — a UI parava de mostrar que fontes
  preencheram quais campos.
- Agora: a lista de complementações é persistida dentro do `provenienciaJson` da ficha
  (`_lista`) e **restaurada no reuso** — o `fontesJson` da linha reutilizada carrega as
  complementações da coleta ORIGINAL, e a auditoria `CADASTRO_CACHE` registra
  `complementado_por`. Fichas antigas (v0.10.0) degradam para lista vazia sem quebra.
- **PROVA com três lotes reais (navegador)**: coleta 16:07 (OpenCNPJ email +
  ReceitaWS dataSituacao) → reuso 16:09 → reuso 16:18 — ambos exibindo "Ficha cadastral
  (coleta original · válida até · reuso)" JUNTO de "Complementado por: OpenCNPJ: email ·
  ReceitaWS: dataSituacao" — evidencias/round-v0.10.1/03.

### 4) EFICIÊNCIA REAL MEDIDA — portão de capacidade na cadeia (sem claim sem número)
- **Nova pergunta da auditoria**: lacunas que nenhuma fonte consegue preencher estariam
  causando consultas repetidas desnecessárias?
- **Mapa de capacidades** (`CAMPOS_POR_FONTE` em sources.ts): o que CADA fonte da
  cadeia tem como preencher, derivado do esquema de resposta (sondagem real por fonte)
  e confirmado em 16 respostas reais (4 CNPJs × 4 fontes). Política conservadora: na
  dúvida, capacidade MANTIDA — perder campo é pior que uma consulta a mais.
- **Portão na cadeia** (`enrichCnpj`): para quando nenhuma lacuna restante é
  preenchível pela cauda, e pula sem HTTP a fonte que não trata nenhuma lacuna atual —
  cada pulo vai para auditoria (`LOOKUP_OK.fontes_puladas_capacidade`) e telemetria.
  Lacunas finais agora são auditadas como `lacunas_restantes` (honestas — não gatilho
  de mais consultas).
- **MEDIÇÃO (o auditor pediu número, não claim)**: `bun scripts/medir-eficiencia-cadeia.ts`
  — 3 fases (sondagem de esquema + coleta real 4×4 + simulação offline fiel das duas
  estratégias com o MESMO `fillGaps` da produção). Resultado da amostra: **14 → 14
  chamadas HTTP, 51 → 51 campos úteis, zero divergência — SEM ECONOMIA NA AMOSTRA**.
  Registro honesto em `qa/eficiencia-cadeia-v0.10.1.{json,md}`: o portão permanece
  como PROTEÇÃO (caminhadas injustificadas nunca acontecem) sem alegar economia.
- Observação documentada (não implementada, fora do escopo): ReceitaWS e BrasilAPI têm
  Simples/MEI aninhado em objeto que o mapeador não extrai — oportunidade futura de
  campos, não de eficiência.

### 5) QSA TRUNCADO — lista incompleta declarada explicitamente
- Quando o teto de segurança (500) trunca o quadro de sócios, a ficha carrega
  `qsaTruncados=true` (tipo + mapeadores das 5 fontes + `fillGaps` propaga o flag com
  os sócios) e a UI exibe "Lista incompleta — o quadro de sócios excede o teto de
  segurança (500)" na teia (aba Dados) e "Quadro societário incompleto" nos chips do
  Scout. O mesmo aviso agora existe para CNAEs truncados (flag v0.10.0 que não tinha
  exibição). Auditoria rawJson registra `qsa_truncado` quando atinge.
- Teste offline: `bun scripts/test-v0101-regressoes.ts` — 13 verificações PASS.

### Verificação ao vivo (navegador, lote real)
- Prévia classifica `12.ABC.345/01DE-35` como CNPJ válido (2/2 pistas prontas);
- Lote processa: alfanumérico → NAO_ENCONTRADO honesto; Petrobras → ENRIQUECIDO com
  complementação (OpenCNPJ email + ReceitaWS dataSituacao);
- 2º lote (mesmo CNPJ) REUSA a ficha: coleta original ≠ reuso, validade +30 dias,
  complementações restauradas; 3º lote idem (prova dupla);
- "Revalidar consulta" ao vivo: REVALIDACAO_OK, nova coleta real, complementação
  re-coletada, ficha substituída;
- Console limpo; desktop + mobile 390px sem overflow; tsc src/ e eslint limpos.

### Proposta P3 (entregue, NADA implementado)
- `docs/PROPOSTA-P3.md`: classificação multissetorial pelo CNAE (derivação local, zero
  chamada) e ativação condicional de APIs regulatórias (CVM e ANS via CSV local no
  SQLite; MAPA/ANTT BLOCKED até confirmar fonte; MinhaReceita grafo segue pendente de
  confirmação) — fontes, campos, regra de ativação e teste mínimo por conector,
  um conector por vez.

## v0.10.0 — "Pré-enriquecimento: ficha cadastral confiável + complementação por APIs"

Rodada dirigida pelo desenho do operador (P1 + P2): fortalecer o pré-enriquecimento
ANTES de acrescentar novas APIs — ficha empresarial rica, verificável e reutilizável
SEM gastar tokens de IA; pesquisa profunda continua sendo só para o que os dados
estruturados não respondem. Zero provedor pago; consultas públicas apenas.

### P1 — Base confiável

#### 1) CNPJ ALFANUMÉRICO (IN RFB 2229/2024) — validador, importação, dedupe e consultas
- **Falha confirmada na v0.9.1**: `normalizeCnpj` removia TODAS as letras (`\D+`) —
  o Scout não conseguia identificar empresas com o novo CNPJ alfanumérico
  (`00.000.000/E08G-12`, emitido pela Receita em 31/07/2026 para filial do BB).
- **Novo `cnpj.ts`**: normalização preserva dígitos + letras A–Z (maiúsculas);
  estrutura validada (8 dígitos + 4 alfanuméricos + 2 DVs); DV com a tabela oficial
  da RFB (A=17 … Z=42) — **verificado contra o exemplo oficial** (`00000000E08G` → DV `12`);
  CNPJs numéricos antigos continuam válidos SEM mudança de comportamento (o dígito
  vale ele mesmo na tabela — cálculo idêntico ao anterior).
- **Importação**: token de CNPJ (`extract.ts`) e CNPJ em prosa (`resolve/`) aceitam
  ordem alfanumérica; validação de DV continua descartando falso positivo.
  Dedupe/normalização já herdaram o suporte (string normalizada, sempre maiúscula).
- **Sanity sem rede**: `bun scripts/test-cnpj-alfanumerico.ts` — 21 verificações
  (DV do exemplo oficial, minúsculas, DV errado rejeitado, raiz/DV com letra
  rejeitados, numéricos legados intactos, classificação de importação sem regressão).
- **PROVA EM PRODUÇÃO PÚBLICA**: o CNPJ `00000000E08G12` (exemplo oficial da RFB)
  retorna nas fontes públicas o registro REAL — BANCO DO BRASIL SA, FILIAL,
  BRASÍLIA/DF, abertura **2026-07-31** (BrasilAPI, OpenCNPJ.org, MinhaReceita e
  OpenCaramelo respondem; ReceitaWS estava em 429 no momento do teste).

#### 2) CACHE COM VALIDADE — ficha cadastral reutilizável por CNPJ (tabela `CadastroCache`)
- **Falha confirmada na v0.9.1**: o reuso "entre lotes" não tinha validade e
  sobrescrevia `queriedAt` sem nova consulta — a data da coleta se perdia.
- **Novo desenho (proposta do operador)**: UMA ficha por CNPJ, com `fonte`,
  `coletadoEm` (data da coleta ORIGINAL — nunca sobrescrita por reuso),
  `validoAte` (TTL **30 dias**), dados completos, proveniência por campo
  (`provenienciaJson`), matriz já resolvida (`matrizJson`) e contadores.
- **Linha de lote agora separa as duas datas**: `queriedAt` (quando ESTA linha
  obteve os dados) e **`collectedAt`** (coleta original na fonte) + `fontesJson`
  (proveniência: fonte primária, complementações, reuso de ficha).
- **Expirou → REVALIDA**: ficha fora do TTL nunca é reaproveitada silenciosamente —
  vira consulta real (nova coleta). IBGE não entra no cache (rederivado localmente,
  grátis). Verificação de candidatos de identidade e busca de matriz também passam
  pela ficha (menos HTTP repetido no mesmo lote).
- **Revalidação MANUAL**: botão "Revalidar consulta" no rastro do dossiê +
  `POST /api/imports/{id}/rows/{n}/revalidate` (força consulta real, substitui a
  ficha; guardas honestas: lote em processamento → 409).

#### 3) CAMPOS COMPLETOS — sem corte silencioso de QSA/CNAEs
- **Falha confirmada**: QSA cortado em 30 participantes; CNAEs secundários cortados
  em 15 descrições SEM código.
- Agora: QSA entra COMPLETO (teto de segurança 500 só contra dado patológico);
  CNAEs secundários preservam **código + descrição** ("0000-0/00 — Desc") e entram
  completos (teto 200 + flag `cnaesTruncados` quando atinge). A UI já cortava só
  na exibição — nada muda de layout, tudo muda de completude.

#### 4) BACKOFF 429 EFETIVO na cadeia + telemetria POR FONTE
- **Falha confirmada**: o código registrava espera pós-429 (`noteBackoff`) mas a
  cadeia NUNCA consultava o controle (`isSourceCoolingDown` existia sem nenhum
  chamador) — a próxima requisição batia na fonte em pausa de novo.
- Agora a cadeia consulta o backoff ANTES de cada fonte; fonte em pausa entra nos
  attempts como `RATE_LIMITED`/`pulada` (honesto, sem requisição) — se TODAS
  pularem, o resultado é `RATE_LIMITED` com retomada natural quando o backoff
  (30s) expira. Auditoria `LOOKUP_FAIL` registra `fontes_puladas_backoff`.
- **Telemetria por fonte**: `/api/telemetry/summary` agora devolve
  `coleta.fontesCadastro[]` (consultas, OK, 429, falhas, tempo médio por fonte) e o
  painel de telemetria exibe a tabela. Reuso de ficha NÃO conta como consulta.

### P2 — Complementação por APIs

#### 5) Complementação SELETIVA por campo (sem consultar tudo sempre)
- **Falha confirmada**: a cadeia parava na 1ª resposta válida — se faltasse campo,
  ninguém complementava.
- Agora: a 1ª fonte que responde define a IDENTIDADE (nunca sobrescrita); as
  seguintes SÓ são consultadas se houver lacuna relevante (`gapsOf`: fantasia,
  e-mail, telefone, capital, natureza, porte, simples/mei, regime, endereço, QSA,
  CNAEs secundários, código IBGE, data de situação) e preenchem APENAS os campos
  vazios (`fillGaps`). Cada preenchimento registra fonte + campos + data
  (`completadoCom` → auditoria `LOOKUP_OK.complementado_por`, telemetria
  `ETAPA/COMPLEMENTACAO` e UI "Complementado por" no rastro).
- O comparativo provou o ganho real: BrasilAPI não traz e-mail do BB — MinhaReceita
  traz; ReceitaWS não traz QSA de filial — BrasilAPI/OpenCNPJ trazem.

#### 6) Comparativo de provedores (incl. OpenCaramelo .com) — `qa/comparativo-provedores-v0.10.0.{json,md}`
- **OpenCaramelo ≠ OpenCNPJ.org** (integrações distintas, formatos distintos):
  adaptador dedicado mapeado do endpoint real `kitana.opencnpj.com/cnpj/{cnpj}`
  (doc verificada em opencnpj.com/api). NÃO está na cadeia padrão — é experimento
  de cobertura, conforme orientação do operador.
- Amostra pública diversificada (companhia aberta, banco público, filial ordem 0002,
  CNPJ alfanumérico oficial). Resultados-chave (4 alvos × 5 provedores, rede real):
  - **Cobertura média (19 campos)**: MinhaReceita 16–18 · BrasilAPI 15–17 ·
    OpenCaramelo 15–16 · ReceitaWS 15–16 · OpenCNPJ.org 10–11 (o mais fraco).
  - **Latência**: BrasilAPI/OpenCaramelo/MinhaReceita ~330–600 ms; OpenCNPJ.org o
    mais lento (~1,0–1,2 s).
  - **429**: ReceitaWS recusou 2/8 consultas (limite próprio) — registrado honesto;
    backoff respeitado nas rodadas seguintes.
  - **Alfanumérico**: 4 de 5 fontes já atendem `00.000.000/E08G-12` (ReceitaWS em
    429 no teste — não medido).

### UI/UX
- "Rastro da consulta" (dossiê) agora mostra: fonte, consulta, **coleta original**,
  ficha cadastral (validade/reuso), **"Complementado por"** (fonte → campos) e o
  botão **Revalidar consulta**.
- Painel de telemetria: nova tabela "Fontes de cadastro" (consultas reais por fonte,
  429 destacado, tempo médio).
- Auditoria em linguagem humana: `CADASTRO_CACHE`, `REVALIDACAO_*`.

### Qualidade e estado
- `tsc src/` e `eslint` limpos; testes do validador 21/21 PASS; comparativo
  executado com rede real (20 consultas públicas, 0 chamada de IA, 0 custo).
- Sem Redis, sem cron, sem provedor pago; OPEN mode preservado; fila da Mesa e
  pesquisa profunda intocadas.

## v0.9.1 — "Correção de atribuição de sinais de porte (golden case)"

Sessão anterior quebrou no meio da entrega (contexto esgotado após o commit das
evidências E4/E5/E6 em 04:24). Esta rodada fecha a entrega e corrige 1 bug real
encontrado ao re-verificar o golden case no navegador. Zero chamada a provedor
pago; zero chamada de busca (cota de `web_search` segue em 429 desde ~04:00).

### Corrigido — upload em PRÉVIA desaparecia (o "E QUEBROU" do operador)
- **Sintoma real reportado**: operador envia `Pasta1.csv` (22 linhas, 12:05), a prévia
  abre — mas qualquer perda do estado do cliente (reload, navegação) e o lote
  PREVIEW ficava **INALCANÇÁVEL**: não reabria no boot (boot só buscava
  PROCESSING/CONFIRMED) e era filtrado fora de "Lotes anteriores"
  (`history.filter(h => h.status !== "PREVIEW")`). O upload parecia perdido.
- **Backend** (`GET /api/imports/{id}`): lote PREVIEW agora devolve
  `previewRecoveravel` — cabeçalho salvo + amostra de 5 linhas re-lida do ARQUIVO
  SALVO (determinístico, zero chamada externa, zero custo) + `fileSize`.
- **Boot** (`page.tsx`): ordem de reabertura virou `PROCESSING → PREVIEW →
  CONFIRMED` — a prévia não confirmada é a ação pendente mais recente do
  operador e reabre como prévia (mesma tela do upload: coluna CNPJ + amostra).
- **Histórico**: lotes PREVIEW aparecem em "Lotes anteriores" com o selo "Prévia"
  ("há prévia(s) aguardando confirmação"); clicar reabre a prévia. Lote com
  arquivo irrecuperável recebe aviso honesto em vez de tela vazia.
- **Verificado no navegador**: reload com a `Pasta1.csv` em PRÉVIA reabre a
  prévia; o operador seguiu o fluxo ao vivo (confirmou 12:20:15, iniciou
  12:20:20 — 22/22 CNPJs identificados via BrasilAPI; leituras IA em fila
  registrando 429 honesto do gateway).

### Corrigido — sinal de porte sem atribuição de entidade (Jotabasso)
- **Sintoma**: no dossiê de AGROPASTORIL JOTABASSO, a seção "Escala comprovada"
  exibia um sinal determinístico começando no meio do título da fonte —
  "…ra RISE with SAP e atualiza. Com um time de aproximadamente 700
  colaboradores, a Jotabasso atende…" — sem o nome "**Sementes** Jotabasso".
  O recorte antigo (`match ±60/140`) destruía exatamente a desambiguação de
  entidade que o golden case cobra (Sementes ≠ Agropastoril).
- **Coletor** (`news.ts` `extractPorteSignals`): recorte agora respeita fronteira
  de FRASE e palavra (nunca corta no meio); cada sinal carrega a FONTE à frente
  ("Sementes Jotabasso migra para RISE with SAP e atualiza — Com um time de…").
  A fonte também entra no INPUT da IA (linha 1185 do research.ts) — a atribuição
  melhora a síntese, não só a exibição.
- **View** (`/api/imports/{id}`): `research.sinaisPorteFontes[]` — para cada sinal
  de pacotes JÁ SALVOS, a API casa o sinal contra os resultados crus das buscas
  salvas/notícias e devolve `{fonte, url}`. O pacote persistido NÃO é tocado
  (hashes de evidência A/B permanecem intactos).
- **UI** (`PorteSignals`): cada sinal exibe a linha de fonte com link; "Copiar
  leitura" inclui `[fonte: …]` nos sinais.
- Verificado no navegador (pacote antigo): fonte "Sementes Jotabasso migra para
  RISE with SAP e atualiza" (delaware.pro) agora visível no dossiê.

### Estado herdado (sem mudança, registrado com honestidade)
- LAR COOPERATIVA: a tentativa de fila de 03:58 SOBRESCREVEU o pacote anterior
  com o pacote v3 de cota recusada (18 buscas em 429, 0 resultados — só RSS de
  notícias sobreviveu). `retry-ai` NÃO foi executado de propósito: regeneraria
  dossiê a partir de pacote sem evidência de busca. Recuperação do golden case
  Lar = `retomar` a fila quando a cota de busca voltar (estado PAUSADA com
  motivo honesto segue visível na UI).
- Golden cases: Jotabasso PASS (agora também na exibição dos sinais), Brasil
  Digital PASS, Lar PARCIAL (aguardando cota).

## v0.9.0 — "Rodada intensiva: Mesa de Contas, Pesquisa Adaptativa, comparabilidade A/B provável"

Missão: contrato "RODADA INTENSIVA v0.8.0 → próximo checkpoint" — qualidade da
investigação, eficiência de chamadas e operação de lotes. Baseline v0.8.0
(SHA 0ae5aff…af134e, conferida na VM). Sem cron, sem push, sem deploy, sem Redis,
provedor nativo Z.ai permanece o PADRÃO.

### E0 — v0.8.0 fechada + comparabilidade A/B honesta
- **Bug corrigido**: `lab-panel` chamava `POST /api/lab/test`, que NÃO existia (404).
  Rota criada (`probeExternalProvider` — GET /models, zero inferência, zero tokens).
- **Descoberta material**: o dossiê oficial profundo NÃO incluía o bloco
  `resolucao_identidade` no input, mas a comparação do laboratório incluía — o
  prompt "idêntico" não era byte-a-byte. Deep path agora usa o MESMO bloco
  (mesmo filtro de sinais) que `buildInputFromRow` reconstrói.
- **Temperature reconciliada**: `DOSSIER_TEMPERATURE=0.2` centralizada; nativo e
  comparação externa usam o mesmo parâmetro (resolve-service repassa).
- **Rastreabilidade**: `ImportRow.dossierEvidenceSha/dossierSystemSha/
  dossierPromptVersion/dossierTemperature` — hash do prompt EXATAMENTE como vai
  ao modelo; cache de IA copia os hashes.
- **Veredito na UI**: comparações só exibem "A/B equivalente" quando hash das
  evidências + hash do prompt + versão + temperatura CONFEREM com a síntese
  oficial; caso contrário: "Comparação histórica — entradas não comprovadamente
  equivalentes" (dossiês antigos, sem hash, são SEMPRE históricos).
- Tokens reportados ≠ custo em dinheiro: nota explícita na UI.
- Docs reais: LEIA-ME/CHANGELOG/API-SPEC/INTEL-SPEC alinhados às versões (v0.8.0
  fecha neste entry abaixo; v0.9.0 é esta).

### E1 — Mesa de Contas Operacional
- Fila de pesquisa profunda por SELEÇÃO (contrato: "importar 5 mil não autoriza
  pesquisar 5 mil"): `ImportBatch.researchQueueJson` durável + executor em
  memória (globalThis), 1 conta por vez, máx. 500/fila, sem Redis/cron.
- `POST /api/imports/:id/research-batch {acao: iniciar|parar|retomar, rowNumbers, modo}`.
- Confirmação com quantidade exata antes de executar (AlertDialog).
- Progresso consolidado (FilaPesquisaPanel) + per/conta na coluna Scout
  ("na fila de pesquisa") + parar SEM perder concluídas + retomada SEM repetir
  chamadas (pacote fresco é PULADO; runDeepResearch interno também reutiliza).
- 429/cota: fila PAUSA com motivo honesto; retomada é sempre manual.
- Revive após restart via `sweepStalled` (heartbeat 3 min) — não é cron.
- Filtro de PESQUISA server-side: com_dossie | gerando | falhou | sem_pesquisa.
- Seleção preservada ao trocar página/filtro (já existia; verificado).

### E2 — Pesquisa Adaptativa (experimento controlado)
- `buildResearchPacket(opts, modo)`: **COMPLETO** (pipeline A→E integral,
  preservado como comparação) e **ADAPTATIVO** (nível 0 cadastro com ZERO buscas →
  nível 1 dirigida → nível 2 SÓ por lacuna: grupo, presença local, tecnologia,
  escala, período/RI, variante de marca — com MOTIVO registrado por consulta).
- Dedupe semântico de consultas entre etapas + dedupe exato de páginas;
  `consultasLog[nivel,motivo,query,resultados]` e `metricas` no pacote.
- Experimento real (Lar, 2026-10-22): COMPLETO 12 buscas/72,8s vs ADAPTATIVO
  6 buscas/63,1s — mesma cobertura de tecnologia (6 sinais) e notícias (10);
  adaptativo não coleta sinais comerciais (5→0). Pacotes em
  `evidencias/adaptativa/`. Economia NÃO é generalizada sem mais experimentos.
- UI: botão "Adaptativa" no dossiê (individual) + escolha de modo na fila.

### E3 — Golden cases (defeitos factuais conhecidos)
- **Jotabasso — PASS no critério central**: variante de marca ("JOTABASSO") buscada
  + páginas LIDAS para desambiguação; dossiê da Agropastoril atribui cada evidência
  à entidade exata e NÃO transfere o SAP de Sementes ("Nenhuma evidência de ERP"
  honesto, NAO_COMPROVADO). `brandTokens` deriva marcas raras do nome jurídico.
- **Brasil Digital — PASS domínio**: `brasildigital.net.br` (site real) em vez de
  updatestar.com; DIRECTORY_HOSTS estendido (agregadores de software e listas
  comerciais); SAP Business One fica como INDICIO (material promocional 2021),
  nunca produção.
- **Lar/Senior — PARCIAL**: Senior entrou na varredura c1 + busca de vaga por
  marca/cidade + busca dirigida de vaga citando fornecedor quando nada aparece
  (vaga citando Senior = tecnologia CITADA, ≠ produção). A 3ª coleta bateu no
  esgotamento de COTA (429 persistente) — estado honesto no pacote
  (`buscasRecusadasCota=19`, nota PESQUISA INCOMPLETA); retomada manual pendente.
- **Escola Paranaense / Sementes Carolina / Madeireira São José**: comportamento
  de ausência honesta e revisão de identidade preservado (código do resolver não
  alterado; re-execução completa pendente de cota).
- **Filtro de relevância**: resultado de busca sem token raro da empresa/marca é
  RUÍDO (homepages de fornecedor, homônimos) — rejeitado com motivo em
  `fontesRejeitadas`; tokens curtos exigem fronteira de palavra ("lar" não casa
  em "particular").

### E4 — Cobertura factual do dossiê (sem score comercial)
- Grid compacto por dimensão: Identidade · Operação · Escala comprovada ·
  Estrutura societária · Tecnologias · Mudanças relevantes · Fontes e período.
- Estados derivados de dados presentes: COMPROVADO / PARCIAL / NÃO ENCONTRADO
  (só com pesquisa suficiente) / NÃO PESQUISADO — cota recusada é pesquisa
  INCOMPLETA, nunca ausência conclusiva.
- Divergências entre fontes exibidas (nunca abafadas); nenhuma conclusão genérica
  de aderência/receita/necessidade.

### E5 — Laboratório mais útil
- Histórico legível por conta (data, provedor, modelo solicitado→efetivo, estado,
  HTTP, tokens, veredito de equivalência).
- Leitura estrutural do dossiê experimental (campos presentes/ausentes + contagem
  de evidências por status).
- Anti-SSRF mínimo no vault: hostname literal-IP privado (10/172.16-31/192.168/
  169.254/0), *.local e *.internal recusados SEMPRE; loopback (127.0.0.1) apenas
  para o mock local; https obrigatório fora do loopback.

### E6 — Exploração (documentada, NÃO implementada)
- `docs/EXPLORACAO-V0.9.md`: 8 oportunidades com problema, reuso, custo, risco
  factual, menor teste e benefício (cache de fontes, FTS local, comparação de
  lote, diff temporal, CVM/PNCP, teia com prova, export executivo, PDFs).

### Honesto desta rodada
- Cota de web_search esgotou (429 persistente no fim da rodada); re-runs ficaram
  pendentes com estado honesto e retomada manual (o desenho de 429 foi exercido
  de verdade). Nenhuma economia de busca foi "anunciada" além do experimento
  comparável. GPT-6 Luna/DeepSeek externos seguem SEM chamada real (sem chave,
  sem autorização) — mock local valida o fluxo.

## v0.8.0 — "Lote B: laboratório de modelos externos (credencial efêmera) + OPEN no Preview"
- OPEN mode no Preview: `.env` sem SCOUT_AUTH_REQUIRED — UI/API abertas anônimas;
  TOKEN segue disponível por env (código de auth preservado para uso futuro).
- Laboratório (Lote B): credencial efêmera em memória (vault globalThis, cookie
  httpOnly `scout_lab`, TTL 60 min, máx. 8 sessões, descarte, redação de chave),
  conector OpenAI-compatible (sem retry/fallback), comparação manual com o pacote
  salvo (0 buscas novas), provedor MOCK local (`sk-mock*`) para validação sintética;
  dossiê experimental em tabela separada (LabComparison) — nunca substitui o oficial.
- Telemetria IA_CHAT com fonte própria para comparações; appVersao 0.8.0.


## v0.7.0 — "Lote A: pistas completas, IA por decisão, telemetria reconstruível"

Missão: Lote A do contrato 2026-10-20 (A1 importação multicoluna · A2 IA opt-in ·
A3 telemetria completa) sobre a baseline v0.6.2 (kit SHA c394899…). Linhagem:
v0.6.2 (a5fa8a1) → v0.6.2+c394899 (mídia curada) → **v0.7.0**. Sem cron, sem push,
sem deploy. Provedor nativo Z.ai inalterado como padrão.

### A1 — Importação multicoluna (fecha P0-A do diagnóstico: 4/5 linhas descartadas)
- `confirmBatch` (CSV) extrai pista alternativa quando a coluna CNPJ vem vazia:
  domínio/site > e-mail > nome de empresa (cabeçalho de razão social/nome/fantasia
  tem prioridade; colunas de cidade/UF/telefone nunca viram nome; UF solta é
  descartada da junção). Reutiliza a MESMA classificação de tokens do parser de
  texto (`classifyToken`) e o MESMO pipeline de resolução do texto colado
  (`lookupKind` + `extractClues` + resolver) — nenhuma infraestrutura nova.
- CNPJ inválido digitado não esconde as outras pistas: a linha segue como
  REFERENCIA com a nota honesta na pista.
- Dedupe de referência (domínio/nome) com `duplicateOf` — rastreabilidade das
  linhas originais preservada; nada é consultado duas vezes.
- Linha sem pista utilizável nenhuma: estado HONESTO "Sem pista utilizável" na UI
  (antes: "Aguardando" eterno + pista vazia — QA 18/19 do diagnóstico). A pista
  exibida passa a ser a primeira célula útil da linha original.
- Nenhum CNPJ inventado para empresa sintética/não identificada (contrato mantido);
  confirmar identidade NÃO inicia pesquisa profunda (confirma≠pesquisa mantido).

### A2 — IA somente por decisão explícita (fecha P0-C: IA ON por default)
- Default de `aiEnabled` agora é **false** na UI (`page.tsx`) E no servidor
  (`confirm/route.ts`) — importar/confirmar NUNCA consome cota de modelo sozinho.
- Jornada: Importar → Identificar → Revisar → Selecionar → **Pesquisar** (botão
  por conta) → **Sintetizar** (leitura por conta / regeneração). Pesquisa profunda
  permanece explícita por linha; regeneração manual ignora cache (já existia).
- Pacote de evidências reutilizado <24h quando completo (G5 mantido); "Gerar
  leitura" refaz SÓ a síntese sem re-coletar (retry-ai mantido).
- Copy do toggle atualizada ("Desligada por padrão…") para a decisão ser visível.

### A3 — Telemetria completa e auditável (fecha P0-B: tokens 0/56)
- **Correção do key-mismatch**: `resolve-service` NORMALIZA o `usage` do gateway
  (aceita `{prompt,completion,total}` e `{prompt_tokens,...}`, devolve ambos os
  shapes); `ai.ts` lê AMBOS — ausência continua nula, nunca vira zero.
- **Nova tabela `TelemetryEvent`** + `src/lib/telemetry.ts` (AsyncLocalStorage):
  run_id/batch_id/row_id/rowNumber/empresa/cnpj/etapa correlacionados sem
  invadir assinaturas; gravação fire-and-forget (nunca quebra o fluxo); sanitização
  (sem segredos/headers/PII/conteúdo bruto; payload cortado).
- Eventos: `COLETA_CADASTRO` (fonte, URL, HTTP, duração, resultados — funil
  `fetchJson`), `WEB_SEARCH`/`PAGE_READER` (query/URL, HTTP, tentativas, resultados,
  aproveitáveis, recusa por cota = estado "bloqueado" DISTINTO de "sem resultados"),
  `IA_CHAT` (provedor, modelo solicitado/efetivo, objetivo, duração, tokens
  normalizados, `tokensInformado=false` quando o gateway não relata, tamanho do
  pacote, versão do prompt), `ETAPA` (RESOLUCAO_IDENTIDADE / ENRIQUECIMENTO /
  PESQUISA_PROFUNDA / SINTESE_IA / RESUMO_LOTE com estado final sucesso/parcial/
  falha/bloqueado e duração).
- Cache entre lotes visível: LOOKUP/AI/RESOLVE/DEEP_RESEARCH cache ganham
  `cacheHit=true` na telemetria.
- **Versões registradas**: `appVersion()` (package.json) + `PROMPT_VERSION`
  ("2.0.0-lotea") em cada evento de IA.
- **Visão consolidada**: `GET /api/telemetry/summary?batchId=` + painel
  "Telemetria do lote" na UI (buscas, leituras, IA, tokens informados/não
  informados, 429, cache, tempo médio por etapa, contas identificadas/revisão).
- **Export para auditoria** (5.5): `export?type=telemetria` (JSONL correlacionável)
  e `type=telemetria-resumo` (JSON legível) — identificadores, versões e datas
  reais para confrontar telemetria × dossiês × mídia.

### Ponto de integração Lote B (apenas preparar — SEM conector)
- `src/lib/providers/external-ai.ts`: contrato tipado DORMANTE (baseUrl/apiKey/
  modelId), guarda `assertExternalAiDisabled()` que falha ALTO se invocado, e as
  regras já decididas (chave nunca no ZIP/logs/código; sem fallback automático;
  resultados experimentais separados; telemetria distingue provedor).
- Nenhuma chamada de rede, nenhuma UI, nenhuma chave lida nesta versão.

### Mantidos (regressão)
G9 guarda TOKEN/OPEN nas rotas · G6 lease durável · confirm≠process ·
ENTITY_BINDING (UNRESOLVED > falso candidato) · matriz pelo identificador oficial ·
datas civis YYYY-MM-DD · cache entre lotes · teto AI_MAX_PER_BATCH por consumo real.

---

## v0.6.2 — "Fronteira real, lease durável, coleta honesta" (resposta à auditoria de retorno do executor v0.6.1)

Veredito recebido: FAIL/CORRECT_DELTA. Este release fecha os três P0 apontados, a
documentação desalinhada e o versionamento — sem cron, sem deploy, sem mutação de dados.

### G9 — Segurança e fronteiras (risco 1 do retorno)
- **Sessão de servidor com cookie httpOnly** (`src/lib/auth.ts` + `POST/GET/DELETE /api/auth/session`):
  o operador digita o token UMA vez; o servidor valida contra `SCOUT_EXPORT_TOKEN` (ou token
  auto-gerado quando `SCOUT_AUTH_REQUIRED=1`, salvo em `db/.scout-token`) e emite cookie
  assinado por HMAC-SHA256 — **o segredo nunca vai ao código do cliente** (nem header fixo,
  nem localStorage).
- **TODAS as rotas de dados protegidas** (antes: `retry-ai`, `retry`, `ai-summary`, `tick`,
  upload, listagem e leitura de lote sem guarda): `assertAccess` cobre as 16 rotas —
  leitura e escrita. Anônimo recebe **401 UNAUTHORIZED** sem tocar no banco.
- **GET /api/imports/[id] sem efeito colateral anônimo**: o sweep de recuperação (mutação
  de estado) só roda DEPOIS da guarda; chamada não autenticada não altera nada.
- **Fim do fail-open silencioso**: modo OPEN (kit local, sem env) é explícito em
  `GET /api/auth/session` e no selo da UI; `SCOUT_AUTH_REQUIRED=1` fecha a fronteira em
  deploy sem token configurado.
- **UI desbloqueável sem quebrar**: `apiFetch` detecta 401 UNAUTHORIZED, abre o diálogo de
  desbloqueio (`AuthGate`) e a sessão nova recarrega a visão; exportações por link passam a
  funcionar via cookie (mesma origem). Header `x-export-token` continua válido para curl/CLI.

### G6 — Concorrência/retomada (risco 2 do retorno)
- **Lease durável em banco** (`leaseOwner` + `leaseExpiresAt` em ImportBatch): o lock em
  memória só é fast-path do mesmo processo; entre processos a verdade é o banco.
- **Claim atômico ANTES de qualquer trabalho** em `startBatch` (updateMany condicional —
  em N processos, exatamente 1 vence; o fim do "marca lock após await").
- **Heartbeat de 15s durante TODO o runBatch** renova o lease; se o lease for perdido
  (outro worker assumiu), o run atual encerra com evento `LEASE_LOST` sem duplicar trabalho.
- **Sweep só retoma lease EXPIRADO**: worker vivo (heartbeat a menos de 60s) nunca é tomado
  como órfão; `processingNow` na API considera o lease do banco (`batchHasLiveLease`).
- **Recuperação sem falso órfão**: `recoverOrphanRows` só roda com o lease já vencido e
  poupa a pesquisa profunda `GERANDO` com `researchAt` < 120s.

### G5 — Repetição de pesquisa e caches (risco 3 do retorno)
- **Coleta recusada por cota NUNCA é reusada**: "Pesquisar de novo" re-coleta quando o
  pacote salvo tem `buscasRecusadasCota > 0` (antes: reuso < 24h preservava o buraco de
  evidências para sempre) — evento `DEEP_RESEARCH_CACHE_SKIP` na trilha. Refazer SÓ a
  síntese (`retry-ai`) continua reaproveitando o pacote completo.
- **Fim da dupla contagem de 429**: recusa que se recupera no retry de 15s não soma;
  só recusa FINAL conta 1× (`buscasRecusadasCota`).
- **Recusa não é "sem resultados"**: a nota por busca agora distingue
  `busca recusada por limite de cota: "…"` de `busca sem resultados: "…"`.

### P1 — Documentação e rastreabilidade (risco 5 do retorno)
- **LEIA-ME v0.6.2 sem promessas removidas**: fora score N/100, decisores e faturamento
  por faixa; nova seção "Acesso protegido (opcional)" com os dois modos.
- **INTEL-SPEC com bandeira de histórico**: seções de score 0–100 e faturamento marcadas
  como módulos REMOVIDOS; código atual apontado corretamente.
- **Versão única**: package.json, LEIA-ME e CHANGELOG em v0.6.2.

### Autorização
- Nenhum cron criado ou mantido (a lista de jobs do ambiente está vazia; o job 469533
  citado pelo retorno não existe aqui). Sem deploy, sem merge, sem push.

## v0.6.1 — "Intenção humana, erro honesto, cota medida" (mapa de auditoria do pacote v0.6.0)
### G1 — Intenção e estados (P0-01, P0-02, P0-07)
- **Confirmar ≠ processar**: o clique em confirmar NÃO dispara mais `/process` escondido —
  o lote fica CONFIRMED e só o botão "Iniciar agora" (comando explícito e idempotente) começa.
- **Nenhum tick/cron inicia lote que o humano não iniciou**: o auto-start de lotes
  CONFIRMED após 30s (RECOVERY_START_CONFIRMED) foi REMOVIDO do sweep.
- **Lease atômico em banco** na retomada de lotes PROCESSING órfãos (em N chamadas
  simultâneas, só uma retoma) + recuperação de linhas órfãs: síntese rápida GERANDO volta
  pra fila; pesquisa profunda GERANDO sem executor vira FALHOU honesto ("reexecute para
  concluir") — nunca reinicia custo de busca sem consentimento (researchAt agora sela o
  INÍCIO da pesquisa e serve de lease/heartbeat).
### G4/G5 — Narrativa e erros (P0-03, P0-04, P0-09, P1-03)
- **Dossiê factual sem hipótese é VÁLIDO**: a validação de IA não reprova mais o dossiê
  inteiro por falta de hipótese (causa raiz do "pesquisa salva + leitura falhou" da
  Escola Paranaense) — lacunas ficam em "O QUE FALTA INVESTIGAR"; nunca preencher com
  dor comercial inventada.
- **Fim da prosa costurada**: nada de "por isso pode … — vale validar" colado sobre
  frases completas — hipóteses entram ROTULADAS (FATO → CONSEQUÊNCIA POSSÍVEL → VALIDAR)
  no prompt, na síntese, na UI e na cópia.
- **Erro de IA visível e específico**: `aiError` sai na API e no dossiê; pesquisa OK +
  síntese falhada é diferenciada ("a pesquisa foi salva — a síntese é que falhou", retry
  reusa o pacote sem recrawl); a tabela mostra "Falhou · tentar" em vez de "—".
### G3 — Datas (P0-05)
- **Datas civis sem fuso**: `2011-11-11` vira **11/11/2011** em qualquer timezone
  (formatBR parseia YYYY-MM-DD por partes, sem `new Date` UTC-midnight) — ficha, dossiê
  e cópia; verificado ao vivo no caso Brasil Digital (antes 10/11).
### G6 — Fila e cota (P0-06, P1-04, P1-05)
- **Cota medida, não muda**: o resolve-service agora ESPERA por slot (até 24s) antes de
  recusar; recusa vira 429 QUOTA explícito; o pacote carrega `buscasRecusadasCota` e a
  nota "PESQUISA INCOMPLETA: N busca(s) não executada(s) por limite de cota" — e a
  síntese é PROIBIDA de concluir ausência sob cota esgotada (nova regra 11 do modo profundo).
- **Teto de IA honesto**: FALHOU não consome teto (só OK + em voo) — retry humano é
  possível; polling adaptativo (1,5s ≤12 linhas · 3s acima).
### G2/G10 — Proveniência (P1-06, P1-07, P1-10)
- **Teia por sócio com proveniência**: nota explícita "coincidência nominal não prova
  participação; confirmar no QSA da empresa encontrada" + limite dos 3 primeiros sócios
  declarado quando o QSA é maior.
- **Domínio candidato validado por nome**: sem correspondência de nome no resultado da
  busca, o método vira "INDÍCIO FRACO — NÃO declarar site oficial sem prova".
- **Fonte sem espelhamento indevido**: chip "Consulta oficial direta" virou "Cadastro
  oficial" com o fornecedor real na explicação (BrasilAPI etc. — agregador, não espelho
  direto da Receita).
### G8 — Interface (P1-01, P1-02, P1-08, P1-09)
- **Cópia = dossiê**: um único espelho das seções canônicas (seções duplicadas
  mescladas, população do município fora, "O QUE FALTA INVESTIGAR" único).
- **Cobertura honesta**: tile "Contas identificadas" + "Leituras Scout prontas: X de Y"
  — nunca "100% pesquisa pronta".
- **Tabela**: coluna Empresa/CNPJ congelada na rolagem horizontal (single scrollport),
  hover coerente, sem coluna cortada.
- **Sem prazo inventado**: "Isso leva de 1 a 2 minutos" removido — a leitura atualiza
  sozinha quando estiver pronta.
### G9 — Segurança (P0-08)
- **Fronteira ativável por ambiente**: `assertMutationAllowed` (mesma chave
  SCOUT_EXPORT_TOKEN) protege confirm, process, deep-research, retry de IA, decide e
  tick — sem a variável, modo dev local aberto; com a variável, 401 sem o header.
### Inventário (P2-01)
- `package.json` alinhado à 0.6.0/0.6.1; LEIA-ME sem citar score.ts/db/evidencias que não
  vão no kit sanitizado; kit regenerado com `unzip -t` verificado.

## v0.6.0 — "Verdade comprovada, jornada sem beco" (este kit)
### Veracidade dos dados (o comercial não pode ser induzido a erro)
- **Faturamento inferido ELIMINADO** (`lib/enrich/faturamento.ts` apagado): porte
  DEMAIS/ME/EPP, Lucro Real/Presumido e não-optante do Simples nunca mais viram faixa de
  receita afirmada. Colunas `faturamento_faixa`/`faturamento_base` fora de todos os CSVs;
  painel de panorama, ficha CRM e packet de IA sem a inferência. Sem receita documentada
  (valor + período + fonte + escopo), o campo **não aparece**.
- **Score comercial 0–100 REMOVIDO** (`lib/score.ts` apagado): badge da fila, painel
  circular, ordenação por nota e colunas `score_prioridade`/`score_banda` fora da
  experiência — sem substituto numérico (G4).
- **Regime tributário datado**: Lucro Presumido/Real agora carrega exercício + natureza
  ("informação fiscal de fonte agregada — não confirma operação vigente").
- **Perguntas de abordagem e "próximo movimento" genérico fora** dos prompts fast/deep,
  da UI e dos exports — o produto informa, não roteiriza.

### Investigação de tecnologia (o teste mais discriminante)
- **Empacotamento por dimensão** na síntese (`ai.ts`): cota garantida para identidade,
  operação/escala, **tecnologia (≥30%)** e mudanças — fim do corte global das "5 primeiras
  buscas / 18k chars" que descartava a evidência do fornecedor que o coletor tinha achado.
  Notícias do Google News agora entram no pacote (antes nunca eram renderizadas).
- **Estados de adoção canônicos** (`lib/enrich/tech-states.ts`): Em uso confirmado ·
  Implantação anunciada · Tecnologia mencionada em vaga · Indício não confirmado ·
  Nenhuma evidência após pesquisa — vaga ≠ produção, cada tecnologia com estado+fonte+data.
- **2 fontes novas no coletor**: vagas/carreira e casos de sucesso de fornecedor.

### Jornada humana sem beco sem saída (Fase 5)
- **`decide` reescrito**: `Nenhuma destas é a empresa` agora abre 4 saídas — adicionar
  outra pista (`action: CLUE` → reprocessa a mesma linha preservando auditoria), informar
  CNPJ correto, manter como não identificada (`action: NOT_FOUND`, auditável) e voltar aos
  candidatos (`action: BACK`). Nenhum caminho irreversível. E2E real: pista nova resolveu a
  linha com confiança MUITO_FORTE (domínio do registrante → CNPJ).
- Tela "Precisamos confirmar esta empresa": Pista recebida → O que conseguimos comprovar →
  por que cada candidato apareceu (nome, local, fonte, situação) + alerta de situação
  cadastral baixada ANTES da decisão. "Nome semelhante não comprova vínculo" explícito.

### Dossiê reestruturado + layout (Fases 4 e 6)
- **8 seções canônicas** (seções sem conteúdo não são renderizadas): Resumo da empresa ·
  O que faz e como opera · Escala comprovada · **Administração e representantes
  registrados** (QSA ≠ decisor comprovado) · Tecnologia e sistemas identificados ·
  Mudanças relevantes · Possível relação com Senior/concorrentes (com "Aderência ainda não
  comprovada" honesta) · O que falta investigar.
- **Dossiê fora da linha da tabela**: expansão virou **Sheet lateral** (≥1024px) /
  full-width (<1024px), header fixo, rolagem única, zero sobreposição. "Copiar link"
  removido (deep link segue via URL).

### Segurança (G7)
- **`SCOUT_EXPORT_TOKEN`**: se definido, toda rota de export (`export-all`, export por
  lote) exige header `x-export-token` (comparação `timingSafeEqual`); sem a variável,
  modo dev liberado. Kit público já sanitizado (sem banco/evidências).

### Motion (ecossistema SV: animations/table/blocks/agentation)
- **Header v3 com respiro**: 72px → 60px rolado (desktop) · 64 → 56 (mobile), logo 40px,
  marca em lockup de duas linhas SEMPRE visível, "Como funciona" como botão de vidro com
  borda + press-feedback físico (`active:translate-y-px`).
- **Kit de primitives** (`components/motion/sv-primitives.tsx`): Ticker (contador com mola
  crítica 100/60, `tabular-nums`), Blur-Fade em cascata, SpotlightCard (holofote teal que
  segue o cursor), StatusPing (halo esmeralda), EmptyStateRow, FloatingActionBar.
- **CSS utilitário**: glare-card (sheen diagonal no hover), border-beam (pacote de luz
  orbitando a borda, offset-path, fase oposta), shiny-text (banda de brilho em rótulos) —
  tudo transform/opacity/filter, `prefers-reduced-motion` desliga.

## v0.5.1 — "Header compacto & movimento cromático"
- **Header 64px → 48px (42px rolado)**: logo 36→28px, marca em linha única (fim da pilha
  de duas linhas) e hero mais próximo — mais produto na primeira dobra.
- **Header reativo por mola** (Framer `useScroll`): colapsa ao rolar, sombra de profundidade
  que acorda com o scroll, subtítulo que some com fade — nunca pula layout.
- **Barra de progresso de leitura** sob o vidro: gradiente esmeralda→neon perseguido por
  mola (`scrollYProgress` + `useSpring`) — escala de 0 a 1 conforme a leitura.
- **Luz cromática** (inspirada no Chromatic Light Lab do UX Pilot Labs): varredura espectral
  diagonal atravessando o vidro do header (9s, acelera no hover, só transform + blur,
  `prefers-reduced-motion` desliga).
- **Micro-movimento**: logo com mola no hover/tap (scale+rotate), "Como funciona" com
  rotação do ícone no hover, entrada do header descendo de cima com atraso mínimo.
- Header extraído para `components/cnpj/app-header.tsx` (page.tsx 764→~690 linhas);
  HOW_IT_WORKS mora junto do header que o usa.
- Entrega: botão "Baixar projeto (.zip)" no rodapé + `scripts/build-zip.sh` (ZIP canônico
  v0.5.1, 44px de alvo de toque no mobile).

## v0.5.0 — "Vínculo comprovado & pesquisa por evidências"
- **Contrato ENTITY_BINDING no resolvedor** (`lib/resolve/binding.ts`): todo candidato nasce
  com vínculo auditável (`source_url/source_owner/mentioned_entity/binding_type/evidência/data`).
  11 tipos de vínculo; `PAGE_OWNER_ONLY` e `UNRELATED` são descartados com motivo — o CNPJ do
  dono da página nunca mais vira candidato (golden case "sementes carolina": Mercado Livre,
  MF Rural, Câmara dos Deputados e Denison rejeitados; UNRESOLVD honesto > candidato falso).
- **Gate mínimo de candidatos**: 1 evidência FORTE ou 2 MODERADAS independentes; BrasilAPI
  virou "dados jurídicos confirmados" (valida o registro, não o vínculo) — UI separa
  "Por que este CNPJ corresponde à pista" de "Dados jurídicos confirmados".
- **Pesquisa profunda por etapas A–E** (`lib/enrich/research.ts`): A identidade (fundação ≠
  abertura cadastral, grupo/marca), B dados de companhia aberta (RI com período+escopo),
  C tecnologia existente (estado IMPLANTADA/ANUNCIADA/AVALIAR — nunca presumir troca de SAP),
  D estrutura comercial/compras (portais de fornecedor), E notícias priorizadas por relevância
  comercial com dedupe por evento (`news.ts`) e recuperação da URL original (Google News).
- **Contrato de evidência no dossiê profundo**: cada afirmação carrega entidade, período,
  fonte e URL; status CONFIRMADO/INDÍCIO/HIPÓTESE/NÃO COMPROVADO; "Entidade analisada"
  separa PJ de marca/rede licenciada (caso Petrobras vs. Vibra generalizado).
- **Antifragilidade de modelo**: backoff 429 (20s→45s), retry interno do scoutChat (3×),
  supervisor `dev:resiliente` no mini-service, busca de nome corrigida (`searchNameFor`
  rejeita fantasia legado tipo "PETROBRAS - EDISE"), detecção LISTADA robusta ("S A" no meio).
- **Instrumentação real**: tokens solicitados/efetivos (null quando o gateway não devolve —
  honesto), tempo de síntese, tempo por etapa do pacote, cache auditado (<24h).
- **Entrega**: `scripts/build-zip.sh` — o ZIP canônico sempre pronto em `public/`,
  botão "Baixar projeto" no rodapé do app.

## v0.4.0 — "Prioridade & Contato"
- **Score de prioridade comercial 0–100** (`lib/score.ts`): 10 fatores determinísticos com
  detalhe audível por ponto; bandas ALTA/MEDIA_ALTA/MEDIA/BAIXA em emerald institucional.
- Badge N/100 na lista (`PriorityListBadge`) com tooltip dos 2 maiores fatores e
  ordenação por score (header "Empresa": none→desc→asc, não-enriquecidas no fim).
- Painel `PriorityPanel` no dossiê: os 10 fatores com pontos/max/por-quê.
- **Consistência UI=export**: adaptador server-side `computePriorityScoreFromRaw()`;
  colunas `score_prioridade` + `score_banda` nos 3 CSVs (resultado, leituras IA, consolidado).
- **Contato**: e-mail, telefone e telefone 2 do cadastro público na ficha do dossiê
  (`ContactSection`) com copiar-um-clique e texto pronto p/ CRM; colunas
  `contato_email/telefone/telefone_2` no CSV.
- **Decisores**: QSA com qualificação ranqueada (`DecisoresSection`); sócios PJ sinalizam grupo.
- **Faturamento**: faixa pública com base legal (`faturamento.ts`, LC 123/2006) —
  colunas `faturamento_faixa` + `faturamento_base`; capital nunca vira faturamento.
- **Contexto municipal IBGE**: população + região imediata no CSV e dossiê.
- Documentação completa do kit: MOTION-SPEC, COMPONENT-CATALOG, INTEL-SPEC, API-SPEC,
  QA-GALLERY, CHANGELOG, LEIA-ME + pasta `evidencias/` com QA visual.

## v0.3.3 — "Motor de pesquisa"
- Teia societária de lista → GRAFO visual no dossiê.
- Google News RSS dedicado por nome + gap-chasing (fim do "não sabemos" preguiçoso).
- Porte real por tabela de evidência (sinais citáveis: headcount/receita/frota/unidades).
- Rounds de QA dark mode + mobile com screenshots (`evidencias/`).

## v0.3.2 — "Aurora Glass" (design overhaul)
- Roxo eliminado do produto; identidade IA = esmeralda `#086B6B` + neon `#12F7D1`.
- Fundo aurora (4 blobs dessincronizados + grão anti-banding), vidro em 3 camadas.
- Fix logo cortada (width/height declarados), dossiê `max-w-3xl` / tela cheia mobile.
- Regra anti-slop de conteúdo (fato visual primeiro) + microcopy de tom.
- Copiar funciona em HTTP (fallback `execCommand`).

## v0.3.1 — "DONE state"
- Banner de resultados: CTA "Visualizar resultados" + "Exportar ▾" + alertas materiais.
- Dossiê com abas (Dossiê/Dados/Evidências) e 11 seções.
- Filtro nunca herda valor vazio (auto-reset anti-tela-vazia).
- Exportações múltiplas (7 formatos) + auditoria .jsonl.
