/**
 * Testes offline v0.10.4 — CORRECT_DELTA + P3-A da auditoria v0.10.3.
 * Sem rede, determinístico, sem IA, sem chamada paga.
 *
 * Cobre:
 *  1. TEMPORALIDADE FISCAL (auditoria v0.10.3 — 3 falhas reproduzidas):
 *     · "A empresa está no Lucro Presumido em 2026." → passava, agora CORRIGIDA
 *       (ano isolado NÃO é atribuição — um ano não comprova o período);
 *     · "Desde 2022, a empresa opera sob o Lucro Presumido atualmente." → idem;
 *     · "A empresa opera sob Lucro Presumido e possui duas unidades de produção."
 *       → regime corrigido E o fato independente (unidades) PRESERVADO;
 *     · afirmação histórica correta → intacta byte a byte;
 *     · negativa → neutralização honesta (sem afirmar o contrário);
 *     · regime vigente EFETIVAMENTE documentado (Simples/MEI no cadastro) → intacto;
 *     · frases compostas: só a cláusula fiscal muda;
 *     · gramática correta + idempotência.
 *  2. FECHAMENTO DO BANCO (testes explícitos em scripts/test-fechamento-banco.ts —
 *     falha de validação, escrita concorrente, rollback e recuperação; 25/25).
 *  3. TELEMETRIA 429 (seis categorias — evento ≠ tentativa ≠ requisição).
 *  4. P3-A CLASSIFICAÇÃO MULTISSETORIAL pelo CNAE (industrial, agroindustrial,
 *     financeira, prestadora de saúde, operadora de plano de saúde — operadora
 *     é K/6550-2/00, NÃO Q/86 — correção da proposta ANS).
 *
 * Uso: bun scripts/test-v0104-regressoes.ts
 * Evidência: qa/guarda-temporalidade-v0.10.4.json
 */
import { writeFileSync } from "node:fs";
import {
  guardaTemporalidade,
  aplicaGuardaTemporalidadeDossie,
  PROMPT_VERSION,
  type AccountAiDossier,
} from "../src/lib/enrich/ai";
import { classificarSetorial, setorDeCnae, divisaoDeCnae, subclasseDeCnae } from "../src/lib/enrich/segmentos";
import { classificarEvento429, classificarSonda, type Categoria429 } from "./diagnostico-429";

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
const idemDe = (texto: string, extra: Parameters<typeof guardaTemporalidade>[1]) =>
  guardaTemporalidade(guardaTemporalidade(texto, extra).texto, extra).correcoes.length === 0;

/* ============ 1. CASOS EXATOS reproduzidos pela auditoria v0.10.3 ============ */
console.log("== CASO 1: 'A empresa está no Lucro Presumido em 2026.' (passava sem correção) ==");
const c1 = guardaTemporalidade("A empresa está no Lucro Presumido em 2026.", EXT_BOTICA);
caso("temporalidade", "ano isolado NÃO mantém afirmação de regime", c1.texto, c1.texto, !/est[áa] no Lucro Presumido/i.test(c1.texto));
caso("temporalidade", "correção com atribuição honesta à fonte", null, c1.texto, /Uma fonte agregadora registra Lucro Presumido para o exercício de 2024/.test(c1.texto));
caso("temporalidade", "ressalva do vigente presente", null, c1.texto, /regime vigente n(ã|a)o foi confirmado/.test(c1.texto));
ok(idemDe("A empresa está no Lucro Presumido em 2026.", EXT_BOTICA), "idempotente");

console.log("== CASO 2: 'Desde 2022, a empresa opera sob o Lucro Presumido atualmente.' (passava) ==");
const c2 = guardaTemporalidade("Desde 2022, a empresa opera sob o Lucro Presumido atualmente.", EXT_BOTICA);
caso("temporalidade", "afirmação de vigência corrigida mesmo com ano na frase", c2.texto, c2.texto, !/opera sob o Lucro Presumido/i.test(c2.texto));
caso("temporalidade", "correção presente com atribuição à fonte", null, c2.texto, /Lucro Presumido para o exercício de 2024/.test(c2.texto));
caso("temporalidade", "sem 'desde 2022' órfão qualificando regime não confirmado", null, c2.texto, !/Desde 2022/.test(c2.texto));
caso("temporalidade", "'atualmente' não sobrevive", null, c2.texto, !/atualmente/i.test(c2.texto));
ok(idemDe("Desde 2022, a empresa opera sob o Lucro Presumido atualmente.", EXT_BOTICA), "idempotente");

