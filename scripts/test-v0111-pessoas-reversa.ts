/**
 * test-v0111-pessoas-reversa.ts — GATE 4 da MISSÃO DE CONSOLIDAÇÃO:
 * investigação reversa de pessoas integrada à base v0.11.1.
 *
 * Método (padrão test-homolog-relacoes-grafo):
 *  - banco ISOLADO em /tmp (DATABASE_URL antes dos imports dinâmicos);
 *  - globalThis.fetch SUBSTITUÍDO por simulador que CONTA toda saída externa —
 *    a leitura reversa (lib + rotas) deve produzir ZERO chamadas externas;
 *  - casos sintéticos exigidos pelo contrato: pessoa com 30 filiais da mesma
 *    raiz; pessoa em várias raízes independentes; homônimos; dados faltantes;
 *    vínculos antigos; cobertura honesta; papel por nome não confirmado.
 *
 * Uso: bun scripts/test-v0111-pessoas-reversa.ts
 */
import { execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { jsonRes } from "./lib/json-res";

/* ================= 0) banco isolado ================= */
// G7 (ambiente): tmpdir() em vez de /tmp fixo e process.execPath em vez de `bunx`
// no PATH — o mesmo script roda no CI Linux e no Windows (bun em ~/.bun/bin).
const DB_ISOLADO = join(tmpdir(), "consol-gate4-pessoas.db");
const DB_JOURNAL = `${DB_ISOLADO}-journal`;
for (const f of [DB_ISOLADO, DB_JOURNAL]) rmSync(f, { force: true });
execSync(`"${process.execPath}" x prisma db push --skip-generate`, { env: { ...process.env, DATABASE_URL: `file:${DB_ISOLADO}` }, cwd: process.cwd(), stdio: "pipe" });
process.env.DATABASE_URL = `file:${DB_ISOLADO}`;
delete process.env.SCOUT_EXPORT_TOKEN;
delete process.env.SCOUT_AUTH_REQUIRED; // modo OPEN: handlers chamados direto

const EVID_DIR = join(process.cwd(), "qa", "consolidacao-v0111", "gate4");
mkdirSync(EVID_DIR, { recursive: true });

/* ============ simulador de fontes (ZERO HTTP real) ============ */
const GRAFO = new Map<string, { status: number; json: unknown }>();
const saidas: string[] = [];
let saidasMomento = 0;
const fetchOriginal = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const externo = /^https?:\/\//i.test(url) && !url.includes("127.0.0.1") && !url.includes("localhost");
  if (!externo) return fetchOriginal(input as never, init);
  saidas.push(url);
  if (url.startsWith("https://grafo.minhareceita.org/")) {
    const path = url.slice("https://grafo.minhareceita.org".length);
    const alvo = GRAFO.get(path);
    if (alvo) return jsonRes(alvo.status, alvo.json);
    return jsonRes(404, { message: `Identificador ${path.replace("/", "")} não encontrado ou sem conexões.` });
  }
  if (url.includes("servicodados.ibge.gov.br/")) return jsonRes(200, []);
  throw new Error(`SIMULADOR GATE4: saída externa não cadastrada: ${url}`);
}) as typeof fetch;

/* ================= imports dinâmicos (DEPOIS do env) ================= */
const { db } = await import("../src/lib/db");
const { POST: postRelacoesRota } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/route");
const { POST: postExpansaoRota } = await import("../src/app/api/imports/[id]/rows/[rowNumber]/relacoes-societarias/expansao/route");
const { GET: getPessoasRota } = await import("../src/app/api/imports/[id]/pessoas/route");
const { GET: getPessoaRota } = await import("../src/app/api/imports/[id]/pessoas/[participanteId]/route");
const { lerPessoasReversas, lerPessoaReversa } = await import("../src/lib/pessoas/reversa");
const { NextRequest } = await import("next/server");
void NextRequest;

