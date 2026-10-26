/**
 * ENTITY_BINDING — vínculo entre evidência e entidade (contrato Senior Scout 360).
 *
 * REGRA CENTRAL: validar que um CNPJ EXISTE (BrasilAPI/OpenCNPJ/ReceitaWS) NÃO valida
 * que ele corresponde à empresa buscada. Antes de promover qualquer CNPJ a candidato,
 * o resolvedor precisa responder: "o que nesta fonte prova que ESTE CNPJ representa
 * a entidade procurada?" Se a resposta for apenas "o termo apareceu nessa página",
 * o vínculo não existe.
 *
 * Bug corrigido (golden case "sementes carolina"):
 *   query "sementes carolina" → página do Mercado Livre sobre "sementes carolina cross"
 *   → CNPJ do publisher extraído do snippet → virava "candidato". Logicamente inválido:
 *   o dono da página (marketplace, notícia, classificado, Câmara dos Deputados…) NÃO é
 *   a entidade buscada. Todo CNPJ com binding PAGE_OWNER_ONLY ou UNRELATED é descartado.
 *
 * Gate mínimo para candidato:
 *   - 1 evidência FORTE (site oficial · divulgação legal · registrante do domínio ·
 *     registro governamental com nome+local), OU
 *   - 2 evidências MODERADAS independentes (telefone, domínio de e-mail, endereço,
 *     diretório empresarial).
 *   - FRACA sozinha não gera candidato; INVALIDA descarta na hora.
 *   - É melhor UNRESOLVED do que candidato contaminado.
 */

import { plural } from "@/lib/linguagem";

export type BindingType =
  | "OFFICIAL_SITE" // site oficial da pista publica razão social/CNPJ
  | "LEGAL_DISCLOSURE" // página da própria empresa/divulgação legal com nome + CNPJ
  | "DOMAIN_REGISTRANT" // registro.br: CNPJ do registrante do domínio
  | "SAME_PHONE" // telefone do registro oficial coincide com a pista
  | "SAME_EMAIL_DOMAIN" // domínio de e-mail do registro coincide com a pista
  | "SAME_ADDRESS" // endereço do registro coincide com a pista
  | "GOVERNMENT_RECORD" // base oficial (Receita) registra nome+local que correspondem à pista
  | "BUSINESS_DIRECTORY" // diretório empresarial associa o nome da pista a este CNPJ
  | "THIRD_PARTY_MENTION" // menção de terceiros — não gera candidato sozinha
  | "PAGE_OWNER_ONLY" // CNPJ é do dono/publisher da página — SEMPRE descartar
  | "UNRELATED"; // nenhuma relação com a pista — SEMPRE descartar

export type BindingStrength = "FORTE" | "MODERADA" | "FRACA" | "INVALIDA";

/** Força semântica de cada tipo (a evidência pode sobrescrever pós-verificação). */
export const BINDING_STRENGTH: Record<BindingType, BindingStrength> = {
  OFFICIAL_SITE: "FORTE",
  LEGAL_DISCLOSURE: "FORTE",
  DOMAIN_REGISTRANT: "FORTE",
  GOVERNMENT_RECORD: "FORTE",
  SAME_PHONE: "MODERADA",
  SAME_EMAIL_DOMAIN: "MODERADA",
  SAME_ADDRESS: "MODERADA",
  BUSINESS_DIRECTORY: "MODERADA",
  THIRD_PARTY_MENTION: "FRACA",
  PAGE_OWNER_ONLY: "INVALIDA",
  UNRELATED: "INVALIDA",
};

export interface BindingEvidence {
  bindingType: BindingType;
  strength: BindingStrength;
  sourceUrl: string | null;
  /** dono da fonte (host ou razão social do publicador) — nunca é a pista em si */
  sourceOwner: string | null;
  /** entidade mencionada na fonte (título da página, ex.: "Sementes Carolina — CNPJ…") */
  mentionedEntity: string | null;
  /** razão social confirmada na base oficial para o CNPJ (null antes da verificação) */
  candidateLegalName: string | null;
  candidateCnpj: string | null;
  /** texto humano: o que ESTA fonte prova (e o que ela não prova) */
  bindingEvidence: string;
  date: string;
}

