/**
 * Testes offline v0.10.2 — TEMPORALIDADE fiscal/porte na síntese do dossiê
 * (item 3 do despacho do operador). Sem rede, determinístico, sem IA.
 *
 * Cobre:
 *  - guardaTemporalidade(): reescrita de regime de exercício + porte cadastral;
 *  - redação JÁ correta não é alterada (idempotência);
 *  - EVIDENCE_RULES nos dois níveis de prompt (rápido e profundo);
 *  - avisos determinísticos no buildUserMessage (regime/porte/capital);
 *  - PROMPT_VERSION registrada (mudou prompt, sobe a versão).
 * Uso: bun scripts/test-v0102-regressoes.ts
 */
import {
  guardaTemporalidade,
  buildUserMessage,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_DEEP,
  PROMPT_VERSION,
  type AccountAiInput,
} from "../src/lib/enrich/ai";

let falhas = 0;
let total = 0;
function ok(cond: boolean, rotulo: string, detalhe = "") {
  total++;
  if (cond) console.log(`  PASS ${rotulo}`);
  else {
    falhas++;
    console.log(`  FAIL ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const REGIME_BOTICA = "Lucro Presumido (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)";

console.log("== guardaTemporalidade: caso EXATAMENTE relatado pelo operador (genérico, vale p/ qualquer empresa) ==");
const casoOpera = "Opera sob o regime de Lucro Presumido e é uma microempresa.";
const r1 = guardaTemporalidade(casoOpera, { regimeTributario: REGIME_BOTICA, porte: "ME", capitalSocial: "100000" });
ok(!/opera sob/i.test(r1.texto), "NÃO afirma mais 'Opera sob o regime'", r1.texto);
ok(/Uma fonte agregadora registra Lucro Presumido para o exercício de 2024/i.test(r1.texto), "atribuição à fonte com exercício 2024", r1.texto);
ok(/regime vigente não foi confirmado/i.test(r1.texto), "ressalva 'regime vigente não foi confirmado' presente", r1.texto);
ok(/porte cadastral de microempresa/i.test(r1.texto), "'é uma microempresa' virou porte cadastral", r1.texto);
ok(!/\bé uma microempresa\b/i.test(r1.texto), "porte não resta como fato operacional", r1.texto);
ok(r1.correcoes.length >= 2, "correções registradas p/ telemetria", JSON.stringify(r1.correcoes));

console.log("== guardaTemporalidade: redação JÁ correta NÃO é alterada ==");
const casoCorreto =
  "Empresa com porte cadastral de microempresa. Uma fonte agregadora apresenta Lucro Presumido para o exercício de 2024; o regime vigente não foi confirmado.";
const r2 = guardaTemporalidade(casoCorreto, { regimeTributario: REGIME_BOTICA, porte: "ME" });
ok(r2.correcoes.length === 0, "zero intervenções", JSON.stringify(r2.correcoes));
ok(r2.texto === casoCorreto, "texto idêntico ao original");

console.log("== guardaTemporalidade: 'Optante pelo Simples Nacional' reescrito (outra empresa) ==");
const r3 = guardaTemporalidade("Optante pelo Simples Nacional.", {
  regimeTributario: "Simples Nacional (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)",
});
ok(/Uma fonte agregadora registra Simples Nacional para o exercício de 2024/i.test(r3.texto), "Simples Nacional atribuído à fonte", r3.texto);
ok(/regime vigente não foi confirmado/i.test(r3.texto), "ressalva presente", r3.texto);

console.log("== guardaTemporalidade: porte sem regime na fonte ==");
const r4 = guardaTemporalidade("É uma empresa de pequeno porte e atua no varejo.", { regimeTributario: "" });
ok(/tem porte cadastral de empresa de pequeno porte/i.test(r4.texto), "porte como cadastral mesmo sem regime", r4.texto);
ok(/atua no varejo/i.test(r4.texto), "resto da frase preservado", r4.texto);

console.log("== guardaTemporalidade: 'possui estrutura de microempresa' (forma observada ao vivo) ==");
const r4b = guardaTemporalidade(
  "Possui estrutura de microempresa com sócio único na gestão.",
  { regimeTributario: "", porte: "MICRO EMPRESA" }
);
ok(/tem porte cadastral de microempresa/i.test(r4b.texto), "'possui estrutura de' virou porte cadastral", r4b.texto);
ok(/com sócio único na gestão/i.test(r4b.texto), "resto da frase preservado", r4b.texto);

console.log("== guardaTemporalidade: sem dados fiscais → intocada ==");
const original = "Conta do setor de logística com operação em duas praças.";
const r5 = guardaTemporalidade(original, null);
ok(r5.texto === original && r5.correcoes.length === 0, "texto intocado", JSON.stringify(r5.correcoes));

console.log("== Prompts: regra de TEMPORALIDADE presente nos DOIS níveis ==");
ok(/TEMPORALIDADE E NATUREZA DOS DADOS/i.test(SYSTEM_PROMPT), "SYSTEM_PROMPT (rápido) traz a regra");
ok(/TEMPORALIDADE E NATUREZA DOS DADOS/i.test(SYSTEM_PROMPT_DEEP), "SYSTEM_PROMPT_DEEP (profundo) traz a regra");
ok(/PORTE CADASTRAL ≠ PORTE OPERACIONAL/i.test(SYSTEM_PROMPT), "distinção porte cadastral ≠ operacional");
ok(/REGIME DE EXERCÍCIO ANTERIOR ≠ REGIME VIGENTE/i.test(SYSTEM_PROMPT), "distinção regime de exercício ≠ vigente");
ok(/ABERTURA CADASTRAL ≠ FUNDAÇÃO/i.test(SYSTEM_PROMPT), "distinção abertura ≠ fundação");
ok(/CAPITAL SOCIAL ≠ FATURAMENTO/i.test(SYSTEM_PROMPT), "distinção capital ≠ faturamento");
ok(/SÓCIO-ADMINISTRADOR ≠ DECISOR COMERCIAL/i.test(SYSTEM_PROMPT), "distinção sócio ≠ decisor");
ok(/Uma fonte agregadora apresenta X para o exercício de Y/i.test(SYSTEM_PROMPT), "redação esperada ensinada no prompt");

console.log("== buildUserMessage: avisos determinísticos entram/saem com o dado ==");
const inputCheio: AccountAiInput = {
  normalizedCnpj: "08044783000117",
  legalName: "EMPRESA TESTE LTDA",
  tradeName: null,
  cnaeDescription: "Farmácia de manipulação",
  municipality: "TERESINA",
  uf: "PI",
  branchType: "MATRIZ",
  registrationStatus: "ATIVA",
  openingDate: "2013-03-14",
  socios: [],
  extra: {
    regimeTributario: REGIME_BOTICA,
    porte: "MICRO EMPRESA",
    capitalSocial: "100000",
  } as AccountAiInput["extra"],
};
const msg = buildUserMessage(inputCheio);
ok(/aviso_regime_tributario/.test(msg), "aviso_regime_tributario presente quando há regime");
ok(/NUNCA afirme que a conta 'opera sob'/.test(msg), "aviso proíbe 'opera sob' literalmente");
ok(/aviso_porte/.test(msg), "aviso_porte presente quando há porte");
ok(/aviso_capital_social/.test(msg), "aviso_capital_social presente quando há capital");
const inputSemFiscal: AccountAiInput = { ...inputCheio, extra: null };
const msg2 = buildUserMessage(inputSemFiscal);
ok(!/aviso_regime_tributario/.test(msg2), "sem regime → aviso ausente");
ok(!/aviso_porte/.test(msg2), "sem porte → aviso ausente");

console.log("== PROMPT_VERSION ==");
// v0.10.3: a guarda mudou de comportamento (regra geral por frase + todos os campos) —
// a versão sobe por design e o portão de reuso invalida dossiês antigos. As regras
// de TEMPORALIDADE no prompt (testadas acima) permanecem idênticas.
// v0.10.4: a guarda ganhou semântica de temporalidade (ano isolado não atribui) e
// preservação de fatos por cláusula — a versão sobe e o assert acompanha POR DESIGN
ok(PROMPT_VERSION === "2.3.0-v0104", "versão do bloco de prompts atualizada", PROMPT_VERSION);

console.log("");
console.log(`TOTAL ${total - falhas}/${total} PASS${falhas ? ` — ${falhas} FAIL` : ""}`);
process.exit(falhas ? 1 : 0);
