/**
 * test-homolog-identidade-adversarial.ts — HOMOLOG-B3 (Gate 4):
 * MATRIZ ADVERSARIAL DE IDENTIDADE — 17 casos do contrato de homologação v0.11.0.
 *
 * O que é: suíte scriptada que ataca a camada de resolução de identidade do Scout 360
 * com as 17 situações adversárias do contrato (Gate 4). O resultado ESPERADO de cada
 * caso foi definido A PARTIR DO CONTRATO DE PRODUTO (regras documentadas em
 * src/lib/resolve/index.ts, binding.ts, confianca.ts, triage/engine.ts e
 * relations/grafo.ts) ANTES da observação do comportamento — a tabela ESPERADO abaixo
 * é uma constante literal deste arquivo, escrita antes de qualquer execução.
 *
 * Estados exigidos pelo contrato (nomes exatos no código):
 *   - resolutionState:  CONFIRMED | REVIEW | UNRESOLVED
 *   - identityStage:    LOCALIZADO | CORRESPONDENTE | VALIDADO
 *   - lookupStatus:     ENRIQUECIDO | NAO_ENCONTRADO | RATE_LIMITED | TIMEOUT |
 *                       ERRO_REDE | ERRO_SERVIDOR | IGNORADO | PENDENTE/EM_FILA/CONSULTANDO
 *   - triagem (lacuna identidade): RESOLVIDO | VALIDACAO_HUMANA | INDISPONIVEL |
 *                       NAO_APLICAVEL | COMPLEMENTAR_API
 *   Mapeamento do contrato → campos:
 *   IDENTIFICADA      = ENRIQUECIDO + CORRESPONDENTE/VALIDADO
 *   REVISAR           = REVIEW (resolutionState) ou LOCALIZADO (identityStage)
 *   NÃO IDENTIFICADA  = UNRESOLVED + NAO_ENCONTRADO
 *   FALHA DE CONSULTA = RATE_LIMITED/TIMEOUT/ERRO_REDE/ERRO_SERVIDOR
 *   PENDENTE          = PENDENTE/EM_FILA/CONSULTANDO
 *
 * Prova estrutural (zero rede externa, zero IA):
 *   - globalThis.fetch substituído por simulador que CONTA toda saída e RECUSA host
 *     externo não cadastrado (padrão test-v01012);
 *   - https.request interceptado (RDAP registro.br é o ÚNICO usuário de https nativo);
 *   - resolve-service :3030 NUNCA é contatado (as chamadas são interceptadas antes);
 *   - lote de grafos usa fetcher INJETÁVEL (padrão test-v01010);
 *   - banco ISOLADO em /tmp (padrão test-v01024: push do schema → DATABASE_URL ANTES
 *     dos imports dinâmicos). Dev server :3000 e resolve-service :3030 intocados.
 *
 * Uso: bun scripts/test-homolog-identidade-adversarial.ts
 * Saída: qa/homolog-v0110/gate4/matriz.txt + matriz.json
 */
import { execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import https from "https";

/* ================= 0) banco isolado (padrão test-v01024) ================= */
const DB_ISOLADO = "/tmp/homolog-gate4-identidade.db";
const DB_JOURNAL = "/tmp/homolog-gate4-identidade.db-journal";
for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
execSync(`DATABASE_URL="file:${DB_ISOLADO}" bunx prisma db push --skip-generate`, {
  cwd: process.cwd(),
  stdio: "pipe",
});
process.env.DATABASE_URL = `file:${DB_ISOLADO}`;
delete process.env.SCOUT_EXPORT_TOKEN;
delete process.env.SCOUT_AUTH_REQUIRED; // modo OPEN: handlers de rota chamados direto

const EVID_DIR = join(process.cwd(), "qa", "homolog-v0110", "gate4");
mkdirSync(EVID_DIR, { recursive: true });

/* ================= tabela ESPERADO (definida ANTES da observação) ================= */
/* Cada entrada foi redigida a partir do contrato de produto documentado, não do
 * comportamento observado. Nada aqui foi ajustado após a primeira execução. */
const ESPERADO: Record<number, string> = {
  1: "IDENTIFICADA: ENRIQUECIDO + identityStage=CORRESPONDENTE, razão social da ficha oficial, nenhuma divergência ALTA; triagem identidade=RESOLVIDO (identificação direta pelo CNPJ informado, nome compatível).",
  2: "REVISAR: identityStage=LOCALIZADO com divergência NOME:ALTA registrada e ficha PRESERVADA (razão social da ficha segue na linha); nunca CORRESPONDENTE/silencioso; triagem=VALIDACAO_HUMANA. CRÍTICO se aprovado sem divergência.",
  3: "Rejeição LOCAL da pista (nunca falha de consulta): cnpjStatus=INVALIDA + lookupStatus=IGNORADO com motivo de dígito verificador; com outra pista na linha (CSV), cnpjStatus=REFERENCIA seguindo pela pista alternativa com motivo 'CNPJ inválido'. ZERO consultas HTTP ao CNPJ inválido.",
  4: "IDENTIFICADA via candidato (pista só com nome): resolutionState=CONFIRMED com resolvedCnpj preenchido, ENRIQUECIDO e CORRESPONDENTE — resolução passa por sweep na web + binding + confirmação na base oficial.",
  5: "REVISAR: resolutionState=REVIEW sem escolhido, com os DOIS candidatos homônimos listados na resolução; nunca auto-escolha sem evidência.",
  6: "Divergência detectada, NUNCA confirmação silenciosa do par nome×CNPJ errado: 6a (CNPJ da planilha + domínio de outra empresa) → LOCALIZADO com divergência DOMINIO; 6b (nome da empresa X + domínio que comprova empresa Y) → divergência NOME registrada e caminho de revisão/correção disponível ao operador.",
  7: "NÃO IDENTIFICADA por ausência de evidência (nunca falha, nunca invenção): resolutionState=UNRESOLVED + lookupStatus=NAO_ENCONTRADO — site sem CNPJ e registro.br sem CNPJ público de registrante não geram identidade de domínio.",
  8: "IDENTIFICADA como FILIAL pelo campo oficial: branchIdentifier=2/branchType=FILIAL, matriz da raiz resolvida (matrizStatus=RESOLVIDA, headquartersCnpj=matriz, foundIsHeadquarters=false); tipo visível na triagem.",
  9: "IDENTIFICADA como MATRIZ pelo campo oficial: branchIdentifier=1, foundIsHeadquarters=true, headquartersCnpj=próprio CNPJ, matrizStatus=RESOLVIDA.",
  10: "Cada estabelecimento identificado separadamente (CNPJs completos distintos, ambos ENRIQUECIDO) com a relação de raiz visível: mesmo cnpjRoot, mesma matriz, e fato de triagem de que estabelecimentos da MESMA pessoa jurídica não são empresas distintas.",
  11: "IDENTIFICADA COM BANDEIRA (nunca sucesso silencioso): ENRIQUECIDO com registrationStatus=BAIXADA visível na linha, fato de triagem 'Situação cadastral: BAIXADA' e perguntas da pessoa jurídica encerradas (NAO_APLICAVEL) citando a situação.",
  12: "FALHA DE CONSULTA (técnica), distinta de 'não identificada': lookupStatus ∈ {ERRO_SERVIDOR, RATE_LIMITED, TIMEOUT, ERRO_REDE} com lookupError preenchido e SEM ficha (legalName nulo); triagem=INDISPONIVEL ('não significa ausência de registro').",
  13: "NÃO IDENTIFICADA por ausência de candidatos: resolutionState=UNRESOLVED + lookupStatus=NAO_ENCONTRADO com nota honesta; triagem=VALIDACAO_HUMANA com 'NÃO ENCONTRADO (buscado) não é NÃO PESQUISADO'. Distinto do caso 12.",
  14: "REVISAR por ambiguidade comprovada: resolutionState=REVIEW sem escolhido, com DOIS candidatos de raízes distintas (site oficial × RDAP registro.br) e nota de revisão humana.",
  15: "Correção do usuário vigente e hipótese antiga substituída: decide {cnpj correto} → normalizedCnpj/razão social da empresa correta, identityStage=VALIDADO, divergência antiga zerada, auditoria RESOLVE_DECISAO_HUMANA (correcao_cnpj); decide {action:CLUE} reprocessa a mesma linha pela nova pista; revalidate revalida a ficha sem perder estado.",
  16: "Classificação PF/PJ sem confluência: hash opaco 32-hex = PF (sem cnpjParticipante); CNPJ 14 com DV = PJ (com cnpjParticipante); identificador de 8 dígitos = INDETERMINADO (nunca PF por eliminação — lição v0.10.16); nenhum CPF persistido.",
  17: "Participante comum visível nas duas empresas (raízes distintas) com a nota 'participante comum … NÃO caracteriza grupo econômico'; sobreposição com estabelecimento da MESMA raiz vai para comumMesmaPj (não é relação entre empresas distintas); NENHUMA inferência automática de grupo econômico.",
};
const ESPERADO_ESTRUTURAL =
  "Contadores SEPARADOS por estado (nenhum contador genérico de falha colapsando estados): totalEnriched / totalReview (REVIEW ∨ LOCALIZADO coletado) / totalUnresolved / totalLocalizado contam conjuntos distintos; linha em FALHA DE CONSULTA não conta como NÃO ENCONTRADO; triagem distingue RESOLVIDO / VALIDACAO_HUMANA(divergência) / VALIDACAO_HUMANA(buscado-não-encontrado) / INDISPONIVEL.";

/* ================= simulador global de fontes (ZERO HTTP real) ================= */
const FICHAS = new Map<string, Record<string, unknown>>(); // cnpj → ficha BrasilAPI
const FALHAS_FONTE = new Map<string, number>(); // cnpj → status HTTP (todas as fontes)
const BUSCAS = new Map<string, { url: string; name: string; snippet: string }[]>(); // query → items
const PAGINAS = new Map<string, { title: string; html: string }>(); // url → página
const RDAP = new Map<string, { status: number; json: unknown }>(); // domínio .br → resposta
const tentativasExternas: string[] = [];
const tentativasRdap: string[] = [];
const fetchOriginal = globalThis.fetch;

const RE_CNPJ_URL =
  /(?:brasilapi\.com\.br\/api\/cnpj\/v1|api\.opencnpj\.org|receitaws\.com\.br\/v\d+\/cnpj|minhareceita\.org)\/([0-9]{14})/;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  // resolve-service :3030 — simulado AQUI (nunca real; o serviço real não é tocado)
  if (url.includes(":3030/web-search")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
    const items = BUSCAS.get(String(body.query ?? "")) ?? [];
    return new Response(JSON.stringify({ ok: true, items }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes(":3030/page-reader")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
    const page = PAGINAS.get(String(body.url ?? ""));
    if (!page) {
      return new Response(JSON.stringify({ ok: false, erro: "PAGINA_INDISPONIVEL" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, data: { title: page.title, html: page.html } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const externo = /^https?:\/\//i.test(url) && !url.includes("127.0.0.1") && !url.includes("localhost");
  if (!externo) return fetchOriginal(input as never, init);
  tentativasExternas.push(url);
  const mCnpj = url.match(RE_CNPJ_URL);
  if (mCnpj) {
    const falha = FALHAS_FONTE.get(mCnpj[1]);
    if (falha !== undefined) {
      return new Response(JSON.stringify({ message: `falha simulada (${falha})` }), { status: falha, headers: { "Content-Type": "application/json" } });
    }
    const ficha = FICHAS.get(mCnpj[1]);
    if (ficha) return new Response(JSON.stringify(ficha), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ message: "not found (simulado)" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("servicodados.ibge.gov.br/")) {
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("rdap.registro.br/")) {
    // nunca deve acontecer (RDAP usa https nativo) — defesa em profundidade
    return new Response(JSON.stringify({ errorCode: 404 }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`SIMULADOR: saída externa NÃO cadastrada — bloqueada (prova de zero HTTP real): ${url}`);
}) as typeof fetch;

/* RDAP registro.br usa https nativo — interceptado no módulo (único usuário de https). */
const httpsRequestOriginal = https.request;
type FakeRes = { statusCode: number; on(ev: string, fn: (d?: unknown) => void): FakeRes };
(https as unknown as { request: unknown }).request = ((...args: unknown[]) => {
  const opts = args[0] as { path?: string } | undefined;
  const domain = decodeURIComponent(String(opts?.path ?? "").replace(/^\/domain\//, ""));
  tentativasRdap.push(domain);
  const alvo = RDAP.get(domain) ?? { status: 404, json: { errorCode: 404 } };
  const listeners: Record<string, ((d?: unknown) => void)[]> = {};
  const fakeRes: FakeRes = {
    statusCode: alvo.status,
    on(ev: string, fn: (d?: unknown) => void) {
      (listeners[ev] ??= []).push(fn);
      return fakeRes;
    },
  };
  const cb = args.find((a) => typeof a === "function") as ((res: FakeRes) => void) | undefined;
  if (cb) setTimeout(() => cb(fakeRes), 1);
  setTimeout(() => {
    for (const fn of listeners["data"] ?? []) fn(Buffer.from(JSON.stringify(alvo.json ?? {})));
    for (const fn of listeners["end"] ?? []) fn();
  }, 2);
  const fakeReq = { on: () => fakeReq, end: () => fakeReq, destroy: () => fakeReq };
  return fakeReq as never;
}) as never;

/* ================= imports dinâmicos (APÓS o env do banco isolado) ================= */
const { db } = await import("../src/lib/db");
const { validateCnpj, formatCnpj } = await import("../src/lib/cnpj");
const { startBatch, confirmTextBatch, confirmBatch } = await import("../src/lib/enrich/engine");
const { classificarTriagemLinha } = await import("../src/lib/triage/engine");
const { investigarRelacoes } = await import("../src/lib/relations/service");
const { POST: decidePOST } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/decide/route");
const { POST: revalidatePOST } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/revalidate/route");
const { NextRequest } = await import("next/server");
type NextReq = InstanceType<typeof NextRequest>;

/* ================= CNPJs sintéticos (DV válido por construção) ================= */
function cnpjValido(raiz8: string, ordem = "0001"): string {
  const base = raiz8 + ordem;
  const calc = (d: number[]) => {
    let soma = 0;
    let peso = d.length - 7;
    for (const dig of d) {
      soma += dig * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base.split("").map(Number));
  const d2 = calc((base + String(d1)).split("").map(Number));
  const cnpj = base + String(d1) + String(d2);
  if (!validateCnpj(cnpj).valid) throw new Error(`CNPJ sintético inválido: ${cnpj}`);
  return cnpj;
}

const CNPJ_ALFA = cnpjValido("11110001");
const CNPJ_BRAVO = cnpjValido("11110002");
const CNPJ_GAMA = cnpjValido("11110003");
const CNPJ_DELTA_A = cnpjValido("11110004");
const CNPJ_DELTA_B = cnpjValido("11110005");
const CNPJ_OMEGA = cnpjValido("11110006");
const CNPJ_EPS_A = cnpjValido("11110007");
const CNPJ_EPS_B = cnpjValido("11110008");
const CNPJ_MATRIZ = cnpjValido("22220001", "0001");
const CNPJ_FILIAL = cnpjValido("22220001", "0002");
const CNPJ_BAIXADA = cnpjValido("33330001");
const CNPJ_FALHA = cnpjValido("44440001");
const CNPJ_K1 = cnpjValido("55550001");
const CNPJ_K2 = cnpjValido("55550002");
const CNPJ_K4 = cnpjValido("55550003");
const CNPJ_SIGMA = cnpjValido("66660001", "0001");
const CNPJ_SIGMA_FILIAL = cnpjValido("66660001", "0002");
const CNPJ_RHO = cnpjValido("66660002");
const CNPJ_PJ_PART = cnpjValido("66660003");
const PF_HASH = "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"; // 32-hex: PF opaco (contrato da fonte)
const ID_8_DIGITOS = "87654321"; // nem hash nem CNPJ → INDETERMINADO (lição v0.10.16)

/* ================= fichas simuladas (BrasilAPI) ================= */
function fichaBrasilAPI(
  cnpj: string,
  razao: string,
  fantasia: string,
  uf: string,
  municipio: string,
  identifier: number,
  opts: { email?: string; situacao?: string } = {}
): Record<string, unknown> {
  return {
    cnpj,
    razao_social: razao,
    nome_fantasia: fantasia,
    descricao_situacao_cadastral: opts.situacao ?? "ATIVA",
    data_situacao_cadastral: "2020-01-01",
    // campo OFICIAL identificador_matriz_filial (1=matriz, 2=filial) — a BrasilAPI real retorna
    identificador_matriz_filial: identifier,
    descricao_identificador_matriz_filial: identifier === 1 ? "MATRIZ" : "FILIAL",
    descricao_tipo_de_logradouro: "AVENIDA",
    logradouro: "INDUSTRIAL",
    numero: "1000",
    bairro: "CENTRO",
    municipio,
    uf,
    cep: "00000000",
    cnae_fiscal: 6204000,
    cnae_fiscal_descricao: "Atividade sintética",
    ddd_telefone_1: "47 3044 4000",
    data_inicio_atividade: "1990-01-01",
    capital_social: "1000000.00",
    descricao_porte: "DEMAIS",
    natureza_juridica: "Sociedade sintética",
    opcao_pelo_simples: false,
    qsa: [{ nome_socio: "SOCIO SINTETICO", qualificacao_socio: "Sócio-Administrador" }],
    email: opts.email ?? "",
  };
}

FICHAS.set(CNPJ_ALFA, fichaBrasilAPI(CNPJ_ALFA, "ALFA COMERCIO SINTETICO LTDA", "Alfa Comercio", "SP", "SAO PAULO", 1, { email: "contato@alfacomercio.com.br" }));
FICHAS.set(CNPJ_BRAVO, fichaBrasilAPI(CNPJ_BRAVO, "BRAVO DISTRIBUIDORA SINTETICA LTDA", "", "MG", "UBERLANDIA", 1, { email: "contato@bravo.com.br" }));
FICHAS.set(CNPJ_GAMA, fichaBrasilAPI(CNPJ_GAMA, "GAMA TECNOLOGIA SINTETICA LTDA", "Gama", "SC", "JOINVILLE", 1, { email: "contato@gama.com.br" }));
FICHAS.set(CNPJ_DELTA_A, fichaBrasilAPI(CNPJ_DELTA_A, "DELTA COMERCIO A SINTETICA LTDA", "", "PR", "CURITIBA", 1));
FICHAS.set(CNPJ_DELTA_B, fichaBrasilAPI(CNPJ_DELTA_B, "DELTA COMERCIO B SINTETICA LTDA", "", "RS", "PORTO ALEGRE", 1));
FICHAS.set(CNPJ_OMEGA, fichaBrasilAPI(CNPJ_OMEGA, "OMEGA COMERCIO SINTETICO LTDA", "Omega", "RJ", "RIO DE JANEIRO", 1, { email: "contato@omegacomercial.com" }));
FICHAS.set(CNPJ_EPS_A, fichaBrasilAPI(CNPJ_EPS_A, "EPSILON A SINTETICA LTDA", "", "SP", "SAO PAULO", 1));
FICHAS.set(CNPJ_EPS_B, fichaBrasilAPI(CNPJ_EPS_B, "EPSILON B SINTETICA LTDA", "", "SP", "SAO PAULO", 1));
FICHAS.set(CNPJ_MATRIZ, fichaBrasilAPI(CNPJ_MATRIZ, "THETA INDUSTRIA SINTETICA LTDA", "Theta", "SP", "CAMPINAS", 1, { email: "contato@theta.com.br" }));
FICHAS.set(CNPJ_FILIAL, fichaBrasilAPI(CNPJ_FILIAL, "THETA INDUSTRIA SINTETICA LTDA", "Theta", "BA", "SALVADOR", 2, { email: "contato@theta.com.br" }));
FICHAS.set(CNPJ_BAIXADA, fichaBrasilAPI(CNPJ_BAIXADA, "IOTA SERVICOS SINTETICO LTDA", "Iota", "DF", "BRASILIA", 1, { email: "contato@iota.com.br", situacao: "BAIXADA" }));
FICHAS.set(CNPJ_K1, fichaBrasilAPI(CNPJ_K1, "KAPPA UM COMERCIO LTDA", "Kappa Um", "SP", "SAO PAULO", 1, { email: "contato@kappaum.com.br" }));
FICHAS.set(CNPJ_K2, fichaBrasilAPI(CNPJ_K2, "KAPPA DOIS COMERCIO LTDA", "", "MG", "BELO HORIZONTE", 1, { email: "contato@kappadois.com.br" }));
FICHAS.set(CNPJ_SIGMA, fichaBrasilAPI(CNPJ_SIGMA, "SIGMA PARTICIPACOES SINTETICA LTDA", "", "SP", "SAO PAULO", 1));
FICHAS.set(CNPJ_RHO, fichaBrasilAPI(CNPJ_RHO, "RHO COMERCIO SINTETICO LTDA", "", "SP", "SANTOS", 1));
FALHAS_FONTE.set(CNPJ_FALHA, 500); // caso 12: TODAS as fontes 500
FALHAS_FONTE.set(CNPJ_K4, 500); // caso estrutural: FALHA no lote de contadores

/* ================= páginas e buscas simuladas ================= */
// caso 4 — página GOVERNAMENTAL com nome + CNPJ (binding FORTE pós-verificação)
PAGINAS.set("https://registro-gama.gov/cnpj", {
  title: "GAMA TECNOLOGIA SINTETICA LTDA — registro CNPJ",
  html: `<html><body>Registro oficial: GAMA TECNOLOGIA SINTETICA LTDA — CNPJ ${formatCnpj(CNPJ_GAMA)} — Joinville/SC</body></html>`,
});
BUSCAS.set('"GAMA TECNOLOGIA" CNPJ', [
  { url: "https://registro-gama.gov/cnpj", name: "GAMA TECNOLOGIA SINTETICA LTDA", snippet: `CNPJ ${formatCnpj(CNPJ_GAMA)}` },
]);

// caso 5 — homônimos em DOIS diretórios independentes (hosts com "cnpj" → DIRECTORY)
PAGINAS.set("https://cnpj-lista-a.example/consulta/delta", {
  title: "DELTA COMERCIO A SINTETICA LTDA — CNPJ",
  html: `<html><body>Consulta pública: DELTA COMERCIO A SINTETICA LTDA ${formatCnpj(CNPJ_DELTA_A)}</body></html>`,
});
PAGINAS.set("https://cnpj-guia-b.example/empresa/delta", {
  title: "DELTA COMERCIO B SINTETICA LTDA — CNPJ",
  html: `<html><body>Cadastro: DELTA COMERCIO B SINTETICA LTDA ${formatCnpj(CNPJ_DELTA_B)}</body></html>`,
});
BUSCAS.set('"DELTA COMERCIO" CNPJ', [
  { url: "https://cnpj-lista-a.example/consulta/delta", name: "DELTA COMERCIO A SINTETICA LTDA", snippet: `CNPJ ${formatCnpj(CNPJ_DELTA_A)}` },
  { url: "https://cnpj-guia-b.example/empresa/delta", name: "DELTA COMERCIO B SINTETICA LTDA", snippet: `CNPJ ${formatCnpj(CNPJ_DELTA_B)}` },
]);

// casos 6/7/14/15b — domínios
PAGINAS.set("https://omegacomercial.com", {
  title: "OMEGA COMERCIO SINTETICO LTDA",
  html: `<html><body>Quem somos: OMEGA COMERCIO SINTETICO LTDA — CNPJ ${formatCnpj(CNPJ_OMEGA)}</body></html>`,
});
PAGINAS.set("https://semidentidade.com.br", {
  title: "Pagina inicial",
  html: `<html><body>Conteudo institucional sem CNPJ publicado.</body></html>`,
});
PAGINAS.set("https://epsilondupla.com.br", {
  title: "EPSILON A SINTETICA LTDA",
  html: `<html><head><script type="application/ld+json">{"@type":"Organization","legalName":"EPSILON A SINTETICA LTDA"}</script></head><body>EPSILON A SINTETICA LTDA — CNPJ ${formatCnpj(CNPJ_EPS_A)}</body></html>`,
});
PAGINAS.set("https://alfacomercio.com.br", {
  title: "ALFA COMERCIO SINTETICO LTDA",
  html: `<html><body>ALFA COMERCIO SINTETICO LTDA — CNPJ ${formatCnpj(CNPJ_ALFA)}</body></html>`,
});

// RDAP registro.br (https interceptado)
RDAP.set("semidentidade.com.br", {
  status: 200,
  json: { entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "SEM IDENTIDADE LTDA"]]] }] },
});
RDAP.set("epsilondupla.com.br", {
  status: 200,
  json: {
    entities: [
      {
        roles: ["registrant"],
        publicIds: [{ type: "cnpj", identifier: CNPJ_EPS_B }],
        vcardArray: ["vcard", [["fn", {}, "text", "EPSILON B SINTETICA LTDA"]]],
      },
    ],
  },
});
// alfacomercio.com.br e quaisquer outros: 404 (domínio sem registro/RDAP)

/* ================= infra de teste ================= */
interface CasoResultado {
  numero: number;
  caso: string;
  entrada: string;
  esperado: string;
  obtido: string;
  evidencia: Record<string, unknown>;
  veredito: "PASS" | "FAIL";
  severidade: "NORMAL" | "CRITICA";
  notas: string;
}
const resultados: CasoResultado[] = [];
let passTotal = 0;
let failTotal = 0;
const falhas: string[] = [];

function registrar(c: CasoResultado): void {
  resultados.push(c);
  if (c.veredito === "PASS") passTotal++;
  else {
    failTotal++;
    falhas.push(`C${c.numero}${c.severidade === "CRITICA" ? " [CRÍTICA]" : ""}: ${c.caso}`);
  }
  console.log(`  ${c.veredito === "PASS" ? "PASS" : c.severidade === "CRITICA" ? "FAIL·CRÍTICO" : "FAIL"}  C${c.numero} — ${c.caso}`);
  if (c.veredito === "FAIL") console.log(`        obtido: ${c.obtido}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function novoLoteTexto(nomeArquivo: string, linhas: string[]): Promise<string> {
  const storedPath = `/tmp/${nomeArquivo}.txt`;
  writeFileSync(storedPath, linhas.join("\n") + "\n", "utf8");
  const batch = await db.importBatch.create({
    data: { fileName: `GATE4-${nomeArquivo}`, sourceType: "TEXT", storedPath, fileSize: 64, hasHeader: false, headerJson: JSON.stringify(["entrada"]) },
  });
  const ok = await confirmTextBatch(batch.id, false);
  if (!ok.ok) throw new Error(`confirmTextBatch falhou: ${ok.error}`);
  return batch.id;
}

async function novoLoteCsv(nomeArquivo: string, conteudo: string): Promise<string> {
  const storedPath = `/tmp/${nomeArquivo}.csv`;
  writeFileSync(storedPath, conteudo, "utf8");
  const batch = await db.importBatch.create({
    data: { fileName: `GATE4-${nomeArquivo}.csv`, sourceType: "CSV", storedPath, fileSize: 64, hasHeader: true, headerJson: JSON.stringify(["cnpj", "nome"]) },
  });
  const ok = await confirmBatch(batch.id, 0, true, false);
  if (!ok.ok) throw new Error(`confirmBatch falhou: ${ok.error}`);
  return batch.id;
}

async function esperarLote(batchId: string, timeoutMs = 120_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } });
    const ativos = await db.importRow.count({ where: { batchId, lookupStatus: { in: ["PENDENTE", "EM_FILA", "CONSULTANDO"] } } });
    if (ativos === 0 && batch && ["DONE", "PARTIAL", "FAILED"].includes(batch.status)) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando lote ${batchId} (status=${batch?.status}, ativos=${ativos})`);
    await sleep(300);
  }
}

type Row = Awaited<ReturnType<typeof db.importRow.findFirst>>;

async function linhaDe(batchId: string, rowNumber: number): Promise<Row> {
  const row = await db.importRow.findFirst({ where: { batchId, rowNumber } });
  if (!row) throw new Error(`linha ${rowNumber} não encontrada no lote ${batchId}`);
  return row;
}

function divergenciasDe(row: Row): { tipo: string; severidade: string; descricao: string }[] {
  if (!row.identityDivergenciasJson) return [];
  try {
    return JSON.parse(row.identityDivergenciasJson) as { tipo: string; severidade: string; descricao: string }[];
  } catch {
    return [];
  }
}

async function triagemDe(batchId: string, rowNumber: number) {
  const t = await classificarTriagemLinha(batchId, rowNumber);
  if (!t.ok) throw new Error(`triagem falhou: ${t.motivo}`);
  return t;
}

function contarTentativas(cnpj: string): number {
  return tentativasExternas.filter((u) => u.includes(cnpj)).length;
}

/** limpa o backoff em memória das fontes (contaminação entre casos — v0.10.1 backoff 10s/30s) */
function limparBackoffFontes(): void {
  const g = globalThis as unknown as { __cnpjSourceBackoff?: Map<string, number> };
  g.__cnpjSourceBackoff?.clear();
}

function reqPost(url: string, body?: unknown): NextReq {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/* =================================================================== */
/* EXECUÇÃO                                                            */
/* =================================================================== */
try {
  console.log("=== HOMOLOG-B3 Gate 4 — matriz adversarial de identidade (17 casos) ===\n");
  const t0 = Date.now();

  /* ---------- C1: CNPJ válido + nome compatível → IDENTIFICADA ---------- */
  {
    console.log("[C1] CNPJ válido + nome compatível");
    const b1 = await novoLoteTexto("c1", [`${formatCnpj(CNPJ_ALFA)} ALFA COMERCIO`]);
    await startBatch(b1);
    await esperarLote(b1);
    const r = await linhaDe(b1, 1);
    const divs = divergenciasDe(r);
    const tri = await triagemDe(b1, 1);
    const lacId = tri.lacunas.find((l) => l.perguntaId === "identidade");
    const ok =
      r.lookupStatus === "ENRIQUECIDO" &&
      r.identityStage === "CORRESPONDENTE" &&
      r.legalName === "ALFA COMERCIO SINTETICO LTDA" &&
      !divs.some((d) => d.severidade === "ALTA") &&
      lacId?.estado === "RESOLVIDO";
    registrar({
      numero: 1,
      caso: "CNPJ válido + nome compatível → IDENTIFICADA",
      entrada: `${formatCnpj(CNPJ_ALFA)} ALFA COMERCIO`,
      esperado: ESPERADO[1],
      obtido: `lookupStatus=${r.lookupStatus} · identityStage=${r.identityStage} · razão=${r.legalName} · divergências=${JSON.stringify(divs.map((d) => `${d.tipo}:${d.severidade}`))} · triagem=${lacId?.estado ?? "?"}`,
      evidencia: {
        lookupStatus: r.lookupStatus,
        identityStage: r.identityStage,
        legalName: r.legalName,
        registrationStatus: r.registrationStatus,
        divergencias: divs,
        triagemEstado: lacId?.estado ?? null,
        fonte: r.source,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: ok ? "" : "identificação direta deveria terminar CORRESPONDENTE sem divergência ALTA",
    });
  }

  /* ---------- C2: CNPJ válido + nome de OUTRA empresa → REVISAR ---------- */
  {
    console.log("[C2] CNPJ válido + nome de outra empresa");
    const b2 = await novoLoteTexto("c2", [`${formatCnpj(CNPJ_BRAVO)} ZETA TRANSPORTES`]);
    await startBatch(b2);
    await esperarLote(b2);
    const r = await linhaDe(b2, 1);
    const divs = divergenciasDe(r);
    const divNome = divs.find((d) => d.tipo === "NOME" && d.severidade === "ALTA");
    const tri = await triagemDe(b2, 1);
    const lacId = tri.lacunas.find((l) => l.perguntaId === "identidade");
    const ok = r.identityStage === "LOCALIZADO" && !!divNome && (r.legalName ?? "").includes("BRAVO") && lacId?.estado === "VALIDACAO_HUMANA";
    const critico = r.identityStage === "CORRESPONDENTE" || (r.lookupStatus === "ENRIQUECIDO" && divs.length === 0);
    registrar({
      numero: 2,
      caso: "CNPJ válido + nome de OUTRA empresa → REVISAR (divergência detectada)",
      entrada: `${formatCnpj(CNPJ_BRAVO)} ZETA TRANSPORTES`,
      esperado: ESPERADO[2],
      obtido: `identityStage=${r.identityStage} · divergências=${JSON.stringify(divs.map((d) => `${d.tipo}:${d.severidade}`))} · ficha preservada=${(r.legalName ?? "").includes("BRAVO")} · triagem=${lacId?.estado ?? "?"}`,
      evidencia: {
        lookupStatus: r.lookupStatus,
        identityStage: r.identityStage,
        legalName: r.legalName,
        divergencias: divs,
        triagemEstado: lacId?.estado ?? null,
        triagemMotivo: lacId?.motivo ?? null,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: critico ? "CRITICA" : "NORMAL",
      notas: critico ? "APROVAÇÃO FALSA DE IDENTIDADE: par nome×CNPJ divergente confirmado sem divergência registrada" : "",
    });
  }

  /* ---------- C3: CNPJ com DV errado → rejeição local da pista ---------- */
  {
    console.log("[C3] CNPJ matematicamente inválido (DV errado)");
    const antes = contarTentativas("12345678000100");
    const b3 = await novoLoteTexto("c3", ["12345678000100"]); // DV correto de 123456780001 é 95
    const b3csv = await novoLoteCsv("c3csv", "cnpj;nome\n12345678000100;ALFA COMERCIO\n");
    await startBatch(b3);
    await esperarLote(b3);
    await startBatch(b3csv);
    await esperarLote(b3csv);
    const r3a = await linhaDe(b3, 1);
    const r3b = await linhaDe(b3csv, 1);
    const depois = contarTentativas("12345678000100");
    const ok =
      r3a.cnpjStatus === "INVALIDA" &&
      r3a.lookupStatus === "IGNORADO" &&
      (r3a.invalidReason ?? "").includes("Dígito verificador") &&
      r3b.cnpjStatus === "REFERENCIA" &&
      (r3b.invalidReason ?? "").includes("CNPJ inválido") &&
      r3b.lookupKind === "NAME" &&
      depois - antes === 0;
    registrar({
      numero: 3,
      caso: "CNPJ matematicamente inválido (DV errado) → rejeição da pista, nunca falha de consulta",
      entrada: 'linha "12345678000100" (DV correto seria 95) · CSV "12345678000100;ALFA COMERCIO"',
      esperado: ESPERADO[3],
      obtido: `texto: cnpjStatus=${r3a.cnpjStatus}/lookupStatus=${r3a.lookupStatus}/motivo="${r3a.invalidReason}" · csv: cnpjStatus=${r3b.cnpjStatus}/kind=${r3b.lookupKind}/motivo="${(r3b.invalidReason ?? "").slice(0, 80)}" · consultas HTTP ao CNPJ inválido=${depois - antes}`,
      evidencia: {
        texto: { cnpjStatus: r3a.cnpjStatus, lookupStatus: r3a.lookupStatus, invalidReason: r3a.invalidReason },
        csv: { cnpjStatus: r3b.cnpjStatus, lookupKind: r3b.lookupKind, lookupStatus: r3b.lookupStatus, invalidReason: r3b.invalidReason },
        consultasHttpAoCnpjInvalido: depois - antes,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });
  }

  /* ---------- C4: nome sem CNPJ → resolução via candidato ---------- */
  {
    console.log("[C4] Nome sem CNPJ → resolução por candidato (gov + Receita)");
    const b4 = await novoLoteTexto("c4", ["GAMA TECNOLOGIA"]);
    await startBatch(b4);
    await esperarLote(b4);
    const r = await linhaDe(b4, 1);
    const ok =
      r.resolutionState === "CONFIRMED" &&
      r.resolvedCnpj === CNPJ_GAMA &&
      r.lookupStatus === "ENRIQUECIDO" &&
      r.identityStage === "CORRESPONDENTE";
    registrar({
      numero: 4,
      caso: "Nome sem CNPJ → identificação via candidato (sweep + binding + Receita)",
      entrada: "GAMA TECNOLOGIA (página gov sintética com nome+CNPJ)",
      esperado: ESPERADO[4],
      obtido: `resolutionState=${r.resolutionState} · resolvedCnpj=${r.resolvedCnpj ? formatCnpj(r.resolvedCnpj) : null} · lookupStatus=${r.lookupStatus} · identityStage=${r.identityStage} · confiança=${r.resolutionConfidence} · reverseSource=${r.reverseSource}`,
      evidencia: {
        resolutionState: r.resolutionState,
        resolutionConfidence: r.resolutionConfidence,
        resolvedCnpj: r.resolvedCnpj,
        reverseSource: r.reverseSource,
        lookupStatus: r.lookupStatus,
        identityStage: r.identityStage,
        legalName: r.legalName,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });
  }

  /* ---------- C5: homônimos → REVISAR, nunca auto-pick ---------- */
  {
    console.log("[C5] Nome empresarial homônimo (duas empresas)");
    const b5 = await novoLoteTexto("c5", ["DELTA COMERCIO"]);
    await startBatch(b5);
    await esperarLote(b5);
    const r = await linhaDe(b5, 1);
    let cands: { cnpj?: string }[] = [];
    try {
      cands = (JSON.parse(r.resolutionJson ?? "{}") as { candidatos?: { cnpj?: string }[] }).candidatos ?? [];
    } catch {
      cands = [];
    }
    const temDois = cands.some((c) => c.cnpj === CNPJ_DELTA_A) && cands.some((c) => c.cnpj === CNPJ_DELTA_B);
    const ok = r.resolutionState === "REVIEW" && !r.resolvedCnpj && temDois;
    registrar({
      numero: 5,
      caso: "Nome homônimo (raízes distintas) → REVISAR com candidatos listados",
      entrada: "DELTA COMERCIO (dois diretórios: DELTA A e DELTA B)",
      esperado: ESPERADO[5],
      obtido: `resolutionState=${r.resolutionState} · escolhido=${r.resolvedCnpj ?? "nenhum"} · candidatos=${cands.map((c) => formatCnpj(String(c.cnpj ?? ""))).join(", ") || "nenhum"} · lookupStatus=${r.lookupStatus}`,
      evidencia: {
        resolutionState: r.resolutionState,
        resolutionConfidence: r.resolutionConfidence,
        resolvedCnpj: r.resolvedCnpj,
        candidatos: cands.map((c) => c.cnpj),
        lookupStatus: r.lookupStatus,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: r.resolvedCnpj ? "CRITICA" : "NORMAL",
      notas: r.resolvedCnpj ? "auto-escolha sem evidência suficiente — escolha de homônimo pelo modelo" : "",
    });
  }

  /* ---------- C6: domínio de empresa diferente ---------- */
  {
    console.log("[C6] Domínio de empresa diferente da pista principal");
    // 6a: CNPJ da planilha (ALFA) + domínio de outra empresa (omegacomercial.com)
    const b6 = await novoLoteTexto("c6", [`${formatCnpj(CNPJ_ALFA)} omegacomercial.com`]);
    // 6b: nome principal ALFA + domínio que pertence à OMEGA (site publica CNPJ da OMEGA)
    await db.importRow.create({
      data: {
        batchId: b6,
        rowNumber: 2,
        originalCellsJson: JSON.stringify(["ALFA COMERCIO", "omegacomercial.com"]),
        lookupKind: "NAME",
        referenceValue: "ALFA COMERCIO",
        rawCnpj: "",
        normalizedCnpj: "",
        cnpjStatus: "REFERENCIA",
        lookupStatus: "EM_FILA",
      },
    });
    await startBatch(b6);
    await esperarLote(b6);
    const r6a = await linhaDe(b6, 1);
    const r6b = await linhaDe(b6, 2);
    const divs6a = divergenciasDe(r6a);
    const divDom = divs6a.find((d) => d.tipo === "DOMINIO");
    const divs6b = divergenciasDe(r6b);
    const divNome6b = divs6b.find((d) => d.tipo === "NOME");

    // 6a esperado: LOCALIZADO + divergência DOMINIO (nunca silencioso)
    const ok6a = r6a.identityStage === "LOCALIZADO" && !!divDom;
    // 6b esperado: divergência NOME registrada (nunca silenciosa). Caminho de revisão sondado.
    let decisao6b = "";
    try {
      const res = await decidePOST(
        reqPost(`http://localhost:3000/api/imports/${b6}/rows/2/decide`, { cnpj: CNPJ_GAMA }),
        { params: Promise.resolve({ id: b6, rowNumber: "2" }) }
      );
      const j = (await res.json()) as { error?: { code?: string } };
      decisao6b = `HTTP ${res.status}${j?.error?.code ? ` (${j.error.code})` : ""}`;
    } catch (e) {
      decisao6b = `erro: ${e instanceof Error ? e.message : String(e)}`;
    }
    // sondas complementares: TODOS os caminhos de correção da linha confirmada
    const sondas: Record<string, string> = { cnpj: decisao6b };
    for (const [chave, corpo] of [
      ["clue", { action: "CLUE", value: "alfacomercio.com.br" }],
      ["not_found", { action: "NOT_FOUND" }],
    ] as [string, unknown][]) {
      try {
        const res = await decidePOST(
          reqPost(`http://localhost:3000/api/imports/${b6}/rows/2/decide`, corpo),
          { params: Promise.resolve({ id: b6, rowNumber: "2" }) }
        );
        const j = (await res.json()) as { error?: { code?: string } };
        sondas[chave] = `HTTP ${res.status}${j?.error?.code ? ` (${j.error.code})` : ""}`;
      } catch (e) {
        sondas[chave] = `erro: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    // PROVA DE CAUSA RAIZ (reprodução mínima em camadas puras): o resolvedor MUTA
    // clues.names com nomes colhidos no site da outra empresa — a avaliação de
    // identidade compara a ficha contra o nome colhido, não contra a pista do usuário.
    const { extractClues, resolveIdentity } = await import("../src/lib/resolve");
    const { avaliarIdentidade } = await import("../src/lib/resolve/confianca");
    const fichaOmega = { legalName: "OMEGA COMERCIO SINTETICO LTDA", tradeName: "Omega", uf: "RJ", municipio: "RIO DE JANEIRO", emailDomain: "omegacomercial.com" };
    const cluesCirurgicos = extractClues(["ALFA COMERCIO", "omegacomercial.com"], "NAME", "ALFA COMERCIO");
    const nomesAntes = [...cluesCirurgicos.names];
    const avalOriginal = avaliarIdentidade({ clues: cluesCirurgicos, pistaEhCnpj: false, ficha: fichaOmega, dominioProvido: true });
    const resCirurgico = await resolveIdentity({ clues: cluesCirurgicos, label: "ALFA COMERCIO" });
    const nomesDepois = [...cluesCirurgicos.names];
    const avalMutado = avaliarIdentidade({ clues: cluesCirurgicos, pistaEhCnpj: false, ficha: fichaOmega, dominioProvido: true });
    const causaRaiz = {
      pistasAntes: nomesAntes,
      pistasDepois: nomesDepois,
      avaliacaoComPistasOriginais: { etapa: avalOriginal.etapa, divergencias: avalOriginal.divergencias.map((d) => `${d.tipo}:${d.severidade}`) },
      avaliacaoComPistasMutadas: { etapa: avalMutado.etapa, divergencias: avalMutado.divergencias.map((d) => `${d.tipo}:${d.severidade}`) },
      resolucao: { estado: resCirurgico.estado, escolhido: resCirurgico.escolhido },
    };
    const silencioso6b = r6b.lookupStatus === "ENRIQUECIDO" && divs6b.length === 0;
    const ok6b = !!divNome6b && !silencioso6b;
    const ok = ok6a && ok6b;
    registrar({
      numero: 6,
      caso: "Domínio aponta para empresa DIFERENTE da pista principal → divergência, nunca silêncio",
      entrada:
        `6a: ${formatCnpj(CNPJ_ALFA)} omegacomercial.com (ficha ALFA usa @alfacomercio.com.br) · ` +
        `6b: ALFA COMERCIO + omegacomercial.com (site publica CNPJ da OMEGA)`,
      esperado: ESPERADO[6],
      obtido:
        `6a: identityStage=${r6a.identityStage} · divergências=${JSON.stringify(divs6a.map((d) => `${d.tipo}:${d.severidade}`))} · ` +
        `6b: resolutionState=${r6b.resolutionState} · resolved=${r6b.resolvedCnpj ? formatCnpj(r6b.resolvedCnpj) : "nenhum"} · identityStage=${r6b.identityStage} · divergências=${JSON.stringify(divs6b.map((d) => `${d.tipo}:${d.severidade}`))} · ` +
        `sondas decide: {cnpj}=${sondas.cnpj} {CLUE}=${sondas.clue} {NOT_FOUND}=${sondas.not_found} · ` +
        `causa raiz: pistas antes=${JSON.stringify(nomesAntes)} → depois=${JSON.stringify(nomesDepois)} (o resolvedor adiciona o nome colhido no site da OMEGA às pistas do USUÁRIO)`,
      evidencia: {
        caso6a: { identityStage: r6a.identityStage, divergencias: divs6a, lookupStatus: r6a.lookupStatus },
        caso6b: {
          resolutionState: r6b.resolutionState,
          resolvedCnpj: r6b.resolvedCnpj,
          identityStage: r6b.identityStage,
          divergencias: divs6b,
          lookupStatus: r6b.lookupStatus,
          sondasDecide: sondas,
        },
        causaRaiz: causaRaiz,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: silencioso6b ? "CRITICA" : "NORMAL",
      notas: ok6a
        ? ok6b
          ? ""
          : `APROVAÇÃO FALSA DE IDENTIDADE (crítica): 6b confirma o CNPJ da OMEGA para uma linha cujo nome é "ALFA COMERCIO" SEM NENHUMA divergência registrada — resolveIdentity muta clues.names com o nome colhido no site da própria OMEGA e a avaliação de identidade compara a ficha contra esse nome colhido (best=1) em vez do nome do usuário; todas as sondas de correção (decide {cnpj}, CLUE, NOT_FOUND) são bloqueadas com 409`
        : "6a: divergência de domínio não registrada como LOCALIZADO",
    });
  }

  /* ---------- C7: domínio sem identidade comprovada ---------- */
  {
    console.log("[C7] Domínio sem identidade comprovada");
    const b7 = await novoLoteTexto("c7", ["semidentidade.com.br"]);
    await startBatch(b7);
    await esperarLote(b7);
    const r = await linhaDe(b7, 1);
    const ok = r.resolutionState === "UNRESOLVED" && r.lookupStatus === "NAO_ENCONTRADO" && !r.resolvedCnpj;
    registrar({
      numero: 7,
      caso: "Domínio sem identidade comprovada (site sem CNPJ; registro.br sem CNPJ público) → NÃO IDENTIFICADA",
      entrada: "semidentidade.com.br (site sem CNPJ + RDAP sem registrante com CNPJ)",
      esperado: ESPERADO[7],
      obtido: `resolutionState=${r.resolutionState} · resolvedCnpj=${r.resolvedCnpj ?? "nenhum"} · lookupStatus=${r.lookupStatus} · lookupError="${(r.lookupError ?? "").slice(0, 90)}"`,
      evidencia: {
        resolutionState: r.resolutionState,
        resolvedCnpj: r.resolvedCnpj,
        lookupStatus: r.lookupStatus,
        lookupError: r.lookupError,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: r.resolvedCnpj ? "CRITICA" : "NORMAL",
      notas: r.resolvedCnpj ? "identidade inventada a partir de domínio sem evidência" : "",
    });
  }

  /* ---------- C8/C9/C10: matriz, filial e mesma raiz ---------- */
  {
    console.log("[C8/C9/C10] Filial, matriz e mesma raiz em estabelecimentos diferentes");
    const b8 = await novoLoteTexto("c8", [formatCnpj(CNPJ_MATRIZ), formatCnpj(CNPJ_FILIAL)]);
    await startBatch(b8);
    await esperarLote(b8);
    const rm = await linhaDe(b8, 1); // matriz
    const rf = await linhaDe(b8, 2); // filial
    const triM = await triagemDe(b8, 1);
    // cache de estabelecimentos da raiz para o fato "mesma pessoa jurídica" na triagem
    const agora = new Date();
    await db.estabelecimentoRootCache.create({
      data: {
        cnpjRaiz: "22220001",
        fonteDescoberta: "MinhaReceita Grafo — quadros de participantes (sintético)",
        coletadoEm: agora,
        atualizadoEm: agora,
        validoAte: new Date(agora.getTime() + 30 * 86400_000),
        estabelecimentosJson: JSON.stringify([
          { cnpj: CNPJ_MATRIZ, razaoSocial: "THETA INDUSTRIA SINTETICA LTDA", municipio: "CAMPINAS", uf: "SP", situacao: "ATIVA", identificadorMatrizFilial: 1, confirmado: true },
          { cnpj: CNPJ_FILIAL, razaoSocial: "THETA INDUSTRIA SINTETICA LTDA", municipio: "SALVADOR", uf: "BA", situacao: "ATIVA", identificadorMatrizFilial: 2, confirmado: true },
        ]),
        coberturaJson: JSON.stringify({ participantesConsultados: [], tetoParticipantes: 10, tetoConfirmacoes: 20, pendentesConfirmacao: 0, totalLocalizados: 2, parcial: true }),
      },
    });
    const triM2 = await triagemDe(b8, 1);
    const lacEst = triM2.lacunas.find((l) => l.perguntaId === "estabelecimentos");
    const fatoRaiz = lacEst?.fatos.find((f) => /MESMA pessoa jurídica não são empresas distintas/.test(f.fato));
    const triMId = triM.lacunas.find((l) => l.perguntaId === "identidade");

    // C8 — filial
    const ok8 =
      rf.branchIdentifier === 2 &&
      (rf.branchType ?? "").toUpperCase() === "FILIAL" &&
      rf.matrizStatus === "RESOLVIDA" &&
      rf.headquartersCnpj === CNPJ_MATRIZ &&
      rf.foundIsHeadquarters === false &&
      rf.cnpjRoot === "22220001" &&
      rf.lookupStatus === "ENRIQUECIDO";
    registrar({
      numero: 8,
      caso: "CNPJ de FILIAL → identificada como filial da raiz (campo oficial)",
      entrada: formatCnpj(CNPJ_FILIAL),
      esperado: ESPERADO[8],
      obtido: `branchIdentifier=${rf.branchIdentifier} · branchType=${rf.branchType} · matrizStatus=${rf.matrizStatus} · headquartersCnpj=${rf.headquartersCnpj ? formatCnpj(rf.headquartersCnpj) : null} · foundIsHeadquarters=${rf.foundIsHeadquarters} · cnpjRoot=${rf.cnpjRoot}`,
      evidencia: {
        branchIdentifier: rf.branchIdentifier,
        branchType: rf.branchType,
        matrizStatus: rf.matrizStatus,
        headquartersCnpj: rf.headquartersCnpj,
        foundIsHeadquarters: rf.foundIsHeadquarters,
        cnpjRoot: rf.cnpjRoot,
        lookupStatus: rf.lookupStatus,
      },
      veredito: ok8 ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });

    // C9 — matriz
    const ok9 =
      rm.branchIdentifier === 1 &&
      (rm.branchType ?? "").toUpperCase() === "MATRIZ" &&
      rm.foundIsHeadquarters === true &&
      rm.headquartersCnpj === CNPJ_MATRIZ &&
      rm.matrizStatus === "RESOLVIDA";
    registrar({
      numero: 9,
      caso: "CNPJ de MATRIZ → identificada como matriz (campo oficial)",
      entrada: formatCnpj(CNPJ_MATRIZ),
      esperado: ESPERADO[9],
      obtido: `branchIdentifier=${rm.branchIdentifier} · branchType=${rm.branchType} · foundIsHeadquarters=${rm.foundIsHeadquarters} · headquartersCnpj=${rm.headquartersCnpj ? formatCnpj(rm.headquartersCnpj) : null} · matrizStatus=${rm.matrizStatus}`,
      evidencia: {
        branchIdentifier: rm.branchIdentifier,
        branchType: rm.branchType,
        foundIsHeadquarters: rm.foundIsHeadquarters,
        headquartersCnpj: rm.headquartersCnpj,
        matrizStatus: rm.matrizStatus,
        triagemIdentidade: triMId?.estado ?? null,
      },
      veredito: ok9 ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });

    // C10 — mesma raiz, estabelecimentos diferentes
    const ok10 =
      rm.lookupStatus === "ENRIQUECIDO" &&
      rf.lookupStatus === "ENRIQUECIDO" &&
      rm.normalizedCnpj !== rf.normalizedCnpj &&
      rm.cnpjRoot === rf.cnpjRoot &&
      rm.headquartersCnpj === rf.headquartersCnpj &&
      !!fatoRaiz;
    registrar({
      numero: 10,
      caso: "Mesma raiz, estabelecimentos diferentes → cada um identificado, relação de raiz visível",
      entrada: `${formatCnpj(CNPJ_MATRIZ)} + ${formatCnpj(CNPJ_FILIAL)} (mesmo lote)`,
      esperado: ESPERADO[10],
      obtido: `matriz=${formatCnpj(rm.normalizedCnpj)} (${rm.lookupStatus}) · filial=${formatCnpj(rf.normalizedCnpj)} (${rf.lookupStatus}) · cnpjRoot iguais=${rm.cnpjRoot === rf.cnpjRoot} (${rm.cnpjRoot}) · mesma matriz=${rm.headquartersCnpj === rf.headquartersCnpj} · fato triagem="${fatoRaiz?.fato?.slice(0, 80) ?? "AUSENTE"}"`,
      evidencia: {
        matriz: { cnpj: rm.normalizedCnpj, status: rm.lookupStatus, root: rm.cnpjRoot, headquarters: rm.headquartersCnpj },
        filial: { cnpj: rf.normalizedCnpj, status: rf.lookupStatus, root: rf.cnpjRoot, headquarters: rf.headquartersCnpj },
        fatoTriagemRaiz: fatoRaiz?.fato ?? null,
      },
      veredito: ok10 ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });
  }

  /* ---------- C11: empresa baixada ---------- */
  {
    console.log("[C11] Empresa baixada (situação cadastral inativa)");
    const b9 = await novoLoteTexto("c9", [formatCnpj(CNPJ_BAIXADA)]);
    await startBatch(b9);
    await esperarLote(b9);
    const r = await linhaDe(b9, 1);
    const tri = await triagemDe(b9, 1);
    const lacId = tri.lacunas.find((l) => l.perguntaId === "identidade");
    const fatoSituacao = lacId?.fatos.find((f) => /Situação cadastral: BAIXADA/.test(f.fato));
    const lacRegime = tri.lacunas.find((l) => l.perguntaId === "regime_tributario");
    const encerradaComMotivo = tri.lacunas.some((l) => l.estado === "NAO_APLICAVEL" && /BAIXADA/i.test(l.motivo));
    const ok = r.lookupStatus === "ENRIQUECIDO" && r.registrationStatus === "BAIXADA" && !!fatoSituacao && encerradaComMotivo;
    registrar({
      numero: 11,
      caso: "Empresa baixada → identificada COM BANDEIRA (nunca sucesso silencioso)",
      entrada: `${formatCnpj(CNPJ_BAIXADA)} (ficha sintética com situação BAIXADA, matriz)`,
      esperado: ESPERADO[11],
      obtido: `lookupStatus=${r.lookupStatus} · registrationStatus=${r.registrationStatus} · fato triagem situação=${!!fatoSituacao} · perguntas PJ encerradas citando BAIXADA=${encerradaComMotivo} (ex.: regime=${lacRegime?.estado})`,
      evidencia: {
        lookupStatus: r.lookupStatus,
        registrationStatus: r.registrationStatus,
        identityStage: r.identityStage,
        triagemIdentidade: lacId?.estado ?? null,
        fatoSituacaoCadastral: fatoSituacao?.fato ?? null,
        regimeEstado: lacRegime?.estado ?? null,
        regimeMotivo: lacRegime?.motivo ?? null,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });
  }

  /* ---------- C12: fonte temporariamente indisponível → FALHA DE CONSULTA ---------- */
  {
    console.log("[C12] Fonte temporariamente indisponível (500 em toda a cadeia)");
    const b10 = await novoLoteTexto("c10", [formatCnpj(CNPJ_FALHA)]);
    await startBatch(b10);
    await esperarLote(b10);
    const r = await linhaDe(b10, 1);
    const tri = await triagemDe(b10, 1);
    const lacId = tri.lacunas.find((l) => l.perguntaId === "identidade");
    const statusFalha = ["ERRO_SERVIDOR", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE"].includes(r.lookupStatus);
    const ok = statusFalha && !!r.lookupError && !r.legalName && lacId?.estado === "INDISPONIVEL" && r.lookupStatus !== "NAO_ENCONTRADO";
    registrar({
      numero: 12,
      caso: "Fonte temporariamente indisponível (429/500/timeout) → FALHA DE CONSULTA distinta de 'não identificada'",
      entrada: `${formatCnpj(CNPJ_FALHA)} (BrasilAPI/OpenCNPJ/ReceitaWS/MinhaReceita respondem 500)`,
      esperado: ESPERADO[12],
      obtido: `lookupStatus=${r.lookupStatus} · lookupError="${(r.lookupError ?? "").slice(0, 70)}" · ficha=${r.legalName ?? "nenhuma"} · triagem=${lacId?.estado ?? "?"} ("${(lacId?.motivo ?? "").slice(0, 70)}")`,
      evidencia: {
        lookupStatus: r.lookupStatus,
        lookupError: r.lookupError,
        legalName: r.legalName,
        retryCount: r.retryCount,
        triagemEstado: lacId?.estado ?? null,
        triagemMotivo: lacId?.motivo ?? null,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: r.lookupStatus === "NAO_ENCONTRADO" ? "CRITICA" : "NORMAL",
      notas: r.lookupStatus === "NAO_ENCONTRADO" ? "falha técnica colapsada em 'não encontrado' — viola a distinção de estados" : "",
    });
    limparBackoffFontes(); // a falha programa backoff global — limpo antes dos casos seguintes
  }

  /* ---------- C13: nenhum candidato → NÃO IDENTIFICADA ---------- */
  {
    console.log("[C13] Nenhum candidato encontrado");
    const b11 = await novoLoteTexto("c11", ["KHAI INEXISTENTE SINTETICA"]);
    await startBatch(b11);
    await esperarLote(b11);
    const r = await linhaDe(b11, 1);
    const tri = await triagemDe(b11, 1);
    const lacId = tri.lacunas.find((l) => l.perguntaId === "identidade");
    const ok =
      r.resolutionState === "UNRESOLVED" &&
      r.lookupStatus === "NAO_ENCONTRADO" &&
      !r.resolvedCnpj &&
      lacId?.estado === "VALIDACAO_HUMANA" &&
      /NÃO ENCONTRADO \(buscado\) não é NÃO PESQUISADO/.test(lacId?.motivo ?? "");
    registrar({
      numero: 13,
      caso: "Nenhum candidato encontrado → NÃO IDENTIFICADA (ausência de informação ≠ falha)",
      entrada: "KHAI INEXISTENTE SINTETICA (busca na web sem resultados)",
      esperado: ESPERADO[13],
      obtido: `resolutionState=${r.resolutionState} · resolvedCnpj=${r.resolvedCnpj ?? "nenhum"} · lookupStatus=${r.lookupStatus} · triagem=${lacId?.estado} ("${(lacId?.motivo ?? "").slice(0, 80)}")`,
      evidencia: {
        resolutionState: r.resolutionState,
        lookupStatus: r.lookupStatus,
        lookupError: r.lookupError,
        triagemEstado: lacId?.estado ?? null,
        triagemMotivo: lacId?.motivo ?? null,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });
  }

  /* ---------- C14: vários candidatos plausíveis (site × RDAP) ---------- */
  {
    console.log("[C14] Vários candidatos plausíveis (site oficial × RDAP)");
    const b12 = await novoLoteTexto("c12", ["epsilondupla.com.br"]);
    await startBatch(b12);
    await esperarLote(b12);
    const r = await linhaDe(b12, 1);
    let cands: { cnpj?: string; strength?: string }[] = [];
    try {
      cands = (JSON.parse(r.resolutionJson ?? "{}") as { candidatos?: { cnpj?: string; strength?: string }[] }).candidatos ?? [];
    } catch {
      cands = [];
    }
    const temAmbos = cands.some((c) => c.cnpj === CNPJ_EPS_A) && cands.some((c) => c.cnpj === CNPJ_EPS_B);
    const ok = r.resolutionState === "REVIEW" && !r.resolvedCnpj && temAmbos;
    registrar({
      numero: 14,
      caso: "Vários candidatos plausíveis → REVISAR com candidatos listados (site × RDAP)",
      entrada: "epsilondupla.com.br (site publica CNPJ EPS-A; registro.br declara registrante EPS-B)",
      esperado: ESPERADO[14],
      obtido: `resolutionState=${r.resolutionState} · escolhido=${r.resolvedCnpj ?? "nenhum"} · candidatos=${cands.map((c) => `${formatCnpj(String(c.cnpj ?? ""))}[${c.strength ?? "?"}]`).join(", ") || "nenhum"} · lookupStatus=${r.lookupStatus}`,
      evidencia: {
        resolutionState: r.resolutionState,
        resolvedCnpj: r.resolvedCnpj,
        candidatos: cands,
        lookupStatus: r.lookupStatus,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: r.resolvedCnpj ? "CRITICA" : "NORMAL",
      notas: r.resolvedCnpj ? "escolha automática entre candidatos conflitantes de raízes distintas" : "",
    });
  }

  /* ---------- C15: pista contraditória corrigida pelo usuário ---------- */
  {
    console.log("[C15] Correção humana de pista contraditória (decide/revalidate)");
    // pista de nome ÚNICA (não usada em outro lote) — evita o cache de resolução entre
    // lotes (RESOLVE_CACHE reutiliza a decisão de outro lote para a mesma pista)
    const b13 = await novoLoteTexto("c13", [`${formatCnpj(CNPJ_ALFA)} ZETA TRANSPORTES`, "ALFA COMERCIO DO VALE"]);
    await startBatch(b13);
    await esperarLote(b13);
    const antes = await linhaDe(b13, 1);
    const divsAntes = divergenciasDe(antes);
    const antesRow2 = await linhaDe(b13, 2);

    // 15a — decide {cnpj correto} na linha VALIDA divergente
    const resDecide = await decidePOST(
      reqPost(`http://localhost:3000/api/imports/${b13}/rows/1/decide`, { cnpj: CNPJ_GAMA }),
      { params: Promise.resolve({ id: b13, rowNumber: "1" }) }
    );
    const jDecide = (await resDecide.json()) as { ok?: boolean; decided?: string };
    await esperarLote(b13);
    const depois = await linhaDe(b13, 1);
    const divsDepois = divergenciasDe(depois);
    const auditCorrecao = await db.auditEvent.findFirst({
      where: { batchId: b13, event: "RESOLVE_DECISAO_HUMANA", rowNumber: 1 },
    });
    const auditDetalhe = (() => {
      try {
        return JSON.parse(auditCorrecao?.detail ?? "{}") as { origem?: string; cnpj_anterior?: string };
      } catch {
        return {};
      }
    })();
    const ok15a =
      resDecide.status === 200 &&
      depois.normalizedCnpj === CNPJ_GAMA &&
      (depois.legalName ?? "").includes("GAMA") &&
      depois.identityStage === "VALIDADO" &&
      depois.resolutionConfidence === "HUMANA" &&
      divsDepois.length === 0 &&
      divsAntes.length > 0 &&
      auditDetalhe.origem === "correcao_cnpj" &&
      !(depois.originalCellsJson ?? "").includes(CNPJ_ALFA);

    // 15b — decide {action:CLUE} na linha por nome sem resultado
    const resClue = await decidePOST(
      reqPost(`http://localhost:3000/api/imports/${b13}/rows/2/decide`, { action: "CLUE", value: "alfacomercio.com.br" }),
      { params: Promise.resolve({ id: b13, rowNumber: "2" }) }
    );
    await esperarLote(b13);
    const depoisRow2 = await linhaDe(b13, 2);
    const auditClue = await db.auditEvent.findFirst({
      where: { batchId: b13, event: "RESOLVE_NOVA_PISTA", rowNumber: 2 },
    });
    const ok15b =
      resClue.status === 200 &&
      antesRow2.lookupStatus === "NAO_ENCONTRADO" &&
      depoisRow2.resolvedCnpj === CNPJ_ALFA &&
      depoisRow2.lookupStatus === "ENRIQUECIDO" &&
      depoisRow2.identityStage === "CORRESPONDENTE" &&
      !!auditClue;

    // 15c — revalidate na linha corrigida (ficha revalidada, estado preservado)
    const resReval = await revalidatePOST(
      reqPost(`http://localhost:3000/api/imports/${b13}/rows/1/revalidate`),
      { params: Promise.resolve({ id: b13, rowNumber: "1" }) }
    );
    const jReval = (await resReval.json()) as { ok?: boolean; revalidado?: boolean; linha?: { lookupStatus?: string } };
    const depoisReval = await linhaDe(b13, 1);
    const ok15c = resReval.status === 200 && jReval.ok === true && depoisReval.lookupStatus === "ENRIQUECIDO" && depoisReval.normalizedCnpj === CNPJ_GAMA && depoisReval.identityStage === "VALIDADO";

    const ok = ok15a && ok15b && ok15c;
    registrar({
      numero: 15,
      caso: "Pista contraditória corrigida pelo usuário → correção vigente, hipótese antiga substituída",
      entrada: `linha1: ${formatCnpj(CNPJ_ALFA)} ZETA TRANSPORTES → decide{cnpj:${formatCnpj(CNPJ_GAMA)}} · linha2: ALFA COMERCIO → decide{action:CLUE, value:alfacomercio.com.br} · revalidate linha1`,
      esperado: ESPERADO[15],
      obtido:
        `15a decide{cnpj}: HTTP ${resDecide.status}/decided=${jDecide.decided} → cnpj=${formatCnpj(depois.normalizedCnpj)} · razão=${depois.legalName} · stage=${depois.identityStage} · divergências ${divsAntes.length}→${divsDepois.length} · auditoria origem=${auditDetalhe.origem} · ` +
        `15b CLUE: HTTP ${resClue.status} → ${antesRow2.lookupStatus}→${depoisRow2.lookupStatus}/${depoisRow2.identityStage} resolved=${depoisRow2.resolvedCnpj ? formatCnpj(depoisRow2.resolvedCnpj) : "nenhum"} · ` +
        `15c revalidate: HTTP ${resReval.status}/ok=${jReval.ok} → ${depoisReval.lookupStatus}/${depoisReval.identityStage}`,
      evidencia: {
        antes: { normalizedCnpj: antes.normalizedCnpj, identityStage: antes.identityStage, divergencias: divsAntes },
        decideCnpj: {
          http: resDecide.status,
          decided: jDecide.decided ?? null,
          normalizedCnpj: depois.normalizedCnpj,
          legalName: depois.legalName,
          identityStage: depois.identityStage,
          resolutionConfidence: depois.resolutionConfidence,
          divergenciasPos: divsDepois,
          auditoriaOrigem: auditDetalhe.origem ?? null,
          cnpjAnterior: auditDetalhe.cnpj_anterior ?? null,
        },
        decideClue: {
          http: resClue.status,
          antes: { lookupStatus: antesRow2.lookupStatus, resolvedCnpj: antesRow2.resolvedCnpj },
          depois: { lookupStatus: depoisRow2.lookupStatus, identityStage: depoisRow2.identityStage, resolvedCnpj: depoisRow2.resolvedCnpj },
          auditoria: auditClue?.event ?? null,
        },
        revalidate: { http: resReval.status, ok: jReval.ok ?? null, linha: jReval.linha ?? null },
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: ok ? "" : `falha em: 15a=${ok15a} 15b=${ok15b} 15c=${ok15c}`,
    });
  }

  /* ---------- C16: PF e PJ como participantes societários ---------- */
  {
    console.log("[C16] PF e PJ como participantes societários (classificação sem confluência)");
    const agora = new Date();
    const b14 = await db.importBatch.create({
      data: { fileName: "GATE4-c16.csv", storedPath: "qa/sintetico", fileSize: 32, rowCount: 1, status: "DONE", totalValid: 1 },
    });
    await db.importRow.create({
      data: {
        batchId: b14.id,
        rowNumber: 1,
        originalCellsJson: JSON.stringify([formatCnpj(CNPJ_SIGMA)]),
        lookupKind: "CNPJ",
        normalizedCnpj: CNPJ_SIGMA,
        rawCnpj: formatCnpj(CNPJ_SIGMA),
        cnpjStatus: "VALIDA",
        lookupStatus: "ENRIQUECIDO",
        legalName: "SIGMA PARTICIPACOES SINTETICA LTDA",
        registrationStatus: "ATIVA",
        branchType: "MATRIZ",
        branchIdentifier: 1,
        collectedAt: agora,
        queriedAt: agora,
      },
    });
    // fonte de grafos INJETÁVEL (padrão test-v01010): PF com hash + CPF (deve ser descartado), PJ com CNPJ, id de 8 dígitos
    const fetcherGate4 = async (path: string): Promise<{ status: number; json: unknown }> => {
      tentativasExternas.push(`grafo-injetado:${path}`);
      if (path === "/updated") return { status: 200, json: { message: "base-sintetica-gate4" } };
      if (path === `/${CNPJ_SIGMA}`) {
        return {
          status: 200,
          json: [
            { id: PF_HASH, nome: "SOCIO PF SINTETICO", cpf: "12345678901" },
            { id: CNPJ_PJ_PART, nome: "TAU PARTICIPACOES LTDA", razao_social: "SIGMA PARTICIPACOES SINTETICA LTDA" },
            { id: ID_8_DIGITOS, nome: "BRD DIGITAL LTDA" },
          ],
        };
      }
      return { status: 404, json: null };
    };
    const inv = await investigarRelacoes(b14.id, 1, { fetcher: fetcherGate4 });
    if (!inv.ok) throw new Error(`investigarRelacoes falhou: ${inv.motivo}`);
    const pf = inv.view.participantes.find((p) => p.participanteId === PF_HASH);
    const pj = inv.view.participantes.find((p) => p.participanteId === CNPJ_PJ_PART);
    const ind = inv.view.participantes.find((p) => p.participanteId === ID_8_DIGITOS);
    const cachePersistido = await db.relacaoSocietariaCache.findUnique({ where: { cnpj: CNPJ_SIGMA } });
    const semCpf = !(cachePersistido?.relacoesJson ?? "").includes("12345678901");
    const tri = await triagemDe(b14.id, 1);
    const lacRel = tri.lacunas.find((l) => l.perguntaId === "relacoes_societarias");
    const fatoContagem = lacRel?.fatos.find((f) => /Quadro público consultado/.test(f.fato));
    const ok =
      pf?.tipo === "PF" &&
      pf?.cnpjParticipante === null &&
      pj?.tipo === "PJ" &&
      pj?.cnpjParticipante === CNPJ_PJ_PART &&
      ind?.tipo === "INDETERMINADO" &&
      semCpf &&
      !!fatoContagem &&
      /1 pessoa jurídica identificável/.test(fatoContagem?.fato ?? "") &&
      /1 pessoa física/.test(fatoContagem?.fato ?? "");
    registrar({
      numero: 16,
      caso: "PF e PJ como participantes societários → classificação correta, sem confluência",
      entrada: `quadro de ${formatCnpj(CNPJ_SIGMA)}: PF(hash 32-hex, com campo cpf na resposta), PJ(CNPJ ${formatCnpj(CNPJ_PJ_PART)}), id 8 dígitos`,
      esperado: ESPERADO[16],
      obtido: `PF=${pf?.tipo}(cnpjParticipante=${pf?.cnpjParticipante ?? "null"}) · PJ=${pj?.tipo}(cnpjParticipante=${pj?.cnpjParticipante ? formatCnpj(pj.cnpjParticipante) : "null"}) · 8-dígitos=${ind?.tipo} · CPF persistido=${!semCpf} · aviso=${inv.view.avisos.join(" | ").slice(0, 90)}`,
      evidencia: {
        participantePF: { id: PF_HASH, tipo: pf?.tipo ?? null, cnpjParticipante: pf?.cnpjParticipante ?? undefined },
        participantePJ: { id: CNPJ_PJ_PART, tipo: pj?.tipo ?? null, cnpjParticipante: pj?.cnpjParticipante ?? null },
        participanteIndeterminado: { id: ID_8_DIGITOS, tipo: ind?.tipo ?? null },
        cpfDescartadoDaPersistencia: semCpf,
        avisos: inv.view.avisos,
        fatoTriagem: fatoContagem?.fato ?? null,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });
  }

  /* ---------- C17: participante compartilhado — comum ≠ grupo ---------- */
  {
    console.log("[C17] Participante compartilhado por empresas diferentes");
    const agora = new Date();
    const b15 = await db.importBatch.create({
      data: { fileName: "GATE4-c17.csv", storedPath: "qa/sintetico", fileSize: 48, rowCount: 3, status: "DONE", totalValid: 3 },
    });
    const linhaBase = (rowNumber: number, cnpj: string, razao: string) =>
      db.importRow.create({
        data: {
          batchId: b15.id,
          rowNumber,
          originalCellsJson: JSON.stringify([formatCnpj(cnpj)]),
          lookupKind: "CNPJ",
          normalizedCnpj: cnpj,
          rawCnpj: formatCnpj(cnpj),
          cnpjStatus: "VALIDA",
          lookupStatus: "ENRIQUECIDO",
          legalName: razao,
          registrationStatus: "ATIVA",
          branchType: "MATRIZ",
          branchIdentifier: 1,
          collectedAt: agora,
          queriedAt: agora,
        },
      });
    await linhaBase(1, CNPJ_SIGMA, "SIGMA PARTICIPACOES SINTETICA LTDA");
    await linhaBase(2, CNPJ_RHO, "RHO COMERCIO SINTETICO LTDA");
    await linhaBase(3, CNPJ_SIGMA_FILIAL, "SIGMA PARTICIPACOES SINTETICA LTDA"); // mesma raiz da linha 1
    const fetcher17 = async (path: string): Promise<{ status: number; json: unknown }> => {
      tentativasExternas.push(`grafo-injetado:${path}`);
      if (path === "/updated") return { status: 200, json: { message: "base-sintetica-gate4" } };
      if (path === `/${CNPJ_SIGMA}`) {
        return { status: 200, json: [{ id: PF_HASH, nome: "SOCIO PF SINTETICO" }, { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nome: "SOCIO EXCLUSIVO SIGMA" }] };
      }
      if (path === `/${CNPJ_RHO}`) {
        return { status: 200, json: [{ id: PF_HASH, nome: "SOCIO PF SINTETICO" }, { id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", nome: "SOCIO EXCLUSIVO RHO" }] };
      }
      return { status: 404, json: null };
    };
    // 1ª investigação (consulta real) — cache da PSI criado; ainda sem participante comum
    const inv1 = await investigarRelacoes(b15.id, 1, { fetcher: fetcher17 });
    if (!inv1.ok) throw new Error(`investigarRelacoes(1) falhou: ${inv1.motivo}`);
    // 2ª investigação (consulta real da RHO) — agora o cache da PSI existe p/ comparação
    const inv2 = await investigarRelacoes(b15.id, 2, { fetcher: fetcher17 });
    if (!inv2.ok) throw new Error(`investigarRelacoes(2) falhou: ${inv2.motivo}`);
    const pf2 = inv2.view.participantes.find((p) => p.participanteId === PF_HASH);
    // 3ª investigação (cache) — participante comum visível na PSI com a nota contratual
    const inv3 = await investigarRelacoes(b15.id, 1, { fetcher: fetcher17 });
    if (!inv3.ok) throw new Error(`investigarRelacoes(3) falhou: ${inv3.motivo}`);
    const pf3 = inv3.view.participantes.find((p) => p.participanteId === PF_HASH);
    // 4ª: adiciona cache da FILIAL da mesma raiz contendo o MESMO participante → comumMesmaPj
    await db.relacaoSocietariaCache.create({
      data: {
        cnpj: CNPJ_SIGMA_FILIAL,
        fonte: "MinhaReceita Grafo",
        baseDados: "base-sintetica-gate4",
        coletadoEm: agora,
        atualizadoEm: agora,
        validoAte: new Date(agora.getTime() + 30 * 86400_000),
        relacoesJson: JSON.stringify([
          { participanteId: PF_HASH, tipo: "PF", nomePublico: "SOCIO PF SINTETICO", cnpjParticipante: null, razaoSocialPj: null, comumCom: [], comumMesmaPj: [] },
        ]),
        totalParticipantes: 1,
      },
    });
    const inv4 = await investigarRelacoes(b15.id, 1, { fetcher: fetcher17 });
    if (!inv4.ok) throw new Error(`investigarRelacoes(4) falhou: ${inv4.motivo}`);
    const pf4 = inv4.view.participantes.find((p) => p.participanteId === PF_HASH);
    const textoTudo = JSON.stringify({
      p: inv4.view.participantes,
      a: inv4.view.avisos,
      v: inv4.view,
    });
    const mencoesGrupo = textoTudo.match(/[^"]*grupo econômico[^"]*/g) ?? [];
    const todasNegadas = mencoesGrupo.every((m) => /NÃO caracteriza grupo econômico/.test(m));
    const comumComOutraEmpresa = pf4?.comumCom.some((c) => c.cnpj === CNPJ_RHO && /NÃO caracteriza grupo econômico/.test(c.nota)) ?? false;
    const mesmaPjIsolada = (pf4?.comumMesmaPj ?? []).some((c) => c.cnpj === CNPJ_SIGMA_FILIAL) && !(pf4?.comumCom ?? []).some((c) => c.cnpj === CNPJ_SIGMA_FILIAL);
    const bidirecional = pf2?.comumCom.some((c) => c.cnpj === CNPJ_SIGMA) ?? false;
    const ok =
      comumComOutraEmpresa &&
      mesmaPjIsolada &&
      bidirecional &&
      inv4.view.existeParticipanteComum === true &&
      todasNegadas &&
      (pf4?.comumCom ?? []).every((c) => c.cnpj !== CNPJ_SIGMA_FILIAL);
    registrar({
      numero: 17,
      caso: "Participante compartilhado por empresas diferentes → visível nas duas, SEM inferência de grupo econômico",
      entrada: `${formatCnpj(CNPJ_SIGMA)} e ${formatCnpj(CNPJ_RHO)} compartilham sócio PF ${PF_HASH.slice(0, 8)}…; filial ${formatCnpj(CNPJ_SIGMA_FILIAL)} (mesma raiz) também o tem`,
      esperado: ESPERADO[17],
      obtido:
        `comumCom(PSI→RHO)=${comumComOutraEmpresa} nota="${pf4?.comumCom.find((c) => c.cnpj === CNPJ_RHO)?.nota ?? "—"}" · bidirecional(RHO→PSI)=${bidirecional} · comumMesmaPj(filial)=${mesmaPjIsolada} · existeParticipanteComum=${inv4.view.existeParticipanteComum} · menções a "grupo econômico" todas negadas=${todasNegadas} (${mencoesGrupo.length} menção(ões)) · aviso="${inv4.view.avisos.find((a) => /MESMA raiz/.test(a)) ?? "—"}"`,
      evidencia: {
        comumNaConsultaDaRho: pf2?.comumCom ?? [],
        comumNaConsultaDaPsi: pf4?.comumCom ?? [],
        comumMesmaPj: pf4?.comumMesmaPj ?? [],
        existeParticipanteComum: inv4.view.existeParticipanteComum,
        avisos: inv4.view.avisos,
        mencoesGrupoEconomico: mencoesGrupo,
        todasNegadas,
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: !todasNegadas ? "CRITICA" : "NORMAL",
      notas: !todasNegadas ? "inferência automática de grupo econômico detectada" : "",
    });
  }

  /* ---------- C18 (estrutural): contadores separados por estado ---------- */
  {
    console.log("[C-ESTRUTURAL] Contadores separados — nenhum contador genérico de falha");
    const b16 = await novoLoteTexto("c16", [
      `${formatCnpj(CNPJ_K1)} KAPPA UM COMERCIO`, // → IDENTIFICADA (ENRIQUECIDO/CORRESPONDENTE)
      `${formatCnpj(CNPJ_K2)} ZETA TRANSPORTES`, // → REVISAR (ENRIQUECIDO/LOCALIZADO divergente)
      "KHAI INEXISTENTE SINTETICA", // → NÃO IDENTIFICADA (UNRESOLVED/NAO_ENCONTRADO)
      `${formatCnpj(CNPJ_K4)} KAPPA QUATRO COMERCIO`, // → FALHA DE CONSULTA (fontes 500)
    ]);
    await startBatch(b16);
    await esperarLote(b16);
    const [r1, r2, r3, r4] = await Promise.all([linhaDe(b16, 1), linhaDe(b16, 2), linhaDe(b16, 3), linhaDe(b16, 4)]);
    const batch = await db.importBatch.findUnique({ where: { id: b16 } });
    const t1 = await triagemDe(b16, 1);
    const t2 = await triagemDe(b16, 2);
    const t3 = await triagemDe(b16, 3);
    const t4 = await triagemDe(b16, 4);
    const e1 = t1.lacunas.find((l) => l.perguntaId === "identidade")?.estado;
    const e2 = t2.lacunas.find((l) => l.perguntaId === "identidade")?.estado;
    const e3 = t3.lacunas.find((l) => l.perguntaId === "identidade")?.estado;
    const e4 = t4.lacunas.find((l) => l.perguntaId === "identidade")?.estado;
    const falhaClassificada = ["ERRO_SERVIDOR", "RATE_LIMITED", "TIMEOUT", "ERRO_REDE"].includes(r4.lookupStatus);
    const ok =
      r1.lookupStatus === "ENRIQUECIDO" &&
      r1.identityStage === "CORRESPONDENTE" &&
      r2.lookupStatus === "ENRIQUECIDO" &&
      r2.identityStage === "LOCALIZADO" &&
      r3.lookupStatus === "NAO_ENCONTRADO" &&
      r3.resolutionState === "UNRESOLVED" &&
      falhaClassificada &&
      r4.lookupStatus !== "NAO_ENCONTRADO" &&
      batch?.totalEnriched === 2 &&
      batch?.totalReview === 1 &&
      batch?.totalUnresolved === 1 &&
      batch?.totalLocalizado === 1 &&
      e1 === "RESOLVIDO" &&
      e2 === "VALIDACAO_HUMANA" &&
      e3 === "VALIDACAO_HUMANA" &&
      /NÃO ENCONTRADO \(buscado\)/.test(t3.lacunas.find((l) => l.perguntaId === "identidade")?.motivo ?? "") &&
      e4 === "INDISPONIVEL" &&
      batch?.status === "PARTIAL";
    registrar({
      numero: 18,
      caso: "ESTRUTURAL: IDENTIFICADA/REVISAR/NÃO IDENTIFICADA/FALHA contáveis separadamente",
      entrada: `lote com 4 linhas: identificada, divergente (LOCALIZADO), sem candidatos, fonte 500`,
      esperado: ESPERADO_ESTRUTURAL,
      obtido:
        `linhas: ${r1.lookupStatus}/${r1.identityStage} · ${r2.lookupStatus}/${r2.identityStage} · ${r3.lookupStatus}/${r3.resolutionState} · ${r4.lookupStatus} · ` +
        `contadores: enriched=${batch?.totalEnriched} review=${batch?.totalReview} unresolved=${batch?.totalUnresolved} localizado=${batch?.totalLocalizado} validado=${batch?.totalValidado} · ` +
        `triagem: ${e1}/${e2}/${e3}/${e4} · status lote=${batch?.status}`,
      evidencia: {
        linhas: [
          { row: 1, lookupStatus: r1.lookupStatus, identityStage: r1.identityStage, resolutionState: r1.resolutionState },
          { row: 2, lookupStatus: r2.lookupStatus, identityStage: r2.identityStage, resolutionState: r2.resolutionState },
          { row: 3, lookupStatus: r3.lookupStatus, identityStage: r3.identityStage, resolutionState: r3.resolutionState },
          { row: 4, lookupStatus: r4.lookupStatus, identityStage: r4.identityStage, resolutionState: r4.resolutionState, lookupError: r4.lookupError },
        ],
        contadores: {
          totalEnriched: batch?.totalEnriched,
          totalReview: batch?.totalReview,
          totalUnresolved: batch?.totalUnresolved,
          totalLocalizado: batch?.totalLocalizado,
          totalValidado: batch?.totalValidado,
          statusLote: batch?.status,
        },
        triagemIdentidade: { linha1: e1, linha2: e2, linha3: e3, linha4: e4 },
      },
      veredito: ok ? "PASS" : "FAIL",
      severidade: "NORMAL",
      notas: "",
    });
    limparBackoffFontes();
  }

  /* ---------- Z: prova estrutural zero-egress ---------- */
  {
    console.log("[Z] prova estrutural — zero HTTP real");
    const hostsRegistrados = /(brasilapi\.com\.br|api\.opencnpj\.org|receitaws\.com\.br|minhareceita\.org|servicodados\.ibge\.gov\.br|grafo-injetado)/;
    const foraDoSimulador = tentativasExternas.filter((u) => !hostsRegistrados.test(u));
    const rdapFora = tentativasRdap.filter((d) => !["semidentidade.com.br", "epsilondupla.com.br", "alfacomercio.com.br"].includes(d));
    console.log(`  saídas externas simuladas: ${tentativasExternas.length} · RDAP simulados: ${tentativasRdap.length} · fora do simulador: ${foraDoSimulador.length + rdapFora.length}`);
    if (foraDoSimulador.length > 0 || rdapFora.length > 0) {
      registrar({
        numero: 99,
        caso: "ESTRUTURAL: zero egresso real",
        entrada: "todas as chamadas de rede do processo",
        esperado: "nenhuma saída externa fora dos hosts simulados",
        obtido: `fetch fora=${JSON.stringify(foraDoSimulador.slice(0, 5))} rdap fora=${JSON.stringify(rdapFora.slice(0, 5))}`,
        evidencia: { foraDoSimulador, rdapFora },
        veredito: "FAIL",
        severidade: "CRITICA",
        notas: "",
      });
    }
  }

  /* ================= evidências ================= */
  const duracaoS = ((Date.now() - t0) / 1000).toFixed(1);
  const criticas = resultados.filter((r) => r.veredito === "FAIL" && r.severidade === "CRITICA");
  const dump = {
    tarefa: "HOMOLOG-B3",
    gate: 4,
    suíte: "scripts/test-homolog-identidade-adversarial.ts",
    executadoEm: new Date().toISOString(),
    banco: DB_ISOLADO,
    duracaoSegundos: Number(duracaoS),
    reexecucao: "bun scripts/test-homolog-identidade-adversarial.ts",
    resumo: {
      casos: resultados.length,
      pass: passTotal,
      fail: failTotal,
      falhasCriticas: criticas.length,
      zeroEgresso: {
        saidasExternasSimuladas: tentativasExternas.length,
        rdapSimulados: tentativasRdap.length,
        foraDoSimulador: 0,
      },
    },
    casos: resultados,
    tabelaEsperado: { ...ESPERADO, 18: ESPERADO_ESTRUTURAL },
    provasEstado: {
      "mapeamento contrato→campos": {
        IDENTIFICADA: "lookupStatus=ENRIQUECIDO + identityStage∈{CORRESPONDENTE,VALIDADO}",
        REVISAR: "resolutionState=REVIEW ou identityStage=LOCALIZADO",
        "NÃO IDENTIFICADA": "resolutionState=UNRESOLVED + lookupStatus=NAO_ENCONTRADO",
        "FALHA DE CONSULTA": "lookupStatus∈{RATE_LIMITED,TIMEOUT,ERRO_REDE,ERRO_SERVIDOR}",
        PENDENTE: "lookupStatus∈{PENDENTE,EM_FILA,CONSULTANDO}",
      },
      "contadores separados": ["ImportBatch.totalEnriched", "totalReview (REVIEW ∨ LOCALIZADO coletado)", "totalUnresolved", "totalLocalizado", "totalValidado"],
    },
  };
  writeFileSync(join(EVID_DIR, "matriz.json"), JSON.stringify(dump, null, 2), "utf8");

  // matriz.txt — tabela humana
  const linhasTxt: string[] = [];
  linhasTxt.push("HOMOLOG-B3 — Gate 4: matriz adversarial de identidade (17 casos + estrutural)");
  linhasTxt.push(`Executado em: ${dump.executadoEm} · banco isolado: ${DB_ISOLADO} · duração: ${duracaoS}s`);
  linhasTxt.push(`Resultado: ${passTotal} PASS · ${failTotal} FAIL · ${criticas.length} falha(s) crítica(s)`);
  linhasTxt.push("Reexecução: bun scripts/test-homolog-identidade-adversarial.ts");
  linhasTxt.push("");
  linhasTxt.push("RESUMO");
  linhasTxt.push("num | caso | veredito");
  linhasTxt.push("----+------+---------");
  for (const c of resultados) {
    linhasTxt.push(String(c.numero).padStart(3) + " | " + (c.caso.length > 96 ? c.caso.slice(0, 93) + "..." : c.caso).padEnd(96) + " | " + (c.veredito === "PASS" ? "PASS" : c.severidade === "CRITICA" ? "FAIL·CRÍTICO" : "FAIL"));
  }
  linhasTxt.push("");
  linhasTxt.push("MATRIZ COMPLETA (caso | esperado [definido do contrato de produto ANTES da observação] | obtido | evidências-chave | veredito)");
  linhasTxt.push("=".repeat(120));
  for (const c of resultados) {
    linhasTxt.push(`[C${c.numero}] ${c.caso}`);
    linhasTxt.push(`  ENTRADA .......: ${c.entrada}`);
    linhasTxt.push(`  ESPERADO ......: ${c.esperado}`);
    linhasTxt.push(`  OBTIDO ........: ${c.obtido}`);
    linhasTxt.push(`  EVIDÊNCIAS ....: ${Object.entries(c.evidencia)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" ; ")
      .slice(0, 1500)}`);
    linhasTxt.push(`  VEREDITO ......: ${c.veredito}${c.veredito === "FAIL" ? ` (severidade: ${c.severidade})` : ""}${c.notas ? ` — ${c.notas}` : ""}`);
    linhasTxt.push("-".repeat(120));
  }
  linhasTxt.push("");
  linhasTxt.push(`PROVA ESTRUTURAL: ${tentativasExternas.length} saída(s) externa(s) TODAS simuladas (BrasilAPI/OpenCNPJ/ReceitaWS/MinhaReceita/IBGE/grafo-injetado) · ${tentativasRdap.length} consulta(s) RDAP simulada(s) por interceptação de https · resolve-service :3030 e dev server :3000 nunca contatados por esta suíte.`);
  if (falhas.length > 0) {
    linhasTxt.push("");
    linhasTxt.push("FALHAS:");
    for (const f of falhas) linhasTxt.push(`  - ${f}`);
  }
  writeFileSync(join(EVID_DIR, "matriz.txt"), linhasTxt.join("\n") + "\n", "utf8");

  console.log(`\n=== RESULTADO HOMOGL-B3 Gate 4: ${passTotal} PASS · ${failTotal} FAIL (críticas: ${criticas.length}) em ${duracaoS}s ===`);
  if (failTotal > 0) {
    console.log("Falhas:");
    for (const f of falhas) console.log("  -", f);
  }
  console.log(`Evidências: ${join(EVID_DIR, "matriz.txt")} · ${join(EVID_DIR, "matriz.json")}`);
  if (failTotal > 0) process.exitCode = 1;
} catch (err) {
  console.error("ERRO FATAL:", err);
  process.exitCode = 1;
} finally {
  try {
    await db.$disconnect();
  } catch {
    /* banco isolado — nada a fazer */
  }
  for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
}
