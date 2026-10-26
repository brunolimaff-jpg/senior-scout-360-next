/**
 * Normalização determinística do MinhaReceita Grafo (v0.10.5 — FRENTE A).
 *
 * Contrato do que este módulo FAZ:
 * - Recebe a resposta crua da fonte e devolve APENAS a normalização mínima
 *   com identidade própria por participante (hash opaco para PF, CNPJ para PJ).
 * - NUNCA persiste CPF (nem o mascarado "**123456**" que a fonte já entrega),
 *   nunca devolve a resposta bruta de pessoas físicas, nunca inventa relação.
 * - Distingue, com honestidade:
 *     · PF = participante pessoa física do quadro (hash opaco);
 *     · PJ = participação societária direta (id = CNPJ do participante);
 *     · qualificação/entrada só quando JÁ EXISTE no cadastro (reuso, sem HTTP);
 *     · nada de "grupo econômico" aqui — isso é decisão da camada acima.
 * - Mapeia erros da fonte com estados honestos (404 = ausência de quadro
 *   público registrado, NÃO é erro de rede; 400 = CNPJ inválido; timeout/429/5xx
 *   = indisponibilidade com tipo preservado).
 *
 * Prova de campo (qa/fontes-samples/round-v0.10.5/):
 * - GET /<cnpj> → [{ cnpj, razao_social, id, nome, cpf }] — QSA oficial por
 *   estabelecimento (contagem idêntica à API principal: BB 41/41, Caixa 39/39).
 * - PF: id = hash 32 hex; PJ: id = CNPJ 14 caracteres (doc da fonte; normalizador
 *   aceita dígito E alfanumérico).
 * - GET /<hash> → quadro de empresas onde a pessoa figura (1 hop).
 * - 404 = "não encontrado ou sem conexões" (registro pode existir com QSA vazio).
 */

import { plural } from "@/lib/linguagem";

/** Teto de armazenamento do quadro de um participante (a fonte pode devolver centenas). */
export const QUADRO_TETO = 500;
/** Teto de exibição do quadro na interface (o total real segue visível). */
export const QUADRO_TETO_EXIBICAO = 50;

export interface LinhaGrafo {
  cnpj?: string;
  razao_social?: string;
  id?: string;
  nome?: string;
  cpf?: string;
}

/**
 * v0.10.16 — classificação de participante com estado honesto:
 * - PF            = hash opaco da fonte (semântica do quadro societário para pessoa física);
 * - PJ            = identificador CNPJ com DV válido (semântica: pessoa jurídica);
 * - INDETERMINADO = identificador que a fonte trouxe mas que não prova nenhum dos dois.
 * A regra residual "não parece CNPJ → PF" FOI REMOVIDA: um nome empresarial
 * (ex.: "... LTDA") com identificador inválido jamais volta como pessoa física.
 */
export type TipoParticipante = "PF" | "PJ" | "INDETERMINADO";

/** Participante normalizado — SEM CPF, SEM resposta bruta de PF. */
export interface ParticipanteGrafo {
  /** identidade própria na fonte: hash opaco (PF), CNPJ (PJ) ou outro identificador (INDETERMINADO). Nunca CPF. */
  participanteId: string;
  tipo: TipoParticipante;
  /** nome público conforme quadro societário (PF) ou razão social (PJ). */
  nomePublico: string;
  /** para PJ: CNPJ completo do participante (14 caracteres). null para PF e INDETERMINADO. */
  cnpjParticipante: string | null;
}

export interface RelacoesNormalizadas {
  ok: true;
  /** razão social do estabelecimento consultado (o `razao_social` das linhas). */
  razaoSocialConsultada: string | null;
  cnpjConsultado: string;
  participantes: ParticipanteGrafo[];
  totalParticipantes: number;
  avisos: string[];
}

export interface EmpresaQuadro {
  cnpj: string;
  razaoSocial: string | null;
}

export interface QuadroNormalizado {
  ok: true;
  tipoParticipante: TipoParticipante;
  empresas: EmpresaQuadro[];
  /** total de linhas distintas da resposta (antes do teto). */
  totalEmpresas: number;
  truncado: boolean;
  avisos: string[];
}

