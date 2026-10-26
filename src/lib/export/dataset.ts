/**
 * export/dataset.ts — DATASET DE EXPORTAÇÃO (v0.10.15).
 *
 * UMA única derivação de fatos por linha, consumida por TODAS as exportações
 * comerciais (Excel, PDF da empresa, PDF do lote). Não cria um segundo motor
 * de classificação: reutiliza as mesmas regras da interface (telefoneUtil,
 * eMailUtil, DECISOR_QUAL_RE de @/lib/contato) e os mesmos estados do banco.
 *
 * Regras de integridade:
 * - Exporta somente o que existe no banco; nada inventado para preencher vazio.
 * - Contato inválido (ex.: 000000000000) NÃO vira contato utilizável aqui;
 *   o valor cru fica apenas na evidência técnica (coluna de auditoria).
 * - IA (leitura, setor, hipóteses) é transportada como HIPÓTESE, separada de fatos.
 * - Consulta candidata (plano) nunca aparece como executada.
 * - Sem reconsulta externa, sem IA, sem rede: só leitura do estado autorizado.
 */
import type { ImportRow } from "@prisma/client";
import { db } from "@/lib/db";
import { formatCnpj } from "@/lib/cnpj";
import { DECISOR_QUAL_RE, eMailUtil, telefoneUtil } from "@/lib/contato";
import { setorDeCnae } from "@/lib/enrich/segmentos"; // MESMA classificação do panorama da interface
import { contarPessoasJuridicas, raizDe } from "@/lib/relations/grafo"; // MESMA contagem PJ×estabelecimento da interface
import type { EscopoExportacao } from "./escopo";

export type { EscopoExportacao };

export const LIMITE_SELECAO = 5000; // mesma escada testada (100/1.000/5.000) — acima disso recusa com explicação

export interface DivergenciaExport {
  tipo: string;
  severidade: string;
  descricao: string;
}

export interface RepresentanteExport {
  cnpjConta: string; // formatado — preserva a referência da empresa
  razaoSocialConta: string;
  nome: string;
  qualificacao: string;
  tipoVinculo: string; // "Sócio/administração (quadro público)" | "Participação registrada (fonte pública)"
  tipoParticipante: string; // "PF" | "PJ" | "INDETERMINADO" | "" (QSA não tipa por linha)
  dataEntrada: string;
  fonte: string;
  dataConsulta: string;
  decisor: boolean; // qualificação de administração registrada — NUNCA prova quem compra
  empresaParticipada: string; // grafo: empresa em que o participante aparece (quando a fonte informa)
}

/** v0.10.16 — RECONCILIAÇÃO tela × PDF: o que a interface mostra de relações
 *  (cache direto + quadros expandidos por comando) entra AQUI, do MESMO estado
 *  persistido. Consulta candidata ou inexistente nunca vira fato. */
export interface QuadroExpandidoExport {
  participanteId: string;
  nome: string;
  tipo: string; // PF | PJ | INDETERMINADO
  totalEmpresas: number; // estabelecimentos (CNPJs completos distintos)
  totalPessoasJuridicas: number; // empresas distintas (raízes) — MESMA regra da interface
  empresas: { cnpjFormatado: string; razaoSocial: string; raiz: string }[];
  coletadoEm: string; // ISO
  validoAte: string; // ISO
  truncado: boolean;
}

export interface RelacoesConsultadasExport {
  coletadoEm: string; // ISO — consulta direta do CNPJ da conta
  validoAte: string; // ISO
  participantes: {
    participanteId: string;
    nome: string;
    tipo: string; // PF | PJ | INDETERMINADO
    cnpjFormatado: string | null;
    quadro: QuadroExpandidoExport | null; // null = a expansão desta conexão ainda não foi feita
  }[];
}

