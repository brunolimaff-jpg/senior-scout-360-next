/** Tipos compartilhados entre frontend e contrato das APIs. */

/** Estatísticas da detecção ao vivo do texto colado (mesma forma do backend). */
export interface TextStatsView {
  total: number;
  header: number;
  cnpjValido: number;
  cnpjInvalido: number;
  dominio: number;
  email: number;
  url: number;
  nome: number; // pistas por nome de empresa
  invalido: number;
}

export interface BatchPreview {
  id: string;
  fileName: string;
  fileSize: number;
  sourceType?: string;
  delimiter: string;
  encoding: string;
  hasHeader: boolean;
  header: string[];
  cnpjColumnIndex: number;
  cnpjColumnDetectedBy: string;
  rowCount: number;
  sampleRows: string[][] | Record<string, unknown>[];
  status: string;
  textStats?: TextStatsView;
}

export interface BatchSummaryView {
  resumo_executivo: string;
  destaques: string[];
  prioridades: string[];
  modelo?: string;
}

/** Item de distribuição do panorama do lote (setor/UF/situação). */
export interface DistItem {
  key: string;
  count: number;
}

/** Candidato de aderência ao portfólio Senior (hipótese por processo, nunca promessa). */
export interface PortfolioFitView {
  produto: string;
  processo: string;
  hipotese: string;
}

/** Evidência citável do dossiê profundo (entidade -> claim -> status -> fonte -> período). */
export interface EvidenceItemView {
  claim: string;
  status: "CONFIRMADO" | "INDICIO" | "HIPOTESE" | "NAO_COMPROVADO" | "NAO_ENCONTRADO";
  source: string;
  url: string | null;
  relevancia: "alta" | "media" | "baixa";
  /** a qual entidade o claim se refere (PJ analisada, grupo, marca, terceiro) */
  entidade?: string;
  /** período de referência do fato — número sem período é reprovação */
  periodo?: string | null;
}

/** Hipótese no formato do contrato: FATO OBSERVADO -> CONSEQUÊNCIA -> VALIDAR. */
export interface DetailedHypothesisView {
  fato: string;
  consequencia: string;
  validar: string;
}

/** Auditoria do modelo de IA: o que foi pedido vs. o que o gateway efetivamente usou. */
export interface ModelAuditView {
  solicitado: string;
  efetivo: string;
  fallback: boolean;
  em: string;
}

export interface AccountDossierView {
  sintese: string;
  perfil: string;
  teia: string[];
  operacao: string[];
  tecnologia: string[];
  aderencia: PortfolioFitView[];
  tese: string;
  // ---- v2 (leitura profunda com research packet) ----
  profunda?: boolean;
  /** qual entidade está no escopo (PJ/marca/grupo) e o que ficou FORA */
  entidadeEscopo?: string;
  quemE?: string;
  oQueFaz?: string[];
  escalaEstrutura?: string[];
  pessoas?: string[];
  mudancasSinais?: string[];
  naoSabemos?: string[];
  hipotesesDetalhadas?: DetailedHypothesisView[];
  evidencias?: EvidenceItemView[];
  modeloAuditoria?: ModelAuditView;
}

/** Notícia pública mapeada por nome (Google News RSS) — visual no dossiê, link real. */
export interface NewsItemView {
  titulo: string;
  fonte: string;
  data: string | null;
  link: string;
}

