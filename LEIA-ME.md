# SCOUT 360 — Kit Completo v0.10.24
### Enriquecimento de contas B2B (CNPJ) · UI "Aurora Glass" + motor de inteligência comercial

Este ZIP é **tudo o que foi construído**: código-fonte completo, documentação detalhada
de design/motion/inteligência/API, catálogo de componentes e evidências de QA.
> Recompila sempre que precisar: `bash scripts/build-zip.sh` → ZIP canônico em `dist/` (v0.10.15: FORA da área pública — herdado da v0.10.12 — o app não serve mais o kit por URL; o pacote é destinado ao operador para auditoria).

---

## 1. Mapa do kit

```
├── LEIA-ME.md                    ← você está aqui (mapa + como rodar)
├── src/                          ← aplicação completa (Next.js 16 App Router)
│   ├── app/                      → page.tsx (produto), layout, globals.css (tokens/aurora), 17 rotas API
│   ├── components/cnpj/          → 5 componentes do produto + senior.tsx (design system interno)
│   ├── components/motion/        → 8 primitivas de movimento (Framer Motion)
│   ├── components/ui/            → 48 componentes shadcn/ui (New York)
│   ├── hooks/                    → use-toast, use-mobile
│   └── lib/                      → enrich/ (research A–E, news, ai, engine, tech-states), resolve/ (binding + index), export-guard, csv/cnpj/extract/clipboard…
├── prisma/schema.prisma          ← modelo de dados (SQLite)
├── db/                           ← criado no primeiro db:push (NÃO vai no kit sanitizado)
├── mini-services/resolve-service/← serviço Bun de resolução pesada de identidade
├── public/logos/                 ← 17 logos do portfólio + logo institucional
├── docs/                         ← 6 documentos de referência (índice na §3)
├── scripts/                      ← boot-dev.sh, build-zip.sh, testes golden (resolver/Petrobras)
├── evidencias/                   ← (só no ambiente de dev — NÃO vai no kit sanitizado público)
├── evidencias-uso/               ← mídia CURADA de uso real (screenshots + vídeos + MANIFESTO.md) — vai no kit p/ avaliação autocontida
└── package.json · tsconfig.json · next.config.ts · tailwind/postcss · components.json · Caddyfile
```

## 2. Como rodar

```bash
cp .env.example .env        # v0.11.0: cria o ambiente (DATABASE_URL) — SEM isto o
                            # db:push falha com "Environment variable not found"
bun install                 # ou npm install
bun run db:push             # sincroniza o schema Prisma (SQLite)
bun run dev                 # http://localhost:3000
```

Fluxo mínimo para ver tudo vivo:
1. Cole uma lista de CNPJs (ou importe um CSV com coluna CNPJ) na tela inicial;
2. Confira a prévia (delimitador/encoding detectados) e confirme;
3. Clique em **"Iniciar agora"** — confirmar NÃO processa sozinho (intenção humana é lei);
4. Abra a **ficha única** de uma conta (v0.10.13: sem abas Dossiê/Dados/Evidências —
   sete seções numeradas, identidade primeiro): identidade, dados públicos, contatos,
   teia societária (QSA), matriz/filiais/relações, análise comercial quando existir,
   lacunas e fontes — o produto NÃO gera score N/100 nem faturamento estimado;
   "não sabemos" é estado legítimo;
5. Quer a leitura profunda? Clique em **"Pesquisa profunda"** na ficha — o motor investiga
   por etapas (identidade → RI → tecnologia → compras → notícias); se a cota de busca
   recusar alguma consulta, o pacote vem marcado **PESQUISA INCOMPLETA** e re-executar
   depois de a cota restaurar coleta DE NOVO (não reusa coleta furada);
