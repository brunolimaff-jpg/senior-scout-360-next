# 01 — Ambiente e capacidade real da VM (medido em 2026-10-20)

Método: comandos de leitura locais (`nproc`, `/proc/meminfo`, `df`, `ulimit`, `ss`, `ps`), sondas HTTP mínimas, ZERO alteração de configuração.

## Hardware e limites

| item | valor medido |
|---|---|
| CPU | 2 vCPU, x86_64 |
| RAM | 4,0 GB total · **2,1 GB disponível** no momento |
| Disco raiz | 9,9 GB · 2,9 GB usados · **6,5 GB livres** |
| Projeto | 2,5 GB (dominado por node_modules) |
| `nofile` | 1024 (teto de sockets/arquivos por processo — relevante p/ concorrência de fetch) |
| `nproc` (usuário) | 100000 |
| SO | Debian 13 (trixie) |
| Runtimes | Bun 1.3.14 · Node v24.21.0 · SQLite via `bun:sqlite` + Prisma |

## Processos e portas (sessão da missão)

| porta | serviço | observação |
|---|---|---|
| 3000 | `next-server` v16.1.3 (`bun run dev`) | **~1,25 GB RSS (30,3% da RAM)** — maior consumidor; impacto direto na margem p/ carga 5k |
| 3030 | resolve-service (`bun --hot` + supervisor `dev:resiliente` que reinicia em ~1s) | uptime 11.851s na checagem; health `{"ok":true}` |
| 81 | caddy (gateway interno da plataforma) | reescreve `?XTransformPort=` |
| 12600/19001/19005/19006 | infraestrutura da plataforma | fora do escopo do app |

Total de processos na VM: ~20.

## Persistência

- **Arquivos**: projeto em `/home/z/my-project` persiste na sessão da VM (inclui `db/custom.db`, worklog, ZIPs em `public/`).
- **Caches de processo** (perdem-se quando o processo reinicia): IBGE em memória (`ibge.ts:28-30`), limiters em `globalThis` (`ai.ts:144-146`, `resolve-service`), caches de resolução em memória. O supervisor do resolve-service reinicia o bun em ~1s — os buckets de RPM zeram a cada crash (comportamento observado no projeto, não um risco novo).
- **Restart da VM**: não acionável de dentro da sandbox; não testado. Não afirmar durabilidade além da sessão.

## Rede

- Internet pública alcançável: 10/10 sondas a fontes públicas retornaram 200 (BrasilAPI, OpenCNPJ ×2, MinhaReceita, ReceitaWS, IBGE ×2, Google News RSS, CVM, PNCP — 422 inicial por formato de data, corrigido).
- Gateway z-ai (via SDK): 4/4 capacidades com **429 imediato (<35 ms)** nas 2 janelas testadas — ver `02-inventario-sdk.md`.

## Leitura para planejamento

1. A camada determinística (parse/validação/SQLite) é desprezível em custo na VM: 5k linhas = ~0,4 s e 113 MB RSS num processo isolado.
2. O gargalo de escala é (a) memória do `next-server` já em ~1,25 GB e (b) cotas — locais (10/min por serviço) e do gateway.
3. `nofile=1024` desaconselha concorrência agressiva de fetch sem medição; a configuração atual (concorrência IA 2, RPM 10) é coerente com o ambiente.