/** Metadados do pacote de pesquisa persistido (resumo — trechos completos ficam no backend). */
export interface ResearchPacketView {
  dominio: string | null;
  paginas: { url: string; titulo: string; tipo: string }[];
  buscas: { query: string; objetivo?: string; resultados: number }[];
  notas: string[];
  sinaisDigitais: string[];
  /** notícias da imprensa mapeadas por nome da empresa e sócios */
  noticias: NewsItemView[];
  /** sinais de porte real detectados deterministicamente (headcount, faturamento, frota, unidades) */
  sinaisPorte: string[];
  /** v0.9.1: fonte de cada sinal (mesma ordem de sinaisPorte) — atribuição por matching
   *  determinístico contra os resultados crus das buscas salvas; null quando não achou */
  sinaisPorteFontes?: ({ fonte: string; url: string | null } | null)[];
  /** queries de teia societária executadas (sócios como chave) */
  teiaBuscada: string[];
  paginasOk: number;
  paginasTentadas: number;
  buscasOk: number;
  geradoEm: string | null;
  /** v0.9.0: modo de coleta do pacote (COMPLETO | ADAPTATIVO | null p/ pacotes antigos) */
  modoPesquisa: string | null;
  /** v0.9.0: buscas recusadas por cota — "não encontrado" sob cota esgotada não é conclusivo */
  buscasRecusadasCota: number;
  /** v0.9.0: dimensões que EFETIVAMENTE tiveram buscas (diferença NÃO_ENCONTRADO vs NÃO_PESQUISADO) */
  dimensoesPesquisadas: {
    identidade: boolean;
    tecnologia: boolean;
    escala: boolean;
    comercial: boolean;
    teia: boolean;
    periodo: boolean;
  };
}

/** Sócio determinístico capturado do QSA das fontes públicas. */
export interface SocioView {
  nome: string;
  qual?: string;
  entrada?: string;
}

/** Contexto municipal IBGE anexado ao enriquecimento (mapeamento geográfico oficial). */
export interface IbgeContextView {
  populacao?: string;
  anoPopulacao?: string;
  regiaoImediata?: string;
  regiaoIntermediaria?: string;
  mesorregiao?: string;
  microrregiao?: string;
  regiao?: string;
}

/** Fatos extras determinísticos da consulta (capital, natureza, optantes, contato...). */
export interface RowExtraView {
  capitalSocial?: string;
  naturezaJuridica?: string;
  porte?: string;
  simples?: string;
  mei?: string;
  email?: string;
  telefone?: string;
  telefone2?: string;
  regimeTributario?: string;
  endereco?: string;
  cnaesSecundarios?: string[];
  /** v0.10.0: true quando a lista de CNAEs atingiu o teto de segurança (200) */
  cnaesTruncados?: boolean;
  /** v0.10.1: true quando o QSA atingiu o teto de segurança (500) — lista declarada incompleta */
  qsaTruncados?: boolean;
  /** código IBGE do município quando a fonte traz (BrasilAPI/MinhaReceita) */
  codigoMunicipioIbge?: string;
  /** contexto IBGE completo (população, região imediata, mesorregião) */
  ibge?: IbgeContextView | null;
  /** P3-A (v0.10.4): classificação multissetorial derivada LOCALMENTE do CNAE 2.0 —
   *  classificação CADASTRAL do estabelecimento consultado (não perfil de operação,
   *  não produto, não necessidade comercial) */
  setorPrimario?: string;
  setoresSecundarios?: string[];
  multissetorial?: boolean;
  avisosSetoriais?: string[];
}

/** ENTITY_BINDING: o que uma fonte prova (ou não) sobre o vínculo pista ↔ CNPJ. */
export interface BindingView {
  bindingType: string;
  strength: string;
  sourceUrl: string | null;
  sourceOwner: string | null;
  mentionedEntity: string | null;
  candidateLegalName: string | null;
  candidateCnpj: string | null;
  bindingEvidence: string;
  date?: string;
}

/** CNPJ/fonte rejeitada pelo gate de vínculo — auditoria do que NÃO virou candidato. */
export interface DiscardedCandidateView {
  cnpj: string | null;
  host: string | null;
  fonte: string | null;
  bindingType: string;
  motivo: string;
}

