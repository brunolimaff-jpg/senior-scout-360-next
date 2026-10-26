# Scout 360 — Proposta P4: Planejador de consultas por API a partir das lacunas TRIAGEM_V1

Status: **IMPLEMENTADO na v0.10.9** (despacho "missão intensiva de evolução e
estresse") — contrato `PLANO_CONSULTAS_V1` em `src/lib/plano/contrato.ts`, gerador
em `src/lib/plano/planner.ts`, rota `GET /api/imports/:id/plano` e seção
"Plano de consultas — proposto (nada executa sozinho)" na ficha do lote.
Suíte: `scripts/test-v0109-evolucao.ts` (43/43). Nada do desenhado abaixo mudou:
sem execução automática, sem executor novo, sem IA.
Versão do app de referência: ~~v0.10.7~~ → v0.10.9.
Origem: despacho do operador — "Depois dos gates, preparar somente a proposta do
próximo recurso: planejador de consultas por API a partir das lacunas TRIAGEM_V1,
sem execução automática."

## 0. Princípios (inalterados e duros)

- **Nenhuma consulta acontece sem comando explícito do operador** — o planejador
  PROPUÕE um plano; o operador APROVA; o executor (que já existe, por fonte)
  roda sob comando, um passo por vez, com teto por rodada.
- **Zero IA** no planejador: a decisão "qual pergunta ainda cabe em fonte
  estruturada" é determinística — ela já existe, é o estado `COMPLEMENTAR_API`
  da triagem (v0.10.6/0.10.7). O planejador apenas ORGANIZA esses estados em
  um plano consultável.
- **A unidade é a lacuna, não a empresa** — coerente com TRIAGEM_V1: cada item
  do plano endereça UMA pergunta de UMA entidade (`cnpj_completo`/`cnpj_raiz` +
  `pergunta_id`).
- **Não confundir** "não encontrado" com "não consultado": o planejador só
  planeja o que a triagem marcou como COMPLEMENTAR_API (fonte aplicável ainda
  não esgotada). VALIDACAO_HUMANA e PESQUISA_DOCUMENTAL NUNCA geram consulta
  de API — aparecem no plano como "fora do alcance de API" (transparência,
  não ação).
- Sem cron, sem fila externa, sem Redis; SQLite (single writer) e teto por
  rodada, idêntico ao padrão A1/B1 (v0.10.5).

## 1. O que o planejador é

Uma tela + um artefato versionado (`PLANO_CONSULTAS_V1`) que consolida as
lacunas `COMPLEMENTAR_API` do lote em um plano ORDENADO de consultas
candidatas, com custo conhecido ANTES de executar:

```
TRIAGEM_V1 (estado por lacuna)
      │  filtro determinístico: estado === COMPLEMENTAR_API
      ▼
PLANO_CONSULTAS_V1 (proposta — nada executa)
      │  aprovação EXPLÍCITA por item ou por lote (mesma UI dos comandos atuais)
      ▼
executor existente (Investigar relações / Investigar estabelecimentos / Revalidar ficha)
      │  1 comando = 1 consulta real, teto por rodada, telemetria e cache como hoje
      ▼
nova triagem da lacuna (o estado muda SOZINHO conforme a evidência: v0.10.7 garante
que indício nunca vira resolução)
```

## 2. Fonte dos dados (tudo já existe)

| Insumo | De onde vem | Custo |
| --- | --- | --- |
| Lacunas `COMPLEMENTAR_API` | `GET /api/imports/:id/triagem` (rota de leitura, zero HTTP externo) | 0 |
| Fonte candidata por pergunta | catálogo `PERGUNTAS_TRIAGEM` + `proximaVerificacao` (motor de triagem) | 0 |
| Bloqueios recentes (429/timeout) | `bloqueios` da entrada TRIAGEM_V1 + telemetria da fonte | 0 |
| Cache válido (reuso sem repetir) | `RelacaoSocietariaCache` / `EstabelecimentoRootCache` / `CadastroCache` + TTL | 0 |
| Custo da consulta | contagem de chamadas que o executor FARIA (1 consulta por CNPJ/quadro, como hoje) | 0 |

## 3. Contrato proposto — `PLANO_CONSULTAS_V1` (esboço)

Mesmo espírito do TRIAGEM_V1: neutro, versionado, validado por esquema, sem
nenhum SDK/endpoint/token do consumidor externo. Exportação só por ação explícita.

```jsonc
{
  "versao_contrato": "PLANO_CONSULTAS_V1",
  "geradoEm": "…",
  "lote": "…",
  "itens": [
    {
      "cnpj_completo": "08044783000117",
      "cnpj_raiz": "08044783",
      "pergunta_id": "estabelecimentos",
      "estado_triagem_origem": "COMPLEMENTAR_API",
      "fonte_candidata": "MinhaReceita Grafo — quadros de participantes",
      "chamadas_estimadas": 2,            // contadas, nunca estimadas a dedo
      "cache_reutilizavel": true,          // TTL vigente → 0 chamadas
      "bloqueios_ativos": [],              // 429/timeout recente adia o item
      "comando_executor": "investigar_estabelecimentos_raiz",  // comando JÁ EXISTENTE
      "o_que_resolve": "Localizar e confirmar estabelecimentos da raiz (cobertura parcial declarada)",
      "o_que_nao_resolve": "Não comprova operação atual; cobertura é parcial por desenho da fonte"
    }
  ],
  "fora_do_escopo_api": [
    // VALIDACAO_HUMANA / PESQUISA_DOCUMENTAL listados por transparência —
    // NUNCA viram item de consulta
  ]
}
```

Regras de ordenação do plano (determinísticas): (1) itens com cache válido
primeiro (custo 0); (2) depois por fonte (agrupa consultas na mesma fonte para
respeitar backoff); (3) itens bloqueados por 429/timeout vão para o fim com o
bloqueio declarado — executá-los primeiro seria martelar a fonte.

## 4. UI proposta (retrabalho mínimo)

Nova seção discreta na ficha do LOTE (não na ficha por empresa):
**"Plano de consultas — proposto (nada executa sozinho)"**:

- contagem por fonte + chamadas estimadas (somatório);
- por item: pergunta, entidade, fonte candidata, custo, bloqueio;
- ação por item e ação "aprovar tudo que custa 0" (itens de cache);
- o botão de aprovação chama o MESMO endpoint de comando que hoje atende os
  botões "Investigar relações societárias" / "Investigar estabelecimentos da
  raiz" / "Revalidar ficha" — nenhum executor novo;
- após cada comando aprovado, a triagem da lacuna é recalculada (já acontece
  hoje a cada abertura do painel) e o plano é regenerado.

## 5. Testes previstos (mesmo padrão da rodada v0.10.7)

1. Plano contém SÓ lacunas COMPLEMENTAR_API (VALIDACAO_HUMANA/PESQUISA_DOCUMENTAL/
   INDISPONIVEL/RESOLVIDO/NAO_APLICAVEL nunca geram item de consulta).
2. Cache válido → item com `chamadas_estimadas: 0` e `cache_reutilizavel: true`.
3. Bloqueio 429 recente → item adiado com bloqueio declarado.
4. Aprovação de 1 item executa EXATAMENTE o comando existente (1 consulta,
   teto respeitado) e a triagem recalculada reflete o novo estado.
5. Nada executa sem aprovação: gerar o plano não cria nenhum evento de rede
   (telemetria da janela com IA 0 / WEB_SEARCH 0 / consultas 0 até a aprovação).
6. Exportação PLANO_CONSULTAS_V1 validada por esquema, sem dados de PF.

## 6. Não-objetivos (explícitos)

- NÃO cria endpoint novo para fontes externas; NÃO executa nada automaticamente
  (nem "só uma consulta de aquecimento"); NÃO adiciona estados ao catálogo da
  triagem; NÃO pontua/ranqueia empresas (sem score comercial); NÃO consome o
  avaliador externo (Jev permanece fora da VM — o plano é só MAIS UM artefato
  neutro que ele poderá ler, no mesmo regime do TRIAGEM_V1).

## 7. Ganho esperado (medido, não prometido)

A rodada v0.10.7 já mede por lacuna o que foi resolvido sem IA e o que segue
aberto. O planejador completa o ciclo que o operador desenhou: **"Já resolvi
esta pergunta, esta outra exige apenas mais uma consulta e esta última precisa
de validação"** — a economia de IA deixa de ser estimada e passa a ser a
consequência natural de esgotar fontes estruturadas baratas primeiro, com o
custo de cada consulta visível antes de aprová-la.
