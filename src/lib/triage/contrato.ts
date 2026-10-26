/**
 * contrato.ts — TRIAGEM_V1: contrato de exportação NEUTRO das lacunas de triagem.
 *
 * Regras do contrato do operador (v0.10.6; PRIVACIDADE E RASTREABILIDADE v0.10.7):
 *  - Unidade principal: UMA pergunta/lacuna de UMA entidade — nunca o dossiê inteiro.
 *  - Formato neutro, versionado e independente de ferramenta (JSON/JSONL) — um
 *    consumidor EXTERNO futuro (ex.: avaliador fora da VM) pode ler sem SDK,
 *    sem endpoint, sem credencial e sem execução automática. NESTE arquivo não
 *    existe cliente, modelo, token ou configuração de conexão — e nada aqui
 *    dispara qualquer chamada.
 *  - Sanitização dura ANTES da validação: CPF (formatado, com máscara "**123456**"
 *    ou 11 dígitos com DV válido) e hash opaco de PF (32 hex) são substituídos por
 *    "[suprimido]". Nome público de pessoa física nunca entra nos campos gerados.
 *  - v0.10.7 (auditoria): TEXTO LIVRE de sinais de pesquisa NÃO exporta direto —
 *    fatos de origem "sinal" passam por pipeline reforçado (e-mail, telefone e
 *    NOME de pessoa física suprimidos; se um nome provável SOBREVIVER à redação,
 *    o fato inteiro NÃO exporta). Fatos de origem "estrutura" (gerados pelo motor
 *    a partir de campos estruturados do registro oficial) seguem o caminho normal —
 *    a razão social é identidade jurídica, não dado pessoal. Sem IA e sem regex
 *    "mágica" de nomes: marcadores de papel + lista fechada de prenomes comuns +
 *    regra de drop conservadora.
 *  - Validação por esquema (zod) — nada sai sem passar; falha de schema é erro
 *    honesto de servidor (500), nunca export silenciosamente corrompido.
 *  - A exportação só acontece por ação EXPLÍCITA do usuário (rota de export com
 *    guarda própria — nada aqui executa por conta própria).
 */
import { z } from "zod";
import type { LacunaTriagemView, EstadoTriagem, FatoTriagemView } from "@/lib/types";

export const TRIAGEM_V1_VERSAO = "TRIAGEM_V1";

/** Campos mínimos do contrato — todos obrigatórios (null explícito quando vazio). */
export const TRIAGEM_V1_ENTRY = z.object({
  versao_contrato: z.literal("TRIAGEM_V1"),
  cnpj_completo: z.string().nullable(),
  cnpj_raiz: z.string().nullable(),
  tipo_entidade: z.enum(["PESSOA_JURIDICA", "ESTABELECIMENTO"]),
  pergunta: z.string().min(1),
  pergunta_id: z.string().min(1),
  estado_triagem: z.enum(["RESOLVIDO", "COMPLEMENTAR_API", "PESQUISA_DOCUMENTAL", "VALIDACAO_HUMANA", "INDISPONIVEL", "NAO_APLICAVEL"]),
  fatos_existentes: z.array(
    z.object({
      fato: z.string(),
      fonte: z.string().nullable(),
      data: z.string().nullable(),
    })
  ),
  evidencias_referenciadas: z.array(
    z.object({
      tipo: z.string(),
      referencia: z.string(),
      data: z.string().nullable(),
    })
  ),
  lacuna: z.string().nullable(),
  verificacao_sugerida: z.string().nullable(),
  fontes_consultadas: z.array(z.string()),
  data_referencia: z.string().min(1),
  bloqueios: z.array(
    z.object({
      fonte: z.string(),
      tipo: z.string(),
      data: z.string().nullable(),
    })
  ),
});

export type TriagemV1Entry = z.infer<typeof TRIAGEM_V1_ENTRY>;

/* ----------------------------- sanitização ----------------------------- */

const RE_CPF_FORMATADO = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g; // validado por DV no filtro abaixo
const RE_CPF_MASCARADO = /\*{2}\d{4,8}\*{2}/g; // formato "**123456**" da fonte de grafos
const RE_HASH_PF = /\b[a-f0-9]{32}\b/gi; // identificador opaco persistente de PF — NUNCA exportar