console.log("== CASO 3: 'A empresa opera sob Lucro Presumido e possui duas unidades de produção.' (perdia fato) ==");
const c3 = guardaTemporalidade("A empresa opera sob Lucro Presumido e possui duas unidades de produção.", EXT_BOTICA);
caso("temporalidade", "regime corrigido", c3.texto, c3.texto, !/opera sob Lucro Presumido/i.test(c3.texto) && /Lucro Presumido para o exercício de 2024/.test(c3.texto));
caso("temporalidade", "FATO INDEPENDENTE preservado (duas unidades)", null, c3.texto, /duas unidades de produ[çc][ãa]o/.test(c3.texto));
caso("temporalidade", "gramática da cláusula preservada com sujeito", null, c3.texto, /a empresa possui duas unidades/.test(c3.texto));
ok(idemDe("A empresa opera sob Lucro Presumido e possui duas unidades de produção.", EXT_BOTICA), "idempotente");

console.log("== composto com fato após vírgula (sem perder a filial) ==");
const c3b = guardaTemporalidade("A empresa está no Lucro Presumido e possui filial em Manaus.", EXT_BOTICA);
ok(!/est[áa] no Lucro Presumido/i.test(c3b.texto) && /filial em Manaus/.test(c3b.texto), "regime corrigido E filial preservada", c3b.texto);
ok(idemDe("A empresa está no Lucro Presumido e possui filial em Manaus.", EXT_BOTICA), "idempotente");

/* ============ 1b. AFIRMAÇÃO HISTÓRICA CORRETA → INTACTA ============ */
console.log("== afirmação histórica correta permanece INTACTA ==");
const hist1 = "Empresa com porte cadastral de microempresa. Uma fonte agregadora apresenta Lucro Presumido para o exercício de 2024; o regime vigente não foi confirmado.";
const h1 = guardaTemporalidade(hist1, EXT_BOTICA);
caso("temporalidade", "histórico atribuído intacto byte a byte", h1.texto, h1.texto, h1.texto === hist1);
ok(h1.correcoes.length === 0, "zero intervenções", JSON.stringify(h1.correcoes));
const hist2 = "Apurou pelo Lucro Real em 2023, conforme fonte agregada.";
const h2 = guardaTemporalidade(hist2, EXT_BOTICA);
ok(/Apurou pelo Lucro Real em 2023/.test(h2.texto) && !/n(ã|a)o foi confirmado como vigente/.test(h2.texto), "exercício citado com fonte intacto", h2.texto);
const hist3 = "No exercício de 2024, a empresa apurou pelo Lucro Presumido.";
const h3 = guardaTemporalidade(hist3, EXT_BOTICA);
ok(/No exerc[íi]cio de 2024/.test(h3.texto), "atribuição por exercício → intacta", h3.texto);
ok(idemDe(hist1, EXT_BOTICA) && idemDe(hist2, EXT_BOTICA), "histórico idempotente");

/* ============ 1c. NEGATIVA → neutralização honesta (sem afirmar o contrário) ============ */
console.log("== negativa fiscal também é neutralizada (a guarda não cria afirmação) ==");
const neg1 = guardaTemporalidade("A empresa não está no Lucro Presumido.", null);
ok(!/n(ã|a)o est[áa] no Lucro Presumido/i.test(neg1.texto), "negativa não resta como fato confirmado", neg1.texto);
ok(/n(ã|a)o foi confirmado como vigente/.test(neg1.texto), "neutralização honesta (não confirma vigente, não afirma o contrário)", neg1.texto);
ok(idemDe("A empresa não está no Lucro Presumido.", null), "idempotente (sem dupla negação)");

/* ============ 1d. REGIME VIGENTE EFETIVAMENTE DOCUMENTADO → INTACTO ============ */
console.log("== regime vigente documentado no cadastro (Simples/MEI) fica intacto ==");
const doc1 = guardaTemporalidade("A empresa é optante do Simples Nacional.", { simples: "Sim", mei: "Não" });
caso("temporalidade", "Simples com opção vigente no cadastro → byte a byte", doc1.texto, doc1.texto, doc1.texto === "A empresa é optante do Simples Nacional.");
ok(doc1.correcoes.length === 0, "zero intervenções", JSON.stringify(doc1.correcoes));
const doc2 = guardaTemporalidade("É microempreendedor individual.", { mei: "Sim", simples: "Sim" });
ok(doc2.texto === "É microempreendedor individual.", "MEI documentado → intacto", doc2.texto);
const doc3 = guardaTemporalidade("A empresa é optante do Simples Nacional.", { simples: "" });
ok(!/[ée] optante do Simples Nacional/i.test(doc3.texto), "Simples SEM documentação no cadastro → corrigido", doc3.texto);
const doc4 = guardaTemporalidade("A empresa está no Lucro Presumido atualmente.", { simples: "Sim", regimeTributario: REGIME_BOTICA });
ok(!/est[áa] no Lucro Presumido/i.test(doc4.texto), "Lucro Presumido NUNCA é 'documentado vigente' (fontes só têm exercício)", doc4.texto);

