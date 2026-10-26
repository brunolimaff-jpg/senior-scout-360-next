/**
 * engine.ts — TRIAGEM LOCAL DETERMINÍSTICA (v0.10.7, SEM IA).
 *
 * Classifica LACUNAS (perguntas por entidade), nunca a empresa inteira, usando
 * EXCLUSIVAMENTE fatos já coletados em SQLite (cadastro, relações societárias,
 * estabelecimentos da raiz, pacote de pesquisa determinístico, telemetria).
 *
 * Regras do contrato do operador aplicadas AQUI:
 *  - ZERO chamada de IA e ZERO busca web: nenhum caminho desta função faz HTTP.
 *  - NÃO ENCONTRADO ≠ NÃO PESQUISADO — o motivo carrega a diferença.
 *  - Não confundir filiais com empresas distintas: a unidade societária é a
 *    RAIZ (pessoa jurídica); o CNPJ completo é ESTABELECIMENTO.
 *  - v0.10.7 (auditoria): INDÍCIO NÃO É RESOLUÇÃO — vaga/menção de contabilidade
 *    ou ERP fica como FATO com proveniência e a lacuna segue ABERTA (nunca
 *    RESOLVIDO); o estado ganha a verificação apropriada (VALIDACAO_HUMANA ou
 *    PESQUISA_DOCUMENTAL).
 *  - v0.10.7 (auditoria): o estado de UM estabelecimento (filial BAIXADA/SUSPENSA/
 *    INAPTA) NÃO comprova a situação operacional da pessoa jurídica — perguntas da
 *    PJ só são encerradas (NAO_APLICAVEL) quando a unidade é a matriz, ou quando a
 *    evidência conhecida da raiz prova todas as unidades encerradas.
 *  - Não criar lacunas genéricas: o catálogo tem perguntas fixas e cada estado
 *    vem de uma regra determinística explícita (ver `motivo`).
 *  - Consulta bloqueada (429/timeout/indisponibilidade) → INDISPONIVEL, sem
 *    apagar fatos anteriores (eles continuam listados).
 *  - Sem score comercial — estados são categorias de evidência, não notas.
 */
import { db } from "@/lib/db";
import { validateCnpj } from "@/lib/cnpj";
import { raizDe } from "@/lib/relations/grafo";
import { plural } from "@/lib/linguagem";
import type {
  EstadoTriagem,
  FatoTriagemView,
  LacunaTriagemView,
  TriagemLinhaView,
  RowExtraView,
  ResearchPacketView,
} from "@/lib/types";

/* ------------------------------ catálogo ------------------------------ */

export const PERGUNTAS_TRIAGEM = {
  identidade: {
    perguntaId: "identidade",
    pergunta: "Quem é a empresa deste CNPJ?",
    entidade: "ESTABELECIMENTO" as const,
    utilidade: "Base de todas as demais perguntas — sem identidade confirmada, nada mais é atribuível.",
  },
  estabelecimentos: {
    perguntaId: "estabelecimentos",
    pergunta: "Onde estão os estabelecimentos desta pessoa jurídica?",
    entidade: "PESSOA_JURIDICA" as const,
    utilidade: "Delimita a pessoa jurídica real (matriz/filiais) e evita confundir filiais com empresas distintas.",
  },
  relacoes: {
    perguntaId: "relacoes_societarias",
    pergunta: "Há outras pessoas jurídicas formalmente vinculadas (participações no quadro público)?",
    entidade: "PESSOA_JURIDICA" as const,
    utilidade: "Participações e sócios comuns são evidência estruturada de vínculos entre pessoas jurídicas distintas — nunca rotulados como grupo econômico.",
  },
  regime: {
    perguntaId: "regime_tributario",
    pergunta: "Qual é o regime tributário vigente?",
    entidade: "PESSOA_JURIDICA" as const,
    utilidade: "Regime vigente muda as obrigações e os documentos esperados — menção histórica não comprova vigência.",
  },
  contabilidade: {
    perguntaId: "contabilidade_interna",
    pergunta: "Possui contabilidade interna (estrutura própria de contabilidade/fiscal)?",
    entidade: "PESSOA_JURIDICA" as const,
    utilidade: "Estrutura contábil própria muda onde a informação operacional pode ser obtida.",
  },
  tecnologia: {
    perguntaId: "tecnologia_erp",
    pergunta: "Qual ERP / sistema de gestão utiliza?",
    entidade: "PESSOA_JURIDICA" as const,
    utilidade: "ERP em uso define integrações reais possíveis — investigação documental candidata, somente sob demanda.",
  },
} as const;

/* ------------------------------ helpers ------------------------------ */

const RE_BAIXADA = /BAIXAD|NULA|SUSPENSA|INAPTA/i;
const RE_ERP = /\berp\b|\btotvs\b|\bsap\b|\bomie\b|\bling\b|microsiga|protheus|sistema de gest/i;
const RE_CONTAB = /contabil|contador|departamento pessoal|folha de pagamento|escrit[oó]rio cont|fiscal e tribut/i;

interface FontesProveniencia {
  primaria?: { fonte?: string; coletadoEm?: string };
  complementacoes?: { fonte?: string; campos?: string[]; coletadoEm?: string }[];
  cache?: { consultaOriginal?: string; validoAte?: string; reaproveitadoEm?: string } | null;
}

function parseJsonSeguro<T>(texto: string | null | undefined): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  try {
    return (typeof d === "string" ? new Date(d) : d).toISOString();
  } catch {
    return null;
  }
}