/** Candidato a empresa produzido pela resolução de identidade (contrato auditorável). */
export interface ResolutionCandidateView {
  cnpj: string;
  strength: string;
  sinais: string[];
  contradicoes: string[];
  fontes: { fonte: string; url: string | null; detalhe?: string }[];
  bindings?: BindingView[];
  /** dados do registro oficial — validam o CNPJ, NUNCA o vínculo com a pista */
  dadosJuridicos?: string[];
  confirmado: { razaoSocial: string; uf: string; municipio: string; identificador: number | null; fonte: string } | null;
}

export interface ResolutionView {
  metodo: string[];
  notas: string[];
  candidatos: ResolutionCandidateView[];
  descartados?: DiscardedCandidateView[];
}

/**
 * Corpo do POST /decide (Fase 5 — revisão sem beco sem saída):
 * - { cnpj } mantém o contrato legado (string confirma; null = "nenhuma destas");
 * - { action } são as saídas do painel: nova pista, não identificada, voltar aos candidatos.
 */
export type DecideRequest =
  | { cnpj: string | null }
  | { action: "CLUE"; value: string }
  | { action: "NOT_FOUND" }
  | { action: "BACK" }
  /** v0.10.12: operador valida o registro localizado divergente (LOCALIZADO → VALIDADO) */
  | { action: "VALIDAR_REGISTRO" };

export interface BatchDetail {
  id: string;
  fileName: string;
  status: string;
  sourceType: string;
  delimiter: string;
  encoding: string;
  hasHeader: boolean;
  header: string[];
  cnpjColumnIndex: number | null;
  rowCount: number;
  fileSize: number;
  /** v0.9.1: prévia reconstruída do arquivo salvo quando status === "PREVIEW" —
   *  permite reabrir o upload depois de perder o estado do cliente (reload) */
  previewRecoveravel?: { header: string[]; sampleRows: string[][]; cnpjColumnIndex: number | null; rowCount: number } | null;
  totalValid: number;
  totalInvalid: number;
  totalDuplicate: number;
  totalReference: number;
  totalResolved: number;
  totalEnriched: number;
  totalPending: number;
  totalConfirmed: number;
  totalReview: number;
  totalUnresolved: number;
  /** v0.10.12: estágio de confiança da identidade */
  totalLocalizado: number;
  totalValidado: number;
  /** v0.10.15 (reconciliação): consultas que terminaram em falha de fonte (NAO_ENCONTRADO, RATE_LIMITED, TIMEOUT, ERRO_REDE, ERRO_SERVIDOR) */
  totalFalhasConsulta: number;
  totalMatriz: number;
  totalDirectCnpj: number;
  /** v0.11.0 (Gate 3/C): população exata do filtro rápido "Pendentes" (lookupStatus FILA) — o número do botão deve bater com a tabela filtrada. */
  totalFila: number;
  /** v0.10.7 (auditoria): quantidades DISTINTAS pela raiz — a raiz é a pessoa
   *  jurídica; matriz+filiais do mesmo root NÃO são empresas distintas.
   *  v0.10.14 (reconciliação): identificadas = raízes compatíveis (o que a tabela
   *  marca como Identificada); localizadas = todas as raízes com ficha coletada,
   *  incluindo as que aguardam revisão de identidade. */
  totalPessoasJuridicas: number;
  totalPessoasJuridicasLocalizadas: number;
  totalMatrizesDistintas: number;
  // alertas materiais (batch-wide) — devem saltar na tela antes de qualquer exportação
  alertBaixada: number;
  alertMatriz: number;
  alertHumana: number;
  // panorama do lote — distribuições batch-wide (top 6)
  /** v0.10.8 (coerência): setor CADASTRAL pela tabela CNAE 2.0 (determinístico, sem IA) */
  cnaeDist: DistItem[];
  /** setor INFERIDO pela leitura de IA (hipótese — exibido separado do cadastral) */
  sectorDist: DistItem[];
  ufDist: DistItem[];
  situacaoDist: DistItem[];
  aiEnabled: boolean;
  aiTotal: number;
  aiDone: number;
  aiFailed: number;
  aiSummary: BatchSummaryView | null;
  aiSummaryAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  processingAt: string | null;
  finishedAt: string | null;
  processingNow: boolean;
  /** Mesa de Contas (v0.9.0): fila de pesquisa profunda por seleção — null = nunca usada */
  filaPesquisa: ResearchQueueView | null;
  /** v0.11.3 (missão Lotes+Mesa): dimensão PESQUISA PROFUNDA do contrato de estados —
   * calculada na fonte canônica (researchStatus/aiStatus/lookupStatus das linhas),
   * nunca derivada de filtros de UI. Identificação cadastral, revisão de identidade
   * e prontidão do dossiê são dimensões INDEPENDENTES que coexistem na mesma conta. */
  pesquisaProfunda: PesquisaProfundaView;
}