/* ============ 1e. GRAMÁTICA + compatibilidade v0.10.2/v0.10.3 ============ */
console.log("== gramática e casos aprovados que continuam valendo ==");
const g1 = guardaTemporalidade("A empresa está no Lucro Presumido atualmente.", EXT_BOTICA);
ok(/Uma fonte agregadora registra Lucro Presumido para o exercício de 2024/.test(g1.texto), "caso v0.10.2 segue corrigido", g1.texto);
ok(!/Atualmente\s+Uma/.test(g1.texto) && g1.texto.length > 0, "sem frase quebrada", g1.texto);
const g2 = guardaTemporalidade("É optante do Lucro Presumido.", null);
ok(/O regime tributário \(Lucro Presumido\) n(ã|a)o foi confirmado como vigente/.test(g2.texto), "sem dado de fonte → neutralização honesta", g2.texto);
const g3 = guardaTemporalidade("A empresa  está no Lucro Presumido   atualmente.", EXT_BOTICA);
ok(!/\s{2,}/.test(g3.texto), "sem espaço duplo", g3.texto);
const g4 = guardaTemporalidade("Empresa com porte cadastral de microempresa. É uma empresa de grande porte.", { regimeTributario: REGIME_BOTICA, porte: "MICRO EMPRESA" });
ok(g4.texto.startsWith("Empresa com porte cadastral de microempresa.") && /porte operacional real n(ã|a)o confirmado/.test(g4.texto), "porte contraditório neutralizado; correto intacto", g4.texto);
const g5 = guardaTemporalidade("É uma microempresa que opera no Lucro Presumido.", EXT_BOTICA);
ok(
  /porte cadastral de microempresa/.test(g5.texto) && !/opera no Lucro Presumido/i.test(g5.texto) && /fonte agregadora/.test(g5.texto) && /confirmado como vigente/.test(g5.texto),
  "porte + regime na MESMA cláusula: os dois corrigidos, nada perdido",
  g5.texto
);
ok(idemDe("É uma microempresa que opera no Lucro Presumido.", EXT_BOTICA), "idempotente");
const g6 = guardaTemporalidade("Segundo fonte agregadora de 2024, a empresa está no Lucro Presumido atualmente.", EXT_BOTICA);
ok(/fonte agregadora de 2024/.test(g6.texto) && !/est[áa] no Lucro Presumido atualmente/i.test(g6.texto), "atribuição citada + claim atual → claim corrigido", g6.texto);

console.log("== dossiê inteiro (campos além da síntese continuam cobertos) ==");
const dossieSujo: AccountAiDossier = {
  sintese: "A empresa está no Lucro Presumido em 2026.",
  perfil: "A empresa opera sob Lucro Presumido e possui duas unidades de produção.",
  teia: [],
  operacao: ["Desde 2022, a empresa opera sob o Lucro Presumido atualmente."],
  tecnologia: [],
  aderencia: [],
  tese: "",
  profunda: true,
};
const gd = aplicaGuardaTemporalidadeDossie({ dossier: dossieSujo, hypotheses: [], extra: EXT_BOTICA });
ok(!/est[áa] no Lucro Presumido em 2026/i.test(gd.dossier.sintese), "sintese corrigida", gd.dossier.sintese);
ok(/duas unidades de produ[çc][ãa]o/.test(gd.dossier.perfil), "perfil: fato independente preservado", gd.dossier.perfil);
ok(gd.dossier.operacao.every((t) => !/opera sob o Lucro Presumido/i.test(t)), "operacao[] corrigida", JSON.stringify(gd.dossier.operacao));
ok(gd.correcoes.some((c) => c.startsWith("perfil:") || c.startsWith("sintese:")), "correções rotuladas por campo", JSON.stringify(gd.correcoes.slice(0, 3)));

