/**
 * Testes offline v0.10.3 — CORRECT_DELTA do retorno da auditoria v0.10.2.
 * Sem rede, determinístico, sem IA, sem chamada paga.
 *
 * Cobre os TRÊS pontos do despacho:
 *  1. TEMPORALIDADE FISCAL (regra GERAL, sem lista curta de verbos):
 *     · "A empresa está no Lucro Presumido atualmente" → reescrita (FALHAVA na v0.10.2);
 *     · "É optante do Lucro Presumido" → reescrita (FALHAVA na v0.10.2);
 *     · duas frases de porte (uma correta, uma incorreta) → incorreta corrigida,
 *       correta intacta (a v0.10.2 pulava o texto inteiro);
 *     · regime histórico corretamente atribuído → PERMANECE INTACTO;
 *     · gramática correta (sem "Atualmente Uma…", sem dupla espaço, sem minúscula no início);
 *     · guarda aplicada a TODOS os campos do dossiê (perfil, quem é, operação,
 *       aderência, hipóteses…) — não só sintese_executiva;
 *     · "VALIDAR" (instrução) e evidências (citações verbatim) intocados.
 *  2. DIAGNÓSTICO 429: HTTP 200 com ok:false → NÃO-sucesso (classificarSonda).
 *  3. Portão de reuso: PROMPT_VERSION subiu — dossiês antigos não são reutilizados.
 *
 * Uso: bun scripts/test-v0103-regressoes.ts
 * Evidência: qa/guarda-temporalidade-v0.10.3.json (casos + resultados, sem dado sensível)
 */
import { writeFileSync } from "node:fs";
import {
  guardaTemporalidade,
  aplicaGuardaTemporalidadeDossie,
  porteCadastralNome,
  PROMPT_VERSION,
  type AccountAiDossier,
} from "../src/lib/enrich/ai";
import { classificarSonda } from "./diagnostico-429";

let falhas = 0;
let total = 0;
const evidencia: { secao: string; caso: string; entrada: string | null; saida: string; resultado: "PASS" | "FAIL"; detalhe?: string }[] = [];