function lacunaVazia(cat: (typeof PERGUNTAS_TRIAGEM)[keyof typeof PERGUNTAS_TRIAGEM]): LacunaTriagemView {
  return {
    perguntaId: cat.perguntaId,
    pergunta: cat.pergunta,
    estado: "RESOLVIDO",
    motivo: "",
    entidade: cat.entidade,
    fatos: [],
    falta: null,
    proximaVerificacao: null,
    utilidade: cat.utilidade,
  };
}

function resumoDe(lacunas: LacunaTriagemView[]): Record<EstadoTriagem, number> {
  const resumo: Record<EstadoTriagem, number> = {
    RESOLVIDO: 0,
    COMPLEMENTAR_API: 0,
    PESQUISA_DOCUMENTAL: 0,
    VALIDACAO_HUMANA: 0,
    INDISPONIVEL: 0,
    NAO_APLICAVEL: 0,
  };
  for (const l of lacunas) resumo[l.estado] += 1;
  return resumo;
}

interface BloqueioView {
  fonte: string;
  tipo: string;
  data: string | null;
}

interface DadosLinha {
  rowNumber: number;
  lookupStatus: string;
  lookupError: string | null;
  cnpj: string | null;
  cnpjRaiz: string | null;
  legalName: string | null;
  tradeName: string | null;
  registrationStatus: string | null;
  statusDate: string | null;
  branchType: string | null;
  branchIdentifier: number | null;
  municipality: string | null;
  uf: string | null;
  cnaeDescription: string | null;
  openingDate: string | null;
  sociosJson: string | null;
  extraJson: string | null;
  researchJson: string | null;
  fontesJson: string | null;
  collectedAt: Date | null;
  queriedAt: Date | null;
  matrizStatus: string | null;
  resolutionState: string | null;
  /** v0.10.12: estágio de confiança da identidade + divergências pistas × cadastro */
  identityStage: string | null;
  identityDivergenciasJson: string | null;
  cnpjStatus: string;
}

async function carregarLinha(batchId: string, rowNumber: number): Promise<DadosLinha | null> {
  const row = await db.importRow.findFirst({
    where: { batchId, rowNumber },
    select: {
      lookupStatus: true,
      lookupError: true,
      normalizedCnpj: true,
      legalName: true,
      tradeName: true,
      registrationStatus: true,
      statusDate: true,
      branchType: true,
      branchIdentifier: true,
      municipality: true,
      uf: true,
      cnaeDescription: true,
      openingDate: true,
      sociosJson: true,
      extraJson: true,
      researchJson: true,
      fontesJson: true,
      collectedAt: true,
      queriedAt: true,
      matrizStatus: true,
      resolutionState: true,
      identityStage: true,
      identityDivergenciasJson: true,
      cnpjStatus: true,
    },
  });
  if (!row) return null;
  const cnpj = row.normalizedCnpj && validateCnpj(row.normalizedCnpj).valid ? row.normalizedCnpj : null;
  return {
    rowNumber,
    lookupStatus: row.lookupStatus,
    lookupError: row.lookupError,
    cnpj,
    cnpjRaiz: cnpj ? raizDe(cnpj) : null,
    legalName: row.legalName,
    tradeName: row.tradeName,
    registrationStatus: row.registrationStatus,
    statusDate: row.statusDate,
    branchType: row.branchType,
    branchIdentifier: row.branchIdentifier,
    municipality: row.municipality,
    uf: row.uf,
    cnaeDescription: row.cnaeDescription,
    openingDate: row.openingDate,
    sociosJson: row.sociosJson,
    extraJson: row.extraJson,
    researchJson: row.researchJson,
    fontesJson: row.fontesJson,
    collectedAt: row.collectedAt,
    queriedAt: row.queriedAt,
    matrizStatus: row.matrizStatus,
    resolutionState: row.resolutionState,
    identityStage: row.identityStage,
    identityDivergenciasJson: row.identityDivergenciasJson,
    cnpjStatus: row.cnpjStatus,
  };
}

/** Falhas RECENTES de consulta às fontes de grafos/estabelecimentos para este alvo. */
async function falhasDeFonte(alvos: string[]): Promise<{ fonte: string; tipo: string; data: string | null }[]> {
  if (alvos.length === 0) return [];
  const evs = await db.telemetryEvent.findMany({
    where: { tipo: { in: ["RELACAO_GRAFO", "DESCOBERTA_ROOT"] }, estadoFinal: "falha", alvo: { in: alvos } },
    orderBy: { startedAt: "desc" },
    take: 6,
  });
  return evs.map((t) => {
    const payload = parseJsonSeguro<{ tipo?: string }>(t.payloadJson);
    return {
      fonte: t.fonte ?? "fonte de grafos",
      tipo: payload?.tipo ?? t.erro ?? "FONTE_INDISPONIVEL",
      data: iso(t.startedAt),
    };
  });
}

/** v0.10.7 (auditoria): a evidência conhecida da raiz PROVA que não há unidade
 *  operando? Regra determinística, zero HTTP — só leitura do que já foi coletado:
 *  (1) nenhuma OUTRA linha do lote da mesma raiz está ATIVA; e
 *  (2) o cache de estabelecimentos da raiz é válido, tem cobertura esgotada
 *      (0 pendentes), ≥1 unidade confirmada e TODAS as confirmadas encerradas.
 *  Qualquer dúvida (cache expirado, cobertura parcial, unidade confirmada ativa)
 *  → false: a raiz NÃO está provada morta e as perguntas da PJ seguem abertas. */
