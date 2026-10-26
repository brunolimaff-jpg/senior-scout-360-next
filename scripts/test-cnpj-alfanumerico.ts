/**
 * Sanity do CNPJ alfanumérico (P1 v0.10.0 + raiz alfanumérica v0.10.1) — sem rede,
 * determinístico. A RFB permite letras nas 12 PRIMEIRAS posições (inclusive a raiz):
 * exemplos oficiais 00.000.000/E08G-12 e 12.ABC.345/01DE-35.
 * Uso: bun scripts/test-cnpj-alfanumerico.ts
 */
import {
  normalizeCnpj,
  formatCnpj,
  validateCnpj,
  calcDvs,
  cnpjFromRoot,
  isCnpjAlfanumerico,
} from "../src/lib/cnpj";
import { classifyToken } from "../src/lib/extract";

let falhas = 0;
function ok(cond: boolean, rotulo: string, detalhe = "") {
  if (cond) console.log(`  PASS ${rotulo}`);
  else {
    falhas++;
    console.log(`  FAIL ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

console.log("== DV pela tabela RFB (A=17..Z=42) ==");
ok(calcDvs("00000000E08G") === "12", "calcDvs(00000000E08G) === '12' (exemplo oficial RFB)", calcDvs("00000000E08G"));
ok(calcDvs("12ABC34501DE") === "35", "calcDvs(12ABC34501DE) === '35' (exemplo oficial RFB com letras na raiz)", calcDvs("12ABC34501DE"));
// DV do numérico clássico: 11.222.333/0001-81
ok(calcDvs("112223330001") === "81", "calcDvs(112223330001) === '81' (numérico legado)", calcDvs("112223330001"));

console.log("== validateCnpj ==");
const r1 = validateCnpj("00.000.000/E08G-12");
ok(r1.valid && r1.normalized === "00000000E08G12" && r1.alfanumerico, "00.000.000/E08G-12 válido alfanumérico", JSON.stringify(r1));
const r2 = validateCnpj("00.000.000/e08g-12");
ok(r2.valid && r2.normalized === "00000000E08G12", "minúsculas normalizadas para maiúsculas", JSON.stringify(r2));
const r3 = validateCnpj("11.222.333/0001-81");
ok(r3.valid && !r3.alfanumerico, "numérico legado 11.222.333/0001-81 continua válido", JSON.stringify(r3));
const r4 = validateCnpj("33.000.167/0001-01");
ok(r4.valid, "Petrobras 33.000.167/0001-01 válida", JSON.stringify(r4));
const r5 = validateCnpj("33.000.167/0001-02");
ok(!r5.valid && /verificador/i.test(r5.reason), "DV errado detectado", JSON.stringify(r5));
const r6 = validateCnpj("00.000.000/E08G-99");
ok(!r6.valid && r6.reason.includes("esperado 12"), "DV alfanumérico errado → 'esperado 12'", JSON.stringify(r6));
const r7 = validateCnpj("12.ABC.345/01DE-35");
ok(r7.valid && r7.normalized === "12ABC34501DE35" && r7.alfanumerico,
  "12.ABC.345/01DE-35 (exemplo oficial RFB, LETRAS NA RAIZ) é VÁLIDO", JSON.stringify(r7));
const r7b = validateCnpj("12.abc.345/01de-35");
ok(r7b.valid && r7b.normalized === "12ABC34501DE35", "letras minúsculas na raiz normalizadas", JSON.stringify(r7b));
const r7c = validateCnpj("12.ABC.345/01DE-99");
ok(!r7c.valid && r7c.reason.includes("esperado 35"), "raiz com letra + DV errado → 'esperado 35'", JSON.stringify(r7c));
const r8 = validateCnpj("00.000.000/E08G-1X");
ok(!r8.valid && /verificadores/.test(r8.reason), "DV com letra rejeitado", JSON.stringify(r8));
const r9 = validateCnpj("12345678000195");
ok(r9.valid && !r9.alfanumerico, "12.345.678/0001-95 válido", JSON.stringify(r9));
const r10 = validateCnpj("00.000.000/0001-00");
ok(!r10.valid, "DV numérico errado continua rejeitado", JSON.stringify(r10));

console.log("== helpers ==");
ok(cnpjFromRoot("00000000", "E08G") === "00000000E08G12", "cnpjFromRoot raiz numérica + ordem E08G", cnpjFromRoot("00000000", "E08G") ?? "null");
ok(cnpjFromRoot("00000000", "0001") === "00000000000191", "cnpjFromRoot numérico BB 0001-91", cnpjFromRoot("00000000", "0001") ?? "null");
ok(cnpjFromRoot("12ABC345", "01DE") === "12ABC34501DE35", "cnpjFromRoot com LETRAS NA RAIZ (exemplo oficial)", cnpjFromRoot("12ABC345", "01DE") ?? "null");
ok(cnpjFromRoot("12.ABC.345", "01/DE") === "12ABC34501DE35", "cnpjFromRoot tolera pontuação na raiz/ordem", cnpjFromRoot("12.ABC.345", "01/DE") ?? "null");
ok(cnpjFromRoot("12ABC3", "01DE") === null, "cnpjFromRoot rejeita raiz com menos de 8 caracteres", String(cnpjFromRoot("12ABC3", "01DE")));
ok(formatCnpj("00000000E08G12") === "00.000.000/E08G-12", "formatCnpj mantém máscara com letras", formatCnpj("00000000E08G12"));
ok(formatCnpj("12ABC34501DE35") === "12.ABC.345/01DE-35", "formatCnpj com letras na raiz", formatCnpj("12ABC34501DE35"));
ok(isCnpjAlfanumerico("00000000E08G12") === true, "isCnpjAlfanumerico E08G");
ok(isCnpjAlfanumerico("12ABC34501DE35") === true, "isCnpjAlfanumerico com letras na raiz");
ok(isCnpjAlfanumerico("33000167000101") === false, "isCnpjAlfanumerico numérico");
ok(normalizeCnpj("00.000.000/e08g-12") === "00000000E08G12", "normalize preserva letras", normalizeCnpj("00.000.000/e08g-12"));
ok(normalizeCnpj("12.ABC.345/01de-35") === "12ABC34501DE35", "normalize com letras na raiz", normalizeCnpj("12.ABC.345/01de-35"));

console.log("== importação (classifyToken) ==");
ok(classifyToken("00.000.000/E08G-12").kind === "CNPJ", "token alfanumérico classificado como CNPJ");
ok(classifyToken("00000000E08G12").kind === "CNPJ", "14 chars alfanuméricos crus como CNPJ");
ok(classifyToken("12.ABC.345/01DE-35").kind === "CNPJ", "token com LETRAS NA RAIZ classificado como CNPJ");
ok(classifyToken("12ABC34501DE35").kind === "CNPJ", "14 chars alfanuméricos (raiz com letra) crus como CNPJ");
ok(classifyToken("33000167000101").kind === "CNPJ", "numérico cru como CNPJ (sem regressão)");
ok(classifyToken("lar.ind.br").kind === "DOMAIN", "domínio continua DOMAIN (sem regressão)");
ok(validateCnpj(classifyToken("00.000.000/E08G-12").raw).valid, "token classificado passa no validador");
ok(validateCnpj(classifyToken("12.ABC.345/01DE-35").raw).valid, "token com letras na raiz passa no validador (DV oficial 35)");
ok(validateCnpj(classifyToken("12.ABC.345/01DE-99").raw).valid === false, "DV errado com letras na raiz continua rejeitado");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
