/**
 * Adapters determinísticos para APIs públicas de CNPJ.
 * Sem IA. Cadeia de fallback: BrasilAPI → OpenCNPJ → ReceitaWS → MinhaReceita.
 * Cada consulta registra fonte, data/hora e resposta bruta (para auditoria).
 * Captura também a teia societária (QSA) e fatos da empresa (capital, natureza,
 * porte, optantes, regime tributário, contato completo, endereço, CNAEs
 * secundários) que alimentam o dossiê e a teia societária.
 */
import { recordTelemetry } from "@/lib/telemetry";

export interface CnpjSocio {
  nome: string;
  qual: string;
  entrada: string;
}

/** Contexto municipal IBGE anexado ao enriquecimento (região + população). */
export interface IbgeContext {
  populacao: string; // "268.202" (IBGE, estimativa mais recente)
  anoPopulacao: string;
  regiaoImediata: string;
  regiaoIntermediaria: string;
  mesorregiao: string;
  microrregiao: string;
  regiao: string; // Centro-Oeste etc.
}

export interface CnpjExtra {
  capitalSocial: string;
  naturezaJuridica: string;
  porte: string;
  simples: string; // "Sim" | "Não" | ""
  mei: string; // "Sim" | "Não" | ""
  email: string;
  telefone: string;
  telefone2: string; // 2º telefone público (ddd_telefone_2) — contato de backup
  regimeTributario: string; // forma de tributação mais recente (LUCRO REAL etc.)
  endereco: string;
  /** v0.10.0: "codigo — descricao" (código preservado) — sem corte silencioso */
  cnaesSecundarios: string[];
  /** v0.10.0: true quando a lista de CNAEs atingiu o teto de segurança (200) */
  cnaesTruncados?: boolean;
  /** v0.10.1: true quando o QSA atingiu o teto de segurança (500) — a lista de sócios
   *  está EXPLICITAMENTE incompleta (nunca um corte silencioso) */
  qsaTruncados?: boolean;
  codigoMunicipioIbge: string; // código IBGE do município quando a fonte traz
  /** contexto IBGE preenchido pelo engine após a consulta (nunca pela fonte CNPJ) */
  ibge: IbgeContext | null;
  /** P3-A (v0.10.4): classificação multissetorial derivada LOCALMENTE do CNAE —
   *  setor cadastral pelo CNAE 2.0 (IBGE), NUNCA produto/need comercial */
  setorPrimario?: string;
  setoresSecundarios?: string[];
  multissetorial?: boolean;
  /** CNAE ilegível/fora da tabela, lista truncada — avisos honestos da derivação */
  avisosSetoriais?: string[];
}

export interface CnpjLookupData {
  legalName: string;
  tradeName: string;
  registrationStatus: string;
  statusDate: string;
  situationReason: string;
  branchType: string; // MATRIZ | FILIAL (da fonte)
  // Identificador OFICIAL da Receita: 1 = matriz, 2 = filial. Nunca inferir matriz
  // pelo sufixo "0001" — a associação não é permanente desde o CNPJ alfanumérico (2026).
  branchIdentifier: number | null; // 1 | 2 | null
  openingDate: string;
  cnaeCode: string;
  cnaeDescription: string;
  municipality: string;
  uf: string;
  socios: CnpjSocio[];
  extra: CnpjExtra;
}

export interface CnpjLookupSuccess {
  ok: true;
  source: string;
  data: CnpjLookupData;
  rawJson: string;
  queriedAt: string;
  /** fontes complementares usadas para preencher lacunas após a fonte primária (P2) */
  completadoCom?: FonteComplementacao[];
}

/** Proveniência de uma complementação: que fonte, que campos, quando coletado. */
export interface FonteComplementacao {
  source: string;
  campos: string[];
  coletadoEm: string;
}

export type CnpjLookupFailure = {
  ok: false;
  source: string;
  errorType:
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "TIMEOUT"
    | "NETWORK_ERROR"
    | "SERVER_ERROR"
    | "INVALID_RESPONSE";
  message: string;
  /** true = a fonte NÃO foi consultada (backoff 429 recente) — a cadeia pulou honestamente */
  pulada?: boolean;
};

export type CnpjLookupResult = CnpjLookupSuccess | CnpjLookupFailure;

const TIMEOUT_MS = 8_000;

// backoff por fonte em memória: epoch ms até o qual a fonte é evitada + motivo que a
// colocou em cooldown (G10-2: a mensagem de "pulada" cita a causa REAL — 429, erro
// 5xx ou timeout — em vez de dizer sempre "429 recente").
interface BackoffState {
  until: number;
  motivo: string;
}
const g = globalThis as unknown as { __cnpjSourceBackoff?: Map<string, BackoffState> };
g.__cnpjSourceBackoff ??= new Map<string, BackoffState>();
const backoff = g.__cnpjSourceBackoff;

function noteBackoff(source: string, ms: number, motivo: string) {
  const until = Date.now() + ms;
  const current = backoff.get(source);
  if (!current || until > current.until) backoff.set(source, { until, motivo });
}

export function isSourceCoolingDown(source: string): boolean {
  return (backoff.get(source)?.until ?? 0) > Date.now();
}

