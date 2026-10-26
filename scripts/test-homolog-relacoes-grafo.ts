/**
 * test-homolog-relacoes-grafo.ts — GATE 8 (HOMOLOG-D1) da homologação v0.11.0.
 * Relações empresariais e grafo: 10 casos do contrato de produto ("o grafo é
 * visualização de FATOS já sustentados") + 4 asserções transversais.
 *
 * Método (padrão test-v01024 + gate4):
 *  - banco ISOLADO em /tmp (push do schema; DATABASE_URL ANTES dos imports
 *    dinâmicos). db/custom.db do dev server :3000 NUNCA é tocado; resolve-service
 *    :3030 nunca é contatado (handlers de rota chamados diretamente);
 *  - globalThis.fetch SUBSTITUÍDO por simulador que CONTA toda saída externa e
 *    atende apenas as URLs cadastradas (fonte de grafos grafo.minhareceita.org e
 *    cadastro BrasilAPI) — URL externa não cadastrada → bloqueada com erro
 *    (prova por construção de ZERO HTTP real);
 *  - expectativas (ESPERADO) redigidas do CONTRATO DE PRODUTO antes da observação.
 *
 * Uso: bun scripts/test-homolog-relacoes-grafo.ts
 * Saída: qa/homolog-v0110/gate8/relatorio.txt + relatorio.json (exit 0/1)
 */
import { execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { RelacoesView, QuadroView } from "../src/lib/types";

/* ================= 0) banco isolado (padrão test-v01024) ================= */
const DB_ISOLADO = "/tmp/homolog-gate8-relacoes.db";
const DB_JOURNAL = "/tmp/homolog-gate8-relacoes.db-journal";
for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
execSync(`DATABASE_URL="file:${DB_ISOLADO}" bunx prisma db push --skip-generate`, {
  cwd: process.cwd(),
  stdio: "pipe",
});
process.env.DATABASE_URL = `file:${DB_ISOLADO}`;
delete process.env.SCOUT_EXPORT_TOKEN;
delete process.env.SCOUT_AUTH_REQUIRED; // modo OPEN: handlers de rota chamados direto

const EVID_DIR = join(process.cwd(), "qa", "homolog-v0110", "gate8");
mkdirSync(EVID_DIR, { recursive: true });

/* ============ tabela ESPERADO — definida ANTES da observação ============ */
const ESPERADO: Record<number, string> = {
  1: "POST relações em empresa com 3 sócios PF: 200 ok com os 3 participantes classificados PESSOA FÍSICA (hash opaco), nomes públicos, fonte/base/coleta na resposta; cache persistido; REABERTURA servida do cache (via=cache) com ZERO HTTP externo e coletadoEm original; mapa AUSENTE (estrela raiz→participantes é decoração — grafoTemValor=false).",
  2: "Participante com nome e SEM CNPJ é classificado PESSOA_FÍSICA pela semântica do IDENTIFICADOR (hash 32-hex da fonte) — nunca pelo nome; sem cnpjParticipante; nenhum CPF (nem mascarado) em qualquer resposta.",
  3: "Participante com identificador CNPJ de 14 caracteres com DV válido é classificado PESSOA_JURIDICA, com cnpjParticipante preenchido e razão social PJ; expansão do quadro PJ funciona (1 hop, contagem de empresas por raiz distinta).",
  4: "Identificador que não prova nem PF nem PJ (ex.: 8 dígitos com nome empresarial) → tipo INDETERMINADO com aviso de tipo não confirmado; NUNCA PF por eliminação (lição v0.10.16); tentativa de expansão recusada com 422 PARTICIPANTE_INVALIDO SEM nenhuma chamada HTTP.",
  5: "Quadro com 12 participantes: TODOS presentes na resposta (sem corte), ordem ESTÁVEL entre a 1ª consulta e a releitura de cache, sem duplicação; o mapa limita o DESENHO a 8 nós de participantes (teto de exibição) mantendo o total real na leitura.",
  6: "Mesmo participante PF nos quadros de DUAS empresas (raízes distintas, mesmo lote): visível nas DUAS fichas (comumCom apontando a outra empresa) com nota explícita 'NÃO caracteriza grupo econômico'; NENHUMA aresta empresa↔empresa de grupo no grafo (a aresta compartilhado liga participante→empresa — fato dos dois quadros); nenhuma ocorrência de 'grupo' fora da negação.",
  7: "Estabelecimentos da MESMA raiz: descoberta via quadros de participantes PF (cobertura PARCIAL rotulada), confirmação individual pelo campo OFICIAL identificador_matriz_filial (1=matriz, 2=filiais — nunca pela ordem 0001); filiais amarradas à raiz e NUNCA entre si (no grafo, estabelecimento da mesma raiz vira aresta mesma-empresa PARA A RAIZ, sem nó duplicado); EstabelecimentoRootCache por raiz; 2ª rodada via cache com ZERO HTTP e sem duplicar unidades.",
  8: "Empresa sem relações em lugar nenhum: 200 com lista vazia e aviso de ausência registrada (NÃO é falha); GET /quadros vazio; sinal de 'nada útil' que a UI usa para a AUSÊNCIA INTENCIONAL do mapa: totalParticipantes=0 e quadros={} → construirGrafoRelacoes não gera arestas → grafoTemValor=false → GrafoRelacoesCard retorna null (sem card vazio).",
  9: "Cache fora do TTL (30 dias): NUNCA reuso silencioso — revalidação por nova consulta (via=consulta, coletadoEm NOVA = coleta honesta) e cache regravado; dentro do TTL o reuso preserva o coletadoEm original com ZERO HTTP; cache ANTIGO com classificação pré-v0.10.16 é reclassificado à LEITURA e regravado com ZERO reconsulta.",
  10: "Avisos de unificação do quadro (registros repetidos na fonte unificados por CNPJ igual) sobrevivem: 1ª consulta, releitura de cache da expansão (correção v0.10.24) e GET /quadros; linhas de cache antigas sem avisosJson: fallback determinístico rederiva o aviso de TETO quando truncado e NÃO inventa aviso de unificação; sem truncamento → sem aviso.",
};
const ESPERADO_CROSS: Record<string, string> = {
  T1: "ZERO HTTP externo em toda ABERTURA/leitura: POST relações com cache válido, GET /quadros (sempre — leitura pura), POST expansão com cache válido, POST matriz-filiais com cache válido — nenhuma saída externa (provado por fetch global interceptado que conta toda saída); HTTP só no comando de coleta.",
  T2: "Sócios NUNCA viram decisores/contatos automaticamente: a resposta expõe apenas campos de vínculo (participanteId, tipo, nomePublico, cnpjParticipante, razaoSocialPj, qualificacao, comumCom, comumMesmaPj); qualificação só por REUSO do cadastro (nome exato único); nenhum campo de contato (e-mail/telefone) ou papel de decisor; nenhum CPF em nenhuma resposta.",
  T3: "Classificação PF/PJ nunca conflui pelo NOME: o identificador decide (hash=PF; CNPJ com DV=PJ; qualquer outra coisa=INDETERMINADO) — nome empresarial com id sem prova NÃO vira PF; CNPJ com DV inválido NÃO vira PJ; nome de pessoa com CNPJ válido NÃO vira PF.",
  T4: "Participante compartilhado NÃO cria aresta automática de grupo: nenhuma aresta do tipo compartilhado com origem na raiz; nenhum nó/aresta rotulado como grupo fora da negação explícita; arestas refletem apenas fatos sustentados (participação de quadro, quadro expandido por comando, mesma pessoa jurídica, participante comum).",
};

/* ================= simulador de fontes (ZERO HTTP real) ================= */
const GRAFO = new Map<string, { status: number; json: unknown }>();
const FICHAS = new Map<string, Record<string, unknown>>(); // cadastro (BrasilAPI)
const saidas: string[] = [];
const fetchOriginal = globalThis.fetch;

function jsonRes(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const externo = /^https?:\/\//i.test(url) && !url.includes("127.0.0.1") && !url.includes("localhost");
  if (!externo) return fetchOriginal(input as never, init);
  saidas.push(url);
  // fonte única das RELAÇÕES (FRENTE A/B): grafo da MinhaReceita
  if (url.startsWith("https://grafo.minhareceita.org/")) {
    const path = url.slice("https://grafo.minhareceita.org".length);
    const alvo = GRAFO.get(path);
    if (alvo) return jsonRes(alvo.status, alvo.json);
    return jsonRes(404, { message: `Identificador ${path.replace("/", "")} não encontrado ou sem conexões.` });
  }
  // cadastro (confirmação individual de estabelecimentos — FRENTE B)
  const mCnpj = url.match(
    /(?:brasilapi\.com\.br\/api\/cnpj\/v1|api\.opencnpj\.org|receitaws\.com\.br\/v\d+\/cnpj|minhareceita\.org)\/([0-9A-Z]{14})/
  );
  if (mCnpj) {
    const ficha = FICHAS.get(mCnpj[1]);
    if (ficha) return jsonRes(200, ficha);
    return jsonRes(404, { message: "not found (simulado)" });
  }
  if (url.includes("servicodados.ibge.gov.br/")) return jsonRes(200, []);
  throw new Error(`SIMULADOR GATE8: saída externa NÃO cadastrada — bloqueada (prova de zero HTTP real): ${url}`);
}) as typeof fetch;

/* ================= imports dinâmicos (DEPOIS do env) ================= */
const { db } = await import("../src/lib/db");
const { validateCnpj, cnpjFromRoot } = await import("../src/lib/cnpj");
const { classificarParticipantePorId, detectarParticipantesComuns } = await import("../src/lib/relations/grafo");
const { construirGrafoRelacoes, grafoTemValor, GRAFO_TETO_PARTICIPANTES } = await import("../src/lib/inteligencia");
const { RELACAO_TTL_DIAS } = await import("../src/lib/relations/service");
const { aguardarTelemetria } = await import("../src/lib/telemetry");
const { POST: postRelacoesRota } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/route");
const { GET: getQuadrosRota } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/quadros/route");
const { POST: postExpansaoRota } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/expansao/route");
const { POST: postMatrizRota } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/matriz-filiais/route");
const { NextRequest } = await import("next/server");
type NextReq = InstanceType<typeof NextRequest>;

/* ================= infra de verificação ================= */
interface RegistroCheck { nome: string; pass: boolean; extra: string }
interface Secao { chave: string; titulo: string; esperado: string; checks: RegistroCheck[]; observado: string[] }
interface Bug { id: string; severidade: string; titulo: string; reproducao: string; evidencia: string }