/* ============ 2. TELEMETRIA 429 — SEIS CATEGORIAS ============ */
console.log("== classificarEvento429: seis categorias distintas ==");
const casos429: [string, Parameters<typeof classificarEvento429>[0], Categoria429][] = [
  ["limite local (code QUOTA)", { httpStatus: 429, erro: "cota de busca esgotada nesta janela (10/min) — aguarde e reexecute", payloadJson: null }, "limite_local"],
  ["limite local (resumo legado)", { httpStatus: 429, erro: "recusa por cota (429/QUOTA)", payloadJson: null }, "limite_local"],
  ["429 efetivo do provedor (ReceitaWS)", { httpStatus: 429, erro: "429 — limite de requisições; fonte em backoff", payloadJson: null }, "http_429_provedor"],
  ["429 efetivo via upstream_status (v0.10.4)", { httpStatus: 429, erro: "429 Too Many Requests", payloadJson: '{"upstream_status":429}' }, "http_429_provedor"],
  ["429 efetivo via origem_recusa (v0.10.4)", { httpStatus: 500, erro: "gateway recusou", payloadJson: '{"origem_recusa":"429_provedor","upstream_status":429}' }, "http_429_provedor"],
  ["menção sem status (legado IA/busca)", { httpStatus: null, erro: "Rate limit exceeded (429). Tente mais tarde.", payloadJson: null }, "erro_mencao_429"],
  ["menção por texto de cota sem status", { httpStatus: 500, erro: "erro do gateway: quota exceeded", payloadJson: null }, "erro_mencao_429"],
  ["timeout por status", { httpStatus: 504, erro: "timeout", payloadJson: null }, "timeout"],
  ["timeout por texto", { httpStatus: null, erro: "The operation was aborted due to timeout", payloadJson: null }, "timeout"],
  ["backoff aplicado (fonte pulada)", { httpStatus: null, erro: "pulada: fonte em backoff por 429 recente", payloadJson: null }, "backoff_aplicado"],
  ["operação não executada por cota", { httpStatus: null, erro: "fila de pesquisa pausada: cota_parcial", payloadJson: null }, "nao_executada_cota"],
  ["sem classificação forçada", { httpStatus: null, erro: "erro estranho sem sinal", payloadJson: null }, "outros"],
];
for (const [nome, evt, esperada] of casos429) {
  const got = classificarEvento429(evt);
  ok(got === esperada, `${nome} → ${esperada}`, `got=${got}`);
}
ok(classificarSonda(200, false, "") === "resposta_200_corpo_nao_ok", "regressão v0.10.3: 200+ok:false ≠ sucesso");

/* ============ 3. P3-A — CLASSIFICAÇÃO MULTISSETORIAL PELO CNAE ============ */
console.log("== segmentos: industrial, agroindustrial, financeira, saúde, operadora ==");
const industrial = classificarSetorial("2945-0/00", []);
ok(industrial.setorPrimario?.startsWith("C — Indústrias de transformação (divisão 29") === true, "industrial → C (divisão 29)", industrial.setorPrimario ?? "—");
ok(industrial.multissetorial === false, "industrial não é multissetorial", "");

const agro = classificarSetorial("1011-2/01", ["0111-3/01 — Cultivo de arroz"]);
ok(agro.multissetorial === true, "agroindustrial (C+A) → multissetorial", JSON.stringify(agro));
ok(agro.setoresSecundarios.includes("A") === true, "seção secundária A (agricultura) detectada", JSON.stringify(agro.setoresSecundarios));

const financeira = classificarSetorial("6422-1/00", []);
ok(financeira.setorPrimario?.startsWith("K — Atividades financeiras") === true, "financeira → K (divisão 64)", financeira.setorPrimario ?? "—");

const saude = classificarSetorial("8610-1/01", []);
ok(saude.setorPrimario?.startsWith("Q — Saúde humana") === true, "prestadora de saúde → Q (divisão 86)", saude.setorPrimario ?? "—");

const operadora = classificarSetorial("6550-2/00", []);
ok(operadora.setorPrimario?.startsWith("K — Atividades financeiras") === true, "OPERADORA de plano de saúde (6550-2/00) → K/65, NÃO Q/86 (correção ANS)", operadora.setorPrimario ?? "—");

const multis3 = classificarSetorial("4711-3/02", ["0111-3/01 — Cultivo de arroz", "8610-1/01 — Hospital", "8592-9/99 — Ensino"]);
ok(multis3.multissetorial === true && multis3.setoresSecundarios.join(",") === "A,Q,P", "multissetorial 4 seções (G+A,Q,P)", JSON.stringify(multis3));