export interface DiscardedCandidate {
  cnpj: string | null;
  host: string | null;
  fonte: string | null;
  bindingType: BindingType;
  motivo: string;
}

export function makeBinding(input: {
  bindingType: BindingType;
  strength?: BindingStrength;
  sourceUrl?: string | null;
  sourceOwner?: string | null;
  mentionedEntity?: string | null;
  candidateLegalName?: string | null;
  candidateCnpj?: string | null;
  bindingEvidence: string;
}): BindingEvidence {
  return {
    bindingType: input.bindingType,
    strength: input.strength ?? BINDING_STRENGTH[input.bindingType],
    sourceUrl: input.sourceUrl ?? null,
    sourceOwner: input.sourceOwner ?? null,
    mentionedEntity: input.mentionedEntity ?? null,
    candidateLegalName: input.candidateLegalName ?? null,
    candidateCnpj: input.candidateCnpj ?? null,
    bindingEvidence: input.bindingEvidence,
    date: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Classificação de hosts: o dono da página nunca é a entidade buscada */
/* ------------------------------------------------------------------ */

export type HostKind = "MARKETPLACE" | "SOCIAL" | "CLASSIFIEDS" | "NEWS" | "GOV" | "DIRECTORY" | "COMPANY";

const withSubdomains = (host: string, listed: string): boolean => host === listed || host.endsWith(`.${listed}`);

const MARKETPLACE_HOSTS = [
  "mercadolivre.com.br", "mercadolibre.com", "mercadolibre.com.br", "amazon.com.br", "amazon.com",
  "shopee.com.br", "aliexpress.com", "magalu.com.br", "magazineluiza.com.br", "americanas.com.br",
  "submarino.com.br", "shoptime.com.br", "casasperfeito.com.br", "madeiramadeira.com.br",
  "netshoes.com.br", "centauro.com.br", "shein.com", "shein.com.br", "temu.com", "temu.com.br",
  "carrefour.com.br", "assai.com.br", "enjoei.com.br",
];

const CLASSIFIEDS_HOSTS = [
  "olx.com.br", "mfrural.com.br", "vivareal.com.br", "zapimoveis.com.br", "chavesnamao.com.br",
  "queroquitar.com.br", "imovelweb.com.br", "vivastreet.com.br", "indeed.com", "indeed.com.br",
  "vagas.com.br", "catho.com.br", "gupy.io", "trampos.co", "99freelas.com.br", "workana.com",
];

const SOCIAL_HOSTS = [
  "facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "youtube.com", "x.com",
  "twitter.com", "pinterest.com", "threads.net", "whatsapp.com", "wa.me", "t.me",
];

const NEWS_HOSTS = [
  "g1.globo.com", "globo.com", "gshow.globo.com", "oglobo.globo.com", "r7.com", "uol.com.br",
  "terra.com.br", "estadao.com.br", "folha.uol.com.br", "folha.com.br", "gazetadopovo.com.br",
  "cnnbrasil.com.br", "infomoney.com.br", "exame.com", "forbes.com.br", "abril.com.br",
  "band.uol.com.br", "sbtnews.com.br", "bemparana.com",
];

const DIRECTORY_HOSTS = [
  "casadosdados.com.br", "cnpj.biz", "econodata.com.br", "consultacnpj.com", "cnpja.com",
  "e-cnpj.com", "localizacnpj.com.br", "empresaqui.com.br", "buscacnpj.org", "cnpjbrasil.com",
  "consultasocietaria.com.br", "apontador.com.br", "guiamais.com.br", "telelistas.net",
  "solutudo.com.br", "saibaempresa.com.br", "cnpj.com.br", "encontracnpj.com.br", "guiafacil.com",
];

/** partes de host que não identificam dono (TLDs e prefixos técnicos) */
const TLD_PARTS = new Set([
  "COM", "COMBR", "BR", "NET", "ORG", "ORGBR", "GOV", "GOVBR", "LEG", "LEGBR", "JUS", "JUSBR",
  "EDU", "EDUBR", "MIL", "IND", "BLOG", "WWW", "ECO", "APP", "IO", "CO", "ME", "INFO", "XYZ",
  "ONLINE", "SITE", "STORE", "SHOP", "ECN", "ART", "MUS", "NOT", "NBR", "VIX", "FLA", "FLR",
  "MAT", "EXP", "SRV", "ADM", "ETIC", "TEC", "PSC", "QSL", "PSG",
]);

const DIRECTORY_URL_RE = /\/(cnpj[^/]*|consulta-?cnpj[^/]*|empresa[s]?\/[^/]*\d|empresas\/[^/]*\d)/i;

export function classifyHost(host: string | null | undefined, url?: string | null): HostKind {
  const h = (host ?? "").toLowerCase().replace(/^www\./, "");
  if (!h) return "COMPANY";
  if (h.endsWith(".gov.br") || h.endsWith(".leg.br") || h.endsWith(".jus.br") || h.endsWith(".gov") || h.endsWith(".leg") || h.endsWith(".mil.br")) {
    return "GOV";
  }
  if (DIRECTORY_HOSTS.some((d) => withSubdomains(h, d)) || (url ? DIRECTORY_URL_RE.test(url) : false) || /cnpj/.test(h)) {
    return "DIRECTORY";
  }
  if (MARKETPLACE_HOSTS.some((d) => withSubdomains(h, d))) return "MARKETPLACE";
  if (SOCIAL_HOSTS.some((d) => withSubdomains(h, d))) return "SOCIAL";
  if (CLASSIFIEDS_HOSTS.some((d) => withSubdomains(h, d))) return "CLASSIFIEDS";
  if (NEWS_HOSTS.some((d) => withSubdomains(h, d))) return "NEWS";
  return "COMPANY";
}

/** Hosts em que TODO CNPJ encontrado pertence ao publicador — nunca geram candidato. */
export function isPublisherHost(kind: HostKind): boolean {
  return kind === "MARKETPLACE" || kind === "SOCIAL" || kind === "CLASSIFIEDS" || kind === "NEWS";
}

export function publisherMotivo(kind: HostKind, host: string | null): string {
  const h = host ?? "fonte desconhecida";
  switch (kind) {
    case "MARKETPLACE":
      return `Fonte descartada (${h}): página de marketplace — o CNPJ do site pertence ao marketplace, não à empresa buscada (PAGE_OWNER_ONLY).`;
    case "SOCIAL":
      return `Fonte descartada (${h}): rede social não declara identidade jurídica da empresa buscada (PAGE_OWNER_ONLY).`;
    case "CLASSIFIEDS":
      return `Fonte descartada (${h}): portal de classificados/agregador — o CNPJ do site é do portal, não da empresa buscada (PAGE_OWNER_ONLY).`;
    case "NEWS":
      return `Fonte descartada (${h}): página de notícias — a empresa citada na matéria não é o dono do CNPJ do site (PAGE_OWNER_ONLY).`;
    default:
      return `Fonte descartada (${h}): o CNPJ pertence ao dono da página (PAGE_OWNER_ONLY).`;
  }
}

/* ------------------------------------------------------------------ */
/* Comparação de nomes/hosts                                          */
/* ------------------------------------------------------------------ */

const STOP_TOKENS = new Set([
  "LTDA", "LTD", "SA", "SAA", "ME", "EPP", "EIRELI", "EIREL", "SOCIEDADE", "EMPRESA", "COMERCIO",
  "SERVICOS", "INDUSTRIA", "PARTICIPACOES", "E", "DE", "DA", "DO", "DAS", "DOS",
]);

/** Tokens de comparação: uppercase, sem acento, sem sufixos societários. */
export function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

/** Interseção de tokens (0..1). Serve para GERAR/ORDENAR e para binding por nome. */
export function tokenSimilarity(a: string, b: string): number {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * v0.10.12: correspondência de nome também por CONTENÇÃO do nome achatado (tokens
 * concatenados, sem espaços). Caso real: pista "RAIADROGASIL" × cadastro "RAIA DROGASIL
 * S/A" — a interseção de tokens dá ZERO, mas a pista achatada está contida no cadastro
 * achatado (mesma empresa). Evita divergência falsa em nomes concatenados/split.
 */
export function nomeCorresponde(pista: string, registrado: string): boolean {
  const p = nameTokens(pista).join("").toLowerCase();
  const r = nameTokens(registrado).join("").toLowerCase();
  if (p.length < 4 || r.length < 4) return false;
  return r.includes(p) || p.includes(r);
}

/** Labels do host que identificam o dono (sem TLDs/partes técnicas). */
export function hostOwnerLabels(host: string): string[] {
  return host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter((p) => p.length > 1 && !TLD_PARTS.has(p.toUpperCase()))
    .flatMap((p) => p.split(/[-_]/))
    .filter((p) => p.length > 1);
}

/**
 * O host é do MESMO titular que a razão social? Ex.: "camara.leg.br" ↔ "CÂMARA DOS
 * DEPUTADOS", "mercadolivre.com.br" ↔ "MERCADO LIVRE BRASIL LTDA". Trata labels
 * concatenados ("mercadolivre" ⊂ "mercadolivrebrasil").
 */
export function hostMatchesLegalName(host: string, legalName: string): boolean {
  const squash = nameTokens(legalName).join("").toLowerCase();
  if (!squash) return false;
  for (const label of hostOwnerLabels(host)) {
    if (label.length >= 5 && squash.includes(label)) return true;
  }
  const hostStr = hostOwnerLabels(host).join("");
  if (hostStr.length >= 5) {
    const nameSquash = legalName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    if (nameSquash.includes(hostStr)) return true;
  }
  return tokenSimilarity(host, legalName) >= 0.6;
}

/** O título da página menciona a entidade buscada (todos os tokens ou similaridade ≥ 0.5)? */
export function titleMentionsEntity(title: string, entity: string): boolean {
  const et = nameTokens(entity);
  if (et.length === 0) return false;
  const tt = nameTokens(title);
  if (et.every((t) => tt.includes(t))) return true;
  return tokenSimilarity(title, entity) >= 0.5;
}

/* ------------------------------------------------------------------ */
/* Gate do candidato: mínimo de vínculo para entrar na lista           */
/* ------------------------------------------------------------------ */

export interface BindingGate {
  promotable: boolean;
  base: "FORTE" | "MODERADA" | "FRACA" | "NENHUMA";
  fortes: BindingEvidence[];
  moderadas: BindingEvidence[];
  resumo: string;
}

/**
 * Regra: 1 FORTE OU 2 MODERADAS independentes (tipo distinto OU fonte distinta).
 * FRACA nunca promove; INVALIDA não participa.
 */
export function evaluateBindingGate(bindings: BindingEvidence[]): BindingGate {
  const valid = bindings.filter((b) => b.strength !== "INVALIDA");
  const fortes = valid.filter((b) => b.strength === "FORTE");
  const moderadas = valid.filter((b) => b.strength === "MODERADA");

  // dedupe moderadas por (tipo, fonte) e exigir independência entre as restantes
  const unique = moderadas.filter(
    (b, i) =>
      moderadas.findIndex((o) => o.bindingType === b.bindingType && (o.sourceOwner ?? o.sourceUrl ?? "") === (b.sourceOwner ?? b.sourceUrl ?? "")) === i
  );
  const independent = unique.length >= 2; // após dedupe, diferem em tipo OU fonte

  const promotable = fortes.length >= 1 || independent;
  const base: BindingGate["base"] = fortes.length >= 1 ? "FORTE" : independent ? "MODERADA" : moderadas.length >= 1 ? "MODERADA" : valid.length >= 1 ? "FRACA" : "NENHUMA";
  const parts: string[] = [];
  if (fortes.length > 0) parts.push(`${plural(fortes.length, "evidência forte", "evidências fortes")}`);
  if (moderadas.length > 0) parts.push(`${plural(moderadas.length, "moderada", "moderadas")}${independent ? " independentes" : ""}`);
  return {
    promotable,
    base,
    fortes,
    moderadas,
    resumo: parts.length > 0 ? parts.join(" + ") : "nenhuma evidência de vínculo",
  };
}