const secoes: Secao[] = [];
const bugs: Bug[] = [];
let passTotal = 0;
let failTotal = 0;
const falhasNomes: string[] = [];
let secaoAtual: Secao | null = null;
const corpos: string[] = []; // todos os corpos de resposta (scan global de CPF/contatos)
const leiturasZeroHttp: { nome: string; delta: number }[] = [];
const grafosConstruidos: { nome: string; arestas: { de: string; para: string; tipo: string; rotulo: string }[] }[] = [];

function abrirSecao(chave: string, titulo: string, esperado: string) {
  secaoAtual = { chave, titulo, esperado, checks: [], observado: [] };
  secoes.push(secaoAtual);
  console.log(`\n== ${chave} — ${titulo} ==`);
}
function caso(n: number, titulo: string) {
  abrirSecao(`CASO ${n}`, titulo, ESPERADO[n]);
}
function check(nome: string, cond: boolean, extra = ""): boolean {
  const ok = cond === true;
  if (ok) passTotal += 1;
  else {
    failTotal += 1;
    falhasNomes.push(nome);
  }
  secaoAtual?.checks.push({ nome, pass: ok, extra });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${nome}${!ok && extra ? ` — ${extra}` : ""}`);
  return ok;
}
function obs(texto: string) {
  secaoAtual?.observado.push(texto);
}
function bug(id: string, severidade: string, titulo: string, reproducao: string, evidencia: string) {
  bugs.push({ id, severidade, titulo, reproducao, evidencia });
  console.log(`  BUG ${id} [${severidade}] ${titulo}`);
}

/* ================= tipos de resposta (espelho do contrato de API) ================= */
interface ParticipanteResp {
  participanteId: string;
  tipo: string;
  nomePublico: string;
  cnpjParticipante: string | null;
  razaoSocialPj: string | null;
  qualificacao: { qual: string; entrada: string; origem: string } | null;
  comumCom: { cnpj: string; razaoSocial: string | null; nota: string }[];
  comumMesmaPj: { cnpj: string; nota: string }[];
  [k: string]: unknown;
}
interface RelacoesResp {
  ok: boolean;
  cnpj: string;
  razaoSocialConsultada: string | null;
  fonte: string;
  baseDados: string | null;
  coletadoEm: string;
  validoAte: string;
  via: string;
  participantes: ParticipanteResp[];
  totalParticipantes: number;
  existeParticipanteComum: boolean;
  avisos: string[];
  [k: string]: unknown;
}
interface QuadroResp {
  ok: boolean;
  participanteId: string;
  tipoParticipante: string;
  rotulo: string | null;
  leitura: string;
  totalEmpresas: number;
  totalPessoasJuridicas: number;
  truncado: boolean;
  empresas: { cnpj: string; razaoSocial: string | null }[];
  empresasOcultas: number;
  fonte: string;
  coletadoEm: string;
  validoAte: string;
  via: string;
  avisos: string[];
  [k: string]: unknown;
}
interface EstabelecimentoResp {
  cnpj: string;
  razaoSocial: string | null;
  municipio: string | null;
  uf: string | null;
  situacao: string | null;
  cnae: string | null;
  identificadorMatrizFilial: number | null;
  confirmado: boolean;
  descobertoPor: string;
  confirmadoEm: string | null;
  fonteConfirmacao: string | null;
  [k: string]: unknown;
}
interface MatrizFiliaisResp {
  ok: boolean;
  cnpjRaiz: string;
  raizAlfanumerica: boolean;
  fonteDescoberta: string;
  coletadoEm: string;
  atualizadoEm: string;
  validoAte: string;
  via: string;
  consultado: { cnpj: string; branchType: string | null; branchIdentifier: number | null };
  matriz: EstabelecimentoResp | null;
  filiais: EstabelecimentoResp[];
  localizadosNaoConfirmados: EstabelecimentoResp[];
  cobertura: {
    parcial: boolean;
    participantesConsultados: number;
    totalParticipantesPf: number;
    tetoParticipantes: number;
    tetoConfirmacoes: number;
    confirmadosNaRodada: number;
    pendentesConfirmacao: number;
  };
  avisos: string[];
  [k: string]: unknown;
}
interface CorpoRelacoes { ok?: boolean; relacoes?: RelacoesResp; error?: { code?: string; message?: string } }
interface CorpoQuadro { ok?: boolean; quadro?: QuadroResp; error?: { code?: string; message?: string; detalheTecnico?: string } }
interface CorpoQuadros { ok?: boolean; quadros?: Record<string, QuadroResp>; avisos?: string[] }
interface CorpoMatriz { ok?: boolean; matrizFiliais?: MatrizFiliaisResp; error?: { code?: string; message?: string } }

/* ================= chamadas de rota (handlers diretos) ================= */
async function chamar(
  handler: (req: NextReq, ctx: { params: Promise<{ id: string; rowNumber: string }> }) => Promise<Response>,
  batchId: string,
  rowNumber: number,
  sufixo: string,
  metodo: "GET" | "POST",
  corpo?: unknown
): Promise<Response> {
  const url = `http://localhost:3000/api/imports/${batchId}/rows/${rowNumber}/${sufixo}`;
  const req =
    corpo !== undefined
      ? new NextRequest(url, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) })
      : new NextRequest(url, { method: metodo });
  return handler(req, { params: Promise.resolve({ id: batchId, rowNumber: String(rowNumber) }) });
}
async function postRelacoes(batchId: string, rowNumber: number) {
  const res = await chamar(postRelacoesRota, batchId, rowNumber, "relacoes-societarias", "POST");
  const corpo = (await res.json()) as CorpoRelacoes;
  corpos.push(JSON.stringify(corpo));
  return { status: res.status, corpo, view: corpo.relacoes ?? null };
}
async function getQuadros(batchId: string, rowNumber: number) {
  const antes = saidas.length;
  const res = await chamar(getQuadrosRota, batchId, rowNumber, "relacoes-societarias/quadros", "GET");
  const corpo = (await res.json()) as CorpoQuadros;
  corpos.push(JSON.stringify(corpo));
  const delta = saidas.length - antes;
  leiturasZeroHttp.push({ nome: `GET /quadros (lote ${batchId.slice(-4)} linha ${rowNumber})`, delta });
  return { status: res.status, corpo, quadros: corpo.quadros ?? {}, avisos: corpo.avisos ?? [], deltaHttp: delta };
}
async function postExpansao(batchId: string, rowNumber: number, participanteId: string) {
  const res = await chamar(postExpansaoRota, batchId, rowNumber, "relacoes-societarias/expansao", "POST", { participanteId });
  const corpo = (await res.json()) as CorpoQuadro;
  corpos.push(JSON.stringify(corpo));
  return { status: res.status, corpo, view: corpo.quadro ?? null };
}
async function postMatrizFiliais(batchId: string, rowNumber: number) {
  const res = await chamar(postMatrizRota, batchId, rowNumber, "matriz-filiais", "POST");
  const corpo = (await res.json()) as CorpoMatriz;
  corpos.push(JSON.stringify(corpo));
  return { status: res.status, corpo, view: corpo.matrizFiliais ?? null };
}

/* ================= fixtures determinísticas ================= */
function cnpjValido(raiz: string, ordem: string): string {
  const c = cnpjFromRoot(raiz, ordem);
  if (!c || !validateCnpj(c).valid) throw new Error(`fixture CNPJ inválida: ${raiz}/${ordem}`);
  return c;
}
const hash = (tag: string) => tag.repeat(16); // tag de 2 chars hex → 32 hex (hash opaco da fonte)

const CNPJ_A = cnpjValido("71000001", "0001"); // quadro simples (3 PF)
const CNPJ_B = cnpjValido("72000002", "0001"); // classificação PF/PJ/INDETERMINADO
const CNPJ_C = cnpjValido("73000003", "0001"); // 12 participantes
const CNPJ_D = cnpjValido("74000004", "0001"); // participante comum (raiz D)
const CNPJ_E = cnpjValido("75000005", "0001"); // participante comum (raiz E)
const CNPJ_F1 = cnpjValido("76000006", "0001"); // matriz
const CNPJ_F2 = cnpjValido("76000006", "0002"); // filial
const CNPJ_F3 = cnpjValido("76000006", "0003"); // filial
const CNPJ_G = cnpjValido("77000007", "0001"); // sem relações
const CNPJ_H = cnpjValido("78000008", "0001"); // cache fora do TTL
const CNPJ_I = cnpjValido("78100009", "0001"); // cache antigo pré-v0.10.16
const CNPJ_J = cnpjValido("79400001", "0001"); // quadro grande (60 empresas)
const CNPJ_PJ_B = cnpjValido("79000010", "0001"); // participante PJ do quadro de B
const CNPJ_PJ_E = cnpjValido("79300001", "0001"); // participante PJ do quadro de E
const CNPJ_U1 = cnpjValido("79500001", "0001"); // empresa não relacionada (quadros)
const CNPJ_U2 = cnpjValido("79500002", "0001"); // idem
const CNPJ_PJ_C = [1, 2, 3, 4].map((i) => cnpjValido(`7920000${i}`, "0001")); // PJ do quadro de C

const HA1 = hash("01"), HA2 = hash("02"), HA3 = hash("03");
const HB1 = hash("04"), HB2 = hash("05");
const HC = Array.from({ length: 8 }, (_, i) => hash(String(10 + i))); // 8 PF de C
const HD2 = hash("21"), HP = hash("20"); // HP = participante comum D×E
const HF1 = hash("30"), HF2 = hash("31");
const HH = hash("40");
const HJ = hash("50");
const HOM1 = hash("61"), HOM2 = hash("62"); // homônimos "JOAO SILVA"
const HASH_EMPRESARIAL = hash("60"); // hash com NOME empresarial (classificador segue o id)
const HBI_OK = hash("07"); // PF correto no cache antigo de I

/* ---- fonte de grafos (mock) ---- */
const linhaGrafo = (cnpj: string, razao: string, id: string, nome: string | null, cpf?: string) => ({
  cnpj, razao_social: razao, id, ...(nome ? { nome } : {}), ...(cpf ? { cpf } : {}),
});
GRAFO.set("/updated", { status: 200, json: { message: "2026-10" } });