/** DV do CPF — evita suprimir números legítimos que só parecem CPF. */
function pareceCpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos)) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false; // sequência repetida é inválida
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(digitos[i]) * (10 - i);
  let d1 = (soma * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(digitos[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(digitos[i]) * (11 - i);
  let d2 = (soma * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(digitos[10]);
}

/** Suprime CPFs (com DV válido), CPFs mascarados e hashes de PF num texto. */
export function sanitizarTexto(s: string): string {
  let out = s.replace(RE_CPF_MASCARADO, "[suprimido]");
  out = out.replace(RE_CPF_FORMATADO, (m) => (pareceCpfValido(m.replace(/\D/g, "")) ? "[suprimido]" : m));
  out = out.replace(RE_HASH_PF, "[suprimido]");
  return out;
}

/* --------- v0.10.7 (auditoria): privacidade para TEXTO LIVRE de sinais ---------
 * A auditoria provou que texto livre (vaga notícia) pode carregar nome de PF
 * ("Responsavel Maria Silva") que passava pela sanitização de CPF/hash. A correção
 * NÃO é uma regex "mágica de nomes" sozinha — é uma cadeia de camadas com drop
 * conservador, aplicada SOMENTE a fatos de origem "sinal" (texto livre):
 *   1. sanitização dura (CPF/hash, acima);
 *   2. e-mail e telefone suprimidos;
 *   3. marcador de papel (responsável/sócio/titular/…) seguido de nome capitalizado
 *      → nome suprimido;
 *   4. sequência capitalizada contendo PRENOME conhecido (lista fechada) → sequência
 *      suprimida — com guarda anti-falso-positivo para topônimos ("São Paulo",
 *      "Santa Maria", "Rio de Janeiro" NÃO são redigidos);
 *   5. SE um indício de nome de PF ainda SOBREVIVER → o fato NÃO exporta (drop). */

const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const RE_TELEFONE = /\(\d{2}\)\s?\d{4,5}-?\d{4}\b|\b\d{4,5}-\d{4}\b/g;

/** Marcadores de papel/pessoa seguidos de nome capitalizado (caso do audit). */
const RE_NOME_APOS_PAPEL =
  /(?:respons[áa]veis?|responsaveis?|s[óo]ci[oa]s?|titular|propriet[áa]ri[oa]|contato|representante|gestor|gestora|encarregad[oa]|diretor|diretora|presidente|gerente|procurador|procuradora)\s*(?:legal|técnico|tecnico)?\s*[:\-–]?\s+((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)(?:\s+(?:de|da|do|dos|das|e)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){0,3})/g;

/** Prenomes comuns PT-BR (lista FECHA'da e conservadora — sem IA, sem base externa). */
const NOMES_PROPRIOS_PF = new Set(
  ("maria joao jose ana antonio francisco carlos paulo pedro lucas luiz marcos luis gabriel rafael daniel marcelo bruno " +
   "eduardo felipe rodrigo mateus thiago ricardo fernando andre leandro tiago alexandre vitor victor vinicius rafaela " +
   "beatriz fernanda juliana mariana camila larissa leticia patricia roberta claudia cristina helena rita sonia adriana " +
   "alexandra amanda barbara bianca bruna carla carolina cecilia cintia daniela debora elaine erica fabiana fabio " +
   "fatima flavia gisele gustavo henrique hugo igor isabel ivan jessica joana jorge julia karina laura leila leonardo " +
   "lucia luciana lucio marcela marcia marilia marina marta mauro monica natalia nelson nicole paula renata renato " +
   "roberto rosa sandra sara sergio silvia simone suzana tatiana teresa valeria vanessa vera walter yasmin").split(" ")
);

/** Primeiros tokens que caracterizam TOPÔNIMO/logradouro — sequência NÃO é pessoa. */
const TOPONIMOS = new Set(["sao", "santo", "santa", "nova", "rio", "vila", "jardim", "parque", "alto", "campo", "campos", "grande", "velha", "velho"]);

function semAcentosMinusculo(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const RE_SEQUENCIA_CAPITALIZADA =
  /[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+(?:de|da|do|dos|das|e)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){0,3}/g;

/** Redige sequências capitalizadas que contêm prenome conhecido (guarda topônimo). */
function suprimirSequenciasComPrenome(texto: string): string {
  return texto.replace(RE_SEQUENCIA_CAPITALIZADA, (seq) => {
    const tokens = seq.split(/\s+/).filter((t) => !/^(?:de|da|do|dos|das|e)$/i.test(t));
    const primeiro = semAcentosMinusculo(tokens[0] ?? "");
    if (TOPONIMOS.has(primeiro)) return seq; // "São Paulo", "Santa Maria", "Rio de Janeiro"…
    const temPrenome = tokens.some((t) => NOMES_PROPRIOS_PF.has(semAcentosMinusculo(t)));
    return temPrenome ? "[pessoa física suprimida]" : seq;
  });
}

/** Redige o nome que segue um marcador de papel (ex.: "Responsavel Maria Silva"). */
function suprimirNomeAposPapel(texto: string): string {
  return texto.replace(RE_NOME_APOS_PAPEL, (_m, nome: string) => _m.slice(0, _m.length - nome.length) + "[pessoa física suprimida]");
}

/** Prenome isolado em QUALQUER capitalização ("maria", "Maria") → suprimido —
 *  exceto em contexto de topônimo ("São Paulo", "Santa Maria" ficam intactos). */
function suprimirTokensComPrenome(texto: string): string {
  const partes = texto.split(/([^A-Za-zÁ-Úá-ú]+)/);
  const ePalavra = (t: string) => /^[A-Za-zÁ-Úá-ú]+$/.test(t);
  for (let i = 0; i < partes.length; i++) {
    const tok = partes[i];
    if (!ePalavra(tok) || !NOMES_PROPRIOS_PF.has(semAcentosMinusculo(tok))) continue;
    // guarda de topônimo: último token alfabético anterior é marcador de lugar → preserva
    let prev = "";
    for (let j = i - 1; j >= 0; j--) {
      if (ePalavra(partes[j])) {
        prev = semAcentosMinusculo(partes[j]);
        break;
      }
      if (partes[j].trim() !== "") break;
    }
    if (TOPONIMOS.has(prev)) continue;
    partes[i] = "[pessoa física suprimida]";
  }
  return partes.join("");
}

/** Indício de nome de PF ainda presente? (mesmos detectores, pós-redação). */
function contemIndicioDeNomePf(texto: string): boolean {
  RE_NOME_APOS_PAPEL.lastIndex = 0;
  if (RE_NOME_APOS_PAPEL.test(texto)) return true;
  RE_SEQUENCIA_CAPITALIZADA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_SEQUENCIA_CAPITALIZADA.exec(texto)) !== null) {
    const tokens = m[0].split(/\s+/).filter((t) => !/^(?:de|da|do|dos|das|e)$/i.test(t));
    if (TOPONIMOS.has(semAcentosMinusculo(tokens[0] ?? ""))) continue;
    if (tokens.some((t) => NOMES_PROPRIOS_PF.has(semAcentosMinusculo(t)))) return true;
  }
  // prenome isolado fora de contexto de topônimo
  const partes = texto.split(/([^A-Za-zÁ-Úá-ú]+)/);
  const ePalavra = (t: string) => /^[A-Za-zÁ-Úá-ú]+$/.test(t);
  for (let i = 0; i < partes.length; i++) {
    const tok = partes[i];
    if (!ePalavra(tok) || !NOMES_PROPRIOS_PF.has(semAcentosMinusculo(tok))) continue;
    let prev = "";
    for (let j = i - 1; j >= 0; j--) {
      if (ePalavra(partes[j])) {
        prev = semAcentosMinusculo(partes[j]);
        break;
      }
      if (partes[j].trim() !== "") break;
    }
    if (TOPONIMOS.has(prev)) continue;
    return true;
  }
  return false;
}

/** Pipeline de UM fato para exportação (v0.10.7):
 *  - origem "estrutura": só a sanitização dura (razão social/CNPJ são identidade jurídica);
 *  - origem "sinal" COM síntese do motor: exporta a SÍNTESE determinística (o texto
 *    livre integral NUNCA sai da VM — privacidade por construção, não por regex);
 *  - origem "sinal" SEM síntese (legado/inesperado): pipeline reforçado de redação
 *    (e-mail/telefone/nome) e fato SUPRIMIDO se nome de PF provável sobreviver. */
export function prepararFatoParaExport(f: FatoTriagemView): { fato: string; fonte: string | null; data: string | null } | null {
  if (f.origem === "estrutura") {
    return { fato: sanitizarTexto(f.fato), fonte: f.fonte, data: f.data };
  }
  if (f.sintese) {
    return { fato: sanitizarTexto(f.sintese), fonte: f.fonte, data: f.data };
  }
  let texto = sanitizarTexto(f.fato);
  texto = texto.replace(RE_EMAIL, "[e-mail suprimido]");
  texto = texto.replace(RE_TELEFONE, "[telefone suprimido]");
  texto = suprimirSequenciasComPrenome(texto);
  texto = suprimirNomeAposPapel(texto);
  texto = suprimirTokensComPrenome(texto);
  if (contemIndicioDeNomePf(texto)) return null; // conteúdo inesperado → NÃO exporta
  return { fato: texto, fonte: f.fonte, data: f.data };
}

/** Fatos exportáveis de uma lacuna — mesmas regras usadas pela entrada do contrato
 *  (a contagem de evidências referenciadas usa ESTA lista, nunca a interna). */
export function fatosExportaveisDe(lacuna: LacunaTriagemView): { fato: string; fonte: string | null; data: string | null }[] {
  const out: { fato: string; fonte: string | null; data: string | null }[] = [];
  for (const f of lacuna.fatos) {
    const p = prepararFatoParaExport(f);
    if (p) out.push(p);
  }
  return out;
}

/** Caminha no objeto e sanitiza TODA string (defesa em profundidade). */
export function sanitizarEntrada<T>(entrada: T): T {
  if (typeof entrada === "string") return sanitizarTexto(entrada) as unknown as T;
  if (Array.isArray(entrada)) return entrada.map((v) => sanitizarEntrada(v)) as unknown as T;
  if (entrada && typeof entrada === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entrada as Record<string, unknown>)) out[k] = sanitizarEntrada(v);
    return out as unknown as T;
  }
  return entrada;
}