/** Motivo (texto curto) pelo qual a fonte está em cooldown; "" se não está. */
export function motivoBackoff(source: string): string {
  const b = backoff.get(source);
  return b && b.until > Date.now() ? b.motivo : "";
}

function pick(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

/** Igual a pick, mas trata "0" (ex.: motivo_situacao=0) como vazio. */
function pickNonZero(obj: Record<string, unknown>, ...keys: string[]): string {
  const v = pick(obj, ...keys);
  if (v === "" || v === "0") return "";
  const n = Number(v);
  return Number.isFinite(n) && n === 0 ? "" : v;
}

function optFlag(v: string): string {
  if (v === "") return "";
  return /^true$/i.test(v) || v === "true" ? "Sim" : /^false$/i.test(v) || v === "false" ? "Não" : v;
}

/**
 * Identificador matriz/filial OFICIAL. Regra: campo numérico identificador_matriz_filial
 * (1=matriz, 2=filial) quando existir; caso contrário, deriva do texto oficial
 * ("MATRIZ"/"Matriz" → 1, "FILIAL"/"Filial" → 2). Nunca usa o sufixo do CNPJ.
 */
function parseBranchIdentifier(j: Record<string, unknown>, branchTypeText: string): number | null {
  const raw = j.identificador_matriz_filial;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    const n = Number(raw);
    if (n === 1 || n === 2) return n;
  }
  const t = branchTypeText.trim().toUpperCase();
  if (t === "MATRIZ") return 1;
  if (t === "FILIAL") return 2;
  return null;
}

/** QSA tolerante: BrasilAPI/OpenCNPJ (nome/razao_social) e ReceitaWS (nome).
 *  ATENÇÃO: OpenCNPJ retorna a chave em MAIÚSCULAS ("QSA") — sem isso perdemos
 *  o quadro societário quando BrasilAPI falha e a cadeia cai na segunda fonte.
 *  v0.10.0 (P1): SEM corte silencioso de 30 — o quadro entra COMPLETO
 *  (teto de segurança 500 só contra dado patológico; teia societária corta só na exibição).
 *  v0.10.1: quando o teto trunca, a resposta diz EXPLICITAMENTE que a lista está
 *  incompleta (qsaTruncados) — nada de corte invisível. */
function parseQsa(j: Record<string, unknown>): { socios: CnpjSocio[]; truncado: boolean } {
  const list =
    j.qsa ??
    j.QSA ??
    j.qsos ??
    j.QSOS ??
    j.socios ??
    j.SOCIOS;
  if (!Array.isArray(list)) return { socios: [], truncado: false };
  const out: CnpjSocio[] = [];
  for (const raw of list.slice(0, 500)) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const nome = pick(s, "nome", "razao_social", "nome_socio");
    if (!nome) continue;
    out.push({
      nome: nome.slice(0, 120),
      qual: pick(s, "qual", "qualificacao_socio", "qualificacao").slice(0, 80),
      entrada: pick(s, "entrada", "data_entrada", "data_entrada_sociedade").slice(0, 20),
    });
  }
  return { socios: out, truncado: list.length > 500 };
}

/** Telefone público legível: "6134939002" → "(61) 3493-9002". Digits-agnostic. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return raw.trim();
}

/**
 * Forma de tributação mais recente do histórico regime_tributario
 * (BrasilAPI/MinhaReceita — FONTE AGREGADORA — devolvem [{ano, forma_de_tributacao}]
 * em ordem crescente). Fase 1.2: é informação FISCAL histórica, não confirmação da
 * operação vigente — o valor carrega o EXERCÍCIO da referência e o rótulo do que é.
 * Tolerante a string simples. "" quando não há dado — falha NUNCA lança.
 * PROIBIDO inferir porte/faturamento a partir do regime.
 */
function parseRegimeTributario(j: Record<string, unknown>): string {
  const arr = j.regime_tributario;
  if (Array.isArray(arr)) {
    const rows = arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((r) => ({ ano: Number(r.ano) || 0, forma: pick(r, "forma_de_tributacao", "forma_tributacao") }))
      .filter((r) => r.forma !== "")
      .sort((a, b) => a.ano - b.ano);
    if (rows.length > 0) {
      const last = rows[rows.length - 1];
      const ano = last.ano > 0 ? String(last.ano) : "ano não informado pela fonte";
      return `${last.forma.slice(0, 40)} (exercício ${ano}, informação fiscal de fonte agregada — não confirma operação vigente)`.slice(0, 160);
    }
  }
  return typeof arr === "string" ? arr.slice(0, 40) : "";
}