async function raizProvadaSemAtivos(batchId: string, raiz: string, cnpjLinha: string): Promise<boolean> {
  const mesmas = await db.importRow.findMany({
    where: { batchId, normalizedCnpj: { startsWith: raiz }, lookupStatus: "ENRIQUECIDO" },
    select: { normalizedCnpj: true, registrationStatus: true },
  });
  const outraAtivaNoLote = mesmas.some(
    (m) => m.normalizedCnpj !== cnpjLinha && !!m.registrationStatus && /ATIVA/i.test(m.registrationStatus)
  );
  if (outraAtivaNoLote) return false;
  const cache = await db.estabelecimentoRootCache.findUnique({ where: { cnpjRaiz: raiz } });
  if (!cache || cache.validoAte <= new Date()) return false;
  const estabelecimentos = parseJsonSeguro<{ cnpj: string; situacao: string | null; confirmado: boolean }[]>(cache.estabelecimentosJson) ?? [];
  const cob = parseJsonSeguro<{ pendentesConfirmacao?: number }>(cache.coberturaJson) ?? {};
  if ((cob.pendentesConfirmacao ?? 0) > 0) return false; // cobertura não esgotada — nada provado
  const outrasConfirmadas = estabelecimentos.filter((e) => e.confirmado && e.cnpj !== cnpjLinha);
  if (outrasConfirmadas.length === 0) return false;
  return outrasConfirmadas.every((e) => !!e.situacao && RE_BAIXADA.test(e.situacao));
}

/* ------------------------------ perguntas ------------------------------ */

function lacunaIdentidade(linha: DadosLinha): LacunaTriagemView {
  const l = lacunaVazia(PERGUNTAS_TRIAGEM.identidade);
  const fontes = parseJsonSeguro<FontesProveniencia>(linha.fontesJson);
  const fontePrimaria = fontes?.primaria?.fonte ?? null;
  const coletadoEm = iso(linha.collectedAt) ?? iso(linha.queriedAt);

  if (linha.lookupStatus === "ENRIQUECIDO" && linha.legalName && linha.cnpj) {
    // v0.10.12: o estágio de identidade decide o que "identidade resolvida" significa —
    // VALIDADO/CORRESPONDENTE = identidade firme; LOCALIZADO = registro achado, vínculo
    // com as pistas NÃO provado → validação humana, com as divergências explicadas e o
    // registro localizado PRESERVADO como fato (nada é descartado).
    if (linha.identityStage === "LOCALIZADO") {
      const divergencias = parseJsonSeguro<{ tipo: string; severidade: string; descricao: string }[]>(linha.identityDivergenciasJson) ?? [];
      l.estado = "VALIDACAO_HUMANA";
      l.motivo =
        "Registro cadastral localizado na fonte oficial, mas ele diverge das pistas informadas — a correspondência NÃO está provada e a identidade precisa da sua validação." +
        (divergencias.length > 0 ? ` Divergências: ${divergencias.map((d) => d.descricao).join(" ")}` : "");
      l.fatos = [
        { fato: `Registro localizado: ${linha.legalName}`, fonte: fontePrimaria, data: coletadoEm },
        { fato: `CNPJ do registro: ${linha.cnpj}`, fonte: fontePrimaria, data: coletadoEm },
        ...(linha.registrationStatus ? [{ fato: `Situação cadastral: ${linha.registrationStatus}${linha.statusDate ? ` (desde ${linha.statusDate})` : ""}`, fonte: fontePrimaria, data: coletadoEm }] : []),
        ...(linha.municipality || linha.uf ? [{ fato: `Sede do registro: ${[linha.municipality, linha.uf].filter(Boolean).join("/")}`, fonte: fontePrimaria, data: coletadoEm }] : []),
        ...divergencias.map((d) => ({ fato: `Divergência (${d.severidade.toLowerCase()}): ${d.descricao}`, fonte: fontePrimaria, data: coletadoEm })),
      ];
      l.falta = "Validar se este registro corresponde à empresa buscada (validar na ficha, corrigir o CNPJ ou informar nova pista).";
      l.proximaVerificacao = "Painel de revisão da identidade na ficha da conta.";
      return l;
    }
    l.estado = "RESOLVIDO";
    l.motivo =
      linha.identityStage === "VALIDADO"
        ? "Identidade validada por você na revisão; o registro oficial confirma os dados (coleta original preservada com fonte e data)."
        : linha.identityStage === "CORRESPONDENTE"
          ? "O cadastro oficial corresponde às pistas informadas (coleta original preservada com fonte e data)."
          : "Identidade confirmada pelo registro oficial consultado (coleta original preservada com fonte e data).";
    l.fatos = [
      { fato: `Razão social: ${linha.legalName}`, fonte: fontePrimaria, data: coletadoEm },
      { fato: `CNPJ completo (estabelecimento): ${linha.cnpj}`, fonte: fontePrimaria, data: coletadoEm },
      { fato: `Raiz (pessoa jurídica): ${raizDe(linha.cnpj)}`, fonte: fontePrimaria, data: coletadoEm },
      ...(linha.registrationStatus ? [{ fato: `Situação cadastral: ${linha.registrationStatus}${linha.statusDate ? ` (desde ${linha.statusDate})` : ""}`, fonte: fontePrimaria, data: coletadoEm }] : []),
      ...(linha.branchType ? [{ fato: `Natureza do estabelecimento: ${linha.branchType}${linha.branchIdentifier ? ` — campo oficial ${linha.branchIdentifier === 1 ? "(matriz)" : linha.branchIdentifier === 2 ? "(filial)" : ""}` : ""}`, fonte: fontePrimaria, data: coletadoEm }] : []),
      ...(linha.municipality || linha.uf ? [{ fato: `Localização: ${[linha.municipality, linha.uf].filter(Boolean).join("/")}`, fonte: fontePrimaria, data: coletadoEm }] : []),
      ...(linha.openingDate ? [{ fato: `Abertura: ${linha.openingDate}`, fonte: fontePrimaria, data: coletadoEm }] : []),
      ...(linha.cnaeDescription ? [{ fato: `Atividade principal: ${linha.cnaeDescription}`, fonte: fontePrimaria, data: coletadoEm }] : []),
    ];
    l.falta = null;
    l.proximaVerificacao = null;
    return l;
  }

  if (["RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR"].includes(linha.lookupStatus)) {
    l.estado = "INDISPONIVEL";
    l.motivo = "A consulta cadastral desta linha não concluiu por indisponibilidade da fonte. Não significa ausência de registro.";
    l.fatos = [];
    l.falta = "Confirmar a identidade pelo registro oficial. A consulta não concluiu.";
    l.proximaVerificacao = "Use 'Tentar novamente' na ficha quando a fonte voltar. Nada foi perdido.";
    return l;
  }
  if (linha.lookupStatus === "NAO_ENCONTRADO" || linha.resolutionState === "UNRESOLVED") {
    l.estado = "VALIDACAO_HUMANA";
    l.motivo = "Buscado nas fontes estruturadas e não encontrado. NÃO ENCONTRADO (buscado) não é NÃO PESQUISADO. A decisão seguinte é sua.";
    l.falta = "Informe uma nova pista (domínio, e-mail, endereço) ou confirme que a empresa não existe nos registros consultados.";
    l.proximaVerificacao = "Revisão humana na ficha, com os candidatos guardados.";
    return l;
  }
  if (linha.resolutionState === "REVIEW" || linha.cnpjStatus === "REFERENCIA" || linha.cnpjStatus === "SEM_CNPJ") {
    l.estado = "VALIDACAO_HUMANA";
    l.motivo = "Identidade em revisão — a linha precisa de decisão humana entre candidatos.";
    l.falta = "Confirmar o CNPJ correto entre os candidatos (ou declarar não identificada).";
    l.proximaVerificacao = "Painel de revisão na ficha.";
    return l;
  }
  if (linha.cnpjStatus === "INVALIDA") {
    l.estado = "NAO_APLICAVEL";
    l.motivo = "Entrada inválida — não há pergunta respondível sobre identidade para este registro.";
    l.falta = null;
    l.proximaVerificacao = null;
    return l;
  }
  if (linha.cnpjStatus === "DUPLICADA") {
    l.estado = "NAO_APLICAVEL";
    l.motivo = "Linha duplicada — consolidada em outra linha do lote (sem consulta repetida).";
    l.falta = null;
    l.proximaVerificacao = null;
    return l;
  }
  // PENDENTE / EM_FILA / CONSULTANDO
  l.estado = "COMPLEMENTAR_API";
  l.motivo = "A coleta desta linha não concluiu. As fontes aplicáveis entram quando o lote processar.";
  l.falta = "Concluir a coleta cadastral da linha.";
  l.proximaVerificacao = "Inicie o lote para concluir a coleta.";
  return l;
}

