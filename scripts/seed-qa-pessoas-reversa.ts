/**
 * Seed QA de relações reversas para o lote QA-mesa-sintetico-v0110 (dados sintéticos,
 * ZERO consulta externa: grava direto nos caches — mesmo padrão dos seeds aprovados).
 * Re-execução idempotente: limpa os caches sintéticos antes de recriar.
 *
 * GUARDA DE ISOLAMENTO (auditoria do Planejador, desvio B):
 * Este seed grava dados SINTÉTICOS e EXIGE um banco QA explicitamente isolado.
 * - Sem DATABASE_URL definido ........ RECUSA (nunca assume um banco padrão);
 * - DATABASE_URL = banco do operador . RECUSA (db/custom.db é só do operador);
 * - Fora de /tmp e sem "qa" no nome .. RECUSA (evita alvo ambíguo).
 * Uso seguro:
 *   DATABASE_URL="file:/tmp/qa-pessoas-reversa.db" bun scripts/seed-qa-pessoas-reversa.ts
 * O banco QA precisa antes conter o lote da mesa (rodar seed-qa-mesa-sintetico.ts
 * contra o MESMO banco QA) — o seed aborta com erro se a linha-base não existir.
 */
import { resolve, basename } from "node:path";

const DB_URL = (process.env.DATABASE_URL ?? "").trim();
if (!DB_URL) {
  console.error("RECUSADO: DATABASE_URL não definido. Este seed grava dados sintéticos e EXIGE um banco QA explicitamente isolado — nunca grava no banco padrão.");
  console.error('Uso seguro: DATABASE_URL="file:/tmp/qa-pessoas-reversa.db" bun scripts/seed-qa-pessoas-reversa.ts');
  process.exit(1);
}
const caminhoAlvo = resolve(DB_URL.startsWith("file:") ? DB_URL.slice("file:".length) : DB_URL);
// raiz do projeto derivada do PRÓPRIO SCRIPT (robusto a cwd alternativo)
const raizProjeto = resolve(import.meta.dir, "..");
const caminhoOperador = resolve(raizProjeto, "db", "custom.db");
if (caminhoAlvo === caminhoOperador || basename(caminhoAlvo) === "custom.db") {
  console.error(`RECUSADO: DATABASE_URL aponta para o banco do operador (${caminhoAlvo}). Dados sintéticos NUNCA entram no banco do operador — use um banco QA isolado (ex.: /tmp/qa-pessoas-reversa.db).`);
  process.exit(1);
}
if (!/[/\\]tmp[/\\]/i.test(caminhoAlvo) && !/qa/i.test(basename(caminhoAlvo))) {
  console.error(`RECUSADO: o banco alvo (${caminhoAlvo}) deve ficar em /tmp ou ter "qa" no nome do arquivo — alvo ambíguo não é aceito.`);
  process.exit(1);
}
console.log(`seed QA pessoas-reversa: banco alvo ISOLADO → ${caminhoAlvo}`);
const { db } = await import("/home/z/my-project/src/lib/db");
import { calcDvs } from "/home/z/my-project/src/lib/cnpj";
const cnpjComDv = (base12: string): string => { const [d1, d2] = calcDvs(base12); return base12 + String(d1) + String(d2); };

const RAIZ_REDE = "88888000";
const RAIZ_H1 = "77777004";
const RAIZ_H2 = "66666005";
const CNPJ_LOJA = cnpjComDv("990001000001"); // linha 1 do lote QA da mesa
const HASH_MARIA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const HASH_JOAO = "11223344556677889900aabbccddeeff";
const HASH_HOMONIMO = "f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1";
const ID_INDET = "12345678";
const CNPJ_PJ = cnpjComDv("777770010001");

// limpa caches sintéticos anteriores (apenas estes ids)
await db.quadroParticipanteCache.deleteMany({ where: { participanteId: { in: [HASH_MARIA, HASH_JOAO, HASH_HOMONIMO, CNPJ_PJ] } } });
await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: CNPJ_LOJA } });

const linha1 = await db.importRow.findFirst({ where: { legalName: { contains: "Metalúrgica Horizonte Vale" } }, orderBy: { rowNumber: "asc" } });
if (!linha1) { console.error("lote QA da mesa não encontrado — rode seed-qa-mesa-sintetico.ts antes"); process.exit(1); }

await db.relacaoSocietariaCache.create({
  data: {
    cnpj: CNPJ_LOJA, fonte: "MinhaReceita Grafo", baseDados: "2026-10",
    coletadoEm: new Date("2026-10-25T10:00:00Z"), atualizadoEm: new Date("2026-10-25T10:00:00Z"),
    validoAte: new Date("2026-11-24T10:00:00Z"),
    relacoesJson: JSON.stringify([
      { participanteId: HASH_MARIA, tipo: "PF", nomePublico: "MARIA SOARES", cnpjParticipante: null, razaoSocialPj: null, qualificacao: { qual: "Sócio-Administrador", entrada: "1998-05-10", origem: "cadastro" } },
      { participanteId: HASH_JOAO, tipo: "PF", nomePublico: "JOAO PEREIRA", cnpjParticipante: null, razaoSocialPj: null },
      { participanteId: HASH_HOMONIMO, tipo: "PF", nomePublico: "MARIA SOARES", cnpjParticipante: null, razaoSocialPj: null },
      { participanteId: ID_INDET, tipo: "INDETERMINADO", nomePublico: "CONTA 12345678", cnpjParticipante: null, razaoSocialPj: null },
      { participanteId: CNPJ_PJ, tipo: "PJ", nomePublico: "INVESTIMENTOS SUL SA", cnpjParticipante: CNPJ_PJ, razaoSocialPj: "INVESTIMENTOS SUL SA" },
    ]),
    totalParticipantes: 5,
  },
});
const empresasMaria = [
  ...Array.from({ length: 30 }, (_, i) => ({ cnpj: `${RAIZ_REDE}${String(100 + i).padStart(4, "0")}`, razaoSocial: "REDE ESTRELA COMERCIO LTDA" })),
  ...Array.from({ length: 3 }, (_, i) => ({ cnpj: `${RAIZ_H1}${String(200 + i).padStart(4, "0")}`, razaoSocial: "HOLDING PARALELA A SA" })),
  ...Array.from({ length: 2 }, (_, i) => ({ cnpj: `${RAIZ_H2}${String(300 + i).padStart(4, "0")}`, razaoSocial: "AGRO VALE B SA" })),
];
await db.quadroParticipanteCache.create({
  data: {
    participanteId: HASH_MARIA, tipoParticipante: "PF", rotulo: "MARIA SOARES", fonte: "MinhaReceita Grafo",
    baseDados: "2026-10", coletadoEm: new Date("2026-10-25T10:10:00Z"), validoAte: new Date("2026-11-24T10:10:00Z"),
    empresasJson: JSON.stringify(empresasMaria), totalEmpresas: 35, truncado: false,
  },
});
console.log(`seed OK: relações do lote QA ${linha1.batchId} linha ${linha1.rowNumber} (${CNPJ_LOJA}) — 5 participantes, quadro da MARIA com 35 estabelecimentos`);
process.exit(0);