function parseExtra(j: Record<string, unknown>): CnpjExtra {
  const cnaes = Array.isArray(j.cnaes_secundarios)
    ? (j.cnaes_secundarios as Record<string, unknown>[])
    : Array.isArray(j.atividades_secundarias)
      ? (j.atividades_secundarias as Record<string, unknown>[])
      : [];
  // v0.10.0 (P1): preserva o CÓDIGO junto à descrição e NÃO corta em 15 silenciosamente
  // (teto de segurança 200 + flag cnaesTruncados quando atinge).
  const cnaesComCodigo = cnaes
    .map((c) => {
      const codigo = pick(c, "codigo", "subclasse", "code").trim();
      const descricao = pick(c, "descricao", "text").trim();
      if (codigo && descricao) return `${codigo} — ${descricao}`.slice(0, 160);
      return (descricao || codigo).slice(0, 160);
    })
    .filter((s) => s.length > 0);
  const cnaesSecundarios = cnaesComCodigo.slice(0, 200);
  const cnaesTruncados = cnaesComCodigo.length > 200;

  const endereco = [
    pick(j, "descricao_tipo_de_logradouro", "tipo_logradouro"),
    pick(j, "logradouro"),
    pick(j, "numero"),
    pick(j, "complemento"),
    pick(j, "bairro"),
  ]
    .filter((s) => s.length > 0)
    .join(" ")
    .slice(0, 180);

  return {
    capitalSocial: pick(j, "capital_social").slice(0, 40),
    naturezaJuridica: pick(j, "natureza_juridica").slice(0, 120),
    porte: pick(j, "descricao_porte", "porte").slice(0, 60),
    simples: optFlag(pick(j, "opcao_simples", "opcao_pelo_simples")),
    mei: optFlag(pick(j, "opcao_mei", "opcao_pelo_mei")),
    email: pick(j, "email").slice(0, 120),
    telefone: formatPhone(pick(j, "ddd_telefone_1", "telefone1", "telefone")),
    telefone2: formatPhone(pick(j, "ddd_telefone_2", "telefone2")),
    regimeTributario: parseRegimeTributario(j),
    endereco,
    cnaesSecundarios,
    cnaesTruncados,
    codigoMunicipioIbge: pick(j, "codigo_municipio_ibge", "codigo_ibge_municipio").slice(0, 10),
    ibge: null,
  };
}

/** Subconjunto curado da resposta para auditoria (JSON válido e pequeno). */
function auditSubset(source: string, cnpj: string, j: Record<string, unknown>): string {
  const keys = [
    "cnpj", "razao_social", "nome_fantasia", "nome", "fantasia", "descricao_situacao_cadastral",
    "situacao_cadastral", "data_situacao", "motivo_situacao_cadastral", "motivo_situacao",
    "descricao_identificador_matriz_filial", "data_inicio_atividade", "abertura", "cnae_fiscal",
    "cnae_fiscal_descricao", "municipio", "uf", "tipo", "status", "message",
    "capital_social", "natureza_juridica", "descricao_porte", "opcao_simples", "opcao_mei", "email",
    "ddd_telefone_1", "ddd_telefone_2", "codigo_municipio_ibge",
  ];
  const subset: Record<string, unknown> = { _fonte: source, _consultado_em: new Date().toISOString() };
  for (const k of keys) {
    if (j[k] !== undefined) subset[k] = j[k];
  }
  const qsa = parseQsa(j);
  if (qsa.socios.length > 0) subset.qsa_resumo = qsa.socios.slice(0, 10);
  if (qsa.truncado) subset.qsa_truncado = true;
  return JSON.stringify(subset).slice(0, 4000);
}

async function fetchJson(url: string, source: string): Promise<
  { ok: true; status: number; json: Record<string, unknown> } | CnpjLookupFailure
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  const tel = (estado: "sucesso" | "falha" | "bloqueado", extra: { httpStatus?: number; erro?: string }) => {
    recordTelemetry({
      tipo: "COLETA_CADASTRO",
      fonte: source,
      operacao: "cadastro_cnpj",
      alvo: url,
      httpStatus: extra.httpStatus ?? null,
      erro: extra.erro ?? null,
      tentativas: 1,
      cacheHit: false,
      resultados: estado === "sucesso" ? 1 : 0,
      duracaoMs: Date.now() - t0,
      estadoFinal: estado,
    });
  };
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "CNPJ-Enrich-MVP/1.0 (deterministico; uso interno)",
      },
      cache: "no-store",
    });
    if (res.status === 429) {
      noteBackoff(source, 30_000, "429");
      tel("bloqueado", { httpStatus: res.status, erro: "429 — limite de requisições; fonte em backoff" });
      return { ok: false, source, errorType: "RATE_LIMITED", message: "429 — limite de requisições; fonte em backoff" };
    }
    if (res.status === 404) {
      tel("falha", { httpStatus: res.status, erro: "404 — CNPJ não encontrado nesta fonte" });
      return { ok: false, source, errorType: "NOT_FOUND", message: "404 — CNPJ não encontrado nesta fonte" };
    }
    if (res.status >= 500) {
      noteBackoff(source, 10_000, `erro ${res.status}`);
      tel("falha", { httpStatus: res.status, erro: `${res.status} — erro do servidor da fonte` });
      return { ok: false, source, errorType: "SERVER_ERROR", message: `${res.status} — erro do servidor da fonte` };
    }
    if (!res.ok) {
      tel("falha", { httpStatus: res.status, erro: `HTTP ${res.status} inesperado` });
      return { ok: false, source, errorType: "SERVER_ERROR", message: `HTTP ${res.status} inesperado` };
    }
    const json = (await res.json()) as Record<string, unknown>;
    tel("sucesso", { httpStatus: res.status });
    return { ok: true, status: res.status, json };
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      noteBackoff(source, 15_000, "timeout");
      tel("falha", { erro: `Timeout após ${TIMEOUT_MS / 1000}s` });
      return { ok: false, source, errorType: "TIMEOUT", message: `Timeout após ${TIMEOUT_MS / 1000}s` };
    }
    const msg = err instanceof Error ? err.message : "Falha de rede desconhecida";
    tel("falha", { erro: msg });
    return {
      ok: false,
      source,
      errorType: "NETWORK_ERROR",
      message: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- BrasilAPI ---------------- */

export async function lookupBrasilApi(cnpj: string): Promise<CnpjLookupResult> {
  const source = "BrasilAPI";
  const r = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, source);
  if (!r.ok) return r;
  const j = r.json;
  const qsaBrasil = parseQsa(j);
  const data: CnpjLookupData = {
    legalName: pick(j, "razao_social"),
    tradeName: pick(j, "nome_fantasia"),
    registrationStatus: pick(j, "descricao_situacao_cadastral"),
    statusDate: pick(j, "data_situacao"),
    situationReason: pickNonZero(j, "motivo_situacao_cadastral"),
    branchType: pick(j, "descricao_identificador_matriz_filial"),
    openingDate: pick(j, "data_inicio_atividade"),
    cnaeCode: pick(j, "cnae_fiscal"),
    cnaeDescription: pick(j, "cnae_fiscal_descricao"),
    municipality: pick(j, "municipio"),
    uf: pick(j, "uf"),
    branchIdentifier: null,
    socios: qsaBrasil.socios,
    extra: { ...parseExtra(j), qsaTruncados: qsaBrasil.truncado || undefined },
  };
  data.branchIdentifier = parseBranchIdentifier(j, data.branchType);
  if (!data.legalName) {
    return { ok: false, source, errorType: "INVALID_RESPONSE", message: "Resposta sem razao_social" };
  }
  return { ok: true, source, data, rawJson: auditSubset(source, cnpj, j), queriedAt: new Date().toISOString() };
}