/** v0.11.3 (missão Lotes+Mesa): contadores canônicos da etapa de pesquisa profunda.
 * Regra do contrato: um lote com 11 identificadas e 3 dossiês prontos NÃO tem
 * 11 dossiês — cada etapa tem o próprio número e denominador. */
export interface PesquisaProfundaView {
  /** linhas com pesquisa profunda já registrada (researchStatus ≠ null) */
  solicitadas: number;
  /** pacotes de pesquisa concluídos (researchStatus OK) — inclui os que ainda sintetizam */
  concluidas: number;
  /** pacotes em coleta agora (researchStatus GERANDO) */
  emExecucao: number;
  /** pacote pronto, síntese em preparo (aiStatus EM_FILA/GERANDO) */
  sintetizando: number;
  /** pesquisa que falhou (researchStatus FALHOU) + síntese que falhou após pacote pronto */
  falhas: number;
  /** DOSSIÊS PRONTOS para a Mesa: pesquisa OK + síntese OK + cadastro concluído +
   * SEM bloqueio de identidade (mesma definição de bloqueio do totalReview). */
  dossiesProntos: number;
  /** contas com cadastro concluído e sem bloqueio de identidade — denominador honesto
   * da pesquisa (ex.: “pesquisa concluída em 3 de 11 identificadas”) */
  identificadasElegiveis: number;
}

/** Estado durável da fila de pesquisa por seleção (Mesa de Contas v0.9.0). */
export interface ResearchQueueView {
  estado: "RODANDO" | "PAUSADA" | "CONCLUIDA" | "PARADA";
  /** índice da próxima conta a processar */
  posicao: number;
  total: number;
  concluidas: number;
  puladas: number;
  falhas: number;
  motivoPausa: string | null;
  solicitadoEm: string;
  heartbeat: string;
  /** executor em memória vivo NESTE processo (informacional; heartbeat é a verdade durável) */
  executorVivo: boolean;
  /** contas ainda não processadas pela fila (rowNumbers) — visibilidade per/linha */
  pendentes: number[];
}

/* ---------------- v0.10.5 — Relações empresariais + matriz/filiais ----------------
 * Views compartilhadas entre o serviço (servidor) e os painéis da ficha (client).
 * Contrato: SEM CPF em nenhum campo; identidade própria por participante
 * (hash opaco para PF, CNPJ para PJ); cobertura sempre honesta (parcial/completa);
 * "participante comum" NUNCA rotulado como grupo econômico. */

/** Qualificação reaproveitada do cadastro existente (sem HTTP novo). */
export interface QualificacaoCadastro {
  qual: string;
  entrada: string;
  origem: "cadastro";
}

/** Outra empresa do MESMO lote que compartilha o participante (evidência dupla). */
export interface ParticipanteComumView {
  cnpj: string;
  razaoSocial: string | null;
  /** frase honesta: participante comum NÃO caracteriza grupo econômico */
  nota: string;
}

/**
 * v0.10.6 — consolidação de identidade: participante que também figura no quadro
 * de OUTRO ESTABELECIMENTO DA MESMA RAIZ. Isso é a MESMA pessoa jurídica
 * (matriz/filial), NUNCA uma relação entre empresas distintas — exibido
 * separadamente de `comumCom` (que agora só contém raízes distintas).
 */
