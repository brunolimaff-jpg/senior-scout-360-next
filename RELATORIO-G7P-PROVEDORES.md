# G7-P — VALIDAÇÃO DE PROVEDORES DO SCOUT 360

Missão do Planejador (26/10/2026): investigar, comparar e recomendar provedores
de pesquisa/leitura/síntese para o Scout fora da VM Z.ai.
**Nenhuma chamada paga foi executada. Nenhum código de produção foi alterado.
Nenhum dado comercial real foi usado.**

## 1. Contrato atual no repositório (verificado no código)

O `mini-services/resolve-service/index.ts` concentra as três operações e o resto
do app consome por HTTP:

| Rota | Entrada | Saída usada pelo Scout | Observações |
|---|---|---|---|
| `POST /web-search` | `{query, num≤10}` | `{ok:true, items[]}` com **`url`, `name`, `snippet`, `host_name`** | rate limit local 10/min; 429 com `retryAfterMs`; cota do provedor repassada como `upstream_status` |
| `POST /page-reader` | `{url http/https}` | `{ok:true, data}` com **`data.html` (HTML!) e `data.title`** | pré-checagem DNS (domínio inexistente → 404 limpo); consumidores medem `html.length`, extraem `<title>` por regex e varrem CNPJs/links no HTML |
| `POST /scout-chat` | `{messages≤4, model?, temperature?, timeout_ms}` | `{ok, content, model, modelRequested, tokens, tokens_aliases}` | envia **`thinking: {type:"disabled"}`** (parâmetro específico Z.ai); normaliza `usage` em dois shapes; 429/504 propagados |

**Consequência para qualquer substituto**: trocar só a URL não basta.
- Pesquisa: os campos `url/name/snippet/host_name` são o contrato (mapeável).
- Leitura: o Scout **depende de HTML** (`data.html`). Provedor que devolve
  Markdown (DeepSeek Fetch) exige adaptação/validação — é o ponto mais delicado.
- Síntese: `thinking` precisa ser removido para gateways genéricos; `usage`
  precisa ser normalizado (o código já aceita dois shapes, mas não qualquer um).

## 2. Candidatos — análise

### A. Z.ai API oficial (`/paas/v4/web_search`, `/paas/v4/reader`) — menor mudança

- Mesmo fornecedor/conteúdo do SDK atual: o SDK posta em `{baseUrl}/functions/invoke`
  (`function_name` + `args`); as APIs oficiais `/paas/v4/web_search` e
  `/paas/v4/reader` são os endpoints de plataforma equivalentes. A equivalência
  de shape precisa ser validada numa amostra (não presumida). Adaptação:
  substituir a invocação do SDK por HTTP com chave de API (≈1 função de
  transporte); o parsing existente permanece.
- Exige **chave Z.ai com acesso aos serviços de tools** — nenhuma chave do Scout
  existe no ambiente local (o `.z-ai-config` não veio no TAR; as variáveis
  `ZAI_BUSINESS_*` do ambiente pertencem ao ZCode, não ao Scout — não presumir).
- Custo: **NÃO VERIFICADO** (preço das tools da Z.ai não consultado nesta sessão).
- Risco: mantém dependência do fornecedor; mas é o piloto de menor risco técnico.

### B. DeepSeek Search + Fetch — preferência do Planejador, se consumo autorizado

- `POST /v1/tools/search` → resultados estruturados (URLs + resumos) → mapeável
  para `{url, name, snippet, host_name}` (adapter fino).
- `POST /v1/tools/fetch` → **Markdown**. O Scout espera `data.html`.
  Opções: (i) preencher `html` com o Markdown e adaptar os consumidores que
  procuram tags (perde extração de `<title>`/estrutura); (ii) baixar o HTML
  diretamente por HTTP (http/https apenas, host validado, loopback/privado
  bloqueado) e usar o Fetch só como fallback — preserva o contrato atual;
  (iii) converter Markdown→HTML (dependência nova, fidelidade duvidosa).
  **Recomendação técnica: (ii)**, validada com amostra sintética antes de ativar.
- Síntese: chat completions padrão (sem `thinking`); `usage` normalizável.
- Custo publicado (citado pelo Planejador): **US$ 0,75 / mil buscas** e
  **US$ 0,75 / mil leituras**, + tokens de geração (tabela de tokens não
  verificada aqui). Ordem de grandeza no Scout: ~4–8 buscas + ~6–12 leituras
  por empresa → **≈ US$ 0,01–0,02/empresa** só em tools.