/* ---------------- OpenCNPJ ---------------- */

export async function lookupOpenCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const source = "OpenCNPJ";
  const r = await fetchJson(`https://api.opencnpj.org/${cnpj}`, source);
  if (!r.ok) return r;
  const j = r.json;
  if (j.status && Number(j.status) >= 400) {
    return { ok: false, source, errorType: "NOT_FOUND", message: pick(j, "message", "erro") || "não encontrado" };
  }
  const qsaOpen = parseQsa(j);
  const data: CnpjLookupData = {
    legalName: pick(j, "razao_social"),
    tradeName: pick(j, "nome_fantasia"),
    registrationStatus: pick(j, "descricao_situacao_cadastral", "situacao_cadastral"),
    statusDate: pick(j, "data_situacao"),
    situationReason: pickNonZero(j, "motivo_situacao_cadastral"),
    branchType: pick(j, "descricao_identificador_matriz_filial"),
    openingDate: pick(j, "data_inicio_atividade"),
    cnaeCode: pick(j, "cnae_fiscal"),
    cnaeDescription: pick(j, "cnae_fiscal_descricao"),
    municipality: pick(j, "municipio"),
    uf: pick(j, "uf"),
    branchIdentifier: null,
    socios: qsaOpen.socios,
    extra: { ...parseExtra(j), qsaTruncados: qsaOpen.truncado || undefined },
  };
  data.branchIdentifier = parseBranchIdentifier(j, data.branchType);
  if (!data.legalName) {
    return { ok: false, source, errorType: "INVALID_RESPONSE", message: "Resposta sem razao_social" };
  }
  return { ok: true, source, data, rawJson: auditSubset(source, cnpj, j), queriedAt: new Date().toISOString() };
}

/* ---------------- ReceitaWS ---------------- */

export async function lookupReceitaWs(cnpj: string): Promise<CnpjLookupResult> {
  const source = "ReceitaWS";
  const r = await fetchJson(`https://receitaws.com.br/v1/cnpj/${cnpj}`, source);
  if (!r.ok) return r;
  const j = r.json;
  const status = pick(j, "status");
  if (status === "ERROR") {
    const msg = pick(j, "message");
    const t = /not found|não encontrado/i.test(msg) ? "NOT_FOUND" : "INVALID_RESPONSE";
    return { ok: false, source, errorType: t, message: msg || "erro reportado pela fonte" };
  }
  const atividades = Array.isArray(j.atividade_principal)
    ? (j.atividade_principal as Record<string, unknown>[])[0] ?? {}
    : {};
  const qsaWs = parseQsa(j);
  const data: CnpjLookupData = {
    legalName: pick(j, "nome"),
    tradeName: pick(j, "fantasia"),
    registrationStatus: pick(j, "situacao"),
    statusDate: pick(j, "data_situacao"),
    situationReason: pickNonZero(j, "motivo_situacao"),
    branchType: pick(j, "tipo"),
    openingDate: pick(j, "abertura"),
    cnaeCode: pick(atividades, "code"),
    cnaeDescription: pick(atividades, "text"),
    municipality: pick(j, "municipio"),
    uf: pick(j, "uf"),
    branchIdentifier: null,
    socios: qsaWs.socios,
    extra: { ...parseExtra(j), qsaTruncados: qsaWs.truncado || undefined },
  };
  data.branchIdentifier = parseBranchIdentifier(j, data.branchType);
  if (!data.legalName) {
    return { ok: false, source, errorType: "INVALID_RESPONSE", message: "Resposta sem nome (razão social)" };
  }
  return { ok: true, source, data, rawJson: auditSubset(source, cnpj, j), queriedAt: new Date().toISOString() };
}