/* ------------------------------ núcleo ------------------------------ */

export async function classificarTriagemLinha(batchId: string, rowNumber: number): Promise<TriagemLinhaView | { ok: false; motivo: string }> {
  const linha = await carregarLinha(batchId, rowNumber);
  if (!linha) return { ok: false, motivo: "linha_nao_encontrada" };

  const calculadoEm = new Date().toISOString();
  const lacunas: LacunaTriagemView[] = [lacunaIdentidade(linha)];

  // As demais perguntas só existem para linha com coleta concluída e CNPJ válido
  // (evita lacunas genéricas sobre entidades ainda não identificadas).
  const extra = parseJsonSeguro<RowExtraView>(linha.extraJson) ?? {};
  const research = parseJsonSeguro<ResearchPacketView>(linha.researchJson);
  const fontes = parseJsonSeguro<FontesProveniencia>(linha.fontesJson);
  const fontePrimaria = fontes?.primaria?.fonte ?? null;
  const coletadoEm = iso(linha.collectedAt) ?? iso(linha.queriedAt);
  // v0.10.7 (auditoria): o estado de UM estabelecimento não comprova a situação
  // operacional da pessoa jurídica. Encerra perguntas da PJ (NAO_APLICAVEL) só quando
  // a unidade consultada é a MATRIZ, ou quando a evidência conhecida da raiz prova
  // todas as unidades encerradas. Filial baixada com raiz não provada morta segue
  // classificando pela evidência, com nota explícita no fato (abaixo).
  const situacaoBaixada = !!linha.registrationStatus && RE_BAIXADA.test(linha.registrationStatus);
  const eMatrizDaRaiz = linha.branchIdentifier === 1 || (linha.branchType ?? "").toUpperCase().includes("MATRIZ");
  const raizProvadaMorta =
    situacaoBaixada && !eMatrizDaRaiz && !!linha.cnpjRaiz && !!linha.cnpj
      ? await raizProvadaSemAtivos(batchId, linha.cnpjRaiz, linha.cnpj)
      : false;
  const encerraPerguntasPj = situacaoBaixada && (eMatrizDaRaiz || raizProvadaMorta);
  const notaEstabelecimentoBaixado =
    situacaoBaixada && !eMatrizDaRaiz && !raizProvadaMorta
      ? {
          fato: `Situação deste estabelecimento (filial): ${linha.registrationStatus}. As perguntas da pessoa jurídica são avaliadas pela raiz.`,
          fonte: fontePrimaria,
          data: coletadoEm,
          origem: "estrutura" as const,
        }
      : null;
  const mei = extra.mei === "Sim";

  if (linha.lookupStatus === "ENRIQUECIDO" && linha.cnpj && linha.cnpjRaiz) {
    const raiz = linha.cnpjRaiz;

    /* ----- estabelecimentos da raiz (pessoa jurídica) ----- */
    {
      const l = lacunaVazia(PERGUNTAS_TRIAGEM.estabelecimentos);
      const cache = await db.estabelecimentoRootCache.findUnique({ where: { cnpjRaiz: raiz } });
      const bloqueios = await falhasDeFonte([linha.cnpj, raiz]);
      const cacheValido = cache && cache.validoAte > new Date();
      const ultimaFalha = bloqueios[0] ?? null;
      const bloqueioMaisRecenteQueCache = !!ultimaFalha && (!cache || new Date(ultimaFalha.data ?? 0) > cache.atualizadoEm);

      if (cache) {
        const estabelecimentos = parseJsonSeguro<{ cnpj: string; razaoSocial: string | null; municipio: string | null; uf: string | null; situacao: string | null; identificadorMatrizFilial: number | null; confirmado: boolean }[]>(cache.estabelecimentosJson) ?? [];
        const cob = parseJsonSeguro<{ participantesConsultados?: string[]; pendentesConfirmacao?: number; totalParticipantesPfCache?: number }>(cache.coberturaJson) ?? {};
        const confirmados = estabelecimentos.filter((e) => e.confirmado);
        const matrizes = confirmados.filter((e) => e.identificadorMatrizFilial === 1).length;
        const filiais = confirmados.filter((e) => e.identificadorMatrizFilial === 2).length;
        const pendentes = cob.pendentesConfirmacao ?? estabelecimentos.filter((e) => !e.confirmado).length;
        const participantesConsultados = cob.participantesConsultados?.length ?? 0;
        const totalParticipantesPf = cob.totalParticipantesPfCache ?? participantesConsultados;
        l.fatos = [
          {
            fato: `Encontramos ${plural(estabelecimentos.length, "estabelecimento", "estabelecimentos")} desta raiz na fonte consultada. ${plural(confirmados.length, "confirmado", "confirmados")} pelo registro oficial (matriz pelo campo oficial: ${matrizes} · filiais: ${filiais})${pendentes > 0 ? ` · ${plural(pendentes, "pendente", "pendentes")} de confirmação` : ""}. A fonte pública cobre parte do total.`,
            fonte: cache.fonteDescoberta,
            data: iso(cache.coletadoEm),
          },
        ];
        // linhas do MESMO lote com a mesma raiz — fato da própria coleta (zero HTTP)
        const mesmasRaiz = await db.importRow.findMany({
          where: { batchId, normalizedCnpj: { startsWith: raiz } },
          select: { normalizedCnpj: true },
        });
        if (mesmasRaiz.length > 1) {
          l.fatos.push({
            fato: `${plural(mesmasRaiz.length, "estabelecimento", "estabelecimentos")} desta raiz presentes no lote atual. Estabelecimentos da MESMA pessoa jurídica não são empresas distintas.`,
            fonte: "linhas do lote (coleta original)",
            data: coletadoEm,
          });
        }
        if (bloqueioMaisRecenteQueCache) {
          l.estado = "INDISPONIVEL";
          l.motivo = `A última tentativa de investigação desta raiz não concluiu por indisponibilidade da fonte em ${ultimaFalha!.data ?? "data não registrada"}. As informações anteriores continuam disponíveis.`;
          l.falta = "Concluir as confirmações/consultas pendentes quando a fonte voltar.";
          l.proximaVerificacao = "Use 'Investigar estabelecimentos da raiz' na ficha quando a fonte voltar.";
        } else if (cacheValido && pendentes === 0 && participantesConsultados >= totalParticipantesPf) {
          l.estado = "RESOLVIDO";
          l.motivo = "Confirmado para a fonte consultada (todos os participantes PF do quadro consultados e todas as confirmações concluídas) — a fonte é PARCIAL e a quantidade total de estabelecimentos não é afirmada.";
          l.falta = null;
          l.proximaVerificacao = null;
        } else {
          l.estado = "COMPLEMENTAR_API";
          l.motivo = cacheValido
            ? "A cobertura na fonte ainda não esgotou: há confirmações pendentes e/ou quadros de participantes não consultados nesta rodada."
            : "A investigação anterior expirou. Uma nova rodada consulta de novo e mantém os fatos já confirmados.";
          l.falta = pendentes > 0 ? `${plural(pendentes, "estabelecimento localizado", "estabelecimentos localizados")} ainda sem confirmação individual pelo registro oficial.` : "Ainda não verificamos todas as empresas ligadas aos participantes desta raiz.";
          l.proximaVerificacao = "Use 'Investigar estabelecimentos da raiz' na ficha para concluir as confirmações.";
        }
      } else if (bloqueioMaisRecenteQueCache) {
        l.estado = "INDISPONIVEL";
        l.motivo = `A investigação da raiz não concluiu por indisponibilidade da fonte em ${ultimaFalha!.data ?? "data não registrada"}. Tente novamente quando a fonte voltar.`;
        l.falta = "Localizar estabelecimentos da raiz. A consulta não concluiu.";
        l.proximaVerificacao = "Use 'Investigar estabelecimentos da raiz' na ficha quando a fonte voltar.";
      } else {
        const relCache = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: linha.cnpj } });
        const relParticipantes = relCache ? parseJsonSeguro<{ tipo: string }[]>(relCache.relacoesJson) ?? [] : [];
        const totalPf = relParticipantes.filter((p) => p.tipo === "PF").length;
        if (relCache && relCache.totalParticipantes === 0) {
          l.estado = "PESQUISA_DOCUMENTAL";
          l.motivo = "O quadro público consultado não tem participantes. A descoberta pela raiz precisa de pesquisa documental.";
          l.falta = "Evidência pública de estabelecimentos da raiz fora do quadro societário consultado.";
          l.proximaVerificacao = "Pesquisa documental na ficha, sempre sob comando.";
        } else {
          l.estado = "COMPLEMENTAR_API";
          l.motivo = "O quadro societário público desta raiz ainda não foi consultado (não consultado não é não encontrado). A consulta acontece na ficha, sob comando.";
          l.falta = "Faltam localizar e confirmar os estabelecimentos desta raiz.";
          l.proximaVerificacao = totalPf > 0
            ? "Use 'Investigar estabelecimentos da raiz' na ficha."
            : "Use 'Investigar relações societárias' na ficha para listar o quadro público.";
        }
      }
      lacunas.push(l);
    }

    /* ----- relações societárias (outras pessoas jurídicas vinculadas) ----- */
    {
      const l = lacunaVazia(PERGUNTAS_TRIAGEM.relacoes);
      if (mei) {
        l.estado = "NAO_APLICAVEL";
        l.motivo = "MEI (Microempreendedor Individual) não possui quadro societário — a pergunta não se aplica a esta natureza.";
        l.falta = null;
        l.proximaVerificacao = null;
      } else {
        const cache = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: linha.cnpj } });
        const bloqueios = await falhasDeFonte([linha.cnpj]);
        const ultimaFalha = bloqueios[0] ?? null;
        const bloqueioMaisRecenteQueCache = !!ultimaFalha && (!cache || new Date(ultimaFalha.data ?? 0) > cache.atualizadoEm);
        if (cache) {
          const participantes = parseJsonSeguro<{ tipo: string; nomePublico: string; cnpjParticipante: string | null; participanteId: string }[]>(cache.relacoesJson) ?? [];
          const pj = participantes.filter((p) => p.tipo === "PJ");
          const pf = participantes.filter((p) => p.tipo === "PF");
          // v0.10.6: expansões já executadas por comando — quadros lidos para fato consolidado
          const quadrosExpandidos = pf.length > 0
            ? await db.quadroParticipanteCache.findMany({ where: { participanteId: { in: pf.map((p) => p.participanteId).slice(0, 100) } } })
            : [];
          const conexoes = quadrosExpandidos.length;
          let estabOutrasPjs = 0;
          const raizesOutrasPjs = new Set<string>();
          for (const q of quadrosExpandidos) {
            const emp = parseJsonSeguro<{ cnpj: string }[]>(q.empresasJson) ?? [];
            for (const e of emp) {
              const r = raizDe(e.cnpj);
              if (r !== raiz) {
                estabOutrasPjs += 1;
                raizesOutrasPjs.add(r);
              }
            }
          }
          l.fatos = [
            {
              fato: `Quadro público consultado: ${plural(participantes.length, "participante", "participantes")} — ${plural(pj.length, "pessoa jurídica identificável", "pessoas jurídicas identificáveis")} por CNPJ e ${plural(pf.length, "pessoa física", "pessoas físicas")} por identificador opaco da fonte (identidades próprias; homônimos nunca são tratados como a mesma pessoa).`,
              fonte: cache.fonte + (cache.baseDados ? ` (base ${cache.baseDados})` : ""),
              data: iso(cache.coletadoEm),
            },
            ...(pj.length > 0
              ? [{ fato: `${plural(pj.length, "participação societária direta de outras pessoas jurídicas registrada", "participações societárias diretas de outras pessoas jurídicas registradas")} no quadro público (nomes/razões sociais conforme a fonte).`, fonte: cache.fonte, data: iso(cache.coletadoEm) }]
              : []),
            ...(conexoes > 0
              ? [{ fato: `Expansão por comando: ${plural(conexoes, "conexão", "conexões")} de sócios PF com quadro público — ${plural(estabOutrasPjs, "estabelecimento", "estabelecimentos")} em ${plural(raizesOutrasPjs.size, "outra pessoa jurídica distinta", "outras pessoas jurídicas distintas")} da consultada (identificadas pela raiz).`, fonte: cache.fonte, data: iso(cache.coletadoEm) }]
              : []),
          ];
          if (bloqueioMaisRecenteQueCache) {
            l.estado = "INDISPONIVEL";
            l.motivo = `A última consulta do quadro não concluiu por indisponibilidade da fonte em ${ultimaFalha!.data ?? "data não registrada"}. As informações anteriores continuam disponíveis.`;
            l.falta = "Atualizar o quadro público quando a fonte voltar.";
            l.proximaVerificacao = "Use 'Investigar relações societárias' na ficha quando a fonte voltar.";
          } else if (pj.length > 0) {
            l.estado = "RESOLVIDO";
            l.motivo = "O quadro público consultado registra participações diretas de outras pessoas jurídicas (relação entre empresas distintas, com fonte e data).";
            l.falta = null;
            l.proximaVerificacao = "Expanda uma conexão na ficha quando quiser aprofundar.";
          } else if (pf.length > 0 && conexoes < pf.length) {
            l.estado = "COMPLEMENTAR_API";
            l.motivo = "Sócios pessoas físicas aparecem no quadro público. Para descobrir outras empresas ligadas a eles, é preciso expandir as conexões na ficha, uma por comando.";
            l.falta = "Ainda não verificamos todas as empresas ligadas a esses participantes.";
            l.proximaVerificacao = "Use 'Investigar conexão' em cada participante da ficha.";
          } else {
            l.estado = "RESOLVIDO";
            l.motivo = pf.length > 0
              ? "Quadro público consultado e todas as conexões de sócios PF já expandidas por comando — a fonte estruturada disponível foi percorrida; novas empresas só apareceriam com alteração futura do quadro público."
              : "Quadro público consultado e registrado como está — ausência de participantes é ausência honesta, não falha.";
            l.falta = null;
            l.proximaVerificacao = null;
          }
        } else if (bloqueioMaisRecenteQueCache) {
          l.estado = "INDISPONIVEL";
          l.motivo = `A consulta do quadro público não concluiu por indisponibilidade da fonte em ${ultimaFalha!.data ?? "data não registrada"}. Tente novamente quando a fonte voltar.`;
          l.falta = "Consultar o quadro público. A consulta não concluiu.";
          l.proximaVerificacao = "Use 'Investigar relações societárias' na ficha quando a fonte voltar.";
        } else {
          l.estado = "COMPLEMENTAR_API";
          l.motivo = "O quadro societário público deste CNPJ ainda não foi consultado (não consultado não é não encontrado). A consulta acontece na ficha, sob comando.";
          l.falta = "Quadro societário público deste estabelecimento ainda não consultado.";
          l.proximaVerificacao = "Use 'Investigar relações societárias' na ficha.";
        }
      }
      lacunas.push(l);
    }

    /* ----- regime tributário vigente ----- */
    {
      const l = lacunaVazia(PERGUNTAS_TRIAGEM.regime);
      if (encerraPerguntasPj) {
        l.estado = "NAO_APLICAVEL";
        l.motivo = eMatrizDaRaiz
          ? `Estabelecimento (matriz) com situação "${linha.registrationStatus}" — regime VIGENTE não se aplica; o regime histórico permanece nos registros oficiais.`
          : `Evidência conhecida da raiz mostra todas as unidades confirmadas encerradas — regime VIGENTE não se aplica; o histórico permanece nos registros oficiais.`;
        l.falta = null;
        l.proximaVerificacao = null;
      } else if (extra.mei === "Sim") {
        l.estado = "RESOLVIDO";
        l.motivo = "Registro oficial declara optante pelo SIMEI (posição na data da coleta).";
        l.fatos = [{ fato: "Optante pelo SIMEI conforme registro oficial consultado (posição da data da coleta — não é projeção futura).", fonte: fontePrimaria, data: coletadoEm }];
        l.falta = null;
        l.proximaVerificacao = "Revalide a ficha mais tarde para atualizar a posição.";
      } else if (extra.simples === "Sim") {
        l.estado = "RESOLVIDO";
        l.motivo = "Registro oficial declara optante pelo Simples Nacional (posição na data da coleta).";
        l.fatos = [{ fato: "Optante pelo Simples Nacional conforme registro oficial consultado (posição da data da coleta — não é projeção futura).", fonte: fontePrimaria, data: coletadoEm }];
        l.falta = null;
        l.proximaVerificacao = "Revalide a ficha mais tarde para atualizar a posição.";
      } else if (extra.simples === "Não") {
        l.estado = "PESQUISA_DOCUMENTAL";
        l.motivo = "Registro oficial declara NÃO-optante por Simples Nacional e SIMEI (posição da data da coleta), mas o registro público não distingue Lucro Real de Lucro Presumido.";
        l.fatos = [{ fato: "Não-optante por Simples Nacional e SIMEI conforme registro oficial (posição da data da coleta).", fonte: fontePrimaria, data: coletadoEm }];
        l.falta = "Falta distinguir Lucro Real de Lucro Presumido. O registro público consultado não distingue.";
        l.proximaVerificacao = "Pesquisa documental (balanços publicados) na ficha, ou confirme com a empresa.";
      } else {
        l.estado = "PESQUISA_DOCUMENTAL";
        l.motivo = "O cadastro consultado não trouxe as flags de optância (não disponível na coleta não é não existente).";
        l.falta = "Falta o registro de optância pelo Simples ou MEI e, para não-optantes, o regime.";
        l.proximaVerificacao = "Revalide a ficha (outra fonte pode trazer as flags) ou peça pesquisa documental.";
      }
      if (notaEstabelecimentoBaixado) l.fatos.unshift({ ...notaEstabelecimentoBaixado });
      lacunas.push(l);
    }

    /* ----- contabilidade interna ----- */
    {
      const l = lacunaVazia(PERGUNTAS_TRIAGEM.contabilidade);
      if (encerraPerguntasPj) {
        l.estado = "NAO_APLICAVEL";
        l.motivo = eMatrizDaRaiz
          ? `Estabelecimento (matriz) com situação "${linha.registrationStatus}" — estrutura operacional vigente não se aplica.`
          : `Evidência conhecida da raiz mostra todas as unidades confirmadas encerradas — estrutura operacional vigente não se aplica.`;
        l.falta = null;
        l.proximaVerificacao = null;
      } else if (mei) {
        l.estado = "NAO_APLICAVEL";
        l.motivo = "MEI — microempreendedor individual com obrigações simplificadas; a pergunta de contabilidade interna não se aplica a esta natureza.";
        l.falta = null;
        l.proximaVerificacao = null;
      } else {
        const sinais = (research?.sinaisPorte ?? []).map((s, i) => ({
          texto: s,
          fonte: research?.sinaisPorteFontes?.[i]?.fonte ?? null,
          url: research?.sinaisPorteFontes?.[i]?.url ?? null,
        }));
        const comContab = sinais.filter((s) => RE_CONTAB.test(s.texto));
        if (comContab.length > 0) {
          // v0.10.7 (auditoria): INDÍCIO NÃO É RESOLUÇÃO — a vaga/menção fica como
          // FATO com proveniência e a lacuna segue ABERTA (VALIDACAO_HUMANA). A
          // exportação leva SÓ a síntese determinística (texto livre fica na ficha).
          l.estado = "VALIDACAO_HUMANA";
          l.motivo = "Indício público registrado como fato. A menção não comprova a estrutura interna atual.";
          l.fatos = comContab.map((s) => {
            const termo = s.texto.match(RE_CONTAB)?.[0] ?? null;
            return {
              fato: s.texto,
              fonte: s.fonte ?? "pacote de pesquisa",
              data: research?.geradoEm ?? null,
              origem: "sinal" as const,
              sintese: `Indício público de contabilidade própria detectado em pesquisa documental${termo ? ` (termo: "${termo}")` : ""} — texto integral preservado apenas na ficha interna (privacidade); não comprova estrutura interna atual.`,
            };
          });
          l.falta = "Falta confirmar se mantém contabilidade ou fiscal internos hoje.";
          l.proximaVerificacao = "Confirme por conversa com a empresa. Se precisar, peça pesquisa documental na ficha.";
        } else {
          l.estado = "VALIDACAO_HUMANA";
          l.motivo = research
            ? `A pesquisa de ${research.geradoEm ? new Date(research.geradoEm).toLocaleDateString("pt-BR") : "data não registrada"} não trouxe sinal público de estrutura contábil. A confirmação depende da empresa.`
            : "Sem pesquisa documental até agora. A resposta final depende da declaração da empresa.";
          l.falta = "Falta confirmar se mantém contabilidade ou fiscal internos.";
          l.proximaVerificacao = "Confirme por conversa com a empresa. Uma pesquisa documental (vagas, estrutura) pode trazer sinais.";
        }
      }
      if (notaEstabelecimentoBaixado) l.fatos.unshift({ ...notaEstabelecimentoBaixado });
      lacunas.push(l);
    }

    /* ----- tecnologia / ERP ----- */
    {
      const l = lacunaVazia(PERGUNTAS_TRIAGEM.tecnologia);
      if (encerraPerguntasPj) {
        l.estado = "NAO_APLICAVEL";
        l.motivo = eMatrizDaRaiz
          ? `Estabelecimento (matriz) com situação "${linha.registrationStatus}" — stack operacional vigente não se aplica.`
          : `Evidência conhecida da raiz mostra todas as unidades confirmadas encerradas — stack operacional vigente não se aplica.`;
        l.falta = null;
        l.proximaVerificacao = null;
      } else {
        const fontesSinais = [
          ...(research?.sinaisPorte ?? []).map((s, i) => ({ texto: s, fonte: research?.sinaisPorteFontes?.[i]?.fonte ?? null })),
          ...(research?.sinaisDigitais ?? []).map((s) => ({ texto: s, fonte: null as string | null })),
        ];
        const comErp = fontesSinais.filter((s) => RE_ERP.test(s.texto));
        if (comErp.length > 0) {
          // v0.10.7 (auditoria): INDÍCIO NÃO É RESOLUÇÃO — a menção (inclusive em
          // vaga de terceiro/parceiro) fica como FATO com proveniência e a lacuna
          // segue ABERTA (PESQUISA_DOCUMENTAL: comprovar implantação/uso em produção).
          // Exportação leva SÓ a síntese determinística (texto livre fica na ficha).
          l.estado = "PESQUISA_DOCUMENTAL";
          l.motivo = "Indício público de sistema de gestão registrado como fato. A menção não comprova implantação ou uso em produção.";
          l.fatos = comErp.map((s) => {
            const termo = s.texto.match(RE_ERP)?.[0] ?? null;
            return {
              fato: s.texto,
              fonte: s.fonte ?? "pacote de pesquisa (sinal digital)",
              data: research?.geradoEm ?? null,
              origem: "sinal" as const,
              sintese: `Indício público de sistema de gestão detectado em pesquisa documental${termo ? ` (termo: "${termo}")` : ""} — texto integral preservado apenas na ficha interna (privacidade); menção não comprova implantação ou uso em produção.`,
            };
          });
          l.falta = "Falta comprovar a implantação e o uso em produção pela própria empresa. A menção pode ser de vaga de terceiro ou parceiro.";
          l.proximaVerificacao = "Pesquisa documental dirigida (páginas da própria empresa, integrações públicas) na ficha, ou confirme por conversa.";
        } else {
          l.estado = "PESQUISA_DOCUMENTAL";
          const tecnologiaPesquisada = research?.dimensoesPesquisadas?.tecnologia;
          l.motivo = research
            ? tecnologiaPesquisada
              ? "Pesquisa documental já executada (dimensão tecnologia) e nenhum sinal público encontrado."
              : "Pacote de pesquisa existente, mas a dimensão tecnologia não foi pesquisada: NÃO PESQUISADO."
            : "Pesquisa documental candidata: ainda NÃO PESQUISADO. Acontece na ficha, sob comando.";
          l.falta = "Falta identificar o sistema de gestão em uso. Não consta nos registros públicos consultados.";
          l.proximaVerificacao = "Pesquisa documental (vagas, integrações, páginas de carreira) na ficha, sob comando.";
        }
      }
      if (notaEstabelecimentoBaixado) l.fatos.unshift({ ...notaEstabelecimentoBaixado });
      lacunas.push(l);
    }
  }

  return {
    ok: true,
    rowNumber: linha.rowNumber,
    cnpj: linha.cnpj,
    cnpjRaiz: linha.cnpjRaiz,
    razaoSocial: linha.legalName,
    calculadoEm,
    lacunas,
    resumo: resumoDe(lacunas),
  };
}