export interface ComumMesmaPjView {
  /** outro estabelecimento da MESMA raiz (mesma pessoa jurídica) */
  cnpj: string;
  nota: string;
}

/** v0.10.16: tipo do participante COM estado honesto — INDETERMINADO quando a
 *  fonte não prova nem pessoa física (hash) nem pessoa jurídica (CNPJ com DV). */
export interface ParticipanteView {
  /** identidade própria na fonte: hash opaco (PF), CNPJ (PJ) ou outro identificador (INDETERMINADO). Nunca CPF. */
  participanteId: string;
  tipo: "PF" | "PJ" | "INDETERMINADO";
  /** nome público conforme quadro societário (PF) ou razão social (PJ). */
  nomePublico: string;
  /** para PJ: CNPJ completo do participante. null para PF. */
  cnpjParticipante: string | null;
  qualificacao: QualificacaoCadastro | null;
  /** participante comum com PESSOAS JURÍDICAS DISTINTAS (raízes diferentes) — nunca grupo econômico */
  comumCom: ParticipanteComumView[];
  /** v0.10.6: participante também presente em OUTRO ESTABELECIMENTO DA MESMA RAIZ —
   *  mesma pessoa jurídica, NÃO é relação entre empresas distintas */
  comumMesmaPj: ComumMesmaPjView[];
  razaoSocialPj: string | null;
}

export interface RelacoesView {
  ok: true;
  cnpj: string;
  razaoSocialConsultada: string | null;
  fonte: string;
  baseDados: string | null;
  coletadoEm: string;
  validoAte: string;
  via: "cache" | "consulta";
  participantes: ParticipanteView[];
  totalParticipantes: number;
  existeParticipanteComum: boolean;
  avisos: string[];
}

export interface EmpresaQuadro {
  cnpj: string;
  razaoSocial: string | null;
}

/**
 * Quadro de UM participante (expansão manual de UMA conexão, 1 hop).
 * v0.10.6 — consolidação de identidade: cada CNPJ do quadro é um
 * ESTABELECIMENTO; a contagem de EMPRESAS (pessoas jurídicas) é feita por
 * RAIZ distinta em `totalPessoasJuridicas`. `totalEmpresas` segue presente
 * por compatibilidade e conta CNPJs completos distintos (estabelecimentos).
 */
export interface QuadroView {
  ok: true;
  participanteId: string;
  tipoParticipante: "PF" | "PJ" | "INDETERMINADO";
  rotulo: string | null;
  /** PF: empresas onde figura; PJ: quadro de sócios do participante */
  leitura: string;
  /** CNPJs completos distintos no quadro = ESTABELECIMENTOS (não empresas) */
  totalEmpresas: number;
  /** v0.10.6: PESSOAS JURÍDICAS distintas (raízes de 8 caracteres) no quadro */
  totalPessoasJuridicas: number;
  truncado: boolean;
  empresas: EmpresaQuadro[];
  empresasOcultas: number;
  fonte: string;
  coletadoEm: string;
  validoAte: string;
  via: "cache" | "consulta";
  avisos: string[];
}

export interface EstabelecimentoView {
  cnpj: string;
  razaoSocial: string | null;
  municipio: string | null;
  uf: string | null;
  situacao: string | null;
  cnae: string | null;
  /** campo OFICIAL da Receita: 1 = matriz, 2 = filial (null = não confirmado) */
  identificadorMatrizFilial: number | null;
  confirmado: boolean;
  descobertoPor: string;
  confirmadoEm: string | null;
  fonteConfirmacao: string | null;
}

