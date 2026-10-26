/**
 * Testes offline v0.10.1 — QSA truncado (item 5 do despacho) + integridade do
 * portão de capacidade (item 4). Sem rede, determinístico.
 * Uso: bun scripts/test-v0101-regressoes.ts
 */
import { fillGaps, gapsOf, CAMPOS_POR_FONTE, type CnpjLookupData } from "../src/lib/enrich/sources";

let falhas = 0;
function ok(cond: boolean, rotulo: string, detalhe = "") {
  if (cond) console.log(`  PASS ${rotulo}`);
  else {
    falhas++;
    console.log(`  FAIL ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const fichaBase: CnpjLookupData = {
  legalName: "EMPRESA TESTE LTDA",
  tradeName: "TESTE",
  registrationStatus: "ATIVA",
  statusDate: "2026-01-01",
  situationReason: "",
  branchType: "MATRIZ",
  branchIdentifier: 1,
  openingDate: "2020-01-01",
  cnaeCode: "4751201",
  cnaeDescription: "Comércio varejista",
  municipality: "CUIABA",
  uf: "MT",
  socios: [],
  extra: {
    capitalSocial: "1000",
    naturezaJuridica: "Sociedade Empresária Limitada",
    porte: "DEMAIS",
    simples: "Sim",
    mei: "Não",
    email: "a@b.c",
    telefone: "(65) 3000-0000",
    telefone2: "",
    regimeTributario: "",
    endereco: "Rua Teste 1",
    cnaesSecundarios: [],
    codigoMunicipioIbge: "5103403",
    ibge: null,
  },
};

console.log("== fillGaps: flag qsaTruncados viaja com os sócios (v0.10.1) ==");
const fichaComQsaTruncado: CnpjLookupData = {
  ...fichaBase,
  statusDate: "", // dataSituacao vazio → também será complementado
  socios: Array.from({ length: 500 }, (_, i) => ({ nome: `SOCIO ${i + 1}`, qual: "Sócio", entrada: "" })),
  extra: { ...fichaBase.extra, qsaTruncados: true },
};
const res = fillGaps(fichaBase, fichaComQsaTruncado);
ok(res.campos.includes("qsa"), "qsa é campo de complementação", JSON.stringify(res.campos));
ok(res.merged.extra.qsaTruncados === true, "flag qsaTruncados PROPAGADO no merge", String(res.merged.extra.qsaTruncados));
ok(res.merged.socios.length === 500, "sócios completos no merge (teto 500)", String(res.merged.socios.length));

const fichaComQsaNormal: CnpjLookupData = {
  ...fichaComQsaTruncado,
  extra: { ...fichaComQsaTruncado.extra, qsaTruncados: undefined },
};
const res2 = fillGaps(fichaBase, fichaComQsaNormal);
ok(res2.merged.extra.qsaTruncados !== true, "sem flag na fonte → sem flag no merge (não inventa)", String(res2.merged.extra.qsaTruncados));

console.log("== portão de capacidade: integridade do mapa (v0.10.1) ==");
const chavesGap = new Set([
  "nomeFantasia", "email", "telefone", "capitalSocial", "naturezaJuridica", "porte",
  "simples", "mei", "regimeTributario", "endereco", "qsa", "cnaesSecundarios",
  "codigoMunicipioIbge", "dataSituacao",
]);
for (const [fonte, cap] of Object.entries(CAMPOS_POR_FONTE)) {
  const invalidas = [...cap].filter((c) => !chavesGap.has(c));
  ok(invalidas.length === 0, `${fonte}: capacidades ⊆ chaves de gapsOf`, invalidas.join(",") || "");
  ok(cap.size > 0, `${fonte}: mapa não vazio`, String(cap.size));
}
// consistência: gapsOf de uma ficha com TUDO vazio deve ser subset da união das capacidades
const tudoVazio: CnpjLookupData = JSON.parse(JSON.stringify(fichaBase));
tudoVazio.tradeName = "";
tudoVazio.statusDate = "";
tudoVazio.socios = [];
tudoVazio.extra.email = "";
tudoVazio.extra.telefone = "";
tudoVazio.extra.capitalSocial = "";
tudoVazio.extra.naturezaJuridica = "";
tudoVazio.extra.porte = "";
tudoVazio.extra.simples = "";
tudoVazio.extra.mei = "";
tudoVazio.extra.regimeTributario = "";
tudoVazio.extra.endereco = "";
tudoVazio.extra.cnaesSecundarios = [];
tudoVazio.extra.codigoMunicipioIbge = "";
const uni = new Set(Object.values(CAMPOS_POR_FONTE).flatMap((s) => [...s]));
const fora = gapsOf(tudoVazio).filter((g) => !uni.has(g));
ok(fora.length === 0, "toda lacuna é preenchível por ALGUMA fonte da cadeia", fora.join(",") || "");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
