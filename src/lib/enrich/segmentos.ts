/**
 * segmentos.ts — P3-A: CLASSIFICAÇÃO MULTISSETORIAL pelo CNAE (derivada localmente).
 *
 * Contrato do despacho v0.10.4:
 *  · a partir do CNPJ confirmado, a classificação cadastral sai das atividades
 *    PRINCIPAL e SECUNDÁRIAS, usando a tabela oficial do CNAE 2.0 (IBGE);
 *  · distingue atividade principal de secundárias, seção/divisão/subclasse,
 *    empresa jurídica vs. estabelecimento, e SETOR CADASTRAL de operação
 *    efetivamente comprovada — CNAE NUNCA vira produto Senior nem necessidade
 *    comercial (regra de evidências mantida);
 *  · ZERO IA, ZERO chamada nova: derivação pura sobre a ficha já coletada
 *    (`cnaeCode`, `cnaesSecundarios`). Cadastral por natureza.
 *
 * Fonte dos mapeamentos: CNAE 2.0 (IBGE) — seção ↔ divisão. A subclasse é o
 * código de 7 dígitos ("6204-0/00" ou "6204000"); a divisão são os 4 primeiros
 * dígitos; a seção vem da tabela abaixo. Divisão fora da tabela → sem seção
 * (honesto — nunca inventar setor).
 *
 * O QUE É (e o que não é): o CNPJ identifica um ESTABELECIMENTO de uma empresa
 * jurídica; matriz e filial têm registros próprios, cada um com seus CNAEs. Os
 * campos aqui derivados descrevem o registro consultado (ficha), não o grupo.
 */

/** CNAE 2.0 — seção ↔ divisões (tabela oficial IBGE, derivável por faixa). */
const SECOES: { secao: string; nome: string; divisoes: [number, number][] }[] = [
  { secao: "A", nome: "Agricultura, pecuária, produção florestal, pesca e aquicultura", divisoes: [[1, 3]] },
  { secao: "B", nome: "Indústrias extrativas", divisoes: [[5, 9]] },
  { secao: "C", nome: "Indústrias de transformação", divisoes: [[10, 33]] },
  { secao: "D", nome: "Eletricidade e gás", divisoes: [[35, 35]] },
  { secao: "E", nome: "Água, esgoto, atividades de gestão de resíduos e descontaminação", divisoes: [[36, 39]] },
  { secao: "F", nome: "Construção", divisoes: [[41, 43]] },
  { secao: "G", nome: "Comércio; reparação de veículos automotores e motocicletas", divisoes: [[45, 47]] },
  { secao: "H", nome: "Transporte, armazenagem e correio", divisoes: [[49, 53]] },
  { secao: "I", nome: "Alojamento e alimentação", divisoes: [[55, 56]] },
  { secao: "J", nome: "Informação e comunicação", divisoes: [[58, 63]] },
  { secao: "K", nome: "Atividades financeiras, de seguros e serviços relacionados", divisoes: [[64, 66]] },
  { secao: "L", nome: "Atividades imobiliárias", divisoes: [[68, 68]] },
  { secao: "M", nome: "Atividades profissionais, científicas e técnicas", divisoes: [[69, 75]] },
  { secao: "N", nome: "Atividades administrativas e serviços complementares", divisoes: [[77, 82]] },
  { secao: "O", nome: "Administração pública, defesa e seguridade social", divisoes: [[84, 84]] },
  { secao: "P", nome: "Educação", divisoes: [[85, 85]] },
  { secao: "Q", nome: "Saúde humana e serviços sociais", divisoes: [[86, 88]] },
  { secao: "R", nome: "Artes, cultura, esporte e recreação", divisoes: [[90, 93]] },
  { secao: "S", nome: "Outras atividades de serviços", divisoes: [[94, 96]] },
  { secao: "T", nome: "Serviços domésticos", divisoes: [[97, 98]] },
  { secao: "U", nome: "Organismos internacionais e outras instituições extraterritoriais", divisoes: [[99, 99]] },
];

export interface SecaoCnae {
  secao: string;
  nome: string;
}

/** Divisão (4 dígitos) → seção CNAE 2.0. Divisão fora da tabela → null (honesto). */
export function secaoDaDivisao(divisao: number): SecaoCnae | null {
  for (const s of SECOES) {
    for (const [de, ate] of s.divisoes) {
      if (divisao >= de && divisao <= ate) return { secao: s.secao, nome: s.nome };
    }
  }
  return null;
}