GRAFO.set(`/${CNPJ_A}`, {
  status: 200,
  json: [
    linhaGrafo(CNPJ_A, "ALFA COMERCIO DE TINTAS LTDA", HA1, "MARIA SOARES DE ALMEIDA", "***123456**"),
    linhaGrafo(CNPJ_A, "ALFA COMERCIO DE TINTAS LTDA", HA2, "JOAO PEREIRA"),
    linhaGrafo(CNPJ_A, "ALFA COMERCIO DE TINTAS LTDA", HA3, "ANA LIMA"),
  ],
});
GRAFO.set(`/${CNPJ_B}`, {
  status: 200,
  json: [
    linhaGrafo(CNPJ_B, "BETA COMERCIO LTDA", HB1, "CARLOS NUNES"),
    linhaGrafo(CNPJ_B, "BETA COMERCIO LTDA", CNPJ_PJ_B, "EMPRESA BETA PARTICIPACOES LTDA"),
    linhaGrafo(CNPJ_B, "BETA COMERCIO LTDA", "35444812", "BRD DIGITAL PARTICIPACOES LTDA"),
    { cnpj: CNPJ_B, razao_social: "BETA COMERCIO LTDA", nome: "LINHA SEM ID", cpf: "***999999**" },
    linhaGrafo(CNPJ_B, "BETA COMERCIO LTDA", HB2, null),
  ],
});
GRAFO.set(`/${HA1}`, {
  status: 200,
  json: [
    linhaGrafo(CNPJ_A, "ALFA COMERCIO DE TINTAS LTDA", HA1, "MARIA SOARES DE ALMEIDA"),
    linhaGrafo(CNPJ_A, "ALFA COMERCIO DE TINTAS LTDA", HA1, "MARIA SOARES DE ALMEIDA"), // repetida → unificação
    linhaGrafo(CNPJ_U1, "UNO TRANSPORTES LTDA", HA1, "MARIA SOARES DE ALMEIDA"),
    linhaGrafo(CNPJ_U2, "DUO SERVICOS LTDA", HA1, "MARIA SOARES DE ALMEIDA"),
  ],
});
GRAFO.set(`/${CNPJ_PJ_B}`, {
  status: 200,
  json: [
    linhaGrafo(CNPJ_U1, "UNO TRANSPORTES LTDA", CNPJ_PJ_B, "EMPRESA BETA PARTICIPACOES LTDA"),
    linhaGrafo(CNPJ_U2, "DUO SERVICOS LTDA", CNPJ_PJ_B, "EMPRESA BETA PARTICIPACOES LTDA"),
  ],
});
GRAFO.set(`/${CNPJ_C}`, {
  status: 200,
  json: [
    ...HC.map((h, i) => linhaGrafo(CNPJ_C, "CIA DOZE PARTICIPACOES LTDA", h, `SOCIO PF ${i + 1}`)),
    ...CNPJ_PJ_C.map((c) => linhaGrafo(CNPJ_C, "CIA DOZE PARTICIPACOES LTDA", c, `HOLDING C ${c.slice(0, 8)} LTDA`)),
  ],
});
GRAFO.set(`/${CNPJ_D}`, {
  status: 200,
  json: [linhaGrafo(CNPJ_D, "DELTA LOGISTICA LTDA", HP, "MARIA SOUZA"), linhaGrafo(CNPJ_D, "DELTA LOGISTICA LTDA", HD2, "PEDRO CASTRO")],
});
GRAFO.set(`/${CNPJ_E}`, {
  status: 200,
  json: [linhaGrafo(CNPJ_E, "ECHO ALIMENTOS LTDA", HP, "MARIA SOUZA"), linhaGrafo(CNPJ_E, "ECHO ALIMENTOS LTDA", CNPJ_PJ_E, "GAMA EMPREENDIMENTOS LTDA")],
});
GRAFO.set(`/${HP}`, {
  status: 200,
  json: [
    linhaGrafo(CNPJ_D, "DELTA LOGISTICA LTDA", HP, "MARIA SOUZA"),
    linhaGrafo(CNPJ_E, "ECHO ALIMENTOS LTDA", HP, "MARIA SOUZA"),
    linhaGrafo(CNPJ_U1, "UNO TRANSPORTES LTDA", HP, "MARIA SOUZA"),
  ],
});
GRAFO.set(`/${CNPJ_F1}`, {
  status: 200,
  json: [linhaGrafo(CNPJ_F1, "FLORESTA DISTRIBUIDORA LTDA", HF1, "HELENA DUARTE"), linhaGrafo(CNPJ_F1, "FLORESTA DISTRIBUIDORA LTDA", HF2, "RICARDO MOTA")],
});
GRAFO.set(`/${CNPJ_F2}`, {
  status: 200,
  json: [linhaGrafo(CNPJ_F2, "FLORESTA DISTRIBUIDORA LTDA", HF1, "HELENA DUARTE"), linhaGrafo(CNPJ_F2, "FLORESTA DISTRIBUIDORA LTDA", HF2, "RICARDO MOTA")],
});
GRAFO.set(`/${HF1}`, {
  status: 200,
  json: [
    linhaGrafo(CNPJ_F1, "FLORESTA DISTRIBUIDORA LTDA", HF1, "HELENA DUARTE"),
    linhaGrafo(CNPJ_F2, "FLORESTA DISTRIBUIDORA LTDA", HF1, "HELENA DUARTE"),
    linhaGrafo(CNPJ_F3, "FLORESTA DISTRIBUIDORA LTDA", HF1, "HELENA DUARTE"),
    linhaGrafo(CNPJ_U2, "DUO SERVICOS LTDA", HF1, "HELENA DUARTE"),
  ],
});
GRAFO.set(`/${HF2}`, { status: 200, json: [linhaGrafo(CNPJ_U2, "DUO SERVICOS LTDA", HF2, "RICARDO MOTA")] });
GRAFO.set(`/${CNPJ_G}`, { status: 404, json: { message: `Identificador ${CNPJ_G} não encontrado ou sem conexões.` } });
GRAFO.set(`/${CNPJ_H}`, { status: 200, json: [linhaGrafo(CNPJ_H, "HIDRO ENERGIA LTDA", HH, "TEREZA FONSECA")] });
GRAFO.set(`/${HH}`, { status: 200, json: [linhaGrafo(CNPJ_U1, "UNO TRANSPORTES LTDA", HH, "TEREZA FONSECA")] });
GRAFO.set(`/${CNPJ_J}`, { status: 200, json: [linhaGrafo(CNPJ_J, "JOTA MARKETING LTDA", HJ, "JULIA MONTES")] });
GRAFO.set(`/${HJ}`, {
  status: 200,
  json: Array.from({ length: 60 }, (_, i) =>
    linhaGrafo(cnpjValido(`796${String(i + 1).padStart(5, "0")}`, "0001"), `J QUADRO EMPRESA ${i + 1} LTDA`, HJ, "JULIA MONTES")
  ),
});

/* ---- fichas de cadastro (mock BrasilAPI — confirmação de filiais) ---- */
function fichaCadastro(cnpj: string, razao: string, identificador: number, municipio: string): Record<string, unknown> {
  return {
    cnpj,
    razao_social: razao,
    nome_fantasia: razao.split(" ")[0],
    descricao_situacao_cadastral: "ATIVA",
    data_situacao: "2020-01-10",
    descricao_identificador_matriz_filial: identificador === 1 ? "MATRIZ" : "FILIAL",
    identificador_matriz_filial: identificador,
    data_inicio_atividade: "2018-05-02",
    cnae_fiscal: "4649404",
    cnae_fiscal_descricao: "Comércio atacadista de produtos de limpeza",
    municipio,
    uf: "SP",
    natureza_juridica: "206-2 - Sociedade Empresária Limitada",
    descricao_porte: "DEMAIS",
    capital_social: "150000.00",
    opcao_simples: "S",
    opcao_mei: "N",
    email: "financeiro@floresta.example",
    ddd_telefone_1: "19 32320000",
    logradouro: "RUA DAS ACACIAS",
    numero: "100",
    bairro: "CENTRO",
    qsa: [{ nome: "HELENA DUARTE", qualificacao_socio: "Sócio-Administrador" }],
    cnaes_secundarios: [{ codigo: "4711-3", descricao: "Comércio varejista" }],
    codigo_municipio_ibge: "3509502",
    regime_tributario: [{ ano: 2024, forma_de_tributacao: "Lucro Presumido" }],
  };
}
FICHAS.set(CNPJ_F2, fichaCadastro(CNPJ_F2, "FLORESTA DISTRIBUIDORA LTDA", 2, "CAMPINAS"));
FICHAS.set(CNPJ_F3, fichaCadastro(CNPJ_F3, "FLORESTA DISTRIBUIDORA LTDA", 2, "SOROCABA"));

/* ================= lotes e linhas ================= */
async function criarLote(
  fileName: string,
  linhas: { rowNumber: number; cnpj: string; legalName: string; branchType?: string; branchIdentifier?: number; headquartersCnpj?: string; sociosJson?: string }[]
): Promise<string> {
  const batch = await db.importBatch.create({ data: { fileName, storedPath: "", fileSize: 0, status: "DONE" } });
  for (const l of linhas) {
    await db.importRow.create({
      data: {
        batchId: batch.id,
        rowNumber: l.rowNumber,
        rawCnpj: l.cnpj,
        normalizedCnpj: l.cnpj,
        cnpjStatus: "VALIDA",
        lookupStatus: "ENRIQUECIDO",
        legalName: l.legalName,
        branchType: l.branchType ?? null,
        branchIdentifier: l.branchIdentifier ?? null,
        cnpjRoot: l.cnpj.slice(0, 8),
        headquartersCnpj: l.headquartersCnpj ?? null,
        sociosJson: l.sociosJson ?? null,
      },
    });
  }
  return batch.id;
}

const SOCIOS_A = JSON.stringify([
  { nome: "MARIA SOARES DE ALMEIDA", qual: "Sócio-Administrador", entrada: "2015-03-10" },
  { nome: "JOAO PEREIRA", qual: "Sócio", entrada: "2012-08-01" },
]);

const loteA = await criarLote("QA-gate8-A.csv", [{ rowNumber: 1, cnpj: CNPJ_A, legalName: "ALFA COMERCIO DE TINTAS LTDA", sociosJson: SOCIOS_A }]);
const loteB = await criarLote("QA-gate8-B.csv", [{ rowNumber: 1, cnpj: CNPJ_B, legalName: "BETA COMERCIO LTDA" }]);
const loteC = await criarLote("QA-gate8-C.csv", [{ rowNumber: 1, cnpj: CNPJ_C, legalName: "CIA DOZE PARTICIPACOES LTDA" }]);
const loteDE = await criarLote("QA-gate8-DE.csv", [
  { rowNumber: 1, cnpj: CNPJ_D, legalName: "DELTA LOGISTICA LTDA" },
  { rowNumber: 2, cnpj: CNPJ_E, legalName: "ECHO ALIMENTOS LTDA" },
]);
const loteF = await criarLote("QA-gate8-F.csv", [
  { rowNumber: 1, cnpj: CNPJ_F1, legalName: "FLORESTA DISTRIBUIDORA LTDA", branchType: "MATRIZ", branchIdentifier: 1 },
  { rowNumber: 2, cnpj: CNPJ_F2, legalName: "FLORESTA DISTRIBUIDORA LTDA", branchType: "FILIAL", branchIdentifier: 2, headquartersCnpj: CNPJ_F1 },
]);
const loteG = await criarLote("QA-gate8-G.csv", [{ rowNumber: 1, cnpj: CNPJ_G, legalName: "GAMA SEM QUADRO LTDA" }]);
const loteH = await criarLote("QA-gate8-H.csv", [{ rowNumber: 1, cnpj: CNPJ_H, legalName: "HIDRO ENERGIA LTDA" }]);
const loteJ = await criarLote("QA-gate8-J.csv", [{ rowNumber: 1, cnpj: CNPJ_J, legalName: "JOTA MARKETING LTDA" }]);