function ok(cond: boolean, rotulo: string, detalhe = "") {
  total++;
  if (cond) console.log(`  PASS ${rotulo}`);
  else {
    falhas++;
    console.log(`  FAIL ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}
function caso(secao: string, nome: string, entrada: string | null, saida: string, cond: boolean, detalhe = "") {
  ok(cond, nome, detalhe);
  evidencia.push({ secao, caso: nome, entrada, saida, resultado: cond ? "PASS" : "FAIL", detalhe: detalhe || undefined });
}

const REGIME_BOTICA = "Lucro Presumido (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)";
const EXT_BOTICA = { regimeTributario: REGIME_BOTICA, porte: "MICRO EMPRESA", capitalSocial: "100000" };

/* ================= 1. TEMPORALIDADE — casos EXATOS do despacho ================= */
console.log("== CASO QUE FALHOU na v0.10.2: 'A empresa está no Lucro Presumido atualmente.' ==");
const t1 = guardaTemporalidade("A empresa está no Lucro Presumido atualmente.", EXT_BOTICA);
caso("temporalidade", "afirmação atual reescrita", t1.texto, t1.texto, /Uma fonte agregadora registra Lucro Presumido para o exercício de 2024/.test(t1.texto));
caso("temporalidade", "'atualmente' não sobrevive", null, t1.texto, !/atualmente/i.test(t1.texto));
caso("temporalidade", "sem 'está no Lucro Presumido' como fato", null, t1.texto, !/est[áa] no Lucro Presumido/i.test(t1.texto));
caso("temporalidade", "ressalva do regime vigente presente", null, t1.texto, /regime vigente n(ã|a)o foi confirmado/.test(t1.texto));
caso("temporalidade", "sem afirmação de operação atual (nenhum verbo lista)", null, t1.texto, !/opera|optante|enquadrad/i.test(t1.texto));

console.log("== CASO QUE FALHOU na v0.10.2: 'É optante do Lucro Presumido.' ==");
const t2 = guardaTemporalidade("É optante do Lucro Presumido.", EXT_BOTICA);
caso("temporalidade", "optante 'do' reescrito (com fonte)", t2.texto, t2.texto, /Uma fonte agregadora registra Lucro Presumido para o exercício de 2024/.test(t2.texto));
const t2b = guardaTemporalidade("É optante do Lucro Presumido.", null);
caso("temporalidade", "optante sem dado de fonte → neutralizado honesto", t2b.texto, t2b.texto, /O regime tributário \(Lucro Presumido\) n(ã|a)o foi confirmado como vigente/.test(t2b.texto));

console.log("== DUAS frases de porte: uma correta, outra incorreta ==");
const textoPorteDuplo = "Empresa com porte cadastral de microempresa. É uma empresa de grande porte.";
const t3 = guardaTemporalidade(textoPorteDuplo, EXT_BOTICA);
caso("temporalidade", "frase correta PERMANECE intacta", t3.texto, t3.texto, t3.texto.startsWith("Empresa com porte cadastral de microempresa."));
caso("temporalidade", "frase incorreta deixa de ser fato operacional", null, t3.texto, !/[ée] uma empresa de grande porte/i.test(t3.texto));
caso("temporalidade", "frase incorreta neutralizada (não atribuída ao cadastro)", null, t3.texto, /porte operacional real n(ã|a)o confirmado/.test(t3.texto));

console.log("== REGIME HISTÓRICO CORRETAMENTE ATRIBUÍDO — permanece INTACTO ==");
const historicoCorreto =
  "Empresa com porte cadastral de microempresa. Uma fonte agregadora apresenta Lucro Presumido para o exercício de 2024; o regime vigente não foi confirmado.";
const t4 = guardaTemporalidade(historicoCorreto, EXT_BOTICA);
caso("temporalidade", "histórico intacto byte a byte", t4.texto, t4.texto, t4.texto === historicoCorreto);
caso("temporalidade", "zero intervenções", null, JSON.stringify(t4.correcoes), t4.correcoes.length === 0);
const t4b = guardaTemporalidade("Apurou pelo Lucro Real em 2023, conforme fonte agregada.", EXT_BOTICA);
caso("temporalidade", "histórico com ano citado intacto", t4b.texto, t4b.texto, /Apurou pelo Lucro Real em 2023/.test(t4b.texto) && !/n(ã|a)o foi confirmado como vigente/.test(t4b.texto));

console.log("== REDAÇÃO FINAL GRAMATICALMENTE CORRETA ==");
const g1 = guardaTemporalidade("Atualmente opera sob o regime de Lucro Presumido.", EXT_BOTICA);
caso("gramática", "defeito v0.10.2 'Atualmente Uma…' eliminado", g1.texto, g1.texto, !/Atualmente\s+Uma/.test(g1.texto) && g1.texto.startsWith("Uma fonte agregadora"));
const g2 = guardaTemporalidade("A empresa  está no Lucro Presumido   atualmente.", EXT_BOTICA);
caso("gramática", "sem espaço duplo na saída", g2.texto, g2.texto, !/\s{2,}/.test(g2.texto));
const g3 = guardaTemporalidade("Uma fonte agregadora apresenta Lucro Presumido para o exercício de 2024.", EXT_BOTICA);
caso("gramática", "ressalva anexada com '; ' (frase bem-formada)", g3.texto, g3.texto, g3.texto.endsWith("exercício de 2024; o regime vigente não foi confirmado."));
const g4 = guardaTemporalidade("A empresa está no Lucro Presumido. O regime vigente não foi confirmado.", EXT_BOTICA);
caso("gramática", "a guarda não CRIA ressalva duplicada", g4.texto, g4.texto, (g4.texto.match(/regime vigente n(ã|a)o foi confirmado/gi) ?? []).length === 1);
const g5 = guardaTemporalidade("é optante do Simples Nacional.", { regimeTributario: "Simples Nacional (exercício 2024, informação fiscal de fonte agregada — não confirma operação vigente)" });
caso("gramática", "frase reescrita inicia com maiúscula", g5.texto, g5.texto, g5.texto.startsWith("Uma fonte agregadora"));

console.log("== IDEMPOTÊNCIA (rodar a guarda sobre a própria saída não muda nada) ==");
let idem = "A empresa está no Lucro Presumido atualmente. É uma microempresa em crescimento.";
let rodadasComCorrecao = 0;
for (let i = 0; i < 3; i++) {
  const r = guardaTemporalidade(idem, EXT_BOTICA);
  if (r.correcoes.length) rodadasComCorrecao++;
  idem = r.texto;
}
caso("gramática", "correção acontece em 1 rodada (não oscila)", null, idem, rodadasComCorrecao === 1);

console.log("== NORMALIZAÇÃO DE PORTE DO CADASTRO ==");
caso("porte", "MICRO EMPRESA → microempresa", null, porteCadastralNome("MICRO EMPRESA") ?? "", porteCadastralNome("MICRO EMPRESA") === "microempresa");
caso("porte", "EPP → empresa de pequeno porte", null, porteCadastralNome("EPP") ?? "", porteCadastralNome("EPP") === "empresa de pequeno porte");
caso("porte", "MEI → microempreendedor individual", null, porteCadastralNome("MEI") ?? "", porteCadastralNome("MEI") === "microempreendedor individual");

/* ============ 1b. GUARDA EM TODO O DOSSIÊ (não só sintese_executiva) ============ */
console.log("== aplicaGuardaTemporalidadeDossie: TODOS os campos textuais ==");
const dossieSujo: AccountAiDossier = {
  sintese: "Opera sob o regime de Lucro Presumido e é uma microempresa.",
  perfil: "A empresa está no Lucro Presumido atualmente.",
  teia: [],
  operacao: ["É optante do Lucro Presumido.", "Operação em Teresina/PI."],
  tecnologia: [],
  aderencia: [
    {
      produto: "ERP",
      processo: "A empresa está no Lucro Presumido atualmente e soma notas manualmente",
      hipotese: "FATO: é optante do Lucro Presumido → CONSEQUÊNCIA POSSÍVEL: rotina fiscal manual → VALIDAR: quem fecha as obrigações",
    },
  ],
  tese: "",
  profunda: true,
  quemE: "A empresa está no Lucro Presumido atualmente e atua em Teresina.",
  oQueFaz: ["Manipulação de fórmulas"],
  escalaEstrutura: ["É uma empresa de pequeno porte segundo a equipe"],
  pessoas: [],
  mudancasSinais: [],
  naoSabemos: ["O regime vigente não foi confirmado."],
  hipotesesDetalhadas: [
    {
      fato: "A empresa está no Lucro Presumido atualmente",
      consequencia: "Possui obrigações fiscais recorrentes",
      validar: "Confirmar com a contabilidade qual o regime vigente",
    },
  ],
};
const gd = aplicaGuardaTemporalidadeDossie({ dossier: dossieSujo, hypotheses: [], extra: EXT_BOTICA });
ok(!/est[áa] no Lucro Presumido atualmente/i.test(gd.dossier.perfil), "perfil_classificacao corrigido", gd.dossier.perfil);
ok(/Uma fonte agregadora registra/.test(gd.dossier.perfil), "perfil com atribuição honesta", gd.dossier.perfil);
ok(gd.dossier.operacao.every((t) => !/optante do/i.test(t)), "operacao[] corrigida", JSON.stringify(gd.dossier.operacao));
ok(gd.dossier.operacao[1] === "Operação em Teresina/PI.", "item sem problema PERMANECE idêntico", gd.dossier.operacao[1]);
ok(!/est[áa] no Lucro Presumido atualmente/i.test(gd.dossier.quemE ?? ""), "quem_e corrigido", gd.dossier.quemE ?? "");
ok(!/[ée] uma empresa de pequeno porte/i.test(gd.dossier.escalaEstrutura?.[0] ?? ""), "escala_estrutura porte corrigido", gd.dossier.escalaEstrutura?.[0] ?? "");
ok(/porte cadastral de empresa de pequeno porte|porte operacional real/.test(gd.dossier.escalaEstrutura?.[0] ?? ""), "escala com redação cadastral", gd.dossier.escalaEstrutura?.[0] ?? "");
ok(!/est[áa] no Lucro Presumido atualmente/i.test(gd.dossier.aderencia?.[0]?.processo ?? ""), "aderência.processo corrigido", gd.dossier.aderencia?.[0]?.processo ?? "");
ok(!/optante do/i.test(gd.dossier.aderencia?.[0]?.hipotese ?? ""), "aderência.hipotese corrigido", gd.dossier.aderencia?.[0]?.hipotese ?? "");
ok(/VALIDAR: quem fecha as obrigações/.test(gd.dossier.aderencia?.[0]?.hipotese ?? ""), "estrutura FATO→CONSEQ→VALIDAR preservada", gd.dossier.aderencia?.[0]?.hipotese ?? "");
ok(!/est[áa] no Lucro Presumido atualmente/i.test(gd.dossier.hipotesesDetalhadas?.[0]?.fato ?? ""), "hipótese.fato corrigido", gd.dossier.hipotesesDetalhadas?.[0]?.fato ?? "");
ok(gd.dossier.hipotesesDetalhadas?.[0]?.validar === "Confirmar com a contabilidade qual o regime vigente", "hipótese.VALIDAR (instrução) INTACTO", gd.dossier.hipotesesDetalhadas?.[0]?.validar ?? "");
ok(gd.dossier.naoSabemos?.[0] === "O regime vigente não foi confirmado.", "nao_sabemos intocado (já é honesto)", gd.dossier.naoSabemos?.[0] ?? "");
ok(gd.correcoes.some((c) => c.startsWith("perfil:")), "correções rotuladas POR CAMPO p/ telemetria", JSON.stringify(gd.correcoes.slice(0, 4)));

console.log("== evidências (citações verbatim de fontes) NÃO são reescritas ==");
const dossieComEvidencia: AccountAiDossier = {
  sintese: "Conta saudável do varejo.",
  perfil: "perfil ok",
  teia: [],
  operacao: [],
  tecnologia: [],
  aderencia: [],
  tese: "",
  profunda: true,
  evidencias: [
    {
      claim: "Sítio da empresa afirma: opera sob o regime de Lucro Presumido",
      status: "INDICIO",
      source: "site oficial",
      url: null,
      relevancia: "baixa",
    },
  ],
};
const ge = aplicaGuardaTemporalidadeDossie({ dossier: dossieComEvidencia, hypotheses: [], extra: EXT_BOTICA });
ok(ge.dossier.evidencias?.[0]?.claim === dossieComEvidencia.evidencias![0].claim, "citação verbatim preservada (integridade da prova)", ge.dossier.evidencias?.[0]?.claim ?? "");
ok(ge.correcoes.length === 0, "zero intervenções quando só a evidência menciona regime", JSON.stringify(ge.correcoes));

console.log("== hipóteses no formato de setas (sem rótulos) — VALIDAR intacto ==");
const gh = aplicaGuardaTemporalidadeDossie(
  { dossier: dossieComEvidencia, hypotheses: ["A empresa está no Lucro Presumido atualmente → risco de rotina fiscal manual → validar regime com a contabilidade"], extra: EXT_BOTICA }
);
ok(!/est[áa] no Lucro Presumido atualmente/i.test(gh.hypotheses[0]), "fato (1º segmento) corrigido", gh.hypotheses[0]);
ok(/validar regime com a contabilidade$/.test(gh.hypotheses[0]), "segmento VALIDAR intacto", gh.hypotheses[0]);

/* ================= 2. DIAGNÓSTICO 429 — classificação da sonda ================= */
console.log("== classificarSonda: HTTP 200 com ok:false NÃO é sucesso (v0.10.3) ==");
ok(classificarSonda(200, false, "") === "resposta_200_corpo_nao_ok", "200 + ok:false → resposta_200_corpo_nao_ok", classificarSonda(200, false, ""));
ok(classificarSonda(200, true, "") === "ok", "200 + ok:true → ok");
ok(classificarSonda(200, null, "") === "ok", "200 sem corpo JSON (ex.: HTML ReceitaWS) → ok por status");
ok(classificarSonda(429, null, "") === "cota_429", "429 → cota_429");
ok(classificarSonda(404, null, "") === "sem_registro_404", "404 → sem_registro_404");
ok(classificarSonda(null, null, "The operation was aborted due to timeout") === "rede_ou_timeout", "sem resposta + timeout → rede_ou_timeout");
ok(classificarSonda(null, null, "getaddrinfo ENOTFOUND") === "erro", "sem resposta + DNS → erro");
ok(classificarSonda(500, null, "") === "erro", "500 → erro");

/* ================= 3. PORTÃO DE REUSO — versão de prompt subiu ================= */
console.log("== PROMPT_VERSION: dossiês gerados antes da v0.10.3 deixam de ser reutilizados ==");
// v0.10.4: guarda com semântica de temporalidade (ano isolado não atribui) + fatos
// preservados por cláusula — a versão sobe (2.3.0-v0104) e dossiês antigos deixam de ser reutilizados
ok(PROMPT_VERSION === "2.3.0-v0104", "versão atual 2.3.0-v0104", PROMPT_VERSION);
ok(PROMPT_VERSION !== "2.2.0-v0103", "portão de reuso invalida dossiês da v0.10.3 (ano-isolado-atribui e perda de fatos corrigidos na v0.10.4)");

/* ================= EVIDÊNCIA (sem dado sensível — frases sintéticas) ================= */
const falhasEvid = evidencia.filter((e) => e.resultado === "FAIL").length;
writeFileSync(
  "qa/guarda-temporalidade-v0.10.3.json",
  JSON.stringify(
    {
      geradoEm: new Date().toISOString(),
      suíte: "test-v0103-regressoes.ts (offline, determinístico, sem rede e sem IA)",
      escopo: "guarda de temporalidade fiscal/porte v0.10.3 + classificação da sonda 429 + portão de reuso",
      resumo: { total, falhas: falhasEvid + (falhas - falhasEvid), pass: total - falhas },
      casos: evidencia,
      classificacao_sonda: {
        regra_v0_10_3: "HTTP 200 com ok:false no corpo → resposta_200_corpo_nao_ok (NÃO é sucesso)",
        exemplos: [
          { http: 200, corpo: { ok: false }, resultado: classificarSonda(200, false, "") },
          { http: 200, corpo: { ok: true }, resultado: classificarSonda(200, true, "") },
          { http: 429, corpo: null, resultado: classificarSonda(429, null, "") },
          { http: 404, corpo: null, resultado: classificarSonda(404, null, "") },
        ],
      },
      decisões_documentadas: [
        "frase com regime + marca de exercício/fonte agregada/ano → INTACTA (histórico correto permanece)",
        "frase com regime sem atribuição histórica → reescrita POR INTEIRO (gramática garantida)",
        "porte citado CONTRA o porte do cadastro → neutralizado ('porte operacional real não confirmado'), nunca atribuído ao registro",
        "VALIDAR (hipóteses) e evidencias[].claim ficam INTACTOS — instrução de conversa e citação verbatim",
      ],
    },
    null,
    2
  ) + "\n"
);
console.log("");
console.log(`TOTAL ${total - falhas}/${total} PASS${falhas ? ` — ${falhas} FAIL` : ""}`);
console.log("evidência: qa/guarda-temporalidade-v0.10.3.json");
process.exit(falhas ? 1 : 0);
