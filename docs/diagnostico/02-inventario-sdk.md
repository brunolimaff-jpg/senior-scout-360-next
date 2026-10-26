# 02 — Inventário do z-ai-web-dev-sdk nesta VM (o que existe × o que foi acessível × o que é grátis)

Data: 2026-10-20 · SDK `z-ai-web-dev-sdk ^0.0.18` (`package.json`) · integração do Scout: mini-service bun :3030 (estável, health OK)

## Capacidades existentes no SDK (documentação da lib)

| capacidade | uso no Scout hoje | status nesta missão |
|---|---|---|
| `chat.completions.create` (LLM) | leitura rápida de lote + síntese de dossiê (via `/scout-chat`) | **429 imediato** (2 janelas) |
| `functions.invoke("web_search")` | buscas do pacote de pesquisa (via `/web-search`) | **429 imediato** (2 janelas) |
| `functions.invoke("page_reader")` | leitura de páginas/RI/portais (via `/page-reader`) | **429 imediato** (2 janelas) |
| visão / TTS / ASR / imagem / vídeo (documentadas na lib) | não usadas | não sondadas (sem cota e sem prioridade p/ o produto) |

## Chamadas mínimas executadas (conteúdo público; 2 tentativas espaçadas ~10 min; sem força bruta)

```
chat (default)          → 429 {"error":"Too many requests, please try again later"} em 29–35ms
chat (glm-5.3-flash)    → 429 em 8ms
web_search (num=3)      → 429 em 9ms
page_reader (example.com) → 429 em 8–9ms
```

Sem header `Retry-After`. A rejeição ocorre **no gateway da plataforma, antes de qualquer fila local** — o limiter local (10/min) nem chega a ser o fator quando a cota está esgotada.

## O que NÃO é possível afirmar (e por quê)

- **Cota/gratuidade**: nenhum endpoint do SDK expõe saldo/cota; a palavra "grátis" não aparece em resposta observável. Não inventar limites.
- **Modelo efetivo e fallback**: já provado em dados históricos (`glm-5.3-flash` solicitado → `glm-4-plus` efetivo, registrado em auditoria), mas o shape de `usage` do gateway não pôde ser confirmado ao vivo nesta janela (429).
- **Multimídia incluída no plano**: biblioteca expõe; disponibilidade/custo na VM é indeterminado nesta janela.

## Fato de código independente do gateway (verificado estaticamente e por dados persistidos)

- O `resolve-service` devolve `tokens:{prompt,completion,total}` (`index.ts:169-175`) e o consumidor lê `tokens.{prompt_tokens,...}` (`ai.ts:86,98-100`) → **toda telemetria de tokens vira `null`**; 56 eventos `AI_OK` auditados, **0 com tokens não-nulos**.
- Mesmo com o gateway operando, o Scout **não conseguiria demonstrar custo por conta** até esse key-mismatch ser corrigido.

## Integração interna (estável)

- Next → `http://127.0.0.1:3030` (POST `/web-search`, `/page-reader`, `/scout-chat`), timeouts 25s (web) / até 240s (chat profundo), RPM local 10/min por serviço com espera por slot até 24s e backoff em 429 — comportamento coerente com a VM de 2 vCPU/4GB.
- A ponte existe porque o SDK **dentro do processo Next derruba o servidor** (registro histórico do projeto); não remover a isolação.