export interface MatrizFiliaisView {
  ok: true;
  cnpjRaiz: string;
  raizAlfanumerica: boolean;
  fonteDescoberta: string;
  coletadoEm: string;
  atualizadoEm: string;
  validoAte: string;
  via: "cache" | "consulta" | "cache_parcial";
  consultado: { cnpj: string; branchType: string | null; branchIdentifier: number | null };
  matriz: EstabelecimentoView | null;
  filiais: EstabelecimentoView[];
  localizadosNaoConfirmados: EstabelecimentoView[];
  cobertura: {
    parcial: true;
    participantesConsultados: number;
    totalParticipantesPf: number;
    tetoParticipantes: number;
    tetoConfirmacoes: number;
    confirmadosNaRodada: number;
    pendentesConfirmacao: number;
  };
  avisos: string[];
}

/* ---------------- v0.10.6 — TRIAGEM LOCAL DETERMINÍSTICA (sem IA) ----------------
 * Camada entre a coleta (cadastro/relações/estabelecimentos) e qualquer decisão
 * futura de investigação. Regras do contrato do operador:
 *  - Classifica LACUNAS (perguntas), nunca a empresa inteira; nunca score comercial.
 *  - Usa EXCLUSIVAMENTE fatos já coletados — zero chamada de IA, zero busca web.
 *  - NÃO ENCONTRADO ≠ NÃO PESQUISADO (o motivo carrega a diferença).
 *  - Estados: RESOLVIDO | COMPLEMENTAR_API | PESQUISA_DOCUMENTAL |
 *    VALIDACAO_HUMANA | INDISPONIVEL | NAO_APLICAVEL. */

export type EstadoTriagem =
  | "RESOLVIDO"
  | "COMPLEMENTAR_API"
  | "PESQUISA_DOCUMENTAL"
  | "VALIDACAO_HUMANA"
  | "INDISPONIVEL"
  | "NAO_APLICAVEL";

export const ESTADO_TRIAGEM_LABEL: Record<EstadoTriagem, string> = {
  RESOLVIDO: "Resolvido sem IA",
  COMPLEMENTAR_API: "Fonte estruturada pode resolver",
  PESQUISA_DOCUMENTAL: "Exige pesquisa documental",
  VALIDACAO_HUMANA: "Depende de validação humana",
  INDISPONIVEL: "Consulta indisponível",
  NAO_APLICAVEL: "Não aplicável",
};

/** Fato já coletado que sustenta (parcialmente ou por completo) a pergunta. */
export interface FatoTriagemView {
  fato: string;
  fonte: string | null;
  /** data da COLETA do fato (ISO) — a vigência é da fonte, nunca inferida */
  data: string | null;
  /** v0.10.7 (auditoria): origem do texto do fato —
   *  "estrutura" = gerado pelo motor a partir de campos estruturados do registro oficial
   *  (seguro para exportar); "sinal" = texto livre capturado em pesquisa (vai pelo
   *  pipeline reforçado de privacidade antes de qualquer exportação). */
  origem?: "estrutura" | "sinal";
  /** v0.10.7 (auditoria): síntese determinística SEM texto livre para exportação —
   *  gerada pelo motor a partir de um termo fechado (regex de catálogo). Quando
   *  presente, a exportação TRIAGEM_V1 leva ESTA síntese no lugar do texto bruto. */
  sintese?: string;
}

export interface LacunaTriagemView {
  /** id estável da pergunta no catálogo (identidade, estabelecimentos, …) */
  perguntaId: string;
  pergunta: string;
  estado: EstadoTriagem;
  /** regra determinística aplicada, em linguagem honesta */
  motivo: string;
  /** sobre qual entidade a pergunta incide */
  entidade: "PESSOA_JURIDICA" | "ESTABELECIMENTO";
  fatos: FatoTriagemView[];
  /** o que falta comprovar — null quando NAO_APLICAVEL ou nada falta */
  falta: string | null;
  /** próxima verificação possível — null quando não há verificação disponível */
  proximaVerificacao: string | null;
  /** por que resolver pode ser útil — sem score, sem promessa comercial */
  utilidade: string;
}

