/**
 * seed-qa-homolog.ts — LOTES SINTÉTICOS DE CARGA para a homologação v0.11.0 (Gate 2).
 *
 * Gera lotes reutilizáveis pelos testes de navegador da homologação:
 *   - QA-homolog-100.csv   → lote "mesa completa": todas as situações de identidade
 *                            não vazias, pares matriz/filial, nomes longos, acentos,
 *                            fichas ricas (identity, extra, sócios, IA, pesquisa, dossiê).
 *   - QA-homolog-1000.csv  → lote de carga: ~90% pendente + ~10% enriquecido.
 *   - QA-homolog-5000.csv  → idem, 5.000 linhas (paginação/busca/filtro/ordenação/export).
 *
 * ZERO consulta externa: dados 100% inventados, gravados direto no banco local
 * (mesma abordagem PROVADA do scripts/seed-qa-mesa-sintetico.ts — o dev server
 * Next:3000 roda enquanto o seed grava no db/custom.db).
 *
 * Execução:
 *   bun scripts/seed-qa-homolog.ts 100 | 1000 | 5000 | all
 *
 * Idempotente: antes de criar, remove o lote anterior COM O MESMO fileName (a
 * execução "all" regenera os três de uma vez; rodar só "100" NÃO apaga os lotes
 * 1000/5000 — senão a rodada sequencial destruiria os lotes já semeados).
 * O schema tem onDelete: Cascade em ImportRow/AuditEvent (prisma/schema.prisma),
 * então apagar o lote apaga as linhas junto.
 * O lote QA-mesa-sintetico-v0110.csv (8 linhas, Gate 1) é PRESERVADO.
 *
 * Determinístico: PRNG com semente fixa → re-execuções produzem os mesmos dados.
 */
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

const db = new PrismaClient();

