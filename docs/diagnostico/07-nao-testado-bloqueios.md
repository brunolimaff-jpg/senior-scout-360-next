# 07 — O que não foi testado / continua bloqueado (fechamento honesto da missão)

## Bloqueios externos (fora do controle do código)

1. **Gateway z-ai em 429** nas 4 capacidades (chat ×2, web_search, page_reader), 2 janelas com ~10 min de intervalo, <35 ms, sem Retry-After. Consequências:
   - tokens observados ao vivo: não coletados;
   - braço "IA ON" fresco do A/B: não executado;
   - deep research fresco nos 6 golden cases (Lar, Jotabasso, Brasil Digital, Escola Paranaense, Sementes Carolina, Madeireira São José): não executado — é a pendência nº 1 herdada do handoff e permanece.
2. **Restart da VM**: não acionável de dentro; durabilidade além da sessão não afirmada.

## Pendências técnicas medidas e não corrigidas (por design desta missão)

- P0-A CSV multicoluna (4/5 descartadas no E1) — proposta nº 2.
- P0-B telemetria de tokens (0/56) — proposta nº 1.
- P0-C IA ON por default — proposta nº 3.
- P1-E/F S.A.→LISTADA e domínio fraco — propostas nº 5/6.
- P1-H teia/QSA truncados — proposta nº 11.
- QA: estado "Aguardando" em descartadas + pista vazia — proposta nº 4.

## Testes que exigem missão própria (com orçamento e monitoramento)

1. **Carga 5k AO VIVO**: worker + 3000 cadeias + lease/recuperação sob estresse; `next-server` já em ~1,25 GB RSS — medir com janela de memória e critério de parada.
2. **A/B completo cadastro×IA** com cota: mesmo Pasta1.csv, IA OFF e ON, colhendo `usage` pós-fix de telemetria.
3. **Golden cases de conteúdo** (G4/G7): 1 run por caso com orçamento explícito e `buscasRecusadasCota` registrado.
4. **Teia completa em caso com QSA grande**.
5. **kitana.opencnpj.com em shadow mode** (A/B de acerto/latência/429/termos antes de entrar na cadeia).

## Riscos abertos

- BrasilAPI: relatos públicos de 429/mitigação em 2026 — a cadeia tem 3 fallbacks, mas nenhum esquema de backoff por fonte além do falhar-e-seguir.
- `nofile=1024` limita concorrência de fetch — manter concorrência conservadora até medir.
- Persistência de caches em memória (IBGE/limiters) reinicia com o processo — custo baixo, documentado.

## Estado do ciclo de auditoria (inalterado por esta missão)

- v0.6.2 = CORRECT_DELTA (G9/G6/G5 provados) — aguarda **3ª auditoria independente**; sem push/merge/deploy.
- Esta missão NÃO alterou código do app; adicionou apenas: `docs/diagnostico/*`, `qa/*`, `scripts/probe-vm-capacity.ts`, `scripts/probe-import-5k.ts`, screenshots 18/19 em `evidencias-uso/`, `scripts/build-zip-diagnostico.sh` e este pacote.
