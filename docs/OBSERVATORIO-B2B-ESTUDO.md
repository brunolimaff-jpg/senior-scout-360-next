# Observatório B2B — Estudo de viabilidade (v0.11.1, Gate 5)

**Status:** estudo. Nada deste documento foi implementado como coleta ou como produto.
**Autoria:** Z.ai (executor único da missão de consolidação), a pedido do Planejador.
**Regra base:** este estudo NÃO autoriza construir uma base nacional nem iniciar coleta massiva.
**Objetivo:** dizer, campo a campo, o que o Scout JÁ RECEBE hoje pode sustentar de inteligência agregada, o que falta, e qual seria o menor piloto honesto.

---

## 1. O que o Observatório é (e o que não é)

O Observatório B2B é a evolução proposta por Bruno: inteligência AGREGADA sobre empresas, pessoas, territórios, setores e sinais comerciais — sobreposição de leitura sobre os dados que o Scout já coleta sob comando, nunca um novo crawler.

| É | Não é |
|---|---|
| Leitura agregada dos lotes que o operador já trouxe | Base nacional de CNPJs |
| Contagens por território/atividade/idade com cobertura explícita | Coleta em massa ou varredura automática de fontes |
| Sinais operacionais para pautar perguntas comerciais | Pontuação individual demográfica (score por pessoa) |
| Amostra honesta: "isto vale para o que foi coletado, N para o total do Brasil" | Inferência de demanda de produto por idade de pessoa, CNAE ou nº de estabelecimentos |

---

## 2. Inventário campo a campo — o que chega ao Scout hoje

Verificado no código real (v0.11.1): `src/lib/enrich/sources.ts`, `cadastro-cache.ts`, `ibge.ts`, `rdap.ts`, `relations/grafo.ts`, `prisma/schema.prisma`.

| Campo | Fonte original | API/rota no Scout | Transformação | Armazenamento | Cobertura real | Período | Limitações |
|---|---|---|---|---|---|---|---|
| Data de abertura da empresa | Cadastro oficial (BrasilAPI/opencnpj/ReceitaWS) | `enrich/sources.ts` → `ImportRow.openingDate` | ISO→string BR | `ImportRow.openingDate` | Alta para CNPJ identificado; 0 para não resolvidos | Momento da coleta (TTL 30 d) | Só empresas já coletadas pelo operador (amostra, não base) |
| Idade APARENTE da empresa | Derivada de `openingDate` | calculável no app | `hoje − abertura` em anos | (calculada na leitura) | Igual à abertura | — | Faixa etária da EMPRESA, nunca da pessoa |
| Qualificação do sócio (papel) | QSA público | `parseQsa()` → `sociosJson` | nome/qual/entrada normalizados | `ImportRow.sociosJson`, caches de relações | Alta onde há QSA | coleta | Associação nominal (guarda de homônimo já implementada); papel ≠ decisão de compra |
| Data de ENTRADA na sociedade | QSA público | `sociosJson.entrada` | ISO truncada | idem | Alta onde há QSA | coleta | Data de vínculo, NÃO nascimento |
| **Faixa etária de sócios** | **NÃO DISPONÍVEL** | — | — | — | **Zero** | — | **Nenhuma fonte atual traz nascimento. A Receita não publica data de nascimento no QSA aberto. Conclusão: análises por faixa etária de pessoas NÃO são sustentáveis com os dados que chegam ao Scout. Qualquer versão disso exigiria outra fonte (com custo/legal) e decisão do Planejador.** |
| Território (município/UF) | Cadastro | `municipality/uf` | normalizado | `ImportRow` | Alta | coleta | É o município da SEDE CONSULTADA (matriz/filial), não a rede toda |
| Atividade (CNAE) | Cadastro | `cnaeDescricao/cnaeCodigo` | texto + código | `ImportRow` | Alta | coleta | CNAE principal declarado; secundários só quando coletados |
| Estabelecimentos da raiz | FRENTE B (grafo QSA + confirmação oficial) | `matriz-filiais` | teto 10 participantes/20 confirmações por rodada | `EstabelecimentoRootCache` | PARCIAL por design (rotulada) | coleta | Nunca inferir porte por nº de unidades sem cobertura total |
| Redes empresariais | FRENTE A (MinhaReceita Grafo) | `relacoes-societarias` | raiz=empresa; CNPJ=estabelecimento | `RelacaoSocietariaCache` + `QuadroParticipanteCache` | 1 hop sob comando | coleta (TTL 30 d) | Nunca chamar de grupo econômico (participante comum ≠ grupo) |
| População do município | IBGE agregados 6579/9324 | `ibge.ts` | nº formatado pt-BR | `extraJson` | Boa para municípios BR | ano do agregado (ex.: 2024) | Contexto geográfico — P1-01: não é escala da conta |
| Região imediata | IBGE | `ibge.ts` | texto | `extraJson` | Boa | idem | idem |
| Sinais de porte | Fontes públicas (atribuição v0.9.1) | `research` | frases + fonte atribuída | `researchJson` | Média (varia por domínio) | coleta | Sempre hipótese com fonte; nunca faturamento inventado |
| Tecnologia/sistemas | Pesquisa profunda do site | `aiDossier.tecnologia` | estados tipados (TECH_STATES) | `aiDossierJson` | Baixa-média (depende do site) | coleta | Melhor sinal operacional disponível hoje para ERP/HCM — ainda assim é INDÍCIO |
| RAIS / vínculos CLT | **NÃO COLETADA** | — | — | — | Zero | — | Fonte oficial existe (Painel Estatístico/RAIS agregado por município-CNAE). ADOÇÃO FUTURA só agregada (nunca vínculo individual); decisão do Planejador |