export interface LinhaExport {
  rowNumber: number;
  // pista original
  entrada: string;
  tipoEntrada: string;
  referencia: string;
  // identidade
  etapaIdentidade: string; // LOCALIZADO | CORRESPONDENTE | VALIDADO | ""
  estadoResolucao: string; // CONFIRMED | REVIEW | UNRESOLVED | ""
  confianca: string;
  divergencias: DivergenciaExport[];
  emRevisao: boolean; // união v0.10.14: REVIEW ∨ LOCALIZADO coletado
  validadaPorOperador: boolean;
  // cadastro
  cnpjFormatado: string;
  cnpjNormalizado: string;
  cnpjRaiz: string;
  razaoSocial: string;
  nomeFantasia: string;
  matrizFilial: string;
  identificadorMatrizFilial: string;
  cnpjMatrizFormatado: string;
  statusMatriz: string;
  situacao: string;
  dataSituacao: string;
  motivoSituacao: string;
  dataAbertura: string;
  cnaeCodigo: string;
  cnaeDescricao: string;
  cnaesSecundarios: string[];
  municipio: string;
  uf: string;
  ibgePopulacao: string;
  ibgeRegiaoImediata: string;
  ibgeAno: string;
  porte: string;
  naturezaJuridica: string;
  capitalSocialTexto: string;
  capitalSocialNumero: number | null;
  simples: string;
  mei: string;
  regimeTributario: string;
  // contatos — só UTILIZÁVEIS (regra única); cru preservado à parte
  telefones: string[];
  email: string;
  endereco: string;
  telefonesCrus: string[]; // evidência técnica/auditoria
  temContatoUtil: boolean;
  // representantes (QSA + relações de grafo quando existem)
  representantes: RepresentanteExport[];
  // v0.10.16: relações já consultadas + quadros expandidos (mesmo estado da tela)
  relacoesConsultadas: RelacoesConsultadasExport | null;
  // fontes e datas
  fonte: string;
  fonteDescoberta: string;
  dataConsulta: Date | null;
  dataColeta: Date | null;
  erro: string;
  // pesquisa profunda (quando pedida explicitamente)
  pesquisaStatus: string;
  // IA — hipóteses, SEPARADAS de fatos
  iaStatus: string;
  iaSetor: string;
  iaPorte: string;
  iaPerfil: string;
  iaLeitura: string;
  iaHipoteses: string[];
}

export interface ResumoLoteExport {
  id: string;
  arquivo: string;
  status: string;
  origem: string;
  criadoEm: Date;
  finalizadoEm: Date | null;
  // contagens oficiais (mesma regra do resumo da interface)
  entradasRecebidas: number;
  linhasProcessadas: number;
  aguardandoExecucao: number;
  pjsLocalizadas: number; // raízes distintas com ficha coletada (inclui revisão)
  pjsIdentificadas: number; // raízes compatíveis com as pistas
  emRevisao: number; // linhas aguardando revisão humana
  validadas: number; // validadas explicitamente pelo operador
  naoIdentificadas: number;
  falhas: number;
  // distribuições realmente sustentadas pelos dados
  situacaoDist: { key: string; count: number }[];
  ufDist: { key: string; count: number }[];
  cnaeDist: { key: string; count: number }[];
}

export interface DatasetExport {
  lote: ResumoLoteExport;
  linhas: LinhaExport[]; // APÓS o escopo
  totalLinhasLote: number; // antes do escopo (para informar o que ficou fora)
  escopo: EscopoExportacao;
}