console.log("== segmentos: formatos de código e honestidade ==");
ok(divisaoDeCnae("6204000") === "62", "formato 7 dígitos → divisão 62", divisaoDeCnae("6204000") ?? "—");
ok(divisaoDeCnae("6550-2/00") === "65", "formato formatado → divisão 65", divisaoDeCnae("6550-2/00") ?? "—");
ok(subclasseDeCnae("6204000") === "6204-0/00", "7 dígitos → subclasse formatada", subclasseDeCnae("6204000") ?? "—");
ok(subclasseDeCnae("4711-3/02 — Comércio varejista") === "4711-3/02", "formato 'código — descrição' (cnaesSecundarios)", subclasseDeCnae("4711-3/02 — Comércio varejista") ?? "—");
const invalido = classificarSetorial("3400-0/00", []);
ok(invalido.setorPrimario === null && invalido.avisos.length > 0, "divisão inexistente (34) → sem setor + aviso honesto", JSON.stringify(invalido.avisos));
const vazio = classificarSetorial(null, null);
ok(vazio.setorPrimario === null && !vazio.multissetorial && vazio.avisos.length === 0, "ficha sem CNAE → sem setor, sem quebra", "");
ok(setorDeCnae("abc") === null, "lixo → null (nunca lança)", "");

/* ============ 4. PORTÃO DE REUSO ============ */
console.log("== PROMPT_VERSION 2.3.0-v0104: dossiês antigos não são reutilizados ==");
ok(PROMPT_VERSION === "2.3.0-v0104", "versão atual 2.3.0-v0104", PROMPT_VERSION);
ok(PROMPT_VERSION !== "2.2.0-v0103", "portão invalida dossiês da v0.10.3 (ano-isolado-atribui corrigido)");

/* ================= EVIDÊNCIA (frases sintéticas, sem dado sensível) ================= */
const falhasEvid = evidencia.filter((e) => e.resultado === "FAIL").length;
writeFileSync(
  "qa/guarda-temporalidade-v0.10.4.json",
  JSON.stringify(
    {
      geradoEm: new Date().toISOString(),
      suíte: "test-v0104-regressoes.ts (offline, determinístico, sem rede e sem IA)",
      escopo: "guarda de temporalidade v0.10.4 (ano isolado não atribui; fatos preservados por cláusula; regime documentado intacto) + classificação 429 em 6 categorias + P3-A classificação multissetorial pelo CNAE",
      resumo: { total, falhas: falhasEvid + (falhas - falhasEvid), pass: total - falhas },
      casos: evidencia,
      classificacao_429: {
        categorias: ["limite_local", "http_429_provedor", "erro_mencao_429", "timeout", "backoff_aplicado", "nao_executada_cota", "outros"],
        nota: "eventos de telemetria ≠ tentativas ≠ requisições; legados sem status preservado contam como MENÇÃO (o total real do gateway não é inventado)",
      },
      classificacao_setorial: {
        exemplos: {
          industrial_2945: "C — Indústrias de transformação (divisão 29)",
          agroindustrial_1011_0111: "C + A → multissetorial",
          financeira_6422: "K — Atividades financeiras (divisão 64)",
          saude_8610: "Q — Saúde humana (divisão 86)",
          operadora_6550_2_00: "K — Planos de saúde (divisão 65) — correção da proposta ANS (não é Q/86)",
        },
        nota: "classificação CADASTRAL do estabelecimento consultado, derivada localmente do CNAE 2.0 — nunca produto nem necessidade comercial",
      },
      decisões_documentadas: [
        "ANO ISOLADO NÃO ATRIBUI: só exercício/fonte agregada/informação fiscal/'não confirmado' mantém a frase intacta (v0.10.3 tratava qualquer ano como histórico)",
        "frase composta: só a cláusula fiscal é corrigida — por TRECHO quando o predicado é identificável; fatos independentes permanecem byte a byte",
        "negativa fiscal cai na MESMA neutralização honesta (a guarda não afirma o contrário)",
        "regime vigente EFETIVAMENTE documentado (extra.simples/mei = Sim) fica intacto; Lucro Presumido/Real não têm vigência documentada nas fontes públicas",
        "fragmento puramente temporal ('Desde 2022,') que só qualificava a afirmação corrigida é descartado",
        "VALIDAR (instrução) e evidencias[].claim (citação verbatim) permanecem intocados",
      ],
    },
    null,
    2
  ) + "\n"
);
console.log("");
console.log(`TOTAL ${total - falhas}/${total} PASS${falhas ? ` — ${falhas} FAIL` : ""}`);
console.log("evidência: qa/guarda-temporalidade-v0.10.4.json");
process.exit(falhas ? 1 : 0);