/* ------------------------- lacuna → contrato ------------------------- */

/** Constrói UMA entrada TRIAGEM_V1 a partir de uma lacuna da ficha. Campos gerados
 *  aqui NUNCA incluem nome público de PF, hash de PF ou CPF — só contagens e
 *  referências estruturadas às evidências internas (cache/rota/tipo de evento).
 *  v0.10.7: os fatos passam pelo pipeline de privacidade por ORIGEM (estrutura
 *  vs texto livre) e fatos com nome de PF provável residual são SUPRIMIDOS. */
export function lacunaParaTriagemV1(
  lacuna: LacunaTriagemView,
  ctx: {
    cnpjCompleto: string | null;
    cnpjRaiz: string | null;
    dataReferencia: string;
    fontesConsultadas: string[];
    evidencias: { tipo: string; referencia: string; data: string | null }[];
    bloqueios: { fonte: string; tipo: string; data: string | null }[];
  }
): TriagemV1Entry {
  return sanitizarEntrada({
    versao_contrato: TRIAGEM_V1_VERSAO,
    cnpj_completo: ctx.cnpjCompleto,
    cnpj_raiz: ctx.cnpjRaiz,
    tipo_entidade: lacuna.entidade,
    pergunta: lacuna.pergunta,
    pergunta_id: lacuna.perguntaId,
    estado_triagem: lacuna.estado,
    fatos_existentes: fatosExportaveisDe(lacuna),
    evidencias_referenciadas: ctx.evidencias,
    lacuna: lacuna.falta,
    verificacao_sugerida: lacuna.proximaVerificacao,
    fontes_consultadas: ctx.fontesConsultadas,
    data_referencia: ctx.dataReferencia,
    bloqueios: ctx.bloqueios,
  });
}