/** safe parse de JSON — nunca lança. */
function safeJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** "1.234.567,89" / "1234567.89" → número; null quando não parseável (texto cru segue). */
export function capitalSocialNumero(texto: string | null | undefined): number | null {
  const raw = (texto ?? "").trim();
  if (!raw) return null;
  const normalizado =
    raw.includes(",") && raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  const limpo = normalizado.replace(/[^\d.\-]/g, "");
  if (!limpo || !/\d/.test(limpo)) return null; // texto sem número nenhum: nunca 0 inventado
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Data do cadastro (ex.: "2021-03-15", "15/03/2021") → Date; null quando não parseável. */
export function dataCadastro(texto: string | null | undefined): Date | null {
  const raw = (texto ?? "").trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * União da v0.10.14 — MESMA regra do resumo e da tabela:
 * em revisão = resolutionState REVIEW ∨ (identityStage LOCALIZADO com ficha coletada).
 */
export function linhaEmRevisao(eff: {
  identityStage: string | null;
  resolutionState: string | null;
  lookupStatus: string;
}): boolean {
  if (eff.resolutionState === "REVIEW") return true;
  return eff.identityStage === "LOCALIZADO" && eff.lookupStatus === "ENRIQUECIDO";
}

/** Linha efetiva de enriquecimento: a própria, o dono do CNPJ ou a original da duplicada. */
function construirEfetiva(rows: ImportRow[]): (r: ImportRow) => ImportRow {
  const rowByNumber = new Map<number, ImportRow>();
  const firstEnrichedByCnpj = new Map<string, ImportRow>();
  for (const r of rows) {
    rowByNumber.set(r.rowNumber, r);
    if (r.lookupStatus === "ENRIQUECIDO" && r.normalizedCnpj && !firstEnrichedByCnpj.has(r.normalizedCnpj)) {
      firstEnrichedByCnpj.set(r.normalizedCnpj, r);
    }
  }
  const eff = (r: ImportRow): ImportRow => {
    if (r.lookupStatus === "ENRIQUECIDO") return r;
    const byCnpj = r.normalizedCnpj ? firstEnrichedByCnpj.get(r.normalizedCnpj) : undefined;
    if (byCnpj) return byCnpj;
    if (r.duplicateOf != null) {
      const orig = rowByNumber.get(r.duplicateOf);
      if (orig) return eff(orig);
    }
    return r;
  };
  return eff;
}

interface RelacaoGrafo {
  nomePublico: string;
  qualificacao: string;
  empresaParticipada: string;
  tipo: string; // v0.10.16: PF | PJ | INDETERMINADO (classificação honesta da fonte)
  cnpjFormatado: string | null; // quando a fonte dá CNPJ válido do participante
  participanteId: string; // identidade própria da fonte (hash/CNPJ/outro)
  fonte: string;
  coletadoEm: Date;
}

/** Cache do quadro expandido de UM participante (lido SEM rede, igual à tela). */
interface QuadroCache {
  rotulo: string | null;
  tipoParticipante: string;
  empresas: { cnpj: string; razaoSocial: string | null }[];
  totalEmpresas: number;
  truncado: boolean;
  coletadoEm: Date;
  validoAte: Date;
}

/** Deriva a linha de exportação de UMA ImportRow (reutiliza a linha efetiva para duplicadas). */
function derivarLinha(
  r: ImportRow,
  effRow: ImportRow,
  entrada: string,
  relacoesPorCnpj: Map<string, { lista: RelacaoGrafo[]; coletadoEm: Date; validoAte: Date }>,
  quadrosPorId: Map<string, QuadroCache>
): LinhaExport {
  const enriched = effRow.lookupStatus === "ENRIQUECIDO";
  const extra = enriched ? safeJson<Record<string, unknown>>(effRow.extraJson, {}) : {};
  const divergencias = safeJson<DivergenciaExport[]>(r.identityDivergenciasJson, []);
  const socios = enriched ? safeJson<{ nome?: string; qual?: string; entrada?: string }[]>(effRow.sociosJson, []) : [];
  const hipoteses = enriched ? safeJson<string[]>(effRow.aiHypothesesJson, []).map(String) : [];

  const telefones: string[] = [];
  const telefonesCrus: string[] = [];
  for (const tel of [extra.telefone, extra.telefone2]) {
    const cru = typeof tel === "string" ? tel.trim() : "";
    if (!cru) continue;
    if (!telefonesCrus.includes(cru)) telefonesCrus.push(cru);
    const util = telefoneUtil(cru);
    if (util && !telefones.includes(util)) telefones.push(util);
  }
  const email = eMailUtil(typeof extra.email === "string" ? extra.email : "");
  const endereco = typeof extra.endereco === "string" ? extra.endereco.trim() : "";

  const representantes: RepresentanteExport[] = [];
  const cnpjContaFmt = effRow.normalizedCnpj ? formatCnpj(effRow.normalizedCnpj) : "";
  const razaoConta = effRow.legalName ?? "";
  for (const s of socios) {
    const nome = String(s.nome ?? "").trim();
    if (!nome) continue;
    const qual = String(s.qual ?? "").trim();
    representantes.push({
      cnpjConta: cnpjContaFmt,
      razaoSocialConta: razaoConta,
      nome,
      qualificacao: qual,
      tipoVinculo: "Sócio/administração (quadro público)",
      tipoParticipante: "",
      dataEntrada: String(s.entrada ?? "").trim(),
      fonte: enriched ? effRow.source ?? "" : "",
      dataConsulta: effRow.queriedAt ? effRow.queriedAt.toISOString() : "",
      decisor: DECISOR_QUAL_RE.test(qual),
      empresaParticipada: "",
    });
  }
  // relações de grafo público JÁ CONSULTADAS (cache local — sem rede aqui).
  // Dedupe: participante que JÁ está no QSA da conta não repete (mesma pessoa,
  // duas fontes); o grafo entra só com vínculo que o QSA não mostra.
  const nomeQsa = new Set(socios.map((s) => String(s.nome ?? "").trim().toUpperCase().replace(/\s+/g, " ")).filter(Boolean));
  const relacoesConsultadasCache = effRow.normalizedCnpj ? relacoesPorCnpj.get(effRow.normalizedCnpj) : undefined;
  for (const rel of relacoesConsultadasCache?.lista ?? []) {
    const nome = String(rel.nomePublico ?? "").trim();
    if (!nome) continue;
    if (nomeQsa.has(nome.toUpperCase().replace(/\s+/g, " "))) continue;
    representantes.push({
      cnpjConta: cnpjContaFmt,
      razaoSocialConta: razaoConta,
      nome,
      qualificacao: rel.qualificacao,
      tipoVinculo: "Participação registrada (fonte pública)",
      tipoParticipante: rel.tipo,
      dataEntrada: "",
      fonte: rel.fonte,
      dataConsulta: rel.coletadoEm.toISOString(),
      decisor: false,
      empresaParticipada: rel.empresaParticipada,
    });
  }

  // v0.10.16 — RECONCILIAÇÃO: o MESMO estado que a ficha mostra (relações diretas
  // + quadros expandidos por comando), lido SEM rede e SEM IA. A expansão nunca
  // acontece aqui: se o quadro não está em cache, entra como "ainda não investigado".
  let relacoesConsultadas: RelacoesConsultadasExport | null = null;
  if (relacoesConsultadasCache && relacoesConsultadasCache.lista.length > 0) {
    const participantes: RelacoesConsultadasExport["participantes"] = [];
    for (const rel of relacoesConsultadasCache.lista) {
      const id = rel.participanteId;
      const qc = id ? quadrosPorId.get(id) : undefined;
      participantes.push({
        participanteId: id,
        nome: rel.nomePublico,
        tipo: rel.tipo,
        cnpjFormatado: rel.cnpjFormatado,
        quadro: qc
          ? {
              participanteId: id,
              nome: qc.rotulo ?? rel.nomePublico,
              tipo: qc.tipoParticipante,
              totalEmpresas: qc.totalEmpresas,
              totalPessoasJuridicas: contarPessoasJuridicas(qc.empresas),
              empresas: qc.empresas.map((e) => ({
                cnpjFormatado: formatCnpj(e.cnpj),
                razaoSocial: e.razaoSocial ?? "",
                raiz: raizDe(e.cnpj),
              })),
              coletadoEm: qc.coletadoEm.toISOString(),
              validoAte: qc.validoAte.toISOString(),
              truncado: qc.truncado,
            }
          : null,
      });
    }
    relacoesConsultadas = {
      coletadoEm: relacoesConsultadasCache.coletadoEm.toISOString(),
      validoAte: relacoesConsultadasCache.validoAte.toISOString(),
      participantes,
    };
  }

  return {
    rowNumber: r.rowNumber,
    entrada,
    tipoEntrada: r.lookupKind || "CNPJ",
    referencia: r.referenceValue ?? "",
    etapaIdentidade: enriched ? effRow.identityStage ?? "" : "",
    estadoResolucao: r.resolutionState ?? effRow.resolutionState ?? "",
    confianca: r.resolutionConfidence ?? effRow.resolutionConfidence ?? "",
    divergencias,
    emRevisao: linhaEmRevisao({
      identityStage: enriched ? effRow.identityStage : null,
      resolutionState: enriched ? effRow.resolutionState : null,
      lookupStatus: effRow.lookupStatus,
    }),
    validadaPorOperador: enriched ? effRow.identityStage === "VALIDADO" : false,
    cnpjFormatado: r.resolvedCnpj
      ? formatCnpj(r.resolvedCnpj)
      : effRow.normalizedCnpj
        ? formatCnpj(effRow.normalizedCnpj)
        : "",
    cnpjNormalizado: effRow.normalizedCnpj || r.normalizedCnpj || "",
    cnpjRaiz: enriched ? effRow.cnpjRoot ?? "" : "",
    razaoSocial: enriched ? effRow.legalName ?? "" : "",
    nomeFantasia: enriched ? effRow.tradeName ?? "" : "",
    matrizFilial: enriched ? effRow.branchType ?? "" : "",
    identificadorMatrizFilial: enriched ? (effRow.branchIdentifier != null ? String(effRow.branchIdentifier) : "") : "",
    cnpjMatrizFormatado:
      enriched && effRow.headquartersCnpj && effRow.headquartersCnpj !== effRow.normalizedCnpj
        ? formatCnpj(effRow.headquartersCnpj)
        : "",
    statusMatriz: enriched ? effRow.matrizStatus ?? "" : "",
    situacao: enriched ? effRow.registrationStatus ?? "" : "",
    dataSituacao: enriched ? effRow.statusDate ?? "" : "",
    motivoSituacao: enriched ? effRow.situationReason ?? "" : "",
    dataAbertura: enriched ? effRow.openingDate ?? "" : "",
    cnaeCodigo: enriched ? effRow.cnaeCode ?? "" : "",
    cnaeDescricao: enriched ? effRow.cnaeDescription ?? "" : "",
    cnaesSecundarios: enriched && Array.isArray(extra.cnaesSecundarios) ? (extra.cnaesSecundarios as unknown[]).map(String).filter((s) => s.trim()) : [],
    municipio: enriched ? effRow.municipality ?? "" : "",
    uf: enriched ? effRow.uf ?? "" : "",
    ibgePopulacao: typeof (extra.ibge as { populacao?: string } | undefined)?.populacao === "string" ? String((extra.ibge as { populacao?: string }).populacao) : "",
    ibgeRegiaoImediata: typeof (extra.ibge as { regiaoImediata?: string } | undefined)?.regiaoImediata === "string" ? String((extra.ibge as { regiaoImediata?: string }).regiaoImediata) : "",
    ibgeAno: typeof (extra.ibge as { anoPopulacao?: string | number } | undefined)?.anoPopulacao === "string" || typeof (extra.ibge as { anoPopulacao?: number } | undefined)?.anoPopulacao === "number" ? String((extra.ibge as { anoPopulacao?: string | number }).anoPopulacao) : "",
    porte: typeof extra.porte === "string" ? extra.porte : "",
    naturezaJuridica: typeof extra.naturezaJuridica === "string" ? extra.naturezaJuridica : "",
    capitalSocialTexto: typeof extra.capitalSocial === "string" ? extra.capitalSocial : "",
    capitalSocialNumero: capitalSocialNumero(typeof extra.capitalSocial === "string" ? extra.capitalSocial : null),
    simples: typeof extra.simples === "string" ? extra.simples : "",
    mei: typeof extra.mei === "string" ? extra.mei : "",
    regimeTributario: typeof extra.regimeTributario === "string" ? extra.regimeTributario : "",
    telefones,
    email,
    endereco,
    telefonesCrus,
    temContatoUtil: telefones.length > 0 || !!email,
    representantes,
    relacoesConsultadas,
    fonte: enriched ? effRow.source ?? "" : "",
    fonteDescoberta: r.reverseSource ?? "",
    dataConsulta: enriched ? effRow.queriedAt : null,
    dataColeta: enriched ? effRow.collectedAt : null,
    erro: !enriched ? effRow.lookupError ?? r.invalidReason ?? "" : "",
    pesquisaStatus: effRow.researchStatus ?? "",
    iaStatus: effRow.aiStatus ?? "",
    iaSetor: effRow.aiStatus === "OK" ? effRow.aiSector ?? "" : "",
    iaPorte: effRow.aiStatus === "OK" ? effRow.aiSize ?? "" : "",
    iaPerfil: effRow.aiStatus === "OK" ? effRow.aiProfile ?? "" : "",
    iaLeitura: effRow.aiStatus === "OK" ? effRow.aiReading ?? "" : "",
    iaHipoteses: hipoteses,
  };
}

/** Contagens do lote pela MESMA regra do resumo da interface (v0.10.14+). */
async function resumoDoLote(
  batch: { id: string; fileName: string; status: string; sourceType: string; rowCount: number; totalPending: number; createdAt: Date; finishedAt: Date | null },
  rows: { identityStage: string | null; resolutionState: string | null; lookupStatus: string; cnpjRoot: string | null; registrationStatus: string | null; uf: string | null; cnaeCode: string | null }[]
): Promise<ResumoLoteExport> {
  const falhaEstados = ["NAO_ENCONTRADO", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"];
  const aguardaEstados = ["PENDENTE", "EM_FILA", "CONSULTANDO"];
  let processadas = 0;
  let naoIdentificadas = 0;
  let falhas = 0;
  let emRevisao = 0;
  let validadas = 0;
  const raizesComFicha = new Set<string>();
  const raizesIdentificadas = new Set<string>();
  for (const r of rows) {
    if (!aguardaEstados.includes(r.lookupStatus) && r.lookupStatus !== "IGNORADO") processadas++;
    if (r.lookupStatus === "ENRIQUECIDO") {
      if (linhaEmRevisao(r)) emRevisao++;
      if (r.identityStage === "VALIDADO") validadas++;
      if (r.cnpjRoot) {
        raizesComFicha.add(r.cnpjRoot);
        if (r.identityStage !== "LOCALIZADO" && (r.resolutionState === null || r.resolutionState === "CONFIRMED")) {
          raizesIdentificadas.add(r.cnpjRoot);
        }
      }
    } else if (falhaEstados.includes(r.lookupStatus)) {
      falhas++;
      naoIdentificadas++;
    }
  }
  const group = (by: "registrationStatus" | "uf" | "cnaeCode"): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.lookupStatus !== "ENRIQUECIDO") continue;
      if (by === "cnaeCode") {
        // v0.10.15: MESMA classificação do panorama da interface (seção CNAE, não código cru)
        const s = setorDeCnae(r.cnaeCode);
        if (s) {
          const chave = `${s.secao} — ${s.secaoNome}`;
          m.set(chave, (m.get(chave) ?? 0) + 1);
        }
        continue;
      }
      const k = r[by];
      if (typeof k === "string" && k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const toDist = (m: Map<string, number>) => [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  return {
    id: batch.id,
    arquivo: batch.fileName,
    status: batch.status,
    origem: batch.sourceType === "TEXT" ? "texto colado (não estruturado)" : "arquivo CSV",
    criadoEm: batch.createdAt,
    finalizadoEm: batch.finishedAt,
    entradasRecebidas: batch.rowCount,
    linhasProcessadas: processadas,
    aguardandoExecucao: batch.totalPending,
    pjsLocalizadas: raizesComFicha.size,
    pjsIdentificadas: raizesIdentificadas.size,
    emRevisao,
    validadas,
    naoIdentificadas,
    falhas,
    situacaoDist: toDist(group("registrationStatus")),
    ufDist: toDist(group("uf")).slice(0, 12),
    cnaeDist: toDist(group("cnaeCode")).slice(0, 12),
  };
}

/** Relações de grafo público já em cache local (sem rede) por CNPJ do lote. */
async function relacoesEmCache(
  cnpjs: string[]
): Promise<Map<string, { lista: RelacaoGrafo[]; coletadoEm: Date; validoAte: Date }>> {
  const mapa = new Map<string, { lista: RelacaoGrafo[]; coletadoEm: Date; validoAte: Date }>();
  if (cnpjs.length === 0) return mapa;
  const caches = await db.relacaoSocietariaCache.findMany({ where: { cnpj: { in: cnpjs } } });
  for (const c of caches) {
    const rel = safeJson<Record<string, unknown>[]>(c.relacoesJson, []);
    const lista: RelacaoGrafo[] = [];
    for (const r of rel) {
      const nome = String(r.nomePublico ?? "").trim();
      if (!nome) continue;
      lista.push({
        nomePublico: nome,
        qualificacao: String(r.qualificacao ?? ""),
        empresaParticipada: String(r.empresaParticipada ?? ""),
        tipo: String(r.tipo ?? "INDETERMINADO"),
        cnpjFormatado: typeof r.cnpjParticipante === "string" && r.cnpjParticipante ? formatCnpj(r.cnpjParticipante) : null,
        participanteId: String(r.participanteId ?? ""),
        fonte: c.fonte,
        coletadoEm: c.coletadoEm,
      });
    }
    mapa.set(c.cnpj, { lista, coletadoEm: c.coletadoEm, validoAte: c.validoAte });
  }
  return mapa;
}

/** v0.10.16 — quadros expandidos JÁ persistidos (sem rede): a mesma leitura da tela. */
async function quadrosEmCache(participanteIds: string[]): Promise<Map<string, QuadroCache>> {
  const mapa = new Map<string, QuadroCache>();
  const ids = [...new Set(participanteIds.filter((i) => i))];
  if (ids.length === 0) return mapa;
  const caches = await db.quadroParticipanteCache.findMany({ where: { participanteId: { in: ids } } });
  for (const c of caches) {
    mapa.set(c.participanteId, {
      rotulo: c.rotulo,
      tipoParticipante: c.tipoParticipante,
      empresas: safeJson<{ cnpj: string; razaoSocial: string | null }[]>(c.empresasJson, []),
      totalEmpresas: c.totalEmpresas,
      truncado: c.truncado,
      coletadoEm: c.coletadoEm,
      validoAte: c.validoAte,
    });
  }
  return mapa;
}

/**
 * Constrói o dataset de exportação do lote no escopo pedido.
 * NÃO consulta fontes externas e NÃO executa IA — lê apenas o estado autorizado.
 */
export async function construirDatasetExportacao(
  batchId: string,
  escopo: EscopoExportacao,
  rowNumbersSelecionadas?: number[]
): Promise<{ ok: true; dataset: DatasetExport } | { ok: false; codigo: string; mensagem: string }> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, codigo: "NOT_FOUND", mensagem: "Lote não encontrado." };
  if (batch.status === "PREVIEW") return { ok: false, codigo: "NOT_CONFIRMED", mensagem: "Confirme o lote antes de exportar." };

  const rows = await db.importRow.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
  if (rows.length === 0) return { ok: false, codigo: "LOTE_VAZIO", mensagem: "Este lote não tem linhas exportáveis." };

  if (escopo === "SELECIONADAS") {
    const n = rowNumbersSelecionadas?.length ?? 0;
    if (n === 0) return { ok: false, codigo: "NO_SELECTION", mensagem: "Selecione contas na prévia antes de exportar apenas as selecionadas." };
    if (n > LIMITE_SELECAO) {
      return {
        ok: false,
        codigo: "SELECAO_ACIMA_DO_LIMITE",
        mensagem: `Seleção com ${n} linhas passa o limite seguro de ${LIMITE_SELECAO} por exportação. Divida a seleção ou exporte todas as empresas.`,
      };
    }
  }

  const eff = construirEfetiva(rows);
  const cnpjs = [...new Set(rows.map((r) => r.normalizedCnpj).filter((c): c is string => !!c && c.length > 0))];
  const relacoes = await relacoesEmCache(cnpjs);
  // quadros expandidos: os participantes de TODAS as relações em cache do lote
  const idsParticipantes = [...relacoes.values()].flatMap((v) => v.lista.map((x) => x.participanteId));
  const quadros = await quadrosEmCache(idsParticipantes);
  const isText = batch.sourceType === "TEXT";

  const todas: LinhaExport[] = rows.map((r) => {
    let pista = "";
    const cells = safeJson<string[]>(r.originalCellsJson, []);
    if (isText) pista = cells[0] ?? "";
    else {
      const naoVazias = cells.filter((c) => c && c.trim().length > 0);
      pista = naoVazias.length > 0 ? naoVazias.join(" · ") : r.rawCnpj || "";
    }
    return derivarLinha(r, eff(r), pista, relacoes, quadros);
  });

  let linhas: LinhaExport[];
  if (escopo === "SEM_REVISAO") linhas = todas.filter((l) => !l.emRevisao);
  else if (escopo === "EM_REVISAO") linhas = todas.filter((l) => l.emRevisao);
  else if (escopo === "SELECIONADAS") linhas = todas.filter((l) => (rowNumbersSelecionadas ?? []).includes(l.rowNumber));
  else linhas = todas;

  if (linhas.length === 0) {
    return {
      ok: false,
      codigo: "ESCOPO_VAZIO",
      mensagem:
        escopo === "SEM_REVISAO"
          ? "Nenhuma conta sem revisão pendente neste lote ainda — revise as identificações primeiro."
          : escopo === "EM_REVISAO"
            ? "Nenhuma conta em revisão neste lote."
            : "Nenhuma conta no escopo escolhido.",
    };
  }

  const resumo = await resumoDoLote(batch, rows);
  return { ok: true, dataset: { lote: resumo, linhas, totalLinhasLote: todas.length, escopo } };
}

/** Conta quantas linhas há por escopo (para a interface informar o que será incluído). */
export async function contarEscopo(
  batchId: string
): Promise<{ ok: true; total: number; semRevisao: number; emRevisao: number; aguardando: number } | { ok: false; codigo: string; mensagem: string }> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { id: true } });
  if (!batch) return { ok: false, codigo: "NOT_FOUND", mensagem: "Lote não encontrado." };
  const rows = await db.importRow.findMany({
    where: { batchId },
    select: { identityStage: true, resolutionState: true, lookupStatus: true },
  });
  let semRevisao = 0;
  let emRevisao = 0;
  let aguardando = 0;
  for (const r of rows) {
    if (["PENDENTE", "EM_FILA", "CONSULTANDO"].includes(r.lookupStatus)) aguardando++;
    if (r.lookupStatus !== "ENRIQUECIDO") continue;
    if (linhaEmRevisao(r)) emRevisao++;
    else semRevisao++;
  }
  return { ok: true, total: rows.length, semRevisao, emRevisao, aguardando };
}
