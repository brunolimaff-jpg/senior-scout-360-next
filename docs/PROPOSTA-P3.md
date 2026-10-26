# Scout 360 — Proposta P3: classificação multissetorial pelo CNAE e ativação condicional de APIs regulatórias

Status: **Parte A IMPLEMENTADA (v0.10.4) · Parte B1 PROVADA (cruzamento) · B2/B3/B4 propostas**.
Versão do app de referência: v0.10.4.

## 0. Princípios (inalterados)

- Pré-enriquecimento SEM IA e SEM custo: cada campo novo nasce de dado estruturado público ou de derivação local determinística.
- Distinção cadastral vs operacional: registro na CVM/ANS comprova VÍNCULO REGULATÓRIO, não faturamento; porte da cidade não é porte da empresa; sócio não é automaticamente decisor técnico.
- **Match por CNPJ COMPLETO** (14 dígitos normalizados) antes de atribuir fatos a uma empresa — nunca match parcial por raiz (8 dígitos), nunca presumir matriz/filial (v0.10.4, despacho do auditor).
- **CNAE/setor é sinal de APLICABILIDADE** (qual base consultar), **nunca prova única de vínculo regulatório** — o vínculo vem do match na base da fonte (v0.10.4).
- Um conector por vez, com teste mínimo ANTES do próximo. Nada de "implementar todos de uma vez".
- Sem cron, sem Redis, sem fila externa: fontes de download (CSV) são carregadas sob demanda no SQLite (carga 1× + SQL local — nunca HTTP por empresa).

## 1. Parte A — Classificação multissetorial pelo CNAE ✅ IMPLEMENTADA (v0.10.4)

**Estado:** implementada e provada — `src/lib/enrich/segmentos.ts` + engine (caminhos cache e coleta
fresca) + telemetria `ETAPA/SEGMENTACAO` + auditoria `setor_cnae` + chip "Setor (CNAE)" nos dados
públicos da ficha. Zero chamada, zero IA — derivação pura sobre a ficha já coletada.

**Fonte dos dados:** a ficha cadastral JÁ coletada (`cnaeCode`, `cnaeDescription`, `cnaesSecundarios`).

**Campos gerados (em `extraJson`):**

| Campo | Conteúdo | Proveniência |
|---|---|---|
| `setorPrimario` | Seção CNAE 2.0 do CNAE principal + divisão (2 dígitos) + subclasse (ex.: `C — Indústrias de transformação (divisão 29, subclasse 2945-0/00)`) | derivado de `cnaeCode` |
| `setoresSecundarios` | Seções DISTINTAS dos CNAEs secundários, excluindo a do principal (ex.: `["A","Q"]`) | derivado de `cnaesSecundarios` |
| `multissetorial` | `true` quando ≥ 2 seções distintas (principal + secundários) | derivado |
| `avisosSetoriais` | CNAE ilegível/fora da tabela; lista truncada — avisos honestos | derivado |

**O que a classificação É (e o que NÃO é):** classificação CADASTRAL do ESTABELECIMENTO consultado
(o CNPJ identifica um estabelecimento da empresa jurídica; matriz e filial têm registros próprios,
cada um com seus CNAEs). Não é perfil de operação, não é produto Senior, não é necessidade comercial —
a UI declara isso no próprio chip; a regra de evidências da IA permanece.

**Testes (offline, determinísticos — scripts/test-v0104-regressoes.ts, 70/70 PASS):**

1. Industrial `2945-0/00` → `C — Indústrias de transformação (divisão 29)`.
2. Agroindustrial `1011-2/01` + secundária `0111-3/01` → multissetorial (C+A).
3. Financeira `6422-1/00` → `K` (divisão 64).
4. Prestadora de saúde `8610-1/01` → `Q` (divisão 86).
5. **Operadora de plano de saúde `6550-2/00` → `K` (divisão 65) — NÃO `Q`/86** (correção do auditor;
   operadora ≠ prestador — ver Parte B2).
6. Divisão inexistente (34) → sem setor + aviso honesto; lixo/sem CNAE → null sem quebra.
7. Formatos: subclasse formatada (`4711-3/02`), 7 dígitos (`6204000`), código+descrição.

## 2. Parte B — Ativação condicional de APIs regulatórias (um conector por vez)

Regra geral de ativação — um conector só roda quando as TRÊS condições batem:
1. **Segmento:** o CNPJ pertence ao público-alvo do conector (derivado da Parte A ou de natureza jurídica) — **sinal de aplicabilidade, não prova de vínculo**;
2. **Lacuna:** o conector responde um campo que a ficha não tem;
3. **Fonte confirmada:** download/endpoint público, gratuito e verificado NA VM (host acessível + esquema real registrado).

Os dados de download (CSV) entram em tabela SQLite própria com `cargaEm` registrado — a proveniência
distingue a data da coleta CNPJ (ficha) da data da CARGA do CSV.

### B1. CVM — companhias abertas (PRIMEIRO conector) ✅ CRUZAMENTO PROVADO (v0.10.4)