/* ---------------- MinhaReceita (4º fallback — espelho dos dados abertos da Receita) ---------------- */

/**
 * minhareceita.org — espelho público dos dados abertos da Receita, sem auth e sem
 * cota conhecida. Formato idêntico ao BrasilAPI (mesmos nomes de campo) mas com
 * EXTRAS que alimentam o dossiê: ddd_telefone_2, regime_tributario (histórico com ano),
 * codigo_municipio_ibge, situacao_especial. É a 4ª chance de resgate quando as três
 * primeiras fontes falham (cada uma tem limite próprio).
 */
export async function lookupMinhaReceita(cnpj: string): Promise<CnpjLookupResult> {
  const source = "MinhaReceita";
  const r = await fetchJson(`https://minhareceita.org/${cnpj}`, source);
  if (!r.ok) return r;
  const j = r.json;
  const qsaMr = parseQsa(j);
  const data: CnpjLookupData = {
    legalName: pick(j, "razao_social"),
    tradeName: pick(j, "nome_fantasia"),
    registrationStatus: pick(j, "descricao_situacao_cadastral"),
    statusDate: pick(j, "data_situacao_cadastral"),
    situationReason: pickNonZero(j, "descricao_motivo_situacao_cadastral"),
    branchType: pick(j, "descricao_identificador_matriz_filial"),
    openingDate: pick(j, "data_inicio_atividade"),
    cnaeCode: pick(j, "cnae_fiscal"),
    cnaeDescription: pick(j, "cnae_fiscal_descricao"),
    municipality: pick(j, "municipio"),
    uf: pick(j, "uf"),
    branchIdentifier: null,
    socios: qsaMr.socios,
    extra: { ...parseExtra(j), qsaTruncados: qsaMr.truncado || undefined },
  };
  data.branchIdentifier = parseBranchIdentifier(j, data.branchType);
  if (!data.legalName) {
    return { ok: false, source, errorType: "INVALID_RESPONSE", message: "Resposta sem razao_social" };
  }
  return { ok: true, source, data, rawJson: auditSubset(source, cnpj, j), queriedAt: new Date().toISOString() };
}

/* ---------------- OpenCaramelo (kitana.opencnpj.com — APENAS comparativo P2) ---------------- */

/**
 * OpenCaramelo (opencnpj.com — NÃO confundir com api.opencnpj.org usado na cadeia).
 * Endpoint real verificado: https://kitana.opencnpj.com/cnpj/{cnpj} (sem auth; doc:
 * https://opencnpj.com/api). Formato PRÓPRIO (razaoSocial, matriz:"Sim", dd/mm/aaaa).
 * NÃO está na cadeia padrão: entra no comparativo de provedores (P2) para medir
 * cobertura/latência/429 antes de qualquer decisão de adoção.
 */