// lote I: cache de relações ANTIGO (pré-v0.10.16) com classificação errada, ainda válido
const COLETA_ANTIGA = new Date(Date.now() - 40 * 86400000);
const loteI = await criarLote("QA-gate8-I.csv", [{ rowNumber: 1, cnpj: CNPJ_I, legalName: "INDUSTRIAL IOTA LTDA" }]);
await db.relacaoSocietariaCache.create({
  data: {
    cnpj: CNPJ_I,
    fonte: "MinhaReceita Grafo",
    baseDados: "2026-09",
    coletadoEm: COLETA_ANTIGA,
    atualizadoEm: COLETA_ANTIGA,
    validoAte: new Date(Date.now() + 20 * 86400000),
    relacoesJson: JSON.stringify([
      { participanteId: "35444812", tipo: "PF", nomePublico: "BRD DIGITAL PARTICIPACOES LTDA", cnpjParticipante: null, razaoSocialPj: null },
      { participanteId: HBI_OK, tipo: "PF", nomePublico: "LUCIA PRADO", cnpjParticipante: null, razaoSocialPj: null },
      { participanteId: CNPJ_PJ_B, tipo: "PJ", nomePublico: "EMPRESA BETA PARTICIPACOES LTDA", cnpjParticipante: CNPJ_PJ_B, razaoSocialPj: "EMPRESA BETA PARTICIPACOES LTDA" },
    ]),
    totalParticipantes: 3,
  },
});

/* ====================== execução dos 10 casos ====================== */
const todosParticipantes: ParticipanteResp[] = [];
const todosEstabelecimentos: EstabelecimentoResp[] = [];
function grafar(nome: string, view: RelacoesResp, quadros: Record<string, QuadroResp>) {
  const g = construirGrafoRelacoes(view as unknown as RelacoesView, quadros as unknown as Record<string, QuadroView>);
  grafosConstruidos.push({ nome, arestas: g.arestas.map((a) => ({ de: a.de, para: a.para, tipo: a.tipo, rotulo: a.rotulo })) });
  return g;
}

/* ---------------- CASO 1 — quadro societário simples ---------------- */
caso(1, "Quadro societário simples (uma empresa, 3 sócios PF)");
{
  const antes = saidas.length;
  const r1 = await postRelacoes(loteA, 1);
  const v1 = r1.view;
  check("C1.1 HTTP 200 com ok:true e view de relações", r1.status === 200 && r1.corpo.ok === true && !!v1, `status=${r1.status} corpo=${JSON.stringify(r1.corpo).slice(0, 160)}`);
  if (v1) {
    todosParticipantes.push(...v1.participantes);
    check("C1.2 3 participantes, TODOS classificados PF (PESSOA FÍSICA)", v1.totalParticipantes === 3 && v1.participantes.length === 3 && v1.participantes.every((p) => p.tipo === "PF"));
    check("C1.3 nomes públicos exatos da fonte (nada inventado)", JSON.stringify(v1.participantes.map((p) => p.nomePublico)) === JSON.stringify(["MARIA SOARES DE ALMEIDA", "JOAO PEREIRA", "ANA LIMA"]));
    check("C1.4 PF não traz cnpjParticipante", v1.participantes.every((p) => p.cnpjParticipante === null));
    check("C1.5 proveniência completa (fonte, base, via, coleta, validade)", v1.fonte === "MinhaReceita Grafo" && v1.baseDados === "2026-10" && v1.via === "consulta" && !!v1.coletadoEm && !!v1.validoAte);
    check("C1.6 razão social oficial da linha preservada", v1.razaoSocialConsultada === "ALFA COMERCIO DE TINTAS LTDA");
    check("C1.7 comando de coleta consultou a fonte exatamente 2× (/{cnpj} + /updated)", saidas.length - antes === 2, `saídas=${JSON.stringify(saidas.slice(antes))}`);
    const cacheA = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: CNPJ_A } });
    check("C1.8 cache persistido com total correto", cacheA !== null && cacheA.totalParticipantes === 3);
    check("C1.9 qualificação só por REUSO do cadastro: MARIA (nome exato único) tem; ANA (fora do cadastro) fica null", v1.participantes.find((p) => p.participanteId === HA1)?.qualificacao?.qual === "Sócio-Administrador" && v1.participantes.find((p) => p.participanteId === HA3)?.qualificacao === null);
    const auditA = await db.auditEvent.count({ where: { batchId: loteA, event: "relacoes_societarias" } });
    check("C1.10 auditoria registrada (relacoes_societarias)", auditA === 1);
    // reabertura
    const antesB = saidas.length;
    const r1b = await postRelacoes(loteA, 1);
    const v1b = r1b.view;
    leiturasZeroHttp.push({ nome: "POST /relacoes-societarias reabertura (cache válido)", delta: saidas.length - antesB });
    check("C1.11 reabertura servida do CACHE com ZERO HTTP externo", v1b?.via === "cache" && saidas.length - antesB === 0, `via=${v1b?.via} delta=${saidas.length - antesB}`);
    check("C1.12 reabertura preserva coletadoEm original (procedência honesta)", v1b?.coletadoEm === v1.coletadoEm);
    check("C1.13 reabertura sem duplicar participantes", v1b?.totalParticipantes === 3);
    // mapa: estrela raiz→participantes é decoração → intencionalmente ausente
    const g1 = grafar("A (3 PF, nada expandido)", v1, {});
    check("C1.14 mapa INTENCIONALMENTE ausente: só arestas participacao → grafoTemValor=false (contrato do experimento controlado)", g1.arestas.length === 3 && g1.arestas.every((a) => a.tipo === "participacao") && grafoTemValor(g1) === false);
    obs(`via=${v1.via}, 3 PF, baseDados=${v1.baseDados}; reabertura via=cache com 0 saídas HTTP; grafoTemValor=false (mapa ausente por design).`);
  }
}

/* ------------- CASOS 2/3/4 — classificação PF / PJ / INDETERMINADO ------------- */
let avisosB1: string[] = [];
caso(2, "Participante PF → PESSOA_FÍSICA (pelo identificador, nunca pelo nome)");
{
  const r2 = await postRelacoes(loteB, 1);
  const v2 = r2.view;
  check("C2.1 quadro de B retornado", r2.status === 200 && !!v2);
  if (v2) {
    todosParticipantes.push(...v2.participantes);
    avisosB1 = v2.avisos.slice();
    const pf = v2.participantes.find((p) => p.participanteId === HB1);
    check("C2.2 participante com nome e SEM CNPJ → PF pelo hash opaco da fonte (32 hex)", pf?.tipo === "PF" && /^[a-f0-9]{32}$/.test(pf?.participanteId ?? "") && pf?.cnpjParticipante === null);
    check("C2.3 classificador puro: hash com NOME EMPRESARIAL continua PF (id prova; nome nunca decide)", classificarParticipantePorId(HASH_EMPRESARIAL, validateCnpj) === "PF");
    obs(`PF "CARLOS NUNES" classificado pelo hash; sem CPF na resposta.`);
  }
}

caso(3, "Participante PJ (CNPJ com DV) → PESSOA_JURIDICA");
{
  const r3 = await postRelacoes(loteB, 1); // cache agora — mesma view
  const v3 = r3.view;
  check("C3.1 releitura de B ainda traz o quadro (via cache)", r3.status === 200 && v3?.via === "cache");
  const pj = v3?.participantes.find((p) => p.participanteId === CNPJ_PJ_B);
  check("C3.2 participante com CNPJ 14 + DV válido → PJ com cnpjParticipante preenchido", pj?.tipo === "PJ" && pj?.cnpjParticipante === CNPJ_PJ_B);
  check("C3.3 razão social PJ presente (razaoSocialPj)", pj?.razaoSocialPj === "EMPRESA BETA PARTICIPACOES LTDA");
  check("C3.4 classificador puro: CNPJ válido com NOME DE PESSOA continuaria PJ (id prova)", classificarParticipantePorId(CNPJ_PJ_B, validateCnpj) === "PJ");
  const re = await postExpansao(loteB, 1, CNPJ_PJ_B);
  const q = re.view;
  check("C3.5 expansão do quadro do PJ funciona (1 hop, sob comando)", re.status === 200 && q?.tipoParticipante === "PJ" && q?.totalEmpresas === 2);
  check("C3.6 contagem por PESSOA JURÍDICA (raízes distintas) = 2", q?.totalPessoasJuridicas === 2);
  check("C3.7 leitura comercial distingue participação de PJ", (q?.leitura ?? "").includes("pessoa jurídica"));
  obs(`PJ "EMPRESA BETA PARTICIPACOES LTDA" com cnpjParticipante; quadro expandido com 2 empresas/2 PJs.`);
}

caso(4, "Participante indeterminado → INDETERMINADO honesto, nunca adivinhado");
{
  const r4 = await postRelacoes(loteB, 1);
  const v4 = r4.view;
  const ind = v4?.participantes.find((p) => p.participanteId === "35444812");
  check("C4.1 id de 8 dígitos com nome empresarial ('BRD DIGITAL PARTICIPACOES LTDA') → INDETERMINADO (nunca PF — lição v0.10.16)", ind?.tipo === "INDETERMINADO", `tipo=${ind?.tipo}`);
  check("C4.2 vínculo registrado mantido (participante não descartado; quadro tem 4)", v4?.totalParticipantes === 4);
  // os avisos de normalização são FATOS da 1ª coleta (avisosB1); na releitura de cache
  // eles somem — essa perda é o bug G8-1, provado à parte em EXTRAS (X1.1)
  check("C4.3 aviso honesto de tipo não confirmado na resposta da coleta", avisosB1.some((a) => a.includes("não permitiu confirmar")), `avisos 1ª coleta=${JSON.stringify(avisosB1)}`);
  const antes = saidas.length;
  const re = await postExpansao(loteB, 1, "35444812");
  check("C4.4 expansão de INDETERMINADO recusada: 422 PARTICIPANTE_INVALIDO com ZERO HTTP (recusa antes da fonte)", re.status === 422 && re.corpo.error?.code === "PARTICIPANTE_INVALIDO" && saidas.length - antes === 0, `status=${re.status} delta=${saidas.length - antes}`);
  const dvInvalido = CNPJ_B.slice(0, 13) + (CNPJ_B[13] === "0" ? "1" : "0");
  check("C4.5 classificador puro: CNPJ 14 com DV INVÁLIDO → INDETERMINADO (nunca PJ)", classificarParticipantePorId(dvInvalido, validateCnpj) === "INDETERMINADO");
  check("C4.6 linha sem identificador descartada com aviso na coleta (nada inventado)", avisosB1.some((a) => a.includes("sem identificador próprio") && a.includes("descartada")));
  obs(`BRD (id 35444812) = INDETERMINADO em consulta e em cache; expansão 422 sem HTTP; avisos da coleta: ${JSON.stringify(avisosB1).slice(0, 200)}. Nota: na RELEITURA de cache esses avisos somem (bug G8-1, provado em X1.1).`);
}

