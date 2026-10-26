/**
 * seed-qa-mesa-sintetico.ts — LOTE SINTÉTICO ISOLADO para validação visual da
 * Mesa de Investigação (v0.11.0). NENHUMA consulta externa: os dados são
 * inventados e gravados direto no banco local. O nome do arquivo marca a
 * origem sintética; pode ser arquivado pelo operador quando quiser.
 *
 * Execução: bun scripts/seed-qa-mesa-sintetico.ts
 * Re-execução: remove o lote anterior com o mesmo fileName antes de criar.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** DV do CNPJ (cálculo padrão dos 2 dígitos verificadores). */
function cnpjComDv(base12: string): string {
  const calc = (digits: string[]): number => {
    // 12 dígitos → pesos começam em 5; 13 dígitos (com o 1º DV) → começam em 6
    const pesos = digits.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < digits.length; i++) soma += Number(digits[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12.split(""));
  const d2 = calc([...base12.split(""), String(d1)]);
  return `${base12}${d1}${d2}`;
}

const RAIZ = "99000100"; // raiz sintética (não alocada pela Receita)
const CNPJ_MATRIZ = cnpjComDv(`${RAIZ}0001`);
const CNPJ_FILIAL = cnpjComDv(`${RAIZ}0002`);
const CNPJ_AGRO = cnpjComDv("990002000001");
const CNPJ_REVIEW_A = cnpjComDv("990003000001");
const CNPJ_REVIEW_B = cnpjComDv("990003000002");
const CNPJ_PENDENTE = cnpjComDv("990004000001");
const CNPJ_NAO_ENC = cnpjComDv("990005000001");

const FILE_NAME = "QA-mesa-sintetico-v0110.csv";

async function main() {
  // isolamento: remove execução anterior do MESMO lote sintético
  await db.importBatch.deleteMany({ where: { fileName: FILE_NAME } });

  const now = new Date();
  const ontem = new Date(now.getTime() - 24 * 3600 * 1000);
  const batch = await db.importBatch.create({
    data: {
      fileName: FILE_NAME,
      storedPath: "(sintético em memória — validação visual)",
      fileSize: 412,
      sourceType: "CSV",
      delimiter: ";",
      hasHeader: true,
      headerJson: JSON.stringify(["entrada", "observacao"]),
      cnpjColumnIndex: 0,
      cnpjColumnDetect: "sintético",
      rowCount: 8,
      status: "DONE",
      totalValid: 6,
      totalInvalid: 1,
      totalDuplicate: 1,
      totalReference: 0,
      totalResolved: 0,
      totalEnriched: 4,
      totalPending: 1,
      aiEnabled: true,
      aiTotal: 4,
      aiDone: 2,
      aiFailed: 0,
      totalConfirmed: 3,
      totalReview: 1,
      totalUnresolved: 1,
      totalLocalizado: 1,
      totalValidado: 0,
      confirmedAt: ontem,
      processingAt: ontem,
      finishedAt: now,
      createdAt: ontem,
    },
  });

  const rows: Prisma.ImportRowUncheckedCreateInput[] = [
    {
      batchId: batch.id,
      rowNumber: 1,
      originalCellsJson: JSON.stringify([CNPJ_MATRIZ, "matriz metalúrgica"]),
      lookupKind: "CNPJ",
      rawCnpj: CNPJ_MATRIZ,
      normalizedCnpj: CNPJ_MATRIZ,
      cnpjStatus: "VALIDA",
      lookupStatus: "ENRIQUECIDO",
      resolutionState: null,
      identityStage: "CORRESPONDENTE",
      cnpjRoot: RAIZ,
      headquartersCnpj: CNPJ_MATRIZ,
      foundIsHeadquarters: true,
      matrizStatus: "RESOLVIDA",
      branchIdentifier: 1,
      legalName: "Metalúrgica Horizonte Vale Ltda",
      tradeName: "Horizonte Vale",
      registrationStatus: "ATIVA",
      statusDate: "2025-11-08",
      branchType: "MATRIZ",
      openingDate: "2009-03-17",
      cnaeCode: "2813-4/00",
      cnaeDescription: "Fabricação de compressores",
      municipality: "Joinville",
      uf: "SC",
      source: "MinhaReceita",
      queriedAt: ontem,
      collectedAt: ontem,
      aiStatus: "OK",
      aiReading:
        "A Horizonte Vale é uma metalúrgica de médio porte de Joinville (SC), com 16 anos de mercado, fabricante de compressores de ar industriais para o setor de papel e celulose. Opera venda direta e via integradores regionais, com frota própria de assistência técnica.",
      aiSector: "Indústria de máquinas e equipamentos",
      aiSize: "Médio porte (aparente pela estrutura e frota)",
      aiProfile: "empresa consolidada, ciclo de venda consultiva, decisão técnica e financeira separadas",
      aiHypothesesJson: JSON.stringify([
        "Manutenção corretiva de compressores consome horas técnicas não faturadas — possível dor de gestão de ordens de serviço (WMS/ERP).",
        "Peças de reposição com estoque descentralizado entre técnicos de campo.",
      ]),
      aiQuestionsJson: JSON.stringify([
        "Como as ordens de serviço são registradas hoje?",
        "Quantos técnicos de campo existem e como são roteirizados?",
      ]),
      sociosJson: JSON.stringify([
        { nome: "Cláudio Menezes Verdi", qual: "49-Sócio-Administrador", entrada: "2009-03-17" },
        { nome: "Helena Verdi Pastore", qual: "49-Sócio-Administrador", entrada: "2014-08-02" },
      ]),
      extraJson: JSON.stringify({
        capitalSocial: 4800000,
        naturezaJuridica: "Sociedade Empresária Limitada",
        porte: "DEMAIS",
        simples: "Não optante",
        mei: false,
        email: "contato@horizontevale.com.br",
        telefone: "(47) 3344-8820",
        telefone2: "(47) 99876-1122",
        endereco: "Rua Dona Francisca, 8300 — Distrito Industrial, Joinville/SC",
        regimeTributario: "LUCRO_REAL (exercício 2024)",
        cnaesSecundarios: ["3314-7/10 — Manutenção de máquinas industriais", "4664-8/00 — Comércio atacadista de máquinas"],
        ibge: { populacao: 603066, anoPopulacao: 2022, regiaoImediata: "Joinville" },
      }),
      fontesJson: JSON.stringify({
        primaria: { fonte: "MinhaReceita", coletadoEm: ontem.toISOString() },
        complementacoes: [
          { fonte: "IBGE — população do município", campos: ["ibge.populacao", "ibge.regiaoImediata"], coletadoEm: ontem.toISOString() },
        ],
        cache: { consultaOriginal: ontem.toISOString(), validoAte: new Date(now.getTime() + 15 * 86400000).toISOString(), reaproveitadoEm: ontem.toISOString() },
      }),
    },
    {
      batchId: batch.id,
      rowNumber: 2,
      originalCellsJson: JSON.stringify([CNPJ_AGRO, "agro com dossiê profundo"]),
      lookupKind: "CNPJ",
      rawCnpj: CNPJ_AGRO,
      normalizedCnpj: CNPJ_AGRO,
      cnpjStatus: "VALIDA",
      lookupStatus: "ENRIQUECIDO",
      resolutionState: null,
      identityStage: "CORRESPONDENTE",
      cnpjRoot: "99000200",
      headquartersCnpj: CNPJ_AGRO,
      foundIsHeadquarters: true,
      matrizStatus: "RESOLVIDA",
      branchIdentifier: 1,
      legalName: "AgroSul Insumos Agrícolas S.A.",
      tradeName: "AgroSul",
      registrationStatus: "ATIVA",
      openingDate: "1998-06-22",
      cnaeCode: "4687-8/01",
      cnaeDescription: "Comércio atacadista de insumos agropecuários",
      municipality: "Sorriso",
      uf: "MT",
      source: "MinhaReceita",
      queriedAt: ontem,
      collectedAt: ontem,
      aiStatus: "OK",
      aiReading:
        "A AgroSul é uma distribuidora de insumos agrícolas com 9 filiais no Centro-Oeste, armazéns próprios e frota terceirizada. Foi recentemente adquirida pelo Grupo Terra Nova, o que abriu uma fase de padronização de sistemas entre as unidades.",
      aiSector: "Distribuição agrícola",
      aiSize: "Grande porte (9 unidades, frota e armazéns)",
      aiProfile: "grupo em integração pós-aquisição — janela de troca de sistemas",
      aiDossierJson: JSON.stringify({
        sintese: "Distribuidora de insumos com 9 filiais, adquirida pelo Grupo Terra Nova; fase de padronização de sistemas.",
        perfil: "atacado agrícola mult filial com decisão centralizada pós-aquisição",
        teia: ["Grupo Terra Nova (controladora desde 2025)", "AgroSul Logística Ltda (coligada de frota)"],
        operacao: ["Distribuição de defensivos e sementes em 9 filiais", "Armazenagem própria com 14 armazéns", "Frota terceirizada com rastreamento"],
        tecnologia: [
          "ERP: legado próprio com módulos não integrados (estado: parcial)",
          "Controle de armazém manual em 5 filiais (estado: ausente)",
        ],
        aderencia: [
          { produto: "ERP", processo: "padronização pós-aquisição entre 9 filiais", hipotese: "Migração consolidada pode considerar ERP Senior na retomada do sistema." },
          { produto: "WMS", processo: "controle de armazém manual em 5 filiais", hipotese: "Se a operação de armazéns for digitalizada, o WMS Senior cobre o fluxo de recebimento e expedição." },
        ],
        tese: "Janela pós-aquisição com decisão de TI centralizada e lacunas de WMS em metade das filiais.",
        profunda: true,
        entidadeEscopo: "PJ AgroSul Insumos Agrícolas S.A. — a controladora Grupo Terra Nova ficou fora do escopo desta consulta.",
        quemE: "A AgroSul Insumos Agrícolas S.A. é uma sociedade por ações de capital fechado, controlada pelo Grupo Terra Nova desde a aquisição registrada em 2025, atuando na distribuição de insumos agrícolas no Centro-Oeste.",
        oQueFaz: ["Compra e distribuição de defensivos, sementes e fertilizantes", "Armazenagem e logística de apoio para cooperativas parceiras"],
        escalaEstrutura: ["9 filiais ativas no MT/MS/GO (registro oficial)", "14 armazéns próprios (site institucional)", "Frota terceirizada com 60+ veículos rastreados (notícia)"],
        pessoas: ["Dirceu Sampaio Alves — Diretor-Presidente (fontes públicas)", "Marisa Tozzo — Diretora de Operações (fontes públicas)"],
        mudancasSinais: ["Aquisição pelo Grupo Terra Nova anunciada em fevereiro de 2025 (imprensa)", "Abertura de 2 filiais novas em 2024 (registro)"],
        naoSabemos: [
          "Qual o sistema de gestão usado hoje nas filiais — a leitura não confirmou o ERP vigente.",
          "Se o controle de armazém das 5 filiais sem WMS é planilha ou sistema próprio.",
          "Qual o prazo e o orçamento do programa de padronização de sistemas da controladora.",
        ],
        hipotesesDetalhadas: [
          { fato: "Aquisição recente pelo Grupo Terra Nova com programa de padronização anunciado", consequencia: "Decisões de sistema podem estar em avaliação agora, com janela curta de influência", validar: "Perguntar à diretoria de operações se há avaliação de ERP/WMS em curso" },
          { fato: "Controle de armazém manual em 5 das 9 filiais (site e vagas de emprego)", consequencia: "Perdas de inventário e expedição lenta podem existir nas unidades sem sistema", validar: "Solicitar indicadores de acurácia de inventário por filial" },
        ],
        evidencias: [
          { claim: "9 filiais ativas no Centro-Oeste", status: "CONFIRMADO", source: "Registro de estabelecimentos (fonte oficial)", url: null, relevancia: "alta", entidade: "AgroSul", periodo: "2025" },
          { claim: "Controle de armazém manual em 5 filiais", status: "INDICIO", source: "Página de carreira + vagas (site oficial)", url: null, relevancia: "media", entidade: "AgroSul", periodo: "2025" },
          { claim: "Frota terceirizada com 60+ veículos", status: "INDICIO", source: "Notícia regional", url: null, relevancia: "media", entidade: "AgroSul", periodo: "2024" },
          { claim: "ERP corporativo definido pela controladora", status: "NAO_ENCONTRADO", source: "Buscas públicas", url: null, relevancia: "alta", entidade: "AgroSul", periodo: "2025" },
        ],
      }),
      researchJson: JSON.stringify({
        dominio: "agrosul.com.br",
        paginas: [
          { url: "https://agrosul.com.br/sobre", titulo: "Quem somos", tipo: "Sobre" },
          { url: "https://agrosul.com.br/unidades", titulo: "Nossas unidades", tipo: "Unidades" },
          { url: "https://agrosul.com.br/contato", titulo: "Contato", tipo: "Contato" },
        ],
        paginasOk: 3,
        paginasTentadas: 3,
        buscas: [
          { query: "AgroSul Grupo Terra Nova aquisição", objetivo: "confirmar controladora", resultados: 4 },
          { query: "AgroSul armazéns unidades MT", objetivo: "medir escala", resultados: 3 },
        ],
        buscasOk: 2,
        notas: ["Síntese a partir do site institucional e de 2 buscas públicas — hipóteses a validar."],
        sinaisDigitais: ["Domínio próprio com TLS válido", "Página de carreiras ativa com vagas de armazém"],
        noticias: [
          { titulo: "Grupo Terra Nova conclui aquisição da AgroSul", fonte: "Valor Agro (sintético)", data: "2025-02-10", link: null },
          { titulo: "AgroSul abre duas unidades no Matopiba", fonte: "Jornal Rural (sintético)", data: "2024-11-03", link: null },
        ],
        sinaisPorte: ["14 armazéns próprios citados na página institucional", "Vagas de emprego indicam operação de armazém em 5 filiais"],
        sinaisPorteFontes: [{ fonte: "Site oficial" }, { fonte: "Site oficial — carreira" }],
      }),
      sociosJson: JSON.stringify([{ nome: "Grupo Terra Nova Participações S.A.", qual: "10-Sócio controlador", entrada: "2025-02-10" }]),
      extraJson: JSON.stringify({
        capitalSocial: 18500000,
        naturezaJuridica: "Sociedade Anônima Fechada",
        porte: "DEMAIS",
        simples: "Não optante",
        email: "institucional@agrosul.com.br",
        telefone: "(65) 3544-7100",
        endereco: "Av. dos Tarumãs, 1200 — Sorriso/MT",
        regimeTributario: "LUCRO_PRESUMIDO (exercício 2024)",
        cnaesSecundarios: ["5211-7/00 — Armazenagem de grãos"],
        ibge: { populacao: 95000, anoPopulacao: 2022, regiaoImediata: "Sorriso" },
      }),
      fontesJson: JSON.stringify({
        primaria: { fonte: "MinhaReceita", coletadoEm: ontem.toISOString() },
        complementacoes: [],
        cache: null,
      }),
    },
    {
      batchId: batch.id,
      rowNumber: 3,
      originalCellsJson: JSON.stringify(["Transportadora Vale do Norte", "pista por nome — 2 candidatos"]),
      lookupKind: "CNPJ",
      rawCnpj: "Vale do Norte",
      normalizedCnpj: "",
      cnpjStatus: "REFERENCIA",
      referenceValue: "Transportadora Vale do Norte",
      lookupStatus: "ENRIQUECIDO",
      resolutionState: "REVIEW",
      resolutionConfidence: "MEDIA",
      identityStage: "LOCALIZADO",
      legalName: "Vale Norte Transportes Rodoviários Ltda",
      tradeName: "Vale do Norte",
      registrationStatus: "ATIVA",
      openingDate: "2012-09-30",
      cnaeDescription: "Transporte rodoviário de carga",
      municipality: "Chapecó",
      uf: "SC",
      source: "Busca na web",
      queriedAt: ontem,
      collectedAt: ontem,
      aiStatus: "IGNORADO",
      resolutionJson: JSON.stringify({
        metodo: ["busca por nome", "cross-check do registro"],
        notas: ["Mais de uma empresa corresponde à pista informada — confirme qual é a certa."],
        candidatos: [
          {
            cnpj: CNPJ_REVIEW_A,
            strength: "FORTE",
            sinais: ["Nome fantasia idêntico à pista", "Município compatível com o cliente citado na observação"],
            contradicoes: [],
            fontes: [{ fonte: "Busca na web", url: null, detalhe: "registro público" }],
            dadosJuridicos: ["Razão social: Vale Norte Transportes Rodoviários Ltda", "Abertura: 2012-09-30", "Situação: ATIVA"],
            confirmado: { razaoSocial: "Vale Norte Transportes Rodoviários Ltda", uf: "SC", municipio: "Chapecó", identificador: 1, fonte: "fonte oficial (sintético)" },
          },
          {
            cnpj: CNPJ_REVIEW_B,
            strength: "MEDIA",
            sinais: ["Razão social semelhante", "Atividade de transporte"],
            contradicoes: ["UF divergente da pista (PR × SC)"],
            fontes: [{ fonte: "Busca na web", url: null }],
            dadosJuridicos: ["Razão social: Vale Norte Logistica e Transporte Ltda", "Situação: ATIVA"],
            confirmado: { razaoSocial: "Vale Norte Logistica e Transporte Ltda", uf: "PR", municipio: "Cascavel", identificador: 1, fonte: "fonte oficial (sintético)" },
          },
        ],
      }),
      sociosJson: JSON.stringify([]),
      extraJson: JSON.stringify({
        capitalSocial: 920000,
        porte: "SIMPLES_NACIONAL",
        simples: "Optante do Simples Nacional",
        telefone: "(49) 3322-4455",
        endereco: "Av. Getúlio Vargas, 2244 — Chapecó/SC",
        ibge: { populacao: 225000, anoPopulacao: 2022, regiaoImediata: "Chapecó" },
      }),
      fontesJson: JSON.stringify({ primaria: { fonte: "Busca na web", coletadoEm: ontem.toISOString() }, complementacoes: [], cache: null }),
    },
    {
      batchId: batch.id,
      rowNumber: 4,
      originalCellsJson: JSON.stringify([CNPJ_NAO_ENC, "não localizada"]),
      lookupKind: "CNPJ",
      rawCnpj: CNPJ_NAO_ENC,
      normalizedCnpj: CNPJ_NAO_ENC,
      cnpjStatus: "VALIDA",
      lookupStatus: "NAO_ENCONTRADO",
      resolutionState: "UNRESOLVED",
      identityStage: "LOCALIZADO",
      source: "MinhaReceita",
      queriedAt: ontem,
      lookupError: "Registro não localizado nas fontes públicas nesta tentativa.",
      resolutionJson: JSON.stringify({
        metodo: ["consulta direta"],
        notas: ["A pista ficou como não identificada. Os candidatos arquivados podem ser reabertos."],
        candidatos: [],
        descartados: [],
      }),
      sociosJson: JSON.stringify([]),
    },
    {
      batchId: batch.id,
      rowNumber: 5,
      originalCellsJson: JSON.stringify([CNPJ_PENDENTE, "aguardando consulta"]),
      lookupKind: "CNPJ",
      rawCnpj: CNPJ_PENDENTE,
      normalizedCnpj: "",
      cnpjStatus: "VALIDA",
      lookupStatus: "PENDENTE",
      source: null,
    },
    {
      batchId: batch.id,
      rowNumber: 6,
      originalCellsJson: JSON.stringify([CNPJ_MATRIZ, "repetida da linha 1"]),
      lookupKind: "CNPJ",
      rawCnpj: CNPJ_MATRIZ,
      normalizedCnpj: CNPJ_MATRIZ,
      cnpjStatus: "DUPLICADA",
      duplicateOf: 1,
      lookupStatus: "IGNORADO",
    },
    {
      batchId: batch.id,
      rowNumber: 7,
      originalCellsJson: JSON.stringify(["12345678901234", "CNPJ com DV inválido"]),
      lookupKind: "CNPJ",
      rawCnpj: "12345678901234",
      normalizedCnpj: "",
      cnpjStatus: "INVALIDA",
      invalidReason: "Dígitos verificadores não conferem",
      lookupStatus: "IGNORADO",
    },
    {
      batchId: batch.id,
      rowNumber: 8,
      originalCellsJson: JSON.stringify([CNPJ_FILIAL, "filial da matriz da linha 1"]),
      lookupKind: "CNPJ",
      rawCnpj: CNPJ_FILIAL,
      normalizedCnpj: CNPJ_FILIAL,
      cnpjStatus: "VALIDA",
      lookupStatus: "ENRIQUECIDO",
      identityStage: "CORRESPONDENTE",
      cnpjRoot: RAIZ,
      headquartersCnpj: CNPJ_MATRIZ,
      foundIsHeadquarters: false,
      matrizStatus: "RESOLVIDA",
      branchIdentifier: 2,
      legalName: "Metalúrgica Horizonte Vale Ltda (Filial Paraná)",
      registrationStatus: "ATIVA",
      openingDate: "2016-05-04",
      cnaeCode: "2813-4/00",
      cnaeDescription: "Fabricação de compressores",
      municipality: "Curitiba",
      uf: "PR",
      source: "MinhaReceita",
      queriedAt: ontem,
      collectedAt: ontem,
      aiStatus: "IGNORADO",
      sociosJson: JSON.stringify([]),
      extraJson: JSON.stringify({ telefone: "(41) 3255-6677", endereco: "Rua Eduardo Sprada, 4450 — Curitiba/PR" }),
      fontesJson: JSON.stringify({ primaria: { fonte: "MinhaReceita", coletadoEm: ontem.toISOString() }, complementacoes: [], cache: null }),
    },
  ];

  await db.importRow.createMany({ data: rows });
  console.log(`[seed] lote sintético criado: ${batch.id} (${rows.length} linhas) — ${FILE_NAME}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