export interface TriagemLinhaView {
  ok: true;
  rowNumber: number;
  cnpj: string | null;
  cnpjRaiz: string | null;
  razaoSocial: string | null;
  calculadoEm: string;
  lacunas: LacunaTriagemView[];
  resumo: Record<EstadoTriagem, number>;
}

/** Erro estruturado da fonte de grafos (repassado pelo corpo do erro da API). */
export interface ErroFonteView {
  tipo: string;
  httpStatus: number | null;
  mensagem: string;
}

export interface RowDetail {
  rowNumber: number;
  entrada: string | null;
  lookupKind: string;
  referenceValue: string | null;
  resolvedCnpj: string | null;
  reverseSource: string | null;
  clues: Record<string, unknown> | null;
  resolution: ResolutionView | null;
  resolutionState: string | null;
  resolutionConfidence: string | null;
  /** v0.10.12: estágio de confiança da identidade (LOCALIZADO | CORRESPONDENTE | VALIDADO) */
  identityStage: string | null;
  /** v0.10.12: divergências entre pistas e cadastro, explicadas para humanos */
  identityDivergencias: { tipo: string; severidade: string; descricao: string }[];
  cnpjRoot: string | null;
  headquartersCnpj: string | null;
  foundIsHeadquarters: boolean | null;
  matrizStatus: string | null;
  branchIdentifier: number | null;
  rawCnpj: string;
  normalizedCnpj: string;
  cnpjStatus: string;
  invalidReason: string | null;
  duplicateOf: number | null;
  lookupStatus: string;
  lookupError: string | null;
  legalName: string | null;
  tradeName: string | null;
  registrationStatus: string | null;
  branchType: string | null;
  municipality: string | null;
  uf: string | null;
  /** atividade econômica principal (fato público da ficha do dossiê) */
  cnaeDescription: string | null;
  /** data de abertura da empresa (fato público da ficha do dossiê) */
  openingDate: string | null;
  source: string | null;
  queriedAt: string | null;
  /** v0.10.0: data da COLETA ORIGINAL na fonte (diferente de queriedAt quando a linha reusa ficha cadastral) */
  collectedAt: string | null;
  /** v0.10.0: proveniência de fontes/campos (fonte primária + complementações + reuso de ficha) */
  fontes: {
    primaria: { fonte: string; coletadoEm: string };
    complementacoes: { fonte: string; campos: string[]; coletadoEm: string }[];
    cache: { consultaOriginal: string; validoAte: string; reaproveitadoEm: string } | null;
  } | null;
  // inteligência de conta (IA)
  aiStatus: string | null;
  aiReading: string | null;
  aiSector: string | null;
  aiSize: string | null;
  aiProfile: string | null;
  aiModel: string | null;
  aiModelRequested: string | null;
  aiHypotheses: string[];
  aiDossier: AccountDossierView | null;
  // pesquisa profunda da conta (research packet)
  researchStatus: string | null; // GERANDO | OK | FALHOU | null (nunca pedido)
  researchAt: string | null;
  researchError: string | null;
  research: ResearchPacketView | null;
  socios: SocioView[];
  extra: RowExtraView | null;
  aiProcessedAt: string | null;
  aiError: string | null;
}