/* ---------------- CASO 5 — sócios múltiplos, ordem estável ---------------- */
caso(5, "Empresa com 12 participantes — todos presentes, ordem estável");
{
  const r5 = await postRelacoes(loteC, 1);
  const v5 = r5.view;
  check("C5.1 12 participantes TODOS presentes (resposta sem corte)", v5?.totalParticipantes === 12 && v5?.participantes.length === 12, `total=${v5?.totalParticipantes}`);
  check("C5.2 composição 8 PF + 4 PJ sem confluência", v5?.participantes.filter((p) => p.tipo === "PF").length === 8 && v5?.participantes.filter((p) => p.tipo === "PJ").length === 4);
  const seq1 = v5?.participantes.map((p) => p.participanteId) ?? [];
  check("C5.3 ordem = primeira aparição na fonte (determinística)", JSON.stringify(seq1) === JSON.stringify([...HC, ...CNPJ_PJ_C]));
  if (v5) todosParticipantes.push(...v5.participantes);
  const antes = saidas.length;
  const r5b = await postRelacoes(loteC, 1);
  const v5b = r5b.view;
  leiturasZeroHttp.push({ nome: "POST /relacoes-societarias releitura 12 participantes (cache)", delta: saidas.length - antes });
  const seq2 = v5b?.participantes.map((p) => p.participanteId) ?? [];
  check("C5.4 ordem ESTÁVEL na releitura de cache (sequência idêntica, zero HTTP)", v5b?.via === "cache" && saidas.length - antes === 0 && JSON.stringify(seq2) === JSON.stringify(seq1));
  check("C5.5 sem duplicação entre leituras", v5b?.totalParticipantes === 12);
  const g5 = v5 ? grafar("C (12 participantes)", v5, {}) : null;
  check("C5.6 mapa limita o DESENHO a 8 participantes (teto de exibição) mantendo o total real na leitura", g5 !== null && g5.nos.filter((n) => n.nivel === 1).length === GRAFO_TETO_PARTICIPANTES && g5.resumo.includes("12 participantes"));
  obs(`12/12 presentes (8 PF + 4 PJ); sequência estável consulta→cache; desenho limitado a ${GRAFO_TETO_PARTICIPANTES} nós.`);
}

/* -------- CASO 6 — participante comum em duas empresas (sem grupo) -------- */
caso(6, "Mesmo participante PF em duas empresas — visível em ambas, SEM grupo econômico");
{
  const rD = await postRelacoes(loteDE, 1);
  const rE = await postRelacoes(loteDE, 2);
  const vD = rD.view, vE = rE.view;
  check("C6.1 quadros de D e E consultados (raízes distintas, mesmo lote)", rD.status === 200 && rE.status === 200 && !!vD && !!vE);
  const hpE = vE?.participantes.find((p) => p.participanteId === HP);
  check("C6.2 participante comum visível na ficha de E já na 1ª leitura (comumCom → D)", hpE?.comumCom.length === 1 && hpE?.comumCom[0].cnpj === CNPJ_D, `comumCom=${JSON.stringify(hpE?.comumCom)}`);
  check("C6.3 nota nega grupo econômico explicitamente", (hpE?.comumCom[0].nota ?? "").includes("NÃO caracteriza grupo econômico"));
  const rD2 = await postRelacoes(loteDE, 1);
  const vD2 = rD2.view;
  const hpD = vD2?.participantes.find((p) => p.participanteId === HP);
  check("C6.4 visível TAMBÉM na ficha de D (comumCom → E)", vD2?.via === "cache" && hpD?.comumCom.length === 1 && hpD?.comumCom[0].cnpj === CNPJ_E);
  check("C6.5 existeParticipanteComum = true em ambas as fichas", vE?.existeParticipanteComum === true && vD2?.existeParticipanteComum === true);
  const jsonD = JSON.stringify(vD2 ?? {}), jsonE = JSON.stringify(vE ?? {});
  const gruposD = jsonD.match(/"[^"]*grupo[^"]*"/gi) ?? [];
  const gruposE = jsonE.match(/"[^"]*grupo[^"]*"/gi) ?? [];
  check("C6.6 'grupo' só existe para NEGAR (nenhuma afirmação de grupo em nenhuma das duas respostas)", [...gruposD, ...gruposE].every((m) => m.includes("NÃO caracteriza grupo econômico")), `ocorrências=${JSON.stringify([...gruposD, ...gruposE])}`);
  const comunsHom = detectarParticipantesComuns(
    [
      { participanteId: HOM1, tipo: "PF" as const, nomePublico: "JOAO SILVA", cnpjParticipante: null },
      { participanteId: HOM2, tipo: "PF" as const, nomePublico: "JOAO SILVA", cnpjParticipante: null },
    ],
    [{ participanteId: HOM1, tipo: "PF" as const, nomePublico: "JOAO SILVA", cnpjParticipante: null }]
  );
  check("C6.7 homônimos: identidade é o ID, nunca o nome (apenas 1 dos 2 é comum)", comunsHom.length === 1 && comunsHom[0].participanteId === HOM1);
  if (vD2) {
    const g6 = grafar("D (participante comum com E)", vD2, {});
    const comp = g6.arestas.filter((a) => a.tipo === "compartilhado");
    check("C6.8 grafo: aresta compartilhado liga PARTICIPANTE→empresa (fato dos dois quadros públicos)", comp.length === 1 && comp[0].de === `p:${HP}` && comp[0].para === `c:${CNPJ_E.slice(0, 8)}`, `arestas=${JSON.stringify(comp)}`);
    check("C6.9 grafo: NENHUMA aresta de grupo empresa↔empresa (nenhuma compartilhado com origem na raiz)", !g6.arestas.some((a) => a.de === "raiz" && a.tipo === "compartilhado"));
    check("C6.10 rótulo da aresta compartilhado nega grupo na própria aresta", comp[0]?.rotulo.includes("NÃO caracteriza grupo econômico") === true);
    todosParticipantes.push(...vD2.participantes);
  }
  if (vE) todosParticipantes.push(...vE.participantes);
  obs(`MARIA SOUZA (hash) presente nos quadros de D e E; comumCom recíproco; única menção a "grupo" é a negação.`);
}

/* ---------------- CASO 7 — matriz e filiais da mesma raiz ---------------- */
caso(7, "Estabelecimentos da mesma raiz (matriz + filiais)");
{
  // relações das duas linhas da MESMA raiz → sobreposição vai para comumMesmaPj
  const rF1 = await postRelacoes(loteF, 1);
  const rF2 = await postRelacoes(loteF, 2);
  const rF1b = await postRelacoes(loteF, 1);
  const vF1b = rF1b.view;
  const hf1 = vF1b?.participantes.find((p) => p.participanteId === HF1);
  check("C7.1 participante no quadro de OUTRO estabelecimento da MESMA raiz → comumMesmaPj (não relação entre empresas)", hf1?.comumMesmaPj.length === 1 && hf1?.comumMesmaPj[0].cnpj === CNPJ_F2 && (hf1?.comumMesmaPj[0].nota ?? "").toUpperCase().includes("MESMA RAIZ"), `comumMesmaPj=${JSON.stringify(hf1?.comumMesmaPj)}`);
  check("C7.2 sobreposição na mesma raiz NÃO conta como participante comum entre empresas distintas", vF1b?.existeParticipanteComum === false);
  check("C7.3 aviso classifica a sobreposição como mesma pessoa jurídica", (vF1b?.avisos ?? []).some((a) => a.includes("mesma pessoa jurídica")));
  if (vF1b) todosParticipantes.push(...vF1b.participantes);

  const antes = saidas.length;
  const r7 = await postMatrizFiliais(loteF, 1);
  const v7 = r7.view;
  check("C7.4 HTTP 200 com ok e view de matriz/filiais", r7.status === 200 && r7.corpo.ok === true && !!v7, `status=${r7.status}`);
  if (v7) {
    todosEstabelecimentos.push(...(v7.matriz ? [v7.matriz] : []), ...v7.filiais, ...v7.localizadosNaoConfirmados);
    check("C7.5 matriz identificada pelo CAMPO OFICIAL (identificador 1) — nunca pela ordem 0001", v7.matriz?.cnpj === CNPJ_F1 && v7.matriz?.identificadorMatrizFilial === 1);
    check("C7.6 2 filiais confirmadas pelo campo OFICIAL 2", v7.filiais.length === 2 && v7.filiais.every((f) => f.identificadorMatrizFilial === 2 && f.confirmado), `filiais=${JSON.stringify(v7.filiais.map((f) => f.cnpj))}`);
    check("C7.7 todas as unidades amarradas à MESMA raiz (76000006)", [v7.matriz, ...v7.filiais].every((e) => !!e && e.cnpj.startsWith("76000006")));
    check("C7.8 cobertura sempre rotulada PARCIAL (fonte de descoberta parcial)", v7.cobertura.parcial === true);
    check("C7.9 1ª rodada via consulta, tetos documentados (10 participantes / 20 confirmações)", v7.via === "consulta" && v7.cobertura.tetoParticipantes === 10 && v7.cobertura.tetoConfirmacoes === 20);
    const root = await db.estabelecimentoRootCache.findUnique({ where: { cnpjRaiz: "76000006" } });
    check("C7.10 EstabelecimentoRootCache persistido POR RAIZ (3 estabelecimentos)", root !== null && JSON.parse(root.estabelecimentosJson).length === 3);
    check("C7.11 nenhuma unidade pendente de confirmação nesta rodada", v7.localizadosNaoConfirmados.length === 0 && v7.cobertura.pendentesConfirmacao === 0);
    const confirmadas = v7.filiais.filter((f) => f.fonteConfirmacao?.startsWith("cadastro"));
    check("C7.12 confirmações individuais com fonte de cadastro declarada", confirmadas.length === 2);
    // grafo: filiais NUNCA viram nós/ligações entre si — amarram à raiz
    const q7 = await getQuadros(loteF, 1);
    if (vF1b) {
      const g7 = grafar("F (matriz+filiais, quadros expandidos)", vF1b, q7.quadros);
      const mesma = g7.arestas.filter((a) => a.tipo === "mesma-empresa");
      check("C7.13 grafo: estabelecimento da mesma raiz vira aresta mesma-empresa PARA A RAIZ (sem nó duplicado da própria empresa)", mesma.length >= 1 && mesma.every((a) => a.para === "raiz"), `arestas mesma-empresa=${JSON.stringify(mesma)}`);
      check("C7.14 grafo: NENHUM nó de filial da raiz 76000006 (filiais não viram empresas separadas nem ligam entre si)", !g7.nos.some((n) => n.id.includes("76000006")));
      check("C7.15 grafo: nenhuma aresta compartilhado no quadro da mesma PJ (sem ligação filial↔filial)", !g7.arestas.some((a) => a.tipo === "compartilhado"));
    }
    const antesB = saidas.length;
    const r7b = await postMatrizFiliais(loteF, 1);
    const v7b = r7b.view;
    leiturasZeroHttp.push({ nome: "POST /matriz-filiais 2ª rodada (cache da raiz)", delta: saidas.length - antesB });
    check("C7.16 2ª rodada via CACHE da raiz com ZERO HTTP externo", v7b?.via === "cache" && saidas.length - antesB === 0, `via=${v7b?.via} delta=${saidas.length - antesB}`);
    check("C7.17 reuso não duplica unidades (mesma matriz, mesmas 2 filiais)", v7b?.matriz?.cnpj === CNPJ_F1 && v7b?.filiais.length === 2 && v7b?.localizadosNaoConfirmados.length === 0);
    obs(`1ª rodada: ${saidas.length - antes} saídas (2 quadros de participantes + 2 confirmações de cadastro); matriz=0001 pelo campo oficial; 2ª rodada via=cache com 0 saídas.`);
  }
}