/* --------------------------- validação --------------------------- */

export type ValidacaoTriagemV1 =
  | { ok: true; entradas: TriagemV1Entry[] }
  | { ok: false; erros: string[] };

/** Valida o pacote inteiro contra o schema — nada é exportado sem passar aqui. */
export function validarPacoteTriagemV1(entradas: unknown): ValidacaoTriagemV1 {
  if (!Array.isArray(entradas)) return { ok: false, erros: ["Pacote TRIAGEM_V1 deve ser um array de entradas."] };
  const erros: string[] = [];
  const ok: TriagemV1Entry[] = [];
  entradas.forEach((e, i) => {
    const r = TRIAGEM_V1_ENTRY.safeParse(e);
    if (r.success) ok.push(r.data);
    else {
      const msg = r.error.issues.map((iss) => `${iss.path.join(".") || "(raiz)"}: ${iss.message}`).join("; ");
      erros.push(`entrada[${i}]: ${msg}`);
    }
  });
  return erros.length > 0 ? { ok: false, erros } : { ok: true, entradas: ok };
}

/** Serializa em JSONL (uma lacuna por linha — formato neutro consumível por streaming). */
export function paraJsonl(entradas: TriagemV1Entry[]): string {
  return entradas.map((e) => JSON.stringify(e)).join("\n") + (entradas.length > 0 ? "\n" : "");
}