/* ============================ CNPJ (DV válido) ============================ */
/** DV do CNPJ — cópia EXATA do cálculo do seed-qa-mesa-sintetico.ts (provado). */
function cnpjComDv(base12: string): string {
  const calc = (digits: string[]): number => {
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

/** Formata 99.999.999/9999-99 (usado nas células originais de linhas por nome). */
function formatCnpj(c: string): string {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/* ============================ PRNG determinístico ============================ */
/** mulberry32 — semente fixa por lote: re-executar reproduz os mesmos dados. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================ pools de dados (ficção) ============================ */

interface Mun { m: string; uf: string; pop: number; reg: string }
const MUNICIPIOS: Mun[] = [
  { m: "Joinville", uf: "SC", pop: 603066, reg: "Joinville" },
  { m: "Sorriso", uf: "MT", pop: 95000, reg: "Sorriso" },
  { m: "Chapecó", uf: "SC", pop: 224000, reg: "Chapecó" },
  { m: "Curitiba", uf: "PR", pop: 1963000, reg: "Curitiba" },
  { m: "Campinas", uf: "SP", pop: 1139000, reg: "Campinas" },
  { m: "Contagem", uf: "MG", pop: 660000, reg: "Belo Horizonte" },
  { m: "Feira de Santana", uf: "BA", pop: 620000, reg: "Feira de Santana" },
  { m: "Cuiabá", uf: "MT", pop: 650000, reg: "Cuiabá" },
  { m: "Blumenau", uf: "SC", pop: 361000, reg: "Blumenau" },
  { m: "Novo Hamburgo", uf: "RS", pop: 247000, reg: "Novo Hamburgo" },
  { m: "Betim", uf: "MG", pop: 440000, reg: "Belo Horizonte" },
  { m: "Jundiaí", uf: "SP", pop: 425000, reg: "Jundiaí" },
  { m: "Ribeirão Preto", uf: "SP", pop: 720000, reg: "Ribeirão Preto" },
  { m: "Londrina", uf: "PR", pop: 575000, reg: "Londrina" },
  { m: "Camaçari", uf: "BA", pop: 300000, reg: "Salvador" },
  { m: "Gravataí", uf: "RS", pop: 235000, reg: "Porto Alegre" },
  { m: "Sertãozinho", uf: "SP", pop: 128000, reg: "Sertãozinho" },
  { m: "Tangará da Serra", uf: "MT", pop: 105000, reg: "Tangará da Serra" },
  { m: "São José dos Pinhais", uf: "PR", pop: 330000, reg: "Curitiba" },
  { m: "Caxias do Sul", uf: "RS", pop: 517000, reg: "Caxias do Sul" },
  { m: "Uberlândia", uf: "MG", pop: 713000, reg: "Uberlândia" },
  { m: "Caruaru", uf: "PE", pop: 365000, reg: "Caruaru" },
  { m: "Rio Verde", uf: "GO", pop: 245000, reg: "Rio Verde" },
  { m: "Araçatuba", uf: "SP", pop: 198000, reg: "Araçatuba" },
  { m: "Parintins", uf: "AM", pop: 115000, reg: "Parintins" },
  { m: "Petrolina", uf: "PE", pop: 355000, reg: "Petrolina" },
];

interface Cnae { c: string; d: string }
const CNAES: Cnae[] = [
  { c: "2813-4/00", d: "Fabricação de compressores" },
  { c: "4687-8/01", d: "Comércio atacadista de insumos agropecuários" },
  { c: "4930-3/02", d: "Transporte rodoviário de carga, exceto produtos perigosos" },
  { c: "5211-7/00", d: "Armazenagem e depósitos de cargas" },
  { c: "6201-5/01", d: "Desenvolvimento de programas de computador sob encomenda" },
  { c: "6209-1/00", d: "Suporte técnico, manutenção e outros serviços em TI" },
  { c: "3314-7/10", d: "Manutenção e reparação de máquinas e equipamentos industriais" },
  { c: "2512-8/00", d: "Fabricação de estruturas metálicas" },
  { c: "2222-6/00", d: "Fabricação de tintas, vernizes, esmaltes e lacres" },
  { c: "1091-1/02", d: "Fabricação de produtos de padaria e confeitaria" },
  { c: "7112-0/00", d: "Serviços de engenharia" },
  { c: "4751-2/00", d: "Comércio varejista especializado de informática e comunicação" },
  { c: "0151-2/01", d: "Criação de bovinos para corte" },
  { c: "3104-7/00", d: "Fabricação de móveis de madeira" },
  { c: "4321-5/00", d: "Instalação elétrica" },
];

const SETORES = [
  "Indústria de máquinas e equipamentos",
  "Distribuição agrícola",
  "Logística e transporte rodoviário",
  "Tecnologia e software B2B",
  "Construção e estruturas metálicas",
  "Tintas e químicos",
  "Alimentos e panificação",
  "Serviços de engenharia",
  "Varejo de tecnologia",
  "Agropecuária",
  "Móveis e madeira",
  "Serviços de instalação e manutenção",
];

const PREFIXOS = ["Indústria", "Comércio", "Serviços", "Logística", "Tecnologia", "Soluções", "Distribuidora", "Transportes", "Metalúrgica", "Agro", "Construtora"];
const TOKEN_A = ["Horizonte", "Serra", "Pioneira", "Atlântica", "Colina", "Vale", "Rio", "Porto", "Campos", "Lagoa", "Duna", "Mata", "Pedra", "Águas"];
const TOKEN_B = ["Vale", "Azul", "do Oeste", "Norte", "Verde", "Branca", "Bonito", "Dourado", "das Missões", "do Sul", "Real", "Sereno", "Cristalino", "Paulista"];
const SUFIXOS = ["Ltda", "Ltda", "Ltda", "S.A.", "S.A.", "EIRELI", "ME", "EPP"];

/** Nomes fixos com diacríticos pesados (Ç, Ã, É, Õ) — exercitam truncamento/acentos na UI. */
const NOMES_ACENTUADOS = [
  "Panificadora Pão de Maçã Ltda", // Ã, Õ, Ç
  "Soluções e Gestão em Tecnologia da Informação Ltda", // Ç, Ã, Õ, É
  "Construção e Pavimentação Triângulo Ltda", // Ç, Ã, Â
  "Ébano & Ópera Comércio de Café Ltda", // É, Ó
  "Distribuidora São Cristóvão de Açúcar e Álcool S.A.", // Ã, É, Ç
  "Transportes Jussara Coração do Pantanal EIRELI", // Ã, Ç, Õ
];

/** Dois nomes de razão social >150 caracteres — truncamento de coluna e tooltip completo. */
const NOME_LONGO_1 =
  "Indústria e Comércio de Peças, Componentes e Conjuntos Metálicos Forjados, Fundidos e Usinados para os Setores Agroindustrial, Automotivo e Ferroviário do Vale do Rio Jacuí e da Região Centro-Norte do Estado do Rio Grande do Sul Ltda";
const NOME_LONGO_2 =
  "Comércio Atacadista, Importação, Exportação e Distribuição de Insumos, Defensivos Agrícolas, Sementes, Fertilizantes, Adubos e Produtos Veterinários para Cooperativas, Armazéns de Grãos e Produtores Rurais do Matopiba e do Centro-Oeste Brasileiro S.A.";

const NOME_BASE = ["Cláudio", "Helena", "Marlene", "Orlando", "Beatriz", "Sérgio", "Rosângela", "Ademir", "Lucinéia", "Mauro", "Cristiane", "Elias", "Tereza", "Vilmar", "Juraci", "Weslley"];
const NOME_SOBRENOME = ["Menezes Verdi", "Pastore", "Almeida Prado", "Nogueira", "Bittencourt", "Camargo Rocha", "Fontoura", "Xavier", "Scheffer", "Tavares Lima", "Moraes", "Kunz", "Barreto", "Andrade"];
const QUALS = ["49-Sócio-Administrador", "22-Sócio", "05-Sócio", "10-Sócio controlador"];

const OBS = ["prospect regional", "indicação de feira", "contato comercial", "cliente potencial", "revisar dados", "pista por nome", "fornecedora atual", "concorrente direto", "lead de evento", "base antiga"];

/* ============================ helpers ============================ */

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

interface Empresa {
  razao: string;
  fantasia: string;
  mun: Mun;
  cnae: Cnae;
  setor: string;
  dominio: string;
  capital: number;
  abertura: string;
  natureza: string;
  porte: string;
  simples: string;
  mei: boolean;
  regime: string;
}

/** Sorteia uma empresa ficcional coerente (nome fantasia/município/CNAE/setor/datas). */
function sorteiaEmpresa(rand: () => number, sobrescreve?: Partial<Empresa>): Empresa {
  const mun = MUNICIPIOS[Math.floor(rand() * MUNICIPIOS.length)];
  const cnae = CNAES[Math.floor(rand() * CNAES.length)];
  const setor = SETORES[Math.floor(rand() * SETORES.length)];
  const ta = TOKEN_A[Math.floor(rand() * TOKEN_A.length)];
  const tb = TOKEN_B[Math.floor(rand() * TOKEN_B.length)];
  const prefixo = PREFIXOS[Math.floor(rand() * PREFIXOS.length)];
  const sufixo = SUFIXOS[Math.floor(rand() * SUFIXOS.length)];
  const fantasiaBase = `${ta} ${tb}`;
  const razao = `${prefixo} ${fantasiaBase} ${sufixo}`;
  const fantasia = fantasiaBase;
  const ano = 1975 + Math.floor(rand() * 49);
  const mes = 1 + Math.floor(rand() * 12);
  const dia = 1 + Math.floor(rand() * 28);
  const simples = rand() < 0.55 ? "Optante do Simples Nacional" : "Não optante";
  const fantasiaFinal = sobrescreve?.fantasia ?? fantasia; // domínio sempre coerente com a fantasia final
  return {
    razao,
    fantasia,
    mun,
    cnae,
    setor,
    dominio: `${slug(fantasiaFinal)}.com.br`,
    capital: [50000, 120000, 250000, 480000, 920000, 1500000, 4800000, 12500000, 18500000][Math.floor(rand() * 9)],
    abertura: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
    natureza: sufixo === "S.A." ? "Sociedade Anônima Fechada" : sufixo === "EIRELI" ? "Empresa Individual de Responsabilidade Limitada" : "Sociedade Empresária Limitada",
    porte: simples === "Optante do Simples Nacional" ? (rand() < 0.5 ? "ME" : "EPP") : rand() < 0.6 ? "SIMPLES_NACIONAL" : "DEMAIS",
    simples,
    mei: false,
    regime: simples === "Optante do Simples Nacional" ? "SIMPLES_NACIONAL (exercício 2024)" : rand() < 0.5 ? "LUCRO_PRESUMIDO (exercício 2024)" : "LUCRO_REAL (exercício 2024)",
    ...sobrescreve,
  };
}

function telefone(rand: () => number, uf: string): string {
  const ddds: Record<string, string> = { SC: "47", MT: "65", PR: "41", SP: "11", MG: "31", BA: "71", RS: "51", PE: "81", GO: "62", AM: "92" };
  const ddd = ddds[uf] ?? "47";
  return `(${ddd}) 3${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}-${Math.floor(1000 + rand() * 8999)}`;
}

function celular(rand: () => number, uf: string): string {
  const ddds: Record<string, string> = { SC: "47", MT: "65", PR: "41", SP: "11", MG: "31", BA: "71", RS: "51", PE: "81", GO: "62", AM: "92" };
  const ddd = ddds[uf] ?? "47";
  return `(${ddd}) 9${Math.floor(1000 + rand() * 8999)}-${Math.floor(1000 + rand() * 8999)}`;
}

function dataIso(d: Date): string {
  return d.toISOString();
}

function sociosDe(rand: () => number, n: number): { nome: string; qual: string; entrada: string }[] {
  const out: { nome: string; qual: string; entrada: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      nome: `${NOME_BASE[Math.floor(rand() * NOME_BASE.length)]} ${NOME_SOBRENOME[Math.floor(rand() * NOME_SOBRENOME.length)]}`,
      qual: QUALS[Math.floor(rand() * QUALS.length)],
      entrada: `${1985 + Math.floor(rand() * 40)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
    });
  }
  return out;
}

/** extraJson — campo por campo no formato que a ficha/contato leem (provado no seed de 8 linhas). */
function extraDe(rand: () => number, emp: Empresa): Record<string, unknown> {
  return {
    capitalSocial: emp.capital,
    naturezaJuridica: emp.natureza,
    porte: emp.porte,
    simples: emp.simples,
    mei: emp.mei,
    email: `contato@${emp.dominio}`,
    telefone: telefone(rand, emp.mun.uf),
    telefone2: celular(rand, emp.mun.uf),
    endereco: `Rua das Indústrias, ${Math.floor(100 + rand() * 4900)} — ${emp.mun.m}/${emp.mun.uf}`,
    regimeTributario: emp.regime,
    cnaesSecundarios: [`${CNAES[Math.floor(rand() * CNAES.length)].c} — ${CNAES[Math.floor(rand() * CNAES.length)].d}`],
    ibge: { populacao: emp.mun.pop, anoPopulacao: 2022, regiaoImediata: emp.mun.reg },
  };
}

function fontesDe(coletadoEm: Date, comCache: boolean): Record<string, unknown> {
  return {
    primaria: { fonte: "MinhaReceita", coletadoEm: dataIso(coletadoEm) },
    complementacoes: [
      { fonte: "IBGE — população do município", campos: ["ibge.populacao", "ibge.regiaoImediata"], coletadoEm: dataIso(coletadoEm) },
    ],
    cache: comCache
      ? {
          consultaOriginal: dataIso(new Date(coletadoEm.getTime() - 15 * 86400000)),
          validoAte: dataIso(new Date(coletadoEm.getTime() + 15 * 86400000)),
          reaproveitadoEm: dataIso(coletadoEm),
        }
      : null,
  };
}

/** Leitura IA (ficha "visão geral" + segmentos) — campos provados no seed de 8 linhas.
 *  Idade derivada da própria data de abertura (coerência ficha × leitura). */
function leituraIaDe(rand: () => number, emp: Empresa): Record<string, unknown> {
  const ageAnos = Math.max(1, new Date().getFullYear() - Number(emp.abertura.slice(0, 4)));
  const perfis = [
    "empresa consolidada, ciclo de venda consultiva, decisão técnica e financeira separadas",
    "operação local com crescimento regional, decisão centralizada no proprietário",
    "grupo em expansão, processos em padronização, janela de troca de sistemas",
    "fornecedor especializado, ticket alto, compra por especificação técnica",
  ];
  return {
    aiStatus: "OK",
    aiReading: `${emp.fantasia} é uma ${emp.setor.toLowerCase()} de ${emp.mun.m} (${emp.mun.uf}), com ${ageAnos} anos de atuação no mercado. Atende clientes corporativos e regionais com operação própria de ${emp.cnae.d.toLowerCase()}.`,
    aiSector: emp.setor,
    aiSize: ageAnos > 25 ? "Grande porte (estrutura multiunidade aparente)" : ageAnos > 12 ? "Médio porte (estrutura e frota próprias)" : "Pequeno porte (operação enxuta)",
    aiProfile: perfis[Math.floor(rand() * perfis.length)],
    aiHypothesesJson: JSON.stringify([
      "Gestão de ordens de serviço e estoque descentralizado consomem horas técnicas não faturadas.",
      "Ciclo comercial dependente de planilhas — possível dor de integração com o ERP atual.",
    ]),
    aiQuestionsJson: JSON.stringify([
      "Como os processos críticos são registrados hoje?",
      "Quantas unidades atendem a operação e como se comunicam?",
    ]),
  };
}

/** Pacote de pesquisa (researchJson) no formato que parseResearchView lê (siteOficial/buscas/noticias). */
function researchDe(emp: Empresa, geradoEm: Date): Record<string, unknown> {
  const tituloNoticia1 = `${emp.fantasia} conclui ampliação da unidade em ${emp.mun.m}`;
  const tituloNoticia2 = `${emp.fantasia} amplia frota própria para atender o interior`;
  return {
    siteOficial: {
      dominio: emp.dominio,
      paginas: [
        { url: `https://${emp.dominio}/sobre`, titulo: "Quem somos", tipo: "Sobre" },
        { url: `https://${emp.dominio}/unidades`, titulo: "Nossas unidades", tipo: "Unidades" },
        { url: `https://${emp.dominio}/contato`, titulo: "Contato", tipo: "Contato" },
      ],
      erro: null,
    },
    buscas: [
      {
        query: `${emp.fantasia} ${emp.mun.m} grupo controlador`,
        objetivo: "identidade e grupo de controle",
        resultados: [
          { titulo: `${emp.fantasia} — site institucional`, url: `https://${emp.dominio}/sobre`, snippet: `Empresa de ${emp.cnae.d.toLowerCase()} sediada em ${emp.mun.m}/${emp.mun.uf}.` },
          { titulo: tituloNoticia1, url: `https://jornal-regional.example/${slug(emp.fantasia)}`, snippet: "Ampliação de capacidade produtiva." },
        ],
      },
      {
        query: `${emp.fantasia} porte funcionários receita`,
        objetivo: "porte e escala da operação",
        resultados: [{ titulo: tituloNoticia2, url: `https://valor-agro.example/${slug(emp.fantasia)}`, snippet: "Frota própria e novas rotas." }],
      },
      {
        query: `${emp.fantasia} ERP sistema de gestão`,
        objetivo: "tecnologia e sistemas de gestão",
        resultados: [{ titulo: `Vagas na ${emp.fantasia}`, url: `https://${emp.dominio}/carreira`, snippet: "Vaga de analista de sistemas." }],
      },
      {
        query: `${emp.fantasia} sócios quadro societário`,
        objetivo: "teia societária e controladores",
        resultados: [{ titulo: `QSA — ${emp.fantasia}`, url: `https://registro-publico.example/${slug(emp.fantasia)}`, snippet: "Quadro de sócios público." }],
      },
    ],
    notas: [
      "Síntese a partir do site institucional e de buscas públicas — hipóteses a validar.",
      "modo de coleta: LISTADA — 4 buscas, 4 consultas deduplicadas, 3 páginas lidas",
    ],
    sinaisDigitais: ["Domínio próprio com TLS válido", "Página de carreiras ativa com vagas abertas"],
    noticias: [
      { titulo: tituloNoticia1, fonte: "Jornal Regional (sintético)", data: "2026-07-14", link: null },
      { titulo: tituloNoticia2, fonte: "Valor Agro (sintético)", data: "2026-03-02", link: null },
    ],
    sinaisPorte: ["ampliação da unidade", "amplia frota própria"],
    teiaBuscada: ["Sócios consultados por nome em busca pública (coincidência nominal — validar no QSA)"],
    paginasOk: 3,
    paginasTentadas: 3,
    buscasOk: 3,
    buscasRecusadasCota: 0,
    geradoEm: dataIso(geradoEm),
    modoPesquisa: "LISTADA",
  };
}

/** Dossiê profundo (aiDossierJson) — mesma estrutura provada na linha AgroSul do seed de 8 linhas. */
function dossierDe(emp: Empresa, geradoEm: Date): Record<string, unknown> {
  return {
    sintese: `${emp.fantasia} é uma ${emp.setor.toLowerCase()} de ${emp.mun.m} (${emp.mun.uf}) em fase de expansão, com unidade ampliada em 2026 e frota própria.`,
    perfil: "operação multiunidade com decisão centralizada e processos em padronização",
    teia: [`${emp.fantasia} Participações Ltda (controladora)`, `${emp.fantasia} Logística Ltda (coligada de frota)`],
    operacao: [`${emp.cnae.d} para clientes corporativos`, "Atendimento em 3 estados da região", "Frota própria com rastreamento"],
    tecnologia: [
      "ERP: legado próprio com módulos não integrados (estado: parcial)",
      "Controle de estoque manual na unidade secundária (estado: ausente)",
    ],
    aderencia: [
      { produto: "ERP", processo: "padronização entre unidades", hipotese: "Migração consolidada pode considerar ERP Senior na retomada do sistema." },
      { produto: "WMS", processo: "controle de estoque manual", hipotese: "Se a operação de depósito for digitalizada, o WMS Senior cobre recebimento e expedição." },
    ],
    tese: "Expansão recente com decisão de TI centralizada e lacunas de WMS na unidade secundária.",
    profunda: true,
    entidadeEscopo: `PJ ${emp.razao} — a controladora ficou fora do escopo desta consulta.`,
    quemE: `A ${emp.razao} é uma empresa de ${emp.cnae.d.toLowerCase()}, sediada em ${emp.mun.m}/${emp.mun.uf}, controlada por ${emp.fantasia} Participações Ltda.`,
    oQueFaz: [`${emp.cnae.d}`, "Logística própria de apoio à operação"],
    escalaEstrutura: ["Unidade ampliada em 2026 (imprensa regional)", "Frota própria citada em notícia", "Página de carreiras ativa"],
    pessoas: ["Diretor-Presidente (fontes públicas)", "Diretora de Operações (fontes públicas)"],
    mudancasSinais: ["Ampliação de unidade anunciada em 2026 (imprensa)", "Contratações técnicas em curso (site de carreira)"],
    naoSabemos: [
      "Qual o sistema de gestão usado hoje — a leitura não confirmou o ERP vigente.",
      "Se o controle de estoque manual é planilha ou sistema próprio.",
      "Qual o prazo e o orçamento do programa de padronização da controladora.",
    ],
    hipotesesDetalhadas: [
      { fato: "Ampliação recente com programa de padronização anunciado", consequencia: "Decisões de sistema podem estar em avaliação agora, com janela curta de influência", validar: "Perguntar à diretoria de operações se há avaliação de ERP/WMS em curso" },
      { fato: "Controle de estoque manual na unidade secundária", consequencia: "Perdas de inventário e expedição lenta podem existir", validar: "Solicitar indicadores de acurácia de inventário por unidade" },
    ],
    evidencias: [
      { claim: "Unidade ampliada em 2026", status: "CONFIRMADO", source: "Registro de estabelecimentos (fonte oficial)", url: null, relevancia: "alta", entidade: emp.fantasia, periodo: "2026" },
      { claim: "Controle de estoque manual na unidade secundária", status: "INDICIO", source: "Página de carreira + vagas (site oficial)", url: null, relevancia: "media", entidade: emp.fantasia, periodo: "2026" },
      { claim: "Frota própria com rastreamento", status: "INDICIO", source: "Notícia regional", url: null, relevancia: "media", entidade: emp.fantasia, periodo: "2026" },
      { claim: "ERP corporativo definido pela controladora", status: "NAO_ENCONTRADO", source: "Buscas públicas", url: null, relevancia: "alta", entidade: emp.fantasia, periodo: "2026" },
    ],
    geradoEm: dataIso(geradoEm),
  };
}

/* ============================ fábrica de lotes ============================ */

/** Linha pronta para createMany — batchId/rowNumber entram só na gravação. */
type RowDraft = Omit<Prisma.ImportRowUncheckedCreateInput, "batchId" | "rowNumber">;

const AGORA = Date.now();
const DIA = 86400000;

/** Cabeçalho comum de linha enriquecida (ficha coletada). */
function fichaEnriquecida(
  emp: Empresa,
  cnpj: string,
  opts: {
    rand: () => number;
    coletadoEm: Date;
    registrationStatus?: string;
    statusDate?: string;
    matriz?: { root: string; matrizCnpj: string; souMatriz: boolean; branch: number; resolvida: boolean };
    createdAt?: Date;
    obs?: string;
    ai?: Record<string, unknown> | null;
    extra?: Record<string, unknown> | null;
  },
): RowDraft {
  const row: RowDraft = {
    lookupKind: "CNPJ",
    originalCellsJson: JSON.stringify([cnpj, opts.obs ?? "prospect regional"]),
    rawCnpj: cnpj,
    normalizedCnpj: cnpj,
    cnpjStatus: "VALIDA",
    lookupStatus: "ENRIQUECIDO",
    identityStage: "CORRESPONDENTE",
    cnpjRoot: opts.matriz ? opts.matriz.root : cnpj.slice(0, 8),
    headquartersCnpj: opts.matriz ? (opts.matriz.matrizCnpj || null) : cnpj,
    foundIsHeadquarters: opts.matriz ? opts.matriz.souMatriz : true,
    matrizStatus: opts.matriz ? (opts.matriz.resolvida ? "RESOLVIDA" : "NAO_LOCALIZADA") : "RESOLVIDA",
    branchIdentifier: opts.matriz ? opts.matriz.branch : 1,
    branchType: opts.matriz ? (opts.matriz.souMatriz ? "MATRIZ" : "FILIAL") : null,
    legalName: emp.razao,
    tradeName: emp.fantasia,
    registrationStatus: opts.registrationStatus ?? "ATIVA",
    statusDate: opts.statusDate ?? "2026-09-10",
    openingDate: emp.abertura,
    cnaeCode: emp.cnae.c,
    cnaeDescription: emp.cnae.d,
    municipality: emp.mun.m,
    uf: emp.mun.uf,
    source: "MinhaReceita",
    queriedAt: opts.coletadoEm,
    collectedAt: opts.coletadoEm,
    sociosJson: JSON.stringify(sociosDe(opts.rand, 1 + Math.floor(opts.rand() * 3))),
    extraJson: JSON.stringify(opts.extra ?? extraDe(opts.rand, emp)),
    fontesJson: JSON.stringify(fontesDe(opts.coletadoEm, opts.rand() < 0.3)),
    createdAt: opts.createdAt ?? opts.coletadoEm,
  };
  if (opts.ai) Object.assign(row, opts.ai);
  else row.aiStatus = "IGNORADO";
  return row;
}

/* ------------------------------- lote de 100 ------------------------------- */

function lote100(rand: () => number): { rows: RowDraft[]; notes: string[] } {
  const rows: RowDraft[] = [];
  const notes: string[] = [];
  const t0 = AGORA - 2 * DIA; // lote criado 2 dias atrás
  const coletado = new Date(t0 + 3600000);
  const gerado = new Date(t0 + 2 * 3600000);
  // raízes sintéticas exclusivas do lote 100 (99.100.xxx — não colidem com 99.000.xx do Gate 1)
  let raizSeq = 1;
  const novaRaiz = () => `991${String(raizSeq++).padStart(5, "0")}`; // sempre 8 dígitos
  const cnpjDa = (root: string, branch: number) => cnpjComDv(`${root}${String(branch).padStart(4, "0")}`);

  /* ---- A) 54 IDENTIFICADAS (ENRIQUECIDO, correspondente/validado) ---- */

  // A1..A9 — pares matriz/filial (raiz igual, ordem de estabelecimento diferente)
  const pares: { razaoPrefixo: string }[] = [
    { razaoPrefixo: "Metalúrgica" },
    { razaoPrefixo: "Distribuidora" },
    { razaoPrefixo: "Transportes" },
    { razaoPrefixo: "Indústria" },
  ];
  pares.forEach((p, idx) => {
    const root = novaRaiz();
    const cnpjMatriz = cnpjDa(root, 1);
    const emp = sorteiaEmpresa(rand, { razao: `${p.razaoPrefixo} ${TOKEN_A[idx % TOKEN_A.length]} ${TOKEN_B[(idx + 3) % TOKEN_B.length]} Ltda` });
    rows.push(
      fichaEnriquecida(emp, cnpjMatriz, {
        rand,
        coletadoEm: coletado,
        matriz: { root, matrizCnpj: cnpjMatriz, souMatriz: true, branch: 1, resolvida: true },
        obs: `matriz do grupo ${emp.fantasia}`,
        ai: idx < 2 ? leituraIaDe(rand, emp) : null,
      }),
    );
    const nFiliais = idx === 2 ? 2 : idx === 3 ? 1 : 1; // par 3 tem 2 filiais; par 4 só 1 (matriz não confirmada)
    for (let f = 0; f < nFiliais; f++) {
      const branch = 2 + f;
      const cnpjFilial = cnpjDa(root, branch);
      const munFilial = MUNICIPIOS[(idx * 7 + f * 5 + 3) % MUNICIPIOS.length];
      const empFilial = sorteiaEmpresa(rand, {
        razao: `${emp.razao} (Filial ${munFilial.uf})`,
        fantasia: `${emp.fantasia} ${munFilial.uf}`,
        mun: munFilial,
      });
      rows.push(
        fichaEnriquecida(empFilial, cnpjFilial, {
          rand,
          coletadoEm: coletado,
          matriz: {
            root,
            matrizCnpj: idx === 3 ? "" : cnpjMatriz, // par 4: matriz NÃO confirmada (alerta de matriz)
            souMatriz: false,
            branch,
            resolvida: idx !== 3,
          },
          obs: `filial ${branch === 2 ? "segundo" : "terceiro"} estabelecimento`,
          ai: null,
        }),
      );
    }
  });
  notes.push("pares matriz/filial: 4 raízes (uma com matriz NÃO_LOCALIZADA → alerta)");

  // A10 — dossiê profundo + pesquisa completa (linha âncora da ficha rica)
  {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    const emp = sorteiaEmpresa(rand, { razao: "AgroNorte Insumos Agrícolas S.A.", fantasia: "AgroNorte", setor: "Distribuição agrícola" });
    const ai = leituraIaDe(rand, emp);
    const row = fichaEnriquecida(emp, cnpj, { rand, coletadoEm: coletado, obs: "agro com dossiê profundo", ai });
    row.aiDossierJson = JSON.stringify(dossierDe(emp, gerado));
    row.researchJson = JSON.stringify(researchDe(emp, gerado));
    row.researchStatus = "OK";
    row.researchAt = gerado;
    rows.push(row);
  }

  // A11..A49 — 39 identificadas variadas (nomes longos, acentos, sufixos, situações cadastrais)
  for (let i = 0; i < 39; i++) {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    let emp: Empresa;
    if (i === 0) emp = sorteiaEmpresa(rand, { razao: NOME_LONGO_1, fantasia: "Forjados Jacuí" });
    else if (i === 1) emp = sorteiaEmpresa(rand, { razao: NOME_LONGO_2, fantasia: "Matopiba Insumos" });
    else if (i < 8) emp = sorteiaEmpresa(rand, { razao: NOMES_ACENTUADOS[i - 2], fantasia: NOMES_ACENTUADOS[i - 2].split(" ")[0] });
    else emp = sorteiaEmpresa(rand);

    const registrationStatus =
      i === 10 || i === 11 ? "BAIXADA" : i === 12 ? "SUSPENSA" : i === 13 ? "INAPTA" : "ATIVA";
    const statusDate = registrationStatus === "ATIVA" ? "2026-09-10" : `${2023 + (i % 3)}-0${1 + (i % 8)}-1${i % 9}`;

    const row = fichaEnriquecida(emp, cnpj, {
      rand,
      coletadoEm: new Date(coletado.getTime() + i * 60000),
      registrationStatus,
      statusDate,
      obs: OBS[i % OBS.length],
      ai: i % 3 !== 2 ? leituraIaDe(rand, emp) : null, // ~2/3 com leitura IA
    });

    // pesquisa profunda: 7 OK + 1 GERANDO + 1 FALHOU (filtros da coluna Scout)
    if (i === 4 || i === 7 || i === 14 || i === 19 || i === 24 || i === 29 || i === 34) {
      row.researchJson = JSON.stringify(researchDe(emp, gerado));
      row.researchStatus = "OK";
      row.researchAt = gerado;
    } else if (i === 16) {
      row.researchStatus = "GERANDO";
      row.researchAt = new Date(coletado.getTime() + 30 * 60000);
    } else if (i === 17) {
      row.researchStatus = "FALHOU";
      row.researchError = "Falha transitória ao montar o pacote de pesquisa (fonte indisponível) — nova tentativa possível.";
      row.researchAt = new Date(coletado.getTime() + 45 * 60000);
    }

    // 2 dossiês profundos já garantidos (A10 + este)
    if (i === 20) row.aiDossierJson = JSON.stringify(dossierDe(emp, gerado));
    rows.push(row);
  }
  notes.push(`nomes >150 chars: 2 (${NOME_LONGO_1.length} e ${NOME_LONGO_2.length} caracteres)`);
  notes.push("nomes com diacríticos pesados (Ç/Ã/É/Õ): 6 fixos + sorteados (São/Soluções/Logística/...)");
  notes.push("situação cadastral: ATIVA + 2 BAIXADA + 1 SUSPENSA + 1 INAPTA (alertas materiais)");

  // A50..A53 — 4 validadas pelo operador (identityStage VALIDADO)
  for (let i = 0; i < 4; i++) {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    const emp = sorteiaEmpresa(rand);
    const row = fichaEnriquecida(emp, cnpj, {
      rand,
      coletadoEm: new Date(coletado.getTime() + (40 + i) * 60000),
      obs: "identidade validada na revisão",
      ai: null,
    });
    row.identityStage = "VALIDADO";
    rows.push(row);
  }

  // A54 — identificada por NOME (pista → decisão humana → CNPJ resolvido)
  {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    const emp = sorteiaEmpresa(rand, { razao: "Vale Verde Alimentos e Condimentos Ltda", fantasia: "Vale Verde" });
    const pista = "Vale Verde Alimentos";
    const row = fichaEnriquecida(emp, cnpj, {
      rand,
      coletadoEm: new Date(coletado.getTime() + 50 * 60000),
      obs: "pista por nome confirmada na revisão",
      ai: leituraIaDe(rand, emp),
    });
    Object.assign(row, {
      originalCellsJson: JSON.stringify([pista, "pista por nome confirmada na revisão"]),
      rawCnpj: pista,
      normalizedCnpj: cnpj,
      cnpjStatus: "REFERENCIA",
      referenceValue: pista,
      resolvedCnpj: cnpj,
      reverseSource: "Decisão humana na revisão",
      resolutionState: "CONFIRMED",
      resolutionConfidence: "HUMANA",
      identityStage: "VALIDADO",
      resolutionJson: JSON.stringify({
        metodo: ["busca por nome", "cross-check do registro"],
        notas: ["Revisão humana: você confirmou esta empresa entre as possibilidades encontradas."],
        candidatos: [
          {
            cnpj,
            strength: "FORTE",
            sinais: ["Razão social compatível com a pista", "Município compatível com o cliente citado"],
            contradicoes: [],
            fontes: [{ fonte: "Busca na web", url: null, detalhe: "registro público" }],
            dadosJuridicos: [`Razão social: ${emp.razao}`, `Abertura: ${emp.abertura}`, "Situação: ATIVA"],
            confirmado: { razaoSocial: emp.razao, uf: emp.mun.uf, municipio: emp.mun.m, identificador: 1, fonte: "fonte oficial (sintético)" },
          },
        ],
        decisao_humana: { cnpj, origem: "candidato", em: dataIso(gerado) },
      }),
    });
    rows.push(row);
  }
  notes.push("1 linha por nome com resolução CONFIRMED/HUMANA (resolvedCnpj + reverseSource)");

  /* ---- B) 20 REVISAR (12 com candidatos + 8 com divergências) ---- */

  // B1..B12 — REVIEW com 2 candidatos (pista por nome, cnpjStatus REFERENCIA)
  for (let i = 0; i < 12; i++) {
    const rootA = novaRaiz();
    const rootB = novaRaiz();
    const cnpjA = cnpjDa(rootA, 1);
    const cnpjB = cnpjDa(rootB, 1);
    const nomeFantasia = `${TOKEN_A[(i * 3) % TOKEN_A.length]} ${TOKEN_B[(i * 5) % TOKEN_B.length]}`;
    const pista = `${nomeFantasia} ${["Transportes", "Alimentos", "Distribuidora", "Engenharia"][i % 4]}`;
    const emp = sorteiaEmpresa(rand, { razao: `${pista} Rodoviários e Logística Ltda`, fantasia: nomeFantasia });
    const munA = emp.mun;
    const munB = MUNICIPIOS[(i * 11 + 5) % MUNICIPIOS.length];
    const row: RowDraft = {
      originalCellsJson: JSON.stringify([pista, OBS[(i + 2) % OBS.length]]),
      lookupKind: "CNPJ",
      rawCnpj: pista,
      normalizedCnpj: "",
      cnpjStatus: "REFERENCIA",
      referenceValue: pista,
      lookupStatus: "ENRIQUECIDO",
      resolutionState: "REVIEW",
      resolutionConfidence: i % 2 === 0 ? "MEDIA" : "BAIXA",
      identityStage: "LOCALIZADO",
      legalName: emp.razao,
      tradeName: nomeFantasia,
      registrationStatus: "ATIVA",
      openingDate: emp.abertura,
      cnaeDescription: "Transporte rodoviário de carga",
      municipality: munA.m,
      uf: munA.uf,
      source: "Busca na web",
      queriedAt: coletado,
      collectedAt: coletado,
      aiStatus: "IGNORADO",
      sociosJson: JSON.stringify([]),
      extraJson: JSON.stringify({
        capitalSocial: emp.capital,
        porte: "SIMPLES_NACIONAL",
        simples: emp.simples,
        telefone: telefone(rand, munA.uf),
        endereco: `Av. Getúlio Vargas, ${1000 + i * 37} — ${munA.m}/${munA.uf}`,
        ibge: { populacao: munA.pop, anoPopulacao: 2022, regiaoImediata: munA.reg },
      }),
      fontesJson: JSON.stringify({ primaria: { fonte: "Busca na web", coletadoEm: dataIso(coletado) }, complementacoes: [], cache: null }),
      resolutionJson: JSON.stringify({
        metodo: ["busca por nome", "cross-check do registro"],
        notas: ["Mais de uma empresa corresponde à pista informada — confirme qual é a certa."],
        candidatos: [
          {
            cnpj: cnpjA,
            strength: "FORTE",
            sinais: ["Nome fantasia idêntico à pista", "Município compatível com o cliente citado na observação"],
            contradicoes: [],
            fontes: [{ fonte: "Busca na web", url: null, detalhe: "registro público" }],
            dadosJuridicos: [`Razão social: ${emp.razao}`, `Abertura: ${emp.abertura}`, "Situação: ATIVA"],
            confirmado: { razaoSocial: emp.razao, uf: munA.uf, municipio: munA.m, identificador: 1, fonte: "fonte oficial (sintético)" },
          },
          {
            cnpj: cnpjB,
            strength: "MEDIA",
            sinais: ["Razão social semelhante", "Atividade compatível"],
            contradicoes: [`UF divergente da pista (${munB.uf} × ${munA.uf})`],
            fontes: [{ fonte: "Busca na web", url: null }],
            dadosJuridicos: [`Razão social: ${nomeFantasia} Logística e Transporte Ltda`, "Situação: ATIVA"],
            confirmado: { razaoSocial: `${nomeFantasia} Logística e Transporte Ltda`, uf: munB.uf, municipio: munB.m, identificador: 1, fonte: "fonte oficial (sintético)" },
          },
        ],
      }),
      createdAt: coletado,
    };
    rows.push(row);
  }

  // B13..B20 — CNPJ válido com DIVERGÊNCIA de identidade (LOCALIZADO + identityDivergenciasJson)
  for (let i = 0; i < 8; i++) {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    const emp = sorteiaEmpresa(rand);
    const divergencias: { tipo: string; severidade: string; descricao: string }[] = [];
    if (i < 4) {
      divergencias.push({
        tipo: "NOME",
        severidade: "ALTA",
        descricao: `O nome da pista ("${emp.fantasia} Comércio") pouco se parece com o nome registrado ("${emp.razao}") — confira antes de usar.`,
      });
    } else if (i < 6) {
      divergencias.push({
        tipo: "LOCALIZACAO",
        severidade: "BAIXA",
        descricao: `A pista indica ${MUNICIPIOS[(i * 9) % MUNICIPIOS.length].uf}, mas o registro está em ${emp.mun.uf} (${emp.mun.m}).`,
      });
      divergencias.push({
        tipo: "DOMINIO",
        severidade: "BAIXA",
        descricao: `O domínio da pista (${slug(emp.fantasia)}-group.com.br) não aparece no cadastro — o e-mail público do registro usa ${emp.dominio}. Pode ser domínio de marketing separado do fiscal; vale conferir.`,
      });
    } else {
      divergencias.push({
        tipo: "LOCALIZACAO",
        severidade: "BAIXA",
        descricao: `A pista indica ${MUNICIPIOS[(i * 7) % MUNICIPIOS.length].uf}, mas o registro está em ${emp.mun.uf} (${emp.mun.m}).`,
      });
    }
    const row = fichaEnriquecida(emp, cnpj, {
      rand,
      coletadoEm: new Date(coletado.getTime() + (60 + i) * 60000),
      obs: "registro diverge das pistas",
      ai: null,
    });
    row.identityStage = "LOCALIZADO";
    row.identityDivergenciasJson = JSON.stringify(divergencias);
    rows.push(row);
  }
  notes.push("revisar: 12 REVIEW com 2 candidatos + 8 LOCALIZADO com divergências (NOME/ALTA, LOCALIZACAO+DOMINIO/BAIXA)");

  /* ---- C) 10 NÃO IDENTIFICADAS (UNRESOLVED / NAO_ENCONTRADO) ---- */
  for (let i = 0; i < 10; i++) {
    const porNome = i >= 7;
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    const pista = porNome ? `${TOKEN_A[(i * 5) % TOKEN_A.length]} ${TOKEN_B[(i * 3) % TOKEN_B.length]} Serviços` : cnpj;
    const row: RowDraft = {
      originalCellsJson: JSON.stringify([pista, porNome ? "pista por nome sem correspondência" : "não localizada"]),
      lookupKind: "CNPJ",
      rawCnpj: pista,
      normalizedCnpj: porNome ? "" : cnpj,
      cnpjStatus: porNome ? "REFERENCIA" : "VALIDA",
      referenceValue: porNome ? pista : null,
      lookupStatus: "NAO_ENCONTRADO",
      resolutionState: "UNRESOLVED",
      lookupError: porNome
        ? "Nenhuma empresa corresponde à pista informada nas fontes públicas nesta tentativa."
        : "Registro não localizado nas fontes públicas nesta tentativa.",
      source: porNome ? "Busca na web" : "MinhaReceita",
      queriedAt: coletado,
      resolutionJson: JSON.stringify({
        metodo: porNome ? ["busca por nome"] : ["consulta direta"],
        notas: [
          porNome
            ? "A pista ficou como não identificada. Os candidatos arquivados podem ser reabertos."
            : "A pista ficou como não identificada. Os candidatos arquivados podem ser reabertos.",
        ],
        candidatos: [],
        descartados: [],
      }),
      sociosJson: JSON.stringify([]),
      createdAt: coletado,
    };
    if (!porNome) row.collectedAt = coletado;
    rows.push(row);
  }

  /* ---- D) 5 FALHAS DE CONSULTA (com erro técnico + retryCount) ---- */
  const falhas: { status: string; erro: string; retry: number }[] = [
    { status: "RATE_LIMITED", erro: "Fonte pública temporariamente sem cota disponível (HTTP 429) — nova tentativa agendável.", retry: 1 },
    { status: "TIMEOUT", erro: "Tempo de resposta excedido ao consultar a fonte pública (timeout de 20s).", retry: 2 },
    { status: "ERRO_REDE", erro: "Falha de rede ao alcançar a fonte pública (ECONNRESET).", retry: 1 },
    { status: "ERRO_SERVIDOR", erro: "Fonte pública respondeu com erro interno (HTTP 502).", retry: 1 },
    { status: "RATE_LIMITED", erro: "Fonte pública temporariamente sem cota disponível (HTTP 429) — nova tentativa agendável.", retry: 3 },
  ];
  falhas.forEach((f, i) => {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    rows.push({
      originalCellsJson: JSON.stringify([cnpj, `falha: ${f.status.toLowerCase()}`]),
      lookupKind: "CNPJ",
      rawCnpj: cnpj,
      normalizedCnpj: cnpj,
      cnpjStatus: "VALIDA",
      lookupStatus: f.status,
      lookupError: f.erro,
      retryCount: f.retry,
      source: "MinhaReceita",
      queriedAt: new Date(coletado.getTime() + (70 + i) * 60000),
      createdAt: coletado,
    });
  });

  /* ---- E) 8 PENDENTES (6 PENDENTE + 2 EM_FILA — lote DONE, linhas não processadas) ---- */
  for (let i = 0; i < 8; i++) {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    rows.push({
      originalCellsJson: JSON.stringify([cnpj, i % 2 === 0 ? "aguardando consulta" : "entrou no fim do lote"]),
      lookupKind: "CNPJ",
      rawCnpj: cnpj,
      normalizedCnpj: cnpj,
      cnpjStatus: "VALIDA",
      lookupStatus: i < 6 ? "PENDENTE" : "EM_FILA",
      createdAt: coletado,
    });
  }

  /* ---- F) 2 DUPLICADAS (CNPJ repetido de linhas já enriquecidas) ---- */
  {
    const cnpjDuplicado1 = (rows[0].normalizedCnpj as string) ?? "";
    const cnpjDuplicado2 = (rows[2].normalizedCnpj as string) ?? "";
    rows.push(
      {
        originalCellsJson: JSON.stringify([cnpjDuplicado1, "repetida da linha 1"]),
        lookupKind: "CNPJ",
        rawCnpj: cnpjDuplicado1,
        normalizedCnpj: cnpjDuplicado1,
        cnpjStatus: "DUPLICADA",
        duplicateOf: 1,
        lookupStatus: "IGNORADO",
        createdAt: coletado,
      },
      {
        originalCellsJson: JSON.stringify([cnpjDuplicado2, "repetida da linha 3"]),
        lookupKind: "CNPJ",
        rawCnpj: cnpjDuplicado2,
        normalizedCnpj: cnpjDuplicado2,
        cnpjStatus: "DUPLICADA",
        duplicateOf: 3,
        lookupStatus: "IGNORADO",
        createdAt: coletado,
      },
    );
  }

  /* ---- G) 1 INVÁLIDA (DV não confere) ---- */
  rows.push({
    originalCellsJson: JSON.stringify(["99109999000199", "CNPJ com DV inválido"]),
    lookupKind: "CNPJ",
    rawCnpj: "99109999000199",
    normalizedCnpj: "",
    cnpjStatus: "INVALIDA",
    invalidReason: "Dígitos verificadores não conferem",
    lookupStatus: "IGNORADO",
    createdAt: coletado,
  });

  return { rows, notes };
}

/* ------------------------- lotes de carga 1000 / 5000 ------------------------- */

function loteCarga(rand: () => number, total: number): { rows: RowDraft[]; notes: string[] } {
  const rows: RowDraft[] = [];
  const notes: string[] = [];
  const t0 = total === 1000 ? AGORA - 12 * DIA : AGORA - 27 * DIA; // espalhados nos últimos 30 dias
  const base = new Date(t0);
  const enriquecidas = Math.floor(total * 0.1);
  const prefixoRaiz = total === 1000 ? "992" : "993";
  let raizSeq = 1;
  const novaRaiz = () => `${prefixoRaiz}${String(raizSeq++).padStart(5, "0")}`;
  const cnpjDa = (root: string, branch: number) => cnpjComDv(`${root}${String(branch).padStart(4, "0")}`);

  // 2 pares matriz/filial entre as enriquecidas (agrupamento por raiz na lista)
  for (let p = 0; p < 2; p++) {
    const root = novaRaiz();
    const cnpjMatriz = cnpjDa(root, 1);
    const cnpjFilial = cnpjDa(root, 2);
    const emp = sorteiaEmpresa(rand);
    const coletado = new Date(base.getTime() + p * 600000);
    const extra = extraDe(rand, emp);
    const ai = leituraIaDe(rand, emp);
    rows.push(
      fichaEnriquecida(emp, cnpjMatriz, {
        rand,
        coletadoEm: coletado,
        matriz: { root, matrizCnpj: cnpjMatriz, souMatriz: true, branch: 1, resolvida: true },
        obs: "matriz",
        ai,
        extra,
      }),
    );
    rows.push(
      fichaEnriquecida(emp, cnpjFilial, {
        rand,
        coletadoEm: coletado,
        matriz: { root, matrizCnpj: cnpjMatriz, souMatriz: false, branch: 2, resolvida: true },
        obs: "filial",
        ai: null,
        extra,
      }),
    );
  }

  // demais enriquecidas
  for (let i = rows.length; i < enriquecidas; i++) {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    const emp = sorteiaEmpresa(rand);
    rows.push(
      fichaEnriquecida(emp, cnpj, {
        rand,
        coletadoEm: new Date(base.getTime() + i * 30000),
        registrationStatus: i % 97 === 0 ? "BAIXADA" : "ATIVA",
        obs: OBS[i % OBS.length],
        ai: i % 2 === 0 ? leituraIaDe(rand, emp) : null,
      }),
    );
  }

  // demais linhas: pendentes (entrada válida, nunca processada)
  while (rows.length < total) {
    const root = novaRaiz();
    const cnpj = cnpjDa(root, 1);
    rows.push({
      originalCellsJson: JSON.stringify([cnpj, "aguardando consulta"]),
      lookupKind: "CNPJ",
      rawCnpj: cnpj,
      normalizedCnpj: cnpj,
      cnpjStatus: "VALIDA",
      lookupStatus: "PENDENTE",
      createdAt: new Date(base.getTime() + rows.length * 1000),
    });
  }
  notes.push(`${enriquecidas} enriquecidas (~10%) + ${total - enriquecidas} pendentes — foco em carga de lista/filtros/export`);
  return { rows, notes };
}

/* ============================ contadores (mesma lógica de recomputeCounters) ============================ */

interface Contadores {
  totalValid: number; totalInvalid: number; totalDuplicate: number; totalReference: number; totalResolved: number;
  totalEnriched: number; totalPending: number; aiTotal: number; aiDone: number; aiFailed: number;
  totalConfirmed: number; totalReview: number; totalUnresolved: number; totalLocalizado: number; totalValidado: number;
}

function contar(rows: RowDraft[]): Contadores {
  const c: Contadores = {
    totalValid: 0, totalInvalid: 0, totalDuplicate: 0, totalReference: 0, totalResolved: 0,
    totalEnriched: 0, totalPending: 0, aiTotal: 0, aiDone: 0, aiFailed: 0,
    totalConfirmed: 0, totalReview: 0, totalUnresolved: 0, totalLocalizado: 0, totalValidado: 0,
  };
  for (const r of rows) {
    const rs = r.resolutionState as string | null;
    const is = r.identityStage as string | null;
    const ls = r.lookupStatus as string;
    const cs = r.cnpjStatus as string;
    if (cs === "VALIDA") c.totalValid++;
    if (cs === "INVALIDA" || cs === "SEM_CNPJ") c.totalInvalid++;
    if (cs === "DUPLICADA") c.totalDuplicate++;
    if (cs === "REFERENCIA") { c.totalReference++; if (r.resolvedCnpj) c.totalResolved++; }
    if (ls === "ENRIQUECIDO") c.totalEnriched++;
    if ((cs === "VALIDA" || cs === "REFERENCIA") && ls !== "ENRIQUECIDO" && ls !== "NAO_ENCONTRADO") c.totalPending++;
    if (r.aiStatus != null) { c.aiTotal++; if (r.aiStatus === "OK") c.aiDone++; if (r.aiStatus === "FALHOU") c.aiFailed++; }
    if (rs === "CONFIRMED") c.totalConfirmed++;
    if (rs === "REVIEW" || (is === "LOCALIZADO" && ls === "ENRIQUECIDO")) c.totalReview++;
    if (rs === "UNRESOLVED") c.totalUnresolved++;
    if (is === "LOCALIZADO") c.totalLocalizado++;
    if (is === "VALIDADO") c.totalValidado++;
  }
  return c;
}

/** Distribuição de situações para o sumário de evidência (mesmos rótulos da mesa). */
function distribuicao(rows: RowDraft[]): Record<string, number> {
  const d: Record<string, number> = {
    identificada: 0, revisar: 0, "não identificada": 0, "falha de consulta": 0, pendente: 0, duplicada: 0, invalida: 0,
  };
  for (const r of rows) {
    const rs = r.resolutionState as string | null;
    const is = r.identityStage as string | null;
    const ls = r.lookupStatus as string;
    const cs = r.cnpjStatus as string;
    if (cs === "DUPLICADA") { d.duplicada++; continue; }
    if (cs === "INVALIDA") { d.invalida++; continue; }
    if (ls === "ENRIQUECIDO" && is === "LOCALIZADO") { d.revisar++; continue; }
    if (rs === "REVIEW") { d.revisar++; continue; }
    if (rs === "UNRESOLVED") { d["não identificada"]++; continue; }
    if (ls === "ENRIQUECIDO") { d.identificada++; continue; }
    if (ls === "PENDENTE" || ls === "EM_FILA" || ls === "CONSULTANDO") { d.pendente++; continue; }
    d["falha de consulta"]++;
  }
  return d;
}

/* ============================ execução ============================ */

async function semear(tamanho: number): Promise<void> {
  const fileName = `QA-homolog-${tamanho}.csv`;
  console.log(`\n[seed] === ${fileName} (${tamanho} linhas) ===`);
  const t0 = Date.now();

  // idempotência: remove o lote anterior COM O MESMO fileName (cascade apaga as
  // linhas — ver onDelete: Cascade em ImportRow, prisma/schema.prisma). Match
  // EXATO: usar startsWith "QA-homolog-100" casaria também com "QA-homolog-1000.csv".
  const anterior = await db.importBatch.findMany({ where: { fileName }, select: { fileName: true } });
  if (anterior.length > 0) {
    await db.importBatch.deleteMany({ where: { fileName } });
    console.log(`[seed] removido(s) ${anterior.length} lote(s) anterior(es): ${anterior.map((a) => a.fileName).join(", ")}`);
  }

  const rand = mulberry32(20261023 + tamanho);
  const { rows, notes } = tamanho === 100 ? lote100(rand) : loteCarga(rand, tamanho);

  // validações internas de qualidade do lote
  if (rows.length !== tamanho) throw new Error(`esperava ${tamanho} linhas, gerei ${rows.length}`);
  const dvInvalidos = rows.filter((r) => {
    const c = (r.normalizedCnpj as string) ?? "";
    if (c.length === 0) return false; // linha por nome sem CNPJ resolvido
    return c.length !== 14 || cnpjComDv(c.slice(0, 12)) !== c;
  });
  if (dvInvalidos.length > 0) throw new Error(`${dvInvalidos.length} CNPJs com DV inválido — abortando`);
  if (tamanho === 100) {
    if (NOME_LONGO_1.length <= 150 || NOME_LONGO_2.length <= 150) throw new Error("nomes longos não passam de 150 caracteres");
    const d100 = distribuicao(rows);
    const vazios = Object.entries(d100).filter(([, n]) => n === 0).map(([k]) => k);
    if (vazios.length > 0) throw new Error(`situações vazias no lote 100: ${vazios.join(", ")}`);
  }

  const contadores = contar(rows);
  const dist = distribuicao(rows);
  const fileSize = rows.reduce((acc, r) => acc + (r.originalCellsJson as string).length + 1, 0);
  const createdAt =
    tamanho === 100 ? new Date(AGORA - 2 * DIA) : tamanho === 1000 ? new Date(AGORA - 12 * DIA) : new Date(AGORA - 27 * DIA);
  const confirmedAt = new Date(createdAt.getTime() + 1800000);
  const processingAt = new Date(createdAt.getTime() + 3600000);
  const finishedAt = new Date(createdAt.getTime() + 7200000);

  const batch = await db.importBatch.create({
    data: {
      fileName,
      storedPath: "(sintético em memória — homologação v0.11.0 Gate 2)",
      fileSize,
      sourceType: "CSV",
      delimiter: ";",
      hasHeader: true,
      headerJson: JSON.stringify(["entrada", "observacao"]),
      cnpjColumnIndex: 0,
      cnpjColumnDetect: "sintético",
      rowCount: rows.length,
      status: "DONE",
      ...contadores,
      aiEnabled: true,
      totalConfirmed: contadores.totalConfirmed,
      confirmedAt,
      processingAt,
      finishedAt,
      createdAt,
    },
  });

  // numera as linhas na ordem original do arquivo e liga ao lote
  const dados: Prisma.ImportRowUncheckedCreateInput[] = rows.map((r, i) => ({ ...r, batchId: batch.id, rowNumber: i + 1 }));

  // createMany em blocos (SQLite + Prisma) — velocidade sem estourar transação
  const BLOCO = 500;
  for (let i = 0; i < dados.length; i += BLOCO) {
    await db.importRow.createMany({ data: dados.slice(i, i + BLOCO) });
  }

  const ms = Date.now() - t0;
  console.log(`[seed] lote criado: ${batch.id} — ${fileName} (${rows.length} linhas, ${fileSize} bytes)`);
  console.log(`[seed] contadores: ${JSON.stringify(contadores)}`);
  console.log(`[seed] distribuição: ${JSON.stringify(dist)}`);
  for (const n of notes) console.log(`[seed] · ${n}`);
  console.log(`[seed] tempo total (incl. geração): ${ms} ms`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const tamanhos = arg === "all" ? [100, 1000, 5000] : [Number(arg)].filter((n) => [100, 1000, 5000].includes(n));
  if (tamanhos.length === 0) {
    console.error("Uso: bun scripts/seed-qa-homolog.ts 100 | 1000 | 5000 | all");
    process.exitCode = 1;
    return;
  }
  const t0 = Date.now();
  for (const n of tamanhos) await semear(n);
  console.log(`\n[seed] concluído em ${Date.now() - t0} ms — lotes QA-homolog-* prontos para a homologação.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