/* ---------------- CASO 8 — relações inexistentes ---------------- */
caso(8, "Empresa sem relações — ausência honesta e mapa INTENCIONALMENTE ausente");
{
  const r8 = await postRelacoes(loteG, 1);
  const v8 = r8.view;
  check("C8.1 ausência é HTTP 200 com ok (NÃO é falha de consulta)", r8.status === 200 && r8.corpo.ok === true && v8?.ok === true, `status=${r8.status}`);
  check("C8.2 lista vazia com aviso de ausência REGISTRADA", v8?.totalParticipantes === 0 && v8?.participantes.length === 0 && (v8?.avisos ?? []).some((a) => a.includes("Nenhuma relação societária pública registrada") && a.includes("não é falha")));
  const q8 = await getQuadros(loteG, 1);
  check("C8.3 GET /quadros vazio (nada expandido, nada inventado)", q8.status === 200 && q8.corpo.ok === true && Object.keys(q8.quadros).length === 0 && q8.deltaHttp === 0);
  if (v8) {
    const g8 = grafar("G (sem relações)", v8, q8.quadros);
    check("C8.4 sinal de 'nada útil' que a UI usa para a AUSÊNCIA do mapa: 0 nós/0 arestas → grafoTemValor=false → GrafoRelacoesCard retorna null (sem card vazio)", g8.nos.length === 0 && g8.arestas.length === 0 && grafoTemValor(g8) === false);
  }
  // comportamento do cache de ausência (documentado como G8-2)
  const antes = saidas.length;
  const r8b = await postRelacoes(loteG, 1);
  const cacheG = await db.relacaoSocietariaCache.count({ where: { cnpj: CNPJ_G } });
  check("C8.5 ausência NÃO é persistida em cache: cada comando re-consulta (1 saída) e nenhuma linha de cache é criada (nada inventado)", r8b.view?.via === "consulta" && saidas.length - antes === 1 && cacheG === 0, `via=${r8b.view?.via} delta=${saidas.length - antes} cacheRows=${cacheG}`);
  bug(
    "G8-2",
    "BAIXO (comportamento documentado)",
    "Ausência (404) não é cacheada, mas a resposta anuncia validoAte de 30 dias",
    "POST /relacoes-societarias em empresa sem quadro público (fonte 404): a resposta devolve validoAte = coleta+30d como se houvesse validade registrada, porém NENHUMA linha é persistida em RelacaoSocietariaCache — o próximo comando consulta a fonte de novo (1 saída HTTP por clique em 'Atualizar'). Cada consulta é sob comando (contrato respeitado), mas o validoAte anunciado não tem persistência por trás.",
    `Caso 8: 2º POST via=consulta, delta HTTP=1, RelacaoSocietariaCache.count(cnpj=${CNPJ_G})=0.`
  );
  obs(`200 com lista vazia + aviso; quadros {} com 0 HTTP; grafoTemValor=false. Comportamento G8-2: ausência nunca cacheada (reconsulta por comando), validoAte anunciado sem persistência.`);
}

/* ---------------- CASO 9 — cache antigo / fora do TTL ---------------- */
caso(9, "Caches antigos — TTL, revalidação honesta e migração à leitura");
{
  const r9a = await postRelacoes(loteH, 1);
  const v9a = r9a.view;
  const antesB = saidas.length;
  const r9b = await postRelacoes(loteH, 1);
  const v9b = r9b.view;
  leiturasZeroHttp.push({ nome: "POST /relacoes-societarias H dentro do TTL (cache)", delta: saidas.length - antesB });
  check("C9.1 dentro do TTL: reuso com ZERO HTTP e coletadoEm ORIGINAL (procedência preservada)", v9b?.via === "cache" && saidas.length - antesB === 0 && v9b?.coletadoEm === v9a?.coletadoEm);
  // envelhece o cache de relações
  await db.relacaoSocietariaCache.update({ where: { cnpj: CNPJ_H }, data: { validoAte: new Date(Date.now() - 86400000) } });
  const antes = saidas.length;
  const r9c = await postRelacoes(loteH, 1);
  const v9c = r9c.view;
  check("C9.2 fora do TTL: REVALIDAÇÃO — via=consulta com 2 saídas (/{cnpj} + /updated); nunca reuso silencioso", v9c?.via === "consulta" && saidas.length - antes === 2, `via=${v9c?.via} saídas=${JSON.stringify(saidas.slice(antes))}`);
  check("C9.3 revalidação = NOVA coleta honesta (coletadoEm muda)", (v9c?.coletadoEm ?? "") > (v9a?.coletadoEm ?? ""));
  const cacheH = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: CNPJ_H } });
  check("C9.4 cache regravado com nova validade", cacheH !== null && cacheH.validoAte > new Date());
  check("C9.5 TTL documentado = 30 dias (RELACAO_TTL_DIAS)", RELACAO_TTL_DIAS === 30);
  // quadro vencido
  const rq1 = await postExpansao(loteH, 1, HH);
  check("C9.6 expansão de quadro funciona na 1ª consulta (via consulta)", rq1.status === 200 && rq1.view?.via === "consulta");
  await db.quadroParticipanteCache.update({ where: { participanteId: HH }, data: { validoAte: new Date(Date.now() - 86400000) } });
  const q9 = await getQuadros(loteH, 1);
  check("C9.7 quadro VENCIDO não volta no mapa (leitura pura filtra por validade) e o aviso aponta o comando de criar a ligação", q9.quadros[HH] === undefined && q9.avisos.some((a) => a.includes("ainda não foi expandida") && a.includes("Investigar conexão")), `quadros=${JSON.stringify(Object.keys(q9.quadros))} avisos=${JSON.stringify(q9.avisos)}`);
  const antesQ = saidas.length;
  const rq2 = await postExpansao(loteH, 1, HH);
  check("C9.8 expansão de quadro vencido REVALIDA (via=consulta, HTTP contado)", rq2.view?.via === "consulta" && saidas.length - antesQ >= 1);
  // cache PRÉ-v0.10.16 com classificação errada
  const antesI = saidas.length;
  const r9i = await postRelacoes(loteI, 1);
  const v9i = r9i.view;
  leiturasZeroHttp.push({ nome: "POST /relacoes-societarias I (cache antigo reclassificado)", delta: saidas.length - antesI });
  const brd = v9i?.participantes.find((p) => p.participanteId === "35444812");
  check("C9.9 cache antigo servido com ZERO reconsulta (via=cache, 0 saídas)", v9i?.via === "cache" && saidas.length - antesI === 0, `via=${v9i?.via} delta=${saidas.length - antesI}`);
  check("C9.10 participante mal classificado (PF por eliminação, pré-v0.10.16) RECLASSIFICADO para INDETERMINADO à leitura", brd?.tipo === "INDETERMINADO", `tipo=${brd?.tipo}`);
  check("C9.11 participantes CORRETOS do cache antigo preservados (PF e PJ intactos)", v9i?.participantes.some((p) => p.participanteId === HBI_OK && p.tipo === "PF") === true && v9i?.participantes.some((p) => p.participanteId === CNPJ_PJ_B && p.tipo === "PJ") === true);
  const cacheI = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: CNPJ_I } });
  check("C9.12 reclassificação REGRAVADA no cache (migração à leitura v0.10.16, vínculo e data preservados)", (cacheI?.relacoesJson ?? "").includes('"INDETERMINADO"') && cacheI?.coletadoEm.getTime() === COLETA_ANTIGA.getTime());
  if (v9i) todosParticipantes.push(...v9i.participantes);
  obs(`TTL 30d: vencido→revalida (nova coleta); válido→reuso 0 HTTP com coletadoEm original; cache pré-v0.10.16 reclassificado à leitura e regravado sem reconsulta.`);
}