export async function lookupOpenCaramelo(cnpj: string): Promise<CnpjLookupResult> {
  const source = "OpenCaramelo";
  const r = await fetchJson(`https://kitana.opencnpj.com/cnpj/${cnpj}`, source);
  if (!r.ok) return r;
  const j = r.json;
  const d = (j.data ?? {}) as Record<string, unknown>;
  const sucesso = j.success === true;
  if (!sucesso) {
    const msg = pick(j, "message") || "não encontrado no OpenCaramelo";
    return { ok: false, source, errorType: "NOT_FOUND", message: msg };
  }
  const matrizSim = String(d.matriz ?? "").toUpperCase() === "SIM";
  const cnaes = Array.isArray(d.cnaes) ? (d.cnaes as Record<string, unknown>[]) : [];
  const socios = Array.isArray(d.socios) ? (d.socios as Record<string, unknown>[]) : [];
  const data: CnpjLookupData = {
    legalName: pick(d, "razaoSocial"),
    tradeName: pick(d, "nomeFantasia"),
    registrationStatus: pick(d, "situacaoCadastral"),
    statusDate: pick(d, "dataSituacaoCadastral"),
    situationReason: pickNonZero(d, "motivoSituacaoCadastral", "motivoSituacao"),
    branchType: matrizSim ? "MATRIZ" : "FILIAL",
    openingDate: pick(d, "dataInicioAtividades"),
    cnaeCode: pick(cnaes[0] ?? {}, "cnae"),
    cnaeDescription: pick(cnaes[0] ?? {}, "descricao"),
    municipality: pick(d, "municipio"),
    uf: pick(d, "uf"),
    branchIdentifier: matrizSim ? 1 : 2,
    socios: socios
      .slice(0, 500)
      .map((s) => ({
        nome: pick(s, "nomeSocio").slice(0, 120),
        qual: pick(s, "descricao").slice(0, 80),
        entrada: pick(s, "dataEntradaSociedade").slice(0, 20),
      }))
      .filter((s) => s.nome.length > 0),
    extra: {
      capitalSocial: pick(d, "capitalSocial").slice(0, 40),
      naturezaJuridica: pick(d, "naturezaJuridica").slice(0, 120),
      porte: pick(d, "porte"),
      simples: optFlag(String(d.opcaoSimples ?? "").toLowerCase() === "s" ? "true" : String(d.opcaoSimples ?? "").toLowerCase() === "n" ? "false" : ""),
      mei: optFlag(String(d.opcaoMei ?? "").toLowerCase() === "s" ? "true" : String(d.opcaoMei ?? "").toLowerCase() === "n" ? "false" : ""),
      email: pick(d, "email").slice(0, 120),
      telefone: formatPhone(pick(d, "telefone")),
      telefone2: "",
      regimeTributario: "",
      endereco: [
        pick(d, "logradouro"),
        pick(d, "numero"),
        pick(d, "complemento"),
        pick(d, "bairro"),
      ]
        .filter((s) => s.length > 0)
        .join(" ")
        .slice(0, 180),
      cnaesSecundarios: cnaes
        .slice(1, 200)
        .map((c) => {
          const codigo = pick(c, "cnae").trim();
          const descricao = pick(c, "descricao").trim();
          return codigo && descricao ? `${codigo} — ${descricao}`.slice(0, 160) : (descricao || codigo).slice(0, 160);
        })
        .filter((s) => s.length > 0),
      codigoMunicipioIbge: "",
      /** v0.10.1: OpenCaramelo também sinaliza QSA truncado pelo teto de segurança */
      qsaTruncados: socios.length > 500 || undefined,
      ibge: null,
    },
  };
  if (!data.legalName) {
    return { ok: false, source, errorType: "INVALID_RESPONSE", message: "Resposta sem razaoSocial" };
  }
  return { ok: true, source, data, rawJson: JSON.stringify({ _fonte: source, _consultado_em: new Date().toISOString(), ...d }).slice(0, 4000), queriedAt: new Date().toISOString() };
}

/* ---------------- Cadeia: fallback + backoff efetivo + complementação seletiva ---------------- */

export interface ChainOutcome {
  result: CnpjLookupResult | null; // null = todas as fontes falharam/puladas
  attempts: CnpjLookupResult[];
  /** fontes consultadas DEPOIS da primária para preencher lacunas (P2) */
  complementacoes: FonteComplementacao[];
  /** v0.10.1: fontes PULADAS sem HTTP porque nenhuma lacuna restante era preenchível
   *  por elas (portão de capacidade) — auditado e telemetrado, nunca silencioso */
  fontesPuladasCapacidade: string[];
}

const CHAIN: { fonte: string; fn: (cnpj: string) => Promise<CnpjLookupResult> }[] = [
  { fonte: "BrasilAPI", fn: lookupBrasilApi },
  { fonte: "OpenCNPJ", fn: lookupOpenCnpj },
  { fonte: "ReceitaWS", fn: lookupReceitaWs },
  { fonte: "MinhaReceita", fn: lookupMinhaReceita },
];

/**
 * Lacunas RELEVANTES da ficha — o que justifica consultar uma fonte complementar.
 * Identidade (razão social, situação, município/UF, CNAE principal, tipo) NÃO entra:
 * vem da fonte primária e não é sobrescrito por ninguém (estabilidade da identidade).
 */
export function gapsOf(d: CnpjLookupData): string[] {
  const g: string[] = [];
  if (!d.tradeName) g.push("nomeFantasia");
  if (!d.extra.email) g.push("email");
  if (!d.extra.telefone && !d.extra.telefone2) g.push("telefone");
  if (!d.extra.capitalSocial) g.push("capitalSocial");
  if (!d.extra.naturezaJuridica) g.push("naturezaJuridica");
  if (!d.extra.porte) g.push("porte");
  if (!d.extra.simples) g.push("simples");
  if (!d.extra.mei) g.push("mei");
  if (!d.extra.regimeTributario) g.push("regimeTributario");
  if (!d.extra.endereco) g.push("endereco");
  if (d.socios.length === 0) g.push("qsa");
  if (d.extra.cnaesSecundarios.length === 0) g.push("cnaesSecundarios");
  if (!d.extra.codigoMunicipioIbge) g.push("codigoMunicipioIbge");
  if (!d.statusDate) g.push("dataSituacao");
  return g;
}

/** Preenche SOMENTE campos vazios de `base` com valores não vazios de `fill`.
 *  Exportado (v0.10.1) para a medição de eficiência usar a MESMA função da cadeia. */
