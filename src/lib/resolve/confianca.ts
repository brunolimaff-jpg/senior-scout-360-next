/**
 * CONFIANÇA DE IDENTIDADE (v0.10.12 — contrato "corrigir a confiança na identificação").
 *
 * Diferencia OBRIGATORIAMENTE três estágios, que antes eram um só ("empresa confirmada"):
 *
 *   1. LOCALIZADO      — registro cadastral localizado na fonte oficial, mas o VÍNCULO
 *                        com as pistas fornecidas NÃO está provado (ex.: CNPJ válido cujo
 *                        nome registrado não tem NENHUMA relação com o nome da pista).
 *                        NÃO é "empresa pretendida confirmada" — é registro localizado.
 *   2. CORRESPONDENTE  — o cadastro corresponde às pistas fornecidas (nome compatível,
 *                        domínio oficial provado, ou identificação direta pelo CNPJ da
 *                        própria planilha sem divergências).
 *   3. VALIDADO        — o operador validou a identidade explicitamente (revisão humana).
 *
 * Regras do contrato:
 * - CNPJ válido com nome, domínio ou localização INCOMPATÍVEL não resulta automaticamente
 *   em empresa pretendida confirmada → LOCALIZADO + divergências explicadas.
 * - O cadastro localizado é PRESERVADO (nada é descartado), a divergência é EXPLICADA em
 *   linguagem humana e a revisão permanece possível (decide route).
 * - Similaridade de nome ZERO é divergência ALTA — a condição anterior (best > 0) ignorava
 *   exatamente o caso mais grave.
 * - Determinístico, zero rede, zero IA — compara pistas × ficha cadastral já coletada.
 */
import { tokenSimilarity, nomeCorresponde } from "@/lib/resolve/binding";
import type { Clues } from "@/lib/resolve/index";

export type IdentityStage = "LOCALIZADO" | "CORRESPONDENTE" | "VALIDADO";

export type DivergenciaTipo = "NOME" | "DOMINIO" | "LOCALIZACAO";
export type DivergenciaSeveridade = "ALTA" | "BAIXA";

export interface DivergenciaIdentidade {
  tipo: DivergenciaTipo;
  severidade: DivergenciaSeveridade;
  /** explicação humana e honesta da divergência (pt-BR, sem jargão) */
  descricao: string;
}

export interface AvaliacaoIdentidade {
  etapa: IdentityStage;
  divergencias: DivergenciaIdentidade[];
  /** melhor similaridade nome-da-pista × nome-registrado (0..1); null se a pista não tem nome */
  similaridadeNome: number | null;
  /** resumo humano do estágio (uma frase) */
  resumo: string;
}

export interface AvaliacaoIdentidadeInput {
  /** pistas normalizadas da linha (null = só CNPJ, sem outras colunas) */
  clues: Clues | null;
  /** a identidade da linha vem do CNPJ da própria planilha (VALIDA)? */
  pistaEhCnpj: boolean;
  /** ficha cadastral coletada na fonte oficial (null = nada coletado) */
  ficha: {
    legalName: string;
    tradeName: string;
    uf: string | null;
    municipio: string | null;
    /** domínio do e-mail público do registro (null se vazio) */
    emailDomain: string | null;
  } | null;
  /** o vínculo do domínio da pista já foi provado por fonte oficial (RDAP registro.br ou site do próprio domínio)? */
  dominioProvido?: boolean;
  /** o operador já validou a identidade (decisão humana)? */
  decididaPorOperador?: boolean;
}

/** domínio da pista é compatível com o domínio público do registro (igual ou subdomínio) */
function dominioCompativel(pista: string, registro: string): boolean {
  const p = pista.toLowerCase().replace(/^www\./, "");
  const r = registro.toLowerCase().replace(/^www\./, "");
  if (!p || !r) return false;
  return p === r || p.endsWith(`.${r}`) || r.endsWith(`.${p}`);
}

/**
 * Avalia a confiança da identidade comparando as PISTAS da linha com a FICHA coletada.
 * Zero rede, zero IA. Cada divergência carrega explicação honesta para a UI e exportação.
 */