/* ---------------- CASO 10 — avisos de unificação preservados ---------------- */
caso(10, "Avisos de unificação do quadro preservados nas releituras");
{
  const r10a = await postExpansao(loteA, 1, HA1);
  const q10a = r10a.view;
  check("C10.1 1ª consulta: aviso de unificação por CNPJ igual (registro repetido na fonte)", (q10a?.avisos ?? []).some((a) => a.includes("unificado por estabelecimento")), `avisos=${JSON.stringify(q10a?.avisos)}`);
  check("C10.2 1ª consulta: quadro com 3 estabelecimentos distintos (dedup) e nada oculto", q10a?.totalEmpresas === 3 && q10a?.empresas.length === 3 && q10a?.empresasOcultas === 0);
  const antes = saidas.length;
  const r10b = await postExpansao(loteA, 1, HA1);
  const q10b = r10b.view;
  leiturasZeroHttp.push({ nome: "POST /expansao releitura de cache (quadro válido)", delta: saidas.length - antes });
  check("C10.3 releitura de cache PRESERVA o aviso de unificação (correção v0.10.24) com ZERO HTTP", q10b?.via === "cache" && saidas.length - antes === 0 && (q10b?.avisos ?? []).some((a) => a.includes("unificado por estabelecimento")), `via=${q10b?.via} avisos=${JSON.stringify(q10b?.avisos)}`);
  const q10c = await getQuadros(loteA, 1);
  const quadroHA1 = q10c.quadros[HA1];
  check("C10.4 GET /quadros (que hidrata o mapa) também preserva o aviso de unificação", (quadroHA1?.avisos ?? []).some((a) => a.includes("unificado por estabelecimento")));
  // linhas antigas sem avisosJson: fallback determinístico
  await db.quadroParticipanteCache.create({
    data: {
      participanteId: HA2,
      tipoParticipante: "PF",
      rotulo: null,
      fonte: "MinhaReceita Grafo",
      baseDados: null,
      coletadoEm: new Date(Date.now() - 40 * 86400000),
      validoAte: new Date(Date.now() + 20 * 86400000),
      empresasJson: JSON.stringify([
        { cnpj: CNPJ_U1, razaoSocial: "UNO TRANSPORTES LTDA" },
        { cnpj: CNPJ_U2, razaoSocial: "DUO SERVICOS LTDA" },
      ]),
      totalEmpresas: 550,
      truncado: true,
      avisosJson: null,
    },
  });
  await db.quadroParticipanteCache.create({
    data: {
      participanteId: HA3,
      tipoParticipante: "PF",
      rotulo: null,
      fonte: "MinhaReceita Grafo",
      baseDados: null,
      coletadoEm: new Date(Date.now() - 40 * 86400000),
      validoAte: new Date(Date.now() + 20 * 86400000),
      empresasJson: JSON.stringify([{ cnpj: CNPJ_U1, razaoSocial: "UNO TRANSPORTES LTDA" }]),
      totalEmpresas: 1,
      truncado: false,
      avisosJson: null,
    },
  });
  const q10d = await getQuadros(loteA, 1);
  check("C10.5 linha antiga TRUNCADA sem avisosJson: aviso de TETO rederivado (fallback determinístico)", (q10d.quadros[HA2]?.avisos ?? []).some((a) => a.includes("armazenamento limitado ao teto de 500")), `avisos=${JSON.stringify(q10d.quadros[HA2]?.avisos)}`);
  check("C10.6 linha antiga SEM truncamento: NENHUM aviso inventado (unificação não é rederivável)", (q10d.quadros[HA3]?.avisos ?? []).length === 0, `avisos=${JSON.stringify(q10d.quadros[HA3]?.avisos)}`);
  obs(`Unificação sobrevive em: 1ª consulta, releitura de cache da expansão e GET /quadros; fallback de teto rederivado para linha antiga truncada; sem truncamento → sem aviso.`);
}

/* ================= TRANSVERSAL T1..T4 ================= */
abrirSecao("TRANSVERSAL", "Asserções transversais (todos os casos)", "");
{
  check("T1.1 ZERO HTTP externo em TODA abertura/leitura — nenhuma saída em nenhuma leitura de cache", leiturasZeroHttp.length >= 8 && leiturasZeroHttp.every((l) => l.delta === 0), `leituras=${JSON.stringify(leiturasZeroHttp)}`);
  check("T1.2 toda saída externa do teste foi atendida pelo simulador (nenhuma URL externa real — bloqueio por construção)", saidas.every((u) => u.startsWith("https://grafo.minhareceita.org/") || u.includes("brasilapi.com.br") || u.includes("api.opencnpj.org") || u.includes("receitaws.com.br") || u.includes("minhareceita.org") || u.includes("servicodados.ibge.gov.br")), `total saídas=${saidas.length}`);
  const CHAVES_PARTICIPANTE = new Set(["participanteId", "tipo", "nomePublico", "cnpjParticipante", "razaoSocialPj", "qualificacao", "comumCom", "comumMesmaPj"]);
  const chavesExtras = new Set<string>();
  for (const p of todosParticipantes) for (const k of Object.keys(p)) if (!CHAVES_PARTICIPANTE.has(k)) chavesExtras.add(k);
  check("T2.1 sócios NUNCA viram decisores/contatos: participantes expõem apenas campos de VÍNCULO (nenhum e-mail/telefone/cargo/decisor)", todosParticipantes.length >= 25 && chavesExtras.size === 0, `chaves extras=${JSON.stringify([...chavesExtras])} participantes=${todosParticipantes.length}`);
  const CHAVES_ESTAB = new Set(["cnpj", "razaoSocial", "municipio", "uf", "situacao", "cnae", "identificadorMatrizFilial", "confirmado", "descobertoPor", "confirmadoEm", "fonteConfirmacao"]);
  const chavesEstabExtras = new Set<string>();
  for (const e of todosEstabelecimentos) for (const k of Object.keys(e)) if (!CHAVES_ESTAB.has(k)) chavesEstabExtras.add(k);
  check("T2.2 estabelecimentos expõem apenas campos cadastrais/procedência (sem contatos, sem CPF)", todosEstabelecimentos.length === 3 && chavesEstabExtras.size === 0, `extras=${JSON.stringify([...chavesEstabExtras])}`);
  const cpfVazou = corpos.some((c) => /"cpf"/i.test(c) || /\*\*\d{4,}/.test(c));
  check("T2.3 nenhum CPF (nem mascarado) em NENHUM corpo de resposta (relações, quadros, expansão, matriz-filiais)", !cpfVazou, corpos.find((c) => /"cpf"/i.test(c) || /\*\*\d{4,}/.test(c))?.slice(0, 160));
  const qualForaDoCadastro = todosParticipantes.filter((p) => p.qualificacao !== null && p.qualificacao.origem !== "cadastro");
  check("T2.4 qualificação só existe por REUSO do cadastro (origem='cadastro') — nunca inventada", qualForaDoCadastro.length === 0);
  const dvInvalido = CNPJ_B.slice(0, 13) + (CNPJ_B[13] === "0" ? "1" : "0");
  check("T3.1 classificador: hash 32-hex → PF", classificarParticipantePorId(hash("63"), validateCnpj) === "PF");
  check("T3.2 classificador: CNPJ com DV válido → PJ", classificarParticipantePorId(CNPJ_U1, validateCnpj) === "PJ");
  check("T3.3 classificador: CNPJ 14 com DV inválido → INDETERMINADO (nunca PJ por formato)", classificarParticipantePorId(dvInvalido, validateCnpj) === "INDETERMINADO");
  check("T3.4 classificador: id de 8 dígitos com nome empresarial → INDETERMINADO (nunca PF por eliminação — lição v0.10.16)", classificarParticipantePorId("35444812", validateCnpj) === "INDETERMINADO");
  check("T3.5 classificador: hash com nome EMPRESARIAL → PF (o NOME nunca decide; o identificador prova)", classificarParticipantePorId(HASH_EMPRESARIAL, validateCnpj) === "PF");
  let arestasGrupo = 0;
  let grupoSemNegacao = 0;
  for (const g of grafosConstruidos) {
    for (const a of g.arestas) {
      if (/grupo/i.test(a.rotulo)) {
        arestasGrupo += 1;
        if (!a.rotulo.includes("NÃO caracteriza grupo econômico")) grupoSemNegacao += 1;
      }
    }
  }
  check("T4.1 nenhuma aresta de GRUPO automática: 'grupo' em rótulos de aresta só existe na negação explícita", grupoSemNegacao === 0, `arestas com 'grupo'=${arestasGrupo}, sem negação=${grupoSemNegacao}`);
  const arestaGrupoDaRaiz = grafosConstruidos.some((g) => g.arestas.some((a) => a.de === "raiz" && a.tipo === "compartilhado"));
  check("T4.2 nenhuma aresta compartilhado com origem na RAIZ (grupo empresa↔empresa nunca é desenhado)", !arestaGrupoDaRaiz);
  const tiposAresta = new Set(grafosConstruidos.flatMap((g) => g.arestas.map((a) => a.tipo)));
  check("T4.3 arestas refletem apenas fatos sustentados (participacao/quadro/mesma-empresa/compartilhado)", [...tiposAresta].every((t) => ["participacao", "quadro", "mesma-empresa", "compartilhado"].includes(t)), `tipos=${JSON.stringify([...tiposAresta])}`);
}

/* ============ EXTRAS — provas adjacentes (bugs documentados) ============ */
abrirSecao("EXTRAS", "Provas adjacentes de procedência (bugs documentados)", "Avisos de coleta e contagens de exibição sobrevivem às releituras de cache (mesmo princípio da correção v0.10.24).");
{
  // X1 — avisos de NORMALIZAÇÃO de relações (linhas descartadas/sem nome/indeterminados) na releitura de cache
  const antes = saidas.length;
  const rB = await postRelacoes(loteB, 1);
  const avisos2 = rB.view?.avisos ?? [];
  const preservados = avisosB1.filter((a) => avisos2.includes(a));
  check("X1.1 avisos de normalização de RELAÇÕES (linha sem id descartada, participante sem nome, indeterminado) sobrevivem à releitura de cache", rB.view?.via === "cache" && preservados.length === avisosB1.length && avisosB1.length >= 3, `1ª leitura=${JSON.stringify(avisosB1)} · releitura=${JSON.stringify(avisos2)}`);
  if (preservados.length < avisosB1.length) {
    bug(
      "G8-1",
      "MÉDIO",
      "Avisos de normalização de RELAÇÕES se perdem na releitura de cache (a correção v0.10.24 cobriu apenas o quadro)",
      "1) Empresa cuja resposta da fonte contém linha sem id, participante sem nome e identificador não classificável (lote B). 2) POST /api/imports/{lote}/rows/1/relacoes-societarias → resposta via=consulta com 3 avisos de normalização. 3) POST de novo (cache válido, via=cache) → avisos=[] — os avisos somem. Causa: investigarRelacoes persiste em RelacaoSocietariaCache.relacoesJson apenas os participantes (service.ts:~323-339); o caminho de cache devolve apenas os avisos de enriquecerParticipantes (service.ts:~241-273). RelacaoSocietariaCache não tem coluna avisosJson (a correção v0.10.24 adicionou persistência de avisos só em QuadroParticipanteCache). Viola o princípio declarado na v0.10.24: 'os avisos da normalização são FATOS da coleta — a leitura de cache NÃO pode devolvê-los vazios'.",
      `Extra X1: 1ª leitura avisos=${JSON.stringify(avisosB1)}; releitura via=cache avisos=${JSON.stringify(avisos2)}.`
    );
  }
  // X2 — contagem de ocultas na releitura de cache da expansão (quadro com 60 empresas)
  const rJ = await postRelacoes(loteJ, 1);
  const rJe1 = await postExpansao(loteJ, 1, HJ);
  const qe1 = rJe1.view;
  const antesJ = saidas.length;
  const rJe2 = await postExpansao(loteJ, 1, HJ);
  const qe2 = rJe2.view;
  leiturasZeroHttp.push({ nome: "POST /expansao J releitura (quadro de 60)", delta: saidas.length - antesJ });
  const qJ = await getQuadros(loteJ, 1);
  const ocultasQuadros = qJ.quadros[HJ]?.empresasOcultas;
  check("X2.1 quadro de 60 empresas: 1ª consulta exibe 50 e contabiliza 10 ocultas (teto de exibição honesto)", qe1?.empresas.length === 50 && qe1?.empresasOcultas === 10, `empresas=${qe1?.empresas.length} ocultas=${qe1?.empresasOcultas}`);
  check("X2.2 releitura de cache da MESMA expansão contabiliza as ocultas corretamente", qe2?.empresas.length === 50 && qe2?.empresasOcultas === 10, `via=${qe2?.via} empresas=${qe2?.empresas.length} ocultas=${qe2?.empresasOcultas} (GET /quadros diz ${ocultasQuadros})`);
  if (qe2 && qe2.empresasOcultas !== 10) {
    bug(
      "G8-3",
      "MÉDIO",
      "empresasOcultas errado na releitura de cache da expansão (usa a lista CHEIA em vez da fatia exibida)",
      "1) Quadro de participante com 60 estabelecimentos (lote J). 2) POST /expansao (1ª, via=consulta): empresas=50 (teto de exibição), empresasOcultas=10 (correto). 3) POST /expansao de novo (via=cache): empresas=50 mas empresasOcultas=0 — o caminho de cache de investigarConexao (service.ts:~580-581) calcula Math.max(0, cache.totalEmpresas - empresas.length) com a lista CHEIA (60) em vez da fatia exibida (50); a rota GET /quadros (quadrosEmCacheDaLinha, service.ts:~518) calcula com a fatia e devolve 10 — duas leituras da MESMA linha de cache divergem. O operador vê '+N estabelecimentos existem no quadro' com N menor que o real ao reabrir a expansão.",
      `Extra X2: consulta ocultas=10; releitura de cache ocultas=${qe2.empresasOcultas}; GET /quadros ocultas=${ocultasQuadros}.`
    );
  }
  obs(`Provas adjacentes concluídas (lote B reaberto; quadro de 60 da J reexpandido).`);
}