**Conclusão do inventário:** a única "demografia" sustentável hoje é da EMPRESA (idade por abertura, porte, capital). Sobre PESSOAS, o Scout só tem papel e data de vínculo — e é isso que deve continuar.

---

## 3. Análises AGREGADAS viáveis com os dados atuais

Todas contadas sobre o universo COLETADO (amostra), com cobertura explícita em cada número.

1. **Idade das empresas por faixa**: "< 5 anos", "5–10", "10–20", "20+" — derivada de `openingDate`; fatia sem abertura fica fora com contagem própria ("sem dado").
2. **Empresas e estabelecimentos por território**: município/UF do lote; raízes distintas ≠ estabelecimentos (regra já implementada); região imediata do IBGE como agrupador.
3. **Empresas por atividade (CNAE)**: distribuição por setor (a UI já tem cnaeDist por lote — o Observatório cruza lotes).
4. **Redes comprovadas**: nº de raízes conectadas por participantes comuns (fato de quadro público, com a ressalva de nunca-grupo-econômico).
5. **Sinais operacionais**: contagem de estados tecnológicos (ex.: "X contas com sinal de ERP próprio", "Y sem sinal") para pautar PERGUNTAS comerciais de ERP/HCM/logística/agro — nunca promessa.
6. **Cobertura e ausência**: para CADA número, o denominador ("de 1.200 entradas coletadas, 940 com cadastro completo") — ausência de dado é um número do Observatório, nunca um zero silencioso.

## 4. O que NÃO fazer (governança)

- Não reconstruir CPF, não deduzir idade exata de pessoa, não criar score demográfico individual.
- Não chamar empresa de "principal" por nº de unidades.
- Não somar estabelecimentos com empresas.
- Não inferir demanda de produto de CNAE/idade isoladamente — sinais servem para PERGUNTAR melhor.
- LGPD: o Observatório opera só com dados de pessoa jurídica e papéis públicos; nada de dado pessoal sensível.

---

## 5. Proposta de experiência (quando aprovada)

Uma visão **"Panorama agregado"** no nível do OPERADOR (acima dos lotes), com três blocos:

```
PANORAMA AGREGADO (amostra: N entradas coletadas em M lotes)
├─ Territórios: top UFs/municípios com N empresas e E estabelecimentos (raízes distintas)
├─ Idade das empresas: 4 faixas + "sem dado" (barra simples, cobertura visível)
├─ Atividades: top setores CNAE com contagem de empresas (não linhas)
└─ Sinais: tecnologia/porte com fonte atribuída — "o que vale perguntar na próxima conversa"
```