export type ErroGrafoTipo =
  | "CNPJ_INVALIDO" // 400 — a fonte valida DV; nós também pré-validamos localmente
  | "SEM_RELACOES_REGISTRADAS" // 404 — CNPJ pode existir com quadro vazio (ausência honesta)
  | "RATE_LIMITED" // 429
  | "TIMEOUT" // abort/timeout local
  | "FONTE_INDISPONIVEL" // 5xx, rede, resposta ilegível
  | "RESPOSTA_ILEGIVEL";

export interface ErroGrafo {
  ok: false;
  tipo: ErroGrafoTipo;
  httpStatus: number | null;
  mensagem: string;
}

const RE_HASH = /^[a-f0-9]{32}$/;
const RE_CNPJ14 = /^[0-9A-Z]{14}$/; // aceita dígito e alfanumérico (RFB 2026)

/** id do participante tem FORMATO de CNPJ (14 caracteres dígito/alfanumérico) — formato não prova DV. */
export function idPareceCnpj(id: string): boolean {
  return RE_CNPJ14.test(id) && !RE_HASH.test(id);
}

/**
 * v0.10.16 — classificação PROVADA pela semântica da fonte + identificador adequado:
 * - hash opaco (32 hex) = pessoa física do quadro (contrato da fonte);
 * - CNPJ 14 caracteres com DV válido = pessoa jurídica;
 * - qualquer outra coisa = INDETERMINADO (nunca PF por eliminação, nunca PJ sem DV).
 */
export function classificarParticipantePorId(
  id: string,
  validarCnpj: (c: string) => { valid: boolean }
): TipoParticipante {
  if (RE_HASH.test(id)) return "PF";
  if (RE_CNPJ14.test(id) && !RE_HASH.test(id) && validarCnpj(id).valid) return "PJ";
  return "INDETERMINADO";
}

/**
 * Normaliza a resposta de GET /<cnpj> (relações diretas).
 * Deduplica por participanteId (identidade própria — NUNCA por nome, que pode
 * se repetir entre homônimos com hashes diferentes). Descarta qualquer campo
 * `cpf` recebido, mesmo mascarado.
 */
export function normalizarRelacoesGrafo(
  resposta: unknown,
  opts: { cnpjConsultado: string; validarCnpj?: (c: string) => { valid: boolean } }
): RelacoesNormalizadas | ErroGrafo {
  if (!Array.isArray(resposta)) return erroDeCorpoNaoArray(resposta);
  const validarCnpj = opts.validarCnpj ?? ((c: string) => ({ valid: idPareceCnpj(c) }));
  const avisos: string[] = [];
  const porId = new Map<string, ParticipanteGrafo>();
  let razaoSocialConsultada: string | null = null;
  let linhasSemId = 0;
  let linhasSemNome = 0;
  let indeterminados = 0;

  for (const linha of resposta as LinhaGrafo[]) {
    if (!linha || typeof linha !== "object") continue;
    const id = typeof linha.id === "string" ? linha.id.trim() : "";
    if (!id) {
      linhasSemId += 1;
      continue;
    }
    if (!razaoSocialConsultada && typeof linha.razao_social === "string" && linha.razao_social.trim()) {
      razaoSocialConsultada = linha.razao_social.trim();
    }
    const nome = typeof linha.nome === "string" ? linha.nome.trim() : "";
    const tipo = classificarParticipantePorId(id, validarCnpj);
    if (tipo === "INDETERMINADO") indeterminados += 1;
    const participante: ParticipanteGrafo =
      tipo === "PJ"
        ? {
            participanteId: id,
            tipo: "PJ",
            nomePublico: nome || id,
            cnpjParticipante: id,
          }
        : {
            participanteId: id,
            tipo,
            nomePublico: nome || "Participante (nome não informado pela fonte)",
            cnpjParticipante: null,
          };
    if (!nome) linhasSemNome += 1;
    if (!porId.has(id)) porId.set(id, participante);
  }

  if (linhasSemId > 0) avisos.push(`${plural(linhasSemId, "linha", "linhas")} sem identificador próprio ${linhasSemId === 1 ? "foi descartada" : "foram descartadas"} (nada inventado).`);
  if (linhasSemNome > 0) avisos.push(`${plural(linhasSemNome, "participante", "participantes")} sem nome público na fonte.`);
  if (indeterminados > 0)
    avisos.push(
      `${plural(indeterminados, "participante", "participantes")} com identificador que a fonte não permitiu confirmar — o tipo (pessoa física ou jurídica) fica não confirmado; o vínculo registrado continua valendo.`
    );

  return {
    ok: true,
    razaoSocialConsultada,
    cnpjConsultado: opts.cnpjConsultado,
    participantes: [...porId.values()],
    totalParticipantes: porId.size,
    avisos,
  };
}