/* ================= relatório ================= */
function vereditoSecao(s: Secao | undefined): boolean {
  return !!s && s.checks.length > 0 && s.checks.every((c) => c.pass);
}
const casosNum = secoes.filter((s) => /^CASO \d+$/.test(s.chave));
const casosPass = casosNum.filter((s) => vereditoSecao(s)).length;
const crossSecao = secoes.find((s) => s.chave === "TRANSVERSAL");
const extrasSecao = secoes.find((s) => s.chave === "EXTRAS");
const gatePass = casosPass === casosNum.length && vereditoSecao(crossSecao) && vereditoSecao(extrasSecao);

const agora = new Date();
const linhaTab = (a: string, b: string, c: string, d: string) => {
  const limpo = (t: string) => String(t).replace(/\s+/g, " ").trim();
  return `| ${limpo(a)} | ${limpo(b)} | ${limpo(c)} | ${limpo(d)} |`;
};

const linhasTxt: string[] = [];
linhasTxt.push("=".repeat(150));
linhasTxt.push("GATE 8 — RELAÇÕES EMPRESARIAIS E GRAFO (HOMOLOG-D1) — Scout 360 v0.11.0");
linhasTxt.push(`Executado em: ${agora.toISOString()}`);
linhasTxt.push("Script: bun scripts/test-homolog-relacoes-grafo.ts  (autocontido, repetível, exit 0/1)");
linhasTxt.push("Banco: /tmp/homolog-gate8-relacoes.db (ISOLADO — padrão test-v01024; db/custom.db do dev server :3000 intocado; resolve-service :3030 nunca contatado)");
linhasTxt.push("Fontes: SIMULADAS — globalThis.fetch interceptado: toda saída externa é contada; URL não cadastrada é BLOQUEADA (prova por construção de ZERO HTTP real). Zero IA.");
linhasTxt.push("Método: handlers de rota chamados diretamente (POST /relacoes-societarias, GET /quadros, POST /expansao, POST /matriz-filiais) + funções puras do grafo (construirGrafoRelacoes/grafoTemValor — as mesmas que a UI usa).");
linhasTxt.push("=".repeat(150));
linhasTxt.push("");
linhasTxt.push("MATRIZ DOS 10 CASOS — esperado (CONTRATO, definido antes da observação) × observado");
linhasTxt.push("-".repeat(150));
linhasTxt.push(linhaTab("CASO", "ESPERADO", "OBSERVADO", "RESULT."));
linhasTxt.push("-".repeat(150));
for (const s of casosNum) {
  const ok = vereditoSecao(s);
  const observado = (s.observado.length > 0 ? s.observado.join(" ") : `${s.checks.filter((c) => c.pass).length}/${s.checks.length} verificações concluídas`) + ` [${s.checks.filter((c) => c.pass).length}/${s.checks.length} checks]`;
  linhasTxt.push(linhaTab(`${s.chave} — ${s.titulo}`, s.esperado, observado, ok ? "PASS" : "FAIL"));
}
linhasTxt.push("-".repeat(150));
linhasTxt.push("");
linhasTxt.push("ASSERTÕES TRANSVERSAIS");
linhasTxt.push("-".repeat(150));
if (crossSecao) {
  for (const [i, c] of crossSecao.checks.entries()) {
    linhasTxt.push(`${c.pass ? "PASS" : "FAIL"}  ${c.nome}${c.pass ? "" : ` — ${c.extra}`}`);
  }
  linhasTxt.push("");
  for (const [k, v] of Object.entries(ESPERADO_CROSS)) linhasTxt.push(`  (${k}) esperado: ${v}`);
}
linhasTxt.push("-".repeat(150));
linhasTxt.push("");
linhasTxt.push("PROVAS ADJACENTES (EXTRAS) E BUGS");
linhasTxt.push("-".repeat(150));
if (extrasSecao) {
  for (const c of extrasSecao.checks) linhasTxt.push(`${c.pass ? "PASS" : "FAIL"}  ${c.nome}${c.pass ? "" : ` — ${c.extra}`}`);
  linhasTxt.push("");
}
if (bugs.length === 0) {
  linhasTxt.push("Nenhum bug registrado.");
} else {
  for (const b of bugs) {
    linhasTxt.push(`${b.id} [${b.severidade}] ${b.titulo}`);
    linhasTxt.push(`  REPRODUÇÃO: ${b.reproducao}`);
    linhasTxt.push(`  EVIDÊNCIA: ${b.evidencia}`);
    linhasTxt.push("");
  }
}
linhasTxt.push("-".repeat(150));
linhasTxt.push("");
linhasTxt.push("DETALHE DAS VERIFICAÇÕES POR CASO");
linhasTxt.push("-".repeat(150));
for (const s of secoes) {
  linhasTxt.push(`${s.chave} — ${s.titulo}${s.esperado ? ` (esperado: ${s.esperado})` : ""}`);
  for (const c of s.checks) linhasTxt.push(`  ${c.pass ? "PASS" : "FAIL"}  ${c.nome}${c.pass ? "" : ` — ${c.extra}`}`);
  for (const o of s.observado) linhasTxt.push(`  OBS: ${o}`);
  linhasTxt.push("");
}
linhasTxt.push("-".repeat(150));
linhasTxt.push(`TOTAIS: ${passTotal} PASS / ${failTotal} FAIL — casos contratuais: ${casosPass}/${casosNum.length} — GATE 8: ${gatePass ? "PASS" : "REPROVADO (bugs documentados)"}`);
linhasTxt.push(`Saídas HTTP externas totais (todas simuladas): ${saidas.length} — leituras de cache com ZERO saída: ${leiturasZeroHttp.filter((l) => l.delta === 0).length}/${leiturasZeroHttp.length}`);
linhasTxt.push(`Re-execução: bun scripts/test-homolog-relacoes-grafo.ts`);

const json = {
  task: "HOMOLOG-D1 (Gate 8 — Relações empresariais e grafo)",
  produto: "Scout 360 v0.11.0",
  executadoEm: agora.toISOString(),
  script: "scripts/test-homolog-relacoes-grafo.ts",
  metodo: {
    banco: "/tmp/homolog-gate8-relacoes.db (isolado, padrão test-v01024)",
    fontes: "simuladas via interceptação de globalThis.fetch (zero HTTP real; toda saída contada)",
    rotas: ["POST /api/imports/[id]/rows/[n]/relacoes-societarias", "GET .../relacoes-societarias/quadros", "POST .../relacoes-societarias/expansao", "POST .../matriz-filiais"],
  },
  casos: casosNum.map((s) => ({
    caso: Number(s.chave.replace("CASO ", "")),
    titulo: s.titulo,
    esperado: s.esperado,
    observado: s.observado,
    checks: s.checks,
    resultado: vereditoSecao(s) ? "PASS" : "FAIL",
  })),
  transversal: crossSecao ? { esperado: ESPERADO_CROSS, checks: crossSecao.checks, resultado: vereditoSecao(crossSecao) ? "PASS" : "FAIL" } : null,
  extras: extrasSecao ? { checks: extrasSecao.checks, resultado: vereditoSecao(extrasSecao) ? "PASS" : "FAIL" } : null,
  bugs,
  totais: { pass: passTotal, fail: failTotal, casosPass: casosPass, casosTotal: casosNum.length, gate: gatePass ? "PASS" : "REPROVADO" },
  saidasHttpSimuladasTotal: saidas.length,
  leiturasZeroHttp: leiturasZeroHttp,
};

/* ================= desmontagem + gravação ================= */
try {
  await aguardarTelemetria();
} catch {
  /* telemetria pendente é tolerada em banco isolado */
}
try {
  await db.$disconnect();
} catch {
  /* isolado */
}
for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });

writeFileSync(join(EVID_DIR, "relatorio.txt"), linhasTxt.join("\n") + "\n", "utf8");
writeFileSync(join(EVID_DIR, "relatorio.json"), JSON.stringify(json, null, 2), "utf8");

console.log(`\n== GATE 8 (HOMOLOG-D1): ${passTotal} PASS / ${failTotal} FAIL — casos ${casosPass}/${casosNum.length} — gate ${gatePass ? "PASS" : "REPROVADO"} ==`);
if (bugs.length > 0) console.log(`Bugs documentados: ${bugs.map((b) => b.id).join(", ")}`);
console.log(`Evidências: ${join(EVID_DIR, "relatorio.txt")} e relatorio.json`);
if (failTotal > 0) {
  console.log("Falhas:", falhasNomes.join(" | "));
  process.exitCode = 1;
}