export function fillGaps(base: CnpjLookupData, fill: CnpjLookupData): { merged: CnpjLookupData; campos: string[] } {
  const campos: string[] = [];
  const merged: CnpjLookupData = {
    ...base,
    extra: { ...base.extra },
    socios: base.socios.length > 0 ? base.socios : fill.socios.length > 0 ? fill.socios : [],
  };
  if (!base.tradeName && fill.tradeName) { merged.tradeName = fill.tradeName; campos.push("nomeFantasia"); }
  if (!base.extra.email && fill.extra.email) { merged.extra.email = fill.extra.email; campos.push("email"); }
  if (!base.extra.telefone && fill.extra.telefone) { merged.extra.telefone = fill.extra.telefone; campos.push("telefone"); }
  if (!base.extra.telefone2 && fill.extra.telefone2) { merged.extra.telefone2 = fill.extra.telefone2; campos.push("telefone2"); }
  if (!base.extra.capitalSocial && fill.extra.capitalSocial) { merged.extra.capitalSocial = fill.extra.capitalSocial; campos.push("capitalSocial"); }
  if (!base.extra.naturezaJuridica && fill.extra.naturezaJuridica) { merged.extra.naturezaJuridica = fill.extra.naturezaJuridica; campos.push("naturezaJuridica"); }
  if (!base.extra.porte && fill.extra.porte) { merged.extra.porte = fill.extra.porte; campos.push("porte"); }
  if (!base.extra.simples && fill.extra.simples) { merged.extra.simples = fill.extra.simples; campos.push("simples"); }
  if (!base.extra.mei && fill.extra.mei) { merged.extra.mei = fill.extra.mei; campos.push("mei"); }
  if (!base.extra.regimeTributario && fill.extra.regimeTributario) { merged.extra.regimeTributario = fill.extra.regimeTributario; campos.push("regimeTributario"); }
  if (!base.extra.endereco && fill.extra.endereco) { merged.extra.endereco = fill.extra.endereco; campos.push("endereco"); }
  if (base.socios.length === 0 && fill.socios.length > 0) {
    campos.push("qsa");
    // v0.10.1: o flag de truncamento do QSA viaja com os sócios (sem flag perdido)
    if (fill.extra.qsaTruncados) merged.extra.qsaTruncados = true;
  }
  if (base.extra.cnaesSecundarios.length === 0 && fill.extra.cnaesSecundarios.length > 0) {
    merged.extra.cnaesSecundarios = fill.extra.cnaesSecundarios;
    merged.extra.cnaesTruncados = fill.extra.cnaesTruncados;
    campos.push("cnaesSecundarios");
  }
  if (!base.extra.codigoMunicipioIbge && fill.extra.codigoMunicipioIbge) {
    merged.extra.codigoMunicipioIbge = fill.extra.codigoMunicipioIbge;
    campos.push("codigoMunicipioIbge");
  }
  if (!base.statusDate && fill.statusDate) { merged.statusDate = fill.statusDate; campos.push("dataSituacao"); }
  return { merged, campos };
}

/**
 * v0.10.1 — MAPA DE CAPACIDADES por fonte (portão de eficiência).
 * Campos (chaves de gapsOf) que CADA fonte da cadeia tem como preencher, segundo
 * o ESQUEMA de resposta de cada API (chaves que o mapeador lê) e confirmado na
 * amostra real de 16 respostas (qa/eficiencia-cadeia-v0.10.1.json — 4 CNPJs × 4 fontes).
 * POLÍTICA CONSERVADORA: na dúvida (esquema incerto), a capacidade é MANTIDA — o
 * portão só pula uma fonte quando é PROVÁVEL que ela não trará nenhuma lacuna restante;
 * perda de campo é pior do que uma consulta a mais.
 */
export const CAMPOS_POR_FONTE: Record<string, Set<string>> = {
  // BrasilAPI: espelho completo do cadastro; NÃO traz ddd_telefone_2 (telefone é um
  // campo só) e o regime tributário aparece só para parte das empresas — capacidade mantida.
  BrasilAPI: new Set([
    "nomeFantasia", "email", "telefone", "capitalSocial", "naturezaJuridica", "porte",
    "simples", "mei", "regimeTributario", "endereco", "qsa", "cnaesSecundarios",
    "codigoMunicipioIbge", "dataSituacao",
  ]),
  // OpenCNPJ(.org): NÃO expõe ddd_telefone_2 nem codigo_municipio_ibge no esquema
  // público (0/4 na amostra); regime tributário ausente (0/4).
  OpenCNPJ: new Set([
    "nomeFantasia", "email", "telefone", "capitalSocial", "naturezaJuridica", "porte",
    "simples", "mei", "endereco", "qsa", "cnaesSecundarios", "dataSituacao",
  ]),
  // ReceitaWS (gratuito): NÃO traz codigo_municipio_ibge, regime_tributario nem
  // opcao_simples/opcao_mei no esquema público (0/4 na amostra; chaves ausentes na resposta).
  ReceitaWS: new Set([
    "nomeFantasia", "email", "telefone", "capitalSocial", "naturezaJuridica", "porte",
    "endereco", "qsa", "cnaesSecundarios", "dataSituacao",
  ]),
  // MinhaReceita: a mais completa — tudo, inclusive regime tributário histórico e
  // codigo_municipio_ibge (e-mail existe no esquema; vazio é dado ausente, não capacidade).
  MinhaReceita: new Set([
    "nomeFantasia", "email", "telefone", "capitalSocial", "naturezaJuridica", "porte",
    "simples", "mei", "regimeTributario", "endereco", "qsa", "cnaesSecundarios",
    "codigoMunicipioIbge", "dataSituacao",
  ]),
};