export interface HistoryItem {
  id: string;
  fileName: string;
  status: string;
  sourceType: string;
  rowCount: number;
  totalValid: number;
  totalInvalid: number;
  totalDuplicate: number;
  totalReference: number;
  totalResolved: number;
  totalEnriched: number;
  totalPending: number;
  totalConfirmed: number;
  totalReview: number;
  delimiter: string;
  encoding: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditEventView {
  id: string;
  ts: string;
  event: string;
  rowNumber: number | null;
  detail: unknown;
}

export interface ApiError {
  code: string;
  message: string;
}

export const LOOKUP_KIND_LABEL: Record<string, string> = {
  CNPJ: "CNPJ",
  DOMAIN: "domínio",
  EMAIL: "e-mail",
  URL: "site",
  NAME: "nome",
};

export interface GlobalStats {
  batches: { total: number; byStatus: { status: string; count: number }[] };
  rows: {
    total: number;
    valid: number;
    invalid: number;
    duplicate: number;
    semCnpj: number;
    reference: number;
    resolved: number;
    enriched: number;
    pending: number;
    failed: number;
    taxaEnriquecimento: number;
  };
  byCnpjStatus: { key: string; count: number }[];
  byLookup: { key: string; count: number }[];
  topUf: { uf: string; count: number }[];
  bySource: { source: string; count: number }[];
  cacheHits: number;
  reverseHits: number;
  auditEvents: number;
  recent: {
    id: string;
    fileName: string;
    status: string;
    rowCount: number;
    totalValid: number;
    totalEnriched: number;
    totalPending: number;
    createdAt: string;
  }[];
}

export const BATCH_STATUS_LABEL: Record<string, string> = {
  PREVIEW: "Prévia",
  CONFIRMED: "Confirmado",
  PROCESSING: "Processando",
  DONE: "Concluído",
  PARTIAL: "Concluído c/ falhas",
  FAILED: "Falhou",
};

export const CNPJ_STATUS_LABEL: Record<string, string> = {
  VALIDA: "Válido",
  INVALIDA: "Inválido",
  DUPLICADA: "Duplicado",
  SEM_CNPJ: "Sem CNPJ",
  REFERENCIA: "Por referência",
};

export const LOOKUP_STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  EM_FILA: "Na fila",
  CONSULTANDO: "Consultando",
  ENRIQUECIDO: "Enriquecido",
  NAO_ENCONTRADO: "Não encontrado",
  RATE_LIMITED: "Limite de taxa",
  TIMEOUT: "Timeout",
  ERRO_REDE: "Erro de rede",
  ERRO_SERVIDOR: "Erro do servidor",
  IGNORADO: "Ignorado",
};

export const AI_STATUS_LABEL: Record<string, string> = {
  EM_FILA: "Na fila",
  GERANDO: "Gerando…",
  OK: "Pronta",
  FALHOU: "Falhou",
  IGNORADO: "Fora do teto",
};

/** Estado da resolução de identidade — linguagem do usuário final, nunca jargão. */
export const RESOLUTION_STATE_LABEL: Record<string, string> = {
  CONFIRMED: "Empresa confirmada",
  REVIEW: "Revisar",
  UNRESOLVED: "Não encontrada",
};

/** Força da evidência (tabela de evidências — nunca score de modelo). */
export const CONFIDENCE_LABEL: Record<string, string> = {
  MUITO_FORTE: "evidência muito forte",
  FORTE: "evidência forte",
  MEDIA: "evidência média",
  BAIXA: "evidência fraca",
};

export const MATRIZ_STATUS_LABEL: Record<string, string> = {
  RESOLVIDA: "matriz confirmada",
  NAO_LOCALIZADA: "matriz não localizada",
};

export const STRENGTH_LABEL: Record<string, string> = {
  MUITO_FORTE: "muito forte",
  FORTE: "forte",
  MEDIA: "média",
  BAIXA: "fraca",
};

/** Tradução amigável de falhas de consulta — sem jargão técnico (tom de voz Senior). */
export function friendlyLookupError(status: string, rawError: string | null): string {
  switch (status) {
    case "RATE_LIMITED":
      return "Muitas consultas em sequência — aguarde alguns segundos e tente de novo.";
    case "TIMEOUT":
    case "ERRO_REDE":
      return "Não foi possível consultar agora. Tente novamente em instantes.";
    case "ERRO_SERVIDOR":
      return "A fonte pública está instável no momento. Tente novamente.";
    case "NAO_ENCONTRADO":
      return rawError && /registro\.br|RDAP|domínio/i.test(rawError)
        ? "Não encontramos o dono deste domínio no registro .br (domínio nacional não registrado ou internacional)."
        : "Não encontramos dados públicos para este registro.";
    default:
      return rawError ?? "—";
  }
}