/**
 * Extrai a DIVISÃO (2 dígitos) de um código CNAE em qualquer formato conhecido:
 * "6204-0/00" (subclasse formatada) · "6204000" (7 dígitos) · "4711-3/02 — Desc"
 * (com descrição, formato dos cnaesSecundarios v0.10.0). Hierarquia CNAE 2.0:
 * seção (letra) → divisão (2 dígitos) → grupo → classe → subclasse (7 dígitos).
 * Código malformado → null (nunca lança).
 */
export function divisaoDeCnae(cnae: string | null | undefined): string | null {
  if (!cnae) return null;
  const digitos = cnae.replace(/\D/g, "");
  if (digitos.length >= 2) return digitos.slice(0, 2);
  return null;
}

/** Subclasse CNAE (7 dígitos) normalizada no formato oficial "0000-0/00". */
export function subclasseDeCnae(cnae: string | null | undefined): string | null {
  if (!cnae) return null;
  const m = /^(\d{2})\s*-?\s*(\d)\s*-\s*(\d)\s*\/\s*(\d{2})/.exec(cnae.trim());
  if (m) return `${m[1]}${m[2]}-${m[3]}/${m[4]}`;
  const digitos = cnae.replace(/\D/g, "");
  if (digitos.length === 7) return `${digitos.slice(0, 4)}-${digitos[4]}/${digitos.slice(5)}`;
  return null;
}

/** Setor derivado de UM código CNAE (seção + divisão + subclasse quando possível). */
export interface SetorCnae {
  secao: string;
  secaoNome: string;
  /** divisão CNAE (2 dígitos — hierarquia oficial: seção → divisão → grupo → classe → subclasse) */
  divisao: string;
  subclasse: string | null;
}

export function setorDeCnae(cnae: string | null | undefined): SetorCnae | null {
  const divisao = divisaoDeCnae(cnae);
  if (!divisao) return null;
  const sec = secaoDaDivisao(Number(divisao));
  if (!sec) return null;
  return { secao: sec.secao, secaoNome: sec.nome, divisao, subclasse: subclasseDeCnae(cnae) };
}

/** Classificação MULTISSETORIAL da ficha (P3-A) — pura, determinística, sem rede. */
export interface ClassificacaoSetorial {
  /** setor do CNAE PRINCIPAL: "K — Atividades financeiras… (divisão 64, subclasse 6422-1/00)" */
  setorPrimario: string | null;
  /** seções DISTINTAS dos CNAEs secundários (exclui a seção do principal) */
  setoresSecundarios: string[];
  /** ≥ 2 seções distintas entre principal + secundários */
  multissetorial: boolean;
  /** avisos honestos (CNAE ilegível/fora da tabela, lista truncada) */
  avisos: string[];
}

export function classificarSetorial(
  cnaePrincipal: string | null | undefined,
  cnaesSecundarios: string[] | null | undefined,
  cnaesTruncados?: boolean
): ClassificacaoSetorial {
  const avisos: string[] = [];
  const primario = setorDeCnae(cnaePrincipal);
  if (cnaePrincipal && !primario) avisos.push("CNAE principal ilegível ou fora da tabela CNAE 2.0 — setor não derivado");

  const secoesSec: string[] = [];
  const lista = cnaesSecundarios ?? [];
  for (const c of lista) {
    const s = setorDeCnae(c);
    if (!s) continue;
    if (primario && s.secao === primario.secao) continue;
    if (!secoesSec.includes(s.secao)) secoesSec.push(s.secao);
  }
  if (cnaesTruncados) avisos.push("lista de CNAEs secundários incompleta (teto de segurança) — setores secundários podem ser parciais");

  const setoresTotais = new Set<string>([...(primario ? [primario.secao] : []), ...secoesSec]);
  return {
    setorPrimario: primario
      ? `${primario.secao} — ${primario.secaoNome} (divisão ${primario.divisao}${primario.subclasse ? `, subclasse ${primario.subclasse}` : ""})`
      : null,
    setoresSecundarios: secoesSec,
    multissetorial: setoresTotais.size >= 2,
    avisos,
  };
}

/** Rótulo curto para chip/telemetria: "K", "G+Q", "K (multissetorial: G,Q)". */
export function rotuloSetorial(c: ClassificacaoSetorial): string | null {
  if (!c.setorPrimario) return c.setoresSecundarios.length ? c.setoresSecundarios.join("+") : null;
  return c.multissetorial ? `${c.setorPrimario[0]} (${c.setoresSecundarios.join("+")})` : c.setorPrimario[0];
}