export function avaliarIdentidade(input: AvaliacaoIdentidadeInput): AvaliacaoIdentidade {
  const { clues, pistaEhCnpj, ficha } = input;

  // decisão do operador é lei: VALIDADO, com as divergências preservadas como contexto
  if (input.decididaPorOperador) {
    return {
      etapa: "VALIDADO",
      divergencias: [],
      similaridadeNome: null,
      resumo: "Você validou a identidade desta empresa na revisão.",
    };
  }

  if (!ficha) {
    return {
      etapa: "LOCALIZADO",
      divergencias: [],
      similaridadeNome: null,
      resumo: "Sem ficha cadastral coletada — o registro não foi avaliado contra as pistas.",
    };
  }

  const divergencias: DivergenciaIdentidade[] = [];
  const nomes = clues?.names ?? [];

  // ---- 1) nome da pista × nome registrado ----
  let best = -1; // -1 = pista sem nome comparável
  if (nomes.length > 0) {
    best = 0;
    for (const n of nomes) {
      let s = Math.max(tokenSimilarity(n, ficha.legalName), ficha.tradeName ? tokenSimilarity(n, ficha.tradeName) : 0);
      // v0.10.12: contenção do nome achatado — "RAIADROGASIL" ⊂ "RAIA DROGASIL S/A"
      if (nomeCorresponde(n, ficha.legalName) || (ficha.tradeName && nomeCorresponde(n, ficha.tradeName))) s = Math.max(s, 1);
      best = Math.max(best, s);
    }
  }
  const temNome = best >= 0;

  if (temNome && best < 0.35) {
    divergencias.push({
      tipo: "NOME",
      // v0.10.12: quando o vínculo do domínio já está PROVADO por fonte oficial (RDAP/site),
      // a pista de nome alheia é erro do dado de origem — divergência de CONTEXTO (BAIXA),
      // pois a correspondência está estabelecida pelo domínio. Sem prova de domínio, o
      // nome é a própria pista: divergência ALTA → registro LOCALIZADO (revisão obrigatória).
      severidade: input.dominioProvido ? "BAIXA" : "ALTA",
      descricao:
        best === 0
          ? `O nome da pista ("${nomes[0].slice(0, 60)}") não tem nenhuma relação com o nome registrado ("${ficha.legalName.slice(0, 60)}") — confira se este é o CNPJ certo.`
          : `O nome da pista ("${nomes[0].slice(0, 60)}") pouco se parece com o nome registrado ("${ficha.legalName.slice(0, 60)}") — confira antes de usar.`,
    });
  }

  // ---- 2) domínio da pista × e-mail público do registro ----
  const dominioPista = clues?.domains?.[0] ?? null;
  let dominioOk: boolean | null = null;
  if (dominioPista && ficha.emailDomain) {
    dominioOk = dominioCompativel(dominioPista, ficha.emailDomain);
    if (!dominioOk && !input.dominioProvido) {
      divergencias.push({
        tipo: "DOMINIO",
        severidade: "BAIXA",
        descricao: `O domínio da pista (${dominioPista}) não aparece no cadastro — o e-mail público do registro usa ${ficha.emailDomain}. Pode ser domínio de marketing separado do fiscal; vale conferir.`,
      });
    }
  }

  // ---- 3) localização da pista × sede do registro ----
  const ufPista = clues?.uf ?? null;
  let ufOk: boolean | null = null;
  if (ufPista && ficha.uf) {
    ufOk = ufPista.toUpperCase() === ficha.uf.toUpperCase();
    if (!ufOk) {
      divergencias.push({
        tipo: "LOCALIZACAO",
        severidade: "BAIXA",
        descricao: `A pista indica ${ufPista}, mas o registro está em ${ficha.uf} (${ficha.municipio ?? "município não informado"}).`,
      });
    }
  }

  // ---- decisão do estágio ----
  const temAlta = divergencias.some((d) => d.severidade === "ALTA");
  const temDivergencia = divergencias.length > 0;

  if (temAlta) {
    const qual = divergencias.filter((d) => d.severidade === "ALTA").map((d) => d.tipo.toLowerCase()).join(" e ");
    return {
      etapa: "LOCALIZADO",
      divergencias,
      similaridadeNome: temNome ? best : null,
      resumo: `Registro localizado na fonte oficial, com divergência de ${qual} em relação às pistas — revise antes de usar.`,
    };
  }

  if (temDivergencia && pistaEhCnpj) {
    // CNPJ da planilha com divergência de contexto (domínio/local) e NENHUM nome que confirme:
    // o registro existe, mas nada nesta linha prova a correspondência → revisão honesta.
    const temNomeConfirmador = temNome && best >= 0.35;
    if (!temNomeConfirmador) {
      return {
        etapa: "LOCALIZADO",
        divergencias,
        similaridadeNome: temNome ? best : null,
        resumo: "Registro localizado na fonte oficial, mas as pistas divergem do cadastro — confirme se é a empresa buscada.",
      };
    }
  }

  // sem divergências: CNPJ direto = a própria pista (identificação direta); pista de nome
  // precisa ter passado pelo resolvedor (compatível) ou ter domínio provado.
  const resumo = pistaEhCnpj
    ? temDivergencia
      ? "O cadastro corresponde às pistas — a divergência de contexto registrada não impede a identificação."
      : "Identificação direta pelo CNPJ informado, confirmada na fonte oficial."
    : input.dominioProvido
      ? "O cadastro corresponde às pistas: o domínio informado é registrado oficialmente para este CNPJ."
      : temNome && best >= 0.6
        ? "O cadastro corresponde às pistas: o nome registrado é compatível com o nome da pista."
        : "O cadastro corresponde às pistas fornecidas.";

  return {
    etapa: "CORRESPONDENTE",
    divergencias,
    similaridadeNome: temNome ? best : null,
    resumo,
  };
}