/* ================= verificação ================= */
let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, extra = ""): boolean {
  if (cond) {
    pass++;
    console.log(`  PASS  ${nome}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    falhas.push(nome);
    console.log(`  FAIL  ${nome}${extra ? ` — ${extra}` : ""}`);
  }
  return cond;
}

/* ================= CNPJs sintéticos (DV válido) ================= */
function cnpjValido(base: string): string {
  const b = `${base}0001`;
  let c = 0, p = 5;
  for (let i = 0; i < 12; i++) { c += Number(b[i]) * p--; if (p < 2) p = 9; }
  const d1 = c % 11 < 2 ? 0 : 11 - (c % 11);
  c = 0; p = 6;
  for (let i = 0; i < 13; i++) { const d = i < 12 ? Number(b[i]) : d1; c += d * p--; if (p < 2) p = 9; }
  const d2 = c % 11 < 2 ? 0 : 11 - (c % 11);
  return b + String(d1) + String(d2);
}
const CNPJ_LOJA = cnpjValido("99555001");       // raiz 99555001 — linha 1
const CNPJ_OBRA = cnpjValido("99555002");       // raiz 99555002 — linha 2
const CNPJ_PJ_PART = cnpjValido("77777001");    // participante PJ

const HASH_MARIA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";   // PF — MARIA SOARES
const HASH_HOMONIMO = "f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1"; // PF — MARIA SOARES (OUTRA pessoa)
const HASH_JOAO = "11223344556677889900aabbccddeeff";      // PF — JOAO PEREIRA
const ID_INDETERMINADO = "12345678";                        // 8 dígitos — sem prova

/* ================= lote sintético ================= */
const batch = await db.importBatch.create({ data: { fileName: "QA-gate4-reversa.csv", storedPath: "", fileSize: 0, status: "DONE" } });
await db.importRow.create({
  data: {
    batchId: batch.id, rowNumber: 1, rawCnpj: CNPJ_LOJA, normalizedCnpj: CNPJ_LOJA, cnpjStatus: "VALIDA",
    lookupStatus: "ENRIQUECIDO", legalName: "LOJA MERIDIANO LTDA", branchType: "MATRIZ", branchIdentifier: 1,
    cnpjRoot: CNPJ_LOJA.slice(0, 8),
    sociosJson: JSON.stringify([{ nome: "MARIA SOARES", qual: "Sócio-Administrador", entrada: "1998-05-10" }]),
  },
});
await db.importRow.create({
  data: {
    batchId: batch.id, rowNumber: 2, rawCnpj: CNPJ_OBRA, normalizedCnpj: CNPJ_OBRA, cnpjStatus: "VALIDA",
    lookupStatus: "ENRIQUECIDO", legalName: "OBRA NORTE ENGENHARIA SA", branchType: "MATRIZ", branchIdentifier: 1,
    cnpjRoot: CNPJ_OBRA.slice(0, 8),
  },
});

/* relações da LOJA (raiz A): MARIA (qual por nome), JOÃO (sem qual), INDETERMINADO */
await db.relacaoSocietariaCache.create({
  data: {
    cnpj: CNPJ_LOJA, fonte: "MinhaReceita Grafo", baseDados: "2026-10",
    coletadoEm: new Date("2026-10-25T12:00:00Z"), atualizadoEm: new Date("2026-10-25T12:00:00Z"),
    validoAte: new Date("2026-11-24T12:00:00Z"),
    relacoesJson: JSON.stringify([
      { participanteId: HASH_MARIA, tipo: "PF", nomePublico: "MARIA SOARES", cnpjParticipante: null, razaoSocialPj: null, qualificacao: { qual: "Sócio-Administrador", entrada: "1998-05-10", origem: "cadastro" } },
      { participanteId: HASH_JOAO, tipo: "PF", nomePublico: "JOAO PEREIRA", cnpjParticipante: null, razaoSocialPj: null },
      { participanteId: ID_INDETERMINADO, tipo: "INDETERMINADO", nomePublico: "CONTA 12345678", cnpjParticipante: null, razaoSocialPj: null },
    ]),
    totalParticipantes: 3,
  },
});
/* relações da OBRA (raiz B): HOMÔNIMO de MARIA (outra pessoa), PJ participante */
await db.relacaoSocietariaCache.create({
  data: {
    cnpj: CNPJ_OBRA, fonte: "MinhaReceita Grafo", baseDados: "2026-10",
    coletadoEm: new Date("2026-10-25T12:05:00Z"), atualizadoEm: new Date("2026-10-25T12:05:00Z"),
    validoAte: new Date("2026-11-24T12:05:00Z"),
    relacoesJson: JSON.stringify([
      { participanteId: HASH_HOMONIMO, tipo: "PF", nomePublico: "MARIA SOARES", cnpjParticipante: null, razaoSocialPj: null },
      { participanteId: CNPJ_PJ_PART, tipo: "PJ", nomePublico: "INVESTIMENTOS SUL SA", cnpjParticipante: CNPJ_PJ_PART, razaoSocialPj: "INVESTIMENTOS SUL SA" },
    ]),
    totalParticipantes: 2,
  },
});

/* quadro ampliado da MARIA (hash1): 30 estabelecimentos da MESMA raiz + 3 de outra + 2 de outra */
const RAIZ_FILIAIS = "88888001";
const RAIZ_OUTRA1 = "77777002";
const RAIZ_OUTRA2 = "66666003";
const empresasMaria = [
  ...Array.from({ length: 30 }, (_, i) => ({ cnpj: `${RAIZ_FILIAIS}${String(100 + i).padStart(4, "0")}`, razaoSocial: "REDE ESTRELA MATRIZ LTDA" })),
  ...Array.from({ length: 3 }, (_, i) => ({ cnpj: `${RAIZ_OUTRA1}${String(200 + i).padStart(4, "0")}`, razaoSocial: "HOLDING PARALELA A SA" })),
  ...Array.from({ length: 2 }, (_, i) => ({ cnpj: `${RAIZ_OUTRA2}${String(300 + i).padStart(4, "0")}`, razaoSocial: "AGRO VALE B SA" })),
];
await db.quadroParticipanteCache.create({
  data: {
    participanteId: HASH_MARIA, tipoParticipante: "PF", rotulo: "MARIA SOARES", fonte: "MinhaReceita Grafo",
    baseDados: "2026-10", coletadoEm: new Date("2026-10-25T12:10:00Z"), validoAte: new Date("2026-11-24T12:10:00Z"),
    empresasJson: JSON.stringify(empresasMaria), totalEmpresas: 35, truncado: false,
  },
});
/* quadro do PJ participante: o quadro de SÓCIOS dele (não empresas em que participa) */
await db.quadroParticipanteCache.create({
  data: {
    participanteId: CNPJ_PJ_PART, tipoParticipante: "PJ", rotulo: "INVESTIMENTOS SUL SA", fonte: "MinhaReceita Grafo",
    baseDados: "2026-10", coletadoEm: new Date("2026-10-25T12:12:00Z"), validoAte: new Date("2026-11-24T12:12:00Z"),
    empresasJson: JSON.stringify([{ cnpj: cnpjValido("99999001"), razaoSocial: "SOCIO UNICO PJ LTDA" }]),
    totalEmpresas: 1, truncado: false,
  },
});

/* ================= CASO 1 — agregação reversa do lote ================= */
console.log("\n== CASO 1 — agregação reversa do lote (leitura pura) ==");
saidasMomento = saidas.length;
const tudo = await lerPessoasReversas(batch.id);
check("agregação devolve dados", !!tudo && tudo.pessoas.length > 0);
check("ZERO consulta externa na agregação reversa", saidas.length === saidasMomento, `${saidas.length - saidasMomento} chamadas externas`);
if (tudo) {
  const r = tudo.resumo;
  check("5 participantes distintos (por identificador, nunca por nome)", r.cobertura.participantesTotal === 5, `total=${r.cobertura.participantesTotal}`);
  check("2 empresas do lote com relações coletadas", r.linhasComRelacoes === 2);
  check("3 pessoas físicas identificadas (hash próprio)", r.pfIdentificadas === 3, `pf=${r.pfIdentificadas}`);
  check("1 participante com identidade incerta", r.participantesIncertos === 1);
  check("1 participação de pessoa jurídica", r.pjParticipacoes === 1);
  check("cobertura honesta: 2 quadros ampliados de 5 participantes", r.cobertura.quadrosAmpliados === 2, `ampliados=${r.cobertura.quadrosAmpliados}`);
  check("papel por nome não confirmado contado separadamente", r.papeisPorNomeNaoConfirmados === 1, `porNome=${r.papeisPorNomeNaoConfirmados}`);
}

/* ================= CASO 2 — pessoa com 30 filiais da MESMA raiz ================= */
console.log("\n== CASO 2 — MARIA SOARES: 30 filiais da mesma raiz + raízes independentes ==");
const maria = tudo?.pessoas.find((p) => p.participanteId === HASH_MARIA);
check("MARIA existe na agregação", !!maria);
if (maria) {
  // raízes: 3 do quadro (88888001/77777002/66666003) + 1 do lote (99555001) = 4
  check("raízes distintas = 4 (3 do quadro + 1 do lote) — NUNCA 35 empresas", maria.raizesDistintas === 4, `raízes=${maria.raizesDistintas}`);
  check("estabelecimentos citados = 36 (35 do quadro + 1 do lote, CNPJs completos)", maria.estabelecimentosCitados === 36, `estabelecimentos=${maria.estabelecimentosCitados}`);
  check("quadro ampliado presente com total real preservado (35)", maria.quadro?.totalEmpresas === 35);
  check("quadro: empresas distintas por RAIZ = 3 (mesma regra da interface)", maria.quadro?.totalPessoasJuridicas === 3, `pjs=${maria.quadro?.totalPessoasJuridicas}`);
  check("vínculo antigo preservado (papel desde 1998-05-10)", maria.papeis[0]?.desde === "1998-05-10");
  check("papel registrado com rótulo honesto de associação por nome", maria.papeis[0]?.papelPorNome === true && maria.papeis[0]?.papel === "Sócio-Administrador");
  check("empresas no lote: linha 1 (LOJA MERIDIANO)", maria.empresasNoLote.length === 1 && maria.empresasNoLote[0].rowNumber === 1);
}

/* ================= CASO 3 — homônimos nunca unidos ================= */
console.log("\n== CASO 3 — homônimos: mesmo nome, identidades separadas ==");
const homonimo = tudo?.pessoas.find((p) => p.participanteId === HASH_HOMONIMO);
check("dois registros separados com o mesmo nome público", !!maria && !!homonimo && maria.participanteId !== homonimo?.participanteId);
if (homonimo) {
  check("homônimo: 1 outro participante com o mesmo nome no lote", homonimo.homonimosNoLote === 1, `homonimos=${homonimo.homonimosNoLote}`);
  check("homônimo: sem quadro ampliado (cobertura honesta, não 'sem vínculos')", homonimo.quadro === null);
  check("homônimo: empresa no lote = linha 2 (OBRA NORTE)", homonimo.empresasNoLote[0]?.rowNumber === 2);
}
if (maria) check("MARIA também vê 1 homônimo no lote", maria.homonimosNoLote === 1);

/* ================= CASO 4 — dados faltantes e identidade incerta ================= */
console.log("\n== CASO 4 — dados faltantes e identidade incerta ==");
const joao = tudo?.pessoas.find((p) => p.participanteId === HASH_JOAO);
const incerto = tudo?.pessoas.find((p) => p.participanteId === ID_INDETERMINADO);
check("JOÃO existe sem papel (dados faltantes não inventam papel)", !!joao && joao.papeis.length === 0);
check("JOÃO: raízes do lote contadas (1), estabelecimentos (1)", joao?.raizesDistintas === 1 && joao?.estabelecimentosCitados === 1, `raízes=${joao?.raizesDistintas}`);
check("INDETERMINADO marcado com identidade incerta", incerto?.identidadeIncerta === true);
check("INDETERMINADO nunca vira PF por eliminação", incerto?.tipo === "INDETERMINADO");

/* ================= CASO 5 — PJ: quadro de sócios ≠ empresas dela ================= */
console.log("\n== CASO 5 — participante PJ: quadro de sócios não vira empresas dela ==");
const pj = tudo?.pessoas.find((p) => p.participanteId === CNPJ_PJ_PART);
check("PJ existe com CNPJ próprio formatado", !!pj && pj.cnpjParticipanteFormatado === `${CNPJ_PJ_PART.slice(0, 2)}.${CNPJ_PJ_PART.slice(2, 5)}.${CNPJ_PJ_PART.slice(5, 8)}/${CNPJ_PJ_PART.slice(8, 12)}-${CNPJ_PJ_PART.slice(12)}`);
if (pj) {
  // raízes: lote (99555002) + ela mesma (77777001) = 2 — o quadro de sócios NÃO entra
  check("raízes = 2 (lote + ela mesma) — quadro de sócios não inflou", pj.raizesDistintas === 2, `raízes=${pj.raizesDistintas}`);
  check("estabelecimentos = 2 (lote + ela mesma)", pj.estabelecimentosCitados === 2);
}

/* ================= CASO 6 — rota API do dossiê da pessoa ================= */
console.log("\n== CASO 6 — rotas API (leitura protegida, zero externa) ==");
saidasMomento = saidas.length;
const reqLista = new NextRequest(`http://localhost:3000/api/imports/${batch.id}/pessoas`, { method: "GET" });
const resLista = await getPessoasRota(reqLista, { params: Promise.resolve({ id: batch.id }) });
const corpoLista = await resLista.json();
check("GET /pessoas → 200 ok com resumo e pessoas", resLista.status === 200 && corpoLista.ok === true && Array.isArray(corpoLista.pessoas));
const reqPessoa = new NextRequest(`http://localhost:3000/api/imports/${batch.id}/pessoas/${HASH_MARIA}`, { method: "GET" });
const resPessoa = await getPessoaRota(reqPessoa, { params: Promise.resolve({ id: batch.id, participanteId: HASH_MARIA }) });
const corpoPessoa = await resPessoa.json();
check("GET /pessoas/:id → 200 com a pessoa correta (por identificador)", resPessoa.status === 200 && corpoPessoa.ok && corpoPessoa.pessoa?.participanteId === HASH_MARIA);
check("ZERO consulta externa nas rotas de leitura reversa", saidas.length === saidasMomento, `${saidas.length - saidasMomento} chamadas externas`);
const reqPessoaFora = new NextRequest(`http://localhost:3000/api/imports/${batch.id}/pessoas/inexistente0000`, { method: "GET" });
const resFora = await getPessoaRota(reqPessoaFora, { params: Promise.resolve({ id: batch.id, participanteId: "inexistente0000" }) });
const corpoFora = await resFora.json();
check("participante fora do lote → ok com pessoa null (nunca erro falso)", resFora.status === 200 && corpoFora.ok === true && corpoFora.pessoa === null);

/* ================= CASO 7 — integração com a coleta REAL (serviço) ================= */
console.log("\n== CASO 7 — a coleta sob comando alimenta a mesma leitura reversa ==");
// registra resposta simulada do grafo para a LOJA e coleta via SERVIÇO (com fetcher simulado)
GRAFO.set(`/${CNPJ_LOJA}`, {
  status: 200,
  json: [{ id: HASH_JOAO, nome: "JOAO PEREIRA", tipo: "pessoa juridica", cnpj: CNPJ_PJ_PART, razao_social: "INVESTIMENTOS SUL SA" }],
});
// (a coleta real já foi simulada pelo cache acima; aqui provamos que o REUSO de cache do serviço
//  e a leitura reversa leem o MESMO contrato — investigarRelacoes via rota não é reexecutado
//  para não duplicar dados: a prova de integração é a leitura reversa do MESMO cache que a
//  quadrosEmCacheDaLinha serve)
const { quadrosEmCacheDaLinha } = await import("../src/lib/relations/service");
saidasMomento = saidas.length;
const quadrosServico = await quadrosEmCacheDaLinha(batch.id, 1);
check("serviço de quadros em cache e leitura reversa coexistem no mesmo cache", quadrosServico.ok === true);
check("ZERO externa na leitura do serviço", saidas.length === saidasMomento);
const tudoDepois = await lerPessoasReversas(batch.id);
check("leitura reversa estável após leitura do serviço (nada mutado)", !!tudoDepois && tudoDepois.pessoas.length === 5);

/* ================= CASO 8 — lote sem relações ================= */
console.log("\n== CASO 8 — lote sem relações: resumo vazio honesto ==");
const batch2 = await db.importBatch.create({ data: { fileName: "QA-gate4-vazio.csv", storedPath: "", fileSize: 0, status: "DONE" } });
await db.importRow.create({
  data: { batchId: batch2.id, rowNumber: 1, rawCnpj: cnpjValido("11111001"), normalizedCnpj: cnpjValido("11111001"), cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", legalName: "SEM RELACOES LTDA", cnpjRoot: "11111001" },
});
const vazio = await lerPessoasReversas(batch2.id);
check("lote sem relações → resumo com zeros e nota honesta", !!vazio && vazio.resumo.cobertura.participantesTotal === 0 && vazio.pessoas.length === 0 && vazio.resumo.nota.length > 0);

/* ================= relatório ================= */
console.log(`\n============================================================`);
console.log(`GATE 4 (INVESTIGAÇÃO REVERSA): ${pass} PASS · ${fail} FAIL`);
const relatorio = { pass, fail, falhas, saidasExternas: saidas };
writeFileSync(join(EVID_DIR, "relatorio.json"), JSON.stringify(relatorio, null, 2));
if (fail > 0) {
  console.log(falhas.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
void jsonRes; // manter referência do helper (usado no simulador)
