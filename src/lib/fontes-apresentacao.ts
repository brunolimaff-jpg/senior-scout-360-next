/**
 * fontes-apresentacao.ts — CAMADA ÚNICA DE APRESENTAÇÃO DAS FONTES (v0.10.8).
 *
 * Contrato do despacho (2026-10-22): o Scout é um produto de inteligência
 * comercial — nomes de provedores, APIs, endpoints e códigos HTTP NÃO aparecem
 * na experiência comercial. O usuário entende:
 *   · O QUE foi consultado (finalidade da consulta — categoria);
 *   · A SITUAÇÃO (concluído / parcial / indisponível);
 *   · O QUE falta;
 *   · COMO verificar (aba Evidências preserva proveniência).
 *
 * REGRAS:
 *  · Os rótulos descrevem a FINALIDADE da consulta. NUNCA prometem fonte
 *    oficial direta nem dado confirmado ("Cadastro empresarial" ≠ "Receita Federal").
 *  · A tradução é de APRESENTAÇÃO: provedores, URLs, datas e resultados crus
 *    continuam guardados e auditáveis (telemetria, exportações técnicas,
 *    detalhes de origem na aba Evidências). Nada aqui apaga proveniência.
 *  · Um único mecanismo, sem plugin/registry: tabela estática + uma função de
 *    categoria (para strings compostas) + função de detalhe técnico (camada
 *    secundária). Reuso: adaptadores existentes permanecem intocados.
 *  · EXCEÇÕES onde nomes técnicos permanecem: Laboratório de Modelos (escolha
 *    explícita de provedor/Model ID) e exportações técnicas/JSONL auditáveis.
 *
 * Sem IA, sem rede, sem estado — mapeamento determinístico.
 */

/** Categorias de apresentação — a linguagem do vendedor. */
export const CATEGORIA = {
  CADASTRO: "Cadastro empresarial",
  ESTABELECIMENTOS: "Matriz e filiais",
  RELACOES: "Relações empresariais",
  CONTEXTO_REGIONAL: "Contexto regional",
  DOMINIO: "Verificação de domínio",
  PESQUISA_PUBLICA: "Pesquisa pública",
  SITE_EMPRESA: "Site da empresa",
  ANALISE_IA: "Análise por IA",
  PISTA_OPERADOR: "Pista enviada por você",
  DECISAO_HUMANA: "Sua confirmação",
} as const;

export type CategoriaFonte = (typeof CATEGORIA)[keyof typeof CATEGORIA];

/**
 * Mapeamento técnico → categoria, em ordem de especificidade.
 *  · Padrões de REGEX casam nomes exatos e strings compostas
 *    (ex.: "MinhaReceita Grafo — quadros de participantes", "cadastro (BrasilAPI, reuso de ficha)").
 *  · String fora da tabela → devolvida intacta (nomes de veículos/notícias são
 *    fontes legítimas de pesquisa; não são nomes de API).
 */
const REGRAS: { padrao: RegExp; categoria: CategoriaFonte }[] = [
  // Descoberta de estabelecimentos (quadros de participantes) → finalidade matriz/filiais
  { padrao: /quadros?\s+de\s+participantes|estabelecimentos?\s+da\s+Receita/i, categoria: CATEGORIA.ESTABELECIMENTOS },
  // Grafos societários puros → relações empresariais
  { padrao: /MinhaReceita\s+Grafo|grafo\s+societ[áa]rio/i, categoria: CATEGORIA.RELACOES },
  // Espelhos públicos do registro empresarial (a cadeia de cadastro do Scout)
  { padrao: /BrasilAPI|OpenCNPJ|ReceitaWS|MinhaReceita|OpenCaramelo|ficha\s+cadastral|cadastro/i, categoria: CATEGORIA.CADASTRO },
  { padrao: /\bIBGE\b|popula[çc][ãa]o\s+do\s+munic[íi]pio/i, categoria: CATEGORIA.CONTEXTO_REGIONAL },
  { padrao: /RDAP|registro\.br|registro\s+do\s+dom[íi]nio/i, categoria: CATEGORIA.DOMINIO },
  { padrao: /Busca\s+na\s+web|web_search|busca\s+p[úu]blica/i, categoria: CATEGORIA.PESQUISA_PUBLICA },
  { padrao: /page_reader|p[áa]gina\s+p[úu]blica|Site\s+oficial/i, categoria: CATEGORIA.SITE_EMPRESA },
  { padrao: /CNPJ\s+informado/i, categoria: CATEGORIA.PISTA_OPERADOR },
  { padrao: /Decis[ãa]o\s+humana|human[oa]\s+na\s+revis[ãa]o/i, categoria: CATEGORIA.DECISAO_HUMANA },
];

/** Fontes que representam MODELO/IA (nunca categorizadas como dado público).
 *  Avaliada SÓ depois das regras — buscas/leituras públicas (web_search, page_reader)
 *  são pesquisa, não análise, mesmo contendo o prefixo técnico do gateway. */
const RE_IA = /z-ai|GLM|gateway|modelo/i;

/**
 * Categoria de apresentação de UMA fonte (string simples ou composta).
 * Descrição da finalidade — nunca garantia de fonte oficial.
 */
export function categoriaDeFonte(fonte: string | null | undefined): string {
  if (!fonte) return "—";
  for (const r of REGRAS) {
    if (r.padrao.test(fonte)) return r.categoria;
  }
  if (RE_IA.test(fonte)) return CATEGORIA.ANALISE_IA;
  return fonte; // nome legítimo (veículo de notícia etc.) ou desconhecido — sem invenção
}

/**
 * Detalhe técnico de origem — camada secundária (aba Evidências, "Detalhes de
 * origem"). Mantém a proveniência visível a quem quiser verificar, SEM nomes de
 * API na leitura normal: a UI exibe a categoria e oferece o detalhe on-demand.
 */
export function detalheTecnicoDeFonte(fonte: string | null | undefined): string | null {
  if (!fonte) return null;
  if (RE_IA.test(fonte)) return fonte;
  for (const r of REGRAS) {
    if (r.padrao.test(fonte) && r.categoria !== fonte) return fonte;
  }
  return null; // a fonte já é um nome legítimo — nada técnico a esconder
}

/**
 * Pares (categoria + detalhe) para exibição em Evidências: categoria upfront,
 * detalhe técnico opcional (tooltip/linha secundária).
 */
export function parDeFonte(fonte: string | null | undefined): { categoria: string; detalhe: string | null } {
  const detalhe = detalheTecnicoDeFonte(fonte);
  return { categoria: categoriaDeFonte(fonte), detalhe };
}