/**
 * Cadeia v0.10.0 + PORTÃO DE CAPACIDADE v0.10.1:
 * 1. BACKOFF EFETIVO (P1): cada fonte é consultada SOMENTE se não estiver em pausa
 *    pós-429. Fonte em backoff entra nos attempts como RATE_LIMITED/pulada — honesto,
 *    sem requisição. Se TODAS pularem, o resultado final é RATE_LIMITED (retomada
 *    natural quando o backoff expira — 30s — em linhas seguintes ou retry).
 * 2. COMPLEMENTAÇÃO SELETIVA (P2): a 1ª fonte que responde define a IDENTIDADE.
 *    Fontes seguintes só são consultadas se houver lacuna relevante (gapsOf) e
 *    preenchem APENAS campos vazios (fillGaps) — sem reconsultar tudo, sem
 *    sobrescrever identidade. Cada preenchimento registra fonte/campos/data.
 * 3. PORTÃO DE CAPACIDADE (v0.10.1): a caminhada para QUANDO nenhuma lacuna restante
 *    é preenchível pelas fontes seguintes (evita consultar tudo atrás de campo que
 *    nenhuma delas tem) e pula individualmente a fonte que não pode tratar nenhuma
 *    lacuna atual — SEM descartar campos que a fonte pudesse trazer. Cada pulo é
 *    registrado em fontesPuladasCapacidade (auditoria + telemetria, nunca silêncio).
 */
export async function enrichCnpj(cnpjDigits: string, opts: { complementar?: boolean } = {}): Promise<ChainOutcome> {
  const complementar = opts.complementar !== false;
  const attempts: CnpjLookupResult[] = [];
  const complementacoes: FonteComplementacao[] = [];
  const fontesPuladasCapacidade: string[] = [];

  // etapa 1: fonte primária (identidade)
  let primaria: CnpjLookupSuccess | null = null;
  let indicePrimaria = -1;
  for (let i = 0; i < CHAIN.length; i++) {
    const { fonte, fn } = CHAIN[i];
    if (isSourceCoolingDown(fonte)) {
      attempts.push({
        ok: false,
        source: fonte,
        errorType: "RATE_LIMITED",
        message: `pulada: fonte em backoff por ${motivoBackoff(fonte) || "falha"} recente`,
        pulada: true,
      });
      continue;
    }
    const r = await fn(cnpjDigits);
    attempts.push(r);
    if (r.ok) {
      primaria = r;
      indicePrimaria = i;
      break;
    }
  }

  if (!primaria) return { result: null, attempts, complementacoes, fontesPuladasCapacidade };
  if (!complementar) return { result: primaria, attempts, complementacoes, fontesPuladasCapacidade };

  // etapa 2: complementação por lacuna, com portão de capacidade
  const podePreencher = (fonte: string, gaps: string[]): string[] => {
    const cap = CAMPOS_POR_FONTE[fonte];
    if (!cap) return gaps; // fonte desconhecida ao mapa → conservador: pode tudo
    return gaps.filter((g) => cap.has(g));
  };
  const caudaAindaUtil = (i: number, gaps: string[]): boolean => {
    for (let j = i; j < CHAIN.length; j++) {
      if (podePreencher(CHAIN[j].fonte, gaps).length > 0) return true;
    }
    return false;
  };

  let atual = primaria.data;
  let gaps = gapsOf(atual);
  for (let i = indicePrimaria + 1; i < CHAIN.length; i++) {
    if (gaps.length === 0) break; // ficha completa — nada a complementar
    if (!caudaAindaUtil(i, gaps)) {
      // v0.10.1: lacunas restantes que NINGUÉM na cauda preenche → parar SEM HTTP.
      // As lacunas ficam registradas como lacunas (honestas) — não geram consultas
      // repetidas por campos que nenhuma fonte consegue fornecer.
      break;
    }
    const { fonte, fn } = CHAIN[i];
    if (isSourceCoolingDown(fonte)) {
      attempts.push({
        ok: false,
        source: fonte,
        errorType: "RATE_LIMITED",
        message: `pulada: fonte em backoff por ${motivoBackoff(fonte) || "falha"} recente (lacunas: ${gaps.slice(0, 4).join(", ")})`,
        pulada: true,
      });
      continue;
    }
    if (podePreencher(fonte, gaps).length === 0) {
      // v0.10.1: esta fonte não tem como preencher NENHUMA lacuna atual — pulada
      // sem requisição (fontes seguintes ainda podem ser úteis).
      fontesPuladasCapacidade.push(fonte);
      continue;
    }
    const r = await fn(cnpjDigits);
    attempts.push(r);
    if (!r.ok) continue;
    const { merged, campos } = fillGaps(atual, r.data);
    if (campos.length > 0) {
      atual = merged;
      complementacoes.push({ source: fonte, campos, coletadoEm: r.queriedAt });
      gaps = gapsOf(atual);
    }
  }

  const result: CnpjLookupSuccess = complementacoes.length > 0 ? { ...primaria, data: atual, completadoCom: complementacoes } : primaria;
  return { result, attempts, complementacoes, fontesPuladasCapacidade };
}