- Acesso: exige **API key paga** — nenhuma chave local; consumo precisa de
  autorização explícita (a missão proíbe chamadas pagas nesta etapa).

### C. LiteLLM (gateway da Senior) — melhor arquitetura, acesso não comprovado

- Permite registrar DeepSeek Search como ferramenta (`/v1/search/{nome}`) e
  consumir modelos por chave virtual, com controle por equipe → **separa
  pesquisa de modelo** e evita lock-in.
- **Acesso verificado no ambiente local: NÃO ENCONTRADO** — nenhuma referência
  a LiteLLM nos configs (`~/.zcode`, `~/.claude`, `~/.codex`, OpenCode) nem
  variáveis de ambiente; nenhuma credencial recuperada. Usar o gateway interno
  exige **autorização da Senior** e confirmação de versão/ferramentas habilitadas.
- Adaptação: mesmo adapter HTTP do DeepSeek para busca/leitura + chat
  OpenAI-compatível apontando para o gateway (sem `thinking`).

### D. Descartados nesta fase

- **OpenCode Go**: o Planejador vetou como backend operacional (perfil de uso e
  termos do serviço); sem `web_search`/`page_reader` equivalentes. Concordamos.
- **Perplexity Sonar antigo**: interface encerrada em 27/09/2026 (fonte citada
  pelo Planejador) — não iniciar implementação nova.
- **Gemini**: viável (Grounding + URL Context), mas exige adaptar formato de
  evidências/citações; fica como terceiro candidato, não no piloto.

## 3. Matriz comparativa

| Critério | Z.ai oficial | DeepSeek Search+Fetch | LiteLLM (Senior) |
|---|---|---|---|
| Rastreabilidade de fontes | Alta (mesmo conteúdo atual) | Alta (URLs estruturadas) | Alta (herda DeepSeek) |
| Cobertura de empresas BR | Igual à atual (validada no produto) | **NÃO VERIFICADO** (precisa amostra) | idem DeepSeek |
| Conteúdo recuperado (formato) | HTML (contrato preservado) | Markdown (exige adapter) | Markdown (exige adapter) |
| Custo por empresa (ordem) | NÃO VERIFICADO | ≈ US$ 0,01–0,02 + tokens | Depende do contrato interno |
| Latência | Igual à atual | NÃO VERIFICADA | NÃO VERIFICADA |
| Complexidade de integração | **Baixa (~1 função HTTP)** | Média (adapter busca + leitura + chat) | Média (igual DeepSeek) |
| Portabilidade entre modelos | Baixa (vendor) | Alta (modelo separado) | **Máxima** (gateway) |
| Identificação determinística | Preservada | Preservada (adapter não decide) | Preservada |
| Local + futura hospedagem | Sim | Sim | Sim (se gateway acessível) |

## 4. Recomendação do menor piloto

1. **Piloto 0 (custo zero, sem código)**: confirmar com a Senior se existe
   LiteLLM autorizado para o projeto (equipe/chave virtual + DeepSeek Search
   habilitado). Se sim, o caminho preferido é o C (pesquisa via LiteLLM,
   síntese por modelo do gateway).
2. **Piloto 1 (menor mudança técnica)**: Z.ai oficial — trocar `functions.invoke`
   por HTTP no resolve-service, mantendo o contrato HTML. Requer chave Z.ai com
   tools.
3. **Piloto 2 (preferência do Planejador)**: DeepSeek Search+Fetch com adapter,
   leitura por HTML direto (validação de URL/anti-SSRF) e Fetch como fallback;
   validar campos e cobertura em amostra sintética antes de ativar.
4. Regra mantida: **nenhuma troca muda o contrato de identidade/evidências**;
   `web_search` só recolhe candidatos, nunca confirma empresa.

## 5. Condições de acesso e pendências

- DeepSeek: API key paga — autorização de consumo pendente (nada foi chamado).
- Z.ai oficial: chave com acesso a tools — não existe no ambiente local.
- LiteLLM Senior: acesso **não comprovado**; exige autorização corporativa.
- Termos do OpenCode Go para uso programático fora do CLI: não presumidos.

## 6. O que NÃO foi feito (limites respeitados)

- Nenhuma chamada paga (DeepSeek/Z.ai/LiteLLM).
- Nenhuma alteração de código de produção ou troca de provedor.
- Nenhum dado comercial real enviado ou usado; nenhuma credencial lida/exibida.