| | |
|---|---|
| Estado | **PROVA de cruzamento executada** (scripts/cruzamento-cvm-prova.ts, 4/4 PASS) — conector AINDA NÃO integrado à cadeia |
| Fonte | `dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv` — 1,5 MB, `;`, **windows-1252**, gratuito, sem auth. Cópia local 1× (`db/fontes/cad_cia_aberta.csv`, SHA-256 registrado) |
| Esquema REAL verificado na VM (21/10/2026) | `CNPJ_CIA;DENOM_SOCIAL;DENOM_COMERC;DT_REG;DT_CONST;DT_CANCEL;MOTIVO_CANCEL;SIT;DT_INI_SIT;CD_CVM;SETOR_ATIV;TP_MERC;CATEG_REG;DT_INI_CATEG;SIT_EMISSOR;…;CNPJ_AUDITOR;AUDITOR` |
| **Correção do auditor aplicada** | categorias de registro são **`Categoria A` e `Categoria B`** (Resolução CVM 80) — a redação antiga "categoria B3" estava ERRADA e foi corrigida; a prova confirma no dado real: Petrobras → `Categoria A` |
| Campos novos (futuro conector) | código CVM (`CD_CVM`), categoria do registro (`CATEG_REG` A/B), situação (`SIT`), data do registro (`DT_REG`) |
| Cross por CNPJ | linha do CSV ↔ CNPJ COMPLETO normalizado (SQL local — sem HTTP por empresa) |
| Prova | Petrobras `33.000.167/0001-01` → CD_CVM 9512, Categoria A, registro 1977-07-20, ATIVO, com proveniência (URL + SHA + cargaEm + linha CSV); Botica `08.044.783/0001-17` → **vazio honesto** (não registrada; ausência não é conclusão sobre a empresa) |
| Banco | carga em banco SCRATCH (`db/fontes/cvm-cia-aberta.db`) — o banco de dev da aplicação não foi tocado; a tabela final será definida na implementação do conector |
| Próximo passo (só após aceite) | implementar o conector na cadeia: gatilho por natureza jurídica S.A. ou CNAE seção K + carga local + proveniência na teia + teste mínimo |

### B2. ANS — operadoras de plano de saúde (SEGUNDO) ⚠️ CORREÇÕES APLICADAS; FONTE NÃO CONFIRMADA NA VM

| | |
|---|---|
| **Correções do auditor aplicadas (v0.10.4)** | **(1) Operadoras ≠ prestadores:** operadoras de planos de saúde possuem CNAE específico **6550-2/00 (Planos de saúde), seção K, divisão 65** — comprovado offline (teste 5 da Parte A). Hospitais e clínicas da **divisão 86 (seção Q)** são prestadores de saúde, NÃO operadoras. O gatilho é o CNAE 6550-2/00/divisão 65, JAMAIS "seção Q, divisão 86xx" (redação antiga errada). **(2) A base pública de operadoras da ANS permite cruzamento por CNPJ** — o vínculo regulatório vem do match, o CNAE só escolhe a base certa |
| Fonte | gov.br/ans (dados abertos ANS) — "Cadastro de Operadoras" / operadoras ativas (CSV em lote, gratuito). Carga local no SQLite |
| Estado da verificação | **NÃO CONFIRMADA nesta rodada**: DNS não resolve na VM (`dados.abertos.ans.gov.br` — curl exit 6, 21/10/2026). Registro honesto em `qa/fontes-samples/ANS-operadoras-NOT-verificado-2026-10-21.md` |
| Campos novos | registro ANS, modalidade (médico-ambulatorial/hospitalar/odontológico), situação |
| Teste mínimo (quando a fonte resolver) | uma operadora real (match + campos), um CNPJ fora do setor (não consultado) |
| Critério de ativação | host acessível + esquema real registrado em qa/fontes-samples/ → e ainda assim SÓ depois do aceite do B1 |

### B3. Agro/MAPA e Transporte/ANTT — APENAS levantamento (sem implementação)

- Fonte ainda **não confirmada** na VM (endpoint público estável ou CSV de carga — a verificar). Ficam BLOCKED até confirmação, como o auditor determinou.
- Entregável desta etapa: registro da verificação (endpoint, formato, amostra) em `qa/fontes-samples/` — sem código de conector.

### B4. MinhaReceita grafo societário — permanece pendente de confirmação

O endpoint de grafo societário do MinhaReceita seguiu sem confirmação de disponibilidade (plano v0.9.1). Teste de 1 requisição antes de qualquer integração; societária ≠ controle de grupo (disciplina atual mantida).

## 3. Ordem de execução

1. **P3-A** (classificação CNAE) — ✅ implementada e provada na v0.10.4;
2. **P3-B1** (CVM via CSV) — ✅ cruzamento provado (carga 1× + SQL local + proveniência); conector na cadeia só após aceite;
3. **P3-B2** (ANS via CSV) — correções aplicadas; BLOQUEADO até a fonte resolver na VM;
4. **P3-B3/B4** — levantamento de fontes, sem implementação.

Cada passo só começa com o checkpoint do anterior (testes → evidência → registro).

## 4. O que esta proposta NÃO faz

- Não implementa conector na cadeia de enriquecimento agora (a v0.10.4 entrega a PROVA do cruzamento e a classificação; o conector CVM entra na cadeia só com aceite);
- Não consulta API paga, não adiciona cron, não usa Redis;
- Não promete campo que a fonte não tem (cada tabela acima lista EXATAMENTE os campos);
- Não troca a cadeia atual de cadastro (BrasilAPI → OpenCNPJ → ReceitaWS → MinhaReceita) nem a complementação por lacuna;
- Não trata CNAE como produto, necessidade comercial nem prova única de vínculo regulatório.