Regras de interface herdadas da ficha: número com denominador; cor com significado (teal=comprovado, âmbar=sinal); nada executa consulta externa (leitura dos dados já coletados).

## 6. Contratos de dados propostos (interfaces, não implementação)

```ts
interface PanoramaAgregadoView {
  amostra: { lotes: number; entradas: number; entradasComCadastro: number };
  territorios: { uf: string; municipio: string; empresasDistintas: number; estabelecimentos: number }[];
  idadeEmpresas: { faixa: "<5" | "5-10" | "10-20" | "20+" | "sem-dado"; empresas: number }[];
  atividades: { setor: string; empresasDistintas: number }[];
  sinaisOperacionais: { sinal: string; contas: number; fonte: "research" | "tech-states";Natureza: "sinal" }[];
  coberturas: { dim: string; preenchidas: number; total: number }[];
}
```

(Regras: contagem por RAIZ distinta; "sem-dado" é sempre uma faixa; nenhum campo individual de pessoa.)

## 7. Exemplo sintético (fixação de contrato)

```json
{
  "amostra": { "lotes": 3, "entradas": 128, "entradasComCadastro": 111 },
  "territorios": [
    { "uf": "SC", "municipio": "Joinville", "empresasDistintas": 18, "estabelecimentos": 24 },
    { "uf": "DF", "municipio": "Brasília", "empresasDistintas": 9, "estabelecimentos": 11 }
  ],
  "idadeEmpresas": [
    { "faixa": "<5", "empresas": 14 },
    { "faixa": "5-10", "empresas": 27 },
    { "faixa": "10-20", "empresas": 38 },
    { "faixa": "20+", "empresas": 26 },
    { "faixa": "sem-dado", "empresas": 6 }
  ],
  "atividades": [
    { "setor": "Comércio atacadista", "empresasDistintas": 31 },
    { "setor": "Transporte rodoviário", "empresasDistintas": 19 }
  ],
  "sinaisOperacionais": [
    { "sinal": "ERP próprio identificado", "contas": 7, "fonte": "tech-states", "natureza": "sinal" },
    { "sinal": "Sinal de gestão de frotas", "contas": 4, "fonte": "research", "natureza": "sinal" }
  ],
  "coberturas": [
    { "dim": "abertura", "preenchidas": 105, "total": 111 },
    { "dim": "regime tributário", "preenchidas": 41, "total": 111 }
  ]
}
```

## 8. Menor piloto recomendado

**Piloto A (recomendado)**: "Panorama do que já está coletado" — leitura agregada ONLY do banco local (sem 1 linha nova de coleta), uma página, 4 blocos do §5, exportável no PDF do lote como página de contexto. Esforço: leitura SQL agregada + 1 componente; zero risco de fonte nova.

**Piloto B (só se A valer)**: cruzar com agregados públicos OFICIAIS já abertos (IBGE município-CNAE; RAIS agregada) para dizer "a amostra do operador representa N% do universo do município" — ainda sem coleta própria, só leitura de API pública agregada (mesma família do `ibge.ts`).

**Piloto C (não recomendado agora)**: qualquer fonte nova por pessoa (idade, CPF, vínculos CLT individuais) — exige decisão legal/comercial do Planejador e não passa pelo contrato atual.

## 9. Campos que o Planejador precisa decidir antes de qualquer implementação

1. Abrir mão de "faixa etária de sócios" (não existe nos dados atuais) ou aprovar investigação de fonte nova com custo/legal.
2. RAIS: só agregado municipal-CNAE (Piloto B) ou nada.
3. Períodos: o Observatório lê o "estado atual coletado" (sem série histórica — o Scout não guarda histórico temporal de campos).
4. Escopo do denominador: por operador (todos os lotes) ou por seleção.

---

*Fim do estudo. Nenhuma funcionalidade do Observatório foi implementada nesta missão.*