/**
 * Normaliza a resposta de GET /<id> para um participante (quadro — expansão
 * manual de UMA conexão). Cada linha traz a empresa onde o participante figura.
 * Teto de armazenamento QUADRO_TETO aplicado com flag honesta.
 */
export function normalizarQuadroParticipante(
  resposta: unknown,
  opts: { participanteId: string; tipoParticipante: TipoParticipante; teto?: number }
): QuadroNormalizado | ErroGrafo {
  if (!Array.isArray(resposta)) return erroDeCorpoNaoArray(resposta);
  const teto = opts.teto ?? QUADRO_TETO;
  const avisos: string[] = [];
  const porCnpj = new Map<string, EmpresaQuadro>();
  let linhasComCnpj = 0;
  for (const linha of resposta as LinhaGrafo[]) {
    if (!linha || typeof linha !== "object") continue;
    const cnpj = typeof linha.cnpj === "string" ? linha.cnpj.trim().toUpperCase() : "";
    if (!cnpj || !RE_CNPJ14.test(cnpj)) continue; // sem CNPJ legível → nada inventado
    linhasComCnpj += 1;
    const razao = typeof linha.razao_social === "string" && linha.razao_social.trim() ? linha.razao_social.trim() : null;
    if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, { cnpj, razaoSocial: razao });
  }
  // v0.10.23 (auditoria): a fonte pode devolver VÁRIAS linhas para o MESMO
  // estabelecimento (CNPJ completo). A deduplicação por CNPJ é correta para o
  // contrato do quadro (lista de estabelecimentos onde o participante figura —
  // estabelecimento distinto por CNPJ), mas o descarte tem de ficar VISÍVEL:
  // sem este aviso, um quadro unificado podia parecer a resposta integral da fonte.
  const unificadas = linhasComCnpj - porCnpj.size;
  if (unificadas > 0) {
    avisos.push(
      `${plural(unificadas, "registro repetido na fonte", "registros repetidos na fonte")} ${unificadas === 1 ? "foi unificado" : "foram unificados"} por estabelecimento (CNPJ igual) — o quadro lista estabelecimentos distintos, não linhas da fonte.`
    );
  }
  const total = porCnpj.size;
  let truncado = false;
  let empresas = [...porCnpj.values()];
  if (total > teto) {
    empresas = empresas.slice(0, teto);
    truncado = true;
    avisos.push(`Quadro com ${total} empresas — armazenamento limitado ao teto de ${teto} (total real preservado).`);
  }
  return {
    ok: true,
    tipoParticipante: opts.tipoParticipante,
    empresas,
    totalEmpresas: total,
    truncado,
    avisos,
  };
}

/**
 * v0.10.6 (consolidação de identidade): a RAIZ (8 primeiros caracteres) é a
 * identidade da PESSOA JURÍDICA; o CNPJ completo é um ESTABELECIMENTO dela.
 * Funções puras — nenhum HTTP, nenhuma suposição além do campo.
 */
export function raizDe(cnpj: string): string {
  return cnpj.toUpperCase().slice(0, 8);
}

/**
 * Conta PESSOAS JURÍDICAS distintas (por raiz) num quadro. Um quadro com 5
 * estabelecimentos da mesma raiz contém UMA pessoa jurídica — nunca cinco.
 */
export function contarPessoasJuridicas(empresas: EmpresaQuadro[]): number {
  const raizes = new Set<string>();
  for (const e of empresas) raizes.add(raizDe(e.cnpj));
  return raizes.size;
}

/**
 * Filtra as empresas de um quadro que pertencem à MESMA RAIZ (8 primeiros
 * caracteres do CNPJ — a pessoa jurídica). Deduplica por CNPJ completo.
 * Preserva a própria raiz consultada (útil como candidato a matriz).
 */