6. Exporte pelo botão **"Exportar"** (v0.10.15: UMA experiência com duas decisões —
   **o que exportar** (todas / sem revisão pendente / somente revisão / selecionadas) ×
   **em que formato** (Excel .xlsx com 6 abas, PDF compacto do lote, CSV); os formatos
   técnicos (JSON/JSONL/TRIAGEM/PLANO) ficam em "Opções técnicas" recolhidas; na ficha
   individual há a ação discreta **"Baixar ficha em PDF"**; nenhum formato reconsulta
   fontes nem executa IA — o arquivo carrega exatamente o que a tela mostra,
   com contatos inválidos bloqueados e a seleção completa sem corte.

## 2a. Acesso protegido (opcional)

O kit roda aberto em máquina local. Para expor em rede/deploy:

```bash
SCOUT_EXPORT_TOKEN=seu-token bun run dev   # modo TOKEN: leitura e escrita exigem sessão
# ou, sem definir token: SCOUT_AUTH_REQUIRED=1 (gera e salva token em db/.scout-token)
```

No modo TOKEN, a aplicação mostra o selo "Acesso restrito" e pede o token UMA vez —
a sessão fica em cookie httpOnly assinado (o token nunca vai para o código do cliente).
Chamadas diretas (curl/CLI) usam o header `x-export-token: $SCOUT_EXPORT_TOKEN`.

## 3. Índice da documentação (`docs/`)

| Documento | O que detalha |
|-----------|---------------|
| `DESIGN-SPEC.md` | Tokens (cor/vidro/aurora/tipografia/formas), princípios anti-slop, layout, voz de conteúdo, motor de dados, arquitetura |
| `MOTION-SPEC.md` | **Sistema de movimento completo**: 3 leis, tokens de mola, 8 primitivas, 6 keyframes CSS, micro-interações (150/200ms), acessibilidade em duas camadas, 10 regras de ouro |
| `COMPONENT-CATALOG.md` | Catálogo dos 50+ sub-componentes, props, estados e convenções transversais |
| `INTEL-SPEC.md` | Motor de enriquecimento, proveniência de fontes, auditoria, exportações — **as seções de score 0–100 e faturamento por faixa são HISTÓRICAS (módulos removidos)** |
| `API-SPEC.md` | As 17 rotas: métodos, contratos, estados retryable, convenções de erro |
| `QA-GALLERY.md` | Índice das evidências visuais + cenários E2E cobertos |

## 4. Stack

Next.js 16 (App Router) · TypeScript 5 · Tailwind CSS 4 · shadcn/ui (New York) ·
Framer Motion · Lucide · Prisma + SQLite · Bun · serviço de resolução em Bun (mini-services).

## 5. Garantias do produto (contrato)

1. **Evidência citável ou nada** — porte real e identidade sempre com fonte; "não sabemos" é estado legítimo. **Sem score numérico e sem faturamento inventado** (módulos removidos no v0.6.x).
2. **Vínculo comprovado ou descarte auditado** — candidato só entra com 1 evidência FORTE ou 2 MODERADAS independentes (`ENTITY_BINDING`); o dono da página nunca vira candidato; UNRESOLVED honesto > falso positivo.
3. **Auditoria total** — cada evento do motor grava trilha exportável (.jsonl).
4. **Recuperação sem duplicar custo** — lease durável em banco (owner + expiração + heartbeat): worker vivo nunca é tomado como órfão; coleta recusada por cota não é reusada como se fosse completa.
5. **Fronteira de acesso real** — modo TOKEN protege leitura e escrita com sessão httpOnly server-side; o segredo nunca vai ao código do cliente.
6. **Movimento com respeito** — `prefers-reduced-motion` desliga tudo (CSS + Framer).
7. **Copiar funciona de verdade** — fallback para contextos HTTP.
8. **Ficha cadastral honesta (v0.10.0, endurecida v0.10.1)** — CNPJ alfanumérico (IN RFB 2229/2024) suportado ponta a ponta COM LETRAS NAS 12 PRIMEIRAS posições — inclusive a raiz (exemplos oficiais 00.000.000/E08G-12 e 12.ABC.345/01DE-35, este com DV 35 reproduzido pela tabela RFB); reuso de cadastro só DENTRO da validade (ficha por CNPJ, TTL 30 dias), com data de COLETA ORIGINAL separada da data de reuso e proveniência de complementações PRESERVADA no reuso ("Complementado por" não renasce vazio); fontes complementares são consultadas SÓ quando falta campo relevante, com portão de capacidade (nunca caminha atrás de campo que ninguém tem — economia MEDIDA, sem claim); QSA/CNAEs truncados por teto de segurança são declarados como listas incompletas; fonte em backoff pós-429 é pulada, nunca martelada; "Revalidar consulta" que falha (HTTP/timeout/429) RESTAURA a ficha anterior e responde erro — nunca destrói o último cadastro válido nem dispara "Ficha revalidada".
9. **Temporalidade fiscal no dossiê (v0.10.2, GERAL desde a v0.10.3, semântica de temporalidade v0.10.4)** — NENHUM campo do dossiê (síntese, perfil, quem é, operação, escala, aderência, hipóteses…) transforma informação fiscal histórica em situação atual confirmada: regime tributário de fonte agregadora é apresentado POR EXERCÍCIO ("Uma fonte agregadora registra X para o exercício de Y; o regime vigente não foi confirmado"), porte citado é PORTE CADASTRAL (e porte que CONTRADIZ o registro é neutralizado, nunca atribuído ao cadastro), abertura cadastral ≠ fundação efetiva, capital social ≠ faturamento, sócio-administrador ≠ decisor comercial. A guarda é uma regra GERAL por frase (sem depender de lista de verbos), reescrita que preserva a gramática, aplicada a TODOS os campos exibidos — instrução "VALIDAR" e citações verbatim de evidência ficam intactas. Regra no prompt + avisos determinísticos no contexto + guarda determinística pós-modelo auditada em telemetria (`AI_GUARD`, rotulada por campo); reuso de dossiê entre lotes só com o MESMO bloco de prompts (portão de versão). **v0.10.4:** ANO ISOLADO NÃO ATRIBUI (um ano não comprova o período — "está no X em 2026" e "desde 2022…atualmente" são corrigidos), fatos independentes da MESMA frase são PRESERVADOS (correção por cláusula/trecho), negativa fiscal cai na mesma neutralização honesta (sem dupla negação) e regime vigente EFETIVAMENTE documentado no cadastro (Simples/MEI = "Sim") fica intacto.
10. **Entrega com banco limpo (v0.10.2, regra permanente; endurecida v0.10.3)** — toda entrega para teste fecha com o banco de desenvolvimento zerado (lotes, linhas, auditoria, telemetria, comparações experimentais e cache cadastral), com backup CONSISTENTE FORA do ZIP e verificação por leitura (`/api/stats` em zero). A limpeza é NO FECHAMENTO da entrega — nunca a cada inicialização e SEM cron: `bun scripts/entrega-banco-limpo.ts` (inventário) → `--confirmar` (backup VACUUM INTO com `integrity_check` + teste de recuperação + limpeza TRANSACIONAL ÚNICA com bloqueio de novas escritas + validação de cache/comparações/uploads/estatísticas + evidência `qa/limpeza-banco-entrega.json` com os SEIS contadores antes/depois). Limpeza sem backup válido é IMPOSSÍVEL. **v0.10.4:** RESULTADO FINAL AGREGADO — PASS somente quando TODAS as validações obrigatórias passam; validação FAIL → "RESULTADO: FAIL" + exit 1; verificação impossível → "RESULTADO: BLOCKED" + exit 1 (nunca sucesso falso); a janela backup→limpeza é protegida por re-leitura dos seis contadores DENTRO do lock (escrita concorrente → ROLLBACK + BLOCKED com nada apagado); testes explícitos de falha de validação, escrita concorrente, rollback e recuperação em sandbox (`scripts/test-fechamento-banco.ts`, 25/25). Se o inventário mostrar algo que não seja dado de teste, a limpeza NÃO deve ser confirmada.
11. **Relações empresariais sem inventar nada (v0.10.5)** — relações societárias e estabelecimentos da mesma raiz vêm SEMPRE de quadros públicos e de confirmação individual pelo registro oficial (nunca IA, nunca inferência): participante com identidade própria (hash da fonte para PF, CNPJ para PJ), matriz APENAS pelo campo oficial `identificador_matriz_filial` (a ordem 0001 nunca prova matriz), estabelecimento baixado/inativo é EXIBIDO como está, participante comum é rotulado como sobreposição de quadro — NUNCA como grupo econômico; homônimos nunca são tratados como a mesma pessoa (identidade = hash da fonte; nomes iguais não provam nada); cobertura de estabelecimentos é SEMPRE rotulada PARCIAL ("estabelecimentos localizados na fonte consultada" — a quantidade total não é afirmada); investigação só sob comando explícito por CNPJ (sem crawler, sem lote, sem recursão), com cache por CNPJ/raiz/participante (TTL 30 dias) que reusa sem duplicar; 429/timeout/indisponibilidade são estados honestos e uma falha NUNCA apaga fato válido; **nenhum CPF (nem mascarado) é persistido ou exportado** e a resposta bruta de pessoas físicas não entra no kit.
12. **Identidade consolidada por raiz (v0.10.6)** — a PESSOA JURÍDICA é a raiz do CNPJ (8 caracteres); o CNPJ completo é um ESTABELECIMENTO dela: cinco filiais da mesma raiz aparecem como UMA empresa com cinco estabelecimentos (nunca cinco empresas), a contagem de quadros societários distingue "X pessoa(s) jurídica(s) · Y estabelecimento(s)", e a sobreposição de participante entre matriz e filial da mesma raiz é classificada como MESMA pessoa jurídica — nunca como "participante comum entre empresas distintas" (participante comum existe só entre RAÍZES distintas e continua NÃO caracterizando grupo econômico).
13. **Triagem determinística de lacunas, sem IA (v0.10.6)** — a seção "O que falta descobrir" classifica PERGUNTAS (nunca a empresa inteira, nunca score comercial) usando exclusivamente fatos já coletados: RESOLVIDO (confirmado por fonte apropriada), COMPLEMENTAR_API (fonte estruturada aplicável ainda não esgotada), PESQUISA_DOCUMENTAL (exige investigação documental, sob demanda), VALIDACAO_HUMANA (ambiguidade/declaração da empresa), INDISPONIVEL (consulta bloqueada por 429/timeout — fatos preservados) e NAO_APLICAVEL (pergunta que não faz sentido para a entidade/atividade). NÃO ENCONTRADO ≠ NÃO PESQUISADO (o motivo registra a diferença); cada lacuna mostra fatos com fonte+data, o que falta, a próxima verificação e por que pode ser útil; regime tributário histórico nunca prova vigência; o painel NUNCA recomenda acionar IA e a exportação do contrato TRIAGEM_V1 (JSON/JSONL, uma entrada por pergunta de uma entidade, validada por esquema) acontece só por ação explícita do usuário, sanitizada (sem CPF, sem hash de PF) e sem nenhum SDK/cliente/modelo/token de consumidor externo.
14. **Indício não é resolução; fechamento e exportação endurecidos (v0.10.7, auditoria)** — vaga/menção de contabilidade ou ERP fica como FATO com proveniência e a lacuna segue ABERTA (VALIDACAO_HUMANA / PESQUISA_DOCUMENTAL — nunca RESOLVIDO); o estado de UMA filial (baixada/suspensa/inapta) não encerra perguntas da pessoa jurídica — só a matriz baixada ou a evidência conhecida da raiz provando todas as unidades encerradas o fazem (regra determinística, zero HTTP); a rotina de entrega com banco limpo cobre as NOVE tabelas (incl. os 3 caches societários) e PASS exige as NOVE zeradas, inclusive com banco já vazio; a exportação TRIAGEM_V1 leva SÓ síntese determinística de sinais (texto livre nunca sai da VM; no caminho inesperado, nome de PF/e-mail/telefone são suprimidos e fato com nome residual não exporta), evidências/fontes/bloqueios são POR PERGUNTA e os exemplos de QA são rótulados como massa sintética; indicadores do lote contam PESSOAS JURÍDICAS distintas pela raiz e matrizes distintas (linhas continuam visíveis como hint).
15. **Fontes invisíveis com proveniência preservada (v0.10.8, coerência)** — a experiência comercial fala a língua do vendedor: nenhum provedor, API, endpoint, modelo ou código HTTP aparece na ficha, resultados, filtros, mensagens de erro, indicadores, triagem ou fluxos de investigação — a camada única de apresentação (`src/lib/fontes-apresentacao.ts`) traduz provedores para categorias de finalidade ("Cadastro empresarial", "Matriz e filiais", "Relações empresariais", "Pesquisa pública"…), que descrevem a finalidade da consulta e NUNCA prometem fonte oficial direta nem dado confirmado. A simplificação é VISUAL: provedor efetivo, URL, data, resultado, cache e falha permanecem preservados e auditáveis — a aba Evidências exibe a categoria com a origem técnica sob demanda, e as exportações técnicas/JSONL e a telemetria continuam intactas. Estados são coerentes: lote confirmado exibe "Aguardando início" (sem animação, nada consulta antes do comando explícito), e a confirmação gera ZERO consultas externas. Exceção isolada: o Laboratório de Modelos, onde a escolha de provedor/Model ID exige identificação.
16. **Plano proposto, nunca executado sozinho; limite com reserva atômica (v0.10.9, evolução e estresse)** — o planejador de consultas (PLANO_CONSULTAS_V1) consolida as lacunas COMPLEMENTAR_API da triagem em um plano ORDENADO com o custo CONTADO do cache local visível ANTES de aprovar: só aprovação explícita por item executa — e chama o MESMO comando da ficha (nenhum executor novo), 1 consulta por vez com teto por rodada, regenerando o plano depois; perguntas que não são de fonte estruturada (documental/humana/indisponível) NUNCA viram consulta e aparecem por transparência; expandir conexão é 1 comando POR participante, nunca em lote; hash/nome de PF nunca saem no artefato. Gerar/abrir o plano é leitura pura (telemetria prova: zero consulta ao abrir). O limitador de chamadas reserva a vaga ATOMICAMENTE (fila FIFO + decisão síncrona): concorrência e RPM são respeitados em TODA janela deslizante mesmo sob rajada (provado antes/depois em estresse), e quem espera permanece na fila — ninguém entra em bloco na virada da janela.