export function filtrarMesmoRaiz(
  empresas: EmpresaQuadro[],
  cnpjRaiz: string
): EmpresaQuadro[] {
  const raiz = cnpjRaiz.toUpperCase().slice(0, 8);
  const vistos = new Set<string>();
  const out: EmpresaQuadro[] = [];
  for (const e of empresas) {
    if (!e.cnpj.startsWith(raiz)) continue;
    if (vistos.has(e.cnpj)) continue;
    vistos.add(e.cnpj);
    out.push(e);
  }
  return out;
}

/**
 * Participantes comuns entre DUAS empresas investigadas (mesmo participanteId
 * nas relações normalizadas de ambas). Sempre é "participante comum" —
 * NUNCA "grupo econômico": a rotulagem de grupo é proibida por contrato.
 */
export function detectarParticipantesComuns(
  relacoesA: ParticipanteGrafo[],
  relacoesB: ParticipanteGrafo[]
): ParticipanteGrafo[] {
  const idsB = new Set(relacoesB.map((p) => p.participanteId));
  const vistos = new Set<string>();
  const out: ParticipanteGrafo[] = [];
  for (const p of relacoesA) {
    if (!idsB.has(p.participanteId)) continue;
    if (vistos.has(p.participanteId)) continue;
    vistos.add(p.participanteId);
    out.push(p);
  }
  return out;
}

/**
 * Mapeia falhas HTTP/tempo da fonte para estados honestos.
 * 404 NÃO é falha de rede: é ausência de quadro público registrado (honesto).
 */
export function mapearErroGrafo(status: number | null, corpo: string | null, causa?: string): ErroGrafo {
  if (causa === "timeout") {
    return { ok: false, tipo: "TIMEOUT", httpStatus: null, mensagem: "A fonte de grafos não respondeu a tempo (timeout). Nada foi alterado." };
  }
  if (status === 429) {
    return { ok: false, tipo: "RATE_LIMITED", httpStatus: 429, mensagem: "A consulta atingiu o limite de requisições da fonte agora. Tente novamente mais tarde — nada foi alterado." };
  }
  if (status === 404) {
    return { ok: false, tipo: "SEM_RELACOES_REGISTRADAS", httpStatus: 404, mensagem: "Nenhuma relação societária pública registrada para este identificador na base consultada." };
  }
  if (status === 400) {
    return { ok: false, tipo: "CNPJ_INVALIDO", httpStatus: 400, mensagem: "A fonte recusou o identificador (inválido para a fonte)." };
  }
  if (status !== null && status >= 500) {
    return { ok: false, tipo: "FONTE_INDISPONIVEL", httpStatus: status, mensagem: "A fonte de grafos está indisponível (erro do servidor). Nada foi alterado." };
  }
  if (status === null) {
    return { ok: false, tipo: "FONTE_INDISPONIVEL", httpStatus: null, mensagem: causa ? `Falha de rede ao contatar a fonte de grafos (${causa}).` : "Falha de rede ao contatar a fonte de grafos. Nada foi alterado." };
  }
  return { ok: false, tipo: "RESPOSTA_ILEGIVEL", httpStatus: status, mensagem: "A fonte respondeu em um formato inesperado — nada foi inferido. O detalhe técnico fica registrado na telemetria." };
}

function erroDeCorpoNaoArray(resposta: unknown): ErroGrafo {
  const msg = typeof (resposta as { message?: unknown })?.message === "string" ? (resposta as { message: string }).message : "";
  if (/não encontrado|sem conexões/i.test(msg)) {
    return mapearErroGrafo(404, msg);
  }
  if (/inválido|invalid/i.test(msg)) {
    return mapearErroGrafo(400, msg);
  }
  return { ok: false, tipo: "RESPOSTA_ILEGIVEL", httpStatus: null, mensagem: "Resposta da fonte de grafos não é a estrutura esperada (nada foi inferido)." };
}

/**
 * Valida o formato de um participanteId que chega da UI para expansão manual:
 * hash opaco (32 hex) OU CNPJ com DV válido (dígito ou alfanumérico).
 * A validação de DV usa o validador local — o id só sai daqui se for
 * estritamente um dos dois formatos.
 */
export function validarParticipanteId(id: string, validarCnpj: (c: string) => { valid: boolean }): { ok: true; tipo: "PF" | "PJ" } | { ok: false } {
  const t = id.trim();
  if (RE_HASH.test(t)) return { ok: true, tipo: "PF" };
  if (RE_CNPJ14.test(t) && validarCnpj(t).valid) return { ok: true, tipo: "PJ" };
  return { ok: false };
}
